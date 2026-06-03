<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElCard, ElSelect, ElOption, ElIcon, ElEmpty, ElMessage } from 'element-plus'
import { Check, Close, Loading, Clock, Edit } from '@element-plus/icons-vue'
import type { WorkflowNode, WorkflowNodeAttachment } from '@/shared/types'
import AppAvatar from '@/shared/ui/avatar/AppAvatar.vue'

/**
 * 自定义审批流程组件
 *
 * 功能：
 * - 数据驱动的审批流程展示
 * - 支持自定义审批人
 * - 支持保存审批模板
 * - 垂直时间轴展示
 * - 当前节点呼吸灯效果
 */

const props = withDefaults(
  defineProps<{
    // 审批节点列表
    nodes: WorkflowNode[]
    // 当前节点ID
    currentNodeId?: string
    // 驳回原因
    rejectionReason?: string
    // 是否允许自定义审批人
    allowCustomApprover?: boolean
    // 是否只读
    readonly?: boolean
    // 审批类型：'distribution' = 下发审批(我们审批下级), 'submission' = 上报审批(下级提交给我们审批)
    approvalType?: 'distribution' | 'submission'
  }>(),
  {
    currentNodeId: '',
    rejectionReason: '',
    allowCustomApprover: false,
    readonly: false,
    approvalType: 'submission'
  }
)

const emit = defineEmits<{
  // 添加节点
  (e: 'addNode'): void
  // 更新审批人
  (e: 'updateApprover', nodeId: string, approverId: string): void
  // 保存为模板
  (e: 'saveTemplate', templateName: string, steps: ApprovalTemplateStep[]): void
  // 应用模板
  (e: 'applyTemplate', templateId: string): void
  // 打开提交材料
  (e: 'openAttachment', attachment: WorkflowNodeAttachment): void
}>()

// ============ 状态 ============
const editingNode = ref<string | null>(null)
const customApprovers = ref<Record<string, string>>({})

// 模拟组织人员数据
const organizationUsers = ref([
  { id: 'user-001', name: '张主任', org: '战略发展部', role: 'strategic_dept' },
  { id: 'user-002', name: '李主任', org: '战略发展部', role: 'strategic_dept' },
  { id: 'user-003', name: '王校长', org: '校长办公室', role: 'strategic_dept' },
  { id: 'user-004', name: '赵处长', org: '教务处', role: 'functional_dept' },
  { id: 'user-005', name: '钱处长', org: '人事处', role: 'functional_dept' }
])

// 是否有驳回
const hasRejection = computed(() => {
  return props.nodes.some(n => n.status === 'rejected')
})

// 获取节点图标
const getNodeIcon = (status: WorkflowNode['status']) => {
  switch (status) {
    case 'completed':
      return Check
    case 'current':
      return Loading
    case 'rejected':
      return Close
    case 'withdrawn':
      return Close
    case 'waiting':
      return Clock
    default:
      return Clock
  }
}

// 获取节点状态类
const getNodeClass = (status: WorkflowNode['status']) => {
  return `node-${status}`
}

// 格式化时间
const formatTime = (date?: Date) => {
  if (!date) {
    return ''
  }
  const d = new Date(date)
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 检查节点是否可编辑
const canEditNode = (node: WorkflowNode) => {
  if (!props.allowCustomApprover || props.readonly) {
    return false
  }
  // 只能编辑当前或待处理的节点
  return node.status === 'current' || node.status === 'pending'
}

// 编辑审批人
const startEditApprover = (nodeId: string) => {
  editingNode.value = nodeId
}

// 确认审批人修改
const confirmApproverChange = (nodeId: string) => {
  const approverId = customApprovers.value[nodeId]
  if (approverId) {
    emit('updateApprover', nodeId, approverId)
    ElMessage.success('审批人已更新')
  }
  editingNode.value = null
}

// 取消编辑
const cancelEdit = (nodeId: string) => {
  delete customApprovers.value[nodeId]
  editingNode.value = null
}

const getCandidateAvatarText = (displayName?: string) => {
  if (!displayName) {
    return '无'
  }
  return displayName.slice(0, 1)
}

const shouldShowCandidateList = (node: WorkflowNode) => {
  return Array.isArray(node.approverCandidates) && node.approverCandidates.length > 0
}

const getOrSignLabel = (node: WorkflowNode) => {
  return shouldShowCandidateList(node) ? '或签' : ''
}

const getCandidateSummary = (node: WorkflowNode) => {
  const total = node.approverCandidates?.length || 0
  if (total <= 0) {
    return ''
  }
  return `${total}人审批中，1人同意即可通过，预计3小时完成`
}
</script>

<template>
  <div class="custom-approval-flow">
    <!-- 空状态 -->
    <div v-if="nodes.length === 0" class="empty-container">
      <el-empty description="暂无审批流程" />
    </div>

    <!-- 审批流程展示 -->
    <div v-else class="flow-content">
      <!-- 垂直时间轴式审批流程 -->
      <div class="approval-timeline">
        <div
          v-for="(node, index) in nodes"
          :key="node.id"
          :class="[
            'timeline-item',
            getNodeClass(node.status),
            { 'is-current': node.status === 'current', 'is-editing': editingNode === node.id }
          ]"
        >
          <!-- 节点图标 -->
          <div class="timeline-icon">
            <el-icon :is="getNodeIcon(node.status)" class="node-icon-inner" />
          </div>

          <!-- 连接线 -->
          <div v-if="index < nodes.length - 1" class="timeline-line"></div>

          <!-- 节点内容卡片 -->
          <div class="timeline-content">
            <ElCard class="node-card" shadow="hover">
              <!-- 卡片头部 -->
              <div class="node-header">
                <div class="node-title-row">
                  <span class="node-step">步骤 {{ index + 1 }}</span>
                  <span class="node-name">{{ node.name }}</span>
                  <span v-if="getOrSignLabel(node)" class="node-sign-mode">
                    {{ getOrSignLabel(node) }}
                  </span>
                </div>

                <!-- 当前节点标识 -->
                <ElTag
                  v-if="node.status === 'current'"
                  class="node-status-tag"
                  type="warning"
                  effect="light"
                  size="small"
                >
                  <el-icon class="pulse-icon"><Loading /></el-icon>
                  审批中
                </ElTag>
                <ElTag
                  v-else-if="node.status === 'completed'"
                  class="node-status-tag"
                  type="success"
                  effect="light"
                  size="small"
                >
                  <el-icon><Check /></el-icon>
                  已通过
                </ElTag>
                <ElTag
                  v-else-if="node.status === 'rejected'"
                  class="node-status-tag"
                  type="danger"
                  effect="light"
                  size="small"
                >
                  <el-icon><Close /></el-icon>
                  已驳回
                </ElTag>
                <ElTag
                  v-else-if="node.status === 'withdrawn'"
                  class="node-status-tag"
                  type="info"
                  effect="light"
                  size="small"
                >
                  <el-icon><Close /></el-icon>
                  已撤回
                </ElTag>
                <ElTag
                  v-else-if="node.status === 'waiting'"
                  class="node-status-tag"
                  type="info"
                  effect="light"
                  size="small"
                >
                  <el-icon><Clock /></el-icon>
                  等待中
                </ElTag>
                <ElTag v-else class="node-status-tag" type="warning" effect="light" size="small">
                  <el-icon><Clock /></el-icon>
                  审批中
                </ElTag>
              </div>

              <!-- 审批人信息 -->
              <div
                v-if="
                  (!shouldShowCandidateList(node) && (node.operatorName || node.operateTime)) ||
                  canEditNode(node)
                "
                class="node-approver"
              >
                <div v-if="node.operatorName || node.operateTime" class="approver-info">
                  <AppAvatar
                    :src="node.operatorAvatar"
                    :size="32"
                    :class="['approver-avatar', { 'is-placeholder': !node.operatorName }]"
                    :name="node.operatorName || '无'"
                  />
                  <div class="approver-details">
                    <span v-if="node.operatorName" class="approver-name">
                      {{ node.operatorName }}
                    </span>
                    <span v-if="node.operateTime" class="approve-time">
                      {{ formatTime(node.operateTime) }}
                    </span>
                  </div>
                </div>

                <!-- 自定义审批人按钮 -->
                <ElButton
                  v-if="canEditNode(node)"
                  :icon="editingNode === node.id ? Check : Edit"
                  size="small"
                  :type="editingNode === node.id ? 'success' : 'primary'"
                  link
                  @click="
                    editingNode === node.id
                      ? confirmApproverChange(node.id)
                      : startEditApprover(node.id)
                  "
                >
                  {{ editingNode === node.id ? '确认' : '修改审批人' }}
                </ElButton>
              </div>

              <div v-if="shouldShowCandidateList(node)" class="candidate-panel">
                <div class="candidate-panel-label">可审批成员</div>
                <div class="candidate-panel-summary">
                  {{ getCandidateSummary(node) }}
                </div>
                <div class="candidate-list">
                  <div
                    v-for="candidate in node.approverCandidates"
                    :key="`${node.id}-${candidate.userId || candidate.displayName}`"
                    :class="[
                      'candidate-item',
                      { 'is-approved': candidate.approved, 'is-rejected': candidate.rejected }
                    ]"
                  >
                    <div class="candidate-avatar-wrap">
                      <AppAvatar
                        :src="candidate.avatar"
                        :size="42"
                        class="candidate-avatar"
                        :name="candidate.displayName"
                      />
                      <span v-if="candidate.approved" class="candidate-approved-badge">
                        <el-icon><Check /></el-icon>
                      </span>
                      <span v-else-if="candidate.rejected" class="candidate-rejected-badge">
                        <el-icon><Close /></el-icon>
                      </span>
                    </div>
                    <div class="candidate-name">{{ candidate.displayName }}</div>
                    <div v-if="candidate.approved" class="candidate-state">已审批通过</div>
                    <div v-else-if="candidate.rejected" class="candidate-state is-rejected">
                      已审批驳回
                    </div>
                  </div>
                </div>
              </div>

              <!-- 审批意见 -->
              <div v-if="node.comment" class="node-comment">
                <div class="comment-label">审批意见：</div>
                <div class="comment-text">{{ node.comment }}</div>
              </div>

              <div v-if="node.attachments?.length" class="node-comment">
                <div class="comment-label">提交材料：</div>
                <div class="attachment-list">
                  <ElButton
                    v-for="attachment in node.attachments"
                    :key="`${node.id}-${attachment.attachmentId || attachment.url}`"
                    link
                    type="primary"
                    class="attachment-link"
                    @click="emit('openAttachment', attachment)"
                  >
                    {{ attachment.name }}
                  </ElButton>
                </div>
              </div>

              <!-- 编辑审批人选择器 -->
              <div v-if="editingNode === node.id" class="approver-selector">
                <ElSelect
                  v-model="customApprovers[node.id]"
                  placeholder="选择审批人"
                  filterable
                  class="approver-select"
                >
                  <ElOption
                    v-for="user in organizationUsers"
                    :key="user.id"
                    :label="`${user.name} - ${user.org}`"
                    :value="user.id"
                  >
                    <div class="user-option">
                      <AppAvatar :size="24" class="user-option-avatar" :name="user.name" />
                      <div class="user-option-info">
                        <span class="user-option-name">{{ user.name }}</span>
                        <span class="user-option-org">{{ user.org }}</span>
                      </div>
                    </div>
                  </ElOption>
                </ElSelect>
                <ElButton size="small" link type="info" @click="cancelEdit(node.id)">
                  取消
                </ElButton>
              </div>
            </ElCard>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-approval-flow {
  padding: 8px 0 16px;
}

.empty-container {
  padding: 40px 20px;
}

/* 审批时间轴 */
.approval-timeline {
  position: relative;
}

.timeline-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding-bottom: 24px;
}

.timeline-item:last-child {
  padding-bottom: 0;
}

.timeline-icon {
  position: relative;
  z-index: 2;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--el-fill-color-light);
  border: 2px solid var(--el-border-color);
  transition: all var(--transition-normal);
}

.timeline-item.node-completed .timeline-icon {
  background: var(--el-color-success-light-9);
  border-color: var(--el-color-success);
  color: var(--el-color-success);
}

.timeline-item.node-current .timeline-icon {
  background: var(--el-color-warning-light-9);
  border-color: var(--el-color-warning);
  color: var(--el-color-warning);
  animation: pulse 2s ease-in-out infinite;
}

.timeline-item.node-rejected .timeline-icon {
  background: var(--el-color-danger-light-9);
  border-color: var(--el-color-danger);
  color: var(--el-color-danger);
}

.timeline-item.node-withdrawn .timeline-icon,
.timeline-item.node-waiting .timeline-icon {
  background: var(--el-color-info-light-9);
  border-color: var(--el-color-info);
  color: var(--el-color-info);
}

@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(230, 162, 60, 0.4);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(230, 162, 60, 0);
  }
}

.node-icon-inner {
  font-size: 18px;
}

.timeline-line {
  position: absolute;
  left: 20px;
  top: 40px;
  bottom: -24px;
  width: 2px;
  background: var(--el-border-color-lighter);
  z-index: 1;
}

.timeline-item:last-child .timeline-line {
  display: none;
}

.timeline-item.node-completed .timeline-line {
  background: var(--el-color-success-light-7);
}

/* 内容卡片 */
.timeline-content {
  flex: 1;
  min-width: 0;
}

.node-card {
  transition: all var(--transition-normal);
}

.timeline-item.is-current .node-card {
  border-color: var(--el-color-warning);
  box-shadow: 0 0 0 1px var(--el-color-warning-light-7);
}

.timeline-item.is-editing .node-card {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 1px var(--el-color-primary-light-7);
}

/* 节点头部 */
.node-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}

.node-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.node-step {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  padding: 2px 8px;
  border-radius: 12px;
}

.node-name {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.node-sign-mode {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.12);
  color: #409eff;
  font-size: 12px;
  font-weight: 600;
}

.node-status-tag {
  flex-shrink: 0;
  margin-top: 2px;
  min-width: 104px;
  justify-content: center;
  white-space: nowrap;
}

.node-status-tag :deep(.el-tag__content) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  white-space: nowrap;
}

.approver-avatar.is-placeholder {
  background: var(--el-fill-color);
  color: var(--el-text-color-placeholder);
  border: 1px solid var(--el-border-color);
}

.pulse-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* 审批人信息 */
.node-approver {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: var(--el-fill-color-lighter);
  border-radius: var(--radius-sm);
  margin-bottom: 8px;
}

.approver-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.approver-avatar {
  background: var(--el-color-primary);
  color: var(--el-color-white);
}

.approver-details {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.approver-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.approve-time {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.candidate-panel {
  padding: 14px 16px;
  background: var(--el-fill-color-lighter);
  border-radius: var(--radius-sm);
  margin-bottom: 8px;
}

.candidate-panel-label {
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.candidate-panel-summary {
  margin-bottom: 14px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.candidate-list {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
}

.candidate-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 60px;
}

.candidate-avatar-wrap {
  position: relative;
}

.candidate-avatar {
  background: linear-gradient(135deg, #5ba7ff, #3b82f6);
  color: #fff;
  box-shadow: 0 6px 16px rgba(59, 130, 246, 0.2);
}

.candidate-approved-badge,
.candidate-rejected-badge {
  position: absolute;
  right: -4px;
  bottom: -2px;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #fff;
  border: 2px solid #fff;
  box-sizing: border-box;
}

.candidate-approved-badge {
  background: var(--el-color-success);
}

.candidate-rejected-badge {
  background: var(--el-color-danger);
}

.candidate-name {
  max-width: 74px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--el-text-color-primary);
  text-align: center;
  word-break: break-word;
}

.candidate-state {
  font-size: 12px;
  color: var(--el-color-success);
}

.candidate-state.is-rejected {
  color: var(--el-color-danger);
}

.candidate-item.is-approved .candidate-avatar {
  background: linear-gradient(135deg, #34c759, #22c55e);
  box-shadow: 0 8px 18px rgba(34, 197, 94, 0.22);
}

.candidate-item.is-rejected .candidate-avatar {
  background: linear-gradient(135deg, #ff8a8a, #f56c6c);
  box-shadow: 0 8px 18px rgba(245, 108, 108, 0.22);
}

/* 审批意见 */
.node-comment {
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border-radius: var(--radius-sm);
  margin-bottom: 8px;
}

.comment-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 4px;
}

.comment-text {
  font-size: 13px;
  color: var(--el-text-color-regular);
  line-height: 1.5;
}

.attachment-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-top: 8px;
}

.attachment-link {
  padding: 0;
}

/* 审批人选择器 */
.approver-selector {
  padding: 12px;
  background: var(--el-color-primary-light-9);
  border-radius: var(--radius-sm);
  display: flex;
  gap: 8px;
  align-items: center;
}

.approver-select {
  flex: 1;
}

.user-option {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-option-avatar {
  font-size: 12px;
  background: var(--el-color-primary);
  color: var(--el-color-white);
}

.user-option-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.user-option-name {
  font-size: 14px;
  font-weight: 500;
}

.user-option-org {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* 驳回提示 */
.rejection-alert {
  margin-top: 16px;
}

/* 模板列表 */
.template-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 400px;
  overflow-y: auto;
}

.template-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border: 2px solid var(--el-border-color);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.template-item:hover {
  border-color: var(--el-color-primary-light-5);
  background: var(--el-fill-color-lighter);
}

.template-item.is-selected {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.template-info {
  flex: 1;
}

.template-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.template-name {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.template-desc {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.template-steps {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.template-selected {
  color: var(--el-color-success);
}

.template-selected .el-icon {
  font-size: 20px;
}
</style>
