/**
 * 审核进度评定门禁（2026-10-31 用户定案）。
 *
 * 三条件全满足才可评定：上报审批期间 + 有评定权限的角色 + 是当前审批节点的评定人。
 * 任一不满足 → 点击格子当场弹对应原因，绝不出现「打开下拉→填→保存失败」空转。
 *
 * 本模块是三视图（战略任务管理页 / 指标填报页 / 指标分发页）共用的纯函数与常量：
 * - 等级选项只有 超前完成/正常/延期 三档；「未评定」退为初始空白显示态，不是选项；
 * - 锁定原因与后端 lockHint 文案一一对应，前端仅做兜底与分类。
 */

/** 后端 lockHint 的三分原因（与 IndicatorAppraisalApplicationService.resolvePermission 对应） */
export type IndicatorAppraisalGateReason =
  'NOT_IN_REPORTING_PERIOD' | 'NO_APPROVAL_SEAT_ROLE' | 'NOT_CURRENT_STEP_APPROVER'

/** 可选等级——评定选择器专用；「未评定」是初始空白显示态，不在其中 */
export const APPRAISAL_LEVEL_OPTIONS: Array<{
  label: string
  value: 'AHEAD' | 'NORMAL' | 'DELAYED'
  type: 'success' | 'warning'
}> = [
  { label: '超前完成', value: 'AHEAD', type: 'success' },
  { label: '正常', value: 'NORMAL', type: 'success' },
  { label: '延期', value: 'DELAYED', type: 'warning' }
]

/** 各原因的前端兜底文案（后端 lockHint 缺失/为空时使用） */
export const APPRAISAL_GATE_FALLBACK_MESSAGES: Record<IndicatorAppraisalGateReason, string> = {
  NOT_IN_REPORTING_PERIOD: '非上报审批期间，无法评定审核进度',
  NO_APPROVAL_SEAT_ROLE: '当前角色无评定权限，无法评定审核进度',
  NOT_CURRENT_STEP_APPROVER: '您不是当前审批环节的评定人，无法评定'
}

/** 结构兼容 IndicatorAppraisalContextVO，避免 lib 层反向依赖 API 层 */
export interface AppraisalGateContextLike {
  canAppraise?: boolean
  currentStepName?: string | null
  lockHint?: string | null
}

/** 只读展示用的显示态（含「未评定」空值兜底；不进选择器选项） */
export interface AppraisalLevelDisplay {
  label: string
  type: 'success' | 'info' | 'warning'
}

const APPRAISAL_EMPTY_DISPLAY: AppraisalLevelDisplay = { label: '未评定', type: 'info' }

/**
 * 按后端 lockHint 文案对不可评定原因分类（文案由本仓库后端固定，子串判定是确定性的）：
 * - 含「评定人」→ 原因③（非当前环节，后端文案：您不是当前审批环节（X）的评定人，无法评定）；
 * - 含「无评定权限」→ 原因②（当前角色无评定权限，无法评定审核进度）；
 * - 其余（含 context 缺失）→ 原因①（非上报期间/流程异常）。
 */
export function resolveAppraisalGateReason(
  context: AppraisalGateContextLike | null | undefined
): IndicatorAppraisalGateReason | null {
  if (context?.canAppraise === true) {
    return null
  }
  const lockHint = String(context?.lockHint ?? '').trim()
  if (lockHint.includes('评定人')) {
    return 'NOT_CURRENT_STEP_APPROVER'
  }
  if (lockHint.includes('无评定权限')) {
    return 'NO_APPROVAL_SEAT_ROLE'
  }
  return 'NOT_IN_REPORTING_PERIOD'
}

/**
 * 点击格子被拦时的提示语：优先用后端 lockHint（细分：未启动/已结束/已重置/节点名等），
 * 为空才退到统一兜底句。
 */
export function getAppraisalGateMessage(
  context: AppraisalGateContextLike | null | undefined
): string {
  const lockHint = String(context?.lockHint ?? '').trim()
  if (lockHint) {
    return lockHint
  }
  const reason = resolveAppraisalGateReason(context) ?? 'NOT_IN_REPORTING_PERIOD'
  return APPRAISAL_GATE_FALLBACK_MESSAGES[reason]
}

/**
 * 等级显示态查表（三视图只读展示共用）：
 * AHEAD/NORMAL/DELAYED → 三档文案与配色；空值/未知码 → 「未评定」info
 * （与历史 manualAlertOptions 空值兜底行为一致；WARNING/INFO 等旧预警码
 *  已在 monitoringApi.getManualAlertLevels 归并为三档，不会到达这里）。
 */
export function getAppraisalLevelDisplay(level?: string | null): AppraisalLevelDisplay {
  const normalized = String(level ?? '')
    .trim()
    .toUpperCase()
  const option = APPRAISAL_LEVEL_OPTIONS.find(item => item.value === normalized)
  if (!option) {
    return { ...APPRAISAL_EMPTY_DISPLAY }
  }
  return { label: option.label, type: option.type }
}
