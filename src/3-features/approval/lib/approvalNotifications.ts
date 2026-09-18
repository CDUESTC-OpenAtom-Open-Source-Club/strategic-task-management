/**
 * Approval Notification Service
 *
 * Handles approval-related notifications with WebSocket integration.
 * Works with the notification center and approval store.
 */

import { computed } from 'vue'
import { getActivePinia } from 'pinia'
import { ElNotification } from 'element-plus'
import { useWebSocketNotifications, NotificationType } from '@/shared/api/websocket'
import type { NotificationMessage } from '@/shared/api/websocket'
import { useAuthStore } from '@/features/auth/model/store'
import { ENABLE_WEBSOCKET_NOTIFICATIONS } from '@/shared/config/api'
import type { UserRole } from '@/shared/types'

export const APPROVAL_STATE_REFRESH_EVENT = 'approval-state-refresh'

export interface ApprovalStateRefreshDetail {
  source?: string
}

export interface ApprovalRoutePayload {
  approvalInstanceId?: number | string | null
  entityType?: string | null
  entityId?: number | string | null
  actionUrl?: string | null
  viewerRole?: UserRole | null
  departmentName?: string | null
  sourceOrgName?: string | null
  targetOrgName?: string | null
  currentDepartmentName?: string | null
  reportOriginType?: 'self-report-upward' | 'college-report-upward' | null
}

let approvalNotificationListener: EventListener | null = null

export function requiresApprovalCenterFallback(payload: ApprovalRoutePayload): boolean {
  const entityType = String(payload.entityType || '')
    .trim()
    .toUpperCase()

  return entityType === 'PLAN' || entityType === 'PLAN_REPORT' || entityType === 'INDICATOR'
}

function normalizeApprovalQueryValue(value?: number | string | null): string | null {
  const normalized = String(value ?? '').trim()
  return normalized ? normalized : null
}

function normalizeApprovalRoute(path?: string | null): string | null {
  const normalized = String(path || '').trim()
  if (!normalized || normalized === '/messages') {
    return null
  }
  return normalized
}

function normalizeDepartmentName(value?: string | null): string {
  return String(value || '').trim()
}

function normalizeViewerRole(role?: UserRole | string | null): UserRole | null {
  const normalized = String(role || '').trim()
  if (
    normalized === 'strategic_dept' ||
    normalized === 'functional_dept' ||
    normalized === 'secondary_college'
  ) {
    return normalized as UserRole
  }

  return null
}

function resolveCurrentViewerRole(): UserRole | null {
  try {
    if (getActivePinia()) {
      const authStore = useAuthStore()
      return normalizeViewerRole(authStore.effectiveRole || authStore.userRole)
    }
  } catch {
    // ignore store lookup failures and fall back to persisted user data
  }

  if (typeof window === 'undefined') {
    return null
  }

  try {
    const savedUser = localStorage.getItem('currentUser')
    if (!savedUser) {
      return null
    }

    const parsedUser = JSON.parse(savedUser) as { role?: string | null }
    return normalizeViewerRole(parsedUser.role)
  } catch {
    return null
  }
}

function replaceRoutePath(path: string, nextPathname: string): string {
  const [, search = ''] = path.split('?')
  return search ? `${nextPathname}?${search}` : nextPathname
}

function resolvePlanReportOriginType(
  payload: ApprovalRoutePayload
): 'self-report-upward' | 'college-report-upward' | null {
  if (payload.reportOriginType === 'self-report-upward') {
    return 'self-report-upward'
  }

  if (payload.reportOriginType === 'college-report-upward') {
    return 'college-report-upward'
  }

  const currentDepartmentName = normalizeDepartmentName(payload.currentDepartmentName)
  const sourceOrgName = normalizeDepartmentName(payload.sourceOrgName)
  const targetOrgName = normalizeDepartmentName(payload.targetOrgName)

  if (currentDepartmentName && targetOrgName && currentDepartmentName === targetOrgName) {
    return 'self-report-upward'
  }

  if (currentDepartmentName && sourceOrgName && currentDepartmentName === sourceOrgName) {
    return 'college-report-upward'
  }

  return null
}

function resolveApprovalDepartmentName(payload: ApprovalRoutePayload): string | null {
  const entityType = String(payload.entityType || '')
    .trim()
    .toUpperCase()
  const sourceOrgName = normalizeDepartmentName(payload.sourceOrgName)
  const targetOrgName = normalizeDepartmentName(payload.targetOrgName)
  const currentDepartmentName = normalizeDepartmentName(payload.currentDepartmentName)
  const fallbackDepartmentName = normalizeDepartmentName(payload.departmentName)

  if (entityType === 'PLAN_REPORT') {
    const originType = resolvePlanReportOriginType(payload)
    if (originType === 'college-report-upward') {
      return targetOrgName || fallbackDepartmentName || null
    }

    if (originType === 'self-report-upward') {
      return targetOrgName || currentDepartmentName || fallbackDepartmentName || null
    }

    return targetOrgName || sourceOrgName || currentDepartmentName || fallbackDepartmentName || null
  }

  if (entityType === 'PLAN') {
    return targetOrgName || sourceOrgName || fallbackDepartmentName || null
  }

  return targetOrgName || sourceOrgName || fallbackDepartmentName || null
}

function resolveApprovalWorkbenchRoute(payload: ApprovalRoutePayload): string | null {
  const entityType = String(payload.entityType || '')
    .trim()
    .toUpperCase()
  const viewerRole = normalizeViewerRole(payload.viewerRole) || resolveCurrentViewerRole()

  switch (entityType) {
    case 'PLAN_REPORT':
      if (viewerRole === 'strategic_dept') {
        return '/strategic-tasks'
      }

      if (viewerRole === 'secondary_college') {
        return '/indicators'
      }

      if (viewerRole === 'functional_dept') {
        const originType = resolvePlanReportOriginType(payload)
        if (originType === 'college-report-upward') {
          return '/distribution'
        }

        return '/indicators'
      }

      return '/strategic-tasks'
    case 'PLAN':
      if (viewerRole === 'functional_dept') {
        return '/distribution'
      }

      if (viewerRole === 'secondary_college') {
        return '/indicators'
      }

      return '/strategic-tasks'
    case 'TASK':
      return '/strategic-tasks'
    case 'INDICATOR':
      return '/indicators'
    case 'INDICATOR_DISTRIBUTION':
      return '/distribution'
    default:
      return null
  }
}

function appendApprovalContext(path: string, payload: ApprovalRoutePayload): string {
  const [pathname, search = ''] = path.split('?')
  const params = new URLSearchParams(search)

  params.set('openApproval', '1')

  const entityType = normalizeApprovalQueryValue(payload.entityType)?.toUpperCase()
  const entityId = normalizeApprovalQueryValue(payload.entityId)
  const approvalInstanceId = normalizeApprovalQueryValue(payload.approvalInstanceId)
  const departmentName = normalizeApprovalQueryValue(resolveApprovalDepartmentName(payload))

  if (entityType) {
    params.set('approvalEntityType', entityType)
  }

  if (entityId) {
    params.set('approvalEntityId', entityId)
  }

  if (approvalInstanceId) {
    params.set('approvalInstanceId', approvalInstanceId)
  }

  if (departmentName) {
    params.set('approvalDepartment', departmentName)
  }

  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function resolveApprovalRoute(payload: ApprovalRoutePayload): string | null {
  const explicitRoute = normalizeApprovalRoute(payload.actionUrl)
  const preferredWorkbenchRoute = resolveApprovalWorkbenchRoute(payload)
  const entityType = String(payload.entityType || '')
    .trim()
    .toUpperCase()

  if (entityType === 'PLAN' || entityType === 'PLAN_REPORT') {
    const baseRoute = preferredWorkbenchRoute
      ? explicitRoute
        ? replaceRoutePath(explicitRoute, preferredWorkbenchRoute)
        : preferredWorkbenchRoute
      : explicitRoute

    return baseRoute ? appendApprovalContext(baseRoute, payload) : null
  }

  if (explicitRoute) {
    return appendApprovalContext(explicitRoute, payload)
  }

  return preferredWorkbenchRoute ? appendApprovalContext(preferredWorkbenchRoute, payload) : null
}

export function notifyApprovalStateRefresh(detail: ApprovalStateRefreshDetail = {}): void {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(
    new CustomEvent<ApprovalStateRefreshDetail>(APPROVAL_STATE_REFRESH_EVENT, {
      detail
    })
  )
}

/**
 * Get icon and notification type based on notification type
 */
function getNotificationConfig(type: NotificationType): {
  icon: string
  type: 'success' | 'warning' | 'info' | 'error'
} {
  switch (type) {
    case NotificationType.APPROVAL_APPROVED:
      return { icon: '✅', type: 'success' }
    case NotificationType.APPROVAL_REJECTED:
      return { icon: '❌', type: 'error' }
    case NotificationType.APPROVAL_REQUIRED:
      return { icon: '📋', type: 'warning' }
    case NotificationType.APPROVAL_NEXT_STEP:
      return { icon: '➡️', type: 'info' }
    default:
      return { icon: '📢', type: 'info' }
  }
}

/**
 * Show desktop notification via Element Plus
 */
function showElNotification(message: NotificationMessage): void {
  const config = getNotificationConfig(message.type)

  ElNotification({
    title: `${config.icon} ${message.title}`,
    message: message.content,
    type: config.type,
    duration: 5000,
    position: 'top-right',
    onClick: () => {
      const route = navigateToApproval(message)
      if (route) {
        window.location.hash = route
      }
    }
  })
}

/**
 * Initialize approval notification listener
 */
export function initApprovalNotifications(): void {
  if (!ENABLE_WEBSOCKET_NOTIFICATIONS) {
    return
  }

  const { connect, requestNotificationPermission } = useWebSocketNotifications()

  // Request browser notification permission
  requestNotificationPermission()

  // Connect to WebSocket
  connect()

  if (typeof window === 'undefined') {
    return
  }

  if (approvalNotificationListener) {
    window.removeEventListener('approval-notification', approvalNotificationListener)
  }

  approvalNotificationListener = ((event: CustomEvent<NotificationMessage>) => {
    const message = event.detail
    showElNotification(message)
  }) as EventListener

  window.addEventListener('approval-notification', approvalNotificationListener)
}

export function destroyApprovalNotifications(): void {
  if (typeof window === 'undefined' || !approvalNotificationListener) {
    return
  }

  window.removeEventListener('approval-notification', approvalNotificationListener)
  approvalNotificationListener = null
}

/**
 * Handle notification click - navigate to approval page
 */
export function navigateToApproval(message: NotificationMessage): string | null {
  return resolveApprovalRoute({
    approvalInstanceId: message.approvalInstanceId,
    entityType: message.entityType,
    entityId: message.entityId
  })
}

/**
 * Format notification for display
 */
export function formatNotification(message: NotificationMessage): {
  title: string
  content: string
  time: string
  type: string
} {
  const time = new Date(message.timestamp)
  const timeStr = time.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })

  return {
    title: message.title,
    content: message.content,
    time: timeStr,
    type: message.type
  }
}

/**
 * Composable for approval notifications
 */
export function useApprovalNotifications() {
  const wsNotifications = useWebSocketNotifications()

  // Filter notifications for approval-related only
  const approvalNotifications = computed(() => {
    return wsNotifications.notifications.value.filter(n => n.type !== NotificationType.SYSTEM)
  })

  // Approval unread count
  const approvalUnreadCount = computed(() => {
    return approvalNotifications.value.length
  })

  return {
    ...wsNotifications,
    approvalNotifications,
    approvalUnreadCount,
    initApprovalNotifications,
    destroyApprovalNotifications,
    navigateToApproval,
    formatNotification
  }
}

export default {
  initApprovalNotifications,
  destroyApprovalNotifications,
  navigateToApproval,
  formatNotification,
  useApprovalNotifications
}
