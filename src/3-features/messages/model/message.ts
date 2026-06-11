import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Message, MessageBizType } from '@/shared/types'
import {
  invalidateMessageCaches,
  messagesApi,
  type MessageCenterSummary,
  type MessageItem
} from '@/features/messages/api/messagesApi'
import { getWorkflowInstanceDetail } from '@/features/workflow/api'
import type { WorkflowInstanceDetailResponse } from '@/features/workflow/api'

function createEmptySummary(): MessageCenterSummary {
  return {
    totalCount: 0,
    todoCount: 0,
    approvalCount: 0,
    reminderCount: 0,
    systemCount: 0,
    riskCount: 0,
    capabilities: {
      riskEnabled: false,
      approvalAggregationEnabled: true,
      detailDrawerEnabled: true
    },
    partialSuccess: false,
    unavailableSources: []
  }
}

function isApprovalBizType(bizType?: MessageBizType): boolean {
  return bizType === 'APPROVAL_TODO' || bizType === 'APPROVAL_RESULT'
}

function parseMessageMetadataJson(message: Message): Record<string, unknown> {
  const metadataJson = message.metadata?.metadataJson
  if (typeof metadataJson !== 'string' || !metadataJson.trim()) {
    return {}
  }

  try {
    const parsed = JSON.parse(metadataJson) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function resolveMessageApprovalInstanceId(message: Message): string {
  if (message.approvalInstanceId) {
    return String(message.approvalInstanceId)
  }

  const nestedMetadata = parseMessageMetadataJson(message)
  const metadataInstanceId =
    nestedMetadata.approvalInstanceId ?? message.metadata?.approvalInstanceId
  const normalizedInstanceId = String(metadataInstanceId || '').trim()
  return /^\d+$/.test(normalizedInstanceId) ? normalizedInstanceId : ''
}

const workflowDetailCache = new Map<string, WorkflowInstanceDetailResponse | null>()

export const useMessageStore = defineStore('message-center', () => {
  const rawMessages = ref<Message[]>([])
  const hiddenReadMessageIds = ref<Set<string>>(new Set())
  const summary = ref<MessageCenterSummary>(createEmptySummary())
  const listLoading = ref(false)
  const summaryLoading = ref(false)
  const detailLoading = ref(false)
  const error = ref<string | null>(null)

  const loading = computed(() => listLoading.value || summaryLoading.value)
  const capabilities = computed(() => summary.value.capabilities)
  const messages = computed(() =>
    rawMessages.value.filter(message => !hiddenReadMessageIds.value.has(message.id))
  )
  const visibleMessages = computed(() => messages.value)
  const todoMessages = computed(() => messages.value.filter(message => isActionRequired(message)))
  const reminderMessages = computed(() =>
    messages.value.filter(message => message.bizType === 'REMINDER_NOTICE')
  )
  const alertMessages = computed(() =>
    messages.value.filter(message => message.category === 'RISK')
  )
  const approvalMessages = computed(() =>
    messages.value.filter(message => isApprovalBizType(message.bizType))
  )
  const systemMessages = computed(() =>
    messages.value.filter(
      message => message.bizType === 'SYSTEM_NOTICE' || message.bizType === 'BUSINESS_NOTICE'
    )
  )
  const hasUnreadMarkableMessages = computed(() =>
    rawMessages.value.some(message => canMarkMessageAsRead(message) && !message.isRead)
  )
  const hasReadMarkableMessages = computed(() =>
    rawMessages.value.some(message => canMarkMessageAsRead(message) && message.isRead)
  )
  const totalCount = computed(() => summary.value.totalCount)

  const unreadCount = computed(() => {
    const reminderCount = rawMessages.value.filter(
      message => message.bizType === 'REMINDER_NOTICE' && !message.isRead
    ).length
    const alertCount = rawMessages.value.filter(
      message => message.category === 'RISK' && !message.isRead
    ).length
    const systemCount = rawMessages.value.filter(
      message =>
        (message.bizType === 'SYSTEM_NOTICE' || message.bizType === 'BUSINESS_NOTICE') &&
        !message.isRead
    ).length
    const todoCount = rawMessages.value.filter(message => isActionRequired(message)).length
    const approvalCount = rawMessages.value.filter(message =>
      message.bizType === 'APPROVAL_RESULT' ? !message.isRead : message.bizType === 'APPROVAL_TODO'
    ).length

    return {
      all:
        todoCount +
        reminderCount +
        alertCount +
        systemCount +
        rawMessages.value.filter(
          message => message.bizType === 'APPROVAL_RESULT' && !message.isRead
        ).length,
      todo: todoCount,
      reminders: reminderCount,
      alerts: alertCount,
      approvals: approvalCount,
      system: systemCount
    }
  })

  function isActionRequired(message?: Pick<Message, 'bizType' | 'actionState'> | null): boolean {
    return message?.bizType === 'APPROVAL_TODO' || message?.actionState === 'ACTION_REQUIRED'
  }

  function canMarkMessageAsRead(message?: Message | null): boolean {
    return Boolean(message?.canMarkAsRead) && !isActionRequired(message)
  }

  function normalizeSeverity(severity?: string | null): Message['severity'] {
    const normalized = String(severity || '')
      .trim()
      .toUpperCase()
    switch (normalized) {
      case 'P1':
      case 'HIGH':
      case 'CRITICAL':
      case 'MAJOR':
        return 'severe'
      case 'P2':
      case 'MEDIUM':
      case 'MODERATE':
      case 'MINOR':
        return 'moderate'
      case 'P3':
      case 'LOW':
      default:
        return normalized ? 'normal' : undefined
    }
  }

  function mapMessageType(message: MessageItem): Message['type'] {
    if (message.category === 'RISK') {
      return 'alert'
    }
    if (message.bizType === 'REMINDER_NOTICE') {
      return 'reminder'
    }
    if (isApprovalBizType(message.bizType)) {
      return 'approval'
    }
    return 'system'
  }

  function toStoreMessage(message: MessageItem): Message {
    const isRead = message.bizType === 'APPROVAL_TODO' ? false : message.readState === 'READ'
    return {
      id: message.messageId,
      messageId: message.messageId,
      type: mapMessageType(message),
      title: message.title,
      content: message.summary || message.content,
      detailContent: message.content,
      severity: normalizeSeverity(message.severity || message.priority),
      isRead,
      createdAt: new Date(message.createdAt),
      actionUrl: message.actionUrl || undefined,
      entityType: message.entityType || undefined,
      entityId:
        message.entityId !== null && message.entityId !== undefined
          ? String(message.entityId)
          : undefined,
      approvalInstanceId: message.approvalInstanceId ?? undefined,
      status: message.actionState || message.readState || undefined,
      category: message.category,
      bizType: message.bizType,
      readState: message.readState || undefined,
      actionState: message.actionState || undefined,
      canMarkAsRead: message.canMarkAsRead,
      canViewDetail: message.canViewDetail,
      canProcess: message.canProcess,
      senderDisplay: message.senderDisplay || undefined,
      currentStepName: message.currentStepName || undefined,
      currentAssigneeDisplay: message.currentAssigneeDisplay || undefined,
      metadata: message.metadata ?? undefined,
      syntheticSource: message.sourceType === 'workflow' ? 'pending_approval' : 'notification'
    }
  }

  async function loadWorkflowDetailForMessage(
    message: Message
  ): Promise<WorkflowInstanceDetailResponse | null> {
    const instanceId = resolveMessageApprovalInstanceId(message)
    if (!instanceId) {
      return null
    }

    if (workflowDetailCache.has(instanceId)) {
      return workflowDetailCache.get(instanceId) ?? null
    }

    try {
      const response = await getWorkflowInstanceDetail(instanceId)
      const detail = response.success && response.data ? response.data : null
      workflowDetailCache.set(instanceId, detail)
      return detail
    } catch {
      workflowDetailCache.set(instanceId, null)
      return null
    }
  }

  function applyWorkflowDetailToMessage(
    message: Message,
    detail: WorkflowInstanceDetailResponse | null
  ): Message {
    if (!detail) {
      return message
    }

    const hasMessageStepName = Boolean(
      message.currentStepName ||
      message.metadata?.currentStepName ||
      parseMessageMetadataJson(message).stepName
    )
    const nextMetadata = {
      ...(message.metadata ?? {}),
      ...(detail.flowCode ? { flowCode: detail.flowCode } : {}),
      ...(detail.flowName ? { flowName: detail.flowName } : {}),
      ...(detail.sourceOrgName ? { sourceOrgName: detail.sourceOrgName } : {}),
      ...(detail.targetOrgName ? { targetOrgName: detail.targetOrgName } : {}),
      ...(detail.planName ? { planName: detail.planName } : {}),
      ...(!hasMessageStepName && detail.currentStepName
        ? { currentStepName: detail.currentStepName }
        : {})
    }

    return {
      ...message,
      currentStepName:
        message.currentStepName || (!hasMessageStepName ? detail.currentStepName : undefined),
      metadata: nextMetadata
    }
  }

  async function enrichApprovalMessages(messages: Message[]): Promise<Message[]> {
    return Promise.all(
      messages.map(async message => {
        if (!isApprovalBizType(message.bizType)) {
          return message
        }

        const detail = await loadWorkflowDetailForMessage(message)
        return applyWorkflowDetailToMessage(message, detail)
      })
    )
  }

  function recomputeSummaryFromMessages(): void {
    const todoCount = rawMessages.value.filter(message => isActionRequired(message)).length
    const approvalResultUnread = rawMessages.value.filter(
      message => message.bizType === 'APPROVAL_RESULT' && !message.isRead
    ).length
    const reminderCount = rawMessages.value.filter(
      message => message.bizType === 'REMINDER_NOTICE' && !message.isRead
    ).length
    const systemCount = rawMessages.value.filter(
      message =>
        (message.bizType === 'SYSTEM_NOTICE' || message.bizType === 'BUSINESS_NOTICE') &&
        !message.isRead
    ).length
    const riskCount = rawMessages.value.filter(
      message => message.category === 'RISK' && !message.isRead
    ).length

    summary.value = {
      ...summary.value,
      totalCount: todoCount + approvalResultUnread + reminderCount + systemCount + riskCount,
      todoCount,
      approvalCount: todoCount + approvalResultUnread,
      reminderCount,
      systemCount,
      riskCount
    }
  }

  function cleanupHiddenReadMessages(): void {
    hiddenReadMessageIds.value = new Set(
      [...hiddenReadMessageIds.value].filter(messageId => {
        const message = rawMessages.value.find(item => item.id === messageId)
        return Boolean(message && canMarkMessageAsRead(message) && message.isRead)
      })
    )
  }

  async function fetchSummary() {
    summaryLoading.value = true
    try {
      summary.value = await messagesApi.getSummary()
      error.value = null
      return summary.value
    } catch (err) {
      error.value = err instanceof Error ? err.message : '消息摘要加载失败'
      summary.value = createEmptySummary()
      throw err
    } finally {
      summaryLoading.value = false
    }
  }

  async function fetchMessages() {
    listLoading.value = true
    try {
      const remoteMessages = await messagesApi.getAllMessages()
      rawMessages.value = await enrichApprovalMessages(remoteMessages.map(toStoreMessage))
      cleanupHiddenReadMessages()
      recomputeSummaryFromMessages()
      error.value = null
      return rawMessages.value
    } catch (err) {
      rawMessages.value = []
      cleanupHiddenReadMessages()
      error.value = err instanceof Error ? err.message : '消息列表加载失败'
      throw err
    } finally {
      listLoading.value = false
    }
  }

  async function refreshMessageCenter() {
    invalidateMessageCaches()
    const results = await Promise.allSettled([fetchSummary(), fetchMessages()])
    const rejected = results.filter(result => result.status === 'rejected')
    if (rejected.length === results.length) {
      throw new Error(error.value || '消息中心加载失败')
    }
  }

  function initializeMessages() {
    if (!rawMessages.value.length) {
      void refreshMessageCenter()
    }
  }

  async function fetchMessageDetail(messageId: string) {
    detailLoading.value = true
    try {
      const detail = await messagesApi.getMessageDetail(messageId)
      const enriched = await enrichApprovalMessages([toStoreMessage(detail)])
      const target = enriched[0] || toStoreMessage(detail)
      const targetIndex = rawMessages.value.findIndex(item => item.id === target.id)
      if (targetIndex === -1) {
        rawMessages.value = [target, ...rawMessages.value]
      } else {
        rawMessages.value.splice(targetIndex, 1, target)
      }
      cleanupHiddenReadMessages()
      return target
    } finally {
      detailLoading.value = false
    }
  }

  async function markAsRead(messageId: string) {
    const message = rawMessages.value.find(item => item.id === messageId)
    if (!message || !canMarkMessageAsRead(message) || message.isRead) {
      return
    }

    const previousReadState = message.isRead
    message.isRead = true
    message.readState = 'READ'
    recomputeSummaryFromMessages()
    cleanupHiddenReadMessages()

    try {
      await messagesApi.markAsRead(messageId)
    } catch (err) {
      message.isRead = previousReadState
      message.readState = previousReadState ? 'READ' : 'UNREAD'
      recomputeSummaryFromMessages()
      cleanupHiddenReadMessages()
      throw err
    }
  }

  async function markAllAsRead() {
    const targets = rawMessages.value.filter(
      message => canMarkMessageAsRead(message) && !message.isRead
    )
    if (!targets.length) {
      return
    }

    const previousStates = targets.map(message => ({
      id: message.id,
      isRead: message.isRead,
      readState: message.readState
    }))

    targets.forEach(message => {
      message.isRead = true
      message.readState = 'READ'
    })
    recomputeSummaryFromMessages()
    cleanupHiddenReadMessages()

    try {
      await messagesApi.markAllAsRead()
    } catch (err) {
      previousStates.forEach(previous => {
        const target = rawMessages.value.find(message => message.id === previous.id)
        if (target) {
          target.isRead = previous.isRead
          target.readState = previous.readState
        }
      })
      recomputeSummaryFromMessages()
      cleanupHiddenReadMessages()
      throw err
    }
  }

  function clearReadMessages() {
    const nextHiddenIds = new Set(hiddenReadMessageIds.value)
    rawMessages.value.forEach(message => {
      if (canMarkMessageAsRead(message) && message.isRead) {
        nextHiddenIds.add(message.id)
      }
    })
    hiddenReadMessageIds.value = nextHiddenIds
  }

  function deleteMessage(messageId: string) {
    rawMessages.value = rawMessages.value.filter(message => message.id !== messageId)
    if (hiddenReadMessageIds.value.has(messageId)) {
      const nextHiddenIds = new Set(hiddenReadMessageIds.value)
      nextHiddenIds.delete(messageId)
      hiddenReadMessageIds.value = nextHiddenIds
    }
    recomputeSummaryFromMessages()
  }

  return {
    summary,
    capabilities,
    error,
    loading,
    summaryLoading,
    detailLoading,
    totalCount,
    messages,
    visibleMessages,
    todoMessages,
    reminderMessages,
    alertMessages,
    approvalMessages,
    systemMessages,
    unreadCount,
    hasUnreadMarkableMessages,
    hasReadMarkableMessages,
    fetchSummary,
    fetchMessages,
    refreshMessageCenter,
    initializeMessages,
    fetchMessageDetail,
    markAsRead,
    markAllAsRead,
    clearReadMessages,
    deleteMessage
  }
})
