import { describe, expect, it } from 'vitest'

// 复刻 monthlySequenceStatusMeta 的封顶逻辑做纯函数验证
function resolveBadge(earliest: string, planYear: number, now: Date) {
  if (earliest === '') return '各月份已上报完毕'
  const isCurrentYear = planYear === now.getFullYear()
  const currentMonthValue = isCurrentYear
    ? Number(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`)
    : null
  const earliestNum = /^\d{6}$/.test(earliest) ? Number(earliest) : null
  if (currentMonthValue !== null && earliestNum !== null && earliestNum > currentMonthValue) {
    return `${currentMonthValue.toString().slice(4).replace(/^0/, '')}月已上报`
  }
  if (earliest.length === 6) {
    return `${Number(earliest.slice(4, 6))}月未上报`
  }
  return '未填报'
}

describe('状态章逐月推进+当前月封顶', () => {
  const OCT_26 = new Date(2026, 9, 26) // 2026-10-26

  it('计划7月下发、未填报任何月 → 显示 7月未上报', () => {
    expect(resolveBadge('202607', 2026, OCT_26)).toBe('7月未上报')
  })
  it('7/8/9月已报、10月未报 → 显示 10月未上报（当前月）', () => {
    expect(resolveBadge('202610', 2026, OCT_26)).toBe('10月未上报')
  })
  it('10月已填报（报告进入审批）→ 封顶显示 10月已上报，不显示 11月', () => {
    // earliest 已推进到 202611（10月有报告记录）
    expect(resolveBadge('202611', 2026, OCT_26)).toBe('10月已上报')
  })
  it('12个月全填完 → 各月份已上报完毕', () => {
    expect(resolveBadge('', 2026, OCT_26)).toBe('各月份已上报完毕')
  })
  it('非当年计划不做当前月封顶', () => {
    expect(resolveBadge('202701', 2027, OCT_26)).toBe('1月未上报')
  })
})
