/**
 * useIndicatorStatus - 指标状态计算 Composable
 *
 * 职责:
 * - 计算指标状态（正常、超前、预警、延期）
 * - 获取当前目标进度
 * - 提供状态相关的工具函数
 *
 * @module composables/dashboard
 */

import type { StrategicIndicator } from '@/shared/types'
import type { IndicatorStatus, STATUS_COLORS as _STATUS_COLORS } from './useDashboardState'

/**
 * 计算指标状态
 */
export function getIndicatorStatus(_indicator: { progress?: number }): IndicatorStatus {
  // 里程碑机制已移除：状态统一回落为正常。
  return 'normal'
}

/**
 * 获取状态显示文本
 */
export function getStatusText(status: IndicatorStatus): string {
  const statusMap: Record<IndicatorStatus, string> = {
    normal: '正常',
    ahead: '超前完成',
    warning: '预警',
    delayed: '延期'
  }
  return statusMap[status]
}

/**
 * 获取状态对应的颜色类
 */
export function getStatusClass(status: IndicatorStatus): string {
  const classMap: Record<IndicatorStatus, string> = {
    normal: 'status-normal',
    ahead: 'status-ahead',
    warning: 'status-warning',
    delayed: 'status-delayed'
  }
  return classMap[status]
}

/**
 * 获取当月目标进度
 */
export function getCurrentTargetProgress(_indicator: { progress?: number }): number | null {
  // 里程碑机制已移除。
  return null
}

/**
 * 计算进度百分比
 */
export function getProgressPercentage(current: number, target: number): number {
  if (target === 0) {
    return 0
  }
  return Math.min(100, Math.round((current / target) * 100))
}

/**
 * 批量计算指标状态
 */
export function calculateIndicatorStatuses(indicators: StrategicIndicator[]) {
  return indicators.map(indicator => ({
    indicator,
    status: getIndicatorStatus(indicator),
    currentTarget: getCurrentTargetProgress(indicator)
  }))
}
