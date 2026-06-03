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

const GLOBAL_DATA_REFRESH_INTERVAL_MS = 3 * 60 * 1000
const ATTENTION_REFRESH_COOLDOWN_MS = 45 * 1000
let globalDataRefreshTimer: ReturnType<typeof setInterval> | null = null
let approvalNotificationRefreshListener: EventListener | null = null
let lastAttentionRefreshAt = 0

export function useAppLayout() {
  const authStore = useAuthStore()
  const orgStore = useOrgStore()
  const messageStore = useMessageStore()
  const approvalStore = useApprovalStore()

  const isLoggedIn = computed(() => authStore.isAuthenticated)
  const currentUser = computed(() => authStore.user)
  const isStrategicDept = computed(() => authStore.userRole === 'strategic_dept')
  const strategicDeptName = computed(() => orgStore.getStrategicDeptName())
  const canAccessAdminConsole = computed(() => hasAdminConsoleAccess(authStore.user))

  const refreshNotificationState = async () => {
    await Promise.all([messageStore.refreshMessageCenter(), approvalStore.loadPendingApprovals()])
  }

  const refreshPendingApprovalState = async () => {
    await Promise.all([messageStore.refreshMessageCenter(), approvalStore.loadPendingApprovals()])
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
      void refreshPendingApprovalState()
      return
    }

    void messageStore.refreshMessageCenter()
  }

  const handleApprovalStateRefresh = () => {
    void refreshPendingApprovalState()
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

  const startGlobalDataRefreshTimer = () => {
    if (globalDataRefreshTimer || typeof window === 'undefined') {
      return
    }

    globalDataRefreshTimer = setInterval(() => {
      if (!authStore.isAuthenticated || document.hidden) {
        return
      }
      requestGlobalDataRefresh({ source: 'heartbeat', silent: true })
    }, GLOBAL_DATA_REFRESH_INTERVAL_MS)
  }

  const stopGlobalDataRefreshTimer = () => {
    if (globalDataRefreshTimer) {
      clearInterval(globalDataRefreshTimer)
      globalDataRefreshTimer = null
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

    startGlobalDataRefreshTimer()
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
    stopGlobalDataRefreshTimer()
  })

  watch(
    () => authStore.isAuthenticated,
    async isAuth => {
      if (isAuth && !orgStore.loaded) {
        await orgStore.loadDepartments()
        void refreshNotificationState()
        startGlobalDataRefreshTimer()
      } else if (isAuth && orgStore.loaded && messageStore.messages.length === 0) {
        void refreshNotificationState()
        startGlobalDataRefreshTimer()
      } else if (isAuth) {
        void refreshPendingApprovalState()
        startGlobalDataRefreshTimer()
      } else {
        stopGlobalDataRefreshTimer()
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
