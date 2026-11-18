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
// 学院等级统计（2026-11-17 数据看板新口径，后端契约字段，禁止改名）
// 口径：①未填报学院也要返回（reported=false，前端画灰柱「下发 n 项·未填报」督办）
//      ②只算已提交/已审批月报（后端过滤，DRAFT 不计入）③等级 appraisal_level 优先
//        self_rating 兜底三档 ④手动预警等级（alert_event/manualAlertSeverity）退出看板统计
// ============================================================================

/**
 * 月份快照状态（2026-11-18 按月快照口径，后端契约字段，禁止改名）。
 *
 * 只有 APPROVED 月份出鉴定值；IN_REVIEW=该月上报仍在审批中、NOT_REPORTED=该月未填报，
 * 两种状态下前端一律置灰显示（#C0C4CC 灰柱 + tooltip 状态说明），不画鉴定柱。
 * 字段缺省（后端未合并 month-snapshot 分支时）按 reported 兜底：
 * reported=false → NOT_REPORTED，否则视为 APPROVED（兼容旧响应）。
 */
export type DashboardMonthState = 'APPROVED' | 'IN_REVIEW' | 'NOT_REPORTED'

/** 单个学院的上报等级统计（GET /api/v1/dashboard/college-levels 行结构） */
export interface DashboardCollegeLevelStat {
  /** 学院组织 ID */
  orgId: number
  /** 学院名称 */
  orgName: string
  /** 所属月份（1-12，趋势接口逐月返回时区分用） */
  month?: number
  /** 超前完成数 */
  ahead: number
  /** 正常数 */
  normal: number
  /** 滞后数（后端枚举 DELAYED） */
  delayed: number
  /** 总计（ahead + normal + delayed） */
  total: number
  /** 当年已下发到该学院的指标数（灰柱「下发 n 项」数据源） */
  dispatchedCount?: number
  /** 当年未下发到该学院的指标数（status=DRAFT/PENDING） */
  undispatchedCount?: number
  /** 未填报标记：false=当月无已提交/已审批月报（灰柱督办），true=已填报 */
  reported?: boolean
  /** 该学院该月的快照状态（按月快照口径；缺省按 reported 兜底） */
  monthState?: DashboardMonthState
}

/** GET /api/v1/dashboard/college-levels?year=&month= 响应 */
export interface DashboardCollegeLevelsResponse {
  year: number
  month: number
  /** 选中月份的全校快照状态（按月快照口径；缺省按 colleges 行内 reported 兜底） */
  monthState?: DashboardMonthState
  /** 学院列表（当年有指标 ∪ 当月已上报；未填报学院 reported=false） */
  colleges: DashboardCollegeLevelStat[]
}

/** 趋势接口的单月结构 */
export interface DashboardCollegeLevelsMonth {
  month: number
  /** 该月全校快照状态（按月快照口径；缺省按 colleges 行内 reported 兜底） */
  monthState?: DashboardMonthState
  /** 学院列表（含未填报学院 reported=false） */
  colleges: DashboardCollegeLevelStat[]
}

/** GET /api/v1/dashboard/college-levels-trend?year= 响应（months 固定 1-12 月全量） */
export interface DashboardCollegeLevelsTrendResponse {
  year: number
  months: DashboardCollegeLevelsMonth[]
}

/** 单条滞后指标明细（GET /api/v1/dashboard/delayed-indicators 行结构） */
export interface DashboardDelayedIndicatorItem {
  /** 指标ID（催办接口入参） */
  indicatorId: number
  /** 指标描述 */
  indicatorName: string | null
  /** 责任单位组织 ID（2026-11-18 滞后清单扩全量后含职能部门，语义由「责任学院」放宽为「责任单位」） */
  orgId: number
  /** 责任单位名称（学院或职能部门） */
  orgName: string
  /** 来源职能部门名称（可能为空） */
  ownerOrgName: string | null
  /** 自评等级 AHEAD/NORMAL/DELAYED（可能为空） */
  selfRating: string | null
  /** 上级鉴定等级 AHEAD/NORMAL/DELAYED（可能为空） */
  appraisalLevel: string | null
}

/** GET /api/v1/dashboard/delayed-indicators?year=&month= 响应 */
export interface DashboardDelayedIndicatorsResponse {
  year: number
  month: number
  /** 滞后指标明细（按学院名+指标ID排序，指标ID去重） */
  items: DashboardDelayedIndicatorItem[]
}

// ============================================================================
// 审核鉴定口径的部门分布（2026-11-18 数据看板分布图口径修复）
// 后端 GET /api/v1/dashboard/appraisal-summary 一次返回部门分布 + 月度快照 + 年度简报。
// 口径：每个指标取不晚于选中月份的最近一次 plan_report_indicator.appraisal_level，
//      当月未上报的部门沿用上次结论（不会因为某月没提交就把整图清零）。
// ============================================================================

/** 单个职能部门的鉴定等级计数 */
export interface DashboardDepartmentLevelStat {
  /** 部门组织 ID */
  orgId: number
  /** 部门名称 */
  orgName: string
  /** 超前完成数 */
  ahead: number
  /** 正常数 */
  normal: number
  /** 滞后数（上级鉴定 DELAYED） */
  delayed: number
  /** 总计（ahead + normal + delayed） */
  total: number
  /** 未填报标记：false=该部门当月未填报（灰柱督办）；缺省视为已填报 */
  reported?: boolean
  /** 该部门该月的快照状态（按月快照口径；缺省按 reported 兜底） */
  monthState?: DashboardMonthState
  /** 该部门当年已下发指标数（非 APPROVED 月份灰柱高度数据源；缺省灰柱不出高度） */
  dispatchedCount?: number
}

/** 部门等级月度快照（下钻趋势用） */
export interface DashboardDepartmentLevelMonth {
  /** 月份（1-12） */
  month: number
  /** 该月全校快照状态（按月快照口径；缺省按 departments 行内 reported 兜底） */
  monthState?: DashboardMonthState
  /** 该月截止口径下的部门分布 */
  departments: DashboardDepartmentLevelStat[]
}

/** GET /api/v1/dashboard/appraisal-summary?year=&month= 响应 */
export interface DashboardAppraisalSummaryResponse {
  year: number
  month: number
  /** 该年度最近一个有鉴定数据的月份（0 表示该年度无鉴定数据） */
  latestMonth: number
  /** 选中月份的全校快照状态（按月快照口径；缺省按 departments 行内 reported 兜底） */
  monthState?: DashboardMonthState
  /** 选中月份的部门分布（按月快照口径，只有 APPROVED 月份出鉴定值） */
  departments: DashboardDepartmentLevelStat[]
  /** 1..选中月份的月度快照 */
  departmentMonths: DashboardDepartmentLevelMonth[]
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
   * months 固定 1-12 月全量；未填报学院 reported=false 由前端画灰柱
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
   * 滞后任务清单（按年月）
   * GET /api/v1/dashboard/delayed-indicators?year=&month=
   * 只算已提交/已审批月报、等级 appraisal_level 优先 self_rating 兜底的 DELAYED 明细；
   * 看板「滞后任务响应清单」卡片专用数据源（旧 progress<50 判定已死：等级制后恒 0）
   */
  async getDelayedIndicators(params: {
    year: number
    month: number
  }): Promise<DashboardDelayedIndicatorsResponse> {
    try {
      logger.debug('[dashboardApi] Fetching delayed indicators:', params)
      const payload = await apiClient.get<unknown>('/dashboard/delayed-indicators', {
        year: params.year,
        month: params.month
      })
      const data = unwrapDashboardPayload<DashboardDelayedIndicatorsResponse>(payload)
      if (!data || !Array.isArray(data.items)) {
        throw new Error('滞后任务清单接口返回格式异常')
      }
      return data
    } catch (error) {
      logger.error('[dashboardApi] Failed to fetch delayed indicators:', error)
      throw error
    }
  },

  /**
   * 审核鉴定口径的部门分布（职能部门堆叠图 / 下钻月度趋势）
   * GET /api/v1/dashboard/appraisal-summary?year=&month=
   * 2026-11-18：替换原前端启发式（getDeptStatsAtMonth），解决分布图不随审核鉴定变化、
   * 且各月份图形完全一样（原判定根本没用到 month）的问题。
   */
  async getAppraisalSummary(params: {
    year: number
    month: number
  }): Promise<DashboardAppraisalSummaryResponse> {
    try {
      logger.debug('[dashboardApi] Fetching appraisal summary:', params)
      const payload = await apiClient.get<unknown>('/dashboard/appraisal-summary', {
        year: params.year,
        month: params.month
      })
      const data = unwrapDashboardPayload<DashboardAppraisalSummaryResponse>(payload)
      if (!data || !Array.isArray(data.departments) || !Array.isArray(data.departmentMonths)) {
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
