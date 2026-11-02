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
}

/**
 * 按条件优先级取第一条命中的锁定原因；全部通过返回空串。
 * 优先级：状态门（只读 → 空列表）→ 异动锁 → 内容门（自评缺口）。
 */
export function resolveReportSubmitLockReason(input: ReportSubmitGateInput): string {
  if (input.isReadOnly) {
    return '历史快照为只读状态，暂不能提交上报'
  }

  if (!input.hasIndicators) {
    return '没有可提交的指标'
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
