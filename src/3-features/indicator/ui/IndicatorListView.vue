<script setup lang="ts">
import IndicatorFillHistory from '@/features/plan/ui/IndicatorFillHistory.vue'
import MutationBadgePopover from '@/features/indicator/ui/MutationBadgePopover.vue'
import {
  MUTATION_FIELDS_INDICATOR_NAME,
  MUTATION_FIELDS_WEIGHT
} from '@/features/indicator/model/mutationHistory'
import { computed, ref, watch } from 'vue'
import ReportMaterialsCell from '@/features/indicator/ui/ReportMaterialsCell.vue'
import { useLatestIndicatorFill } from '@/features/indicator/model/useLatestIndicatorFill'
// 2026-10-28 华年定案：三个页面列宽统一，唯一来源见 tableColumns.ts
import { TASK_TABLE_COLUMN_WIDTH } from '@/features/task/lib/tableColumns'
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
import { ElMessage, ElMessageBox } from 'element-plus'
import type { StrategicIndicator } from '@/shared/types'
import {
  buildAttachmentNameCell,
  buildExportFileName,
  exportRowsToExcel,
  type ExcelExportColumn,
  type ExcelExportSheet,
  type ExcelRowTone
} from '@/shared/lib/export/excel'
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
import { ApprovalProgressDrawer } from '@/features/approval'
// 2026-11-25（指标填报导入式上报 · 学院侧）：导入弹窗放在 import feature，
// 由本页（indicator）消费——与既有 ApprovalProgressDrawer 的跨 feature 引用同构。
import ReportFillImportDialog from '@/features/import/ui/ReportFillImportDialog.vue'
import type { ReportFillTemplateVariant } from '@/features/import/lib/reportFillImportTemplate'
import { useIndicatorAppraisal } from '@/features/indicator/model/useIndicatorAppraisal'
import { getAppraisalLevelDisplay } from '@/features/indicator/lib/appraisalGate'
// 2026-11-19 用户定案：审核进度行内下拉共享组件（三视图同构）
import AppraisalLevelCell from '@/features/indicator/ui/AppraisalLevelCell.vue'
import type { ManualAlertSeverity } from '@/shared/api/monitoringApi'
import { formatLocalDateTag } from '@/shared/lib/utils/localDateTag'
import FullTextPanel from '@/shared/ui/display/FullTextPanel.vue'
import ReportCycleTag from '@/shared/ui/display/ReportCycleTag.vue'
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
  buildCollegeExportRowsByOwnerDept,
  canCurrentUserHandlePlanApprovalOnPage,
  canEdit,
  canHandleIndicatorWorkflow,
  // 2026-11-25（填报导入式上报）：可用性 + 模板预填 + 周期/月份上下文
  canUseReportFillImport,
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
  // 2026-11-18（学院未选归口=行集置空）：空态引导文案
  collegeFillEmptyHint,
  currentApprovalApproverName,
  currentApprovalCandidateNames,
  currentApprovalFlowName,
  // 2026-11-25（填报导入式上报）：单归口入口要传给后端的归口部门 id
  currentFunctionalOrgId,
  currentApprovalStatusMeta,
  // 2026-11-17（e2e 缺陷②修复）：驳回退回待重报（WITHDRAWN 活链）红横幅判定
  hasReturnedReportChain,
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
  monthlySequenceStatusMeta,
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
  handleSubmitAllGate,
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
  downloadDisplayAttachmentItem,
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
  // 2026-11-25（填报导入式上报）：周期/月份/学院名上下文
  reportFillCollegeName,
  reportFillCycleId,
  reportFillMonth,
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
  showStrategicTaskColumn,
  showWithdrawAllButton,
  strategicStore,
  submitAllButtonDisabledReason,
  submitAllDisabledTitle,
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

const { latestFillNote, latestFillAttachments } = useLatestIndicatorFill(
  computed(() => (currentDetail as any)?.value?.id ?? null),
  // 实时值：按 id 从当前行数组取**最新**行对象（行对象加载后会被替换，
  // 打开抽屉那一刻的旧引用里的 pendingRemark 是空值）
  (id: string | number) => indicators.value.find(item => String(item.id) === String(id)) as any
)

const indicatorListExporting = ref(false)

// 2026-10-29：二级学院导出改造——「导出当前范围」按来源部门出 Excel，
// 「全部导出」按来源职能部门拆分多个 Excel 并打成一个 zip。
const collegeExportDialogVisible = ref(false)
const selectedCollegeExportDepartments = ref<string[]>([])
const collegeBatchExporting = ref(false)

// ==================== 2026-11-25（指标填报导入式上报） ====================
// 三种变体对应标准模板 04/05/06：职能部门上报 / 学院单归口 / 学院多归口批量。
const reportFillImportVisible = ref(false)
const reportFillImportVariant = ref<ReportFillTemplateVariant>('college-all')
/** 单归口（college-single）时必须带上的目标部门 id */
const reportFillTargetOrgId = ref<number | null>(null)

const openReportFillImport = (variant: ReportFillTemplateVariant, targetOrgId?: number | null) => {
  // 单归口入口必须能解析出目标部门 id：拿不到就明确拦下，
  // 否则后端会按「批量」处理，把文件里所有归口线一起提交。
  if (variant === 'college-single' && !targetOrgId) {
    ElMessage.warning('归属部门尚未加载完成，请稍候重试或刷新页面后再导入')
    return
  }
  reportFillImportVariant.value = variant
  reportFillTargetOrgId.value = variant === 'college-single' ? (targetOrgId ?? null) : null
  reportFillImportVisible.value = true
}

/** 导入完成后刷新页面数据（填报内容与审核进度都会变）。 */
const handleReportFillImported = async () => {
  // refreshIndicatorListAfterMutation 内部已重拉计划详情（按当前 planId），
  // 故不重复调用需要 planId 入参的 refreshCurrentPlanDetails。
  await refreshIndicatorListAfterMutation()
}

// 2026-10-14 用户定案：与战略任务管理/下发界面同构——同一战略任务多行在「战略任务」列合并；移除「内部ID」列
/**
 * 2026-11-17（用户反馈第 2.2 条）：导出的「自评进度」文案。
 *
 * 行对象上的 selfRating 由填报层附加（StrategicIndicator 声明里没有该字段），
 * 这里做窄化读取；空值统一「—」，未知码原样输出便于排查。
 * （承接 PR #122 @Nerdlet369 的导出 overlay 部分；DELAYED 文案随本仓口径作「滞后」）
 */
const getIndicatorListExportSelfRatingLabel = (row: StrategicIndicator): string => {
  const raw = String((row as { selfRating?: string | null }).selfRating ?? '').trim()
  if (!raw) {
    return '—'
  }
  const key = raw.toUpperCase()
  return (
    ({ AHEAD: '超前完成', NORMAL: '正常', DELAYED: '滞后' } as Record<string, string>)[key] ?? raw
  )
}

const buildIndicatorListExportColumns = (
  rows: StrategicIndicator[],
  summaryMap: IndicatorAttachmentSummaryMap | null
): ExcelExportColumn<StrategicIndicator>[] => {
  // 2026-11-18 用户拍板（学院删列）：学院视角不显示「战略任务」列（与界面一致），
  // 导出也不出该列——无列即无跨行合并；职能部门/战略部视角导出保留任务列与合并逻辑。
  const showTaskColumn = !isSecondaryCollege.value
  const taskSpanByIndex = new Map<number, number>()
  if (showTaskColumn) {
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
  }

  const columns: ExcelExportColumn<StrategicIndicator>[] = [
    { header: '序号', width: 8, align: 'center', getValue: (_row, index) => index + 1 },
    { header: '来源部门', width: 18, getValue: row => row.ownerDept || '-' },
    { header: '责任部门', width: 18, getValue: row => row.responsibleDept || '-' }
  ]

  if (showTaskColumn) {
    columns.push({
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
    })
  }

  columns.push(
    // 2026-11-17（领导二-1）：学院视角该列装的是子指标名（row.name），表头与网格一致改
    // 「子指标名称」——学院侧材料不再出现「核心指标」（职能部门原指标）字样
    {
      header: isSecondaryCollege.value ? '子指标名称' : '核心指标',
      width: 32,
      getValue: row => row.name || '-'
    },
    { header: '指标类型', width: 12, align: 'center', getValue: row => row.type1 || '-' },
    { header: '任务类别', width: 12, align: 'center', getValue: row => row.type2 || '-' },
    { header: '权重', width: 10, align: 'center', getValue: row => Number(row.weight || 0) },
    // 2026-11-17 用户反馈第 2.2 条：导出缺少「填报的内容」——补自评进度（页面有权重之后这一列）
    // （承接 PR #122 @Nerdlet369 的导出 overlay 部分）
    {
      header: '自评进度',
      width: 14,
      align: 'center',
      getValue: row => getIndicatorListExportSelfRatingLabel(row)
    },
    {
      header: '审核进度',
      width: 18,
      align: 'center',
      // 2026-11-17（领导反馈「导出的表没有填报的内容」）：导出与网格同源——
      // 实时等级 context 优先（getIndicatorAppraisalLevel），行内存字段兜底。
      // 此前只读 row.manualAlertSeverity（依赖一次异步回显，审批中/回显失败恒空），
      // 页面有值、导出为空。导出 handler 已在构建 sheet 前 await 加载 context。
      getValue: row =>
        getManualAlertLabel(getIndicatorAppraisalLevel(row.id, row.manualAlertSeverity))
    },
    // 2026-11-17 用户反馈第 2.2 条：与页面列名对齐，「填报说明」改称「进度说明」
    // （承接 PR #122 @Nerdlet369 的导出 overlay 部分）
    { header: '进度说明', width: 28, getValue: row => row.pendingRemark || '-' },
    // 2026-10-28：附件本体打进 zip 后，Excel 只保留「附件目录（相对路径）」+「文件名」；
    // 附件来源由后端按当前登录人可见范围返回，页面看不到的填报不会进导出。
    {
      header: '附件目录（包内相对路径）',
      width: 30,
      getValue: (row, index) => {
        const attachments = resolveVisibleAttachments(summaryMap, row.id, () =>
          resolveIndicatorAttachmentItems(row)
        )
        return attachments.length > 0
          ? buildAttachmentRelativeDir({ seq: index + 1, indicatorName: row.name || '指标' })
          : '-'
      }
    },
    {
      header: '上报资料',
      width: 42,
      getValue: row =>
        buildAttachmentNameCell(
          resolveVisibleAttachments(summaryMap, row.id, () => resolveIndicatorAttachmentItems(row))
        )
    }
  )

  return columns
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

// 2026-10-29：二级学院「全部导出」的部门多选（与战略任务页同构）
const allCollegeExportDepartmentsSelected = computed(
  () => selectedCollegeExportDepartments.value.length === availableOwnerDepts.value.length
)

const collegeExportDepartmentsIndeterminate = computed(
  () =>
    selectedCollegeExportDepartments.value.length > 0 &&
    selectedCollegeExportDepartments.value.length < availableOwnerDepts.value.length
)

const toggleAllCollegeExportDepartments = (checked: string | number | boolean) => {
  selectedCollegeExportDepartments.value = checked ? [...availableOwnerDepts.value] : []
}

const buildCollegeExportSheet = (
  rows: StrategicIndicator[],
  summaryMap: IndicatorAttachmentSummaryMap | null
): ExcelExportSheet<StrategicIndicator> => ({
  sheetName: '指标填报',
  rows,
  columns: buildIndicatorListExportColumns(rows, summaryMap),
  emptyMessage: '该部门暂无可导出的指标',
  getRowTone: getIndicatorListExportRowTone
})

const buildCollegeAttachmentGroups = (
  rows: StrategicIndicator[],
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
          resolveIndicatorAttachmentItems(row)
        )
      }
    })
  )

// 2026-10-29：二级学院「导出当前范围」= 当前来源部门一个 Excel + 附件，强制打包 zip。
const handleExportCollegeCurrentRange = async () => {
  const sourceDept =
    filterOwnerDept.value || availableOwnerDepts.value[0] || effectiveViewingDept.value
  if (!sourceDept) {
    ElMessage.warning('请先选择来源部门')
    return
  }

  indicatorListExporting.value = true
  try {
    await strategicStore.loadIndicatorsByYear(timeContext.currentYear, { force: true })

    const groups = buildCollegeExportRowsByOwnerDept([sourceDept])
    if (groups.length === 0 || groups[0].rows.length === 0) {
      ElMessage.warning('当前部门暂无可导出的指标数据')
      return
    }

    const rows = groups[0].rows
    // 2026-11-17：导出前显式重查实时等级 context（与网格同源），确保「审核进度」列不为空
    await loadIndicatorAppraisalContexts(rows.map(row => row.id))
    const summaryMap = await loadIndicatorAttachmentSummaryMap(rows.map(row => row.id))

    const payload = {
      department: sourceDept,
      sheets: [buildCollegeExportSheet(rows, summaryMap) as ExcelExportSheet<unknown>],
      attachmentGroups: buildCollegeAttachmentGroups(rows, summaryMap)
    }

    const dateText = formatLocalDateTag()
    const collegeName = effectiveViewingDept.value || authStore.userDepartment || '当前学院'

    await exportDepartmentsAsZip([payload], `指标填报_${collegeName}_${dateText}.zip`, {
      forceZip: true,
      onProgress: text => ElMessage({ message: text, duration: 1200, grouping: true })
    })
    ElMessage.success(`导出成功：${sourceDept} 的 Excel 与附件已打包`)
  } catch {
    ElMessage.error('导出失败，请稍后重试')
  } finally {
    indicatorListExporting.value = false
  }
}

const openCollegeExportDialog = () => {
  if (availableOwnerDepts.value.length === 0) {
    ElMessage.warning('当前学院暂无可导出的来源部门')
    return
  }
  selectedCollegeExportDepartments.value = [...availableOwnerDepts.value]
  collegeExportDialogVisible.value = true
}

// 2026-10-29：二级学院「全部导出」= 每个来源职能部门一个 Excel，附件同包，绝不嵌套 zip。
const handleExportAllCollegeDepartments = async () => {
  if (selectedCollegeExportDepartments.value.length === 0) {
    ElMessage.warning('请选择要导出的部门')
    return
  }

  collegeBatchExporting.value = true
  try {
    await strategicStore.loadIndicatorsByYear(timeContext.currentYear, { force: true })

    const groups = buildCollegeExportRowsByOwnerDept(selectedCollegeExportDepartments.value)
    if (groups.length === 0) {
      ElMessage.warning('当前学院暂无可导出的指标数据')
      return
    }

    const allRows = groups.flatMap(group => group.rows)
    // 2026-11-17：导出前显式重查实时等级 context（与网格同源），确保「审核进度」列不为空
    await loadIndicatorAppraisalContexts(allRows.map(row => row.id))
    const summaryMap = await loadIndicatorAttachmentSummaryMap(allRows.map(row => row.id))

    const payloads = groups.map(group => ({
      department: group.department,
      sheets: [buildCollegeExportSheet(group.rows, summaryMap) as ExcelExportSheet<unknown>],
      attachmentGroups: buildCollegeAttachmentGroups(group.rows, summaryMap)
    }))

    const dateText = formatLocalDateTag()
    const collegeName = effectiveViewingDept.value || authStore.userDepartment || '当前学院'

    await exportDepartmentsAsZip(payloads, `指标填报_${collegeName}_${dateText}.zip`, {
      forceZip: true,
      onProgress: text => ElMessage({ message: text, duration: 1200, grouping: true })
    })
    collegeExportDialogVisible.value = false
    ElMessage.success(
      `导出成功：${payloads.length} 个职能部门各一个 Excel，${countExportAttachments(payloads)} 个附件已一并打包`
    )
  } catch {
    ElMessage.error('导出失败，请稍后重试')
  } finally {
    collegeBatchExporting.value = false
  }
}

// 2026-10-31 定稿：等级选项收敛到共享 appraisalGate（只有超前完成/正常/滞后三档），
// 「未评定」退为初始空白显示态（不是选项，空值仍显示「—」），三视图同构。
const getManualAlertLabel = (severity?: ManualAlertSeverity) =>
  getAppraisalLevelDisplay(severity).label

const getManualAlertTagType = (severity?: ManualAlertSeverity) =>
  getAppraisalLevelDisplay(severity).type

// ============================================================================
// 2026-10-30 P0-3：补「审核进度」写入位（上报审批链行内鉴定）
//
// 背景：审核进度此前只有战略任务管理页有写入入口，指标填报页这一列纯只读，
// 导致「上报链可评级节点要求全部指标已评定」与「无人能评级」构成死锁
// （本地上报实例实测 409：存在未评定的审核进度拦截，2026-10-30 起文案改报指标名与操作指引）。
// 此处复用 useIndicatorAppraisal（后端 canAppraise 判定谁能改），与战略任务页同构。
// 2026-11-19 用户定案：统一为**行内下拉**（共享组件 AppraisalLevelCell），
// 点击解锁 → 选三档 → 选完即存；原先的「调整审核进度」弹窗层已下线。
// ============================================================================
const appraisalApi = useIndicatorAppraisal()
const {
  load: loadIndicatorAppraisalContexts,
  getLevel: getIndicatorAppraisalLevel,
  getContext: getIndicatorAppraisalContext
} = appraisalApi

watch(
  () => (indicators.value ?? []).map(item => String(item.id)).join(','),
  () => {
    void loadIndicatorAppraisalContexts((indicators.value ?? []).map(item => item.id))
  },
  { immediate: true }
)

const getMonthlyExpectedProgress = () => {
  const month = new Date().getMonth() + 1
  return Math.min(100, Math.round((month / 12) * 100))
}

const handleExportIndicatorList = async () => {
  // 2026-10-29：二级学院改走「按来源职能部门拆分」的导出；职能部门/战略部保持原逻辑
  if (isSecondaryCollege.value) {
    await handleExportCollegeCurrentRange()
    return
  }

  const rows = getIndicatorListExportRows()
  if (rows.length === 0) {
    ElMessage.warning('暂无可导出的指标数据')
    return
  }

  indicatorListExporting.value = true
  try {
    // 2026-11-17：导出前显式重查实时等级 context（与网格同源），确保「审核进度」列
    // 不因批量缓存陈旧/未加载而导出为空
    await loadIndicatorAppraisalContexts(rows.map(row => row.id))
    const scopeName = effectiveViewingDept.value || authStore.userDepartment || '当前部门'
    // 2026-10-28：附件可见性由后端判定——填报人可见本人草稿，上级只可见上一轮已上报快照
    const summaryMap = await loadIndicatorAttachmentSummaryMap(rows.map(row => row.id))

    const sheet: ExcelExportSheet<StrategicIndicator> = {
      sheetName: scopeName,
      rows,
      columns: buildIndicatorListExportColumns(rows, summaryMap),
      getRowTone: getIndicatorListExportRowTone
    }

    const attachmentGroups = collectAttachmentGroups(
      rows.map((row, index) => {
        const summary = getAttachmentSummary(summaryMap, row.id)
        return {
          seq: index + 1,
          indicatorName: row.name || '指标',
          round: summary?.round,
          fillDate: summary?.fillDate,
          attachments: resolveVisibleAttachments(summaryMap, row.id, () =>
            resolveIndicatorAttachmentItems(row)
          )
        }
      })
    )

    if (attachmentGroups.length === 0) {
      await exportRowsToExcel(sheet, buildExportFileName('指标填报与管理', scopeName))
      ElMessage.success('导出成功')
      return
    }

    // 2026-10-28：有附件时改为 zip——Excel 与附件同包，Excel 里用「附件目录」列定位
    const dateText = formatLocalDateTag()
    await exportDepartmentsAsZip(
      [
        {
          department: scopeName,
          sheets: [sheet as ExcelExportSheet<unknown>],
          attachmentGroups
        }
      ],
      `指标填报与管理_${scopeName}_${dateText}.zip`,
      { onProgress: text => ElMessage({ message: text, duration: 1200, grouping: true }) }
    )
    ElMessage.success('导出成功：Excel 与附件已一并打包')
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
          {{ isSecondaryCollege ? '导出当前范围' : '导出' }}
        </el-button>
        <el-button
          v-if="isSecondaryCollege"
          type="primary"
          :loading="collegeBatchExporting"
          @click="openCollegeExportDialog"
        >
          <el-icon><Download /></el-icon>
          全部导出
        </el-button>
        <!-- 2026-11-25（指标填报导入式上报）：
             学院视角 →【批量导入】（06 多归口批量，按「目标部门」列拆线）
             职能部门填报人 →【导入填报】（04 职能部门上报战略发展部）
             按钮位置与显示口径沿用协作者 PR #145：与导出按钮并排右对齐、
             学院视角即显示（不再要求填报人席位），避免填报人看不到入口。 -->
        <el-button v-if="isSecondaryCollege" @click="openReportFillImport('college-all')">
          <el-icon><Upload /></el-icon>
          批量导入
        </el-button>
        <el-button v-else-if="canUseReportFillImport" @click="openReportFillImport('func')">
          <el-icon><Upload /></el-icon>
          导入填报
        </el-button>
      </div>
    </div>

    <!-- 2026-11-17（e2e 缺陷②修复，症状 A）：驳回退回待重报（WITHDRAWN 活链）红横幅。
         驳回后落点 = 报告退回 DRAFT + 审批实例 WITHDRAWN 活链（completed_at 为空），
         此前页面只有灰色「草稿」章——违背 2026-11-13 定案「驳回=退回填报人，
         退回态要可见」。对齐任务管理页异动退回横幅口径（hasReturnedMutationChain 同构）：
         红横幅常驻提示 + 指路「一键提交」重报。数据流不变（草稿本就可编辑可重报，
         行为已被测试证实正常），只补状态提示层；重报提交后实例复活 IN_REVIEW、
         报告离开 DRAFT → 横幅自动消失（判定见 model hasReturnedReportChain /
         lib isReportReturnedChainAlive）。 -->
    <el-alert
      v-if="hasReturnedReportChain"
      type="error"
      :closable="false"
      show-icon
      style="margin: 12px 16px"
    >
      <template #title>
        上报已退回待重报（驳回或撤回）：填报内容已退回为草稿，请完善后点「一键提交」重新上报
      </template>
    </el-alert>

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
            <!-- 归属部门筛选（仅学院可见；2026-11-13 口径变更：原「来源部门」退役——
                 选项=当前行集按父级核心指标反查出的归口职能部门，一键提交/撤回必须先选）。
                 2026-11-15 用户拍板（提交按钮隐藏改主动引导①）：未选时选择器琥珀色描边 +
                 placeholder 点明「提交上报前必选」；选中后恢复默认。填报/存草稿不受影响 -->
            <el-form-item
              v-if="isSecondaryCollege && availableOwnerDepts.length > 0"
              label="归属部门"
            >
              <el-select
                v-model="filterOwnerDept"
                :class="{ 'owner-dept-guide': !filterOwnerDept }"
                placeholder="请先选择归属部门（提交上报前必选）"
                clearable
                style="width: 200px"
              >
                <el-option
                  v-for="dept in availableOwnerDepts"
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
            <!-- 2026-10-30 三页统一：周期态走共享 ReportCycleTag（当前填报周期：YYYY年M月），
                 状态态（已回退/各月份已上报完毕/未填报降级）保留旧 tag 文案 -->
            <ReportCycleTag
              v-if="monthlySequenceStatusMeta.month"
              :month="monthlySequenceStatusMeta.month"
              :type="monthlySequenceStatusMeta.type"
            />
            <el-tag
              v-else
              size="small"
              class="overall-status-tag"
              :type="monthlySequenceStatusMeta.type"
            >
              {{ monthlySequenceStatusMeta.label }}
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
                  <!-- 2026-10-31（角标口径「轮到我」配套）：注明当前在等谁审批，
                       与「可审批人」互补——名单是范围，这里是实例已定的当前审批人 -->
                  <div v-if="currentApprovalApproverName" class="approval-status-card__row">
                    <span class="approval-status-card__label">当前等待</span>
                    <span class="approval-status-card__value">
                      {{ currentApprovalApproverName }} 审批
                    </span>
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
              <!-- 2026-11-25（指标填报导入式上报）：单归口导入（05）——
                   显示口径沿用协作者 PR #145（学院视角即显示）；
                   仍保留「须先选归属部门」的置灰引导（单归口只提交所选那条线）。 -->
              <el-tooltip
                v-if="isSecondaryCollege"
                :content="filterOwnerDept ? '导入本归属部门的填报数据' : '请先选择归属部门，再导入'"
                :disabled="Boolean(filterOwnerDept)"
                effect="dark"
                placement="top"
              >
                <span style="display: inline-block">
                  <el-button
                    size="small"
                    :disabled="!filterOwnerDept"
                    @click="openReportFillImport('college-single', currentFunctionalOrgId ?? null)"
                  >
                    <el-icon><Upload /></el-icon>
                    导入
                  </el-button>
                </span>
              </el-tooltip>
              <!-- 一键提交按钮（2026-11-15 用户拍板「隐藏改主动引导」②：批量操作区内
                   **始终渲染**，草稿态/归属部门/未来月三条件从 v-if 不渲染改为原生
                   disabled + el-tooltip 说明缺什么（与一键撤回同款结构，PR#110 模式），
                   tooltip 文案 = submitAllButtonDisabledReason（单一事实源，优先级
                   部门 > 未来月 > 草稿，见 lib/reportSubmitGate.ts）；条件满足即恢复
                   可点，点击链路不变（handleSubmitAllGate → handleSubmitAll，内部守卫
                   保留作双保险）；服务端提交门禁照旧兜底（409 不变） -->
              <el-tooltip
                :content="submitAllDisabledTitle"
                :disabled="!submitAllButtonDisabledReason"
                effect="dark"
                placement="top"
              >
                <span style="display: inline-block">
                  <el-button
                    type="primary"
                    size="small"
                    :disabled="Boolean(submitAllButtonDisabledReason)"
                    @click="handleSubmitAllGate"
                  >
                    <el-icon><Upload /></el-icon>
                    一键提交
                  </el-button>
                </span>
              </el-tooltip>
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

            <!-- 2026-11-17 领导界面优化（截图批注「滚动窗口竖直拉长」）：表格滚动区
                 竖直拉长到占满视口剩余高度——高度链 = 页面容器 calc(100vh - 264px)
                 （与战略任务管理页同一常量，见 IndicatorListView.css 顶部注释）→
                 table-card / table-body / table-container 逐级 flex:1 传下来，
                 el-table 用 height="100%" 吃满容器（Element Plus 对百分比字符串
                 原样落到根元素 style.height，再由内部 ResizeObserver 量 offsetHeight
                 切分表头/表体），表体内部滚动、表头钉住。窗口缩放自适应（纯 CSS
                 视口计算 + el-table 自身 observer，无 JS 参与高度）。 -->
            <el-table
              v-else-if="indicators.length > 0"
              ref="tableRef"
              v-loading="isLoadingPlanDetails"
              :data="indicators"
              :span-method="getSpanMethod"
              border
              highlight-current-row
              class="unified-table"
              height="100%"
              @selection-change="handleSelectionChange"
            >
              <!-- 2026-10-28 华年定案：三个页面列宽/顺序必须与「战略任务管理」页面完全一致。
                   战略任务列改为与基准页相同的固定宽度（140），核心指标列取基准页的 min-width（210），
                   剩余宽度由核心指标列吃掉，表格仍铺满容器。取值统一在 TASK_TABLE_COLUMN_WIDTH。 -->
              <!-- 2026-11-18 用户拍板（外部反馈三问题·学院删列）：学院视角「战略任务」列也不显示
                   （此前已删核心指标列，子指标纯平铺、无分组列，getSpanMethod 学院分支随之不合并）；
                   职能部门/战略部视角零变化（showStrategicTaskColumn 仅对学院收窄）。 -->
              <el-table-column
                v-if="showStrategicTaskColumn"
                prop="taskContent"
                label="战略任务"
                :width="TASK_TABLE_COLUMN_WIDTH.strategicTask"
              >
                <template #default="{ row }">
                  <!-- 2026-10-19 用户定案：上方=任务属性，右侧竖排看板=截断全文，两框互不干扰 -->
                  <el-tooltip
                    :content="row.type2 === '发展性' ? '发展性任务' : '基础性任务'"
                    placement="top"
                  >
                    <FullTextPanel :text="row.taskContent || '未关联任务'">
                      <span
                        class="task-content-colored"
                        :style="{ color: getTaskTypeColor(row.type2) }"
                        >{{ row.taskContent || '未关联任务' }}</span
                      >
                    </FullTextPanel>
                  </el-tooltip>
                </template>
              </el-table-column>
              <!-- 2026-10-28 华年定案：核心指标列取基准页 min-width（210），吃掉剩余宽度。
                   2026-10-28 用户定案：学院端该列展示的是子指标（职能部门下发），
                   列名改「子指标名称」，宽度取子指标列基准（192） -->
              <el-table-column
                prop="name"
                :label="isSecondaryCollege ? '子指标名称' : '核心指标'"
                :min-width="
                  isSecondaryCollege
                    ? TASK_TABLE_COLUMN_WIDTH.subIndicatorMin
                    : TASK_TABLE_COLUMN_WIDTH.coreIndicatorMin
                "
              >
                <template #default="{ row }">
                  <!-- 2026-10-24 用户定案：填报页字段一律只读，不能双击编辑——
                       填报人只能通过最右侧操作栏「填报」进入填报弹窗 -->
                  <div class="indicator-name-cell">
                    <el-tooltip
                      :content="row.type1 === '定性' ? '定性指标' : '定量指标'"
                      placement="top"
                    >
                      <FullTextPanel :text="row.name || ''">
                        <span
                          class="indicator-name-text"
                          :class="
                            row.type1 === '定性'
                              ? 'indicator-qualitative'
                              : 'indicator-quantitative'
                          "
                          >{{ row.name || '' }}</span
                        >
                      </FullTextPanel>
                    </el-tooltip>

                    <!-- D10：异动/改名历史徽标（悬停看历史，无变更自动隐藏）
                         2026-10-30 用户定案：徽标按被改字段分流，权重异动不计入指标名徽标；
                         角标统一落在单元格右上角（.indicator-row-badge 绝对定位） -->
                    <MutationBadgePopover
                      v-if="row.id"
                      class="indicator-row-badge"
                      :indicator-id="row.id"
                      :fields="MUTATION_FIELDS_INDICATOR_NAME"
                    />
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
                  <div class="weight-cell">
                    <el-input
                      v-if="editingIndicatorId === row.id && editingIndicatorField === 'weight'"
                      v-model="editingIndicatorValue"
                      v-focus
                      size="small"
                      style="width: 50px"
                      @blur="saveIndicatorEdit(row, 'weight')"
                    />
                    <span v-else class="weight-text">{{ row.weight }}</span>
                    <!-- 2026-10-30 用户定案：权重异动角标落在「权重这一格」的右上角 -->
                    <div class="weight-cell__badge">
                      <MutationBadgePopover
                        v-if="row.id"
                        :indicator-id="row.id"
                        :fields="MUTATION_FIELDS_WEIGHT"
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
                  <el-tag
                    v-if="row.selfRating"
                    :type="row.selfRating === 'DELAYED' ? 'warning' : 'success'"
                    size="small"
                  >
                    {{
                      { AHEAD: '超前完成', NORMAL: '正常', DELAYED: '滞后' }[row.selfRating] ||
                      row.selfRating
                    }}
                  </el-tag>
                  <span v-else style="color: #909399">—</span>
                </template>
              </el-table-column>
              <el-table-column
                label="审核进度"
                :width="TASK_TABLE_COLUMN_WIDTH.appraisalLevel"
                align="center"
                header-align="center"
                label-class-name="manual-level-header"
              >
                <template #default="{ row }">
                  <!-- 2026-10-30 P0-3 → 2026-11-19 定稿：审批链行内鉴定（三视图同构）。
                       统一为共享行内下拉组件：点击格子才解锁下拉，选完即存，无弹窗层；
                       不可评定时显示只读值 + 悬停说明原因；空值显示「未评定」。 -->
                  <AppraisalLevelCell
                    :indicator-id="row.id"
                    :level="getIndicatorAppraisalLevel(row.id, row.manualAlertSeverity)"
                    :context="getIndicatorAppraisalContext(row.id)"
                    :appraisal="appraisalApi"
                  />
                </template>
              </el-table-column>
              <!-- 2026-10-26 用户定案：上报资料列悬浮显示附件卡片（序号+文件名+类型），
                   点击文件名直接下载；与指标分发页同构（ReportMaterialsCell）。
                   2026-10-29 用户定案：维持「上报资料 → 进度说明」顺序，与战略任务管理页一致
                   （曾短暂对调过一次，同日撤回）。 -->
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
              <!-- 2026-10-20 用户定案：进度说明不占太大位置——固定宽度，
                   剩余空间让给战略任务/核心指标两列 -->
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
                    <span class="pending-remark-text">{{ row.pendingRemark || '—' }}</span>
                  </el-tooltip>
                </template>
              </el-table-column>
              <el-table-column label="操作" :width="TASK_TABLE_COLUMN_WIDTH.actions" align="center">
                <template #default="{ row }">
                  <div class="action-cell">
                    <div class="action-buttons">
                      <el-button link type="primary" size="small" @click="handleViewDetail(row)"
                        >查看</el-button
                      >
                      <!-- 2026-10-24 用户定案：填报/编辑按钮只属于填报人角色——
                           此前只判 !isStrategicDept，导致职能部门/学院的审核人也能看到并进入填报。 -->
                      <!-- 2026-10-26 用户定案：提交审批后填报内容仍可实时编辑保存
                           （updateReport 实时更新，审批详情同步可见）；锁定的只是
                           「发起审批」（一键提交按钮非 draft 态置灰 + 后端 409 兜底）。
                           故填报按钮不再按 report-lock 锁死，仅保留角色与只读期限制。 -->
                      <el-button
                        v-if="!isStrategicDept && isCurrentUserReporter"
                        link
                        :type="hasReportContent(row) ? 'info' : 'success'"
                        size="small"
                        :disabled="
                          timeContext.isReadOnly ||
                          (isCurrentPlanReportLocked && hasReportContent(row))
                        "
                        :title="
                          isCurrentPlanReportLocked && hasReportContent(row)
                            ? '本月已上报，请于下月填报下月进度'
                            : undefined
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

            <!-- 2026-11-18（学院未选归口=行集置空，用户定案）：学院未选归属部门时
                 空态显示引导文案（与琥珀描边选择器同范式指路）；其余场景走既有文案 -->
            <el-empty
              :description="collegeFillEmptyHint || (shouldShowPlanWarning ? '' : '暂无指标数据')"
            >
            </el-empty>
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
          <!-- 2026-10-24 用户定案：自评进度与审核进度并列展示（前者填报告知，后者上级鉴定） -->
          <el-descriptions-item label="自评进度">
            <el-tag v-if="(currentDetail as any).selfRating" size="small" type="info">
              {{
                { AHEAD: '超前完成', NORMAL: '正常', DELAYED: '滞后' }[
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
          <el-descriptions-item v-if="shouldShowDetailResponsibleDept" label="责任部门">
            {{ currentDetail.responsibleDept || '未分配' }}
          </el-descriptions-item>
          <el-descriptions-item v-if="showOwnerDeptDetail" label="来源部门">
            {{ currentDetail.ownerDept || '未知' }}
          </el-descriptions-item>
          <el-descriptions-item label="创建时间" :span="2">{{
            formatDetailDate(currentDetail.createTime)
          }}</el-descriptions-item>
          <el-descriptions-item label="进度说明" :span="2">{{
            latestFillNote || '—'
          }}</el-descriptions-item>
        </el-descriptions>

        <div v-if="currentDetailAttachmentItems.length > 0" class="detail-attachments">
          <div class="divider"></div>
          <h4>相关上报资料</h4>
          <div class="detail-attachments__list">
            <!-- 2026-10-26 用户反馈：单击即下载（此前仅双击可打开，用户以为点不动）。
                 双击保留预览（图片/PDF 走新标签页），下载走 attachmentId 通道。 -->
            <button
              v-for="(attachment, index) in currentDetailAttachmentItems"
              :key="`${attachment.attachmentId || attachment.url}-${index}`"
              type="button"
              class="detail-attachments__item"
              :title="`点击下载 ${attachment.name}（双击可预览）`"
              @click.prevent.stop="downloadDisplayAttachmentItem(attachment)"
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
            :indicator-name="currentDetail?.name"
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
        </div>

        <el-divider />

        <!-- 2026-10-19 用户定案：归属月份属整体计划上报口径（列表层展示），
             单个指标的填报弹窗不再重复展示月份横幅。 -->
        <!-- 填报表单 -->
        <!-- 2026-11-14（用户反馈）：label-width 100px 放不下「上报资料（可选）」——
             8 个全角字符 ×14px = 112px 压线，加 padding 必折行。加宽到 124px 留余量 -->
        <el-form label-width="124px" class="report-form">
          <el-form-item label="自评进度" required>
            <el-select
              v-model="reportForm.selfRating"
              placeholder="请自评进度"
              style="width: 200px"
            >
              <el-option label="超前完成" value="AHEAD" />
              <el-option label="正常" value="NORMAL" />
              <el-option label="滞后" value="DELAYED" />
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
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt"
              :on-change="handleReportFileChange"
              :on-remove="handleReportFileRemove"
              :before-upload="beforeReportUpload"
            >
              <el-button size="small" type="primary" plain>选择文件</el-button>
              <template #tip>
                <div class="upload-tip">
                  支持 PDF、Word、Excel、图片、TXT 格式，单个文件不超过
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

    <!-- 二级学院「全部导出」部门选择弹窗 -->
    <el-dialog
      v-model="collegeExportDialogVisible"
      title="选择导出部门"
      width="520px"
      :close-on-click-modal="!collegeBatchExporting"
    >
      <div class="college-export-dialog-body">
        <el-checkbox
          :model-value="allCollegeExportDepartmentsSelected"
          :indeterminate="collegeExportDepartmentsIndeterminate"
          @change="toggleAllCollegeExportDepartments"
        >
          全选部门
        </el-checkbox>
        <el-checkbox-group
          v-model="selectedCollegeExportDepartments"
          class="college-export-selection-list"
        >
          <el-checkbox v-for="dept in availableOwnerDepts" :key="dept" :value="dept">
            {{ dept }}
          </el-checkbox>
        </el-checkbox-group>
      </div>
      <template #footer>
        <el-button :disabled="collegeBatchExporting" @click="collegeExportDialogVisible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="collegeBatchExporting"
          @click="handleExportAllCollegeDepartments"
        >
          导出
        </el-button>
      </template>
    </el-dialog>

    <!-- 2026-11-25（指标填报导入式上报 · 学院侧）：Excel 批量填报弹窗 -->
    <ReportFillImportDialog
      v-model:visible="reportFillImportVisible"
      :variant="reportFillImportVariant"
      :cycle-id="reportFillCycleId"
      :default-report-month="reportFillMonth"
      :responsible-org-name="reportFillCollegeName || ''"
      :target-org-id="reportFillTargetOrgId"
      @committed="handleReportFillImported"
    />
  </div>
</template>

<style scoped src="./IndicatorListView.css"></style>
