<script setup lang="ts">
import { computed } from 'vue'
import { Document, User, Timer, Right } from '@element-plus/icons-vue'
import ApprovalHistory from './ApprovalHistory.vue'
import CustomApprovalFlow from './CustomApprovalFlow.vue'
import {
  useApprovalProgressDrawer,
  type ApprovalProgressDrawerEmit,
  type ApprovalProgressDrawerProps
} from '@/3-features/approval/model/useApprovalProgressDrawer'

const props = withDefaults(defineProps<ApprovalProgressDrawerProps>(), {
  modelValue: false,
  indicators: () => [],
  plan: null,
  initialPlanWorkflowDetail: null,
  indicatorId: undefined,
  departmentName: '',
  planName: '',
  showApprovalSection: true,
  showPlanApprovals: false,
  readonly: false,
  approvalType: 'submission',
  historyViewMode: 'auto',
  workflowCode: '',
  workflowEntityType: 'PLAN',
  workflowEntityId: undefined,
  secondaryWorkflowEntityType: undefined,
  secondaryWorkflowEntityId: undefined,
  routeTarget: '',
  showRouteButton: true,
  planReportSummary: null
})

const emit = defineEmits<ApprovalProgressDrawerEmit>()

const {
  INDICATOR_DISPATCH_APPROVE_PERMISSION,
  INDICATOR_REPORT_APPROVE_PERMISSION,
  PLAN_DISPATCH_APPROVE_PERMISSION,
  PLAN_REPORT_APPROVE_PERMISSION,
  activePlanWorkflow,
  activeTab,
  applyOptimisticPlanWorkflowPatch,
  approvalHistory,
  approvedCount,
  authStore,
  buildWorkflowNodeCandidates,
  cacheSubmitterName,
  cacheWorkflowUserAvatar,
  canCurrentUserHandlePlanApproval,
  canLookupWorkflowUsers,
  currentDetailWorkflow,
  currentIndicator,
  currentNodeId,
  currentPendingPlanTask,
  currentPlanApprovalItems,
  currentPlanApprovalSummary,
  currentPlanEntityIds,
  currentPlanInstanceId,
  currentPlanInstanceStatus,
  currentPlanOperationLabel,
  currentPlanStepDisplay,
  currentPlanTaskId,
  currentUserId,
  currentUserOrgId,
  currentUserPermissionCodes,
  currentUserRoleCodes,
  detailDialogStatusTag,
  displayedBusinessAttachmentLabel,
  displayedBusinessCommentLabel,
  displayedBusinessEmptyAttachmentText,
  displayedBusinessEmptyCommentText,
  displayedBusinessIndicatorItems,
  displayedBusinessProgressLabel,
  displayedBusinessSectionSubtitle,
  displayedBusinessSectionTitle,
  displayedBusinessSummaryComment,
  displayedDistributionIndicatorItems,
  ensureSubmitterNameLoaded,
  ensureWorkflowRelatedAvatarsLoaded,
  ensureWorkflowUserAvatarLoaded,
  expectedWorkflowCodes,
  formatTime,
  getFallbackSubmitterValue,
  getFunctionalStatus,
  getRetainedWorkflowDetail,
  getStrategicStatus,
  handleAddNode,
  handleApplyTemplate,
  handleApprovePlanBatch,
  handleClose,
  handleWorkflowNodeAttachmentOpen,
  handleRejectPlanBatch,
  handleSaveTemplate,
  handleUpdateApprover,
  hasApprovalData,
  hasDisplayableApprovalContent,
  hasPlanApprovalPermission,
  hasPlanWorkflowData,
  hasWorkflowTabContent,
  historicalPlanApprovalItems,
  historyInstanceDetailCache,
  historyTargets,
  isDistributionFlow,
  isPlanCompletedApproval,
  isPlanHistoryOnlyMode,
  isPlanPendingApproval,
  isPlanWorkflowTerminated,
  isRetainableWorkflowDetail,
  isSubmissionFlow,
  isTerminalHistoryStatus,
  latestPlanTask,
  latestPlanTaskDisplayLabel,
  loadPendingPlanApprovals,
  loadPlanWorkflowDetail,
  loadPlanWorkflowHistoryCards,
  loadSelectedHistoryInstanceDetail,
  loadWorkflowDefinitionPreview,
  mapWorkflowTaskStatusToNodeStatus,
  matchesExpectedWorkflowCode,
  navigateToPendingPlanApproval,
  navigateToRouteTarget,
  normalizeDisplayName,
  normalizeStepMatchKey,
  normalizeWorkflowAction,
  normalizeWorkflowCode,
  normalizeWorkflowEntityType,
  normalizeWorkflowStatus,
  normalizedPlanBusinessStatus,
  normalizedRouteTarget,
  openPlanApprovalDetails,
  parsePositiveEntityId,
  parsePositiveUserId,
  pendingCount,
  pendingPlanApprovalPreviewItems,
  pendingPlanApprovals,
  planDetailContentLoading,
  planApprovalsLoading,
  planDetailDialogVisible,
  planStore,
  planSubmitterName,
  planWorkflowDetail,
  planWorkflowHistory,
  planWorkflowHistoryCards,
  planWorkflowStatus,
  planWorkflowStatusTag,
  planWorkflowTasks,
  refreshPlanApprovalAfterMutation,
  rejectedCount,
  rejectionReason,
  requiredPlanApprovalPermissionCode,
  requiredPlanApprovalPermissionCodes,
  resolveApprovalRouteTitle,
  resolveCandidateDisplayName,
  resolveExpectedApproverOrgId,
  resolveExpectedApproverRoleCodes,
  resolveHistoricalCardSummary,
  resolveHistoryStatusTag,
  resolvePreferredActiveTab,
  resolveSourceDepartmentDisplayName,
  resolveTaskCandidateApprovers,
  resolveTaskStatusLabel,
  resolveWorkflowTaskDisplayName,
  resolveWorkflowTaskDisplayOperatorName,
  resolveWorkflowTaskOperatorName,
  router,
  savePlanReportIndicatorProgress,
  scopedDepartmentPlan,
  scopedPendingPlanCount,
  scopedPlanApprovals,
  scopedPlanEntityIds,
  selectedHistoryInstanceDetail,
  selectedHistoryInstanceDetailLoading,
  selectedHistoryInstanceId,
  setPlanReportProgressDraft,
  shouldDisplayWorkflowHistoryItem,
  showArchivedPlanWorkflowEmptyState,
  showCardHistoryEmptyState,
  showHistoryTimeline,
  showPlanHistoryCard,
  showPlanPendingCard,
  submitterNameCache,
  timeContext,
  workflowDefinitionPreview,
  workflowNodes,
  workflowUserAvatarCache
} = useApprovalProgressDrawer(props, emit)

const isPlaceholderPlanApprovalName = (value: unknown): boolean => {
  const normalized = normalizeDisplayName(value).replace(/\s+/g, ' ')
  return /^Plan\s*#?\s*\d+$/i.test(normalized) || /^计划\s*#?\s*\d+$/i.test(normalized)
}

const normalizeApprovalDepartmentName = (value: unknown): string => {
  return normalizeDisplayName(value)
    .replace(/[（(［[].*?[）)］\]]/g, '')
    .trim()
}

const displayedCurrentPlanApprovalName = computed(() => {
  const rawName = normalizeDisplayName(currentPlanApprovalSummary.value?.planName)
  if (rawName && !isPlaceholderPlanApprovalName(rawName)) {
    return rawName
  }

  if (props.approvalType === 'submission') {
    const departmentName =
      normalizeApprovalDepartmentName(props.departmentName) ||
      normalizeApprovalDepartmentName(currentPlanApprovalSummary.value?.submitterName) ||
      '当前部门'

    return `${departmentName}上报审批`
  }

  return rawName || '当前计划'
})
</script>

<template>
  <ElDrawer
    :model-value="modelValue"
    title="审批进度"
    direction="rtl"
    size="600px"
    @close="handleClose"
  >
    <!-- 统计信息 -->
    <template #header>
      <div class="drawer-header">
        <div class="drawer-title-group">
          <h3 class="drawer-title">{{ showPlanApprovals ? '审批中心' : '审批进度' }}</h3>
          <ElButton
            v-if="props.showRouteButton && normalizedRouteTarget"
            class="route-target-button"
            size="small"
            type="primary"
            @click="navigateToRouteTarget"
          >
            跳转到对应页面
          </ElButton>
        </div>
        <div class="stats-tags">
          <ElPopover
            v-if="showPlanApprovals && scopedPendingPlanCount > 0"
            trigger="hover"
            placement="bottom-end"
            :width="320"
            popper-class="pending-plan-approval-popper"
          >
            <template #reference>
              <ElTag type="warning" size="small" class="pending-plan-approval-tag">
                其他计划审批中: {{ scopedPendingPlanCount }}
              </ElTag>
            </template>

            <div class="pending-plan-approval-preview">
              <div class="pending-plan-approval-preview__title">其他计划还在审批中</div>
              <button
                v-for="item in pendingPlanApprovalPreviewItems"
                :key="item.key"
                type="button"
                class="pending-plan-approval-preview__item"
                @click="navigateToPendingPlanApproval(item)"
              >
                <span class="pending-plan-approval-preview__name">{{ item.title }}</span>
                <span class="pending-plan-approval-preview__route">{{ item.routeDisplay }}</span>
              </button>
            </div>
          </ElPopover>
          <ElTag v-if="!hasPlanWorkflowData && pendingCount > 0" type="warning" size="small">
            审批中: {{ pendingCount }}
          </ElTag>
          <ElTag v-if="!hasPlanWorkflowData && approvedCount > 0" type="success" size="small">
            已通过: {{ approvedCount }}
          </ElTag>
          <ElTag v-if="!hasPlanWorkflowData && rejectedCount > 0" type="danger" size="small">
            已驳回: {{ rejectedCount }}
          </ElTag>
        </div>
      </div>
    </template>

    <!-- 空状态 -->
    <ElEmpty
      v-if="!showPlanApprovals && !hasDisplayableApprovalContent"
      description="暂无审批数据"
      :image-size="120"
    />

    <!-- 审批内容 -->
    <div v-else class="approval-content">
      <!-- 标签页 -->
      <ElTabs v-model="activeTab" class="approval-tabs">
        <ElTabPane v-if="showPlanApprovals" name="pending-plans" label="计划审批">
          <div v-loading="planApprovalsLoading" class="plan-approval-pane">
            <ElEmpty
              v-if="!planApprovalsLoading && !showPlanPendingCard"
              description="暂无审批中的计划"
              :image-size="120"
            />
            <div v-else class="approval-list">
              <div
                v-if="showPlanPendingCard && currentPlanApprovalSummary"
                :key="currentPlanApprovalSummary.key"
                class="approval-card"
              >
                <div class="card-header">
                  <div class="plan-info">
                    <el-icon class="plan-icon"><Document /></el-icon>
                    <div class="info-text">
                      <div class="plan-name">{{ displayedCurrentPlanApprovalName }}</div>
                      <div class="plan-year">
                        {{
                          hasPlanWorkflowData
                            ? '当前审批状态已接入'
                            : `待审批实例 ${currentPlanApprovalSummary.count} 条`
                        }}
                      </div>
                    </div>
                  </div>
                  <ElTag
                    :type="hasPlanWorkflowData ? planWorkflowStatusTag.type : 'warning'"
                    size="small"
                  >
                    {{ hasPlanWorkflowData ? planWorkflowStatusTag.label : '待审批' }}
                  </ElTag>
                </div>
                <div class="submit-info">
                  <div class="info-row">
                    <el-icon><User /></el-icon>
                    <span class="label">提交人：</span>
                    <span class="value">{{ currentPlanApprovalSummary.submitterName }}</span>
                  </div>
                  <div class="info-row">
                    <el-icon><Timer /></el-icon>
                    <span class="label">提交时间：</span>
                    <span class="value">{{
                      formatTime(currentPlanApprovalSummary.createdAt)
                    }}</span>
                  </div>
                  <div class="info-row">
                    <el-icon><Right /></el-icon>
                    <span class="label">当前步骤：</span>
                    <span class="value">{{ currentPlanApprovalSummary.currentStepName }}</span>
                  </div>
                  <div v-if="currentPlanOperationLabel" class="info-row">
                    <el-icon><Right /></el-icon>
                    <span class="label">当前操作：</span>
                    <span class="value">{{ currentPlanOperationLabel }}</span>
                  </div>
                  <div v-if="activePlanWorkflow?.lastRejectReason" class="info-row">
                    <el-icon><Document /></el-icon>
                    <span class="label">驳回原因：</span>
                    <span class="value">{{ activePlanWorkflow.lastRejectReason }}</span>
                  </div>
                </div>
                <div class="card-actions">
                  <ElButton @click="openPlanApprovalDetails">查看详情</ElButton>
                  <ElButton
                    v-if="
                      hasPlanWorkflowData &&
                      isPlanPendingApproval &&
                      canCurrentUserHandlePlanApproval
                    "
                    type="success"
                    @click="handleApprovePlanBatch"
                  >
                    审批通过
                  </ElButton>
                  <ElButton
                    v-if="
                      hasPlanWorkflowData &&
                      isPlanPendingApproval &&
                      canCurrentUserHandlePlanApproval
                    "
                    type="danger"
                    @click="handleRejectPlanBatch"
                  >
                    审批驳回
                  </ElButton>
                  <template v-if="!hasPlanWorkflowData">
                    <ElButton
                      v-if="hasPlanApprovalPermission"
                      type="success"
                      @click="handleApprovePlanBatch"
                    >
                      一键通过
                    </ElButton>
                    <ElButton
                      v-if="hasPlanApprovalPermission"
                      type="danger"
                      @click="handleRejectPlanBatch"
                    >
                      一键驳回
                    </ElButton>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </ElTabPane>

        <!-- 审批流程视图（使用CustomApprovalFlow组件） -->
        <ElTabPane
          v-if="showPlanApprovals || hasWorkflowTabContent"
          name="workflow"
          label="审批流程"
        >
          <ElEmpty
            v-if="showArchivedPlanWorkflowEmptyState || (!hasApprovalData && !hasPlanWorkflowData)"
            description="暂无审批数据"
            :image-size="120"
          />
          <template v-else>
            <ElAlert
              v-if="hasPlanWorkflowData"
              type="info"
              title="审批人由后端流程定义自动决定，当前页面仅展示当前节点和审批结果。"
              show-icon
              :closable="false"
              style="margin-bottom: 16px"
            />
            <ElAlert
              v-if="hasPlanWorkflowData && isPlanPendingApproval && !hasPlanApprovalPermission"
              type="warning"
              title="当前角色或组织范围不匹配该审批节点，仅可查看审批进度和历史。"
              show-icon
              :closable="false"
              style="margin-bottom: 16px"
            />
            <ElAlert
              v-if="
                hasPlanWorkflowData && isPlanPendingApproval && !canCurrentUserHandlePlanApproval
              "
              type="warning"
              title="当前节点按角色审批流转，你当前仅可查看审批进度和历史。"
              show-icon
              :closable="false"
              style="margin-bottom: 16px"
            />

            <CustomApprovalFlow
              :nodes="workflowNodes"
              :current-node-id="currentNodeId"
              :rejection-reason="rejectionReason"
              :readonly="readonly || hasPlanWorkflowData"
              :approval-type="approvalType"
              @open-attachment="handleWorkflowNodeAttachmentOpen"
              @add-node="handleAddNode"
              @update-approver="handleUpdateApprover"
              @save-template="handleSaveTemplate"
              @apply-template="handleApplyTemplate"
            />
          </template>
        </ElTabPane>

        <!-- 历史记录视图 -->
        <ElTabPane name="history" label="审批历史">
          <ElEmpty
            v-if="!hasApprovalData && !hasPlanWorkflowData"
            description="暂无审批历史"
            :image-size="120"
          />
          <template v-else>
            <div v-if="showPlanHistoryCard" class="approval-list" style="margin-bottom: 16px">
              <div
                v-for="item in historicalPlanApprovalItems"
                :key="`${item.instanceId}-history`"
                class="approval-card"
              >
                <div class="card-header">
                  <div class="plan-info">
                    <el-icon class="plan-icon"><Document /></el-icon>
                    <div class="info-text">
                      <div class="plan-name">{{ item.routeTitle || item.title }}</div>
                      <div class="plan-year">
                        {{ item.flowName || '已完成，详情可查看完整审批流程' }}
                      </div>
                    </div>
                  </div>
                  <ElTag :type="item.statusType || 'success'" size="small">
                    {{ item.statusLabel || '已通过' }}
                  </ElTag>
                </div>
                <div class="submit-info">
                  <div class="info-row">
                    <el-icon><User /></el-icon>
                    <span class="label">提交人：</span>
                    <span class="value">{{ item.submitterName }}</span>
                  </div>
                  <div class="info-row">
                    <el-icon><Timer /></el-icon>
                    <span class="label">提交时间：</span>
                    <span class="value">{{ formatTime(item.createdAt) }}</span>
                  </div>
                  <div class="info-row">
                    <el-icon><Right /></el-icon>
                    <span class="label">流转方向：</span>
                    <span class="value">{{ item.routeTitle || '--' }}</span>
                  </div>
                  <div class="info-row">
                    <el-icon><Timer /></el-icon>
                    <span class="label">完成时间：</span>
                    <span class="value">{{ formatTime(item.completedAt) }}</span>
                  </div>
                </div>
                <div v-if="resolveHistoricalCardSummary(item)" class="history-summary-card">
                  <div class="history-summary-title">
                    {{ resolveHistoricalCardSummary(item)?.title }}
                  </div>
                  <div class="history-summary-list">
                    <div
                      v-for="summaryItem in resolveHistoricalCardSummary(item)?.items || []"
                      :key="`${item.instanceId}-${summaryItem}`"
                      class="history-summary-item"
                    >
                      {{ summaryItem }}
                    </div>
                  </div>
                </div>
                <div class="card-actions">
                  <ElButton @click="openPlanApprovalDetails(item)">查看详情</ElButton>
                </div>
              </div>
            </div>
            <ElEmpty
              v-else-if="showCardHistoryEmptyState"
              description="暂无审批历史"
              :image-size="120"
            />
            <ApprovalHistory
              v-else-if="showHistoryTimeline"
              :history="approvalHistory"
              :approval-type="approvalType"
            />
          </template>
        </ElTabPane>
      </ElTabs>
    </div>

    <ElDialog
      v-model="planDetailDialogVisible"
      title="审批实例详情"
      width="680px"
      class="plan-detail-dialog"
    >
      <div v-loading="planDetailContentLoading" class="plan-detail-content">
        <div class="plan-detail-summary">
          <div class="summary-title">
            {{
              historicalPlanApprovalItems.find(
                item => String(item.instanceId) === selectedHistoryInstanceId
              )?.routeTitle ||
              displayedCurrentPlanApprovalName ||
              '当前计划'
            }}
          </div>
          <div class="summary-subtitle">
            {{
              selectedHistoryInstanceId
                ? '当前查看审批实例'
                : isPlanPendingApproval
                  ? '待审批实例'
                  : '历史审批实例'
            }}
            {{ selectedHistoryInstanceId ? '' : currentPlanApprovalItems.length }}
          </div>
        </div>

        <div
          v-if="
            (selectedHistoryInstanceId ? historicalPlanApprovalItems : currentPlanApprovalItems)
              .length > 0
          "
          class="plan-detail-list"
        >
          <div
            v-for="item in selectedHistoryInstanceId
              ? historicalPlanApprovalItems.filter(
                  historyItem => String(historyItem.instanceId) === selectedHistoryInstanceId
                )
              : currentPlanApprovalItems"
            :key="item.instanceId"
            class="plan-detail-item"
          >
            <div class="detail-item-header">
              <div class="detail-item-title">{{ item.routeTitle || item.title }}</div>
              <ElTag
                :type="item.statusType || detailDialogStatusTag.type"
                effect="light"
                size="small"
              >
                {{ item.statusLabel || detailDialogStatusTag.label }}
              </ElTag>
            </div>
            <div class="detail-item-meta">
              <div v-if="item.flowName" class="detail-meta-row">
                <span class="detail-label">流程名称：</span>
                <span class="detail-value">{{ item.flowName }}</span>
              </div>
              <div class="detail-meta-row">
                <span class="detail-label">实例编号：</span>
                <span class="detail-value">{{ item.instanceNo }}</span>
              </div>
              <div class="detail-meta-row">
                <span class="detail-label">提交人：</span>
                <span class="detail-value">{{ item.submitterName }}</span>
              </div>
              <div class="detail-meta-row">
                <span class="detail-label">提交时间：</span>
                <span class="detail-value">{{ formatTime(item.createdAt) }}</span>
              </div>
              <div class="detail-meta-row">
                <span class="detail-label"
                  >{{ selectedHistoryInstanceId ? '实例状态' : '当前步骤' }}：</span
                >
                <span class="detail-value">{{ item.currentStepName }}</span>
              </div>
              <div v-if="item.completedAt" class="detail-meta-row">
                <span class="detail-label">完成时间：</span>
                <span class="detail-value">{{ formatTime(item.completedAt) }}</span>
              </div>
              <div v-if="item.entityId" class="detail-meta-row">
                <span class="detail-label">关联实体ID：</span>
                <span class="detail-value">{{ item.entityId }}</span>
              </div>
            </div>
          </div>
        </div>
        <ElEmpty v-else description="暂无审批实例详情" :image-size="100" />

        <div
          v-if="
            displayedBusinessIndicatorItems.length > 0 ||
            displayedDistributionIndicatorItems.length > 0 ||
            displayedBusinessSummaryComment
          "
          class="plan-detail-snapshot"
        >
          <div class="summary-title">{{ displayedBusinessSectionTitle }}</div>
          <div class="summary-subtitle">{{ displayedBusinessSectionSubtitle }}</div>

          <div v-if="displayedBusinessSummaryComment" class="snapshot-summary-card">
            <div class="snapshot-section-title">整单说明</div>
            <div class="snapshot-summary-text">{{ displayedBusinessSummaryComment }}</div>
          </div>

          <div class="snapshot-indicator-list">
            <div
              v-for="indicator in displayedBusinessIndicatorItems.length > 0
                ? displayedBusinessIndicatorItems
                : displayedDistributionIndicatorItems"
              :key="`${indicator.indicatorId || indicator.indicatorName}`"
              class="snapshot-indicator-card"
            >
              <div class="snapshot-indicator-header">
                <div class="snapshot-indicator-name">{{ indicator.indicatorName }}</div>
                <ElTag size="small" effect="light">{{ indicator.indicatorType }}</ElTag>
              </div>

              <div class="snapshot-indicator-grid">
                <div class="snapshot-field">
                  <span class="snapshot-field-label">责任部门</span>
                  <span class="snapshot-field-value">{{ indicator.responsibleDept }}</span>
                </div>
                <div class="snapshot-field">
                  <span class="snapshot-field-label">当前实际进度</span>
                  <span class="snapshot-field-value">{{ indicator.currentProgress }}</span>
                </div>
                <div class="snapshot-field">
                  <span class="snapshot-field-label">{{ displayedBusinessProgressLabel }}</span>
                  <div v-if="indicator.canEditSubmittedProgress" class="snapshot-progress-editor">
                    <ElInputNumber
                      :model-value="indicator.submittedProgressDraft"
                      :min="0"
                      :max="100"
                      :step="5"
                      size="small"
                      controls-position="right"
                      class="snapshot-progress-input"
                      @update:model-value="
                        value =>
                          setPlanReportProgressDraft(
                            indicator.reportId,
                            indicator.indicatorId,
                            value ?? undefined
                          )
                      "
                    />
                    <span class="snapshot-progress-unit">%</span>
                    <ElButton
                      size="small"
                      type="primary"
                      :loading="indicator.isSavingSubmittedProgress"
                      @click="savePlanReportIndicatorProgress(indicator)"
                    >
                      保存
                    </ElButton>
                  </div>
                  <span v-else class="snapshot-field-value snapshot-field-value--strong">{{
                    indicator.submittedProgress
                  }}</span>
                </div>
                <div class="snapshot-field">
                  <span class="snapshot-field-label">目标值 / 实际值 / 单位</span>
                  <span class="snapshot-field-value"
                    >{{ indicator.targetValue }} / {{ indicator.actualValue }} /
                    {{ indicator.unit }}</span
                  >
                </div>
              </div>

              <div class="snapshot-section">
                <div class="snapshot-section-title">{{ displayedBusinessCommentLabel }}</div>
                <div class="snapshot-section-content">
                  {{ indicator.submittedComment || displayedBusinessEmptyCommentText }}
                </div>
              </div>

              <div class="snapshot-section">
                <div class="snapshot-section-title">{{ displayedBusinessAttachmentLabel }}</div>
                <div v-if="indicator.attachments.length > 0" class="snapshot-attachment-list">
                  <ElButton
                    v-for="attachment in indicator.attachments"
                    :key="`${indicator.indicatorId || indicator.indicatorName}-${attachment.attachmentId || attachment.url}`"
                    link
                    type="primary"
                    class="snapshot-attachment-link"
                    @click="handleWorkflowNodeAttachmentOpen(attachment)"
                  >
                    {{ attachment.name }}
                  </ElButton>
                </div>
                <div v-else class="snapshot-section-empty">
                  {{ displayedBusinessEmptyAttachmentText }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="(selectedHistoryInstanceDetail?.history?.length || planWorkflowHistory.length) > 0"
          class="plan-detail-history"
        >
          <div class="summary-title">审批历史</div>
          <ApprovalHistory
            :history="
              selectedHistoryInstanceDetail?.history?.length
                ? selectedHistoryInstanceDetail.history
                    .filter(shouldDisplayWorkflowHistoryItem)
                    .map((historyItem, index) => ({
                      id: String(historyItem.taskId ?? index),
                      action: normalizeWorkflowAction(historyItem.action),
                      operator: String(historyItem.operatorId ?? index),
                      operatorName: String(historyItem.operatorName || '系统'),
                      operatorAvatar: historyItem.operatorId
                        ? workflowUserAvatarCache[String(historyItem.operatorId)] || undefined
                        : undefined,
                      operateTime: new Date(historyItem.operateTime || Date.now()),
                      stepName:
                        typeof historyItem.taskName === 'string' ? historyItem.taskName : undefined,
                      comment: historyItem.comment
                    }))
                : planWorkflowHistory
            "
            :approval-type="approvalType"
          />
        </div>
      </div>

      <template #footer>
        <ElButton @click="planDetailDialogVisible = false">关闭</ElButton>
      </template>
    </ElDialog>
  </ElDrawer>
</template>

<style scoped src="./ApprovalProgressDrawer.css"></style>
