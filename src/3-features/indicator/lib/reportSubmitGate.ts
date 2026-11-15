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
 *
 * 2026-11-15（用户拍板「提交按钮隐藏改主动引导」）：草稿态/归属部门/未来月三条件
 * 从「整颗按钮 v-if 不渲染」并入本原因链（按钮始终渲染，置灰 + el-tooltip 说明
 * 缺什么，与一键撤回同款结构）。多条件同时缺时文案按优先级取第一条：
 * 部门 > 未来月 > 草稿（紧随既有状态门之后，异动锁/自评缺口保持其后不变）。
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
  /**
   * 2026-11-15（用户拍板「未来月放填报、拦提交」原显隐条件并入置灰引导）：
   * 提交目标月是否晚于当前真实月份。未来月（true）时一键提交置灰并提示
   * 「未来周期暂不能提交」；填报存草稿不受影响。后端提交端点有同口径校验兜底
   * （前端置灰只是入口收敛，不能替代服务端防线）。缺省视为非未来月。
   */
  isFutureMonth?: boolean
  /**
   * 2026-11-15：是否走 PlanReport 上报流程（原显隐条件并入置灰引导）。
   * 缺省（undefined）视为 true——与旧显隐函数口径一致。
   */
  usePlanReportFlow?: boolean
  /**
   * 2026-11-15：PlanReport 流的报告动作态是否为 draft（原显隐条件并入置灰引导）。
   * 走 PlanReport 流且非 draft（在审/已批等）时置灰并提示「暂无可提交的填报内容」；
   * 传统链（usePlanReportFlow=false）不适用。缺省视为草稿态。
   */
  isPlanReportDraftState?: boolean
}

/**
 * 按条件优先级取第一条命中的锁定原因；全部通过返回空串。
 * 优先级：状态门（只读 → 空列表）→ 归属部门门（2026-11-13）→ 未来月门（2026-11-15）→
 * 草稿态门（2026-11-15）→ 异动锁 → 内容门（自评缺口）。
 * 三门（部门 > 未来月 > 草稿）的相对顺序为 2026-11-15 用户拍板的 tooltip 文案优先级。
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

  // 2026-11-15（用户拍板：未来月放填报、拦提交，原 v-if 隐藏并入置灰引导）：
  // 提交目标月晚于当前真实月份 → 置灰并提示；填报存草稿不受影响
  if (input.isFutureMonth === true) {
    return '未来周期暂不能提交'
  }

  // 2026-11-15（原「非草稿态不渲染」并入置灰引导）：报告在审/已批等非 draft 态
  // 没有可提交的草稿内容；传统链不适用（usePlanReportFlow=false 或缺省时跳过）
  if ((input.usePlanReportFlow ?? true) && input.isPlanReportDraftState === false) {
    return '暂无可提交的填报内容'
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
