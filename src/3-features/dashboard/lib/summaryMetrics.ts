import type { DashboardData, Indicator } from '@/shared/types'

export type DashboardIndicatorStatus = 'normal' | 'ahead' | 'warning' | 'delayed'

// 里程碑机制已移除：状态不再由里程碑推导，统一回落为正常。
// 延后判断改由上报链路的上级鉴定等级承载。
export const getIndicatorStatusAtMonth = (
  _indicator: Indicator,
  _month: number,
  _year: number
): DashboardIndicatorStatus => {
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
