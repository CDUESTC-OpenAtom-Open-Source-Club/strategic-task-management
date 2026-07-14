/**
 * Dashboard Feature - Query API
 *
 * Read-only API operations for dashboard data.
 */

import { apiClient } from '@/shared/api/client'
import { alertApi } from '@/shared/api/monitoringApi'
import { buildQueryKey, fetchWithCache } from '@/shared/lib/utils/cache'
import { CACHE_TTL, createShortMemoryPolicy } from '@/shared/lib/utils/cache-config'
import { logger } from '@/shared/lib/utils/logger'
import type { DashboardData, DepartmentProgress, AlertSummary } from '@/shared/types'

const DASHBOARD_POLICY = createShortMemoryPolicy(CACHE_TTL.DASHBOARD, {
  staleWhileRevalidate: true,
  tags: ['dashboard.overview']
})

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
 * Get dashboard overview data
 *
 * API: GET /api/v1/analytics/dashboard/overview
 *
 * @returns Dashboard overview data
 */
export async function getDashboardData(): Promise<DashboardData> {
  try {
    logger.debug('[Dashboard API] Fetching dashboard data')
    return await fetchWithCache({
      key: buildQueryKey('dashboard', 'overview'),
      policy: DASHBOARD_POLICY,
      fetcher: () => apiClient.post<DashboardData>('/analytics/dashboard', {})
    })
  } catch (error) {
    logger.error('[Dashboard API] Failed to fetch dashboard data:', error)
    throw error
  }
}

/**
 * Get department progress data
 *
 * API: GET /api/v1/analytics/dashboard/charts
 *
 * @returns Department progress list
 */
export async function getDepartmentProgress(): Promise<DepartmentProgress[]> {
  try {
    logger.debug('[Dashboard API] Fetching department progress')
    await apiClient.post('/analytics/dashboard', {})
    return []
  } catch (error) {
    logger.error('[Dashboard API] Failed to fetch department progress:', error)
    throw error
  }
}

/**
 * Get recent activities
 *
 * API: GET /api/v1/analytics/activities
 *
 * @returns Recent activities list
 */
export async function getRecentActivities(): Promise<Array<Record<string, unknown>>> {
  try {
    logger.debug('[Dashboard API] Fetching recent activities')
    return []
  } catch (error) {
    logger.error('[Dashboard API] Failed to fetch recent activities:', error)
    // Return empty array to maintain UI stability
    return []
  }
}

/**
 * Get alert summary
 *
 * API: GET /api/v1/alerts/events/unclosed
 *
 * @returns Alert summary
 */
export async function getAlertSummary(): Promise<AlertSummary> {
  try {
    logger.debug('[Dashboard API] Fetching alert summary')
    return await fetchWithCache({
      key: buildQueryKey('dashboard', 'alertSummary'),
      policy: {
        ...createShortMemoryPolicy(CACHE_TTL.WORKFLOW_DETAIL, {
          staleWhileRevalidate: true,
          tags: ['dashboard.overview']
        })
      },
      fetcher: async () => summarizeAlerts(await alertApi.getUnclosedAlerts())
    })
  } catch (error) {
    logger.error('[Dashboard API] Failed to fetch alert summary:', error)
    throw error
  }
}

/**
 * Get filtered dashboard data
 *
 * API: GET /api/v1/analytics/dashboard/overview
 *
 * @param params - Filter parameters
 * @returns Dashboard overview data
 */
export async function getFilteredDashboardData(params: {
  department?: string
  indicatorType?: string
  alertLevel?: 'severe' | 'moderate' | 'normal'
  year?: number
}): Promise<DashboardData> {
  try {
    logger.debug('[Dashboard API] Fetching filtered dashboard data:', params)
    return await fetchWithCache({
      key: buildQueryKey('dashboard', 'overview', params),
      policy: DASHBOARD_POLICY,
      fetcher: () => apiClient.post<DashboardData>('/analytics/dashboard', params)
    })
  } catch (error) {
    logger.error('[Dashboard API] Failed to fetch filtered dashboard data:', error)
    throw error
  }
}
