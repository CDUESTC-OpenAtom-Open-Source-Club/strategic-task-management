import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { cacheManager } from '@/shared/lib/utils/cache'
import { getTasksByYear } from '@/features/task/api/query'

const apiClientMock = vi.hoisted(() => ({
  get: vi.fn()
}))

vi.mock('@/shared/api/client', () => ({
  apiClient: apiClientMock
}))

describe('task query getTasksByYear', () => {
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

  it('resolves the cycle first and fetches tasks by cycle instead of pulling /tasks for local filtering', async () => {
    apiClientMock.get
      .mockResolvedValueOnce({
        success: true,
        code: 200,
        message: 'ok',
        data: {
          content: [
            {
              cycleId: 4,
              year: 2026
            }
          ]
        },
        timestamp: '2026-04-04T10:00:00'
      })
      .mockResolvedValueOnce({
        success: true,
        code: 200,
        message: 'ok',
        data: [
          {
            taskId: 41003,
            cycleId: 4,
            taskName: '重点任务',
            taskDesc: null,
            taskType: '定量',
            responsibleDept: '战略发展部',
            weight: 10,
            targetValue: 100,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z'
          }
        ],
        timestamp: '2026-04-04T10:00:01'
      })

    const response = await getTasksByYear(2026)

    expect(apiClientMock.get).toHaveBeenNthCalledWith(1, '/cycles', {
      year: 2026,
      page: 0,
      size: 1
    })
    expect(apiClientMock.get).toHaveBeenNthCalledWith(2, '/tasks/by-cycle/4')
    expect(apiClientMock.get).not.toHaveBeenCalledWith('/tasks')
    expect(response.data).toHaveLength(1)
    expect(response.data?.[0]?.taskId).toBe(41003)
  })
})
