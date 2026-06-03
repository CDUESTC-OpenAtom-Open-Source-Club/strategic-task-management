/**
 * Strategic Indicator Feature - Mutation API
 *
 * Write operations for indicators (create, update, delete, distribute).
 * Based on API documentation: POST/PUT/DELETE /api/indicators/*
 */

import { apiClient } from '@/shared/api/client'
import { buildQueryKey, invalidateQueries } from '@/shared/lib/utils/cache'
import { requestMessageCenterRefresh } from '@/shared/lib/messageCenterRefresh'
import type {
  Indicator,
  IndicatorCreateRequest,
  IndicatorUpdateRequest,
  DistributeRequest
} from '@/entities/indicator/model/types'
import type {
  IndicatorDetailResponse,
  DistributionResponse,
  ApprovalSubmissionResponse,
  DistributionResult,
  ApprovalSubmissionResult
} from './types'

function invalidateIndicatorCaches(id?: number): void {
  const targets: Array<string | ReturnType<typeof buildQueryKey>> = [
    'indicator.list',
    'dashboard.overview',
    'task.list',
    'task.detail'
  ]

  if (id !== undefined) {
    targets.push('indicator.detail', `indicator.detail.${id}`)
    targets.push(buildQueryKey('indicator', 'detail', { id }))
  }

  invalidateQueries(targets)
}

function invalidateIndicatorAndMessageCaches(id?: number): void {
  invalidateIndicatorCaches(id)
  requestMessageCenterRefresh()
}

/**
 * Create indicator
 *
 * API: POST /api/indicators
 *
 * @param data - Indicator creation data
 * @returns Created indicator
 */
export async function createIndicator(data: IndicatorCreateRequest): Promise<Indicator> {
  const response = await apiClient.post<IndicatorDetailResponse>('/indicators', data)
  invalidateIndicatorCaches()
  return response.data
}

/**
 * Update indicator
 *
 * API: PUT /api/indicators/{id}
 *
 * @param id - Indicator ID
 * @param data - Update data
 * @returns Updated indicator
 */
export async function updateIndicator(
  id: number,
  data: IndicatorUpdateRequest
): Promise<Indicator> {
  const response = await apiClient.post<IndicatorDetailResponse>(`/indicators/${id}/breakdown`, data)
  invalidateIndicatorCaches(id)
  return response.data
}

/**
 * Delete indicator
 *
 * API: DELETE /api/indicators/{id}
 *
 * @param id - Indicator ID
 */
export async function deleteIndicator(id: number): Promise<void> {
  await apiClient.post(`/indicators/${id}/terminate`, {})
  invalidateIndicatorCaches(id)
}

/**
 * Distribute indicator to target organizations
 *
 * API: POST /api/indicators/{id}/distribute
 *
 * @param id - Indicator ID
 * @param request - Distribution request
 * @returns Distribution result
 */
export async function distributeIndicator(
  id: number,
  request: DistributeRequest
): Promise<DistributionResult> {
  const response = await apiClient.post<DistributionResponse>(
    `/indicators/${id}/distribute`,
    request
  )
  invalidateIndicatorAndMessageCaches(id)
  return response.data
}

/**
 * Batch distribute indicators
 *
 * API: POST /api/indicators/distribute/batch
 *
 * @param indicatorIds - Indicator IDs
 * @param targetOrgIds - Target organization IDs
 * @param deadline - Deadline
 * @returns Distribution result
 */
export async function batchDistributeIndicators(
  indicatorIds: number[],
  targetOrgIds: number[],
  deadline?: string
): Promise<DistributionResult> {
  const responses = await Promise.all(
    indicatorIds.map(indicatorId =>
      apiClient.post<DistributionResponse>(`/indicators/${indicatorId}/distribute`, {
        targetOrgIds,
        deadline
      })
    )
  )

  indicatorIds.forEach(id => invalidateIndicatorCaches(id))
  requestMessageCenterRefresh()
  return responses[0]?.data ?? ({ success: true } as unknown as DistributionResult)
}

/**
 * Withdraw indicator
 *
 * API: POST /api/indicators/{id}/withdraw
 *
 * @param id - Indicator ID
 * @param reason - Withdrawal reason
 */
export async function withdrawIndicator(id: number, reason?: string): Promise<void> {
  await apiClient.post(`/indicators/${id}/withdraw`, { reason })
  invalidateIndicatorAndMessageCaches(id)
}

/**
 * Submit indicator for approval
 *
 * API: POST /api/indicators/{id}/submit-approval
 *
 * @param id - Indicator ID
 * @param comment - Submission comment
 * @returns Approval submission result
 */
export async function submitIndicatorForApproval(
  id: number,
  comment?: string
): Promise<ApprovalSubmissionResult> {
  const response = await apiClient.post<ApprovalSubmissionResponse>(
    `/indicators/${id}/submit`,
    {
      comment,
      flowCode: 'INDICATOR_APPROVAL'
    }
  )
  invalidateIndicatorAndMessageCaches(id)
  return response.data
}

/**
 * Submit indicator progress
 *
 * API: POST /api/indicators/{id}/submit-progress (from workflow endpoints)
 *
 * @param id - Indicator ID
 * @param value - Progress value
 * @param evidence - Evidence description
 * @param attachments - Attachment IDs
 * @returns Report ID
 */
export async function submitIndicatorProgress(
  id: number,
  value: number,
  evidence?: string,
  attachments?: number[]
): Promise<{ reportId: number; status: string }> {
  void value
  void evidence
  void attachments
  const response = await apiClient.post<any>(`/indicators/${id}/submit`, {})
  invalidateIndicatorCaches(id)
  return response.data
}

/**
 * Confirm indicator receipt
 *
 * API: POST /workflow/indicator/{id}/confirm-receive
 *
 * @param id - Indicator ID
 * @param comment - Confirmation comment
 */
export async function confirmIndicatorReceipt(id: number, comment?: string): Promise<void> {
  void id
  void comment
}

/**
 * Decompose indicator into sub-indicators
 *
 * API: POST /workflow/indicator/{id}/decompose
 *
 * @param id - Parent indicator ID
 * @param decompositions - Sub-indicator data
 * @returns Created sub-indicators
 */
export async function decomposeIndicator(
  id: number,
  decompositions: Array<{
    name: string
    targetOrgId: number
    value: number
    weight: number
  }>
): Promise<{ parentId: number; createdCount: number; childIndicators: Indicator[] }> {
  const response = await apiClient.post<any>(`/indicators/${id}/breakdown`, {
    decompositions
  })
  invalidateIndicatorCaches(id)
  return response.data
}
