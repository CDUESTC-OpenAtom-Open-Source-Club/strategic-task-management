import { describe, expect, it } from 'vitest'

type SequenceMeta = { label: string; type: string; month?: string }

// 复刻 monthlySequenceStatusMeta 的封顶逻辑做纯函数验证（2026-10-30 「当前填报周期」口径）
// 2026-10-30 用户定案：绿色 = 当前周期审批链全部走完（APPROVED）；草稿/审批中/欠账一律灰色
function resolveBadge(
  earliest: string,
  planYear: number,
  now: Date,
  approvalStatus: string
): SequenceMeta {
  if (earliest === '') return { label: '各月份已上报完毕', type: 'success' }
  const isCurrentYear = planYear === now.getFullYear()
  const currentMonthValue = isCurrentYear
    ? Number(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`)
    : null
  const earliestNum = /^\d{6}$/.test(earliest) ? Number(earliest) : null
  if (currentMonthValue !== null && earliestNum !== null && earliestNum > currentMonthValue) {
    // 封顶当前月：仅审批链走完（APPROVED）变绿，草稿/审批中/未知一律灰
    return {
      label: '',
      type: approvalStatus === 'APPROVED' ? 'success' : 'info',
      month: String(currentMonthValue)
    }
  }
  if (/^\d{6}$/.test(earliest)) {
    return { label: '', type: 'info', month: earliest }
  }
  return { label: '未填报', type: 'info' }
}

describe('状态章逐月推进+当前月封顶（当前填报周期口径）', () => {
  const OCT_26 = new Date(2026, 9, 26) // 2026-10-26
  const NOV_2 = new Date(2026, 10, 2) // 2026-11-02（用户截图场景）

  it('计划7月下发、未填报任何月 → 当前填报周期=202607（info，含欠账提示）', () => {
    expect(resolveBadge('202607', 2026, OCT_26, 'DRAFT')).toEqual({
      label: '',
      type: 'info',
      month: '202607'
    })
  })
  it('7/8/9月已报、10月未报 → 当前填报周期=202610（欠账月，info）', () => {
    expect(resolveBadge('202610', 2026, OCT_26, 'DRAFT')).toEqual({
      label: '',
      type: 'info',
      month: '202610'
    })
  })
  it('10月已报且审批链走完（APPROVED）→ 周期封顶 202610（success），不显示 11月', () => {
    // earliest 已推进到 202611（10月有报告记录）且最终环节通过
    expect(resolveBadge('202611', 2026, OCT_26, 'APPROVED')).toEqual({
      label: '',
      type: 'success',
      month: '202610'
    })
  })
  it('10月已报但仍在审批（IN_REVIEW）→ 周期封顶 202610 但保持灰（info）', () => {
    expect(resolveBadge('202611', 2026, OCT_26, 'IN_REVIEW')).toEqual({
      label: '',
      type: 'info',
      month: '202610'
    })
  })
  it('当前月报告还是草稿（DRAFT）→ 封顶当前月但保持灰（info，用户截图场景）', () => {
    // 11月查看，11月报告已创建但还是草稿（earliest 越过当前月），不得变绿
    expect(resolveBadge('202612', 2026, NOV_2, 'DRAFT')).toEqual({
      label: '',
      type: 'info',
      month: '202611'
    })
  })
  it('12个月全填完 → 各月份已上报完毕（success，无周期月）', () => {
    expect(resolveBadge('', 2026, OCT_26, 'APPROVED')).toEqual({
      label: '各月份已上报完毕',
      type: 'success'
    })
  })
  it('非当年计划不做当前月封顶（info）', () => {
    expect(resolveBadge('202701', 2027, OCT_26, 'DRAFT')).toEqual({
      label: '',
      type: 'info',
      month: '202701'
    })
  })
})
