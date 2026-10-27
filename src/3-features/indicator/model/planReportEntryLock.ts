/**
 * 月度上报链（B6 会议定案及后续修正）共用的纯计算逻辑：
 * - 「最早未填报月」扫描
 * - 填报入口锁定判定
 *
 * 独立成无依赖模块，便于单元测试（不引入 store / api）。
 */

export type PlanReportEntryLockState = {
  /** 最早未填报月（YYYYMM）；'' 表示当年 12 个月全部已有报告（无可填月） */
  earliestUnfilledMonth: string
  /** 目标填报月的报告状态（大写）；'' 表示该月尚无报告（可新填） */
  targetMonthReportStatus: string
}

/**
 * 扫描第一个不存在于 existingMonths 的月份（YYYYMM）。
 *
 * 2026-10-27 用户定案：起算月不是 1 月，而是「计划下发给该组织的那个月」。
 * 例如 2 月下发到某学院的计划，该学院从 2 月开始填报，不会被要求补 1 月。
 * 因此扫描从 startMonth（起算月）开始；startMonth 不可得时退回从 1 月扫（历史行为）。
 *
 * @param existingMonths 已上报月份集合；`null` 表示数据不可得（与「空集合」区分），返回 `null` 由调用方降级
 * @param year 目标年份（当年）
 * @param startMonth 起算月（YYYYMM），通常是计划下发月；不可得时从 1 月起扫
 * @returns 最早未填报月；起算月到 12 月全部已填返回 `''`；数据不可得返回 `null`
 */
export function findEarliestUnfilledReportMonth(
  existingMonths: string[] | null,
  year: number,
  startMonth?: string | null
): string | null {
  if (!existingMonths) {
    return null
  }

  const normalizedMonths = new Set(existingMonths.map(month => String(month).trim()))

  // 起算月：格式合法且年份一致才采纳，否则退回 1 月
  let startMonthValue = 1
  const normalizedStart = String(startMonth || '').trim()
  if (/^\d{6}$/.test(normalizedStart) && normalizedStart.slice(0, 4) === String(year)) {
    const parsed = Number(normalizedStart.slice(4, 6))
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 12) {
      startMonthValue = parsed
    }
  }

  for (let month = startMonthValue; month <= 12; month++) {
    const value = `${year}${String(month).padStart(2, '0')}`
    if (!normalizedMonths.has(value)) {
      return value
    }
  }
  return ''
}

/**
 * 报告处于这些状态时，该报告所在月不可再填报：
 * 审批中（SUBMITTED / IN_REVIEW / PENDING）或已批准（APPROVED）。
 */
export function isLockingPlanReportStatus(status?: string | null): boolean {
  return ['SUBMITTED', 'IN_REVIEW', 'PENDING', 'APPROVED'].includes(
    String(status || '')
      .trim()
      .toUpperCase()
  )
}

/**
 * 填报入口锁定判定（缺陷修复：报告批准后填报按钮不应永久消失）。
 *
 * 语义：锁定 = 「当前要填报的那个月（最早未填月）」的报告正在审批中或已批准。
 * - 最早未填月无报告（可新填）→ 不锁；
 * - 12 个月全部已填报（无可填月）→ 锁；
 * - 最早未填月的报告审批中 / 已批准 → 锁。
 */
export function resolvePlanReportEntryLock(params: {
  usePlanReportFlow?: boolean
  lockState: PlanReportEntryLockState | null | undefined
}): boolean {
  if (params.usePlanReportFlow === false) {
    return false
  }

  const { earliestUnfilledMonth, targetMonthReportStatus } = params.lockState ?? {}
  if (typeof earliestUnfilledMonth !== 'string') {
    return false
  }

  if (earliestUnfilledMonth === '') {
    return true
  }

  return isLockingPlanReportStatus(targetMonthReportStatus)
}
