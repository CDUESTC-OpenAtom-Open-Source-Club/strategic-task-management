/**
 * Workflow Feature - Query API
 *
 * Read operations for workflow data using new API (/api/v1/workflows)
 */

import { apiClient } from '@/shared/api/client'
import { buildQueryKey, fetchWithCache } from '@/shared/lib/utils/cache'
import {
  CACHE_TTL,
  createMemoryDetailPolicy,
  createShortMemoryPolicy
} from '@/shared/lib/utils/cache-config'
import { getCachedUserContext } from '@/shared/lib/utils/cacheContext'
import type { ApiResponse } from '@/shared/types'
import type {
  WorkflowDefinitionResponse,
  WorkflowDefinitionPreviewResponse,
  WorkflowHistoryCardResponse,
  WorkflowInstanceResponse,
  WorkflowTaskResponse,
  WorkflowInstanceDetailResponse,
  PageResult
} from './types'

const WORKFLOW_STABLE_POLICY = createShortMemoryPolicy(CACHE_TTL.DETAIL, {
  staleWhileRevalidate: true,
  tags: ['workflow.definitions']
})

const WORKFLOW_TODO_POLICY = createShortMemoryPolicy(CACHE_TTL.WORKFLOW_TODO, {
  staleWhileRevalidate: false,
  tags: ['workflow.todo']
})

const WORKFLOW_DETAIL_POLICY = createMemoryDetailPolicy({
  ttlMs: CACHE_TTL.WORKFLOW_DETAIL,
  tags: ['workflow.detail'],
  staleWhileRevalidate: false
})

function withWorkflowContext(params?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...getCachedUserContext(),
    ...(params ?? {}),
    version: 'v1'
  }
}

function isForbiddenError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const status =
    'response' in error
      ? Number((error as { response?: { status?: number } }).response?.status ?? NaN)
      : Number((error as { status?: number }).status ?? NaN)

  return status === 403
}

function buildForbiddenEmptyPageResult<T>(
  pageNum: number,
  pageSize: number
): ApiResponse<PageResult<T>> {
  return {
    success: true,
    code: 200,
    message: '当前账号无权查看工作流数据，已按空数据处理',
    data: {
      items: [],
      total: 0,
      pageNum,
      pageSize
    },
    timestamp: new Date().toISOString()
  }
}

/**
 * Get workflow definitions with pagination
 *
 * API: GET /api/v1/workflows/definitions
 *
 * @param pageNum - Page number (default: 1)
 * @param pageSize - Page size (default: 10)
 * @returns Paginated workflow definitions
 */
export async function getWorkflowDefinitions(
  pageNum: number = 1,
  pageSize: number = 10
): Promise<ApiResponse<PageResult<WorkflowDefinitionResponse>>> {
  return fetchWithCache({
    key: buildQueryKey('workflow', 'definitions', withWorkflowContext({ pageNum, pageSize })),
    policy: {
      ...WORKFLOW_STABLE_POLICY,
      tags: ['workflow.definitions']
    },
    fetcher: () => apiClient.get('/workflows/definitions', { pageNum, pageSize })
  })
}

/**
 * Get workflow definition by ID
 *
 * API: GET /api/v1/workflows/definitions/{definitionId}
 *
 * @param definitionId - Workflow definition ID
 * @returns Workflow definition details
 */
export async function getWorkflowDefinitionById(
  definitionId: string
): Promise<ApiResponse<WorkflowDefinitionResponse>> {
  return fetchWithCache({
    key: buildQueryKey('workflow', 'definition', withWorkflowContext({ definitionId })),
    policy: {
      ...WORKFLOW_STABLE_POLICY,
      tags: ['workflow.definitions', `workflow.definition.${definitionId}`]
    },
    fetcher: () => apiClient.get(`/workflows/definitions/${definitionId}`)
  })
}

/**
 * Get workflow definition by code
 *
 * API: GET /api/v1/workflows/definitions/code/{flowCode}
 *
 * @param flowCode - Workflow flow code
 * @returns Workflow definition details
 */
export async function getWorkflowDefinitionByCode(
  flowCode: string
): Promise<ApiResponse<WorkflowDefinitionResponse>> {
  return fetchWithCache({
    key: buildQueryKey('workflow', 'definitionByCode', withWorkflowContext({ flowCode })),
    policy: {
      ...WORKFLOW_STABLE_POLICY,
      tags: ['workflow.definitions', `workflow.code.${flowCode}`]
    },
    fetcher: () => apiClient.get(`/workflows/definitions/code/${flowCode}`)
  })
}

/**
 * Preview workflow definition with candidate approvers
 *
 * API: GET /api/v1/workflows/definitions/code/{flowCode}/preview
 */
export async function getWorkflowDefinitionPreviewByCode(
  flowCode: string
): Promise<ApiResponse<WorkflowDefinitionPreviewResponse>> {
  return fetchWithCache({
    key: buildQueryKey('workflow', 'definitionPreview', withWorkflowContext({ flowCode })),
    policy: {
      ...WORKFLOW_STABLE_POLICY,
      ttlMs: 30 * 1000,
      tags: ['workflow.definitions', `workflow.preview.${flowCode}`]
    },
    fetcher: () => apiClient.get(`/workflows/definitions/code/${flowCode}/preview`)
  })
}

/**
 * Get workflow definitions by entity type
 *
 * API: GET /api/v1/workflows/definitions/entity-type/{entityType}
 *
 * @param entityType - Entity type (e.g., 'TASK', 'INDICATOR')
 * @returns List of workflow definitions
 */
export async function getWorkflowDefinitionsByEntityType(
  entityType: string
): Promise<ApiResponse<WorkflowDefinitionResponse[]>> {
  return fetchWithCache({
    key: buildQueryKey('workflow', 'definitionsByEntityType', withWorkflowContext({ entityType })),
    policy: {
      ...WORKFLOW_STABLE_POLICY,
      tags: ['workflow.definitions', `workflow.entityType.${entityType}`]
    },
    fetcher: () => apiClient.get(`/workflows/definitions/entity-type/${entityType}`)
  })
}

/**
 * Get workflow instances for a specific definition
 *
 * API: GET /api/v1/workflows/{definitionId}/instances
 *
 * @param definitionId - Workflow definition ID
 * @param pageNum - Page number (default: 1)
 * @param pageSize - Page size (default: 10)
 * @returns Paginated workflow instances
 */
export async function getWorkflowInstances(
  definitionId: string,
  pageNum: number = 1,
  pageSize: number = 10
): Promise<ApiResponse<PageResult<WorkflowInstanceResponse>>> {
  return fetchWithCache({
    key: buildQueryKey(
      'workflow',
      'instances',
      withWorkflowContext({ definitionId, pageNum, pageSize })
    ),
    policy: {
      ...WORKFLOW_STABLE_POLICY,
      ttlMs: 30 * 1000,
      tags: ['workflow.instances']
    },
    fetcher: () => apiClient.get(`/workflows/${definitionId}/instances`, { pageNum, pageSize })
  })
}

/**
 * Get workflow instance detail
 *
 * API: GET /api/v1/workflows/instances/{instanceId}
 *
 * @param instanceId - Workflow instance ID
 * @returns Detailed workflow instance with tasks and history
 */
export async function getWorkflowInstanceDetail(
  instanceId: string
): Promise<ApiResponse<WorkflowInstanceDetailResponse>> {
  return fetchWithCache({
    key: buildQueryKey('workflow', 'detail', withWorkflowContext({ instanceId })),
    policy: {
      ...WORKFLOW_DETAIL_POLICY,
      tags: ['workflow.detail', `workflow.detail.${instanceId}`]
    },
    fetcher: async () => {
      try {
        return await apiClient.get(`/workflows/instances/${instanceId}`)
      } catch (error) {
        if (isForbiddenError(error)) {
          return {
            success: true,
            code: 200,
            message: '当前账号无权查看该工作流实例，已按空数据处理',
            data: undefined,
            timestamp: new Date().toISOString()
          } as ApiResponse<WorkflowInstanceDetailResponse>
        }
        throw error
      }
    }
  })
}

/**
 * Get latest workflow instance detail by business entity.
 *
 * API: GET /api/v1/workflows/instances/entity/{entityType}/{entityId}
 */
export async function getWorkflowInstanceDetailByBusiness(
  entityType: string,
  entityId: number | string,
  options: { force?: boolean } = {}
): Promise<ApiResponse<WorkflowInstanceDetailResponse>> {
  return fetchWithCache({
    key: buildQueryKey(
      'workflow',
      'detailByBusiness',
      withWorkflowContext({ entityType, entityId: String(entityId) })
    ),
    force: options.force === true,
    policy: {
      ...WORKFLOW_DETAIL_POLICY,
      tags: ['workflow.detail', `workflow.business.${entityType}.${entityId}`]
    },
    fetcher: async () => {
      try {
        return await apiClient.get(`/workflows/instances/entity/${entityType}/${entityId}`)
      } catch (error) {
        if (isForbiddenError(error)) {
          return {
            success: true,
            code: 200,
            message: '当前账号无权查看该业务工作流，已按空数据处理',
            data: undefined,
            timestamp: new Date().toISOString()
          } as ApiResponse<WorkflowInstanceDetailResponse>
        }
        throw error
      }
    }
  })
}

/**
 * Get all completed workflow history cards by business entity.
 *
 * API: GET /api/v1/workflows/instances/entity/{entityType}/{entityId}/list
 */
export async function getWorkflowInstanceHistoryByBusiness(
  entityType: string,
  entityId: number | string
): Promise<ApiResponse<WorkflowHistoryCardResponse[]>> {
  return fetchWithCache({
    key: buildQueryKey(
      'workflow',
      'historyByBusiness',
      withWorkflowContext({ entityType, entityId: String(entityId) })
    ),
    policy: {
      ...WORKFLOW_STABLE_POLICY,
      ttlMs: 30 * 1000,
      tags: ['workflow.detail', `workflow.business.${entityType}.${entityId}`]
    },
    fetcher: async () => {
      try {
        return await apiClient.get(`/workflows/instances/entity/${entityType}/${entityId}/list`)
      } catch (error) {
        if (isForbiddenError(error)) {
          return {
            success: true,
            code: 200,
            message: '当前账号无权查看该业务审批历史，已按空数据处理',
            data: [],
            timestamp: new Date().toISOString()
          }
        }
        throw error
      }
    }
  })
}

/**
 * Get my pending workflow tasks
 *
 * API: GET /api/v1/workflows/my-tasks
 *
 * @param pageNum - Page number (default: 1)
 * @returns Paginated pending tasks for current user
 */
export async function getMyPendingTasks(
  pageNum: number = 1
): Promise<ApiResponse<PageResult<WorkflowTaskResponse>>> {
  return fetchWithCache({
    key: buildQueryKey('workflow', 'todo', withWorkflowContext({ pageNum })),
    policy: {
      ...WORKFLOW_TODO_POLICY,
      tags: ['workflow.todo']
    },
    fetcher: async () => {
      try {
        return await apiClient.get('/workflows/my-tasks', { pageNum })
      } catch (error) {
        if (isForbiddenError(error)) {
          return buildForbiddenEmptyPageResult<WorkflowTaskResponse>(pageNum, 10)
        }
        throw error
      }
    }
  })
}

/**
 * Get my approved workflow instances
 *
 * API: GET /api/v1/workflows/my-approved
 *
 * @param pageNum - Page number (default: 1)
 * @param pageSize - Page size (default: 10)
 * @returns Paginated approved instances for current user
 */
export async function getMyApprovedInstances(
  pageNum: number = 1,
  pageSize: number = 10
): Promise<ApiResponse<PageResult<WorkflowInstanceResponse>>> {
  return fetchWithCache({
    key: buildQueryKey('workflow', 'myApproved', withWorkflowContext({ pageNum, pageSize })),
    policy: {
      ...WORKFLOW_TODO_POLICY,
      ttlMs: 30 * 1000,
      tags: ['workflow.instances']
    },
    fetcher: async () => {
      try {
        return await apiClient.get('/workflows/my-approved', { pageNum, pageSize })
      } catch (error) {
        if (isForbiddenError(error)) {
          return buildForbiddenEmptyPageResult<WorkflowInstanceResponse>(pageNum, pageSize)
        }
        throw error
      }
    }
  })
}

/**
 * Get my applied workflow instances
 *
 * API: GET /api/v1/workflows/my-applied
 *
 * @param pageNum - Page number (default: 1)
 * @param pageSize - Page size (default: 10)
 * @returns Paginated applied instances for current user
 */
export async function getMyAppliedInstances(
  pageNum: number = 1,
  pageSize: number = 10
): Promise<ApiResponse<PageResult<WorkflowInstanceResponse>>> {
  return fetchWithCache({
    key: buildQueryKey('workflow', 'myApplied', withWorkflowContext({ pageNum, pageSize })),
    policy: {
      ...WORKFLOW_TODO_POLICY,
      ttlMs: 30 * 1000,
      tags: ['workflow.instances']
    },
    fetcher: async () => {
      try {
        return await apiClient.get('/workflows/my-applied', { pageNum, pageSize })
      } catch (error) {
        if (isForbiddenError(error)) {
          return buildForbiddenEmptyPageResult<WorkflowInstanceResponse>(pageNum, pageSize)
        }
        throw error
      }
    }
  })
}

/**
 * Get workflow statistics
 *
 * API: GET /api/v1/workflows/statistics
 *
 * @returns Workflow statistics data
 */
export async function getWorkflowStatistics(): Promise<ApiResponse<Record<string, unknown>>> {
  return fetchWithCache({
    key: buildQueryKey('workflow', 'statistics', withWorkflowContext()),
    policy: {
      ...WORKFLOW_TODO_POLICY,
      ttlMs: 30 * 1000,
      tags: ['workflow.statistics']
    },
    fetcher: async () => {
      try {
        return await apiClient.get('/workflows/statistics')
      } catch (error) {
        if (isForbiddenError(error)) {
          return {
            success: true,
            code: 200,
            message: '当前账号无权查看工作流统计，已按空数据处理',
            data: {},
            timestamp: new Date().toISOString()
          }
        }
        throw error
      }
    }
  })
}
