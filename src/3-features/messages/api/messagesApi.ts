import { apiClient } from '@/shared/api/client'
import { buildQueryKey, fetchWithCache, invalidateQueries } from '@/shared/lib/utils/cache'
import { CACHE_TTL, createShortMemoryPolicy } from '@/shared/lib/utils/cache-config'
import { getCachedUserContext } from '@/shared/lib/utils/cacheContext'

export type MessageCategory = 'ALL' | 'TODO' | 'APPROVAL' | 'REMINDER' | 'SYSTEM' | 'RISK'
export type MessageBizType =
  | 'APPROVAL_TODO'
  | 'APPROVAL_RESULT'
  | 'REMINDER_NOTICE'
  | 'SYSTEM_NOTICE'
  | 'BUSINESS_NOTICE'
  | 'RISK_WARNING'
  | 'RISK_ALERT'

export interface MessageCenterCapabilities {
  riskEnabled: boolean
  approvalAggregationEnabled: boolean
  detailDrawerEnabled: boolean
}

export interface MessageCenterSummary {
  totalCount: number
  todoCount: number
  approvalCount: number
  reminderCount: number
  systemCount: number
  riskCount: number
  capabilities: MessageCenterCapabilities
  lastRefreshTime?: string
  partialSuccess?: boolean
  unavailableSources?: string[]
}

export interface MessageItem {
  messageId: string
  sourceType: 'notification' | 'workflow' | 'risk'
  sourceId: string
  category: MessageCategory
  bizType: MessageBizType
  title: string
  summary: string
  content: string
  priority?: string | null
  severity?: string | null
  readState?: 'UNREAD' | 'READ' | null
  actionState?: 'ACTION_REQUIRED' | 'DONE' | null
  createdAt: string
  eventAt?: string | null
  actionUrl?: string | null
  entityType?: string | null
  entityId?: number | null
  approvalInstanceId?: number | null
  currentStepName?: string | null
  currentAssigneeDisplay?: string | null
  senderDisplay?: string | null
  canMarkAsRead: boolean
  canViewDetail: boolean
  canProcess: boolean
  metadata?: Record<string, unknown> | null
}

export interface MessageListPayload {
  items: MessageItem[]
  total: number
  pageNum: number
  pageSize: number
  totalPages: number
  partialSuccess?: boolean
  unavailableSources?: string[]
  capabilities: MessageCenterCapabilities
}

interface ApiEnvelope<T> {
  success: boolean
  code: number
  message: string
  data: T
}

const SUMMARY_POLICY = createShortMemoryPolicy(CACHE_TTL.MESSAGE_UNREAD, {
  staleWhileRevalidate: false,
  tags: ['messages.summary', 'messages.unread']
})

const MESSAGE_LIST_POLICY = createShortMemoryPolicy(CACHE_TTL.MESSAGE_LIST, {
  staleWhileRevalidate: false,
  tags: ['messages.list']
})

function withMessageContext(params?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...getCachedUserContext(),
    ...(params ?? {}),
    version: 'v2'
  }
}

export function invalidateMessageCaches(): void {
  invalidateQueries(['messages.summary', 'messages.unread', 'messages.list'])
}

function emptyCapabilities(): MessageCenterCapabilities {
  return {
    riskEnabled: false,
    approvalAggregationEnabled: true,
    detailDrawerEnabled: true
  }
}

function emptySummary(): MessageCenterSummary {
  return {
    totalCount: 0,
    todoCount: 0,
    approvalCount: 0,
    reminderCount: 0,
    systemCount: 0,
    riskCount: 0,
    capabilities: emptyCapabilities(),
    partialSuccess: false,
    unavailableSources: []
  }
}

function normalizeSummary(
  payload: ApiEnvelope<MessageCenterSummary> | MessageCenterSummary
): MessageCenterSummary {
  const summary =
    (payload as ApiEnvelope<MessageCenterSummary>)?.data ?? (payload as MessageCenterSummary)
  if (!summary || typeof summary !== 'object') {
    return emptySummary()
  }

  return {
    ...emptySummary(),
    ...summary,
    capabilities: {
      ...emptyCapabilities(),
      ...(summary.capabilities ?? {})
    },
    unavailableSources: Array.isArray(summary.unavailableSources) ? summary.unavailableSources : []
  }
}

function normalizeListPayload(
  payload: ApiEnvelope<MessageListPayload> | MessageListPayload
): MessageListPayload {
  const normalized =
    (payload as ApiEnvelope<MessageListPayload>)?.data ?? (payload as MessageListPayload)
  if (!normalized || typeof normalized !== 'object') {
    return {
      items: [],
      total: 0,
      pageNum: 1,
      pageSize: 100,
      totalPages: 0,
      capabilities: emptyCapabilities(),
      partialSuccess: false,
      unavailableSources: []
    }
  }

  return {
    items: Array.isArray(normalized.items) ? normalized.items : [],
    total: Number(normalized.total ?? 0),
    pageNum: Number(normalized.pageNum ?? 1),
    pageSize: Number(normalized.pageSize ?? 100),
    totalPages: Number(normalized.totalPages ?? 0),
    partialSuccess: Boolean(normalized.partialSuccess),
    unavailableSources: Array.isArray(normalized.unavailableSources)
      ? normalized.unavailableSources
      : [],
    capabilities: {
      ...emptyCapabilities(),
      ...(normalized.capabilities ?? {})
    }
  }
}

export const messagesApi = {
  async getSummary(): Promise<MessageCenterSummary> {
    return fetchWithCache({
      key: buildQueryKey('messages', 'summary', withMessageContext()),
      policy: SUMMARY_POLICY,
      fetcher: async () => {
        const response =
          await apiClient.get<ApiEnvelope<MessageCenterSummary>>('/message-center/summary')
        return normalizeSummary(response)
      }
    })
  },

  async getAllMessages(category: MessageCategory = 'ALL'): Promise<MessageItem[]> {
    return fetchWithCache({
      key: buildQueryKey('messages', 'list', withMessageContext({ category })),
      policy: MESSAGE_LIST_POLICY,
      fetcher: async () => {
        const response = await apiClient.get<ApiEnvelope<MessageListPayload>>(
          '/message-center/messages',
          {
            category,
            page: 1,
            size: 100,
            includeRisk: true
          }
        )
        return normalizeListPayload(response).items
      }
    })
  },

  async getMessageDetail(messageId: string): Promise<MessageItem> {
    const response = await apiClient.get<ApiEnvelope<MessageItem>>(
      `/message-center/messages/${encodeURIComponent(messageId)}`
    )
    return (response as ApiEnvelope<MessageItem>).data
  },

  async markAsRead(messageId: string) {
    const result = await apiClient.post<ApiEnvelope<unknown>>(
      `/message-center/messages/${encodeURIComponent(messageId)}/read`
    )
    invalidateMessageCaches()
    return result
  },

  async markAllAsRead() {
    const result = await apiClient.post<ApiEnvelope<unknown>>('/message-center/messages/read-all')
    invalidateMessageCaches()
    return result
  },

  async getUnreadCount(): Promise<number> {
    const summary = await this.getSummary()
    return summary.totalCount
  }
}
