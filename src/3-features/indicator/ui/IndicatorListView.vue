<script setup lang="ts">
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
  Refresh
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { StrategicIndicator } from '@/shared/types'
import {
  buildAttachmentCell,
  buildExportFileName,
  exportRowsToExcel,
  formatProgress,
  type ExcelExportColumn,
  type ExcelRowTone
} from '@/shared/lib/export/excel'
import { ApprovalProgressDrawer } from '@/features/approval'
import type { ManualAlertSeverity } from '@/shared/api/monitoringApi'
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
  _addMilestone,
  _basicIndicators,
  _batchDistributeToDepartments,
  _calculateMilestoneStatus,
  _confirmAssignment,
  _currentTask,
  _developmentIndicators,
  _getMilestoneProgressText,
  _getTaskGroup,
  _handleBatchDistributeByTask,
  _handleBatchFillByTask,
  _handleBatchRevokeByTask,
  _handleBatchSubmitAll,
  _handleDoubleClick,
  _handleTableScroll,
  _pendingApprovalCount,
  _removeMilestone,
  _saveEdit,
  _selectDepartment,
  _selectTask,
  _showMilestoneInput,
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
  currentPlanStatusMeta,
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
  formatMilestoneDate,
  functionalDepartments,
  getAttachmentExtension,
  getCurrentPlanId,
  getDisplayProgress,
  getDisplayedReportedProgress,
  getIndicatorDraftStorageKey,
  getIndicatorProgressStatus,
  getIndicatorWorkflowSnapshot,
  getMilestonesTooltip,
  getPlanIndicatorAttachments,
  getPlanIndicatorIds,
  getPlanIndicatorNumber,
  getPlanIndicatorOptionalNumber,
  getPlanIndicatorText,
  getProgressStatusClass,
  getSafeApprovalStatus,
  getSortedMilestones,
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
  nearestMilestone,
  newRow,
  normalizePlanMilestoneStatus,
  normalizePlanMilestones,
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
  reportUploadFiles,
  resetFilters,
  resolveMilestoneDisplayState,
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

const indicatorListExportColumns: ExcelExportColumn<StrategicIndicator>[] = [
  { header: '序号', width: 8, align: 'center', getValue: (_row, index) => index + 1 },
  { header: '来源部门', width: 18, getValue: row => row.ownerDept || '-' },
  { header: '责任部门', width: 18, getValue: row => row.responsibleDept || '-' },
  { header: '战略任务', width: 28, getValue: row => row.taskContent || '-' },
  { header: '核心指标', width: 32, getValue: row => row.name || '-' },
  { header: '指标类型', width: 12, align: 'center', getValue: row => row.type1 || '-' },
  { header: '任务类别', width: 12, align: 'center', getValue: row => row.type2 || '-' },
  { header: '备注', width: 24, getValue: row => row.remark || '-' },
  { header: '权重', width: 10, align: 'center', getValue: row => Number(row.weight || 0) },
  {
    header: '进度',
    width: 24,
    getValue: row => formatProgress(getDisplayProgress(row), getDisplayedReportedProgress(row))
  },
  {
    header: '预警等级判定',
    width: 18,
    align: 'center',
    getValue: row => getManualAlertLabel(row.manualAlertSeverity)
  },
  { header: '填报说明', width: 28, getValue: row => row.pendingRemark || '-' },
  {
    header: '附件',
    width: 42,
    getValue: row => buildAttachmentCell(resolveIndicatorAttachmentItems(row))
  }
]

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
  { label: '无预警', value: null, type: 'success' },
  { label: '一般滞后', value: 'INFO', type: 'info' },
  { label: '严重滞后', value: 'WARNING', type: 'warning' },
  { label: '重大滞后', value: 'CRITICAL', type: 'danger' }
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
        columns: indicatorListExportColumns,
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
            <el-tag size="small" class="overall-status-tag" :type="currentPlanStatusMeta.type">
              计划状态: {{ currentPlanStatusMeta.label }}
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
                width="200"
              >
                <template #default="{ row }">
                  <el-tooltip
                    :content="row.type2 === '发展性' ? '发展性任务' : '基础性任务'"
                    placement="top"
                  >
                    <span
                      class="task-content-colored"
                      :style="{ color: getTaskTypeColor(row.type2) }"
                      >{{ row.taskContent || '未关联任务' }}</span
                    >
                  </el-tooltip>
                </template>
              </el-table-column>
              <el-table-column prop="name" label="核心指标" min-width="280">
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
                      :content="row.type1 === '定性' ? '定性指标' : '定量指标'"
                      placement="top"
                    >
                      <span
                        class="indicator-name-text"
                        :class="
                          row.type1 === '定性' ? 'indicator-qualitative' : 'indicator-quantitative'
                        "
                        >{{ row.name }}</span
                      >
                    </el-tooltip>
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="remark" label="备注" width="130">
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
                    <span v-else class="remark-text">{{ row.remark || '' }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="weight" label="权重" width="100" align="center">
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
              <el-table-column prop="progress" label="进度" width="150" align="center">
                <template #default="{ row }">
                  <div class="progress-cell">
                    <span class="progress-number" :class="getProgressStatusClass(row)">
                      {{ getDisplayProgress(row) }}%
                    </span>
                    <el-tooltip
                      v-if="shouldShowReportedProgress(row)"
                      content="填报进度"
                      placement="top"
                    >
                      <span class="reported-progress"
                        >({{ getDisplayedReportedProgress(row) }}%)</span
                      >
                    </el-tooltip>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="预警等级判定" width="150" align="center">
                <template #default="{ row }">
                  <el-tag :type="getManualAlertTagType(row.manualAlertSeverity)" size="small">
                    {{ getManualAlertLabel(row.manualAlertSeverity) }}
                  </el-tag>
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

              <el-table-column label="操作" width="260" align="center">
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
          <el-descriptions-item label="当前进度"
            >{{ currentDetail.progress || 0 }}%</el-descriptions-item
          >
          <el-descriptions-item label="填报进度">
            <template v-if="shouldShowReportedProgress(currentDetail)">
              <el-tooltip content="已提交但尚未审批通过的填报进度" placement="top">
                <span style="color: #e6a23c; font-weight: 600"
                  >{{ getDisplayedReportedProgress(currentDetail) }}%</span
                >
              </el-tooltip>
            </template>
            <span v-else style="color: #909399">暂无填报</span>
          </el-descriptions-item>
          <el-descriptions-item label="预警等级判定">
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
          <h4>相关附件</h4>
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
    </el-drawer>

    <!-- 进度填报弹窗 -->
    <el-dialog
      v-model="reportDialogVisible"
      title="进度填报"
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
            <span class="info-label">当前进度：</span>
            <span class="info-value highlight">{{ currentReportIndicator.progress || 0 }}%</span>
          </div>
          <div class="info-row">
            <span class="info-label">月度参考：</span>
            <span class="info-value monthly-target"
              >本月建议进度 {{ getMonthlyExpectedProgress() }}%</span
            >
          </div>
        </div>

        <el-divider />

        <!-- 填报表单 -->
        <el-form label-width="100px" class="report-form">
          <el-form-item label="填报进度" required>
            <el-input-number
              v-model="reportForm.newProgress"
              :min="0"
              :max="100"
              :step="5"
              style="width: 200px"
            />
            <span class="form-hint">%（按本月实际完成情况填写）</span>
          </el-form-item>
          <el-form-item label="进度备注" required>
            <el-input
              v-model="reportForm.remark"
              type="textarea"
              :rows="4"
              placeholder="请详细备注本次进度更新的工作内容和完成情况..."
              maxlength="500"
              show-word-limit
            />
          </el-form-item>
          <el-form-item label="附件（可选）">
            <el-upload
              v-model:file-list="reportUploadFiles"
              action="#"
              :auto-upload="false"
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
