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
 * 在当年 1~12 月中扫描第一个不存在于 existingMonths 的月份（YYYYMM）。
 *
 * @param existingMonths 已上报月份集合；`null` 表示数据不可得（与「空集合」区分），返回 `null` 由调用方降级
 * @param year 目标年份（当年）
 * @returns 最早未填报月；全部已填返回 `''`；数据不可得返回 `null`
 */
export function findEarliestUnfilledReportMonth(
  existingMonths: string[] | null,
  year: number
): string | null {
  if (!existingMonths) {
    return null
  }

  const normalizedMonths = new Set(existingMonths.map(month => String(month).trim()))
  for (let month = 1; month <= 12; month++) {
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
