import { ref, computed } from 'vue'
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
import { PermissionCode, type StrategicIndicator, type Plan } from '@/shared/types'
import type { WorkflowNode, ApprovalHistoryItem } from '@/shared/types'
import { approvalApi } from '@/features/task/api/strategicApi'
import { indicatorFillApi } from '@/features/plan/api/planApi'
import { getUserById, getUsersByOrgId, tryGetUserById } from '@/features/user/api/query'
import { useAuthStore } from '@/features/auth/model/store'
import {
  isDistributionFlow,
  isSubmissionFlow,
  isTerminalHistoryStatus,
  normalizeDisplayName,
  normalizeWorkflowAction,
  normalizeWorkflowCode,
  notifyApprovalStateRefresh,
  parsePositiveUserId,
  resolveApprovalRouteTitle,
  resolveHistoryStatusTag,
  shouldDisplayWorkflowHistoryItem,
  toPositiveNumber
} from '@/features/approval/lib'
import { usePlanStore } from '@/features/plan/model/store'
import type {
  DistributionApprovalProgressDrawerEmit,
  DistributionApprovalProgressDrawerProps,
  PlanReportAttachmentItem,
  PlanApprovalDetailItem,
  PlanReportIndicatorDetailItem,
  PlanReportSnapshotSummary,
  WorkflowHistoryTarget
} from '@/features/approval/model/types'
import { usePermission } from '@/shared/lib/permissions'
import { apiClient } from '@/shared/api'
import { useTimeContextStore } from '@/shared/lib/timeContext'
import { logger } from '@/shared/lib/utils/logger'
import {
  getWorkflowDefinitionPreviewByCode,
  getWorkflowInstanceDetail,
  getWorkflowInstanceDetailByBusiness,
  getWorkflowInstanceHistoryByBusiness
} from '@/features/workflow/api/queries'
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

export function useApprovalProgressState(
  props: DistributionApprovalProgressDrawerProps,
  emit: DistributionApprovalProgressDrawerEmit
) {
  const authStore = useAuthStore()
  const planStore = usePlanStore()
  const timeContext = useTimeContextStore()
  const permissionUtil = usePermission()
  const canLookupWorkflowUsers = computed(() => {
    const roles = currentUserRoleCodes.value
    return roles.includes('STRATEGY_DEPT_HEAD') || roles.includes('VICE_PRESIDENT')
  })
  const INDICATOR_DISPATCH_APPROVE_PERMISSION = 'BTN_INDICATOR_DISPATCH_APPROVE'
  const INDICATOR_REPORT_APPROVE_PERMISSION = 'BTN_INDICATOR_REPORT_APPROVE'
  const currentUserId = computed(() => Number(authStore.user?.userId ?? authStore.user?.id ?? 0))
  const currentUserOrgId = computed(() => Number(authStore.user?.orgId ?? 0))
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
  const relatedPlanReportSummary = ref<PlanReportSnapshotSummary | null>(null)
  const selectedPlanReportSnapshot = ref<PlanReportSnapshotSummary | null>(null)
  const selectedPlanReportSnapshotLoading = ref(false)

  const expectedWorkflowCodes = computed(() => {
    const rawCodes = Array.isArray(props.workflowCode) ? props.workflowCode : [props.workflowCode]
    const normalizedCodes = rawCodes.map(normalizeWorkflowCode).filter(Boolean)
    const shouldIncludeSubmissionWorkflow =
      props.workflowEntityType === 'PLAN_REPORT' ||
      props.secondaryWorkflowEntityType === 'PLAN_REPORT' ||
      Boolean(relatedPlanReportSummary.value?.id)

    if (shouldIncludeSubmissionWorkflow) {
      normalizedCodes.push('PLAN_APPROVAL_COLLEGE')
    }

    return Array.from(new Set(normalizedCodes))
  })

  function matchesExpectedWorkflowCode(workflowCode: unknown): boolean {
    if (expectedWorkflowCodes.value.length === 0) {
      return true
    }

    return expectedWorkflowCodes.value.includes(normalizeWorkflowCode(workflowCode))
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
      logger.warn('[DistributionApprovalProgressDrawer] 用户头像解析失败:', { userId, error })
    }
  }

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

  async function handlePlanReportAttachmentOpen(attachment: {
    name: string
    url: string
  }): Promise<void> {
    try {
      const targetUrl = normalizeDisplayName(attachment.url)
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
      logger.error('[DistributionApprovalProgressDrawer] 打开审批附件失败:', error)
      ElMessage.error('打开附件失败，请稍后重试')
    }
  }

  function getFallbackSubmitterValue(): string {
    const createdBy = normalizeDisplayName(props.plan?.createdBy)
    if (createdBy && !parsePositiveUserId(createdBy)) {
      return createdBy
    }

    return props.departmentName || '当前提交人'
  }

  function isPlaceholderPlanName(value: unknown): boolean {
    const name = normalizeDisplayName(value)
    return /^Plan\s*#?\s*\d+$/i.test(name) || /^计划\s*#?\s*\d+$/i.test(name)
  }

  function resolvePlanDisplayName(value: unknown, fallback: string): string {
    const name = normalizeDisplayName(value)
    return name && !isPlaceholderPlanName(name) ? name : fallback
  }

  function resolvePlanNameFallback(): string {
    return props.departmentName ? `${props.departmentName}计划` : '当前计划'
  }

  function resolveSubmitterDisplayName(...candidates: unknown[]): string {
    const matched = candidates
      .map(candidate => normalizeDisplayName(candidate))
      .find(candidate => candidate && !/^\d+$/.test(candidate))

    return matched || props.departmentName || '待确认'
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
  const planWorkflowDetailLoading = ref(false)
  const workflowDefinitionPreview = ref<WorkflowDefinitionPreviewResponse | null>(null)
  const planWorkflowHistoryCards = ref<WorkflowHistoryCardResponse[]>([])
  const planWorkflowDetailRequestSeq = ref(0)
  const selectedHistoryInstanceId = ref<string | null>(null)
  const selectedHistoryInstanceDetail = ref<WorkflowInstanceDetailResponse | null>(null)
  const selectedHistoryInstanceDetailLoading = ref(false)
  const historyInstanceDetailCache = ref<Record<string, WorkflowInstanceDetailResponse>>({})

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
    const entityIds = new Set<number>()

    const planId = Number(props.plan?.id ?? NaN)
    if (Number.isFinite(planId) && planId > 0) {
      entityIds.add(planId)
    }

    const workflowEntityId = Number(props.workflowEntityId ?? NaN)
    if (Number.isFinite(workflowEntityId) && workflowEntityId > 0) {
      entityIds.add(workflowEntityId)
    }

    const workflowInstanceId = Number(props.plan?.workflowInstanceId ?? NaN)
    if (Number.isFinite(workflowInstanceId) && workflowInstanceId > 0) {
      entityIds.add(workflowInstanceId)
    }

    return entityIds
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

  const relevantDepartmentOrgIds = computed(() => {
    const orgIds = new Set<number>()

    const currentOrgId = toPositiveNumber(currentUserOrgId.value)
    if (currentOrgId) {
      orgIds.add(currentOrgId)
    }

    const rawPlan = props.plan as
      | (Plan & {
          createdByOrgId?: number | string
          sourceOrgId?: number | string
        })
      | null
      | undefined

    const createdByOrgId = toPositiveNumber(rawPlan?.createdByOrgId)
    if (createdByOrgId) {
      orgIds.add(createdByOrgId)
    }

    const sourceOrgId = toPositiveNumber(rawPlan?.sourceOrgId)
    if (sourceOrgId) {
      orgIds.add(sourceOrgId)
    }

    const activeSourceOrgId = toPositiveNumber(activePlanWorkflow.value?.sourceOrgId)
    if (activeSourceOrgId) {
      orgIds.add(activeSourceOrgId)
    }

    return orgIds
  })

  function isDepartmentRelevantApproval(instance: Record<string, any>): boolean {
    if (relevantDepartmentOrgIds.value.size === 0) {
      return false
    }

    const approverOrgId = toPositiveNumber(instance.approverOrgId)
    if (approverOrgId && relevantDepartmentOrgIds.value.has(approverOrgId)) {
      return true
    }

    const sourceOrgId = toPositiveNumber(instance.sourceOrgId)
    if (sourceOrgId && relevantDepartmentOrgIds.value.has(sourceOrgId)) {
      return true
    }

    return false
  }

  const scopedPlanApprovals = computed(() => {
    const matchingApprovals = pendingPlanApprovals.value.filter(instance => {
      const flowCode = (instance as { flowCode?: string }).flowCode
      if (!matchesExpectedWorkflowCode(flowCode)) {
        return false
      }

      const entityId = Number(instance.entityId)
      const matchesEntity =
        Number.isFinite(entityId) && entityId > 0 && scopedPlanEntityIds.value.has(entityId)

      const matchesDepartment = isDepartmentRelevantApproval(instance)

      if (scopedPlanEntityIds.value.size === 0) {
        return matchesDepartment || !props.departmentName
      }

      return matchesEntity || matchesDepartment
    })

    const seenKeys = new Set<string>()
    return matchingApprovals.filter(instance => {
      const key =
        String(
          (instance as { instanceId?: string | number }).instanceId ||
            (instance as { taskId?: string | number }).taskId ||
            (instance as { entityId?: string | number }).entityId ||
            ''
        ).trim() || JSON.stringify(instance)

      if (seenKeys.has(key)) {
        return false
      }
      seenKeys.add(key)
      return true
    })
  })

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
    appendTarget('PLAN_REPORT', relatedPlanReportSummary.value?.id)

    return targets
  })

  function hasPlanReportWorkflowContext(
    summary: PlanReportSnapshotSummary | null | undefined
  ): boolean {
    if (!summary?.id) {
      return false
    }

    const workflowStatus = String(summary.workflowStatus || summary.status || '')
      .trim()
      .toUpperCase()
    const workflowInstanceId = Number(summary.workflowInstanceId ?? NaN)
    const currentTaskId = Number(summary.currentTaskId ?? NaN)
    const currentStepName = normalizeDisplayName(summary.currentStepName)

    return (
      (workflowStatus !== '' &&
        workflowStatus !== 'DRAFT' &&
        workflowStatus !== 'WITHDRAWN' &&
        workflowStatus !== 'CANCELLED') ||
      (Number.isFinite(workflowInstanceId) && workflowInstanceId > 0) ||
      (Number.isFinite(currentTaskId) && currentTaskId > 0) ||
      Boolean(currentStepName)
    )
  }
  const activePlanWorkflow = computed(() => {
    if (!props.plan) {
      return null
    }

    const detail = planWorkflowDetail.value
    const useDetail = detail && matchesExpectedWorkflowCode(detail.flowCode)
    return {
      ...props.plan,
      workflowInstanceId:
        Number((useDetail ? detail.instanceId : undefined) || props.plan.workflowInstanceId || 0) ||
        undefined,
      workflowStatus:
        (useDetail ? detail.status : undefined) || props.plan.workflowStatus || props.plan.status,
      startedAt:
        (useDetail ? detail.startTime : undefined) ||
        props.plan.submittedAt ||
        props.plan.createdAt,
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
        useDetail && Array.isArray(detail?.history) ? detail.history : props.plan.workflowHistory
    }
  })

  const currentDetailWorkflow = computed(
    () => selectedHistoryInstanceDetail.value || planWorkflowDetail.value
  )

  const displayedPlanReportSnapshot = computed<PlanReportSnapshotSummary | null>(() => {
    if (selectedHistoryInstanceId.value) {
      return selectedPlanReportSnapshot.value
    }

    if (hasRelatedPlanReportActiveWorkflow.value && relatedPlanReportSummary.value?.id) {
      return selectedPlanReportSnapshot.value || relatedPlanReportSummary.value
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

  const displayedPlanReportSummaryComment = computed(() => {
    const snapshot = displayedPlanReportSnapshot.value
    if (!snapshot) {
      return ''
    }

    return normalizeDisplayName(snapshot.content) || normalizeDisplayName(snapshot.summary) || ''
  })

  const currentDetailFlowCode = computed(() => {
    return normalizeWorkflowCode(
      currentDetailWorkflow.value?.flowCode ||
        currentDetailWorkflow.value?.definitionId ||
        currentDetailWorkflow.value?.flowName
    )
  })

  const displayedBusinessSectionMode = computed<'report' | 'distribution' | 'generic'>(() => {
    if (selectedHistoryInstanceId.value) {
      if (displayedPlanReportIndicatorItems.value.length > 0) {
        return 'report'
      }

      if (isDistributionFlow(currentDetailFlowCode.value)) {
        return 'distribution'
      }

      return 'generic'
    }

    if (
      displayedPlanReportIndicatorItems.value.length > 0 ||
      hasRelatedPlanReportActiveWorkflow.value
    ) {
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
    if (displayedPlanReportIndicatorItems.value.length > 0) {
      return []
    }

    if (
      !(isDistributionFlow(currentDetailFlowCode.value) || props.approvalType === 'distribution')
    ) {
      return []
    }

    return props.indicators.map((indicator, index) => {
      const type1 = normalizeDisplayName(indicator.type1)
      const type2 = normalizeDisplayName(indicator.type2)
      return {
        indicatorId: Number(indicator.id ?? NaN) || index,
        indicatorName: normalizeDisplayName(indicator.name) || `指标${index + 1}`,
        indicatorType: [type1, type2].filter(Boolean).join(' / ') || '--',
        responsibleDept:
          normalizeDisplayName(indicator.responsibleDept) ||
          normalizeDisplayName(indicator.ownerDept) ||
          '--',
        currentProgress: Number.isFinite(Number(indicator.progress))
          ? `${Number(indicator.progress)}%`
          : '--',
        submittedProgress: '--',
        submittedComment: '',
        targetValue: formatIndicatorMetricValue(indicator.targetValue),
        actualValue: formatIndicatorMetricValue(indicator.actualValue),
        unit: normalizeDisplayName(indicator.unit) || '--',
        attachments: []
      }
    })
  })

  const displayedPlanReportIndicatorItems = computed(() => {
    const snapshot = displayedPlanReportSnapshot.value
    const indicatorDetails = Array.isArray(snapshot?.indicatorDetails)
      ? snapshot.indicatorDetails
      : []

    return indicatorDetails.map((detail: PlanReportIndicatorDetailItem, index: number) => {
      const indicatorId = Number(detail?.indicatorId ?? NaN)
      const matchedIndicator = props.indicators.find(
        indicator => Number(indicator.id) === indicatorId
      )
      const indicatorName =
        normalizeDisplayName(matchedIndicator?.name) ||
        `指标${Number.isFinite(indicatorId) ? ` #${indicatorId}` : index + 1}`
      const type1 = normalizeDisplayName(matchedIndicator?.type1)
      const type2 = normalizeDisplayName(matchedIndicator?.type2)

      return {
        indicatorId: Number.isFinite(indicatorId) ? indicatorId : null,
        indicatorName,
        indicatorType: [type1, type2].filter(Boolean).join(' / ') || '--',
        responsibleDept:
          normalizeDisplayName(matchedIndicator?.responsibleDept) ||
          normalizeDisplayName(matchedIndicator?.ownerDept) ||
          '--',
        currentProgress: Number.isFinite(Number(matchedIndicator?.progress))
          ? `${Number(matchedIndicator?.progress)}%`
          : '--',
        submittedProgress: Number.isFinite(Number(detail?.progress))
          ? `${Number(detail?.progress)}%`
          : '--',
        submittedComment: normalizeDisplayName(detail?.comment) || '--',
        targetValue: formatIndicatorMetricValue(matchedIndicator?.targetValue),
        actualValue: formatIndicatorMetricValue(matchedIndicator?.actualValue),
        unit: normalizeDisplayName(matchedIndicator?.unit) || '--',
        attachments: toDisplayAttachmentItems(detail?.attachments)
      }
    })
  })

  const hasPlanWorkflowData = computed(() => {
    const workflowInstanceId = Number(planWorkflowDetail.value?.instanceId ?? NaN)
    if (Number.isFinite(workflowInstanceId) && workflowInstanceId > 0) {
      return true
    }

    if (planWorkflowTasks.value.length > 0) {
      return true
    }

    if (planWorkflowHistory.value.length > 0 || planWorkflowHistoryCards.value.length > 0) {
      return true
    }

    return Boolean(
      normalizeDisplayName(planWorkflowDetail.value?.currentStepName) ||
      normalizeDisplayName(planWorkflowDetail.value?.flowCode) ||
      normalizeDisplayName(planWorkflowDetail.value?.status)
    )
  })

  const hasRelatedPlanReportActiveWorkflow = computed(() => {
    if (!hasPlanReportWorkflowContext(relatedPlanReportSummary.value)) {
      return false
    }

    const workflowStatus = String(
      relatedPlanReportSummary.value?.workflowStatus || relatedPlanReportSummary.value?.status || ''
    )
      .trim()
      .toUpperCase()

    return ['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(workflowStatus)
  })

  const relatedPlanReportStepDisplay = computed(() => {
    const workflowStatus = String(
      relatedPlanReportSummary.value?.workflowStatus || relatedPlanReportSummary.value?.status || ''
    )
      .trim()
      .toUpperCase()
    const currentStepName = normalizeDisplayName(relatedPlanReportSummary.value?.currentStepName)

    if (['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(workflowStatus)) {
      return currentStepName || '审批中'
    }
    if (workflowStatus === 'APPROVED') {
      return '已通过'
    }
    if (workflowStatus === 'REJECTED' || workflowStatus === 'RETURNED') {
      return '已驳回'
    }
    if (workflowStatus === 'WITHDRAWN' || workflowStatus === 'CANCELLED') {
      return '已撤回'
    }

    return currentStepName || workflowStatus || '审批中'
  })

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
      ? [PermissionCode.BTN_STRATEGY_TASK_DISPATCH_APPROVE, INDICATOR_DISPATCH_APPROVE_PERMISSION]
      : [PermissionCode.BTN_STRATEGY_TASK_REPORT_APPROVE, INDICATOR_REPORT_APPROVE_PERMISSION]
  })

  const requiredPlanApprovalPermissionCode = computed(() => {
    return requiredPlanApprovalPermissionCodes.value[0]
  })

  const hasPlanApprovalPermission = computed(() => {
    if (!hasPlanWorkflowData.value || !isPlanPendingApproval.value) {
      return false
    }

    const expectedApproverRoleCodes = resolveExpectedApproverRoleCodes()
    if (expectedApproverRoleCodes.length > 0) {
      const hasExpectedRole = expectedApproverRoleCodes.some(roleCode =>
        currentUserRoleCodes.value.includes(roleCode)
      )
      if (!hasExpectedRole) {
        return false
      }
    }

    const expectedApproverOrgId = resolveExpectedApproverOrgId()
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
    const currentTaskId = String(activePlanWorkflow.value?.currentTaskId || '').trim()
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

  const canCurrentUserHandlePlanApproval = computed(() => {
    if (
      !hasPlanWorkflowData.value ||
      !isPlanPendingApproval.value ||
      !hasPlanApprovalPermission.value
    ) {
      return false
    }

    const expectedApproverRoleCodes = resolveExpectedApproverRoleCodes()
    if (expectedApproverRoleCodes.length > 0) {
      const hasExpectedRole = expectedApproverRoleCodes.some(roleCode =>
        currentUserRoleCodes.value.includes(roleCode)
      )
      if (!hasExpectedRole) {
        return false
      }
    }

    const expectedApproverOrgId = resolveExpectedApproverOrgId()
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

    // 必须按任务创建的先后顺序（taskId 或时间）排序，而不是 stepNo。
    // 因为流程可能回退到前面的步骤（如撤回/驳回），此时最新的节点 stepNo 可能更小。
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

  const resolveTaskStatusTag = (
    task: WorkflowTaskResponse
  ): { label: string; type: 'success' | 'warning' | 'danger' | 'info' } => {
    const normalizedStatus = String(task.status || '')
      .trim()
      .toUpperCase()

    if (normalizedStatus === 'WITHDRAWN') {
      return { label: '已撤回', type: 'info' }
    }
    if (normalizedStatus === 'REJECTED') {
      return { label: '已驳回', type: 'danger' }
    }
    if (normalizedStatus === 'COMPLETED') {
      return { label: '已通过', type: 'success' }
    }
    if (normalizedStatus === 'WAITING') {
      return { label: '等待中', type: 'info' }
    }
    if (normalizedStatus === 'PENDING') {
      if (
        isPlanWorkflowTerminated.value &&
        String(task.taskId || '') !== String(currentPlanTaskId.value || '')
      ) {
        return { label: '等待中', type: 'info' }
      }
      return { label: '审批中', type: 'warning' }
    }

    return { label: normalizedStatus || '未知', type: 'info' }
  }

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

    if (normalizedPlanBusinessStatus.value === 'DRAFT') {
      const allTaskStatuses = new Set(
        planWorkflowTasks.value.map(task =>
          String(task.status || '')
            .trim()
            .toUpperCase()
        )
      )
      if (allTaskStatuses.has('WITHDRAWN')) {
        return { label: '已撤回', type: 'info' as const }
      }
      if (allTaskStatuses.has('REJECTED')) {
        return { label: '已驳回', type: 'danger' as const }
      }
      return { label: '草稿', type: 'info' as const }
    }

    return { label: rawStatus || '未发起', type: 'info' as const }
  })

  const planWorkflowHistory = computed<ApprovalHistoryItem[]>(() => {
    const workflowHistorySource = Array.isArray(planWorkflowDetail.value?.history)
      ? planWorkflowDetail.value.history
      : activePlanWorkflow.value?.workflowHistory

    if (!Array.isArray(workflowHistorySource)) {
      return []
    }

    return workflowHistorySource.filter(shouldDisplayWorkflowHistoryItem).map((item, index) => ({
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

    // 同理，取最新任务时应遵循时间轴/ID顺序
    return [...planWorkflowDetail.value.tasks].sort((left, right) => {
      const leftId = Number(left.taskId ?? 0)
      const rightId = Number(right.taskId ?? 0)
      if (leftId !== rightId) {
        return leftId - rightId
      }
      const leftTime = new Date(left.createdTime || 0).getTime()
      const rightTime = new Date(right.createdTime || 0).getTime()
      return leftTime - rightTime
    })
  })

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
          logger.warn('[DistributionApprovalProgressDrawer] 加载节点组织候选审批人失败:', {
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

    const runtimeAssigneeId =
      parsePositiveUserId(task.assigneeId) ||
      parsePositiveUserId(activePlanWorkflow.value?.currentApproverId)
    const runtimeAssigneeName =
      normalizeDisplayName(task.assigneeName) ||
      normalizeDisplayName(activePlanWorkflow.value?.currentApproverName) ||
      (() => {
        const approverOrgName = normalizeDisplayName(task.approverOrgName)
        if (!approverOrgName) {
          return ''
        }
        const stepName =
          normalizeDisplayName(task.currentStepName) || normalizeDisplayName(task.taskName) || ''
        if (stepName.includes('分管校领导') || stepName.includes('院长')) {
          return `${approverOrgName}分管校领导`
        }
        return `${approverOrgName}审批人`
      })()

    const resolvedOperatorName = resolveWorkflowTaskOperatorName(task)
    const shouldMarkApprovedCandidate = isWorkflowTaskApproved(task)
    const shouldMarkRejectedCandidate = isWorkflowTaskRejected(task)
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

    const hasRuntimeApprover = Boolean(runtimeAssigneeName || runtimeAssigneeId)
    const previewCandidates = matchedStep?.candidateApprovers
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
    const isCurrentTask = String(task.taskId || '') === String(currentPlanTaskId.value || '')

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
    if (isCurrentTask) {
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

  function resolveTaskStatusLabel(task: WorkflowTaskResponse): string {
    return resolveTaskStatusTag(task).label
  }

  const latestPlanTaskDisplayLabel = computed(() => {
    return latestPlanTask.value ? resolveTaskStatusLabel(latestPlanTask.value) : ''
  })

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
    if (hasRelatedPlanReportActiveWorkflow.value && relatedPlanReportSummary.value?.id) {
      return [
        {
          instanceId: Number(relatedPlanReportSummary.value.workflowInstanceId ?? 0) || 0,
          instanceNo: String(
            relatedPlanReportSummary.value.workflowInstanceId ||
              relatedPlanReportSummary.value.id ||
              '待回填'
          ),
          title: `${props.departmentName || '当前部门'}上报审批`,
          routeTitle: `上报审批 · ${props.departmentName || '当前部门'} -> ${normalizeDisplayName(props.plan?.createdByOrgName) || '上级部门'}`,
          flowCode: 'PLAN_APPROVAL_COLLEGE',
          submitterName: props.departmentName || '当前部门',
          currentStepName: relatedPlanReportStepDisplay.value,
          createdAt: undefined,
          entityId: relatedPlanReportSummary.value.id,
          planName: resolvePlanDisplayName(props.planName, resolvePlanNameFallback())
        }
      ]
    }

    if (hasPlanWorkflowData.value && props.plan) {
      const fallbackPlanName = resolvePlanDisplayName(props.planName, resolvePlanNameFallback())
      const planName = resolvePlanDisplayName(activePlanWorkflow.value?.name, fallbackPlanName)

      return [
        {
          instanceId: currentPlanInstanceId.value,
          instanceNo: String(currentPlanInstanceId.value || '待回填'),
          title: planName,
          submitterName: planSubmitterName.value,
          currentStepName: String(currentPlanStepDisplay.value),
          createdAt:
            activePlanWorkflow.value?.startedAt ||
            activePlanWorkflow.value?.submittedAt ||
            activePlanWorkflow.value?.createdAt,
          entityId:
            activePlanWorkflow.value?.businessEntityId ||
            props.workflowEntityId ||
            activePlanWorkflow.value?.id,
          planName
        }
      ]
    }

    const fallbackPlanName = resolvePlanDisplayName(props.planName, resolvePlanNameFallback())

    return scopedPlanApprovals.value.map((instance, index) => ({
      instanceId: Number(instance.instanceId) || index,
      instanceNo:
        String(
          instance.instanceNo || instance.flowInstanceNo || instance.processInstanceNo || ''
        ).trim() || `审批实例 ${index + 1}`,
      title: resolvePlanDisplayName(
        instance.entityTitle || instance.planName || instance.title || instance.entityName || '',
        `${fallbackPlanName} - 审批实例 ${index + 1}`
      ),
      submitterName: resolveSubmitterDisplayName(
        instance.submitterName,
        instance.applicantName,
        instance.submitter,
        instance.sourceOrgName,
        instance.targetOrgName
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

  const historicalPlanApprovalItems = computed<PlanApprovalDetailItem[]>(() => {
    return planWorkflowHistoryCards.value
      .filter(
        item =>
          matchesExpectedWorkflowCode(item.flowCode) &&
          (isTerminalHistoryStatus(item.status) || Boolean(item.completedAt))
      )
      .map((item, index) => {
        const statusTag = resolveHistoryStatusTag(item.status)
        return {
          instanceId: Number(item.instanceId) || index,
          instanceNo: String(item.instanceNo || item.instanceId || `审批实例 ${index + 1}`),
          title: resolvePlanDisplayName(
            item.planName,
            item.entityId ? `审批实例 ${item.entityId}` : '审批实例'
          ),
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
    if (hasRelatedPlanReportActiveWorkflow.value && relatedPlanReportSummary.value?.id) {
      return {
        key: `plan-report-${relatedPlanReportSummary.value.id}`,
        planName: `${props.departmentName || '当前部门'}上报审批`,
        currentStepName: relatedPlanReportStepDisplay.value,
        submitterName: props.departmentName || '当前部门',
        createdAt: undefined,
        count: 1
      }
    }

    if (hasPlanWorkflowData.value && props.plan) {
      const fallbackPlanName = resolvePlanDisplayName(props.planName, resolvePlanNameFallback())
      const planName = resolvePlanDisplayName(activePlanWorkflow.value?.name, fallbackPlanName)

      return {
        key: planName,
        planName,
        currentStepName: currentPlanStepDisplay.value,
        submitterName: planSubmitterName.value,
        createdAt:
          activePlanWorkflow.value?.startedAt ||
          activePlanWorkflow.value?.submittedAt ||
          activePlanWorkflow.value?.createdAt,
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
    const planName = resolvePlanDisplayName(props.planName, resolvePlanNameFallback())

    return {
      key: planName,
      planName,
      currentStepName:
        scopedPlanApprovals.value
          .map(item => item.currentStepName)
          .find(step => typeof step === 'string' && step.trim()) ||
        latestPlanTaskDisplayLabel.value ||
        '审批中',
      submitterName:
        scopedPlanApprovals.value
          .map(item =>
            resolveSubmitterDisplayName(
              item.submitterName,
              item.applicantName,
              item.submitter,
              item.sourceOrgName,
              item.targetOrgName
            )
          )
          .find(name => typeof name === 'string' && name.trim()) || '待确认',
      createdAt: latestCreatedAt,
      count: scopedPlanApprovals.value.length
    }
  })

  // ============ 审批流程节点数据 ============
  const workflowNodes = computed<WorkflowNode[]>(() => {
    if (isPlanHistoryOnlyMode.value) {
      return []
    }

    if (hasPlanWorkflowData.value && props.plan) {
      if (planWorkflowTasks.value.length === 0) {
        return []
      }

      return planWorkflowTasks.value.map(task => ({
        id: String(task.taskId || task.taskKey || task.currentStepName || task.taskName),
        name:
          normalizeDisplayName(task.currentStepName) ||
          normalizeDisplayName(task.taskName) ||
          '审批节点',
        status: mapWorkflowTaskStatusToNodeStatus(task),
        operatorName: resolveWorkflowTaskOperatorName(task),
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
          typeof task.comment === 'string' && task.comment.trim()
            ? task.comment
            : String(task.taskId || '') === String(currentPlanTaskId.value || '') &&
                activePlanWorkflow.value?.canWithdraw
              ? '当前仍可撤回'
              : undefined
      }))
    }

    if (props.showPlanApprovals) {
      return []
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
      if (planWorkflowHistory.value.length > 0) {
        return planWorkflowHistory.value
      }

      if (historicalPlanApprovalItems.value.length > 0) {
        return historicalPlanApprovalItems.value.map((item, index) => ({
          id: `history-card-${item.instanceId}-${index}`,
          action: item.statusLabel || '已完成',
          operator: String(item.instanceId || index),
          operatorName: item.submitterName || '系统',
          operatorAvatar: undefined,
          operateTime: new Date(item.completedAt || item.createdAt || Date.now()),
          stepName: item.routeTitle || item.title,
          comment: item.flowName || item.currentStepName
        }))
      }

      return []
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

    notifyApprovalStateRefresh({ source: 'distribution-approval-progress-drawer' })
  }

  async function loadPendingPlanApprovals() {
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

  async function loadRelatedPlanReportSummary() {
    if (!props.showPlanApprovals || !props.plan) {
      relatedPlanReportSummary.value = null
      return
    }

    const planId = Number(props.plan.id ?? NaN)
    const reportOrgId = Number(
      (
        props.plan as Plan & {
          targetOrgId?: number | string
          orgId?: number | string
          target_org_id?: number | string
        }
      ).targetOrgId ??
        (
          props.plan as Plan & {
            orgId?: number | string
            target_org_id?: number | string
          }
        ).target_org_id ??
        props.plan.orgId ??
        NaN
    )

    if (
      !Number.isFinite(planId) ||
      planId <= 0 ||
      !Number.isFinite(reportOrgId) ||
      reportOrgId <= 0
    ) {
      relatedPlanReportSummary.value = null
      return
    }

    try {
      const { currentReport, latestReport } =
        await indicatorFillApi.getCurrentMonthPlanReportSummaries(planId, reportOrgId)

      if (hasPlanReportWorkflowContext(currentReport)) {
        relatedPlanReportSummary.value = currentReport
        return
      }

      if (hasPlanReportWorkflowContext(latestReport)) {
        relatedPlanReportSummary.value = latestReport
        return
      }

      relatedPlanReportSummary.value = latestReport || currentReport || null
    } catch (error) {
      relatedPlanReportSummary.value = null
      logger.warn('[DistributionApprovalProgressDrawer] 加载关联上报审批摘要失败:', error)
    }
  }

  async function loadPlanWorkflowDetail() {
    if (!props.showPlanApprovals || !props.plan) {
      planWorkflowDetail.value = null
      return
    }

    const requestSeq = ++planWorkflowDetailRequestSeq.value

    try {
      if (hasRelatedPlanReportActiveWorkflow.value && relatedPlanReportSummary.value?.id) {
        const response = await getWorkflowInstanceDetailByBusiness(
          'PLAN_REPORT',
          Number(relatedPlanReportSummary.value.id)
        )
        if (
          requestSeq === planWorkflowDetailRequestSeq.value &&
          response.success &&
          response.data &&
          matchesExpectedWorkflowCode(response.data.flowCode)
        ) {
          planWorkflowDetail.value = response.data
          return
        }
      }

      const businessEntityType = props.workflowEntityType || 'PLAN'
      const businessEntityId = Number(props.workflowEntityId ?? props.plan.id ?? 0)
      if (Number.isFinite(businessEntityId) && businessEntityId > 0) {
        const response = await getWorkflowInstanceDetailByBusiness(
          businessEntityType,
          businessEntityId
        )
        if (
          requestSeq === planWorkflowDetailRequestSeq.value &&
          response.success &&
          response.data &&
          matchesExpectedWorkflowCode(response.data.flowCode)
        ) {
          planWorkflowDetail.value = response.data
          return
        }
      }

      const workflowInstanceId = Number(props.plan.workflowInstanceId ?? 0)
      if (Number.isFinite(workflowInstanceId) && workflowInstanceId > 0) {
        const response = await getWorkflowInstanceDetail(String(workflowInstanceId))
        if (
          requestSeq === planWorkflowDetailRequestSeq.value &&
          response.success &&
          response.data &&
          matchesExpectedWorkflowCode(response.data.flowCode)
        ) {
          planWorkflowDetail.value = response.data
          return
        }
      }

      if (requestSeq === planWorkflowDetailRequestSeq.value) {
        planWorkflowDetail.value = null
      }
    } catch (error) {
      if (requestSeq === planWorkflowDetailRequestSeq.value) {
        planWorkflowDetail.value = null
      }
      logger.warn('[ApprovalProgressDrawer] 加载计划工作流详情失败:', error)
    }
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
      logger.warn('[DistributionApprovalProgressDrawer] 加载流程定义预览失败:', {
        flowCode,
        error
      })
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
          emit('refresh', {
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
        emit('refresh', {
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
          emit('refresh', {
            status: 'DRAFT',
            workflowStatus: 'REJECTED',
            canWithdraw: false,
            currentTaskId: null,
            currentStepName: '已驳回'
          })
          await refreshPlanApprovalAfterMutation()
          ElMessage.success('审批已驳回')
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
        emit('refresh', {
          status: 'DRAFT',
          workflowStatus: 'REJECTED',
          canWithdraw: false,
          currentTaskId: null,
          currentStepName: '已驳回'
        })
        await refreshPlanApprovalAfterMutation()
        ElMessage.success(`已一键驳回 ${scopedPlanApprovals.value.length} 条审批实例`)
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
      return
    }

    selectedHistoryInstanceId.value = normalizedInstanceId
    const cachedDetail = historyInstanceDetailCache.value[normalizedInstanceId]
    if (cachedDetail) {
      selectedHistoryInstanceDetail.value = cachedDetail
      selectedHistoryInstanceDetailLoading.value = false
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

  const detailDialogStatusTag = computed(() => {
    if (hasPlanWorkflowData.value) {
      return planWorkflowStatusTag.value
    }
    return { label: '审批中', type: 'warning' as const }
  })

  const hasDisplayableApprovalContent = computed(() => {
    if (props.showPlanApprovals) {
      return (
        currentPlanApprovalItems.value.length > 0 ||
        historicalPlanApprovalItems.value.length > 0 ||
        hasPlanWorkflowData.value
      )
    }

    if (hasPlanWorkflowData.value) {
      return true
    }
    return hasApprovalData.value
  })

  const hasWorkflowTabContent = computed(() => {
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
    if (planWorkflowDetailLoading.value && scopedPlanApprovals.value.length === 0) {
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

  return {
    INDICATOR_DISPATCH_APPROVE_PERMISSION,
    INDICATOR_REPORT_APPROVE_PERMISSION,
    activePlanWorkflow,
    activeTab,
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
    ensureWorkflowTaskScopedCandidatesLoaded,
    expectedWorkflowCodes,
    displayedPlanReportIndicatorItems,
    displayedDistributionIndicatorItems,
    displayedBusinessAttachmentLabel,
    displayedBusinessCommentLabel,
    displayedBusinessEmptyAttachmentText,
    displayedBusinessEmptyCommentText,
    displayedBusinessProgressLabel,
    displayedBusinessSectionSubtitle,
    displayedBusinessSectionTitle,
    displayedPlanReportSnapshot,
    displayedPlanReportSummaryComment,
    formatIndicatorMetricValue,
    getFallbackSubmitterValue,
    getFunctionalStatus,
    getStrategicStatus,
    handlePlanReportAttachmentOpen,
    handleAddNode,
    handleApplyTemplate,
    handleClose,
    handleSaveTemplate,
    handleUpdateApprover,
    hasApprovalData,
    hasDisplayableApprovalContent,
    hasPlanApprovalPermission,
    hasRelatedPlanReportActiveWorkflow,
    hasPlanWorkflowData,
    hasWorkflowTabContent,
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
    mapWorkflowTaskStatusToNodeStatus,
    matchesExpectedWorkflowCode,
    normalizeDisplayName,
    normalizeStepMatchKey,
    normalizeWorkflowAction,
    normalizeWorkflowCode,
    normalizedPlanBusinessStatus,
    parsePositiveUserId,
    pendingCount,
    pendingPlanApprovals,
    permissionUtil,
    planApprovalsLoading,
    planDetailDialogVisible,
    planDetailContentLoading,
    planStore,
    planSubmitterName,
    planWorkflowDetail,
    planWorkflowDetailLoading,
    planWorkflowDetailRequestSeq,
    planWorkflowHistory,
    planWorkflowHistoryCards,
    planWorkflowStatus,
    planWorkflowStatusTag,
    planWorkflowTasks,
    rejectedCount,
    rejectionReason,
    relevantDepartmentOrgIds,
    relatedPlanReportSummary,
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
    toPositiveNumber,
    hasPlanReportWorkflowContext,
    workflowDefinitionPreview,
    workflowNodes,
    workflowOrgRoleCandidateCache,
    workflowUserAvatarCache
  }
}

export type ApprovalProgressState = ReturnType<typeof useApprovalProgressState>
