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
import { logger } from '@/shared/lib/utils/logger'
import type { DashboardData, DepartmentProgress, AlertSummary } from '@/shared/types'

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
          ttlMs: 45 * 1000,
          scope: 'memory',
          staleWhileRevalidate: true,
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
          ttlMs: 45 * 1000,
          scope: 'memory',
          staleWhileRevalidate: true,
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
