/**
 * 2026-10-27 用户定案：「审批流程」页签顶部的实例选择栏只承载
 * 「当前正在审批的实例」。
 *
 * 背景：此前候选里混入了历史终态实例（已通过/已驳回/已撤回），
 * 导致选择栏出现「实例1 上报审批…已通过 / 实例2 下发审批…已通过」这类
 * 已完成流程——它们属于「审批历史」页签，不该出现在进行中视图里。
 *
 * 规则：
 *   · 计划自身：仅在审批中（PENDING/IN_REVIEW/SUBMITTED）才作为一条候选
 *   · 进行中的上报审批、进行中的异动审批：各占一条候选
 *   · 历史终态实例：一律不进选择栏
 *   · 只有一条候选 → 整栏隐藏；多条 → 统一编号 实例1、实例2、实例3…
 */

export type WorkflowFocusCandidateKind = 'plan' | 'report' | 'mutation' | 'history'

export interface WorkflowFocusCandidate {
  key: string
  instanceId?: number | string
  label: string
  step?: string
  kind: WorkflowFocusCandidateKind
}

/** 处于「正在审批」状态的实例状态集合 */
export const IN_FLIGHT_WORKFLOW_STATUSES = ['PENDING', 'IN_REVIEW', 'SUBMITTED'] as const

export function isInFlightWorkflowStatus(status: unknown): boolean {
  const normalized = String(status ?? '')
    .trim()
    .toUpperCase()
  return (IN_FLIGHT_WORKFLOW_STATUSES as readonly string[]).includes(normalized)
}

export interface BuildWorkflowFocusCandidatesInput {
  /** 计划自身是否仍在审批中 */
  isPlanPending: boolean
  /** 计划名称（候选标题用） */
  planLabel: string
  /** 部门名称（计划名称缺失时兜底） */
  departmentName?: string
  /** 进行中的上报审批实例 */
  reports?: Array<{ instanceId?: number | string; label: string; step?: string }>
  /** 进行中的异动审批实例 */
  mutations?: Array<{ instanceId?: number | string; label: string; step?: string }>
}

/**
 * 构建选择栏候选列表。历史终态实例不参与。
 */
export function buildWorkflowFocusCandidates(
  input: BuildWorkflowFocusCandidatesInput
): WorkflowFocusCandidate[] {
  const items: WorkflowFocusCandidate[] = []

  if (input.isPlanPending) {
    items.push({
      key: 'plan:current',
      label: input.planLabel || input.departmentName || '计划审批',
      kind: 'plan'
    })
  }

  for (const report of input.reports ?? []) {
    if (!report.instanceId) {
      continue
    }
    items.push({
      key: `report:${report.instanceId}`,
      instanceId: report.instanceId,
      label: report.label || '上报审批',
      step: report.step,
      kind: 'report'
    })
  }

  for (const mutation of input.mutations ?? []) {
    if (!mutation.instanceId) {
      continue
    }
    items.push({
      key: `mutation:${mutation.instanceId}`,
      instanceId: mutation.instanceId,
      label: mutation.label || '异动审批',
      step: mutation.step,
      kind: 'mutation'
    })
  }

  return items
}

/**
 * 选择栏是否需要展示：只有一条候选时整栏隐藏（直接渲染那条流程）。
 */
export function shouldShowWorkflowInstanceSelector(candidates: unknown[]): boolean {
  return candidates.length > 1
}

/**
 * 选择栏上的序号文案：统一编号 实例1、实例2、实例3…
 */
export function resolveWorkflowInstanceIndexLabel(index: number): string {
  return `实例${index + 1}`
}
