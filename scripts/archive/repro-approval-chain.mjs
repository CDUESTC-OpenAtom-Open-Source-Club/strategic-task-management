#!/usr/bin/env node
/**
 * 审批链复现器 —— 针对「界面显示可审批、点击后后端拒绝」这类缺陷
 *
 * 场景：以某个审批人账号登录 → 消息中心找到目标待办卡片 → 打开审批抽屉 →
 *       记录「审批通过」按钮是否存在 → 点击 → 抓取后端 HTTP 状态码、界面提示文案、
 *       抽屉是否关闭，形成一份可复跑的结构化结果。
 *
 * 用法：
 *   node scripts/repro-approval-chain.mjs --account jiwei_audit1:admin123 \
 *     --card-contains "分管职能部门负责人审批" --out /tmp/repro-d.json
 *
 * 退出码：0 = 审批成功；1 = 被拒或异常（可用于回归闸门）
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

const BASE = arg('base', 'http://127.0.0.1:3500').replace(/\/$/, '')
const [account, password = 'admin123'] = arg('account', 'zlb_demo:admin123').split(':')
const CARD = arg('card-contains', '审批')
const OUT = arg('out', '')

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] })
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } })
  const page = await ctx.newPage()

  const result = {
    base: BASE,
    account,
    cardKeyword: CARD,
    loginUrl: null,
    cardFound: false,
    cardText: '',
    approveButtonVisible: false,
    approveButtonEnabled: false,
    httpStatus: null,
    responseBody: null,
    toasts: [],
    drawerClosed: false,
    verdict: 'UNKNOWN'
  }

  const apiCalls = []
  page.on('response', async res => {
    const url = res.url()
    if (!/workflows\/tasks\/.*\/(approve|reject)/.test(url)) return
    let body = null
    try {
      body = (await res.text()).slice(0, 400)
    } catch {
      /* 响应体可能已被消费 */
    }
    apiCalls.push({ url, status: res.status(), body })
  })

  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.getByPlaceholder('用户名 / 邮箱 / 手机号').fill(account)
    await page.getByPlaceholder('请输入密码').fill(password)
    await page
      .locator('.el-button--primary:visible', { hasText: /登\s*录|登录中/ })
      .first()
      .click()
    await page.waitForTimeout(3000)
    result.loginUrl = page.url()

    await page.goto(`${BASE}/messages`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForTimeout(4000)

    // 找目标卡片：文本包含关键词
    const card = page.locator(`text=${CARD}`).first()
    result.cardFound = (await card.count()) > 0
    if (!result.cardFound) {
      result.verdict = 'CARD_NOT_FOUND'
      const bodyText =
        (await page
          .locator('body')
          .textContent()
          .catch(() => '')) || ''
      result.cardText = bodyText.slice(0, 200)
      throw new Error(`消息中心未找到包含「${CARD}」的待办卡片`)
    }
    result.cardText = ((await card.textContent().catch(() => '')) || '').trim().slice(0, 120)
    await card.click()
    await page.waitForTimeout(2500)

    // 抽屉可能有多个（审批中心 + 详情层），取「含审批通过按钮」的那个
    const approveBtn = page
      .locator('.el-drawer:visible button:visible, .el-dialog:visible button:visible', {
        hasText: '审批通过'
      })
      .first()
    result.approveButtonVisible = (await approveBtn.count()) > 0
    result.approveButtonEnabled = result.approveButtonVisible
      ? await approveBtn.isEnabled().catch(() => false)
      : false

    if (!result.approveButtonVisible) {
      result.verdict = 'NO_APPROVE_BUTTON'
      throw new Error('审批抽屉里没有「审批通过」按钮')
    }

    await approveBtn.click()
    await page.waitForTimeout(1200)

    // 可能弹二次确认框
    const box = page.locator('.el-message-box:visible').last()
    if (await box.count()) {
      const ta = box.locator('textarea:visible')
      if (await ta.count())
        await ta
          .first()
          .fill('自动化复现：审批通过')
          .catch(() => {})
      const confirm = box.locator('button:visible', { hasText: /确\s*认|确\s*定|通\s*过/ }).first()
      if (await confirm.count()) await confirm.click()
    }
    await page.waitForTimeout(3000)

    result.toasts = (
      await page
        .locator('.el-message')
        .allTextContents()
        .catch(() => [])
    ).map(t => t.trim())
    result.drawerClosed =
      (await page.locator('.el-drawer:visible, .el-dialog:visible').count()) === 0

    const call = apiCalls[apiCalls.length - 1]
    if (call) {
      result.httpStatus = call.status
      result.responseBody = call.body
    }

    if (result.httpStatus && result.httpStatus >= 200 && result.httpStatus < 300) {
      result.verdict = 'APPROVED'
    } else if (result.httpStatus) {
      result.verdict = `REJECTED_${result.httpStatus}`
    } else if (result.toasts.some(t => /审批通过/.test(t))) {
      result.verdict = 'APPROVED'
    } else {
      result.verdict = 'NO_RESPONSE'
    }
  } catch (err) {
    if (result.verdict === 'UNKNOWN') result.verdict = 'ERROR'
    result.error = String(err.message).slice(0, 300)
  } finally {
    console.log('\n===== 复现结果 =====')
    console.log(JSON.stringify(result, null, 2))
    if (OUT) {
      fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8')
      console.log(`明细已写入: ${OUT}`)
    }
    await browser.close()
    process.exit(result.verdict === 'APPROVED' ? 0 : 1)
  }
}

main()
