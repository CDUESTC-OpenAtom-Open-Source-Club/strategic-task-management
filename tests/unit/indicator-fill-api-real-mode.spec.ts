import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiGet, apiPost, apiPut, getIndicatorById, loadDepartments } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  getIndicatorById: vi.fn(),
  loadDepartments: vi.fn()
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

vi.mock('@/features/auth/model/store', () => ({
  useAuthStore: () => ({
    user: { id: 124 },
    effectiveRole: 'strategic_dept',
    effectiveDepartment: '战略发展部',
    userDepartment: '战略发展部'
  })
}))

vi.mock('@/features/organization/model/store', () => ({
  useOrgStore: () => ({
    loaded: true,
    departments: [{ id: 39, name: '战略发展部', type: 'functional_dept' }],
    getDepartmentByName: (name: string) =>
      name === '战略发展部' ? { id: 39, name: '战略发展部', type: 'functional_dept' } : undefined,
    loadDepartments
  })
}))

vi.mock('@/features/approval/api/approval', () => ({
  approvalApi: {}
}))

const currentReportMonth = new Date().toISOString().slice(0, 7).replace('-', '')

describe('indicatorFillApi real report flow', () => {
  let indicatorFillApi: typeof import('@/features/plan/api/planApi').indicatorFillApi

  beforeEach(() => {
    vi.resetModules()
    apiGet.mockReset()
    apiPost.mockReset()
    apiPut.mockReset()
    getIndicatorById.mockReset()
    loadDepartments.mockReset()

    getIndicatorById.mockResolvedValue({
      success: true,
      data: {
        id: 30022,
        taskId: 93011,
        indicatorName: '年度预算执行率',
        targetOrgId: 39,
        targetOrgName: '战略发展部'
      }
    })

    apiGet.mockImplementation((url: string) => {
      if (url === '/tasks/93011') {
        return Promise.resolve({
          success: true,
          data: {
            planId: 111
          }
        })
      }

      return Promise.resolve({
        success: true,
        data: []
      })
    })
  })

  beforeEach(async () => {
    ;({ indicatorFillApi } = await import('@/features/plan/api/planApi'))
  })

  it('blocks saving when the current month report is already in review', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/tasks/93011') {
        return Promise.resolve({
          success: true,
          data: {
            planId: 111
          }
        })
      }

      if (url === '/reports/plan/111') {
        return Promise.resolve({
          success: true,
          data: [
            {
              id: 6,
              planId: 111,
              reportMonth: currentReportMonth,
              reportOrgId: 39,
              status: 'IN_REVIEW',
              updatedAt: '2026-03-18T10:00:00.000Z'
            }
          ]
        })
      }

      return Promise.resolve({
        success: true,
        data: []
      })
    })

    await expect(
      indicatorFillApi.saveFill({
        indicator_id: 30022,
        progress: 80,
        content: '本月已提交后的二次保存尝试'
      })
    ).rejects.toThrow('本月已有上报正在审批中')

    expect(apiPost).not.toHaveBeenCalled()
    expect(apiPut).not.toHaveBeenCalled()
  })

  it('updates an editable existing current month report instead of creating a duplicate', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/tasks/93011') {
        return Promise.resolve({
          success: true,
          data: {
            planId: 111
          }
        })
      }

      if (url === '/reports/plan/111') {
        return Promise.resolve({
          success: true,
          data: [
            {
              id: 9,
              planId: 111,
              reportMonth: currentReportMonth,
              reportOrgId: 39,
              status: 'REJECTED',
              updatedAt: '2026-03-18T10:00:00.000Z'
            }
          ]
        })
      }

      return Promise.resolve({
        success: true,
        data: []
      })
    })

    apiPut.mockResolvedValue({
      success: true,
      data: {
        id: 9,
        planId: 111,
        reportMonth: currentReportMonth,
        reportOrgId: 39,
        status: 'REJECTED',
        progress: 66,
        content: '驳回后修改并重新保存',
        updatedAt: '2026-03-18T11:00:00.000Z',
        createdAt: '2026-03-01T00:00:00.000Z'
      }
    })

    const response = await indicatorFillApi.saveFill({
      indicator_id: 30022,
      progress: 66,
      content: '驳回后修改并重新保存'
    })

    expect(apiPost).not.toHaveBeenCalled()
    expect(apiPut).toHaveBeenCalledWith(
      '/reports/9',
      expect.objectContaining({
        title: '年度预算执行率',
        indicatorId: 30022,
        content: '驳回后修改并重新保存',
        summary: '驳回后修改并重新保存',
        progress: 66,
        issues: '驳回后修改并重新保存',
        nextPlan: '驳回后修改并重新保存',
        operatorUserId: 124
      })
    )
    expect(response.data.id).toBe(9)
    expect(response.data.content).toBe('驳回后修改并重新保存')
  })

  it('submits the current month plan report for secondary college flow', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/reports/plan/111') {
        return Promise.resolve({
          success: true,
          data: [
            {
              id: 12,
              planId: 111,
              reportMonth: currentReportMonth,
              reportOrgId: 39,
              status: 'DRAFT',
              auditInstanceId: 901,
              updatedAt: '2026-03-18T10:00:00.000Z',
              createdAt: '2026-03-01T00:00:00.000Z'
            }
          ]
        })
      }

      if (url === '/reports/12') {
        return Promise.resolve({
          success: true,
          data: {
            id: 12,
            planId: 111,
            reportMonth: currentReportMonth,
            reportOrgId: 39,
            status: 'IN_REVIEW',
            auditInstanceId: 901,
            updatedAt: '2026-03-18T11:00:00.000Z',
            createdAt: '2026-03-01T00:00:00.000Z'
          }
        })
      }

      if (url === '/workflows/instances/901') {
        return Promise.resolve({
          success: true,
          data: {
            instanceId: 901,
            currentTaskId: 3001,
            status: 'IN_REVIEW',
            canWithdraw: true,
            currentStepName: '学院审批人审批'
          }
        })
      }

      return Promise.resolve({
        success: true,
        data: []
      })
    })

    apiPost.mockResolvedValueOnce({
      success: true,
      data: {
        id: 12
      }
    })

    const response = await indicatorFillApi.submitCurrentMonthPlanReport(111, 39)

    // 2026-10-31：重报说明透传后 submit 增加可选 body（comment）——空说明传 undefined body
    expect(apiPost).toHaveBeenCalledWith('/reports/12/submit?userId=124', undefined)
    expect(response.id).toBe(12)
    expect(response.workflowInstanceId).toBe(901)
    expect(response.workflowStatus).toBe('IN_REVIEW')
    expect(response.canWithdraw).toBe(true)
  })

  it('withdraws the current month plan report via its workflow instance', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/reports/plan/111') {
        return Promise.resolve({
          success: true,
          data: [
            {
              id: 15,
              planId: 111,
              reportMonth: currentReportMonth,
              reportOrgId: 39,
              status: 'IN_REVIEW',
              workflowInstanceId: 902,
              canWithdraw: true,
              updatedAt: '2026-03-18T10:00:00.000Z',
              createdAt: '2026-03-01T00:00:00.000Z'
            }
          ]
        })
      }

      if (url === '/workflows/instances/entity/PLAN_REPORT/15') {
        return Promise.resolve({
          success: true,
          data: {
            instanceId: 902,
            currentTaskId: 3002,
            status: 'IN_REVIEW',
            canWithdraw: true,
            currentStepName: '学院院长审批'
          }
        })
      }

      if (url === '/reports/15') {
        return Promise.resolve({
          success: true,
          data: {
            id: 15,
            planId: 111,
            reportMonth: currentReportMonth,
            reportOrgId: 39,
            status: 'DRAFT',
            auditInstanceId: 902,
            updatedAt: '2026-03-18T12:00:00.000Z',
            createdAt: '2026-03-01T00:00:00.000Z'
          }
        })
      }

      if (url === '/workflows/instances/902') {
        return Promise.resolve({
          success: true,
          data: {
            instanceId: 902,
            status: 'CANCELLED',
            canWithdraw: false
          }
        })
      }

      return Promise.resolve({
        success: true,
        data: []
      })
    })

    apiPost.mockResolvedValueOnce({
      success: true,
      data: null
    })

    const response = await indicatorFillApi.withdrawCurrentMonthPlanReport(111, 39)

    expect(apiPost).toHaveBeenCalledWith('/workflows/902/cancel')
    expect(response.id).toBe(15)
    expect(response.status).toBe('DRAFT')
    expect(response.workflowStatus).toBe('CANCELLED')
    expect(response.canWithdraw).toBe(false)
  })
})
