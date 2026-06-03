/**
 * Workflow Feature - Mutation API
 *
 * Write operations for workflow data using new API (/api/v1/workflows)
 */

import { apiClient } from '@/shared/api/client'
import { invalidateQueries } from '@/shared/lib/utils/cache'
import { requestMessageCenterRefresh } from '@/shared/lib/messageCenterRefresh'
import type { ApiResponse } from '@/shared/types'
import type {
  StartWorkflowRequest,
  ApprovalRequest,
  RejectionRequest,
  ReassignRequest,
  WorkflowTaskDecisionRequest,
  WorkflowInstanceResponse
} from './types'

function invalidateWorkflowCaches(taskOrInstanceId?: string): void {
  const targets: string[] = [
    'workflow.todo',
    'workflow.detail',
    'workflow.instances',
    'workflow.statistics',
    'plan.list',
    'plan.detail',
    'indicator.list',
    'indicator.detail',
    'task.list',
    'task.detail',
    'dashboard.overview'
  ]

  if (taskOrInstanceId) {
    targets.push(`workflow.detail.${taskOrInstanceId}`)
  }

  invalidateQueries(targets)
  requestMessageCenterRefresh()
}

/**
 * Start a workflow by workflow code
 *
 * API: POST /api/v1/workflows/start
 *
 * @param request - Start workflow request
 * @returns Started workflow instance
 */
export async function startWorkflow(
  request: StartWorkflowRequest
): Promise<ApiResponse<WorkflowInstanceResponse>> {
  const response = await apiClient.post<ApiResponse<WorkflowInstanceResponse>>('/workflows/start', request)
  invalidateWorkflowCaches(response.data?.instanceId)
  return response
}

/**
 * Approve a workflow task
 *
 * API: POST /api/v1/workflows/tasks/{taskId}/approve
 *
 * @param taskId - Task/Instance ID
 * @param request - Approval request with optional comment
 * @returns Updated workflow instance
 */
export async function approveTask(
  taskId: string,
  request: ApprovalRequest
): Promise<ApiResponse<WorkflowInstanceResponse>> {
  const response = await apiClient.post<ApiResponse<WorkflowInstanceResponse>>(
    `/workflows/tasks/${taskId}/approve`,
    request
  )
  invalidateWorkflowCaches(taskId)
  invalidateWorkflowCaches(response.data?.instanceId)
  return response
}

/**
 * Decide a workflow task with a boolean result
 *
 * API: POST /api/v1/workflows/tasks/{taskId}/decision
 */
export async function decideTask(
  taskId: string,
  request: WorkflowTaskDecisionRequest
): Promise<ApiResponse<WorkflowInstanceResponse>> {
  const response = await apiClient.post<ApiResponse<WorkflowInstanceResponse>>(
    `/workflows/tasks/${taskId}/decision`,
    request
  )
  invalidateWorkflowCaches(taskId)
  invalidateWorkflowCaches(response.data?.instanceId)
  return response
}

/**
 * Reject a workflow task
 *
 * API: POST /api/v1/workflows/tasks/{taskId}/reject
 *
 * @param taskId - Task/Instance ID
 * @param request - Rejection request with reason
 * @returns Updated workflow instance
 */
export async function rejectTask(
  taskId: string,
  request: RejectionRequest
): Promise<ApiResponse<WorkflowInstanceResponse>> {
  const response = await apiClient.post<ApiResponse<WorkflowInstanceResponse>>(
    `/workflows/tasks/${taskId}/reject`,
    request
  )
  invalidateWorkflowCaches(taskId)
  invalidateWorkflowCaches(response.data?.instanceId)
  return response
}

/**
 * Reassign a workflow task to another user
 *
 * API: POST /api/v1/workflows/tasks/{taskId}/reassign
 *
 * @param taskId - Task/Instance ID
 * @param request - Reassign request with target user ID
 * @returns Updated workflow instance
 */
export async function reassignTask(
  taskId: string,
  request: ReassignRequest
): Promise<ApiResponse<WorkflowInstanceResponse>> {
  const response = await apiClient.post<ApiResponse<WorkflowInstanceResponse>>(
    `/workflows/tasks/${taskId}/reassign`,
    request
  )
  invalidateWorkflowCaches(taskId)
  invalidateWorkflowCaches(response.data?.instanceId)
  return response
}

/**
 * Cancel a workflow instance
 *
 * API: POST /api/v1/workflows/{instanceId}/cancel
 *
 * @param instanceId - Instance ID
 */
export async function cancelWorkflow(
  instanceId: string
): Promise<ApiResponse<void>> {
  const response = await apiClient.post<ApiResponse<void>>(`/workflows/${instanceId}/cancel`)
  invalidateWorkflowCaches(instanceId)
  return response
}
