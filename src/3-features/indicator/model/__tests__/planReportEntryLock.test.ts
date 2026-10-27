import { describe, expect, it } from 'vitest'
import { findEarliestUnfilledReportMonth } from '../planReportEntryLock'

describe('findEarliestUnfilledReportMonth（起算月口径）', () => {
  // 2026-10-27 用户定案：填报从「计划下发给该组织的那个月」起算，不是从 1 月起算
  it('没有起算月时仍从 1 月扫（历史行为兜底）', () => {
    expect(findEarliestUnfilledReportMonth([], 2026)).toBe('202601')
    expect(findEarliestUnfilledReportMonth(['202601'], 2026)).toBe('202602')
  })

  it('起算月为 2 月时，不要求补 1 月', () => {
    // 计划 2 月下发 → 从 2 月开始填；1 月不算欠账
    expect(findEarliestUnfilledReportMonth([], 2026, '202602')).toBe('202602')
  })

  it('起算月之前的月份即便未填报也不计入欠账', () => {
    // 起算月 202610，已填 202610、202611 → 最早未填是 202612，不回到 202601
    expect(findEarliestUnfilledReportMonth(['202610', '202611'], 2026, '202610')).toBe('202612')
  })

  it('起算月到 12 月全部已填时返回空串（无可填月）', () => {
    const filled = Array.from({ length: 3 }, (_, i) => `2026${String(10 + i).padStart(2, '0')}`)
    expect(findEarliestUnfilledReportMonth(filled, 2026, '202610')).toBe('')
  })

  it('起算月格式非法时退回从 1 月扫', () => {
    expect(findEarliestUnfilledReportMonth([], 2026, 'abc')).toBe('202601')
    expect(findEarliestUnfilledReportMonth([], 2026, '202613')).toBe('202601')
    expect(findEarliestUnfilledReportMonth([], 2026, '')).toBe('202601')
  })

  it('起算月年份与目标年份不一致时退回从 1 月扫', () => {
    expect(findEarliestUnfilledReportMonth([], 2026, '202502')).toBe('202601')
  })

  it('已填月份集合不可得时返回 null（交由调用方降级）', () => {
    expect(findEarliestUnfilledReportMonth(null, 2026, '202610')).toBeNull()
  })

  it('起算月之前的月份已填也不影响结果（起点就是起算月）', () => {
    expect(findEarliestUnfilledReportMonth(['202601', '202602'], 2026, '202603')).toBe('202603')
  })
})
