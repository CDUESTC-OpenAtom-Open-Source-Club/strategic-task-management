/**
 * Dashboard Calculation Service
 *
 * 负责仪表板相关的业务计算逻辑
 * 包括进度计算、权重计算、统计计算等
 */

import type { Indicator } from '@/shared/types'

export class DashboardCalculationService {
  /**
   * 计算指标完成率
   * @param indicators 指标列表
   * @returns 完成率百分比
   */
  calculateCompletionRate(indicators: Indicator[]): number {
    if (indicators.length === 0) {
      return 0
    }

    const totalProgress = indicators.reduce((sum, indicator) => {
      return sum + (indicator.progress || 0)
    }, 0)

    return Math.round(totalProgress / indicators.length)
  }

  /**
   * 计算加权完成率
   * @param indicators 指标列表
   * @returns 加权完成率
   */
  calculateWeightedCompletionRate(indicators: Indicator[]): number {
    if (indicators.length === 0) {
      return 0
    }

    let totalWeight = 0
    let weightedProgress = 0

    indicators.forEach(indicator => {
      const weight = indicator.weight || 1
      const progress = indicator.progress || 0

      totalWeight += weight
      weightedProgress += progress * weight
    })

    if (totalWeight === 0) {
      return 0
    }

    return Math.round(weightedProgress / totalWeight)
  }

  /**
   * 计算基础性指标平均进度
   * @param indicators 指标列表
   * @returns 基础性指标平均进度
   */
  calculateBasicProgress(indicators: Indicator[]): number {
    const basicIndicators = indicators.filter(i => i.type2 === '基础性')

    if (basicIndicators.length === 0) {
      return 0
    }

    const totalProgress = basicIndicators.reduce((sum, i) => sum + (i.progress || 0), 0)
    return Math.round(totalProgress / basicIndicators.length)
  }

  /**
   * 计算发展性指标平均进度
   * @param indicators 指标列表
   * @returns 发展性指标平均进度
   */
  calculateDevelopmentProgress(indicators: Indicator[]): number {
    const developmentIndicators = indicators.filter(i => i.type2 === '发展性')

    if (developmentIndicators.length === 0) {
      return 0
    }

    const totalProgress = developmentIndicators.reduce((sum, i) => sum + (i.progress || 0), 0)
    return Math.round(totalProgress / developmentIndicators.length)
  }

  /**
   * 计算总分
   * 基础性指标满分100分，发展性指标满分20分
   * @param indicators 指标列表
   * @returns 总分
   */
  calculateTotalScore(indicators: Indicator[]): number {
    const basicProgress = this.calculateBasicProgress(indicators)
    const developmentProgress = this.calculateDevelopmentProgress(indicators)

    // 基础性指标 100% 对应 100 分
    const basicScore = basicProgress

    // 发展性指标 100% 对应 20 分
    const developmentScore = Math.round(developmentProgress * 0.2)

    return basicScore + developmentScore
  }

  /**
   * 计算预警指标数量
   * @param indicators 指标列表
   * @returns 预警指标数量
   */
  calculateWarningCount(indicators: Indicator[]): number {
    return indicators.filter(i => {
      const progress = i.progress || 0
      return progress < 50
    }).length
  }

  /**
   * 计算各部门进度统计
   * @param indicators 指标列表
   * @returns 部门进度映射表
   */
  calculateDepartmentProgress(indicators: Indicator[]): Map<string, number> {
    const deptProgress = new Map<string, number[]>()

    indicators.forEach(indicator => {
      const dept = indicator.responsible_dept
      const progress = indicator.progress || 0

      if (!deptProgress.has(dept)) {
        deptProgress.set(dept, [])
      }

      const progressList = deptProgress.get(dept)
      if (progressList) {
        progressList.push(progress)
      }
    })

    // 计算每个部门的平均进度
    const avgProgress = new Map<string, number>()
    deptProgress.forEach((progressList, dept) => {
      const avg = Math.round(progressList.reduce((sum, p) => sum + p, 0) / progressList.length)
      avgProgress.set(dept, avg)
    })

    return avgProgress
  }

  /**
   * 计算状态分布
   * @param indicators 指标列表
   * @returns 状态分布统计
   */
  calculateStatusDistribution(indicators: Indicator[]): {
    ahead: number
    normal: number
    warning: number
    delayed: number
  } {
    const distribution = {
      ahead: 0,
      normal: 0,
      warning: 0,
      delayed: 0
    }

    indicators.forEach(indicator => {
      const status = indicator.status || 'normal'
      if (status in distribution) {
        distribution[status as keyof typeof distribution]++
      }
    })

    return distribution
  }
}

// 导出单例实例函数
export function useDashboardCalculationService(): DashboardCalculationService {
  return new DashboardCalculationService()
}
