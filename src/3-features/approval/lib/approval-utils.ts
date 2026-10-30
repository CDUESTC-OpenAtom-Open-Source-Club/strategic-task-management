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

// 2026-09-27 用户拍板：审批卡片标题必须按真实流程类型区分——
// 战略部/职能部门发起的下发是「下发审批」，只有上报链路才叫「上报审批」，
// 指标异动是「异动审批」。flowCode 缺失时保守回退「上报审批」维持旧行为。
export function resolvePlanApprovalTypeLabel(flowCode?: string): string {
  const code = normalizeWorkflowCode(flowCode)
  if (isDistributionFlow(code)) {
    return '下发审批'
  }
  if (isMutationFlow(code)) {
    return '异动审批'
  }
  return '上报审批'
}

// 审核进度只属于上报链路（V88 口径）：下发/异动流程不显示审核进度选择器。
// flowCode 未知时保持显示，避免老数据丢功能。
export function showAppraisalLevelForFlow(flowCode?: string): boolean {
  const code = normalizeWorkflowCode(flowCode)
  return !code || isSubmissionFlow(code)
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
    return { label: '已回退', type: 'danger' }
  }
  if (normalized === 'WITHDRAWN') {
    return { label: '已回退', type: 'info' }
  }
  // 2026-10-30 用户定案（异动驳回后重报/取消闭环）：填报人「取消异动」主动终结
  // 的链与已通过同归审批历史，状态标签单列「已取消」
  if (normalized === 'CANCELLED') {
    return { label: '已取消', type: 'info' }
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
  // 2026-10-30（异动驳回后重报/取消闭环）：CANCELLED（取消异动）与 APPROVED/REJECTED
  // 同为链条终态，历史页签按终态准入
  return ['APPROVED', 'REJECTED', 'CANCELLED'].includes(normalized)
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
