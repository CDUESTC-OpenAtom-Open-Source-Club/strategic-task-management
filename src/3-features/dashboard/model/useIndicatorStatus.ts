/**
 * useIndicatorStatus - 指标状态计算 Model
 *
 * 职责:
 * - 计算指标状态（正常、超前、预警、延期）
 * - 获取当前目标进度
 * - 提供状态相关的工具函数
 *
 * @module features/dashboard/model
 */

import type { StrategicIndicator } from '@/shared/types'
import type {
  IndicatorStatus,
  STATUS_COLORS as _STATUS_COLORS
} from '@/shared/lib/hooks/dashboard/useDashboardState'

/**
 * 计算指标状态
 */
export function getIndicatorStatus(indicator: StrategicIndicator): IndicatorStatus {
  // 里程碑机制已移除：状态不再由里程碑推导，统一回落为正常。
  // 延后判断改由上报链路的上级鉴定等级承载（见上报审批链路策划稿）。
  void indicator
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
export function getCurrentTargetProgress(_indicator: StrategicIndicator): number | null {
  // 里程碑机制已移除：不再有里程碑目标进度。
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
