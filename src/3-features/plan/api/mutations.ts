/**
 * Plan Feature - Mutation API
 *
 * Write operations for plan data.
 */

import { apiClient as api } from '@/shared/api/client'
import { approveTask, rejectTask } from '@/features/workflow/api'
import { buildQueryKey, invalidateQueries } from '@/shared/lib/utils/cache'
import { requestMessageCenterRefresh } from '@/shared/lib/messageCenterRefresh'
import type { ApiResponse, Plan } from '@/shared/types'

function invalidatePlanCaches(planId?: number | string): void {
  const normalizedId = planId !== undefined ? String(planId) : undefined
  const targets: Array<string | ReturnType<typeof buildQueryKey>> = [
    'plan.list',
    'task.list',
    'dashboard.overview'
  ]

  if (normalizedId !== undefined) {
    targets.push('plan.detail', `plan.detail.${normalizedId}`)
    targets.push(buildQueryKey('plan', 'detail', { planId: normalizedId }))
  }

  invalidateQueries(targets)
}

/**
 * Create new plan
 *
 * API: POST /api/plans
 *
 * @param data - Plan creation data
 * @returns Created plan
 */
export async function createPlan(data: Partial<Plan>): Promise<ApiResponse<Plan>> {
  const response = await api.post<ApiResponse<Plan>>('/plans', data)
  invalidatePlanCaches(response.data?.id ?? data.id)
  return response
}

/**
 * Update plan
 *
 * API: PUT /api/plans/{id}
 *
 * @param planId - Plan ID
 * @param data - Update data
 * @returns Updated plan
 */
export async function updatePlan(
  planId: number | string,
  data: Partial<Plan>
): Promise<ApiResponse<Plan>> {
  const response = await api.put<ApiResponse<Plan>>(`/plans/${planId}`, data)
  invalidatePlanCaches(planId)
  return response
}

/**
 * Delete plan
 *
 * API: DELETE /api/plans/{id}
 *
 * @param planId - Plan ID
 */
export async function deletePlan(planId: number | string): Promise<ApiResponse<void>> {
  const response = await api.delete<ApiResponse<void>>(`/plans/${planId}`)
  invalidatePlanCaches(planId)
  return response
}

/**
 * Submit plan for approval
 *
 * API: POST /api/plans/{id}/submit-approval
 *
 * @param planId - Plan ID
 * @param comment - Submission comment
 */
export async function submitPlanForApproval(
  planId: number | string,
  comment?: string
): Promise<ApiResponse<void>> {
  void comment
  const response = await api.post<ApiResponse<void>>(`/plans/${planId}/publish`)
  invalidatePlanCaches(planId)
  requestMessageCenterRefresh()
  return response
}

/**
 * Approve plan
 *
 * API: POST /api/v1/workflows/tasks/{taskId}/approve
 *
 * @param instanceId - Approval instance ID
 * @param userId - Approver user ID (unused, taken from JWT)
 * @param comment - Approval comment
 */
export async function approvePlan(
  instanceId: number | string,
  _userId: number | string,
  comment?: string
): Promise<ApiResponse<void>> {
  await approveTask(String(instanceId), { comment })
  invalidatePlanCaches()
  requestMessageCenterRefresh()
  return { success: true, data: undefined }
}

/**
 * Reject plan
 *
 * API: POST /api/v1/workflows/tasks/{taskId}/reject
 *
 * @param instanceId - Approval instance ID
 * @param userId - Approver user ID (unused, taken from JWT)
 * @param comment - Rejection reason (required)
 */
export async function rejectPlan(
  instanceId: number | string,
  _userId: number | string,
  comment: string
): Promise<ApiResponse<void>> {
  await rejectTask(String(instanceId), { reason: comment })
  invalidatePlanCaches()
  requestMessageCenterRefresh()
  return { success: true, data: undefined }
}

/**
 * Archive plan
 *
 * API: POST /api/plans/{id}/archive
 *
 * @param planId - Plan ID
 */
export async function archivePlan(planId: number | string): Promise<ApiResponse<void>> {
  const response = await api.post<ApiResponse<void>>(`/plans/${planId}/archive`)
  invalidatePlanCaches(planId)
  return response
}
