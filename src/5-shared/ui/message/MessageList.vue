<template>
  <div class="message-list">
    <div v-if="messages.length === 0" class="empty-state">
      <el-empty :description="emptyDescription" />
    </div>

    <div v-else class="messages">
      <div
        v-for="message in messages"
        :key="message.id"
        :class="['message-item', { unread: isHighlighted(message) }]"
        @click="handleMessageClick(message)"
      >
        <div class="unread-indicator" :class="getIndicatorClass(message)"></div>

        <div class="message-body">
          <div class="message-header">
            <div class="message-type">
              <el-tag :type="getMessageTagType(message)" size="small">
                {{ getMessageTagLabel(message) }}
              </el-tag>
              <el-tag
                v-if="message.severity"
                :type="getSeverityTag(message.severity)"
                size="small"
                class="severity-tag"
              >
                {{ getSeverityLabel(message.severity) }}
              </el-tag>
            </div>
            <div class="message-time">
              <el-tooltip :content="formatDateTime(message.createdAt)" placement="top">
                <span>{{ getRelativeTime(message.createdAt) }}</span>
              </el-tooltip>
            </div>
          </div>

          <div class="message-title">{{ message.title }}</div>
          <div class="message-content">{{ message.content }}</div>

          <div v-if="isApprovalType(message)" class="message-extra approval-meta">
            <span v-if="getApprovalCurrentStepDisplay(message)">
              当前环节：{{ getApprovalCurrentStepDisplay(message) }}
            </span>
            <span v-if="getApprovalDepartmentDisplay(message)">
              审批中部门：{{ getApprovalDepartmentDisplay(message) }}
            </span>
            <span v-if="getApprovalRouteDisplay(message)">
              审批流向：{{ getApprovalRouteDisplay(message) }}
            </span>
          </div>

          <div v-else-if="message.currentStepName || message.senderDisplay" class="message-extra">
            <span v-if="message.currentStepName">当前环节：{{ message.currentStepName }}</span>
            <span v-if="message.senderDisplay">来源：{{ message.senderDisplay }}</span>
          </div>

          <div class="message-actions">
            <el-button
              v-if="message.canMarkAsRead && !message.isRead"
              type="primary"
              size="small"
              @click.stop="markAsRead(message.id)"
            >
              标为已读
            </el-button>
            <el-button size="small" @click.stop="viewDetails(message)"> 查看详情 </el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { formatDateTime } from '@/shared/lib/utils'
import type { Message } from '@/shared/types'
import {
  getApprovalCurrentStepDisplay,
  getApprovalDepartmentDisplay,
  getApprovalRouteDisplay
} from './approvalMessageDisplay'

interface Props {
  messages: Message[]
  emptyDescription?: string
}

interface Emits {
  (e: 'read', messageId: string): void
  (e: 'view', message: Message): void
}

withDefaults(defineProps<Props>(), {
  emptyDescription: '暂无消息'
})

const emit = defineEmits<Emits>()

const getMessageTagType = (message: Message): string => {
  if (message.bizType === 'APPROVAL_TODO') {
    return 'warning'
  }
  if (message.type === 'reminder') {
    return 'primary'
  }
  if (message.type === 'alert') {
    return 'danger'
  }
  return 'info'
}

const getMessageTagLabel = (message: Message): string => {
  if (message.bizType === 'APPROVAL_TODO') {
    return '待处理'
  }
  if (message.type === 'approval') {
    return '审批'
  }
  if (message.type === 'reminder') {
    return '催办'
  }
  if (message.type === 'alert') {
    return '风险'
  }
  return '系统'
}

const getSeverityTag = (severity: NonNullable<Message['severity']>): string => {
  switch (severity) {
    case 'severe':
      return 'danger'
    case 'moderate':
      return 'warning'
    default:
      return 'success'
  }
}

const getSeverityLabel = (severity: NonNullable<Message['severity']>): string => {
  switch (severity) {
    case 'severe':
      return '严重'
    case 'moderate':
      return '一般'
    default:
      return '普通'
  }
}

const isHighlighted = (message: Message): boolean =>
  message.bizType === 'APPROVAL_TODO' || !message.isRead

const getIndicatorClass = (message: Message): string => {
  if (message.bizType === 'APPROVAL_TODO') {
    return 'indicator-warning'
  }
  if (message.type === 'reminder') {
    return 'indicator-primary'
  }
  if (message.type === 'alert') {
    return 'indicator-danger'
  }
  return message.isRead ? 'indicator-neutral' : 'indicator-info'
}

const getRelativeTime = (date: Date): string => {
  const now = new Date()
  const diff = now.getTime() - new Date(date).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) {
    return '刚刚'
  }
  if (minutes < 60) {
    return `${minutes}分钟前`
  }
  if (hours < 24) {
    return `${hours}小时前`
  }
  if (days < 7) {
    return `${days}天前`
  }
  if (days < 30) {
    return `${Math.floor(days / 7)}周前`
  }
  return formatDateTime(date)
}

const isApprovalType = (message: Message): boolean =>
  message.bizType === 'APPROVAL_TODO' ||
  message.bizType === 'APPROVAL_RESULT' ||
  message.type === 'approval'

const handleMessageClick = (message: Message) => {
  emit('view', message)
}

const markAsRead = (messageId: string) => {
  emit('read', messageId)
}

const viewDetails = (message: Message) => {
  emit('view', message)
}
</script>

<style scoped>
.message-list {
  min-height: 300px;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 0;
}

.messages {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message-item {
  display: flex;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--bg-white);
  transition: all 0.2s ease;
  cursor: pointer;
}

.message-item:hover {
  border-color: var(--color-primary);
  transform: translateY(-1px);
  box-shadow: var(--shadow-hover);
}

.message-item.unread {
  background: var(--bg-light);
}

.unread-indicator {
  width: 4px;
  flex-shrink: 0;
}

.indicator-danger {
  background: linear-gradient(180deg, var(--color-danger) 0%, #fca5a5 100%);
}

.indicator-warning {
  background: linear-gradient(180deg, var(--color-warning) 0%, #f6c76f 100%);
}

.indicator-primary {
  background: linear-gradient(180deg, var(--color-primary) 0%, #79bbff 100%);
}

.indicator-info {
  background: linear-gradient(180deg, var(--color-primary) 0%, #93c5fd 100%);
}

.indicator-neutral {
  background: #e5e7eb;
}

.message-body {
  flex: 1;
  padding: 16px 18px;
}

.message-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 10px;
}

.message-type {
  display: flex;
  align-items: center;
  gap: 8px;
}

.message-time {
  font-size: 12px;
  color: var(--text-secondary);
}

.message-title {
  margin-bottom: 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-main);
}

.message-content {
  margin-bottom: 10px;
  color: var(--text-regular);
  line-height: 1.6;
}

.message-extra {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

.message-extra.approval-meta {
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.message-actions {
  display: flex;
  gap: 8px;
}
</style>
