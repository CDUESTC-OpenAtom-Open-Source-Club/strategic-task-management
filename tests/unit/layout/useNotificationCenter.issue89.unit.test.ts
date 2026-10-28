/**
 * Issue #89 消息中心修复的单元测试
 *
 * P2：铃铛角标必须与已读状态联动——消息列表已加载时角标 = 本地未读派生值
 *     （messageStore.unreadCount.all），而非可能滞后的 summary.totalCount；
 *     列表未加载时回退 summary 兜底。
 * P4：铃铛下拉「查看全部消息」/消息卡片点击——先收起下拉；
 *     已停留在 /messages 时不再重复 router.push。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'

type StoreMessage = {
  id: string
  bizType: string
  isRead: boolean
  readState?: string
  actionState?: string
  canMarkAsRead?: boolean
  title?: string
  content?: string
  createdAt?: string
}

const routerPush = vi.fn()
let currentRoutePath = '/dashboard'

const approvalCenterVisible = ref(false)

const messageStoreState = {
  raw: reactive([] as StoreMessage[]),
  serverTotalCount: 0
}

// 真实场景是 Pinia store（响应式），这里用 reactive 复刻同样的响应式行为
const messageStore = reactive({
  get messages() {
    return messageStoreState.raw
  },
  get totalCount() {
    return messageStoreState.serverTotalCount
  },
  get unreadCount() {
    const raw = messageStoreState.raw
    const todo = raw.filter(
      m => m.bizType === 'APPROVAL_TODO' || m.actionState === 'ACTION_REQUIRED'
    ).length
    const unreadResult = raw.filter(m => m.bizType === 'APPROVAL_RESULT' && !m.isRead).length
    const reminder = raw.filter(m => m.bizType === 'REMINDER_NOTICE' && !m.isRead).length
    const system = raw.filter(
      m => (m.bizType === 'SYSTEM_NOTICE' || m.bizType === 'BUSINESS_NOTICE') && !m.isRead
    ).length
    const alert = raw.filter(m => m.bizType === 'RISK_ALERT' && !m.isRead).length
    return {
      all: todo + unreadResult + reminder + system + alert,
      todo,
      approvals: todo + unreadResult,
      reminders: reminder,
      system,
      alerts: alert
    }
  },
  initializeMessages: vi.fn()
})

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush }),
  useRoute: () => ({
    get path() {
      return currentRoutePath
    }
  })
}))

vi.mock('@/features/approval', () => ({
  useApprovalCenter: () => ({
    toggleApprovalCenter: vi.fn(),
    approvalCenterVisible,
    openApprovalCenter: vi.fn()
  })
}))

vi.mock('@/features/approval/lib/approvalNotifications', () => ({
  resolveApprovalRoute: vi.fn(() => null)
}))

vi.mock('@/features/auth/model/store', () => ({
  useAuthStore: () => ({
    effectiveRole: 'strategic_dept',
    userRole: 'strategic_dept',
    user: { orgName: '战略发展部' }
  })
}))

vi.mock('@/features/messages/model/message', () => ({
  useMessageStore: () => messageStore
}))

vi.mock('@/shared/lib/utils', () => ({
  formatDateTime: vi.fn((value: unknown) => String(value))
}))

import { useNotificationCenter } from '../../../src/1-app/layouts/lib/useNotificationCenter'

function seedMessages() {
  messageStoreState.raw.splice(
    0,
    messageStoreState.raw.length,
    {
      id: '1',
      bizType: 'APPROVAL_RESULT',
      isRead: false,
      title: '计划审批已通过 A',
      createdAt: '2026-10-21T10:00:00Z'
    },
    {
      id: '2',
      bizType: 'APPROVAL_RESULT',
      isRead: false,
      title: '计划审批已通过 B',
      createdAt: '2026-10-21T11:00:00Z'
    },
    {
      id: '3',
      bizType: 'APPROVAL_RESULT',
      isRead: true,
      readState: 'READ',
      title: '计划审批已通过 C',
      createdAt: '2026-10-20T09:00:00Z'
    },
    {
      id: '4',
      bizType: 'APPROVAL_TODO',
      isRead: false,
      title: '待审批：测试计划',
      createdAt: '2026-10-22T09:00:00Z'
    },
    {
      id: '5',
      bizType: 'REMINDER_NOTICE',
      isRead: false,
      title: '催办',
      createdAt: '2026-10-22T08:00:00Z'
    }
  )
}

describe('useNotificationCenter —— Issue #89 P2 铃铛角标与已读状态联动', () => {
  beforeEach(() => {
    messageStoreState.raw.splice(0, messageStoreState.raw.length)
    messageStoreState.serverTotalCount = 0
    currentRoutePath = '/dashboard'
    approvalCenterVisible.value = false
    routerPush.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('消息列表已加载时，角标取本地未读派生值而不是 summary.totalCount（修复恒为 19）', () => {
    seedMessages()
    messageStoreState.serverTotalCount = 19

    const { unreadCount } = useNotificationCenter()

    // 本地口径：2 条未读审批结果 + 1 条待审批（恒未读） + 1 条未读催办 = 4
    expect(unreadCount.value).toBe(4)
    expect(unreadCount.value).not.toBe(19)
  })

  it('消息列表未加载时，回退 summary.totalCount 兜底', () => {
    messageStoreState.raw.splice(0, messageStoreState.raw.length)
    messageStoreState.serverTotalCount = 19

    const { unreadCount } = useNotificationCenter()

    expect(unreadCount.value).toBe(19)
  })

  it('标记已读后角标立即递减（本地已读状态变化直接反映到角标）', () => {
    seedMessages()
    messageStoreState.serverTotalCount = 19

    const { unreadCount } = useNotificationCenter()
    expect(unreadCount.value).toBe(4)

    const target = messageStoreState.raw.find(m => m.id === '1')
    if (target) {
      target.isRead = true
      target.readState = 'READ'
    }

    expect(unreadCount.value).toBe(3)
  })
})

describe('useNotificationCenter —— Issue #89 P4 铃铛下拉跳转/收起', () => {
  beforeEach(() => {
    messageStoreState.raw.splice(0, messageStoreState.raw.length)
    messageStoreState.serverTotalCount = 0
    currentRoutePath = '/dashboard'
    approvalCenterVisible.value = false
    routerPush.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('handleViewAllMessages：不在 /messages 时收起下拉并跳转', () => {
    currentRoutePath = '/dashboard'
    const { handleViewAllMessages, notificationPreviewVisible } = useNotificationCenter()
    notificationPreviewVisible.value = true

    handleViewAllMessages()

    expect(notificationPreviewVisible.value).toBe(false)
    expect(routerPush).toHaveBeenCalledTimes(1)
    expect(routerPush).toHaveBeenCalledWith('/messages')
  })

  it('handleViewAllMessages：已在 /messages 时只收起下拉，不重复导航（修复无响应）', () => {
    currentRoutePath = '/messages'
    const { handleViewAllMessages, notificationPreviewVisible } = useNotificationCenter()
    notificationPreviewVisible.value = true

    handleViewAllMessages()

    expect(notificationPreviewVisible.value).toBe(false)
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('handleNotificationClick：收起下拉；已在 /messages 且无消息时不再重复 push', () => {
    currentRoutePath = '/messages'
    const { handleNotificationClick, notificationPreviewVisible } = useNotificationCenter()
    notificationPreviewVisible.value = true

    handleNotificationClick()

    expect(notificationPreviewVisible.value).toBe(false)
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('handleNotificationClick：不在 /messages 时跳转消息中心', () => {
    currentRoutePath = '/dashboard'
    const { handleNotificationClick, notificationPreviewVisible } = useNotificationCenter()
    notificationPreviewVisible.value = true

    handleNotificationClick()

    expect(notificationPreviewVisible.value).toBe(false)
    expect(routerPush).toHaveBeenCalledWith('/messages')
  })

  it('handleNotificationClick：无审批上下文的消息在 /messages 页只收起下拉', () => {
    currentRoutePath = '/messages'
    const { handleNotificationClick } = useNotificationCenter()

    handleNotificationClick({
      id: '9',
      type: 'system',
      title: '系统通知',
      content: '',
      isRead: false,
      createdAt: new Date(),
      bizType: 'SYSTEM_NOTICE'
    } as never)

    expect(routerPush).not.toHaveBeenCalled()
  })
})
