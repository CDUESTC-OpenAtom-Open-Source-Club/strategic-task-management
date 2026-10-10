import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Bell } from '@element-plus/icons-vue'
import type { Message } from '@/shared/types'
import { useApprovalCenter } from '@/features/approval/lib/useApprovalCenter'
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
  const pendingApprovalPreviewMessages = computed(() =>
    messageStore.approvalMessages
      .filter(
        message =>
          message.bizType === 'APPROVAL_TODO' ||
          message.actionState === 'ACTION_REQUIRED' ||
          message.canProcess
      )
      .slice(0, 3)
  )
  const hasPendingApprovalPreviewMessages = computed(
    () => pendingApprovalPreviewMessages.value.length > 0
  )
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

  const handleNotificationClick = (message?: Message) => {
    if (approvalCenterVisible.value) {
      toggleApprovalCenter(null)
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
    pendingApprovalPreviewMessages,
    hasPendingApprovalPreviewMessages,
    notificationPreviewLoading,
    handleNotificationHover,
    handleNotificationClick,
    formatNotificationTime,
    resolveNotificationApprovalRoute,
    Bell
  }
}
