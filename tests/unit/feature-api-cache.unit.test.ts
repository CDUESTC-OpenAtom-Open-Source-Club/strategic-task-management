import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { buildQueryKey, cacheManager } from '@/shared/lib/utils/cache'
import { queryIndicators } from '@/features/indicator/api/query'
import { getAllPlans, getPlanById } from '@/features/plan/api/query'
import { updatePlan } from '@/features/plan/api/mutations'
import { getTasksByOrg } from '@/features/task/api/query'
import { orgApi } from '@/features/organization/api/org'
import { useTimeContextStore } from '@/shared/lib/timeContext'

const apiClientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn()
}))

vi.mock('@/shared/api/client', () => ({
  apiClient: apiClientMock
}))

vi.mock('@/features/workflow/api', () => ({
  approveTask: vi.fn(),
  rejectTask: vi.fn(),
  startWorkflow: vi.fn()
}))

describe('feature API cache integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    cacheManager.clear()
    cacheManager.resetStats()
    sessionStorage.clear()
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    cacheManager.clear()
    cacheManager.resetStats()
    sessionStorage.clear()
    localStorage.clear()
  })

  it('caches indicator list queries in session scope', async () => {
    const indicator = {
      id: 1,
      name: '招生规模',
      taskId: 10,
      level: 'FIRST',
      ownerOrgId: 2,
      targetOrgId: 3,
      type: 'QUANTITATIVE',
      status: 'DRAFT',
      workflowStatus: 'DRAFT',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z'
    }

    apiClientMock.get.mockResolvedValue({
      data: {
        content: [indicator],
        totalElements: 1,
        totalPages: 1,
        number: 0,
        size: 20
      }
    })

    const filters = { year: 2026, ownerOrgId: 2 }
    const first = await queryIndicators(filters as never)
    const second = await queryIndicators(filters as never)

    expect(first.content).toHaveLength(1)
    expect(second.content).toHaveLength(1)
    expect(apiClientMock.get).toHaveBeenCalledTimes(1)
    expect(
      cacheManager.get(buildQueryKey('indicator', 'list', { ...filters, version: 'v1' }))?.scope
    ).toBe('session')
  })

  it('invalidates cached plan list and detail entries after plan update', async () => {
    apiClientMock.get
      .mockResolvedValueOnce({
        success: true,
        code: 200,
        message: 'ok',
        data: [
          {
            id: 9,
            name: '2026年度计划',
            cycle: '2026',
            org_id: 1,
            status: 'draft',
            tasks: []
          }
        ],
        timestamp: Date.now()
      })
      .mockResolvedValueOnce({
        success: true,
        code: 200,
        message: 'ok',
        data: {
          id: 9,
          name: '2026年度计划',
          cycle: '2026',
          org_id: 1,
          status: 'draft',
          tasks: []
        },
        timestamp: Date.now()
      })

    apiClientMock.put.mockResolvedValue({
      success: true,
      code: 200,
      message: 'updated',
      data: {
        id: 9,
        name: '已更新计划',
        cycle: '2026',
        org_id: 1,
        status: 'draft',
        tasks: []
      },
      timestamp: Date.now()
    })

    await getAllPlans()
    await getPlanById(9)

    expect(cacheManager.get(buildQueryKey('plan', 'list', { version: 'v1' }))).toBeDefined()
    expect(
      cacheManager.get(buildQueryKey('plan', 'detail', { planId: '9', version: 'v1' }))
    ).toBeDefined()

    await updatePlan(9, { name: '已更新计划' })

    expect(cacheManager.get(buildQueryKey('plan', 'list', { version: 'v1' }))).toBeUndefined()
    expect(
      cacheManager.get(buildQueryKey('plan', 'detail', { planId: '9', version: 'v1' }))
    ).toBeUndefined()
  })

  it('caches task organization queries in session scope', async () => {
    apiClientMock.get.mockResolvedValue({
      success: true,
      code: 200,
      message: 'ok',
      data: [
        {
          taskId: 12,
          cycleId: 2026,
          taskName: '重点任务',
          taskDesc: null,
          taskType: '定量',
          responsibleDept: '教务处',
          weight: 10,
          targetValue: 100,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z'
        }
      ],
      timestamp: Date.now()
    })

    await getTasksByOrg(7)
    await getTasksByOrg(7)

    expect(apiClientMock.get).toHaveBeenCalledTimes(1)
    expect(
      cacheManager.get(buildQueryKey('task', 'list', { orgId: 7, version: 'v1' }))?.scope
    ).toBe('session')
  })

  it('stores organization cache in session scope with versioned key', async () => {
    apiClientMock.get.mockResolvedValue({
      success: true,
      data: [
        {
          orgId: 11,
          orgName: '战略发展部',
          orgType: 'admin',
          sortOrder: 1
        }
      ]
    })

    await orgApi.getAllDepartments()

    expect(cacheManager.get(buildQueryKey('org', 'departments', { version: 'v2' }))?.scope).toBe(
      'session'
    )
  })

  it('persists cycle list cache for time context initialization', async () => {
    apiClientMock.get.mockResolvedValue({
      success: true,
      data: [
        {
          cycleId: 4,
          cycleName: '2026年度考核周期',
          year: 2026,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
          description: null,
          createdAt: '2026-01-01T00:00:00',
          updatedAt: '2026-01-01T00:00:00'
        }
      ]
    })

    const timeContext = useTimeContextStore()
    await timeContext.initialize()

    const cycleKey = buildQueryKey('cycle', 'list', { version: 'v1' })
    expect(cacheManager.get(cycleKey)?.scope).toBe('session')
  })
})
