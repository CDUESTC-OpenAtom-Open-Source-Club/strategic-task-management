/**
 * Dashboard Feature API
 *
 * Provides API endpoints for dashboard functionality including:
 * - Dashboard overview data
 * - Department progress
 * - Recent activities
 * - Alert summaries
 *
 * @module features/dashboard/api
 */

import { apiClient } from '@/shared/api/client'
import { alertApi } from '@/shared/api/monitoringApi'
import { buildQueryKey, fetchWithCache } from '@/shared/lib/utils/cache'
import { CACHE_TTL } from '@/shared/lib/utils/cache-config'
import { logger } from '@/shared/lib/utils/logger'
import type { DashboardData, DepartmentProgress, AlertSummary } from '@/shared/types'

// ============================================================================
// 学院等级统计（2026-10-31 数据看板新口径，后端契约字段，禁止改名）
// 口径：①未填报学院整列不显示（colleges 只含有数据的学院）
//      ②只算已提交/已审批月报（后端过滤）③等级只看上级鉴定三档
//      ④手动预警等级（alert_event/manualAlertSeverity）退出看板统计
// ============================================================================

/** 单个学院的上报等级统计（GET /api/v1/dashboard/college-levels 行结构） */
export interface DashboardCollegeLevelStat {
  /** 学院组织 ID */
  orgId: number
  /** 学院名称 */
  orgName: string
  /** 超前完成数 */
  ahead: number
  /** 正常数 */
  normal: number
  /** 延期数 */
  delayed: number
  /** 总计 */
  total: number
}

/** GET /api/v1/dashboard/college-levels?year=&month= 响应 */
export interface DashboardCollegeLevelsResponse {
  year: number
  month: number
  /** 只含有数据的学院（未填报学院不返回） */
  colleges: DashboardCollegeLevelStat[]
}

/** 趋势接口的单月结构 */
export interface DashboardCollegeLevelsMonth {
  month: number
  /** 只含有数据的学院（未填报学院不返回） */
  colleges: DashboardCollegeLevelStat[]
}

/** GET /api/v1/dashboard/college-levels-trend?year= 响应（months 只到最晚有数据月份） */
export interface DashboardCollegeLevelsTrendResponse {
  year: number
  months: DashboardCollegeLevelsMonth[]
}

/**
 * 兼容两种返回形态：契约裸形态 { year, month, colleges } 与后端统一
 * ApiResponse 包裹形态 { code, message, data }（DashboardSummaryController 同款）。
 */
function unwrapDashboardPayload<T extends object>(payload: unknown): T | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }
  const record = payload as Record<string, unknown>
  if ('code' in record && 'data' in record && record.data && typeof record.data === 'object') {
    return record.data as T
  }
  return payload as T
}

function summarizeAlerts(alerts: Array<{ severity?: string; status?: string }>): AlertSummary {
  const summary: AlertSummary = {
    severe: 0,
    moderate: 0,
    normal: 0,
    total: 0
  }

  alerts.forEach(alert => {
    const status = String(alert.status).toUpperCase()
    if (status === 'CLOSED' || status === 'RESOLVED') {
      return
    }

    summary.total += 1
    const severity = String(alert.severity).toUpperCase()
    if (severity === 'CRITICAL') {
      summary.severe += 1
    } else if (severity === 'WARNING' || severity === 'MAJOR') {
      summary.moderate += 1
    } else {
      summary.normal += 1
    }
  })

  return summary
}

/**
 * API endpoints for dashboard functionality
 * 注意：后端API位于 /api/v1/analytics/ 路径下
 */
export const dashboardApi = {
  async sendReminder(indicatorId: number, reason?: string) {
    return await apiClient.post(`/indicators/${indicatorId}/reminders`, {
      source: 'DASHBOARD',
      reason: reason ?? '任务进度滞后，请尽快更新进展'
    })
  },

  async getReminderStatuses(indicatorIds: number[]) {
    if (indicatorIds.length === 0) {
      return []
    }

    const response = await apiClient.post('/indicators/reminders/statuses', {
      indicatorIds
    })
    const payload = response?.data?.data
    return Array.isArray(payload) ? payload : []
  },

  /**
   * Get dashboard overview data
   * 使用正确的后端API路径：/api/v1/analytics/dashboard/overview
   */
  async getDashboardData(): Promise<DashboardData> {
    try {
      logger.debug('[dashboardApi] Fetching dashboard data')
      return await fetchWithCache({
        key: buildQueryKey('dashboard', 'overview'),
        policy: {
          ttlMs: CACHE_TTL.DASHBOARD,
          scope: 'memory',
          staleWhileRevalidate: false,
          dedupeWindowMs: 1000,
          tags: ['dashboard.overview']
        },
        fetcher: () => apiClient.post<DashboardData>('/analytics/dashboard', {})
      })
    } catch (error) {
      logger.error('[dashboardApi] Failed to fetch dashboard data:', error)
      throw error
    }
  },

  /**
   * Get department progress data
   * 使用正确的后端API路径：/api/v1/analytics/dashboard/charts
   */
  async getDepartmentProgress(): Promise<DepartmentProgress[]> {
    try {
      logger.debug('[dashboardApi] Fetching department progress')
      await apiClient.post('/analytics/dashboard', {})
      return []
    } catch (error) {
      logger.error('[dashboardApi] Failed to fetch department progress:', error)
      throw error
    }
  },

  /**
   * Get recent activities

   * 注意：后端文档中未明确定义此接口
   * 使用/analytics/activities作为临时路径，需要后端确认
   */
  async getRecentActivities(): Promise<Array<Record<string, unknown>>> {
    try {
      logger.debug('[dashboardApi] Fetching recent activities')
      return []
    } catch (error) {
      logger.error('[dashboardApi] Failed to fetch recent activities:', error)
      // 返回空数组而不是抛出错误，保持UI稳定性
      return []
    }
  },

  /**
   * Get alert summary
   * 使用正确的后端API路径：/api/v1/alerts/events/unclosed
   */
  async getAlertSummary(): Promise<AlertSummary> {
    try {
      logger.debug('[dashboardApi] Fetching alert summary')
      return summarizeAlerts(await alertApi.getUnclosedAlerts())
    } catch (error) {
      logger.error('[dashboardApi] Failed to fetch alert summary:', error)
      throw error
    }
  },

  /**
   * 学院等级统计（按年月）
   * GET /api/v1/dashboard/college-levels?year=&month=
   * 非法参数后端 400；colleges 只含有数据的学院（未填报学院整列不画）
   */
  async getCollegeLevels(params: {
    year: number
    month: number
  }): Promise<DashboardCollegeLevelsResponse> {
    try {
      logger.debug('[dashboardApi] Fetching college levels:', params)
      const payload = await apiClient.get<unknown>('/dashboard/college-levels', {
        year: params.year,
        month: params.month
      })
      const data = unwrapDashboardPayload<DashboardCollegeLevelsResponse>(payload)
      if (!data || !Array.isArray(data.colleges)) {
        throw new Error('学院等级接口返回格式异常')
      }
      return data
    } catch (error) {
      logger.error('[dashboardApi] Failed to fetch college levels:', error)
      throw error
    }
  },

  /**
   * 学院等级月度趋势（按年）
   * GET /api/v1/dashboard/college-levels-trend?year=
   * months 只到最晚有数据月份；x 轴只画接口返回的月份
   */
  async getCollegeLevelsTrend(params: {
    year: number
  }): Promise<DashboardCollegeLevelsTrendResponse> {
    try {
      logger.debug('[dashboardApi] Fetching college levels trend:', params)
      const payload = await apiClient.get<unknown>('/dashboard/college-levels-trend', {
        year: params.year
      })
      const data = unwrapDashboardPayload<DashboardCollegeLevelsTrendResponse>(payload)
      if (!data || !Array.isArray(data.months)) {
        throw new Error('学院等级趋势接口返回格式异常')
      }
      return data
    } catch (error) {
      logger.error('[dashboardApi] Failed to fetch college levels trend:', error)
      throw error
    }
  },

  /**
   * Get filtered dashboard data
   * 注意：后端文档中未明确定义此接口
   * 临时复用overview接口，需要后端确认
   */
  async getFilteredDashboardData(params: {
    department?: string
    indicatorType?: string
    alertLevel?: 'severe' | 'moderate' | 'normal'
    year?: number
  }): Promise<DashboardData> {
    try {
      logger.debug('[dashboardApi] Fetching filtered dashboard data:', params)
      return await fetchWithCache({
        key: buildQueryKey('dashboard', 'overview', params),
        policy: {
          ttlMs: CACHE_TTL.DASHBOARD,
          scope: 'memory',
          staleWhileRevalidate: false,
          dedupeWindowMs: 1000,
          tags: ['dashboard.overview']
        },
        fetcher: () => apiClient.post<DashboardData>('/analytics/dashboard', params)
      })
    } catch (error) {
      logger.error('[dashboardApi] Failed to fetch filtered dashboard data:', error)
      throw error
    }
  }
}
