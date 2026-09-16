import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useStrategicStore } from '@/features/task/model/strategic'

const { createIndicatorMock, loadDepartmentsMock } = vi.hoisted(() => ({
  createIndicatorMock: vi.fn(),
  loadDepartmentsMock: vi.fn()
}))

vi.mock('@/features/indicator/api', () => ({
  indicatorApi: {
    createIndicator: createIndicatorMock
  }
}))

vi.mock('@/features/task/api/strategicApi', () => ({
  strategicApi: {}
}))

vi.mock('@/shared/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

vi.mock('@/features/organization/model/store', () => ({
  useOrgStore: () => ({
    loaded: true,
    departments: [
      { id: '1', name: '战略发展部', type: 'strategic_dept', sortOrder: 1 },
      { id: '2', name: '教务部', type: 'functional_dept', sortOrder: 2 }
    ],
    loadDepartments: loadDepartmentsMock
  })
}))

describe('useStrategicStore addIndicator', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    createIndicatorMock.mockReset()
  })

  it('sends normalized indicator type when creating a strategic task indicator', async () => {
    createIndicatorMock.mockResolvedValue({
      success: true,
      data: {
        id: 101,
        indicatorDesc: '核心指标A',
        type1: '定性',
        weightPercent: 20,
        progress: 0,
        ownerOrgId: 1,
        targetOrgId: 2
      }
    })

    const store = useStrategicStore()

    await store.addIndicator({
      id: 'temp-1',
      name: '核心指标A',
      type1: '定性',
      type2: '发展性',
      isQualitative: true,
      weight: 20,
      progress: 0,
      createTime: '2026-03-29',
      remark: '测试',
      canWithdraw: true,
      targetValue: 100,
      unit: '%',
      responsibleDept: '教务部',
      ownerDept: '战略发展部',
      responsiblePerson: '测试用户',
      status: 'active',
      isStrategic: true,
      year: 2026,
      statusAudit: [],
      taskContent: '战略任务A'
    } as any)

    expect(createIndicatorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        indicatorDesc: '核心指标A',
        type1: '定性',
        ownerOrgId: 1,
        targetOrgId: 2
      })
    )
  })
})
