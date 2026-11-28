/**
 * 「进度说明」列 100 字截断契约锁定（2026-11-28 用户拍板）。
 *
 * 口径：表格单元格内最多显示 100 字，超长截断加省略号；悬浮气泡展示全文，
 * 悬浮启用阈值与截断阈值统一为 PROGRESS_REMARK_MAX_LENGTH（=100）。
 * 详情弹窗、审批抽屉说明卡、上报记录弹窗、Excel 导出等全量展示位不受影响。
 *
 * 三大视图（战略任务管理 / 指标填报 / 指标下发）挂载成本高且仓库无挂载先例，
 * 本测试沿用 appraisal-inline-select-no-popup 的 grep 契约模式：直接断言
 * 4 处进度说明列的源码写法，锁定阈值不再回落到旧的 50。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const projectRoot = join(__dirname, '..', '..', '..')
const srcRoot = join(projectRoot, 'src')

const readSource = (relativePath: string) => readFileSync(join(srcRoot, relativePath), 'utf8')

const strategicTaskView = () => readSource('3-features/task/ui/StrategicTaskView.vue')
const indicatorListView = () => readSource('3-features/indicator/ui/IndicatorListView.vue')
const indicatorDistributeView = () =>
  readSource('3-features/indicator/ui/IndicatorDistributeView.vue')

describe('进度说明 100 字截断契约（2026-11-28 用户拍板）', () => {
  it('常量定义为 100 且放在 formatters 的 truncateText 旁', () => {
    const formatters = readSource('5-shared/lib/utils/formatters.ts')
    expect(formatters).toContain('export const PROGRESS_REMARK_MAX_LENGTH = 100')
  })

  it('战略任务管理页两个 tab 的进度说明列均用统一阈值截断+悬浮', () => {
    const source = strategicTaskView()
    // 两个 tab 同款列：截断与悬浮阈值都用常量，不再出现旧的 50
    expect(source).not.toContain("(row.pendingRemark || '').length <= 50")
    expect(source.split('popper-class="pending-remark-tooltip"').length - 1).toBe(2)
    expect(source).toContain(
      ':disabled="(row.pendingRemark || \'\').length <= PROGRESS_REMARK_MAX_LENGTH"'
    )
    expect(source).toContain("truncateText(row.pendingRemark || '', PROGRESS_REMARK_MAX_LENGTH)")
  })

  it('填报页进度说明列用统一阈值截断+悬浮（保留 pending-remark-text）', () => {
    const source = indicatorListView()
    expect(source).not.toContain("(row.pendingRemark || '').length <= 50")
    expect(source).toContain(
      ':disabled="(row.pendingRemark || \'\').length <= PROGRESS_REMARK_MAX_LENGTH"'
    )
    expect(source).toContain("truncateText(row.pendingRemark || '', PROGRESS_REMARK_MAX_LENGTH)")
    expect(source).toContain('class="pending-remark-text"')
    expect(source).toContain('popper-class="pending-remark-tooltip"')
  })

  it('下发页子行进度说明列用统一阈值截断+悬浮（父行「-」不动）', () => {
    const source = indicatorDistributeView()
    expect(source).not.toContain("(row.child?.pendingRemark || '').length <= 50")
    expect(source).toContain(
      ':disabled="\n                          (row.child?.pendingRemark || \'\').length <= PROGRESS_REMARK_MAX_LENGTH\n                        "'
    )
    expect(source).toContain(
      "truncateText(row.child?.pendingRemark || '', PROGRESS_REMARK_MAX_LENGTH)"
    )
    expect(source).toContain('popper-class="pending-remark-tooltip"')
  })

  it('气泡限宽样式 pending-remark-tooltip 已定义（max-width 480px）', () => {
    const expected = '.pending-remark-tooltip'
    expect(strategicTaskView()).toContain(expected)
    expect(indicatorListView()).toContain(expected)
    expect(readSource('3-features/indicator/ui/IndicatorDistributeView.global.css')).toContain(
      'max-width: 480px'
    )
  })
})
