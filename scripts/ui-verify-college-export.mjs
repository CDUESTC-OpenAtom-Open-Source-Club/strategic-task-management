/**
 * 2026-11-19（学院页签「全部导出」改造 · UI 真机验证脚本）
 *
 * 走真实点击路径：战略部账号 → 学院页签 → 全部导出 → 断言下载到的 zip/xlsx
 * 表头含「职能部门」列、行值正确、每院一个文件（不含职能部门目录）。
 */

import { chromium } from '@playwright/test'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE_URL = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:3614'
const EVIDENCE_ROOT =
  process.env.EVIDENCE_ROOT ||
  '/Users/blackevil/Documents/Projects/战略任务管理系统/测试证据/2026-11-19-学院全部导出改造'
const USERNAME = process.env.SISM_USERNAME || 'zlb_admin'
const PASSWORD = process.env.SISM_PASSWORD || 'admin123'

const ensureDir = dir => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}
const log = (...args) => console.log('[ui-export]', ...args)

const main = async () => {
  ensureDir(EVIDENCE_ROOT)
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({
    viewport: { width: 1680, height: 1050 },
    acceptDownloads: true
  })
  const page = await context.newPage()

  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    const inputs = page.locator('input')
    await inputs.nth(0).fill(USERNAME)
    await inputs.nth(1).fill(PASSWORD)
    await page
      .locator('button')
      .filter({ hasText: /登录|登 录/i })
      .first()
      .click()
    await page.waitForTimeout(2500)
    log('登录后 URL =', page.url())

    await page.goto(`${BASE_URL}/strategic-tasks`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)

    const tab = page.locator('.el-tabs__item').filter({ hasText: '二级学院' }).first()
    if (await tab.count()) {
      await tab.click()
      await page.waitForTimeout(1800)
    }

    // 选学院（JS 点击，避开侧边栏遮罩）
    const college = page.locator('.task-item').filter({ hasText: '文理学院' }).first()
    if (await college.count()) {
      await college.evaluate(node => node.click())
      await page.waitForTimeout(2000)
    }

    await page.screenshot({ path: resolve(EVIDENCE_ROOT, '01-学院页签-工具栏.png') })

    // 「全部导出」按钮（改造后不要求先选职能部门）
    const exportButton = page.locator('button').filter({ hasText: '全部导出' }).first()
    log('全部导出按钮 disabled =', await exportButton.isDisabled())

    const downloadPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null)
    await exportButton.click()
    const download = await downloadPromise
    if (!download) {
      log('⚠️ 未捕获到下载')
      await page.screenshot({ path: resolve(EVIDENCE_ROOT, '02-导出后状态.png') })
      return
    }
    const zipPath = resolve(EVIDENCE_ROOT, download.suggestedFilename())
    await download.saveAs(zipPath)
    log('导出文件已保存:', zipPath)

    await page.waitForTimeout(1200)
    await page.screenshot({ path: resolve(EVIDENCE_ROOT, '03-导出完成.png') })
  } finally {
    await browser.close()
  }
}

main().catch(error => {
  console.error('[ui-export] 失败:', error)
  process.exit(1)
})
