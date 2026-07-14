/**
 * WebSocket Service for Real-time Notifications
 *
 * Provides WebSocket connection management for real-time approval notifications.
 */

import { ref, computed } from 'vue'
import { logger } from '@/shared/lib/utils/logger'
import { tokenManager } from '@/shared/lib/utils/tokenManager'
import { WS_BASE_URL } from '@/shared/config/api'

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
const RECONNECT_INTERVAL = 5000
const MAX_RECONNECT_ATTEMPTS = 5
const MAX_CONSECUTIVE_FAILURES = 2
let reconnectAttempts = 0
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let shouldReconnect = true
let handshakeRejected = false
let lastErrorMessage: string | null = null
let consecutiveFailureCount = 0

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
 * Handle incoming WebSocket message
 */
function handleMessage(event: MessageEvent): void {
  try {
    const message: NotificationMessage = JSON.parse(event.data)

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
  reconnectAttempts = 0
  consecutiveFailureCount = 0
  handshakeRejected = false
  shouldReconnect = true
  clearConnectionError()
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('[WebSocket] Connected')
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

  // Attempt reconnection
  if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log(
        `[WebSocket] Reconnecting in ${RECONNECT_INTERVAL}ms (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`
      )
    }
    reconnectTimer = setTimeout(() => {
      reconnectAttempts++
      connectWebSocket()
    }, RECONNECT_INTERVAL)
  } else {
    shouldReconnect = false
    logConnectionError('已达到最大重连次数，停止重试')
  }
}

/**
 * Handle WebSocket error
 */
function handleError(error: Event): void {
  connectionState.value = 'error'
  consecutiveFailureCount++

  if (consecutiveFailureCount >= MAX_CONSECUTIVE_FAILURES) {
    shouldReconnect = false
    handshakeRejected = true
    logConnectionError(
      'WebSocket 握手连续失败，已暂停自动重连，请检查后端通知通道权限或可用性',
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
