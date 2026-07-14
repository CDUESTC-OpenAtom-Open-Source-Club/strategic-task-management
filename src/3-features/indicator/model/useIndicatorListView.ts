import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import {
  Plus,
  View,
  Download,
  Delete as _Delete,
  ArrowDown as _ArrowDown,
  Promotion,
  RefreshLeft,
  Check,
  Close,
  Upload,
  Edit,
  Refresh
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadProps, UploadUserFile } from 'element-plus'
import type { ElTable } from 'element-plus'
/* eslint-disable no-restricted-syntax -- Backend-aligned types */
import type {
  StrategicTask as _StrategicTask,
  StrategicIndicator,
  Plan,
  Attachment
} from '@/shared/types'
/* eslint-enable no-restricted-syntax */
import { useStrategicStore } from '@/features/task/model/strategic'
import { useAuthStore } from '@/features/auth/model/store'
import { useTimeContextStore } from '@/shared/lib/timeContext'
import { useApprovalStore } from '@/features/approval/model/store'
import { useApprovalRouteAutopen } from '@/features/approval/lib'
import { resolveIndicatorYear } from '@/shared/lib/utils/indicatorYear'
import {
  getProgressStatus,
  getProgressColor as _getProgressColor,
  getStatusTagType as _getStatusTagType
} from '@/shared/lib/utils'
import { useOrgStore } from '@/features/organization/model/store'
import { usePlanStore } from '@/features/plan/model/store'
import { indicatorFillApi } from '@/features/plan/api/planApi'
import { getUsersByOrgId } from '@/features/user/api/query'
import { ApprovalProgressDrawer } from '@/features/approval'
import { approveTask, rejectTask } from '@/features/workflow/api'
import { getWorkflowDefinitionPreviewByCode } from '@/features/workflow/api'
import {
  getWorkflowInstanceDetail,
  getWorkflowInstanceDetailByBusiness
} from '@/features/workflow/api/queries'
import type {
  WorkflowDefinitionPreviewResponse,
  WorkflowInstanceDetailResponse,
  WorkflowTaskResponse
} from '@/features/workflow/api/types'
import { useDataValidator } from '@/shared/lib/validation/dataValidator'
import { getPlanStatusDisplay, normalizePlanStatus } from '@/features/task/lib/planStatus'
import { logger } from '@/shared/lib/utils/logger'
import { apiClient, apiService } from '@/shared/api'
import { buildQueryKey, invalidateQueries } from '@/shared/lib/utils/cache'
import {
  GLOBAL_DATA_REFRESH_REQUEST_EVENT,
  type GlobalDataRefreshDetail
} from '@/5-shared/lib/dataFreshness'
import { resolveMilestoneDisplayState } from '@/shared/lib/utils/milestoneDisplay'
import { sortMilestonesByProgress } from '@/shared/lib/utils/milestoneSort'
import {
  canCurrentUserHandleIndicatorWorkflow,
  getIndicatorWorkflowStatusLabel,
  getIndicatorWorkflowTagType,
  resolveLatestIndicatorWorkflowSnapshot,
  type IndicatorWorkflowSnapshot
} from '@/features/plan/lib/indicatorWorkflow'
import { filterIndicatorsForViewerRole } from '@/features/indicator/lib/scope'
import {
  isCollegePlanCandidate,
  listCollegePlanSourceDepts,
  resolveCollegePlanSourceDept
} from '@/features/indicator/lib/collegePlanModule'
import { canViewReceivedPlanContent as canViewReceivedPlanContentByStatus } from '@/features/indicator/lib/visibility'
import {
  milestoneDefaultValues as _milestoneDefaultValues,
  MILESTONE_STATUS_VALUES,
  PROGRESS_APPROVAL_STATUS_VALUES,
  type ProgressApprovalStatusValue
} from '@/shared/config/validationRules'

interface PersistedIndicatorDraft {
  indicatorId: string
  progress: number
  remark: string
  attachments: string[]
  attachmentDetails?: Attachment[]
  savedAt: string
}

interface ReportUploadFile extends UploadUserFile {
  attachmentId?: number
}

interface DisplayAttachmentItem {
  name: string
  url: string
  attachmentId?: number
}

class AttachmentUploadError extends Error {
  cause: unknown

  constructor(message: string, cause: unknown) {
    super(message)
    this.name = 'AttachmentUploadError'
    this.cause = cause
  }
}

// --- 自定义指令，用于自动聚焦 ---
const vFocus = {
  mounted: (el: HTMLElement) => {
    const input = el.querySelector('input') || el.querySelector('textarea')
    if (input) {
      input.focus()
    } else {
      el.focus()
    }
  }
}

export interface IndicatorListViewProps {
  viewingRole?: string
  viewingDept?: string
}

export function useIndicatorListView(props: IndicatorListViewProps) {
  // 使用共享 Store
  const strategicStore = useStrategicStore()
  const authStore = useAuthStore()
  const timeContext = useTimeContextStore()
  const approvalStore = useApprovalStore()
  const planStore = usePlanStore()
  const orgStore = useOrgStore()
  const indicatorRefreshTick = ref(0)
  let globalDataRefreshPromise: Promise<void> | null = null

  // 内部刷新信号（可通过暴露给子组件，或在 computed 强制依赖它）
  // 注意：不要去 watch 这个值再调用 refresh()，否则会死循环！
  const currentUserId = computed(() => Number(authStore.user?.userId ?? 0))
  const currentDraftOwnerKey = computed(() => {
    const userId = authStore.user?.userId ?? authStore.user?.id
    const username = authStore.user?.username ?? authStore.userName
    const orgId = authStore.user?.orgId ?? authStore.user?.department
    const ownerParts = [userId, username, orgId].filter(
      value => value !== undefined && value !== null && value !== ''
    )
    return ownerParts.length > 0 ? ownerParts.join(':') : 'anonymous'
  })
  const currentUserPermissionCodes = computed(() => {
    const permissions = (authStore.user as { permissions?: unknown[] } | null)?.permissions
    if (!Array.isArray(permissions)) {
      return []
    }
    return permissions
      .map(permission => (typeof permission === 'string' ? permission.trim() : ''))
      .filter(Boolean)
  })
  const currentUserRoleCodes = computed(() => {
    const roles = (authStore.user as { roles?: unknown[] } | null)?.roles
    if (!Array.isArray(roles)) {
      return []
    }
    return roles.map(role => (typeof role === 'string' ? role.trim() : '')).filter(Boolean)
  })
  const currentUserOrgId = computed(() => {
    const rawOrgId = Number((authStore.user as { orgId?: string | number } | null)?.orgId ?? NaN)
    return Number.isFinite(rawOrgId) && rawOrgId > 0 ? rawOrgId : 0
  })

  const isCurrentUserReporter = computed(() => {
    const user = authStore.user as {
      username?: unknown
      realName?: unknown
      name?: unknown
      roles?: unknown
    } | null

    const username = String(user?.username ?? '')
      .trim()
      .toLowerCase()
    const realName = String(user?.realName ?? user?.name ?? '').trim()
    const roles = Array.isArray(user?.roles)
      ? user!.roles
          .map(role => (typeof role === 'string' ? role.trim().toUpperCase() : ''))
          .filter(Boolean)
      : []

    return (
      roles.includes('ROLE_REPORTER') || username.endsWith('_report') || realName.includes('填报人')
    )
  })

  function getIndicatorDraftStorageKey(indicatorId: number | string): string {
    return `indicator-draft:${timeContext.currentYear}:${currentDraftOwnerKey.value}:${String(indicatorId)}`
  }

  function readPersistedIndicatorDraft(
    indicatorId: number | string
  ): PersistedIndicatorDraft | null {
    if (typeof window === 'undefined') {
      return null
    }

    try {
      const raw = window.localStorage.getItem(getIndicatorDraftStorageKey(indicatorId))
      if (!raw) {
        return null
      }

      const parsed = JSON.parse(raw) as Partial<PersistedIndicatorDraft>
      if (!parsed || typeof parsed !== 'object') {
        return null
      }

      const progress = Number(parsed.progress)
      return {
        indicatorId: String(parsed.indicatorId ?? indicatorId),
        progress: Number.isFinite(progress) ? progress : 0,
        remark: String(parsed.remark ?? ''),
        attachments: Array.isArray(parsed.attachments)
          ? parsed.attachments.map(item => String(item))
          : [],
        attachmentDetails: Array.isArray(parsed.attachmentDetails)
          ? (parsed.attachmentDetails as Attachment[])
          : [],
        savedAt: String(parsed.savedAt ?? '')
      }
    } catch (error) {
      logger.warn('[IndicatorListView] 读取本地指标草稿失败:', { indicatorId, error })
      return null
    }
  }

  function persistIndicatorDraft(
    indicatorId: number | string,
    draft: Omit<PersistedIndicatorDraft, 'indicatorId' | 'savedAt'>
  ): void {
    if (typeof window === 'undefined') {
      return
    }

    try {
      const payload: PersistedIndicatorDraft = {
        indicatorId: String(indicatorId),
        progress: Number(draft.progress) || 0,
        remark: draft.remark || '',
        attachments: Array.isArray(draft.attachments) ? draft.attachments : [],
        attachmentDetails: Array.isArray(draft.attachmentDetails) ? draft.attachmentDetails : [],
        savedAt: new Date().toISOString()
      }
      window.localStorage.setItem(getIndicatorDraftStorageKey(indicatorId), JSON.stringify(payload))
    } catch (error) {
      logger.warn('[IndicatorListView] 保存本地指标草稿失败:', { indicatorId, error })
    }
  }

  function clearPersistedIndicatorDraft(indicatorId: number | string): void {
    if (typeof window === 'undefined') {
      return
    }

    try {
      window.localStorage.removeItem(getIndicatorDraftStorageKey(indicatorId))
    } catch (error) {
      logger.warn('[IndicatorListView] 清理本地指标草稿失败:', { indicatorId, error })
    }
  }

  onMounted(async () => {
    await Promise.allSettled([
      orgStore.loadDepartments(),
      planStore.loadPlans({ background: true }),
      strategicStore.loadIndicatorsByYear(timeContext.currentYear)
    ])

    await loadCollegePlanDetails()
    restartPlanApprovalPolling()
    if (typeof window !== 'undefined') {
      window.addEventListener(
        GLOBAL_DATA_REFRESH_REQUEST_EVENT,
        handleGlobalDataRefreshRequest as EventListener
      )
    }
  })

  onUnmounted(() => {
    reportAttachmentObjectUrls.forEach(url => {
      window.URL.revokeObjectURL(url)
    })
    reportAttachmentObjectUrls.clear()

    if (planApprovalPollTimer) {
      clearInterval(planApprovalPollTimer)
      planApprovalPollTimer = null
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener(
        GLOBAL_DATA_REFRESH_REQUEST_EVENT,
        handleGlobalDataRefreshRequest as EventListener
      )
    }
  })

  const handleGlobalDataRefreshRequest = (event: Event) => {
    if (globalDataRefreshPromise) {
      return
    }

    const detail = (event as CustomEvent<GlobalDataRefreshDetail>).detail
    globalDataRefreshPromise = (async () => {
      logger.info('[IndicatorListView] handling global data refresh request', detail)
      await refreshIndicatorListAfterMutation()
    })().finally(() => {
      globalDataRefreshPromise = null
    })
  }

  // 使用数据验证器 - 用于验证里程碑数据完整性
  // @requirement 2.4 - Milestone data validation with complete fields
  const { validateMilestone, safeGet, validateEnum } = useDataValidator({ logErrors: true })

  // ============================================================================
  // 审批状态枚举值验证与容错处理
  // @requirement 2.6 - progressApprovalStatus enum validation
  // ============================================================================

  /**
   * 默认审批状态值 - 当状态无效时使用
   */
  const DEFAULT_APPROVAL_STATUS: ProgressApprovalStatusValue = 'NONE'
  const PLAN_REPORT_UI_STATE_KEY = 'indicator-plan-report-ui-state'

  function readPlanReportUiState(): 'submitted' | 'withdrawn' | null {
    if (typeof window === 'undefined') {
      return null
    }

    try {
      const value = window.sessionStorage.getItem(PLAN_REPORT_UI_STATE_KEY)
      return value === 'submitted' || value === 'withdrawn' ? value : null
    } catch {
      return null
    }
  }

  function writePlanReportUiState(value: 'submitted' | 'withdrawn' | null): void {
    if (typeof window === 'undefined') {
      return
    }

    try {
      if (value) {
        window.sessionStorage.setItem(PLAN_REPORT_UI_STATE_KEY, value)
      } else {
        window.sessionStorage.removeItem(PLAN_REPORT_UI_STATE_KEY)
      }
    } catch {
      // ignore sessionStorage failure
    }
  }

  /**
   * 安全获取审批状态值
   *
   * 检查 progressApprovalStatus 是否为有效枚举值，无效时返回默认值 'NONE'
   * 确保 UI 不会因为无效状态值而崩溃
   *
   * @param status - 原始状态值
   * @returns 有效的审批状态值
   *
   * @requirement 2.6 - progressApprovalStatus enum validation
   */
  function getSafeApprovalStatus(status: unknown): ProgressApprovalStatusValue {
    // 如果状态为空或未定义，返回默认值
    if (status === null || status === undefined || status === '') {
      return DEFAULT_APPROVAL_STATUS
    }

    // 验证是否为有效枚举值
    if (validateEnum(status, PROGRESS_APPROVAL_STATUS_VALUES)) {
      return status as ProgressApprovalStatusValue
    }

    // 无效状态值，记录警告并返回默认值
    console.warn(
      `[IndicatorListView] 无效的审批状态值: "${status}"，使用默认值 "${DEFAULT_APPROVAL_STATUS}"`
    )
    return DEFAULT_APPROVAL_STATUS
  }

  /**
   * 检查指标是否处于指定的审批状态
   *
   * @requirement: Plan-centric status - 改为检查 Plan 的状态，而不是单个指标的状态
   * 一个 Plan 下的所有指标共享同一个 Plan 的状态
   *
   * @param _indicator - 指标对象（保留参数以保持兼容性，但不再使用）
   * @param targetStatus - 目标状态或状态数组
   * @returns 是否匹配目标状态
   */
  function isApprovalStatus(
    indicator: StrategicIndicator,
    targetStatus: ProgressApprovalStatusValue | ProgressApprovalStatusValue[]
  ): boolean {
    const indicatorStatus = getSafeApprovalStatus(indicator.progressApprovalStatus)
    if (indicatorStatus !== 'NONE') {
      if (Array.isArray(targetStatus)) {
        return targetStatus.includes(indicatorStatus)
      }

      return indicatorStatus === targetStatus
    }

    // @requirement: Plan-centric - 使用 Plan 的状态作为当前页面的提交态来源。
    // 对职能部门/学院页面来说，DISTRIBUTED 代表“已下发，待本部门填写并提交”，
    // 不能误判为已经审批通过或不可再次填报。
    let effectiveStatus: ProgressApprovalStatusValue = 'DRAFT'

    if (usePlanReportFlow.value) {
      const reportStatus = normalizedCurrentPlanReportStatus.value
      switch (reportStatus) {
        case 'PENDING':
        case 'IN_REVIEW':
        case 'SUBMITTED':
          effectiveStatus = 'PENDING'
          break
        case 'APPROVED':
          effectiveStatus = 'APPROVED'
          break
        case 'REJECTED':
          effectiveStatus = 'REJECTED'
          break
        default:
          effectiveStatus = 'DRAFT'
      }
    } else {
      const planStatus = normalizedCurrentPlanStatus.value
      switch (planStatus) {
        case 'PENDING':
          effectiveStatus = 'PENDING'
          break
        case 'DISTRIBUTED':
        case 'DRAFT':
        case null:
          effectiveStatus = 'DRAFT'
          break
        case 'active':
          effectiveStatus = 'APPROVED'
          break
        default:
          effectiveStatus = 'DRAFT'
      }
    }

    if (Array.isArray(targetStatus)) {
      return targetStatus.includes(effectiveStatus)
    }

    return effectiveStatus === targetStatus
  }

  // 接收父组件传递的选中角色和部门

  // 当前有效角色与部门（支持独立页面直接访问，不依赖外层传参）
  const effectiveViewingRole = computed(
    () => props.viewingRole || authStore.effectiveRole || authStore.userRole || ''
  )
  const effectiveViewingDept = computed(() => {
    return props.viewingDept || authStore.effectiveDepartment || authStore.userDepartment || ''
  })

  // 判断当前是否为战略发展部角色
  const isStrategicDept = computed(() => {
    return effectiveViewingRole.value === 'strategic_dept'
  })

  // 判断当前是否为二级学院角色
  const isSecondaryCollege = computed(() => {
    return effectiveViewingRole.value === 'secondary_college'
  })

  // 判断当前是否为职能部门角色
  const isFunctionalDept = computed(() => {
    return effectiveViewingRole.value === 'functional_dept'
  })

  // 判断当前角色是否走 PlanReport 提交/撤回流程。
  // 规则：除战略发展部外，其它视角统一走 PlanReport，避免误操作 Plan 生命周期状态。
  const usePlanReportFlow = computed(() => {
    return !isStrategicDept.value
  })

  // 当前计划的状态
  const currentPlanStatus = computed(() => {
    return currentPlanDetails.value?.status || currentUserPlan.value?.status || null
  })

  const normalizedCurrentPlanStatus = computed(() => {
    return normalizePlanStatus(currentPlanStatus.value)
  })

  const hydratingPlanDetail = ref(false)

  async function hydrateCurrentPlanWorkflowState(options: { force?: boolean } = {}): Promise<void> {
    const planId = Number(currentPlanDetails.value?.id ?? currentUserPlanId.value ?? NaN)
    if (!Number.isFinite(planId) || planId <= 0) {
      return
    }

    const status = normalizedCurrentPlanStatus.value
    if (status !== 'PENDING' && status !== 'DISTRIBUTED') {
      return
    }

    const plan = currentPlanDetails.value as
      | ({
          canWithdraw?: boolean
          workflowInstanceId?: number
          currentTaskId?: number
        } & Record<string, unknown>)
      | null

    const needHydration =
      options.force ||
      (status === 'PENDING' && typeof plan?.canWithdraw !== 'boolean') ||
      plan?.workflowInstanceId == null ||
      plan?.currentTaskId == null

    if (!needHydration || hydratingPlanDetail.value) {
      return
    }

    hydratingPlanDetail.value = true
    try {
      await refreshCurrentPlanDetails(planId)
    } finally {
      hydratingPlanDetail.value = false
    }
  }

  const PLAN_APPROVAL_WORKFLOW_CODE_FUNCDEPT = 'PLAN_APPROVAL_FUNCDEPT'
  const PLAN_APPROVAL_WORKFLOW_CODE_COLLEGE = 'PLAN_APPROVAL_COLLEGE'
  const PLAN_DISPATCH_WORKFLOW_CODE_FUNCDEPT = 'PLAN_DISPATCH_FUNCDEPT'
  const PLAN_APPROVAL_POLL_INTERVAL_MS = 15000
  let planApprovalPollTimer: ReturnType<typeof setInterval> | null = null

  function getCurrentPlanId(): number | null {
    const planId = Number(currentPlanDetails.value?.id ?? currentUserPlanId.value ?? NaN)
    return Number.isFinite(planId) && planId > 0 ? planId : null
  }

  function resolvePlanApprovalWorkflowCode(): string | string[] {
    return isSecondaryCollege.value
      ? [PLAN_APPROVAL_WORKFLOW_CODE_COLLEGE, PLAN_DISPATCH_WORKFLOW_CODE_FUNCDEPT]
      : PLAN_APPROVAL_WORKFLOW_CODE_FUNCDEPT
  }

  async function refreshCurrentPlanDetails(planId: number): Promise<void> {
    const latestPlan = await planStore.loadPlanDetails(planId, { force: true, background: true })
    if (latestPlan) {
      currentPlanDetails.value = latestPlan
      if (isSecondaryCollege.value) {
        collegePlanDetailsMap.value = {
          ...collegePlanDetailsMap.value,
          [String(planId)]: latestPlan as Plan
        }
      }
    }
    await loadCurrentPlanReportSummary(planId)
    await loadCurrentPlanWorkflowDetail(planId)
  }

  async function loadCurrentPlanWorkflowDetail(planId?: number | null): Promise<void> {
    const resolvedPlanId = Number(planId ?? getCurrentPlanId() ?? NaN)
    const reportId = Number(currentPlanReportSummary.value?.id ?? NaN)
    const workflowInstanceId = Number(
      usePlanReportFlow.value
        ? (currentPlanReportSummary.value?.workflowInstanceId ?? NaN)
        : (currentPlanReportSummary.value?.workflowInstanceId ??
            currentPlanDetails.value?.workflowInstanceId ??
            NaN)
    )

    try {
      if (Number.isFinite(workflowInstanceId) && workflowInstanceId > 0) {
        const response = await getWorkflowInstanceDetail(String(workflowInstanceId))
        currentPlanWorkflowDetail.value = response.data ?? null
        return
      }

      if (usePlanReportFlow.value && Number.isFinite(reportId) && reportId > 0) {
        const response = await getWorkflowInstanceDetailByBusiness('PLAN_REPORT', reportId)
        currentPlanWorkflowDetail.value = response.data ?? null
        return
      }

      if (usePlanReportFlow.value) {
        currentPlanWorkflowDetail.value = null
        return
      }

      if (Number.isFinite(resolvedPlanId) && resolvedPlanId > 0) {
        const response = await getWorkflowInstanceDetailByBusiness('PLAN', resolvedPlanId)
        currentPlanWorkflowDetail.value = response.data ?? null
        return
      }
    } catch (error) {
      logger.warn('[IndicatorListView] 加载当前计划工作流详情失败:', {
        planId: resolvedPlanId,
        reportId,
        workflowInstanceId,
        error
      })
    }

    currentPlanWorkflowDetail.value = null
  }

  function clearCurrentPlanReportDerivedState(): void {
    if (!currentPlanDetails.value?.indicators?.length) {
      return
    }

    currentPlanDetails.value = {
      ...currentPlanDetails.value,
      indicators: currentPlanDetails.value.indicators.map((item: any) => {
        if (!item || typeof item !== 'object') {
          return item
        }

        const nextItem = { ...(item as Record<string, unknown>) }
        delete nextItem.reportProgress
        delete nextItem.report_progress
        delete nextItem.pendingProgress
        delete nextItem.pending_progress
        delete nextItem.pendingRemark
        delete nextItem.pending_remark
        delete nextItem.pendingAttachments
        delete nextItem.currentReportId
        delete nextItem.current_report_id

        return nextItem
      })
    }
  }

  async function loadCurrentPlanReportSummary(planId?: number | null): Promise<void> {
    if (!usePlanReportFlow.value) {
      currentPlanReportSummary.value = null
      latestPlanReportSummary.value = null
      return
    }

    const resolvedPlanId = Number(planId ?? getCurrentPlanId() ?? NaN)
    const reportOrgId = Number(currentViewingOrgId.value ?? NaN)
    if (
      !Number.isFinite(resolvedPlanId) ||
      resolvedPlanId <= 0 ||
      !Number.isFinite(reportOrgId) ||
      reportOrgId <= 0
    ) {
      currentPlanReportSummary.value = null
      latestPlanReportSummary.value = null
      return
    }

    try {
      currentPlanReportSummary.value = await indicatorFillApi.getCurrentMonthPlanReport(
        resolvedPlanId,
        reportOrgId
      )
      latestPlanReportSummary.value = await indicatorFillApi.getLatestCurrentMonthPlanReport(
        resolvedPlanId,
        reportOrgId
      )
      if (!currentPlanReportSummary.value) {
        clearCurrentPlanReportDerivedState()
      }

      const rawReportStatus = String(currentPlanReportSummary.value?.status || '')
        .trim()
        .toUpperCase()
      const rawWorkflowStatus = String(currentPlanReportSummary.value?.workflowStatus || '')
        .trim()
        .toUpperCase()
      const effectiveBackendStatus = rawWorkflowStatus || rawReportStatus
      if (
        pendingPlanReportUiState.value === 'submitted' &&
        ['SUBMITTED', 'PENDING', 'IN_REVIEW', 'APPROVED'].includes(effectiveBackendStatus)
      ) {
        pendingPlanReportUiState.value = null
        writePlanReportUiState(null)
      }
      if (
        pendingPlanReportUiState.value === 'withdrawn' &&
        (rawReportStatus === 'DRAFT' || rawWorkflowStatus === 'WITHDRAWN')
      ) {
        pendingPlanReportUiState.value = null
        writePlanReportUiState(null)
      }
    } catch (error) {
      currentPlanReportSummary.value = null
      latestPlanReportSummary.value = null
      clearCurrentPlanReportDerivedState()
      logger.warn('[IndicatorListView] 加载当前上报摘要失败:', {
        planId: resolvedPlanId,
        reportOrgId,
        error
      })
    }
  }

  async function pollCurrentPlanApprovalState(): Promise<void> {
    const planId = getCurrentPlanId()
    if (!planId || document.hidden) {
      return
    }

    try {
      await refreshCurrentPlanDetails(planId)
    } catch (error) {
      logger.warn('[IndicatorListView] 轮询计划审批状态失败:', { planId, error })
    }
  }

  function restartPlanApprovalPolling(): void {
    if (planApprovalPollTimer) {
      clearInterval(planApprovalPollTimer)
      planApprovalPollTimer = null
    }

    if (!getCurrentPlanId()) {
      return
    }

    planApprovalPollTimer = setInterval(() => {
      void pollCurrentPlanApprovalState()
    }, PLAN_APPROVAL_POLL_INTERVAL_MS)
  }

  function formatDetailDate(time: string | Date | undefined): string {
    if (!time) {
      return '-'
    }

    const date = new Date(time)
    if (Number.isNaN(date.getTime())) {
      return String(time).slice(0, 10) || '-'
    }

    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  // 判断计划是否处于草稿状态
  const isPlanDraft = computed(() => {
    return (
      normalizedCurrentPlanStatus.value === 'DRAFT' || normalizedCurrentPlanStatus.value === null
    )
  })

  // 判断计划是否已下发
  const isPlanDistributed = computed(() => {
    return normalizedCurrentPlanStatus.value === 'DISTRIBUTED'
  })

  const shouldShowDetailLifecycleTag = computed(() => {
    return isStrategicDept.value && (isPlanDraft.value || isPlanDistributed.value)
  })

  const shouldShowDetailResponsibleDept = computed(() => {
    return isStrategicDept.value
  })

  const normalizedCurrentPlanWorkflowStatus = computed(() => {
    return String(currentPlanDetails.value?.workflowStatus || '')
      .trim()
      .toUpperCase()
  })

  const canViewReceivedPlanContent = computed(() => {
    if (!hasCurrentUserPlanData.value) {
      return false
    }

    return canViewReceivedPlanContentByStatus(currentPlanStatus.value, isStrategicDept.value)
  })

  // 判断是否可以编辑（只有战略发展部可以编辑，且计划处于草稿状态，历史年份只读）
  const canEdit = computed(() => {
    return (
      authStore.userRole === 'strategic_dept' &&
      isStrategicDept.value &&
      !timeContext.isReadOnly &&
      isPlanDraft.value
    )
  })

  // 是否显示责任部门列（只有战略发展部才显示）
  const showResponsibleDeptColumn = computed(() => isStrategicDept.value)
  const showOwnerDeptDetail = computed(() => isSecondaryCollege.value)

  // 当前选中任务索引
  const currentTaskIndex = ref(0)
  const isAddingOrEditing = ref(false)

  // 选中的部门
  const selectedDepartment = ref('')

  // 筛选条件
  const filterType2 = ref('') // 任务类型筛选
  const filterType1 = ref('') // 指标类型筛选
  const filterDept = ref('') // 责任部门筛选
  const filterOwnerDept = ref('') // 来源部门筛选（仅学院使用）
  const collegePlanDetailsMap = ref<Record<string, Plan>>({})
  const collegePlanDetailsLoading = ref(false)

  const collegePlanCandidates = computed<Plan[]>(() => {
    if (!isSecondaryCollege.value) {
      return []
    }

    return planStore.plans.filter(plan =>
      isCollegePlanCandidate(plan as Plan, {
        currentYear: timeContext.currentYear,
        viewingOrgId: currentViewingOrgId.value,
        viewingDept: effectiveViewingDept.value,
        resolvePlanYear: candidate => resolvePlanYear(candidate)
      })
    )
  })

  // 获取学院接收到的来源部门列表（从指标数据中提取）
  const availableOwnerDepts = computed(() => {
    if (!isSecondaryCollege.value || !effectiveViewingDept.value) {
      return []
    }

    const planSourceDepts = listCollegePlanSourceDepts(
      collegePlanCandidates.value.map(plan => {
        const cachedPlan = collegePlanDetailsMap.value[String(plan.id)]
        return (cachedPlan || plan) as Plan
      })
    )

    if (planSourceDepts.length > 0) {
      return planSourceDepts
    }

    const currentYear = timeContext.currentYear
    const realYear = timeContext.realCurrentYear

    // 获取当前学院作为责任部门的所有指标的来源部门
    const ownerDepts = new Set<string>()
    strategicStore.indicators.forEach(i => {
      const indicatorYear = resolveIndicatorYear(i, realYear)
      if (
        indicatorYear === currentYear &&
        i.responsibleDept === effectiveViewingDept.value &&
        i.ownerDept
      ) {
        ownerDepts.add(i.ownerDept)
      }
    })

    return Array.from(ownerDepts).sort()
  })

  const selectedCollegePlan = computed<Plan | null>(() => {
    if (!isSecondaryCollege.value) {
      return null
    }

    const selectedSourceDept = filterOwnerDept.value.trim()
    const matchedPlan = collegePlanCandidates.value.find(plan => {
      const cachedPlan = collegePlanDetailsMap.value[String(plan.id)]
      const sourceDept = resolveCollegePlanSourceDept((cachedPlan || plan) as Plan)

      if (!selectedSourceDept) {
        return Boolean(sourceDept) || collegePlanCandidates.value.length === 1
      }

      return sourceDept === selectedSourceDept
    })

    return matchedPlan || collegePlanCandidates.value[0] || null
  })

  // 初始化来源部门筛选（默认选中第一个）
  const initOwnerDeptFilter = () => {
    if (
      isSecondaryCollege.value &&
      availableOwnerDepts.value.length > 0 &&
      !filterOwnerDept.value
    ) {
      filterOwnerDept.value = availableOwnerDepts.value[0] ?? ''
    }
  }

  // 重置筛选条件
  const resetFilters = () => {
    filterType2.value = ''
    filterType1.value = ''
    filterDept.value = ''
    // 学院重置时恢复默认来源部门
    if (isSecondaryCollege.value && availableOwnerDepts.value.length > 0) {
      filterOwnerDept.value = availableOwnerDepts.value[0] ?? ''
    } else {
      filterOwnerDept.value = ''
    }
  }

  // 职能部门列表（从数据库动态获取）
  const functionalDepartments = computed(() => orgStore.getAllFunctionalDepartmentNames())

  const currentViewingOrgId = computed(() => {
    const viewingDept = effectiveViewingDept.value || authStore.userDepartment || ''
    if (!viewingDept) {
      const rawUserOrgId = Number(authStore.user?.orgId ?? NaN)
      return Number.isFinite(rawUserOrgId) && rawUserOrgId > 0 ? rawUserOrgId : null
    }

    const matchedDepartment = orgStore.getDepartmentByName(viewingDept)
    const matchedOrgId = Number(matchedDepartment?.id ?? NaN)
    if (Number.isFinite(matchedOrgId) && matchedOrgId > 0) {
      return matchedOrgId
    }

    const rawUserOrgId = Number(authStore.user?.orgId ?? NaN)
    return Number.isFinite(rawUserOrgId) && rawUserOrgId > 0 ? rawUserOrgId : null
  })

  async function loadCollegePlanDetails(options: { force?: boolean } = {}): Promise<void> {
    if (!isSecondaryCollege.value || collegePlanCandidates.value.length === 0) {
      collegePlanDetailsMap.value = {}
      return
    }

    if (collegePlanDetailsLoading.value) {
      return
    }

    const targetPlan = selectedCollegePlan.value || collegePlanCandidates.value[0] || null
    if (!targetPlan?.id) {
      return
    }

    const cacheKey = String(targetPlan.id)
    if (!options.force && collegePlanDetailsMap.value[cacheKey]) {
      return
    }

    collegePlanDetailsLoading.value = true
    try {
      const detailedPlan =
        (await planStore.loadPlanDetails(targetPlan.id, {
          force: options.force,
          background: true
        })) || targetPlan

      collegePlanDetailsMap.value = {
        ...collegePlanDetailsMap.value,
        [cacheKey]: detailedPlan as Plan
      }
    } catch (error) {
      logger.warn('[IndicatorListView] 加载学院计划详情失败:', error)
    } finally {
      collegePlanDetailsLoading.value = false
    }
  }

  function filterIndicatorsForCurrentViewer(list: StrategicIndicator[]): StrategicIndicator[] {
    const viewerRole = isStrategicDept.value
      ? 'strategic_dept'
      : isSecondaryCollege.value
        ? 'secondary_college'
        : 'functional_dept'

    return filterIndicatorsForViewerRole(
      list,
      viewerRole,
      currentViewingOrgId.value,
      canViewReceivedPlanContent.value
    )
  }

  const resolvePlanYear = (plan: any): number | null => {
    const explicitYear = plan?.cycle?.year ?? plan?.year
    if (explicitYear != null && explicitYear !== '') {
      return Number(explicitYear)
    }

    const cycleId = Number(plan?.cycleId)
    if (cycleId === 4 || cycleId === 90) {
      return 2026
    }
    if (cycleId === 7) {
      return 2025
    }

    return null
  }

  // 获取当前用户对应的 Plan（包含指标数据）
  const currentUserPlan = computed(() => {
    if (isSecondaryCollege.value) {
      const selectedPlan = selectedCollegePlan.value
      if (!selectedPlan) {
        return null
      }

      return collegePlanDetailsMap.value[String(selectedPlan.id)] || selectedPlan
    }

    // 获取当前用户所在的部门
    const userDept = effectiveViewingDept.value || authStore.userDepartment || ''
    const viewingOrgId = currentViewingOrgId.value
    if (!userDept && viewingOrgId === null) {
      return null
    }

    // 优先按目标组织 ID 匹配，兼容“战略发展部创建、目标部门接收”的计划。
    // 名称匹配只作为兜底，避免 targetOrgName 缺失或格式不一致时误判“未找到计划”。
    return (
      planStore.plans.find((p: any) => {
        const targetOrgName = p.targetOrgName || ''
        const targetOrgId = Number(p.targetOrgId ?? p.orgId ?? NaN)
        const cycleYear = resolvePlanYear(p)
        const matchesOrgId =
          viewingOrgId !== null && Number.isFinite(targetOrgId) && targetOrgId === viewingOrgId
        const matchesOrgName = Boolean(userDept) && targetOrgName === userDept
        return cycleYear === timeContext.currentYear && (matchesOrgId || matchesOrgName)
      }) || null
    )
  })

  // 当前用户 Plan ID
  const currentUserPlanId = computed(() => {
    return currentUserPlan.value?.id
  })

  // 存储当前 Plan 的详情（包含指标数据）
  const currentPlanDetails = ref<any>(null)
  const currentPlanWorkflowDetail = ref<WorkflowInstanceDetailResponse | null>(null)
  const approvalStatusPopoverLoading = ref(false)
  const approvalWorkflowPreview = ref<WorkflowDefinitionPreviewResponse | null>(null)
  const currentPlanReportSummary = ref<{
    id: number
    content?: string | null
    summary?: string | null
    workflowInstanceId?: number | null
    currentTaskId?: number | null
    workflowStatus?: string | null
    currentStepName?: string | null
    canWithdraw?: boolean
    status?: string | null
    indicatorDetails?: Array<{
      indicatorId?: number | string | null
      progress?: number | string | null
      comment?: string | null
      attachments?: Attachment[] | null
    }> | null
  } | null>(null)
  const latestPlanReportSummary = ref<{ id: number } | null>(null)
  const pendingPlanReportUiState = ref<null | 'submitted' | 'withdrawn'>(readPlanReportUiState())

  const SUBMITTED_FALLBACK_STATUSES = ['DRAFT', 'WITHDRAWN', 'CANCELLED', 'REJECTED', 'RETURNED']
  const WITHDRAWN_FALLBACK_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'PENDING']

  const currentPlanReportUiStatus = computed(() => {
    const reportBusinessStatus = String(currentPlanReportSummary.value?.status || '')
      .trim()
      .toUpperCase()
    const rawStatus = String(
      currentPlanWorkflowDetail.value?.status ||
        currentPlanReportSummary.value?.workflowStatus ||
        currentPlanReportSummary.value?.status ||
        ''
    )
      .trim()
      .toUpperCase()

    if (
      pendingPlanReportUiState.value === 'submitted' &&
      (!rawStatus || SUBMITTED_FALLBACK_STATUSES.includes(rawStatus))
    ) {
      return 'SUBMITTED'
    }

    if (
      pendingPlanReportUiState.value === 'withdrawn' &&
      (!rawStatus || WITHDRAWN_FALLBACK_STATUSES.includes(rawStatus))
    ) {
      return 'DRAFT'
    }

    if (reportBusinessStatus === 'DRAFT') {
      return 'DRAFT'
    }

    return rawStatus
  })

  const isCurrentPlanReportInApproval = computed(() =>
    ['SUBMITTED', 'IN_REVIEW', 'PENDING'].includes(currentPlanReportUiStatus.value)
  )

  const currentPlanReportActionState = computed<
    'draft' | 'pending_withdrawable' | 'pending_locked' | 'approved'
  >(() => {
    if (!usePlanReportFlow.value) {
      return 'draft'
    }

    if (currentPlanReportUiStatus.value === 'APPROVED') {
      return 'approved'
    }

    if (isCurrentPlanReportInApproval.value) {
      return canWithdrawCurrentPlan.value ? 'pending_withdrawable' : 'pending_locked'
    }

    return 'draft'
  })

  const approvalWorkflowReportSummary = computed(() => {
    const currentWorkflowInstanceId = Number(
      currentPlanReportSummary.value?.workflowInstanceId ?? NaN
    )
    const currentStatus = currentPlanReportUiStatus.value

    if (
      currentPlanReportSummary.value?.id &&
      Number.isFinite(currentWorkflowInstanceId) &&
      currentWorkflowInstanceId > 0 &&
      currentStatus !== 'DRAFT'
    ) {
      return currentPlanReportSummary.value
    }

    return latestPlanReportSummary.value
  })

  const normalizedCurrentPlanReportStatus = computed(() => {
    return currentPlanReportUiStatus.value
  })

  // Plan 详情加载状态
  const isLoadingPlanDetails = ref(false)

  function getPlanIndicatorText(indicator: Record<string, unknown>, ...keys: string[]): string {
    for (const key of keys) {
      const value = indicator[key]
      if (value !== undefined && value !== null) {
        const text = String(value).trim()
        if (text) {
          return text
        }
      }
    }
    return ''
  }

  function getPlanIndicatorNumber(indicator: Record<string, unknown>, ...keys: string[]): number {
    for (const key of keys) {
      const value = indicator[key]
      const numericValue = Number(value)
      if (Number.isFinite(numericValue)) {
        return numericValue
      }
    }
    return 0
  }

  function getPlanIndicatorOptionalNumber(
    indicator: Record<string, unknown>,
    ...keys: string[]
  ): number | undefined {
    for (const key of keys) {
      const value = indicator[key]
      if (value === undefined || value === null || value === '') {
        continue
      }

      const numericValue = Number(value)
      if (Number.isFinite(numericValue)) {
        return numericValue
      }
    }

    return undefined
  }

  function getPlanIndicatorAttachments(indicator: Record<string, unknown>): string[] | undefined {
    const rawValue = indicator.pendingAttachments
    if (!Array.isArray(rawValue)) {
      return undefined
    }

    const attachments = rawValue
      .map(item => {
        if (typeof item === 'string') {
          return item.trim()
        }
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>
          return (
            getPlanIndicatorText(
              record,
              'fileName',
              'originalName',
              'original_name',
              'name',
              'url',
              'publicUrl',
              'public_url',
              'objectKey',
              'object_key'
            ) || ''
          )
        }
        return ''
      })
      .filter(Boolean)

    return attachments
  }

  function normalizePlanMilestoneStatus(status: unknown): 'pending' | 'completed' | 'overdue' {
    const normalized = String(status || '')
      .trim()
      .toUpperCase()
    if (normalized === 'COMPLETED') {
      return 'completed'
    }
    if (normalized === 'DELAYED' || normalized === 'OVERDUE' || normalized === 'CANCELED') {
      return 'overdue'
    }
    return 'pending'
  }

  function normalizePlanMilestones(rawMilestones: unknown): StrategicIndicator['milestones'] {
    if (!Array.isArray(rawMilestones)) {
      return []
    }

    return rawMilestones.map((milestone, index) => {
      const item =
        milestone && typeof milestone === 'object' ? (milestone as Record<string, unknown>) : {}
      return {
        id: getPlanIndicatorText(item, 'id', 'milestoneId') || `milestone-${index}`,
        name: getPlanIndicatorText(item, 'name', 'milestoneName') || `里程碑${index + 1}`,
        targetProgress: getPlanIndicatorNumber(item, 'targetProgress', 'weightPercent'),
        deadline: getPlanIndicatorText(item, 'deadline', 'dueDate'),
        status: normalizePlanMilestoneStatus(item.status),
        isPaired: String(item.isPaired).toLowerCase() === 'true',
        weightPercent: getPlanIndicatorNumber(item, 'weightPercent', 'targetProgress'),
        sortOrder: getPlanIndicatorNumber(item, 'sortOrder') || index
      }
    })
  }

  function resolveIndicatorType2(
    taskType: unknown,
    fallback: StrategicIndicator['type2'] = '其他'
  ): StrategicIndicator['type2'] {
    const normalized = String(taskType || '')
      .trim()
      .toUpperCase()
    if (normalized === 'BASIC') {
      return '基础性'
    }
    if (normalized === 'DEVELOPMENT') {
      return '发展性'
    }
    return fallback
  }

  // 监听 Plan ID 变化，自动加载 Plan 详情
  watch(
    [
      isSecondaryCollege,
      currentViewingOrgId,
      () => planStore.plans.length,
      () => timeContext.currentYear
    ],
    async () => {
      await loadCollegePlanDetails()
    },
    { immediate: true }
  )

  watch(
    availableOwnerDepts,
    ownerDepts => {
      if (!isSecondaryCollege.value) {
        return
      }

      if (ownerDepts.length === 0) {
        filterOwnerDept.value = ''
        return
      }

      if (!ownerDepts.includes(filterOwnerDept.value)) {
        filterOwnerDept.value = ownerDepts[0] ?? ''
      }
    },
    { immediate: true }
  )

  watch(
    currentUserPlanId,
    async newPlanId => {
      if (newPlanId && (!currentPlanDetails.value || currentPlanDetails.value?.id !== newPlanId)) {
        // 加载 Plan 详情
        isLoadingPlanDetails.value = true
        const cachedCollegePlan =
          isSecondaryCollege.value && selectedCollegePlan.value
            ? collegePlanDetailsMap.value[String(selectedCollegePlan.value.id)]
            : null
        const plan =
          cachedCollegePlan && String(cachedCollegePlan.id) === String(newPlanId)
            ? cachedCollegePlan
            : await planStore.loadPlanDetails(newPlanId, { background: true })
        if (plan) {
          currentPlanDetails.value = plan
          if (isSecondaryCollege.value) {
            collegePlanDetailsMap.value = {
              ...collegePlanDetailsMap.value,
              [String(newPlanId)]: plan as Plan
            }
          }
        }
        await loadCurrentPlanReportSummary(newPlanId)
        await loadCurrentPlanWorkflowDetail(newPlanId)
        isLoadingPlanDetails.value = false
      } else if (!newPlanId) {
        currentPlanDetails.value = null
        currentPlanReportSummary.value = null
        currentPlanWorkflowDetail.value = null
        isLoadingPlanDetails.value = false
      }

      restartPlanApprovalPolling()
    },
    { immediate: true }
  )

  watch(
    [() => currentPlanDetails.value?.id, normalizedCurrentPlanStatus],
    async ([planId, status], [prevPlanId, prevStatus]) => {
      if (planId === prevPlanId && status === prevStatus) {
        return
      }

      await hydrateCurrentPlanWorkflowState()
    },
    { immediate: true }
  )

  watch(
    () => currentPlanDetails.value?.id,
    () => {
      restartPlanApprovalPolling()
    }
  )

  // 从当前 Plan 中提取指标列表（使用后端返回的指标数据）
  const currentPlanIndicators = computed(() => {
    const plan = currentPlanDetails.value
    if (!plan || !plan.indicators) {
      return []
    }

    const storeIndicatorMap = new Map(
      strategicStore.indicators.map(indicator => [String(indicator.id), indicator] as const)
    )

    // Plan 详情接口字段仍然偏瘦，这里优先复用 strategicStore 已标准化的数据，
    // 再用当前 plan 明细里的实时字段覆盖，避免任务名/里程碑被硬编码丢失。
    const mappedIndicators = plan.indicators.map((ind: any) => {
      const source = ind && typeof ind === 'object' ? (ind as Record<string, unknown>) : {}
      const indicatorId = String(source.id ?? source.indicatorId ?? '')
      const storeIndicator = indicatorId ? storeIndicatorMap.get(indicatorId) : undefined
      const normalizedMilestones = normalizePlanMilestones(source.milestones)
      const progress = getPlanIndicatorOptionalNumber(source, 'progress')
      const weight = getPlanIndicatorOptionalNumber(source, 'weightPercent', 'weight')
      const reportProgress = getPlanIndicatorOptionalNumber(
        source,
        'reportProgress',
        'report_progress'
      )
      const pendingProgress = getPlanIndicatorOptionalNumber(
        source,
        'pendingProgress',
        'pending_progress'
      )
      const pendingRemark = getPlanIndicatorText(source, 'pendingRemark', 'pending_remark')
      const pendingAttachments = getPlanIndicatorAttachments(source)
      const currentReportId = getPlanIndicatorOptionalNumber(
        source,
        'currentReportId',
        'current_report_id'
      )
      const pendingAttachmentDetails =
        Array.isArray(source.pendingAttachmentDetails) && source.pendingAttachmentDetails.length > 0
          ? (source.pendingAttachmentDetails as Attachment[])
          : ((storeIndicator as StrategicIndicator & { pendingAttachmentDetails?: Attachment[] })
              ?.pendingAttachmentDetails ?? [])
      const sourceApprovalStatus = getPlanIndicatorText(
        source,
        'progressApprovalStatus',
        'progress_approval_status'
      )

      const normalizedIndicator = {
        ...(storeIndicator || {}),
        id: indicatorId || storeIndicator?.id || String(Date.now()),
        name: getPlanIndicatorText(source, 'indicatorName', 'name') || storeIndicator?.name || '',
        indicator_desc:
          getPlanIndicatorText(source, 'indicatorDesc', 'description') ||
          (storeIndicator as StrategicIndicator & { indicator_desc?: string })?.indicator_desc ||
          '',
        description:
          getPlanIndicatorText(source, 'indicatorDesc', 'description') ||
          (storeIndicator as StrategicIndicator & { description?: string })?.description ||
          '',
        progress: progress ?? storeIndicator?.progress ?? 0,
        weight: weight ?? storeIndicator?.weight ?? 0,
        type1:
          (getPlanIndicatorText(
            source,
            'type1',
            'indicatorType',
            'indicatorType1'
          ) as StrategicIndicator['type1']) ||
          storeIndicator?.type1 ||
          '定量',
        type2: resolveIndicatorType2(source.taskType, storeIndicator?.type2 || '其他'),
        status: (getPlanIndicatorText(source, 'status').toUpperCase() ||
          storeIndicator?.status ||
          'ACTIVE') as StrategicIndicator['status'],
        isStrategic: storeIndicator?.isStrategic ?? true,
        year: Number(source.year) || storeIndicator?.year || timeContext.currentYear,
        ownerDept:
          getPlanIndicatorText(source, 'ownerOrgName', 'ownerDept') ||
          storeIndicator?.ownerDept ||
          '战略发展部',
        responsibleDept:
          getPlanIndicatorText(source, 'targetOrgName', 'responsibleDept') ||
          storeIndicator?.responsibleDept ||
          effectiveViewingDept.value ||
          authStore.userDepartment ||
          '',
        taskContent:
          getPlanIndicatorText(source, 'taskName', 'taskContent') ||
          storeIndicator?.taskContent ||
          '',
        remark: getPlanIndicatorText(source, 'remark') || storeIndicator?.remark || '',
        progressApprovalStatus: sourceApprovalStatus
          ? getSafeApprovalStatus(sourceApprovalStatus)
          : getSafeApprovalStatus(storeIndicator?.progressApprovalStatus),
        pendingProgress: pendingProgress ?? storeIndicator?.pendingProgress ?? null,
        pendingRemark: pendingRemark || storeIndicator?.pendingRemark || null,
        pendingAttachments: pendingAttachments ?? storeIndicator?.pendingAttachments ?? [],
        pendingAttachmentDetails,
        milestones:
          normalizedMilestones.length > 0 ? normalizedMilestones : storeIndicator?.milestones || [],
        createdAt:
          getPlanIndicatorText(source, 'createdAt') ||
          (storeIndicator as StrategicIndicator & { createdAt?: string })?.createdAt ||
          '',
        updatedAt:
          getPlanIndicatorText(source, 'updatedAt') ||
          (storeIndicator as StrategicIndicator & { updatedAt?: string })?.updatedAt ||
          ''
      } as StrategicIndicator & {
        reportProgress?: number | null
        targetOrgId?: number
        ownerOrgId?: number
        targetOrgName?: string
        ownerOrgName?: string
      }

      if (reportProgress !== undefined) {
        normalizedIndicator.reportProgress = reportProgress
      } else if (
        (storeIndicator as (StrategicIndicator & { reportProgress?: number | null }) | undefined)
          ?.reportProgress !== undefined
      ) {
        normalizedIndicator.reportProgress = (
          storeIndicator as StrategicIndicator & { reportProgress?: number | null }
        ).reportProgress
      }

      const targetOrgId =
        getPlanIndicatorNumber(source, 'targetOrgId', 'target_org_id') ||
        Number(
          (storeIndicator as StrategicIndicator & { targetOrgId?: number | string })?.targetOrgId ??
            0
        )
      if (Number.isFinite(targetOrgId) && targetOrgId > 0) {
        normalizedIndicator.targetOrgId = targetOrgId
      }

      const ownerOrgId =
        getPlanIndicatorNumber(source, 'ownerOrgId', 'owner_org_id') ||
        Number(
          (storeIndicator as StrategicIndicator & { ownerOrgId?: number | string })?.ownerOrgId ?? 0
        )
      if (Number.isFinite(ownerOrgId) && ownerOrgId > 0) {
        normalizedIndicator.ownerOrgId = ownerOrgId
      }

      if (currentReportId !== undefined) {
        ;(
          normalizedIndicator as StrategicIndicator & { currentReportId?: number | null }
        ).currentReportId = currentReportId
      } else if (
        (storeIndicator as (StrategicIndicator & { currentReportId?: number | null }) | undefined)
          ?.currentReportId !== undefined
      ) {
        ;(
          normalizedIndicator as StrategicIndicator & { currentReportId?: number | null }
        ).currentReportId = (
          storeIndicator as StrategicIndicator & { currentReportId?: number | null }
        ).currentReportId
      }

      const targetOrgName = getPlanIndicatorText(source, 'targetOrgName', 'target_org_name')
      if (targetOrgName) {
        normalizedIndicator.targetOrgName = targetOrgName
      }

      const ownerOrgName = getPlanIndicatorText(source, 'ownerOrgName', 'owner_org_name')
      if (ownerOrgName) {
        normalizedIndicator.ownerOrgName = ownerOrgName
      }

      return normalizedIndicator
    })

    if (
      isSecondaryCollege.value &&
      Array.isArray(currentPlanReportSummary.value?.indicatorDetails)
    ) {
      const reportId = Number(currentPlanReportSummary.value?.id ?? NaN)
      const detailMap = new Map(
        currentPlanReportSummary.value.indicatorDetails.map(detail => [
          String(detail?.indicatorId ?? ''),
          detail
        ])
      )

      const mergedIndicators = mappedIndicators.map(indicator => {
        const detail = detailMap.get(String(indicator.id))
        if (!detail) {
          return indicator
        }

        const detailProgress = Number(detail.progress)
        const nextProgress = Number.isFinite(detailProgress)
          ? detailProgress
          : indicator.pendingProgress
        const nextRemark = String(detail.comment || '').trim() || indicator.pendingRemark || null
        const nextAttachmentDetails = Array.isArray(detail.attachments) ? detail.attachments : []
        const nextAttachments =
          nextAttachmentDetails.length > 0
            ? nextAttachmentDetails
                .map(attachment => attachment?.fileName || attachment?.url || '')
                .filter(Boolean)
            : (indicator.pendingAttachments ?? [])

        return {
          ...indicator,
          currentReportId:
            Number.isFinite(reportId) && reportId > 0 ? reportId : indicator.currentReportId,
          reportProgress: nextProgress,
          pendingProgress: nextProgress,
          pendingRemark: nextRemark,
          pendingAttachments: nextAttachments,
          pendingAttachmentDetails:
            nextAttachmentDetails.length > 0
              ? nextAttachmentDetails
              : ((indicator as StrategicIndicator & { pendingAttachmentDetails?: Attachment[] })
                  .pendingAttachmentDetails ?? [])
        }
      })

      return filterIndicatorsForCurrentViewer(mergedIndicators)
    }

    return filterIndicatorsForCurrentViewer(mappedIndicators)
  })

  // 判断当前是否存在可供当前页面展示的 Plan 数据
  // 职能部门/学院在计划进入下发或审批流程后，都应继续看到计划内容。
  const hasCurrentUserPlanData = computed(() => {
    const plan = currentPlanDetails.value
    if (!plan) {
      return false
    }

    if (Array.isArray(plan.indicators) && plan.indicators.length > 0) {
      return true
    }

    const indicatorCount = Number(plan.indicatorCount ?? plan.indicator_count ?? NaN)
    return Number.isFinite(indicatorCount) && indicatorCount > 0
  })

  const hasCurrentUserPlan = computed(() => {
    return hasCurrentUserPlanData.value && canViewReceivedPlanContent.value
  })

  const isIndicatorDataLoading = computed(() => {
    return strategicStore.loading || strategicStore.loadingState.indicators
  })

  // 判断是否正在加载初始数据
  const isInitialLoading = computed(() => {
    // Plan Store 正在加载
    if (planStore.loading) {
      return true
    }
    if (collegePlanDetailsLoading.value) {
      return true
    }
    // Plan 详情正在加载
    if (isLoadingPlanDetails.value) {
      return true
    }
    // 指标列表仍在加载时，不能提前显示表格空态
    if (isIndicatorDataLoading.value) {
      return true
    }
    // 如果有 currentUserPlanId，但还没有加载 currentPlanDetails
    if (currentUserPlanId.value && !currentPlanDetails.value) {
      return true
    }
    return false
  })

  // 判断是否应该显示"未找到 Plan"的警告
  // 只有在非加载状态、非战略发展部、且确实没有 Plan 时才显示
  const shouldShowPlanWarning = computed(() => {
    // 加载中不显示警告
    if (isInitialLoading.value) {
      return false
    }
    // 战略发展部不显示警告
    if (isStrategicDept.value) {
      return false
    }
    // 有可展示的 Plan 不显示警告
    if (hasCurrentUserPlan.value) {
      return false
    }
    // 没有已下发 Plan，或 Plan 未下发时显示警告
    return true
  })

  const planWarningMessage = computed(() => {
    const departmentName = effectiveViewingDept.value || authStore.userDepartment || '当前部门'

    if (hasCurrentUserPlanData.value && !canViewReceivedPlanContent.value) {
      return `当前部门（${departmentName}）已存在 ${timeContext.currentYear} 年度计划，但当前计划数据暂不可见，请刷新后重试。`
    }

    if (isSecondaryCollege.value) {
      return `当前部门（${departmentName}）暂未接收到 ${timeContext.currentYear} 年度的指标计划。请联系上级职能部门下发计划后再查看指标。`
    }

    return `当前部门（${departmentName}）暂未创建 ${timeContext.currentYear} 年度的战略计划。请联系战略发展部创建计划后再查看指标。`
  })

  // 表格引用和选中的指标
  const tableRef = ref<InstanceType<typeof ElTable>>()
  const selectedIndicators = ref<StrategicIndicator[]>([])
  const approvalDrawerVisible = ref(false)

  // 专门用于审批抽屉的指标列表
  // - 审批人（战略发展部）：只显示待审批的指标
  // - 填报人（职能部门/二级学院）：显示所有已提交的指标（待审批+已审批+已驳回）
  const approvalIndicators = computed(() => {
    let list =
      hasCurrentUserPlan.value && currentPlanIndicators.value.length > 0
        ? currentPlanIndicators.value.map(i => ({
            ...i,
            id: String(i.id)
          }))
        : strategicStore.indicators.map(i => ({
            ...i,
            id: String(i.id)
          }))

    // 按当前年份过滤
    const currentYear = timeContext.currentYear
    const realYear = timeContext.realCurrentYear
    list = list.filter(i => {
      const indicatorYear = resolveIndicatorYear(i, realYear)
      return indicatorYear === currentYear
    })

    // 根据当前角色过滤数据
    // 非战略部门只有在计划已下发（已下发状态）时才能看到指标
    if (!(hasCurrentUserPlan.value && currentPlanIndicators.value.length > 0)) {
      list = filterIndicatorsForCurrentViewer(list)
    }

    if (isSecondaryCollege.value && filterOwnerDept.value) {
      list = list.filter(i => i.ownerDept === filterOwnerDept.value)
    }

    // 审批人：返回待审批的指标 + 有历史记录的指标（确保历史记录能正常显示）
    // 填报人：返回所有有审批状态的指标（用于查看审批进度）
    // @requirement 2.6 - 使用安全的状态检查，处理无效枚举值
    if (isStrategicDept.value) {
      return list.filter(
        i => isApprovalStatus(i, 'PENDING') || (i.statusAudit && i.statusAudit.length > 0)
      )
    } else {
      // 使用安全的状态获取，过滤掉 draft 和 none 状态
      return list.filter(i => {
        const safeStatus = getSafeApprovalStatus(i.progressApprovalStatus)
        return safeStatus !== 'NONE' && safeStatus !== 'DRAFT'
      })
    }
  })

  // 仅计算待审批的数量，用于按钮上的数字显示
  const _pendingApprovalCount = computed(() => {
    let list =
      hasCurrentUserPlan.value && currentPlanIndicators.value.length > 0
        ? currentPlanIndicators.value
        : strategicStore.indicators

    // 按当前年份过滤
    const currentYear = timeContext.currentYear
    const realYear = timeContext.realCurrentYear
    list = list.filter(i => {
      const indicatorYear = resolveIndicatorYear(i, realYear)
      return indicatorYear === currentYear
    })

    // 根据当前角色过滤数据
    // 非战略部门只有在计划已下发时才能看到指标
    if (!(hasCurrentUserPlan.value && currentPlanIndicators.value.length > 0)) {
      list = filterIndicatorsForCurrentViewer(list)
    }

    if (isSecondaryCollege.value && filterOwnerDept.value) {
      list = list.filter(i => i.ownerDept === filterOwnerDept.value)
    }

    // 只统计待审批状态的指标数量
    // @requirement 2.6 - 使用安全的状态检查，处理无效枚举值
    return list.filter(i => isApprovalStatus(i, 'PENDING')).length
  })

  const pendingApprovalCount = computed(() => _pendingApprovalCount.value)

  const pagePlanWorkflowStatus = computed(() => {
    if (usePlanReportFlow.value) {
      return currentPlanReportUiStatus.value
    }

    return String(
      currentPlanWorkflowDetail.value?.status ||
        currentPlanReportSummary.value?.workflowStatus ||
        currentPlanDetails.value?.workflowStatus ||
        currentPlanDetails.value?.status ||
        ''
    )
      .trim()
      .toUpperCase()
  })

  const hasPagePlanWorkflowData = computed(() => {
    return Boolean(
      currentPlanWorkflowDetail.value &&
      (currentPlanWorkflowDetail.value.instanceId ||
        currentPlanWorkflowDetail.value.status ||
        currentPlanWorkflowDetail.value.currentTaskId ||
        currentPlanWorkflowDetail.value.currentStepName ||
        (Array.isArray(currentPlanWorkflowDetail.value.history) &&
          currentPlanWorkflowDetail.value.history.length > 0))
    )
  })

  const isPagePlanPendingApproval = computed(() => {
    return ['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(pagePlanWorkflowStatus.value)
  })

  const hasPagePlanApprovalPermission = computed(() => {
    if (!isPagePlanPendingApproval.value) {
      return false
    }

    const expectedApproverRoleCodes = resolveExpectedApproverRoleCodesForPage()
    if (expectedApproverRoleCodes.length > 0) {
      const hasExpectedRole = expectedApproverRoleCodes.some(roleCode =>
        currentUserRoleCodes.value.includes(roleCode)
      )
      if (!hasExpectedRole) {
        return false
      }
    }

    const expectedApproverOrgId = resolveExpectedApproverOrgIdForPage()
    if (
      Number.isFinite(currentUserOrgId.value) &&
      currentUserOrgId.value > 0 &&
      Number.isFinite(expectedApproverOrgId) &&
      (expectedApproverOrgId as number) > 0
    ) {
      return currentUserOrgId.value === expectedApproverOrgId
    }

    return true
  })

  const pagePlanWorkflowTasks = computed<WorkflowTaskResponse[]>(() => {
    return Array.isArray(currentPlanWorkflowDetail.value?.tasks)
      ? currentPlanWorkflowDetail.value.tasks
      : []
  })

  const currentPagePlanTaskId = computed(() => {
    const pendingTask = pagePlanWorkflowTasks.value.find(
      task =>
        String(task.status || '')
          .trim()
          .toUpperCase() === 'PENDING'
    )
    const pendingTaskId = Number(pendingTask?.taskId ?? 0)
    if (Number.isFinite(pendingTaskId) && pendingTaskId > 0) {
      return pendingTaskId
    }

    const rawTaskId = Number(
      currentPlanWorkflowDetail.value?.currentTaskId ??
        currentPlanReportSummary.value?.currentTaskId ??
        (usePlanReportFlow.value ? 0 : currentPlanDetails.value?.currentTaskId) ??
        0
    )
    return Number.isFinite(rawTaskId) && rawTaskId > 0 ? rawTaskId : 0
  })

  const currentPagePendingPlanTask = computed<WorkflowTaskResponse | null>(() => {
    const currentTaskId = String(currentPagePlanTaskId.value || '').trim()
    if (!currentTaskId) {
      return null
    }

    return (
      pagePlanWorkflowTasks.value.find(task => {
        const taskId = String(task.taskId || '').trim()
        const status = String(task.status || '')
          .trim()
          .toUpperCase()
        return taskId === currentTaskId && status === 'PENDING'
      }) || null
    )
  })

  function resolveExpectedApproverRoleCodesForPage(): string[] {
    const stepName = String(
      currentPlanWorkflowDetail.value?.currentStepName ||
        currentPlanReportSummary.value?.currentStepName ||
        currentPlanDetails.value?.currentStepName ||
        ''
    ).trim()

    if (!stepName) {
      return []
    }

    if (
      stepName.includes('职能部门审批') ||
      stepName.includes('职能部门终审') ||
      stepName.includes('二级学院审批')
    ) {
      return ['ROLE_APPROVER']
    }

    if (stepName.includes('战略发展部')) {
      return ['ROLE_STRATEGY_DEPT_HEAD']
    }

    if (stepName.includes('分管校领导') || stepName.includes('学院院长')) {
      return ['ROLE_VICE_PRESIDENT']
    }

    return []
  }

  function resolveExpectedApproverOrgIdForPage(): number | null {
    const stepName = String(
      currentPlanWorkflowDetail.value?.currentStepName ||
        currentPlanReportSummary.value?.currentStepName ||
        currentPlanDetails.value?.currentStepName ||
        ''
    ).trim()
    const currentTaskId = String(currentPagePlanTaskId.value || '').trim()

    if (currentTaskId && Array.isArray(currentPlanWorkflowDetail.value?.tasks)) {
      const currentTask = currentPlanWorkflowDetail.value.tasks.find(
        task => String(task.taskId || '').trim() === currentTaskId
      )

      if (stepName.includes('职能部门终审')) {
        const sourceOrgId = Number(
          currentPlanWorkflowDetail.value?.sourceOrgId ?? currentPlanDetails.value?.sourceOrgId ?? 0
        )
        if (Number.isFinite(sourceOrgId) && sourceOrgId > 0) {
          return sourceOrgId
        }
      }

      const approverOrgId = Number(currentTask?.approverOrgId ?? 0)
      if (Number.isFinite(approverOrgId) && approverOrgId > 0) {
        return approverOrgId
      }
    }

    return null
  }

  const canCurrentUserHandlePlanApprovalOnPage = computed(() => {
    if (
      !hasPagePlanWorkflowData.value ||
      !isPagePlanPendingApproval.value ||
      !hasPagePlanApprovalPermission.value ||
      !currentPagePendingPlanTask.value
    ) {
      return false
    }

    const expectedApproverRoleCodes = resolveExpectedApproverRoleCodesForPage()
    if (expectedApproverRoleCodes.length > 0) {
      const hasExpectedRole = expectedApproverRoleCodes.some(roleCode =>
        currentUserRoleCodes.value.includes(roleCode)
      )
      if (!hasExpectedRole) {
        return false
      }
    }

    const expectedApproverOrgId = resolveExpectedApproverOrgIdForPage()
    if (
      Number.isFinite(currentUserOrgId.value) &&
      currentUserOrgId.value > 0 &&
      Number.isFinite(expectedApproverOrgId) &&
      (expectedApproverOrgId as number) > 0
    ) {
      return currentUserOrgId.value === expectedApproverOrgId
    }

    return false
  })

  const approvalBadgeCount = computed(() => (canCurrentUserHandlePlanApprovalOnPage.value ? 1 : 0))

  const approvalEntryButtonText = computed(() => {
    if (usePlanReportFlow.value) {
      return isCurrentPlanReportInApproval.value ? '审批中' : '审批记录'
    }

    const status = normalizedCurrentPlanStatus.value
    if (status === 'PENDING') {
      return '审批中'
    }
    if (status === 'DISTRIBUTED') {
      return '查看审批'
    }
    return '审批进度'
  })

  const { routeApprovalEntityType, routeApprovalEntityId } = useApprovalRouteAutopen({
    supportedEntityTypes: ['PLAN', 'PLAN_REPORT'] as const,
    onAutoOpen: async () => {
      await nextTick()
      const planId = Number(getCurrentPlanId() ?? NaN)
      if (Number.isFinite(planId) && planId > 0) {
        await loadCurrentPlanReportSummary(planId)
        await loadCurrentPlanWorkflowDetail(planId)
      }
      approvalDrawerVisible.value = true
    },
    onClearFailure: error => {
      logger.warn('[IndicatorListView] 清理审批自动打开参数失败:', error)
    }
  })

  const primaryApprovalWorkflowEntityType = computed<'PLAN' | 'PLAN_REPORT'>(() => {
    if (routeApprovalEntityType.value) {
      return routeApprovalEntityType.value
    }
    return approvalWorkflowReportSummary.value?.id ? 'PLAN_REPORT' : 'PLAN'
  })

  const primaryApprovalWorkflowEntityId = computed<number | string | undefined>(() => {
    return (
      routeApprovalEntityId.value ??
      approvalWorkflowReportSummary.value?.id ??
      currentPlanDetails.value?.id
    )
  })

  const secondaryApprovalWorkflowEntityType = computed<'PLAN' | 'PLAN_REPORT' | undefined>(() => {
    if (approvalWorkflowReportSummary.value?.id) {
      return 'PLAN'
    }

    return latestPlanReportSummary.value?.id ? 'PLAN_REPORT' : undefined
  })

  const secondaryApprovalWorkflowEntityId = computed<number | string | undefined>(() => {
    if (approvalWorkflowReportSummary.value?.id) {
      return currentUserPlanId.value
    }

    return latestPlanReportSummary.value?.id
  })

  const handleOpenApproval = async () => {
    const planId = Number(getCurrentPlanId() ?? NaN)
    if (Number.isFinite(planId) && planId > 0) {
      await loadCurrentPlanReportSummary(planId)
      await loadCurrentPlanWorkflowDetail(planId)
    }
    approvalDrawerVisible.value = true
  }

  const handleApprovalStatusPopoverShow = async () => {
    const planId = Number(getCurrentPlanId() ?? NaN)
    if (!Number.isFinite(planId) || planId <= 0) {
      return
    }

    approvalStatusPopoverLoading.value = true
    try {
      if (!currentPlanWorkflowDetail.value) {
        await loadCurrentPlanWorkflowDetail(planId)
      }

      if (!approvalWorkflowPreview.value) {
        try {
          const workflowCode = usePlanReportFlow.value
            ? PLAN_APPROVAL_WORKFLOW_CODE_COLLEGE
            : PLAN_APPROVAL_WORKFLOW_CODE_FUNCDEPT
          const response = await getWorkflowDefinitionPreviewByCode(workflowCode)
          if (response.success && response.data) {
            approvalWorkflowPreview.value = response.data
          }
        } catch (error) {
          logger.warn('[IndicatorListView] 加载流程状态候选审批人失败:', error)
        }
      }
    } finally {
      approvalStatusPopoverLoading.value = false
    }
  }

  interface TaskListItem {
    id: number
    title: string
    desc: string
    createTime: string
    cycle: string
  }

  function getPlanIndicatorIds(plan: unknown): number[] {
    if (!plan || typeof plan !== 'object') {
      return []
    }

    const candidate = (plan as { indicatorIds?: unknown }).indicatorIds
    if (!Array.isArray(candidate)) {
      return []
    }

    return candidate.map(id => Number(id)).filter(id => Number.isFinite(id))
  }

  // 从 Store 获取任务列表
  const taskList = computed<TaskListItem[]>(() =>
    strategicStore.tasks.map(task => {
      const item = task as unknown as Record<string, unknown>
      return {
        id: Number(item.id ?? 0),
        title: String(item.title ?? '暂无任务'),
        desc: String(item.desc ?? ''),
        createTime: String(item.createTime ?? ''),
        cycle: String(item.cycle ?? '')
      }
    })
  )

  // 当前选中的任务
  const _currentTask = computed(
    () =>
      taskList.value[currentTaskIndex.value] || {
        id: 0,
        title: '暂无任务',
        desc: '',
        createTime: '',
        cycle: ''
      }
  )

  // 从 Store 获取指标列表（带里程碑），按任务类型和战略任务分组排序，并应用筛选
  const indicators = computed(() => {
    // 初始化来源部门筛选
    initOwnerDeptFilter()

    // 优先使用当前 Plan 中的指标数据，但非战略角色必须满足“Plan 已下发”
    if (hasCurrentUserPlan.value && currentPlanIndicators.value.length > 0) {
      let list = currentPlanIndicators.value

      // 应用筛选条件
      if (filterType2.value) {
        list = list.filter(i => i.type2 === filterType2.value)
      }
      if (filterType1.value) {
        list = list.filter(i => i.type1 === filterType1.value)
      }
      if (filterDept.value) {
        list = list.filter(i => i.responsibleDept === filterDept.value)
      }
      // 学院角色：按来源部门筛选
      if (isSecondaryCollege.value && filterOwnerDept.value) {
        list = list.filter(i => i.ownerDept === filterOwnerDept.value)
      }

      // 排序
      return list.sort((a, b) => {
        const type2A = a.type2 || ''
        const type2B = b.type2 || ''
        if (type2A !== type2B) {
          return type2A === '发展性' ? -1 : 1
        }
        const taskA = a.taskContent || ''
        const taskB = b.taskContent || ''
        return taskA.localeCompare(taskB)
      })
    }

    // 回退到使用 strategicStore.indicators（向后兼容）
    let list = strategicStore.indicators.map(i => ({
      ...i,
      id: String(i.id)
    }))

    if (
      isSecondaryCollege.value &&
      Array.isArray(currentPlanReportSummary.value?.indicatorDetails)
    ) {
      const reportId = Number(currentPlanReportSummary.value?.id ?? NaN)
      const reportStatus = String(currentPlanReportSummary.value?.status || '')
        .trim()
        .toUpperCase()
      const detailMap = new Map(
        currentPlanReportSummary.value.indicatorDetails.map(detail => [
          String(detail?.indicatorId ?? ''),
          detail
        ])
      )

      list = list.map(indicator => {
        const detail = detailMap.get(String(indicator.id))
        if (!detail) {
          return indicator
        }

        const detailProgress = Number(detail.progress)
        const nextProgress = Number.isFinite(detailProgress)
          ? detailProgress
          : indicator.pendingProgress
        const nextRemark = String(detail.comment || '').trim() || indicator.pendingRemark || null
        const nextAttachments = Array.isArray(detail.attachments)
          ? detail.attachments
              .map(attachment => attachment?.fileName || attachment?.url || '')
              .filter(Boolean)
          : (indicator.pendingAttachments ?? [])

        return {
          ...indicator,
          currentReportId:
            Number.isFinite(reportId) && reportId > 0 ? reportId : indicator.currentReportId,
          reportProgress: nextProgress,
          pendingProgress: nextProgress,
          pendingRemark: nextRemark,
          pendingAttachments: nextAttachments,
          pendingAttachmentDetails: Array.isArray(detail.attachments) ? detail.attachments : [],
          progressApprovalStatus:
            reportStatus === 'SUBMITTED' || reportStatus === 'IN_REVIEW'
              ? 'PENDING'
              : (indicator.progressApprovalStatus ?? 'DRAFT')
        }
      })
    }

    // 按当前年份过滤
    const currentYear = timeContext.currentYear
    const realYear = timeContext.realCurrentYear
    list = list.filter(i => {
      const indicatorYear = resolveIndicatorYear(i, realYear)
      return indicatorYear === currentYear
    })

    // 根据 Plan 筛选指标（优先级高于角色过滤）
    // 如果存在当前用户的 Plan，只显示该 Plan 包含的指标
    const plan = currentUserPlan.value
    const planIndicatorIds = getPlanIndicatorIds(plan)
    if (planIndicatorIds.length > 0) {
      list = list.filter(i => planIndicatorIds.includes(Number(i.id)))
    }

    // 根据当前角色过滤数据
    // 如果不是战略发展部，只显示下发到当前部门（责任部门）的指标
    // 且仅在计划已下发后才可见
    list = filterIndicatorsForCurrentViewer(list)

    // 应用筛选条件
    if (filterType2.value) {
      list = list.filter(i => i.type2 === filterType2.value)
    }
    if (filterType1.value) {
      list = list.filter(i => i.type1 === filterType1.value)
    }
    if (filterDept.value) {
      list = list.filter(i => i.responsibleDept === filterDept.value)
    }
    // 学院角色：按来源部门筛选
    if (isSecondaryCollege.value && filterOwnerDept.value) {
      list = list.filter(i => i.ownerDept === filterOwnerDept.value)
    }

    // 先按 type2（任务类型）排序，再按 taskContent（战略任务）排序
    return list.sort((a, b) => {
      const type2A = a.type2 || ''
      const type2B = b.type2 || ''
      if (type2A !== type2B) {
        // 发展性排在前面
        return type2A === '发展性' ? -1 : 1
      }
      const taskA = a.taskContent || ''
      const taskB = b.taskContent || ''
      return taskA.localeCompare(taskB)
    })
  })

  const indicatorWorkflowCache = ref<Record<string, IndicatorWorkflowSnapshot | null>>({})
  const indicatorWorkflowLoadingMap = ref<Record<string, boolean>>({})

  const loadIndicatorWorkflowSnapshot = async (
    indicatorId: number | string,
    options: { force?: boolean } = {}
  ) => {
    const cacheKey = String(indicatorId)
    if (!options.force && cacheKey in indicatorWorkflowCache.value) {
      return indicatorWorkflowCache.value[cacheKey]
    }

    indicatorWorkflowLoadingMap.value = {
      ...indicatorWorkflowLoadingMap.value,
      [cacheKey]: true
    }

    try {
      const response = await indicatorFillApi.getIndicatorFillHistory(indicatorId)
      const fills = Array.isArray(response.data) ? response.data : []
      const snapshot = resolveLatestIndicatorWorkflowSnapshot(fills)
      indicatorWorkflowCache.value = {
        ...indicatorWorkflowCache.value,
        [cacheKey]: snapshot
      }
      return snapshot
    } catch (error) {
      logger.warn('[IndicatorListView] 加载指标工作流快照失败:', { indicatorId, error })
      indicatorWorkflowCache.value = {
        ...indicatorWorkflowCache.value,
        [cacheKey]: null
      }
      return null
    } finally {
      indicatorWorkflowLoadingMap.value = {
        ...indicatorWorkflowLoadingMap.value,
        [cacheKey]: false
      }
    }
  }

  const getIndicatorWorkflowSnapshot = (indicator: StrategicIndicator | null | undefined) => {
    if (!indicator?.id) {
      return null
    }
    return indicatorWorkflowCache.value[String(indicator.id)] ?? null
  }

  const isIndicatorWorkflowLoading = (indicator: StrategicIndicator | null | undefined) => {
    if (!indicator?.id) {
      return false
    }
    return Boolean(indicatorWorkflowLoadingMap.value[String(indicator.id)])
  }

  const canHandleIndicatorWorkflow = (indicator: StrategicIndicator | null | undefined) =>
    canCurrentUserHandleIndicatorWorkflow(
      getIndicatorWorkflowSnapshot(indicator),
      currentUserId.value,
      currentUserPermissionCodes.value
    )

  const getDisplayProgress = (indicator: StrategicIndicator): number => {
    const progress = Number(indicator.progress)
    return Number.isFinite(progress) ? progress : 0
  }

  const hasIndicatorReportIdentity = (indicator: StrategicIndicator): boolean => {
    const currentReportId = Number(
      (indicator as StrategicIndicator & { currentReportId?: number | null }).currentReportId ?? NaN
    )
    if (Number.isFinite(currentReportId) && currentReportId > 0) {
      return true
    }

    const reported = Number(
      (indicator as StrategicIndicator & { reportProgress?: number | null }).reportProgress ?? NaN
    )
    if (Number.isFinite(reported)) {
      return true
    }

    const approvalStatus = getSafeApprovalStatus(indicator.progressApprovalStatus)
    return approvalStatus !== 'NONE' && approvalStatus !== 'DRAFT'
  }

  const getDisplayedReportedProgress = (indicator: StrategicIndicator): number | null => {
    if (!hasIndicatorReportIdentity(indicator)) {
      return null
    }

    const latestReportProgress = Number(
      (indicator as StrategicIndicator & { reportProgress?: number | null }).reportProgress
    )
    if (Number.isFinite(latestReportProgress)) {
      return latestReportProgress
    }

    return null
  }

  const shouldShowReportedProgress = (indicator: StrategicIndicator): boolean => {
    const actualProgress = getDisplayProgress(indicator)
    const reportedProgress = getDisplayedReportedProgress(indicator)
    return reportedProgress !== null && reportedProgress !== actualProgress
  }

  watch(
    () => indicators.value.map(indicator => String(indicator.id)).join(','),
    ids => {
      if (!ids) {
        return
      }
      const indicatorsNeedingWorkflowSnapshot = indicators.value.filter(indicator => {
        const approvalStatus = getSafeApprovalStatus(indicator.progressApprovalStatus)
        if (approvalStatus !== 'NONE' && approvalStatus !== 'DRAFT') {
          return true
        }

        const currentReportId = Number(
          (indicator as StrategicIndicator & { currentReportId?: number | null }).currentReportId ??
            NaN
        )
        if (Number.isFinite(currentReportId) && currentReportId > 0) {
          return true
        }

        const reportedProgress = Number(
          (indicator as StrategicIndicator & { reportProgress?: number | null }).reportProgress ??
            NaN
        )
        return Number.isFinite(reportedProgress)
      })

      if (indicatorsNeedingWorkflowSnapshot.length === 0) {
        return
      }

      void Promise.all(
        indicatorsNeedingWorkflowSnapshot.map(indicator =>
          loadIndicatorWorkflowSnapshot(indicator.id)
        )
      )
    },
    { immediate: true }
  )

  // @requirement: Plan-centric status - 整体状态直接使用 Plan 的状态，而不是从单个指标计算
  // 一个 Plan 下的所有指标共享同一个状态
  const overallStatus = computed(() => {
    if (!isStrategicDept.value && !hasCurrentUserPlan.value) {
      return 'draft'
    }

    if (usePlanReportFlow.value) {
      return currentPlanReportActionState.value.startsWith('pending') ? 'pending' : 'draft'
    }

    const planStatus = currentPlanStatus.value
    if (!planStatus) {
      return 'draft'
    }
    // 将 Plan 状态转换为小写以统一处理
    const status = planStatus.toLowerCase()
    // Plan 状态: DRAFT -> draft, PENDING -> pending, ACTIVE -> active, REJECTED -> rejected, COMPLETED -> completed
    switch (status) {
      case 'active':
        return 'active'
      case 'pending':
        return 'pending'
      case 'rejected':
        return 'rejected'
      case 'completed':
      case 'archived':
        return 'completed'
      case 'draft':
      default:
        return 'draft'
    }
  })

  const currentPlanStatusMeta = computed(() => {
    const workflowStatus = pagePlanWorkflowStatus.value
    if (workflowStatus) {
      return getPlanStatusDisplay(workflowStatus)
    }

    if (usePlanReportFlow.value && hasCurrentUserPlanData.value) {
      return getPlanStatusDisplay(currentPlanReportUiStatus.value || currentPlanStatus.value)
    }

    return getPlanStatusDisplay(currentPlanStatus.value)
  })

  const normalizeWorkflowStepName = (value?: string | null) => {
    return String(value || '')
      .replace(/\s+/g, '')
      .trim()
  }

  const normalizePreviewCandidateDisplayName = (
    candidate: WorkflowDefinitionPreviewResponse['steps'][number]['candidateApprovers'][number]
  ) => {
    return candidate.realName || candidate.username || `用户${candidate.userId}`
  }

  const currentApprovalWorkflowStatus = computed(() => {
    return String(pagePlanWorkflowStatus.value || '')
      .trim()
      .toUpperCase()
  })

  const currentApprovalStepName = computed(() => {
    return String(
      currentPlanWorkflowDetail.value?.currentStepName ||
        currentPlanReportSummary.value?.currentStepName ||
        currentPlanDetails.value?.currentStepName ||
        ''
    ).trim()
  })

  const currentApprovalApproverName = computed(() => {
    return String(
      currentPlanWorkflowDetail.value?.currentApproverName ||
        currentPlanDetails.value?.currentApproverName ||
        ''
    ).trim()
  })

  const currentApprovalFlowName = computed(() => {
    return String(
      currentPlanWorkflowDetail.value?.flowName ||
        currentPlanWorkflowDetail.value?.definitionName ||
        approvalWorkflowPreview.value?.workflowName ||
        ''
    ).trim()
  })

  const currentApprovalStepPreview = computed(() => {
    const stepName = normalizeWorkflowStepName(currentApprovalStepName.value)
    if (!stepName || !approvalWorkflowPreview.value?.steps?.length) {
      return null
    }

    return (
      approvalWorkflowPreview.value.steps.find(
        step => normalizeWorkflowStepName(step.stepName) === stepName
      ) || null
    )
  })

  const currentApprovalRuntimeCandidateNames = ref<string[]>([])
  const approvalCandidateCache = new Map<string, string[]>()
  const canLookupWorkflowUsers = computed(() => authStore.userRole === 'strategic_dept')

  const normalizeOrgRoleUserDisplayName = (user: {
    realName?: unknown
    name?: unknown
    username?: unknown
  }): string => {
    return String(user.realName || user.name || user.username || '').trim()
  }

  async function loadCurrentApprovalRuntimeCandidateNames(): Promise<void> {
    const orgId = resolveExpectedApproverOrgIdForPage()
    const roleCodes = resolveExpectedApproverRoleCodesForPage()
    if (!canLookupWorkflowUsers.value || !orgId || roleCodes.length === 0) {
      currentApprovalRuntimeCandidateNames.value = []
      return
    }

    const cacheKey = `${orgId}::${roleCodes.slice().sort().join(',')}`
    const cached = approvalCandidateCache.get(cacheKey)
    if (cached) {
      currentApprovalRuntimeCandidateNames.value = cached
      return
    }

    try {
      const users = await getUsersByOrgId(orgId)
      const names = users
        .filter(user => user.isActive !== false)
        .filter(user => {
          const userRoles = Array.isArray(user.roles) ? user.roles.filter(Boolean) : []
          return roleCodes.some(roleCode => userRoles.includes(roleCode))
        })
        .map(user => normalizeOrgRoleUserDisplayName(user))
        .filter(Boolean)

      const uniqueNames = [...new Set(names)]
      approvalCandidateCache.set(cacheKey, uniqueNames)
      currentApprovalRuntimeCandidateNames.value = uniqueNames
    } catch (error) {
      currentApprovalRuntimeCandidateNames.value = []
      logger.warn('[IndicatorListView] 加载页面级审批候选人失败:', {
        orgId,
        roleCodes,
        error
      })
    }
  }

  const currentApprovalCandidateNames = computed(() => {
    if (currentApprovalRuntimeCandidateNames.value.length > 0) {
      return currentApprovalRuntimeCandidateNames.value
    }

    const candidates = currentApprovalStepPreview.value?.candidateApprovers
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return []
    }

    return candidates
      .map(candidate => normalizePreviewCandidateDisplayName(candidate))
      .filter(Boolean)
  })

  watch(
    () => [
      currentApprovalStepName.value,
      resolveExpectedApproverOrgIdForPage(),
      resolveExpectedApproverRoleCodesForPage().join('|')
    ],
    () => {
      void loadCurrentApprovalRuntimeCandidateNames()
    },
    { immediate: true }
  )

  const currentApprovalStatusMeta = computed(() => {
    const workflowStatus = currentApprovalWorkflowStatus.value
    const stepName = currentApprovalStepName.value
    const approverName = currentApprovalApproverName.value
    const candidateNames = currentApprovalCandidateNames.value

    if (
      workflowStatus === 'APPROVED' ||
      workflowStatus === 'COMPLETED' ||
      workflowStatus === 'FINISHED' ||
      (!usePlanReportFlow.value && normalizedCurrentPlanStatus.value === 'DISTRIBUTED')
    ) {
      return {
        label: '已完成审批',
        type: 'success' as const,
        description: '当前计划审批流程已完成。'
      }
    }

    if (
      workflowStatus === 'REJECTED' ||
      workflowStatus === 'RETURNED' ||
      workflowStatus === 'WITHDRAWN' ||
      workflowStatus === 'CANCELLED'
    ) {
      return {
        label: '已退回',
        type: 'danger' as const,
        description: stepName ? `当前流程已在“${stepName}”环节退回。` : '当前计划审批流程已退回。'
      }
    }

    if (
      stepName ||
      approverName ||
      ['SUBMITTED', 'IN_REVIEW', 'PENDING'].includes(workflowStatus)
    ) {
      return {
        label: stepName ? `待${stepName}审批` : '审批中',
        type: 'warning' as const,
        description:
          candidateNames.length > 0
            ? `当前节点有 ${candidateNames.length} 位可审批人。`
            : stepName
              ? `当前节点：${stepName}`
              : '当前计划正在审批中。'
      }
    }

    if (hasPagePlanWorkflowData.value || approvalWorkflowReportSummary.value?.id) {
      return {
        label: '查看流程',
        type: 'info' as const,
        description: '当前计划已有审批记录，可进入审批中心查看。'
      }
    }

    return {
      label: '未发起流程',
      type: 'info' as const,
      description: '当前计划还未发起审批流程。'
    }
  })

  const showPlanBatchActions = computed(() => {
    return (
      !isStrategicDept.value &&
      isCurrentUserReporter.value &&
      canViewReceivedPlanContent.value &&
      Boolean(currentUserPlanId.value) &&
      indicators.value.length > 0
    )
  })

  const showSubmitAllButton = computed(() => {
    return (
      showPlanBatchActions.value &&
      allIndicatorsFilled.value &&
      (!usePlanReportFlow.value || currentPlanReportActionState.value === 'draft')
    )
  })

  const showWithdrawAllButton = computed(() => {
    return (
      showPlanBatchActions.value &&
      (!usePlanReportFlow.value
        ? canWithdrawAny.value
        : currentPlanReportActionState.value === 'pending_withdrawable' ||
          currentPlanReportActionState.value === 'pending_locked')
    )
  })

  const showStrategicTaskColumn = computed(() => !usePlanReportFlow.value)

  // 计算单元格合并信息
  const getSpanMethod = ({
    row,
    column: _column,
    rowIndex,
    columnIndex
  }: {
    row: any
    column: any
    rowIndex: number
    columnIndex: number
  }) => {
    const dataList = indicators.value

    if (!showStrategicTaskColumn.value) {
      return { rowspan: 1, colspan: 1 }
    }

    // 只有战略任务列（第0列）需要合并
    if (columnIndex === 0) {
      const currentTask = row.taskContent || '未关联任务'

      // 计算当前任务在列表中的起始位置
      let startIndex = rowIndex
      while (
        startIndex > 0 &&
        (dataList[startIndex - 1].taskContent || '未关联任务') === currentTask
      ) {
        startIndex--
      }

      // 如果是该任务的第一行，计算合并行数
      if (startIndex === rowIndex) {
        let count = 1
        while (
          rowIndex + count < dataList.length &&
          (dataList[rowIndex + count].taskContent || '未关联任务') === currentTask
        ) {
          count++
        }
        return { rowspan: count, colspan: 1 }
      } else {
        // 不是第一行，隐藏该单元格
        return { rowspan: 0, colspan: 0 }
      }
    }
    return { rowspan: 1, colspan: 1 }
  }

  // 获取当前行所属的任务组
  const _getTaskGroup = (row: StrategicIndicator) => {
    const taskContent = row.taskContent || '未命名任务'
    const rows = indicators.value.filter(i => (i.taskContent || '未命名任务') === taskContent)
    return { taskContent, rows }
  }

  // 按任务组批量分解（战略发展部专用）
  const _handleBatchDistributeByTask = (group: {
    taskContent: string
    rows: StrategicIndicator[]
  }) => {
    const departments = ['教务处', '科研处', '人事处']
    const indicatorNames = group.rows.map(ind => ind.name).join('、')

    ElMessageBox.confirm(
      `确认将任务 "${group.taskContent}" 下的 ${group.rows.length} 个指标分解到各职能部门？\n\n${indicatorNames}\n\n目标部门：${departments.join('、')}`,
      '批量分解确认',
      {
        confirmButtonText: '确定分解',
        cancelButtonText: '取消',
        type: 'warning'
      }
    ).then(() => {
      ElMessage.success(`成功分解${group.rows.length}项指标到职能部门`)
    })
  }

  // 按任务组批量提交（职能部门/二级学院专用）
  const _handleBatchFillByTask = (group: { taskContent: string; rows: StrategicIndicator[] }) => {
    // 找出所有待提交（draft）或已驳回（rejected）的指标
    // @requirement 2.6 - 使用安全的状态检查，处理无效枚举值
    const pendingRows = group.rows.filter(r => isApprovalStatus(r, ['DRAFT', 'REJECTED']))

    if (pendingRows.length === 0) {
      ElMessage.warning('当前没有待提交的进度')
      return
    }

    const indicatorNames = pendingRows.map(ind => ind.name).join('、')

    ElMessageBox.prompt(
      `确认对任务 "${group.taskContent}" 下的 ${pendingRows.length} 个指标进行批量提交？\n\n指标列表：${indicatorNames}\n\n请输入提交备注：`,
      '批量提交确认',
      {
        confirmButtonText: '确定提交',
        cancelButtonText: '取消',
        inputPlaceholder: '请输入提交备注',
        inputType: 'textarea',
        inputValidator: value => {
          if (!value || !value.trim()) {
            return '请输入提交备注'
          }
          return true
        }
      }
    ).then(async ({ value: submitComment }) => {
      try {
        for (const row of pendingRows) {
          // 更新指标状态为待审批
          await strategicStore.updateIndicator(row.id.toString(), {
            progressApprovalStatus: 'PENDING'
          })

          // 添加审计日志
          strategicStore.addStatusAuditEntry(row.id.toString(), {
            operator: authStore.userName || 'unknown',
            operatorName: authStore.userName || '未知用户',
            operatorDept: authStore.userDepartment || '未知部门',
            action: 'submit',
            comment: submitComment || '批量提交进度填报',
            previousProgress: row.progress,
            newProgress: row.pendingProgress,
            previousStatus: row.progressApprovalStatus,
            newStatus: 'PENDING'
          })

          clearPersistedIndicatorDraft(row.id)
        }

        ElMessage.success(`成功提交${pendingRows.length}项指标进度`)
      } catch (error) {
        logger.error('Failed to submit indicators:', error)
        ElMessage.error('提交失败，请稍后重试')
      }
    })
  }

  // 按任务组批量撤回（职能部门/二级学院专用）
  const _handleBatchRevokeByTask = (group: { taskContent: string; rows: StrategicIndicator[] }) => {
    // 找出所有待审批（pending）的指标
    // @requirement 2.6 - 使用安全的状态检查，处理无效枚举值
    const pendingRows = group.rows.filter(r => isApprovalStatus(r, 'PENDING'))

    if (pendingRows.length === 0) {
      ElMessage.warning('该任务下没有待审批的指标')
      return
    }

    const indicatorNames = pendingRows.map(ind => ind.name).join('、')

    ElMessageBox.confirm(
      `确认撤回任务 "${group.taskContent}" 下的 ${pendingRows.length} 个待审批指标的进度审批？\n\n${indicatorNames}`,
      '批量撤回进度审批',
      {
        confirmButtonText: '确认撤回',
        cancelButtonText: '取消',
        type: 'warning'
      }
    ).then(() => {
      pendingRows.forEach(row => {
        // 撤回：将状态改回 none，并保留填报数据供修改
        // 或者改回 draft？用户说“撤回”，通常是回到可编辑状态。
        // 在这里我们改回 none，但保留 pendingProgress 等字段，这样“填报”按钮会显示这些值。
        // 实际上 updateIndicator 会合并对象。
        strategicStore.updateIndicator(row.id.toString(), {
          progressApprovalStatus: 'DRAFT'
        })

        // 添加审计日志
        strategicStore.addStatusAuditEntry(row.id.toString(), {
          operator: authStore.userName || 'unknown',
          operatorName: authStore.userName || '未知用户',
          operatorDept: authStore.userDepartment || '未知部门',
          action: 'revoke',
          comment: '批量撤回进度审批',
          previousStatus: 'pending',
          newStatus: 'draft'
        })
      })

      ElMessage.info(`已撤回${pendingRows.length}项指标提交`)
    })
  }

  // 全局批量提交（职能部门/二级学院专用）
  const _handleBatchSubmitAll = () => {
    // 找出所有待提交（draft）或已驳回（rejected）的指标
    // @requirement 2.6 - 使用安全的状态检查，处理无效枚举值
    const pendingRows = indicators.value.filter(r => isApprovalStatus(r, ['DRAFT', 'REJECTED']))

    if (pendingRows.length === 0) {
      ElMessage.warning('没有可提交的指标')
      return
    }

    const indicatorNames = pendingRows.map(ind => ind.name).join('、')

    ElMessageBox.prompt(
      `确认批量提交 ${pendingRows.length} 个指标的进度填报？\n\n指标列表：${indicatorNames}\n\n请输入提交备注：`,
      '批量提交确认',
      {
        confirmButtonText: '确定提交',
        cancelButtonText: '取消',
        inputPlaceholder: '请输入提交备注',
        inputType: 'textarea',
        inputValidator: value => {
          if (!value || !value.trim()) {
            return '请输入提交备注'
          }
          return true
        }
      }
    ).then(({ value: submitComment }) => {
      pendingRows.forEach(row => {
        // 提交：将状态改为 pending，并将 pendingProgress 等数据提交审批
        strategicStore.updateIndicator(row.id.toString(), {
          progressApprovalStatus: 'PENDING',
          progress: row.pendingProgress || row.progress || 0,
          progressComment: row.pendingProgressComment || row.progressComment || ''
        })

        // 添加审计日志
        strategicStore.addStatusAuditEntry(row.id.toString(), {
          operator: authStore.userName || 'unknown',
          operatorName: authStore.userName || '未知用户',
          operatorDept: authStore.userDepartment || '未知部门',
          action: 'submit',
          comment: submitComment || '批量提交进度填报',
          previousStatus: row.progressApprovalStatus,
          newStatus: 'PENDING',
          previousProgress: row.progress,
          newProgress: row.pendingProgress,
          progressComment: row.pendingProgressComment
        })

        clearPersistedIndicatorDraft(row.id)
      })

      ElMessage.success(`成功提交${pendingRows.length}项指标进度`)
    })
  }

  // 全局批量撤回（职能部门/二级学院专用）
  // 获取任务类型对应的颜色
  const getTaskTypeColor = (type2: string) => {
    return type2 === '发展性' ? '#409EFF' : '#67C23A'
  }

  // 按类别筛选指标
  const _developmentIndicators = computed(() => indicators.value.filter(i => i.type2 === '发展性'))
  const _basicIndicators = computed(() => indicators.value.filter(i => i.type2 === '基础性'))

  // 新增行数据
  const newRow = ref({
    taskContent: '',
    name: '',
    type1: '定性' as '定性' | '定量',
    type2: '基础性' as '发展性' | '基础性',
    weight: '',
    remark: '',
    milestones: [] as Array<{
      id: number
      name: string
      targetProgress: number
      deadline: string
      status: 'pending' | 'completed' | 'overdue'
    }>
  })

  // 获取任务选项列表（从 Store 中的 tasks 获取）
  const taskOptions = computed(() =>
    strategicStore.tasks.map(t => ({
      value: t.title,
      label: t.title
    }))
  )

  // 里程碑输入状态
  const _showMilestoneInput = ref(false)

  // 任务下发相关状态
  const showAssignmentDialog = ref(false)
  const assignmentTarget = ref('')
  const assignmentMethod = ref<'self' | 'college'>('self')

  // 添加新里程碑
  const _addMilestone = () => {
    newRow.value.milestones.push({
      id: Date.now(),
      name: '',
      targetProgress: 0,
      deadline: '',
      status: 'pending'
    })
  }

  // 删除里程碑
  const _removeMilestone = (index: number) => {
    newRow.value.milestones.splice(index, 1)
  }

  // 当前日期
  const currentDate = '2025年12月5日'

  // 编辑状态管理（任务详情）
  const editingField = ref<string | null>(null)
  const editingValue = ref('')

  // 指标列表编辑状态
  const editingIndicatorId = ref<number | null>(null)
  const editingIndicatorField = ref<string | null>(null)
  const editingIndicatorValue = ref<any>(null)

  // 任务详情双击编辑处理
  const _handleDoubleClick = (field: 'title' | 'desc' | 'cycle' | 'createTime', value: string) => {
    if (!canEdit.value) {
      return
    }
    editingField.value = field
    editingValue.value = value
  }

  // 任务详情保存编辑
  const _saveEdit = (field: 'title' | 'desc' | 'cycle' | 'createTime') => {
    if (editingValue.value === undefined || editingValue.value === null) {
      cancelEdit()
      return
    }

    const task = taskList.value[currentTaskIndex.value]
    if (field === 'title') {
      task.title = editingValue.value
    } else if (field === 'desc') {
      task.desc = editingValue.value
    } else if (field === 'cycle') {
      task.cycle = editingValue.value
    } else if (field === 'createTime') {
      task.createTime = editingValue.value
    }

    cancelEdit()
  }

  // 任务详情取消编辑
  const cancelEdit = () => {
    editingField.value = null
    editingValue.value = ''
  }

  // 指标双击编辑
  const handleIndicatorDblClick = (row: StrategicIndicator, field: string) => {
    if (!canEdit.value) {
      return
    }
    editingIndicatorId.value = row.id
    editingIndicatorField.value = field
    editingIndicatorValue.value = row[field as keyof StrategicIndicator]
  }

  // 保存指标编辑
  const saveIndicatorEdit = (row: StrategicIndicator, field: string) => {
    if (editingIndicatorId.value === null) {
      return
    }

    if (editingIndicatorValue.value === null || editingIndicatorValue.value === undefined) {
      cancelIndicatorEdit()
      return
    }

    const updates: Partial<StrategicIndicator> = {}

    if (field === 'type1' || field === 'type2') {
      updates[field] = editingIndicatorValue.value
      if (field === 'type1') {
        updates.isQualitative = editingIndicatorValue.value === '定性'
      }
    } else {
      ;(updates as any)[field] = editingIndicatorValue.value
    }

    strategicStore.updateIndicator(row.id.toString(), updates)
    cancelIndicatorEdit()
  }

  // 取消指标编辑
  const cancelIndicatorEdit = () => {
    editingIndicatorId.value = null
    editingIndicatorField.value = null
    editingIndicatorValue.value = null
  }

  // 方法
  const addNewRow = () => {
    isAddingOrEditing.value = true
  }

  // 在指定类别中添加新指标
  const _addIndicatorToCategory = (category: '发展性' | '基础性') => {
    newRow.value.type2 = category
    isAddingOrEditing.value = true
  }

  const cancelAdd = () => {
    isAddingOrEditing.value = false
    newRow.value = {
      taskContent: '',
      name: '',
      type1: '定性',
      type2: '基础性',
      weight: '',
      remark: '',
      milestones: []
    }
  }

  const saveNewRow = () => {
    if (!newRow.value.taskContent) {
      ElMessage.warning('请先选择所属战略任务')
      return
    }
    if (!newRow.value.name) {
      ElMessage.warning('请输入指标名称')
      return
    }

    strategicStore.addIndicator({
      id: Date.now().toString(),
      name: newRow.value.name,
      isQualitative: newRow.value.type1 === '定性',
      type1: newRow.value.type1,
      type2: newRow.value.type2,
      progress: 0,
      createTime: currentDate,
      weight: Number(newRow.value.weight) || 0,
      remark: newRow.value.remark || '无备注',
      canWithdraw: true,
      milestones: [...newRow.value.milestones],
      targetValue: 100,
      unit: '%',
      responsibleDept: authStore.userDepartment || '未分配',
      responsiblePerson: '',
      status: 'active',
      isStrategic: true,
      taskContent: newRow.value.taskContent
    })
    ElMessage.success('指标添加成功')
    cancelAdd()
  }

  // 里程碑状态计算
  // @requirement 2.4 - Milestone data validation with complete fields
  const _calculateMilestoneStatus = (
    indicator: StrategicIndicator
  ): 'success' | 'warning' | 'exception' => {
    if (!indicator.milestones || indicator.milestones.length === 0) {
      return getProgressStatus(indicator.progress)
    }

    const currentDate = new Date()

    const hasOverdueMilestone = indicator.milestones.some(milestone => {
      // 使用 safeGet 安全获取字段值，缺失时使用默认值
      const deadline = safeGet(milestone, 'deadline', '')
      const status = safeGet(milestone, 'status', 'pending')

      if (!deadline) {
        return false
      } // 没有截止日期的里程碑不算逾期

      const deadlineDate = new Date(deadline)
      if (isNaN(deadlineDate.getTime())) {
        return false
      } // 无效日期不算逾期

      return status === 'pending' && deadlineDate < currentDate
    })

    const hasUpcomingMilestone = indicator.milestones.some(milestone => {
      const status = String(safeGet(milestone, 'status', 'pending'))
      const deadline = safeGet(milestone, 'deadline', '')

      if (status === 'completed') {
        return false
      }
      if (!deadline) {
        return false
      } // 没有截止日期的里程碑不算即将到期

      const deadlineDate = new Date(deadline)
      if (isNaN(deadlineDate.getTime())) {
        return false
      } // 无效日期不算即将到期

      const daysUntilDeadline = Math.ceil(
        (deadlineDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24)
      )
      return daysUntilDeadline > 0 && daysUntilDeadline <= 30
    })

    if (hasOverdueMilestone) {
      return 'exception'
    } else if (hasUpcomingMilestone) {
      return 'warning'
    } else {
      return 'success'
    }
  }

  // 获取里程碑进度文本
  // @requirement 2.4 - Milestone data validation with complete fields
  const _getMilestoneProgressText = (indicator: StrategicIndicator): string => {
    if (!indicator.milestones || indicator.milestones.length === 0) {
      return `当前进度: ${indicator.progress}%`
    }

    // 使用 safeGet 安全获取状态字段
    const pendingMilestones = indicator.milestones.filter(m => {
      const status = safeGet(m, 'status', 'pending')
      return status === 'pending'
    }).length

    const currentDate = new Date()
    const overdueMilestonesCount = indicator.milestones.filter(m => {
      const status = safeGet(m, 'status', 'pending')
      const deadline = safeGet(m, 'deadline', '')

      if (status !== 'pending') {
        return false
      }
      if (!deadline) {
        return false
      } // 没有截止日期的里程碑不算逾期

      const deadlineDate = new Date(deadline)
      if (isNaN(deadlineDate.getTime())) {
        return false
      } // 无效日期不算逾期

      return deadlineDate < currentDate
    }).length

    if (overdueMilestonesCount > 0) {
      return `逾期: ${overdueMilestonesCount} 个里程碑`
    } else if (pendingMilestones > 0) {
      return `待完成: ${pendingMilestones} 个里程碑`
    } else {
      return '所有里程碑已完成'
    }
  }

  // ============================================================
  // 进度状态颜色计算函数
  // 当前填报按月度周期推进，不再依赖里程碑节点。
  // ============================================================
  const PROGRESS_WARNING_DAYS = 5 // 保留导出给旧调用方，月度周期判定不再使用该阈值

  type ProgressStatusType = 'delayed' | 'warning' | 'ahead' | 'normal'

  const getMonthlyExpectedProgress = (date = new Date()) => {
    const month = date.getMonth() + 1
    return Math.min(100, Math.round((month / 12) * 100))
  }

  /**
   * 获取指标进度状态
   * @param indicator 指标对象
   * @returns 'delayed' | 'warning' | 'ahead' | 'normal'
   *
   * 逻辑说明：
   * 1. delayed（红色）：低于当前月份理论进度 10 个百分点以上
   * 2. warning（黄色）：低于当前月份理论进度
   * 3. ahead（绿色）：高于当前月份理论进度
   * 4. normal（默认）：达到当前月份理论进度
   */
  const getIndicatorProgressStatus = (indicator: StrategicIndicator): ProgressStatusType => {
    const currentProgress = indicator.progress || 0
    const expectedProgress = getMonthlyExpectedProgress()

    if (currentProgress < expectedProgress - 10) {
      return 'delayed'
    }
    if (currentProgress < expectedProgress) {
      return 'warning'
    }
    if (currentProgress > expectedProgress) {
      return 'ahead'
    }

    return 'normal'
  }

  /**
   * 获取进度状态对应的CSS类名
   */
  const getProgressStatusClass = (indicator: StrategicIndicator): string => {
    const status = getIndicatorProgressStatus(indicator)
    const classMap: Record<ProgressStatusType, string> = {
      delayed: 'progress-delayed',
      warning: 'progress-warning',
      ahead: 'progress-ahead',
      normal: ''
    }
    return classMap[status]
  }

  // 获取里程碑列表用于tooltip显示
  // @requirement 2.4 - Milestone data validation with complete fields
  interface MilestoneTooltipItem {
    id: string | number
    name: string
    expectedDate: string
    progress: number
    status: string
    isValid: boolean
  }

  /**
   * 验证并获取里程碑数据用于tooltip显示
   *
   * 对每个里程碑进行数据完整性验证，缺失字段时显示默认值
   *
   * @param indicator - 指标对象
   * @returns 验证后的里程碑列表，包含默认值填充
   *
   * @requirement 2.4 - Milestone data validation with complete fields
   */
  const getMilestonesTooltip = (indicator: StrategicIndicator): MilestoneTooltipItem[] => {
    const milestones = sortMilestonesByProgress(indicator.milestones || [])

    return milestones.map((m, index) => {
      // 验证里程碑数据完整性
      const validationResult = validateMilestone(m)

      // 使用 safeGet 安全获取字段值，缺失时使用默认值
      const id = safeGet(m, 'id', `milestone-${index}`)
      const name = safeGet(m, 'name', '未命名里程碑')
      const deadline = safeGet(m, 'deadline', '')
      const targetProgress = safeGet(m, 'targetProgress', 0)
      const status = safeGet(m, 'status', 'pending')

      // 验证状态是否为有效枚举值
      const validStatus = MILESTONE_STATUS_VALUES.includes(
        status as (typeof MILESTONE_STATUS_VALUES)[number]
      )
        ? status
        : 'pending'

      // 格式化日期显示
      let expectedDate = ''
      if (deadline) {
        try {
          const date = new Date(deadline)
          if (!isNaN(date.getTime())) {
            expectedDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
          }
        } catch {
          expectedDate = '日期格式错误'
        }
      } else {
        expectedDate = '未设置'
      }

      return {
        id,
        name,
        expectedDate,
        progress: typeof targetProgress === 'number' ? targetProgress : 0,
        status: validStatus,
        isValid: validationResult.isValid
      }
    })
  }

  const getSortedMilestones = (milestones?: StrategicIndicator['milestones']) =>
    sortMilestonesByProgress(milestones || [])

  const _selectDepartment = (dept: string) => {
    selectedDepartment.value = dept
  }

  const _selectTask = (index: number) => {
    currentTaskIndex.value = index
  }

  // 表格选择变化处理
  const handleSelectionChange = (selection: StrategicIndicator[]) => {
    selectedIndicators.value = selection
  }

  // 任务下发相关方法
  const _confirmAssignment = () => {
    if (!assignmentTarget.value) {
      ElMessage.warning('请选择下发目标')
      return
    }

    const indicatorNames = selectedIndicators.value.map(ind => ind.name).join('、')
    const targetName =
      assignmentMethod.value === 'self' ? '自己完成' : `下发给${assignmentTarget.value}`

    ElMessageBox.confirm(`确认将以下指标${targetName}？\n\n${indicatorNames}`, '确认下发', {
      confirmButtonText: '确定下发',
      cancelButtonText: '取消',
      type: 'info'
    }).then(() => {
      ElMessage.success(
        `成功下发${selectedIndicators.value.length}项指标到${assignmentTarget.value}`
      )
      showAssignmentDialog.value = false
      assignmentTarget.value = ''
      assignmentMethod.value = 'self'
    })
  }

  // 批量分解到职能部门（战略发展部专用）
  const _batchDistributeToDepartments = () => {
    const departments = ['教务处', '科研处', '人事处']
    const indicatorNames = selectedIndicators.value.map(ind => ind.name).join('、')

    ElMessageBox.confirm(
      `确认将以下指标分解到各职能部门？\n\n${indicatorNames}\n\n目标部门：${departments.join('、')}`,
      '确认分解',
      {
        confirmButtonText: '确定分解',
        cancelButtonText: '取消',
        type: 'warning'
      }
    ).then(() => {
      ElMessage.success(`成功分解${selectedIndicators.value.length}项指标到职能部门`)
      tableRef.value?.clearSelection()
    })
  }

  // 详情抽屉状态
  const detailDrawerVisible = ref(false)
  const currentDetail = ref<StrategicIndicator | null>(null)

  // 查看详情
  const handleViewDetail = (row: StrategicIndicator) => {
    currentDetail.value = row
    detailDrawerVisible.value = true
  }

  // 删除指标
  const handleDeleteIndicator = (row: StrategicIndicator) => {
    ElMessageBox.confirm(`确定要删除指标 "${row.name}" 吗？删除后无法恢复。`, '删除确认', {
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
      type: 'warning'
    }).then(() => {
      strategicStore.deleteIndicator(row.id.toString())
      ElMessage.success('指标已删除')
    })
  }

  // ============================================================================
  // 指标生命周期撤回操作 (Indicator Lifecycle Withdrawal)
  // 操作字段: status (DISTRIBUTED -> DRAFT via approval workflow)
  // 用途: 撤回已下发的指标，使其回到草稿状态可重新编辑
  // @requirement 2.1, 2.2, 3.3, 3.4 - 分离审批操作和生命周期操作
  // ============================================================================

  /**
   * 撤回已下发的指标 (生命周期操作)
   * 操作指标的生命周期状态字段 (status)，不影响进度审批状态
   * 这是一个需要审批的操作：DISTRIBUTED -> PENDING_WITHDRAW_REVIEW -> DRAFT
   */
  const handleWithdrawIndicator = (row: StrategicIndicator) => {
    ElMessageBox.confirm(
      `确定要撤回指标 "${row.name}" 的下发吗？撤回后可以重新编辑。`,
      '撤回指标下发',
      {
        confirmButtonText: '确定撤回',
        cancelButtonText: '取消',
        type: 'warning'
      }
    ).then(async () => {
      try {
        // 调用后端服务撤回指标生命周期状态
        await strategicStore.withdrawIndicator(row.id.toString())
        ElMessage.success('指标下发撤回成功')
      } catch (err) {
        ElMessage.error('指标下发撤回失败，请稍后重试')
      }
    })
  }

  // 表格滚动状态
  const _tableScrollRef = ref<HTMLElement | null>(null)
  const isTableScrolling = ref(false)

  const _handleTableScroll = (e: Event) => {
    const target = e.target as HTMLElement
    const scrollLeft = target.scrollLeft
    const scrollWidth = target.scrollWidth
    const clientWidth = target.clientWidth
    isTableScrolling.value = scrollLeft < scrollWidth - clientWidth - 2
  }

  // ================== 进度填报相关 ==================

  // 填报弹窗状态
  const reportDialogVisible = ref(false)
  const currentReportIndicator = ref<StrategicIndicator | null>(null)
  const isSavingReport = ref(false)
  const isUploadingReportFiles = ref(false)
  const reportUploadFiles = ref<ReportUploadFile[]>([])

  // 填报表单数据
  const reportForm = ref({
    newProgress: 0,
    remark: '',
    attachments: [] as string[]
  })

  // 计算离当前进度最近的里程碑目标
  // 优先返回“当前进度尚未达到的最近一个里程碑”；
  // 若当前进度已超过所有里程碑，则回退到最后一个里程碑。
  // @requirement 2.4 - Milestone data validation with complete fields
  const nearestMilestone = computed(() => {
    if (!currentReportIndicator.value?.milestones?.length) {
      return null
    }

    const currentProgress = Number(currentReportIndicator.value.progress || 0)
    const normalizedMilestones = currentReportIndicator.value.milestones
      .map(m => {
        const deadline = safeGet(m, 'deadline', '')
        const name = safeGet(m, 'name', '未命名里程碑')
        const targetProgress = Number(safeGet(m, 'targetProgress', 0))
        const id = safeGet(m, 'id', '')
        const status = safeGet(m, 'status', 'pending')

        return {
          id,
          name,
          targetProgress,
          deadline,
          status
        }
      })
      .filter(m => Number.isFinite(m.targetProgress))
      .sort((a, b) => a.targetProgress - b.targetProgress)

    const nextMilestone = normalizedMilestones.find(m => m.targetProgress >= currentProgress)
    if (nextMilestone) {
      return nextMilestone
    }

    return normalizedMilestones[normalizedMilestones.length - 1] || null
  })

  // 格式化里程碑日期
  // @requirement 2.4 - Milestone data validation with complete fields
  const formatMilestoneDate = (deadline: string) => {
    if (!deadline) {
      return '未设置'
    }
    const date = new Date(deadline)
    if (isNaN(date.getTime())) {
      return '日期格式错误'
    }
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }

  function resolveDialogAttachments(
    row: StrategicIndicator,
    persistedDraft?: PersistedIndicatorDraft | null
  ): DisplayAttachmentItem[] {
    const rawAttachments = (
      row as StrategicIndicator & {
        pendingAttachmentDetails?: Attachment[]
      }
    ).pendingAttachmentDetails

    if (Array.isArray(rawAttachments) && rawAttachments.length > 0) {
      return rawAttachments.map(attachment => ({
        name: attachment.fileName || '附件',
        url: attachment.url,
        attachmentId: Number(attachment.id)
      }))
    }

    if (
      Array.isArray(persistedDraft?.attachmentDetails) &&
      persistedDraft.attachmentDetails.length > 0
    ) {
      return persistedDraft.attachmentDetails.map((attachment, index) => ({
        name: attachment.fileName || `附件${index + 1}`,
        url: attachment.url,
        attachmentId: Number(attachment.id)
      }))
    }

    const attachmentUrls = row.pendingAttachments ?? persistedDraft?.attachments ?? []
    return attachmentUrls.map((url, index) => ({
      name: String(url).split('/').pop() || `附件${index + 1}`,
      url
    }))
  }

  const refreshReportIndicatorSnapshot = async (
    indicator: StrategicIndicator
  ): Promise<StrategicIndicator> => {
    try {
      const { indicatorApi } = await import('@/features/indicator/api')
      const response = await indicatorApi.getIndicatorById(String(indicator.id))
      const latest =
        response && typeof response === 'object' && 'data' in response ? response.data : response

      if (!latest || typeof latest !== 'object') {
        return indicator
      }

      const latestRecord = latest as Record<string, unknown>
      const normalizedMilestones = Array.isArray(latestRecord.milestones)
        ? normalizePlanMilestones(latestRecord.milestones)
        : indicator.milestones

      const mergedIndicator = {
        ...indicator,
        ...(latest as Partial<StrategicIndicator>),
        milestones: normalizedMilestones,
        reportProgress: (indicator as StrategicIndicator & { reportProgress?: number | null })
          .reportProgress,
        pendingProgress: indicator.pendingProgress,
        pendingRemark: indicator.pendingRemark,
        pendingAttachments: indicator.pendingAttachments,
        pendingAttachmentDetails: (
          indicator as StrategicIndicator & { pendingAttachmentDetails?: Attachment[] }
        ).pendingAttachmentDetails,
        currentReportId: (indicator as StrategicIndicator & { currentReportId?: number | null })
          .currentReportId
      } as StrategicIndicator

      currentReportIndicator.value = mergedIndicator
      return mergedIndicator
    } catch (error) {
      logger.warn('[IndicatorListView] 刷新填报弹窗指标快照失败，继续使用列表数据:', {
        indicatorId: indicator.id,
        error
      })
      return indicator
    }
  }

  // 打开填报弹窗
  const handleOpenReportDialog = async (row: StrategicIndicator) => {
    const latestIndicator = await refreshReportIndicatorSnapshot(row)
    const persistedDraft = readPersistedIndicatorDraft(row.id)
    const reportedProgress = getDisplayedReportedProgress(row)
    const attachmentItems = resolveDialogAttachments(row, persistedDraft)
    const actualProgress = Number(latestIndicator.progress || 0)
    const preferredProgress =
      (reportedProgress !== null ? reportedProgress : null) ??
      row.pendingProgress ??
      persistedDraft?.progress ??
      latestIndicator.progress ??
      0
    reportForm.value = {
      newProgress: Math.max(actualProgress, Number(preferredProgress) || 0),
      remark: row.pendingRemark ?? persistedDraft?.remark ?? '',
      attachments: attachmentItems.map(item => item.url)
    }
    reportUploadFiles.value = attachmentItems.map((item, index) => ({
      name: item.name || `附件${index + 1}`,
      url: item.url,
      attachmentId: item.attachmentId,
      status: 'success',
      uid: `${row.id}-${index}-${item.url}`
    }))
    reportDialogVisible.value = true
  }

  // 关闭填报弹窗
  const closeReportDialog = () => {
    reportDialogVisible.value = false
    currentReportIndicator.value = null
    reportForm.value = {
      newProgress: 0,
      remark: '',
      attachments: []
    }
    reportUploadFiles.value = []
  }

  const syncReportAttachmentUrls = () => {
    reportForm.value.attachments = reportUploadFiles.value
      .map(file => file.url || file.name || '')
      .filter(Boolean)
  }

  const reportAttachmentObjectUrls = new Set<string>()

  const previewableAttachmentExtensions = new Set([
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'bmp',
    'svg',
    'pdf',
    'txt',
    'md',
    'json',
    'csv'
  ])

  const getAttachmentExtension = (name?: string, url?: string) => {
    const source = String(name || url || '')
      .trim()
      .toLowerCase()
    const cleanSource = source.split('?')[0]?.split('#')[0] || ''
    const matched = cleanSource.match(/\.([a-z0-9]+)$/)
    return matched?.[1] || ''
  }

  const openBlobInNewTab = (blob: Blob) => {
    const objectUrl = window.URL.createObjectURL(blob)
    reportAttachmentObjectUrls.add(objectUrl)
    window.open(objectUrl, '_blank', 'noopener,noreferrer')
  }

  const triggerBlobDownload = (blob: Blob, filename: string) => {
    const objectUrl = window.URL.createObjectURL(blob)
    reportAttachmentObjectUrls.add(objectUrl)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filename || 'download'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const openLocalAttachmentFile = (file: ReportUploadFile) => {
    const rawFile = file.raw
    if (!(rawFile instanceof File)) {
      return false
    }

    const extension = getAttachmentExtension(file.name, rawFile.name)
    if (previewableAttachmentExtensions.has(extension)) {
      openBlobInNewTab(rawFile)
      return true
    }

    triggerBlobDownload(rawFile, file.name || rawFile.name || 'download')
    return true
  }

  const openRemoteAttachmentFile = async (file: ReportUploadFile) => {
    const targetUrl = String(file.url || '').trim()
    if (!targetUrl) {
      return false
    }

    const response = await apiClient.getAxiosInstance().get(targetUrl, {
      responseType: 'blob'
    })

    const blob = response.data instanceof Blob ? response.data : new Blob([response.data])
    const extension = getAttachmentExtension(file.name, targetUrl)
    if (previewableAttachmentExtensions.has(extension)) {
      openBlobInNewTab(blob)
      return true
    }

    triggerBlobDownload(blob, file.name || 'download')
    return true
  }

  const handleReportAttachmentOpen = async (file: ReportUploadFile) => {
    try {
      if (openLocalAttachmentFile(file)) {
        return
      }

      if (await openRemoteAttachmentFile(file)) {
        return
      }

      ElMessage.warning('当前附件暂时无法打开')
    } catch (error) {
      logger.error('[IndicatorListView] 打开附件失败:', error)
      ElMessage.error('打开附件失败，请稍后重试')
    }
  }

  const openDisplayAttachmentItem = async (item: DisplayAttachmentItem) => {
    try {
      const targetUrl = String(item.url || '').trim()
      if (!targetUrl) {
        ElMessage.warning('当前附件暂时无法打开')
        return
      }

      const response = await apiClient.getAxiosInstance().get(targetUrl, {
        responseType: 'blob'
      })

      const blob = response.data instanceof Blob ? response.data : new Blob([response.data])
      const extension = getAttachmentExtension(item.name, targetUrl)
      if (previewableAttachmentExtensions.has(extension)) {
        openBlobInNewTab(blob)
        return
      }

      triggerBlobDownload(blob, item.name || 'download')
    } catch (error) {
      logger.error('[IndicatorListView] 打开历史附件失败:', error)
      ElMessage.error('打开附件失败，请稍后重试')
    }
  }

  const resolveIndicatorAttachmentItems = (
    indicator:
      | (StrategicIndicator & {
          pendingAttachmentDetails?: Attachment[]
          pendingAttachments?: string[]
        })
      | null
  ): DisplayAttachmentItem[] => {
    if (!indicator) {
      return []
    }

    const rawAttachmentDetails = Array.isArray(indicator.pendingAttachmentDetails)
      ? indicator.pendingAttachmentDetails
      : []

    if (rawAttachmentDetails.length > 0) {
      return rawAttachmentDetails.map((attachment, index) => ({
        name: attachment.fileName || `附件${index + 1}`,
        url: attachment.url,
        attachmentId: Number(attachment.id)
      }))
    }

    const rawAttachments = Array.isArray(indicator.pendingAttachments)
      ? indicator.pendingAttachments
      : []
    return rawAttachments.map((url, index) => ({
      name: String(url).split('/').pop() || `附件${index + 1}`,
      url: String(url)
    }))
  }

  const currentDetailAttachmentItems = computed(() =>
    resolveIndicatorAttachmentItems(
      currentDetail.value as
        | (StrategicIndicator & {
            pendingAttachmentDetails?: Attachment[]
            pendingAttachments?: string[]
          })
        | null
    )
  )

  const handleInlineAttachmentRemove = (targetFile: UploadUserFile) => {
    reportUploadFiles.value = reportUploadFiles.value.filter(file => file.uid !== targetFile.uid)
    syncReportAttachmentUrls()
  }

  const handleReportFileChange: UploadProps['onChange'] = (_uploadFile, uploadFiles) => {
    reportUploadFiles.value = uploadFiles as ReportUploadFile[]
    syncReportAttachmentUrls()
  }

  const handleReportFileRemove: UploadProps['onRemove'] = (_uploadFile, uploadFiles) => {
    reportUploadFiles.value = uploadFiles as ReportUploadFile[]
    syncReportAttachmentUrls()
    return true
  }

  const beforeReportUpload: UploadProps['beforeUpload'] = file => {
    const isLt30M = file.size / 1024 / 1024 < 30
    if (!isLt30M) {
      ElMessage.error('附件大小不能超过 30MB')
    }
    return isLt30M
  }

  const normalizeUploadedAttachment = (
    payload: Record<string, unknown>,
    fallbackName: string,
    currentUserId: number
  ): Attachment => {
    const id = String(payload.id ?? '')
    const resolvedFileName = payload.fileName ?? payload.originalName ?? fallbackName
    const fileName = String(resolvedFileName || '附件')
    const url = String(payload.url ?? payload.publicUrl ?? fileName)
    const fileSize = Number(payload.fileSize ?? payload.sizeBytes ?? 0)
    const fileType = String(payload.fileType ?? payload.contentType ?? '')
    const uploadedBy = Number(payload.uploadedBy ?? currentUserId)
    const uploadedAt = String(payload.uploadedAt ?? '')

    return {
      id,
      fileName,
      fileSize: Number.isFinite(fileSize) ? fileSize : 0,
      fileType,
      url,
      uploadedBy: Number.isFinite(uploadedBy) ? uploadedBy : currentUserId,
      uploadedAt
    }
  }

  const uploadReportAttachments = async (): Promise<{
    attachmentIds: number[]
    attachmentUrls: string[]
    attachmentDetails: Attachment[]
  }> => {
    const currentUserId =
      Number(authStore.user?.id ?? (authStore.user as { userId?: number } | null)?.userId) || 0

    const attachmentIds: number[] = []
    const attachmentUrls: string[] = []
    const attachmentDetails: Attachment[] = []
    isUploadingReportFiles.value = true

    try {
      for (const file of reportUploadFiles.value) {
        if (file.attachmentId) {
          attachmentIds.push(file.attachmentId)
          attachmentUrls.push(file.url || file.name)
          attachmentDetails.push({
            id: String(file.attachmentId),
            fileName: file.name || '附件',
            fileSize: Number(file.size || 0),
            fileType: '',
            url: file.url || file.name || '',
            uploadedBy: currentUserId,
            uploadedAt: ''
          })
          continue
        }

        const rawFile = file.raw
        if (!(rawFile instanceof File)) {
          if (file.url) {
            attachmentUrls.push(file.url)
          }
          continue
        }

        file.status = 'uploading'

        let uploaded: Attachment
        try {
          const response = await apiService.upload<{
            code: number
            data: Record<string, unknown>
            message: string
          }>('/attachments/upload', rawFile, {
            uploadedBy: currentUserId
          })

          const rawUploaded =
            response &&
            typeof response === 'object' &&
            response.data &&
            typeof response.data === 'object'
              ? response.data
              : null

          if (!rawUploaded?.id) {
            throw new Error(response.message || '附件上传失败')
          }

          uploaded = normalizeUploadedAttachment(
            rawUploaded,
            file.name || rawFile.name,
            currentUserId
          )
        } catch (error) {
          file.status = 'fail'
          throw new AttachmentUploadError('附件上传失败', error)
        }

        file.attachmentId = Number(uploaded.id)
        file.url = uploaded.url
        file.name = uploaded.fileName || file.name
        file.status = 'success'

        attachmentIds.push(Number(uploaded.id))
        attachmentUrls.push(uploaded.url || uploaded.fileName)
        attachmentDetails.push({
          id: String(uploaded.id),
          fileName: uploaded.fileName || file.name || '附件',
          fileSize: Number(uploaded.fileSize || 0),
          fileType: uploaded.fileType || '',
          url: uploaded.url || uploaded.fileName || '',
          uploadedBy: Number(uploaded.uploadedBy || currentUserId),
          uploadedAt: uploaded.uploadedAt || ''
        })
      }
    } finally {
      isUploadingReportFiles.value = false
    }

    reportForm.value.attachments = attachmentUrls
    return { attachmentIds, attachmentUrls, attachmentDetails }
  }

  const syncBackendReportedProgress = (
    indicatorId: number | string,
    payload: {
      progressApprovalStatus?: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'NONE'
      reportProgress: number
      pendingProgress?: number | null
      pendingRemark?: string | null
      pendingAttachments?: string[]
      pendingAttachmentDetails?: Attachment[]
      currentReportId?: number | null
    }
  ) => {
    strategicStore.patchIndicator(String(indicatorId), payload)

    if (currentDetail.value && String(currentDetail.value.id) === String(indicatorId)) {
      currentDetail.value = {
        ...currentDetail.value,
        ...payload
      }
    }

    if (currentPlanDetails.value?.indicators?.length) {
      currentPlanDetails.value = {
        ...currentPlanDetails.value,
        indicators: currentPlanDetails.value.indicators.map((item: any) => {
          const itemId = String(item?.id ?? item?.indicatorId ?? '')
          if (itemId !== String(indicatorId)) {
            return item
          }

          return {
            ...item,
            ...(payload.progressApprovalStatus
              ? { progressApprovalStatus: payload.progressApprovalStatus }
              : {}),
            reportProgress: payload.reportProgress,
            pendingProgress: payload.pendingProgress,
            pendingRemark: payload.pendingRemark,
            pendingAttachments: payload.pendingAttachments,
            pendingAttachmentDetails: payload.pendingAttachmentDetails,
            currentReportId: payload.currentReportId
          }
        })
      }
    }

    if (Array.isArray(currentPlanReportSummary.value?.indicatorDetails)) {
      currentPlanReportSummary.value = {
        ...currentPlanReportSummary.value,
        indicatorDetails: currentPlanReportSummary.value.indicatorDetails.map(detail => {
          const detailIndicatorId = String(detail?.indicatorId ?? '')
          if (detailIndicatorId !== String(indicatorId)) {
            return detail
          }

          return {
            ...detail,
            progress: payload.pendingProgress ?? payload.reportProgress,
            comment: payload.pendingRemark ?? '',
            attachments: Array.isArray(payload.pendingAttachmentDetails)
              ? payload.pendingAttachmentDetails
              : []
          }
        })
      }
    }
  }

  // 保存进度填报（设为待提交状态）
  const submitProgressReport = async () => {
    if (!currentReportIndicator.value) {
      return
    }

    const indicator = await refreshReportIndicatorSnapshot(currentReportIndicator.value)

    // 验证：月度填报允许按实际情况修订为 0-100 之间的任意百分比。
    if (reportForm.value.newProgress < 0) {
      ElMessage.warning('进度不能小于 0%')
      return
    }

    // 验证：进度不能超过100
    if (reportForm.value.newProgress > 100) {
      ElMessage.warning('进度不能超过 100%')
      return
    }

    // 验证：必须填写说明
    if (!reportForm.value.remark.trim()) {
      ElMessage.warning('请填写进度备注')
      return
    }

    try {
      isSavingReport.value = true
      const { indicatorFillApi } = await import('@/features/plan/api/planApi')
      await indicatorFillApi.ensureEditable(indicator.id)
      let attachmentIds: number[] = []
      let attachmentUrls: string[] = []
      let attachmentDetails: Attachment[] = []

      try {
        ;({ attachmentIds, attachmentUrls, attachmentDetails } = await uploadReportAttachments())
      } catch (error) {
        if (!(error instanceof AttachmentUploadError)) {
          throw error
        }

        logger.warn('[IndicatorListView] 附件上传失败，已阻止保存:', error.cause ?? error)
        ElMessage.error('附件上传失败，未保存本次填报。请稍后重试，确认附件成功上传后再保存。')
        return
      }

      const batchSourceIndicators =
        currentPlanIndicators.value.length > 0 ? currentPlanIndicators.value : indicators.value

      const batchItems = batchSourceIndicators
        .map(item => {
          const itemId = String(item.id)
          const isCurrentIndicator = itemId === String(indicator.id)
          const reportProgress = isCurrentIndicator
            ? reportForm.value.newProgress
            : item.pendingProgress
          const reportRemark = isCurrentIndicator
            ? reportForm.value.remark
            : String(item.pendingRemark || '').trim()

          if (
            reportProgress === null ||
            reportProgress === undefined ||
            !Number.isFinite(Number(reportProgress))
          ) {
            return null
          }

          if (!isCurrentIndicator && !reportRemark && getDisplayedReportedProgress(item) === null) {
            return null
          }

          return {
            indicator_id: item.id,
            indicator_name: item.name,
            progress: Number(reportProgress),
            content: reportRemark,
            milestone_id: undefined,
            attachment_ids: isCurrentIndicator ? attachmentIds : []
          }
        })
        .filter(Boolean)

      const savedFill = await planStore.saveIndicatorFill({
        indicator_id: indicator.id,
        progress: reportForm.value.newProgress,
        content: reportForm.value.remark,
        attachments: [],
        // Attachments are uploaded first and linked by attachment_ids in batch_items.
        milestone_id: undefined,
        batch_items: batchItems
      })

      persistIndicatorDraft(indicator.id, {
        progress: reportForm.value.newProgress,
        remark: reportForm.value.remark,
        attachments: attachmentUrls,
        attachmentDetails
      })

      const savedReportId = Number(savedFill?.id ?? 0) || null
      for (const item of batchItems) {
        const matchedIndicator = batchSourceIndicators.find(
          candidate => String(candidate.id) === String(item.indicator_id)
        )
        syncBackendReportedProgress(item.indicator_id, {
          progressApprovalStatus: matchedIndicator?.progressApprovalStatus ?? 'DRAFT',
          reportProgress: Number(item.progress),
          pendingProgress: Number(item.progress),
          pendingRemark: item.content,
          pendingAttachments:
            String(item.indicator_id) === String(indicator.id)
              ? attachmentUrls
              : (matchedIndicator?.pendingAttachments ?? []),
          pendingAttachmentDetails:
            String(item.indicator_id) === String(indicator.id)
              ? attachmentDetails
              : ((
                  matchedIndicator as StrategicIndicator & {
                    pendingAttachmentDetails?: Attachment[]
                  }
                )?.pendingAttachmentDetails ?? []),
          currentReportId: savedReportId
        })
      }

      ElMessage.success(
        attachmentUrls.length > 0
          ? '进度已保存，可在批量操作中提交'
          : '进度已保存（未关联附件），可在批量操作中提交'
      )
      closeReportDialog()
    } catch (error) {
      logger.error('[IndicatorListView] 保存进度填报失败:', error)
      ElMessage.error(
        error instanceof Error ? error.message || '保存失败，请稍后重试' : '保存失败，请稍后重试'
      )
    } finally {
      isSavingReport.value = false
    }
  }

  const refreshIndicatorWorkflowContext = async (indicatorId: number | string) => {
    invalidateQueries([
      'indicator.list',
      'task.list',
      'plan.detail',
      'dashboard.overview',
      buildQueryKey('task', 'list', { year: timeContext.currentYear })
    ])
    await loadIndicatorWorkflowSnapshot(indicatorId, { force: true })
    await strategicStore.loadIndicatorsByYear(timeContext.currentYear)
    const planId = getCurrentPlanId()
    if (planId) {
      await refreshCurrentPlanDetails(planId)
    }
    await approvalStore.loadPendingApprovals()
  }

  const refreshIndicatorListAfterMutation = async () => {
    const planId = getCurrentPlanId()

    const tasks: Promise<any>[] = [
      strategicStore.loadIndicatorsByYear(timeContext.currentYear, { force: true }),
      approvalStore.loadPendingApprovals()
    ]

    if (planId) {
      tasks.push(refreshCurrentPlanDetails(planId))
    }

    // 触发全局查询失效（强制缓存更新）
    invalidateQueries([
      'indicator.list',
      'task.list',
      'task.scope',
      'plan.list',
      'plan.detail',
      'dashboard.overview',
      buildQueryKey('task', 'list', { year: timeContext.currentYear })
    ])

    await Promise.allSettled(tasks)

    // 使用内部刷新信号触发状态重算，避免污染地址栏 query。
    indicatorRefreshTick.value = Date.now()
  }

  function applyLocalPlanReportSummary(
    report: (typeof currentPlanReportSummary.value extends infer T ? T : never) | null,
    target: 'submitted' | 'withdrawn'
  ): void {
    pendingPlanReportUiState.value = target
    writePlanReportUiState(target)

    if (!report) {
      return
    }

    const isDraftLikeStatus = (value: unknown): boolean => {
      const normalized = String(value || '')
        .trim()
        .toUpperCase()
      return !normalized || normalized === 'DRAFT'
    }

    const shouldForceSubmittedFallback = (value: unknown): boolean => {
      const normalized = String(value || '')
        .trim()
        .toUpperCase()
      return !normalized || SUBMITTED_FALLBACK_STATUSES.includes(normalized)
    }

    const shouldResetDraftStepContext =
      target === 'submitted' &&
      (shouldForceSubmittedFallback(report.status) ||
        shouldForceSubmittedFallback(report.workflowStatus))

    const nextSummary = {
      ...report,
      status:
        target === 'withdrawn'
          ? 'DRAFT'
          : shouldForceSubmittedFallback(report.status)
            ? 'SUBMITTED'
            : String(report.status || report.workflowStatus || 'SUBMITTED').toUpperCase(),
      workflowStatus:
        target === 'withdrawn'
          ? 'WITHDRAWN'
          : shouldForceSubmittedFallback(report.workflowStatus)
            ? 'SUBMITTED'
            : String(report.workflowStatus || report.status || 'SUBMITTED').toUpperCase(),
      canWithdraw: target === 'submitted' ? true : false,
      currentTaskId: shouldResetDraftStepContext ? null : (report.currentTaskId ?? null),
      currentStepName: shouldResetDraftStepContext ? null : (report.currentStepName ?? null),
      currentApproverName: shouldResetDraftStepContext
        ? null
        : ((report as { currentApproverName?: string | null }).currentApproverName ?? null)
    }

    currentPlanReportSummary.value = nextSummary
    latestPlanReportSummary.value = nextSummary?.id ? { id: Number(nextSummary.id) } : null
  }

  function applyLocalCurrentPlanDetailsPatch(
    patch: Partial<NonNullable<typeof currentPlanDetails.value>>
  ): void {
    if (!currentPlanDetails.value) {
      return
    }

    currentPlanDetails.value = {
      ...currentPlanDetails.value,
      ...patch
    }
  }

  function delay(ms: number): Promise<void> {
    return new Promise(resolve => {
      window.setTimeout(resolve, ms)
    })
  }

  async function settleCurrentPlanReportState(target: 'submitted' | 'withdrawn'): Promise<void> {
    if (!usePlanReportFlow.value) {
      await refreshIndicatorListAfterMutation()
      return
    }

    // 轮询反而会导致刚变更的最新状态被缓存（或者因为后端的秒级延迟）产生的 DRAFT 状态重新覆盖掉，
    // 进而造成循环 36 秒的灾难性卡顿。
    logger.info(`[IndicatorListView] 采用乐观 UI 直接结算 ${target} 状态`)

    // 释放一个短暂的延迟避免太冲的重绘
    await delay(100)

    // 对于职能部门线，如果不用严格审核工作流，状态在前面就已经被 applyLocalPlanReportSummary 修复好了
    // 对于战略任务线，我们发起一次标准的后台刷新即可
    if (!usePlanReportFlow.value) {
      await refreshIndicatorListAfterMutation()
    } else {
      // 短暂延迟后发起一次默默更新（不锁死 UI）来同步最新的真实数据，万一有后续变化能默默被 Vue 监听到。
      // 但是去掉了 await 阻挡。
      refreshIndicatorListAfterMutation().catch(e => {
        logger.error('Background refresh failed after optimistic update', e)
      })
    }

    // PlanReport 路径中，旧的 workflowDetail 会短暂保留提交前节点，
    // 导致页面底部状态继续显示“草稿/待填报人提交审批”直到后台刷新返回。
    // 先清掉这份旧详情，让 UI 立即回退到刚刚写入的本地摘要状态。
    currentPlanWorkflowDetail.value = null

    if (target === 'withdrawn') {
      currentPlanWorkflowDetail.value = null
    }
  }
  const handleApproveIndicatorWorkflow = async (row: StrategicIndicator) => {
    const snapshot = getIndicatorWorkflowSnapshot(row)
    if (!snapshot?.currentTaskId) {
      ElMessage.warning('当前指标没有可审批的工作流任务')
      return
    }
    if (!canHandleIndicatorWorkflow(row)) {
      ElMessage.warning('当前审批节点不是你，或当前账号缺少报告审批权限')
      return
    }

    try {
      const { value } = await ElMessageBox.prompt('请输入审批意见（可选）', '审批通过', {
        confirmButtonText: '确认通过',
        cancelButtonText: '取消',
        inputType: 'textarea'
      })
      await approveTask(String(snapshot.currentTaskId), {
        comment: value || '审批通过'
      })
      ElMessage.success('审批通过成功')
      await refreshIndicatorWorkflowContext(row.id)
    } catch {
      // user cancelled
    }
  }

  const handleRejectIndicatorWorkflow = async (row: StrategicIndicator) => {
    const snapshot = getIndicatorWorkflowSnapshot(row)
    if (!snapshot?.currentTaskId) {
      ElMessage.warning('当前指标没有可审批的工作流任务')
      return
    }
    if (!canHandleIndicatorWorkflow(row)) {
      ElMessage.warning('当前审批节点不是你，或当前账号缺少报告审批权限')
      return
    }

    try {
      const { value } = await ElMessageBox.prompt('请输入驳回原因', '审批驳回', {
        confirmButtonText: '确认驳回',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputValidator: input => (String(input || '').trim() ? true : '请填写驳回原因')
      })
      await rejectTask(String(snapshot.currentTaskId), {
        reason: String(value).trim()
      })
      ElMessage.success('审批驳回成功')
      await refreshIndicatorWorkflowContext(row.id)
    } catch {
      // user cancelled
    }
  }

  // 检查指标是否已有真实填报内容
  // 业务要求：按钮文案只根据当前轮次的 pendingProgress 判断。
  const hasReportContent = (row: StrategicIndicator): boolean => {
    return row.pendingProgress !== undefined && row.pendingProgress !== null
  }

  // 检查所有指标是否都已填报
  const allIndicatorsFilled = computed(() => {
    if (indicators.value.length === 0) {
      return false
    }
    return indicators.value.every(row => hasReportContent(row))
  })

  // 检查是否所有指标都已提交（待审批状态）
  // @requirement 2.6 - 使用安全的状态检查，处理无效枚举值
  const allIndicatorsSubmitted = computed(() => {
    if (indicators.value.length === 0) {
      return false
    }
    return indicators.value.every(row => isApprovalStatus(row, 'PENDING'))
  })

  const canWithdrawCurrentPlan = computed(() => {
    if (usePlanReportFlow.value) {
      if (!isCurrentUserReporter.value) {
        return false
      }

      const currentStepName = String(
        currentPlanWorkflowDetail.value?.currentStepName ||
          currentPlanReportSummary.value?.currentStepName ||
          currentPlanDetails.value?.currentStepName ||
          ''
      ).trim()

      const isPastSubmitterWithdrawWindow =
        currentStepName.includes('终审') ||
        currentStepName.includes('校领导') ||
        currentStepName.includes('院长') ||
        currentStepName.includes('战略发展部')

      if (pendingPlanReportUiState.value === 'submitted' && !isPastSubmitterWithdrawWindow) {
        return true
      }

      if (typeof currentPlanReportSummary.value?.canWithdraw === 'boolean') {
        return currentPlanReportSummary.value.canWithdraw
      }

      if (typeof currentPlanWorkflowDetail.value?.canWithdraw === 'boolean') {
        return currentPlanWorkflowDetail.value.canWithdraw
      }

      return ['SUBMITTED', 'PENDING'].includes(currentPlanReportUiStatus.value)
    }

    const planStatus = normalizedCurrentPlanStatus.value
    return (
      planStatus === 'PENDING' &&
      isCurrentUserReporter.value &&
      (Boolean(currentPlanDetails.value?.canWithdraw) || true) // 传统 plan 也采用乐观推测
    )
  })

  /**
   * 计算属性：判断是否存在任何可供撤回的指标。
   * 只有当至少有一个指标的状态是 'PENDING' (待审批) 时，才允许撤回。
   *
   * @requirement 2.6 - 使用安全的状态检查，处理无效枚举值
   */
  const canWithdrawAny = computed(() => {
    return canWithdrawCurrentPlan.value
  })

  const isCurrentPlanReportLocked = computed(() => {
    if (!usePlanReportFlow.value) {
      return false
    }
    return isCurrentPlanReportInApproval.value || currentPlanReportUiStatus.value === 'APPROVED'
  })

  /**
   * 计算属性：为撤回按钮提供动态的提示信息。
   */
  const withdrawTooltip = computed(() => {
    if (timeContext.isReadOnly) {
      return '当前时间窗口为只读，无法操作。'
    }
    if (canWithdrawAny.value) {
      return '' // 如果可以撤回，则没有提示
    }
    if (!isCurrentUserReporter.value) {
      return '当前登录身份不是填报人，不能撤回'
    }
    if (usePlanReportFlow.value && currentPlanReportActionState.value === 'pending_locked') {
      return '当前流程已进入下一审批节点，填报人不能再撤回'
    }
    return '当前审批进度不支持撤回' // 如果不可撤回，提供原因
  })

  // 获取未填报的指标数量
  const unfilledIndicatorsCount = computed(() => {
    return indicators.value.filter(row => !hasReportContent(row)).length
  })

  // 一键提交所有指标（职能部门/二级学院专用）
  const handleSubmitAll = () => {
    if (indicators.value.length === 0) {
      ElMessage.warning('没有可提交的指标')
      return
    }

    const planId = getCurrentPlanId()
    if (!planId) {
      ElMessage.warning('当前部门还没有可提交审批的计划')
      return
    }

    if (
      !isSecondaryCollege.value &&
      !['DRAFT', 'DISTRIBUTED', null].includes(normalizedCurrentPlanStatus.value)
    ) {
      ElMessage.warning('当前计划正在审批中，不能重复提交')
      return
    }

    // 检查是否所有指标都已填报
    if (!allIndicatorsFilled.value) {
      const unfilled = unfilledIndicatorsCount.value
      ElMessage.warning(`还有 ${unfilled} 个指标未填报，请先完成所有指标的填报后再进行一键提交`)
      return
    }

    ElMessageBox.prompt(
      `确认提交当前计划下的全部 ${indicators.value.length} 个指标吗？\n\n注意：该操作会发起本次上报审批，提交后将无法修改，需等待上级部门审批。\n\n请输入提交备注：`,
      '一键提交确认',
      {
        confirmButtonText: '确定提交',
        cancelButtonText: '取消',
        inputPlaceholder: '请输入提交备注',
        inputType: 'textarea',
        inputValidator: value => {
          if (!value || !value.trim()) {
            return '请输入提交备注'
          }
          return true
        }
      }
    )
      .then(async ({ value: submitComment }) => {
        const loading = ElLoading.service({
          lock: true,
          text: '正在提交并同步审批状态，请稍候...',
          background: 'rgba(255, 255, 255, 0.7)'
        })

        try {
          if (usePlanReportFlow.value) {
            applyLocalPlanReportSummary(currentPlanReportSummary.value, 'submitted')
          }

          let updatedReportSummary:
            | (typeof currentPlanReportSummary.value extends infer T ? T : never)
            | null = null
          if (usePlanReportFlow.value) {
            const reportOrgId = Number(currentViewingOrgId.value ?? NaN)
            if (!Number.isFinite(reportOrgId) || reportOrgId <= 0) {
              ElMessage.warning('无法识别当前组织，不能提交上报')
              return
            }
            updatedReportSummary = await indicatorFillApi.submitCurrentMonthPlanReport(
              planId,
              reportOrgId
            )
          } else {
            await planStore.submitPlanForApproval(planId, {
              workflowCode: resolvePlanApprovalWorkflowCode()
            })
          }

          if (updatedReportSummary) {
            applyLocalPlanReportSummary(updatedReportSummary, 'submitted')
          }

          if (!usePlanReportFlow.value) {
            applyLocalCurrentPlanDetailsPatch({
              status: 'PENDING',
              workflowStatus: 'IN_REVIEW',
              canWithdraw: true
            })
          }

          // 修复：无论采用的是哪种 Flow，提交操作的最终目标态都是 submitted
          await settleCurrentPlanReportState('submitted')

          // 仅战略部流程需要清除工作流详情（等待后端异步同步）
          // PlanReport 路径（职能部门/二级学院）refresh 后已有最新数据，不需要清除
          if (!usePlanReportFlow.value) {
            currentPlanWorkflowDetail.value = null
          }
          ElMessage.success('已提交上报审批')
        } catch (error) {
          logger.error('[IndicatorListView] Failed to submit plan approval:', error)
          ElMessage.error(error instanceof Error ? error.message : '提交失败，请稍微重试')
        } finally {
          loading.close()
        }
      })
      .catch(() => {
        // 处理取消操作，不做任何响应
      })
  }

  // ============================================================================
  // 进度审批撤回操作 (Progress Approval Withdrawal)
  // 操作字段: progressApprovalStatus (PENDING -> DRAFT)
  // 用途: 撤回已提交的进度审批，允许重新编辑填报内容
  // @requirement 2.1, 2.2, 3.3, 3.4 - 分离审批操作和生命周期操作
  // ============================================================================

  /**
   * 一键撤回所有已提交的指标进度审批
   * 仅操作 progressApprovalStatus 字段，不影响指标生命周期状态
   * @requirement 2.6 - 使用安全的状态检查，处理无效枚举值
   */
  const handleWithdrawAllProgressApprovals = () => {
    // 二次校验：确保有可撤回的指标
    if (!canWithdrawAny.value) {
      ElMessage.warning(withdrawTooltip.value)
      return
    }

    const planId = getCurrentPlanId()
    if (!planId) {
      ElMessage.warning('当前计划不存在，无法撤回')
      return
    }

    ElMessageBox.confirm(
      '确认撤回当前上报审批吗？\n\n撤回后本次上报会回到草稿状态，可继续编辑后再提交。',
      '一键撤回上报审批',
      {
        confirmButtonText: '确定撤回',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
      .then(async () => {
        const loading = ElLoading.service({
          lock: true,
          text: '正在撤回并重置审批状态，请稍候...',
          background: 'rgba(255, 255, 255, 0.7)'
        })

        try {
          if (usePlanReportFlow.value) {
            applyLocalPlanReportSummary(currentPlanReportSummary.value, 'withdrawn')
          }

          let updatedReportSummary:
            | (typeof currentPlanReportSummary.value extends infer T ? T : never)
            | null = null
          if (usePlanReportFlow.value) {
            const reportOrgId = Number(currentViewingOrgId.value ?? NaN)
            if (!Number.isFinite(reportOrgId) || reportOrgId <= 0) {
              ElMessage.warning('无法识别当前组织，不能撤回上报')
              return
            }
            updatedReportSummary = await indicatorFillApi.withdrawCurrentMonthPlanReport(
              planId,
              reportOrgId
            )
          } else {
            await planStore.withdrawPlan(planId)
          }

          if (updatedReportSummary) {
            applyLocalPlanReportSummary(updatedReportSummary, 'withdrawn')
          }

          if (!usePlanReportFlow.value) {
            applyLocalCurrentPlanDetailsPatch({
              status: 'DRAFT',
              workflowStatus: 'WITHDRAWN',
              canWithdraw: false,
              currentTaskId: undefined,
              currentStepName: undefined,
              currentApproverId: undefined,
              currentApproverName: undefined
            })
          }

          await settleCurrentPlanReportState('withdrawn')
          ElMessage.success('已撤回当前上报审批')
        } catch (error) {
          logger.error('[IndicatorListView] Failed to withdraw plan approval:', error)
          ElMessage.error(error instanceof Error ? error.message : '撤回失败，请稍微重试')
        } finally {
          loading.close()
        }
      })
      .catch(() => {
        // 用户取消，无操作
      })
  }

  // ============================================================================
  // 状态显示辅助函数
  // @requirement 2.9, 3.1, 3.2 - 清晰分离生命周期状态和审批状态
  // ============================================================================

  /**
   * 战略部"撤回下发"按钮展示条件
   * @requirement: Plan-centric status - 使用 Plan 状态判断
   * 仅在 Plan 处于已下发态时显示，避免草稿/待填报数据出现错误操作
   */
  const canWithdrawDistribution = (_row: StrategicIndicator): boolean => {
    // @requirement: Plan-centric - 检查 Plan 是否为已下发状态
    return isPlanDistributed.value
  }

  return {
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
    handleApproveIndicatorWorkflow,
    handleDeleteIndicator,
    handleIndicatorDblClick,
    handleInlineAttachmentRemove,
    handleOpenApproval,
    handleOpenReportDialog,
    handleRejectIndicatorWorkflow,
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
  }
}
