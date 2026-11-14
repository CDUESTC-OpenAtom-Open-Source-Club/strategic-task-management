import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheManager } from '@/shared/lib/utils/cache'

const apiGetMock = vi.fn()
const axiosPostMock = vi.fn()

vi.mock('@/shared/api/client', () => ({
  apiClient: {
    get: apiGetMock,
    getAxiosInstance: () => ({
      post: axiosPostMock
    })
  }
}))

vi.mock('@/shared/api', () => ({
  withRetry: <T>(fn: () => Promise<T>) => fn()
}))

vi.mock('@/features/approval/api/approval', () => ({
  approvalApi: {}
}))

vi.mock('@/features/auth/model/store', () => ({
  useAuthStore: () => ({
    user: { id: 1 },
    effectiveRole: 'strategic_dept',
    effectiveDepartment: '战略发展部',
    userDepartment: '战略发展部'
  })
}))

vi.mock('@/shared/lib/timeContext', () => ({
  useTimeContextStore: () => ({
    initialize: async () => {},
    resolveCycleYear: () => 2026
  })
}))

describe('planApi.getAllPlans', () => {
  beforeEach(() => {
    apiGetMock.mockReset()
    axiosPostMock.mockReset()
    cacheManager.clear()
    cacheManager.resetStats()
  })

  it('unwraps paged items payloads returned by backend', async () => {
    const plan = { id: 101, name: 'Plan 101' }
    apiGetMock.mockResolvedValue({
      code: 200,
      message: 'ok',
      timestamp: '2026-03-18T08:00:00Z',
      data: {
        items: [plan]
      }
    })

    const { planApi } = await import('@/features/plan/api/planApi')
    const result = await planApi.getAllPlans()

    expect(apiGetMock).toHaveBeenCalledWith('/plans', { page: 0, size: 1000 })
    expect(result.data).toHaveLength(1)
    expect(result.data?.[0]).toMatchObject(plan)
  })

  it('unwraps content payloads returned by backend page objects', async () => {
    const plan = { id: 202, name: 'Plan 202' }
    apiGetMock.mockResolvedValue({
      code: 200,
      message: 'ok',
      timestamp: '2026-03-18T08:00:00Z',
      data: {
        content: [plan]
      }
    })

    const { planApi } = await import('@/features/plan/api/planApi')
    const result = await planApi.getAllPlans()

    expect(result.data).toHaveLength(1)
    expect(result.data?.[0]).toMatchObject(plan)
  })

  it('uses extended timeout when withdrawing a plan', async () => {
    axiosPostMock.mockResolvedValue({
      success: true,
      code: 200,
      data: {
        id: 4036,
        status: 'DRAFT'
      },
      message: 'ok'
    })

    const { planApi } = await import('@/features/plan/api/planApi')
    const result = await planApi.withdrawPlan(4036)

    expect(axiosPostMock).toHaveBeenCalledWith('/plans/4036/withdraw', undefined, {
      timeout: 90000
    })
    expect(result.data).toMatchObject({ id: 4036, status: 'DRAFT' })
  })
})

/**
 * 2026-11-13（学院上报按归口部门分批提交）：报告摘要查询的 functionalOrgId 请求形状。
 *
 * 后端新契约（ReportController.findReportsByPlanId）支持可选 query functionalOrgId
 * （传了=只看该部门的报告）；学院×部门=独立报告与审批链，战略任务页学院口径的
 * 上报摘要必须按所选归口部门收口。planApi 层由 F1 先行支持（loadPlanReportsByPlanId
 * 透传 + 缓存键按 fno 区分），这里锁请求形状与缓存隔离。
 */
describe('indicatorFillApi.getCurrentMonthPlanReportSummaries · functionalOrgId 请求形状（2026-11-13）', () => {
  beforeEach(() => {
    apiGetMock.mockReset()
    cacheManager.clear()
  })

  it('传 functionalOrgId → GET /reports/plan/{planId}?functionalOrgId=（与后端 Controller 参数名一致）', async () => {
    apiGetMock.mockResolvedValue({
      code: 200,
      message: 'ok',
      data: [
        {
          id: 9001,
          reportOrgId: 37,
          reportMonth: '2026-11',
          status: 'IN_REVIEW',
          functionalOrgId: 37
        }
      ]
    })

    const { indicatorFillApi } = await import('@/features/plan/api/planApi')
    await indicatorFillApi.getCurrentMonthPlanReportSummaries(705489, 37, undefined, 37)

    expect(apiGetMock).toHaveBeenCalledWith('/reports/plan/705489?functionalOrgId=37')
  })

  it('不传 functionalOrgId → 保持聚合口径 URL（旧行为零变化）', async () => {
    apiGetMock.mockResolvedValue({
      code: 200,
      message: 'ok',
      data: []
    })

    const { indicatorFillApi } = await import('@/features/plan/api/planApi')
    await indicatorFillApi.getCurrentMonthPlanReportSummaries(705489, 37)

    expect(apiGetMock).toHaveBeenCalledWith('/reports/plan/705489')
  })

  it('不同 functionalOrgId 缓存键隔离（切部门必发新请求，不串上一个部门的报告）', async () => {
    apiGetMock.mockResolvedValue({
      code: 200,
      message: 'ok',
      data: []
    })

    const { indicatorFillApi } = await import('@/features/plan/api/planApi')
    await indicatorFillApi.getCurrentMonthPlanReportSummaries(705489, 37, undefined, 37)
    await indicatorFillApi.getCurrentMonthPlanReportSummaries(705489, 37, undefined, 44)

    expect(apiGetMock).toHaveBeenCalledTimes(2)
    expect(apiGetMock).toHaveBeenNthCalledWith(1, '/reports/plan/705489?functionalOrgId=37')
    expect(apiGetMock).toHaveBeenNthCalledWith(2, '/reports/plan/705489?functionalOrgId=44')
  })

  it('同 plan/org/functionalOrgId 并发调用共享在途请求（只发一次，在途去重契约）', async () => {
    // 注：loadPlanReportsByPlanId 的既有契约是「在途去重 + TTL 清理」，TTL 内不回放缓存
    // （2026-10-27 保存后立即取新列表的取舍），此处锁定在途去重不受 functionalOrgId 改造影响
    apiGetMock.mockImplementation(
      () =>
        new Promise(resolve =>
          setTimeout(
            () =>
              resolve({
                code: 200,
                message: 'ok',
                data: []
              }),
            10
          )
        )
    )

    const { indicatorFillApi } = await import('@/features/plan/api/planApi')
    await Promise.all([
      indicatorFillApi.getCurrentMonthPlanReportSummaries(705489, 37, undefined, 37),
      indicatorFillApi.getCurrentMonthPlanReportSummaries(705489, 37, undefined, 37)
    ])

    expect(apiGetMock).toHaveBeenCalledTimes(1)
    expect(apiGetMock).toHaveBeenCalledWith('/reports/plan/705489?functionalOrgId=37')
  })
})
