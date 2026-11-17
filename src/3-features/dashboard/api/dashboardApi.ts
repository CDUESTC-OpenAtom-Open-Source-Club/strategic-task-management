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

// ============================================================================
// 审核鉴定口径汇总（2026-11-17 用户反馈第 1 条修复）
// 一次返回：①职能部门等级分布（含月度快照）②滞后任务清单 ③年度简报汇总
// 口径：每个指标取不晚于选中月份的最近一次 appraisal_level；当月未上报的部门沿用上次结论
// ============================================================================

/** 单个职能部门的鉴定等级计数 */
export interface DashboardDepartmentLevelStat {
  orgId: number
  orgName: string
  ahead: number
  normal: number
  /** 滞后数（上级鉴定 DELAYED） */
  delayed: number
  total: number
}

/** 部门等级月度快照（下钻趋势用） */
export interface DashboardDepartmentLevelMonth {
  month: number
  departments: DashboardDepartmentLevelStat[]
}

/** 滞后任务（最近一次鉴定为 DELAYED 的指标） */
export interface DashboardLaggingTask {
  /** 指标 ID（前端表格的 REF_ID） */
  indicatorId: number
  indicatorName: string
  /** 责任主体组织 ID */
  orgId: number | null
  /** 责任主体组织名称 */
  orgName: string
  /** 最近一次鉴定所在月份，格式 yyyyMM */
  reportMonth: string
}

/** 年度鉴定等级汇总（简报口径） */
export interface DashboardAnnualLevelSummary {
  ahead: number
  normal: number
  delayed: number
  total: number
  /** 总体完成率百分比（0-100 整数） */
  completionRate: number
}

/** GET /api/v1/dashboard/appraisal-summary?year=&month=&limit= 响应 */
export interface DashboardAppraisalSummaryResponse {
  year: number
  month: number
  /** 该年度最近一个有鉴定数据的月份（0 表示该年度无鉴定数据） */
  latestMonth: number
  departments: DashboardDepartmentLevelStat[]
  departmentMonths: DashboardDepartmentLevelMonth[]
  laggingTasks: DashboardLaggingTask[]
  annual: DashboardAnnualLevelSummary
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
   * 审核鉴定口径的看板汇总（职能部门分布 / 滞后任务 / 年度简报）
   * GET /api/v1/dashboard/appraisal-summary?year=&month=&limit=
   * 每个指标取不晚于 month 的最近一次鉴定，当月未上报的部门沿用上次结论
   */
  async getAppraisalSummary(params: {
    year: number
    month: number
    limit?: number
  }): Promise<DashboardAppraisalSummaryResponse> {
    try {
      logger.debug('[dashboardApi] Fetching appraisal summary:', params)
      const payload = await apiClient.get<unknown>('/dashboard/appraisal-summary', {
        year: params.year,
        month: params.month,
        limit: params.limit
      })
      const data = unwrapDashboardPayload<DashboardAppraisalSummaryResponse>(payload)
      if (
        !data ||
        !Array.isArray(data.departments) ||
        !Array.isArray(data.departmentMonths) ||
        !Array.isArray(data.laggingTasks) ||
        !data.annual
      ) {
        throw new Error('审核鉴定汇总接口返回格式异常')
      }
      return data
    } catch (error) {
      logger.error('[dashboardApi] Failed to fetch appraisal summary:', error)
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
