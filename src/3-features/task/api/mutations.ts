/**
 * Task Feature - Mutation API
 *
 * Write operations for task data.
 */

import { apiClient as api } from '@/shared/api/client'
import {
  startWorkflow,
  approveTask as workflowApproveTask,
  rejectTask as workflowRejectTask
} from '@/features/workflow/api'
import { buildQueryKey, invalidateQueries } from '@/shared/lib/utils/cache'
import { requestMessageCenterRefresh } from '@/shared/lib/messageCenterRefresh'
import type { ApiResponse, StrategicTask } from '@/shared/types'
import type { TaskCreateRequest, TaskUpdateRequest } from '@/shared/types'

function invalidateTaskCaches(taskId?: number): void {
  const targets: Array<string | ReturnType<typeof buildQueryKey>> = [
    'task.list',
    'plan.detail',
    'dashboard.overview'
  ]

  if (taskId !== undefined) {
    targets.push('task.detail', `task.detail.${taskId}`)
    targets.push(buildQueryKey('task', 'detail', { taskId }))
    targets.push(buildQueryKey('task', 'indicators', { taskId }))
    targets.push(buildQueryKey('task', 'milestones', { taskId }))
  }

  invalidateQueries(targets)
}

/**
 * Create new task
 *
 * API: POST /api/v1/tasks
 *
 * @param request - Task creation request
 * @returns Created task
 */
export async function createTask(request: TaskCreateRequest): Promise<ApiResponse<StrategicTask>> {
  const response = await api.post<ApiResponse<StrategicTask>>('/tasks', request)
  invalidateTaskCaches(response.data?.taskId)
  return response
}

/**
 * Update task
 *
 * API: PUT /api/v1/tasks/{id}
 *
 * @param taskId - Task ID
 * @param request - Update request
 * @returns Updated task
 */
export async function updateTask(
  taskId: number,
  request: TaskUpdateRequest
): Promise<ApiResponse<StrategicTask>> {
  const response = await api.put<ApiResponse<StrategicTask>>(`/tasks/${taskId}`, request)
  invalidateTaskCaches(taskId)
  return response
}

/**
 * Delete task
 *
 * API: DELETE /api/v1/tasks/{id}
 *
 * @param taskId - Task ID
 */
export async function deleteTask(taskId: number): Promise<ApiResponse<void>> {
  const response = await api.delete<ApiResponse<void>>(`/tasks/${taskId}`)
  invalidateTaskCaches(taskId)
  return response
}

/**
 * Submit task for approval
 *
 * API: POST /api/v1/workflows/start
 *
 * @param taskId - Task ID
 * @param requesterId - Requester user ID (unused, taken from JWT)
 * @param requesterOrgId - Requester org ID (unused, taken from JWT)
 * @param comment - Submission comment (optional)
 */
export async function submitTaskForApproval(
  taskId: number,
  _requesterId: number,
  _requesterOrgId: number,
  _comment?: string
): Promise<ApiResponse<void>> {
  await startWorkflow({
    workflowCode: 'TASK_APPROVAL',
    businessEntityId: taskId,
    businessEntityType: 'TASK'
  })
  invalidateTaskCaches(taskId)
  requestMessageCenterRefresh()
  return { success: true, data: undefined }
}

/**
 * Approve task (approval instance)
 *
 * API: POST /api/v1/workflows/tasks/{taskId}/approve
 *
 * @param instanceId - Approval instance ID
 * @param userId - Approver user ID (unused, taken from JWT)
 * @param comment - Approval comment
 */
export async function approveTask(
  instanceId: number,
  _userId: number,
  comment?: string
): Promise<ApiResponse<void>> {
  await workflowApproveTask(String(instanceId), { comment })
  invalidateTaskCaches()
  requestMessageCenterRefresh()
  return { success: true, data: undefined }
}

/**
 * Reject task (approval instance)
 *
 * API: POST /api/v1/workflows/tasks/{taskId}/reject
 *
 * @param instanceId - Approval instance ID
 * @param userId - Approver user ID (unused, taken from JWT)
 * @param reason - Rejection reason (required)
 */
export async function rejectTask(
  instanceId: number,
  _userId: number,
  reason: string
): Promise<ApiResponse<void>> {
  await workflowRejectTask(String(instanceId), { reason })
  invalidateTaskCaches()
  requestMessageCenterRefresh()
  return { success: true, data: undefined }
}

/**
 * Activate task
 *
 * API: POST /api/v1/tasks/{id}/activate
 *
 * @param taskId - Task ID
 */
export async function activateTask(taskId: number): Promise<ApiResponse<void>> {
  const response = await api.post<ApiResponse<void>>(`/tasks/${taskId}/activate`)
  invalidateTaskCaches(taskId)
  return response
}

/**
 * Deactivate task
 *
 * API: POST /api/v1/tasks/{id}/cancel
 *
 * @param taskId - Task ID
 */
export async function deactivateTask(taskId: number): Promise<ApiResponse<void>> {
  const response = await api.post<ApiResponse<void>>(`/tasks/${taskId}/cancel`)
  invalidateTaskCaches(taskId)
  return response
}
