export type PlanStatusLike = string | null | undefined

export function canEditManualAlertLevel(
  planStatus: PlanStatusLike,
  options: { readOnly?: boolean; workflowInFlight?: boolean } = {}
): boolean {
  if (options.readOnly) {
    return false
  }
  if (
    String(planStatus ?? '')
      .trim()
      .toUpperCase() !== 'DISTRIBUTED'
  ) {
    return false
  }
  // 2026-10-18 用户定案：审核进度是上报审批过程中的状态——
  // 仅「计划已下发 + 上报流程进行中」可调整；平时（流程未发起/已结束/已退回）锁死。
  if (options.workflowInFlight !== true) {
    return false
  }
  return true
}

export const MANUAL_ALERT_LOCKED_HINT = '计划正式下发后才能调整进度等级'
export const MANUAL_ALERT_WORKFLOW_LOCKED_HINT = '上报流程进行中才能调整进度等级，平时为锁定状态'
export const MANUAL_ALERT_READONLY_HINT = '历史年份只读，不能调整进度等级'
