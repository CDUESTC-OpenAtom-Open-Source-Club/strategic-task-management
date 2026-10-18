<script setup lang="ts">
import IndicatorFillHistory from '@/features/plan/ui/IndicatorFillHistory.vue'
import MutationBadgePopover from '@/features/indicator/ui/MutationBadgePopover.vue'
import { ref } from 'vue'
import {
  Plus,
  View,
  Download,
  Promotion,
  RefreshLeft,
  Check,
  Close,
  Upload,
  Edit,
  Refresh,
  Calendar
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { StrategicIndicator } from '@/shared/types'
import {
  buildAttachmentCell,
  buildExportFileName,
  exportRowsToExcel,
  type ExcelExportColumn,
  type ExcelRowTone
} from '@/shared/lib/export/excel'
import { ApprovalProgressDrawer } from '@/features/approval'
import type { ManualAlertSeverity } from '@/shared/api/monitoringApi'
import { truncateText } from '@/shared/lib/utils/formatters'
import {
  useIndicatorListView,
  type IndicatorListViewProps
} from '@/features/indicator/model/useIndicatorListView'

const props = defineProps<IndicatorListViewProps>()

const {
  DEFAULT_APPROVAL_STATUS,
  PLAN_APPROVAL_POLL_INTERVAL_MS,
  PLAN_APPROVAL_WORKFLOW_CODE_COLLEGE,
  PLAN_APPROVAL_WORKFLOW_CODE_FUNCDEPT,
  PLAN_DISPATCH_WORKFLOW_CODE_FUNCDEPT,
  PLAN_REPORT_UI_STATE_KEY,
  PROGRESS_WARNING_DAYS,
  _addIndicatorToCategory,
  _basicIndicators,
  _batchDistributeToDepartments,
  _confirmAssignment,
  _currentTask,
  _developmentIndicators,
  _getTaskGroup,
  _handleBatchDistributeByTask,
  _handleBatchFillByTask,
  _handleBatchRevokeByTask,
  _handleBatchSubmitAll,
  _handleDoubleClick,
  _handleTableScroll,
  _pendingApprovalCount,
  _saveEdit,
  _selectDepartment,
  _selectTask,
  _tableScrollRef,
  addNewRow,
  allIndicatorsFilled,
  allIndicatorsSubmitted,
  applyLocalCurrentPlanDetailsPatch,
  applyLocalPlanReportSummary,
  approvalBadgeCount,
  approvalDrawerVisible,
  approvalEntryButtonText,
  approvalIndicators,
  approvalStatusPopoverLoading,
  approvalStore,
  approvalWorkflowPreview,
  approvalWorkflowReportSummary,
  assignmentMethod,
  assignmentTarget,
  authStore,
  availableOwnerDepts,
  beforeReportUpload,
  canCurrentUserHandlePlanApprovalOnPage,
  canEdit,
  canHandleIndicatorWorkflow,
  canViewReceivedPlanContent,
  canWithdrawAny,
  canWithdrawCurrentPlan,
  canWithdrawDistribution,
  cancelAdd,
  cancelEdit,
  cancelIndicatorEdit,
  clearCurrentPlanReportDerivedState,
  clearPersistedIndicatorDraft,
  closeReportDialog,
  collegePlanCandidates,
  collegePlanDetailsLoading,
  collegePlanDetailsMap,
  currentApprovalApproverName,
  currentApprovalCandidateNames,
  currentApprovalFlowName,
  currentApprovalStatusMeta,
  currentApprovalStepName,
  currentApprovalStepPreview,
  currentApprovalWorkflowStatus,
  currentDate,
  currentDetail,
  currentDetailAttachmentItems,
  currentDraftOwnerKey,
  currentPagePendingPlanTask,
  currentPagePlanTaskId,
  currentPlanDetails,
  currentPlanIndicators,
  currentPlanReportActionState,
  currentPlanReportSummary,
  currentPlanReportUiStatus,
  currentPlanStatus,
  currentMonthlyReportStatusMeta,
  currentPlanWorkflowDetail,
  currentReportIndicator,
  currentTaskIndex,
  currentUserId,
  currentUserOrgId,
  currentUserPermissionCodes,
  currentUserPlan,
  currentUserPlanId,
  currentUserRoleCodes,
  currentViewingOrgId,
  delay,
  detailDrawerVisible,
  reportHistoryOpen,
  currentDetailId,
  editingField,
  editingIndicatorField,
  editingIndicatorId,
  editingIndicatorValue,
  editingValue,
  effectiveViewingDept,
  effectiveViewingRole,
  filterDept,
  filterIndicatorsForCurrentViewer,
  filterOwnerDept,
  filterType1,
  filterType2,
  formatDetailDate,
  functionalDepartments,
  getAttachmentExtension,
  getCurrentPlanId,
  getDisplayedReportedProgress,
  getIndicatorDraftStorageKey,
  getIndicatorProgressStatus,
  getIndicatorWorkflowSnapshot,
  getPlanIndicatorAttachments,
  getPlanIndicatorIds,
  getPlanIndicatorNumber,
  getPlanIndicatorOptionalNumber,
  getPlanIndicatorText,
  getProgressStatusClass,
  getSafeApprovalStatus,
  getSpanMethod,
  getTaskTypeColor,
  handleApprovalStatusPopoverShow,
  handleDeleteIndicator,
  handleIndicatorDblClick,
  handleInlineAttachmentRemove,
  handleOpenApproval,
  handleOpenReportDialog,
  handleReportAttachmentOpen,
  handleReportFileChange,
  handleReportFileRemove,
  handleSelectionChange,
  handleSubmitAll,
  handleViewDetail,
  handleWithdrawAllProgressApprovals,
  handleWithdrawIndicator,
  hasCurrentUserPlan,
  hasCurrentUserPlanData,
  hasIndicatorReportIdentity,
  hasPagePlanApprovalPermission,
  hasPagePlanWorkflowData,
  hasReportContent,
  hydrateCurrentPlanWorkflowState,
  hydratingPlanDetail,
  indicatorRefreshTick,
  indicatorWorkflowCache,
  indicatorWorkflowLoadingMap,
  indicators,
  initOwnerDeptFilter,
  isAddingOrEditing,
  isApprovalStatus,
  isCurrentPlanReportInApproval,
  isCurrentPlanReportLocked,
  isCurrentUserReporter,
  isFunctionalDept,
  isIndicatorDataLoading,
  isIndicatorWorkflowLoading,
  isInitialLoading,
  isLoadingPlanDetails,
  isPagePlanPendingApproval,
  isPlanDistributed,
  isPlanDraft,
  isSavingReport,
  isSecondaryCollege,
  isStrategicDept,
  isTableScrolling,
  isUploadingReportFiles,
  latestPlanReportSummary,
  loadCollegePlanDetails,
  loadCurrentPlanReportSummary,
  loadCurrentPlanWorkflowDetail,
  loadIndicatorWorkflowSnapshot,
  newRow,
  normalizePreviewCandidateDisplayName,
  normalizedCurrentPlanReportStatus,
  normalizedCurrentPlanStatus,
  normalizedCurrentPlanWorkflowStatus,
  openBlobInNewTab,
  openDisplayAttachmentItem,
  openLocalAttachmentFile,
  openRemoteAttachmentFile,
  orgStore,
  overallStatus,
  pagePlanWorkflowStatus,
  pagePlanWorkflowTasks,
  pendingApprovalCount,
  pendingPlanReportUiState,
  persistIndicatorDraft,
  planStore,
  planWarningMessage,
  pollCurrentPlanApprovalState,
  previewableAttachmentExtensions,
  primaryApprovalWorkflowEntityId,
  primaryApprovalWorkflowEntityType,
  readPersistedIndicatorDraft,
  readPlanReportUiState,
  refreshCurrentPlanDetails,
  refreshIndicatorListAfterMutation,
  refreshIndicatorWorkflowContext,
  refreshReportIndicatorSnapshot,
  reportAttachmentObjectUrls,
  reportDialogVisible,
  reportForm,
  currentReportMonthLabel,
  reportUploadFiles,
  resetFilters,
  resolveDialogAttachments,
  resolveExpectedApproverOrgIdForPage,
  resolveExpectedApproverRoleCodesForPage,
  resolveIndicatorAttachmentItems,
  resolveIndicatorType2,
  resolvePlanApprovalWorkflowCode,
  resolvePlanYear,
  restartPlanApprovalPolling,
  saveIndicatorEdit,
  saveNewRow,
  secondaryApprovalWorkflowEntityId,
  secondaryApprovalWorkflowEntityType,
  selectedCollegePlan,
  selectedDepartment,
  selectedIndicators,
  settleCurrentPlanReportState,
  shouldShowDetailLifecycleTag,
  shouldShowDetailResponsibleDept,
  shouldShowPlanWarning,
  shouldShowReportedProgress,
  showAssignmentDialog,
  showOwnerDeptDetail,
  showPlanBatchActions,
  showResponsibleDeptColumn,
  showStrategicTaskColumn,
  showSubmitAllButton,
  showWithdrawAllButton,
  strategicStore,
  submitProgressReport,
  syncBackendReportedProgress,
  syncReportAttachmentUrls,
  tableRef,
  taskList,
  taskOptions,
  timeContext,
  triggerBlobDownload,
  unfilledIndicatorsCount,
  uploadReportAttachments,
  usePlanReportFlow,
  vFocus,
  withdrawTooltip,
  writePlanReportUiState
} = useIndicatorListView(props)

const indicatorListExporting = ref(false)

// 2026-10-14 用户定案：与战略任务管理/下发界面同构——同一战略任务多行在「战略任务」列合并；移除「内部ID」列
const buildIndicatorListExportColumns = (
  rows: StrategicIndicator[]
): ExcelExportColumn<StrategicIndicator>[] => {
  const taskSpanByIndex = new Map<number, number>()
  rows.forEach((row, index) => {
    const key = row.taskContent || '-'
    const prevKey = index > 0 ? rows[index - 1].taskContent || '-' : null
    if (prevKey === key) {
      taskSpanByIndex.set(index, 0)
      return
    }
    let end = index + 1
    while (end < rows.length && (rows[end].taskContent || '-') === key) {
      end += 1
    }
    taskSpanByIndex.set(index, end - index)
  })

  return [
    { header: '序号', width: 8, align: 'center', getValue: (_row, index) => index + 1 },
    { header: '来源部门', width: 18, getValue: row => row.ownerDept || '-' },
    { header: '责任部门', width: 18, getValue: row => row.responsibleDept || '-' },
    {
      header: '战略任务',
      width: 28,
      getValue: (row, index) => {
        const text = row.taskContent || '-'
        const span = taskSpanByIndex.get(index) ?? 1
        if (span > 1) {
          return { value: text, rowSpan: span, alignVertical: 'center' }
        }
        // 被上方合并覆盖的从属行：write-excel-file 要求传 null
        if (span === 0) {
          return null
        }
        return text
      }
    },
    { header: '核心指标', width: 32, getValue: row => row.name || '-' },
    { header: '指标类型', width: 12, align: 'center', getValue: row => row.type1 || '-' },
    { header: '任务类别', width: 12, align: 'center', getValue: row => row.type2 || '-' },
    { header: '备注', width: 24, getValue: row => row.remark || '-' },
    { header: '权重', width: 10, align: 'center', getValue: row => Number(row.weight || 0) },
    {
      header: '鉴定进度等级',
      width: 18,
      align: 'center',
      getValue: row => getManualAlertLabel(row.manualAlertSeverity)
    },
    { header: '填报说明', width: 28, getValue: row => row.pendingRemark || '-' },
    {
      header: '上报资料',
      width: 42,
      getValue: row => buildAttachmentCell(resolveIndicatorAttachmentItems(row))
    }
  ]
}

const getIndicatorListExportRows = (): StrategicIndicator[] => {
  const source =
    currentPlanIndicators.value.length > 0 ? currentPlanIndicators.value : indicators.value
  return [...source].sort((left, right) => {
    const leftType = String(left.type2 || '')
    const rightType = String(right.type2 || '')
    if (leftType !== rightType) {
      return leftType === '发展性' ? -1 : 1
    }
    return String(left.taskContent || '').localeCompare(String(right.taskContent || ''))
  })
}

const getIndicatorListExportRowTone = (row: StrategicIndicator): ExcelRowTone => {
  if (String(row.type2 || '').includes('发展')) {
    return 'development'
  }
  if (String(row.type2 || '').includes('基础')) {
    return 'basic'
  }
  return 'default'
}

const manualAlertOptions: Array<{
  label: string
  value: ManualAlertSeverity
  type: 'success' | 'info' | 'warning' | 'danger'
}> = [
  // 进度等级三档（与战略任务管理页 manualAlertOptions 一致）：存储码沿用 alert severity
  { label: '未评定', value: null, type: 'info' },
  { label: '超前完成', value: 'AHEAD', type: 'success' },
  { label: '正常', value: 'NORMAL', type: 'success' },
  { label: '延期', value: 'DELAYED', type: 'warning' }
]

const getManualAlertOption = (severity?: ManualAlertSeverity) =>
  manualAlertOptions.find(option => option.value === (severity ?? null)) || manualAlertOptions[0]

const getManualAlertLabel = (severity?: ManualAlertSeverity) => getManualAlertOption(severity).label

const getManualAlertTagType = (severity?: ManualAlertSeverity) =>
  getManualAlertOption(severity).type

const getMonthlyExpectedProgress = () => {
  const month = new Date().getMonth() + 1
  return Math.min(100, Math.round((month / 12) * 100))
}

const handleExportIndicatorList = async () => {
  const rows = getIndicatorListExportRows()
  if (rows.length === 0) {
    ElMessage.warning('暂无可导出的指标数据')
    return
  }

  indicatorListExporting.value = true
  try {
    const scopeName = effectiveViewingDept.value || authStore.userDepartment || '当前部门'
    await exportRowsToExcel(
      {
        sheetName: scopeName,
        rows,
        columns: buildIndicatorListExportColumns(rows),
        getRowTone: getIndicatorListExportRowTone
      },
      buildExportFileName('指标填报与管理', scopeName)
    )
    ElMessage.success('导出成功')
  } catch {
    ElMessage.error('导出失败，请稍后重试')
  } finally {
    indicatorListExporting.value = false
  }
}
</script>

<template>
  <div class="indicator-list-container page-fade-enter">
    <!-- 页面头部 - 统一页面头部样式 (Requirements: 5.1, 5.2) -->
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">指标列表</h1>
        <p class="page-desc">管理和查看所有战略考核指标</p>
      </div>
      <div class="page-actions">
        <el-button :loading="indicatorListExporting" @click="handleExportIndicatorList">
          <el-icon><Download /></el-icon>
          导出
        </el-button>
      </div>
    </div>

    <!-- 主内容区域 -->
    <div class="content-wrapper">
      <!-- 筛选卡片 - 统一卡片样式 (Requirements: 2.1, 2.2, 8.1) -->
      <div class="filter-card card-base card-animate">
        <div class="card-body">
          <el-form :inline="true" class="filter-form">
            <el-form-item label="任务类型">
              <el-select
                v-model="filterType2"
                placeholder="全部类型"
                clearable
                style="width: 140px"
              >
                <el-option label="发展性" value="发展性" />
                <el-option label="基础性" value="基础性" />
              </el-select>
            </el-form-item>
            <!-- 来源部门筛选（仅学院可见） -->
            <el-form-item
              v-if="isSecondaryCollege && availableOwnerDepts.length > 0"
              label="来源部门"
            >
              <el-select v-model="filterOwnerDept" placeholder="选择来源部门" style="width: 200px">
                <el-option
                  v-for="dept in availableOwnerDepts"
                  :key="dept"
                  :label="dept"
                  :value="dept"
                />
              </el-select>
            </el-form-item>
            <el-form-item v-if="showResponsibleDeptColumn" label="责任部门">
              <el-select v-model="filterDept" placeholder="全部部门" clearable style="width: 200px">
                <el-option
                  v-for="dept in functionalDepartments"
                  :key="dept"
                  :label="dept"
                  :value="dept"
                />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button @click="resetFilters">重置</el-button>
            </el-form-item>
          </el-form>
        </div>
      </div>

      <!-- 指标表格卡片 - 统一表格样式 (Requirements: 4.1, 4.2, 4.3) -->
      <div class="table-card card-base card-animate" style="animation-delay: 0.1s">
        <div class="card-header">
          <span class="card-title">指标列表</span>
          <div class="header-actions">
            <el-tag
              size="small"
              class="overall-status-tag"
              :type="currentMonthlyReportStatusMeta.type"
            >
              本月上报状态: {{ currentMonthlyReportStatusMeta.label }}
            </el-tag>
            <el-popover
              placement="top-start"
              trigger="hover"
              :width="320"
              popper-class="approval-status-popper"
              @show="handleApprovalStatusPopoverShow"
            >
              <template #reference>
                <el-tag
                  size="small"
                  class="overall-status-tag overall-status-tag--clickable"
                  :type="currentApprovalStatusMeta.type"
                  @click.stop="handleOpenApproval"
                >
                  审批状态: {{ currentApprovalStatusMeta.label }}
                </el-tag>
              </template>

              <div class="approval-status-card" @click.stop="handleOpenApproval">
                <div class="approval-status-card__header">
                  <span class="approval-status-card__title">流程状态</span>
                </div>
                <div class="approval-status-card__body">
                  <div class="approval-status-card__row">
                    <span class="approval-status-card__label">说明</span>
                    <span class="approval-status-card__value">
                      {{ currentApprovalStatusMeta.description }}
                    </span>
                  </div>
                  <div
                    v-if="approvalStatusPopoverLoading || currentApprovalFlowName"
                    class="approval-status-card__row"
                  >
                    <span class="approval-status-card__label">审批流</span>
                    <span class="approval-status-card__value">
                      {{ approvalStatusPopoverLoading ? '加载中...' : currentApprovalFlowName }}
                    </span>
                  </div>
                  <div v-if="currentApprovalStepName" class="approval-status-card__row">
                    <span class="approval-status-card__label">当前节点</span>
                    <span class="approval-status-card__value">{{ currentApprovalStepName }}</span>
                  </div>
                  <div
                    v-if="currentApprovalCandidateNames.length > 0"
                    class="approval-status-card__row"
                  >
                    <span class="approval-status-card__label">可审批人</span>
                    <span class="approval-status-card__value">
                      {{ currentApprovalCandidateNames.join('、') }}
                    </span>
                  </div>
                </div>
                <div class="approval-status-card__footer">点击可进入审批中心</div>
              </div>
            </el-popover>
            <span class="indicator-count">共 {{ indicators.length }} 条记录</span>

            <!-- 职能部门/二级学院的批量操作按钮 -->
            <template v-if="showPlanBatchActions">
              <!-- 一键提交按钮（所有指标都已填报且未全部提交时显示） -->
              <el-button
                v-if="showSubmitAllButton"
                type="primary"
                size="small"
                :disabled="
                  timeContext.isReadOnly || indicators.length === 0 || !allIndicatorsFilled
                "
                :title="!allIndicatorsFilled ? `还有 ${unfilledIndicatorsCount} 个指标未填报` : ''"
                @click="handleSubmitAll"
              >
                <el-icon><Upload /></el-icon>
                一键提交
              </el-button>
              <!-- 一键撤回按钮（有任何待审批指标时显示） -->
              <el-tooltip
                v-if="showWithdrawAllButton"
                :content="withdrawTooltip"
                :disabled="timeContext.isReadOnly || canWithdrawAny"
                effect="dark"
                placement="top"
              >
                <span style="display: inline-block">
                  <el-button
                    type="warning"
                    size="small"
                    :disabled="timeContext.isReadOnly || !canWithdrawAny"
                    @click="handleWithdrawAllProgressApprovals"
                  >
                    <el-icon><RefreshLeft /></el-icon>
                    一键撤回
                  </el-button>
                </span>
              </el-tooltip>
            </template>

            <template
              v-if="
                !isStrategicDept &&
                canViewReceivedPlanContent &&
                Boolean(currentUserPlanId) &&
                indicators.length > 0
              "
            >
              <el-badge
                v-if="approvalBadgeCount > 0"
                :value="approvalBadgeCount"
                class="approval-badge"
              >
                <el-button
                  size="small"
                  type="warning"
                  style="margin-left: 8px"
                  @click="handleOpenApproval"
                >
                  <el-icon><Check /></el-icon>
                  {{ approvalEntryButtonText }}
                </el-button>
              </el-badge>
              <el-button v-else size="small" style="margin-left: 8px" @click="handleOpenApproval">
                <el-icon><Check /></el-icon>
                {{ approvalEntryButtonText }}
              </el-button>
            </template>
          </div>
        </div>
        <div class="card-body table-body">
          <div class="table-container">
            <div v-if="isInitialLoading" class="loading-state">
              <el-skeleton :rows="8" animated />
            </div>

            <el-table
              v-else-if="indicators.length > 0"
              ref="tableRef"
              v-loading="isLoadingPlanDetails"
              :data="indicators"
              :span-method="getSpanMethod"
              border
              highlight-current-row
              class="unified-table"
              @selection-change="handleSelectionChange"
            >
              <el-table-column
                v-if="showStrategicTaskColumn"
                prop="taskContent"
                label="战略任务"
                width="126"
              >
                <template #default="{ row }">
                  <el-tooltip
                    :content="row.taskContent || '未关联任务'"
                    :disabled="(row.taskContent || '').length <= 50"
                    placement="top"
                  >
                    <span
                      class="task-content-colored"
                      :style="{ color: getTaskTypeColor(row.type2) }"
                      >{{ truncateText(row.taskContent || '未关联任务', 50) }}</span
                    >
                  </el-tooltip>
                </template>
              </el-table-column>
              <el-table-column prop="name" label="核心指标" min-width="228">
                <template #default="{ row }">
                  <div class="indicator-name-cell" @dblclick="handleIndicatorDblClick(row, 'name')">
                    <el-input
                      v-if="editingIndicatorId === row.id && editingIndicatorField === 'name'"
                      v-model="editingIndicatorValue"
                      v-focus
                      type="textarea"
                      :autosize="{ minRows: 2, maxRows: 6 }"
                      @blur="saveIndicatorEdit(row, 'name')"
                    />
                    <el-tooltip
                      v-else
                      :content="row.name || ''"
                      :disabled="(row.name || '').length <= 50"
                      placement="top"
                    >
                      <span
                        class="indicator-name-text"
                        :class="
                          row.type1 === '定性' ? 'indicator-qualitative' : 'indicator-quantitative'
                        "
                        >{{ truncateText(row.name || '', 50) }}</span
                      >
                    </el-tooltip>

                    <!-- D10：异动/改名历史徽标（悬停看历史，无变更自动隐藏） -->
                    <MutationBadgePopover
                      v-if="row.id"
                      class="indicator-row-badge"
                      :indicator-id="row.id"
                    />
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="weight" label="权重" width="82" align="center">
                <template #default="{ row }">
                  <div class="weight-cell" @dblclick="handleIndicatorDblClick(row, 'weight')">
                    <el-input
                      v-if="editingIndicatorId === row.id && editingIndicatorField === 'weight'"
                      v-model="editingIndicatorValue"
                      v-focus
                      size="small"
                      style="width: 50px"
                      @blur="saveIndicatorEdit(row, 'weight')"
                    />
                    <span v-else class="weight-text">{{ row.weight }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="自评等级" width="108" align="center">
                <template #default="{ row }">
                  <el-tag
                    v-if="row.selfRating"
                    :type="row.selfRating === 'DELAYED' ? 'warning' : 'success'"
                    size="small"
                  >
                    {{
                      { AHEAD: '超前完成', NORMAL: '正常', DELAYED: '延期' }[row.selfRating] ||
                      row.selfRating
                    }}
                  </el-tag>
                  <span v-else style="color: #909399">—</span>
                </template>
              </el-table-column>
              <el-table-column label="鉴定进度等级" width="128" align="center">
                <template #default="{ row }">
                  <el-tag :type="getManualAlertTagType(row.manualAlertSeverity)" size="small">
                    {{ getManualAlertLabel(row.manualAlertSeverity) }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column label="进度说明" min-width="120">
                <template #default="{ row }">
                  <el-tooltip
                    :content="row.pendingRemark || ''"
                    :disabled="(row.pendingRemark || '').length <= 50"
                    placement="top"
                  >
                    <span class="pending-remark-text">{{
                      row.pendingRemark ? truncateText(row.pendingRemark, 50) : '—'
                    }}</span>
                  </el-tooltip>
                </template>
              </el-table-column>
              <el-table-column label="上报资料" width="68" align="center">
                <template #default="{ row }">
                  <div
                    v-if="
                      (row.attachments?.length || row.pendingAttachmentDetails?.length || 0) > 0
                    "
                  >
                    <el-button link type="primary" size="small" @click="handleViewDetail(row)">
                      {{ row.attachments?.length || row.pendingAttachmentDetails?.length || 0 }} 个
                    </el-button>
                  </div>
                  <div v-else style="color: #909399">—</div>
                </template>
              </el-table-column>
              <el-table-column prop="remark" label="备注" width="104">
                <template #default="{ row }">
                  <div
                    class="indicator-name-cell"
                    @dblclick="handleIndicatorDblClick(row, 'remark')"
                  >
                    <el-input
                      v-if="editingIndicatorId === row.id && editingIndicatorField === 'remark'"
                      v-model="editingIndicatorValue"
                      v-focus
                      type="textarea"
                      :autosize="{ minRows: 2, maxRows: 6 }"
                      @blur="saveIndicatorEdit(row, 'remark')"
                    />
                    <el-tooltip
                      v-else
                      :content="row.remark || ''"
                      :disabled="(row.remark || '').length <= 50"
                      placement="top"
                    >
                      <span class="remark-text">{{
                        row.remark ? truncateText(row.remark, 50) : ''
                      }}</span>
                    </el-tooltip>
                  </div>
                </template>
              </el-table-column>
              <el-table-column
                v-if="showResponsibleDeptColumn"
                prop="responsibleDept"
                label="责任部门"
                min-width="140"
              >
                <template #default="{ row }">
                  <span class="dept-text">{{ row.responsibleDept || '未分配' }}</span>
                </template>
              </el-table-column>

              <el-table-column label="操作" width="188" align="center">
                <template #default="{ row }">
                  <div class="action-cell">
                    <div class="action-buttons">
                      <el-button link type="primary" size="small" @click="handleViewDetail(row)"
                        >查看</el-button
                      >
                      <el-button
                        v-if="!isStrategicDept"
                        v-show="!isCurrentPlanReportLocked"
                        link
                        :type="hasReportContent(row) ? 'info' : 'success'"
                        size="small"
                        :disabled="
                          isApprovalStatus(row, 'PENDING') ||
                          isCurrentPlanReportLocked ||
                          timeContext.isReadOnly
                        "
                        @click="handleOpenReportDialog(row)"
                        >{{
                          isApprovalStatus(row, 'REJECTED')
                            ? '重新填报'
                            : hasReportContent(row)
                              ? '编辑'
                              : '填报'
                        }}</el-button
                      >

                      <el-button
                        v-if="isStrategicDept && canWithdrawDistribution(row)"
                        link
                        type="warning"
                        size="small"
                        :disabled="timeContext.isReadOnly"
                        @click="handleWithdrawIndicator(row)"
                      >
                        <el-icon><RefreshLeft /></el-icon>
                        撤回下发
                      </el-button>

                      <el-button
                        v-if="canEdit"
                        link
                        type="danger"
                        size="small"
                        @click="handleDeleteIndicator(row)"
                        >删除</el-button
                      >
                    </div>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <!-- 空状态 - 统一空状态样式 (Requirements: 7.1, 7.2, 7.3) -->
          <div v-if="!isInitialLoading && indicators.length === 0" class="empty-state">
            <el-alert
              v-if="shouldShowPlanWarning"
              title="未找到对应的计划"
              type="warning"
              :closable="false"
              style="margin-bottom: 20px"
            >
              <template #default>
                {{ planWarningMessage }}
              </template>
            </el-alert>

            <el-empty :description="shouldShowPlanWarning ? '' : '暂无指标数据'"> </el-empty>
          </div>
        </div>
      </div>
    </div>

    <!-- 新增指标表单 - 统一表单样式 (Requirements: 8.1, 8.2, 8.3) -->
    <el-dialog
      v-model="isAddingOrEditing"
      title="新增指标"
      width="600px"
      :close-on-click-modal="false"
    >
      <el-form label-width="100px" class="add-form">
        <el-form-item label="战略任务" required>
          <el-select
            v-model="newRow.taskContent"
            placeholder="请选择所属战略任务"
            style="width: 100%"
            popper-class="sism-select-popper--visible-scrollbar"
          >
            <el-option
              v-for="task in taskOptions"
              :key="task.value"
              :label="task.label"
              :value="task.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="指标名称" required>
          <el-input v-model="newRow.name" placeholder="请输入指标名称" />
        </el-form-item>
        <el-form-item label="任务类型">
          <el-select v-model="newRow.type2" style="width: 100%">
            <el-option label="发展性" value="发展性" />
            <el-option label="基础性" value="基础性" />
          </el-select>
        </el-form-item>
        <el-form-item label="指标类型">
          <el-select v-model="newRow.type1" style="width: 100%">
            <el-option label="定性" value="定性" />
            <el-option label="定量" value="定量" />
          </el-select>
        </el-form-item>
        <el-form-item label="权重">
          <el-input v-model="newRow.weight" placeholder="请输入权重" type="number" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="newRow.remark" type="textarea" :rows="3" placeholder="请输入备注" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="cancelAdd">取消</el-button>
        <el-button type="primary" @click="saveNewRow">保存</el-button>
      </template>
    </el-dialog>

    <!-- 详情抽屉 -->
    <el-drawer v-model="detailDrawerVisible" title="指标详情" size="45%">
      <div v-if="currentDetail" class="detail-container">
        <!-- 基础信息 -->
        <div class="detail-header">
          <h3>{{ currentDetail.name }}</h3>
          <div class="detail-tags">
            <el-tag size="small" :type="currentDetail.type1 === '定量' ? 'primary' : 'warning'">{{
              currentDetail.type1
            }}</el-tag>
            <el-tag
              size="small"
              :style="{
                backgroundColor: getTaskTypeColor(currentDetail.type2),
                color: '#fff',
                border: 'none'
              }"
            >
              {{ currentDetail.type2 }}任务
            </el-tag>
            <template v-if="shouldShowDetailLifecycleTag">
              <!-- Plan-centric: 状态由 Plan 控制，不是指标自己的 canWithdraw 字段 -->
              <el-tag v-if="isPlanDraft" size="small" type="info">待下发</el-tag>
              <el-tag v-else-if="isPlanDistributed" size="small" type="success">已下发</el-tag>
              <el-tag v-else size="small" type="info">待下发</el-tag>
            </template>
          </div>
        </div>

        <el-descriptions :column="2" border class="detail-desc">
          <el-descriptions-item label="战略任务" :span="2">{{
            currentDetail.taskContent
          }}</el-descriptions-item>
          <el-descriptions-item label="任务类别"
            >{{ currentDetail.type2 }}任务</el-descriptions-item
          >
          <el-descriptions-item label="指标类型">{{ currentDetail.type1 }}</el-descriptions-item>
          <el-descriptions-item label="权重">{{ currentDetail.weight }}</el-descriptions-item>
          <el-descriptions-item label="鉴定进度等级">
            <el-tag :type="getManualAlertTagType(currentDetail.manualAlertSeverity)" size="small">
              {{ getManualAlertLabel(currentDetail.manualAlertSeverity) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item v-if="shouldShowDetailResponsibleDept" label="责任部门">
            {{ currentDetail.responsibleDept || '未分配' }}
          </el-descriptions-item>
          <el-descriptions-item v-if="showOwnerDeptDetail" label="来源部门">
            {{ currentDetail.ownerDept || '未知' }}
          </el-descriptions-item>
          <el-descriptions-item label="创建时间" :span="2">{{
            formatDetailDate(currentDetail.createTime)
          }}</el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">{{
            currentDetail.remark || '暂无备注'
          }}</el-descriptions-item>
        </el-descriptions>

        <div v-if="currentDetailAttachmentItems.length > 0" class="detail-attachments">
          <div class="divider"></div>
          <h4>相关上报资料</h4>
          <div class="detail-attachments__list">
            <button
              v-for="(attachment, index) in currentDetailAttachmentItems"
              :key="`${attachment.attachmentId || attachment.url}-${index}`"
              type="button"
              class="detail-attachments__item"
              :title="`双击打开 ${attachment.name}`"
              @dblclick.prevent.stop="openDisplayAttachmentItem(attachment)"
            >
              {{ attachment.name }}
            </button>
          </div>
        </div>
      </div>

      <el-collapse v-model="reportHistoryOpen" class="report-history-collapse">
        <el-collapse-item title="上报记录（历次填报 / 含被驳回）" name="history">
          <IndicatorFillHistory
            v-if="reportHistoryOpen?.includes('history') && currentDetailId"
            :indicator-id="currentDetailId"
          />
        </el-collapse-item>
      </el-collapse>
    </el-drawer>

    <!-- 进度填报弹窗 -->
    <el-dialog
      v-model="reportDialogVisible"
      title="指标填报"
      width="500px"
      :close-on-click-modal="false"
      @close="closeReportDialog"
    >
      <div v-if="currentReportIndicator" class="report-dialog">
        <!-- 指标信息 -->
        <div class="report-indicator-info">
          <div class="info-row">
            <span class="info-label">指标名称：</span>
            <span class="info-value">{{ currentReportIndicator.name }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">自评等级：</span>
            <span class="info-value highlight">{{
              { AHEAD: '超前完成', NORMAL: '正常', DELAYED: '延期' }[
                currentReportIndicator.selfRating
              ] || '未自评'
            }}</span>
          </div>
        </div>

        <el-divider />

        <!-- 2026-10-15 用户定案：归属月份由系统锁定（最早未填报月），不可选择——
             按月顺序依次填报、不能跳月，故不再提供下拉，改为顶部醒目提示。 -->
        <div class="report-month-banner">
          <el-icon class="report-month-banner__icon"><Calendar /></el-icon>
          <div class="report-month-banner__body">
            <span class="report-month-banner__label">本次填报归属月份</span>
            <span class="report-month-banner__value">{{ currentReportMonthLabel }}</span>
          </div>
          <span class="report-month-banner__hint">按月顺序填报，不可跳月</span>
        </div>

        <!-- 填报表单 -->
        <el-form label-width="100px" class="report-form">
          <el-form-item label="自评等级" required>
            <el-select
              v-model="reportForm.selfRating"
              placeholder="请自评进度"
              style="width: 200px"
            >
              <el-option label="超前完成" value="AHEAD" />
              <el-option label="正常" value="NORMAL" />
              <el-option label="延期" value="DELAYED" />
            </el-select>
            <span class="form-hint">进度按等级定性评价，不再填写百分比</span>
          </el-form-item>
          <el-form-item label="进度说明" required>
            <el-input
              v-model="reportForm.remark"
              type="textarea"
              :rows="4"
              placeholder="请详细说明本次进度更新的工作内容和完成情况..."
              maxlength="500"
              show-word-limit
            />
          </el-form-item>
          <el-form-item label="上报资料（可选）">
            <el-upload
              v-model:file-list="reportUploadFiles"
              action="#"
              :auto-upload="false"
              multiple
              :limit="5"
              :disabled="isUploadingReportFiles || isSavingReport"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
              :on-change="handleReportFileChange"
              :on-remove="handleReportFileRemove"
              :before-upload="beforeReportUpload"
            >
              <el-button size="small" type="primary" plain>选择文件</el-button>
              <template #tip>
                <div class="upload-tip">
                  支持 PDF、Word、Excel、图片格式，单个文件不超过
                  30MB，最多5个文件。选择后仅暂存，保存时才会上传并关联。双击文件名可预览或下载。
                </div>
              </template>
              <template #file="{ file }">
                <div class="custom-upload-file">
                  <button
                    type="button"
                    class="custom-upload-file__name"
                    :title="`双击打开 ${file.name || '附件'}`"
                    @dblclick.prevent.stop="handleReportAttachmentOpen(file as ReportUploadFile)"
                  >
                    {{ file.name || '附件' }}
                  </button>
                  <button
                    type="button"
                    class="custom-upload-file__remove"
                    aria-label="移除附件"
                    @click.prevent.stop="handleInlineAttachmentRemove(file)"
                  >
                    ×
                  </button>
                </div>
              </template>
            </el-upload>
          </el-form-item>
        </el-form>

        <!-- 提示信息 -->
        <div class="report-tips">
          <el-alert
            title="保存后可在批量操作中统一提交审批"
            type="info"
            :closable="false"
            show-icon
          />
        </div>
      </div>

      <template #footer>
        <el-button :disabled="isSavingReport" @click="closeReportDialog">取消</el-button>
        <el-button
          type="primary"
          :loading="isSavingReport || isUploadingReportFiles"
          :disabled="isSavingReport || isUploadingReportFiles"
          @click="submitProgressReport"
          >保存</el-button
        >
      </template>
    </el-dialog>

    <!-- 任务审批进度抽屉 -->
    <ApprovalProgressDrawer
      v-model="approvalDrawerVisible"
      :indicators="approvalIndicators"
      :plan="currentPlanDetails"
      :initial-plan-workflow-detail="currentPlanWorkflowDetail"
      :department-name="effectiveViewingDept || '当前部门'"
      :plan-name="
        currentPlanDetails?.taskName ||
        currentPlanDetails?.name ||
        effectiveViewingDept ||
        '当前部门'
      "
      :show-plan-approvals="true"
      :show-approval-section="true"
      :workflow-code="resolvePlanApprovalWorkflowCode()"
      :workflow-entity-type="primaryApprovalWorkflowEntityType"
      :workflow-entity-id="primaryApprovalWorkflowEntityId"
      :secondary-workflow-entity-type="secondaryApprovalWorkflowEntityType"
      :secondary-workflow-entity-id="secondaryApprovalWorkflowEntityId"
      :plan-report-summary="currentPlanReportSummary"
      :show-route-button="false"
      history-view-mode="card-only"
      approval-type="submission"
      @refresh="refreshIndicatorListAfterMutation"
    />
  </div>
</template>

<style scoped src="./IndicatorListView.css"></style>
