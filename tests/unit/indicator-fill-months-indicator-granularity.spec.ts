import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiGet, apiPost, apiPut, getIndicatorById } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  getIndicatorById: vi.fn()
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
    post: apiPost,
    put: apiPut,
    getAxiosInstance: () => ({
      get: async (...args: Parameters<typeof apiGet>) => {
        const data = await apiGet(...args)
        return {
          status: 200,
          data
        }
      }
    })
  }
}))

vi.mock('@/shared/api', () => ({
  withRetry: <T>(fn: () => Promise<T>) => fn()
}))

vi.mock('@/features/indicator/api', () => ({
  indicatorApi: {
    getIndicatorById
  }
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

/**
 * 缺陷回归（月份单一数据源）：202601 已存在 APPROVED 报告（含指标 A 明细）时，
 * 保存指标 A 的目标月 202602 —— 建草稿 POST 必须使用目标月 202602，
 * 不得再按旧口径创建 202601 空草稿（409 + 脏草稿的根源）。
 */
describe('indicatorFillApi.saveFill keeps the explicit target report month', () => {
  let indicatorFillApi: typeof import('@/features/plan/api/planApi').indicatorFillApi

  beforeEach(async () => {
    vi.resetModules()
    apiGet.mockReset()
    apiPost.mockReset()
    apiPut.mockReset()
    getIndicatorById.mockReset()

    getIndicatorById.mockResolvedValue({
      success: true,
      data: {
        id: 2001,
        taskId: 93011,
        targetOrgId: 39,
        targetOrgName: '战略发展部'
      }
    })

    // 本地库现状：plan 4036 / report 5（202601，APPROVED，含指标 2001 明细）
    apiGet.mockImplementation((url: string) => {
      if (url === '/tasks/93011') {
        return Promise.resolve({
          success: true,
          data: { planId: 4036 }
        })
      }

      if (url === '/reports/plan/4036') {
        return Promise.resolve({
          success: true,
          data: [
            {
              id: 5,
              planId: 4036,
              reportMonth: '202601',
              reportOrgId: 39,
              status: 'APPROVED',
              indicatorDetails: [{ indicatorId: 2001, progress: 30 }]
            }
          ]
        })
      }

      return Promise.resolve({ success: true, data: [] })
    })

    apiPost.mockResolvedValue({
      success: true,
      data: {
        id: 7,
        planId: 4036,
        reportMonth: '202602',
        reportOrgId: 39,
        status: 'DRAFT'
      },
      message: '创建成功'
    })

    apiPut.mockResolvedValue({
      success: true,
      data: {
        id: 7,
        planId: 4036,
        reportMonth: '202602',
        reportOrgId: 39,
        status: 'DRAFT',
        indicatorDetails: [{ indicatorId: 2001, progress: 70 }]
      },
      message: '保存成功'
    })
    ;({ indicatorFillApi } = await import('@/features/plan/api/planApi'))
  })

  it('creates the draft at the explicit target month 202602, never at 202601', async () => {
    await indicatorFillApi.saveFill({
      indicator_id: 2001,
      progress: 70,
      content: '本月推进情况',
      reportMonth: '202602'
    })

    expect(apiPost).toHaveBeenCalledTimes(1)
    const [postUrl, postPayload] = apiPost.mock.calls[0]
    expect(postUrl).toBe('/reports')
    // 单一数据源：建草稿月份 === 弹窗目标月，绝不能回落到已结清的 202601
    expect(postPayload.reportMonth).toBe('202602')
    expect(postPayload.reportMonth).not.toBe('202601')
    expect(postPayload.planId).toBe(4036)
    expect(postPayload.reportOrgId).toBe(39)

    // 明细 PUT 落在新建的目标月草稿上
    expect(apiPut).toHaveBeenCalledTimes(1)
    const [putUrl] = apiPut.mock.calls[0]
    expect(putUrl).toBe('/reports/7')
  })

  it('falls back to the current month only when no explicit month is provided', async () => {
    const currentMonth = new Date().toISOString().slice(0, 7).replace('-', '')

    await indicatorFillApi.saveFill({
      indicator_id: 2001,
      progress: 70,
      content: '本月推进情况'
    })

    const [, postPayload] = apiPost.mock.calls[0]
    expect(postPayload.reportMonth).toBe(currentMonth)
  })
})
