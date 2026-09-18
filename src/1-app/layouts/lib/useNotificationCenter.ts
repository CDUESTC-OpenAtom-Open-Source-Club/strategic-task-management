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

  // P7：铃铛点击直达审批中心（有可打开的审批上下文时）；
  // 否则退回消息中心。审批中心为 AppLayout 全局抽屉，红点/未读数不变。
  const { toggleApprovalCenter, approvalCenterVisible } = useApprovalCenter()

  const handleNotificationClick = () => {
    if (!approvalCenterVisible.value) {
      toggleApprovalCenter(null)
      return
    }
    toggleApprovalCenter(null)
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
