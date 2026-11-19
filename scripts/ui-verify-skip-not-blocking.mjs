/**
 * 2026-11-19（学院全部导入 · 缺陷修复真机复验 · 场景E）
 *
 * 场景：**两条线都已下发 + 组内权重不足** —— 修复前被算成「错误组」并阻断整单，
 * 修复后应稳定归「将跳过」、错误组计数为 0、确认按钮可点。
 *
 * 断言（修复后）：
 *   ① 「错误组」计数 = 0
 *   ② 「将跳过」计数 = 2
 *   ③ 确认按钮可点（disabled = false）
 *   ④ 执行清单两组都写「这条线已下发，本次将跳过」
 *
 * 用法：
 *   VITE_DEV_SERVER_URL=http://127.0.0.1:3616 \
 *   EVIDENCE_ROOT=/Users/blackevil/Documents/Projects/战略任务管理系统/测试证据/2026-11-19-全部导入-UI \
 *   SHOT_PREFIX=改后 node scripts/ui-verify-skip-not-blocking.mjs
 */

import { chromium } from '@playwright/test'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE_URL = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:3616'
const EVIDENCE_ROOT =
  process.env.EVIDENCE_ROOT ||
  '/Users/blackevil/Documents/Projects/战略任务管理系统/测试证据/2026-11-19-全部导入-UI'
const OUT_DIR = resolve(EVIDENCE_ROOT, '场景E-跳过组不阻断')
const FIXTURE_DIR = resolve(EVIDENCE_ROOT, '测试文件')
const SHOT_PREFIX = process.env.SHOT_PREFIX || '改后'
const FILE_NAME = '场景E-两条线已下发且组内权重不足-文理学院.xlsx'
const COLLEGE = '文理学院'
const USERNAME = process.env.SISM_USERNAME || 'zlb_admin'
const PASSWORD = process.env.SISM_PASSWORD || 'admin123'

const ensureDir = dir => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

const log = (...args) => console.log('[ui-verify-e]', ...args)

const login = async page => {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const inputs = page.locator('input')
  if ((await inputs.count()) >= 2) {
    await inputs.nth(0).fill(USERNAME)
    await inputs.nth(1).fill(PASSWORD)
  }
  await page.locator('button').filter({ hasText: /登录|登 录|Login/i }).first().click()
  await page.waitForTimeout(2500)
  log('登录后 URL =', page.url())
}

const gotoStrategicTasks = async page => {
  await page.goto(`${BASE_URL}/strategic-tasks`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
}

const switchToCollegeTab = async page => {
  const tab = page.locator('.el-tabs__item').filter({ hasText: '二级学院' }).first()
  if (await tab.count()) {
    await tab.click()
    await page.waitForTimeout(2000)
  }
}

const selectCollege = async (page, college) => {
  const item = page.locator('.task-item').filter({ hasText: college }).first()
  if (await item.count()) {
    await item.evaluate(node => node.click())
    await page.waitForTimeout(2000)
  }
}

const openAllImportDialog = async page => {
  await page.locator('button').filter({ hasText: '全部导入' }).first().click()
  await page.waitForTimeout(1200)
}

const uploadFile = async (page, filePath) => {
  await page.locator('.el-dialog input[type="file"]').first().setInputFiles(filePath)
  await page.waitForTimeout(1200)
}

const clickPreview = async page => {
  await page.locator('.el-dialog button').filter({ hasText: '解析预览' }).first().click()
  await page.waitForTimeout(3000)
}

/** 读「分组总数 / 将下发 / 将跳过 / 错误组 / 无法归组行」五个计数 */
const readStats = async page => {
  return page.locator('.el-dialog .preview-stat').evaluateAll(nodes => {
    const out = {}
    for (const node of nodes) {
      const label = (node.querySelector('span')?.textContent || '').trim()
      const value = (node.querySelector('strong')?.textContent || '').trim()
      out[label] = value
    }
    return out
  })
}

const main = async () => {
  ensureDir(OUT_DIR)
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({ viewport: { width: 1680, height: 1050 } })
  const page = await context.newPage()
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('  [browser error]', msg.text().slice(0, 200))
  })

  try {
    await login(page)
    await gotoStrategicTasks(page)
    await switchToCollegeTab(page)
    await selectCollege(page, COLLEGE)

    await openAllImportDialog(page)
    await page.screenshot({ path: resolve(OUT_DIR, `${SHOT_PREFIX}-01-全部导入弹窗-打开.png`) })

    await uploadFile(page, resolve(FIXTURE_DIR, FILE_NAME))
    await page.screenshot({ path: resolve(OUT_DIR, `${SHOT_PREFIX}-02-已选文件.png`) })

    await clickPreview(page)
    await page.screenshot({ path: resolve(OUT_DIR, `${SHOT_PREFIX}-03-分组预览.png`) })
    await page.screenshot({
      path: resolve(OUT_DIR, `${SHOT_PREFIX}-04-分组预览-整页.png`),
      fullPage: true
    })

    const stats = await readStats(page)
    log('分组统计 =', JSON.stringify(stats, null, 0))

    const dialogText = await page.locator('.el-dialog').innerText()

    // 执行清单区域单独截图
    const plan = page.locator('.el-dialog .execution-plan').first()
    if (await plan.count()) {
      await plan.evaluate(node => node.scrollIntoView({ block: 'center' }))
      await page.waitForTimeout(600)
      await page.screenshot({ path: resolve(OUT_DIR, `${SHOT_PREFIX}-05-执行清单.png`) })
    }
    // 分组明细（组卡片）单独截图
    const groupCard = page.locator('.el-dialog .group-card').first()
    if (await groupCard.count()) {
      await groupCard.evaluate(node => node.scrollIntoView({ block: 'start' }))
      await page.waitForTimeout(600)
      await page.screenshot({ path: resolve(OUT_DIR, `${SHOT_PREFIX}-06-分组明细-组卡片.png`) })
    }
    await page.locator('.el-dialog').evaluate(node => node.scrollTo({ top: 0 }))
    await page.waitForTimeout(400)

    const confirmButton = page
      .locator('.el-dialog button')
      .filter({ hasText: '确认全部导入' })
      .first()
    const disabled = await confirmButton.isDisabled().catch(() => null)
    log('确认按钮 disabled =', disabled)

    // ---------------- 断言 ----------------
    const failures = []
    const check = (ok, msg) => {
      log(`${ok ? '✓' : '✗'} ${msg}`)
      if (!ok) failures.push(msg)
    }

    check(stats['错误组'] === '0', `「错误组」计数 = 0（实际 ${stats['错误组']}）`)
    check(stats['将跳过'] === '2', `「将跳过」计数 = 2（实际 ${stats['将跳过']}）`)
    check(stats['将下发'] === '0', `「将下发」计数 = 0（实际 ${stats['将下发']}）`)
    check(disabled === false, `确认按钮可点（disabled = ${disabled}）`)
    check(
      dialogText.includes('这条线已下发，本次将跳过'),
      '执行清单写明「这条线已下发，本次将跳过」'
    )
    check(!dialogText.includes('不能下发'), '执行清单不含「不能下发」组级错误')
    check(!dialogText.includes('存在错误组或无法归组的行'), '无「存在错误组…」阻断提示')

    // 逐组核对执行清单条目
    const planText = (await plan.count()) ? await plan.innerText() : dialogText
    const skipMentions = (planText.match(/这条线已下发，本次将跳过/g) || []).length
    check(skipMentions >= 2, `执行清单两组都写了跳过原因（命中 ${skipMentions} 处）`)

    // 截图：阻断提示区（若有）
    const alert = page.locator('.el-dialog .el-alert').first()
    if (await alert.count()) {
      await alert.evaluate(node => node.scrollIntoView({ block: 'center' }))
      await page.waitForTimeout(500)
      await page.screenshot({ path: resolve(OUT_DIR, `${SHOT_PREFIX}-07-阻断提示区.png`) })
    }

    // 结果落盘（机器可读）
    const report = {
      shotPrefix: SHOT_PREFIX,
      stats,
      confirmButtonDisabled: disabled,
      skipMentions,
      failures
    }
    console.log('REPORT_JSON=' + JSON.stringify(report))

    if (failures.length) {
      console.log('❌ 断言未通过：', failures.join(' / '))
      process.exitCode = 1
    } else {
      console.log('✅ 场景E 全部断言通过')
    }
  } finally {
    await browser.close()
  }
}

main().catch(error => {
  console.error('[ui-verify-e] 失败:', error)
  process.exit(1)
})
