import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  APPRAISAL_LEVEL_OPTIONS,
  getAppraisalLevelDisplay
} from '@/features/indicator/lib/appraisalGate'
import { PROGRESS_LEVEL_META, getProgressLevelMeta } from '@/shared/lib/constants/progressLevel'

/**
 * 2026-11-17 领导反馈批量修复（fix/lead-report-batch-fe）源码契约锁。
 *
 * 仓库惯例：巨型 SFC/composable（如 useIndicatorDistributeView 8k 行）不宜整体实例化，
 * 用源码契约锁锁定关键接线（college-two-step-selection / college-add-row-parent 同款模式）。
 *
 * 覆盖点：
 * ① 指标下发页（IndicatorDistributeView，职能部门侧）导出「审核进度」列与网格同源——
 *    实时等级 context 优先（getIndicatorAppraisalLevel），经共享 getChildAppraisalDisplay
 *    映射（修复旧 getChildManualAlertLabel 词表认不出 DELAYED 的问题）；
 *    两个导出 handler 在构建 sheet 前显式 await 加载实时等级 context。
 * ② 指标填报页（IndicatorListView）学院视角父指标内容隐藏：
 *    - 模板不再调用 resolveParentIndicator(row)（父指标名/类型不进入学院模板）；
 *    - 分组不再按 parentIndicatorId（父级核心指标）分组，统一按任务名分组；
 *    - 学院导出「核心指标」表头改为「子指标名称」（与网格同款动态表头）。
 * ③「延期」→「滞后」全局文案统一（领导三-1）：只改显示文案，枚举值 DELAYED 不变——
 *    共享常量与三视图共享 appraisalGate 的行为级断言（直接 import 断言，强于源码锁）。
 */

const readSource = (relative: string): string =>
  readFileSync(resolve(process.cwd(), relative), 'utf8')

const distributeViewSource = readSource('src/3-features/indicator/ui/IndicatorDistributeView.vue')
const listViewModelSource = readSource('src/3-features/indicator/model/useIndicatorListView.ts')

describe('指标下发页导出「审核进度」列与网格同源（领导二-2）', () => {
  it('导出列用实时等级 context 优先 + 行字段兜底，经共享 getChildAppraisalDisplay 映射', () => {
    const expected =
      'getChildAppraisalDisplay(\n          getIndicatorAppraisalLevel(row.child?.id, getChildManualAlertSeverity(row.child))\n        ).label'
    expect(
      distributeViewSource.includes(expected),
      '导出「审核进度」列必须与网格同源：getChildAppraisalDisplay(getIndicatorAppraisalLevel(...)).label'
    ).toBe(true)
    // 旧实现（词表认不出 DELAYED）不得再出现在导出列
    expect(distributeViewSource).not.toContain(
      'getValue: row => getChildManualAlertLabel(getChildManualAlertSeverity(row.child))'
    )
  })

  it('两个导出 handler 在构建 sheet 前显式 await 加载实时等级 context', () => {
    for (const handlerName of [
      'handleExportCurrentDistributionCollege',
      'handleExportSelectedDistributionColleges'
    ]) {
      const startIndex = distributeViewSource.indexOf(`const ${handlerName}`)
      expect(startIndex, `应能定位 ${handlerName}`).toBeGreaterThanOrEqual(0)
      const body = distributeViewSource.slice(
        startIndex,
        distributeViewSource.indexOf('const openDistributionBatchExportDialog') > startIndex
          ? distributeViewSource.indexOf('const openDistributionBatchExportDialog')
          : distributeViewSource.length
      )
      expect(body, `${handlerName} 应在导出前 await loadIndicatorAppraisalContexts(...)`).toContain(
        'await loadIndicatorAppraisalContexts('
      )
    }
  })
})

describe('学院视角父指标内容隐藏（领导二-1）', () => {
  it('填报页模板不再渲染父指标内容（resolveParentIndicator(row) 调用全部移除）', () => {
    const listViewSource = readSource('src/3-features/indicator/ui/IndicatorListView.vue')
    expect(
      listViewSource.includes('resolveParentIndicator(row)'),
      '学院模板曾用 resolveParentIndicator(row) 渲染父级核心指标名/类型，修复后必须全部移除'
    ).toBe(false)
  })

  it('表格分组不再按 parentIndicatorId（父级核心指标）分组，统一按任务名分组', () => {
    expect(
      listViewModelSource.includes('未关联核心指标'),
      'getSpanMethod 学院分支（parentIndicatorId 分组键）应已移除'
    ).toBe(false)
    expect(listViewModelSource).toContain("item?.taskContent || '未关联任务'")
  })

  it('学院导出表头动态化：学院视角「子指标名称」，职能部门视角保持「核心指标」', () => {
    const listViewSource = readSource('src/3-features/indicator/ui/IndicatorListView.vue')
    expect(
      listViewSource.includes("isSecondaryCollege.value ? '子指标名称' : '核心指标'"),
      '导出列头应与网格同款动态表头（学院=子指标名称，职能部门=核心指标不变）'
    ).toBe(true)
  })
})

describe('「延期」→「滞后」全局文案统一（领导三-1，枚举值不变）', () => {
  it('共享进度等级常量：DELAYED 显示「滞后」，AHEAD/NORMAL 不受影响', () => {
    expect(PROGRESS_LEVEL_META.DELAYED.label).toBe('滞后')
    expect(PROGRESS_LEVEL_META.AHEAD.label).toBe('超前完成')
    expect(PROGRESS_LEVEL_META.NORMAL.label).toBe('正常')
    expect(getProgressLevelMeta('DELAYED').label).toBe('滞后')
    expect(getProgressLevelMeta(null).label).toBe('未评定')
  })

  it('三视图共享 appraisalGate：DELAYED 选项与显示态均为「滞后」，枚举值 DELAYED 不变', () => {
    const delayedOption = APPRAISAL_LEVEL_OPTIONS.find(option => option.value === 'DELAYED')
    expect(delayedOption?.label, '下拉选项 label 必须为「滞后」').toBe('滞后')
    expect(getAppraisalLevelDisplay('DELAYED')).toEqual({ label: '滞后', type: 'warning' })
    expect(getAppraisalLevelDisplay(null).label).toBe('未评定')
  })

  it('非禁改区源文件不再出现「延期」显示文案（dashboard/approval 由并行代理负责，不在断言内）', () => {
    const scopedSources = [
      'src/5-shared/lib/constants/progressLevel.ts',
      'src/3-features/indicator/lib/appraisalGate.ts',
      'src/3-features/indicator/lib/reportBatch.ts',
      'src/3-features/indicator/ui/IndicatorListView.vue',
      'src/3-features/indicator/ui/IndicatorDistributeView.vue',
      'src/3-features/indicator/model/useIndicatorDistributeView.ts',
      'src/3-features/plan/ui/IndicatorFillHistory.vue',
      'src/3-features/task/ui/TaskIndicatorTree.vue',
      'src/3-features/task/ui/StrategicTaskView.vue',
      'src/3-features/profile/ui/NotificationSettings.vue',
      'src/5-shared/ui/charts/AlertDistributionChart.vue'
    ]
    for (const relative of scopedSources) {
      expect(readSource(relative).includes('延期'), `${relative} 不应再有「延期」文案残留`).toBe(
        false
      )
    }
  })
})
