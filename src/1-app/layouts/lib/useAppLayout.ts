import { computed, watch, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '@/features/auth/model/store'
import { useOrgStore } from '@/features/organization/model/store'
import { useMessageStore } from '@/features/messages/model/message'
import { useApprovalStore } from '@/features/approval/model/store'
import { APPROVAL_STATE_REFRESH_EVENT } from '@/features/approval/lib'
import { hasAdminConsoleAccess } from '@/shared/lib/permissions/adminConsoleAccess'
import {
  GLOBAL_DATA_REFRESH_REQUEST_EVENT,
  requestGlobalDataRefresh,
  type GlobalDataRefreshDetail
} from '@/shared/lib/dataFreshness'
import { useWebSocketNotifications } from '@/shared/api/websocket'

const ATTENTION_REFRESH_COOLDOWN_MS = 45 * 1000
// 2026-10-07 心跳兜底：WS 断连/漏推时，每 30s 轻量同步一次消息与审批状态，
// 保证"操作后几秒内状态异步收敛"；页面不可见时跳过，卸载时清理。
const NOTIFICATION_HEARTBEAT_INTERVAL_MS = 30 * 1000
let approvalNotificationRefreshListener: EventListener | null = null
let lastAttentionRefreshAt = 0
let messageRefreshInFlight: Promise<unknown> | null = null
let approvalRefreshInFlight: Promise<unknown> | null = null
let notificationHeartbeatTimer: ReturnType<typeof setInterval> | null = null

export function useAppLayout() {
  const authStore = useAuthStore()
  const orgStore = useOrgStore()
  const messageStore = useMessageStore()
  const approvalStore = useApprovalStore()
  useWebSocketNotifications() // 激活 WS 客户端,数据驱动模式不再依赖连接状态

  const isLoggedIn = computed(() => authStore.isAuthenticated)
  const currentUser = computed(() => authStore.user)
  const isStrategicDept = computed(() => authStore.userRole === 'strategic_dept')
  const strategicDeptName = computed(() => orgStore.getStrategicDeptName())
  const canAccessAdminConsole = computed(() => hasAdminConsoleAccess(authStore.user))

  const refreshMessages = () => {
    if (!messageRefreshInFlight) {
      messageRefreshInFlight = Promise.resolve(messageStore.refreshMessageCenter()).finally(() => {
        messageRefreshInFlight = null
      })
    }
    return messageRefreshInFlight
  }

  const refreshPendingApprovals = () => {
    if (!approvalRefreshInFlight) {
      approvalRefreshInFlight = Promise.resolve(approvalStore.loadPendingApprovals()).finally(
        () => {
          approvalRefreshInFlight = null
        }
      )
    }
    return approvalRefreshInFlight
  }

  const refreshNotificationState = async () => {
    await Promise.all([refreshMessages(), refreshPendingApprovals()])
  }

  const handleGlobalDataRefreshRequest = (event: Event) => {
    if (!authStore.isAuthenticated) {
      return
    }

    const detail = (event as CustomEvent<GlobalDataRefreshDetail>).detail
    if (detail?.source === 'approval-state-refresh') {
      return
    }

    if (detail?.source === 'approval-notification') {
      void refreshNotificationState()
      return
    }

    void refreshMessages()
  }

  const handleApprovalStateRefresh = (event?: Event) => {
    void refreshNotificationState()
    const detail = (event as CustomEvent<{ domains?: string[] }> | undefined)?.detail
    requestGlobalDataRefresh({
      source: 'approval-state-refresh',
      silent: true,
      // 2026-10-07：桥接补齐数据域，保住"中间审批环节不打扰看板"的细粒度契约；
      // 看板的终态刷新由 WS approval-notification 携带 dashboard 域负责。
      domains: detail?.domains ?? ['message', 'workflow', 'plan', 'indicator']
    })
  }

  const handleWindowFocus = () => {
    const now = Date.now()
    if (now - lastAttentionRefreshAt < ATTENTION_REFRESH_COOLDOWN_MS) {
      return
    }
    lastAttentionRefreshAt = now
    requestGlobalDataRefresh({ source: 'window-focus', silent: true })
  }

  const handleVisibilityChange = () => {
    if (typeof document !== 'undefined' && !document.hidden) {
      const now = Date.now()
      if (now - lastAttentionRefreshAt < ATTENTION_REFRESH_COOLDOWN_MS) {
        return
      }
      lastAttentionRefreshAt = now
      requestGlobalDataRefresh({ source: 'visibility-return', silent: true })
    }
  }

  const stopNotificationHeartbeat = () => {
    if (notificationHeartbeatTimer !== null) {
      clearInterval(notificationHeartbeatTimer)
      notificationHeartbeatTimer = null
    }
  }

  const startNotificationHeartbeat = () => {
    stopNotificationHeartbeat()
    notificationHeartbeatTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return
      }
      if (!authStore.isAuthenticated) {
        return
      }
      requestGlobalDataRefresh({
        source: 'heartbeat',
        silent: true,
        domains: ['message', 'workflow']
      })
    }, NOTIFICATION_HEARTBEAT_INTERVAL_MS)
  }

  onMounted(async () => {
    if (typeof window !== 'undefined') {
      window.addEventListener(
        APPROVAL_STATE_REFRESH_EVENT,
        handleApprovalStateRefresh as EventListener
      )
      window.addEventListener('focus', handleWindowFocus)
      window.addEventListener(
        GLOBAL_DATA_REFRESH_REQUEST_EVENT,
        handleGlobalDataRefreshRequest as EventListener
      )
      document.addEventListener('visibilitychange', handleVisibilityChange)
      startNotificationHeartbeat()

      // 2026-09-27 细粒度刷新：approval-notification 的全局刷新请求已由
      // websocket.ts 统一携带数据域分发，此处不再重复转发（避免无域事件
      // 抢占去重窗口、稀释域信息）。浏览器通知弹窗等副作用仍在 websocket.ts。
      approvalNotificationRefreshListener = null
      window.addEventListener('approval-notification', approvalNotificationRefreshListener)
    }

    if (authStore.isAuthenticated) {
      await orgStore.loadDepartments()
    }
  })

  onUnmounted(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener(
        APPROVAL_STATE_REFRESH_EVENT,
        handleApprovalStateRefresh as EventListener
      )
      window.removeEventListener('focus', handleWindowFocus)
      window.removeEventListener(
        GLOBAL_DATA_REFRESH_REQUEST_EVENT,
        handleGlobalDataRefreshRequest as EventListener
      )
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      stopNotificationHeartbeat()
      if (approvalNotificationRefreshListener) {
        window.removeEventListener('approval-notification', approvalNotificationRefreshListener)
        approvalNotificationRefreshListener = null
      }
    }
  })

  watch(
    () => authStore.isAuthenticated,
    async isAuth => {
      if (isAuth && !orgStore.loaded) {
        await orgStore.loadDepartments()
        void refreshNotificationState()
      } else if (isAuth) {
        void refreshNotificationState()
      }
    },
    { immediate: true }
  )

  const handleLogout = () => {
    authStore.logout()
  }

  return {
    isLoggedIn,
    currentUser,
    isStrategicDept,
    strategicDeptName,
    canAccessAdminConsole,
    handleLogout
  }
}
