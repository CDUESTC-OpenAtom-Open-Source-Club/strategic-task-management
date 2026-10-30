#!/usr/bin/env node
/**
 * 控制台错误扫描器 —— 「生产构建 + 逐页逐角色」回归闸门
 *
 * 为什么需要它：setup 阶段的 TDZ（Cannot access 'x' before initialization）会被 Vue
 * 全局错误处理吞成一条 console error，页面照常渲染、功能表面正常，
 * type-check / 单元测试 / 冒烟测试都不监听 console error —— 所以「本地全绿」和
 * 「线上带病」可以长期并存（本项目 2026-10-30 的审批抽屉 TDZ 就是这么漏出去的）。
 *
 * 用法：
 *   node scripts/scan-console-errors.mjs --base http://127.0.0.1:4174 \
 *     --account zlb_demo:admin123 --account jiaowu_demo:admin123 \
 *     --routes /dashboard,/strategic-tasks,/indicators,/distribution,/messages,/profile \
 *     --out /tmp/console-scan.json
 *
 * 退出码：0 = 无错误；1 = 有错误（可用于 CI 闸门）
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'))

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`)
  return idx > -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback
}
function argAll(name) {
  const out = []
  process.argv.forEach((v, i) => {
    if (v === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1])
  })
  return out
}

const BASE = arg('base', 'http://127.0.0.1:4174').replace(/\/$/, '')
const ACCOUNTS = argAll('account').map(pair => {
  const [account, password] = pair.split(':')
  return { account, password: password || 'admin123' }
})
const ROUTES = arg(
  'routes',
  '/dashboard,/strategic-tasks,/indicators,/distribution,/messages,/profile'
).split(',')
const OUT = arg('out', '')
const SETTLE_MS = Number(arg('settle', 3000))

// 业务上「预期会失败」的请求：登录失败、无权限、资源冲突等不算前端缺陷
const IGNORE_PATTERNS = [/Failed to load resource/i, /net::ERR_/i, /favicon/i]

function isRealError(text) {
  if (!text) return false
  return !IGNORE_PATTERNS.some(re => re.test(text))
}

async function login(page, account, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  const accountInput = page.getByPlaceholder('用户名 / 邮箱 / 手机号')
  await accountInput.waitFor({ state: 'visible', timeout: 15000 })
  await accountInput.fill(account)
  await page.getByPlaceholder('请输入密码').fill(password)
  await page
    .locator('.el-button--primary:visible', { hasText: /登\s*录|登录中/ })
    .first()
    .click()
  await page.waitForTimeout(3000)
  const url = page.url()
  if (url.includes('/login')) {
    throw new Error(`登录失败：${account}（仍停留在登录页）`)
  }
}

async function scanAccount(browser, { account, password }) {
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } })
  const page = await ctx.newPage()
  const findings = []
  let currentRoute = '/'

  page.on('console', msg => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (!isRealError(text)) return
    findings.push({ account, route: currentRoute, kind: 'console.error', text: text.slice(0, 400) })
  })
  page.on('pageerror', err => {
    findings.push({
      account,
      route: currentRoute,
      kind: 'pageerror',
      text: String(err?.message || err).slice(0, 400)
    })
  })
  page.on('requestfailed', req => {
    const failure = req.failure()?.errorText || ''
    if (!isRealError(failure)) return
    findings.push({
      account,
      route: currentRoute,
      kind: 'requestfailed',
      text: `${req.method()} ${req.url()} :: ${failure}`.slice(0, 400)
    })
  })

  try {
    await login(page, account, password)
    for (const route of ROUTES) {
      currentRoute = route
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(SETTLE_MS)
    }
  } catch (err) {
    findings.push({
      account,
      route: currentRoute,
      kind: 'scan.abort',
      text: String(err.message).slice(0, 300)
    })
  } finally {
    await ctx.close()
  }
  return findings
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] })
  const all = []
  for (const acc of ACCOUNTS) {
    const found = await scanAccount(browser, acc)
    all.push(...found)
    console.log(`[scan] ${acc.account}: ${found.length} 条`)
  }
  await browser.close()

  // 去重：同一账号同一路由同一文本只算一次
  const seen = new Set()
  const unique = all.filter(f => {
    const key = `${f.account}|${f.route}|${f.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const tdz = unique.filter(f => /before initialization|Cannot access|ReferenceError/i.test(f.text))
  const byAccount = {}
  for (const f of unique) {
    byAccount[f.account] = (byAccount[f.account] || 0) + 1
  }

  const report = {
    base: BASE,
    routes: ROUTES,
    accounts: ACCOUNTS.map(a => a.account),
    total: unique.length,
    tdzLike: tdz.length,
    byAccount,
    findings: unique
  }

  console.log('\n===== 扫描结果 =====')
  console.log(
    `总错误: ${unique.length}  |  TDZ 类: ${tdz.length}  |  按账号:`,
    JSON.stringify(byAccount)
  )
  for (const f of unique.slice(0, 30)) {
    console.log(`  [${f.account}] ${f.route} (${f.kind}) ${f.text}`)
  }

  if (OUT) {
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8')
    console.log(`\n明细已写入: ${OUT}`)
  }
  process.exit(unique.length > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('[scan] 致命错误:', err)
  process.exit(2)
})
