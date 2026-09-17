import type { DashboardData, Indicator } from '@/shared/types'

export type DashboardIndicatorStatus = 'normal' | 'ahead' | 'warning' | 'delayed'

/**
 * 指标在某月的执行状态。
 *
 * 口径依据《SISM-业务口径决议录-2026-09-16》：
 * - 里程碑机制已移除，不再由里程碑到期日/目标进度推导状态（原实现依赖 indicator.milestones）。
 * - 预警/鉴定改为「纯人工判定」，沿用现有预警等级三档（正常/警告/严重）。
 * - 未下发（DRAFT）或未进入审批的指标不计入完成，维持原状。
 *
 * 判定顺序（先真实数据、后状态回退）：
 * 1. 指标自身人工预警等级（manualAlertLevel / alertLevel）
 * 2. 指标生命周期状态：未下发（DRAFT/REJECTED）→ 不算完成
 * 3. 进度：达到 100 → ahead（超前/达成）；有进度但未完成 → normal（正常推进）
 */
const ALERT_LEVEL_TO_STATUS: Record<string, DashboardIndicatorStatus> = {
  // 三档预警等级（正常/警告/严重）——对齐后端 warn_level 与前端预警判定
  OK: 'normal',
  NONE: 'normal',
  INFO: 'normal',
  MINOR: 'warning',
  WARN: 'warning',
  WARNING: 'warning',
  MAJOR: 'delayed',
  CRITICAL: 'delayed'
}

const resolveManualAlertStatus = (
  indicator: Indicator
): DashboardIndicatorStatus | null => {
  const record = indicator as unknown as Record<string, unknown>
  const rawLevel =
    record.manualAlertLevel ?? record.alertLevel ?? record.warningLevel ?? record.alertSeverity

  if (rawLevel === null || rawLevel === undefined || rawLevel === '') {
    return null
  }

  const mapped = ALERT_LEVEL_TO_STATUS[String(rawLevel).toUpperCase()]
  return mapped ?? null
}

/** 未下发/已驳回的指标不计入完成（决议录：未提交审批的维持原状、不算完成） */
const isNotDistributed = (indicator: Indicator): boolean => {
  const status = String(indicator.workflowStatus ?? indicator.status ?? '').toUpperCase()
  return status === 'DRAFT' || status === 'REJECTED'
}

export const getIndicatorStatusAtMonth = (
  indicator: Indicator,
  _month: number,
  _year: number
): DashboardIndicatorStatus => {
  // 1. 人工预警等级优先（真实数据源）
  const alertStatus = resolveManualAlertStatus(indicator)
  if (alertStatus && alertStatus !== 'normal') {
    return alertStatus
  }

  // 2. 未下发/已驳回：不算完成，但也不虚报为正常
  if (isNotDistributed(indicator)) {
    return 'warning'
  }

  // 3. 已下发：按进度判断推进状态
  const progress = Number(indicator.progress ?? 0)
  if (progress >= 100) {
    return 'ahead'
  }

  return 'normal'
}

export const buildDashboardSummary = (
  indicators: Indicator[],
  month: number,
  year: number
): DashboardData => {
  const totalIndicators = indicators.length
  const basicIndicators = indicators.filter(i => i.type2 === '基础性')
  const developmentIndicators = indicators.filter(i => i.type2 === '发展性')

  const basicScore =
    basicIndicators.length > 0
      ? Math.round(
          basicIndicators.reduce((sum, i) => sum + Number(i.progress ?? 0), 0) /
            basicIndicators.length
        )
      : 0
  const developmentScore =
    developmentIndicators.length > 0
      ? Math.round(
          (developmentIndicators.reduce((sum, i) => sum + Number(i.progress ?? 0), 0) /
            developmentIndicators.length) *
            0.2
        )
      : 0

  const statusCounts = indicators.reduce(
    (counts, indicator) => {
      const status = getIndicatorStatusAtMonth(indicator, month, year)
      counts[status] += 1
      return counts
    },
    {
      ahead: 0,
      normal: 0,
      warning: 0,
      delayed: 0
    }
  )

  // 完成 = 已达成（ahead）或正常推进（normal）；预警/滞后不计入完成
  const completedIndicators = statusCounts.ahead + statusCounts.normal
  const warningCount = statusCounts.warning + statusCounts.delayed

  return {
    totalScore: basicScore + developmentScore,
    basicScore,
    developmentScore,
    completionRate:
      totalIndicators > 0 ? Math.round((completedIndicators / totalIndicators) * 100) : 0,
    warningCount,
    totalIndicators,
    completedIndicators,
    alertIndicators: {
      severe: statusCounts.delayed,
      moderate: statusCounts.warning,
      normal: statusCounts.ahead + statusCounts.normal
    }
  }
}
