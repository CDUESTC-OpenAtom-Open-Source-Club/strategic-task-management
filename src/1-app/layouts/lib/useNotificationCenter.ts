import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Bell } from '@element-plus/icons-vue'
import type { Message } from '@/shared/types'
import { useApprovalCenter } from '@/features/approval/lib/useApprovalCenter'
import { resolveApprovalRoute } from '@/features/approval/lib/approvalNotifications'
import { useAuthStore } from '@/features/auth/model/store'
import { useMessageStore } from '@/features/messages/model/message'
import { formatDateTime } from '@/shared/lib/utils'

function getMessageMetadataValue(message: Message, key: string): string {
  const value = message.metadata?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function useNotificationCenter() {
  const router = useRouter()
  const messageStore = useMessageStore()

  const unreadCount = computed(() => messageStore.totalCount)
  // 2026-10-10 测试报告 N7 修复：铃铛悬浮面板改为「全部未读消息」——
  // 此前只显示待审批消息，无待审批时面板空白但角标有数，造成困扰。
  // 排序：待审批（ACTION_REQUIRED）优先置顶，其余未读按时间倒序；前端滚动查看更多。
  const unreadPreviewMessages = computed(() => {
    const unread = messageStore.messages.filter(
      message => message.isRead === false || message.readState === 'UNREAD'
    )
    const isApprovalTodo = (message: (typeof unread)[number]) =>
      message.bizType === 'APPROVAL_TODO' ||
      message.actionState === 'ACTION_REQUIRED' ||
      message.canProcess === true
    return [...unread]
      .sort((left, right) => {
        const leftApproval = isApprovalTodo(left) ? 1 : 0
        const rightApproval = isApprovalTodo(right) ? 1 : 0
        if (leftApproval !== rightApproval) {
          return rightApproval - leftApproval
        }
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      })
      .map(message => ({
        ...message,
        approvalTodo: isApprovalTodo(message)
      }))
  })
  const hasUnreadPreviewMessages = computed(() => unreadPreviewMessages.value.length > 0)
  const notificationPreviewLoading = computed(() => messageStore.loading)

  const handleNotificationHover = () => {
    if (!messageStore.loading && messageStore.messages.length === 0) {
      messageStore.initializeMessages()
    }
  }

  // 2026-09-27 用户反馈：点击铃铛应直接进入消息中心，
  // 之前首次点击会打开审批中心抽屉、需点两次才能到消息中心。
  // 2026-10-07：点击悬浮的某条待审批消息时携带其审批实例 ID，
  // 消息中心落地后自动打开对应审批，无需在列表中再找一遍。
  const { toggleApprovalCenter, approvalCenterVisible } = useApprovalCenter()

  const authStore = useAuthStore()

  const handleNotificationClick = (message?: Message) => {
    if (approvalCenterVisible.value) {
      toggleApprovalCenter(null)
    }

    if (message) {
      // 2026-10-18 用户反馈：铃铛「待审批」卡片应像其他入口一样，
      // 跳到「对应的看板界面」并自动打开审批中心，而不是永远落在消息中心页。
      // 已处理的通知（通过/驳回）仍落在消息中心查看详情，避免跳去没有待办的工作台。
      const isApprovalTodo =
        message.bizType === 'APPROVAL_TODO' ||
        message.actionState === 'ACTION_REQUIRED' ||
        message.canProcess === true

      if (!isApprovalTodo) {
        const approvalInstanceId = message.approvalInstanceId
        if (approvalInstanceId !== undefined && approvalInstanceId !== null) {
          router.push({
            path: '/messages',
            query: { approvalInstanceId: String(approvalInstanceId) }
          })
          return
        }
        router.push('/messages')
        return
      }

      const payload = {
        approvalInstanceId: message.approvalInstanceId,
        entityType: message.entityType,
        entityId: message.entityId,
        actionUrl: message.actionUrl,
        viewerRole: authStore.effectiveRole || authStore.userRole,
        departmentName:
          getMessageMetadataValue(message, 'targetOrgName') ||
          getMessageMetadataValue(message, 'sourceOrgName') ||
          '',
        sourceOrgName: getMessageMetadataValue(message, 'sourceOrgName') || null,
        targetOrgName: getMessageMetadataValue(message, 'targetOrgName') || null
      }
      const workbenchRoute = resolveApprovalRoute(payload)
      if (workbenchRoute) {
        router.push(workbenchRoute)
        return
      }
    }

    const approvalInstanceId = message?.approvalInstanceId
    if (approvalInstanceId !== undefined && approvalInstanceId !== null) {
      router.push({
        path: '/messages',
        query: { approvalInstanceId: String(approvalInstanceId) }
      })
      return
    }

    router.push('/messages')
  }

  const formatNotificationTime = (date: Date | string) => formatDateTime(date)

  const resolveNotificationApprovalRoute = (message: Message) => {
    const sourceOrgName = getMessageMetadataValue(message, 'sourceOrgName')
    const targetOrgName = getMessageMetadataValue(message, 'targetOrgName')

    if (sourceOrgName && targetOrgName) {
      return `${sourceOrgName} -> ${targetOrgName}`
    }

    return sourceOrgName || targetOrgName || ''
  }

  return {
    unreadCount,
    unreadPreviewMessages,
    hasUnreadPreviewMessages,
    notificationPreviewLoading,
    handleNotificationHover,
    handleNotificationClick,
    formatNotificationTime,
    resolveNotificationApprovalRoute,
    Bell
  }
}
