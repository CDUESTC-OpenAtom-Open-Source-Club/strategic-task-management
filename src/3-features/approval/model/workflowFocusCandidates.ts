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
 *   · 2026-10-30 用户定案修订：退回待重报的异动活链（WITHDRAWN 且未终结）
 *     同样进选择栏——流程没结束前不得在审批中心消失
 *   · 2026-10-30 用户定案修订（二）：选择栏去掉「实例N」编号前缀，
 *     每条标签自解释为「{审批类型} · source -> target」方向标题；
 *     计划候选由调用方（useApprovalProgressState）拼好方向标题经 planLabel 传入，
 *     上下文取不到时回退计划名
 *   · 只有一条候选 → 整栏隐藏；多条 → 全部平铺展示
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
  /**
   * 计划候选标题。2026-10-30 起 calling 方（useApprovalProgressState）优先传
   * 方向标题「{审批类型} · source -> target」，取不到上下文时回退计划名
   */
  planLabel: string
  /** 部门名称（计划名称缺失时兜底） */
  departmentName?: string
  /** 进行中的上报审批实例 */
  reports?: Array<{ instanceId?: number | string; label: string; step?: string }>
  /** 进行中的异动审批实例 */
  mutations?: Array<{ instanceId?: number | string; label: string; step?: string }>
  /**
   * 2026-10-30 用户定案：退回待重报的异动活链（未终结）——
   * 同样进选择栏，key 用 returned: 前缀与在审实例区分，避免撞 key
   */
  returnedMutations?: Array<{ instanceId?: number | string; label: string; step?: string }>
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

  // 2026-10-30 用户定案：退回待重报活链（未终结）与在审实例同 kind（mutation），
  // key 前缀 returned: 避免与在审实例撞 key
  for (const mutation of input.returnedMutations ?? []) {
    if (!mutation.instanceId) {
      continue
    }
    items.push({
      key: `returned:${mutation.instanceId}`,
      instanceId: mutation.instanceId,
      label: mutation.label || '异动审批（退回待重报）',
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
