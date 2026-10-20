<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, Close, Upload, RefreshLeft } from '@element-plus/icons-vue'
import type { ApprovalHistoryItem } from '@/shared/types'
import AppAvatar from '@/shared/ui/avatar/AppAvatar.vue'

const props = defineProps<{
  history: ApprovalHistoryItem[]
  // 审批类型：'distribution' = 下发审批, 'submission' = 审批流程
  approvalType?: 'distribution' | 'submission'
}>()

// 2026-10-20 用户定案：标签不再按「上报/下发」二选一硬编码。
// 下发审批历史沿用「下发审批」，其余统一显示「审批流程」——
// 审批实例详情弹窗里的历史可能是下发审批的，硬标「上报审批」会张冠李戴。
const approvalTypeLabel = computed(() => {
  return props.approvalType === 'distribution' ? '下发审批' : '审批流程'
})

const approvalTypeTagType = computed(() => {
  return props.approvalType === 'distribution' ? 'primary' : 'success'
})

const historySortOrder = ref<'asc' | 'desc'>('asc')

const sortedHistory = computed(() =>
  [...props.history].sort((a, b) => {
    const leftTime = new Date(a.operateTime).getTime()
    const rightTime = new Date(b.operateTime).getTime()

    return historySortOrder.value === 'asc' ? leftTime - rightTime : rightTime - leftTime
  })
)

const historySortOrderLabel = computed(() => {
  return historySortOrder.value === 'asc' ? '正序' : '倒序'
})

function toggleHistorySortOrder() {
  historySortOrder.value = historySortOrder.value === 'asc' ? 'desc' : 'asc'
}

const getActionIcon = (action: ApprovalHistoryItem['action']) => {
  switch (action) {
    case 'approve':
      return Check
    case 'reject':
      return Close
    case 'submit':
      return Upload
    case 'withdraw':
      return RefreshLeft
    default:
      return Check
  }
}

const getActionType = (action: ApprovalHistoryItem['action']) => {
  switch (action) {
    case 'approve':
      return 'success'
    case 'reject':
      return 'danger'
    case 'submit':
      return 'primary'
    case 'withdraw':
      return 'warning'
    default:
      return 'info'
  }
}

const getActionLabel = (action: ApprovalHistoryItem['action']) => {
  switch (action) {
    case 'approve':
      return '审批通过'
    case 'reject':
      return '审批驳回'
    case 'submit':
      return '提交审批'
    case 'withdraw':
      return '撤回申请'
    default:
      return action
  }
}

const getStepLabel = (item: ApprovalHistoryItem) => {
  return item.stepName?.trim() || '流程节点'
}

const formatTime = (date: Date) => {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
</script>

<template>
  <div class="approval-history">
    <div v-if="sortedHistory.length > 0" class="history-header">
      <div class="history-header-type">
        <ElTag v-if="approvalType" :type="approvalTypeTagType" size="small">
          {{ approvalTypeLabel }}
        </ElTag>
        <span class="history-header-desc">审批历史记录</span>
      </div>
      <ElButton type="primary" @click="toggleHistorySortOrder">
        {{ historySortOrderLabel }}
      </ElButton>
    </div>
    <el-timeline>
      <el-timeline-item
        v-for="item in sortedHistory"
        :key="item.id"
        :type="getActionType(item.action)"
        :icon="getActionIcon(item.action)"
        :timestamp="formatTime(item.operateTime)"
        placement="top"
      >
        <div class="history-item">
          <div class="history-header">
            <div class="history-operator">
              <AppAvatar
                :size="36"
                :src="item.operatorAvatar"
                :name="item.operatorName || '系统'"
                class="history-avatar"
              />
              <div class="history-operator-meta">
                <div class="history-operator-top">
                  <el-tag :type="getActionType(item.action)" size="small" effect="light">
                    {{ getActionLabel(item.action) }}
                  </el-tag>
                  <span class="operator-name">{{ item.operatorName }}</span>
                </div>
              </div>
            </div>
          </div>
          <p v-if="item.stepName" class="history-step">节点：{{ getStepLabel(item) }}</p>
          <p v-if="item.comment" class="history-comment">{{ item.comment }}</p>
        </div>
      </el-timeline-item>
    </el-timeline>

    <el-empty v-if="sortedHistory.length === 0" description="暂无审批记录" :image-size="60" />
  </div>
</template>

<style scoped>
.approval-history {
  padding: 8px 0;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.history-header-type {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  flex: 1;
}

.history-header-desc {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.history-item {
  padding: 8px 12px;
  background: var(--bg-light);
  border-radius: 8px;
}

.history-header {
  display: flex;
  align-items: center;
}

.history-operator {
  display: flex;
  align-items: center;
  gap: 12px;
}

.history-avatar {
  flex-shrink: 0;
}

.history-operator-meta {
  min-width: 0;
}

.history-operator-top {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.operator-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-main);
}

.history-step {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.history-comment {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

:deep(.el-timeline-item__timestamp) {
  font-size: 12px;
}
</style>
