/**
 * Task Feature - Query API
 *
 * Read-only API operations for task data.
 */

import { apiClient as api } from '@/shared/api/client'
import { buildQueryKey, fetchWithCache } from '@/shared/lib/utils/cache'
import { createMemoryDetailPolicy, createSessionListPolicy } from '@/shared/lib/utils/cache-config'
import { getCachedUserContext } from '@/shared/lib/utils/cacheContext'
import type { ApiResponse, StrategicTask } from '@/shared/types'

const TASK_LIST_POLICY = createSessionListPolicy({
  tags: ['task.list']
})

const TASK_DETAIL_POLICY = createMemoryDetailPolicy({
  tags: ['task.detail']
})

function withTaskCacheContext(params?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...getCachedUserContext(),
    ...(params ?? {}),
    version: 'v1'
  }
}

/**
 * Get tasks by year
 *
 * API: GET /api/v1/cycles?year=... -> GET /api/v1/tasks/by-cycle/{cycleId}
 *
 * @param year - Year
 * @returns Tasks for the year
 */
export async function getTasksByYear(year: number): Promise<ApiResponse<StrategicTask[]>> {
  const cycleResponse = await api.get<
    ApiResponse<{
      content?: Array<{ cycleId?: number; id?: number }>
    }>
  >('/cycles', {
    year,
    page: 0,
    size: 1
  })

  const cycle = cycleResponse?.data?.content?.[0]
  const cycleId = cycle?.cycleId ?? cycle?.id

  if (!cycleResponse?.success || !cycleId) {
    return {
      success: false,
      code: cycleResponse?.code ?? 404,
      message: cycleResponse?.message || `No cycle found for year ${year}`,
      data: [],
      timestamp: cycleResponse?.timestamp ?? new Date().toISOString()
    }
  }

  return fetchWithCache<ApiResponse<StrategicTask[]>>({
    key: buildQueryKey('task', 'list', withTaskCacheContext({ year })),
    policy: {
      ...TASK_LIST_POLICY,
      tags: ['task.list', `task.year.${year}`]
    },
    fetcher: () => api.get(`/tasks/by-cycle/${cycleId}`)
  })
}

/**
 * Get task by ID
 *
 * API: GET /api/v1/tasks/{id}
 *
 * @param taskId - Task ID
 * @returns Task details
 */
export async function getTaskById(taskId: number): Promise<ApiResponse<StrategicTask>> {
  return fetchWithCache({
    key: buildQueryKey('task', 'detail', withTaskCacheContext({ taskId })),
    policy: {
      ...TASK_DETAIL_POLICY,
      tags: ['task.detail', `task.detail.${taskId}`]
    },
    fetcher: () => api.get(`/tasks/${taskId}`)
  })
}

/**
 * Get tasks by organization
 *
 * API: GET /api/v1/tasks/by-org/{orgId}
 *
 * @param orgId - Organization ID
 * @returns Tasks for organization
 */
export async function getTasksByOrg(orgId: number): Promise<ApiResponse<StrategicTask[]>> {
  return fetchWithCache({
    key: buildQueryKey('task', 'list', withTaskCacheContext({ orgId })),
    policy: {
      ...TASK_LIST_POLICY,
      tags: ['task.list', `task.org.${orgId}`]
    },
    fetcher: () => api.get(`/tasks/by-org/${orgId}`)
  })
}

/**
 * Get tasks by status
 *
 * 后端不支持 /tasks/by-status/{status} 端点
 * Task 的 status 字段是 @Transient（不存储在数据库中），从关联的 Plan 获取
 * 暂时返回空结果，需要按 status 过滤时请通过 Plan 关联查询
 *
 * @param status - Task status (not used, kept for API compatibility)
 * @returns Empty result (status filtering not supported)
 */
export async function getTasksByStatus(_status: string): Promise<ApiResponse<StrategicTask[]>> {
  // 后端不支持按 status 查询，返回空结果
  return {
    success: true,
    code: 200,
    message: 'Status filtering not supported, returning empty result',
    data: [],
    timestamp: new Date().toISOString()
  }
}

/**
 * Search tasks
 *
 * API: GET /api/v1/tasks/search
 *
 * @param keyword - Search keyword
 * @returns Matching tasks
 */
export async function searchTasks(keyword: string): Promise<ApiResponse<StrategicTask[]>> {
  return fetchWithCache({
    key: buildQueryKey('task', 'search', withTaskCacheContext({ keyword })),
    policy: {
      ...TASK_LIST_POLICY,
      tags: ['task.list', 'task.search']
    },
    fetcher: () => api.get('/tasks/search', { taskName: keyword })
  })
}

/**
 * Get task indicators
 *
 * API: GET /api/v1/indicators/task/{id}
 *
 * @param taskId - Task ID
 * @returns Task indicators
 */
export async function getTaskIndicators(taskId: number): Promise<ApiResponse<any[]>> {
  return fetchWithCache({
    key: buildQueryKey('task', 'indicators', withTaskCacheContext({ taskId })),
    policy: {
      ...TASK_DETAIL_POLICY,
      staleWhileRevalidate: true,
      tags: ['task.detail', `task.detail.${taskId}`, 'indicator.list', `indicator.task.${taskId}`]
    },
    fetcher: () => api.get(`/indicators/task/${taskId}`)
  })
}
