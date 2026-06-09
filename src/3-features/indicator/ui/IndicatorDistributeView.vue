<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Plus,
  Promotion,
  Check,
  Close,
  View,
  Search,
  RefreshLeft,
  Timer,
  Delete,
  Download,
  Upload
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { StrategicIndicator } from '@/shared/types'
import {
  buildAttachmentCell,
  buildExportFileName,
  exportRowsToExcel,
  exportSheetsToExcel,
  formatMilestones,
  formatProgress,
  hasReachedMilestone,
  MILESTONE_REACHED_TEXT_COLOR,
  type ExcelExportColumn,
  type ExcelExportSheet,
  type ExcelRowTone
} from '@/shared/lib/export/excel'
import IndicatorMilestoneTimeline from '@/features/indicator/ui/IndicatorMilestoneTimeline.vue'
import { DistributionApprovalProgressDrawer } from '@/features/approval'
import BusinessImportDialog from '@/features/import/ui/BusinessImportDialog.vue'
import {
  useIndicatorDistributeView,
  type IndicatorDistributeViewProps
} from '@/features/indicator/model/useIndicatorDistributeView'

const props = defineProps<IndicatorDistributeViewProps>()

const {
  _addNewChildRow,
  _canAddIndicator,
  _distributeNewChildren,
  _formatColleges,
  _formatCollegesShort,
  _formatMilestones,
  _getChildIndicators,
  _getCurrentMonthTargetProgress,
  _getIndicatorTypeColor,
  _getPendingChildCount,
  _getStatusTagType,
  _getStatusText,
  _getTaskTypeColor,
  _handleChildTypeChange,
  _handleCollegeSelectBlur,
  _handleCollegeSelectClose,
  _handleDistributeOrWithdraw,
  _isReadOnly,
  _newIndicatorList,
  _selectParentSpanMethod,
  _selectingParentForIndex,
  addFormMilestone,
  addMilestone,
  addRowFormRef,
  addingParentId,
  applyLocalCollegePlanPatch,
  applyLocalCollegePlanReportSummaryPatch,
  approvalDrawerPlan,
  approvalFlowStatusMeta,
  approvalIndicators,
  approvalPreviewLoading,
  approvalSetupDialogVisible,
  approvalSubmitComment,
  approvalStatusPopoverLoading,
  approvalSubmitting,
  approvalWorkflowPreview,
  approvalWorkflowReportSummary,
  authStore,
  availableParentIndicators,
  buildDraftMilestonesFromForm,
  buildLocalMilestonesFromForm,
  buildTaskTypeMap,
  canCurrentUserApproveCurrentPlan,
  canCurrentUserSubmitCurrentDepartmentDistribution,
  canDeletePersistedChild,
  canEditChild,
  canEditCurrentCollegePlan,
  canManageChildDraft,
  canWithdrawCurrentCollegePlan,
  cancelAddIndicator,
  cancelChildEdit,
  cloneParentMilestonesForForm,
  collegeDropdownVisible,
  collegeIndicators,
  collegeOverallStatus,
  collegeTableData,
  collegeTotalWeight,
  colleges,
  closeCopyIndicatorsDialog,
  confirmDepartmentPlanApprovalSubmission,
  copyClearExisting,
  copyIndicatorDialogVisible,
  copyIndicatorsFromCollege,
  copySourceCollege,
  copySourceCollegeOptions,
  currentActiveCollegePlan,
  currentApprovalApproverName,
  currentApprovalCandidateNames,
  currentApprovalEntityId,
  currentApprovalEntityType,
  currentApprovalFlowName,
  currentApprovalStepName,
  currentApprovalStepPreview,
  currentApprovalType,
  currentApprovalWorkflowCode,
  currentApprovalWorkflowStatus,
  currentCollegePlanActionState,
  currentCollegePlanReportSummary,
  currentCollegePlanReportUiStatus,
  currentCollegePlanStatusMeta,
  currentCollegeWorkflowDetail,
  currentDepartmentOrgId,
  currentDepartmentOrgIdFromTable,
  currentDepartmentPlan,
  currentDepartmentPlanDetails,
  currentDepartmentPlanIndicators,
  currentDept,
  currentDetailIndicator,
  currentDispatchWorkflowCode,
  currentPlanTaskTypeMap,
  currentSelectedCollegePlan,
  currentSelectedCollegePlanDetails,
  currentUserNormalizedRoleCodes,
  currentUserOrgId,
  currentUserPermissionCodes,
  currentUserRoleCodes,
  deletingChildId,
  departmentAliasNameMap,
  detailDrawerVisible,
  distributionApprovalButtonText,
  distributionApprovalButtonType,
  distributionRecordCount,
  distributionSubmitButtonDisabledReason,
  distributionSubmitButtonText,
  distributionSubmitButtonType,
  editingChildField,
  editingChildId,
  editingChildValue,
  editingMilestones,
  editingMilestonesChild,
  editingNewChildId,
  filteredColleges,
  formatDetailDate,
  generateMonthlyMilestones,
  generateMonthlyMilestonesForExisting,
  generateMonthlyMilestonesForForm,
  generateMonthlyMilestonesLocal,
  getChildLifecycleStatus,
  getChildStatus,
  getCollegeChildCount,
  getCollegeStatus,
  getDeptNameByOrgId,
  getEditingChildName,
  getEditingChildType,
  getDisplayedReportedProgress,
  getIndicatorTaskId,
  getIndicatorTypeLabel,
  getMilestonesTooltip,
  getMyCollegeIndicators,
  getOrgIdByDeptName,
  getPlanIndicatorNumber,
  getPlanIndicatorText,
  getRowClassName,
  getSortedMilestones,
  handleApprovalRefresh,
  handleApprovalStatusPopoverShow,
  handleBatchDistribute,
  handleBatchWithdraw,
  handleChildDblClick,
  handleCloseApprovalSetupDialog,
  handleFormIndicatorTypeChange,
  handleGlobalMousedown,
  handleMilestoneDateChange,
  handleNewChildRowClick,
  handleOpenApproval,
  handleParentIndicatorChange,
  handleViewDetail,
  hasCurrentCollegePendingApproval,
  isAddingIndicator,
  isBasicTaskIndicator,
  isBatchDistributing,
  isCollegeSidebarLoading,
  isCurrentUserReporter,
  isDeletingChild,
  isFunctionalDept,
  isInteractingWithCollegeSelect,
  isMilestoneCompleted,
  isQualitativeIndicator,
  isSameDepartment,
  isSavingChildCell,
  isSavingIndicator,
  isSavingMilestones,
  isStrategicDept,
  lastEditTime,
  latestCollegePlanReportSummary,
  loadCurrentCollegePlanReportSummary,
  loadCurrentDepartmentPlanDetails,
  loadCurrentDepartmentPlanTaskTypeMap,
  loadCurrentSelectedCollegePlanDetails,
  matchesCurrentDepartmentPlanContext,
  matchesCurrentSelectedCollegePlanContext,
  matchesDepartment,
  milestonesDialogVisible,
  newChildIndicators,
  newIndicatorForm,
  normalizeDepartmentName,
  normalizeIndicatorTypeLabel,
  normalizePreviewCandidateDisplayName,
  normalizeTaskTypeToCategory,
  normalizeWorkflowStepName,
  normalizedCurrentActiveCollegeWorkflowStatus,
  normalizedCurrentDepartmentPlanStatus,
  normalizedSelectedCollegePlanStatus,
  openAddIndicatorForm,
  openCopyIndicatorsDialog,
  openDistributionApprovalSetupDialog,
  openMilestonesDialog,
  orgStore,
  pageBootstrapPromise,
  parseColleges,
  pendingApprovalCount,
  pendingCollegePlanUiState,
  persistIndicatorMilestones,
  planStore,
  plansWithIndicators,
  preloadCurrentCollegeWorkflowDetail,
  receivedParentIndicators,
  refreshDistributionData,
  refreshDistributionPromise,
  removeChildIndicator,
  removeFormMilestone,
  removeMilestone,
  removeNewChildRow,
  resetApprovalSetupDialog,
  resolveCurrentStepExpectedRoleCodes,
  resolveIndicatorTaskType,
  resolveParentTargetProgress,
  resolvePlanYear,
  routeApprovalPlan,
  saveChildEdit,
  saveMilestones,
  saveNewIndicator,
  savingChildField,
  savingChildId,
  searchKeyword,
  secondaryApprovalEntityId,
  secondaryApprovalEntityType,
  selectParentDialogVisible,
  selectParentIndicator,
  selectParentTableData,
  selectedCollege,
  selectedCollegePlanUiStatus,
  shouldShowReportedProgress,
  sortLocalMilestonesByDate,
  strategicStore,
  syncSelectedCollegeFromApprovalRoute,
  taskApprovalVisible,
  timeContext,
  toBatchDistributionMilestones,
  toMilestoneBatchPayload,
  validateAndSaveNewChild,
  validateMilestoneProgress,
  waitForPageBootstrap,
  withdrawButtonDisabled,
  withdrawButtonDisabledReason,
  withdrawButtonType,
  withdrawButtonVisible
} = useIndicatorDistributeView(props)

type DistributionExportChild = Partial<StrategicIndicator> & {
  id?: string | number
  name?: string
  remark?: string
  weight?: number
  type1?: string | null
  indicatorType1?: string | null
  progress?: number | string | null
  milestones?: unknown[]
  pendingAttachments?: unknown
  pendingAttachmentDetails?: unknown[]
}

interface DistributionExportRow {
  exportCollege: string
  type: 'child' | 'new-child'
  taskTitle: string
  indicator: StrategicIndicator
  child: DistributionExportChild
  parentIndicatorId: string
}

const distributionExporting = ref(false)
const distributionBatchExportDialogVisible = ref(false)
const selectedDistributionExportColleges = ref<string[]>([])
const distributionImportDialogVisible = ref(false)

const allDistributionExportCollegesSelected = computed({
  get: () =>
    colleges.value.length > 0 &&
    selectedDistributionExportColleges.value.length === colleges.value.length,
  set: checked => {
    selectedDistributionExportColleges.value = checked ? [...colleges.value] : []
  }
})

const distributionExportCollegesIndeterminate = computed(
  () =>
    selectedDistributionExportColleges.value.length > 0 &&
    selectedDistributionExportColleges.value.length < colleges.value.length
)

const distributionExportColumns: ExcelExportColumn<DistributionExportRow>[] = [
  { header: '序号', width: 8, align: 'center', getValue: (_row, index) => index + 1 },
  { header: '学院', width: 20, getValue: row => row.exportCollege },
  { header: '战略任务', width: 28, getValue: row => row.taskTitle || '-' },
  { header: '核心指标', width: 32, getValue: row => row.indicator.name || '-' },
  { header: '子指标名称', width: 32, getValue: row => row.child.name || '-' },
  {
    header: '指标类型',
    width: 12,
    align: 'center',
    getValue: row => getDistributionChildTypeText(row.child)
  },
  { header: '备注', width: 24, getValue: row => row.child.remark || '-' },
  { header: '权重', width: 10, align: 'center', getValue: row => Number(row.child.weight || 0) },
  {
    header: '进度',
    width: 24,
    getValue: row =>
      formatProgress(
        row.child.progress ?? 0,
        row.type === 'child' ? getDisplayedReportedProgress(row.child as StrategicIndicator) : null
      )
  },
  { header: '里程碑', width: 34, getValue: row => formatMilestones(row.child.milestones) },
  {
    header: '附件',
    width: 42,
    getValue: row =>
      buildAttachmentCell(
        row.child.pendingAttachmentDetails?.length
          ? row.child.pendingAttachmentDetails
          : row.child.pendingAttachments
      )
  }
]

const getDistributionChildTypeText = (child: DistributionExportChild): string => {
  const normalized = normalizeIndicatorTypeLabel(child.type1 || child.indicatorType1 || '')
  return normalized || '-'
}

const matchesDistributionExportCollege = (
  indicator: StrategicIndicator,
  college: string
): boolean => {
  const responsibleDept = (indicator as StrategicIndicator & { responsibleDept?: unknown })
    .responsibleDept
  if (Array.isArray(responsibleDept)) {
    return responsibleDept.some(dept => isSameDepartment(String(dept), college))
  }
  return isSameDepartment(String(responsibleDept || ''), college)
}

const getDistributionExportRowsByCollege = (college: string): DistributionExportRow[] => {
  const data: DistributionExportRow[] = []

  receivedParentIndicators.value.forEach(indicator => {
    const indicatorId = String(indicator.id)
    const children = strategicStore.indicators.filter(candidate => {
      if (String(candidate.parentIndicatorId) !== indicatorId || candidate.isStrategic) {
        return false
      }
      return matchesDistributionExportCollege(candidate, college)
    })

    const draftChildren = (newChildIndicators[indicatorId] || []).filter(child =>
      Array.isArray(child.college) ? child.college.includes(college) : false
    )

    children.forEach(child => {
      data.push({
        exportCollege: college,
        type: 'child',
        taskTitle: indicator.taskContent || '',
        indicator,
        child,
        parentIndicatorId: indicatorId
      })
    })

    draftChildren.forEach(child => {
      data.push({
        exportCollege: college,
        type: 'new-child',
        taskTitle: indicator.taskContent || '',
        indicator,
        child,
        parentIndicatorId: indicatorId
      })
    })
  })

  return data
}

const getDistributionExportRowTone = (row: DistributionExportRow): ExcelRowTone => {
  if (row.type === 'new-child') {
    return 'draft'
  }

  const taskCategory = normalizeTaskTypeToCategory(resolveIndicatorTaskType(row.indicator))
  if (taskCategory.includes('发展')) {
    return 'development'
  }
  if (taskCategory.includes('基础')) {
    return 'basic'
  }
  return 'default'
}

const getDistributionExportRowTextColor = (row: DistributionExportRow): string | undefined => {
  if (row.type !== 'child') {
    return undefined
  }

  return hasReachedMilestone(row.child.progress, getSortedMilestones(row.child.milestones))
    ? MILESTONE_REACHED_TEXT_COLOR
    : undefined
}

const buildDistributionExportSheet = (
  college: string,
  rows = getDistributionExportRowsByCollege(college)
): ExcelExportSheet<DistributionExportRow> => ({
  sheetName: college || '当前学院',
  rows,
  columns: distributionExportColumns,
  emptyMessage: '当前学院暂无可导出的子指标数据',
  getRowTone: getDistributionExportRowTone,
  getRowTextColor: getDistributionExportRowTextColor
})

const handleExportCurrentDistributionCollege = async () => {
  const college = selectedCollege.value
  if (!college) {
    ElMessage.warning('请先选择学院')
    return
  }

  const rows = getDistributionExportRowsByCollege(college)
  if (rows.length === 0) {
    ElMessage.warning('当前学院暂无可导出的数据')
    return
  }

  distributionExporting.value = true
  try {
    await exportRowsToExcel(
      buildDistributionExportSheet(college, rows),
      buildExportFileName('指标下发与管理', college)
    )
    ElMessage.success('导出成功')
  } catch {
    ElMessage.error('导出失败，请稍后重试')
  } finally {
    distributionExporting.value = false
  }
}

const openDistributionBatchExportDialog = () => {
  selectedDistributionExportColleges.value = [...colleges.value]
  distributionBatchExportDialogVisible.value = true
}

const handleExportSelectedDistributionColleges = async () => {
  const selectedColleges = selectedDistributionExportColleges.value
  if (selectedColleges.length === 0) {
    ElMessage.warning('请选择要导出的学院')
    return
  }

  distributionExporting.value = true
  try {
    await Promise.all([
      planStore.loadPlans({ force: true, background: true }),
      strategicStore.loadIndicatorsByYear(timeContext.currentYear, { force: true })
    ])

    await exportSheetsToExcel(
      selectedColleges.map(
        college => buildDistributionExportSheet(college) as ExcelExportSheet<unknown>
      ),
      buildExportFileName(
        '指标下发与管理',
        selectedColleges.length === 1 ? selectedColleges[0] : '多学院'
      )
    )
    distributionBatchExportDialogVisible.value = false
    ElMessage.success('导出成功')
  } catch {
    ElMessage.error('导出失败，请稍后重试')
  } finally {
    distributionExporting.value = false
  }
}

const currentDistributionImportOrgId = computed(() =>
  selectedCollege.value ? getOrgIdByDeptName(selectedCollege.value) : null
)

const currentDistributionImportCycleId = computed(() => {
  const selectedPlan = currentSelectedCollegePlan.value as {
    cycleId?: number | string
    cycle_id?: number | string
  } | null
  const departmentPlan = currentDepartmentPlan.value as {
    cycleId?: number | string
    cycle_id?: number | string
  } | null
  const directCycleId =
    selectedPlan?.cycleId ??
    selectedPlan?.cycle_id ??
    departmentPlan?.cycleId ??
    departmentPlan?.cycle_id
  const numericDirectCycleId = Number(directCycleId)
  if (Number.isFinite(numericDirectCycleId) && numericDirectCycleId > 0) {
    return numericDirectCycleId
  }

  const cycle = timeContext.cycles.find(item => Number(item.year) === timeContext.currentYear) as
    | { cycleId?: number | string; id?: number | string }
    | undefined
  const numericCycleId = Number(cycle?.cycleId ?? cycle?.id)
  return Number.isFinite(numericCycleId) && numericCycleId > 0 ? numericCycleId : null
})

const openDistributionImportDialog = () => {
  if (!selectedCollege.value || !currentDistributionImportOrgId.value) {
    ElMessage.warning('请先选择要导入的学院')
    return
  }
  if (!currentDistributionImportCycleId.value) {
    ElMessage.warning('当前周期信息不可用，暂不能导入')
    return
  }
  distributionImportDialogVisible.value = true
}

const handleDistributionImportCommitted = async () => {
  await refreshDistributionData()
}
</script>

<template>
  <div class="distribution-view page-fade-enter">
    <!-- 只读提示 -->
    <el-alert
      v-if="isStrategicDept"
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom: 16px"
    >
      当前以战略发展部身份查看，数据为只读状态
    </el-alert>
    <el-alert
      v-else-if="timeContext.isReadOnly"
      type="warning"
      :closable="false"
      show-icon
      style="margin-bottom: 16px"
    >
      当前处于历史快照模式（{{ timeContext.currentYear }}年），数据为只读状态
    </el-alert>

    <div class="distribution-export-bar">
      <el-button
        v-if="
          isFunctionalDept &&
          !timeContext.isReadOnly &&
          canEditChild &&
          selectedCollege &&
          (collegeOverallStatus.label === '暂无指标' || currentCollegePlanActionState === 'draft')
        "
        @click="openCopyIndicatorsDialog"
      >
        复制学院指标
      </el-button>
      <el-button
        type="primary"
        plain
        :loading="distributionExporting"
        :disabled="colleges.length === 0"
        @click="openDistributionBatchExportDialog"
      >
        <el-icon><Download /></el-icon>
        全部导出
      </el-button>
    </div>

    <div class="distribution-layout">
      <!-- 左侧：学院侧边栏 -->
      <div class="strategic-panel card-animate">
        <div class="panel-header">
          <span class="panel-title">学院列表</span>
          <el-input
            v-model="searchKeyword"
            placeholder="搜索学院..."
            :prefix-icon="Search"
            clearable
            size="small"
            style="width: 120px"
          />
        </div>

        <!-- 学院列表 -->
        <div class="indicator-list">
          <div
            v-for="college in filteredColleges"
            :key="college"
            :class="['college-card', { selected: selectedCollege === college }]"
            @click="selectedCollege = college"
          >
            <span class="college-card-name">{{ college }}</span>
            <span class="college-card-count">{{ getCollegeChildCount(college) }} 个子指标</span>
          </div>

          <el-empty
            v-if="filteredColleges.length === 0"
            :description="isCollegeSidebarLoading ? '学院加载中...' : '暂无学院'"
          />
        </div>
      </div>

      <!-- 右侧：指标表格 -->
      <div class="distribution-panel">
        <!-- 学院模式：选中学院时显示 -->
        <div
          v-if="selectedCollege"
          class="table-card card-base card-animate"
          style="animation-delay: 0.1s"
        >
          <!-- 表头 -->
          <div class="card-header">
            <div class="header-left">
              <el-tag :type="currentCollegePlanStatusMeta.type" size="default">
                计划状态: {{ currentCollegePlanStatusMeta.label }}
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
                    :type="approvalFlowStatusMeta.tagType"
                    size="default"
                    style="cursor: pointer"
                    @click.stop="handleOpenApproval"
                  >
                    审批状态: {{ approvalFlowStatusMeta.label }}
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
                        {{ approvalFlowStatusMeta.description }}
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
              <el-tag
                :type="
                  collegeTotalWeight > 100
                    ? 'danger'
                    : collegeTotalWeight === 100
                      ? 'success'
                      : 'info'
                "
                :class="{ 'weight-tag--overlimit': collegeTotalWeight > 100 }"
                size="default"
              >
                基础性权重合计: {{ collegeTotalWeight }} / 100
              </el-tag>
            </div>
            <div class="header-actions">
              <el-button
                :loading="distributionExporting"
                @click="handleExportCurrentDistributionCollege"
              >
                <el-icon><Download /></el-icon>
                导出
              </el-button>
              <el-button :icon="Upload" @click="openDistributionImportDialog">导入</el-button>
              <!-- 
                按钮显示逻辑：
                - 草稿态且暂无指标 → 只显示"新增指标"
                - 有指标时 → 审批入口始终可见
                - 编辑/下发按钮仅在草稿态显示
              -->
              <template v-if="isFunctionalDept && !timeContext.isReadOnly">
                <template v-if="collegeOverallStatus.label === '暂无指标' && canEditChild">
                  <el-button type="primary" @click="openAddIndicatorForm">
                    <el-icon><Plus /></el-icon>
                    新增指标
                  </el-button>
                </template>
                <template v-else>
                  <div class="approval-entry-wrapper">
                    <span
                      v-if="canCurrentUserApproveCurrentPlan"
                      class="approval-entry-dot"
                      aria-hidden="true"
                    ></span>
                    <el-button :type="distributionApprovalButtonType" @click="handleOpenApproval">
                      <el-icon><Check /></el-icon>
                      {{ distributionApprovalButtonText }}
                    </el-button>
                  </div>
                  <template v-if="currentCollegePlanActionState === 'draft' && canEditChild">
                    <el-button type="primary" @click="openAddIndicatorForm">
                      <el-icon><Plus /></el-icon>
                      新增指标
                    </el-button>
                    <el-button
                      :type="distributionSubmitButtonType"
                      :loading="isBatchDistributing"
                      :aria-disabled="Boolean(distributionSubmitButtonDisabledReason)"
                      :class="{ 'is-disabled': Boolean(distributionSubmitButtonDisabledReason) }"
                      :title="distributionSubmitButtonDisabledReason"
                      @click="handleBatchDistribute(selectedCollege)"
                    >
                      <el-icon><Promotion /></el-icon>
                      {{ distributionSubmitButtonText }}
                    </el-button>
                  </template>
                  <template v-else-if="withdrawButtonVisible">
                    <el-button
                      :type="withdrawButtonType"
                      :loading="isBatchDistributing"
                      :disabled="withdrawButtonDisabled"
                      :title="withdrawButtonDisabledReason"
                      @click="handleBatchWithdraw(selectedCollege)"
                    >
                      <el-icon><Promotion /></el-icon>
                      撤回
                    </el-button>
                  </template>
                </template>
              </template>
            </div>
          </div>

          <!-- 表格主体 -->
          <div class="card-body table-body">
            <div class="table-container">
              <el-table
                :data="collegeTableData"
                border
                :row-class-name="getRowClassName"
                class="unified-table distribution-table"
              >
                <!-- 子指标名称列 -->
                <el-table-column label="子指标名称" min-width="150">
                  <template #default="{ row }">
                    <!-- 没有子指标的父指标 -->
                    <template v-if="row.type === 'indicator-only'">
                      <div class="add-child-hint">
                        <span class="no-child-text">暂无子指标</span>
                      </div>
                    </template>
                    <!-- 已有子指标 -->
                    <template v-else-if="row.type === 'child'">
                      <div
                        class="child-name-cell"
                        @dblclick="handleChildDblClick(row.child, 'name')"
                      >
                        <el-input
                          v-if="
                            editingChildId === row.child?.id?.toString() &&
                            editingChildField === 'name'
                          "
                          v-model="editingChildValue"
                          type="textarea"
                          :rows="1"
                          autosize
                          class="editing-field textarea-cell"
                          @blur="saveChildEdit(row.child, 'name')"
                        />
                        <span
                          v-else-if="isSavingChildCell(row.child, 'name')"
                          class="cell-saving-text"
                        >
                          保存中...
                        </span>
                        <el-tooltip
                          v-else
                          :content="`${getIndicatorTypeLabel(row.child)}指标`"
                          placement="top"
                        >
                          <span
                            class="child-text"
                            :class="
                              isQualitativeIndicator(row.child)
                                ? 'indicator-qualitative'
                                : 'indicator-quantitative'
                            "
                            >{{ row.child?.name || '未命名' }}</span
                          >
                        </el-tooltip>
                      </div>
                    </template>
                    <!-- 新增子指标行 -->
                    <template v-else-if="row.type === 'new-child'">
                      <div
                        class="new-child-cell"
                        @click="handleNewChildRowClick(row.child.id, row.parentIndicatorId)"
                      >
                        <el-input
                          v-if="editingNewChildId === row.child.id"
                          v-model="row.child.name"
                          type="textarea"
                          :rows="1"
                          autosize
                          placeholder="输入子指标名称"
                          class="new-child-editing textarea-cell"
                          @blur="validateAndSaveNewChild(row.parentIndicatorId, row.child.id)"
                        />
                        <el-tooltip
                          v-else
                          :content="`${getIndicatorTypeLabel(row.child)}指标`"
                          placement="top"
                        >
                          <span
                            class="new-child-text"
                            :class="{ 'placeholder-text': !row.child.name }"
                            >{{ row.child.name || '点击输入名称' }}</span
                          >
                        </el-tooltip>
                      </div>
                    </template>
                  </template>
                </el-table-column>

                <!-- 备注列 -->
                <el-table-column label="备注" width="140">
                  <template #default="{ row }">
                    <template v-if="row.type === 'indicator-only'">
                      <span class="remark-text">-</span>
                    </template>
                    <template v-else-if="row.type === 'child'">
                      <div
                        class="child-remark-cell"
                        @dblclick="handleChildDblClick(row.child, 'remark')"
                      >
                        <el-input
                          v-if="
                            editingChildId === row.child?.id?.toString() &&
                            editingChildField === 'remark'
                          "
                          v-model="editingChildValue"
                          type="textarea"
                          :rows="1"
                          autosize
                          class="editing-field textarea-cell"
                          @blur="saveChildEdit(row.child, 'remark')"
                        />
                        <span
                          v-else-if="isSavingChildCell(row.child, 'remark')"
                          class="cell-saving-text"
                        >
                          保存中...
                        </span>
                        <span v-else class="remark-text">{{ row.child?.remark || '-' }}</span>
                      </div>
                    </template>
                    <template v-else-if="row.type === 'new-child'">
                      <div
                        class="new-child-cell"
                        @click="handleNewChildRowClick(row.child.id, row.parentIndicatorId)"
                      >
                        <el-input
                          v-if="editingNewChildId === row.child.id"
                          v-model="row.child.remark"
                          type="textarea"
                          :rows="1"
                          autosize
                          placeholder="输入备注（选填）"
                          class="new-child-editing textarea-cell"
                        />
                        <span
                          v-else
                          class="remark-text new-child-text"
                          :class="{ 'placeholder-text': !row.child.remark }"
                          >{{ row.child.remark || '-' }}</span
                        >
                      </div>
                    </template>
                  </template>
                </el-table-column>

                <!-- 权重列 -->
                <el-table-column label="权重" width="80" align="center">
                  <template #default="{ row }">
                    <template v-if="row.type === 'indicator-only'">
                      <span class="weight-text">-</span>
                    </template>
                    <template v-else-if="row.type === 'child'">
                      <div class="weight-cell" @dblclick="handleChildDblClick(row.child, 'weight')">
                        <el-input-number
                          v-if="
                            editingChildId === row.child?.id?.toString() &&
                            editingChildField === 'weight'
                          "
                          v-model="editingChildValue"
                          :min="0"
                          :max="100"
                          size="small"
                          :controls="false"
                          style="width: 60px"
                          class="editing-field"
                          @blur="saveChildEdit(row.child, 'weight')"
                        />
                        <span
                          v-else-if="isSavingChildCell(row.child, 'weight')"
                          class="cell-saving-text"
                        >
                          保存中...
                        </span>
                        <span v-else class="weight-text editable">{{
                          row.child?.weight ?? '-'
                        }}</span>
                      </div>
                    </template>
                    <template v-else-if="row.type === 'new-child'">
                      <span class="weight-text">{{ row.child?.weight ?? 10 }}</span>
                    </template>
                  </template>
                </el-table-column>

                <!-- 学院模式下不显示学院列 -->

                <!-- 里程碑列 -->
                <el-table-column label="里程碑" width="100" align="center">
                  <template #default="{ row }">
                    <template v-if="row.type === 'indicator-only'">
                      <span class="milestone-count">-</span>
                    </template>
                    <template v-else-if="row.type === 'child'">
                      <el-popover
                        placement="left"
                        :width="320"
                        trigger="hover"
                        :disabled="!row.child?.milestones?.length"
                      >
                        <template #reference>
                          <div
                            class="milestone-cell"
                            :class="{
                              editable: canManageChildDraft(row.child)
                            }"
                            @dblclick="
                              canManageChildDraft(row.child) && openMilestonesDialog(row.child)
                            "
                          >
                            <span class="milestone-count">
                              {{ row.child?.milestones?.length || 0 }} 个里程碑
                            </span>
                          </div>
                        </template>
                        <div class="milestone-popover">
                          <div class="milestone-popover-title">里程碑列表</div>
                          <div
                            v-for="(ms, idx) in getMilestonesTooltip(row.child)"
                            :key="ms.id"
                            class="milestone-item"
                            :class="{
                              'milestone-completed': isMilestoneCompleted(row.child, ms.progress)
                            }"
                          >
                            <div class="milestone-item-header">
                              <span class="milestone-index">{{ idx + 1 }}.</span>
                              <span class="milestone-name">{{ ms.name || '未命名' }}</span>
                              <el-icon
                                v-if="isMilestoneCompleted(row.child, ms.progress)"
                                class="milestone-check-icon"
                              >
                                <Check />
                              </el-icon>
                            </div>
                            <div class="milestone-item-info">
                              <span>预期: {{ ms.expectedDate || '未设置' }}</span>
                              <span>进度: {{ ms.progress }}%</span>
                            </div>
                          </div>
                          <div v-if="!row.child?.milestones?.length" class="milestone-empty">
                            暂无里程碑
                          </div>
                        </div>
                      </el-popover>
                    </template>
                    <template v-else-if="row.type === 'new-child'">
                      <el-popover
                        placement="left"
                        :width="320"
                        trigger="hover"
                        :disabled="!row.child?.milestones?.length"
                      >
                        <template #reference>
                          <div
                            class="milestone-cell editable"
                            @dblclick.stop="openMilestonesDialog(row.child)"
                          >
                            <span class="milestone-count">
                              {{ row.child?.milestones?.length || 0 }} 个里程碑
                            </span>
                          </div>
                        </template>
                        <div class="milestone-popover">
                          <div class="milestone-popover-title">里程碑列表</div>
                          <div
                            v-for="(ms, idx) in getMilestonesTooltip(row.child)"
                            :key="ms.id"
                            class="milestone-item"
                          >
                            <div class="milestone-item-header">
                              <span class="milestone-index">{{ idx + 1 }}.</span>
                              <span class="milestone-name">{{ ms.name || '未命名' }}</span>
                            </div>
                            <div class="milestone-item-info">
                              <span>预期: {{ ms.expectedDate || '未设置' }}</span>
                              <span>进度: {{ ms.progress }}%</span>
                            </div>
                          </div>
                          <div v-if="!row.child?.milestones?.length" class="milestone-empty">
                            暂无里程碑
                          </div>
                        </div>
                      </el-popover>
                    </template>
                  </template>
                </el-table-column>

                <!-- 进度列 -->
                <el-table-column label="进度" width="100" align="center">
                  <template #default="{ row }">
                    <template v-if="row.type === 'indicator-only'">
                      <span class="progress-text">-</span>
                    </template>
                    <template v-else-if="row.type === 'child'">
                      <div
                        class="progress-cell"
                        @dblclick="handleChildDblClick(row.child, 'progress')"
                      >
                        <el-input-number
                          v-if="
                            editingChildId === row.child.id.toString() &&
                            editingChildField === 'progress'
                          "
                          v-model="editingChildValue"
                          :min="0"
                          :max="100"
                          :precision="0"
                          size="small"
                          class="editing-field"
                          @blur="saveChildEdit(row.child, 'progress')"
                          @keyup.enter="saveChildEdit(row.child, 'progress')"
                          @keyup.esc="cancelChildEdit"
                        />
                        <span
                          v-else-if="isSavingChildCell(row.child, 'progress')"
                          class="cell-saving-text"
                        >
                          保存中...
                        </span>
                        <span
                          v-else
                          class="progress-text"
                          :class="{
                            editable: canManageChildDraft(row.child)
                          }"
                        >
                          {{ row.child?.progress || 0 }}%
                        </span>
                        <el-tooltip
                          v-if="shouldShowReportedProgress(row.child)"
                          content="填报进度"
                          placement="top"
                        >
                          <span class="reported-progress"
                            >({{ getDisplayedReportedProgress(row.child) }}%)</span
                          >
                        </el-tooltip>
                      </div>
                    </template>
                    <template v-else-if="row.type === 'new-child'">
                      <span class="progress-text">-</span>
                    </template>
                  </template>
                </el-table-column>

                <!-- 操作列 - 学院模式：仅查看和删除（删除需先撤销） -->
                <el-table-column label="操作" width="180" align="center">
                  <template #default="{ row }">
                    <!-- 没有子指标的父指标 - 无操作 -->
                    <template v-if="row.type === 'indicator-only'">
                      <span class="action-placeholder">-</span>
                    </template>
                    <!-- 子指标操作：查看 + 删除（仅草稿状态） -->
                    <template v-else-if="row.type === 'child'">
                      <div class="action-cell" :class="{ 'is-busy': isDeletingChild(row.child) }">
                        <el-button
                          link
                          type="primary"
                          size="small"
                          :disabled="isDeletingChild(row.child)"
                          @click="handleViewDetail(row.child)"
                        >
                          <el-icon><View /></el-icon>查看
                        </el-button>
                        <el-button
                          v-if="canDeletePersistedChild(row.child)"
                          link
                          type="danger"
                          size="small"
                          :loading="isDeletingChild(row.child)"
                          :disabled="isDeletingChild(row.child)"
                          @click="removeChildIndicator(row.child)"
                        >
                          <el-icon v-if="!isDeletingChild(row.child)"><Close /></el-icon>
                          {{ isDeletingChild(row.child) ? '删除中...' : '删除' }}
                        </el-button>
                      </div>
                    </template>
                    <!-- 新增子指标操作：删除 -->
                    <template v-else-if="row.type === 'new-child'">
                      <div class="action-cell">
                        <el-button
                          link
                          type="danger"
                          size="small"
                          @click="removeNewChildRow(row.parentIndicatorId, row.rowIndex)"
                        >
                          <el-icon><Close /></el-icon>删除
                        </el-button>
                      </div>
                    </template>
                  </template>
                </el-table-column>
              </el-table>
            </div>

            <!-- 新增指标表单 -->
            <div v-if="isAddingIndicator" ref="addRowFormRef" class="add-row-form">
              <h3 class="form-title">新增子指标</h3>
              <div class="add-form-content">
                <el-form label-width="140px" class="no-wrap-labels">
                  <el-row :gutter="16">
                    <el-col :span="12">
                      <el-form-item class="no-wrap-label required-form-item">
                        <template #label><span class="required-asterisk">*</span>关联指标</template>
                        <el-select
                          v-model="newIndicatorForm.parentIndicatorId"
                          filterable
                          placeholder="选择关联的核心指标"
                          style="width: 100%"
                          @change="handleParentIndicatorChange"
                        >
                          <el-option-group
                            v-for="task in plansWithIndicators"
                            :key="task.taskContent"
                            :label="task.taskContent"
                          >
                            <el-option
                              v-for="indicator in task.indicators"
                              :key="indicator.id"
                              :label="indicator.name"
                              :value="indicator.id.toString()"
                            >
                              <div class="parent-indicator-option">
                                <span class="parent-indicator-option__name">{{
                                  indicator.name
                                }}</span>
                                <div class="parent-indicator-option__tags">
                                  <el-tag
                                    size="small"
                                    :type="
                                      getIndicatorTypeLabel(indicator) === '定量'
                                        ? 'primary'
                                        : 'warning'
                                    "
                                  >
                                    {{ getIndicatorTypeLabel(indicator) }}
                                  </el-tag>
                                  <el-tag
                                    size="small"
                                    effect="plain"
                                    :style="{
                                      color: _getTaskTypeColor(task.type2),
                                      borderColor: _getTaskTypeColor(task.type2),
                                      backgroundColor:
                                        task.type2 === '发展性'
                                          ? 'rgba(64, 158, 255, 0.08)'
                                          : 'rgba(103, 194, 58, 0.08)'
                                    }"
                                  >
                                    {{ task.type2 }}
                                  </el-tag>
                                </div>
                              </div>
                            </el-option>
                          </el-option-group>
                        </el-select>
                      </el-form-item>
                    </el-col>
                    <el-col :span="8">
                      <el-form-item class="required-form-item">
                        <template #label><span class="required-asterisk">*</span>指标类型</template>
                        <el-select
                          v-model="newIndicatorForm.type1"
                          style="width: 100%"
                          @change="
                            (val: string) => handleFormIndicatorTypeChange(val as '定量' | '定性')
                          "
                        >
                          <el-option label="定性" value="定性" />
                          <el-option label="定量" value="定量" />
                        </el-select>
                      </el-form-item>
                    </el-col>
                    <el-col :span="8">
                      <el-form-item class="required-form-item">
                        <template #label><span class="required-asterisk">*</span>权重</template>
                        <el-input-number
                          v-model="newIndicatorForm.weight"
                          :min="0"
                          :max="100"
                          placeholder="权重"
                          :controls="false"
                          style="width: 100%"
                        />
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <el-row :gutter="16">
                    <el-col :span="24">
                      <el-form-item class="required-form-item">
                        <template #label><span class="required-asterisk">*</span>指标内容</template>
                        <el-input
                          v-model="newIndicatorForm.name"
                          type="textarea"
                          :autosize="{ minRows: 2, maxRows: 10 }"
                          placeholder="输入指标内容"
                        />
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <el-row :gutter="16">
                    <el-col :span="24">
                      <el-form-item label="备注">
                        <el-input
                          v-model="newIndicatorForm.remark"
                          type="textarea"
                          :autosize="{ minRows: 2, maxRows: 10 }"
                          placeholder="输入备注内容（选填）"
                        />
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <el-row :gutter="16">
                    <el-col :span="24">
                      <el-form-item class="required-form-item">
                        <template #label><span class="required-asterisk">*</span>里程碑</template>
                        <div class="milestone-form-area">
                          <el-button
                            v-if="newIndicatorForm.type1 === '定性'"
                            size="small"
                            type="primary"
                            plain
                            @click="addFormMilestone"
                          >
                            <el-icon><Plus /></el-icon> 添加里程碑
                          </el-button>
                          <div v-if="newIndicatorForm.milestones.length > 0" class="milestone-list">
                            <div
                              v-for="(ms, idx) in newIndicatorForm.milestones"
                              :key="ms.id"
                              class="milestone-form-item"
                            >
                              <span class="milestone-index">{{ idx + 1 }}.</span>
                              <el-input
                                v-model="ms.name"
                                placeholder="里程碑名称"
                                style="width: 160px"
                                size="small"
                              />
                              <el-input-number
                                v-model="ms.targetProgress"
                                :min="0"
                                :max="100"
                                placeholder="目标进度%"
                                size="small"
                                style="width: 110px"
                              />
                              <el-date-picker
                                v-model="ms.deadline"
                                type="date"
                                placeholder="截止日期"
                                size="small"
                                style="width: 130px"
                                value-format="YYYY-MM-DD"
                              />
                              <el-button
                                type="danger"
                                size="small"
                                text
                                @click="removeFormMilestone(idx)"
                              >
                                <el-icon><Delete /></el-icon>
                              </el-button>
                            </div>
                          </div>
                          <span v-else class="milestone-hint">
                            {{
                              newIndicatorForm.type1 === '定量'
                                ? '选择定量后自动生成12月里程碑'
                                : '暂无里程碑，点击添加'
                            }}
                          </span>
                        </div>
                      </el-form-item>
                    </el-col>
                  </el-row>
                </el-form>
              </div>
              <div class="add-form-actions">
                <el-button
                  type="primary"
                  :loading="isSavingIndicator"
                  :disabled="isSavingIndicator"
                  @click="saveNewIndicator"
                >
                  {{ isSavingIndicator ? '保存中' : '保存' }}
                </el-button>
                <el-button :disabled="isSavingIndicator" @click="cancelAddIndicator"
                  >取消</el-button
                >
              </div>
            </div>
          </div>

          <div class="excel-status-bar">
            <div class="status-left">
              {{ selectedCollege ? `共 ${distributionRecordCount} 条记录` : '请选择左侧学院' }}
            </div>
            <div class="status-right">最后编辑: {{ lastEditTime }}</div>
          </div>
        </div>

        <!-- 空状态：未选择学院 -->
        <el-empty v-else description="请选择左侧学院" class="empty-placeholder" />
      </div>
    </div>

    <!-- 指标详情抽屉 -->
    <el-drawer v-model="detailDrawerVisible" title="指标详情" size="45%">
      <div v-if="currentDetailIndicator" class="detail-container">
        <div class="detail-header">
          <h3>{{ currentDetailIndicator.name }}</h3>
          <div class="detail-tags">
            <el-tag
              size="small"
              :type="
                getIndicatorTypeLabel(currentDetailIndicator) === '定量' ? 'primary' : 'warning'
              "
            >
              {{ getIndicatorTypeLabel(currentDetailIndicator) }}
            </el-tag>
            <el-tag
              size="small"
              :style="{
                backgroundColor: _getTaskTypeColor(currentDetailIndicator.type2),
                color: '#fff',
                border: 'none'
              }"
            >
              {{ currentDetailIndicator.type2 }}任务
            </el-tag>
            <el-tag size="small" :type="_getStatusTagType(getChildStatus(currentDetailIndicator))">
              {{
                getChildStatus(currentDetailIndicator) === 'draft'
                  ? '草稿'
                  : getChildStatus(currentDetailIndicator) === 'pending'
                    ? '审批中'
                    : getChildStatus(currentDetailIndicator) === 'approved'
                      ? '已通过'
                      : '已下发'
              }}
            </el-tag>
          </div>
        </div>

        <el-descriptions :column="2" border class="detail-desc">
          <el-descriptions-item label="战略任务" :span="2">
            {{ currentDetailIndicator.taskContent }}
          </el-descriptions-item>
          <el-descriptions-item label="任务类别">
            {{ currentDetailIndicator.type2 }}任务
          </el-descriptions-item>
          <el-descriptions-item label="指标类型">
            {{ getIndicatorTypeLabel(currentDetailIndicator) }}
          </el-descriptions-item>
          <el-descriptions-item label="权重">{{
            currentDetailIndicator.weight
          }}</el-descriptions-item>
          <el-descriptions-item label="当前进度">
            {{ currentDetailIndicator.progress || 0 }}%
          </el-descriptions-item>
          <el-descriptions-item label="责任部门">
            {{ currentDetailIndicator.responsibleDept || '未分配' }}
          </el-descriptions-item>
          <el-descriptions-item label="创建时间" :span="2">
            {{ formatDetailDate(currentDetailIndicator.createTime) }}
          </el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">
            {{ currentDetailIndicator.remark || '暂无备注' }}
          </el-descriptions-item>
        </el-descriptions>

        <div
          v-if="currentDetailIndicator.milestones && currentDetailIndicator.milestones.length > 0"
          class="milestone-section"
        >
          <div class="divider"></div>
          <h4>里程碑节点</h4>
          <IndicatorMilestoneTimeline
            :milestones="currentDetailIndicator.milestones"
            :current-progress="currentDetailIndicator.progress"
          />
        </div>
      </div>
    </el-drawer>

    <el-dialog
      v-model="distributionBatchExportDialogVisible"
      title="选择导出学院"
      width="520px"
      :close-on-click-modal="!distributionExporting"
    >
      <div class="export-dialog-body">
        <el-checkbox
          v-model="allDistributionExportCollegesSelected"
          :indeterminate="distributionExportCollegesIndeterminate"
        >
          全选学院
        </el-checkbox>
        <el-checkbox-group
          v-model="selectedDistributionExportColleges"
          class="export-selection-list"
        >
          <el-checkbox v-for="college in colleges" :key="college" :value="college">
            {{ college }}
          </el-checkbox>
        </el-checkbox-group>
      </div>
      <template #footer>
        <el-button
          :disabled="distributionExporting"
          @click="distributionBatchExportDialogVisible = false"
        >
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="distributionExporting"
          @click="handleExportSelectedDistributionColleges"
        >
          导出
        </el-button>
      </template>
    </el-dialog>

    <BusinessImportDialog
      v-model:visible="distributionImportDialogVisible"
      type="distribution"
      :target-org-id="currentDistributionImportOrgId"
      :target-org-name="selectedCollege"
      :source-org-id="currentDepartmentOrgId"
      :source-org-name="currentDept"
      :cycle-id="currentDistributionImportCycleId"
      @committed="handleDistributionImportCommitted"
    />

    <!-- 任务审批进度抽屉 -->
    <el-dialog
      v-model="approvalSetupDialogVisible"
      title="发起下发审批"
      width="640px"
      :close-on-click-modal="!approvalSubmitting"
      :close-on-press-escape="!approvalSubmitting"
      :show-close="!approvalSubmitting"
      @close="handleCloseApprovalSetupDialog"
    >
      <div v-loading="approvalPreviewLoading" class="approval-setup-dialog">
        <template v-if="approvalWorkflowPreview">
          <div class="approval-setup-summary">
            <div class="approval-setup-title">
              {{ approvalWorkflowPreview.workflowName || currentDispatchWorkflowCode }}
            </div>
            <div class="approval-setup-meta">
              当前部门计划会提交到真实工作流，审批通过后当前下发流程才算正式生效。
            </div>
          </div>

          <div class="approval-step-list">
            <div
              v-for="step in approvalWorkflowPreview.steps"
              :key="step.stepDefId"
              class="approval-step-card"
            >
              <div class="approval-step-order">步骤 {{ step.stepOrder }}</div>
              <div class="approval-step-name">{{ step.stepName }}</div>
              <div class="approval-step-candidates">
                {{
                  step.candidateApprovers.length > 0
                    ? step.candidateApprovers
                        .map(
                          candidate =>
                            candidate.realName || candidate.username || `用户${candidate.userId}`
                        )
                        .join('、')
                    : '系统自动分配'
                }}
              </div>
            </div>
          </div>

          <el-form label-position="top" class="approval-setup-form">
            <el-form-item label="提交说明">
              <el-input
                v-model="approvalSubmitComment"
                type="textarea"
                :rows="4"
                maxlength="500"
                show-word-limit
                placeholder="请输入提交说明；如果留空，后端会自动生成默认提交文案并落库。"
              />
            </el-form-item>
          </el-form>
        </template>

        <el-empty v-else description="审批流程预览加载中或暂无可用节点" />
      </div>

      <template #footer>
        <el-button :disabled="approvalSubmitting" @click="handleCloseApprovalSetupDialog">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="approvalSubmitting"
          :disabled="approvalPreviewLoading || !approvalWorkflowPreview"
          @click="confirmDepartmentPlanApprovalSubmission"
        >
          确认发起
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="copyIndicatorDialogVisible"
      title="复制学院指标"
      width="520px"
      :close-on-click-modal="true"
      @close="closeCopyIndicatorsDialog"
    >
      <div class="copy-indicator-dialog">
        <p class="copy-indicator-dialog__hint">
          选择一个已有指标的学院，将其当前填报的子指标复制到
          <strong>{{ selectedCollege || '当前学院' }}</strong>
          。默认只追加，不会覆盖当前学院已有指标。
        </p>

        <el-form label-width="110px">
          <el-form-item label="来源学院">
            <el-select v-model="copySourceCollege" placeholder="选择来源学院" style="width: 100%">
              <el-option
                v-for="option in copySourceCollegeOptions"
                :key="option.value"
                :label="`${option.label}（${option.count} 个子指标）`"
                :value="option.value"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="复制策略">
            <el-checkbox v-model="copyClearExisting"> 复制前清空当前学院已有子指标 </el-checkbox>
          </el-form-item>
        </el-form>
      </div>

      <template #footer>
        <el-button @click="closeCopyIndicatorsDialog">取消</el-button>
        <el-button type="primary" @click="copyIndicatorsFromCollege">确认复制</el-button>
      </template>
    </el-dialog>

    <DistributionApprovalProgressDrawer
      v-model="taskApprovalVisible"
      :indicators="approvalIndicators"
      :plan="approvalDrawerPlan"
      :initial-plan-workflow-detail="currentCollegeWorkflowDetail"
      :department-name="selectedCollege || currentDept || '当前部门'"
      :plan-name="selectedCollege || currentDept || '当前部门'"
      :show-plan-approvals="true"
      :show-approval-section="true"
      :workflow-code="currentApprovalWorkflowCode"
      :workflow-entity-type="currentApprovalEntityType"
      :workflow-entity-id="currentApprovalEntityId"
      :secondary-workflow-entity-type="secondaryApprovalEntityType"
      :secondary-workflow-entity-id="secondaryApprovalEntityId"
      :approval-type="currentApprovalType"
      @close="taskApprovalVisible = false"
      @refresh="handleApprovalRefresh"
    />

    <!-- 里程碑编辑弹窗 -->
    <el-dialog
      v-model="milestonesDialogVisible"
      title="编辑里程碑"
      width="700px"
      :close-on-click-modal="false"
      :close-on-press-escape="!isSavingMilestones"
      :show-close="!isSavingMilestones"
    >
      <div v-if="editingMilestonesChild" class="milestone-edit-dialog">
        <!-- 指标信息 -->
        <div class="indicator-info-header">
          <div class="info-item">
            <span class="label">指标名称：</span>
            <span class="value">{{ getEditingChildName() }}</span>
          </div>
          <div class="info-item">
            <span class="label">指标类型：</span>
            <el-tag size="small" :type="getEditingChildType() === '定量' ? 'primary' : 'warning'">
              {{ getEditingChildType() }}
            </el-tag>
          </div>
        </div>

        <el-divider />

        <!-- 操作按钮 -->
        <div class="milestone-actions">
          <el-button size="small" type="primary" :icon="Plus" @click="addMilestone">
            添加里程碑
          </el-button>
          <el-button
            v-if="getEditingChildType() === '定量'"
            size="small"
            type="success"
            :icon="Timer"
            @click="generateMonthlyMilestones"
          >
            生成12个月里程碑
          </el-button>
          <span class="milestone-count-hint"> 当前共 {{ editingMilestones.length }} 个里程碑 </span>
        </div>

        <!-- 里程碑列表 -->
        <div class="milestone-edit-list">
          <el-empty
            v-if="editingMilestones.length === 0"
            description="暂无里程碑，点击上方按钮添加"
            :image-size="80"
          />

          <!-- 里程碑编辑表单 -->
          <div v-for="(ms, idx) in editingMilestones" :key="ms.id" class="milestone-edit-item">
            <div class="milestone-index">{{ idx + 1 }}.</div>
            <div class="milestone-fields">
              <el-input
                v-model="ms.name"
                placeholder="里程碑名称"
                size="small"
                class="field-name"
              />
              <el-input-number
                v-model="ms.progress"
                :min="0"
                :max="100"
                placeholder="目标进度%"
                size="small"
                class="field-progress"
                @change="validateMilestoneProgress(idx)"
              />
              <el-date-picker
                v-model="ms.expectedDate"
                type="date"
                placeholder="截止日期"
                size="small"
                value-format="YYYY-MM-DD"
                class="field-date"
                @change="handleMilestoneDateChange"
              />
              <el-button
                type="danger"
                size="small"
                :icon="Delete"
                circle
                @click="removeMilestone(idx)"
              />
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button :disabled="isSavingMilestones" @click="milestonesDialogVisible = false">
          取消
        </el-button>
        <el-button type="primary" :loading="isSavingMilestones" @click="saveMilestones">
          保存
        </el-button>
      </template>
    </el-dialog>

    <!-- 选择关联核心指标弹框（已改为内联选择，此弹窗已不再使用，可删除） -->
    <!-- 选择关联核心指标弹框 -->
    <el-dialog
      v-model="selectParentDialogVisible"
      title="选择关联的核心指标"
      width="700px"
      :close-on-click-modal="false"
    >
      <div class="select-parent-content">
        <el-table
          :data="selectParentTableData"
          border
          max-height="400px"
          class="select-parent-table"
        >
          <!-- 核心指标列 - 可选择 -->
          <el-table-column label="核心指标" min-width="280">
            <template #default="{ row }">
              <div class="indicator-select-row">
                <div class="indicator-info">
                  <el-tag
                    size="small"
                    :type="getIndicatorTypeLabel(row.indicator) === '定量' ? 'primary' : 'warning'"
                  >
                    {{ getIndicatorTypeLabel(row.indicator) }}
                  </el-tag>
                  <span class="indicator-name">{{ row.indicator.name }}</span>
                </div>
              </div>
            </template>
          </el-table-column>
          <!-- 备注列 -->
          <el-table-column label="备注" width="150">
            <template #default="{ row }">
              <span class="indicator-remark">{{ row.indicator.remark || '-' }}</span>
            </template>
          </el-table-column>
          <!-- 操作列 -->
          <el-table-column label="操作" width="80" align="center">
            <template #default="{ row }">
              <el-button type="primary" size="small" @click="selectParentIndicator(row.indicator)">
                选择
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <el-empty v-if="selectParentTableData.length === 0" description="暂无核心指标数据" />
      </div>

      <template #footer>
        <el-button @click="selectParentDialogVisible = false">取消</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped src="./IndicatorDistributeView.css"></style>
<style src="./IndicatorDistributeView.global.css"></style>
