import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiGet } = vi.hoisted(() => ({
  apiGet: vi.fn()
}))

vi.mock('@/shared/config/api', async importOriginal => {
  const actual = await importOriginal<typeof import('@/shared/config/api')>()
  return {
    ...actual,
    USE_MOCK: false
  }
})

vi.mock('@/shared/api/client', () => ({
  apiClient: {
    get: apiGet,
    post: vi.fn(),
    put: vi.fn()
  }
}))

vi.mock('@/shared/api', () => ({
  withRetry: <T>(fn: () => Promise<T>) => fn()
}))

/**
 * 缺陷修复：同月第二个指标填报被锁到下一个月、保存时后端 409。
 * 「最早未填报月」需要指标级粒度（该指标的明细出现在某月报告中才算已填），
 * 与后端防跳月校验对齐：指标 A 已有 202601 记录、指标 B 无 → B 的填报月份应为 202601。
 */
describe('indicatorFillApi.getExistingReportMonthsForIndicator', () => {
  let indicatorFillApi: typeof import('@/features/plan/api/planApi').indicatorFillApi
  let findEarliestUnfilledReportMonth: typeof import('@/features/indicator/model/planReportEntryLock').findEarliestUnfilledReportMonth

  const YEAR = Number(new Date().toISOString().slice(0, 4))

  beforeEach(async () => {
    vi.resetModules()
    apiGet.mockReset()

    // 计划 111 已有一份 202601 报告，其中只有指标 2001 的明细（指标 2002 尚未填报）
    apiGet.mockImplementation((url: string) => {
      if (url === '/reports/plan/111') {
        return Promise.resolve({
          success: true,
          data: [
            {
              id: 6,
              planId: 111,
              reportMonth: `${YEAR}01`,
              reportOrgId: 39,
              status: 'DRAFT',
              indicatorDetails: [{ indicatorId: 2001, progress: 30 }]
            }
          ]
        })
      }

      return Promise.resolve({ success: true, data: [] })
    })
    ;({ indicatorFillApi } = await import('@/features/plan/api/planApi'))
    ;({ findEarliestUnfilledReportMonth } =
      await import('@/features/indicator/model/planReportEntryLock'))
  })

  it('counts a month as filled for indicator A only when its own detail exists', async () => {
    const monthsA = await indicatorFillApi.getExistingReportMonthsForIndicator(111, 39, 2001)
    const monthsB = await indicatorFillApi.getExistingReportMonthsForIndicator(111, 39, 2002)

    expect(monthsA).toEqual([`${YEAR}01`])
    expect(monthsB).toEqual([])
  })

  it('keeps indicator B locked to 202601 (not 202602) after indicator A saved a 202601 draft', async () => {
    const monthsB = await indicatorFillApi.getExistingReportMonthsForIndicator(111, 39, 2002)
    const earliestMonthForB = findEarliestUnfilledReportMonth(monthsB, YEAR)

    // 缺陷回归用例：B 的弹窗月份必须是 202601（B 自己的最早无记录月），否则后端防跳月校验 409
    expect(earliestMonthForB).toBe(`${YEAR}01`)
  })

  it('advanced indicator A to the next month after its 202601 record', async () => {
    const monthsA = await indicatorFillApi.getExistingReportMonthsForIndicator(111, 39, 2001)
    expect(findEarliestUnfilledReportMonth(monthsA, YEAR)).toBe(`${YEAR}02`)
  })

  it('returns null when the report list fails to load (caller degrades)', async () => {
    apiGet.mockImplementation(() => Promise.reject(new Error('network down')))
    const months = await indicatorFillApi.getExistingReportMonthsForIndicator(111, 39, 2002)
    expect(months).toBeNull()
  })
})
