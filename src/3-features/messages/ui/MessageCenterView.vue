<template>
  <div class="message-center">
    <div class="page-header">
      <div class="header-content">
        <h1 class="page-title">消息中心</h1>
        <p class="page-desc">查看和管理与您相关的待处理事项和通知消息</p>
      </div>
      <div class="page-actions">
        <el-button :loading="messageStore.loading" @click="refreshData"> 刷新 </el-button>
        <el-button
          type="primary"
          plain
          :disabled="!messageStore.hasUnreadMarkableMessages"
          @click="markAllAsRead"
        >
          全部标为已读
        </el-button>
        <el-button :disabled="!messageStore.hasReadMarkableMessages" @click="clearReadMessages">
          清除已读
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="messageStore.error"
      type="error"
      show-icon
      :closable="false"
      class="message-error"
      :title="messageStore.error"
      description="消息中心未再使用 mock 数据兜底，你可以点击刷新重新加载真实数据。"
    />

    <div class="summary-grid">
      <el-card v-for="card in summaryCards" :key="card.key" shadow="never" class="summary-card">
        <div class="summary-label">{{ card.label }}</div>
        <div class="summary-value">{{ card.value }}</div>
        <div class="summary-hint">{{ card.hint }}</div>
      </el-card>
    </div>

    <el-card class="message-card" shadow="never">
      <el-tabs v-model="activeTab" class="message-tabs">
        <el-tab-pane name="all">
          <template #label>
            <span class="tab-label">
              全部消息
              <el-badge
                v-if="unreadCount.all > 0"
                :value="unreadCount.all"
                :max="99"
                class="tab-badge"
              />
            </span>
          </template>
          <div v-if="activeTab === 'all'" class="message-panel">
            <div class="message-subfilters">
              <el-segmented v-model="activeTypeFilter" :options="typeFilterOptions" />
            </div>
            <MessageList
              :messages="filteredMessages"
              :empty-description="getEmptyDescription()"
              @read="handleMessageRead"
              @view="handleMessageView"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane name="todo">
          <template #label>
            <span class="tab-label">
              待处理
              <el-badge
                v-if="unreadCount.todo > 0"
                :value="unreadCount.todo"
                :max="99"
                class="tab-badge"
                type="warning"
              />
            </span>
          </template>
          <div v-if="activeTab === 'todo'" class="message-panel">
            <div class="message-subfilters">
              <el-segmented v-model="activeTypeFilter" :options="typeFilterOptions" />
            </div>
            <MessageList
              :messages="filteredMessages"
              :empty-description="getEmptyDescription()"
              @read="handleMessageRead"
              @view="handleMessageView"
            />
          </div>
        </el-tab-pane>

        <el-tab-pane name="processed">
          <template #label>
            <span class="tab-label">
              已处理
              <el-badge
                v-if="unreadProcessedCount > 0"
                :value="unreadProcessedCount"
                :max="99"
                class="tab-badge"
                type="success"
              />
            </span>
          </template>
          <div v-if="activeTab === 'processed'" class="message-panel">
            <div class="message-subfilters">
              <el-segmented v-model="activeTypeFilter" :options="typeFilterOptions" />
            </div>
            <div class="message-subfilters">
              <el-segmented v-model="processedFilter" :options="processedFilterOptions" />
            </div>
            <MessageList
              :messages="filteredMessages"
              :empty-description="getEmptyDescription()"
              @read="handleMessageRead"
              @view="handleMessageView"
            />
          </div>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-drawer v-model="detailVisible" title="消息详情" size="480px" destroy-on-close>
      <div v-if="detailMessage" class="detail-content">
        <div class="detail-tags">
          <el-tag size="small">{{ detailMessage.title }}</el-tag>
          <el-tag
            v-if="detailMessage.senderDisplay && !isApprovalMessage(detailMessage)"
            type="info"
            size="small"
          >
            {{ detailMessage.senderDisplay }}
          </el-tag>
          <el-tag
            v-if="isApprovalMessage(detailMessage) && getApprovalCurrentStepDisplay(detailMessage)"
            type="warning"
            size="small"
          >
            当前环节：{{ getApprovalCurrentStepDisplay(detailMessage) }}
          </el-tag>
          <el-tag
            v-if="isApprovalMessage(detailMessage) && getApprovalDepartmentDisplay(detailMessage)"
            type="success"
            size="small"
          >
            审批中部门：{{ getApprovalDepartmentDisplay(detailMessage) }}
          </el-tag>
          <el-tag
            v-if="isApprovalMessage(detailMessage) && getApprovalRouteDisplay(detailMessage)"
            type="primary"
            size="small"
          >
            审批流向：{{ getApprovalRouteDisplay(detailMessage) }}
          </el-tag>
          <el-tag
            v-if="!isApprovalMessage(detailMessage) && detailMessage.currentStepName"
            type="warning"
            size="small"
          >
            {{ detailMessage.currentStepName }}
          </el-tag>
        </div>
        <div class="detail-time">{{ formatDateTime(detailMessage.createdAt) }}</div>
        <div class="detail-body">{{ detailMessage.detailContent || detailMessage.content }}</div>

        <div v-if="shouldShowDetailActionSelector(detailMessage)" class="detail-action-selector">
          <span class="detail-action-selector__label">处理方式</span>
          <el-segmented v-model="detailActionMode" :options="detailActionOptions(detailMessage)" />
        </div>

        <div class="detail-actions">
          <el-button
            v-if="shouldShowOpenApprovalCenterAction(detailMessage)"
            type="primary"
            @click="openMessageApprovalCenter(detailMessage)"
          >
            右侧打开审批中心
          </el-button>
          <el-button
            v-if="shouldShowRouteAction(detailMessage)"
            :type="shouldShowOpenApprovalCenterAction(detailMessage) ? 'default' : 'primary'"
            @click="navigateMessageRoute(detailMessage)"
          >
            {{ getMessageRouteActionLabel(detailMessage) }}
          </el-button>
          <el-button
            v-else-if="canHandleMessageAction(detailMessage)"
            type="primary"
            @click="navigateByMessage(detailMessage)"
          >
            {{ getMessagePrimaryActionLabel(detailMessage) }}
          </el-button>
          <el-button
            v-if="detailMessage.canMarkAsRead && !detailMessage.isRead"
            @click="handleMessageRead(detailMessage.id)"
          >
            标为已读
          </el-button>
        </div>
      </div>
      <el-skeleton v-else-if="messageStore.detailLoading" :rows="6" animated />
      <el-empty v-else description="暂无可展示的详情内容" />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import MessageList from '@/shared/ui/message/MessageList.vue'
import {
  getApprovalCurrentStepDisplay,
  getApprovalDepartmentDisplay,
  getApprovalRouteDisplay
} from '@/shared/ui/message/approvalMessageDisplay'
import { useMessageStore } from '@/features/messages/model/message'
import {
  requiresApprovalCenterFallback,
  resolveApprovalRoute
} from '@/features/approval/lib/approvalNotifications'
import { useApprovalCenter } from '@/features/approval'
import { useAuthStore } from '@/features/auth/model/store'
import type { Message } from '@/shared/types'
import { formatDateTime } from '@/shared/lib/utils'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const messageStore = useMessageStore()
const { openApprovalCenter } = useApprovalCenter()

const activeTab = ref('all')
const activeTypeFilter = ref<'all' | 'approval' | 'reminder' | 'system'>('all')
const processedFilter = ref<'all' | 'approved' | 'rejected'>('all')
const detailVisible = ref(false)
const detailMessage = ref<Message | null>(null)
const detailActionMode = ref<'approval-center' | 'route'>('approval-center')

const allMessages = computed(() => messageStore.visibleMessages)
const todoMessages = computed(() => messageStore.todoMessages)
const reminderMessages = computed(() => messageStore.reminderMessages)
const approvalMessages = computed(() => messageStore.approvalMessages)
const systemMessages = computed(() => messageStore.systemMessages)
const unreadCount = computed(() => messageStore.unreadCount)
const processedMessages = computed(() =>
  allMessages.value.filter(
    message => !messageStore.todoMessages.some(item => item.id === message.id)
  )
)
const processedCount = computed(() => processedMessages.value.length)
const unreadProcessedCount = computed(
  () => processedMessages.value.filter(message => !message.isRead).length
)

const typeFilterOptions = [
  { label: '全部类型', value: 'all' },
  { label: '审批通知', value: 'approval' },
  { label: '催办通知', value: 'reminder' },
  { label: '系统通知', value: 'system' }
] as const

const processedFilterOptions = [
  { label: '全部结果', value: 'all' },
  { label: '已通过', value: 'approved' },
  { label: '已驳回', value: 'rejected' }
] as const

const currentPrimaryMessages = computed(() => {
  if (activeTab.value === 'todo') {
    return todoMessages.value
  }
  if (activeTab.value === 'processed') {
    return processedMessages.value.filter(message =>
      matchesProcessedResultFilter(message, processedFilter.value)
    )
  }
  return allMessages.value
})

const filteredMessages = computed(() => {
  const base = currentPrimaryMessages.value
  switch (activeTypeFilter.value) {
    case 'approval':
      return base.filter(message => message.type === 'approval')
    case 'reminder':
      return base.filter(message => message.type === 'reminder')
    case 'system':
      return base.filter(message => message.type === 'system')
    default:
      return base
  }
})

const summaryCards = computed(() => {
  const cards = [
    {
      key: 'todo',
      label: '待处理',
      value: messageStore.summary.todoCount,
      hint: '当前仍需你处理的审批事项'
    },
    {
      key: 'approval',
      label: '审批通知',
      value: messageStore.summary.approvalCount,
      hint: '待处理和审批结果统一归口'
    },
    {
      key: 'reminder',
      label: '催办通知',
      value: messageStore.summary.reminderCount,
      hint: '仅统计未读催办消息'
    },
    {
      key: 'system',
      label: '系统通知',
      value: messageStore.summary.systemCount,
      hint: '仅统计未读系统与业务通知'
    }
  ]

  return cards
})

function getEmptyDescription(): string {
  const scopeLabel =
    activeTab.value === 'todo' ? '待处理' : activeTab.value === 'processed' ? '已处理' : '消息'
  const resultLabel =
    activeTab.value === 'processed'
      ? processedFilter.value === 'approved'
        ? '中的已通过审批'
        : processedFilter.value === 'rejected'
          ? '中的已驳回审批'
          : ''
      : ''
  const typeLabel =
    activeTypeFilter.value === 'approval'
      ? '审批通知'
      : activeTypeFilter.value === 'reminder'
        ? '催办通知'
        : activeTypeFilter.value === 'system'
          ? '系统通知'
          : ''

  if (typeLabel) {
    return `当前没有${scopeLabel}中的${typeLabel}`
  }

  if (resultLabel) {
    return `当前没有${scopeLabel}${resultLabel}`
  }

  return `当前没有${scopeLabel}`
}

async function refreshData() {
  try {
    await messageStore.refreshMessageCenter()
  } catch {
    ElMessage.error(messageStore.error || '刷新失败，请稍后重试')
  }
}

async function handleMessageRead(messageId: string) {
  try {
    await messageStore.markAsRead(messageId)
    ElMessage.success('已标记为已读')
  } catch {
    ElMessage.error('标记已读失败，请稍后重试')
  }
}

function buildApprovalCenterContext(message: Message) {
  const routeTarget = resolveMessageRouteTarget(message)
  const workflowEntityType =
    message.entityType === 'PLAN_REPORT' || message.entityType === 'PLAN'
      ? message.entityType
      : undefined
  const workflowEntityId =
    message.entityId !== undefined && message.entityId !== null && String(message.entityId).trim()
      ? message.entityId
      : undefined

  return {
    workflowEntityType,
    workflowEntityId,
    approvalInstanceId: message.approvalInstanceId,
    departmentName: resolveApprovalDepartment(message),
    planName: resolveApprovalCenterPlanName(message),
    routeTarget: routeTarget || undefined
  }
}

function isApprovalMessage(message?: Message | null): boolean {
  return message?.type === 'approval'
}

function normalizeResultKeywordTarget(message: Message): string {
  return [
    message.title,
    message.content,
    message.detailContent,
    message.status,
    message.readState,
    message.actionState
  ]
    .filter(value => typeof value === 'string' && value.trim())
    .join(' ')
    .toUpperCase()
}

function isApprovedMessage(message: Message): boolean {
  const normalized = normalizeResultKeywordTarget(message)
  return (
    message.bizType === 'APPROVAL_RESULT' &&
    (normalized.includes('通过') ||
      normalized.includes('已通过') ||
      normalized.includes('APPROVED') ||
      normalized.includes('SUCCESS'))
  )
}

function isRejectedMessage(message: Message): boolean {
  const normalized = normalizeResultKeywordTarget(message)
  return (
    message.bizType === 'APPROVAL_RESULT' &&
    (normalized.includes('驳回') ||
      normalized.includes('已驳回') ||
      normalized.includes('REJECTED') ||
      normalized.includes('REJECT'))
  )
}

function matchesProcessedResultFilter(
  message: Message,
  filter: 'all' | 'approved' | 'rejected'
): boolean {
  if (filter === 'approved') {
    return isApprovedMessage(message)
  }

  if (filter === 'rejected') {
    return isRejectedMessage(message)
  }

  return true
}

function getMessageMetadataValue(message: Message, key: string): string {
  const value = message.metadata?.[key]
  if (typeof value === 'string') {
    return value.trim()
  }

  const metadataJsonRaw = message.metadata?.metadataJson
  if (typeof metadataJsonRaw === 'string' && metadataJsonRaw.trim()) {
    try {
      const parsed = JSON.parse(metadataJsonRaw) as Record<string, unknown>
      const nestedValue = parsed[key]
      return typeof nestedValue === 'string' ? nestedValue.trim() : ''
    } catch {
      return ''
    }
  }

  return ''
}

function isGenericApprovalTitle(value: string): boolean {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return true
  }

  return (
    /^Plan\s+\d+$/i.test(normalized) ||
    /^业务对象#\d+$/.test(normalized) ||
    normalized === '计划审批' ||
    normalized === '审批通知' ||
    /^有新的.+待审批$/.test(normalized)
  )
}

function resolveApprovalCenterPlanName(message: Message): string {
  const candidates = [
    getMessageMetadataValue(message, 'businessName'),
    getMessageMetadataValue(message, 'planName'),
    getMessageMetadataValue(message, 'entityTitle'),
    getMessageMetadataValue(message, 'entityName'),
    message.title
  ]

  const explicitName = candidates
    .map(value => String(value || '').trim())
    .find(value => value && !isGenericApprovalTitle(value))
  if (explicitName) {
    return explicitName
  }

  const targetOrgName = getMessageMetadataValue(message, 'targetOrgName')
  const sourceOrgName = getMessageMetadataValue(message, 'sourceOrgName')
  const departmentName = targetOrgName || sourceOrgName || message.senderDisplay || ''
  return departmentName ? `${departmentName}计划` : ''
}

function resolvePlanReportCollegeFromBusinessName(message: Message): string {
  const businessName = getMessageMetadataValue(message, 'businessName')
  if (!businessName) {
    return ''
  }

  const normalized = businessName.replace(/\s+/g, ' ').trim()
  const reportMatch = normalized.match(/([\u4e00-\u9fa5A-Za-z0-9()（）·\-_]+)月报/)
  if (reportMatch?.[1]) {
    return reportMatch[1].replace(/^\d+/, '').trim()
  }

  return ''
}

function resolveApprovalDepartment(message: Message): string {
  const sourceOrgName = getMessageMetadataValue(message, 'sourceOrgName')
  const targetOrgName = getMessageMetadataValue(message, 'targetOrgName')
  return targetOrgName || sourceOrgName || message.senderDisplay || ''
}

function resolveCurrentViewerDepartment(): string {
  return String(
    authStore.effectiveDepartment ||
      authStore.user?.department ||
      (authStore.user as { orgName?: string | null } | null)?.orgName ||
      ''
  ).trim()
}

function resolvePlanReportRouteOriginType(
  sourceOrgName: string,
  targetOrgName: string
): 'self-report-upward' | 'college-report-upward' | null {
  const currentDepartmentName = resolveCurrentViewerDepartment()
  if (!currentDepartmentName) {
    return null
  }

  if (targetOrgName && currentDepartmentName === targetOrgName) {
    return 'self-report-upward'
  }

  if (sourceOrgName && currentDepartmentName === sourceOrgName) {
    return 'college-report-upward'
  }

  return null
}

function resolveApprovalRouteDepartment(message: Message): string {
  const sourceOrgName = getMessageMetadataValue(message, 'sourceOrgName')
  const targetOrgName = getMessageMetadataValue(message, 'targetOrgName')
  const entityType = String(message.entityType || '')
    .trim()
    .toUpperCase()

  if (entityType === 'PLAN_REPORT') {
    const originType = resolvePlanReportRouteOriginType(sourceOrgName, targetOrgName)
    if (originType === 'college-report-upward') {
      return targetOrgName || resolvePlanReportCollegeFromBusinessName(message) || ''
    }

    return targetOrgName || sourceOrgName || resolvePlanReportCollegeFromBusinessName(message) || ''
  }

  if (entityType === 'PLAN') {
    return targetOrgName || sourceOrgName || ''
  }

  return targetOrgName || sourceOrgName || ''
}

function resolveApprovalRouteDisplay(message: Message): string {
  const sourceOrgName = getMessageMetadataValue(message, 'sourceOrgName')
  const targetOrgName = getMessageMetadataValue(message, 'targetOrgName')

  if (sourceOrgName && targetOrgName) {
    return `${sourceOrgName} -> ${targetOrgName}`
  }

  return sourceOrgName || targetOrgName || ''
}

function buildApprovalPayload(message: Message) {
  const sourceOrgName = getMessageMetadataValue(message, 'sourceOrgName')
  const targetOrgName = getMessageMetadataValue(message, 'targetOrgName')
  return {
    approvalInstanceId: message.approvalInstanceId,
    entityType: message.entityType,
    entityId: message.entityId,
    actionUrl: message.actionUrl,
    viewerRole: authStore.effectiveRole || authStore.userRole,
    departmentName: resolveApprovalRouteDepartment(message),
    sourceOrgName: sourceOrgName || null,
    targetOrgName: targetOrgName || null,
    currentDepartmentName: resolveCurrentViewerDepartment() || null,
    reportOriginType:
      String(message.entityType || '')
        .trim()
        .toUpperCase() === 'PLAN_REPORT'
        ? resolvePlanReportRouteOriginType(sourceOrgName, targetOrgName)
        : null
  }
}

function resolveMessageRouteTarget(message?: Message | null): string | null {
  if (!message) {
    return null
  }

  const approvalPayload = buildApprovalPayload(message)
  if (message.type === 'approval') {
    const approvalRoute = resolveApprovalRoute(approvalPayload)

    if (approvalRoute) {
      return approvalRoute
    }
  }

  if (message.actionUrl) {
    return message.actionUrl
  }

  return null
}

function canOpenApprovalCenter(message?: Message | null): boolean {
  if (!message || !isApprovalMessage(message)) {
    return false
  }

  const context = buildApprovalCenterContext(message)
  return Boolean(
    (context.workflowEntityType === 'PLAN' || context.workflowEntityType === 'PLAN_REPORT') &&
    context.workflowEntityId !== undefined
  )
}

function canOpenMessageRoute(message?: Message | null): boolean {
  return Boolean(message && isApprovalMessage(message) && resolveMessageRouteTarget(message))
}

function resolveMessageAction(
  message?: Message | null
): { mode: 'approval-center' } | { mode: 'route'; target: string } | { mode: 'none' } {
  if (!message) {
    return { mode: 'none' }
  }

  const routeTarget = resolveMessageRouteTarget(message)

  if (isApprovalMessage(message) && detailActionMode.value === 'approval-center') {
    if (canOpenApprovalCenter(message)) {
      return { mode: 'approval-center' }
    }

    const approvalPayload = buildApprovalPayload(message)
    if (requiresApprovalCenterFallback(approvalPayload) && canOpenApprovalCenter(message)) {
      return { mode: 'approval-center' }
    }
  }

  if (routeTarget && canOpenMessageRoute(message)) {
    return { mode: 'route', target: routeTarget }
  }

  if (canOpenApprovalCenter(message)) {
    return { mode: 'approval-center' }
  }

  return { mode: 'none' }
}

function canHandleMessageAction(message?: Message | null): boolean {
  return resolveMessageAction(message).mode !== 'none'
}

function detailActionOptions(message?: Message | null) {
  const options: Array<{ label: string; value: 'approval-center' | 'route' }> = []

  if (canOpenApprovalCenter(message)) {
    options.push({ label: '右侧打开审批中心', value: 'approval-center' })
  }

  if (canOpenMessageRoute(message)) {
    options.push({ label: '跳转到对应页面', value: 'route' })
  }

  return options
}

function shouldShowDetailActionSelector(message?: Message | null): boolean {
  return (
    Boolean(message && !shouldShowOpenApprovalCenterAction(message)) &&
    detailActionOptions(message).length > 1
  )
}

function syncDetailActionMode(message?: Message | null) {
  const options = detailActionOptions(message)
  if (!options.length) {
    return
  }

  const currentModeSupported = options.some(option => option.value === detailActionMode.value)
  if (!currentModeSupported) {
    detailActionMode.value = options[0].value
    return
  }

  if (isApprovalMessage(message) && canOpenApprovalCenter(message)) {
    detailActionMode.value = 'approval-center'
  }
}

function getMessagePrimaryActionLabel(message?: Message | null): string {
  if (!message) {
    return '查看关联内容'
  }

  const action = resolveMessageAction(message)
  if (action.mode === 'approval-center') {
    return message.canProcess || message.bizType === 'APPROVAL_TODO'
      ? '右侧打开审批中心'
      : '右侧查看关联审批'
  }

  if (action.mode === 'route') {
    return message.canProcess || message.bizType === 'APPROVAL_TODO'
      ? '跳转到对应页面'
      : '查看关联内容'
  }

  return '查看详情'
}

async function handleMessageView(message: Message) {
  if (shouldAutoOpenApprovalCenter(message)) {
    openApprovalCenter(buildApprovalCenterContext(message))
    return
  }

  if (
    !isApprovalMessage(message) &&
    (!messageStore.capabilities.detailDrawerEnabled || message.canViewDetail === false) &&
    canHandleMessageAction(message)
  ) {
    navigateByMessage(message)
    return
  }

  detailVisible.value = true
  detailMessage.value = message
  syncDetailActionMode(message)
  try {
    detailMessage.value = await messageStore.fetchMessageDetail(message.id)
    syncDetailActionMode(detailMessage.value)
  } catch {
    ElMessage.warning('详情加载失败，已展示列表中的摘要内容')
  }
}

function navigateByMessage(message: Message) {
  syncDetailActionMode(message)
  const action = resolveMessageAction(message)

  if (action.mode === 'approval-center') {
    openApprovalCenter(buildApprovalCenterContext(message))
    return
  }

  if (action.mode === 'route') {
    void router.push(action.target)
    return
  }
}

function shouldAutoOpenApprovalCenter(message?: Message | null): boolean {
  return Boolean(message && isApprovalMessage(message) && canOpenApprovalCenter(message))
}

function shouldShowOpenApprovalCenterAction(message?: Message | null): boolean {
  return canOpenApprovalCenter(message)
}

function shouldShowRouteAction(message?: Message | null): boolean {
  return canOpenMessageRoute(message)
}

function openMessageApprovalCenter(message?: Message | null) {
  if (!message || !canOpenApprovalCenter(message)) {
    return
  }

  openApprovalCenter(buildApprovalCenterContext(message))
  detailVisible.value = false
}

function navigateMessageRoute(message?: Message | null) {
  if (!message) {
    return
  }

  const routeTarget = resolveMessageRouteTarget(message)
  if (!routeTarget) {
    return
  }

  detailVisible.value = false
  void router.push(routeTarget)
}

function getMessageRouteActionLabel(message?: Message | null): string {
  if (!message) {
    return '查看关联内容'
  }

  return message.canProcess || message.bizType === 'APPROVAL_TODO'
    ? '跳转到对应页面'
    : '查看关联内容'
}

async function markAllAsRead() {
  if (!messageStore.hasUnreadMarkableMessages) {
    ElMessage.warning('暂无可标记为已读的消息')
    return
  }

  try {
    await messageStore.markAllAsRead()
    ElMessage.success('已将普通通知全部标为已读')
  } catch {
    ElMessage.error('全部标记已读失败，请稍后重试')
  }
}

function clearReadMessages() {
  if (!messageStore.hasReadMarkableMessages) {
    ElMessage.warning('暂无已读消息可清理')
    return
  }

  messageStore.clearReadMessages()
  ElMessage.success('已清除当前视图中的已读消息')
}

/** 钉钉待办 sourceId：sism-approval-{type}-{entityId}-{instanceId}[-{stepId}] */
const DINGTALK_SOURCE_ID_RE = /^sism-approval-([A-Z_]+)-(\d+)-(\d+)(?:-(\d+))?$/

/**
 * 钉钉待办跳转落地：按 sourceId 中的审批实例 ID 自动打开对应的待处理审批
 * 消息（审批中心盒子/详情弹窗），用户无需在列表中手动查找。
 */
async function autoOpenFromDingTalkSourceId() {
  const raw = route.query.sourceId
  if (typeof raw !== 'string' || !raw) {
    return
  }
  const match = raw.match(DINGTALK_SOURCE_ID_RE)
  const nextQuery = { ...route.query }
  delete nextQuery.sourceId
  await router.replace({ query: nextQuery })
  if (!match) {
    return
  }
  const instanceId = match[3]
  const target = messageStore.todoMessages.find(
    message => String(message.approvalInstanceId ?? '') === instanceId
  )
  if (target) {
    handleMessageView(target)
  }
}

onMounted(async () => {
  await refreshData()
  await autoOpenFromDingTalkSourceId()
})
</script>

<style scoped>
.message-center {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.header-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.page-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: var(--text-main);
}

.page-desc {
  margin: 0;
  font-size: 14px;
  color: var(--text-secondary);
}

.page-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.message-error {
  margin-bottom: -4px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.summary-card {
  border: 1px solid var(--border-color);
}

.summary-label {
  font-size: 13px;
  color: var(--text-secondary);
}

.summary-value {
  margin: 8px 0 6px;
  font-size: 28px;
  font-weight: 700;
  color: var(--text-main);
}

.summary-hint {
  font-size: 12px;
  color: var(--text-secondary);
}

.message-card {
  border: 1px solid var(--border-color);
  border-radius: 16px;
}

.message-tabs :deep(.el-tabs__header) {
  margin-bottom: 20px;
}

.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.tab-badge {
  margin-left: 2px;
}

.message-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message-subfilters {
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.message-subfilters :deep(.el-segmented) {
  flex-wrap: wrap;
  max-width: 100%;
}

.detail-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.detail-time {
  font-size: 13px;
  color: var(--text-secondary);
}

.detail-body {
  white-space: pre-wrap;
  line-height: 1.7;
  color: var(--text-main);
}

.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.detail-action-selector {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-action-selector__label {
  font-size: 13px;
  color: var(--text-secondary);
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
  }

  .page-actions {
    width: 100%;
    flex-wrap: wrap;
  }
}
</style>
