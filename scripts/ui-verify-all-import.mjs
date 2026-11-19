/**
 * 2026-11-19（学院全部导入 · UI 真机验证脚本）
 *
 * 用途：Playwright 有头直连本地前后端，走真实点击路径验证「全部导入」的分组预览 /
 * 执行清单 / 逐组结果，并把截图存到「测试证据/2026-11-19-全部导入-UI/」。
 *
 * 跑法（在 worktree 根目录）：
 *   VITE_DEV_SERVER_URL=http://127.0.0.1:3614 node scripts/ui-verify-all-import.mjs
 */

import { chromium } from '@playwright/test'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE_URL = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:3614'
const EVIDENCE_ROOT =
  process.env.EVIDENCE_ROOT ||
  '/Users/blackevil/Documents/Projects/战略任务管理系统/测试证据/2026-11-19-全部导入-UI'
const FIXTURE_DIR = resolve(EVIDENCE_ROOT, '测试文件')
const USERNAME = process.env.SISM_USERNAME || 'zlb_admin'
const PASSWORD = process.env.SISM_PASSWORD || 'admin123'

const SCENARIOS = [
  {
    dir: '场景A-双组将下发',
    file: '场景A-双组将下发-计算机学院.xlsx',
    college: '计算机学院',
    expect: ['分组总数', '将下发', '执行清单', '教务处', '数字校园建设办公室']
  },
  {
    dir: '场景B-B组权重不足',
    file: '场景B-B组权重不足-计算机学院.xlsx',
    college: '计算机学院',
    expect: ['错误组', '基础性权重合计 85/100', '数字校园建设办公室组基础性权重合计']
  },
  {
    dir: '场景C-归属不符',
    file: '场景C-归属不符-计算机学院.xlsx',
    college: '计算机学院',
    expect: ['无法归组', '职能部门与核心指标归属不符']
  },
  {
    dir: '场景D-两组将跳过',
    file: '场景D-两组将跳过-文理学院.xlsx',
    college: '文理学院',
    expect: ['已下发 · 本次将跳过', '这条线已下发']
  }
]

const ensureDir = dir => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

const log = (...args) => console.log('[ui-verify]', ...args)

const login = async page => {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  const inputs = page.locator('input')
  const count = await inputs.count()
  if (count >= 2) {
    await inputs.nth(0).fill(USERNAME)
    await inputs.nth(1).fill(PASSWORD)
  }
  const loginButton = page
    .locator('button')
    .filter({ hasText: /登录|登 录|Login/i })
    .first()
  await loginButton.click()
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
    // 侧边栏可能被折叠遮罩挡住（pointer events 被拦截）→ 用 JS 触发点击
    await item.evaluate(node => node.click())
    await page.waitForTimeout(2000)
  }
}

const openAllImportDialog = async page => {
  // 注意：按钮含图标节点，text() 带空白 → 用 includes 而非正则锚定
  const button = page.locator('button').filter({ hasText: '全部导入' }).first()
  await button.click()
  await page.waitForTimeout(1200)
}

const uploadFile = async (page, filePath) => {
  const input = page.locator('.el-dialog input[type="file"]').first()
  await input.setInputFiles(filePath)
  await page.waitForTimeout(1200)
}

const clickPreview = async page => {
  const button = page.locator('.el-dialog button').filter({ hasText: '解析预览' }).first()
  await button.click()
  await page.waitForTimeout(2500)
}

const main = async () => {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({ viewport: { width: 1680, height: 1050 } })
  const page = await context.newPage()
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('  [browser error]', msg.text().slice(0, 200))
    }
  })

  try {
    // ---------- 改前对比图（现状：无「全部导入」按钮） ----------
    const beforeDir = resolve(EVIDENCE_ROOT, '00-改前对比-无全部导入按钮')
    ensureDir(beforeDir)
    await login(page)
    await gotoStrategicTasks(page)
    await switchToCollegeTab(page)
    await selectCollege(page, '计算机学院')
    await page.screenshot({ path: resolve(beforeDir, '01-学院页签-改前.png'), fullPage: false })
    log('改前对比图已保存')

    for (const scenario of SCENARIOS) {
      const dir = resolve(EVIDENCE_ROOT, scenario.dir)
      ensureDir(dir)
      log('场景开始:', scenario.dir)

      // 回到学院页签并选学院
      await switchToCollegeTab(page)
      await selectCollege(page, scenario.college)

      await openAllImportDialog(page)
      await page.screenshot({ path: resolve(dir, '01-全部导入弹窗-打开.png') })

      // 下载模板（9 列 + 职能部门列）
      const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null)
      await page
        .locator('.el-dialog button')
        .filter({ hasText: '下载模板' })
        .first()
        .click()
      const download = await downloadPromise
      if (download) {
        const templatePath = resolve(dir, `模板-${scenario.file}`)
        await download.saveAs(templatePath)
        log('  模板已下载:', templatePath)
      }
      await page.waitForTimeout(800)

      await uploadFile(page, resolve(FIXTURE_DIR, scenario.file))
      await page.screenshot({ path: resolve(dir, '02-已选文件.png') })

      await clickPreview(page)
      await page.screenshot({ path: resolve(dir, '03-分组预览.png') })
      await page.screenshot({ path: resolve(dir, '04-分组预览-整页.png'), fullPage: true })
      // 滚到分组明细 / 无法归组区（截图取「组卡片 + 独立错误区」）
      const groupCard = page.locator('.el-dialog .group-card').first()
      if (await groupCard.count()) {
        await groupCard.evaluate(node => node.scrollIntoView({ block: 'start' }))
        await page.waitForTimeout(600)
      }
      await page.screenshot({ path: resolve(dir, '05-分组明细-组卡片.png') })
      const unassigned = page.locator('.el-dialog .group-card--error').last()
      if (await unassigned.count()) {
        await unassigned.evaluate(node => node.scrollIntoView({ block: 'center' }))
        await page.waitForTimeout(600)
      }
      await page.screenshot({ path: resolve(dir, '06-无法归组行-独立错误区.png') })
      await page.locator('.el-dialog').evaluate(node => node.scrollTo({ top: 0 }))
      await page.waitForTimeout(400)

      const dialogText = await page.locator('.el-dialog').innerText()
      const missing = scenario.expect.filter(text => !dialogText.includes(text))
      if (missing.length > 0) {
        console.log('  ⚠️ 预期文案缺失:', missing.join(' / '))
      } else {
        log('  ✓ 分组预览三类信息全部命中')
      }

      // 确认按钮置灰状态
      const confirmButton = page
        .locator('.el-dialog button')
        .filter({ hasText: '确认全部导入' })
        .first()
      const disabled = await confirmButton.isDisabled().catch(() => null)
      log('  确认按钮 disabled =', disabled)

      // 关闭弹窗
      const cancelButton = page.locator('.el-dialog button').filter({ hasText: '取消' }).first()
      await cancelButton.click()
      await page.waitForTimeout(800)
      log('场景完成:', scenario.dir)
    }

    // ---------- 结果页（场景A 走完整提交） ----------
    const resultDir = resolve(EVIDENCE_ROOT, '场景A2-提交后逐组结果')
    ensureDir(resultDir)
    await switchToCollegeTab(page)
    await selectCollege(page, '艺术与科技学院')
    await openAllImportDialog(page)
    await uploadFile(page, resolve(FIXTURE_DIR, '场景A2-成功下发-艺术与科技学院.xlsx'))
    await clickPreview(page)
    const confirmButton = page
      .locator('.el-dialog button')
      .filter({ hasText: '确认全部导入' })
      .first()
    await confirmButton.click()
    await page.waitForTimeout(1500)
    await page.screenshot({ path: resolve(resultDir, '01-执行清单确认框.png') })
    // 确认框（Element Plus MessageBox）
    const boxConfirm = page
      .locator('.el-message-box button')
      .filter({ hasText: '确认全部导入' })
      .first()
    if (await boxConfirm.count()) {
      await boxConfirm.click()
      await page.waitForTimeout(4000)
    }
    await page.screenshot({ path: resolve(resultDir, '02-逐组结果.png') })
    await page.screenshot({ path: resolve(resultDir, '03-逐组结果-整页.png'), fullPage: true })
    const resultText = await page.locator('.el-dialog').innerText()
    console.log('  结果页文案片段:', resultText.replace(/\s+/g, ' ').slice(0, 600))

    // ---------- 全部导出改造验证 ----------
    const exportDir = resolve(EVIDENCE_ROOT, '场景E-学院全部导出改造')
    ensureDir(exportDir)
    await page.locator('.el-dialog button').filter({ hasText: '关闭' }).first().click().catch(() => {})
    await page.waitForTimeout(500)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(800)
    await switchToCollegeTab(page)
    await selectCollege(page, '计算机学院')
    await page.screenshot({ path: resolve(exportDir, '01-学院页签-全部导出按钮.png') })

    const exportDownload = page.waitForEvent('download', { timeout: 20000 }).catch(() => null)
    await page.locator('button').filter({ hasText: '全部导出' }).first().click()
    const exported = await exportDownload
    if (exported) {
      const exportPath = resolve(exportDir, exported.suggestedFilename())
      await exported.saveAs(exportPath)
      log('  导出文件已保存:', exportPath)
    } else {
      log('  ⚠️ 未捕获到导出下载（可能弹了确认框）')
      await page.screenshot({ path: resolve(exportDir, '02-导出后状态.png') })
    }
  } finally {
    await browser.close()
  }
}

main().catch(error => {
  console.error('[ui-verify] 失败:', error)
  process.exit(1)
})
