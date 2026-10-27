<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useLatestIndicatorFill } from '@/features/indicator/model/useLatestIndicatorFill'
import TaskIndicatorTree from './TaskIndicatorTree.vue'
import IndicatorFillHistory from '@/features/plan/ui/IndicatorFillHistory.vue'
import MutationBadgePopover from '@/features/indicator/ui/MutationBadgePopover.vue'
import ReportMaterialsCell from '@/features/indicator/ui/ReportMaterialsCell.vue'
import ReportStatusCell from '@/features/indicator/ui/ReportStatusCell.vue'
import {
  Plus,
  View,
  Download,
  Delete,
  ArrowDown,
  ArrowLeftBold,
  Check,
  Loading,
  Upload
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { logger } from '@/shared/lib/utils/logger'
import AppAvatar from '@/shared/ui/avatar/AppAvatar.vue'
import { DistributionApprovalProgressDrawer } from '@/features/approval'
import BusinessImportDialog from '@/features/import/ui/BusinessImportDialog.vue'
import { resolveIndicatorYear } from '@/shared/lib/utils/indicatorYear'
import type { StrategicIndicator } from '@/shared/types'
import {
  buildAttachmentCell,
  buildExportFileName,
  exportRowsToExcel,
  exportSheetsToExcel,
  type ExcelExportColumn,
  type ExcelExportSheet,
  type ExcelRowTone
} from '@/shared/lib/export/excel'
import { collectAttachmentRefs, exportDepartmentsAsZip } from '@/shared/lib/export/zipExport'
import type { ManualAlertSeverity } from '@/shared/api/monitoringApi'
import {
  useStrategicTaskView,
  type StrategicTaskViewProps
} from '@/features/task/model/useStrategicTaskView'
import { strategicApi } from '@/features/task/api/strategicApi'
import { useStrategicStore } from '@/features/task/model/strategic'
import {
  MANUAL_ALERT_LOCKED_HINT,
  MANUAL_ALERT_READONLY_HINT,
  MANUAL_ALERT_WORKFLOW_LOCKED_HINT,
  canEditManualAlertLevel
} from '@/features/task/lib/warning-level'
import { truncateText } from '@/shared/lib/utils/formatters'
import FullTextPanel from '@/shared/ui/display/FullTextPanel.vue'
import type { ImportCommitResponse } from '@/features/import/api/businessImport'

const props = defineProps<StrategicTaskViewProps>()
const strategicStore = useStrategicStore()

const {
  PLAN_APPROVAL_HISTORY_WORKFLOW_CODES,
  PLAN_APPROVAL_SUBMIT_WORKFLOW_CODE,
  _addIndicatorToCategory,
  _currentDate,
  _currentTask,
  _deleteIndicator,
  _formatUpdateTime,
  _getProgressClass,
  _goToIndicator,
  _groupedBasicIndicators,
  _groupedDevelopmentIndicators,
  _handleBatchDeleteByTask,
  _handleBatchDistributeByTask,
  _handleBatchWithdrawByTask,
  _handleDoubleClick,
  _handleTableScroll,
  _handleWithdraw,
  _handleWithdrawTask,
  _hasPendingApprovalForDept,
  _openDistributeDialog,
  _saveEdit,
  _selectTask,
  _tableScrollRef,
  _toggleViewMode,
  addNewRow,
  addRowFormRef,
  approvalEntryButtonText,
  approvalFlowStatusMeta,
  approvalIndicators,
  approvalPreviewLoading,
  approvalSetupDialogVisible,
  approvalSubmitComment,
  approvalStatusPopoverLoading,
  approvalStore,
  approvalSubmitting,
  approvalWorkflowPreview,
  approvalWorkflowReportSummary,
  approveIndicatorReview,
  assignmentMethod,
  assignmentTarget,
  authStore,
  backendTaskTypeMap,
  basicIndicators,
  buildTaskIdSet,
  buildTaskTypeMap,
  canCurrentUserHandleCurrentIndicatorWorkflow,
  canCurrentUserSubmitCurrentPlan,
  canDeleteIndicator,
  canDeleteCollegeIndicator,
  canDistribute,
  canEdit,
  isCurrentPlanUnderApproval,
  canEditIndicators,
  canWithdrawPlan,
  cancelAdd,
  cancelEdit,
  cancelIndicatorEdit,
  closeDistributeDialog,
  confirmAssignment,
  confirmDistribute,
  confirmPlanApprovalSubmission,
  currentApprovalApproverName,
  currentApprovalCandidateNames,
  currentApprovalFlowName,
  currentApprovalStepName,
  currentApprovalStepPreview,
  currentApprovalWorkflowStatus,
  currentDepartmentOrgId,
  currentDetail,
  departmentMutationPendingApprovals,
  currentDistributeGroup,
  currentDistributeItem,
  currentIndicator,
  currentIndicatorIndex,
  currentIndicatorWorkflow,
  currentIndicatorWorkflowLoading,
  currentPlan,
  currentPlanReportSummary,
  currentPlanScopeLoading,
  currentPlanStatus,
  currentPlanTaskIdSet,
  currentPlanTaskIdSetSignature,
  currentPlanTaskTypeMap,
  currentTaskIndex,
  currentUserId,
  currentUserOrgId,
  currentUserPermissionCodes,
  currentUserRoleCodes,
  departmentAliasNameMap,
  departmentIdNameMap,
  departmentNameIdMap,
  departmentTotalWeight,
  departmentViewLoadingRequestId,
  departmentViewRequestId,
  detailDrawerVisible,
  developmentIndicators,
  distributeButtonDisabled,
  distributeButtonDisabledReason,
  distributeButtonIcon,
  distributeButtonText,
  distributeButtonType,
  distributeDialogVisible,
  distributeTarget,
  editingField,
  editingIndicatorField,
  editingIndicatorId,
  editingIndicatorValue,
  editingValue,
  ensurePersistedTaskIdForIndicator,
  ensurePlanCanDistribute,
  existingTaskNames,
  querySearchTask,
  onTaskOptionSelect,
  onTaskInputBlur,
  findCurrentPlanByDepartment,
  findCurrentPlanByOrgId,
  findExistingTaskIdByName,
  formatDetailDate,
  functionalDepartments,
  collegeDepartments,
  selectedCollege,
  selectCollege,
  collegeTableIndicators,
  collegeFillStatusScope,
  isReportApprovalInFlight,
  isMutationApprovalInFlight,
  collegeDepartmentsScoped,
  collegeAddMode,
  collegeParentIndicatorOptions,
  indicatorById,
  collegeSpanMethod,
  getCategoryColor,
  getCategoryText,
  getDisplayedReportedProgress,
  getCurrentActorUserId,
  getIndicatorCategoryLabel,
  getIndicatorMappedTaskType,
  getIndicatorTaskId,
  getIndicatorWorkflowStatusLabel,
  getIndicatorWorkflowTagType,
  getPersistedWithdrawableRows,
  getProgressColor,
  getProgressStatus,
  getPendingProgressDelta,
  getRouteQueryText,
  getSpanMethod,
  getTaskCategoryLabel,
  getTaskGroup,
  getTaskStatus,
  getTaskTypeForPersistence,
  hasPendingProgressContent,
  hasPendingProgressValue,
  goToNextIndicator,
  goToPrevIndicator,
  groupIndicatorsByTask,
  handleAddIndicatorToTask,
  handleApprovalRefresh,
  handleApprovalStatusPopoverShow,
  handleApproveCurrentIndicatorWorkflow,
  handleCancelAssignment,
  handleCloseApprovalSetupDialog,
  handleDeleteIndicator,
  handleDistributeAll,
  handleDistributeOrWithdraw,
  handleGlobalClick,
  handleIndicatorDblClick,
  handleOpenApproval,
  handleRejectCurrentIndicatorWorkflow,
  handleSelectionChange,
  handleTaskSelect,
  handleTaskVisibleChange,
  handleViewDetail,
  handleWithdrawAll,
  hasApprovalPreview,
  hasApprovalStepCandidates,
  hasApprovalWorkflowReportBinding,
  hasDistributedIndicators,
  hasWorkflowBinding,
  hydrateCurrentPlanWorkflowState,
  hydratingPlanDetail,
  indicatorByIdMap,
  indicatorWorkflowCache,
  indicators,
  isDepartmentSwitching,
  isAddingOrEditing,
  isBasicIndicatorForCurrentRules,
  isBasicTaskType,
  isBootstrappingPage,
  isCurrentUserReporter,
  isDevelopmentTaskType,
  isIndicatorInCurrentPlanScope,
  isIndicatorInFlowStage,
  isInitialDataLoading,
  isPlanDistributed,
  isReadOnly,
  isSavingIndicatorCell,
  isSavingIndicatorEdit,
  isStrategicDept,
  isTableScrolling,
  lastEditTime,
  latestPlanReportSummary,
  loadBackendTaskTypeMap,
  loadCurrentPlanTaskScope,
  loadIndicatorWorkflowSnapshot,
  loadPendingPlanApprovalCount,
  newRow,
  normalizedIndicators,
  normalizeDepartmentName,
  normalizeEditableText,
  normalizePreviewCandidateDisplayName,
  normalizeTaskId,
  normalizeWorkflowStepName,
  openApprovalSetupDialog,
  openNewRowDialog,
  orgStore,
  overallStatus,
  pageTransitionLoading,
  pendingApprovalCount,
  pendingPlanApprovalCount,
  permissionUtil,
  persistTaskContentEdit,
  planStore,
  planUiPhase,
  preloadApprovalWorkflowDetail,
  preloadedPlanWorkflowDetail,
  preservePrefilledTaskBindingOnce,
  primaryApprovalWorkflowEntityId,
  primaryApprovalWorkflowEntityType,
  secondaryApprovalWorkflowEntityId,
  secondaryApprovalWorkflowEntityType,
  refreshApprovalWorkflowSummaries,
  refreshCurrentDepartmentView,
  refreshIndicatorWorkflowContext,
  refreshTaskPageAfterIndicatorMutation,
  hasMutationDraft,
  submitMutationDraft,
  cancelMutationDraft,
  registerTaskLocally,
  rejectIndicatorReview,
  resetApprovalSetupDialog,
  resetApprovalWorkflowStateCache,
  resetNewRow,
  resolveDepartmentIdByName,
  resolveExpectedApproverOrgIdForCurrentPlan,
  resolveExpectedApproverRoleCodesForCurrentPlan,
  resolvePlanYear,
  route,
  router,
  saveIndicatorEdit,
  saveNewRow,
  savingIndicatorField,
  savingIndicatorId,
  selectedDepartment,
  selectedIndicators,
  selectDepartment,
  shouldShowReportedProgress,
  showAssignmentDialog,
  syncCurrentPlanReportSummaries,
  syncSelectedDepartmentFromRoute,
  tableRef,
  taskApprovalVisible,
  taskList,
  taskSelectRef,
  taskSpanMetaMap,
  taskTypeMap,
  taskTypeMapLoading,
  timeContext,
  triggerApprovalForDistribution,
  updateEditTime,
  viewMode,
  reportHistoryOpen,
  currentDetailId
} = useStrategicTaskView(props)

const { latestFillNote, latestFillAttachments } = useLatestIndicatorFill(
  computed(() => (currentDetail as any)?.id ?? null)
)

const activeTaskTabName = ref<'functional' | 'college'>('functional')

/**
 * 2026-10-24 用户定案：卡片视图暂无业务需求，入口从工具栏隐藏（代码保留）。
 * 恢复显示只需把此开关改回 true。
 */
const SHOW_CARD_VIEW_TOGGLE = false

/**
 * 2026-10-24 用户定案：从「上报记录」卡点开单次上报详情。
 * 抽屉里只显示历次摘要，点某一张卡看该轮的完整内容（进度/自评/说明/附件/审核意见）。
 */
const fillDetailVisible = ref(false)
const activeFillDetail = ref<Record<string, any> | null>(null)

const openFillDetail = (fill: Record<string, any>) => {
  activeFillDetail.value = fill || null
  fillDetailVisible.value = Boolean(fill)
}

const downloadFillAttachment = async (attachment: Record<string, any>) => {
  try {
    const { apiClient } = await import('@/shared/api/client')
    await apiClient.download(`/attachments/${attachment.id}/download`, attachment.fileName)
  } catch (error) {
    logger.warn('[StrategicTaskView] 上报附件下载失败:', error)
    ElMessage.error('附件下载失败，请稍后重试')
  }
}

/**
 * 2026-10-23 用户定案：新增行按 tab 分流——
 * 职能部门 tab 建核心指标（战略部下发），学院 tab 建该学院的子指标（挂到所选核心指标）。
 * 由 collegeAddMode 告知 model 走哪条创建契约。
 */
const handleAddNewRow = () => {
  collegeAddMode.value = activeTaskTabName.value === 'college'
  addNewRow()
}

// 2026-10-19 修复：切 tab 时按对应链路重新拉取上报摘要——
// 二级学院 tab 用「职能部门→学院」的 FUNC_TO_COLLEGE 计划/组织查询，
// 否则学院链路的自评等级与进度说明列读不到数据（恒为空）。
watch(activeTaskTabName, tab => {
  // PR#83：告知 model 头部「审批状态」的填报审批态聚合范围——
  // 「上报状态」列只存在于学院页签，聚合也只在该页签进行
  collegeFillStatusScope.value = tab === 'college'
  if (tab === 'college') {
    if (selectedCollege.value) {
      void syncCurrentPlanReportSummaries({ force: true, collegeScope: true })
    }
    return
  }
  void syncCurrentPlanReportSummaries({ force: true })
})

// 2026-10-13 用户定案：二级学院 tab 未选学院时的左侧入口引导（呼吸高亮 + 指向气泡），选中后消失
// 仅当当前职能部门确实有下发学院时才引导（列表为空时引导会指向空列表，反而更困惑）
const showCollegeGuide = computed(
  () =>
    activeTaskTabName.value === 'college' &&
    !selectedCollege.value &&
    collegeDepartmentsScoped.value.length > 0
)

// 2026-10-18 用户定案：鉴定进度等级是上报审批过程中的状态——
// 仅「计划已下发 + 上报审批流程进行中」可调整；平时（流程未发起/已结束/已退回）锁死。
const manualAlertWorkflowInFlight = computed(() =>
  ['PENDING', 'IN_REVIEW'].includes(
    String(currentApprovalWorkflowStatus.value ?? '')
      .trim()
      .toUpperCase()
  )
)

const manualAlertEditable = computed(() =>
  canEditManualAlertLevel(currentPlanStatus.value, {
    readOnly: isReadOnly.value,
    workflowInFlight: manualAlertWorkflowInFlight.value
  })
)

// 二级学院页签（P2）：筛出下发到学院的任务与指标，复用 TaskIndicatorTree 树状下钻
// 2026-10-11 修复：原过滤只看 department 字段（二级学院子指标的 owner 是职能部门，
// 该字段为空）导致链路「职能部门→学院」下发后学院 tab 显示 No Data。
// 改为按目标部门（targetDepartment/targetOrgName）识别学院归属。
const collegeIndicators = computed(() =>
  // 2026-10-11 修复：改用全量指标源（normalizedIndicators）——
  // indicators 被"当前选中部门 + isStrategic + 当前计划范围"三重过滤，
  // 学院子指标（owner=职能部门、有 parentIndicatorId）会被全部排除，导致学院 tab 恒为空。
  (normalizedIndicators.value || []).filter(item => {
    const candidate = item as {
      department?: string
      targetDepartment?: string
      targetOrgName?: string
      targetOrgId?: string | number
      responsibleDept?: string
    }
    const targetName = String(
      candidate.targetDepartment ??
        candidate.targetOrgName ??
        candidate.responsibleDept ??
        candidate.department ??
        ''
    )
    if (targetName.includes('学院')) {
      return true
    }
    const targetOrgId = Number(candidate.targetOrgId ?? NaN)
    return Number.isFinite(targetOrgId) && targetOrgId >= 55 && targetOrgId <= 62
  })
)
const collegeTasks = computed(() => {
  // 2026-10-11 修复：store 的 tasks 以 taskContent 作为 id（非数字 taskId），
  // 原按 taskId 匹配恒为空。改为按 任务名（taskContent）匹配，
  // 同时保留数字 taskId 兜底匹配。
  const collegeTaskNames = new Set(
    collegeIndicators.value.map(item => String(item.taskContent ?? '')).filter(Boolean)
  )
  const collegeTaskIds = new Set(
    collegeIndicators.value.map(item => String(item.taskId ?? '')).filter(Boolean)
  )
  return (taskList.value || []).filter(task => {
    const byName = collegeTaskNames.has(String(task.title ?? ''))
    const byId = collegeTaskIds.has(String(task.id ?? ''))
    return byName || byId
  })
})

type StrategicExportRow = StrategicIndicator & {
  exportDepartment: string
}

const strategicExporting = ref(false)

/**
 * 2026-10-14 用户定案（P8 表单式异动）：
 * 已下发指标双击字段就地编辑 → 改动攒入异动草稿（内存态，刷新即丢）→
 * 顶部「发起异动」按钮一次性提交全部攒改，走 PLAN_MUTATION_STRATEGY 审批链；
 * 驳回后后端自动清除 mutation_status，可再次发起。
 */
const mutationApiLoading = ref(false)

// 2026-10-10：异动审批实例 → 审批中心「审批历史」卡片（P1 修复：异动链不缺失前端）
// 2026-10-21：任务改名异动（entity_type=TASK）与指标异动并列，需按各自类型取历史
const departmentMutationWorkflowEntities = ref<
  Array<{ entityId: number; entityType?: 'INDICATOR' | 'TASK' }>
>([])
// 2026-10-21：审批中（IN_REVIEW）的异动实例 → 审批中心「计划审批」看板，
// 让发起人和部门视角都能看到自己发起的异动（此前看板只列"我是审批人"的实例）
const loadDepartmentMutationWorkflowEntities = async () => {
  try {
    const orgId = resolveDepartmentIdByName(selectedDepartment.value)
    if (!orgId) {
      departmentMutationWorkflowEntities.value = []
      departmentMutationPendingApprovals.value = []
      return
    }
    const { mutationApi } = await import('@/features/indicator/api/mutationApi')
    const response = await mutationApi.approvals(orgId)
    const items = Array.isArray(response.data) ? response.data : []
    departmentMutationWorkflowEntities.value = items
      .map(item => ({
        entityId: Number(item.indicator_id),
        entityType:
          String(item.entity_type || 'INDICATOR').toUpperCase() === 'TASK'
            ? ('TASK' as const)
            : ('INDICATOR' as const)
      }))
      .filter(item => Number.isFinite(item.entityId) && item.entityId > 0)
    departmentMutationPendingApprovals.value = items
      .filter(item => String(item.status || '').toUpperCase() === 'IN_REVIEW')
      .map(item => ({
        instanceId: item.instance_id,
        entityId: Number(item.indicator_id),
        entityType:
          String(item.entity_type || 'INDICATOR').toUpperCase() === 'TASK'
            ? ('TASK' as const)
            : ('INDICATOR' as const),
        flowCode: item.flow_code || 'PLAN_MUTATION_STRATEGY',
        status: 'IN_REVIEW',
        title: item.indicator_desc,
        currentStepName: item.current_step_name,
        approverOrgId: item.approver_org_id,
        sourceOrgId: item.source_org_id,
        sourceOrgName: item.source_org_name,
        targetOrgId: item.target_org_id,
        targetOrgName: item.target_org_name,
        // 2026-10-21：批次号与字段变更明细，供看板聚合与详情弹窗逐字段展示
        batchId: item.batch_id || null,
        changedFields: item.changed_fields || null,
        // 提交人取后端真实发起人（audit_instance.requester 的姓名）
        submitterName: item.submitter_name,
        createdAt: item.created_at
      }))

    // 2026-10-21：异动本身也是一条审批流程，「审批流程」页签要能显示它走到哪一步。
    // 按实例取流程详情挂到对应条目上（与计划审批同一套 getWorkflowInstanceDetail 接口）。
    const { getWorkflowInstanceDetail } = await import('@/features/workflow/api/queries')
    departmentMutationPendingApprovals.value = await Promise.all(
      departmentMutationPendingApprovals.value.map(async entry => {
        try {
          const detail = await getWorkflowInstanceDetail(String(entry.instanceId))
          return detail?.success && detail.data ? { ...entry, workflowDetail: detail.data } : entry
        } catch (error) {
          logger.warn('[StrategicTaskView] 加载异动流程详情失败:', {
            instanceId: entry.instanceId,
            error
          })
          return entry
        }
      })
    )
  } catch (error) {
    logger.warn('[StrategicTaskView] 加载异动审批实例失败:', error)
  }
}
// 部门切换即预载（抽屉打开时数据已就绪，避免晚于历史卡片加载的时序问题）
watch(
  () => selectedDepartment.value,
  () => {
    void loadDepartmentMutationWorkflowEntities()
  },
  { immediate: true }
)
// 抽屉每次打开都重新拉一次：审批推进后异动的当前节点与流程详情都会变
watch(
  () => taskApprovalVisible?.value,
  visible => {
    if (visible) {
      void loadDepartmentMutationWorkflowEntities()
    }
  }
)
const strategicBatchExportDialogVisible = ref(false)
const selectedStrategicExportDepartments = ref<string[]>([])
const strategicImportDialogVisible = ref(false)
type ManualAlertSelectValue = Exclude<ManualAlertSeverity, null> | ''

const manualAlertOptions: Array<{
  label: string
  value: ManualAlertSelectValue
  type: 'success' | 'info' | 'warning' | 'danger'
}> = [
  // 进度等级三档（2026-09-17 定案）：存储码沿用 alert severity，新增 AHEAD/NORMAL
  { label: '未评定', value: '', type: 'info' },
  { label: '超前完成', value: 'AHEAD', type: 'success' },
  { label: '正常', value: 'NORMAL', type: 'success' },
  { label: '延期', value: 'DELAYED', type: 'warning' }
]

const getManualAlertOption = (severity?: ManualAlertSeverity) =>
  manualAlertOptions.find(option => option.value === (severity ?? '')) || manualAlertOptions[0]

const getManualAlertLabel = (severity?: ManualAlertSeverity) => getManualAlertOption(severity).label

const getManualAlertTagType = (severity?: ManualAlertSeverity) =>
  getManualAlertOption(severity).type

const allStrategicExportDepartmentsSelected = computed({
  get: () =>
    functionalDepartments.value.length > 0 &&
    selectedStrategicExportDepartments.value.length === functionalDepartments.value.length,
  set: checked => {
    selectedStrategicExportDepartments.value = checked ? [...functionalDepartments.value] : []
  }
})

const strategicExportDepartmentsIndeterminate = computed(
  () =>
    selectedStrategicExportDepartments.value.length > 0 &&
    selectedStrategicExportDepartments.value.length < functionalDepartments.value.length
)

// 导出与界面同构：同一战略任务的多行在「战略任务」列合并为一个单元格。
// 2026-10-18 用户定案（晚间修订）：导出不含「内部ID」——系统内部主键对导出读者无意义，
// 行对齐由「序号」承担；回导匹配走「任务名+指标名」名称匹配。
const buildStrategicExportColumns = (
  rows: StrategicExportRow[]
): ExcelExportColumn<StrategicExportRow>[] => {
  // 计算「战略任务」连续分组的合并行数：仅组首行携带 rowSpan，其余行为被合并的从属行
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
    { header: '部门', width: 18, getValue: row => row.exportDepartment },
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
    {
      header: '任务类别',
      width: 12,
      align: 'center',
      getValue: row => getCategoryText(row.type2)
    },
    { header: '下发备注', width: 24, getValue: row => row.remark || '-' },
    // 2026-10-20 用户定案：表头直接标出权重可接受的写法，避免用户猜格式
    {
      header: '权重（可填 10 / 10% / 0.1）',
      width: 16,
      align: 'center',
      getValue: row => Number(row.weight || 0)
    },
    // 2026-10-20：阅读列标注「导入忽略」——导入解析器不识别这两列，改了不起作用
    {
      header: '鉴定进度等级（导入忽略）',
      width: 20,
      align: 'center',
      getValue: row => getManualAlertLabel(row.manualAlertSeverity)
    },
    {
      header: '上报资料（导入忽略）',
      width: 42,
      getValue: row =>
        buildAttachmentCell(
          (row as StrategicIndicator & { pendingAttachmentDetails?: unknown[] })
            .pendingAttachmentDetails?.length
            ? (row as StrategicIndicator & { pendingAttachmentDetails?: unknown[] })
                .pendingAttachmentDetails
            : row.pendingAttachments
        )
    }
  ]
}

const findStrategicExportPlanByDepartment = (department: string) => {
  const normalizedDepartment = normalizeDepartmentName(department)
  const departmentOrgId = resolveDepartmentIdByName(department)
  const sourceOrgId = Number(
    (currentPlan.value as Record<string, unknown> | null)?.createdByOrgId ??
      (currentPlan.value as Record<string, unknown> | null)?.created_by_org_id ??
      35
  )

  const plans = planStore.plans.filter(plan => {
    const planRecord = plan as Record<string, unknown>
    const planYear = resolvePlanYear(planRecord)
    const planTargetOrgId = Number(planRecord.targetOrgId ?? planRecord.org_id ?? planRecord.orgId)
    const planTargetOrgName = normalizeDepartmentName(
      String(planRecord.targetOrgName || planRecord.orgName || '')
    )

    return (
      planYear === timeContext.currentYear &&
      ((departmentOrgId != null &&
        Number.isFinite(planTargetOrgId) &&
        planTargetOrgId === departmentOrgId) ||
        planTargetOrgName === normalizedDepartment)
    )
  })

  return (
    plans.find(plan => {
      const planRecord = plan as Record<string, unknown>
      const planCreatedByOrgId = Number(planRecord.createdByOrgId ?? planRecord.created_by_org_id)
      const planLevel = String(planRecord.planLevel || planRecord.plan_level || '')
        .trim()
        .toUpperCase()

      return (
        Number.isFinite(planCreatedByOrgId) &&
        planCreatedByOrgId === sourceOrgId &&
        planLevel === 'STRAT_TO_FUNC'
      )
    }) ||
    plans[0] ||
    null
  )
}

const loadStrategicExportTaskIdSetByDepartment = async (
  department: string
): Promise<Set<string>> => {
  const plan = findStrategicExportPlanByDepartment(department)
  const planId = plan?.id
  if (!planId) {
    return new Set()
  }

  const response = await strategicApi.getTasksByPlanId(planId)
  if (!response?.success || !Array.isArray(response.data)) {
    return new Set()
  }

  return new Set(buildTaskIdSet(response.data as Array<Record<string, unknown>>))
}

const getStrategicExportRowsByDepartment = (
  department: string,
  planTaskIdSet?: Set<string>
): StrategicExportRow[] => {
  const rows = normalizedIndicators.value
    .filter(
      indicator =>
        resolveIndicatorYear(indicator, timeContext.currentYear) === timeContext.currentYear
    )
    .filter(
      indicator =>
        indicator.ownerDept === '战略发展部' &&
        indicator.responsibleDept === department &&
        indicator.isStrategic === true &&
        (planTaskIdSet
          ? planTaskIdSet.has(getIndicatorTaskId(indicator))
          : isIndicatorInCurrentPlanScope(indicator))
    )
    .map(indicator => ({
      ...indicator,
      type2: getIndicatorCategoryLabel(indicator),
      exportDepartment: department
    }))

  return rows.sort((left, right) => {
    const leftRank = getStrategicTaskTypeRank(left)
    const rightRank = getStrategicTaskTypeRank(right)
    if (leftRank !== rightRank) {
      return leftRank - rightRank
    }
    return String(left.taskContent || '').localeCompare(String(right.taskContent || ''))
  })
}

// 2026-10-19 用户定案：序号→内部ID 映射（导入时随预览请求传后端，序号与导出文件完全一致）
const strategicSequenceEntries = computed(() => {
  const department = selectedDepartment.value
  if (!department) {
    return []
  }
  return getStrategicExportRowsByDepartment(department).map((row, index) => ({
    seq: index + 1,
    indicatorId: row.id
  }))
})

const getStrategicTaskTypeRank = (indicator: StrategicIndicator): number => {
  const taskType = getIndicatorMappedTaskType(indicator)
  if (isDevelopmentTaskType(taskType)) {
    return 0
  }
  if (isBasicTaskType(taskType)) {
    return 1
  }
  return 2
}

const getStrategicExportRowTone = (row: StrategicExportRow): ExcelRowTone => {
  const category = getCategoryText(row.type2)
  if (category.includes('发展')) {
    return 'development'
  }
  if (category.includes('基础')) {
    return 'basic'
  }
  return 'default'
}

const getStrategicExportRowTextColor = (row: StrategicExportRow): string | undefined =>
  row.manualAlertSeverity === 'CRITICAL'
    ? '#f56c6c'
    : row.manualAlertSeverity === 'WARNING'
      ? '#e6a23c'
      : undefined

const buildStrategicExportSheet = (
  department: string,
  rows = getStrategicExportRowsByDepartment(department)
): ExcelExportSheet<StrategicExportRow> => ({
  sheetName: department || '当前部门',
  rows,
  columns: buildStrategicExportColumns(rows),
  emptyMessage: '当前部门暂无可导出的战略任务指标',
  getRowTone: getStrategicExportRowTone,
  getRowTextColor: getStrategicExportRowTextColor
})

const handleExportCurrentStrategicDepartment = async () => {
  const department = selectedDepartment.value
  if (!department) {
    ElMessage.warning('请先选择部门')
    return
  }

  const rows = getStrategicExportRowsByDepartment(department)
  if (rows.length === 0) {
    ElMessage.warning('当前部门暂无可导出的数据')
    return
  }

  strategicExporting.value = true
  try {
    await exportRowsToExcel(
      buildStrategicExportSheet(department, rows),
      buildExportFileName('战略任务指标总表', department)
    )
    ElMessage.success('导出成功')
  } catch {
    ElMessage.error('导出失败，请稍后重试')
  } finally {
    strategicExporting.value = false
  }
}

const openStrategicBatchExportDialog = () => {
  selectedStrategicExportDepartments.value = [...functionalDepartments.value]
  strategicBatchExportDialogVisible.value = true
}

// 2026-10-20 用户定案：全部导出 = 每个部门一个 Excel（序号各自从 1 开始），
// 附件原始文件一并打进 zip，避免多部门挤在一个工作簿里导致序号跨部门错位、附件只有链接。
const handleExportSelectedStrategicDepartments = async () => {
  const departments = selectedStrategicExportDepartments.value
  if (departments.length === 0) {
    ElMessage.warning('请选择要导出的部门')
    return
  }

  strategicExporting.value = true
  try {
    await Promise.all([
      planStore.loadPlans({ force: true, background: true }),
      strategicStore.loadIndicatorsByYear(timeContext.currentYear, { force: true })
    ])

    const payloads = await Promise.all(
      departments.map(async department => {
        const taskIdSet = await loadStrategicExportTaskIdSetByDepartment(department)
        const rows = getStrategicExportRowsByDepartment(department, taskIdSet)
        return {
          department,
          sheets: [buildStrategicExportSheet(department, rows) as ExcelExportSheet<unknown>],
          attachments: collectAttachmentRefs(rows)
        }
      })
    )

    const dateText = new Date().toISOString().slice(0, 10)
    await exportDepartmentsAsZip(
      payloads,
      `战略任务指标总表_${departments.length === 1 ? departments[0] : '多部门'}_${dateText}.zip`,
      { onProgress: text => ElMessage({ message: text, duration: 1200, grouping: true }) }
    )
    strategicBatchExportDialogVisible.value = false
    ElMessage.success(
      departments.length === 1
        ? '导出成功（单部门已直接输出 xlsx）'
        : `导出成功：${departments.length} 个部门各一个 Excel，附件已一并打包`
    )
  } catch {
    ElMessage.error('导出失败，请稍后重试')
  } finally {
    strategicExporting.value = false
  }
}

const currentStrategicImportOrgId = computed(
  () => currentDepartmentOrgId.value ?? resolveDepartmentIdByName(selectedDepartment.value) ?? null
)

const currentStrategicImportCycleId = computed(() => {
  const selectedPlan = currentPlan.value as {
    cycleId?: number | string
    cycle_id?: number | string
  } | null
  const directCycleId = selectedPlan?.cycleId ?? selectedPlan?.cycle_id
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

const openStrategicImportDialog = () => {
  if (!selectedDepartment.value || !currentStrategicImportOrgId.value) {
    ElMessage.warning('请先选择要导入的职能部门')
    return
  }
  if (!currentStrategicImportCycleId.value) {
    ElMessage.warning('当前周期信息不可用，暂不能导入')
    return
  }
  // 2026-10-20 用户定案：已下发计划不允许再通过导入修改，点击入口时就拦住，
  // 不让用户白跑一趟选文件流程；同时给出替代操作路径。
  if (hasDistributedIndicators.value) {
    ElMessageBox.alert(
      '该部门计划已下发，不能再通过导入修改。\n\n如需新增或调整指标：\n' +
        '· 新增：点表格上方「新增行」，或指标行右下角的「+」\n' +
        '· 修改：双击指标名称/权重/下发备注就地编辑\n' +
        '· 改完后点击顶部「发起异动」提交审批（审批通过后生效）',
      '该计划已下发，导入已关闭',
      { confirmButtonText: '我知道了', type: 'warning' }
    ).catch(() => {})
    return
  }
  strategicImportDialogVisible.value = true
}

const handleStrategicImportCommitted = async (result?: ImportCommitResponse) => {
  await refreshCurrentDepartmentView({ showLoading: true, force: true, reloadIndicators: true })

  if (result?.workflow?.autoSubmitAndApprove || result?.workflow?.instanceId) {
    resetApprovalWorkflowStateCache()
    await refreshApprovalWorkflowSummaries()
    await preloadApprovalWorkflowDetail()
  }
}
</script>

<template>
  <div class="strategic-task-container page-fade-enter">
    <!-- 侧边栏遮罩层 -->
    <div class="sidebar-backdrop"></div>

    <!-- 左侧任务列表 - 动态隐藏 -->
    <aside class="task-sidebar">
      <div class="sidebar-header">
        <div class="task-list-title">
          {{ activeTaskTabName === 'functional' ? '部门列表' : '学院列表' }}
        </div>
      </div>

      <ul class="task-list">
        <!-- 2026-10-11 用户定案：职能部门 tab 列职能部门；二级学院 tab 列学院 -->
        <template v-if="activeTaskTabName === 'functional'">
          <li
            v-for="dept in functionalDepartments"
            :key="dept"
            :class="['task-item', { active: selectedDepartment === dept }]"
            @click="selectDepartment(dept)"
          >
            {{ dept }}
          </li>
        </template>
        <template v-else>
          <!-- 2026-10-13 用户定案：学院列表按左侧已选职能部门下钻，只列该部门下发的目标学院 -->
          <li
            v-for="college in collegeDepartmentsScoped"
            :key="college"
            :class="['task-item', { active: selectedCollege === college }]"
            @click="selectCollege(college)"
          >
            {{ college }}
          </li>
          <li v-if="collegeDepartmentsScoped.length === 0" class="task-item college-scope-empty">
            当前职能部门暂无下发给学院的指标
          </li>
        </template>
      </ul>
    </aside>
    <!-- 展开箭头独立于侧边栏 - 使用SVG图标 -->
    <!-- 2026-10-13 用户定案：二级学院 tab 未选学院时，左侧入口加呼吸高亮引导（3 次后转静态） -->
    <div class="sidebar-toggle" :class="{ 'sidebar-toggle--guide': showCollegeGuide }">
      <svg class="toggle-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M9 6L15 12L9 18"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          fill="none"
        />
      </svg>
      <span class="toggle-hint">{{ selectedDepartment || functionalDepartments[0] || '' }}</span>
    </div>
    <!-- 左侧入口引导气泡（指向真实交互入口，点击学院后消失） -->
    <transition name="el-fade-in">
      <div v-if="showCollegeGuide" class="college-guide-bubble">
        <span class="college-guide-bubble__arrow">←</span>
        请选择学院
      </div>
    </transition>

    <!-- 右侧详情区域 - Excel风格 -->
    <section
      :class="[
        'task-detail',
        'excel-style',
        'card-animate',
        { 'department-switching': isDepartmentSwitching }
      ]"
      style="animation-delay: 0.1s"
    >
      <!-- Excel标题头 -->
      <div class="excel-header">
        <h2 class="excel-title">战略任务指标总表</h2>
        <div class="excel-header-status">
          <el-button
            type="primary"
            plain
            size="small"
            :loading="strategicExporting"
            @click="openStrategicBatchExportDialog"
          >
            <el-icon><Download /></el-icon>
            全部导出
          </el-button>
          <el-tag :type="overallStatus.type" size="small">
            计划状态: {{ isInitialDataLoading ? '加载中...' : overallStatus.label }}
          </el-tag>
        </div>
      </div>

      <!-- Excel工具栏 -->
      <div class="excel-toolbar">
        <div class="toolbar-left">
          <!-- 2026-10-20 用户定案：已下发计划允许战略部继续新增指标（走异动审批链），
               不再因 hasDistributedIndicators 禁用「新增行」 -->
          <!-- 2026-10-21 用户定案：编辑权只属于填报人，负责人/校领导只审批不编辑 -->
          <!-- 2026-10-23 用户定案：学院 tab 也能新增，但新增的是「该学院的子指标」，
               必须挂到所选核心指标下（复用指标下发与管理页的新增子指标契约） -->
          <el-button
            type="primary"
            size="small"
            :disabled="
              !canEdit ||
              isCurrentPlanUnderApproval ||
              (activeTaskTabName === 'college' && !selectedCollege)
            "
            :title="
              isCurrentPlanUnderApproval
                ? '计划正在审批中，暂不能新增：请等审批结束或先撤回本次审批'
                : activeTaskTabName === 'college' && !selectedCollege
                  ? '请先在左侧选择学院'
                  : ''
            "
            @click.stop="handleAddNewRow"
          >
            <el-icon><Plus /></el-icon>
            新增行
          </el-button>
          <!-- 下发/撤回合并按钮 -->
          <el-button
            :type="distributeButtonType"
            size="small"
            :disabled="distributeButtonDisabled"
            :title="distributeButtonDisabledReason"
            @click.stop="handleDistributeOrWithdraw"
          >
            <el-icon><component :is="distributeButtonIcon" /></el-icon>
            {{ distributeButtonText }}
          </el-button>
          <div class="approval-entry-wrapper">
            <!-- 审批进度按钮（带徽章） -->
            <el-badge v-if="pendingApprovalCount > 0" is-dot class="approval-badge">
              <el-button
                size="small"
                type="warning"
                class="approval-entry-action"
                @click="handleOpenApproval"
              >
                <el-icon><Check /></el-icon>
                {{ approvalEntryButtonText }}
              </el-button>
            </el-badge>
            <el-button
              v-else
              size="small"
              class="approval-entry-action"
              @click="handleOpenApproval"
            >
              <el-icon><Check /></el-icon>
              {{ approvalEntryButtonText }}
            </el-button>
          </div>
          <el-button
            size="small"
            :loading="strategicExporting"
            @click="handleExportCurrentStrategicDepartment"
          >
            <el-icon><Download /></el-icon>
            导出
          </el-button>
          <el-button size="small" :icon="Upload" @click="openStrategicImportDialog">
            导入
          </el-button>
          <!-- 2026-10-21 用户定案：全部攒改一起上报；按钮就叫「发起异动」 -->
          <!-- 编辑权只属于填报人：负责人/校领导不产生草稿，也不应看到提交入口 -->
          <!-- 2026-10-24 用户定案（互斥）：上报在审时异动发起入口锁定；异动在审时草稿区一并锁定 -->
          <template
            v-if="
              canEdit &&
              hasMutationDraft &&
              !isReportApprovalInFlight &&
              !isMutationApprovalInFlight
            "
          >
            <el-button
              size="small"
              type="warning"
              :loading="mutationApiLoading"
              @click="submitMutationDraft"
            >
              发起异动
            </el-button>
            <el-button size="small" :disabled="mutationApiLoading" @click="cancelMutationDraft">
              取消异动
            </el-button>
          </template>
          <!-- 视图切换按钮 -->
          <!-- 2026-10-24 用户定案：卡片视图无业务需求，且不能切换时单独留「表格视图」按钮
               也无意义——整组隐藏（两个按钮与卡片视图模板代码均保留） -->
          <el-button-group v-if="SHOW_CARD_VIEW_TOGGLE" style="margin-left: 16px">
            <el-button
              :type="viewMode === 'table' ? 'primary' : ''"
              size="small"
              @click="viewMode = 'table'"
            >
              <el-icon><View /></el-icon>
              表格视图
            </el-button>
            <el-button
              :type="viewMode === 'card' ? 'primary' : ''"
              size="small"
              @click="viewMode = 'card'"
            >
              <el-icon><View /></el-icon>
              卡片视图
            </el-button>
          </el-button-group>
        </div>
        <div class="toolbar-right">
          <el-popover
            placement="top-end"
            trigger="hover"
            :width="320"
            popper-class="approval-status-popper"
            @show="handleApprovalStatusPopoverShow"
          >
            <template #reference>
              <el-tag
                :type="approvalFlowStatusMeta.tagType"
                effect="light"
                class="approval-status-tag"
                @click.stop="handleOpenApproval"
              >
                {{ activeTaskTabName === 'college' ? '审批状况' : '审批状态' }}:
                {{ approvalFlowStatusMeta.label }}
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
              departmentTotalWeight > 100
                ? 'danger'
                : departmentTotalWeight === 100
                  ? 'success'
                  : 'info'
            "
            :class="{ 'weight-tag--overlimit': departmentTotalWeight > 100 }"
            size="small"
            style="margin-right: 12px"
          >
            基础性权重合计: {{ departmentTotalWeight }} / 100
          </el-tag>
          <el-tag v-if="isReadOnly" type="warning" size="small" style="margin-right: 12px">
            历史快照 (只读)
          </el-tag>
        </div>
      </div>

      <!-- 待审批进度警告提示 -->
      <el-alert
        v-if="pendingApprovalCount > 0 && !hasDistributedIndicators"
        type="warning"
        :closable="false"
        style="margin: 12px 16px"
      >
        <template #title> 当前计划已进入审批流程，请先完成整体计划审批后再继续下发或编辑 </template>
      </el-alert>

      <!-- 任务管理页签：职能部门 / 二级学院（2026-09-17 定案 tabpage 方案） -->
      <el-tabs v-model="activeTaskTabName" class="task-tabs">
        <el-tab-pane label="职能部门战略任务管理" name="functional">
          <!-- Excel表格 -->
          <div class="excel-table-wrapper">
            <div v-if="isInitialDataLoading" class="page-loading-state">
              <div class="loading-header">
                <el-icon class="is-loading"><Loading /></el-icon>
                <span>正在加载指标数据，请稍候...</span>
              </div>
              <el-skeleton :rows="8" animated />
            </div>

            <template v-else>
              <!-- 表格视图 -->
              <div v-if="viewMode === 'table'" class="table-container">
                <el-table
                  ref="tableRef"
                  :data="indicators"
                  :span-method="getSpanMethod"
                  border
                  highlight-current-row
                  class="unified-table"
                >
                  <el-table-column prop="taskContent" label="战略任务" width="140">
                    <template #default="{ row }">
                      <div class="task-cell-wrapper">
                        <div
                          class="indicator-name-cell"
                          @dblclick="handleIndicatorDblClick(row, 'taskContent')"
                        >
                          <el-input
                            v-if="
                              editingIndicatorId === row.id &&
                              editingIndicatorField === 'taskContent'
                            "
                            v-model="editingIndicatorValue"
                            v-focus
                            type="textarea"
                            :autosize="{ minRows: 2, maxRows: 6 }"
                            @blur="saveIndicatorEdit(row, 'taskContent')"
                            @keyup.esc="cancelIndicatorEdit"
                          />
                          <span
                            v-else-if="isSavingIndicatorCell(row, 'taskContent')"
                            class="cell-saving-text"
                          >
                            保存中...
                          </span>
                          <!-- 2026-10-19 用户定案：两个独立显示框互不干扰——
                               上方悬停显示任务属性（基础性/发展性），右侧竖排看板显示被截断的全文 -->
                          <el-tooltip
                            v-else
                            :content="`${getCategoryText(row.type2)}任务`"
                            placement="top"
                          >
                            <FullTextPanel :text="row.taskContent || '未关联任务'">
                              <span
                                class="indicator-name-text task-content-colored"
                                :style="{ color: getCategoryColor(row.type2) }"
                                >{{ truncateText(row.taskContent || '未关联任务', 50) }}</span
                              >
                            </FullTextPanel>
                          </el-tooltip>
                          <!-- 战略任务改名同样计入「已更改 N 次」（悬停查看历史） -->
                          <div v-if="!isReadOnly" class="indicator-cell-footer">
                            <MutationBadgePopover :task-id="getIndicatorTaskId(row) || null" />
                          </div>
                        </div>

                        <!-- 右下角新增指标三角形按钮
                             2026-10-20 用户定案：已下发计划也允许新增指标（走异动链），
                             不再限定 canWithdraw（该条件仅未下发时为真） -->
                        <div
                          v-if="!isReadOnly"
                          class="add-indicator-trigger"
                          @click="handleAddIndicatorToTask(row)"
                        >
                          <span class="trigger-icon">+</span>
                        </div>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column prop="name" label="核心指标" min-width="210">
                    <template #default="{ row }">
                      <div
                        class="indicator-name-cell"
                        @dblclick="handleIndicatorDblClick(row, 'name')"
                      >
                        <el-input
                          v-if="editingIndicatorId === row.id && editingIndicatorField === 'name'"
                          v-model="editingIndicatorValue"
                          v-focus
                          type="textarea"
                          :autosize="{ minRows: 2, maxRows: 6 }"
                          @blur="saveIndicatorEdit(row, 'name')"
                        />
                        <span
                          v-else-if="isSavingIndicatorCell(row, 'name')"
                          class="cell-saving-text"
                        >
                          保存中...
                        </span>
                        <template v-else>
                          <template v-if="row.name">
                            <el-tooltip
                              :content="
                                row.type1 === '定性'
                                  ? '定性指标'
                                  : row.type1 === '定量'
                                    ? '定量指标'
                                    : '未设置类型'
                              "
                              placement="top"
                            >
                              <FullTextPanel :text="row.name">
                                <span
                                  class="indicator-name-text"
                                  :class="
                                    row.type1 === '定性'
                                      ? 'indicator-qualitative'
                                      : row.type1 === '定量'
                                        ? 'indicator-quantitative'
                                        : ''
                                  "
                                  >{{ truncateText(row.name, 50) }}</span
                                >
                              </FullTextPanel>
                            </el-tooltip>
                            <!-- D2 孤立指标标记：父指标已被删除时提示，信息不丢 -->
                            <el-tag
                              v-if="
                                row.parentIndicatorId &&
                                !indicatorByIdMap.get(String(row.parentIndicatorId))
                              "
                              size="small"
                              type="warning"
                              class="orphan-parent-tag"
                              >父级已删除</el-tag
                            >
                            <div class="indicator-cell-footer">
                              <MutationBadgePopover v-if="row.id" :indicator-id="row.id" />
                            </div>
                          </template>
                          <span v-else class="indicator-name-text placeholder-text"
                            >双击编辑指标</span
                          >
                        </template>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column prop="weight" label="权重" width="80" align="center">
                    <template #default="{ row }">
                      <div class="weight-cell" @dblclick="handleIndicatorDblClick(row, 'weight')">
                        <el-input
                          v-if="editingIndicatorId === row.id && editingIndicatorField === 'weight'"
                          v-model="editingIndicatorValue"
                          v-focus
                          size="small"
                          style="width: 50px"
                          @blur="saveIndicatorEdit(row, 'weight')"
                          @keyup.enter="saveIndicatorEdit(row, 'weight')"
                        />
                        <span
                          v-else-if="isSavingIndicatorCell(row, 'weight')"
                          class="cell-saving-text"
                        >
                          保存中...
                        </span>
                        <span v-else class="weight-text">{{ row.weight }}</span>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column label="自评等级" width="112" align="center">
                    <template #default="{ row }">
                      <el-tag v-if="row.selfRating" size="small" type="info">
                        {{
                          { AHEAD: '超前完成', NORMAL: '正常', DELAYED: '延期' }[row.selfRating] ||
                          row.selfRating
                        }}
                      </el-tag>
                      <span v-else style="color: #909399">—</span>
                    </template>
                  </el-table-column>
                  <!-- 2026-10-24 用户定案（鉴定等级锁死）：填报看板上的鉴定进度等级
                       一律只读展示——鉴定由上级部门在审批详情里按指标评定（指标级鉴定），
                       看板不再提供行内修改入口，防止绕过审批链直接改等级。 -->
                  <el-table-column label="鉴定进度等级" width="122" align="center">
                    <template #default="{ row }">
                      <div class="manual-alert-cell">
                        <el-tag :type="getManualAlertTagType(row.manualAlertSeverity)" size="small">
                          {{ getManualAlertLabel(row.manualAlertSeverity) }}
                        </el-tag>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column label="上报资料" width="112" align="center">
                    <template #default="{ row }">
                      <span
                        v-if="
                          (row.attachments?.length || row.pendingAttachmentDetails?.length || 0) > 0
                        "
                      >
                        <el-button
                          link
                          type="primary"
                          size="small"
                          @click="viewIndicatorDetail(row as StrategicIndicator)"
                        >
                          {{ row.attachments?.length || row.pendingAttachmentDetails?.length || 0 }}
                          个附件
                        </el-button>
                      </span>
                      <span v-else style="color: #909399">—</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="进度说明" min-width="130">
                    <template #default="{ row }">
                      <el-tooltip
                        :content="row.pendingRemark || ''"
                        :disabled="(row.pendingRemark || '').length <= 50"
                        placement="top"
                      >
                        <span>{{
                          row.pendingRemark ? truncateText(row.pendingRemark, 50) : '—'
                        }}</span>
                      </el-tooltip>
                    </template>
                  </el-table-column>
                  <el-table-column prop="remark" label="下发备注" width="130">
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
                          @keyup.esc="cancelIndicatorEdit"
                        />
                        <span
                          v-else-if="isSavingIndicatorCell(row, 'remark')"
                          class="cell-saving-text"
                        >
                          保存中...
                        </span>
                        <el-tooltip
                          v-else
                          :content="row.remark || ''"
                          :disabled="(row.remark || '').length <= 50"
                          placement="top"
                        >
                          <span class="indicator-name-text remark-text-wrap">{{
                            row.remark ? truncateText(row.remark, 50) : '样例：双击编辑说明'
                          }}</span>
                        </el-tooltip>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" width="116" align="center">
                    <template #default="{ row }">
                      <div class="action-buttons-inline">
                        <!-- 详情按钮 - 始终显示（2026-10-23 用户定案：查看/详情文案统一为「详情」） -->
                        <el-button link type="primary" size="small" @click="handleViewDetail(row)"
                          >详情</el-button
                        >

                        <!-- 删除按钮 - 仅草稿状态可删除 -->
                        <el-button
                          v-if="canDeleteIndicator(row)"
                          link
                          type="danger"
                          size="small"
                          @click="handleDeleteIndicator(row)"
                          >删除</el-button
                        >
                      </div>
                    </template>
                  </el-table-column>
                </el-table>
              </div>

              <!-- 卡片视图 -->
              <div v-else-if="viewMode === 'card'" class="card-container">
                <!-- 卡片导航栏 -->
                <div v-if="indicators.length > 0" class="card-navigation">
                  <div class="nav-left">
                    <el-button
                      :disabled="currentIndicatorIndex === 0"
                      size="small"
                      @click="goToPrevIndicator"
                    >
                      <el-icon><ArrowDown style="transform: rotate(90deg)" /></el-icon>
                      上一个
                    </el-button>
                    <span class="nav-info">
                      {{ currentIndicatorIndex + 1 }} / {{ indicators.length }}
                    </span>
                    <el-button
                      :disabled="currentIndicatorIndex === indicators.length - 1"
                      size="small"
                      @click="goToNextIndicator"
                    >
                      下一个
                      <el-icon><ArrowDown style="transform: rotate(-90deg)" /></el-icon>
                    </el-button>
                  </div>
                  <div class="nav-right">
                    <el-select
                      v-model="currentIndicatorIndex"
                      placeholder="快速跳转"
                      size="small"
                      style="width: 200px"
                    >
                      <el-option
                        v-for="(indicator, index) in indicators"
                        :key="indicator.id"
                        :label="`${index + 1}. ${indicator.name || '未命名指标'}`"
                        :value="index"
                      />
                    </el-select>
                  </div>
                </div>

                <!-- 指标卡片 -->
                <div v-if="currentIndicator" class="indicator-card">
                  <!-- 卡片头部 -->
                  <div class="card-header">
                    <div class="card-title-section">
                      <h3 class="card-title">{{ currentIndicator.name || '未命名指标' }}</h3>
                      <div class="card-tags">
                        <el-tag
                          size="small"
                          :class="
                            currentIndicator.type1 === '定性'
                              ? 'tag-qualitative'
                              : 'tag-quantitative'
                          "
                        >
                          {{ currentIndicator.type1 }}
                        </el-tag>
                        <el-tag
                          size="small"
                          :style="{
                            backgroundColor: getCategoryColor(currentIndicator.type2),
                            color: '#fff',
                            border: 'none'
                          }"
                        >
                          {{ getCategoryText(currentIndicator.type2) }}任务
                        </el-tag>
                        <el-tag v-if="currentPlanStatus === 'PENDING'" type="warning" size="small">
                          计划审批中
                        </el-tag>
                      </div>
                    </div>
                    <div class="card-actions">
                      <el-button
                        type="primary"
                        size="small"
                        @click="handleViewDetail(currentIndicator)"
                      >
                        <el-icon><View /></el-icon>
                        详情
                      </el-button>
                      <el-button
                        v-if="canDeleteIndicator(currentIndicator)"
                        type="danger"
                        size="small"
                        @click="handleDeleteIndicator(currentIndicator)"
                      >
                        <el-icon><Delete /></el-icon>
                        删除
                      </el-button>
                    </div>
                  </div>

                  <!-- 卡片内容 -->
                  <div class="card-content">
                    <!-- 基础信息 -->
                    <div class="info-section">
                      <h4 class="section-title">基础信息</h4>
                      <div class="info-grid">
                        <div class="info-item">
                          <span class="info-label">战略任务：</span>
                          <span class="info-value">{{
                            currentIndicator.taskContent || '未关联任务'
                          }}</span>
                        </div>
                        <div class="info-item">
                          <span class="info-label">权重：</span>
                          <span class="info-value">{{ currentIndicator.weight }}</span>
                        </div>
                        <div class="info-item">
                          <span class="info-label">责任部门：</span>
                          <span class="info-value">{{ currentIndicator.responsibleDept }}</span>
                        </div>
                        <div class="info-item">
                          <span class="info-label">责任人：</span>
                          <span class="info-value">{{ currentIndicator.responsiblePerson }}</span>
                        </div>
                        <div class="info-item full-width">
                          <span class="info-label">备注：</span>
                          <span class="info-value">{{ currentIndicator.remark || '无备注' }}</span>
                        </div>
                      </div>
                    </div>

                    <!-- 进度信息 -->
                    <div class="progress-section">
                      <h4 class="section-title">进度信息</h4>
                      <div class="progress-display">
                        <div class="progress-main">
                          <div class="progress-text">
                            <span class="current-progress"
                              >{{ currentIndicator.progress || 0 }}%</span
                            >
                            <span class="progress-label">当前进度</span>
                          </div>
                          <el-progress
                            :percentage="currentIndicator.progress || 0"
                            :stroke-width="12"
                            :color="getProgressColor(currentIndicator)"
                            class="progress-bar"
                          />
                        </div>
                        <!-- 待审批进度显示 -->
                        <div
                          v-if="hasPendingProgressContent(currentIndicator)"
                          class="pending-progress"
                        >
                          <div
                            v-if="hasPendingProgressValue(currentIndicator)"
                            class="pending-info"
                          >
                            <span class="pending-label">申请进度：</span>
                            <span class="pending-value"
                              >{{ currentIndicator.pendingProgress }}%</span
                            >
                            <span class="progress-change">
                              ({{ getPendingProgressDelta(currentIndicator) > 0 ? '+' : ''
                              }}{{ getPendingProgressDelta(currentIndicator) }}%)
                            </span>
                          </div>
                          <div v-if="currentIndicator.pendingRemark" class="pending-remark">
                            <span class="remark-label">填报备注：</span>
                            <span class="remark-text">{{ currentIndicator.pendingRemark }}</span>
                          </div>
                        </div>

                        <div
                          v-if="currentIndicatorWorkflowLoading"
                          class="workflow-progress-card is-loading"
                        >
                          <span class="workflow-progress-hint">正在加载该指标的审批流信息...</span>
                        </div>

                        <div v-else-if="currentIndicatorWorkflow" class="workflow-progress-card">
                          <div class="workflow-progress-header">
                            <span class="workflow-progress-title">报告审批流</span>
                            <el-tag
                              size="small"
                              :type="getIndicatorWorkflowTagType(currentIndicatorWorkflow)"
                            >
                              {{ getIndicatorWorkflowStatusLabel(currentIndicatorWorkflow) }}
                            </el-tag>
                          </div>
                          <div class="workflow-progress-grid">
                            <div class="workflow-progress-item">
                              <span class="workflow-progress-label">当前节点</span>
                              <span class="workflow-progress-value">{{
                                currentIndicatorWorkflow.currentStepName || '审批'
                              }}</span>
                            </div>
                            <div class="workflow-progress-item">
                              <span class="workflow-progress-label">当前审批人</span>
                              <span class="workflow-progress-value">{{
                                currentIndicatorWorkflow.currentApproverName || '待分配'
                              }}</span>
                            </div>
                          </div>
                          <div
                            v-if="canCurrentUserHandleCurrentIndicatorWorkflow"
                            class="workflow-progress-actions"
                          >
                            <el-button
                              size="small"
                              type="success"
                              @click="handleApproveCurrentIndicatorWorkflow"
                            >
                              审批通过
                            </el-button>
                            <el-button
                              size="small"
                              type="danger"
                              plain
                              @click="handleRejectCurrentIndicatorWorkflow"
                            >
                              审批驳回
                            </el-button>
                          </div>
                          <div
                            v-else-if="currentIndicatorWorkflow.currentApproverName"
                            class="workflow-progress-hint"
                          >
                            当前节点审批人为
                            {{ currentIndicatorWorkflow.currentApproverName }}，你当前仅可查看。
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 空状态 -->
                <div v-else class="empty-state">
                  <el-empty description="当前部门暂无指标数据" :image-size="120">
                    <el-button v-if="!isReadOnly" type="primary" @click="addNewRow">
                      <el-icon><Plus /></el-icon>
                      新增指标
                    </el-button>
                  </el-empty>
                </div>
              </div>
            </template>

            <!-- 新增行表单 -->
            <!-- 2026-10-23 修复：表单此前固定在职能部门面板内，学院 tab 点「新增行」时
                 表单渲染到隐藏面板、用户看不见。改为按当前 tab 渲染 -->
            <div
              v-if="isAddingOrEditing && activeTaskTabName === 'functional'"
              ref="addRowFormRef"
              class="add-row-form"
            >
              <h3 class="form-title">
                {{ collegeAddMode ? '新增子指标（挂到核心指标下）' : '新增任务指标' }}
              </h3>
              <div class="add-form-content">
                <!-- 2026-10-23：学院 tab 新增的是子指标，必须先选关联的核心指标 -->
                <el-form v-if="collegeAddMode" label-width="80px">
                  <el-row :gutter="16">
                    <el-col :span="24">
                      <el-form-item class="required-form-item">
                        <template #label><span class="required-asterisk">*</span>关联指标</template>
                        <el-select
                          v-model="newRow.parentIndicatorId"
                          filterable
                          placeholder="选择要挂靠的核心指标"
                          style="width: 100%"
                          :teleported="false"
                        >
                          <el-option
                            v-for="opt in collegeParentIndicatorOptions"
                            :key="opt.id"
                            :label="opt.name"
                            :value="opt.id"
                          >
                            <span>{{ opt.name }}</span>
                            <span class="parent-indicator-option__task">{{ opt.taskContent }}</span>
                          </el-option>
                        </el-select>
                        <div v-if="collegeParentIndicatorOptions.length === 0" class="form-hint">
                          当前职能部门尚未向「{{ selectedCollege }}」下发核心指标，无法新增子指标
                        </div>
                      </el-form-item>
                    </el-col>
                  </el-row>
                </el-form>
                <el-form label-width="80px">
                  <!-- 2026-10-23：学院 tab 建子指标时，任务类型与战略任务均从所选核心指标继承，不在此填写 -->
                  <el-row v-if="!collegeAddMode" :gutter="16">
                    <el-col :span="4">
                      <el-form-item class="required-form-item">
                        <template #label><span class="required-asterisk">*</span>任务类型</template>
                        <el-select
                          v-model="newRow.type2"
                          style="width: 100%"
                          :disabled="!!taskTypeMap[newRow.taskContent]"
                        >
                          <el-option label="发展性" value="发展性" />
                          <el-option label="基础性" value="基础性" />
                        </el-select>
                      </el-form-item>
                    </el-col>
                    <el-col :span="12">
                      <el-form-item class="required-form-item">
                        <template #label><span class="required-asterisk">*</span>战略任务</template>
                        <el-autocomplete
                          v-model="newRow.taskContent"
                          :fetch-suggestions="querySearchTask"
                          placeholder="选择或输入战略任务名称（输入后点击其他位置即保留）"
                          style="width: 100%"
                          :teleported="false"
                          clearable
                          @select="onTaskOptionSelect"
                          @blur="onTaskInputBlur"
                        />
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <el-row :gutter="16">
                    <el-col :span="4">
                      <el-form-item class="required-form-item">
                        <template #label><span class="required-asterisk">*</span>指标类型</template>
                        <el-select v-model="newRow.type1" style="width: 100%">
                          <el-option label="定性" value="定性" />
                          <el-option label="定量" value="定量" />
                        </el-select>
                      </el-form-item>
                    </el-col>
                    <el-col :span="4">
                      <el-form-item class="required-form-item">
                        <template #label><span class="required-asterisk">*</span>权重</template>
                        <el-input-number
                          v-model="newRow.weight"
                          :min="0"
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
                        <template #label><span class="required-asterisk">*</span>核心指标</template>
                        <el-input
                          v-model="newRow.name"
                          type="textarea"
                          :autosize="{ minRows: 2, maxRows: 10 }"
                          placeholder="设置核心指标内容"
                        />
                      </el-form-item>
                    </el-col>
                  </el-row>
                  <el-row :gutter="16">
                    <el-col :span="24">
                      <el-form-item label="下发备注">
                        <el-input
                          v-model="newRow.remark"
                          type="textarea"
                          :autosize="{ minRows: 3, maxRows: 15 }"
                          placeholder="输入指标备注"
                        />
                      </el-form-item>
                    </el-col>
                  </el-row>
                </el-form>
              </div>
              <div class="add-form-actions">
                <el-button type="primary" @click="saveNewRow">保存</el-button>
                <el-button @click="cancelAdd">取消</el-button>
              </div>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="二级学院战略任务管理" name="college">
          <!-- 2026-10-11 用户定案：与职能部门同构的表格视图——左侧选学院，表格展示该学院收到的全部指标，双击异动 -->
          <div class="excel-table-wrapper">
            <div v-if="!selectedCollege" class="college-empty-tip">
              <!-- 2026-10-13 用户定案：中央提示增强（深色大字 + 图标 + 辅助说明），作为左侧入口引导的辅助 -->
              <template v-if="collegeDepartmentsScoped.length > 0">
                <el-icon class="college-empty-icon"><ArrowLeftBold /></el-icon>
                <div class="college-empty-main">请先在左侧选择对应学院</div>
                <div class="college-empty-sub">
                  点击左侧「学院列表」中的学院名称，这里将展示该学院收到的战略任务指标
                </div>
              </template>
              <!-- 当前职能部门未下发学院：引导切换部门而不是选学院 -->
              <template v-else>
                <div class="college-empty-main">当前职能部门暂未向学院下发指标</div>
                <div class="college-empty-sub">
                  请在上方「职能部门战略任务管理」中切换其他职能部门，或先完成指标下发
                </div>
              </template>
            </div>
            <template v-else>
              <div class="table-container">
                <el-table
                  :data="collegeTableIndicators"
                  :span-method="collegeSpanMethod"
                  border
                  highlight-current-row
                  class="unified-table"
                >
                  <el-table-column label="核心指标" min-width="140">
                    <template #default="{ row }">
                      <!-- 2026-10-13 用户定案：与职能部门 tab 核心指标列同构——同核心指标合并单元格、定性/定量配色；悬停看全文 -->
                      <el-tooltip
                        :content="
                          row.parentIndicatorId &&
                          indicatorById.get(row.parentIndicatorId)?.type1 === '定性'
                            ? '定性指标'
                            : row.parentIndicatorId &&
                                indicatorById.get(row.parentIndicatorId)?.type1 === '定量'
                              ? '定量指标'
                              : '未设置类型'
                        "
                        placement="top"
                      >
                        <FullTextPanel
                          :text="
                            (row.parentIndicatorId &&
                              indicatorById.get(row.parentIndicatorId)?.name) ||
                            ''
                          "
                        >
                          <span
                            class="indicator-name-text"
                            :class="
                              row.parentIndicatorId &&
                              indicatorById.get(row.parentIndicatorId)?.type1 === '定性'
                                ? 'indicator-qualitative'
                                : row.parentIndicatorId &&
                                    indicatorById.get(row.parentIndicatorId)?.type1 === '定量'
                                  ? 'indicator-quantitative'
                                  : ''
                            "
                            >{{
                              row.parentIndicatorId &&
                              indicatorById.get(row.parentIndicatorId)?.name
                                ? truncateText(
                                    (row.parentIndicatorId &&
                                      indicatorById.get(row.parentIndicatorId)?.name) ||
                                      '',
                                    50
                                  )
                                : '—'
                            }}</span
                          >
                        </FullTextPanel>
                      </el-tooltip>
                    </template>
                  </el-table-column>
                  <el-table-column prop="name" label="子指标名称" min-width="192">
                    <template #default="{ row }">
                      <div
                        class="indicator-name-cell"
                        @dblclick="handleIndicatorDblClick(row, 'name')"
                      >
                        <el-input
                          v-if="editingIndicatorId === row.id && editingIndicatorField === 'name'"
                          v-model="editingIndicatorValue"
                          v-focus
                          type="textarea"
                          :autosize="{ minRows: 2, maxRows: 6 }"
                          @blur="saveIndicatorEdit(row, 'name')"
                          @keyup.esc="cancelIndicatorEdit"
                        />
                        <span
                          v-else-if="isSavingIndicatorCell(row, 'name')"
                          class="cell-saving-text"
                        >
                          保存中...
                        </span>
                        <template v-else>
                          <template v-if="row.name">
                            <el-tooltip
                              :content="
                                row.type1 === '定性'
                                  ? '定性指标'
                                  : row.type1 === '定量'
                                    ? '定量指标'
                                    : '未设置类型'
                              "
                              placement="top"
                            >
                              <FullTextPanel :text="row.name">
                                <span class="indicator-name-text">{{
                                  truncateText(row.name, 50)
                                }}</span>
                              </FullTextPanel>
                            </el-tooltip>
                          </template>
                          <span v-else class="placeholder-text">未命名指标</span>
                        </template>
                        <!-- 异动历史徽章（有变更时显示，悬停看历史） -->
                        <div v-if="row.id" class="indicator-cell-footer">
                          <MutationBadgePopover :indicator-id="row.id" />
                          <!-- 上报历史小标（每次上报更新，不走异动链，悬停看历次上报+资料） -->
                        </div>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column prop="weight" label="权重" width="80" align="center">
                    <template #default="{ row }">
                      <div class="weight-cell" @dblclick="handleIndicatorDblClick(row, 'weight')">
                        <el-input
                          v-if="editingIndicatorId === row.id && editingIndicatorField === 'weight'"
                          v-model="editingIndicatorValue"
                          v-focus
                          size="small"
                          style="width: 50px"
                          @blur="saveIndicatorEdit(row, 'weight')"
                          @keyup.enter="saveIndicatorEdit(row, 'weight')"
                        />
                        <span
                          v-else-if="isSavingIndicatorCell(row, 'weight')"
                          class="cell-saving-text"
                        >
                          保存中...
                        </span>
                        <span v-else class="weight-text">{{ row.weight }}</span>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column label="自评等级" width="110" align="center">
                    <template #default="{ row }">
                      <el-tag v-if="row.selfRating" size="small" type="info">
                        {{
                          { AHEAD: '超前完成', NORMAL: '正常', DELAYED: '延期' }[row.selfRating] ||
                          row.selfRating
                        }}
                      </el-tag>
                      <span v-else>—</span>
                    </template>
                  </el-table-column>
                  <el-table-column label="鉴定进度等级" width="126" align="center">
                    <template #default="{ row }">
                      <el-tag :type="getManualAlertTagType(row.manualAlertSeverity)" size="small">
                        {{ getManualAlertLabel(row.manualAlertSeverity) }}
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column label="上报资料" width="96">
                    <template #default="{ row }">
                      <!-- 只展示当前最新一次上报提交的资料；历次经右下角上报小标查看 -->
                      <ReportMaterialsCell :indicator-id="row.id" />
                    </template>
                  </el-table-column>
                  <el-table-column label="上报状态" width="100" align="center">
                    <template #default="{ row }">
                      <!-- 取最新一次非草稿上报的真实审批状态（hasCurrentMonthFill 是"能否继续填报"字段，不反映上报历史） -->
                      <ReportStatusCell :indicator-id="row.id" />
                    </template>
                  </el-table-column>
                  <el-table-column label="进度说明" min-width="116">
                    <template #default="{ row }">
                      <el-tooltip
                        :content="row.pendingRemark || ''"
                        :disabled="(row.pendingRemark || '').length <= 50"
                        placement="top"
                      >
                        <span>{{
                          row.pendingRemark ? truncateText(row.pendingRemark, 50) : '—'
                        }}</span>
                      </el-tooltip>
                    </template>
                  </el-table-column>
                  <el-table-column prop="remark" label="下发备注" width="106">
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
                          @keyup.esc="cancelIndicatorEdit"
                        />
                        <span
                          v-else-if="isSavingIndicatorCell(row, 'remark')"
                          class="cell-saving-text"
                        >
                          保存中...
                        </span>
                        <el-tooltip
                          v-else
                          :content="row.remark || ''"
                          :disabled="(row.remark || '').length <= 50"
                          placement="top"
                        >
                          <span class="indicator-name-text remark-text-wrap">{{
                            row.remark ? truncateText(row.remark, 50) : '—'
                          }}</span>
                        </el-tooltip>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column label="操作" width="120" align="center" fixed="right">
                    <template #default="{ row }">
                      <el-button link type="primary" size="small" @click="handleViewDetail(row)">
                        详情
                      </el-button>
                      <!-- 2026-10-23 用户定案：学院看板也能删，但只能删子指标——
                           核心指标归属「战略部→职能部门」链路，不在此处删除 -->
                      <el-button
                        v-if="canDeleteCollegeIndicator(row)"
                        link
                        type="danger"
                        size="small"
                        @click="handleDeleteIndicator(row)"
                        >删除</el-button
                      >
                    </template>
                  </el-table-column>
                </el-table>
              </div>
              <div class="excel-status-bar">
                <div class="status-left">共 {{ collegeTableIndicators.length }} 条记录</div>
              </div>

              <!-- 2026-10-23：学院 tab 的新增子指标表单（与职能部门面板同构，仅保留子指标字段）。
                   此前表单只挂在职能部门面板内，学院 tab 点「新增行」时用户看不到表单。 -->
              <div
                v-if="isAddingOrEditing && activeTaskTabName === 'college'"
                ref="addRowFormRef"
                class="add-row-form"
              >
                <h3 class="form-title">新增子指标（挂到核心指标下）</h3>
                <div class="add-form-content">
                  <el-form label-width="80px">
                    <el-row :gutter="16">
                      <el-col :span="24">
                        <el-form-item class="required-form-item">
                          <template #label
                            ><span class="required-asterisk">*</span>关联指标</template
                          >
                          <el-select
                            v-model="newRow.parentIndicatorId"
                            filterable
                            placeholder="选择要挂靠的核心指标"
                            style="width: 100%"
                            :teleported="false"
                          >
                            <el-option
                              v-for="opt in collegeParentIndicatorOptions"
                              :key="opt.id"
                              :label="opt.name"
                              :value="opt.id"
                            >
                              <span>{{ opt.name }}</span>
                              <span class="parent-indicator-option__task">{{
                                opt.taskContent
                              }}</span>
                            </el-option>
                          </el-select>
                          <div v-if="collegeParentIndicatorOptions.length === 0" class="form-hint">
                            当前职能部门尚未向「{{ selectedCollege }}」下发核心指标，无法新增子指标
                          </div>
                        </el-form-item>
                      </el-col>
                    </el-row>
                    <el-row :gutter="16">
                      <el-col :span="4">
                        <el-form-item class="required-form-item">
                          <template #label
                            ><span class="required-asterisk">*</span>指标类型</template
                          >
                          <el-select v-model="newRow.type1" style="width: 100%">
                            <el-option label="定性" value="定性" />
                            <el-option label="定量" value="定量" />
                          </el-select>
                        </el-form-item>
                      </el-col>
                      <el-col :span="4">
                        <el-form-item class="required-form-item">
                          <template #label><span class="required-asterisk">*</span>权重</template>
                          <el-input-number
                            v-model="newRow.weight"
                            :min="0"
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
                          <template #label
                            ><span class="required-asterisk">*</span>子指标内容</template
                          >
                          <el-input
                            v-model="newRow.name"
                            type="textarea"
                            :autosize="{ minRows: 2, maxRows: 10 }"
                            placeholder="设置子指标内容"
                          />
                        </el-form-item>
                      </el-col>
                    </el-row>
                    <el-row :gutter="16">
                      <el-col :span="24">
                        <el-form-item label="下发备注">
                          <el-input
                            v-model="newRow.remark"
                            type="textarea"
                            :autosize="{ minRows: 3, maxRows: 15 }"
                            placeholder="输入指标备注"
                          />
                        </el-form-item>
                      </el-col>
                    </el-row>
                  </el-form>
                </div>
                <div class="add-form-actions">
                  <el-button type="primary" @click="saveNewRow">保存</el-button>
                  <el-button @click="cancelAdd">取消</el-button>
                </div>
              </div>
            </template>
          </div>
        </el-tab-pane>
      </el-tabs>

      <!-- Excel状态栏 -->
      <div class="excel-status-bar">
        <div class="status-left">
          {{ isInitialDataLoading ? '正在加载数据...' : `共 ${indicators.length} 条记录` }}
        </div>
        <div class="status-right">
          {{ isInitialDataLoading ? '最后编辑: --' : `最后编辑: ${lastEditTime}` }}
        </div>
      </div>
    </section>

    <!-- 任务下发对话框 -->
    <el-dialog
      v-model="showAssignmentDialog"
      title="任务下发"
      width="600px"
      :before-close="
        () => {
          showAssignmentDialog = false
          assignmentTarget = ''
          assignmentMethod = 'self'
        }
      "
    >
      <div class="assignment-dialog">
        <div class="selected-indicators">
          <h4>选中的指标 ({{ selectedIndicators.length }}项)</h4>
          <ul>
            <li v-for="indicator in selectedIndicators" :key="indicator.id">
              {{ indicator.name }}
            </li>
          </ul>
        </div>

        <el-form :model="{ assignmentMethod, assignmentTarget }" label-width="120px">
          <el-form-item :label="props.selectedRole === '战略发展部' ? '下发方式' : '下发方式'">
            <el-radio-group v-model="assignmentMethod">
              <el-radio v-if="props.selectedRole === '战略发展部'" value="self"
                >职能部门完成</el-radio
              >
              <el-radio v-if="props.selectedRole === '战略发展部'" value="college">
                分解到职能部门
              </el-radio>
              <el-radio
                v-else-if="props.selectedRole === '教务处' || props.selectedRole === '科研处'"
                value="self"
              >
                自己完成
              </el-radio>
              <el-radio
                v-if="props.selectedRole === '教务处' || props.selectedRole === '科研处'"
                value="college"
              >
                下发给学院
              </el-radio>
            </el-radio-group>
          </el-form-item>

          <el-form-item v-if="assignmentMethod === 'college'" label="目标部门">
            <el-select v-model="assignmentTarget" placeholder="选择学院" style="width: 100%">
              <el-option label="计算机学院" value="计算机学院" />
              <el-option label="艺术与科技学院" value="艺术与科技学院" />
            </el-select>
          </el-form-item>
        </el-form>
      </div>

      <template #footer>
        <el-button @click="handleCancelAssignment"> 取消 </el-button>
        <el-button
          type="primary"
          :disabled="assignmentMethod === 'college' && !assignmentTarget"
          @click="confirmAssignment"
        >
          确认下发
        </el-button>
      </template>
    </el-dialog>

    <!-- 指标详情抽屉 -->
    <el-drawer v-model="detailDrawerVisible" title="指标详情" size="45%">
      <div v-if="currentDetail" class="detail-container">
        <!-- 基础信息 -->
        <div class="detail-header">
          <h3>{{ currentDetail.name }}</h3>
          <div class="detail-tags">
            <el-tag
              size="small"
              :class="currentDetail.type1 === '定性' ? 'tag-qualitative' : 'tag-quantitative'"
              >{{ currentDetail.type1 }}</el-tag
            >
            <el-tag
              size="small"
              :style="{
                backgroundColor: getCategoryColor(currentDetail.type2),
                color: '#fff',
                border: 'none'
              }"
            >
              {{ getCategoryText(currentDetail.type2) }}任务
            </el-tag>
          </div>
        </div>

        <el-descriptions :column="2" border class="detail-desc">
          <el-descriptions-item label="战略任务" :span="2">{{
            currentDetail.taskContent
          }}</el-descriptions-item>
          <el-descriptions-item label="任务类别"
            >{{ getCategoryText(currentDetail.type2) }}任务</el-descriptions-item
          >
          <el-descriptions-item label="指标类型">{{ currentDetail.type1 }}</el-descriptions-item>
          <el-descriptions-item label="权重">{{ currentDetail.weight }}</el-descriptions-item>
          <!-- 2026-10-24 用户定案：自评等级与鉴定等级并列展示（前者填报告知，后者上级鉴定） -->
          <el-descriptions-item label="自评等级">
            <el-tag v-if="(currentDetail as any).selfRating" size="small" type="info">
              {{
                { AHEAD: '超前完成', NORMAL: '正常', DELAYED: '延期' }[
                  String((currentDetail as any).selfRating).toUpperCase()
                ] || (currentDetail as any).selfRating
              }}
            </el-tag>
            <span v-else style="color: #909399">—</span>
          </el-descriptions-item>
          <el-descriptions-item label="鉴定进度等级">
            <el-tag :type="getManualAlertTagType(currentDetail.manualAlertSeverity)" size="small">
              {{ getManualAlertLabel(currentDetail.manualAlertSeverity) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="责任部门">{{
            currentDetail.responsibleDept
          }}</el-descriptions-item>
          <el-descriptions-item label="责任人">{{
            currentDetail.responsiblePerson
          }}</el-descriptions-item>
          <el-descriptions-item label="创建时间" :span="2">{{
            formatDetailDate(currentDetail.createTime)
          }}</el-descriptions-item>
          <el-descriptions-item label="进度说明" :span="2">{{
            latestFillNote || '—'
          }}</el-descriptions-item>
          <el-descriptions-item label="上报资料" :span="2">
            <span v-if="!latestFillAttachments.length" style="color: #909399">—</span>
            <span v-else>{{ latestFillAttachments.map(a => a.fileName).join('、') }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="下发备注" :span="2">{{
            currentDetail.remark
          }}</el-descriptions-item>
        </el-descriptions>

        <!-- 上报记录：固定展开展示，不做折叠交互（2026-10-07 用户拍板） -->
        <div class="report-history-section">
          <div class="report-history-title">上报记录（历次填报 / 含被驳回）</div>
          <!-- 2026-10-24 用户定案：点某张上报卡看该轮完整详情——弹窗内聚在
               IndicatorFillHistory 组件内，三个复用页面共同生效 -->
          <IndicatorFillHistory v-if="currentDetailId" :indicator-id="currentDetailId" />
        </div>
      </div>
    </el-drawer>

    <!-- 下发弹窗（支持单个和整体下发） -->
    <el-dialog
      v-model="distributeDialogVisible"
      :title="currentDistributeGroup ? '整体下发' : '指标下发'"
      width="500px"
      :close-on-click-modal="false"
    >
      <div class="distribute-dialog">
        <!-- 单个指标下发 -->
        <div v-if="currentDistributeItem" class="indicator-info">
          <p><strong>指标名称：</strong>{{ currentDistributeItem.name }}</p>
          <p><strong>任务类别：</strong>{{ getCategoryText(currentDistributeItem.type2) }}任务</p>
          <p><strong>权重：</strong>{{ currentDistributeItem.weight }}</p>
        </div>
        <!-- 整体下发 -->
        <div v-else-if="currentDistributeGroup" class="indicator-info">
          <p><strong>任务名称：</strong>{{ currentDistributeGroup.taskContent }}</p>
          <p>
            <strong>待下发指标数：</strong
            >{{ currentDistributeGroup.rows.filter(r => r.canWithdraw).length }} 个
          </p>
          <div class="indicator-list">
            <p><strong>包含指标：</strong></p>
            <ul>
              <li
                v-for="row in currentDistributeGroup.rows.filter(r => r.canWithdraw)"
                :key="row.id"
              >
                {{ row.name }}
              </li>
            </ul>
          </div>
        </div>
        <el-form label-width="100px" style="margin-top: 20px">
          <el-form-item label="下发目标">
            <el-select
              v-model="distributeTarget"
              multiple
              placeholder="选择下发目标部门（可多选）"
              style="width: 100%"
            >
              <el-option
                v-for="dept in functionalDepartments"
                :key="dept"
                :label="dept"
                :value="dept"
              />
            </el-select>
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <el-button @click="closeDistributeDialog">取消</el-button>
        <el-button type="primary" @click="confirmDistribute">确认下发</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="strategicBatchExportDialogVisible"
      title="选择导出部门"
      width="520px"
      :close-on-click-modal="!strategicExporting"
    >
      <div class="export-dialog-body">
        <el-checkbox
          v-model="allStrategicExportDepartmentsSelected"
          :indeterminate="strategicExportDepartmentsIndeterminate"
        >
          全选部门
        </el-checkbox>
        <el-checkbox-group
          v-model="selectedStrategicExportDepartments"
          class="export-selection-list"
        >
          <el-checkbox v-for="dept in functionalDepartments" :key="dept" :value="dept">
            {{ dept }}
          </el-checkbox>
        </el-checkbox-group>
      </div>
      <template #footer>
        <el-button
          :disabled="strategicExporting"
          @click="strategicBatchExportDialogVisible = false"
        >
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="strategicExporting"
          @click="handleExportSelectedStrategicDepartments"
        >
          导出
        </el-button>
      </template>
    </el-dialog>

    <BusinessImportDialog
      v-model:visible="strategicImportDialogVisible"
      type="strategic-task"
      :target-org-id="currentStrategicImportOrgId"
      :target-org-name="selectedDepartment"
      :cycle-id="currentStrategicImportCycleId"
      :sequence-entries="strategicSequenceEntries"
      @committed="handleStrategicImportCommitted"
    />

    <el-dialog
      v-model="approvalSetupDialogVisible"
      title="确认审批流程"
      width="640px"
      :close-on-click-modal="false"
      @close="handleCloseApprovalSetupDialog"
    >
      <div v-loading="approvalPreviewLoading" class="approval-setup-dialog">
        <div v-if="currentPlan" class="approval-setup-summary">
          <div class="summary-row">
            <span class="summary-label">当前计划：</span>
            <span class="summary-value">{{
              currentPlan.name || currentPlan.taskName || selectedDepartment || '当前计划'
            }}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">审批流程：</span>
            <span class="summary-value">
              {{ approvalWorkflowPreview?.workflowName || PLAN_APPROVAL_SUBMIT_WORKFLOW_CODE }}
            </span>
          </div>
        </div>

        <div v-if="hasApprovalPreview" class="approval-step-list">
          <div
            v-for="step in approvalWorkflowPreview?.steps || []"
            :key="step.stepDefId"
            class="approval-step-card"
          >
            <div class="approval-step-header">
              <div class="approval-step-order">步骤 {{ step.stepOrder }}</div>
              <div class="approval-step-name">{{ step.stepName }}</div>
            </div>
            <div class="approval-step-users">
              <span class="approval-step-users-label">可审批用户：</span>
              <div
                v-if="hasApprovalStepCandidates(step.candidateApprovers)"
                class="approval-step-user-list"
              >
                <div
                  v-for="candidate in step.candidateApprovers"
                  :key="candidate.userId"
                  class="approval-step-user-item"
                >
                  <AppAvatar
                    :size="32"
                    :name="normalizePreviewCandidateDisplayName(candidate)"
                    class="approval-step-user-avatar"
                  />
                  <span class="approval-step-user-name">
                    {{ normalizePreviewCandidateDisplayName(candidate) }}
                  </span>
                </div>
              </div>
              <span v-else class="approval-step-users-value">系统自动分配</span>
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
              placeholder="请输入提交说明；如果留空，会生成默认提交文案并落库。"
            />
          </el-form-item>
        </el-form>

        <el-empty
          v-if="!approvalPreviewLoading && !hasApprovalPreview"
          description="暂未加载到审批流程定义"
          :image-size="88"
        />
      </div>

      <template #footer>
        <el-button @click="handleCloseApprovalSetupDialog">取消</el-button>
        <el-button
          type="primary"
          :loading="approvalSubmitting"
          :disabled="approvalPreviewLoading || !hasApprovalPreview || departmentTotalWeight !== 100"
          @click="confirmPlanApprovalSubmission"
        >
          确认发起审批
        </el-button>
      </template>
    </el-dialog>

    <!-- 任务审批抽屉 -->
    <DistributionApprovalProgressDrawer
      v-model="taskApprovalVisible"
      :indicators="approvalIndicators"
      :plan="currentPlan"
      :initial-plan-workflow-detail="preloadedPlanWorkflowDetail"
      :department-name="selectedDepartment"
      :plan-name="currentPlan?.taskName || currentPlan?.name || selectedDepartment"
      :show-plan-approvals="true"
      :show-approval-section="true"
      :workflow-code="PLAN_APPROVAL_HISTORY_WORKFLOW_CODES"
      :workflow-entity-type="primaryApprovalWorkflowEntityType"
      :workflow-entity-id="primaryApprovalWorkflowEntityId"
      :secondary-workflow-entity-type="secondaryApprovalWorkflowEntityType"
      :secondary-workflow-entity-id="secondaryApprovalWorkflowEntityId"
      :mutation-workflow-entities="departmentMutationWorkflowEntities"
      :mutation-pending-approvals="departmentMutationPendingApprovals"
      approval-type="submission"
      @close="taskApprovalVisible = false"
      @refresh="handleApprovalRefresh"
    />
  </div>
</template>

<style scoped src="./StrategicTaskView.css"></style>

<style scoped>
/* 计划未正式下发时锁定鉴定等级 */
.manual-alert-select-wrapper--locked {
  cursor: not-allowed;
}

/* 2026-10-24：单次上报详情弹窗（从上报记录卡点开） */
.fill-detail {
  padding: 4px 2px;
}

.fill-attachment-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fill-attachment-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.fill-attachment-name {
  color: #374151;
  font-size: 13px;
  word-break: break-all;
}
</style>
