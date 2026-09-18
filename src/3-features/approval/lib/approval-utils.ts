import type { ApprovalHistoryItem } from '@/shared/types'
import type { WorkflowHistoryCardResponse } from '@/features/workflow/api/types'

export type ApprovalStatusTag = {
  label: string
  type: 'success' | 'warning' | 'danger' | 'info'
}

export function normalizeDisplayName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeWorkflowCode(value: unknown): string {
  return String(value || '')
    .trim()
    .toUpperCase()
}

export function parsePositiveUserId(value: unknown): number | null {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null
  }
  return numericValue
}

export function toPositiveNumber(value: unknown): number | null {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null
}

export function isSubmissionFlow(flowCode?: string): boolean {
  return String(flowCode || '')
    .toUpperCase()
    .startsWith('PLAN_APPROVAL_')
}

export function isDistributionFlow(flowCode?: string): boolean {
  return String(flowCode || '')
    .toUpperCase()
    .startsWith('PLAN_DISPATCH_')
}

export function isMutationFlow(flowCode?: string): boolean {
  return (
    String(flowCode || '')
      .trim()
      .toUpperCase() === 'PLAN_MUTATION_STRATEGY'
  )
}

export function resolveApprovalRouteTitle(
  card: Pick<WorkflowHistoryCardResponse, 'flowCode' | 'sourceOrgName' | 'targetOrgName'>
): string {
  const sourceOrgName = normalizeDisplayName(card.sourceOrgName) || '战略发展部'
  const targetOrgName = normalizeDisplayName(card.targetOrgName) || '目标部门'

  if (isSubmissionFlow(card.flowCode)) {
    return `上报审批 · ${targetOrgName} -> ${sourceOrgName}`
  }

  if (isDistributionFlow(card.flowCode)) {
    return `下发审批 · ${sourceOrgName} -> ${targetOrgName}`
  }

  if (isMutationFlow(card.flowCode)) {
    return `异动审批 · ${sourceOrgName} -> ${targetOrgName}`
  }

  return normalizeDisplayName(card.flowCode) || '审批流程'
}

export function resolveHistoryStatusTag(status?: string): ApprovalStatusTag {
  const normalized = String(status || '').toUpperCase()
  if (normalized === 'APPROVED') {
    return { label: '已通过', type: 'success' }
  }
  if (normalized === 'REJECTED') {
    return { label: '已驳回', type: 'danger' }
  }
  if (normalized === 'WITHDRAWN') {
    return { label: '已撤回', type: 'info' }
  }
  if (normalized === 'IN_REVIEW' || normalized === 'PENDING' || normalized === 'SUBMITTED') {
    return { label: '审批中', type: 'warning' }
  }
  return { label: normalized || '未知', type: 'info' }
}

export function isTerminalHistoryStatus(status?: string): boolean {
  const normalized = String(status || '')
    .trim()
    .toUpperCase()
  return ['APPROVED', 'REJECTED'].includes(normalized)
}

export function normalizeWorkflowAction(action?: string): ApprovalHistoryItem['action'] {
  const normalized = String(action || '')
    .trim()
    .toUpperCase()
  if (normalized.includes('REJECT')) {
    return 'reject'
  }
  if (normalized.includes('WITHDRAW') || normalized.includes('CANCEL')) {
    return 'withdraw'
  }
  if (normalized.includes('START') || normalized.includes('SUBMIT')) {
    return 'submit'
  }
  return 'approve'
}

export function shouldDisplayWorkflowHistoryItem(
  item: { action?: string } | null | undefined
): boolean {
  const normalized = String(item?.action || '')
    .trim()
    .toUpperCase()
  return !normalized.includes('START')
}
