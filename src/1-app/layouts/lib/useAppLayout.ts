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
let approvalNotificationRefreshListener: EventListener | null = null
let lastAttentionRefreshAt = 0
let messageRefreshInFlight: Promise<unknown> | null = null
let approvalRefreshInFlight: Promise<unknown> | null = null

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

  const handleApprovalStateRefresh = () => {
    void refreshNotificationState()
    requestGlobalDataRefresh({ source: 'approval-state-refresh', silent: true })
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

      approvalNotificationRefreshListener = (() => {
        requestGlobalDataRefresh({ source: 'approval-notification', silent: false })
      }) as EventListener
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
