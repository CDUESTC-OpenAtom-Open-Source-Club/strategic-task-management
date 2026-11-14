/**
 * /indicators 填报页「一键提交」按钮锁定原因（2026-10-31 用户拍板「灰而可点」）。
 *
 * 与下发页 distributionSubmitGate 同范式：锁的作用域不变（异动期间锁上报是
 * 2026-10-24 互斥锁②的既有设计），只是把「置灰点不动」升级为
 * 「点击当场弹第一条命中原因」：
 * - 本模块是纯函数，同时供三处使用：按钮置灰判定、悬停 title、点击 gate toast——
 *   单一事实源，条件优先级只有一份；
 * - 文案口径（说人话、无内部 ID、最少化）：异动锁与既有 toast 完全同口径，
 *   自评缺口与既有悬停 title 完全同口径，绝不出现 Plan N / 实例 ID。
 */

export interface ReportSubmitGateInput {
  /** 历史快照模式只读 */
  isReadOnly: boolean
  /** 当前计划下存在可提交的指标行 */
  hasIndicators: boolean
  /** 本部门指标异动审批在途（2026-10-24 互斥锁②：同一学院链上上报与异动二选一） */
  mutationInFlight: boolean
  /** 存在未填写自评进度的指标行数 */
  missingSelfRatingCount: number
  /**
   * 2026-11-13（学院上报按归口部门分批提交）：是否已选择「归属部门」。
   * 仅学院页签传入：未选（false）时一键提交/一键撤回禁用并提示先选部门；
   * 缺省（undefined）视为已选——非学院链路调用方零改动。
   */
  functionalDeptSelected?: boolean
}

/**
 * 按条件优先级取第一条命中的锁定原因；全部通过返回空串。
 * 优先级：状态门（只读 → 空列表）→ 归属部门门（2026-11-13）→ 异动锁 → 内容门（自评缺口）。
 */
export function resolveReportSubmitLockReason(input: ReportSubmitGateInput): string {
  if (input.isReadOnly) {
    return '历史快照为只读状态，暂不能提交上报'
  }

  if (!input.hasIndicators) {
    return '没有可提交的指标'
  }

  // 2026-11-13：一键提交必须先选归属部门——后端按报告归口派审批席位，
  // 未选部门时无法确定提交上下文（报告按 (月, 归口部门) 隔离）
  if (input.functionalDeptSelected === false) {
    return '请先选择归属部门'
  }

  // 2026-10-24 互斥锁②：异动审批在途时不能提交上报——文案与既有点击守卫同口径
  if (input.mutationInFlight) {
    return '当前部门存在进行中的异动审批，暂不能提交上报；请等异动审批结束或撤回后再操作'
  }

  if (input.missingSelfRatingCount > 0) {
    return '存在未填写自评进度的指标，请先完成全部指标的自评进度评定，再提交上报'
  }

  return ''
}

/** 「一键提交」按钮可见性判定输入（showSubmitAllButton 的纯逻辑，单一事实源） */
export interface ReportSubmitAllButtonVisibilityInput {
  /** 批量操作区可见（非战略部 + 填报人 + 已收计划 + 有行） */
  showBatchActions: boolean
  /** 当前报告处于填报入口锁定 */
  isReportLocked: boolean
  /** 是否走 PlanReport 上报流程（非战略部恒 true） */
  usePlanReportFlow: boolean
  /** PlanReport 流的报告动作态是否为 draft（传统链不适用恒传 true） */
  isPlanReportDraftState: boolean
  /**
   * 2026-11-13（用户拍板「一键提交的前提是已选归属部门」）：是否已选「归属部门」。
   * 仅学院页签传入：未选（false）时整颗按钮**不渲染**（不是置灰）；
   * 缺省（undefined，非学院链路无归属部门概念）视为已选——渲染逻辑与旧版完全一致。
   */
  functionalDeptSelected?: boolean
  /**
   * 2026-11-13（用户拍板「未来月放填报、拦提交」）：提交目标月是否晚于当前真实月份。
   * 未来月（true）时整颗按钮**不渲染**——填报存草稿不受影响，提交要等到了当月才开放；
   * 缺省（undefined，取不到月份的调用方）视为非未来月——渲染逻辑与旧版完全一致。
   * 后端提交端点有同口径校验兜底（前端隐藏只是入口收敛，不能替代服务端防线）。
   */
  isFutureMonth?: boolean
}

/**
 * 「一键提交」按钮是否渲染（2026-11-13 学院未选归属部门不渲染）。
 * 条件与 useIndicatorListView.showSubmitAllButton 一一对应；学院上下文条件
 * 由调用方折算进 functionalDeptSelected（!isSecondaryCollege || Boolean(selected)），
 * 非学院传 undefined 恒通过——回归零影响。
 */
export function resolveReportSubmitAllButtonVisible(
  input: ReportSubmitAllButtonVisibilityInput
): boolean {
  if (!input.showBatchActions) {
    return false
  }
  if (input.isReportLocked) {
    return false
  }
  if (input.usePlanReportFlow && !input.isPlanReportDraftState) {
    return false
  }
  // 学院未选归属部门 → 不渲染（与置灰门禁「请先选择归属部门」同口径，但更前置）
  if (input.functionalDeptSelected === false) {
    return false
  }
  // 2026-11-13（用户拍板：未来月放填报、拦提交）：提交目标月晚于当前真实月份 →
  // 按钮不渲染。填报（录入/存草稿）不受影响——只是提交动作要等到了当月才开放。
  // 调用方折算传入（未来月=true），undefined 恒通过（非学院/取不到月份的调用方零改动）。
  if (input.isFutureMonth === true) {
    return false
  }
  return true
}

/**
 * 2026-11-13（B-1 修复，用户全链回归实测）：上报「驳回退回待重报」判定。
 *
 * 驳回/发起人撤回后实例是活链（rawStatus 仍 IN_REVIEW），但当前 pending 节点
 * 已回到「填报人提交」——业务上等同草稿：填报人要能直接修改并重新提交。
 * 此前 UiStatus 保持 IN_REVIEW → currentPlanReportActionState 判
 * pending_withdrawable → 「一键提交」不渲染，填报人只能绕行「一键撤回」再重报。
 *
 * @param rawStatus 工作流实例状态（IN_REVIEW/SUBMITTED/PENDING/…）
 * @param currentStepName 当前 pending 节点名（驳回退回的唯一落点 = 填报人提交）
 */
export function isReportReturnedToSubmitter(rawStatus: unknown, currentStepName: unknown): boolean {
  const status = String(rawStatus ?? '')
    .trim()
    .toUpperCase()
  if (!['SUBMITTED', 'IN_REVIEW', 'PENDING'].includes(status)) {
    return false
  }
  return String(currentStepName ?? '').includes('填报人提交')
}
