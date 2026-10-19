import type { IndicatorFill } from '@/shared/types'

export interface IndicatorWorkflowSnapshot {
  fillId: string | number
  reportId?: string | number
  workflowInstanceId?: string | number
  currentTaskId?: string | number
  workflowStatus?: string
  currentStepName?: string
  currentApproverId?: number
  currentApproverName?: string
  status?: string
  progress: number
  content?: string
  auditComment?: string
  createdAt?: string
  updatedAt?: string
}

function toTimestamp(value?: string): number {
  if (!value) {
    return 0
  }
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function hasWorkflowSignal(fill: IndicatorFill): boolean {
  return Boolean(
    fill.report_id ||
    fill.workflowInstanceId ||
    fill.currentTaskId ||
    fill.workflowStatus ||
    fill.currentStepName ||
    fill.currentApproverId ||
    fill.currentApproverName
  )
}

export function resolveLatestIndicatorWorkflowSnapshot(
  fills: IndicatorFill[]
): IndicatorWorkflowSnapshot | null {
  if (!Array.isArray(fills) || fills.length === 0) {
    return null
  }

  const sortedFills = [...fills].sort(
    (left, right) =>
      toTimestamp(right.updated_at || right.created_at) -
      toTimestamp(left.updated_at || left.created_at)
  )

  const latestFill = sortedFills.find(hasWorkflowSignal) || sortedFills[0]

  if (!latestFill) {
    return null
  }

  return {
    fillId: latestFill.id,
    reportId: latestFill.report_id,
    workflowInstanceId: latestFill.workflowInstanceId,
    currentTaskId: latestFill.currentTaskId,
    workflowStatus: latestFill.workflowStatus,
    currentStepName: latestFill.currentStepName,
    currentApproverId: latestFill.currentApproverId,
    currentApproverName: latestFill.currentApproverName,
    status: latestFill.status,
    progress: latestFill.progress,
    content: latestFill.content,
    auditComment: latestFill.audit_comment,
    createdAt: latestFill.created_at,
    updatedAt: latestFill.updated_at
  }
}

export function normalizeIndicatorWorkflowStatus(status?: string): string {
  return String(status || '')
    .trim()
    .toUpperCase()
}

export function getIndicatorWorkflowStatusLabel(
  snapshot?: IndicatorWorkflowSnapshot | null
): string {
  const workflowStatus = normalizeIndicatorWorkflowStatus(snapshot?.workflowStatus)
  if (
    workflowStatus === 'PENDING' ||
    workflowStatus === 'IN_REVIEW' ||
    workflowStatus === 'SUBMITTED'
  ) {
    return '待审批'
  }
  if (workflowStatus === 'WITHDRAWN') {
    return '已回退'
  }
  if (workflowStatus === 'APPROVED' || workflowStatus === 'COMPLETED') {
    return '已通过'
  }
  if (workflowStatus === 'REJECTED' || workflowStatus === 'RETURNED') {
    return '已回退'
  }

  const fillStatus = String(snapshot?.status || '')
    .trim()
    .toLowerCase()
  if (fillStatus === 'submitted') {
    return '待审批'
  }
  if (fillStatus === 'approved') {
    return '已通过'
  }
  if (fillStatus === 'rejected') {
    return '已回退'
  }
  return '草稿'
}

export function getIndicatorWorkflowTagType(
  snapshot?: IndicatorWorkflowSnapshot | null
): 'warning' | 'success' | 'danger' | 'info' {
  const label = getIndicatorWorkflowStatusLabel(snapshot)
  if (label === '待审批') {
    return 'warning'
  }
  if (label === '已通过') {
    return 'success'
  }
  if (label === '已回退') {
    return 'danger'
  }
  return 'info'
}

export function canCurrentUserHandleIndicatorWorkflow(
  snapshot: IndicatorWorkflowSnapshot | null | undefined,
  userId: number,
  permissionCodes: string[]
): boolean {
  void permissionCodes
  if (!snapshot?.currentTaskId || !snapshot.currentApproverId || userId <= 0) {
    return false
  }

  return snapshot.currentApproverId === userId
}
