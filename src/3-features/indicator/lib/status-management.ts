/**
 * Strategic Indicator Feature - Advanced Status Management
 *
 * Comprehensive status management system for indicators with dual status system:
 * - Lifecycle status: DRAFT -> PENDING_REVIEW -> DISTRIBUTED -> ARCHIVED
 * - Approval status: NONE -> DRAFT -> PENDING -> APPROVED -> REJECTED
 *
 * Provides safe accessors, validation, and UI display mapping.
 */

import type { Indicator } from '@/entities/indicator/model/types'
import {
  IndicatorStatus,
  ProgressApprovalStatus,
  WorkflowStatus
} from '@/entities/indicator/model/types'

/**
 * Safe status value extraction with fallback mechanism
 * Handles invalid status values gracefully to prevent UI crashes
 */
export function getSafeApprovalStatus(
  indicator: Indicator,
  fallback: string = ProgressApprovalStatus.NONE
): string {
  const status = indicator.progressApprovalStatus

  // Validate status is in allowed values
  const validStatuses = Object.values(ProgressApprovalStatus)
  if (typeof status === 'string' && validStatuses.includes(status as any)) {
    return status
  }

  // Log warning for invalid status
  console.warn('Invalid progress approval status:', status, 'for indicator:', indicator.id)

  return fallback
}

/**
 * Check if indicator is in specific approval status
 * Handles status validation and fallback logic
 */
export function isApprovalStatus(indicator: Indicator, targetStatus: string): boolean {
  const safeStatus = getSafeApprovalStatus(indicator)
  return safeStatus === targetStatus
}

/**
 * Get lifecycle status display text with fallback
 */
export function getLifecycleStatusText(status: string): string {
  const config: Record<string, string> = {
    [IndicatorStatus.DRAFT]: '草稿',
    [IndicatorStatus.PENDING_REVIEW]: '待审核',
    [IndicatorStatus.DISTRIBUTED]: '已下发',
    [IndicatorStatus.ARCHIVED]: '已归档',
    // Deprecated status mappings
    [IndicatorStatus.PENDING]: '待审核',
    [IndicatorStatus.ACTIVE]: '已下发'
  }

  return config[status] || '未知状态'
}

/**
 * Get lifecycle status tag type for Element Plus
 */
export function getLifecycleStatusType(status: string): 'success' | 'warning' | 'info' | 'danger' {
  const config: Record<string, 'success' | 'warning' | 'info' | 'danger'> = {
    [IndicatorStatus.DRAFT]: 'info',
    [IndicatorStatus.PENDING_REVIEW]: 'warning',
    [IndicatorStatus.DISTRIBUTED]: 'success',
    [IndicatorStatus.ARCHIVED]: 'info',
    [IndicatorStatus.PENDING]: 'warning',
    [IndicatorStatus.ACTIVE]: 'success'
  }

  return config[status] || 'info'
}

/**
 * Get approval status display text with fallback
 */
export function getApprovalStatusText(status: string): string {
  const config: Record<string, string> = {
    [ProgressApprovalStatus.NONE]: '无待审批',
    [ProgressApprovalStatus.DRAFT]: '草稿',
    [ProgressApprovalStatus.PENDING]: '审批中',
    [ProgressApprovalStatus.APPROVED]: '已通过',
    [ProgressApprovalStatus.REJECTED]: '已回退'
  }

  return config[status] || '未知状态'
}

/**
 * Get approval status tag type for Element Plus
 */
export function getApprovalStatusType(status: string): 'success' | 'warning' | 'info' | 'danger' {
  const config: Record<string, 'success' | 'warning' | 'info' | 'danger'> = {
    [ProgressApprovalStatus.NONE]: 'info',
    [ProgressApprovalStatus.DRAFT]: 'info',
    [ProgressApprovalStatus.PENDING]: 'warning',
    [ProgressApprovalStatus.APPROVED]: 'success',
    [ProgressApprovalStatus.REJECTED]: 'danger'
  }

  return config[status] || 'info'
}

/**
 * Get workflow status display text with fallback
 */
export function getWorkflowStatusText(status: string): string {
  const config: Record<string, string> = {
    [WorkflowStatus.DRAFT]: '草稿',
    [WorkflowStatus.PENDING_DISTRIBUTION]: '待确认接收',
    [WorkflowStatus.DISTRIBUTED]: '已下发',
    [WorkflowStatus.PENDING_APPROVAL]: '审批中',
    [WorkflowStatus.REJECTED]: '已回退',
    [WorkflowStatus.COMPLETED]: '已完成'
  }

  return config[status] || '未知状态'
}

/**
 * Get workflow status tag type for Element Plus
 */
export function getWorkflowStatusType(status: string): 'success' | 'warning' | 'info' | 'danger' {
  const config: Record<string, 'success' | 'warning' | 'info' | 'danger'> = {
    [WorkflowStatus.DRAFT]: 'info',
    [WorkflowStatus.PENDING_DISTRIBUTION]: 'warning',
    [WorkflowStatus.DISTRIBUTED]: 'success',
    [WorkflowStatus.PENDING_APPROVAL]: 'warning',
    [WorkflowStatus.REJECTED]: 'danger',
    [WorkflowStatus.COMPLETED]: 'success'
  }

  return config[status] || 'info'
}

/**
 * Check if indicator should show approval status badge
 * Only shows badge when there's an active approval process
 */
export function showApprovalBadge(indicator: Indicator): boolean {
  const safeStatus = getSafeApprovalStatus(indicator)
  return safeStatus !== ProgressApprovalStatus.NONE && safeStatus !== ProgressApprovalStatus.DRAFT
}

/**
 * Get composite status information for display
 * Combines lifecycle and approval status for comprehensive UI
 */
export function getCompositeStatusInfo(indicator: Indicator) {
  const lifecycleStatus = indicator.status
  const approvalStatus = getSafeApprovalStatus(indicator)

  return {
    lifecycle: {
      text: getLifecycleStatusText(lifecycleStatus),
      type: getLifecycleStatusType(lifecycleStatus)
    },
    approval: {
      text: getApprovalStatusText(approvalStatus),
      type: getApprovalStatusType(approvalStatus),
      show: showApprovalBadge(indicator)
    },
    workflow: {
      text: getWorkflowStatusText(indicator.workflowStatus),
      type: getWorkflowStatusType(indicator.workflowStatus)
    }
  }
}

/**
 * Check if indicator is in a terminal state (cannot transition further)
 */
export function isTerminalState(indicator: Indicator): boolean {
  return indicator.status === IndicatorStatus.ARCHIVED
}

/**
 * Check if indicator is in an active state (can accept progress updates)
 */
export function isActiveState(indicator: Indicator): boolean {
  return indicator.status === IndicatorStatus.DISTRIBUTED
}

/**
 * Check if indicator is in a editable state
 */
export function isEditableState(indicator: Indicator): boolean {
  return indicator.status === IndicatorStatus.DRAFT
}

/**
 * Check if indicator is awaiting review or approval
 */
export function isPendingState(indicator: Indicator): boolean {
  return (
    indicator.status === IndicatorStatus.PENDING_REVIEW ||
    isApprovalStatus(indicator, ProgressApprovalStatus.PENDING)
  )
}

/**
 * Get all valid status transitions from current state
 * Returns array of allowed next states
 */
export function getAllowedTransitions(indicator: Indicator): string[] {
  const currentStatus = indicator.status

  const transitions: Record<string, string[]> = {
    [IndicatorStatus.DRAFT]: [IndicatorStatus.PENDING_REVIEW],
    [IndicatorStatus.PENDING_REVIEW]: [IndicatorStatus.DISTRIBUTED, IndicatorStatus.DRAFT],
    [IndicatorStatus.DISTRIBUTED]: [IndicatorStatus.ARCHIVED],
    [IndicatorStatus.ARCHIVED]: []
  }

  return transitions[currentStatus] || []
}

/**
 * Validate status transition
 */
export function isValidTransition(indicator: Indicator, targetStatus: string): boolean {
  const allowed = getAllowedTransitions(indicator)
  return allowed.includes(targetStatus)
}
