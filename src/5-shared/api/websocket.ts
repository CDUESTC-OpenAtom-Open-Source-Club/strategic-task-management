/**
 * WebSocket Service for Real-time Notifications
 *
 * Provides WebSocket connection management for real-time approval notifications.
 */

import { ref, computed } from 'vue'
import { logger } from '@/shared/lib/utils/logger'
import { tokenManager } from '@/shared/lib/utils/tokenManager'
import { WS_BASE_URL } from '@/shared/config/api'
import { requestGlobalDataRefresh } from '@/shared/lib/dataFreshness'

// Notification types matching backend
export enum NotificationType {
  APPROVAL_REQUIRED = 'APPROVAL_REQUIRED',
  APPROVAL_APPROVED = 'APPROVAL_APPROVED',
  APPROVAL_REJECTED = 'APPROVAL_REJECTED',
  APPROVAL_NEXT_STEP = 'APPROVAL_NEXT_STEP',
  SYSTEM = 'SYSTEM'
}

// Notification message interface
export interface NotificationMessage {
  type: NotificationType
  title: string
  content: string
  entityType?: string
  entityId?: number
  approvalInstanceId?: number
  stepName?: string
  timestamp: string
}

// WebSocket connection state
type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error'

// Global state
const ws = ref<WebSocket | null>(null)
const connectionState = ref<ConnectionState>('disconnected')
const notifications = ref<NotificationMessage[]>([])
const unreadCount = ref(0)
const MAX_NOTIFICATION_HISTORY = 100

// Reconnection settings
// 2026-10-10 跨窗口实时修复②：后端/前端重启的窗口期若放弃重连，已打开的页面将
// 永远收不到实时推送（表现正是"必须手动刷新"）。改为指数退避无限重试，
// 并在页面重新聚焦/网络恢复时立即重连。
const RECONNECT_BACKOFF_STEPS_MS = [2_000, 4_000, 8_000, 16_000, 30_000, 60_000]
const MAX_CONSECUTIVE_FAILURES = 2
let reconnectAttempts = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let shouldReconnect = true
let handshakeRejected = false
let lastErrorMessage: string | null = null
let consecutiveFailureCount = 0
let reconnectListenersBound = false

function scheduleReconnect(delayMs: number): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connectWebSocket()
  }, delayMs)
}

function nextBackoffDelayMs(): number {
  const step =
    RECONNECT_BACKOFF_STEPS_MS[Math.min(reconnectAttempts, RECONNECT_BACKOFF_STEPS_MS.length - 1)]
  return step
}

/**
 * 断开状态下，页面重新聚焦或网络恢复时立即重连（重置退避等待）。
 * 后端短暂重启后用户切回页面即可恢复推送，不必手动刷新。
 */
function handleReconnectTrigger(): void {
  if (typeof window === 'undefined') {
    return
  }
  if (ws.value?.readyState === WebSocket.OPEN || ws.value?.readyState === WebSocket.CONNECTING) {
    return
  }
  if (!shouldReconnect || handshakeRejected) {
    return
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('[WebSocket] reconnect trigger (focus/online), reconnecting now')
  }
  connectWebSocket()
}

function bindReconnectListeners(): void {
  if (reconnectListenersBound || typeof window === 'undefined') {
    return
  }
  reconnectListenersBound = true
  window.addEventListener('focus', handleReconnectTrigger)
  window.addEventListener('online', handleReconnectTrigger)
}

/**
 * Get WebSocket URL from config
 */
function getWebSocketUrl(): string {
  const userId = getUserId()
  const token = tokenManager.getAccessToken()
  const params = new URLSearchParams()
  params.set('userId', userId)
  if (token) {
    params.set('token', token)
  }
  return `${WS_BASE_URL}/ws/notifications?${params.toString()}`
}

function logConnectionError(message: string, error?: unknown): void {
  if (lastErrorMessage !== message) {
    lastErrorMessage = message
    logger.error(`[WebSocket] ${message}`, error)
  } else if (import.meta.env.DEV && error) {
    logger.error(`[WebSocket] ${message}`, error)
  }
}

function clearConnectionError(): void {
  lastErrorMessage = null
}

/**
 * Get current user ID from localStorage or auth store
 */
function getUserId(): string {
  const userStr = localStorage.getItem('user')
  if (userStr) {
    try {
      const user = JSON.parse(userStr)
      return user.id || ''
    } catch {
      return ''
    }
  }
  return ''
}

/**
 * 2026-09-27 细粒度异步刷新（用户拍板）：把 WS 消息映射为受影响的数据域，
 * 只让相关视图定向刷新，避免"一条通知全员全量刷"。
 * 终态（审批通过/驳回）才带 dashboard 域——看板聚合数据此时才真的变化。
 */
function resolveRefreshDomains(message: NotificationMessage): string[] {
  const domains = new Set<string>(['message'])
  const entityType = String(message.entityType || '')
    .trim()
    .toUpperCase()
  const type = String(message.type || '')
    .trim()
    .toUpperCase()

  if (entityType === 'INDICATOR') {
    domains.add('indicator')
    domains.add('plan')
  } else if (['PLAN', 'PLAN_REPORT', 'INDICATOR_DISTRIBUTION'].includes(entityType)) {
    domains.add('plan')
  } else {
    domains.add('plan')
  }

  if (type === NotificationType.APPROVAL_APPROVED || type === NotificationType.APPROVAL_REJECTED) {
    domains.add('dashboard')
  }

  return Array.from(domains)
}

/**
 * Handle incoming WebSocket message
 */
function handleMessage(event: MessageEvent): void {
  try {
    const message: NotificationMessage = JSON.parse(event.data)

    // 2026-10-24 跨窗口数据同步：DATA_CHANGED 是后端广播的数据变更事件（指标直改/
    // 异动落库等），不是用户消息——不进消息列表、不弹浏览器通知。做两件事：
    // ① 派发 indicator-data-changed 精确事件，战略任务视图据此对单行做局部补丁；
    // ② 走全局数据域总线（indicator/plan 域），其余视图复用既有轻刷新。
    if (message.type === 'DATA_CHANGED') {
      window.dispatchEvent(
        new CustomEvent('indicator-data-changed', {
          detail: { entityType: message.entityType, entityId: message.entityId }
        })
      )
      requestGlobalDataRefresh({
        source: 'data-change-push',
        silent: true,
        domains: ['indicator', 'plan']
      })
      return
    }

    // Add to notifications list
    notifications.value.unshift(message)
    if (notifications.value.length > MAX_NOTIFICATION_HISTORY) {
      notifications.value.length = MAX_NOTIFICATION_HISTORY
    }

    // Increment unread count
    unreadCount.value = Math.min(unreadCount.value + 1, notifications.value.length)

    // Show browser notification if supported
    showBrowserNotification(message)

    // Dispatch custom event for other components to listen
    window.dispatchEvent(new CustomEvent('approval-notification', { detail: message }))

    // 2026-09-27 细粒度刷新：按数据域发起定向刷新请求（消息中心/审批待办由 AppLayout 消费 message 域）
    requestGlobalDataRefresh({
      source: 'approval-notification',
      silent: false,
      domains: resolveRefreshDomains(message)
    })
  } catch (error) {
    logger.error('[WebSocket] Failed to parse message:', error)
  }
}

/**
 * Show browser notification
 */
function showBrowserNotification(message: NotificationMessage): void {
  if (!('Notification' in window)) {
    return
  }

  if (Notification.permission === 'granted') {
    new Notification(message.title, {
      body: message.content,
      icon: '/favicon.ico'
    })
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        new Notification(message.title, {
          body: message.content,
          icon: '/favicon.ico'
        })
      }
    })
  }
}

/**
 * Handle WebSocket open
 */
function handleOpen(): void {
  connectionState.value = 'connected'
  const isReconnectAfterDrop = reconnectAttempts > 0 || consecutiveFailureCount > 0
  reconnectAttempts = 0
  consecutiveFailureCount = 0
  handshakeRejected = false
  shouldReconnect = true
  clearConnectionError()
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('[WebSocket] Connected')
  }
  // 2026-10-10 跨窗口实时修复⑤：断线重连成功的瞬间做一次全量数据刷新——
  // 后端重启/网络中断期间错过的所有状态流转，在恢复连接时自动收敛，
  // 不再依赖下一条推送或 45s 心跳，杜绝"重连后界面停在旧状态"。
  if (isReconnectAfterDrop && typeof window !== 'undefined') {
    requestGlobalDataRefresh({
      source: 'approval-state-refresh',
      silent: true,
      domains: ['message', 'workflow', 'plan', 'indicator']
    })
  }
}

/**
 * Handle WebSocket close
 */
function handleClose(event?: CloseEvent): void {
  connectionState.value = 'disconnected'
  ws.value = null

  if (event && [1002, 1003, 1007, 1008, 1011].includes(event.code)) {
    shouldReconnect = false
    handshakeRejected = true
    logConnectionError(`连接被服务端拒绝（code=${event.code}）`)
    return
  }

  if (!shouldReconnect || handshakeRejected) {
    return
  }

  // 指数退避无限重试：后端重启/网络抖动后自动恢复，不再有重连次数上限
  const delayMs = nextBackoffDelayMs()
  reconnectAttempts++
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(`[WebSocket] Reconnecting in ${delayMs}ms (attempt ${reconnectAttempts})`)
  }
  scheduleReconnect(delayMs)
}

/**
 * Handle WebSocket error
 */
function handleError(error: Event): void {
  connectionState.value = 'error'
  consecutiveFailureCount++

  if (consecutiveFailureCount === MAX_CONSECUTIVE_FAILURES) {
    // 2026-10-10 跨窗口实时修复②：连续握手失败只记日志并继续退避重试，
    // 不再永久放弃（后端重启窗口期曾导致页面永久失联，只能手动刷新恢复）。
    logConnectionError(
      'WebSocket 握手连续失败，将继续按退避间隔重试（后端恢复后会自动重连）',
      error
    )
    return
  }

  logConnectionError('连接失败，请确认后端 WebSocket 服务已启动', error)
}

/**
 * Connect to WebSocket server
 */
export function connectWebSocket(): void {
  if (ws.value?.readyState === WebSocket.OPEN) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[WebSocket] Already connected')
    }
    return
  }

  const userId = getUserId()
  if (!userId) {
    shouldReconnect = false
    logger.warn('[WebSocket] No user ID, skipping connection')
    return
  }

  if (!tokenManager.getAccessToken()) {
    shouldReconnect = false
    logger.warn('[WebSocket] No access token, skipping connection')
    return
  }

  connectionState.value = 'connecting'
  shouldReconnect = true
  handshakeRejected = false
  bindReconnectListeners()

  try {
    const url = getWebSocketUrl()
    ws.value = new WebSocket(url)

    ws.value.onopen = handleOpen
    ws.value.onmessage = handleMessage
    ws.value.onclose = event => handleClose(event)
    ws.value.onerror = handleError

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[WebSocket] Connecting to:', url.replace(/([?&]token=)[^&]+/, '$1***'))
    }
  } catch (error) {
    connectionState.value = 'error'
    shouldReconnect = false
    logConnectionError('初始化 WebSocket 连接失败', error)
  }
}

/**
 * Disconnect WebSocket
 */
export function disconnectWebSocket(): void {
  shouldReconnect = false
  handshakeRejected = false
  consecutiveFailureCount = 0
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  if (ws.value) {
    ws.value.close()
    ws.value = null
  }

  connectionState.value = 'disconnected'
  clearConnectionError()
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('[WebSocket] Disconnected')
  }
}

/**
 * Mark notification as read
 */
export function markAsRead(index: number): void {
  if (index >= 0 && index < notifications.value.length) {
    notifications.value.splice(index, 1)
    unreadCount.value = Math.min(unreadCount.value, notifications.value.length)
  }
}

/**
 * Mark all notifications as read
 */
export function markAllAsRead(): void {
  notifications.value = []
  unreadCount.value = 0
}

/**
 * Clear all notifications
 */
export function clearNotifications(): void {
  notifications.value = []
  unreadCount.value = 0
}

/**
 * Request browser notification permission
 */
export function requestNotificationPermission(): void {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

/**
 * Composable for using WebSocket notifications
 */
export function useWebSocketNotifications() {
  return {
    // State
    connectionState: computed(() => connectionState.value),
    notifications: computed(() => notifications.value),
    unreadCount: computed(() => unreadCount.value),
    isConnected: computed(() => connectionState.value === 'connected'),

    // Actions
    connect: connectWebSocket,
    disconnect: disconnectWebSocket,
    markAsRead,
    markAllAsRead,
    clearNotifications,
    requestNotificationPermission
  }
}

export default {
  connectWebSocket,
  disconnectWebSocket,
  useWebSocketNotifications,
  NotificationType
}
