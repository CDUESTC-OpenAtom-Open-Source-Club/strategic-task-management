import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
  const route = useRoute()
  const messageStore = useMessageStore()

  // Issue #89 P2：铃铛角标改为与已读状态联动，避免「标为已读后角标恒定不减」。
  // 此前直接取 summary.totalCount：一旦本地已读状态与摘要口径出现短暂不一致
  // （标为已读回源窗口、旧构建的摘要缓存等），角标就会卡在旧值。
  // 消息列表已加载时以本地未读派生值（messageStore.unreadCount.all）为准——
  // 它直接来自每条消息的 isRead/readState，标记已读后立即响应；
  // 列表尚未加载完成时才回退到服务端摘要兜底。
  const unreadCount = computed(() => {
    if (messageStore.messages.length > 0) {
      return messageStore.unreadCount.all
    }
    return messageStore.totalCount
  })

  // Issue #89 P4：铃铛下拉改为受控开关。
  // 此前「查看全部消息」/消息卡片点击只会 router.push('/messages')：
  // 已停留在 /messages 时是重复导航（无任何视觉变化）且下拉不收起，
  // 表现为「按钮无响应」。现在点击后先收起下拉，再按需跳转。
  //
  // 注意：实测（element-plus 2.13.5）指针停留在弹层内容里时，
  // 仅靠 v-model:visible=false 无法收起 hover 触发的弹层（内部触发态会回写 true），
  // 因此额外用 popper-class 的 --hidden 强制隐藏；重新 hover 时可见性恢复，类自动移除。
  const notificationPreviewVisible = ref(false)

  const closeNotificationPreview = () => {
    notificationPreviewVisible.value = false
  }

  const notificationPreviewPopperClass = computed(() =>
    notificationPreviewVisible.value
      ? 'notification-preview-popper'
      : 'notification-preview-popper notification-preview-popper--hidden'
  )

  const handleViewAllMessages = () => {
    closeNotificationPreview()
    if (route.path !== '/messages') {
      router.push('/messages')
    }
  }

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
    // Issue #89 P4：无论点的是消息卡片还是铃铛本体，先收起下拉再跳转
    closeNotificationPreview()

    if (approvalCenterVisible.value) {
      toggleApprovalCenter(null)
    }

    if (message) {
      // 2026-10-19 用户定案：铃铛里「待审批」与「普通通知」都要能跳到对应看板并
      // 自动打开审批中心——通知类（通过/回退/流程推进）同样携带审批实例，
      // 用户点开就能看到该实例的完整审批看板，而不是只落在消息中心列表。
      const hasApprovalContext =
        (message.approvalInstanceId !== undefined && message.approvalInstanceId !== null) ||
        Boolean(message.entityType && message.entityId)

      if (!hasApprovalContext) {
        // 无审批上下文的纯系统/催办通知：仍进消息中心
        // （Issue #89 P4：已在 /messages 时无需重复导航，收起下拉即可）
        if (route.path !== '/messages') {
          router.push('/messages')
        }
        return
      }

      // 2026-10-24（铃铛跳转修复）：上报审批（PLAN_REPORT）的 source/target 是
      // 「下发方向」（教务处 -> 计算机学院），上报是反方向——提交方=targetOrg。
      // departmentName 必须带提交方组织名，/distribution 深链靠它自动选中对应学院。
      const entityTypeUpper = String(message.entityType || '')
        .trim()
        .toUpperCase()
      const sourceOrgName = getMessageMetadataValue(message, 'sourceOrgName') || null
      const targetOrgName = getMessageMetadataValue(message, 'targetOrgName') || null
      const payload = {
        approvalInstanceId: message.approvalInstanceId,
        entityType: message.entityType,
        entityId: message.entityId,
        actionUrl: message.actionUrl,
        viewerRole: authStore.effectiveRole || authStore.userRole,
        departmentName:
          entityTypeUpper === 'PLAN_REPORT'
            ? targetOrgName || sourceOrgName || ''
            : targetOrgName || sourceOrgName || '',
        sourceOrgName,
        targetOrgName,
        currentDepartmentName:
          (typeof authStore.user?.orgName === 'string' && authStore.user.orgName.trim()) || null
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

    // Issue #89 P4：已在 /messages 时（如直接点铃铛本体）不再重复导航
    if (route.path !== '/messages') {
      router.push('/messages')
    }
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
    notificationPreviewVisible,
    notificationPreviewPopperClass,
    handleNotificationHover,
    handleNotificationClick,
    handleViewAllMessages,
    formatNotificationTime,
    resolveNotificationApprovalRoute,
    Bell
  }
}
