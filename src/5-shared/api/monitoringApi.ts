/**
 * 预警告警 API
 * 用于 Dashboard 和消息中心的预警统计
 *
 * 当前 OpenAPI 只稳定暴露 alerts 相关接口。
 * warnings 和细粒度 process/acknowledge 能力在前端走兼容降级。
 */

import { apiClient } from '@/shared/api/client'
import { logger } from '@/shared/lib/utils/logger'

/**
 * 预警事件
 */
export interface WarningEvent {
  id: number
  ruleId: number
  ruleName: string
  entityType: string
  entityId: number
  entityName?: string
  message: string
  status: 'ACTIVE' | 'ACKNOWLEDGED'
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  triggeredAt: string
}

/**
 * 告警事件
 */
export interface AlertEvent {
  id: number
  indicatorId?: number
  ruleId: number
  ruleName: string
  entityType: string
  entityId: number
  entityName?: string
  severity: 'CRITICAL' | 'WARNING' | 'INFO' | 'MAJOR' | 'MINOR'
  message: string
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
  triggeredAt: string
  assigneeId?: number
  assigneeName?: string
}

/**
 * 告警统计数据
 */
export interface AlertStats {
  totalOpen: number
  countBySeverity: {
    CRITICAL: number
    WARNING: number
    INFO: number
    MAJOR?: number
    MINOR?: number
  }
}

export type ManualAlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL' | null

type ApiEnvelope<T> = {
  code?: number
  message?: string
  data?: T
  success?: boolean
}

type SilentHttpResponse<T> = {
  status: number
  data?: ApiEnvelope<T> | T
}

const EMPTY_ALERT_STATS: AlertStats = {
  totalOpen: 0,
  countBySeverity: {
    CRITICAL: 0,
    WARNING: 0,
    INFO: 0
  }
}

const ALERTS_API_UNAVAILABLE_KEY = 'sism_alerts_api_unavailable'

function readAlertsApiUnavailable(): boolean {
  if (typeof sessionStorage === 'undefined') {
    return false
  }

  return sessionStorage.getItem(ALERTS_API_UNAVAILABLE_KEY) === '1'
}

function markAlertsApiUnavailable(): void {
  alertsApiUnavailable = true
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(ALERTS_API_UNAVAILABLE_KEY, '1')
  }
}

let alertsApiUnavailable = readAlertsApiUnavailable()

function unwrapMockResponse<T>(response: T | ApiEnvelope<T>): T {
  if (response && typeof response === 'object' && 'data' in response) {
    return (response as ApiEnvelope<T>).data as T
  }

  return response as T
}

async function silentGet<T>(path: string): Promise<SilentHttpResponse<T>> {
  const response = await apiClient.getAxiosInstance().get<ApiEnvelope<T> | T>(path, {
    validateStatus: () => true,
    _skipBusinessErrorThrow: true
  })

  return {
    status: response.status,
    data: response.data
  }
}

async function requestUnclosedAlerts(path: string): Promise<AlertEvent[] | null> {
  const response = await silentGet<AlertEvent[]>(path)
  const payload = response.data as ApiEnvelope<AlertEvent[]> | AlertEvent[] | undefined
  if (
    response.status === 404 ||
    (payload && typeof payload === 'object' && 'success' in payload && payload.success === false)
  ) {
    return null
  }

  return unwrapMockResponse(payload as ApiEnvelope<AlertEvent[]> | AlertEvent[])
}

/**
 * 预警告警 API
 */
export const alertApi = {
  async getManualAlertLevels(indicatorIds: number[]): Promise<Record<string, ManualAlertSeverity>> {
    const ids = [...new Set(indicatorIds.filter(id => Number.isFinite(id) && id > 0))]
    if (ids.length === 0) {
      return {}
    }

    const response = await apiClient.get<
      ApiEnvelope<Record<string, string>> | Record<string, string>
    >(`/alerts/manual-levels?indicatorIds=${ids.join(',')}`)
    const payload = unwrapMockResponse(
      response as ApiEnvelope<Record<string, string>> | Record<string, string>
    )

    return Object.fromEntries(
      Object.entries(payload || {}).map(([indicatorId, severity]) => {
        const normalized = String(severity || '').toUpperCase()
        return [
          indicatorId,
          normalized === 'INFO' || normalized === 'WARNING' || normalized === 'CRITICAL'
            ? (normalized as Exclude<ManualAlertSeverity, null>)
            : null
        ]
      })
    )
  },

  async setManualAlertLevel(
    indicatorId: number | string,
    severity: ManualAlertSeverity
  ): Promise<void> {
    await apiClient.put(`/alerts/indicator/${indicatorId}/manual-level`, {
      severity: severity ?? 'NONE'
    })
  },

  /**
   * 获取告警统计
   * 使用 OpenAPI 告警统计接口
   */
  getStats: async () => {
    if (alertsApiUnavailable) {
      return EMPTY_ALERT_STATS
    }

    const response = await silentGet<AlertStats>('/alerts/stats')
    const payload = response.data as ApiEnvelope<AlertStats> | AlertStats | undefined
    if (
      response.status === 404 ||
      (payload && typeof payload === 'object' && 'success' in payload && payload.success === false)
    ) {
      markAlertsApiUnavailable()
      logger.warn('[alertApi] alerts stats endpoint unavailable, degrade to empty stats')
      return EMPTY_ALERT_STATS
    }

    return unwrapMockResponse(payload as ApiEnvelope<AlertStats> | AlertStats)
  },

  /**
   * 获取未关闭的告警事件
   * 兼容 `/alerts/events/unclosed` 与 `/alerts/unresolved`
   */
  getUnclosedAlerts: async () => {
    if (alertsApiUnavailable) {
      return []
    }

    const preferred = await requestUnclosedAlerts('/alerts/events/unclosed')
    if (preferred !== null) {
      return preferred
    }

    logger.warn('[alertApi] /alerts/events/unclosed returned 404, fallback to /alerts/unresolved')
    const fallback = await requestUnclosedAlerts('/alerts/unresolved')
    if (fallback !== null) {
      return fallback
    }

    markAlertsApiUnavailable()
    logger.warn('[alertApi] alerts query endpoints unavailable, degrade to empty alerts list')
    return []
  },

  /**
   * 获取活跃的预警事件
   * 当前 OpenAPI 无预警事件列表，降级为空结果
   */
  getActiveWarnings: async (params?: {
    indicatorId?: number
    orgId?: number
    page?: number
    size?: number
  }) => {
    void params
    return {
      content: [] as WarningEvent[],
      total: 0
    }
  },

  /**
   * 确认预警
   * 当前 OpenAPI 无预警确认接口
   */
  acknowledgeWarning: async (id: number) => {
    void id
    throw new Error('当前 OpenAPI 未提供预警确认接口')
  },

  /**
   * 处理告警
   * 复用通知 handle/status 能力近似表达告警处理
   */
  processAlert: async (
    id: number,
    data: {
      assigneeId?: number
      status: string
      actionLog: string
    }
  ) => {
    const handledByUserId = data.assigneeId ?? 0
    const handleParams = new URLSearchParams({
      handledByUserId: String(handledByUserId)
    })
    if (data.actionLog) {
      handleParams.set('handledNote', data.actionLog)
    }
    await apiClient.post(`/notifications/${id}/handle?${handleParams.toString()}`)
    await apiClient.patch(
      `/notifications/${id}/status?newStatus=${encodeURIComponent(data.status)}`
    )

    return {
      id,
      ruleId: 0,
      ruleName: 'Alert',
      entityType: 'NOTIFICATION',
      entityId: id,
      severity: 'MINOR' as const,
      message: data.actionLog,
      status: (data.status || 'IN_PROGRESS') as AlertEvent['status'],
      triggeredAt: new Date().toISOString(),
      assigneeId: data.assigneeId
    }
  }
}

export default alertApi
