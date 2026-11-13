<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { TASK_TABLE_COLUMN_WIDTH } from '@/features/task/lib/tableColumns'
import {
  COLLEGE_DEPT_INELIGIBLE_WARNING,
  resolveCollegeDeptFilterSelection
} from '@/features/task/lib/collegeDispatchEligibility'
import { useLatestIndicatorFill } from '@/features/indicator/model/useLatestIndicatorFill'
import { useIndicatorAppraisal } from '@/features/indicator/model/useIndicatorAppraisal'
import { getAppraisalLevelDisplay } from '@/features/indicator/lib/appraisalGate'
// 2026-11-12 防漂移：导出列头与导入模板共用同一权重文案（后端按表头全等匹配，改文案需同步后端别名表）
import { WEIGHT_COLUMN_HEADER } from '@/features/import/lib/importTemplate'
import TaskIndicatorTree from './TaskIndicatorTree.vue'
import IndicatorFillHistory from '@/features/plan/ui/IndicatorFillHistory.vue'
import MutationBadgePopover from '@/features/indicator/ui/MutationBadgePopover.vue'
import {
  MUTATION_FIELDS_INDICATOR_NAME,
  MUTATION_FIELDS_TASK_NAME,
  MUTATION_FIELDS_WEIGHT
} from '@/features/indicator/model/mutationHistory'
import ReportMaterialsCell from '@/features/indicator/ui/ReportMaterialsCell.vue'
import {
  Plus,
  View,
  Download,
  Delete,
  ArrowDown,
  ArrowLeftBold,
  // 2026-11-09（用户拍板：两步显式选择）：第二级空态引导图标（指向上方部门下拉）
  ArrowUpBold,
  Check,
  Loading,
  Upload,
  // 2026-11-08（单层下发）：学院页签「发起下发审批」按钮图标
  Promotion,
  // 2026-11-11（学院页签按钮体系修正）：撤回类动作图标（撤回/撤回异动共用撤回语义）
  RefreshLeft
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { logger } from '@/shared/lib/utils/logger'
import AppAvatar from '@/shared/ui/avatar/AppAvatar.vue'
import ReportCycleTag from '@/shared/ui/display/ReportCycleTag.vue'
import { DistributionApprovalProgressDrawer } from '@/features/approval'
import {
  buildPlanReferenceLabel,
  resolvePlanConfirmWorkflowName
} from '@/features/approval/lib/approval-utils'
import BusinessImportDialog from '@/features/import/ui/BusinessImportDialog.vue'
import { resolveIndicatorYear } from '@/shared/lib/utils/indicatorYear'
import { formatLocalDateTag } from '@/shared/lib/utils/localDateTag'
import type { StrategicIndicator } from '@/shared/types'
import type { Cell } from 'write-excel-file/browser'
import {
  buildAttachmentNameCell,
  buildExportFileName,
  buildWholeColumnMergedCell,
  exportRowsToExcel,
  normalizeExportAttachments,
  type ExcelExportColumn,
  type ExcelExportSheet,
  type ExcelRowTone
} from '@/shared/lib/export/excel'
import { buildDistributionExportRowGrouping } from '@/features/indicator/lib/distributionExportGroups'
import { getProgressLevelTagStyle } from '@/shared/lib/constants/progressLevel'
import {
  buildAttachmentRelativeDir,
  collectAttachmentGroups,
  countExportAttachments,
  exportDepartmentsAsZip
} from '@/shared/lib/export/zipExport'
import {
  getAttachmentSummary,
  loadIndicatorAttachmentSummaryMap,
  resolveVisibleAttachments,
  type IndicatorAttachmentSummaryMap
} from '@/features/indicator/model/indicatorAttachmentSummary'
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
import FullTextPanel from '@/shared/ui/display/FullTextPanel.vue'
import type { ImportCommitResponse } from '@/features/import/api/businessImport'
import { planApi } from '@/features/plan/api/planApi'
// 2026-11-11（学院页签按钮体系修正）：按钮分流三要素（文案/类型/动作）与实现共用同一纯函数
import { resolveCollegeTabDistributeAction } from '@/features/task/lib/collegeTabDistribute'

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
  approvalEntryButtonTextWithMutation,
  approvalEntryCanHandle,
  allDepartmentMutationPendingApprovals,
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
  canWriteStrategicTask,
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
  isEntityMutationInFlight,
  // 2026-10-31 用户定案：异动链退回态判定（只认退回活链且不与在审实例重叠），角标浮层分态用
  isEntityMutationReturned,
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
  // 2026-11-09（用户要求）：学院页签右侧「职能部门」下拉筛选器
  collegeDispatchDeptFilter,
  collegeDeptDropdownItems,
  collegeDeptCurrent,
  // 2026-11-09（页签分流）：二级学院页签的「基础性权重合计」（学院口径，分母固定 100）
  collegeBasicWeightTotal,
  collegeFillStatusScope,
  isReportApprovalInFlight,
  isMutationApprovalInFlight,
  // 2026-11-11（学院页签按钮体系修正）：生效计划上下文（学院页签 → FUNC_TO_COLLEGE
  // 子计划）+ 异动在审可撤判定/执行体（「撤回异动」真撤回入口）
  effectivePlanContext,
  canWithdrawMutationInFlight,
  handleWithdrawMutationBatch,
  collegeDepartmentsScoped,
  collegeAddMode,
  collegeParentIndicatorOptions,
  // 2026-11-08（单层下发）：学院页签「导入 / 导出 / 发起下发审批」所需的 model 数据
  isStrategicDeptLogin,
  strategicDeptOrgId,
  strategicDeptName,
  selectedCollegeDispatchPlanId,
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
  departmentMutationWorkflowEntities,
  loadDepartmentMutationWorkflowEntities,
  departmentPlanFamilyWorkflowEntities,
  loadDepartmentPlanFamilyWorkflowEntities,
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
  mutationSubmitBlocked,
  mutationSubmitBlockedReason,
  mutationDraftCount,
  reportMonth,
  submitMutationDraft,
  // 2026-10-31 用户定案（退回填报人节点两按钮常驻）：取消异动按钮恢复常驻，
  // 与「发起异动」并排；仅发起人可见（isReturnedChainRequester 预判，后端二次校验）
  handleCancelMutation,
  isReturnedChainRequester,
  hasReturnedMutationChain,
  returnedMutationChainCount,
  // 2026-10-30（审批中心退回卡）：退回链清单透传给审批抽屉，流程未终结不得在审批中心消失
  returnedMutationChains,
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

// 2026-11-08（单层下发）：学院页签「导入 / 导出 / 发起下发审批」所需的周期与组织入参。
// 单独在这里聚合，避免把「学院页签工具栏」的细节塞进 7000+ 行的 useStrategicTaskView。
const collegeDispatchCycleId = computed(() => {
  const cycle = timeContext.cycles.find(
    item => Number((item as { year?: number | string }).year) === timeContext.currentYear
  ) as { cycleId?: number | string; id?: number | string } | undefined
  const numericCycleId = Number(cycle?.cycleId ?? cycle?.id)
  return Number.isFinite(numericCycleId) && numericCycleId > 0 ? numericCycleId : null
})

const collegeDispatchCollegeOrgId = computed(() =>
  selectedCollege.value ? resolveDepartmentIdByName(selectedCollege.value) : null
)

/**
 * 学院下发操作区何时置灰。
 *
 * 口径：只有「未选学院 / 周期不可用」这两种前置条件不足才置灰，
 * 业务性拒绝（无核心指标、无计划）交给点击时的 toast 与后端校验 ——
 * 一律置灰会让用户看不出「到底缺什么」。
 */
const collegeDispatchDisabledReason = computed(() => {
  if (!isStrategicDeptLogin.value) {
    return '学院指标下发由战略发展部操作'
  }
  if (!selectedCollege.value) {
    return '请先在左侧选择学院'
  }
  if (!collegeDispatchCycleId.value) {
    return '当前周期信息不可用，暂不能下发'
  }
  return ''
})

/**
 * 2026-11-08（单层下发）：二级学院页签「导入」弹窗的父级锚点。
 *
 * 新口径下学院指标由战略部直接下发、没有父级核心指标，故固定传空数组。
 * 用模块级常量而不是模板里写字面量 []，避免每次渲染产生新引用触发子组件重算。
 */
const COLLEGE_IMPORT_PARENT_INDICATORS: Array<{
  name?: string
  taskContent?: string
  type1?: string
  type2?: string
}> = []

// 2026-10-31 用户拍板（「确认审批流程」弹窗去计划编号）：
// ①「当前计划」行不读 currentPlan.name / taskName —— 后端占位名是「Plan 4036」式，
//   以「{年份}年度 计划（{source} -> {target}）」口径指代（approval-utils 同款），
//   年份用视图统一的 resolvePlanYear，目标缺省落到选中部门，最终兜底「当前计划」。
// ②「审批流程」行按 flowCode 映射中文流程名，绝不透出英文 workflowName。
const approvalSetupPlanReference = computed(() => {
  const plan = currentPlan.value as Record<string, unknown> | null
  if (!plan) {
    return ''
  }
  return buildPlanReferenceLabel({
    year: resolvePlanYear(plan),
    sourceOrgName: plan.createdByOrgName,
    targetOrgName: plan.targetOrgName || selectedDepartment.value,
    fallback: selectedDepartment.value || '当前计划'
  })
})
const approvalSetupWorkflowName = computed(() =>
  resolvePlanConfirmWorkflowName(PLAN_APPROVAL_SUBMIT_WORKFLOW_CODE)
)

const { latestFillNote, latestFillAttachments } = useLatestIndicatorFill(
  computed(() => (currentDetail as any)?.value?.id ?? null),
  // 实时值：按 id 从当前行数组取**最新**行对象（行对象异步加载后会被替换，
  // 打开抽屉那一刻的旧引用里的 pendingRemark 是空值）
  (id: string | number) => indicators.value.find(item => String(item.id) === String(id)) as any
)

// 2026-10-28：审批链行内鉴定——只有当前审批节点负责人可改（后端 canAppraise 判定）
// 2026-10-31 定稿：点击格子先单条重查 context，canAppraise=true 才弹轻量等级选择器
const {
  load: loadIndicatorAppraisalContexts,
  getLevel: getIndicatorAppraisalLevel,
  openAppraisalGate: openIndicatorAppraisalGate
} = useIndicatorAppraisal()

watch(
  () => (normalizedIndicators?.value ?? []).map(item => String(item.id)).join(','),
  () => {
    void loadIndicatorAppraisalContexts((normalizedIndicators?.value ?? []).map(item => item.id))
  },
  { immediate: true }
)

const activeTaskTabName = ref<'functional' | 'college'>('functional')

/**
 * 2026-11-09（页签分流）：页头「基础性权重合计」按页签分流。
 *
 * <p>职能部门页签沿用部门口径（departmentTotalWeight：该部门下基础性任务权重合计）；
 * 二级学院页签改用学院口径（collegeBasicWeightTotal：所选学院在当前计划下全部基础性
 * 指标的权重合计，分母固定 100）。文案与样式类名保持不变，只换计算来源。</p>
 *
 * <p>两处口径都做了空值兜底：页面 shell 单测用的 view-model mock 不提供这两个字段，
 * 直接取 .value 会抛错并让整个页面渲染失败（模板里直接比较 undefined 不会报错，
 * 挪进 computed 后才会）。</p>
 */
const headerBasicWeightTotal = computed(() =>
  activeTaskTabName.value === 'college'
    ? (collegeBasicWeightTotal?.value ?? 0)
    : (departmentTotalWeight?.value ?? 0)
)

/**
 * 2026-11-08（单层下发）：二级学院页签「下发/撤回」按钮的置灰口径。
 *
 * <p>职能部门登录：按钮置灰并说明「只审批学院上报，不再下发」—— 新口径下学院指标的
 * 下发方只有战略发展部，职能部门保留的只是学院上报的审批权，若仍可点会误导成
 * 「还能下发」。</p>
 * <p>战略部登录：沿用 collegeDispatchDisabledReason（未选学院 / 周期不可用时置灰）；
 * 计划缺失属于业务性拒绝，交给点击时的 toast（与上一版组件口径一致）。</p>
 */
const collegeTabDistributeDisabledReason = computed(() => {
  if (!isStrategicDeptLogin.value) {
    return '职能部门只审批学院上报，不再下发'
  }
  // 2026-11-08（审查 blocking 修复）：必须先并入既有只读守卫。
  // 原实现只判断「未选学院 / 周期不可用」，但历史快照年份（isReadOnly=true）同样能取到
  // cycleId 与匹配到计划 → 历史只读年份仍能发起下发审批，等于绕过只读。
  if (isReadOnly.value) {
    return '历史快照为只读状态'
  }
  if (!canWriteStrategicTask.value) {
    return '当前角色仅可查看，不能发起下发审批'
  }
  // 2026-11-09（用户拍板：两步显式选择）：先沿用既有前置守卫（含「请先在左侧选择学院」），
  // 学院已选但未显式选择职能部门时给出第二步引导 —— 不再自动兜底第一个部门。
  const preconditionReason = collegeDispatchDisabledReason.value
  if (preconditionReason) {
    return preconditionReason
  }
  if (!collegeDispatchDeptFilter?.value) {
    return '请先选择职能部门'
  }
  return ''
})

/**
 * 2026-11-09（用户拍板：两步显式选择）：学院页签「选学院 + 选职能部门」两选是否已齐。
 *
 * <p>职能部门页签恒为 true —— 本口径只作用于学院页签，职能部门页签行为零变化。
 * 两选未齐时：中央内容区显示引导空态、工具栏「新增行 / 发起审批 / 导入 / 导出 /
 * 全部导出」置灰、顶部「审批状况 / 基础性权重合计 / 计划状态」状态签隐藏。</p>
 */
const collegeTabTwoStepReady = computed(() => {
  if (activeTaskTabName.value !== 'college') {
    return true
  }
  const dept = String(collegeDispatchDeptFilter?.value ?? '').trim()
  return Boolean(selectedCollege?.value) && dept !== ''
})

/** 两选未齐时工具栏按钮 tooltip 的引导文案：缺哪一步提示哪一步。 */
const collegeTabTwoStepGuideTip = computed(() => {
  if (!selectedCollege?.value) {
    return '请先在左侧选择学院'
  }
  return '请先选择职能部门'
})

/**
 * 2026-11-11（学院页签按钮体系修正）：学院子计划的原始状态（按钮相位数据源）。
 *
 * <p>只认「学院计划上下文」（effectivePlanContext.source === 'college'）解析出的
 * FUNC_TO_COLLEGE 子计划 —— 此前按钮文案/图标复用职能页签的 distributeButton*，
 * 那套读的是职能部门自身计划（planUiPhase → currentPlan），学院下发审批中时
 * 恒显示发起类文案（高②）。取不到上下文（页签 mock / 未激活）返回 null，
 * 分流函数按「发起审批」处理（与两选引导态行为一致）。</p>
 */
const collegeTabSubPlanStatus = computed(() => {
  const context = effectivePlanContext?.value as
    | { source?: string; plan?: Record<string, unknown> | null }
    | undefined
  if (!context || context.source !== 'college') {
    return null
  }
  return context.plan?.status
})

/**
 * 2026-11-11（学院页签按钮体系修正）：学院页签「下发/撤回」按钮的三要素 + 动作。
 *
 * <p>分流纯函数 resolveCollegeTabDistributeAction 与单测共用（实现即口径）：</p>
 * <ul>
 *   <li>异动在审且当前用户可撤 → 「撤回异动」（warning，真撤回入口）——
 *       高①：此前文案显示「撤回异动」、点击却弹「发起下发审批」确认框；</li>
 *   <li>学院下发审批中（PENDING/IN_REVIEW）→ 「撤回」（warning，真撤回）——
 *       高②：此前恒显示发起类文案，学院下发的真撤回在 UI 不可达；</li>
 *   <li>已下发 → 「撤回」（info，无可撤动作，点击引导查看审批）；</li>
 *   <li>草稿/未解析 → 「发起审批」（success，既有发起流程）。</li>
 * </ul>
 * <p>文案/类型/动作同源判定，杜绝「文案一套、点击另一套」。图标在组件侧按动作映射
 * （发起 = Promotion 飞行、其余 = RefreshLeft 撤回），与职能页签图标口径一致。</p>
 */
const collegeTabDistributeButton = computed(() => {
  const decision = resolveCollegeTabDistributeAction({
    canWithdrawMutationInFlight: canWithdrawMutationInFlight?.value === true,
    collegePlanStatus: collegeTabSubPlanStatus.value
  })
  return {
    ...decision,
    icon: decision.action === 'submit-dispatch' ? Promotion : RefreshLeft
  }
})

/**
 * 2026-11-08（单层下发）：工具栏「下发/撤回」按钮的点击分流。
 *
 * <p>职能部门页签 → 原样交给 model 的 handleDistributeOrWithdraw（行为零变化）；
 * 二级学院页签 → 战略部在此**发起下发审批**，计划取 selectedCollegeDispatchPlanId
 * （与学院上报作用域同源），流程码固定 PLAN_DISPATCH_COLLEGE——2026-11-10 起学院下发
 * （FUNC_TO_COLLEGE，created_by=战略发展部）改用专用审批流程「Plan下发审批（二级学院）」，
 * 后端提交校验只认新码。</p>
 * <p>注意：本函数体只在点击时求值，因此引用下方声明的 model 函数不会有 TDZ 风险。</p>
 */
// 2026-11-08（审查 blocking 修复）：提交防重。
// 发起下发审批会推进计划状态并生成待办，提交后到数据刷新完成之间若允许再点，
// 会二次提交同一计划（上一版 CollegeDispatchActions 有 submitting 标记，迁移时漏了）。
const collegeDispatchSubmitting = ref(false)

/**
 * 2026-11-11（高②修复）：学院下发审批的真「撤回」。
 *
 * <p>此前学院下发计划审批中（IN_REVIEW）时按钮恒显示发起类文案，真撤回在 UI 不可达
 * （职能部门 /distribution 页的撤回也不覆盖学院下发）。现按钮分流已按子计划相位
 * 暴露「撤回」，此处执行体：确认 → POST /plans/{id}/withdraw（后端校验发起人与
 * 撤回窗口，撤回后计划回草稿、审批实例撤回）→ 强刷回真实状态。</p>
 */
const handleWithdrawCollegeDispatch = async () => {
  const planId = selectedCollegeDispatchPlanId.value
  if (!planId) {
    ElMessage.warning('当前学院还没有可撤回的下发计划')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认撤回对「${selectedCollege.value || '当前学院'}」的下发审批？撤回后计划将恢复为草稿，可调整后重新发起。`,
      '撤回下发审批',
      { type: 'warning', confirmButtonText: '确认撤回', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  collegeDispatchSubmitting.value = true
  try {
    const response = await planApi.withdrawPlan(planId)
    if (response.code === 200) {
      ElMessage.success('已撤回下发审批，计划恢复为草稿')
      await refreshCurrentDepartmentView({ force: true })
    } else {
      ElMessage.error(response.message || '撤回下发审批失败')
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '撤回下发审批失败')
  } finally {
    collegeDispatchSubmitting.value = false
  }
}

const handleDistributeOrWithdrawClick = async () => {
  if (activeTaskTabName.value !== 'college') {
    handleDistributeOrWithdraw()
    return
  }
  if (collegeDispatchSubmitting.value) {
    return
  }
  if (collegeTabDistributeDisabledReason.value) {
    ElMessage.warning(collegeTabDistributeDisabledReason.value)
    return
  }
  // 2026-11-11（学院页签按钮体系修正）：点击分流与按钮文案同源
  // （collegeTabDistributeButton.action）——文案显示什么，点下去就做什么。
  // 高①：异动在审可撤 → 「撤回异动」真撤回（整批退回填报人节点），
  // 此前误走下方「发起下发审批」确认框（同框实锤 C1-20）。
  if (collegeTabDistributeButton.value.action === 'withdraw-mutation') {
    await handleWithdrawMutationBatch()
    return
  }
  // 高②：学院下发审批中 → 真「撤回」（计划回草稿、审批实例撤回）
  if (collegeTabDistributeButton.value.action === 'withdraw-dispatch') {
    await handleWithdrawCollegeDispatch()
    return
  }
  // 已下发相位：无可撤动作（与职能页签「当前状态不可操作」置灰口径一致），
  // 引导去审批中心查看记录，不再弹发起确认。
  if (collegeTabDistributeButton.value.action === 'distributed-locked') {
    ElMessage.info('当前学院计划已下发，可在审批中心查看审批记录')
    return
  }
  const planId = selectedCollegeDispatchPlanId.value
  if (!planId) {
    ElMessage.warning('当前学院还没有可提交审批的下发计划')
    return
  }
  // 发起审批会推进计划状态并生成待办，必须让用户确认一次（文案沿用上一版学院下发操作区）
  try {
    await ElMessageBox.confirm(
      `确认对「${selectedCollege.value || '当前学院'}」发起下发审批？提交后进入：战略发展部负责人 → 分管校领导。`,
      '发起下发审批',
      { type: 'warning', confirmButtonText: '确认发起', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  collegeDispatchSubmitting.value = true
  try {
    const response = await planApi.submitPlanForApproval(planId, {
      // 学院下发专用审批流程（2026-11-10 起后端只认新码；职能部门页签仍走 PLAN_DISPATCH_STRATEGY）
      workflowCode: 'PLAN_DISPATCH_COLLEGE'
    })
    if (response.code === 200) {
      ElMessage.success('已发起下发审批')
      await refreshCurrentDepartmentView({ force: true })
    } else {
      ElMessage.error(response.message || '发起下发审批失败')
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '发起下发审批失败')
  } finally {
    collegeDispatchSubmitting.value = false
  }
}

/**
 * 2026-10-24 用户定案：卡片视图暂无业务需求，入口从工具栏隐藏（代码保留）。
 * 恢复显示只需把此开关改回 true。
 */
const SHOW_CARD_VIEW_TOGGLE = false

// 2026-10-28 迭代计划 M6：未提交异动草稿的丢失可感知——
// ① 刷新/关窗：beforeunload 原生拦截；② 站内路由离开：确认框二次确认。
const guardActive = computed(() => canEdit.value && mutationDraftCount.value > 0)
const handleBeforeUnload = (event: BeforeUnloadEvent) => {
  if (!guardActive.value) {
    return
  }
  event.preventDefault()
  event.returnValue = ''
}
onMounted(() => window.addEventListener('beforeunload', handleBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', handleBeforeUnload))
onBeforeRouteLeave(async () => {
  if (!guardActive.value) {
    return true
  }
  try {
    await ElMessageBox.confirm(
      `有 ${mutationDraftCount.value} 项修改尚未发起异动，离开页面将丢失。确定离开吗？`,
      '未提交的异动草稿',
      { confirmButtonText: '离开', cancelButtonText: '留下', type: 'warning' }
    )
    return true
  } catch {
    return false
  }
})

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
 * 2026-11-09（用户要求）：学院页签右侧「职能部门」下拉筛选器。
 *
 * <p>2026-11-09（用户拍板：两步显式选择）：空字符串 = 未选择（两步未齐的引导态，
 * 表格置空并提示先选部门）；选了某个部门 = 只看该部门下发给这个学院的指标。</p>
 *
 * <p>2026-11-10（用户拍板）：资格分流 —— 只有存在「已下发」核心指标的部门可选中。
 * 无资格部门**可点击**（不再 disabled 灰锁），点击弹提示
 * 「当前职能部门未有已下发的任务」并 return（不落选）；分流判定与单测共用
 * {@link resolveCollegeDeptFilterSelection} 纯函数。</p>
 */
const handleCollegeDeptFilterChange = (command: string | number | object) => {
  const selection = resolveCollegeDeptFilterSelection(collegeDeptDropdownItems.value, command)
  if (!selection.accepted) {
    ElMessage.warning(COLLEGE_DEPT_INELIGIBLE_WARNING)
    return
  }
  collegeDispatchDeptFilter.value = selection.dept
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
// 否则学院链路的自评进度与进度说明列读不到数据（恒为空）。
watch(activeTaskTabName, tab => {
  // PR#83：告知 model 头部「审批状态」的填报审批态聚合范围——
  // 「上报状态」列只存在于学院页签，聚合也只在该页签进行
  collegeFillStatusScope.value = tab === 'college'
  // 2026-11-09（用户要求）：切页签时把学院页签的部门筛选复位成「全部部门」，
  // 否则从别的页签切回来会带着上次筛的部门，用户看到的是残缺列表却不知道原因。
  if (tab !== 'college') {
    collegeDispatchDeptFilter.value = ''
  }
  if (tab === 'college') {
    if (selectedCollege.value) {
      void syncCurrentPlanReportSummaries({ force: true, collegeScope: true })
    }
    return
  }
  void syncCurrentPlanReportSummaries({ force: true })
})

// 2026-11-09（用户要求）：切换学院时同样复位部门筛选 —— 不同学院可选的部门集合不同，
// 沿用上一个学院的筛选会让新学院的表格直接空掉。
watch(selectedCollege, () => {
  collegeDispatchDeptFilter.value = ''
})

// 2026-10-13 用户定案：二级学院 tab 未选学院时的左侧入口引导（呼吸高亮 + 指向气泡），选中后消失
// 仅当当前职能部门确实有下发学院时才引导（列表为空时引导会指向空列表，反而更困惑）
//
// 2026-11-05（用户反馈）：气泡在**鼠标移到左侧入口区域后立即消失**。
// 气泡的用途是「不知道下一步该点哪里」时指路；用户已经把鼠标移到入口上，说明已经找到了，
// 再让它一直贴在入口旁边就是挡路。呼吸高亮保留（不占位、不挡视线）。
const collegeGuideHoverDismissed = ref(false)
const dismissCollegeGuide = () => {
  collegeGuideHoverDismissed.value = true
}
const showCollegeGuide = computed(
  () =>
    activeTaskTabName.value === 'college' &&
    !selectedCollege.value &&
    !collegeGuideHoverDismissed.value &&
    collegeDepartmentsScoped.value.length > 0
)

// 切换页签时重置，下次进入「二级学院」页签仍会给出一次引导（否则一次悬停就永久失效）
watch(activeTaskTabName, () => {
  collegeGuideHoverDismissed.value = false
})

// 2026-10-18 用户定案：审核进度是上报审批过程中的状态——
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
// 2026-10-26：departmentMutationWorkflowEntities 与 loader 下沉 model 层
// （handleApprovalRefresh 在 model 内引用它，UI 本地定义导致跨作用域悬空）
// 2026-10-26：部门计划族（FUNC_TO_COLLEGE 子计划 + 学院上报）经 relatedWorkflowEntities
// 传入审批中心，使部门卡片审批历史兼容「学院 → 本部门」的上报链
// 部门切换即预载（抽屉打开时数据已就绪，避免晚于历史卡片加载的时序问题）
watch(
  () => selectedDepartment.value,
  () => {
    void loadDepartmentMutationWorkflowEntities()
    void loadDepartmentPlanFamilyWorkflowEntities()
  },
  { immediate: true }
)
// 抽屉每次打开都重新拉一次：审批推进后异动的当前节点与流程详情都会变；
// 部门计划族同样重试（planStore 晚就绪时首次部门 watch 可能空手而归）
watch(
  () => taskApprovalVisible?.value,
  visible => {
    if (visible) {
      void loadDepartmentMutationWorkflowEntities()
      void loadDepartmentPlanFamilyWorkflowEntities()
    }
  }
)
const strategicBatchExportDialogVisible = ref(false)
const selectedStrategicExportDepartments = ref<string[]>([])
const strategicImportDialogVisible = ref(false)
// 2026-10-31 定稿：等级选项收敛到共享 appraisalGate（只有超前完成/正常/延期三档），
// 「未评定」退为初始空白显示态（不是选项），三视图同构。
const getManualAlertLabel = (severity?: ManualAlertSeverity) =>
  getAppraisalLevelDisplay(severity).label

const getManualAlertTagType = (severity?: ManualAlertSeverity) =>
  getAppraisalLevelDisplay(severity).type

/**
 * 2026-10-31 定稿：点击审核进度格子的统一入口（三视图同构）。
 * 先单条重查该行 context → canAppraise=false 当场弹对应原因
 * （优先后端 lockHint）→ 通过才弹轻量等级选择器 → 确认后保存并同步行数据。
 */
const handleAppraisalCellClick = async (row: {
  id: string | number
  name?: string
  manualAlertSeverity?: ManualAlertSeverity
}) => {
  await openIndicatorAppraisalGate(row.id, {
    indicatorName: row.name,
    onSaved: level => {
      strategicStore.patchIndicator(String(row.id), { manualAlertSeverity: level })
    }
  })
}

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
// 2026-10-31 三页统一（用户拍板）：序号升级为任务组号并随任务组竖向合并，
// 部门列整列合并，任务类别列统一为任务类型（列序对齐导入模板）。
type StrategicExportAttachmentSource = StrategicExportRow & {
  pendingAttachments?: unknown
  pendingAttachmentDetails?: unknown[]
}

const resolveStrategicExportAttachmentItems = (row: StrategicExportRow) => {
  const source = row as StrategicExportAttachmentSource
  return normalizeExportAttachments(
    source.pendingAttachmentDetails?.length
      ? source.pendingAttachmentDetails
      : source.pendingAttachments
  )
}

const buildStrategicExportColumns = (
  rows: StrategicExportRow[],
  summaryMap: IndicatorAttachmentSummaryMap | null
): ExcelExportColumn<StrategicExportRow>[] => {
  // 2026-10-31 三页统一（用户拍板）：序号=任务组号（同任务多行共用、按任务出现顺序递增，
  // 消灭「同一任务被编成多个序号」的老问题）；序号/战略任务/任务类型按任务组竖向合并
  // （相邻同任务行合并，与下发页 IndicatorDistributeView 的 rowSpan 分组写法一致）；
  // 分组跨度复用下发页纯函数 buildDistributionExportRowGrouping（键=战略任务名）。
  const { groupNumberByIndex, spanByIndex } = buildDistributionExportRowGrouping(
    rows.map(row => row.taskContent || '-')
  )

  const buildMergedGroupCell = (index: number, value: string | number): Cell => {
    const span = spanByIndex[index] ?? 1
    if (span > 1) {
      return { value, rowSpan: span, alignVertical: 'center' }
    }
    // 被上方合并覆盖的从属行：write-excel-file 要求传 null
    if (span === 0) {
      return null
    }
    return value
  }

  return [
    {
      header: '序号',
      width: 8,
      align: 'center',
      getValue: (_row, index) => buildMergedGroupCell(index, groupNumberByIndex[index])
    },
    // 2026-10-31 用户拍板：部门列整列合并（一份导出锁定一个部门）
    {
      header: '部门',
      width: 18,
      getValue: (row, index) => buildWholeColumnMergedCell(index, rows.length, row.exportDepartment)
    },
    {
      header: '战略任务',
      width: 28,
      getValue: (row, index) => buildMergedGroupCell(index, row.taskContent || '-')
    },
    // 2026-10-31 三页统一：原「任务类别」列（本就是任务级）统一为「任务类型」，
    // 表头与位置对齐导入模板（战略任务之后），随任务组竖向合并
    {
      header: '任务类型',
      width: 12,
      align: 'center',
      getValue: (row, index) => buildMergedGroupCell(index, getCategoryText(row.type2))
    },
    { header: '核心指标', width: 32, getValue: row => row.name || '-' },
    { header: '指标类型', width: 12, align: 'center', getValue: row => row.type1 || '-' },
    // 2026-11-11 用户拍板：权重全局统一纯数字口径，导出与导入模板同口径
    {
      header: WEIGHT_COLUMN_HEADER,
      width: 16,
      align: 'center',
      getValue: row => Number(row.weight || 0)
    },
    // 2026-10-20：阅读列标注「导入忽略」——导入解析器不识别这两列，改了不起作用
    {
      header: '审核进度（导入忽略）',
      width: 20,
      align: 'center',
      getValue: row => getManualAlertLabel(row.manualAlertSeverity)
    },
    // 2026-10-28：附件本体打进 zip 后，Excel 只保留「附件目录（相对路径）」+「文件名」，
    // 避免单元格里塞长 URL；目录名按序号 + 截断指标名生成（见 export/fileName.ts）。
    // 附件来源由后端按当前登录人可见范围返回，页面看不到的填报不会进导出。
    {
      header: '附件目录（包内相对路径）',
      width: 30,
      getValue: (row, index) => {
        const attachments = resolveVisibleAttachments(summaryMap, row.id, () =>
          resolveStrategicExportAttachmentItems(row)
        )
        return attachments.length > 0
          ? buildAttachmentRelativeDir({ seq: index + 1, indicatorName: row.name || '指标' })
          : '-'
      }
    },
    {
      header: '上报资料（导入忽略）',
      width: 42,
      getValue: row =>
        buildAttachmentNameCell(
          resolveVisibleAttachments(summaryMap, row.id, () =>
            resolveStrategicExportAttachmentItems(row)
          )
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

// 2026-10-31 层级化定案：导入不再按序号匹配（序号=任务组号，落库按「任务+核心指标名」匹配），
// 序号→内部ID 映射（strategicSequenceEntries）随之移除。

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
  rows = getStrategicExportRowsByDepartment(department),
  summaryMap: IndicatorAttachmentSummaryMap | null = null
): ExcelExportSheet<StrategicExportRow> => ({
  sheetName: department || '当前部门',
  rows,
  columns: buildStrategicExportColumns(rows, summaryMap),
  emptyMessage: '当前部门暂无可导出的战略任务指标',
  getRowTone: getStrategicExportRowTone,
  getRowTextColor: getStrategicExportRowTextColor
})

const buildStrategicExportAttachmentGroups = (
  rows: StrategicExportRow[],
  summaryMap: IndicatorAttachmentSummaryMap | null
) =>
  collectAttachmentGroups(
    rows.map((row, index) => {
      const summary = getAttachmentSummary(summaryMap, row.id)
      return {
        seq: index + 1,
        indicatorName: row.name || '指标',
        round: summary?.round,
        fillDate: summary?.fillDate,
        attachments: resolveVisibleAttachments(summaryMap, row.id, () =>
          resolveStrategicExportAttachmentItems(row)
        )
      }
    })
  )

/**
 * 2026-11-08（单层下发）：二级学院页签的导出 =「战略发展部 → 当前所选学院」的指标表。
 *
 * <p>数据源直接用页面学院表格同一份 collegeTableIndicators，保证「看到什么就导出什么」。
 * 列按新口径给出：指标名称 / 指标类型 / 任务类型 / 权重 / 状态 —— 单层结构下学院指标
 * 没有父级核心指标，因此不再有「核心指标」列。</p>
 */
const handleExportCollegeIndicators = async () => {
  const college = selectedCollege.value
  if (!college) {
    ElMessage.warning('请先在左侧选择学院')
    return
  }
  // 2026-11-09（用户拍板：两步显式选择）：学院页签「导出 / 全部导出」以双条件为前置
  // （学院 + 职能部门），第二步未选时阻断并提示，与工具栏按钮置灰口径一致。
  if (!collegeDispatchDeptFilter?.value) {
    ElMessage.warning('请先选择职能部门')
    return
  }
  const rows = collegeTableIndicators.value
  if (rows.length === 0) {
    ElMessage.warning('当前部门与该学院范围内暂无可导出的指标')
    return
  }
  strategicExporting.value = true
  try {
    await exportRowsToExcel(
      {
        sheetName: '指标下发与管理',
        rows,
        columns: [
          { header: '指标名称', width: 36, getValue: row => String(row.name || '') },
          {
            header: '指标类型',
            width: 12,
            align: 'center',
            getValue: row => String(row.type1 || '定量')
          },
          {
            header: '任务类型',
            width: 12,
            align: 'center',
            getValue: row => getCategoryText(getIndicatorCategoryLabel(row))
          },
          { header: '权重', width: 10, align: 'center', getValue: row => String(row.weight ?? '') },
          { header: '状态', width: 14, getValue: row => String(row.status || '') }
        ],
        emptyMessage: '当前学院暂无可导出的指标数据'
      },
      buildExportFileName('指标下发与管理', college)
    )
    ElMessage.success('导出成功')
  } catch {
    ElMessage.error('导出失败，请稍后重试')
  } finally {
    strategicExporting.value = false
  }
}

const handleExportCurrentStrategicDepartment = async () => {
  // 2026-11-08（单层下发）：页签分流——学院页签导出的是「战略部 → 当前所选学院」的指标表，
  // 与职能部门页签的「按部门导出战略任务」不是同一份数据，故在此分流而非新增按钮。
  if (activeTaskTabName.value === 'college') {
    await handleExportCollegeIndicators()
    return
  }
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
    // 2026-10-28：附件可见性由后端判定——填报人可见本人草稿，上级只可见上一轮已上报快照
    const summaryMap = await loadIndicatorAttachmentSummaryMap(rows.map(row => row.id))
    const attachmentGroups = buildStrategicExportAttachmentGroups(rows, summaryMap)

    if (attachmentGroups.length === 0) {
      await exportRowsToExcel(
        buildStrategicExportSheet(department, rows, summaryMap),
        buildExportFileName('战略任务指标总表', department)
      )
      ElMessage.success('导出成功')
      return
    }

    // 2026-10-28：单部门有附件时也走 zip——Excel 与附件同包，避免附件只剩超链接
    const dateText = formatLocalDateTag()
    await exportDepartmentsAsZip(
      [
        {
          department,
          sheets: [
            buildStrategicExportSheet(department, rows, summaryMap) as ExcelExportSheet<unknown>
          ],
          attachmentGroups
        }
      ],
      `战略任务指标总表_${department}_${dateText}.zip`,
      { onProgress: text => ElMessage({ message: text, duration: 1200, grouping: true }) }
    )
    ElMessage.success('导出成功：Excel 与附件已一并打包')
  } catch {
    ElMessage.error('导出失败，请稍后重试')
  } finally {
    strategicExporting.value = false
  }
}

const openStrategicBatchExportDialog = () => {
  // 2026-11-09（页签分流）：二级学院页签的「全部导出」导出的是该学院的指标数据，
  // 与工具栏「导出」完全同口径（复用同一个 handleExportCollegeIndicators，数据源同为
  // collegeTableIndicators），不再弹职能部门多选框——学院页签根本没有「职能部门维度」
  // 可选。职能部门页签行为保持原样，一行都不改。
  if (activeTaskTabName.value === 'college') {
    void handleExportCollegeIndicators()
    return
  }
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

    const departmentRows = await Promise.all(
      departments.map(async department => {
        const taskIdSet = await loadStrategicExportTaskIdSetByDepartment(department)
        return {
          department,
          rows: getStrategicExportRowsByDepartment(department, taskIdSet)
        }
      })
    )

    // 2026-10-28：一次批量查询所有部门的可见附件（服务端按当前登录人过滤草稿）
    const summaryMap = await loadIndicatorAttachmentSummaryMap(
      departmentRows.flatMap(item => item.rows.map(row => row.id))
    )

    const payloads = departmentRows.map(({ department, rows }) => ({
      department,
      sheets: [
        buildStrategicExportSheet(department, rows, summaryMap) as ExcelExportSheet<unknown>
      ],
      attachmentGroups: buildStrategicExportAttachmentGroups(rows, summaryMap)
    }))

    const dateText = formatLocalDateTag()
    await exportDepartmentsAsZip(
      payloads,
      `战略任务指标总表_${departments.length === 1 ? departments[0] : '多部门'}_${dateText}.zip`,
      { onProgress: text => ElMessage({ message: text, duration: 1200, grouping: true }) }
    )
    strategicBatchExportDialogVisible.value = false

    const attachmentCount = countExportAttachments(payloads)
    if (attachmentCount > 0) {
      ElMessage.success(
        `导出成功：${departments.length} 个部门各一个 Excel，${attachmentCount} 个附件已一并打包`
      )
    } else if (departments.length === 1) {
      ElMessage.success('导出成功（单部门无附件，已直接输出 xlsx）')
    } else {
      ElMessage.success(`导出成功：${departments.length} 个部门各一个 Excel（无附件）`)
    }
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
  // 2026-11-08（单层下发）：页签分流。
  // 二级学院页签的「导入」= 战略部直接把学院指标下发给当前所选学院（distribution 类型），
  // 不再经过「职能部门核心指标」这一层，因此既不校验职能部门计划，也不要求父级锚点。
  if (activeTaskTabName.value === 'college') {
    if (collegeDispatchDisabledReason.value) {
      ElMessage.warning(collegeDispatchDisabledReason.value)
      return
    }
    if (!collegeDispatchCollegeOrgId.value) {
      ElMessage.warning('请先在左侧选择要下发的学院')
      return
    }
    // 2026-11-09（用户拍板：两步显式选择）：学院已选但未显式选择职能部门时同样阻断。
    // 弹窗内提交链路（BusinessImportDialog）不再二次校验部门选择，且弹窗是模态框、
    // 打开期间部门下拉不可点 —— 所以「打开导入」这一道双条件守卫就是提交的唯一入口闸门。
    if (!collegeDispatchDeptFilter?.value) {
      ElMessage.warning('请先选择职能部门')
      return
    }
    // 2026-11-11（E-1 互斥守卫）：异动审批在审时导入与「新增行」同口径拦截
    // （按钮已置灰，这里兜底键盘/编程式调用），避免在审计划被导入绕过置灰加行。
    if (isMutationApprovalInFlight?.value === true) {
      ElMessage.warning('异动审批进行中，暂不能导入：等审批结束或先撤回/取消本次异动')
      return
    }
    strategicImportDialogVisible.value = true
    return
  }
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
        '· 修改：双击指标名称/权重就地编辑\n' +
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
    <!-- 2026-11-05（战略部直发学院指标）：职能部门对本页只读 → 顶部只读提示。
         判定用**真实登录角色**（不能用视角角色，否则战略部切视角会被误判成只读）。 -->
    <el-alert
      v-if="!canWriteStrategicTask"
      type="info"
      :closable="false"
      show-icon
      style="margin: 12px 16px"
    >
      当前角色对战略任务管理页仅可查看，不能新增、编辑、发起异动或下发撤回
    </el-alert>

    <!-- 侧边栏遮罩层 -->
    <div class="sidebar-backdrop"></div>

    <!-- 左侧任务列表 - 动态隐藏 -->
    <aside class="task-sidebar" @mouseenter="dismissCollegeGuide">
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
    <div
      class="sidebar-toggle"
      :class="{ 'sidebar-toggle--guide': showCollegeGuide }"
      @mouseenter="dismissCollegeGuide"
    >
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
      <!-- 2026-11-05（用户反馈）：竖条的提示文字必须跟随当前页签。
           原实现恒取 selectedDepartment（职能部门），切到「二级学院」页签后
           列表标题已变成「学院列表」，竖条却还挂着职能部门名，两处对不上。 -->
      <span class="toggle-hint">{{
        activeTaskTabName === 'college'
          ? selectedCollege || collegeDepartmentsScoped[0] || ''
          : selectedDepartment || functionalDepartments[0] || ''
      }}</span>
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
            :disabled="!collegeTabTwoStepReady"
            :title="collegeTabTwoStepReady ? '' : collegeTabTwoStepGuideTip"
            @click="openStrategicBatchExportDialog"
          >
            <el-icon><Download /></el-icon>
            全部导出
          </el-button>
          <!-- 2026-11-09（用户拍板：两步显式选择）：学院页签两选未齐时隐藏状态签
               —— 此时没有职能部门上下文，显示职能部门页签的计划状态会误导 -->
          <el-tag v-if="collegeTabTwoStepReady" :type="overallStatus.type" size="small">
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
          <!-- 2026-10-30 用户定案（仿 M5 互斥可见化）：异动审批在途时新增入口置灰 + tooltip。
               口径与后端 isOrgLockedByMutation 一致，只认 IN_REVIEW；
               退回待重报（WITHDRAWN 活链）不锁——新增行会成为草稿随下次发起提交 -->
          <el-button
            type="primary"
            size="small"
            :disabled="
              !canEdit ||
              isCurrentPlanUnderApproval ||
              isMutationApprovalInFlight ||
              (activeTaskTabName === 'college' && (!selectedCollege || !collegeDispatchDeptFilter))
            "
            :title="
              !canEdit
                ? '当前角色仅可查看，填报人才能新增'
                : isCurrentPlanUnderApproval
                  ? '计划正在审批中，暂不能新增：请等审批结束或先撤回本次审批'
                  : isMutationApprovalInFlight
                    ? '异动审批进行中，暂不能新增：等审批结束或先撤回/取消本次异动'
                    : activeTaskTabName === 'college' && !selectedCollege
                      ? '请先在左侧选择学院'
                      : activeTaskTabName === 'college' && !collegeDispatchDeptFilter
                        ? '请先选择职能部门'
                        : ''
            "
            @click.stop="handleAddNewRow"
          >
            <el-icon><Plus /></el-icon>
            新增行
          </el-button>
          <!-- 下发/撤回合并按钮 -->
          <!-- 2026-11-09（用户要求）：两个页签这一块必须**完全一致**——文案/按钮类型/图标
               统一用同一套取值（职能部门页签为原有样式：绿色「发起审批」/「撤回」），
               不再给学院页签单独换色换图标换文案。
               仅「可用性」与「点下去做什么」按页签分流：
               - 可用性：学院页签用 collegeTabDistributeDisabledReason（含只读/权限/未选学院），
                 避免用部门计划相位误判学院页签；
               - 点击：handleDistributeOrWithdrawClick 内部按页签分流。
               2026-11-11（学院页签按钮体系修正）修订：学院页签的文案/类型/图标改按
               **学院子计划相位**分流（collegeTabDistributeButton，与点击动作同源）——
               高①撤回异动点击弹错确认、高②学院下发审批中撤回不可达，根因都是
               文案读异动在审/点击恒走发起分支的错位，以及相位误读职能部门自身计划。
               职能部门页签三要素仍直读 distributeButton*（行为逐字不变，零回归）。 -->
          <el-button
            :type="
              activeTaskTabName === 'college'
                ? collegeTabDistributeButton.buttonType
                : distributeButtonType
            "
            size="small"
            :loading="activeTaskTabName === 'college' ? collegeDispatchSubmitting : undefined"
            :disabled="
              activeTaskTabName === 'college'
                ? Boolean(collegeTabDistributeDisabledReason) || collegeDispatchSubmitting
                : distributeButtonDisabled
            "
            :title="
              activeTaskTabName === 'college'
                ? collegeTabDistributeDisabledReason
                : distributeButtonDisabledReason
            "
            @click.stop="handleDistributeOrWithdrawClick"
          >
            <el-icon>
              <component
                :is="
                  activeTaskTabName === 'college'
                    ? collegeTabDistributeButton.icon
                    : distributeButtonIcon
                "
              />
            </el-icon>
            {{
              activeTaskTabName === 'college'
                ? collegeTabDistributeButton.text
                : distributeButtonText
            }}
          </el-button>
          <div class="approval-entry-wrapper">
            <!-- 审批进度按钮（带徽章） -->
            <!-- 2026-10-30（纯附加）：红点可见条件升级为「按钮文字为『处理审批』」——
                 计划级可处理（既有表现不变）或异动可处理（当前节点审批组织=当前用户组织）。
                 既有 pendingApprovalCount 在下发守卫等处的口径不受影响 -->
            <el-badge v-if="approvalEntryCanHandle" is-dot class="approval-badge">
              <el-button
                size="small"
                type="warning"
                class="approval-entry-action"
                @click="handleOpenApproval"
              >
                <el-icon><Check /></el-icon>
                {{ approvalEntryButtonTextWithMutation }}
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
          <!-- 2026-11-08（单层下发）：还原为两个页签都显示「导出 / 导入」。
               具体动作由点击处理按页签分流（职能部门 = 部门维度；二级学院 = 战略部 → 所选学院），
               不再隐藏按钮、也不再另外挂一套学院专用按钮组。 -->
          <!-- 2026-11-09（用户拍板：两步显式选择）：学院页签两选未齐时「导出 / 导入」置灰
               + tooltip 引导（职能部门页签不受影响，两选条件只挂在学院页签分支上） -->
          <el-button
            size="small"
            :loading="strategicExporting"
            :disabled="!collegeTabTwoStepReady"
            :title="collegeTabTwoStepReady ? '' : collegeTabTwoStepGuideTip"
            @click="handleExportCurrentStrategicDepartment"
          >
            <el-icon><Download /></el-icon>
            导出
          </el-button>
          <!-- 2026-11-11（E-1 互斥守卫）：异动审批在审时学院页签「导入」与「新增行」同口径
               置灰（口径与后端 isOrgLockedByMutation 一致，只认异动在审；上报在审不锁导入，
               与新增行一致）。仅作用于学院页签 —— 职能部门页签行为逐字不变（零回归红线）。
               在审期间导入会绕过「新增行置灰」直接往在审计划里加行，必须一并拦下 -->
          <el-button
            size="small"
            :icon="Upload"
            :disabled="
              !canWriteStrategicTask ||
              (activeTaskTabName === 'college' && isMutationApprovalInFlight === true) ||
              (activeTaskTabName === 'college' && (!selectedCollege || !collegeDispatchDeptFilter))
            "
            :title="
              !canWriteStrategicTask
                ? '当前角色仅可查看，不能导入指标'
                : activeTaskTabName === 'college' && isMutationApprovalInFlight
                  ? '异动审批进行中，暂不能导入：等审批结束或先撤回/取消本次异动'
                  : activeTaskTabName === 'college' && !selectedCollege
                    ? '请先在左侧选择学院'
                    : activeTaskTabName === 'college' && !collegeDispatchDeptFilter
                      ? '请先选择职能部门'
                      : ''
            "
            @click="openStrategicImportDialog"
          >
            导入
          </el-button>
          <!-- 2026-10-21 用户定案：全部攒改一起上报；按钮就叫「发起异动」 -->
          <!-- 编辑权只属于填报人：负责人/校领导不产生草稿，也不应看到提交入口 -->
          <!-- 2026-10-28 迭代计划 M5（互斥可见化）：上报/异动在审时按钮置灰 + tooltip 说明，
               取代此前「直接隐藏」——用户能看出为什么暂时不能发起，而不是入口凭空消失 -->
          <!-- 2026-10-30 用户定案（退回可感知）：有「退回待重报」异动链时按钮同样常驻。
               2026-10-30 用户定案修订：退回态按钮直接可点、不做置灰引导；
               :disabled 与 tooltip 仅保留在审互斥口径（上报在审/异动在审） -->
          <template v-if="canEdit && (hasMutationDraft || hasReturnedMutationChain)">
            <el-tooltip
              :disabled="!mutationSubmitBlocked"
              :content="mutationSubmitBlockedReason"
              placement="top"
            >
              <span>
                <el-button
                  size="small"
                  type="warning"
                  :disabled="mutationSubmitBlocked"
                  :loading="mutationApiLoading"
                  @click="submitMutationDraft"
                >
                  发起异动
                </el-button>
              </span>
            </el-tooltip>
          </template>
          <!-- 2026-10-31 用户定案（退回填报人节点两按钮常驻 + 原样重发）：「取消异动」恢复，
               与「发起异动」并排、紧随其后。语义=整批终结：该批退回链一次置为 CANCELLED
               并完整保留在审批中心「审批历史」（历史绝不删除）。仅异动发起人可见
               （isReturnedChainRequester 按 requester_id 预判、兜底 submitter_name 比对；
               后端 cancel-returned 仍会二次校验 requester）。此前 2026-10-30 的
               「先隐藏待重新设计」口径作废，按钮已按定案语义放开。 -->
          <el-tooltip
            v-if="canEdit && hasReturnedMutationChain && isReturnedChainRequester"
            content="点「取消异动」终结该批审批链：整链置为『已取消』并归入审批中心「审批历史」，此后该批不可再重新发起"
            placement="top"
          >
            <el-button size="small" :disabled="mutationApiLoading" @click="handleCancelMutation">
              取消异动
            </el-button>
          </el-tooltip>
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
          <!-- 2026-11-09（用户拍板：两步显式选择）：学院页签两选未齐时隐藏「审批状况」签
               —— 此时没有职能部门上下文，读到的是职能部门页签的审批流状态，会误导 -->
          <el-popover
            v-if="collegeTabTwoStepReady"
            placement="top-end"
            trigger="click"
            :width="320"
            popper-class="approval-status-popper"
            @show="handleApprovalStatusPopoverShow"
          >
            <template #reference>
              <!-- 2026-10-28 修复：恢复状态章点击打开审批中心（PR#92 实现 M1 时误删，
                   历史行为 = 点击自动打开对应审批中心）；浮层仍由点击展开供快速预览 -->
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
          <!-- 2026-11-09（用户拍板：两步显式选择）：学院页签两选未齐时同步隐藏，
               权重合计读的是 collegeTableIndicators（两选未齐时为空表），显示 0/100 会误导 -->
          <el-tag
            v-if="collegeTabTwoStepReady"
            :type="
              headerBasicWeightTotal > 100
                ? 'danger'
                : headerBasicWeightTotal === 100
                  ? 'success'
                  : 'info'
            "
            :class="{ 'weight-tag--overlimit': headerBasicWeightTotal > 100 }"
            size="small"
            style="margin-right: 12px"
          >
            基础性权重合计: {{ headerBasicWeightTotal }} / 100
          </el-tag>
          <!-- 2026-10-28 迭代计划 M2：看板显示当前填报周期（数据归属周期一目了然）。
               2026-10-30 起文案/样式由共享组件 ReportCycleTag 统一，三页一致 -->
          <ReportCycleTag :month="reportMonth" />
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

      <!-- 2026-10-28 迭代计划 M6：未提交异动草稿的可感知提示（刷新/离开即丢） -->
      <el-alert
        v-if="canEdit && mutationDraftCount > 0"
        type="warning"
        :closable="false"
        show-icon
        style="margin: 12px 16px"
      >
        <template #title>
          有
          {{ mutationDraftCount }}
          项修改待发起异动（刷新或离开页面将丢失），确认后请点顶部「发起异动」提交审批
        </template>
      </el-alert>

      <!-- 2026-10-30（取消闭环）：被驳回退回待重报的异动链可感知提示。
           2026-10-30 定案修订：发起人撤回同样把链退回填报人（活链），
           与驳回退回共用本横幅——链活着就提示可重报。
           2026-10-31 用户定案：退回填报人节点两按钮常驻——横幅同时指路
           「发起异动」（可不修改原样重发）与「取消异动」（终结整批归审批历史） -->
      <el-alert
        v-if="canEdit && hasReturnedMutationChain"
        type="error"
        :closable="false"
        show-icon
        style="margin: 12px 16px"
      >
        <template #title>
          有
          {{ returnedMutationChainCount }}
          批异动已退回待重报（驳回或发起人撤回）：可点「发起异动」重新提交（可按原内容重发，也可修改后再发），或点「取消异动」终结该批异动（归入审批历史）
        </template>
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
                  <el-table-column
                    prop="taskContent"
                    label="战略任务"
                    :width="TASK_TABLE_COLUMN_WIDTH.strategicTask"
                  >
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
                                >{{ row.taskContent || '未关联任务' }}</span
                              >
                            </FullTextPanel>
                          </el-tooltip>
                          <!-- 战略任务改名同样计入「已更改 N 次」（悬停查看历史） -->
                          <div v-if="!isReadOnly" class="indicator-cell-footer">
                            <MutationBadgePopover
                              :task-id="getIndicatorTaskId(row) || null"
                              :fields="MUTATION_FIELDS_TASK_NAME"
                              :mutation-in-flight="
                                isEntityMutationInFlight('TASK', getIndicatorTaskId(row))
                              "
                              :mutation-returned="
                                isEntityMutationReturned('TASK', getIndicatorTaskId(row))
                              "
                            />
                          </div>
                        </div>

                        <!-- 右下角新增指标三角形按钮
                             2026-10-20 用户定案：已下发计划也允许新增指标（走异动链），
                             不再限定 canWithdraw（该条件仅未下发时为真） -->
                        <!-- 2026-10-30 用户定案：异动审批在途时置灰 + tooltip（同「新增行」口径） -->
                        <!-- 2026-10-31 规范补齐：div 非按钮元素补 aria-disabled 真禁用语义；
                             保留 hover title 提示与模型层守卫（handleAddIndicatorToTask
                             在锁定态直接拦截并弹 warning），不改视觉、不误伤提示交互 -->
                        <div
                          v-if="!isReadOnly"
                          class="add-indicator-trigger"
                          :class="{ 'add-indicator-trigger--locked': isMutationApprovalInFlight }"
                          :aria-disabled="isMutationApprovalInFlight ? 'true' : undefined"
                          :title="
                            isMutationApprovalInFlight
                              ? '异动审批进行中，暂不能新增：等审批结束或先撤回/取消本次异动'
                              : ''
                          "
                          @click="handleAddIndicatorToTask(row)"
                        >
                          <span class="trigger-icon">+</span>
                        </div>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column
                    prop="name"
                    label="核心指标"
                    :min-width="TASK_TABLE_COLUMN_WIDTH.coreIndicatorMin"
                    class-name="indicator-name-col-cell"
                  >
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
                                  >{{ row.name }}</span
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
                            <div class="indicator-cell-footer indicator-cell-footer--corner">
                              <MutationBadgePopover
                                v-if="row.id"
                                :indicator-id="row.id"
                                :fields="MUTATION_FIELDS_INDICATOR_NAME"
                                :mutation-in-flight="isEntityMutationInFlight('INDICATOR', row.id)"
                                :mutation-returned="isEntityMutationReturned('INDICATOR', row.id)"
                              />
                            </div>
                          </template>
                          <span v-else class="indicator-name-text placeholder-text"
                            >双击编辑指标</span
                          >
                        </template>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column
                    prop="weight"
                    label="权重"
                    :width="TASK_TABLE_COLUMN_WIDTH.weight"
                    align="center"
                    class-name="weight-col-cell"
                  >
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
                        <!-- 2026-10-30 用户定案：权重异动记录的角标落在权重单元格（表格格子）右上角，
                             不再挂在核心指标列下（权重改动却显示在核心指标旁边，看不出是权重被改）。
                             定位基准是整格（.el-table__cell.weight-col），不是权重数字容器。 -->
                        <div class="weight-cell__badge">
                          <MutationBadgePopover
                            v-if="row.id"
                            :indicator-id="row.id"
                            :fields="MUTATION_FIELDS_WEIGHT"
                            :mutation-in-flight="isEntityMutationInFlight('INDICATOR', row.id)"
                            :mutation-returned="isEntityMutationReturned('INDICATOR', row.id)"
                          />
                        </div>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column
                    label="自评进度"
                    :width="TASK_TABLE_COLUMN_WIDTH.selfRating"
                    align="center"
                  >
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
                  <!-- 2026-10-28 用户定案（恢复行内鉴定）：鉴定是审批手段——
                       只有当前审批节点的负责人可改；其他角色/节点只读。
                       数据写当前报告轮次的 appraisal_level，后端同步 Alert。 -->
                  <el-table-column
                    label="审核进度"
                    :width="TASK_TABLE_COLUMN_WIDTH.appraisalLevel"
                    align="center"
                  >
                    <template #default="{ row }">
                      <div class="manual-alert-cell">
                        <el-tag
                          :type="
                            getManualAlertTagType(
                              getIndicatorAppraisalLevel(row.id, row.manualAlertSeverity)
                            )
                          "
                          :style="
                            getProgressLevelTagStyle(
                              getIndicatorAppraisalLevel(row.id, row.manualAlertSeverity)
                            )
                          "
                          size="small"
                          class="manual-alert-tag--clickable"
                          @click="handleAppraisalCellClick(row)"
                        >
                          {{
                            getManualAlertLabel(
                              getIndicatorAppraisalLevel(row.id, row.manualAlertSeverity)
                            )
                          }}
                        </el-tag>
                      </div>
                    </template>
                  </el-table-column>
                  <!-- 2026-10-26 用户定案：上报资料列统一用 ReportMaterialsCell——
                       悬浮即列出附件卡片（序号+文件名+类型），点击文件名下载，
                       与指标填报页/指标分发页完全同构。 -->
                  <el-table-column
                    label="上报资料"
                    :width="TASK_TABLE_COLUMN_WIDTH.reportMaterials"
                    align="center"
                  >
                    <template #default="{ row }">
                      <ReportMaterialsCell
                        :indicator-id="row.id"
                        :attachments="row.pendingAttachmentDetails || row.attachments"
                      />
                    </template>
                  </el-table-column>
                  <el-table-column
                    label="进度说明"
                    :min-width="TASK_TABLE_COLUMN_WIDTH.progressNoteMin"
                  >
                    <template #default="{ row }">
                      <el-tooltip
                        :content="row.pendingRemark || ''"
                        :disabled="(row.pendingRemark || '').length <= 50"
                        placement="top"
                      >
                        <span>{{ row.pendingRemark || '—' }}</span>
                      </el-tooltip>
                    </template>
                  </el-table-column>
                  <el-table-column
                    label="操作"
                    :width="TASK_TABLE_COLUMN_WIDTH.actions"
                    align="center"
                  >
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
                    <!-- 2026-10-30 用户定案：异动审批在途时置灰 + tooltip（同「新增行」口径） -->
                    <el-button
                      v-if="!isReadOnly"
                      type="primary"
                      :disabled="isMutationApprovalInFlight"
                      :title="
                        isMutationApprovalInFlight
                          ? '异动审批进行中，暂不能新增：等审批结束或先撤回/取消本次异动'
                          : ''
                      "
                      @click="addNewRow"
                    >
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
                </el-form>
              </div>
              <div class="add-form-actions">
                <el-button type="primary" @click="saveNewRow">保存</el-button>
                <el-button @click="cancelAdd">取消</el-button>
              </div>
            </div>
          </div>
        </el-tab-pane>

        <el-tab-pane name="college">
          <!-- 2026-11-09（用户要求）：在「二级学院战略任务管理」标签右侧加一个部门下拉。
               列出**全部职能部门**（2026-11-10 用户拍板：资格口径=存在「已下发」核心指标）：
               · 有「已下发」核心指标 → 可选中，按状态着色（已上报=绿 / 审批中=橙）；
               · 已下发但未上报 → 正常显示；
               · 无「已下发」核心指标 → 灰色 + 「未下发」标记，**可点击**，
                 点击弹提示「当前职能部门未有已下发的任务」且不选中。
               **强制显示单个部门**：没有「全部部门」这一态。
               2026-11-09（用户拍板：两步显式选择）：不再自动默认选第一个部门 ——
               未选时箭头右侧显示灰色占位「请选择职能部门」，引导完成第二步选择。 -->
          <template #label>
            <span class="college-tab-label">
              二级学院战略任务管理
              <el-dropdown
                v-if="activeTaskTabName === 'college'"
                trigger="click"
                placement="bottom-start"
                @command="handleCollegeDeptFilterChange"
              >
                <span class="college-tab-trigger" @click.stop>
                  <el-icon class="college-tab-filter-arrow"><ArrowDown /></el-icon>
                  <!-- 当前部门小字：只显示「现在表格里是哪个部门的数据」。
                       状态（已上报/审批中）按用户要求**只在点开的下拉列表里**展示，
                       不在这里重复。整块（箭头 + 小字）都是点击热区。
                       2026-11-09（用户拍板：两步显式选择）：未选部门时显示灰色占位文案。 -->
                  <span v-if="collegeDeptCurrent" class="college-tab-current">
                    {{ collegeDeptCurrent.dept }}
                  </span>
                  <span v-else class="college-tab-current college-tab-current--placeholder">
                    请选择职能部门
                  </span>
                </span>
                <template #dropdown>
                  <el-dropdown-menu class="college-dept-filter-menu">
                    <!-- 注意：菜单被 teleport 到 body，scoped 样式选不到它，
                         所以颜色/置灰一律用内联 style，避免样式不生效。 -->
                    <el-dropdown-item
                      v-for="item in collegeDeptDropdownItems"
                      :key="item.dept"
                      :command="item.dept"
                      :style="{
                        color:
                          !item.eligible
                            ? '#c0c4cc'
                            : item.reportStatus === 'reported'
                              ? '#67c23a'
                              : item.dispatchStatus === 'dispatching' ||
                                  item.reportStatus === 'reporting'
                                ? '#e6a23c'
                                : undefined
                      }"
                    >
                      <span class="college-dept-filter-name">{{ item.dept }}</span>
                      <!-- 2026-11-10（用户拍板）：无「已下发」核心指标的部门 → 「未下发」标记，
                           全部项可点击（点击拦截在 handleCollegeDeptFilterChange 里弹提示）。 -->
                      <el-tag
                        v-if="!item.eligible"
                        type="warning"
                        size="small"
                        class="college-dept-filter-tag"
                        >未下发</el-tag
                      >
                      <!-- 下发维度（战略部 → 该学院）：进行中才标记；已下发按用户要求正常显示、不标记 -->
                      <el-tag
                        v-if="item.eligible && item.dispatchStatus === 'dispatching'"
                        type="warning"
                        size="small"
                        class="college-dept-filter-tag"
                        >下发中</el-tag
                      >
                      <!-- 上报维度（该学院 → 审批）：进行中=橙、已完成=绿 -->
                      <el-tag
                        v-if="item.eligible && item.reportStatus === 'reporting'"
                        type="warning"
                        size="small"
                        class="college-dept-filter-tag"
                        >上报中</el-tag
                      >
                      <el-tag
                        v-else-if="item.eligible && item.reportStatus === 'reported'"
                        type="success"
                        size="small"
                        class="college-dept-filter-tag"
                        >已上报</el-tag
                      >
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </span>
          </template>
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
              <template v-else-if="isStrategicDeptLogin">
                <!-- 2026-11-05（issue #96 · 1.1）：战略部是下发方，这里是「还没给任何学院下发过」，
                     不能沿用职能部门那句「请切换职能部门 —— 或先完成指标下发」，
                     否则用户看不出自己就是那个该去做下发的人。 -->
                <div class="college-empty-main">该职能部门尚未向任何二级学院下发指标</div>
                <div class="college-empty-sub">
                  在左侧选择学院后，用页签上方工具栏的「导入」完成本次下发
                </div>
              </template>
              <template v-else>
                <div class="college-empty-main">当前职能部门暂未向学院下发指标</div>
                <div class="college-empty-sub">
                  请在上方「职能部门战略任务管理」中切换其他职能部门，或先完成指标下发
                </div>
              </template>
            </div>
            <!-- 2026-11-09（用户拍板：两步显式选择）：第二级引导 —— 学院已选但未选职能部门。
                 样式结构（图标+深色大字+辅助小字）完全沿用第一级空态，不再自动兜底
                 第一个部门直接展示内容。 -->
            <div v-else-if="!collegeDispatchDeptFilter" class="college-empty-tip">
              <el-icon class="college-empty-icon"><ArrowUpBold /></el-icon>
              <div class="college-empty-main">请选择上方职能部门</div>
              <div class="college-empty-sub">
                选择职能部门后，这里将展示该学院收到的对应战略任务指标
              </div>
            </div>
            <template v-else>
              <div class="table-container">
                <el-table
                  :data="collegeTableIndicators"
                  border
                  highlight-current-row
                  class="unified-table"
                >
                  <el-table-column
                    prop="name"
                    label="子指标名称"
                    :min-width="TASK_TABLE_COLUMN_WIDTH.collegeSubIndicatorMin"
                    class-name="indicator-name-col-cell"
                  >
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
                                <!-- 2026-10-28 修复：子指标名称补上定性/定量配色类，
                                     与核心指标列/职能部门 tab 保持同构（此前裸 span 丢色） -->
                                <span
                                  class="indicator-name-text"
                                  :class="
                                    row.type1 === '定性'
                                      ? 'indicator-qualitative'
                                      : row.type1 === '定量'
                                        ? 'indicator-quantitative'
                                        : ''
                                  "
                                  >{{ row.name }}</span
                                >
                              </FullTextPanel>
                            </el-tooltip>
                          </template>
                          <span v-else class="placeholder-text">未命名指标</span>
                        </template>
                        <!-- 异动历史徽章（有变更时显示，悬停看历史） -->
                        <div
                          v-if="row.id"
                          class="indicator-cell-footer indicator-cell-footer--corner"
                        >
                          <MutationBadgePopover
                            :indicator-id="row.id"
                            :fields="MUTATION_FIELDS_INDICATOR_NAME"
                            :mutation-in-flight="isEntityMutationInFlight('INDICATOR', row.id)"
                            :mutation-returned="isEntityMutationReturned('INDICATOR', row.id)"
                          />
                          <!-- 上报历史小标（每次上报更新，不走异动链，悬停看历次上报+资料） -->
                        </div>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column
                    prop="weight"
                    label="权重"
                    :width="TASK_TABLE_COLUMN_WIDTH.weight"
                    align="center"
                    class-name="weight-col-cell"
                  >
                    <template #default="{ row }">
                      <div class="weight-cell" @dblclick="handleIndicatorDblClick(row, 'weight')">
                        <div class="weight-cell__content">
                          <el-input
                            v-if="
                              editingIndicatorId === row.id && editingIndicatorField === 'weight'
                            "
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
                          <!-- 2026-10-30 用户定案：权重异动记录挂在权重格子右上角 -->
                          <div class="weight-cell__badge">
                            <MutationBadgePopover
                              v-if="row.id"
                              :indicator-id="row.id"
                              :fields="MUTATION_FIELDS_WEIGHT"
                              :mutation-in-flight="isEntityMutationInFlight('INDICATOR', row.id)"
                              :mutation-returned="isEntityMutationReturned('INDICATOR', row.id)"
                            />
                          </div>
                        </div>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column
                    label="自评进度"
                    :width="TASK_TABLE_COLUMN_WIDTH.selfRating"
                    align="center"
                  >
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
                  <el-table-column
                    label="审核进度"
                    :width="TASK_TABLE_COLUMN_WIDTH.appraisalLevel"
                    align="center"
                  >
                    <template #default="{ row }">
                      <div class="manual-alert-cell">
                        <el-tag
                          :type="
                            getManualAlertTagType(
                              getIndicatorAppraisalLevel(row.id, row.manualAlertSeverity)
                            )
                          "
                          :style="
                            getProgressLevelTagStyle(
                              getIndicatorAppraisalLevel(row.id, row.manualAlertSeverity)
                            )
                          "
                          size="small"
                          class="manual-alert-tag--clickable"
                          @click="handleAppraisalCellClick(row)"
                        >
                          {{
                            getManualAlertLabel(
                              getIndicatorAppraisalLevel(row.id, row.manualAlertSeverity)
                            )
                          }}
                        </el-tag>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column
                    label="上报资料"
                    :width="TASK_TABLE_COLUMN_WIDTH.reportMaterials"
                  >
                    <template #default="{ row }">
                      <!-- 当前轮次附件（含草稿）；历次经上报记录查看 -->
                      <ReportMaterialsCell
                        :indicator-id="row.id"
                        :attachments="row.pendingAttachmentDetails || row.attachments"
                      />
                    </template>
                  </el-table-column>
                  <el-table-column
                    label="进度说明"
                    :min-width="TASK_TABLE_COLUMN_WIDTH.progressNoteMin"
                  >
                    <template #default="{ row }">
                      <el-tooltip
                        :content="row.pendingRemark || ''"
                        :disabled="(row.pendingRemark || '').length <= 50"
                        placement="top"
                      >
                        <span>{{ row.pendingRemark || '—' }}</span>
                      </el-tooltip>
                    </template>
                  </el-table-column>
                  <el-table-column
                    label="操作"
                    :width="TASK_TABLE_COLUMN_WIDTH.actions"
                    align="center"
                    fixed="right"
                  >
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
          <!-- 2026-10-24 用户定案：自评进度与审核进度并列展示（前者填报告知，后者上级鉴定） -->
          <el-descriptions-item label="自评进度">
            <el-tag v-if="(currentDetail as any).selfRating" size="small" type="info">
              {{
                { AHEAD: '超前完成', NORMAL: '正常', DELAYED: '延期' }[
                  String((currentDetail as any).selfRating).toUpperCase()
                ] || (currentDetail as any).selfRating
              }}
            </el-tag>
            <span v-else style="color: #909399">—</span>
          </el-descriptions-item>
          <el-descriptions-item label="审核进度">
            <el-tag
              :type="getManualAlertTagType(currentDetail.manualAlertSeverity)"
              :style="getProgressLevelTagStyle(currentDetail.manualAlertSeverity)"
              size="small"
            >
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
        </el-descriptions>

        <!-- 上报记录：固定展开展示，不做折叠交互（2026-10-07 用户拍板） -->
        <div class="report-history-section">
          <div class="report-history-title">上报记录（历次填报 / 含被驳回）</div>
          <!-- 2026-10-24 用户定案：点某张上报卡看该轮完整详情——弹窗内聚在
               IndicatorFillHistory 组件内，三个复用页面共同生效 -->
          <IndicatorFillHistory
            v-if="currentDetailId"
            :indicator-id="currentDetailId"
            :indicator-name="currentDetail?.name"
          />
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

    <!-- 2026-11-08（单层下发）：同一个导入弹窗按页签切换口径，不新增第二个实例。
         职能部门页签 = strategic-task（战略部 → 职能部门，原行为不变）；
         二级学院页签 = distribution（战略部 → 所选学院），单层结构没有父级核心指标，
         故 parent-indicators 固定传空数组。 -->
    <BusinessImportDialog
      v-model:visible="strategicImportDialogVisible"
      :type="activeTaskTabName === 'college' ? 'distribution' : 'strategic-task'"
      :target-org-id="
        activeTaskTabName === 'college' ? collegeDispatchCollegeOrgId : currentStrategicImportOrgId
      "
      :target-org-name="activeTaskTabName === 'college' ? selectedCollege : selectedDepartment"
      :source-org-id="activeTaskTabName === 'college' ? strategicDeptOrgId : undefined"
      :source-org-name="activeTaskTabName === 'college' ? strategicDeptName : undefined"
      :cycle-id="
        activeTaskTabName === 'college' ? collegeDispatchCycleId : currentStrategicImportCycleId
      "
      :parent-indicators="
        activeTaskTabName === 'college' ? COLLEGE_IMPORT_PARENT_INDICATORS : undefined
      "
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
            <span class="summary-value">{{ approvalSetupPlanReference }}</span>
          </div>
          <div class="summary-row">
            <span class="summary-label">审批流程：</span>
            <span class="summary-value">{{ approvalSetupWorkflowName }}</span>
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
    <!-- 2026-10-30（纯附加）链路覆盖：异动卡数据源传合并视图（主计划 + 链下学院子计划），
         修正学院子计划异动在抽屉漏卡；发起异动互斥锁仍读 departmentMutationPendingApprovals -->
    <!-- 2026-10-30 用户定案：退回待重报活链在流程终结前不得在审批中心消失——
         退回链清单透传给抽屉，计划审批 tab 渲染「退回待重报」状态卡、
         审批流程 tab 选择栏可选中查看该链 -->
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
      :mutation-pending-approvals="allDepartmentMutationPendingApprovals"
      :returned-mutation-approvals="returnedMutationChains"
      :related-workflow-entities="departmentPlanFamilyWorkflowEntities"
      approval-type="submission"
      @close="taskApprovalVisible = false"
      @refresh="handleApprovalRefresh"
    />
  </div>
</template>

<style scoped src="./StrategicTaskView.css"></style>

<style scoped>
/* 计划未正式下发时锁定审核进度 */
.manual-alert-select-wrapper--locked {
  cursor: not-allowed;
}

/* 2026-10-28：可点击的鉴定标签——点击才解锁下拉，悬停只显示提示 */
.manual-alert-tag--clickable {
  cursor: pointer;
}

/* 锁定状态：点击弹出一次提示，不用悬停提示 */
.manual-alert-tag--locked {
  cursor: help;
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

/* 2026-11-09（用户要求）：学院页签「职能部门」下拉筛选器 —— 标签右侧的小箭头 */
.college-tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.college-tab-filter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  color: #6b7280;
  cursor: pointer;
  transition:
    background-color 0.15s,
    color 0.15s;
}

.college-tab-filter:hover {
  background-color: #eff6ff;
  color: #2563eb;
}

.college-dept-filter-menu {
  max-height: 420px;
  overflow-y: auto;
  min-width: 240px;
}

.college-dept-filter-name {
  flex: 1;
}

/* 2026-11-09（用户要求）：学院页签「职能部门」下拉 —— 整块（箭头+小字）都是点击热区 */
.college-tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.college-tab-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.college-tab-trigger:hover {
  background-color: #eff6ff;
}

.college-tab-filter-arrow {
  color: #6b7280;
  font-size: 13px;
}

.college-tab-trigger:hover .college-tab-filter-arrow {
  color: #2563eb;
}

/* 当前部门小字：只显示部门名（状态按用户要求只在下拉列表里展示） */
.college-tab-current {
  font-size: 12px;
  color: #909399;
  font-weight: 400;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 2026-11-09（用户拍板：两步显式选择）：未选部门时的灰色占位文案「请选择职能部门」 */
.college-tab-current--placeholder {
  color: #c0c4cc;
}

/* 说明：下拉菜单被 Element Plus teleport 到 body，scoped 样式选不到它，
   所以「已上报 / 审批中 / 未下发」三种颜色一律用模板上的内联 style 实现，
   这里不再留对应 class（留着会误导后来者以为改样式能生效）。 */
</style>
