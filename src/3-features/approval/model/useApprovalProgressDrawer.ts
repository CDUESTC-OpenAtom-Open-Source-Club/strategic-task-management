import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  ElDrawer,
  ElDialog,
  ElTabs,
  ElTabPane,
  ElEmpty,
  ElTag,
  ElAlert,
  ElButton,
  ElMessage,
  ElMessageBox,
  ElLoading
} from 'element-plus'
import { Document, User, Timer, Right } from '@element-plus/icons-vue'
import type {
  ApiResponse,
  StrategicIndicator,
  Plan,
  WorkflowNode,
  ApprovalHistoryItem,
  WorkflowNodeAttachment
} from '@/shared/types'
import { approvalApi } from '@/features/task/api/strategicApi'
import { getIndicatorById as getIndicatorDetailById } from '@/features/indicator/api/query'
import { getUserById, getUsersByOrgId, tryGetUserById } from '@/features/user/api/query'
import { useAuthStore } from '@/features/auth/model/store'
import { APPROVAL_STATE_REFRESH_EVENT, notifyApprovalStateRefresh } from '@/features/approval/lib'
import { resolveApprovalRoute } from '@/features/approval/lib/approvalNotifications'
import { usePlanStore } from '@/features/plan/model/store'
import { useTimeContextStore } from '@/shared/lib/timeContext'
import { logger } from '@/shared/lib/utils/logger'
import {
  getWorkflowDefinitionPreviewByCode,
  getWorkflowInstanceDetail,
  getWorkflowInstanceDetailByBusiness,
  getWorkflowInstanceHistoryByBusiness
} from '@/features/workflow/api/queries'
import { canCurrentUserHandleWorkflowApproval } from '@/features/approval/lib'
import { apiClient } from '@/shared/api'
import type {
  ApproverCandidateResponse,
  WorkflowDefinitionPreviewResponse,
  WorkflowHistoryCardResponse,
  WorkflowInstanceDetailResponse,
  WorkflowTaskResponse
} from '@/features/workflow/api/types'

/**
 * 审批进度抽屉组件
 *
 * 整合审批组件：
 * 1. CustomApprovalFlow - 审批流程视图（垂直时间轴）
 * 2. ApprovalHistory - 审批历史时间线
 *
 * 用于展示指标审批进度和历史记录
 */

interface Props {
  modelValue: boolean
  indicators?: StrategicIndicator[]
  plan?: Plan | null
  initialPlanWorkflowDetail?: WorkflowInstanceDetailResponse | null
  indicatorId?: string | number
  departmentName?: string
  planName?: string
  showApprovalSection?: boolean
  showPlanApprovals?: boolean
  readonly?: boolean
  // 审批类型：'distribution' = 下发审批, 'submission' = 上报审批
  approvalType?: 'distribution' | 'submission'
  historyViewMode?: 'auto' | 'card-only'
  workflowCode?: string | string[]
  workflowEntityType?: 'PLAN' | 'PLAN_REPORT'
  workflowEntityId?: number | string
  secondaryWorkflowEntityType?: 'PLAN' | 'PLAN_REPORT'
  secondaryWorkflowEntityId?: number | string
  routeTarget?: string
  showRouteButton?: boolean
  planReportSummary?: {
    content?: string | null
    summary?: string | null
    indicatorDetails?: Array<{
      comment?: string | null
      attachments?: Array<{
        id?: number | string | null
        fileName?: string | null
        url?: string | null
      }> | null
    }> | null
  } | null
}

interface PlanReportAttachmentItem {
  id?: number | string | null
  fileName?: string | null
  fileSize?: number | null
  fileType?: string | null
  url?: string | null
}

interface PlanReportIndicatorDetailItem {
  indicatorId?: number | string | null
  progress?: number | string | null
  comment?: string | null
  attachments?: PlanReportAttachmentItem[] | null
}

interface PlanReportSnapshotSummary {
  id?: number | string
  content?: string | null
  summary?: string | null
  workflowStatus?: string | null
  status?: string | null
  workflowInstanceId?: number | string | null
  currentTaskId?: number | string | null
  currentStepName?: string | null
  indicatorDetails?: PlanReportIndicatorDetailItem[] | null
}

interface HistoricalCardSummary {
  title: string
  items: string[]
}

export interface ApprovalProgressDrawerEmit {
  (e: 'update:modelValue', value: boolean): void
  (e: 'close'): void
  (e: 'refresh'): void
}

export interface ApprovalProgressDrawerProps extends Props {}

export function useApprovalProgressDrawer(
  props: ApprovalProgressDrawerProps,
  emit: ApprovalProgressDrawerEmit
) {
  const router = useRouter()
  const authStore = useAuthStore()
  const planStore = usePlanStore()
  const timeContext = useTimeContextStore()
  const canLookupWorkflowUsers = computed(() => {
    const roles = currentUserRoleCodes.value
    return roles.includes('STRATEGY_DEPT_HEAD') || roles.includes('VICE_PRESIDENT')
  })
  const PLAN_DISPATCH_APPROVE_PERMISSION = 'BTN_STRATEGY_TASK_DISPATCH_APPROVE'
  const PLAN_REPORT_APPROVE_PERMISSION = 'BTN_STRATEGY_TASK_REPORT_APPROVE'
  const INDICATOR_DISPATCH_APPROVE_PERMISSION = 'BTN_INDICATOR_DISPATCH_APPROVE'
  const INDICATOR_REPORT_APPROVE_PERMISSION = 'BTN_INDICATOR_REPORT_APPROVE'
  const currentUserId = computed(() => Number(authStore.user?.userId ?? authStore.user?.id ?? 0))
  const currentUserOrgId = computed(() => Number(authStore.user?.orgId ?? 0))
  const routeTargetSeed = computed(() => {
    const value = typeof props.routeTarget === 'string' ? props.routeTarget.trim() : ''
    return value || ''
  })
  const explicitApprovalRouteTarget = computed(() => {
    if (!routeTargetSeed.value) {
      return ''
    }

    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
      const parsedUrl = new URL(routeTargetSeed.value, origin)
      return parsedUrl.searchParams.has('openApproval') ? routeTargetSeed.value : ''
    } catch {
      return routeTargetSeed.value.includes('openApproval=') ? routeTargetSeed.value : ''
    }
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
  const submitterNameCache = ref<Record<string, string>>({})
  const workflowUserAvatarCache = ref<Record<string, string>>({})
  const workflowOrgRoleCandidateCache = ref<Record<string, ApproverCandidateResponse[]>>({})
  const indicatorDetailCache = ref<Record<string, StrategicIndicator>>({})
  const previewableAttachmentExtensions = new Set([
    'pdf',
    'png',
    'jpg',
    'jpeg',
    'gif',
    'bmp',
    'webp',
    'svg',
    'txt',
    'md',
    'json'
  ])

  function getAttachmentExtension(name?: string, url?: string): string {
    const candidate = String(name || url || '')
      .split('?')[0]
      .split('#')[0]
    const segments = candidate.split('.')
    return segments.length > 1 ? segments.pop()?.toLowerCase() || '' : ''
  }

  function openBlobInNewTab(blob: Blob): void {
    const objectUrl = window.URL.createObjectURL(blob)
    window.open(objectUrl, '_blank', 'noopener,noreferrer')
  }

  function triggerBlobDownload(blob: Blob, filename: string): void {
    const objectUrl = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(objectUrl)
  }

  async function handleWorkflowNodeAttachmentOpen(
    attachment: WorkflowNodeAttachment
  ): Promise<void> {
    try {
      const targetUrl = String(attachment.url || '').trim()
      if (!targetUrl) {
        ElMessage.warning('当前附件暂时无法打开')
        return
      }

      const response = await apiClient.getAxiosInstance().get(targetUrl, {
        responseType: 'blob'
      })
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data])
      const extension = getAttachmentExtension(attachment.name, targetUrl)

      if (previewableAttachmentExtensions.has(extension)) {
        openBlobInNewTab(blob)
        return
      }

      triggerBlobDownload(blob, attachment.name || 'download')
    } catch (error) {
      logger.error('[ApprovalProgressDrawer] 打开审批材料失败:', error)
      ElMessage.error('打开附件失败，请稍后重试')
    }
  }

  function normalizeDisplayName(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
  }

  function isGenericPlanDisplayName(value: unknown): boolean {
    const normalized = normalizeDisplayName(value).replace(/\s+/g, ' ')
    if (!normalized) {
      return true
    }

    return (
      /^Plan\s+\d+$/i.test(normalized) ||
      /^业务对象#\d+$/.test(normalized) ||
      normalized === '计划审批' ||
      normalized === '审批通知' ||
      /^有新的.+待审批$/.test(normalized)
    )
  }

  function resolvePlanDisplayNameFromContext(
    detail?: WorkflowInstanceDetailResponse | null,
    fallback?: unknown
  ): string {
    const candidates = [detail?.planName, props.plan?.name, props.planName, fallback]

    const explicitName = candidates
      .map(candidate => normalizeDisplayName(candidate))
      .find(candidate => candidate && !isGenericPlanDisplayName(candidate))
    if (explicitName) {
      return explicitName
    }

    const departmentName =
      normalizeDisplayName(detail?.targetOrgName) ||
      normalizeDisplayName(props.plan?.targetOrgName) ||
      normalizeDisplayName(props.departmentName) ||
      normalizeDisplayName(detail?.sourceOrgName) ||
      normalizeDisplayName(props.plan?.createdByOrgName) ||
      normalizeDisplayName(props.plan?.orgName)

    if (departmentName) {
      return `${departmentName}计划`
    }

    return normalizeDisplayName(fallback) || '当前计划'
  }

  function normalizeWorkflowCode(value: unknown): string {
    return String(value || '')
      .trim()
      .toUpperCase()
  }

  function normalizeWorkflowStatus(value: unknown): string {
    const normalized = String(value || '')
      .trim()
      .toUpperCase()

    if (['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(normalized)) {
      return 'PENDING'
    }

    if (['APPROVED', 'DISTRIBUTED'].includes(normalized)) {
      return 'APPROVED'
    }

    if (['REJECTED', 'RETURNED'].includes(normalized)) {
      return 'REJECTED'
    }

    if (['WITHDRAWN', 'CANCELLED'].includes(normalized)) {
      return 'WITHDRAWN'
    }

    return normalized
  }

  const expectedWorkflowCodes = computed(() => {
    const rawCodes = Array.isArray(props.workflowCode) ? props.workflowCode : [props.workflowCode]
    return rawCodes.map(normalizeWorkflowCode).filter(Boolean)
  })

  function matchesExpectedWorkflowCode(workflowCode: unknown): boolean {
    if (expectedWorkflowCodes.value.length === 0) {
      return true
    }

    return expectedWorkflowCodes.value.includes(normalizeWorkflowCode(workflowCode))
  }

  function normalizeWorkflowEntityType(value: unknown): 'PLAN' | 'PLAN_REPORT' | '' {
    const normalized = String(value || '')
      .trim()
      .toUpperCase()
    if (normalized === 'PLAN_REPORT') {
      return 'PLAN_REPORT'
    }
    if (normalized === 'PLAN') {
      return 'PLAN'
    }
    return ''
  }

  function parsePositiveEntityId(value: unknown): number | null {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return null
    }
    return numericValue
  }

  const routeContextWorkflowDetail = computed<WorkflowInstanceDetailResponse | null>(() => {
    return selectedHistoryInstanceDetail.value || planWorkflowDetail.value || null
  })

  const routeContextDepartmentName = computed(() => {
    const detail = routeContextWorkflowDetail.value
    const entityType = normalizeWorkflowEntityType(
      detail?.businessEntityType ??
        (detail as { entityType?: unknown } | null)?.entityType ??
        props.workflowEntityType
    )
    const sourceOrgName = normalizeDisplayName(detail?.sourceOrgName)
    const targetOrgName = normalizeDisplayName(detail?.targetOrgName)

    if (entityType === 'PLAN') {
      return targetOrgName || props.departmentName || sourceOrgName || ''
    }

    if (entityType === 'PLAN_REPORT') {
      return sourceOrgName || targetOrgName || props.departmentName || ''
    }

    return targetOrgName || sourceOrgName || props.departmentName || ''
  })

  const routeContextSourceOrgName = computed(() => {
    const detail = routeContextWorkflowDetail.value
    return normalizeDisplayName(detail?.sourceOrgName)
  })

  const routeContextTargetOrgName = computed(() => {
    const detail = routeContextWorkflowDetail.value
    return normalizeDisplayName(detail?.targetOrgName)
  })

  const normalizedRouteTarget = computed(() => {
    if (explicitApprovalRouteTarget.value) {
      return explicitApprovalRouteTarget.value
    }

    const detail = routeContextWorkflowDetail.value
    const entityType =
      normalizeWorkflowEntityType(
        detail?.businessEntityType ??
          (detail as { entityType?: unknown } | null)?.entityType ??
          props.workflowEntityType
      ) || undefined
    const entityId =
      parsePositiveEntityId(
        detail?.businessEntityId ??
          (detail as { entityId?: unknown } | null)?.entityId ??
          detail?.planId ??
          props.workflowEntityId ??
          props.plan?.id
      ) ?? undefined
    const approvalInstanceId =
      parsePositiveEntityId(detail?.instanceId ?? props.initialPlanWorkflowDetail?.instanceId) ??
      undefined

    const resolvedRoute = resolveApprovalRoute({
      actionUrl: routeTargetSeed.value || null,
      entityType,
      entityId,
      approvalInstanceId,
      viewerRole: authStore.effectiveRole || authStore.userRole,
      departmentName: routeContextDepartmentName.value || null,
      sourceOrgName: routeContextSourceOrgName.value || null,
      targetOrgName: routeContextTargetOrgName.value || null,
      currentDepartmentName:
        normalizeDisplayName(authStore.effectiveDepartment || authStore.user?.department) || null
    })

    return resolvedRoute || routeTargetSeed.value
  })

  function isRetainableWorkflowDetail(
    detail: WorkflowInstanceDetailResponse | null | undefined
  ): boolean {
    if (!detail || !matchesExpectedWorkflowCode(detail.flowCode)) {
      return false
    }

    const detailEntityType = normalizeWorkflowEntityType(
      detail.businessEntityType ?? (detail as { entityType?: unknown }).entityType
    )
    const expectedEntityType = normalizeWorkflowEntityType(props.workflowEntityType)
    if (detailEntityType && expectedEntityType && detailEntityType !== expectedEntityType) {
      return false
    }

    const expectedEntityId = parsePositiveEntityId(props.workflowEntityId ?? props.plan?.id)
    const detailEntityId = parsePositiveEntityId(
      detail.businessEntityId ?? (detail as { entityId?: unknown }).entityId ?? detail.planId
    )
    if (expectedEntityId && detailEntityId && expectedEntityId !== detailEntityId) {
      return false
    }

    return Boolean(
      parsePositiveEntityId(detail.instanceId) ||
      detail.status ||
      detail.currentStepName ||
      (Array.isArray(detail.tasks) && detail.tasks.length > 0) ||
      (Array.isArray(detail.history) && detail.history.length > 0)
    )
  }

  function getRetainedWorkflowDetail(): WorkflowInstanceDetailResponse | null {
    if (isRetainableWorkflowDetail(props.initialPlanWorkflowDetail)) {
      return props.initialPlanWorkflowDetail
    }

    if (isRetainableWorkflowDetail(planWorkflowDetail.value)) {
      return planWorkflowDetail.value
    }

    return null
  }

  function parsePositiveUserId(value: unknown): number | null {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return null
    }
    return numericValue
  }

  function cacheWorkflowUserAvatar(userIdValue: unknown, avatarValue: unknown): boolean {
    const userId = parsePositiveUserId(userIdValue)
    const avatar = typeof avatarValue === 'string' ? avatarValue.trim() : ''
    if (!userId || !avatar) {
      return false
    }

    const cacheKey = String(userId)
    if (workflowUserAvatarCache.value[cacheKey] === avatar) {
      return true
    }

    workflowUserAvatarCache.value = {
      ...workflowUserAvatarCache.value,
      [cacheKey]: avatar
    }
    return true
  }

  async function ensureWorkflowUserAvatarLoaded(userIdValue: unknown): Promise<void> {
    if (!canLookupWorkflowUsers.value) {
      return
    }

    const userId = parsePositiveUserId(userIdValue)
    if (!userId) {
      return
    }

    const cacheKey = String(userId)
    if (workflowUserAvatarCache.value[cacheKey]) {
      return
    }

    try {
      const user = await tryGetUserById(userId)
      if (!user) {
        return
      }
      cacheWorkflowUserAvatar(userId, (user as { avatar?: unknown; avatarUrl?: unknown }).avatar)
      cacheWorkflowUserAvatar(userId, (user as { avatarUrl?: unknown }).avatarUrl)
    } catch (error) {
      logger.warn('[ApprovalProgressDrawer] 用户头像解析失败:', { userId, error })
    }
  }

  function getFallbackSubmitterValue(): string {
    const createdBy = normalizeDisplayName(props.plan?.createdBy)
    if (createdBy && !parsePositiveUserId(createdBy)) {
      return createdBy
    }

    const submittedByName = normalizeDisplayName(props.plan?.submittedByName)
    if (submittedByName) {
      return submittedByName
    }

    const createdByName = normalizeDisplayName(props.plan?.createdByName)
    if (createdByName) {
      return createdByName
    }

    const currentUserDisplayName = normalizeDisplayName(authStore.userName)
    const currentDepartmentName = normalizeDisplayName(authStore.effectiveDepartment)
    const sourceDepartmentName =
      normalizeDisplayName(props.plan?.createdByOrgName) ||
      normalizeDisplayName(props.plan?.orgName)
    if (
      currentUserDisplayName &&
      currentDepartmentName &&
      sourceDepartmentName &&
      currentDepartmentName === sourceDepartmentName
    ) {
      return currentUserDisplayName
    }

    return sourceDepartmentName || normalizeDisplayName(props.departmentName) || '待确认'
  }

  function cacheSubmitterName(userIdValue: unknown, nameValue: unknown): boolean {
    const userId = parsePositiveUserId(userIdValue)
    const displayName = normalizeDisplayName(nameValue)
    if (!userId || !displayName) {
      return false
    }

    const cacheKey = String(userId)
    if (submitterNameCache.value[cacheKey] === displayName) {
      return true
    }

    submitterNameCache.value = {
      ...submitterNameCache.value,
      [cacheKey]: displayName
    }

    return true
  }

  async function ensureSubmitterNameLoaded(
    userIdValue: unknown,
    fallbackName?: string
  ): Promise<void> {
    const userId = parsePositiveUserId(userIdValue)
    if (!userId) {
      return
    }

    const cacheKey = String(userId)
    if (submitterNameCache.value[cacheKey]) {
      return
    }

    if (!canLookupWorkflowUsers.value) {
      const fallbackDisplayName = normalizeDisplayName(fallbackName) || getFallbackSubmitterValue()
      cacheSubmitterName(userId, fallbackDisplayName)
      return
    }

    try {
      const user = await tryGetUserById(userId)
      if (!user) {
        const fallbackDisplayName =
          normalizeDisplayName(fallbackName) || getFallbackSubmitterValue()
        cacheSubmitterName(userId, fallbackDisplayName)
        return
      }
      const realName = normalizeDisplayName(user.realName)
      const username = normalizeDisplayName(user.username)
      submitterNameCache.value = {
        ...submitterNameCache.value,
        [cacheKey]: realName || username || cacheKey
      }
    } catch (error) {
      const fallbackDisplayName = normalizeDisplayName(fallbackName) || getFallbackSubmitterValue()
      cacheSubmitterName(userId, fallbackDisplayName)
      logger.warn('[ApprovalProgressDrawer] 提交人名称解析失败:', { userId, error })
    }
  }

  const planSubmitterName = computed(() => {
    const explicitName =
      normalizeDisplayName(props.plan?.submittedByName) ||
      normalizeDisplayName(props.plan?.createdByName)
    if (explicitName) {
      return explicitName
    }

    const submittedById = parsePositiveUserId(props.plan?.submittedBy)
    if (submittedById) {
      return submitterNameCache.value[String(submittedById)] || getFallbackSubmitterValue()
    }

    const createdById = parsePositiveUserId(props.plan?.createdBy)
    if (createdById) {
      return submitterNameCache.value[String(createdById)] || getFallbackSubmitterValue()
    }

    return getFallbackSubmitterValue()
  })

  // ============ 状态 ============
  const activeTab = ref('workflow')
  const planApprovalsLoading = ref(false)
  const pendingPlanApprovals = ref<Record<string, any>[]>([])
  const planDetailDialogVisible = ref(false)
  const planWorkflowDetail = ref<WorkflowInstanceDetailResponse | null>(
    props.initialPlanWorkflowDetail
  )
  const workflowDefinitionPreview = ref<WorkflowDefinitionPreviewResponse | null>(null)
  const planWorkflowHistoryCards = ref<WorkflowHistoryCardResponse[]>([])
  const selectedHistoryInstanceId = ref<string | null>(null)
  const selectedHistoryInstanceDetail = ref<WorkflowInstanceDetailResponse | null>(null)
  const selectedHistoryInstanceDetailLoading = ref(false)
  const selectedPlanReportSnapshot = ref<PlanReportSnapshotSummary | null>(null)
  const selectedPlanReportSnapshotLoading = ref(false)
  const planReportSnapshotCache = ref<Record<string, PlanReportSnapshotSummary>>({})
  const historyInstanceDetailCache = ref<Record<string, WorkflowInstanceDetailResponse>>({})

  function resolvePreferredActiveTab(): 'pending-plans' | 'workflow' | 'history' {
    if (props.showPlanApprovals) {
      return isPlanPendingApproval.value || scopedPendingPlanCount.value > 0
        ? 'pending-plans'
        : 'history'
    }

    return hasWorkflowTabContent.value ? 'workflow' : 'history'
  }

  interface PlanApprovalDetailItem {
    instanceId: number
    instanceNo: string
    title: string
    routeTitle?: string
    flowName?: string
    flowCode?: string
    submitterName: string
    currentStepName: string
    createdAt?: string
    completedAt?: string
    statusLabel?: string
    statusType?: 'success' | 'warning' | 'danger' | 'info'
    entityId?: string | number
    planName?: string
  }

  interface PendingPlanApprovalPreviewItem {
    key: string
    title: string
    routeDisplay: string
    routeTarget: string
  }

  interface WorkflowHistoryTarget {
    entityType: 'PLAN' | 'PLAN_REPORT'
    entityId: number
  }

  // 当前选中的指标
  const currentIndicator = computed(() => {
    if (props.indicatorId) {
      return props.indicators.find(i => i.id === props.indicatorId)
    }
    // 如果没有指定ID，返回第一个有待审批状态的指标
    return (
      props.indicators.find(
        i =>
          i.progressApprovalStatus &&
          ['pending', 'approved', 'rejected'].includes(i.progressApprovalStatus)
      ) || props.indicators[0]
    )
  })

  const availablePlanIndicators = computed<StrategicIndicator[]>(() => {
    const merged = new Map<string, StrategicIndicator>()

    props.indicators.forEach(indicator => {
      merged.set(String(indicator.id), indicator)
    })

    const rawPlanIndicators = Array.isArray(
      (props.plan as { indicators?: unknown[] } | null)?.indicators
    )
      ? ((props.plan as { indicators?: unknown[] }).indicators as Record<string, unknown>[])
      : []

    rawPlanIndicators.forEach((rawIndicator, index) => {
      if (!rawIndicator || typeof rawIndicator !== 'object') {
        return
      }

      const rawId =
        String(rawIndicator.id ?? rawIndicator.indicatorId ?? '').trim() || `plan-${index + 1}`
      const existingIndicator = merged.get(rawId)

      merged.set(rawId, {
        ...(existingIndicator || {}),
        ...(rawIndicator as unknown as StrategicIndicator),
        id: rawId,
        name:
          normalizeDisplayName(rawIndicator.name ?? rawIndicator.indicatorName) ||
          normalizeDisplayName(existingIndicator?.name) ||
          `指标${index + 1}`,
        type1:
          normalizeDisplayName(
            rawIndicator.type1 ?? rawIndicator.indicatorType1 ?? rawIndicator.indicatorType
          ) || normalizeDisplayName(existingIndicator?.type1),
        type2:
          normalizeDisplayName(rawIndicator.type2 ?? rawIndicator.indicatorType2) ||
          normalizeDisplayName(existingIndicator?.type2),
        ownerDept:
          normalizeDisplayName(rawIndicator.ownerDept ?? rawIndicator.ownerOrgName) ||
          normalizeDisplayName(existingIndicator?.ownerDept),
        responsibleDept:
          normalizeDisplayName(
            rawIndicator.responsibleDept ??
              rawIndicator.targetOrgName ??
              rawIndicator.departmentName
          ) || normalizeDisplayName(existingIndicator?.responsibleDept),
        unit:
          normalizeDisplayName(rawIndicator.unit) || normalizeDisplayName(existingIndicator?.unit)
      } as StrategicIndicator)
    })

    return Array.from(merged.values())
  })

  // 是否有审批数据
  const hasApprovalData = computed(() => {
    return (
      props.indicators.length > 0 &&
      props.indicators.some(i => i.progressApprovalStatus && i.progressApprovalStatus !== 'none')
    )
  })

  // 待审批数量
  const pendingCount = computed(() => {
    return props.indicators.filter(i => i.progressApprovalStatus === 'pending').length
  })

  // 已通过数量
  const approvedCount = computed(() => {
    return props.indicators.filter(i => i.progressApprovalStatus === 'approved').length
  })

  // 已驳回数量
  const rejectedCount = computed(() => {
    return props.indicators.filter(i => i.progressApprovalStatus === 'rejected').length
  })

  const currentPlanEntityIds = computed(() => {
    if (props.plan?.id) {
      return new Set([Number(props.plan.id)])
    }

    if (props.plan?.workflowInstanceId) {
      return new Set([Number(props.plan.workflowInstanceId)])
    }

    return new Set<number>()
  })

  const scopedDepartmentPlan = computed(() => {
    if (props.plan || !props.departmentName) {
      return null
    }

    return (
      planStore.getPlanByTargetOrgAndYear(props.departmentName, timeContext.currentYear) || null
    )
  })

  const scopedPlanEntityIds = computed(() => {
    const entityIds = new Set<number>()

    currentPlanEntityIds.value.forEach(entityId => {
      entityIds.add(entityId)
    })

    const departmentPlanId = Number(scopedDepartmentPlan.value?.id ?? NaN)
    if (Number.isFinite(departmentPlanId) && departmentPlanId > 0) {
      entityIds.add(departmentPlanId)
    }

    return entityIds
  })

  const scopedPlanApprovals = computed(() => {
    if (scopedPlanEntityIds.value.size === 0) {
      if (props.departmentName || props.planName) {
        return []
      }
      return pendingPlanApprovals.value
    }

    const withEntityId = pendingPlanApprovals.value.filter(instance => {
      const entityId = Number(instance.entityId)
      return Number.isFinite(entityId) && entityId > 0
    })

    if (withEntityId.length === 0) {
      return []
    }

    return withEntityId.filter(instance => {
      if (!scopedPlanEntityIds.value.has(Number(instance.entityId))) {
        return false
      }

      const flowCode = (instance as { flowCode?: string }).flowCode
      return matchesExpectedWorkflowCode(flowCode)
    })
  })

  function resolvePendingApprovalRouteDisplay(instance: Record<string, any>): string {
    const sourceOrgName = normalizeDisplayName(instance.sourceOrgName)
    const targetOrgName = normalizeDisplayName(instance.targetOrgName)

    if (sourceOrgName && targetOrgName) {
      return `${sourceOrgName} -> ${targetOrgName}`
    }

    return sourceOrgName || targetOrgName || '流向待补充'
  }

  function resolvePendingApprovalDepartmentName(instance: Record<string, any>): string {
    const entityType = normalizeWorkflowEntityType(instance.entityType) || 'PLAN'
    const sourceOrgName = normalizeDisplayName(instance.sourceOrgName)
    const targetOrgName = normalizeDisplayName(instance.targetOrgName)

    if (entityType === 'PLAN_REPORT') {
      return sourceOrgName || targetOrgName || props.departmentName || ''
    }

    return targetOrgName || sourceOrgName || props.departmentName || ''
  }

  function resolvePendingApprovalTitle(instance: Record<string, any>, index: number): string {
    return (
      normalizeDisplayName(instance.entityTitle) ||
      normalizeDisplayName(instance.planName) ||
      normalizeDisplayName(instance.title) ||
      normalizeDisplayName(instance.entityName) ||
      `${props.planName || props.departmentName || '当前计划'} - 审批实例 ${index + 1}`
    )
  }

  const pendingPlanApprovalPreviewItems = computed<PendingPlanApprovalPreviewItem[]>(() =>
    scopedPlanApprovals.value.map((instance, index) => {
      const entityType = normalizeWorkflowEntityType(instance.entityType) || 'PLAN'
      const entityId =
        parsePositiveEntityId(instance.entityId ?? instance.businessEntityId) ?? undefined
      const approvalInstanceId = parsePositiveEntityId(instance.instanceId) ?? undefined
      const routeTarget =
        resolveApprovalRoute({
          actionUrl: typeof instance.actionUrl === 'string' ? instance.actionUrl : null,
          entityType,
          entityId,
          approvalInstanceId,
          viewerRole: authStore.effectiveRole || authStore.userRole,
          departmentName: resolvePendingApprovalDepartmentName(instance) || null,
          sourceOrgName: normalizeDisplayName(instance.sourceOrgName) || null,
          targetOrgName: normalizeDisplayName(instance.targetOrgName) || null,
          currentDepartmentName:
            normalizeDisplayName(authStore.effectiveDepartment || authStore.user?.department) ||
            null
        }) || ''

      return {
        key: `${approvalInstanceId || instance.taskId || index}`,
        title: resolvePendingApprovalTitle(instance, index),
        routeDisplay: resolvePendingApprovalRouteDisplay(instance),
        routeTarget
      }
    })
  )

  const scopedPendingPlanCount = computed(() => scopedPlanApprovals.value.length)

  const historyTargets = computed<WorkflowHistoryTarget[]>(() => {
    const targets: WorkflowHistoryTarget[] = []
    const seen = new Set<string>()

    const appendTarget = (entityType: 'PLAN' | 'PLAN_REPORT' | undefined, entityId: unknown) => {
      const normalizedType =
        entityType === 'PLAN_REPORT' ? 'PLAN_REPORT' : entityType === 'PLAN' ? 'PLAN' : null
      const normalizedId = Number(entityId ?? NaN)
      if (!normalizedType || !Number.isFinite(normalizedId) || normalizedId <= 0) {
        return
      }

      const key = `${normalizedType}:${normalizedId}`
      if (seen.has(key)) {
        return
      }

      seen.add(key)
      targets.push({
        entityType: normalizedType,
        entityId: normalizedId
      })
    }

    appendTarget(props.workflowEntityType, props.workflowEntityId ?? props.plan?.id)
    appendTarget(props.secondaryWorkflowEntityType, props.secondaryWorkflowEntityId)
    if (
      normalizeWorkflowEntityType(props.workflowEntityType) === 'PLAN_REPORT' &&
      normalizeWorkflowEntityType(props.secondaryWorkflowEntityType) !== 'PLAN'
    ) {
      appendTarget('PLAN', planWorkflowDetail.value?.planId ?? activePlanWorkflow.value?.id)
    }

    return targets
  })
  const activePlanWorkflow = computed(() => {
    const detail = planWorkflowDetail.value
    const useDetail = detail && matchesExpectedWorkflowCode(detail.flowCode)
    if (!props.plan) {
      if (!useDetail) {
        return null
      }

      return {
        id: parsePositiveEntityId(props.secondaryWorkflowEntityId) ?? undefined,
        name: resolvePlanDisplayNameFromContext(detail),
        workflowInstanceId: Number(detail.instanceId || 0) || undefined,
        workflowStatus: detail.status,
        status: detail.status,
        currentTaskId: detail.currentTaskId,
        currentStepName: detail.currentStepName,
        currentApproverId: detail.currentApproverId,
        currentApproverName: detail.currentApproverName,
        canWithdraw: detail.canWithdraw,
        workflowHistory: Array.isArray(detail.history) ? detail.history : [],
        submittedAt: detail.startTime,
        createdAt: detail.startTime,
        createdByName:
          normalizeDisplayName(detail.starterName) ||
          normalizeDisplayName(detail.targetOrgName) ||
          normalizeDisplayName(props.departmentName),
        submittedByName:
          normalizeDisplayName(detail.starterName) ||
          normalizeDisplayName(detail.targetOrgName) ||
          normalizeDisplayName(props.departmentName),
        sourceOrgName: detail.sourceOrgName,
        targetOrgName: detail.targetOrgName
      } as Plan
    }

    return {
      ...props.plan,
      workflowInstanceId:
        Number((useDetail ? detail.instanceId : undefined) || props.plan.workflowInstanceId || 0) ||
        undefined,
      workflowStatus:
        (useDetail ? detail.status : undefined) || props.plan.workflowStatus || props.plan.status,
      currentTaskId: (useDetail ? detail.currentTaskId : undefined) || props.plan.currentTaskId,
      currentStepName:
        (useDetail ? detail.currentStepName : undefined) || props.plan.currentStepName,
      currentApproverId:
        (useDetail ? detail.currentApproverId : undefined) ?? props.plan.currentApproverId,
      currentApproverName:
        (useDetail ? detail.currentApproverName : undefined) || props.plan.currentApproverName,
      canWithdraw:
        useDetail && typeof detail?.canWithdraw === 'boolean'
          ? detail.canWithdraw
          : props.plan.canWithdraw,
      workflowHistory:
        useDetail && Array.isArray(detail?.history) ? detail.history : props.plan.workflowHistory,
      sourceOrgName: useDetail ? detail.sourceOrgName : undefined,
      targetOrgName: useDetail ? detail.targetOrgName : props.plan.targetOrgName,
      submittedByName:
        (useDetail ? normalizeDisplayName(detail.starterName) : '') || props.plan.submittedByName,
      createdByName:
        (useDetail ? normalizeDisplayName(detail.starterName) : '') || props.plan.createdByName
    }
  })

  const currentDetailWorkflow = computed(
    () => selectedHistoryInstanceDetail.value || planWorkflowDetail.value
  )

  const hasPlanWorkflowData = computed(() => {
    if (
      planWorkflowDetail.value &&
      (parsePositiveEntityId(planWorkflowDetail.value.instanceId) ||
        normalizeWorkflowStatus(planWorkflowDetail.value.status) ||
        normalizeDisplayName(planWorkflowDetail.value.currentStepName) ||
        (Array.isArray(planWorkflowDetail.value.tasks) &&
          planWorkflowDetail.value.tasks.length > 0) ||
        (Array.isArray(planWorkflowDetail.value.history) &&
          planWorkflowDetail.value.history.length > 0))
    ) {
      return true
    }

    return Boolean(
      activePlanWorkflow.value &&
      (activePlanWorkflow.value.workflowInstanceId ||
        activePlanWorkflow.value.workflowStatus ||
        activePlanWorkflow.value.currentStepName ||
        (Array.isArray(activePlanWorkflow.value.workflowHistory) &&
          activePlanWorkflow.value.workflowHistory.length > 0))
    )
  })

  function resolvePlanSubmitterDisplayName(detail?: WorkflowInstanceDetailResponse | null): string {
    const PLACEHOLDER_PATTERNS = /^(待确认|未知|当前提交人|\d+|用户#\d+|user#\d+)$/i
    const starterId = parsePositiveUserId(detail?.starterId)
    const currentDepartmentName = normalizeDisplayName(authStore.effectiveDepartment)
    const sourceDepartmentName =
      normalizeDisplayName(detail?.sourceOrgName) ||
      normalizeDisplayName(props.plan?.createdByOrgName) ||
      normalizeDisplayName(props.plan?.orgName)
    const currentUserSubmitterFallback =
      currentDepartmentName &&
      sourceDepartmentName &&
      currentDepartmentName === sourceDepartmentName
        ? normalizeDisplayName(authStore.userName)
        : ''
    const candidates = [
      starterId ? submitterNameCache.value[String(starterId)] : '',
      detail?.starterName,
      activePlanWorkflow.value?.submittedByName,
      props.plan?.submittedByName,
      props.plan?.createdByName,
      currentUserSubmitterFallback,
      sourceDepartmentName
    ]
    const matched = candidates
      .map(candidate => normalizeDisplayName(candidate))
      .find(candidate => candidate && !PLACEHOLDER_PATTERNS.test(candidate))
    return matched || getFallbackSubmitterValue()
  }

  const normalizedPlanBusinessStatus = computed(() => {
    const rawStatus = String(props.plan?.status || '')
      .trim()
      .toUpperCase()

    if (rawStatus === 'PUBLISHED') {
      return 'APPROVED'
    }

    return rawStatus
  })

  const planWorkflowStatus = computed(() => {
    return String(
      activePlanWorkflow.value?.workflowStatus || activePlanWorkflow.value?.status || ''
    ).toUpperCase()
  })

  const isPlanPendingApproval = computed(() => {
    return ['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(planWorkflowStatus.value)
  })

  const isPlanCompletedApproval = computed(() => {
    return ['DISTRIBUTED', 'APPROVED'].includes(planWorkflowStatus.value)
  })

  const currentPlanOperationLabel = computed(() => {
    if (!hasPlanWorkflowData.value) {
      return null
    }

    if (props.workflowEntityType === 'PLAN_REPORT') {
      if (['DRAFT', 'WITHDRAWN', 'CANCELLED'].includes(planWorkflowStatus.value)) {
        return '已撤回，可重新发起审批'
      }

      if (['RETURNED', 'REJECTED'].includes(planWorkflowStatus.value)) {
        return '已退回，可修改后重新发起审批'
      }

      if (isPlanCompletedApproval.value) {
        return '审批已完成'
      }

      if (isPlanPendingApproval.value) {
        return activePlanWorkflow.value?.canWithdraw ? '提交方仍可撤回' : '审批流已锁定'
      }

      return null
    }

    if (isPlanPendingApproval.value) {
      return activePlanWorkflow.value?.canWithdraw ? '提交方仍可撤回' : '审批流已锁定'
    }

    if (isPlanCompletedApproval.value) {
      return '审批已完成'
    }

    if (normalizedPlanBusinessStatus.value === 'DRAFT') {
      if (planWorkflowStatusTag.value.label === '已撤回') {
        return '已撤回，可重新发起审批'
      }
      if (planWorkflowStatusTag.value.label === '已驳回') {
        return '已退回，可修改后重新发起审批'
      }
      return '草稿状态，可发起审批'
    }

    if (['DRAFT', 'WITHDRAWN', 'CANCELLED'].includes(planWorkflowStatus.value)) {
      return '已撤回，可重新发起审批'
    }

    if (['RETURNED', 'REJECTED'].includes(planWorkflowStatus.value)) {
      return '已退回，可修改后重新发起审批'
    }

    return null
  })

  const requiredPlanApprovalPermissionCodes = computed(() => {
    return props.approvalType === 'distribution'
      ? [PLAN_DISPATCH_APPROVE_PERMISSION, INDICATOR_DISPATCH_APPROVE_PERMISSION]
      : [PLAN_REPORT_APPROVE_PERMISSION, INDICATOR_REPORT_APPROVE_PERMISSION]
  })

  const requiredPlanApprovalPermissionCode = computed(() => {
    return requiredPlanApprovalPermissionCodes.value[0]
  })

  const hasPlanApprovalPermission = computed(() => {
    return canCurrentUserHandleWorkflowApproval({
      currentUserId: currentUserId.value,
      currentUserOrgId: currentUserOrgId.value,
      currentUserRoleCodes: currentUserRoleCodes.value,
      hasApprovalPermission: true,
      isPendingApproval: isPlanPendingApproval.value,
      expectedApproverRoleCodes: resolveExpectedApproverRoleCodes(),
      expectedApproverOrgId: resolveExpectedApproverOrgId()
    })
  })

  function resolveExpectedApproverRoleCodes(): string[] {
    const stepName = String(activePlanWorkflow.value?.currentStepName || '').trim()
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

  function resolveExpectedApproverOrgId(): number | null {
    const stepName = String(activePlanWorkflow.value?.currentStepName || '').trim()
    const currentTaskId = String(currentPlanTaskId.value || '').trim()
    if (currentTaskId && Array.isArray(planWorkflowDetail.value?.tasks)) {
      const currentTask = planWorkflowDetail.value.tasks.find(
        task => String(task.taskId || '').trim() === currentTaskId
      )

      if (stepName.includes('职能部门终审')) {
        const sourceOrgId = Number(
          planWorkflowDetail.value?.sourceOrgId ?? activePlanWorkflow.value?.sourceOrgId ?? 0
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

  const currentPendingPlanTask = computed<WorkflowTaskResponse | null>(() => {
    const currentTaskId = String(currentPlanTaskId.value || '').trim()
    if (!currentTaskId) {
      return null
    }

    return (
      planWorkflowTasks.value.find(task => {
        const taskId = String(task.taskId || '').trim()
        const status = String(task.status || '')
          .trim()
          .toUpperCase()
        return taskId === currentTaskId && status === 'PENDING'
      }) || null
    )
  })

  const canCurrentUserHandlePlanApproval = computed(() => {
    if (
      !hasPlanWorkflowData.value ||
      !isPlanPendingApproval.value ||
      !hasPlanApprovalPermission.value
    ) {
      return false
    }

    if (!currentPendingPlanTask.value) {
      return false
    }

    return canCurrentUserHandleWorkflowApproval({
      currentUserId: currentUserId.value,
      currentUserOrgId: currentUserOrgId.value,
      currentUserRoleCodes: currentUserRoleCodes.value,
      hasApprovalPermission: hasPlanApprovalPermission.value,
      isPendingApproval: isPlanPendingApproval.value,
      explicitApproverId:
        currentPendingPlanTask.value.assigneeId ?? activePlanWorkflow.value?.currentApproverId,
      expectedApproverRoleCodes: resolveExpectedApproverRoleCodes(),
      expectedApproverOrgId: resolveExpectedApproverOrgId()
    })
  })

  const currentPlanTaskId = computed(() => {
    if (isPlanWorkflowTerminated.value) {
      return 0
    }

    const pendingTask = planWorkflowTasks.value.find(task => {
      return (
        String(task.status || '')
          .trim()
          .toUpperCase() === 'PENDING'
      )
    })
    const pendingTaskId = Number(pendingTask?.taskId ?? 0)
    if (Number.isFinite(pendingTaskId) && pendingTaskId > 0) {
      return pendingTaskId
    }

    const rawTaskId = Number(activePlanWorkflow.value?.currentTaskId ?? 0)
    if (Number.isFinite(rawTaskId) && rawTaskId > 0) {
      return rawTaskId
    }

    return 0
  })

  const currentPlanInstanceStatus = computed(() => {
    return String(
      activePlanWorkflow.value?.workflowStatus || activePlanWorkflow.value?.status || ''
    )
      .trim()
      .toUpperCase()
  })

  const latestPlanTask = computed(() => {
    if (planWorkflowTasks.value.length === 0) {
      return null
    }

    const sorted = [...planWorkflowTasks.value].sort((left, right) => {
      const leftId = Number(left.taskId ?? 0)
      const rightId = Number(right.taskId ?? 0)
      if (leftId !== rightId) {
        return leftId - rightId
      }
      const leftTime = new Date(left.createdTime || 0).getTime()
      const rightTime = new Date(right.createdTime || 0).getTime()
      return leftTime - rightTime
    })

    return sorted[sorted.length - 1] || null
  })

  const isPlanWorkflowTerminated = computed(() => {
    return ['WITHDRAWN', 'REJECTED', 'RETURNED', 'CANCELLED'].includes(
      currentPlanInstanceStatus.value
    )
  })

  const currentPlanInstanceId = computed(() => {
    const rawInstanceId = Number(activePlanWorkflow.value?.workflowInstanceId ?? 0)
    if (Number.isFinite(rawInstanceId) && rawInstanceId > 0) {
      return rawInstanceId
    }

    return 0
  })

  const planWorkflowStatusTag = computed(() => {
    const rawStatus = currentPlanInstanceStatus.value
    if (rawStatus === 'DISTRIBUTED' || rawStatus === 'APPROVED') {
      return { label: '已通过', type: 'success' as const }
    }
    if (rawStatus === 'RETURNED' || rawStatus === 'REJECTED') {
      return { label: '已驳回', type: 'danger' as const }
    }
    if (rawStatus === 'WITHDRAWN' || rawStatus === 'CANCELLED') {
      return { label: '已撤回', type: 'info' as const }
    }
    if (rawStatus === 'PENDING' || rawStatus === 'IN_REVIEW' || rawStatus === 'SUBMITTED') {
      return { label: '审批中', type: 'warning' as const }
    }

    const allTaskStatuses = new Set(
      planWorkflowTasks.value.map(task =>
        String(task.status || '')
          .trim()
          .toUpperCase()
      )
    )

    if (normalizedPlanBusinessStatus.value === 'DRAFT') {
      if (allTaskStatuses.has('WITHDRAWN')) {
        return { label: '已撤回', type: 'info' as const }
      }
      if (allTaskStatuses.has('REJECTED')) {
        return { label: '已驳回', type: 'danger' as const }
      }
      return { label: '草稿', type: 'info' as const }
    }

    const latestTaskStatus = String(latestPlanTask.value?.status || '')
      .trim()
      .toUpperCase()

    if (latestTaskStatus === 'WITHDRAWN') {
      return { label: '已撤回', type: 'info' as const }
    }
    if (latestTaskStatus === 'REJECTED') {
      return { label: '已驳回', type: 'danger' as const }
    }
    return { label: rawStatus || '未发起', type: 'info' as const }
  })

  const planWorkflowHistory = computed<ApprovalHistoryItem[]>(() => {
    if (!Array.isArray(activePlanWorkflow.value?.workflowHistory)) {
      return []
    }

    return activePlanWorkflow.value.workflowHistory
      .filter(shouldDisplayWorkflowHistoryItem)
      .map((item, index) => ({
        id: String(item.taskId ?? index),
        action: normalizeWorkflowAction(item.action),
        operator: String(item.operatorId ?? index),
        operatorName: String(item.operatorName || '系统'),
        operatorAvatar: item.operatorId
          ? workflowUserAvatarCache.value[String(item.operatorId)] || undefined
          : undefined,
        operateTime: new Date(item.operateTime || Date.now()),
        stepName: typeof item.stepName === 'string' ? item.stepName : undefined,
        comment: item.comment
      }))
  })

  const planWorkflowTasks = computed<WorkflowTaskResponse[]>(() => {
    if (!Array.isArray(planWorkflowDetail.value?.tasks)) {
      return []
    }

    return [...planWorkflowDetail.value.tasks].sort((left, right) => {
      const leftStepNo = Number(left.stepNo ?? Number.MAX_SAFE_INTEGER)
      const rightStepNo = Number(right.stepNo ?? Number.MAX_SAFE_INTEGER)
      if (leftStepNo !== rightStepNo) {
        return leftStepNo - rightStepNo
      }
      return String(left.taskId || '').localeCompare(String(right.taskId || ''))
    })
  })

  watch(
    planWorkflowTasks,
    () => {
      void ensureWorkflowTaskScopedCandidatesLoaded()
    },
    { immediate: true }
  )

  function normalizeStepMatchKey(value: unknown): string {
    return String(value || '')
      .trim()
      .replace(/\s+/g, '')
      .replace(/[（(].*?[）)]/g, '')
      .toUpperCase()
  }

  function resolveCandidateDisplayName(candidate: ApproverCandidateResponse): string {
    return (
      normalizeDisplayName(candidate.realName) ||
      normalizeDisplayName(candidate.username) ||
      `用户${candidate.userId}`
    )
  }

  function resolveExpectedApproverRoleCodesByStepName(stepNameValue: unknown): string[] {
    const stepName = String(stepNameValue || '').trim()
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

  function buildWorkflowOrgRoleCandidateCacheKey(orgId: unknown, roleCodes: string[]): string {
    const normalizedOrgId = Number(orgId ?? NaN)
    const normalizedRoles = [...new Set(roleCodes.map(code => code.trim()).filter(Boolean))].sort()
    return `${Number.isFinite(normalizedOrgId) && normalizedOrgId > 0 ? normalizedOrgId : 0}::${normalizedRoles.join(',')}`
  }

  async function ensureWorkflowTaskScopedCandidatesLoaded(): Promise<void> {
    const tasks = planWorkflowTasks.value
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return
    }

    const targets = new Map<string, { orgId: number; roleCodes: string[] }>()

    tasks.forEach(task => {
      const orgId = Number(task.approverOrgId ?? NaN)
      const roleCodes = resolveExpectedApproverRoleCodesByStepName(
        task.currentStepName || task.taskName
      )

      if (!Number.isFinite(orgId) || orgId <= 0 || roleCodes.length === 0) {
        return
      }

      const cacheKey = buildWorkflowOrgRoleCandidateCacheKey(orgId, roleCodes)
      if (workflowOrgRoleCandidateCache.value[cacheKey]) {
        return
      }

      targets.set(cacheKey, { orgId, roleCodes })
    })

    if (targets.size === 0) {
      return
    }

    await Promise.all(
      [...targets.entries()].map(async ([cacheKey, target]) => {
        try {
          const users = await getUsersByOrgId(target.orgId)
          const candidates = users
            .filter(user => user.isActive !== false)
            .filter(user => {
              const roles = Array.isArray(user.roles) ? user.roles.filter(Boolean) : []
              return target.roleCodes.some(roleCode => roles.includes(roleCode))
            })
            .map(user => ({
              userId: Number(user.userId ?? user.id ?? 0),
              username: user.username,
              realName: user.realName || user.name,
              orgId: Number(user.orgId ?? target.orgId),
              orgName: user.orgName || user.department
            }))
            .filter(candidate => Number.isFinite(candidate.userId) && candidate.userId > 0)

          if (candidates.length === 0) {
            return
          }

          workflowOrgRoleCandidateCache.value = {
            ...workflowOrgRoleCandidateCache.value,
            [cacheKey]: candidates
          }
        } catch (error) {
          logger.warn('[ApprovalProgressDrawer] 加载节点组织候选审批人失败:', {
            orgId: target.orgId,
            roleCodes: target.roleCodes,
            error
          })
        }
      })
    )
  }

  function buildWorkflowNodeCandidates(
    candidates: ApproverCandidateResponse[] | undefined,
    operatorName?: string,
    markApproved: boolean = false,
    markRejected: boolean = false
  ): WorkflowNode['approverCandidates'] {
    const resolvedOperatorName = normalizeDisplayName(operatorName)
    const candidateList = Array.isArray(candidates)
      ? candidates
          .map(candidate => {
            const displayName = resolveCandidateDisplayName(candidate)
            return {
              userId: candidate.userId,
              username: candidate.username,
              realName: candidate.realName,
              displayName,
              avatar: candidate.userId
                ? workflowUserAvatarCache.value[String(candidate.userId)] || undefined
                : undefined,
              approved:
                markApproved && resolvedOperatorName ? displayName === resolvedOperatorName : false,
              rejected:
                markRejected && resolvedOperatorName ? displayName === resolvedOperatorName : false
            }
          })
          .filter(candidate => candidate.displayName)
      : []

    if (
      markApproved &&
      resolvedOperatorName &&
      candidateList.length > 0 &&
      !candidateList.some(candidate => candidate.displayName === resolvedOperatorName)
    ) {
      candidateList.unshift({
        displayName: resolvedOperatorName,
        approved: true
      })
    }

    if (
      markRejected &&
      resolvedOperatorName &&
      candidateList.length > 0 &&
      !candidateList.some(candidate => candidate.displayName === resolvedOperatorName)
    ) {
      candidateList.unshift({
        displayName: resolvedOperatorName,
        rejected: true
      })
    }

    return candidateList.length > 0 ? candidateList : undefined
  }

  function resolveTaskCandidateApprovers(
    task: WorkflowTaskResponse
  ): WorkflowNode['approverCandidates'] {
    const preview = workflowDefinitionPreview.value
    const taskStepNo = Number(task.stepNo ?? NaN)
    const rawStepName =
      normalizeDisplayName(task.currentStepName) || normalizeDisplayName(task.taskName)
    const rawStepKey = normalizeStepMatchKey(rawStepName)

    const matchedStep =
      !preview || !Array.isArray(preview.steps) || preview.steps.length === 0
        ? null
        : preview.steps.find(step => Number(step.stepOrder ?? NaN) === taskStepNo) ||
          preview.steps.find(step => normalizeStepMatchKey(step.stepName) === rawStepKey) ||
          null

    const derivedApproverOrgDisplayName = (() => {
      const stepName =
        normalizeDisplayName(task.currentStepName) || normalizeDisplayName(task.taskName) || ''

      if (stepName.includes('职能部门审批')) {
        return `${resolveTargetDepartmentDisplayName()}审批人`
      }

      if (stepName.includes('职能部门终审')) {
        return `${resolveTargetDepartmentDisplayName()}终审人`
      }

      const approverOrgName = normalizeDisplayName(task.approverOrgName)
      if (!approverOrgName) {
        return ''
      }
      if (stepName.includes('分管校领导') || stepName.includes('院长')) {
        return `${approverOrgName}分管校领导`
      }
      return `${approverOrgName}审批人`
    })()
    const taskEntityType = normalizeWorkflowEntityType(task.entityType)
    const prefersDepartmentSeatDisplay =
      rawStepName.includes('职能部门审批') || rawStepName.includes('职能部门终审')
    const runtimeAssigneeId =
      parsePositiveUserId(task.assigneeId) ||
      (taskEntityType === 'PLAN'
        ? parsePositiveUserId(activePlanWorkflow.value?.currentApproverId)
        : null)
    const runtimeAssigneeName =
      (prefersDepartmentSeatDisplay ? derivedApproverOrgDisplayName : '') ||
      normalizeDisplayName(task.assigneeName) ||
      derivedApproverOrgDisplayName ||
      (taskEntityType === 'PLAN'
        ? normalizeDisplayName(activePlanWorkflow.value?.currentApproverName)
        : '')

    const resolvedOperatorName = resolveWorkflowTaskOperatorName(task)
    const shouldMarkApprovedCandidate = isWorkflowTaskApproved(task)
    const shouldMarkRejectedCandidate = isWorkflowTaskRejected(task)
    const normalizedStatus = String(task.status || '')
      .trim()
      .toUpperCase()

    const runtimeScopedRoleCodes = resolveExpectedApproverRoleCodesByStepName(
      task.currentStepName || task.taskName
    )
    const runtimeScopedOrgId = Number(task.approverOrgId ?? NaN)
    const runtimeScopedCandidates =
      Number.isFinite(runtimeScopedOrgId) &&
      runtimeScopedOrgId > 0 &&
      runtimeScopedRoleCodes.length > 0
        ? workflowOrgRoleCandidateCache.value[
            buildWorkflowOrgRoleCandidateCacheKey(runtimeScopedOrgId, runtimeScopedRoleCodes)
          ]
        : undefined

    if (runtimeScopedCandidates?.length) {
      return buildWorkflowNodeCandidates(
        runtimeScopedCandidates,
        resolvedOperatorName || runtimeAssigneeName,
        shouldMarkApprovedCandidate,
        shouldMarkRejectedCandidate
      )
    }

    const previewCandidates = matchedStep?.candidateApprovers
    const hasRuntimeApprover = Boolean(runtimeAssigneeName || runtimeAssigneeId)
    const previewContainsRuntimeApprover =
      hasRuntimeApprover &&
      Array.isArray(previewCandidates) &&
      previewCandidates.some(candidate => {
        const candidateUserId = parsePositiveUserId(candidate.userId)
        if (runtimeAssigneeId && candidateUserId && candidateUserId === runtimeAssigneeId) {
          return true
        }

        const candidateDisplayName = resolveCandidateDisplayName(candidate)
        if (runtimeAssigneeName && candidateDisplayName === runtimeAssigneeName) {
          return true
        }

        const candidateOrgId = Number(candidate.orgId ?? NaN)
        const taskApproverOrgId = Number(task.approverOrgId ?? NaN)
        return (
          Number.isFinite(candidateOrgId) &&
          candidateOrgId > 0 &&
          Number.isFinite(taskApproverOrgId) &&
          taskApproverOrgId > 0 &&
          candidateOrgId === taskApproverOrgId
        )
      })

    const shouldPreferRuntimeApprover =
      ['PENDING', 'CURRENT'].includes(normalizedStatus) &&
      hasRuntimeApprover &&
      (!Array.isArray(previewCandidates) ||
        previewCandidates.length === 0 ||
        !previewContainsRuntimeApprover)

    if (shouldPreferRuntimeApprover) {
      return buildWorkflowNodeCandidates(
        [
          {
            userId: runtimeAssigneeId || 0,
            username: runtimeAssigneeName,
            realName: runtimeAssigneeName,
            orgId: task.approverOrgId,
            orgName: task.approverOrgName
          }
        ],
        resolvedOperatorName,
        shouldMarkApprovedCandidate,
        shouldMarkRejectedCandidate
      )
    }

    if (previewCandidates?.length) {
      return buildWorkflowNodeCandidates(
        previewCandidates,
        resolvedOperatorName || runtimeAssigneeName,
        shouldMarkApprovedCandidate,
        shouldMarkRejectedCandidate
      )
    }

    if (runtimeAssigneeName || runtimeAssigneeId) {
      return buildWorkflowNodeCandidates(
        [
          {
            userId: runtimeAssigneeId || 0,
            username: runtimeAssigneeName,
            realName: runtimeAssigneeName,
            orgId: task.approverOrgId,
            orgName: task.approverOrgName
          }
        ],
        resolvedOperatorName,
        shouldMarkApprovedCandidate,
        shouldMarkRejectedCandidate
      )
    }

    return undefined
  }

  function mapWorkflowTaskStatusToNodeStatus(task: WorkflowTaskResponse): WorkflowNode['status'] {
    const normalizedStatus = String(task.status || '')
      .trim()
      .toUpperCase()
    if (normalizedStatus === 'COMPLETED') {
      return 'completed'
    }
    if (normalizedStatus === 'REJECTED') {
      return 'rejected'
    }
    if (normalizedStatus === 'WITHDRAWN') {
      return 'withdrawn'
    }
    if (normalizedStatus === 'WAITING') {
      return 'waiting'
    }
    if (normalizedStatus === 'PENDING' && isPlanWorkflowTerminated.value) {
      return 'waiting'
    }
    if (
      normalizedStatus === 'PENDING' &&
      currentPlanInstanceStatus.value === 'WITHDRAWN' &&
      String(task.taskId || '') !== String(currentPlanTaskId.value || '')
    ) {
      return 'waiting'
    }
    if (String(task.taskId || '') === String(currentPlanTaskId.value || '')) {
      return 'current'
    }
    return 'pending'
  }

  function resolveWorkflowTaskOperatorName(task: WorkflowTaskResponse): string | undefined {
    const normalizedStatus = String(task.status || '')
      .trim()
      .toUpperCase()

    if (!['COMPLETED', 'APPROVED', 'REJECTED', 'WITHDRAWN'].includes(normalizedStatus)) {
      return undefined
    }

    return normalizeDisplayName(task.assigneeName) || normalizeDisplayName(task.approverOrgName)
  }

  function isWorkflowTaskApproved(task: WorkflowTaskResponse): boolean {
    const normalizedStatus = String(task.status || '')
      .trim()
      .toUpperCase()
    return normalizedStatus === 'COMPLETED' || normalizedStatus === 'APPROVED'
  }

  function isWorkflowTaskRejected(task: WorkflowTaskResponse): boolean {
    const normalizedStatus = String(task.status || '')
      .trim()
      .toUpperCase()
    return normalizedStatus === 'REJECTED' || normalizedStatus === 'RETURNED'
  }

  function resolveSourceDepartmentDisplayName(): string {
    const detailSourceOrgName = normalizeDisplayName(planWorkflowDetail.value?.sourceOrgName)
    if (detailSourceOrgName) {
      return detailSourceOrgName
    }

    const activeSourceOrgName = normalizeDisplayName(
      (activePlanWorkflow.value as { sourceOrgName?: unknown } | null)?.sourceOrgName
    )
    if (activeSourceOrgName) {
      return activeSourceOrgName
    }

    const planSourceOrgName = normalizeDisplayName(
      (props.plan as { sourceOrgName?: unknown } | null)?.sourceOrgName
    )
    if (planSourceOrgName) {
      return planSourceOrgName
    }

    const ownerDeptName = props.indicators
      .map(indicator => normalizeDisplayName((indicator as { ownerDept?: unknown }).ownerDept))
      .find(Boolean)
    if (ownerDeptName) {
      return ownerDeptName
    }

    return '来源部门'
  }

  function resolveTargetDepartmentDisplayName(): string {
    const detailTargetOrgName = normalizeDisplayName(planWorkflowDetail.value?.targetOrgName)
    if (detailTargetOrgName) {
      return detailTargetOrgName
    }

    const activeTargetOrgName = normalizeDisplayName(
      (activePlanWorkflow.value as { targetOrgName?: unknown } | null)?.targetOrgName
    )
    if (activeTargetOrgName) {
      return activeTargetOrgName
    }

    const planTargetOrgName = normalizeDisplayName(
      (props.plan as { targetOrgName?: unknown } | null)?.targetOrgName
    )
    if (planTargetOrgName) {
      return planTargetOrgName
    }

    if (props.departmentName) {
      return props.departmentName
    }

    const responsibleDeptName = props.indicators
      .map(indicator =>
        normalizeDisplayName((indicator as { responsibleDeptName?: unknown }).responsibleDeptName)
      )
      .find(Boolean)
    if (responsibleDeptName) {
      return responsibleDeptName
    }

    return '目标部门'
  }

  function resolveWorkflowTaskDisplayName(task: WorkflowTaskResponse): string {
    const rawStepName =
      normalizeDisplayName(task.currentStepName) ||
      normalizeDisplayName(task.taskName) ||
      '审批节点'

    if (rawStepName.includes('职能部门审批')) {
      return `${resolveTargetDepartmentDisplayName()}审批人审批`
    }

    if (rawStepName.includes('职能部门终审')) {
      return `${resolveTargetDepartmentDisplayName()}终审人审批`
    }

    return rawStepName
  }

  function resolveWorkflowTaskDisplayOperatorName(task: WorkflowTaskResponse): string | undefined {
    const resolvedOperatorName = resolveWorkflowTaskOperatorName(task)
    if (resolvedOperatorName) {
      return resolvedOperatorName
    }

    const rawStepName =
      normalizeDisplayName(task.currentStepName) || normalizeDisplayName(task.taskName) || ''

    if (rawStepName.includes('职能部门审批') || rawStepName.includes('职能部门终审')) {
      return resolveTargetDepartmentDisplayName()
    }

    if (rawStepName.includes('职能部门终审')) {
      return resolveSourceDepartmentDisplayName()
    }

    return undefined
  }

  function resolveTaskStatusLabel(task: WorkflowTaskResponse): string {
    const normalizedStatus = String(task.status || '')
      .trim()
      .toUpperCase()
    if (normalizedStatus === 'WAITING') {
      return '等待中'
    }
    if (normalizedStatus === 'WITHDRAWN') {
      return '已撤回'
    }
    if (normalizedStatus === 'REJECTED') {
      return '已驳回'
    }
    if (normalizedStatus === 'PENDING' && isPlanWorkflowTerminated.value) {
      return '等待中'
    }
    if (
      normalizedStatus === 'PENDING' &&
      currentPlanInstanceStatus.value === 'WITHDRAWN' &&
      String(task.taskId || '') !== String(currentPlanTaskId.value || '')
    ) {
      return '等待中'
    }
    if (normalizedStatus === 'COMPLETED') {
      return '已通过'
    }
    return '审批中'
  }

  const latestPlanTaskDisplayLabel = computed(() => {
    return latestPlanTask.value ? resolveTaskStatusLabel(latestPlanTask.value) : ''
  })

  const displayedPlanReportSnapshot = computed<PlanReportSnapshotSummary | null>(() => {
    if (selectedHistoryInstanceId.value) {
      return selectedPlanReportSnapshot.value
    }

    if (props.workflowEntityType === 'PLAN_REPORT') {
      return selectedPlanReportSnapshot.value || props.planReportSummary || null
    }

    return null
  })

  const planDetailContentLoading = computed(() => {
    return selectedHistoryInstanceDetailLoading.value || selectedPlanReportSnapshotLoading.value
  })

  function formatIndicatorMetricValue(value: unknown): string {
    if (value === null || value === undefined || value === '') {
      return '--'
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }

    const normalized = String(value).trim()
    return normalized || '--'
  }

  function toDisplayAttachmentItems(
    attachments: PlanReportAttachmentItem[] | null | undefined
  ): Array<{ name: string; url: string; attachmentId?: number }> {
    if (!Array.isArray(attachments)) {
      return []
    }

    return attachments
      .map((attachment, index) => {
        const url = normalizeDisplayName(attachment?.url)
        if (!url) {
          return null
        }

        const attachmentId = Number(attachment?.id ?? NaN)
        return {
          name: normalizeDisplayName(attachment?.fileName) || `附件${index + 1}`,
          url,
          attachmentId: Number.isFinite(attachmentId) ? attachmentId : undefined
        }
      })
      .filter(
        (
          attachment
        ): attachment is {
          name: string
          url: string
          attachmentId?: number
        } => Boolean(attachment)
      )
  }

  async function ensureIndicatorDetailLoaded(indicatorIdValue: unknown): Promise<void> {
    const indicatorId = Number(indicatorIdValue ?? NaN)
    if (!Number.isFinite(indicatorId) || indicatorId <= 0) {
      return
    }

    const cacheKey = String(indicatorId)
    if (indicatorDetailCache.value[cacheKey]) {
      return
    }

    try {
      const indicator = await getIndicatorDetailById(indicatorId)
      const normalizedIndicator = {
        ...(indicator as unknown as Record<string, unknown>),
        id: String(
          (indicator as { id?: unknown; indicatorId?: unknown }).id ??
            (indicator as { indicatorId?: unknown }).indicatorId ??
            indicatorId
        ),
        name:
          normalizeDisplayName(
            (indicator as { name?: unknown; indicatorName?: unknown }).name ??
              (indicator as { indicatorName?: unknown }).indicatorName
          ) || `指标 #${indicatorId}`,
        type1: normalizeDisplayName(
          (indicator as { type1?: unknown; indicatorType1?: unknown; indicatorType?: unknown })
            .type1 ??
            (indicator as { indicatorType1?: unknown; indicatorType?: unknown }).indicatorType1 ??
            (indicator as { indicatorType?: unknown }).indicatorType
        ),
        type2: normalizeDisplayName(
          (indicator as { type2?: unknown; indicatorType2?: unknown }).type2 ??
            (indicator as { indicatorType2?: unknown }).indicatorType2
        ),
        responsibleDept: normalizeDisplayName(
          (
            indicator as {
              responsibleDept?: unknown
              targetOrgName?: unknown
              ownerOrgName?: unknown
              departmentName?: unknown
            }
          ).responsibleDept ??
            (indicator as { targetOrgName?: unknown }).targetOrgName ??
            (indicator as { ownerOrgName?: unknown }).ownerOrgName ??
            (indicator as { departmentName?: unknown }).departmentName
        ),
        ownerDept: normalizeDisplayName(
          (
            indicator as {
              ownerDept?: unknown
              ownerOrgName?: unknown
              targetOrgName?: unknown
            }
          ).ownerDept ??
            (indicator as { ownerOrgName?: unknown }).ownerOrgName ??
            (indicator as { targetOrgName?: unknown }).targetOrgName
        ),
        unit: normalizeDisplayName((indicator as { unit?: unknown }).unit)
      } as StrategicIndicator

      indicatorDetailCache.value = {
        ...indicatorDetailCache.value,
        [cacheKey]: normalizedIndicator
      }
    } catch (error) {
      logger.warn('[ApprovalProgressDrawer] 加载历史指标详情失败:', {
        indicatorId,
        error
      })
    }
  }

  const currentDetailFlowCode = computed(() => {
    return normalizeWorkflowCode(
      currentDetailWorkflow.value?.flowCode ||
        currentDetailWorkflow.value?.definitionId ||
        currentDetailWorkflow.value?.flowName
    )
  })

  const displayedBusinessSectionMode = computed<'report' | 'distribution' | 'generic'>(() => {
    if (selectedHistoryInstanceId.value) {
      if (displayedPlanReportSnapshot.value) {
        return 'report'
      }

      if (isDistributionFlow(currentDetailFlowCode.value)) {
        return 'distribution'
      }

      return 'generic'
    }

    if (displayedPlanReportSnapshot.value) {
      return 'report'
    }

    if (isDistributionFlow(currentDetailFlowCode.value) || props.approvalType === 'distribution') {
      return 'distribution'
    }

    return 'generic'
  })

  const displayedBusinessSectionTitle = computed(() => {
    if (displayedBusinessSectionMode.value === 'report') {
      return '本次上报内容'
    }

    if (displayedBusinessSectionMode.value === 'distribution') {
      return '本次下发内容'
    }

    return '本次业务内容'
  })

  const displayedBusinessSectionSubtitle = computed(() => {
    if (displayedBusinessSectionMode.value === 'report') {
      return '以下内容为发起审批时提交的业务明细'
    }

    if (displayedBusinessSectionMode.value === 'distribution') {
      return '以下内容为本次下发审批对应的指标明细'
    }

    return '以下内容为本次审批关联的业务明细'
  })

  const displayedBusinessSummaryComment = computed(() => {
    const snapshot = displayedPlanReportSnapshot.value
    if (!snapshot) {
      return ''
    }

    return normalizeDisplayName(snapshot.content) || normalizeDisplayName(snapshot.summary) || ''
  })

  const displayedBusinessProgressLabel = computed(() => {
    return displayedBusinessSectionMode.value === 'report' ? '本次填报进度' : '下发目标进度'
  })

  const displayedBusinessCommentLabel = computed(() => {
    return displayedBusinessSectionMode.value === 'report' ? '填报说明' : '下发说明'
  })

  const displayedBusinessAttachmentLabel = computed(() => {
    return displayedBusinessSectionMode.value === 'report' ? '提交材料' : '下发材料'
  })

  const displayedBusinessEmptyCommentText = computed(() => {
    return displayedBusinessSectionMode.value === 'report' ? '未填写说明' : '本次下发未附带额外说明'
  })

  const displayedBusinessEmptyAttachmentText = computed(() => {
    return displayedBusinessSectionMode.value === 'report' ? '未提交附件' : '本次下发未附带额外材料'
  })

  const displayedDistributionIndicatorItems = computed(() => {
    if (displayedPlanReportSnapshot.value) {
      return []
    }

    if (
      !(isDistributionFlow(currentDetailFlowCode.value) || props.approvalType === 'distribution')
    ) {
      return []
    }

    return availablePlanIndicators.value.map((indicator, index) => {
      const cacheKey = String(indicator.id ?? index)
      const resolvedIndicator = indicatorDetailCache.value[cacheKey] || indicator
      const type1 =
        normalizeDisplayName(resolvedIndicator.type1) ||
        normalizeDisplayName(
          (resolvedIndicator as { indicatorType?: unknown; indicatorType1?: unknown }).indicatorType
        ) ||
        normalizeDisplayName((resolvedIndicator as { indicatorType1?: unknown }).indicatorType1)
      const type2 = normalizeDisplayName(resolvedIndicator.type2)
      const currentProgressNumber = Number(resolvedIndicator.progress ?? NaN)
      const targetValueRaw = (resolvedIndicator as { targetValue?: unknown }).targetValue
      const actualValueRaw = (resolvedIndicator as { actualValue?: unknown }).actualValue
      const unitRaw = normalizeDisplayName((resolvedIndicator as { unit?: unknown }).unit)
      const hasTargetValue =
        targetValueRaw !== null && targetValueRaw !== undefined && String(targetValueRaw) !== ''
      const hasActualValue =
        actualValueRaw !== null && actualValueRaw !== undefined && String(actualValueRaw) !== ''
      const hasExplicitMetric = hasTargetValue || hasActualValue || Boolean(unitRaw)

      return {
        indicatorId: Number(resolvedIndicator.id ?? NaN) || index,
        indicatorName: normalizeDisplayName(resolvedIndicator.name) || `指标${index + 1}`,
        indicatorType: [type1, type2].filter(Boolean).join(' / ') || '--',
        responsibleDept:
          normalizeDisplayName(resolvedIndicator.responsibleDept) ||
          normalizeDisplayName((resolvedIndicator as { targetOrgName?: unknown }).targetOrgName) ||
          normalizeDisplayName((resolvedIndicator as { ownerOrgName?: unknown }).ownerOrgName) ||
          normalizeDisplayName(
            (resolvedIndicator as { departmentName?: unknown }).departmentName
          ) ||
          normalizeDisplayName(resolvedIndicator.ownerDept) ||
          '--',
        currentProgress: Number.isFinite(currentProgressNumber)
          ? `${currentProgressNumber}%`
          : '--',
        submittedProgress: '--',
        submittedComment: '',
        targetValue: hasExplicitMetric
          ? formatIndicatorMetricValue(targetValueRaw)
          : Number.isFinite(currentProgressNumber)
            ? '100'
            : '--',
        actualValue: hasExplicitMetric
          ? formatIndicatorMetricValue(actualValueRaw)
          : Number.isFinite(currentProgressNumber)
            ? String(currentProgressNumber)
            : '--',
        unit: hasExplicitMetric
          ? unitRaw || '--'
          : Number.isFinite(currentProgressNumber)
            ? '%'
            : '--',
        attachments: []
      }
    })
  })

  const displayedBusinessIndicatorItems = computed(() => {
    const snapshot = displayedPlanReportSnapshot.value
    const indicatorDetails = Array.isArray(snapshot?.indicatorDetails)
      ? snapshot.indicatorDetails
      : []

    return indicatorDetails.map((detail: PlanReportIndicatorDetailItem, index: number) => {
      const indicatorId = Number(detail?.indicatorId ?? NaN)
      const cacheKey = String(indicatorId)
      const matchedIndicator =
        indicatorDetailCache.value[cacheKey] ||
        availablePlanIndicators.value.find(indicator => Number(indicator.id) === indicatorId)
      const indicatorName =
        normalizeDisplayName(matchedIndicator?.name) ||
        `指标${Number.isFinite(indicatorId) ? ` #${indicatorId}` : index + 1}`
      const type1 = normalizeDisplayName(matchedIndicator?.type1)
      const type2 = normalizeDisplayName(matchedIndicator?.type2)
      const currentProgressNumber = Number(matchedIndicator?.progress ?? NaN)
      const targetValueRaw = (matchedIndicator as { targetValue?: unknown } | undefined)
        ?.targetValue
      const actualValueRaw = (matchedIndicator as { actualValue?: unknown } | undefined)
        ?.actualValue
      const unitRaw = normalizeDisplayName(
        (matchedIndicator as { unit?: unknown } | undefined)?.unit
      )
      const hasTargetValue =
        targetValueRaw !== null && targetValueRaw !== undefined && String(targetValueRaw) !== ''
      const hasActualValue =
        actualValueRaw !== null && actualValueRaw !== undefined && String(actualValueRaw) !== ''
      const hasExplicitMetric = hasTargetValue || hasActualValue || Boolean(unitRaw)
      const inferredTargetValue =
        Number.isFinite(Number(targetValueRaw)) && hasTargetValue
          ? formatIndicatorMetricValue(targetValueRaw)
          : Number.isFinite(currentProgressNumber)
            ? '100'
            : '--'
      const inferredActualValue =
        Number.isFinite(Number(actualValueRaw)) && hasActualValue
          ? formatIndicatorMetricValue(actualValueRaw)
          : Number.isFinite(currentProgressNumber)
            ? String(currentProgressNumber)
            : '--'
      const inferredUnit = unitRaw || (Number.isFinite(currentProgressNumber) ? '%' : '--')

      return {
        indicatorId: Number.isFinite(indicatorId) ? indicatorId : null,
        indicatorName,
        indicatorType: [type1, type2].filter(Boolean).join(' / ') || '--',
        responsibleDept:
          normalizeDisplayName(matchedIndicator?.responsibleDept) ||
          normalizeDisplayName(
            (
              matchedIndicator as {
                ownerDept?: unknown
                targetOrgName?: unknown
                ownerOrgName?: unknown
                departmentName?: unknown
              } | null
            )?.targetOrgName
          ) ||
          normalizeDisplayName(
            (
              matchedIndicator as {
                ownerDept?: unknown
                ownerOrgName?: unknown
                departmentName?: unknown
              } | null
            )?.ownerOrgName
          ) ||
          normalizeDisplayName(
            (
              matchedIndicator as {
                ownerDept?: unknown
                departmentName?: unknown
              } | null
            )?.departmentName
          ) ||
          normalizeDisplayName(matchedIndicator?.ownerDept) ||
          '--',
        currentProgress: Number.isFinite(currentProgressNumber)
          ? `${currentProgressNumber}%`
          : '--',
        submittedProgress: Number.isFinite(Number(detail?.progress))
          ? `${Number(detail?.progress)}%`
          : '--',
        submittedComment: normalizeDisplayName(detail?.comment) || '未填写说明',
        targetValue: hasExplicitMetric
          ? formatIndicatorMetricValue(targetValueRaw)
          : inferredTargetValue,
        actualValue: hasExplicitMetric
          ? formatIndicatorMetricValue(actualValueRaw)
          : inferredActualValue,
        unit: hasExplicitMetric ? unitRaw || '--' : inferredUnit,
        attachments: toDisplayAttachmentItems(detail?.attachments)
      }
    })
  })

  function resolveHistoricalCardSummary(item: {
    flowCode?: string
    entityId?: string | number
  }): HistoricalCardSummary | null {
    if (isDistributionFlow(item.flowCode)) {
      const indicatorNames = props.indicators
        .map(indicator => normalizeDisplayName(indicator.name))
        .filter(Boolean)

      if (indicatorNames.length === 0) {
        return null
      }

      return {
        title: '本次下发内容摘要',
        items: indicatorNames.slice(0, 3)
      }
    }

    if (isSubmissionFlow(item.flowCode)) {
      const entityKey = String(item.entityId || '').trim()
      const snapshot =
        (displayedPlanReportSnapshot.value &&
        entityKey === String(displayedPlanReportSnapshot.value.id || '')
          ? displayedPlanReportSnapshot.value
          : null) ||
        planReportSnapshotCache.value[entityKey] ||
        null

      const indicatorNames = Array.isArray(snapshot?.indicatorDetails)
        ? snapshot.indicatorDetails
            .map(detail => Number(detail?.indicatorId ?? NaN))
            .map(indicatorId => {
              const matchedIndicator = props.indicators.find(
                indicator => Number(indicator.id) === indicatorId
              )
              return normalizeDisplayName(matchedIndicator?.name)
            })
            .filter(Boolean)
        : []

      if (indicatorNames.length === 0) {
        return null
      }

      return {
        title: '本次上报内容摘要',
        items: indicatorNames.slice(0, 3)
      }
    }

    return null
  }

  const currentPlanStepDisplay = computed(() => {
    if (
      currentPlanInstanceStatus.value === 'WITHDRAWN' ||
      currentPlanInstanceStatus.value === 'CANCELLED'
    ) {
      return '已撤回'
    }
    if (
      currentPlanInstanceStatus.value === 'REJECTED' ||
      currentPlanInstanceStatus.value === 'RETURNED'
    ) {
      return '已退回'
    }
    if (
      currentPlanInstanceStatus.value === 'APPROVED' ||
      currentPlanInstanceStatus.value === 'DISTRIBUTED'
    ) {
      return '已通过'
    }

    if (props.workflowEntityType === 'PLAN_REPORT') {
      if (['已撤回', '已驳回', '已通过'].includes(latestPlanTaskDisplayLabel.value)) {
        return latestPlanTaskDisplayLabel.value
      }

      return (
        activePlanWorkflow.value?.currentStepName || latestPlanTaskDisplayLabel.value || '审批中'
      )
    }

    if (normalizedPlanBusinessStatus.value === 'DRAFT') {
      if (planWorkflowStatusTag.value.label === '已撤回') {
        return '已撤回'
      }
      if (planWorkflowStatusTag.value.label === '已驳回') {
        return '已退回'
      }
      return '草稿'
    }

    if (['已撤回', '已驳回', '已通过'].includes(latestPlanTaskDisplayLabel.value)) {
      return latestPlanTaskDisplayLabel.value
    }

    return activePlanWorkflow.value?.currentStepName || latestPlanTaskDisplayLabel.value || '审批中'
  })

  const currentPlanApprovalItems = computed<PlanApprovalDetailItem[]>(() => {
    if (
      props.workflowEntityType === 'PLAN_REPORT' &&
      hasPlanWorkflowData.value &&
      planWorkflowDetail.value
    ) {
      return [
        {
          instanceId: Number(planWorkflowDetail.value.instanceId ?? 0) || 0,
          instanceNo: String(planWorkflowDetail.value.instanceId || '待回填'),
          title: props.planName || `${props.departmentName || '当前部门'}上报审批`,
          routeTitle: `上报审批 · ${normalizeDisplayName(planWorkflowDetail.value.targetOrgName) || props.departmentName || '当前部门'} -> ${normalizeDisplayName(planWorkflowDetail.value.sourceOrgName) || '上级部门'}`,
          submitterName:
            props.departmentName ||
            normalizeDisplayName(planWorkflowDetail.value.targetOrgName) ||
            '当前部门',
          currentStepName: String(currentPlanStepDisplay.value),
          createdAt: planWorkflowDetail.value.startTime,
          entityId: props.workflowEntityId,
          planName: props.planName || props.departmentName || '当前计划'
        }
      ]
    }

    if (hasPlanWorkflowData.value && activePlanWorkflow.value) {
      const planName = resolvePlanDisplayNameFromContext(
        planWorkflowDetail.value,
        activePlanWorkflow.value.name
      )
      return [
        {
          instanceId: currentPlanInstanceId.value,
          instanceNo: String(currentPlanInstanceId.value || '待回填'),
          title: planName,
          submitterName: resolvePlanSubmitterDisplayName(planWorkflowDetail.value),
          currentStepName: String(currentPlanStepDisplay.value),
          createdAt: activePlanWorkflow.value?.submittedAt || activePlanWorkflow.value?.createdAt,
          entityId: activePlanWorkflow.value?.id || props.workflowEntityId,
          planName
        }
      ]
    }

    return scopedPlanApprovals.value.map((instance, index) => ({
      instanceId: Number(instance.instanceId) || index,
      instanceNo:
        String(
          instance.instanceNo || instance.flowInstanceNo || instance.processInstanceNo || ''
        ).trim() || `审批实例 ${index + 1}`,
      title: String(
        instance.entityTitle ||
          instance.planName ||
          instance.title ||
          instance.entityName ||
          `${props.planName || props.departmentName || '当前计划'} - 审批实例 ${index + 1}`
      ).trim(),
      submitterName: String(
        instance.submitterName || instance.applicantName || instance.submitter || '未知'
      ),
      currentStepName: String(
        instance.currentStepName ||
          instance.currentStep ||
          latestPlanTaskDisplayLabel.value ||
          '审批中'
      ),
      createdAt: typeof instance.createdAt === 'string' ? instance.createdAt : undefined,
      entityId: instance.entityId,
      planName: instance.planName
    }))
  })

  function isSubmissionFlow(flowCode?: string): boolean {
    return String(flowCode || '')
      .toUpperCase()
      .startsWith('PLAN_APPROVAL_')
  }

  function isDistributionFlow(flowCode?: string): boolean {
    return String(flowCode || '')
      .toUpperCase()
      .startsWith('PLAN_DISPATCH_')
  }

  function resolveApprovalRouteTitle(
    card: Pick<WorkflowHistoryCardResponse, 'flowCode' | 'sourceOrgName' | 'targetOrgName'>
  ): string {
    const sourceOrgName = normalizeDisplayName(card.sourceOrgName) || '战略发展部'
    const targetOrgName = normalizeDisplayName(card.targetOrgName) || '目标部门'

    if (isSubmissionFlow(card.flowCode)) {
      return `上报审批 · ${targetOrgName} -> ${sourceOrgName}`
    }

    if (isDistributionFlow(card.flowCode)) {
      return `下发审批 · ${sourceOrgName} -> ${targetOrgName}`
    }

    return normalizeDisplayName(card.flowCode) || '审批流程'
  }

  function resolveHistoryStatusTag(status?: string): {
    label: string
    type: 'success' | 'warning' | 'danger' | 'info'
  } {
    const normalized = String(status || '').toUpperCase()
    if (normalized === 'APPROVED') {
      return { label: '已通过', type: 'success' }
    }
    if (normalized === 'REJECTED') {
      return { label: '已驳回', type: 'danger' }
    }
    if (normalized === 'WITHDRAWN') {
      return { label: '已撤回', type: 'info' }
    }
    if (normalized === 'IN_REVIEW' || normalized === 'PENDING' || normalized === 'SUBMITTED') {
      return { label: '审批中', type: 'warning' }
    }
    return { label: normalized || '未知', type: 'info' }
  }

  function isTerminalHistoryStatus(status?: string): boolean {
    const normalized = String(status || '')
      .trim()
      .toUpperCase()
    // 业务约定：审批历史只展示已审批完成的结果，不包含撤回中的流程。
    return ['APPROVED', 'REJECTED'].includes(normalized)
  }

  const historicalPlanApprovalItems = computed<PlanApprovalDetailItem[]>(() => {
    return planWorkflowHistoryCards.value
      .filter(item => isTerminalHistoryStatus(item.status) || Boolean(item.completedAt))
      .map((item, index) => {
        const statusTag = resolveHistoryStatusTag(item.status)
        return {
          instanceId: Number(item.instanceId) || index,
          instanceNo: String(item.instanceNo || item.instanceId || `审批实例 ${index + 1}`),
          title: normalizeDisplayName(item.planName) || `Plan ${item.entityId || ''}`.trim(),
          routeTitle: resolveApprovalRouteTitle(item),
          flowName: item.flowName,
          flowCode: item.flowCode,
          submitterName: normalizeDisplayName(item.requesterName) || '未知',
          currentStepName: statusTag.label,
          createdAt: item.startedAt,
          completedAt: item.completedAt,
          statusLabel: statusTag.label,
          statusType: statusTag.type,
          entityId: item.entityId,
          planName: item.planName
        }
      })
  })

  const currentPlanApprovalSummary = computed(() => {
    if (
      props.workflowEntityType === 'PLAN_REPORT' &&
      hasPlanWorkflowData.value &&
      planWorkflowDetail.value
    ) {
      return {
        key: `plan-report-${props.workflowEntityId || planWorkflowDetail.value.instanceId || 'current'}`,
        planName: props.planName || `${props.departmentName || '当前部门'}上报审批`,
        currentStepName: currentPlanStepDisplay.value,
        submitterName: resolvePlanSubmitterDisplayName(planWorkflowDetail.value),
        createdAt: planWorkflowDetail.value.startTime,
        count: 1
      }
    }

    if (hasPlanWorkflowData.value && activePlanWorkflow.value) {
      const planName = resolvePlanDisplayNameFromContext(
        planWorkflowDetail.value,
        activePlanWorkflow.value.name
      )
      return {
        key: planName,
        planName,
        currentStepName: currentPlanStepDisplay.value,
        submitterName: resolvePlanSubmitterDisplayName(planWorkflowDetail.value),
        createdAt: activePlanWorkflow.value?.submittedAt || activePlanWorkflow.value?.createdAt,
        count: 1
      }
    }

    if (scopedPlanApprovals.value.length === 0) {
      return null
    }

    const sortedCreatedAt = scopedPlanApprovals.value
      .map(item => item.createdAt)
      .filter(Boolean)
      .sort()
    const latestCreatedAt = sortedCreatedAt[sortedCreatedAt.length - 1]

    return {
      key: props.planName || props.departmentName || 'current-plan',
      planName: props.planName || `${props.departmentName || '当前部门'}计划`,
      currentStepName:
        scopedPlanApprovals.value
          .map(item => item.currentStepName)
          .find(step => typeof step === 'string' && step.trim()) ||
        latestPlanTaskDisplayLabel.value ||
        '审批中',
      submitterName:
        scopedPlanApprovals.value
          .map(item => item.submitterName)
          .find(name => typeof name === 'string' && name.trim()) || '未知',
      createdAt: latestCreatedAt,
      count: scopedPlanApprovals.value.length
    }
  })

  // ============ 审批流程节点数据 ============
  const workflowNodes = computed<WorkflowNode[]>(() => {
    if (isPlanHistoryOnlyMode.value) {
      return []
    }

    if (props.showPlanApprovals && !hasPlanWorkflowData.value) {
      return []
    }

    const submittedMaterialAttachments = (() => {
      if (props.workflowEntityType !== 'PLAN_REPORT') {
        return undefined
      }

      const detailItems = Array.isArray(props.planReportSummary?.indicatorDetails)
        ? props.planReportSummary.indicatorDetails
        : []
      const deduped = new Map<string, WorkflowNodeAttachment>()

      detailItems.forEach(detail => {
        if (!Array.isArray(detail.attachments)) {
          return
        }

        detail.attachments.forEach((attachment, index) => {
          const url = String(attachment?.url || '').trim()
          if (!url) {
            return
          }

          const name = String(attachment?.fileName || '').trim() || `附件${index + 1}`
          const attachmentId = Number(attachment?.id ?? NaN)
          const dedupeKey = Number.isFinite(attachmentId) ? `id:${attachmentId}` : `url:${url}`

          if (!deduped.has(dedupeKey)) {
            deduped.set(dedupeKey, {
              name,
              url,
              attachmentId: Number.isFinite(attachmentId) ? attachmentId : undefined
            })
          }
        })
      })

      return deduped.size > 0 ? Array.from(deduped.values()) : undefined
    })()

    const submittedReportComment = (() => {
      const rootComment = normalizeDisplayName(props.planReportSummary?.content)
      if (rootComment) {
        return rootComment
      }

      const summaryComment = normalizeDisplayName(props.planReportSummary?.summary)
      if (summaryComment) {
        return summaryComment
      }

      const detailItems = Array.isArray(props.planReportSummary?.indicatorDetails)
        ? props.planReportSummary.indicatorDetails
        : []
      return (
        detailItems
          .map(detail => normalizeDisplayName(detail.comment))
          .find(comment => Boolean(comment)) || undefined
      )
    })()

    if (hasPlanWorkflowData.value && props.plan) {
      return planWorkflowTasks.value.map((task, index) => ({
        id: String(task.taskId || task.taskKey || task.currentStepName || task.taskName),
        name: resolveWorkflowTaskDisplayName(task),
        status: mapWorkflowTaskStatusToNodeStatus(task),
        operatorName: resolveWorkflowTaskDisplayOperatorName(task),
        operatorAvatar: task.assigneeId
          ? workflowUserAvatarCache.value[String(task.assigneeId)] || undefined
          : undefined,
        approverCandidates: resolveTaskCandidateApprovers(task),
        operateTime: task.approvedAt
          ? new Date(task.approvedAt)
          : task.createdTime
            ? new Date(task.createdTime)
            : undefined,
        comment:
          submittedReportComment &&
          index === 0 &&
          resolveWorkflowTaskDisplayName(task).includes('提交')
            ? submittedReportComment
            : typeof task.comment === 'string' && task.comment.trim()
              ? task.comment
              : String(task.taskId || '') === String(currentPlanTaskId.value || '') &&
                  activePlanWorkflow.value?.canWithdraw
                ? '当前仍可撤回'
                : undefined,
        attachments:
          submittedMaterialAttachments &&
          index === 0 &&
          resolveWorkflowTaskDisplayName(task).includes('提交')
            ? submittedMaterialAttachments
            : undefined
      }))
    }

    const indicator = currentIndicator.value
    if (!indicator) return []

    // 根据指标的审批状态构建工作流节点
    const nodes: WorkflowNode[] = []

    // 1. 提交申请节点
    nodes.push({
      id: 'submit',
      name: '提交申请',
      status: indicator.progressApprovalStatus ? 'completed' : 'pending',
      operatorName: indicator.responsibleDeptName || '责任部门',
      operateTime: indicator.createdAt,
      comment: '提交进度审批申请'
    })

    // 2. 职能部门审核节点
    const hasFunctional = indicator.functionalDeptId
    if (hasFunctional) {
      nodes.push({
        id: 'functional',
        name: '职能部门审核',
        status: getFunctionalStatus(indicator.progressApprovalStatus),
        operatorName: indicator.functionalDeptName || '职能部门',
        comment: indicator.statusAudit?.find((a: Record<string, unknown>) => a.action === 'approve')
          ?.comment as string | undefined
      })
    }

    // 3. 战略部门审批节点
    nodes.push({
      id: 'strategic',
      name: '战略部门审批',
      status: getStrategicStatus(indicator.progressApprovalStatus),
      operatorName: '战略发展部',
      operateTime: indicator.updatedAt,
      comment: indicator.statusAudit?.find((a: Record<string, unknown>) => a.action === 'reject')
        ?.comment as string | undefined
    })

    return nodes
  })

  // 获取职能部门节点状态
  function getFunctionalStatus(approvalStatus?: string): WorkflowNode['status'] {
    if (approvalStatus === 'approved') return 'completed'
    if (approvalStatus === 'rejected') return 'rejected'
    if (approvalStatus === 'pending') return 'completed'
    return 'pending'
  }

  // 获取战略部门节点状态
  function getStrategicStatus(approvalStatus?: string): WorkflowNode['status'] {
    if (approvalStatus === 'approved') return 'completed'
    if (approvalStatus === 'rejected') return 'rejected'
    if (approvalStatus === 'pending') return 'current'
    return 'pending'
  }

  // ============ 审批历史数据 ============
  const approvalHistory = computed<ApprovalHistoryItem[]>(() => {
    if (props.showPlanApprovals) {
      return planWorkflowHistory.value
    }

    if (planWorkflowHistory.value.length > 0) {
      return planWorkflowHistory.value
    }

    const indicator = currentIndicator.value
    if (!indicator?.statusAudit) return []

    return indicator.statusAudit.map((audit: Record<string, unknown>, index: number) => ({
      id: String(index),
      action: audit.action as ApprovalHistoryItem['action'],
      operator: String(audit.operator ?? index),
      operatorName: String(audit.operatorName ?? '系统'),
      operatorAvatar: parsePositiveUserId(audit.operator)
        ? workflowUserAvatarCache.value[String(parsePositiveUserId(audit.operator))] || undefined
        : undefined,
      operateTime: new Date(
        (audit.operateTime as string | number | Date | undefined) ?? Date.now()
      ),
      stepName: typeof audit.stepName === 'string' ? audit.stepName : undefined,
      comment: audit.comment as string | undefined,
      dataBefore: audit.dataBefore as Record<string, unknown> | undefined,
      dataAfter: audit.dataAfter as Record<string, unknown> | undefined
    }))
  })

  // 当前节点ID
  const currentNodeId = computed(() => {
    if (hasPlanWorkflowData.value && props.plan) {
      if (isPlanPendingApproval.value && currentPlanTaskId.value) {
        return String(currentPlanTaskId.value)
      }
      return ''
    }

    const status = currentIndicator.value?.progressApprovalStatus
    if (status === 'pending') return 'strategic'
    if (status === 'approved') return ''
    return 'submit'
  })

  // 驳回原因
  const rejectionReason = computed(() => {
    if (activePlanWorkflow.value?.lastRejectReason) {
      return activePlanWorkflow.value.lastRejectReason
    }

    const indicator = currentIndicator.value
    const rejectAudit = indicator?.statusAudit?.find(
      (a: Record<string, unknown>) => a.action === 'reject'
    )
    return rejectAudit?.comment || ''
  })

  // ============ 方法 ============
  function handleClose() {
    emit('update:modelValue', false)
    emit('close')
  }

  function applyOptimisticPlanWorkflowPatch(patch: {
    status?: string
    workflowStatus?: string
    canWithdraw?: boolean
    currentTaskId?: number | null
    currentStepName?: string | null
    currentApproverId?: number | null
    currentApproverName?: string | null
  }) {
    if (!props.plan) {
      return
    }

    Object.assign(props.plan, patch)
  }

  async function refreshPlanApprovalAfterMutation(): Promise<void> {
    const planId = Number(props.plan?.id ?? scopedDepartmentPlan.value?.id ?? NaN)

    await Promise.all([
      loadPendingPlanApprovals(),
      loadPlanWorkflowDetail(),
      loadPlanWorkflowHistoryCards()
    ])

    if (Number.isFinite(planId) && planId > 0) {
      await planStore.loadPlanDetails(planId, { force: true, background: true })
    }

    notifyApprovalStateRefresh({ source: 'approval-progress-drawer' })
    emit('refresh')
  }

  async function loadPendingPlanApprovals() {
    if (hasPlanWorkflowData.value) {
      pendingPlanApprovals.value = []
      return
    }

    if (!props.showPlanApprovals) {
      pendingPlanApprovals.value = []
      return
    }

    planApprovalsLoading.value = true
    try {
      if (props.departmentName) {
        await planStore.loadPlans()
      }

      const userId = authStore.user?.userId || authStore.user?.id || 1
      const response = await approvalApi.getPendingApprovals(userId)
      if (response.success && Array.isArray(response.data)) {
        pendingPlanApprovals.value = response.data
        if (props.modelValue && props.showPlanApprovals && scopedPendingPlanCount.value > 0) {
          activeTab.value = 'pending-plans'
        }
        return
      }

      pendingPlanApprovals.value = []
      if (response.message) {
        ElMessage.error(response.message)
      }
    } catch (error: any) {
      pendingPlanApprovals.value = []
      logger.error('[ApprovalProgressDrawer] 加载待审批列表失败:', error)
      ElMessage.error(error?.message || '加载待审批列表失败')
    } finally {
      planApprovalsLoading.value = false
    }
  }

  async function loadPlanWorkflowDetail() {
    if (!props.showPlanApprovals) {
      planWorkflowDetail.value = null
      return
    }

    const retainedDetail = getRetainedWorkflowDetail()

    try {
      const businessEntityType = props.workflowEntityType || 'PLAN'
      const businessEntityId = Number(props.workflowEntityId ?? props.plan?.id ?? 0)
      if (Number.isFinite(businessEntityId) && businessEntityId > 0) {
        const response = await getWorkflowInstanceDetailByBusiness(
          businessEntityType,
          businessEntityId
        )
        if (
          response.success &&
          response.data &&
          matchesExpectedWorkflowCode(response.data.flowCode)
        ) {
          planWorkflowDetail.value = response.data
          if (
            props.modelValue &&
            props.showPlanApprovals &&
            normalizeWorkflowStatus(response.data.status) === 'PENDING'
          ) {
            activeTab.value = 'pending-plans'
          }
          return
        }
      }
    } catch (error) {
      logger.warn('[ApprovalProgressDrawer] 按业务实体加载计划工作流详情失败，回退旧实例ID:', error)
    }

    const workflowInstanceId = Number(props.plan?.workflowInstanceId ?? 0)
    if (Number.isFinite(workflowInstanceId) && workflowInstanceId > 0) {
      try {
        const response = await getWorkflowInstanceDetail(String(workflowInstanceId))
        if (
          response.success &&
          response.data &&
          matchesExpectedWorkflowCode(response.data.flowCode)
        ) {
          planWorkflowDetail.value = response.data
          if (
            props.modelValue &&
            props.showPlanApprovals &&
            normalizeWorkflowStatus(response.data.status) === 'PENDING'
          ) {
            activeTab.value = 'pending-plans'
          }
          return
        }
      } catch (error) {
        logger.warn('[ApprovalProgressDrawer] 旧实例ID详情加载失败:', {
          workflowInstanceId,
          error
        })
      }
    }

    if (retainedDetail) {
      planWorkflowDetail.value = retainedDetail
      return
    }

    planWorkflowDetail.value = null
  }

  async function loadWorkflowDefinitionPreview() {
    const flowCode = normalizeDisplayName(
      planWorkflowDetail.value?.flowCode ||
        (activePlanWorkflow.value as { flowCode?: unknown } | null)?.flowCode ||
        (Array.isArray(props.workflowCode) ? props.workflowCode[0] : props.workflowCode)
    )

    if (!flowCode) {
      workflowDefinitionPreview.value = null
      return
    }

    try {
      const response = await getWorkflowDefinitionPreviewByCode(flowCode)
      workflowDefinitionPreview.value = response.success && response.data ? response.data : null
    } catch (error) {
      workflowDefinitionPreview.value = null
      logger.warn('[ApprovalProgressDrawer] 加载流程定义预览失败:', { flowCode, error })
    }
  }

  async function ensureWorkflowRelatedAvatarsLoaded(): Promise<void> {
    const userIds = new Set<number>()

    planWorkflowTasks.value.forEach(task => {
      const assigneeId = parsePositiveUserId(task.assigneeId)
      if (assigneeId) {
        userIds.add(assigneeId)
      }
    })
    ;(workflowDefinitionPreview.value?.steps || []).forEach(step => {
      ;(step.candidateApprovers || []).forEach(candidate => {
        const candidateUserId = parsePositiveUserId(candidate.userId)
        if (candidateUserId) {
          userIds.add(candidateUserId)
        }
      })
    })

    await Promise.all([...userIds].map(userId => ensureWorkflowUserAvatarLoaded(userId)))
  }

  async function loadPlanWorkflowHistoryCards() {
    if (!props.showPlanApprovals || !props.plan) {
      planWorkflowHistoryCards.value = []
      return
    }

    if (historyTargets.value.length === 0) {
      planWorkflowHistoryCards.value = []
      return
    }

    try {
      const results = await Promise.all(
        historyTargets.value.map(target =>
          getWorkflowInstanceHistoryByBusiness(target.entityType, target.entityId)
        )
      )

      const merged = results
        .flatMap(response =>
          response.success && Array.isArray(response.data) ? response.data : []
        )
        .sort((left, right) => {
          const leftTime = new Date(left.completedAt || left.startedAt || 0).getTime()
          const rightTime = new Date(right.completedAt || right.startedAt || 0).getTime()
          return rightTime - leftTime
        })

      const seen = new Set<string>()
      planWorkflowHistoryCards.value = merged.filter(item => {
        const key = String(item.instanceId || '')
        if (!key || seen.has(key)) {
          return false
        }
        seen.add(key)
        return true
      })
    } catch (error) {
      planWorkflowHistoryCards.value = []
      logger.warn('[ApprovalProgressDrawer] 加载计划审批历史卡片失败:', error)
    }
  }

  async function handleApprovePlanBatch() {
    if (!hasPlanApprovalPermission.value) {
      ElMessage.warning('当前角色或组织范围不匹配该审批节点，无法执行审批通过')
      return
    }

    if (hasPlanWorkflowData.value) {
      await loadPlanWorkflowDetail()
    }

    if (currentPlanTaskId.value) {
      if (!canCurrentUserHandlePlanApproval.value) {
        ElMessage.warning('当前审批节点不是你，无法执行审批通过')
        return
      }

      try {
        const { value } = await ElMessageBox.prompt(
          `确认通过“${props.plan.name || props.planName || '当前计划'}”的审批？`,
          '审批通过',
          {
            confirmButtonText: '确认通过',
            cancelButtonText: '取消',
            inputPlaceholder: '请输入审批意见（可选）',
            inputType: 'textarea'
          }
        )
        const loadingInstance = ElLoading.service({
          lock: true,
          text: '正在审批并同步数据，请稍候...',
          background: 'rgba(0, 0, 0, 0.7)'
        })

        try {
          const userId = authStore.user?.userId || authStore.user?.id || 1
          const response = await approvalApi.approvePlan(
            currentPlanTaskId.value,
            userId,
            value || '审批通过'
          )
          if (!response.success) {
            ElMessage.error(response.message || '审批失败')
            return
          }
          applyOptimisticPlanWorkflowPatch({
            status: 'DISTRIBUTED',
            workflowStatus: 'APPROVED',
            canWithdraw: false,
            currentTaskId: null,
            currentStepName: '审批完成',
            currentApproverId: null,
            currentApproverName: null
          })
          await refreshPlanApprovalAfterMutation()
          ElMessage.success('审批通过')
          handleClose()
        } finally {
          loadingInstance.close()
        }
        return
      } catch {
        return
      }
    }

    if (scopedPlanApprovals.value.length === 0) {
      ElMessage.warning('当前计划暂无待审批实例')
      return
    }

    try {
      const { value } = await ElMessageBox.prompt(
        `确认一键审批通过“${currentPlanApprovalSummary.value?.planName || '当前计划'}”下的 ${scopedPlanApprovals.value.length} 条审批实例？`,
        '审批通过',
        {
          confirmButtonText: '确认通过',
          cancelButtonText: '取消',
          inputPlaceholder: '请输入审批意见（可选）',
          inputType: 'textarea'
        }
      )

      const loadingInstance = ElLoading.service({
        lock: true,
        text: '正在审批并同步数据，请稍候...',
        background: 'rgba(0, 0, 0, 0.7)'
      })

      try {
        const userId = authStore.user?.userId || authStore.user?.id || 1
        for (const instance of scopedPlanApprovals.value) {
          const response = await approvalApi.approvePlan(
            instance.instanceId,
            userId,
            value || '审批通过'
          )
          if (!response.success) {
            ElMessage.error(response.message || '审批失败')
            return
          }
        }

        applyOptimisticPlanWorkflowPatch({
          status: 'DISTRIBUTED',
          workflowStatus: 'APPROVED',
          canWithdraw: false,
          currentTaskId: null,
          currentStepName: '审批完成',
          currentApproverId: null,
          currentApproverName: null
        })
        await refreshPlanApprovalAfterMutation()
        ElMessage.success(`已一键通过 ${scopedPlanApprovals.value.length} 条审批实例`)
        handleClose()
      } finally {
        loadingInstance.close()
      }
    } catch {
      // 用户取消
    }
  }

  async function handleRejectPlanBatch() {
    if (!hasPlanApprovalPermission.value) {
      ElMessage.warning('当前角色或组织范围不匹配该审批节点，无法执行审批驳回')
      return
    }

    if (hasPlanWorkflowData.value) {
      await loadPlanWorkflowDetail()
    }

    if (currentPlanTaskId.value) {
      if (!canCurrentUserHandlePlanApproval.value) {
        ElMessage.warning('当前审批节点不是你，无法执行审批驳回')
        return
      }

      try {
        const { value } = await ElMessageBox.prompt(
          `确认驳回“${props.plan.name || props.planName || '当前计划'}”的审批？`,
          '审批驳回',
          {
            confirmButtonText: '确认驳回',
            cancelButtonText: '取消',
            inputPlaceholder: '请输入驳回原因（必填）',
            inputType: 'textarea',
            inputValidator: val => (val && val.trim() ? true : '请输入驳回原因')
          }
        )
        const loadingInstance = ElLoading.service({
          lock: true,
          text: '正在驳回并同步数据，请稍候...',
          background: 'rgba(0, 0, 0, 0.7)'
        })

        try {
          const userId = authStore.user?.userId || authStore.user?.id || 1
          const response = await approvalApi.rejectPlan(currentPlanTaskId.value, userId, value)
          if (!response.success) {
            ElMessage.error(response.message || '驳回失败')
            return
          }
          applyOptimisticPlanWorkflowPatch({
            status: 'DRAFT',
            workflowStatus: 'REJECTED',
            canWithdraw: false,
            currentTaskId: null,
            currentStepName: '已驳回'
          })
          await refreshPlanApprovalAfterMutation()
          ElMessage.success('审批已驳回')
          handleClose()
        } finally {
          loadingInstance.close()
        }
        return
      } catch {
        return
      }
    }

    if (scopedPlanApprovals.value.length === 0) {
      ElMessage.warning('当前计划暂无待审批实例')
      return
    }

    try {
      const { value } = await ElMessageBox.prompt(
        `确认一键驳回“${currentPlanApprovalSummary.value?.planName || '当前计划'}”下的 ${scopedPlanApprovals.value.length} 条审批实例？`,
        '审批拒绝',
        {
          confirmButtonText: '确认拒绝',
          cancelButtonText: '取消',
          inputPlaceholder: '请输入拒绝原因（必填）',
          inputType: 'textarea',
          inputValidator: val => (val && val.trim() ? true : '请输入拒绝原因')
        }
      )

      const loadingInstance = ElLoading.service({
        lock: true,
        text: '正在驳回并同步数据，请稍候...',
        background: 'rgba(0, 0, 0, 0.7)'
      })

      try {
        const userId = authStore.user?.userId || authStore.user?.id || 1
        for (const instance of scopedPlanApprovals.value) {
          const response = await approvalApi.rejectPlan(instance.instanceId, userId, value)
          if (!response.success) {
            ElMessage.error(response.message || '拒绝失败')
            return
          }
        }

        applyOptimisticPlanWorkflowPatch({
          status: 'DRAFT',
          workflowStatus: 'REJECTED',
          canWithdraw: false,
          currentTaskId: null,
          currentStepName: '已驳回'
        })
        await refreshPlanApprovalAfterMutation()
        ElMessage.success(`已一键驳回 ${scopedPlanApprovals.value.length} 条审批实例`)
        handleClose()
      } finally {
        loadingInstance.close()
      }
    } catch {
      // 用户取消
    }
  }

  function formatTime(timestamp?: Date | string) {
    if (!timestamp) {
      return '--'
    }

    const date = new Date(timestamp)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  async function loadSelectedHistoryInstanceDetail(instanceId?: number | string | null) {
    const normalizedInstanceId = String(instanceId || '').trim()
    if (!normalizedInstanceId) {
      selectedHistoryInstanceId.value = null
      selectedHistoryInstanceDetail.value = null
      selectedHistoryInstanceDetailLoading.value = false
      selectedPlanReportSnapshot.value = null
      selectedPlanReportSnapshotLoading.value = false
      return
    }

    selectedHistoryInstanceId.value = normalizedInstanceId
    const cachedDetail = historyInstanceDetailCache.value[normalizedInstanceId]
    if (cachedDetail) {
      selectedHistoryInstanceDetail.value = cachedDetail
      selectedHistoryInstanceDetailLoading.value = false
      const cachedEntityType = String(
        cachedDetail.businessEntityType ??
          (cachedDetail as { entityType?: unknown }).entityType ??
          ''
      )
        .trim()
        .toUpperCase()
      if (cachedEntityType === 'PLAN_REPORT') {
        void loadPlanReportSnapshotById(
          cachedDetail.businessEntityId ?? (cachedDetail as { entityId?: unknown }).entityId
        )
      } else {
        selectedPlanReportSnapshot.value = null
        selectedPlanReportSnapshotLoading.value = false
      }
      return
    }

    selectedHistoryInstanceDetailLoading.value = true
    selectedHistoryInstanceDetail.value = null

    try {
      const response = await getWorkflowInstanceDetail(normalizedInstanceId)
      selectedHistoryInstanceDetail.value = response.success ? (response.data ?? null) : null
      if (response.success && response.data) {
        historyInstanceDetailCache.value = {
          ...historyInstanceDetailCache.value,
          [normalizedInstanceId]: response.data
        }
        const responseEntityType = String(
          response.data.businessEntityType ??
            (response.data as { entityType?: unknown }).entityType ??
            ''
        )
          .trim()
          .toUpperCase()
        if (responseEntityType === 'PLAN_REPORT') {
          void loadPlanReportSnapshotById(
            response.data.businessEntityId ?? (response.data as { entityId?: unknown }).entityId
          )
        } else {
          selectedPlanReportSnapshot.value = null
        }
      }
    } catch (error) {
      selectedHistoryInstanceDetail.value = null
      logger.warn('[ApprovalProgressDrawer] 加载历史审批实例详情失败:', {
        instanceId: normalizedInstanceId,
        error
      })
    } finally {
      selectedHistoryInstanceDetailLoading.value = false
    }
  }

  async function loadPlanReportSnapshotById(reportId?: number | string | null) {
    const normalizedReportId = Number(reportId ?? NaN)
    if (!Number.isFinite(normalizedReportId) || normalizedReportId <= 0) {
      selectedPlanReportSnapshot.value = null
      selectedPlanReportSnapshotLoading.value = false
      return
    }

    selectedPlanReportSnapshot.value = null
    selectedPlanReportSnapshotLoading.value = true
    try {
      const response = await apiClient.get<ApiResponse<PlanReportSnapshotSummary>>(
        `/reports/${normalizedReportId}`
      )

      if (response.code === 200 && response.data) {
        selectedPlanReportSnapshot.value = response.data
        planReportSnapshotCache.value = {
          ...planReportSnapshotCache.value,
          [String(normalizedReportId)]: response.data
        }
        const indicatorIds = (response.data.indicatorDetails || [])
          .map(detail => Number(detail?.indicatorId ?? NaN))
          .filter(indicatorId => Number.isFinite(indicatorId) && indicatorId > 0)
        indicatorIds.forEach(indicatorId => {
          void ensureIndicatorDetailLoaded(indicatorId)
        })
        return
      }

      selectedPlanReportSnapshot.value = null
    } catch (error) {
      selectedPlanReportSnapshot.value = null
      logger.warn('[ApprovalProgressDrawer] 加载审批业务快照失败:', {
        reportId: normalizedReportId,
        error
      })
    } finally {
      selectedPlanReportSnapshotLoading.value = false
    }
  }

  async function prefetchPlanReportSnapshot(reportId?: number | string | null): Promise<void> {
    const normalizedReportId = Number(reportId ?? NaN)
    if (!Number.isFinite(normalizedReportId) || normalizedReportId <= 0) {
      return
    }

    const cacheKey = String(normalizedReportId)
    if (planReportSnapshotCache.value[cacheKey]) {
      return
    }

    try {
      const response = await apiClient.get<ApiResponse<PlanReportSnapshotSummary>>(
        `/reports/${normalizedReportId}`
      )

      if (response.code === 200 && response.data) {
        planReportSnapshotCache.value = {
          ...planReportSnapshotCache.value,
          [cacheKey]: response.data
        }
      }
    } catch (error) {
      logger.warn('[ApprovalProgressDrawer] 预取历史审批摘要失败:', {
        reportId: normalizedReportId,
        error
      })
    }
  }

  async function openPlanApprovalDetails(item?: PlanApprovalDetailItem) {
    if (
      currentPlanApprovalItems.value.length === 0 &&
      historicalPlanApprovalItems.value.length === 0 &&
      !hasPlanWorkflowData.value
    ) {
      ElMessage.warning('当前计划暂无待审批实例')
      return
    }

    planDetailDialogVisible.value = true

    if (item?.instanceId) {
      void loadSelectedHistoryInstanceDetail(item.instanceId)
      return
    }

    selectedHistoryInstanceId.value = null
    selectedHistoryInstanceDetail.value = null
    selectedHistoryInstanceDetailLoading.value = false
    if (props.workflowEntityType === 'PLAN_REPORT' && props.workflowEntityId) {
      void loadPlanReportSnapshotById(props.workflowEntityId)
      return
    }
    selectedPlanReportSnapshot.value = null
    selectedPlanReportSnapshotLoading.value = false
  }

  async function navigateToRouteTarget() {
    if (!normalizedRouteTarget.value) {
      return
    }

    handleClose()
    await router.push(normalizedRouteTarget.value)
  }

  async function navigateToPendingPlanApproval(item: PendingPlanApprovalPreviewItem) {
    if (!item.routeTarget) {
      ElMessage.warning('暂无法定位审批页面')
      return
    }

    handleClose()
    await router.push(item.routeTarget)
  }

  // 处理自定义审批流程事件
  function handleAddNode() {
    // 暂不实现，可后续扩展
  }

  function handleUpdateApprover(_nodeId: string, _approverId: string) {
    // 暂不实现，可后续扩展
  }

  function handleSaveTemplate(_templateName: string, _steps: any[]) {
    // 暂不实现，可后续扩展
  }

  function handleApplyTemplate(_templateId: string) {
    // 暂不实现，可后续扩展
  }

  function normalizeWorkflowAction(action?: string): ApprovalHistoryItem['action'] {
    const normalized = String(action || '')
      .trim()
      .toUpperCase()
    if (normalized.includes('REJECT')) {
      return 'reject'
    }
    if (normalized.includes('WITHDRAW') || normalized.includes('CANCEL')) {
      return 'withdraw'
    }
    if (normalized.includes('START') || normalized.includes('SUBMIT')) {
      return 'submit'
    }
    return 'approve'
  }

  function shouldDisplayWorkflowHistoryItem(item: { action?: string } | null | undefined): boolean {
    const normalized = String(item?.action || '')
      .trim()
      .toUpperCase()
    return !normalized.includes('START')
  }

  const detailDialogStatusTag = computed(() => {
    if (hasPlanWorkflowData.value) {
      return planWorkflowStatusTag.value
    }
    return { label: '审批中', type: 'warning' as const }
  })

  const hasDisplayableApprovalContent = computed(() => {
    if (hasPlanWorkflowData.value) {
      return true
    }
    return hasApprovalData.value
  })

  const hasWorkflowTabContent = computed(() => {
    if (props.showPlanApprovals) {
      return true
    }
    return hasPlanWorkflowData.value || hasApprovalData.value
  })

  const isPlanHistoryOnlyMode = computed(() => {
    return Boolean(
      props.showPlanApprovals && hasPlanWorkflowData.value && isPlanCompletedApproval.value
    )
  })

  const showPlanPendingCard = computed(() => {
    if (isPlanHistoryOnlyMode.value) {
      return false
    }
    return Boolean(currentPlanApprovalSummary.value)
  })

  const showPlanHistoryCard = computed(() => {
    return Boolean(props.showPlanApprovals && historicalPlanApprovalItems.value.length > 0)
  })

  const showHistoryTimeline = computed(() => {
    if (props.showPlanApprovals) {
      return false
    }
    return props.historyViewMode !== 'card-only' && !showPlanHistoryCard.value
  })

  const showCardHistoryEmptyState = computed(() => {
    return props.showPlanApprovals && !showPlanHistoryCard.value
  })

  const showArchivedPlanWorkflowEmptyState = computed(() => {
    return Boolean(
      props.showPlanApprovals &&
      hasPlanWorkflowData.value &&
      (isPlanHistoryOnlyMode.value || workflowNodes.value.length === 0)
    )
  })

  // ============ 监听 ============
  watch(
    () => props.initialPlanWorkflowDetail,
    detail => {
      if (!props.modelValue) {
        return
      }

      if (isRetainableWorkflowDetail(detail)) {
        planWorkflowDetail.value = detail ?? null
        return
      }

      planWorkflowDetail.value = null
      if (props.showPlanApprovals) {
        void loadPlanWorkflowDetail()
        void loadWorkflowDefinitionPreview()
        void loadPlanWorkflowHistoryCards()
      }
    }
  )

  watch(
    () => props.modelValue,
    val => {
      if (val) {
        const retainedDetail = getRetainedWorkflowDetail()
        planWorkflowDetail.value = retainedDetail ?? props.initialPlanWorkflowDetail ?? null
        // 打开时重置到工作流标签页
        activeTab.value = props.showPlanApprovals
          ? isPlanPendingApproval.value
            ? 'pending-plans'
            : 'history'
          : hasWorkflowTabContent.value
            ? 'workflow'
            : 'history'
        cacheSubmitterName(props.plan?.submittedBy, props.plan?.submittedByName)
        cacheSubmitterName(props.plan?.createdBy, props.plan?.createdByName)
        if (!normalizeDisplayName(props.plan?.submittedByName)) {
          void ensureSubmitterNameLoaded(props.plan?.submittedBy, props.plan?.createdByName)
        }
        void loadPendingPlanApprovals()
        void loadPlanWorkflowDetail()
        void loadWorkflowDefinitionPreview()
        void ensureWorkflowRelatedAvatarsLoaded()
        void loadPlanWorkflowHistoryCards()
      } else {
        selectedHistoryInstanceId.value = null
        selectedHistoryInstanceDetail.value = null
        selectedPlanReportSnapshot.value = null
        selectedPlanReportSnapshotLoading.value = false
      }
    }
  )

  watch(
    () => [
      props.showPlanApprovals,
      props.plan?.id,
      props.plan?.workflowInstanceId,
      props.plan?.status,
      props.plan?.workflowStatus,
      props.plan?.canWithdraw,
      props.plan?.currentStepName,
      props.workflowEntityType,
      props.workflowEntityId,
      props.secondaryWorkflowEntityType,
      props.secondaryWorkflowEntityId,
      JSON.stringify(props.plan?.workflowHistory ?? []),
      expectedWorkflowCodes.value.join('|')
    ],
    ([showPlanApprovals, planId]) => {
      if (!showPlanApprovals || !planId) {
        planWorkflowDetail.value = null
        planWorkflowHistoryCards.value = []
        return
      }

      const retainedDetail = getRetainedWorkflowDetail()
      if (retainedDetail) {
        planWorkflowDetail.value = retainedDetail
      }
      void loadPlanWorkflowDetail()
      void loadWorkflowDefinitionPreview()
      void ensureWorkflowRelatedAvatarsLoaded()
      void loadPlanWorkflowHistoryCards()
    },
    { immediate: true }
  )

  watch(
    () => [planWorkflowDetail.value?.flowCode, props.workflowCode],
    () => {
      if (!props.modelValue) {
        return
      }
      void loadWorkflowDefinitionPreview()
    },
    { immediate: true }
  )

  watch(
    () => [
      planWorkflowTasks.value.map(task => task.assigneeId).join('|'),
      (workflowDefinitionPreview.value?.steps || [])
        .flatMap(step => (step.candidateApprovers || []).map(candidate => candidate.userId))
        .join('|')
    ],
    () => {
      if (!props.modelValue) {
        return
      }
      void ensureWorkflowRelatedAvatarsLoaded()
    },
    { immediate: true }
  )

  watch(
    () =>
      (displayedPlanReportSnapshot.value?.indicatorDetails || [])
        .map(detail => Number(detail?.indicatorId ?? NaN))
        .filter(indicatorId => Number.isFinite(indicatorId) && indicatorId > 0)
        .join('|'),
    indicatorIdsKey => {
      if (!props.modelValue || !indicatorIdsKey) {
        return
      }

      const indicatorIds = indicatorIdsKey
        .split('|')
        .map(value => Number(value))
        .filter(indicatorId => Number.isFinite(indicatorId) && indicatorId > 0)

      indicatorIds.forEach(indicatorId => {
        void ensureIndicatorDetailLoaded(indicatorId)
      })
    },
    { immediate: true }
  )

  watch(
    () =>
      displayedBusinessSectionMode.value === 'distribution'
        ? availablePlanIndicators.value
            .map(indicator => Number(indicator.id ?? NaN))
            .filter(indicatorId => Number.isFinite(indicatorId) && indicatorId > 0)
            .join('|')
        : '',
    indicatorIdsKey => {
      if (!props.modelValue || !indicatorIdsKey) {
        return
      }

      const indicatorIds = indicatorIdsKey
        .split('|')
        .map(value => Number(value))
        .filter(indicatorId => Number.isFinite(indicatorId) && indicatorId > 0)

      indicatorIds.forEach(indicatorId => {
        void ensureIndicatorDetailLoaded(indicatorId)
      })
    },
    { immediate: true }
  )

  watch(
    () =>
      historicalPlanApprovalItems.value
        .filter(item => isSubmissionFlow(item.flowCode))
        .map(item => Number(item.entityId ?? NaN))
        .filter(reportId => Number.isFinite(reportId) && reportId > 0)
        .join('|'),
    reportIdsKey => {
      if (!props.modelValue || !reportIdsKey) {
        return
      }

      const reportIds = reportIdsKey
        .split('|')
        .map(value => Number(value))
        .filter(reportId => Number.isFinite(reportId) && reportId > 0)

      reportIds.forEach(reportId => {
        void prefetchPlanReportSnapshot(reportId)
      })
    },
    { immediate: true }
  )

  watch(
    () => [
      props.plan?.submittedBy,
      props.plan?.submittedByName,
      props.plan?.createdBy,
      props.plan?.createdByName
    ],
    ([submittedBy, submittedByName, createdBy, createdByName]) => {
      if (!props.modelValue) {
        return
      }

      cacheSubmitterName(submittedBy, submittedByName)
      cacheSubmitterName(createdBy, createdByName)
      if (!normalizeDisplayName(submittedByName)) {
        void ensureSubmitterNameLoaded(submittedBy, normalizeDisplayName(createdByName))
      }
    },
    { immediate: true }
  )

  watch(
    () => [
      props.modelValue,
      props.showPlanApprovals,
      scopedPendingPlanCount.value,
      isPlanPendingApproval.value,
      hasWorkflowTabContent.value
    ],
    ([isVisible]) => {
      if (!isVisible) {
        return
      }

      const preferredTab = resolvePreferredActiveTab()
      if (
        activeTab.value !== preferredTab &&
        (activeTab.value === 'history' || activeTab.value === 'workflow')
      ) {
        activeTab.value = preferredTab
      }
    }
  )

  const handleApprovalStateRefresh = () => {
    if (!props.modelValue || !props.showPlanApprovals) {
      return
    }

    void loadPendingPlanApprovals()
    void loadPlanWorkflowDetail()
    void loadWorkflowDefinitionPreview()
    void loadPlanWorkflowHistoryCards()
  }

  onMounted(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.addEventListener(APPROVAL_STATE_REFRESH_EVENT, handleApprovalStateRefresh)
  })

  onUnmounted(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.removeEventListener(APPROVAL_STATE_REFRESH_EVENT, handleApprovalStateRefresh)
  })

  return {
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
    ensureSubmitterNameLoaded,
    ensureWorkflowRelatedAvatarsLoaded,
    ensureWorkflowUserAvatarLoaded,
    expectedWorkflowCodes,
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
    scopedDepartmentPlan,
    scopedPendingPlanCount,
    scopedPlanApprovals,
    scopedPlanEntityIds,
    selectedHistoryInstanceDetail,
    selectedHistoryInstanceDetailLoading,
    selectedHistoryInstanceId,
    selectedPlanReportSnapshot,
    selectedPlanReportSnapshotLoading,
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
  }
}
