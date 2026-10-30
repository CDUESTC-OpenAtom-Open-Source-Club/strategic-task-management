<script setup lang="ts">
import { computed } from 'vue'
import { Document, User, Timer, Right } from '@element-plus/icons-vue'
import ApprovalHistory from './ApprovalHistory.vue'
import CustomApprovalFlow from './CustomApprovalFlow.vue'
import {
  formatAppraisalLevel,
  formatInstanceNo,
  formatStayDuration
} from '@/features/approval/model/useApprovalProgressDrawer'
import {
  resolvePlanApprovalTypeLabel,
  showAppraisalLevelForFlow
} from '@/features/approval/lib/approval-utils'
import { resolveWorkflowInstanceIndexLabel } from '@/features/approval/model/workflowFocusCandidates'
import { getProgressLevelTagStyle } from '@/shared/lib/constants/progressLevel'
import {
  useDistributionApprovalProgressDrawer,
  type DistributionApprovalProgressDrawerEmit,
  type DistributionApprovalProgressDrawerProps
} from '@/3-features/approval/model/useDistributionApprovalProgressDrawer'
import type { PlanApprovalDetailItem } from '@/3-features/approval/model/types'

const props = withDefaults(defineProps<DistributionApprovalProgressDrawerProps>(), {
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
  mutationWorkflowEntities: () => [],
  mutationPendingApprovals: () => [],
  relatedWorkflowEntities: () => [],
  routeTarget: ''
})

const emit = defineEmits<DistributionApprovalProgressDrawerEmit>()

const {
  INDICATOR_DISPATCH_APPROVE_PERMISSION,
  INDICATOR_REPORT_APPROVE_PERMISSION,
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
  canCurrentUserHandleMutationApproval,
  canCurrentUserWithdrawMutation,
  canLookupWorkflowUsers,
  currentDetailWorkflow,
  currentIndicator,
  currentNodeId,
  currentPlanApprovalItems,
  currentPlanApprovalSummary,
  currentPlanEntityIds,
  currentPlanInstanceId,
  currentPlanInstanceStatus,
  currentPlanOperationLabel,
  currentPlanStepDisplay,
  currentPlanTaskId,
  currentUserId,
  pendingMutationApprovalItems,
  pendingReportApprovalItems,
  currentUserOrgId,
  currentUserPermissionCodes,
  currentUserRoleCodes,
  detailDialogStatusTag,
  displayedBusinessAttachmentLabel,
  displayedBusinessCommentLabel,
  displayedBusinessEmptyAttachmentText,
  displayedBusinessEmptyCommentText,
  displayedBusinessSectionSubtitle,
  displayedBusinessSectionTitle,
  displayedDistributionIndicatorItems,
  displayedPlanReportIndicatorItems,
  displayedPlanReportSummaryComment,
  ensureSubmitterNameLoaded,
  ensureWorkflowRelatedAvatarsLoaded,
  ensureWorkflowUserAvatarLoaded,
  expectedWorkflowCodes,
  formatTime,
  getFallbackSubmitterValue,
  getFunctionalStatus,
  getStrategicStatus,
  handleAddNode,
  handleApplyTemplate,
  handleApproveMutation,
  canCurrentUserHandleReportTodo,
  handleApprovePlanBatch,
  handleClose,
  handlePlanReportAttachmentOpen,
  handleRejectMutation,
  handleRejectPlanBatch,
  handleSaveTemplate,
  handleUpdateApprover,
  handleWithdrawMutation,
  hasApprovalData,
  hasDisplayableApprovalContent,
  hasPlanApprovalPermission,
  hasAnyPlanApprovalRole,
  hasPlanWorkflowData,
  hasWorkflowTabContent,
  workflowFocusCandidates,
  workflowFocusIdx,
  historicalPlanApprovalItems,
  historyInstanceDetailCache,
  historyTargets,
  isDepartmentRelevantApproval,
  isDistributionFlow,
  isPlanCompletedApproval,
  isPlanHistoryOnlyMode,
  isPlanPendingApproval,
  isPlanWorkflowTerminated,
  isSubmissionFlow,
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
  normalizeDisplayName,
  normalizeStepMatchKey,
  normalizeWorkflowAction,
  normalizeWorkflowCode,
  normalizedPlanBusinessStatus,
  openPlanApprovalDetails,
  parsePositiveUserId,
  pendingCount,
  pendingPlanApprovalPreviewItems,
  pendingPlanApprovals,
  permissionUtil,
  planApprovalsLoading,
  planWorkflowDetailLoading,
  planDetailContentLoading,
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
  relevantDepartmentOrgIds,
  requiredPlanApprovalPermissionCode,
  requiredPlanApprovalPermissionCodes,
  resolveApprovalRouteTitle,
  resolveCandidateDisplayName,
  resolveExpectedApproverOrgId,
  resolveExpectedApproverRoleCodes,
  resolveHistoryStatusTag,
  resolveTaskCandidateApprovers,
  resolveTaskStatusLabel,
  resolveTaskStatusTag,
  resolveWorkflowTaskOperatorName,
  scopedDepartmentPlan,
  scopedPendingPlanCount,
  scopedPlanApprovals,
  scopedPlanEntityIds,
  selectedHistoryInstanceDetail,
  selectedHistoryInstanceDetailLoading,
  selectedHistoryInstanceId,
  shouldDisplayWorkflowHistoryItem,
  showArchivedPlanWorkflowEmptyState,
  showCardHistoryEmptyState,
  showHistoryTimeline,
  showPlanHistoryCard,
  showPlanPendingCard,
  submitterNameCache,
  timeContext,
  toPositiveNumber,
  workflowDefinitionPreview,
  workflowNodes,
  reportWorkflowInstances,
  selectedReportInstanceIdx,
  workflowUserAvatarCache
} = useDistributionApprovalProgressDrawer(props, emit)

const isPlaceholderPlanApprovalName = (value: unknown): boolean => {
  const normalized = normalizeDisplayName(value).replace(/\s+/g, ' ')
  return /^Plan\s*#?\s*\d+$/i.test(normalized) || /^计划\s*#?\s*\d+$/i.test(normalized)
}

// 2026-10-21：异动字段名 → 中文标签，与右下角「异动历史」角标口径一致
const MUTATION_FIELD_LABELS: Record<string, string> = {
  indicator_desc: '指标内容',
  weight_percent: '权重',
  remark: '下发备注',
  name: '战略任务'
}

const formatMutationFieldLabel = (fieldKey: string, entityType?: 'INDICATOR' | 'TASK'): string => {
  // 聚合卡片会把字段名拼成「指标名 · 字段」，这里只翻译后缀
  const parts = fieldKey.split(' · ')
  const rawField = parts.length > 1 ? parts[parts.length - 1] : fieldKey
  const label = MUTATION_FIELD_LABELS[rawField] || rawField
  if (parts.length > 1) {
    return `${parts.slice(0, -1).join(' · ')} · ${label}`
  }
  if (!MUTATION_FIELD_LABELS[rawField] && entityType === 'TASK') {
    return '战略任务'
  }
  return label
}

const formatMutationValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') {
    return '空'
  }
  return String(value)
}

/**
 * 详情弹窗条目数据源：与原版一致——选中实例时按 instanceId 在历史卡片中定位；
 * 异动卡片走同一查看详情入口，故追加在异动待审卡片中定位（计划实例不会落入其中）。
 * 未选中时保持原版口径：当前审批条目。
 */
const planDetailDialogItems = computed<PlanApprovalDetailItem[]>(() => {
  if (!selectedHistoryInstanceId.value) {
    return currentPlanApprovalItems.value
  }
  return [...historicalPlanApprovalItems.value, ...pendingMutationApprovalItems.value].filter(
    item => String(item.instanceId) === selectedHistoryInstanceId.value
  )
})

/** 当前弹窗选中的条目是否为异动（异动条目以「本次异动内容」替代业务快照区） */
const planDetailIsMutationItem = computed(() => {
  const item = planDetailDialogItems.value[0]
  if (!item) {
    return false
  }
  return Boolean(item.batchId || (item.changedFields && Object.keys(item.changedFields).length > 0))
})

/**
 * 2026-10-23：月报待办卡（PLAN_REPORT）的标题与操作。
 *
 * 注意流向：后端 my-tasks 给的 sourceOrg/targetOrg 是「下发方向」
 * （教务处 -> 计算机学院），而上报是反方向，标题须翻转，
 * 与审批历史卡片的「上报审批 · 计算机学院 -> 教务处」口径一致。
 */
const resolveReportApprovalTitle = (item: Record<string, any>): string => {
  const sourceName = normalizeDisplayName(item.sourceOrgName)
  const targetName = normalizeDisplayName(item.targetOrgName)
  if (sourceName && targetName) {
    // 上报方向 = 接收方 -> 下发方
    return `上报审批 · ${targetName} -> ${sourceName}`
  }
  return (
    normalizeDisplayName(item.planName) ||
    normalizeDisplayName(item.taskName) ||
    normalizeDisplayName(item.title) ||
    '上报审批'
  )
}

const openReportApprovalDetails = (item: Record<string, any>) => {
  const instanceId = String(item.instanceId ?? item.taskId ?? '')
  if (instanceId) {
    selectedHistoryInstanceId.value = instanceId
  }
  planDetailDialogVisible.value = true
}

// 2026-10-24（B 卡内容装配）：my-tasks 条目缺 submitterName、flowName 透传
// 「Plan审批流程（二级学院）」易与计划汇总卡混淆——展示层统一转译。
/** 上报卡的流程标签：按 flowCode 转译为上报语义，不透传 Plan 审批字样 */
const resolveReportFlowLabel = (item: Record<string, any>): string => {
  const flowCode = String(item?.flowCode || '')
    .trim()
    .toUpperCase()
  if (flowCode === 'PLAN_APPROVAL_COLLEGE') {
    return '上报审批流程（二级学院 → 职能部门）'
  }
  if (flowCode === 'PLAN_APPROVAL_FUNCDEPT') {
    return '上报审批流程（职能部门 → 战略发展部）'
  }
  return String(item?.flowName || '') || '上报审批'
}

/**
 * 上报卡提交人：my-tasks 无 submitterName 时按提交方组织名兜底。
 * 注意方向：my-tasks 的 source/target 是「下发方向」（教务处 -> 计算机学院），
 * 上报是反方向——提交方 = targetOrg（计算机学院），审批方 = sourceOrg（教务处）。
 */
const resolveReportSubmitterName = (item: Record<string, any>): string => {
  const direct = String(item?.submitterName || '').trim()
  if (direct) {
    return direct
  }
  const targetOrg = String(item?.targetOrgName || '').trim()
  if (targetOrg) {
    return targetOrg
  }
  return '--'
}

/** 上报卡停留时长：与历史卡 formatTime 同源的时间差展示 */
const resolveReportStayDuration = (item: Record<string, any>): string => {
  const raw = item?.createdAt
  const created = raw ? new Date(raw).getTime() : NaN
  if (!Number.isFinite(created)) {
    return '--'
  }
  const minutes = Math.max(0, Math.floor((Date.now() - created) / 60000))
  if (minutes < 1) {
    return '刚刚提交'
  }
  if (minutes < 60) {
    return `已停留 ${minutes} 分钟`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `已停留 ${hours} 小时 ${minutes % 60} 分钟`
  }
  return `已停留 ${Math.floor(hours / 24)} 天`
}

const handleApproveReportTodo = async (item: Record<string, any>) => {
  await handleApproveMutation(item as PlanApprovalDetailItem)
}

const handleRejectReportTodo = async (item: Record<string, any>) => {
  await handleRejectMutation(item as PlanApprovalDetailItem)
}

/** 选中实例的标题（计划实例在历史卡片中找，异动实例在异动卡片中找） */
const planDetailSelectedTitle = computed(() => {
  if (!selectedHistoryInstanceId.value) {
    return ''
  }
  return (
    planDetailDialogItems.value.find(item => item.routeTitle)?.routeTitle ||
    planDetailDialogItems.value[0]?.title ||
    ''
  )
})

const normalizeApprovalDepartmentName = (value: unknown): string => {
  return normalizeDisplayName(value)
    .replace(/[（(［[].*?[）)］\]]/g, '')
    .trim()
}

// 审核进度仅上报链路显示（2026-09-27 用户拍板）：下发/异动流程不出现该选择器
const showPlanAppraisalLevelSelect = computed(() =>
  showAppraisalLevelForFlow(
    activePlanWorkflow.value?.flowCode || currentDetailWorkflow.value?.flowCode
  )
)

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

    return `${departmentName}${resolvePlanApprovalTypeLabel(
      activePlanWorkflow.value?.flowCode || currentDetailWorkflow.value?.flowCode
    )}`
  }

  return rawName || '当前计划'
})
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    title="审批进度"
    direction="rtl"
    size="600px"
    @close="handleClose"
  >
    <!-- 统计信息 -->
    <template #header>
      <div class="drawer-header">
        <h3 class="drawer-title">{{ showPlanApprovals ? '审批中心' : '审批进度' }}</h3>
        <div class="stats-tags">
          <el-popover
            v-if="showPlanApprovals && scopedPendingPlanCount > 0"
            trigger="hover"
            placement="bottom-end"
            :width="320"
            popper-class="pending-plan-approval-popper"
          >
            <template #reference>
              <el-tag type="warning" size="small" class="pending-plan-approval-tag">
                其他计划审批中: {{ scopedPendingPlanCount }}
              </el-tag>
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
          </el-popover>
          <el-tag v-if="!hasPlanWorkflowData && pendingCount > 0" type="warning" size="small">
            审批中: {{ pendingCount }}
          </el-tag>
          <el-tag v-if="!hasPlanWorkflowData && approvedCount > 0" type="success" size="small">
            已通过: {{ approvedCount }}
          </el-tag>
          <el-tag v-if="!hasPlanWorkflowData && rejectedCount > 0" type="danger" size="small">
            已回退: {{ rejectedCount }}
          </el-tag>
        </div>
      </div>
    </template>

    <!-- 空状态 -->
    <el-empty
      v-if="!showPlanApprovals && !hasDisplayableApprovalContent"
      description="暂无审批数据"
      :image-size="120"
    />

    <!-- 审批内容 -->
    <div v-else class="approval-content">
      <!-- 标签页 -->
      <el-tabs v-model="activeTab" class="approval-tabs">
        <el-tab-pane v-if="showPlanApprovals" name="pending-plans" label="计划审批">
          <div
            v-loading="planApprovalsLoading || planWorkflowDetailLoading"
            class="plan-approval-pane"
          >
            <!-- 2026-10-23 修复（计划审批 tab 空白）：恢复 de6eb6f 的 v-if/v-else 互斥结构——
                 8a806f8 把三个分支改为并列独立 v-if 后，「计划下发审批」场景下
                 计划汇总卡不渲染（pane 只剩注释节点，无空态也无卡片，实测截图 g41） -->
            <el-empty
              v-if="
                !planApprovalsLoading &&
                !planWorkflowDetailLoading &&
                !showPlanPendingCard &&
                !pendingMutationApprovalItems.length &&
                !pendingReportApprovalItems.length
              "
              description="暂无审批中的计划"
              :image-size="120"
            />
            <div v-else class="approval-list">
              <!-- 2026-10-21：审批中的异动卡片，与「审批历史」卡片同构（同一套 approval-card 样式与字段） -->
              <div
                v-for="item in pendingMutationApprovalItems"
                :key="`${item.instanceId}-pending`"
                class="approval-card"
              >
                <div class="card-header">
                  <div class="plan-info">
                    <el-icon class="plan-icon"><Document /></el-icon>
                    <div class="info-text">
                      <div class="plan-name">{{ item.routeTitle || item.title }}</div>
                      <div class="plan-year">
                        {{ item.flowName || '指标异动审批（战略发展部）' }}
                      </div>
                    </div>
                  </div>
                  <el-tag :type="item.statusType || 'warning'" size="small">
                    {{ item.statusLabel || '审批中' }}
                  </el-tag>
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
                    <el-icon><Right /></el-icon>
                    <span class="label">当前步骤：</span>
                    <span class="value">{{ item.currentStepName }}</span>
                  </div>
                </div>
                <div class="card-actions">
                  <el-button @click="openPlanApprovalDetails(item)">查看详情</el-button>
                  <!-- 2026-10-21：异动卡片的审批操作——仅当前节点审批人可见，
                       否则发起人/无关角色会看到点不动的按钮 -->
                  <template v-if="canCurrentUserHandleMutationApproval(item)">
                    <el-button type="success" @click="handleApproveMutation(item)">
                      审批通过
                    </el-button>
                    <el-button type="danger" @click="handleRejectMutation(item)"
                      >审批驳回</el-button
                    >
                  </template>
                  <!-- 撤回：与上报审批同源（POST /workflows/{id}/cancel），仅发起人且未过窗口时可见 -->
                  <el-button
                    v-if="canCurrentUserWithdrawMutation(item)"
                    type="warning"
                    @click="handleWithdrawMutation(item)"
                  >
                    撤回
                  </el-button>
                </div>
              </div>
              <!-- 2026-10-23 修复（上报审批卡片不显示）：月报待办独立成卡。
                   此前月报被排除在计划汇总卡之外且无替代渲染路径，导致
                   「待战略发展部终审人审批」时审批中心却是空的。 -->
              <div
                v-for="item in pendingReportApprovalItems"
                :key="`report-pending-${item.instanceId || item.taskId}`"
                data-card-kind="report-todo-card"
                class="approval-card"
              >
                <div class="card-header">
                  <div class="plan-info">
                    <el-icon class="plan-icon"><Document /></el-icon>
                    <div class="info-text">
                      <div class="plan-name">{{ resolveReportApprovalTitle(item) }}</div>
                      <div class="plan-year">
                        {{ resolveReportFlowLabel(item) }}
                      </div>
                    </div>
                  </div>
                  <el-tag type="warning" size="small">审批中</el-tag>
                </div>
                <div class="submit-info">
                  <div class="info-row">
                    <el-icon><User /></el-icon>
                    <span class="label">提交人：</span>
                    <span class="value">{{ resolveReportSubmitterName(item) }}</span>
                  </div>
                  <div class="info-row">
                    <el-icon><Timer /></el-icon>
                    <span class="label">提交时间：</span>
                    <span class="value">{{
                      item.createdAt ? formatTime(item.createdAt) : '--'
                    }}</span>
                  </div>
                  <div class="info-row">
                    <el-icon><Timer /></el-icon>
                    <span class="label">停留时长：</span>
                    <span class="value">{{ resolveReportStayDuration(item) }}</span>
                  </div>
                  <div class="info-row">
                    <el-icon><Right /></el-icon>
                    <span class="label">当前步骤：</span>
                    <span class="value">{{
                      item.currentStepName || item.taskName || '审批中'
                    }}</span>
                  </div>
                </div>
                <div class="card-actions">
                  <el-button @click="openReportApprovalDetails(item)">查看详情</el-button>
                  <el-button type="success" @click="handleApproveReportTodo(item)">
                    审批通过
                  </el-button>
                  <el-button type="danger" @click="handleRejectReportTodo(item)">
                    审批驳回
                  </el-button>
                </div>
              </div>
              <div
                v-if="showPlanPendingCard && currentPlanApprovalSummary"
                :key="currentPlanApprovalSummary.key"
                data-card-kind="plan-summary-card"
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
                            : `审批中流程 ${currentPlanApprovalSummary.count} 条`
                        }}
                      </div>
                    </div>
                  </div>
                  <el-tag
                    :type="hasPlanWorkflowData ? planWorkflowStatusTag.type : 'warning'"
                    size="small"
                  >
                    {{ hasPlanWorkflowData ? planWorkflowStatusTag.label : '审批中' }}
                  </el-tag>
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
                  <div
                    v-if="formatStayDuration(currentPlanApprovalSummary?.createdAt)"
                    class="info-row"
                  >
                    <el-icon><Timer /></el-icon>
                    <span class="label">停留时长：</span>
                    <span class="value">{{
                      formatStayDuration(currentPlanApprovalSummary?.createdAt)
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
                  <el-button @click="openPlanApprovalDetails">查看详情</el-button>
                  <!-- 2026-10-24 用户定案：整体鉴定废弃——审核进度改在审批详情里
                       按指标逐条评定（仅上报链末级审批节点出现），卡片上不再有选择器 -->
                  <el-button
                    v-if="
                      hasPlanWorkflowData &&
                      isPlanPendingApproval &&
                      canCurrentUserHandlePlanApproval
                    "
                    type="success"
                    @click="handleApprovePlanBatch"
                  >
                    审批通过
                  </el-button>
                  <el-button
                    v-if="
                      hasPlanWorkflowData &&
                      isPlanPendingApproval &&
                      canCurrentUserHandlePlanApproval
                    "
                    type="danger"
                    @click="handleRejectPlanBatch"
                  >
                    审批驳回
                  </el-button>
                  <template v-if="!hasPlanWorkflowData">
                    <el-button
                      v-if="hasAnyPlanApprovalRole"
                      type="success"
                      @click="handleApprovePlanBatch"
                    >
                      一键通过
                    </el-button>
                    <el-button
                      v-if="hasAnyPlanApprovalRole"
                      type="danger"
                      @click="handleRejectPlanBatch"
                    >
                      一键驳回
                    </el-button>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </el-tab-pane>

        <!-- 审批流程视图（使用CustomApprovalFlow组件） -->
        <el-tab-pane name="workflow" label="审批流程">
          <!-- 2026-10-24 用户定案：多条进行中实例时顶部选择栏——
               列出每条实例（标题+当前环节），点选切换展开渲染对应流程 -->
          <!-- 2026-10-27 用户定案：选择栏只承载「当前正在审批的实例」。
               已完成（已通过/已驳回/已撤回）的实例归「审批历史」页签，不在这里出现；
               只有一条在审实例时整栏隐藏，多条时统一编号 实例1、实例2、实例3…。 -->
          <div v-if="workflowFocusCandidates.length > 1" class="workflow-instance-selector">
            <button
              v-for="(instance, idx) in workflowFocusCandidates"
              :key="instance.key"
              type="button"
              class="workflow-instance-option"
              :class="{ active: idx === workflowFocusIdx }"
              @click="workflowFocusIdx = idx"
            >
              <span class="option-index">{{ resolveWorkflowInstanceIndexLabel(idx) }}</span>
              <span class="option-title">{{ instance.label }}</span>
              <span v-if="instance.step" class="option-step">{{ instance.step }}</span>
            </button>
          </div>
          <el-empty
            v-if="
              (showArchivedPlanWorkflowEmptyState || workflowNodes.length === 0) &&
              reportWorkflowInstances.length === 0
            "
            description="暂无审批数据"
            :image-size="120"
          />
          <template v-else>
            <el-alert
              v-if="rejectionReason"
              type="error"
              :title="'驳回原因：' + rejectionReason"
              show-icon
              :closable="false"
              style="margin-bottom: 16px"
            />
            <el-alert
              v-if="
                hasPlanWorkflowData && isPlanPendingApproval && !canCurrentUserHandlePlanApproval
              "
              type="warning"
              title="你当前不是该节点的审批人，仅可查看审批进度和历史。"
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
              @add-node="handleAddNode"
              @update-approver="handleUpdateApprover"
              @save-template="handleSaveTemplate"
              @apply-template="handleApplyTemplate"
            />
          </template>
        </el-tab-pane>

        <!-- 历史记录视图 -->
        <el-tab-pane name="history" label="审批历史">
          <el-empty
            v-if="approvalHistory.length === 0 && !showPlanHistoryCard"
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
                  <el-tag :type="item.statusType || 'success'" size="small">
                    {{ item.statusLabel || '已通过' }}
                  </el-tag>
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
                <div class="card-actions">
                  <el-button @click="openPlanApprovalDetails(item)">查看详情</el-button>
                </div>
              </div>
            </div>
            <el-empty
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
        </el-tab-pane>
      </el-tabs>
    </div>

    <el-dialog
      v-model="planDetailDialogVisible"
      title="审批流程详情"
      width="680px"
      class="plan-detail-dialog"
    >
      <div v-loading="planDetailContentLoading" class="plan-detail-content">
        <div class="plan-detail-summary">
          <div class="summary-title">
            {{ planDetailSelectedTitle || displayedCurrentPlanApprovalName || '当前计划' }}
          </div>
          <div class="summary-subtitle">
            {{
              selectedHistoryInstanceId
                ? '当前查看审批流程'
                : isPlanPendingApproval
                  ? '审批中流程'
                  : '历史审批流程'
            }}
            {{ selectedHistoryInstanceId ? '' : currentPlanApprovalItems.length }}
          </div>
        </div>

        <div v-if="planDetailDialogItems.length > 0" class="plan-detail-list">
          <div
            v-for="item in planDetailDialogItems"
            :key="item.instanceId"
            class="plan-detail-item"
          >
            <div class="detail-item-header">
              <div class="detail-item-title">{{ item.routeTitle || item.title }}</div>
              <el-tag
                :type="item.statusType || detailDialogStatusTag.type"
                effect="light"
                size="small"
              >
                {{ item.statusLabel || detailDialogStatusTag.label }}
              </el-tag>
            </div>
            <div class="detail-item-meta">
              <div v-if="item.flowName" class="detail-meta-row">
                <span class="detail-label">流程名称：</span>
                <span class="detail-value">{{ item.flowName }}</span>
              </div>
              <div class="detail-meta-row">
                <span class="detail-label">流程编号：</span>
                <span class="detail-value">{{ formatInstanceNo(item.instanceNo) }}</span>
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
                  >{{ selectedHistoryInstanceId ? '流程状态' : '当前步骤' }}：</span
                >
                <span class="detail-value">{{ item.currentStepName }}</span>
              </div>
              <div v-if="item.completedAt" class="detail-meta-row">
                <span class="detail-label">完成时间：</span>
                <span class="detail-value">{{ formatTime(item.completedAt) }}</span>
              </div>
            </div>
            <!-- 2026-10-21：异动审批必须能看到「改了哪些内容」——逐字段展示 before→after -->
            <div
              v-if="item.changedFields && Object.keys(item.changedFields).length > 0"
              class="detail-item-mutation"
            >
              <div class="detail-mutation-title">
                本次异动内容
                <span class="detail-mutation-hint">（审批通过后生效）</span>
              </div>
              <div
                v-for="(change, fieldKey) in item.changedFields"
                :key="fieldKey"
                class="detail-mutation-row"
              >
                <span class="detail-mutation-field">{{
                  formatMutationFieldLabel(String(fieldKey), item.mutationEntityType)
                }}</span>
                <span class="detail-mutation-before">{{
                  formatMutationValue(change?.before)
                }}</span>
                <span class="detail-mutation-arrow">→</span>
                <span class="detail-mutation-after">{{ formatMutationValue(change?.after) }}</span>
              </div>
            </div>
          </div>
        </div>
        <el-empty v-else description="暂无审批流程详情" :image-size="100" />

        <div
          v-if="
            !planDetailIsMutationItem &&
            (displayedPlanReportIndicatorItems.length > 0 ||
              displayedDistributionIndicatorItems.length > 0 ||
              displayedPlanReportSummaryComment)
          "
          class="plan-detail-snapshot"
        >
          <div class="summary-title">{{ displayedBusinessSectionTitle }}</div>
          <div class="summary-subtitle">{{ displayedBusinessSectionSubtitle }}</div>

          <div v-if="displayedPlanReportSummaryComment" class="snapshot-summary-card">
            <div class="snapshot-section-title">整单说明</div>
            <div class="snapshot-summary-text">{{ displayedPlanReportSummaryComment }}</div>
          </div>

          <div class="snapshot-indicator-list">
            <div
              v-for="indicator in displayedPlanReportIndicatorItems.length > 0
                ? displayedPlanReportIndicatorItems
                : displayedDistributionIndicatorItems"
              :key="`${indicator.indicatorId || indicator.indicatorName}`"
              class="snapshot-indicator-card"
            >
              <div class="snapshot-indicator-header">
                <div class="snapshot-indicator-name">{{ indicator.indicatorName }}</div>
                <el-tag size="small" effect="light">{{ indicator.indicatorType }}</el-tag>
              </div>

              <div class="snapshot-indicator-grid">
                <div class="snapshot-field">
                  <span class="snapshot-field-label">责任部门</span>
                  <span class="snapshot-field-value">{{ indicator.responsibleDept }}</span>
                </div>
                <div class="snapshot-field">
                  <span class="snapshot-field-label">权重</span>
                  <span class="snapshot-field-value snapshot-field-value--strong">{{
                    indicator.weight === '--' ? '--' : `${indicator.weight} 分`
                  }}</span>
                </div>
              </div>

              <!-- D3：自评进度等级徽标（对齐主审批抽屉） -->
              <div class="snapshot-section">
                <div class="snapshot-section-title">{{ displayedBusinessCommentLabel }}</div>
                <div class="snapshot-section-content">
                  {{ indicator.submittedComment || displayedBusinessEmptyCommentText }}
                </div>
              </div>

              <div class="snapshot-section">
                <div class="snapshot-section-title">自评进度</div>
                <div class="snapshot-section-content">
                  <ElTag v-if="indicator.submittedSelfRating" size="small" type="info">{{
                    formatAppraisalLevel(indicator.submittedSelfRating)
                  }}</ElTag>
                  <span v-else class="snapshot-section-empty">未填报</span>
                </div>
              </div>

              <!-- 2026-10-28 用户定案：审批卡片不提供鉴定下拉——
                   鉴定只在三个表格页的指标行内完成，这里只读展示当前等级。 -->
              <div class="snapshot-section">
                <div class="snapshot-section-title">审核进度</div>
                <div class="snapshot-section-content">
                  <ElTag
                    v-if="indicator.appraisalLevel"
                    size="small"
                    :type="
                      indicator.appraisalLevel === 'DELAYED'
                        ? 'warning'
                        : indicator.appraisalLevel === 'AHEAD'
                          ? 'success'
                          : 'info'
                    "
                    :style="getProgressLevelTagStyle(indicator.appraisalLevel)"
                  >
                    {{ formatAppraisalLevel(indicator.appraisalLevel) }}
                  </ElTag>
                  <span v-else class="snapshot-section-empty">未评定</span>
                </div>
              </div>

              <div class="snapshot-section">
                <div class="snapshot-section-title">{{ displayedBusinessAttachmentLabel }}</div>
                <div v-if="indicator.attachments.length > 0" class="snapshot-attachment-list">
                  <el-button
                    v-for="attachment in indicator.attachments"
                    :key="`${indicator.indicatorId || indicator.indicatorName}-${attachment.attachmentId || attachment.url}`"
                    link
                    type="primary"
                    class="snapshot-attachment-link"
                    @click="handlePlanReportAttachmentOpen(attachment)"
                  >
                    {{ attachment.name }}
                  </el-button>
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
        <el-button @click="planDetailDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </el-drawer>
</template>

<style scoped src="./DistributionApprovalProgressDrawer.css">
/* 选择栏样式在此文件的 <style scoped src> 指向的 CSS 内——
   带 src 的 style 块会忽略内联内容，勿在此处写规则 */
</style>
<style scoped src="./workflowInstanceSelector.css"></style>
