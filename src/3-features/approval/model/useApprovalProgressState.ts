import { ref, computed, watch } from 'vue'
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
  resolveApprovalRoute,
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
  const router = useRouter()
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
  const planReportProgressDrafts = ref<Record<string, number>>({})
  const savingPlanReportProgressKey = ref<string | null>(null)

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

  function resolvePlanApprovalDisplayName(fallback: string): string {
    if (props.approvalType === 'submission') {
      const departmentName =
        normalizeDisplayName(props.departmentName) ||
        normalizeDisplayName(planWorkflowDetail.value?.targetOrgName) ||
        normalizeDisplayName(activePlanWorkflow.value?.targetOrgName) ||
        normalizeDisplayName(props.plan?.targetOrgName) ||
        normalizeDisplayName(props.plan?.orgName) ||
        '当前部门'

      // 2026-10-07 标题按真实流程类型与方向取词（2026-09-27 拍板口径）：
      // 下发=上级 -> 部门，上报=部门 -> 上级，异动=上级 -> 部门，起止部门必须写清；
      // flowCode 未知时保守回退旧格式，不猜方向。
      const flowCode = normalizeWorkflowCode(
        planWorkflowDetail.value?.flowCode ||
          (activePlanWorkflow.value as { flowCode?: unknown } | null)?.flowCode ||
          (Array.isArray(props.workflowCode) ? props.workflowCode[0] : props.workflowCode)
      )
      if (!flowCode) {
        return `${departmentName}上报审批`
      }

      return resolveApprovalRouteTitle({
        flowCode,
        sourceOrgName:
          normalizeDisplayName(planWorkflowDetail.value?.sourceOrgName) ||
          normalizeDisplayName(props.plan?.createdByOrgName),
        targetOrgName: departmentName
      })
    }

    return resolvePlanDisplayName(activePlanWorkflow.value?.name, fallback)
  }

  function resolveSubmitterDisplayName(...candidates: unknown[]): string {
    const PLACEHOLDER_PATTERNS = /^(待确认|未知|当前提交人|\d+|用户#\d+|user#\d+)$/i
    const matched = candidates
      .map(candidate => normalizeDisplayName(candidate))
      .find(candidate => candidate && !PLACEHOLDER_PATTERNS.test(candidate))

    return matched || getFallbackSubmitterValue()
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

  /** 月报（PLAN_REPORT）待办：与计划审批并列的独立业务实例，不参与计划汇总卡。 */
  function isExternalWorkflowTodo(instance: Record<string, any>): boolean {
    const entityType = String(instance.entityType ?? instance.businessEntityType ?? '')
      .trim()
      .toUpperCase()
    return entityType === 'PLAN_REPORT'
  }

  /**
   * 异动审批实例（INDICATOR / TASK，flowCode=PLAN_MUTATION_STRATEGY）。
   * 与月报同理，属于独立业务实例：各自成卡，不参与计划汇总卡生成与计数。
   */
  function isMutationWorkflowInstance(instance: Record<string, any>): boolean {
    if (normalizeWorkflowCode(instance.flowCode) === 'PLAN_MUTATION_STRATEGY') {
      return true
    }
    const entityType = String(instance.entityType ?? instance.businessEntityType ?? '')
      .trim()
      .toUpperCase()
    return entityType === 'INDICATOR' || entityType === 'TASK'
  }

  const scopedPlanApprovals = computed(() => {
    // 2026-10-21 二次修正（用户定案）：异动实例不再并入计划集合。
    // 异动与「上报审批」同类，是独立业务实例，必须各自成卡；
    // 混进计划集合会让 currentPlanApprovalSummary 误判「有计划审批中」，
    // 同一条异动被渲染成两张卡（异动卡 + 计划汇总卡），且汇总卡缺提交人/提交时间。
    // 异动卡统一由 pendingMutationApprovalItems 渲染。
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

  /**
   * 计划汇总卡 / 一键审批只针对计划（PLAN）实例。
   * 与「上报审批」既有规律对齐：月报、指标异动、任务异动都是独立业务实例，
   * 各自成卡，不参与计划汇总卡的生成与计数。
   */
  const planScopedPlanApprovals = computed(() =>
    scopedPlanApprovals.value.filter(
      instance => !isExternalWorkflowTodo(instance) && !isMutationWorkflowInstance(instance)
    )
  )

  /**
   * 2026-10-23 修复（上报审批卡片不显示）：月报待办（PLAN_REPORT）的独立卡片集合。
   *
   * 背景：`planScopedPlanApprovals` 把月报排除在计划汇总卡之外（正确——月报是独立业务实例），
   * 但此前**没有任何地方渲染它**，导致：战略部终审人在「计算机学院」视图下，
   * 页面顶部显示「待战略发展部终审人审批」，审批中心「计划审批」tab 却是空的
   * （my-tasks 里明明有这条待办）。现在把月报待办单独成卡（与异动卡同构）。
   */
  const pendingReportApprovalItems = computed<Record<string, any>[]>(() =>
    pendingPlanApprovals.value.filter(instance => isExternalWorkflowTodo(instance))
  )

  // 2026-10-24 用户定案：同一上下文可能同时存在多条进行中的上报实例
  // （本部门上报 + 下级部门上报）。「审批流程」页签顶部做选择栏，
  // 点选哪条实例就展开渲染哪条的流程；默认选第一条。
  const selectedReportInstanceIdx = ref(0)
  const reportWorkflowInstances = computed(() => pendingReportApprovalItems.value)
  const selectedReportInstance = computed(() => {
    const items = reportWorkflowInstances.value
    if (items.length === 0) {
      return null
    }
    return items[Math.min(selectedReportInstanceIdx.value, items.length - 1)] || items[0]
  })
  const reportWorkflowDetail = ref<WorkflowInstanceDetailResponse | null>(null)
  const reportWorkflowDetailLoading = ref(false)
  watch(
    () =>
      String(
        selectedReportInstance.value?.instanceId ??
          selectedReportInstance.value?.workflowInstanceId ??
          ''
      ),
    async instanceKey => {
      if (!instanceKey) {
        reportWorkflowDetail.value = null
        return
      }
      reportWorkflowDetailLoading.value = true
      try {
        const response = await getWorkflowInstanceDetail(instanceKey)
        reportWorkflowDetail.value = response?.success && response.data ? response.data : null
      } catch (error) {
        logger.warn('[ApprovalProgress] 加载上报实例流程详情失败:', error)
        reportWorkflowDetail.value = null
      } finally {
        reportWorkflowDetailLoading.value = false
      }
    },
    { immediate: true }
  )

  interface PendingPlanApprovalPreviewItem {
    key: string
    title: string
    routeDisplay: string
    routeTarget: string
  }

  function normalizeWorkflowEntityType(
    value: unknown
  ): 'PLAN' | 'PLAN_REPORT' | 'INDICATOR' | 'TASK' | undefined {
    const normalized = String(value || '')
      .trim()
      .toUpperCase()
    if (normalized === 'PLAN_REPORT') {
      return 'PLAN_REPORT'
    }
    if (normalized === 'PLAN') {
      return 'PLAN'
    }
    // 异动审批（PLAN_MUTATION_STRATEGY）挂在指标实体上
    if (normalized === 'INDICATOR') {
      return 'INDICATOR'
    }
    // 2026-10-21：战略任务改名异动同样走 PLAN_MUTATION_STRATEGY，实体类型为 TASK
    if (normalized === 'TASK') {
      return 'TASK'
    }
    return undefined
  }

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
      const entityId = toPositiveNumber(instance.entityId ?? instance.businessEntityId) ?? undefined
      const approvalInstanceId = toPositiveNumber(instance.instanceId) ?? undefined
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

  /**
   * 2026-10-21：审批中的异动实例卡片（「计划审批」看板）。
   * 此前看板数据源是 my-pending（我是审批人），异动发起人看不到自己发起的异动。
   * 复用历史卡片的 PlanApprovalDetailItem 结构，保证两处卡片样式与字段一致；
   * 同一次「发起异动」提交的多条改动（同一 batch_id）聚合成一张卡片。
   */
  const pendingMutationApprovalItems = computed<PlanApprovalDetailItem[]>(() => {
    const groups = new Map<string, Record<string, any>[]>()
    for (const item of props.mutationPendingApprovals ?? []) {
      if (String(item.status || '').toUpperCase() !== 'IN_REVIEW') {
        continue
      }
      // 无批次号的历史实例按实例独立成卡，避免误聚合
      const groupKey = normalizeDisplayName(item.batchId) || `instance-${item.instanceId}`
      const list = groups.get(groupKey) ?? []
      list.push(item)
      groups.set(groupKey, list)
    }

    return Array.from(groups.entries()).map(([_groupKey, items], index) => {
      const first = items[0]
      const statusTag = resolveHistoryStatusTag('IN_REVIEW')
      const sourceOrgName = normalizeDisplayName(first.sourceOrgName)
      const targetOrgName = normalizeDisplayName(first.targetOrgName)
      const flowCode = normalizeDisplayName(first.flowCode) || 'PLAN_MUTATION_STRATEGY'

      // 聚合本批次全部字段变更：字段名 → before/after（多实体同名字段按指标名区分）
      const changedFields: Record<string, { before?: unknown; after?: unknown }> = {}
      for (const entry of items) {
        const fields = entry.changedFields
        if (!fields || typeof fields !== 'object') {
          continue
        }
        for (const [key, value] of Object.entries(fields as Record<string, any>)) {
          // 多实体时用「指标名 · 字段」区分；单实体直接用字段名，避免标签重复
          const entityLabel = normalizeDisplayName(
            (value as { before?: unknown })?.before ?? entry.title
          )
          const label = items.length > 1 ? `${entityLabel || '指标'} · ${key}` : key
          changedFields[label] = {
            before: value?.before,
            after: value?.after
          }
        }
      }

      const title =
        items.length > 1
          ? `${normalizeDisplayName(first.title) || '异动'} 等 ${items.length} 项`
          : normalizeDisplayName(first.title) || '异动审批'
      const entityType = normalizeWorkflowEntityType(first.entityType)

      return {
        instanceId: Number(first.instanceId) || index,
        instanceNo: String(first.instanceId || ''),
        title,
        // 与「审批历史」异动卡片同源：同一个 resolveApprovalRouteTitle 生成流向标题
        routeTitle: resolveApprovalRouteTitle({
          flowCode,
          sourceOrgName,
          targetOrgName
        }),
        flowName:
          entityType === 'TASK' ? '任务异动审批（战略发展部）' : '指标异动审批（战略发展部）',
        flowCode,
        submitterName: normalizeDisplayName(first.submitterName) || '战略发展部',
        currentStepName: normalizeDisplayName(first.currentStepName) || '—',
        createdAt: first.createdAt,
        statusLabel: statusTag.label,
        statusType: statusTag.type,
        entityId: first.entityId,
        batchId: normalizeDisplayName(first.batchId) || null,
        changedFields,
        mutationEntityType: entityType === 'TASK' ? 'TASK' : 'INDICATOR',
        // 2026-10-22：一次异动提交会为每个实体各建一个实例（共享 batchId），
        // 卡片把它们聚合成一张。审批/驳回必须作用于整批，否则只处理第一条，
        // 其余实例会一直卡在「审批中」——用户看到的「驳回没退回」就是这个原因。
        mutationInstanceIds: items
          .map(entry => Number(entry.instanceId))
          .filter(id => Number.isFinite(id) && id > 0),
        // 当前待办节点的审批组织：异动卡片按「组织 + 步骤名角色」判定审批按钮可见性
        approverOrgId: first.approverOrgId
      } as PlanApprovalDetailItem
    })
  })

  const historyTargets = computed<WorkflowHistoryTarget[]>(() => {
    const targets: WorkflowHistoryTarget[] = []
    const seen = new Set<string>()

    const appendTarget = (
      entityType: 'PLAN' | 'PLAN_REPORT' | 'INDICATOR' | 'TASK' | undefined,
      entityId: unknown
    ) => {
      const normalizedType =
        entityType === 'PLAN_REPORT'
          ? 'PLAN_REPORT'
          : entityType === 'PLAN'
            ? 'PLAN'
            : entityType === 'INDICATOR'
              ? 'INDICATOR'
              : entityType === 'TASK'
                ? 'TASK'
                : null
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
    // 2026-10-10：指标异动审批链（PLAN_MUTATION_*，entity_type=INDICATOR）纳入审批历史
    // 2026-10-21：任务改名异动（entity_type=TASK）按各自类型追加，否则会拿 TASK 的 id 去查指标历史
    for (const mutation of props.mutationWorkflowEntities ?? []) {
      appendTarget(mutation.entityType ?? 'INDICATOR', mutation.entityId)
    }
    // 2026-10-26：部门计划族（子计划 PLAN + 各自学院上报 PLAN_REPORT）纳入审批历史，
    // 使战略任务页部门卡片的审批历史能看到「学院 → 本部门」的上报链
    for (const related of props.relatedWorkflowEntities ?? []) {
      appendTarget(related.entityType, related.entityId)
    }

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
    const detail = planWorkflowDetail.value
    const useDetail = detail && matchesExpectedWorkflowCode(detail.flowCode)

    // INDICATOR（异动审批）实例没有 plan 上下文，从工作流详情合成最小视图
    if (!props.plan) {
      if (!useDetail) {
        return null
      }

      return {
        id: toPositiveNumber(props.secondaryWorkflowEntityId) ?? undefined,
        name:
          normalizeDisplayName(detail.planName) ||
          props.planName ||
          props.departmentName ||
          '当前计划',
        // 2026-10-24：暴露实例实体类型——A/B 卡去重（报告实例不渲染计划汇总卡）依赖它
        entityType: detail.entityType,
        workflowInstanceId: Number(detail.instanceId || 0) || undefined,
        workflowStatus: detail.status,
        status: detail.status,
        startedAt: detail.startTime,
        currentTaskId: detail.currentTaskId,
        currentStepName: detail.currentStepName,
        currentApproverId: detail.currentApproverId,
        currentApproverName: detail.currentApproverName,
        canWithdraw: detail.canWithdraw,
        workflowHistory: Array.isArray(detail.history) ? detail.history : [],
        sourceOrgName: detail.sourceOrgName,
        targetOrgName: detail.targetOrgName
      } as Plan
    }

    return {
      ...props.plan,
      // 2026-10-24：同上——报告实例接入时暴露 PLAN_REPORT，供 A 卡去重判定
      entityType: useDetail ? detail.entityType : props.plan.entityType,
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
    return displayedBusinessSectionMode.value === 'report' ? '进度说明' : '下发备注'
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
        // 2026-10-26 用户反馈：详情卡补「权重」；下发链无自评/鉴定数据，占位显示
        weight: normalizeDisplayName(String(indicator.weight ?? '')) || '--',
        submittedSelfRating: '',
        appraisalLevel: '',
        targetValue: formatIndicatorMetricValue(indicator.targetValue),
        actualValue: formatIndicatorMetricValue(indicator.actualValue),
        unit: normalizeDisplayName(indicator.unit) || '--',
        attachments: []
      }
    })
  })

  function getPlanReportProgressEditKey(reportId: number | string, indicatorId: number | string) {
    return `${reportId}:${indicatorId}`
  }

  function setPlanReportProgressDraft(
    reportId: number | string | null,
    indicatorId: number | string | null,
    value: number | undefined
  ) {
    if (!reportId || !indicatorId || value === undefined) {
      return
    }

    const key = getPlanReportProgressEditKey(reportId, indicatorId)
    planReportProgressDrafts.value = {
      ...planReportProgressDrafts.value,
      [key]: Number(value)
    }
  }

  const displayedPlanReportIndicatorItems = computed(() => {
    const snapshot = displayedPlanReportSnapshot.value
    const indicatorDetails = Array.isArray(snapshot?.indicatorDetails)
      ? snapshot.indicatorDetails
      : []
    const reportId = Number(snapshot?.id ?? NaN)

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
      const progressValue = Number(detail?.progress ?? NaN)
      const editKey =
        Number.isFinite(reportId) && Number.isFinite(indicatorId)
          ? getPlanReportProgressEditKey(reportId, indicatorId)
          : ''

      return {
        reportId: Number.isFinite(reportId) ? reportId : null,
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
        submittedProgress: Number.isFinite(progressValue) ? `${progressValue}%` : '--',
        submittedProgressValue: Number.isFinite(progressValue) ? progressValue : null,
        submittedProgressDraft:
          editKey && planReportProgressDrafts.value[editKey] !== undefined
            ? planReportProgressDrafts.value[editKey]
            : Number.isFinite(progressValue)
              ? progressValue
              : 0,
        progressEditKey: editKey,
        // 会议定案：审批人不可修改下级填报内容（只能通过/打回），内联编辑入口恒关闭，
        // 仅保留只读展示；savePlanReportIndicatorProgress 方法保留但无 UI 入口。
        canEditSubmittedProgress: false,
        isSavingSubmittedProgress: savingPlanReportProgressKey.value === editKey,
        submittedComment: normalizeDisplayName(detail?.comment) || '--',
        submittedSelfRating: normalizeDisplayName(detail?.selfRating) || '',
        // 2026-10-26 用户反馈：上报详情卡同样补「权重」（指标库行自带）
        weight:
          normalizeDisplayName(
            String((matchedIndicator as { weight?: unknown } | null)?.weight ?? '')
          ) || '--',
        // 2026-10-24 指标级鉴定：已评定等级随快照带出，详情弹窗展示
        appraisalLevel: normalizeDisplayName(detail?.appraisalLevel) || '',
        targetValue: formatIndicatorMetricValue(matchedIndicator?.targetValue),
        actualValue: formatIndicatorMetricValue(matchedIndicator?.actualValue),
        unit: normalizeDisplayName(matchedIndicator?.unit) || '--',
        attachments: toDisplayAttachmentItems(detail?.attachments)
      }
    })
  })

  async function savePlanReportIndicatorProgress(item: {
    reportId: number | string | null
    indicatorId: number | string | null
    indicatorName?: string
    submittedProgressDraft?: number
    progressEditKey?: string
  }) {
    if (!item.reportId || !item.indicatorId || !item.progressEditKey) {
      ElMessage.warning('当前报告明细缺少必要信息，无法修改填报进度')
      return
    }

    const progress = Number(item.submittedProgressDraft)
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
      ElMessage.warning('进度必须在 0 到 100 之间')
      return
    }

    savingPlanReportProgressKey.value = item.progressEditKey
    try {
      const updatedReport = await indicatorFillApi.updatePlanReportIndicatorProgress(
        item.reportId,
        item.indicatorId,
        progress
      )

      if (String(relatedPlanReportSummary.value?.id ?? '') === String(updatedReport.id)) {
        relatedPlanReportSummary.value = updatedReport
      }
      if (String(selectedPlanReportSnapshot.value?.id ?? '') === String(updatedReport.id)) {
        selectedPlanReportSnapshot.value = updatedReport
      }
      if (
        !selectedPlanReportSnapshot.value &&
        String(displayedPlanReportSnapshot.value?.id ?? '') === String(updatedReport.id)
      ) {
        selectedPlanReportSnapshot.value = updatedReport
      }

      planReportProgressDrafts.value = {
        ...planReportProgressDrafts.value,
        [item.progressEditKey]: progress
      }
      emit('refresh')
      ElMessage.success(`已更新「${item.indicatorName || '该指标'}」填报进度`)
    } catch (error) {
      logger.error('[ApprovalProgressDrawer] 更新填报进度失败:', error)
      ElMessage.error(error instanceof Error && error.message ? error.message : '更新填报进度失败')
    } finally {
      savingPlanReportProgressKey.value = null
    }
  }

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
    if (['REJECTED', 'RETURNED', 'WITHDRAWN', 'CANCELLED'].includes(workflowStatus)) {
      // 2026-10-18 用户定案：驳回/撤回/退回统一中性词「已回退」，不再混用三种称谓
      return '已回退'
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
      if (planWorkflowStatusTag.value.label === '已回退') {
        return '已回退，可重新发起审批'
      }
      return '草稿状态，可发起审批'
    }

    if (
      ['DRAFT', 'WITHDRAWN', 'CANCELLED', 'RETURNED', 'REJECTED'].includes(planWorkflowStatus.value)
    ) {
      return '已回退，可重新发起审批'
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

  /**
   * 无工作流详情时的降级判权：只校验当前用户是否持有任一计划审批角色。
   * 真正的节点归属仍由后端 decision 接口兜底。
   * 修复点：与 useApprovalProgressDrawer 相同——原「一键通过/一键驳回」
   * 在 !hasPlanWorkflowData 分支下恒不可见（死分支）。
   */
  const hasAnyPlanApprovalRole = computed(() => {
    return currentUserRoleCodes.value.some(roleCode =>
      ['ROLE_APPROVER', 'ROLE_STRATEGY_DEPT_HEAD', 'ROLE_VICE_PRESIDENT'].includes(roleCode)
    )
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
    if (!hasPlanWorkflowData.value || !isPlanPendingApproval.value) {
      return false
    }

    // 不再以 hasPlanApprovalPermission 作为前置门，且补上「被指派审批人 = 本人」
    // 这条最强证据（与 useApprovalProgressDrawer / approverMatch 对齐）。
    const explicitAssigneeId = parsePositiveUserId(
      planWorkflowTasks.value.find(
        task =>
          String(task.status || '')
            .trim()
            .toUpperCase() === 'PENDING'
      )?.assigneeId
    )
    if (explicitAssigneeId && explicitAssigneeId === Number(currentUserId.value)) {
      return true
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

    if (normalizedStatus === 'WITHDRAWN' || normalizedStatus === 'REJECTED') {
      return { label: '已回退', type: 'info' }
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
    if (['RETURNED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'].includes(rawStatus)) {
      return { label: '已回退', type: 'info' as const }
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
      if (allTaskStatuses.has('WITHDRAWN') || allTaskStatuses.has('REJECTED')) {
        return { label: '已回退', type: 'info' as const }
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
    // 2026-10-20 修复（复盘图15）：提交类节点（填报人提交 / 填报人修改 / 填报人上报）
    // 不是审批节点，不应展示「可审批成员」「或签」。此前对所有节点统一返回候选，
    // 导致填报人提交节点下错误列出后续审核成员（党委办审核人2、党委办[演示]）。
    const stepNameForSubmitCheck =
      normalizeDisplayName(task.currentStepName) || normalizeDisplayName(task.taskName) || ''
    if (
      /填报人/.test(stepNameForSubmitCheck) &&
      /(提交|修改|上报|填报)/.test(stepNameForSubmitCheck)
    ) {
      return []
    }

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
      ['WITHDRAWN', 'CANCELLED', 'REJECTED', 'RETURNED'].includes(currentPlanInstanceStatus.value)
    ) {
      return '已回退'
    }
    if (
      currentPlanInstanceStatus.value === 'APPROVED' ||
      currentPlanInstanceStatus.value === 'DISTRIBUTED'
    ) {
      return '已通过'
    }

    if (normalizedPlanBusinessStatus.value === 'DRAFT') {
      if (planWorkflowStatusTag.value.label === '已回退') {
        return '已回退'
      }
      return '草稿'
    }

    if (['已回退', '已通过'].includes(latestPlanTaskDisplayLabel.value)) {
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
          title:
            planReportApprovalContext.value?.title ||
            `${props.departmentName || '当前部门'}上报审批`,
          routeTitle:
            planReportApprovalContext.value?.title ||
            `上报审批 · ${props.departmentName || '当前部门'} -> ${normalizeDisplayName(props.plan?.createdByOrgName) || '上级部门'}`,
          flowCode: planReportApprovalContext.value?.flowCode || 'PLAN_APPROVAL_COLLEGE',
          submitterName: resolveSubmitterDisplayName(
            planReportApprovalContext.value?.submitterName,
            relatedPlanReportSummary.value?.submitterName,
            props.plan?.submittedByName,
            props.plan?.createdByName
          ),
          currentStepName: relatedPlanReportStepDisplay.value,
          createdAt:
            planReportApprovalContext.value?.createdAt ||
            relatedPlanReportSummary.value?.submittedAt ||
            relatedPlanReportSummary.value?.createdAt ||
            undefined,
          entityId: relatedPlanReportSummary.value.id,
          planName: resolvePlanDisplayName(props.planName, resolvePlanNameFallback())
        }
      ]
    }

    if (hasPlanWorkflowData.value && props.plan) {
      const fallbackPlanName = resolvePlanDisplayName(props.planName, resolvePlanNameFallback())
      const planName = resolvePlanApprovalDisplayName(fallbackPlanName)

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

  /**
   * 2026-10-19 用户定案：上报审批卡片的三个要素必须取工作流真实数据——
   * 标题走标准「上报审批 · 部门 -> 上级」格式；提交人取工作流发起人（点击上报的填报人，
   * 不是计划的创建人）；提交时间取工作流启动时刻（plan_report.submitted_at 同刻）。
   * 工作流详情未加载完成时返回 null，由调用方回退旧写法，避免标题闪变。
   */
  const planReportApprovalContext = computed(() => {
    const detail = planWorkflowDetail.value
    if (!detail) {
      return null
    }

    // 与本文件 resolvePlanApprovalDisplayName（323-328 行）同款取值口径：
    // sourceOrg=上级（计划创建方），targetOrg=上报部门；resolveApprovalRouteTitle 内部处理流向
    const sourceOrgName =
      normalizeDisplayName(detail.sourceOrgName) ||
      normalizeDisplayName(props.plan?.createdByOrgName) ||
      '战略发展部'
    const targetOrgName =
      normalizeDisplayName(detail.targetOrgName) ||
      normalizeDisplayName(props.departmentName) ||
      '当前部门'
    const flowCode =
      normalizeWorkflowCode(detail.flowCode) ||
      (Array.isArray(props.workflowCode) ? props.workflowCode[0] : props.workflowCode) ||
      'PLAN_APPROVAL_COLLEGE'

    return {
      title: resolveApprovalRouteTitle({ flowCode, sourceOrgName, targetOrgName }),
      flowCode,
      submitterName:
        normalizeDisplayName(detail.starterName) ||
        normalizeDisplayName(props.plan?.submittedByName),
      createdAt: detail.startTime
    }
  })

  const currentPlanApprovalSummary = computed(() => {
    if (hasRelatedPlanReportActiveWorkflow.value && relatedPlanReportSummary.value?.id) {
      const reportContext = planReportApprovalContext.value
      return {
        key: `plan-report-${relatedPlanReportSummary.value.id}`,
        planName: reportContext?.title || `${props.departmentName || '当前部门'}上报审批`,
        currentStepName: relatedPlanReportStepDisplay.value,
        // 提交人：工作流发起人优先（真实填报人），回退报告/计划字段
        submitterName: resolveSubmitterDisplayName(
          reportContext?.submitterName,
          relatedPlanReportSummary.value?.submitterName,
          props.plan?.submittedByName,
          props.plan?.createdByName
        ),
        // 提交时间：工作流启动时刻优先，回退报告提交时间
        createdAt:
          reportContext?.createdAt ||
          relatedPlanReportSummary.value?.submittedAt ||
          relatedPlanReportSummary.value?.createdAt,
        count: 1
      }
    }

    if (hasPlanWorkflowData.value && props.plan) {
      const fallbackPlanName = resolvePlanDisplayName(props.planName, resolvePlanNameFallback())
      const planName = resolvePlanApprovalDisplayName(fallbackPlanName)

      return {
        key: planName,
        planName,
        currentStepName: currentPlanStepDisplay.value,
        // 2026-10-18 用户反馈：提交人显示成了当前环节审批人——
        // 优先取工作流真实发起人（starter），回退计划字段。
        submitterName:
          normalizeDisplayName(planWorkflowDetail.value?.starterName) ||
          normalizeDisplayName(activePlanWorkflow.value?.submittedByName) ||
          planSubmitterName.value,
        createdAt:
          activePlanWorkflow.value?.startedAt ||
          activePlanWorkflow.value?.submittedAt ||
          activePlanWorkflow.value?.createdAt,
        count: 1
      }
    }

    // 汇总卡只统计计划实例：异动/月报各自成卡，不能触发「计划审批中」
    if (planScopedPlanApprovals.value.length === 0) {
      return null
    }

    const sortedCreatedAt = planScopedPlanApprovals.value
      .map(item => item.createdAt)
      .filter(Boolean)
      .sort()
    const latestCreatedAt = sortedCreatedAt[sortedCreatedAt.length - 1]
    const planName = resolvePlanDisplayName(props.planName, resolvePlanNameFallback())

    return {
      key: planName,
      planName,
      currentStepName:
        planScopedPlanApprovals.value
          .map(item => item.currentStepName)
          .find(step => typeof step === 'string' && step.trim()) ||
        latestPlanTaskDisplayLabel.value ||
        '审批中',
      submitterName:
        planScopedPlanApprovals.value
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
      count: planScopedPlanApprovals.value.length
    }
  })

  // 2026-10-26 用户定案：「审批流程」页签顶部选择栏的候选扩展为全量可查看流程——
  // 主流程（默认焦点，直显）+ 进行中上报 + 进行中异动 + 历史终态实例（含学院上报链）。
  // 仅一条候选时选择栏隐藏，行为与旧版一致。
  // reportWorkflowInstances 只保留「进行中上报」语义（A/B 卡去重消费它），不改。
  interface WorkflowFocusCandidate {
    key: string
    instanceId?: number | string
    label: string
    step?: string
    kind: 'plan' | 'report' | 'mutation' | 'history'
  }
  const workflowFocusIdx = ref(0)
  const workflowFocusCandidates = computed<WorkflowFocusCandidate[]>(() => {
    const items: WorkflowFocusCandidate[] = [
      {
        key: 'plan:current',
        label:
          normalizeDisplayName(props.planName) ||
          normalizeDisplayName(props.departmentName) ||
          '主流程',
        kind: 'plan'
      }
    ]
    for (const report of reportWorkflowInstances.value) {
      const instanceId = report.workflowInstanceId || report.instanceId
      if (!instanceId) {
        continue
      }
      items.push({
        key: `report:${instanceId}`,
        instanceId,
        label: normalizeDisplayName(report.routeTitle || report.title) || '上报审批',
        step: normalizeDisplayName(report.currentStepName) || undefined,
        kind: 'report'
      })
    }
    for (const mutation of pendingMutationApprovalItems.value) {
      if (!mutation.instanceId) {
        continue
      }
      items.push({
        key: `mutation:${mutation.instanceId}`,
        instanceId: mutation.instanceId,
        label: normalizeDisplayName(mutation.routeTitle || mutation.title) || '异动审批',
        step: normalizeDisplayName(mutation.currentStepName) || undefined,
        kind: 'mutation'
      })
    }
    for (const history of historicalPlanApprovalItems.value) {
      if (!history.instanceId) {
        continue
      }
      items.push({
        key: `history:${history.instanceId}`,
        instanceId: history.instanceId,
        label: normalizeDisplayName(history.routeTitle || history.title) || '历史审批',
        step: normalizeDisplayName(history.currentStepName) || undefined,
        kind: 'history'
      })
    }
    return items
  })
  const workflowFocusInstance = computed<WorkflowFocusCandidate | null>(() => {
    const items = workflowFocusCandidates.value
    if (items.length === 0) {
      return null
    }
    return items[Math.min(workflowFocusIdx.value, items.length - 1)] || items[0]
  })
  const focusWorkflowDetail = ref<WorkflowInstanceDetailResponse | null>(null)
  watch(
    () => String(workflowFocusInstance.value?.instanceId ?? ''),
    async instanceKey => {
      if (!instanceKey) {
        focusWorkflowDetail.value = null
        return
      }
      try {
        const response = await getWorkflowInstanceDetail(instanceKey)
        focusWorkflowDetail.value = response?.success && response.data ? response.data : null
      } catch (error) {
        logger.warn('[ApprovalProgress] 加载流程焦点实例详情失败:', error)
        focusWorkflowDetail.value = null
      }
    },
    { immediate: true }
  )

  // ============ 审批流程节点数据 ============
  const workflowNodes = computed<WorkflowNode[]>(() => {
    // 2026-10-26 用户定案：选择栏点选了非主流程候选（进行中上报/异动、历史终态实例，
    // 含学院上报链）时，优先渲染该实例的流程步骤链。主流程候选与无详情时落回原有分支。
    const focusCandidate = workflowFocusInstance.value
    const focusDetail = focusCandidate?.kind !== 'plan' ? focusWorkflowDetail.value : null
    if (focusCandidate && focusCandidate.kind !== 'plan' && focusDetail) {
      const focusTasks = Array.isArray(focusDetail.tasks) ? focusDetail.tasks : []
      if (focusTasks.length > 0) {
        return focusTasks.map(task => {
          const isPending =
            String(task.status || '')
              .trim()
              .toUpperCase() === 'PENDING'
          return {
            id: String(task.taskId || task.taskKey || task.currentStepName || task.taskName),
            name:
              normalizeDisplayName(task.currentStepName) ||
              normalizeDisplayName(task.taskName) ||
              '审批节点',
            status: isPending ? 'current' : mapWorkflowTaskStatusToNodeStatus(task),
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
              typeof task.comment === 'string' && task.comment.trim() ? task.comment : undefined
          } satisfies WorkflowNode
        })
      }
    }

    // 2026-10-24 用户定案：审批进行中的上报实例（PLAN_REPORT）也要在「审批流程」
    // 页签渲染——选中哪条实例就渲染哪条的步骤链（多实例时由页签顶部选择栏切换）。
    // 此前该页签只接了 PLAN 流程与异动流程，上报审批进行中时永远「暂无审批数据」。
    const selectedReport = selectedReportInstance.value
    if (selectedReport) {
      const detail = reportWorkflowDetail.value
      const detailTasks = Array.isArray(detail?.tasks) ? detail!.tasks : []
      const sourceTasks =
        detailTasks.length > 0
          ? detailTasks
          : [
              {
                taskId: String(
                  selectedReport.taskId || selectedReport.instanceId || 'report-current'
                ),
                taskName: String(selectedReport.currentStepName || '当前审批环节'),
                currentStepName: String(selectedReport.currentStepName || ''),
                status: 'PENDING',
                assigneeId: selectedReport.assigneeId,
                assigneeName: selectedReport.assigneeName,
                approvedAt: undefined,
                comment: undefined
              } as WorkflowTaskResponse
            ]
      return sourceTasks.map(task => {
        const isPending =
          String(task.status || '')
            .trim()
            .toUpperCase() === 'PENDING'
        return {
          id: String(task.taskId || task.taskKey || task.currentStepName || task.taskName),
          name:
            normalizeDisplayName(task.currentStepName) ||
            normalizeDisplayName(task.taskName) ||
            '审批节点',
          status: isPending ? 'current' : mapWorkflowTaskStatusToNodeStatus(task),
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
            typeof task.comment === 'string' && task.comment.trim() ? task.comment : undefined
        } satisfies WorkflowNode
      })
    }

    if (isPlanHistoryOnlyMode.value) {
      // 计划自身流程已归档（下发审批已完成）；此时抽屉里正在走的是异动流程，
      // 与上报审批同理，应当显示它当前走到哪一步，而不是空态。
      if (activeMutationWorkflowTasks.value.length === 0) {
        return []
      }
      const mutationTaskIds = new Set(
        activeMutationWorkflowTasks.value.map(task => String(task.taskId || ''))
      )
      return activeMutationWorkflowTasks.value.map(task => {
        const taskId = String(task.taskId || task.taskKey || task.currentStepName || task.taskName)
        const isPending =
          String(task.status || '')
            .trim()
            .toUpperCase() === 'PENDING'
        return {
          id: taskId,
          name:
            normalizeDisplayName(task.currentStepName) ||
            normalizeDisplayName(task.taskName) ||
            '审批节点',
          status: isPending ? 'current' : mapWorkflowTaskStatusToNodeStatus(task),
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
            typeof task.comment === 'string' && task.comment.trim() ? task.comment : undefined
        } satisfies WorkflowNode
      })
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
    // 计划流程已归档、由异动流程接管时，当前节点取异动的待办任务
    if (isPlanHistoryOnlyMode.value) {
      const pendingTask = activeMutationWorkflowTasks.value.find(
        task =>
          String(task.status || '')
            .trim()
            .toUpperCase() === 'PENDING'
      )
      return pendingTask ? String(pendingTask.taskId || '') : ''
    }

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

  async function navigateToPendingPlanApproval(item: PendingPlanApprovalPreviewItem) {
    if (!item.routeTarget) {
      ElMessage.warning('暂无法定位审批页面')
      return
    }

    handleClose()
    await router.push(item.routeTarget)
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

  /**
   * 审批中的异动实例的流程详情（含 tasks）。
   * 与上报审批同理：异动也是一条独立的审批流程，审批中心应当能看到它走到哪一步。
   * 只在计划自身流程已归档（isPlanHistoryOnlyMode）时接管「审批流程」页签，
   * 计划流程仍在审批中时仍以计划节点为准，互不覆盖。
   * 2026-10-21：抽屉里可能同时存在多条异动（不同实例），优先跟随用户正在查看的那张卡，
   * 未选中时回落到最新一条（后端按 created_at DESC 返回）。
   */
  const activeMutationWorkflowDetail = computed<WorkflowInstanceDetailResponse | null>(() => {
    if (!isPlanHistoryOnlyMode.value) {
      return null
    }
    const candidates = props.mutationPendingApprovals ?? []
    const selectedId = String(selectedHistoryInstanceId.value || '').trim()
    const matched = selectedId
      ? candidates.find(item => String(item.instanceId || '') === selectedId)
      : undefined
    const source = matched ?? candidates[0]
    const detail = (source as { workflowDetail?: unknown } | undefined)?.workflowDetail
    if (!detail || typeof detail !== 'object') {
      return null
    }
    const tasks = (detail as WorkflowInstanceDetailResponse).tasks
    return Array.isArray(tasks) && tasks.length > 0
      ? (detail as WorkflowInstanceDetailResponse)
      : null
  })

  const activeMutationWorkflowTasks = computed<WorkflowTaskResponse[]>(() => {
    const detail = activeMutationWorkflowDetail.value
    if (!detail || !Array.isArray(detail.tasks)) {
      return []
    }
    return [...detail.tasks].sort((left, right) => {
      const leftStep = Number(left.stepNo ?? 0)
      const rightStep = Number(right.stepNo ?? 0)
      if (leftStep !== rightStep) {
        return leftStep - rightStep
      }
      return Number(left.taskId ?? 0) - Number(right.taskId ?? 0)
    })
  })

  async function loadPlanWorkflowDetail() {
    // INDICATOR（异动审批）实例没有 plan 上下文，凭 workflowEntityId 也可按业务实体加载
    if (!props.showPlanApprovals || (!props.plan && !toPositiveNumber(props.workflowEntityId))) {
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
      const businessEntityId = Number(props.workflowEntityId ?? props.plan?.id ?? 0)
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

      const workflowInstanceId = Number(props.plan?.workflowInstanceId ?? 0)
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

  /**
   * 本次审批通过时选定的鉴定进度等级（P1）：AHEAD/NORMAL/DELAYED；空=不评定。
   *
   * @deprecated 2026-10-24 用户定案：整体鉴定废弃，改用 planIndicatorAppraisalLevels 逐指标评定。
   */
  const planAppraisalLevel = ref<string>('')

  // ------------------------------------------------------------------
  // 2026-10-24 用户定案（指标级鉴定）：
  // - 鉴定等级按指标逐条评定，入口在审批详情弹窗的指标卡片上；
  // - 只有流程定义里的「末级审批节点」（上级部门鉴定环节）出现评定 UI，
  //   学院/部门内部环节只通过、驳回；
  // - 通过时把选定的 逐指标 随 decideTask 提交，后端只在实例到达终态时投影。
  // ------------------------------------------------------------------
  const planIndicatorAppraisalLevels = ref<Record<string, string>>({})

  function setPlanIndicatorAppraisalLevel(
    reportId: number | string | null | undefined,
    indicatorId: number | string | null | undefined,
    level: string
  ) {
    const rid = Number(reportId)
    const iid = Number(indicatorId)
    if (!Number.isFinite(rid) || !Number.isFinite(iid)) {
      return
    }
    const key = `${rid}:${iid}`
    if (level) {
      planIndicatorAppraisalLevels.value[key] = level
    } else {
      delete planIndicatorAppraisalLevels.value[key]
    }
  }

  function getPlanIndicatorAppraisalLevel(
    reportId: number | string | null | undefined,
    indicatorId: number | string | null | undefined
  ): string {
    const rid = Number(reportId)
    const iid = Number(indicatorId)
    if (!Number.isFinite(rid) || !Number.isFinite(iid)) {
      return ''
    }
    return planIndicatorAppraisalLevels.value[`${rid}:${iid}`] || ''
  }

  function collectPlanIndicatorAppraisalLevels(
    reportId: number | string | null | undefined
  ): Record<number, string> {
    const rid = Number(reportId)
    if (!Number.isFinite(rid)) {
      return {}
    }
    const prefix = `${rid}:`
    const result: Record<number, string> = {}
    for (const [key, level] of Object.entries(planIndicatorAppraisalLevels.value)) {
      if (!key.startsWith(prefix) || !level) {
        continue
      }
      const indicatorId = Number(key.slice(prefix.length))
      if (Number.isFinite(indicatorId) && indicatorId > 0) {
        result[indicatorId] = level
      }
    }
    return result
  }

  /** 审批提交成功后清空本单的逐指标选择，避免残留影响下一单 */
  function clearPlanIndicatorAppraisalLevels() {
    planIndicatorAppraisalLevels.value = {}
  }

  /** 上报链各流程「末级审批节点」的 step_def_id 缓存（flowCode → defId/null） */
  const appraisalStepDefIdByFlow = ref<Record<string, number | null>>({})

  async function ensureAppraisalStepDefId(flowCodeRaw?: string | null): Promise<number | null> {
    const flowCode = String(flowCodeRaw || '').trim()
    if (!flowCode) {
      return null
    }
    const cached = appraisalStepDefIdByFlow.value[flowCode]
    if (cached !== undefined) {
      return cached
    }
    let defId: number | null = null
    try {
      const { getWorkflowDefinitionPreviewByCode } = await import('@/features/workflow/api/queries')
      const response = await getWorkflowDefinitionPreviewByCode(flowCode)
      const steps = Array.isArray(response.data?.steps) ? response.data.steps : []
      const approvalSteps = steps
        .filter(
          step =>
            String(step.stepType || 'APPROVAL')
              .trim()
              .toUpperCase() === 'APPROVAL'
        )
        .sort((left, right) => (left.stepOrder ?? 0) - (right.stepOrder ?? 0))
      const lastApproval = approvalSteps[approvalSteps.length - 1]
      defId = Number.isFinite(lastApproval?.stepDefId) ? Number(lastApproval?.stepDefId) : null
    } catch (error) {
      logger.warn('[ApprovalState] 加载流程定义判定鉴定节点失败:', { flowCode, error })
      defId = null
    }
    appraisalStepDefIdByFlow.value[flowCode] = defId
    return defId
  }

  /** 从待办条目取当前 PENDING 节点的 step_def_id（my-tasks 的 taskKey 形如 step_12） */
  function pendingStepDefIdOfItem(item: Record<string, any>): number | null {
    const pendingTask = Array.isArray(item?.workflowDetail?.tasks)
      ? (item.workflowDetail.tasks as Array<Record<string, any>>).find(
          task => String(task?.status || '').toUpperCase() === 'PENDING'
        )
      : null
    const rawKey = String(pendingTask?.taskKey || item?.taskKey || item?.currentTaskKey || '')
    const match = rawKey.match(/^step_(\d+)$/)
    return match ? Number(match[1]) : null
  }

  /** 实例 → 是否鉴定节点 的判定缓存（模板同步读取，后台回填） */
  const appraisalInstanceFlags = ref<Record<number, boolean>>({})
  /** 详情弹窗当前是否处于「上级部门鉴定」模式（点击审批通过时显式置位，最可靠） */
  const appraisalDialogActive = ref(false)
  /**
   * 鉴定弹窗打开时快照的实例 ID。不复用全局 selectedHistoryInstanceId——
   * 弹窗打开触发的审批状态刷新事件会异步清空它（线上实测踩坑：
   * 「确认通过」时 ID 已被 handleApprovalStateRefresh 置空导致守卫拦下）。
   */
  const appraisalDialogInstanceId = ref<number | string | null>(null)

  /**
   * 权威判定：按实例 ID 直查实例详情，以实例自身 flowCode + PENDING 步骤
   * step_def_id 对照流程定义末级审批节点。待办条目的 flowCode/taskKey 在
   * 不同入口（my-tasks/部门看板）装配不一，不能作为唯一依据（线上实测踩坑）。
   */
  async function resolveIsAppraisalApprovalItem(item: Record<string, any>): Promise<boolean> {
    const instanceId = Number(item?.instanceId)
    if (!Number.isFinite(instanceId) || instanceId <= 0) {
      return false
    }
    let flowCode = String(item?.flowCode || '')
      .trim()
      .toUpperCase()
    let pendingDefId = pendingStepDefIdOfItem(item)
    if (!flowCode.startsWith('PLAN_APPROVAL') || pendingDefId === null) {
      try {
        const { getWorkflowInstanceDetail } = await import('@/features/workflow/api/queries')
        const response = await getWorkflowInstanceDetail(String(instanceId))
        if (response.success && response.data) {
          flowCode = String(response.data.flowCode || '')
            .trim()
            .toUpperCase()
          const pendingTask = Array.isArray(response.data.tasks)
            ? response.data.tasks.find(
                task => String(task?.status || '').toUpperCase() === 'PENDING'
              )
            : null
          const match = String(pendingTask?.taskKey || '').match(/^step_(\d+)$/)
          pendingDefId = match ? Number(match[1]) : null
        }
      } catch (error) {
        logger.warn('[ApprovalState] 判定鉴定节点取实例详情失败:', { instanceId, error })
      }
    }
    let result = false
    if (flowCode.startsWith('PLAN_APPROVAL') && pendingDefId !== null) {
      const defId = await ensureAppraisalStepDefId(flowCode)
      result = defId !== null && pendingDefId === defId
    }
    appraisalInstanceFlags.value[instanceId] = result
    return result
  }

  /** 按实例 ID 直读鉴定节点判定缓存（弹窗 footer/选择器的同步条件） */
  function isAppraisalInstanceId(instanceId: number | string | null | undefined): boolean {
    const id = Number(instanceId)
    return Number.isFinite(id) && appraisalInstanceFlags.value[id] === true
  }

  /**
   * 该待办是否处于「上级部门鉴定」节点（上报链的末级审批节点）。
   * 同步读缓存；未判定过则后台回填，模板随之自动刷新。
   */
  function isAppraisalApprovalItem(item: Record<string, any> | null | undefined): boolean {
    const instanceId = Number(item?.instanceId)
    if (!Number.isFinite(instanceId)) {
      return false
    }
    const cached = appraisalInstanceFlags.value[instanceId]
    if (cached !== undefined) {
      return cached
    }
    void resolveIsAppraisalApprovalItem(item as Record<string, any>)
    return false
  }

  async function handleApprovePlanBatch() {
    if (!hasPlanApprovalPermission.value && !hasAnyPlanApprovalRole.value) {
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
          `确认通过“${props.plan?.name || props.planName || '当前计划'}”的审批？`,
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
            value || '审批通过',
            planAppraisalLevel.value || undefined
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

    // 一键审批只针对计划实例：异动/月报有各自的审批入口，不能被批量带上
    if (planScopedPlanApprovals.value.length === 0) {
      ElMessage.warning('当前计划暂无待审批实例')
      return
    }

    try {
      const { value } = await ElMessageBox.prompt(
        `确认一键审批通过“${currentPlanApprovalSummary.value?.planName || '当前计划'}”下的 ${planScopedPlanApprovals.value.length} 条审批实例？`,
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
        for (const instance of planScopedPlanApprovals.value) {
          const response = await approvalApi.approvePlan(
            instance.instanceId,
            userId,
            value || '审批通过',
            planAppraisalLevel.value || undefined
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
    if (!hasPlanApprovalPermission.value && !hasAnyPlanApprovalRole.value) {
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
          `确认驳回“${props.plan?.name || props.planName || '当前计划'}”的审批？驳回只会退回上一审批节点，不会跳级。`,
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
            currentStepName: '已回退'
          })
          emit('refresh', {
            status: 'DRAFT',
            workflowStatus: 'REJECTED',
            canWithdraw: false,
            currentTaskId: null,
            currentStepName: '已回退'
          })
          await refreshPlanApprovalAfterMutation()
          ElMessage.success('审批已回退')
        } finally {
          loadingInstance.close()
        }
        return
      } catch {
        return
      }
    }

    // 一键驳回只针对计划实例：异动/月报有各自的审批入口
    if (planScopedPlanApprovals.value.length === 0) {
      ElMessage.warning('当前计划暂无待审批实例')
      return
    }

    try {
      const { value } = await ElMessageBox.prompt(
        `确认一键驳回“${currentPlanApprovalSummary.value?.planName || '当前计划'}”下的 ${planScopedPlanApprovals.value.length} 条审批实例？`,
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
        for (const instance of planScopedPlanApprovals.value) {
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
          currentStepName: '已回退'
        })
        emit('refresh', {
          status: 'DRAFT',
          workflowStatus: 'REJECTED',
          canWithdraw: false,
          currentTaskId: null,
          currentStepName: '已回退'
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

    // 2026-10-18：与 formatStayDuration 统一口径——无时区标记的裸串按北京时间解析并渲染
    const trimmed = String(timestamp).trim()
    const normalized = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(trimmed)
      ? trimmed.replace(' ', 'T')
      : trimmed
    const date = new Date(normalized)
    if (Number.isNaN(date.getTime())) {
      return '--'
    }
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
    // 2026-10-24 用户定案（A/B 卡重复修复）：下发页在报告上下文里会把「报告实例」
    // 详情喂给计划汇总卡，导致汇总卡把月报待办再渲染一遍——与 pendingReportApprovalItems
    // 的上报待办卡重复，且提交人显示为「--」。按实例去重：计划汇总卡的当前待办
    // （currentTaskId）若已被上报待办卡覆盖，则不再渲染汇总卡。
    const reportTodoIds = new Set<string>()
    for (const item of pendingReportApprovalItems.value as Array<Record<string, any>>) {
      for (const key of ['taskId', 'instanceId', 'currentTaskId']) {
        const value = item[key]
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          reportTodoIds.add(String(value).trim())
        }
      }
    }
    const planTodoId = String(currentPlanTaskId.value || '').trim()
    if (planTodoId && reportTodoIds.has(planTodoId)) {
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
    // 计划流程归档后若由异动流程接管（workflowNodes 已有异动节点），这里不会命中空态，
    // 两个条件同时为假——无需额外守卫。
    return Boolean(
      props.showPlanApprovals && hasPlanWorkflowData.value && workflowNodes.value.length === 0
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
    hasAnyPlanApprovalRole,
    planAppraisalLevel,
    // 2026-10-24 指标级鉴定
    planIndicatorAppraisalLevels,
    setPlanIndicatorAppraisalLevel,
    getPlanIndicatorAppraisalLevel,
    collectPlanIndicatorAppraisalLevels,
    clearPlanIndicatorAppraisalLevels,
    isAppraisalApprovalItem,
    isAppraisalInstanceId,
    resolveIsAppraisalApprovalItem,
    appraisalDialogActive,
    appraisalDialogInstanceId,
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
    navigateToPendingPlanApproval,
    normalizeDisplayName,
    normalizeStepMatchKey,
    normalizeWorkflowAction,
    normalizeWorkflowCode,
    normalizedPlanBusinessStatus,
    parsePositiveUserId,
    pendingCount,
    pendingPlanApprovalPreviewItems,
    pendingMutationApprovalItems,
    pendingReportApprovalItems,
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
    resolveExpectedApproverRoleCodesByStepName,
    resolveHistoryStatusTag,
    resolveTaskCandidateApprovers,
    resolveTaskStatusLabel,
    resolveTaskStatusTag,
    resolveWorkflowTaskOperatorName,
    savePlanReportIndicatorProgress,
    scopedDepartmentPlan,
    scopedPendingPlanCount,
    scopedPlanApprovals,
    scopedPlanEntityIds,
    selectedHistoryInstanceDetail,
    selectedHistoryInstanceDetailLoading,
    selectedHistoryInstanceId,
    selectedPlanReportSnapshot,
    selectedPlanReportSnapshotLoading,
    setPlanReportProgressDraft,
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
    reportWorkflowInstances,
    selectedReportInstanceIdx,
    selectedReportInstance,
    workflowFocusCandidates,
    workflowFocusIdx,
    reportWorkflowDetailLoading,
    workflowOrgRoleCandidateCache,
    workflowUserAvatarCache
  }
}

export type ApprovalProgressState = ReturnType<typeof useApprovalProgressState>
