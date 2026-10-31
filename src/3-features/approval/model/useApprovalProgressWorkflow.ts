import { onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElLoading, ElMessage, ElMessageBox } from 'element-plus'
import { approvalApi } from '@/features/task/api/strategicApi'
import { decideTask } from '@/features/workflow/api/mutations'
import { indicatorFillApi } from '@/features/plan/api/planApi'
import { tryGetUserById } from '@/features/user/api/query'
import { APPROVAL_STATE_REFRESH_EVENT, notifyApprovalStateRefresh } from '@/features/approval/lib'
import { normalizeApprovalEntityType } from '@/features/approval/model/approvalEntityTypes'
import {
  isUnfinishedAppraisalMessage,
  resolveUnfinishedAppraisalJumpRoute,
  showUnfinishedAppraisalNotice
} from '@/features/approval/model/unfinishedAppraisalNotice'
import { apiClient } from '@/shared/api'
import type { ApiResponse } from '@/shared/types'
import { logger } from '@/shared/lib/utils/logger'
import {
  buildUserFacingErrorMessage,
  claimErrorToast,
  markErrorHandled
} from '@/shared/lib/utils/errorToast'
import {
  getWorkflowDefinitionPreviewByCode,
  getWorkflowInstanceDetail,
  getWorkflowInstanceDetailByBusiness,
  getWorkflowInstanceHistoryByBusiness
} from '@/features/workflow/api/queries'
import type {
  DistributionApprovalProgressDrawerEmit,
  DistributionApprovalProgressDrawerProps,
  PlanApprovalDetailItem,
  PlanReportSnapshotSummary
} from '@/features/approval/model/types'
import type { WorkflowInstanceDetailResponse } from '@/features/workflow/api/types'
import type { ApprovalProgressState } from './useApprovalProgressState'

interface UseApprovalProgressWorkflowOptions {
  props: DistributionApprovalProgressDrawerProps
  emit: DistributionApprovalProgressDrawerEmit
  state: ApprovalProgressState
}

/**
 * 2026-10-31（C-6 实例 ID 前缀泄漏修复）：批量审批失败文案不再拼「{instanceId}: 」前缀。
 * 实例 ID 是内部排查信息，整批同卡场景对用户无意义；用户 toast 只保留业务原文，
 * 实例级完整信息改走 logger.warn 留在控制台供排查。
 * 注意：failures 必须与失败实例一一对应（toast 的「有 N 项」计数依赖它），不去重。
 *
 * 2026-10-30 双弹修复约定：调用方在「抛错」路径必须先 markErrorHandled(error)——
 * 失败已计入本汇总、由循环结束后统一弹一个，响应拦截器的兜底 toast 不再弹，
 * 否则「单实例原文 + 批次汇总」双弹（用户实测缺陷）。
 */
function pushMutationApprovalFailure(
  failures: string[],
  instanceId: number | string,
  rawMessage: string
): void {
  const message = String(rawMessage || '').trim() || '审批失败'
  logger.warn('[ApprovalProgress] 批量审批失败实例详情:', { instanceId, message })
  failures.push(message)
}

export function useApprovalProgressWorkflow({
  props,
  emit,
  state
}: UseApprovalProgressWorkflowOptions) {
  const router = useRouter()

  /**
   * ElMessageBox.prompt 被用户「取消 / 关闭」时，promise reject 的是字符串
   * 'cancel' / 'close'（不是 Error）。这类情况不是失败，不能弹错误提示。
   */
  function isPromptDismissed(error: unknown): boolean {
    return error === 'cancel' || error === 'close'
  }

  /**
   * 提取错误文案：
   * - 拦截器 reject 的是统一错误对象（{ message, code, ... }），不是 Error 实例
   * - 也有直接抛 Error 的路径
   * 两者都取 .message；取不到时返回空串由调用方兜底。
   */
  function extractErrorMessage(error: unknown): string {
    if (typeof error === 'string') {
      return error
    }
    if (error instanceof Error) {
      return error.message
    }
    const message = (error as { message?: unknown } | null | undefined)?.message
    return typeof message === 'string' ? message : ''
  }

  /**
   * 当前抽屉上下文里能取到的 PLAN_REPORT 实例（「未完成审核」跳转的兜底上下文）。
   * 抽屉锚定上报链时 planWorkflowDetail 即报告实例；否则退回关联上报摘要（仅 id）。
   */
  function resolveDrawerPlanReportContext(): Record<string, unknown> | null {
    const detail = state.planWorkflowDetail.value
    if (detail && normalizeApprovalEntityType(detail.businessEntityType) === 'PLAN_REPORT') {
      return detail as unknown as Record<string, unknown>
    }
    const reportId = state.toPositiveNumber(state.relatedPlanReportSummary.value?.id)
    if (reportId) {
      return { entityType: 'PLAN_REPORT', entityId: reportId }
    }
    return null
  }

  /**
   * 2026-10-30 用户定案：「未完成审核」拦截要能一键跳转。
   *
   * 命中「未完成审核」类拦截文案时改用 ElNotification（title「未完成审核」、
   * message=后端原文原样、附「去完成鉴定」按钮），点击落到该报告填报部门的
   * 指标填报页——路由复用审批卡片 routeTarget 的 resolveApprovalRoute 同一套口径，
   * 部门/实例参数从被拒实例/卡片上下文提取（兜底取当前抽屉的 PLAN_REPORT 上下文）。
   *
   * 返回 true 表示已按拦截通知处理（调用方不要再弹普通 toast）；
   * 返回 false 表示非该类拦截（或解析不出跳转路由），走原样错误 toast。
   */
  function showUnfinishedAppraisalBlockNotice(
    message: string,
    instance?: Record<string, unknown> | null
  ): boolean {
    if (!isUnfinishedAppraisalMessage(message)) {
      return false
    }

    const routeTarget = resolveUnfinishedAppraisalJumpRoute(
      instance ?? resolveDrawerPlanReportContext(),
      {
        viewerRole: state.authStore.effectiveRole || state.authStore.userRole,
        currentDepartmentName:
          state.normalizeDisplayName(
            state.authStore.effectiveDepartment || state.authStore.user?.department
          ) || null,
        fallbackDepartmentName: props.departmentName || null
      }
    )
    // 解析不出跳转路由（缺报告实体上下文）时退回普通 toast：文字保留，不承诺跳转
    if (!routeTarget) {
      return false
    }

    // 消息级去重：同一拦截不重复弹通知
    if (!claimErrorToast(message)) {
      return true
    }
    showUnfinishedAppraisalNotice({
      message,
      routeTarget,
      onJump: target => {
        // 与 navigateToPendingPlanApproval 同口径：先收抽屉再跳填报页
        state.handleClose()
        void router.push(target)
      }
    })
    return true
  }

  /**
   * 提示一条审批失败信息（2026-10-29 N-02 修复）。
   *
   * - `markErrorHandled`：告诉响应拦截器「这条错误业务层已经提示过」，
   *   拦截器的兜底提示据此跳过 → 同一条错误只弹一次（实测 409 场景原本弹两条）。
   * - `claimErrorToast`：消息级去重，避免与其它层重复弹同一条文案。
   * - 后端原文优先透出（中文原文直接用；英文原文用中文兜底 + 原文附注）。
   * - 2026-10-30 用户定案：「未完成审核」类拦截升级为带「去完成鉴定」跳转的
   *   Notification（见 showUnfinishedAppraisalBlockNotice），其余错误保持普通 toast。
   */
  function showApprovalErrorToast(
    error: unknown,
    fallbackText: string,
    instance?: Record<string, unknown> | null
  ): void {
    markErrorHandled(error)

    const message = buildUserFacingErrorMessage(
      extractErrorMessage(error),
      fallbackText,
      (error as { status?: number } | null | undefined)?.status
    )

    if (showUnfinishedAppraisalBlockNotice(message, instance)) {
      return
    }

    if (!claimErrorToast(message)) {
      return
    }
    ElMessage.error(message)
  }

  /**
   * 2026-10-30 双弹修复 + 跳转增强：审批失败提示的统一出口——同一轮操作只弹一个错误弹窗。
   *
   * - 单实例失败：只弹该实例的错误原文（不再套「有 1 项…未成功」汇总前缀）；
   * - 多实例失败：只弹汇总（首条原文 + 计数），失败明细已在 failures 里；
   * - 「未完成审核」类拦截：升级为带「去完成鉴定」按钮的 Notification（后端原文原样展示）；
   * - 其余错误保持原样 toast。
   */
  function showApprovalFailureMessage(
    message: string,
    instance?: Record<string, unknown> | null
  ): void {
    const normalized = String(message || '').trim()
    if (!normalized) {
      return
    }

    if (showUnfinishedAppraisalBlockNotice(normalized, instance)) {
      return
    }

    if (!claimErrorToast(normalized)) {
      return
    }
    ElMessage.error(normalized)
  }

  function normalizeWorkflowRuntimeStatus(value: unknown): string {
    return String(value || '')
      .trim()
      .toUpperCase()
  }

  function isActivePlanStatus(): boolean {
    return ['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(
      normalizeWorkflowRuntimeStatus(props.plan?.workflowStatus || props.plan?.status)
    )
  }

  function isTerminalWorkflowDetail(detail: WorkflowInstanceDetailResponse): boolean {
    return ['WITHDRAWN', 'CANCELLED', 'REJECTED', 'RETURNED'].includes(
      normalizeWorkflowRuntimeStatus(detail.status)
    )
  }

  function shouldIgnoreWorkflowDetail(detail: WorkflowInstanceDetailResponse): boolean {
    return isActivePlanStatus() && isTerminalWorkflowDetail(detail)
  }

  function waitForWorkflowRetry(delayMs: number): Promise<void> {
    return new Promise(resolve => {
      window.setTimeout(resolve, delayMs)
    })
  }

  async function ensureWorkflowUserAvatarLoaded(userIdValue: unknown): Promise<void> {
    if (!state.canLookupWorkflowUsers.value) {
      return
    }

    const userId = state.parsePositiveUserId(userIdValue)
    if (!userId) {
      return
    }

    const cacheKey = String(userId)
    if (state.workflowUserAvatarCache.value[cacheKey]) {
      return
    }

    try {
      const user = await tryGetUserById(userId)
      if (!user) {
        return
      }
      state.cacheWorkflowUserAvatar(
        userId,
        (user as { avatar?: unknown; avatarUrl?: unknown }).avatar
      )
      state.cacheWorkflowUserAvatar(userId, (user as { avatarUrl?: unknown }).avatarUrl)
    } catch (error) {
      logger.warn('[DistributionApprovalProgressDrawer] 用户头像解析失败:', { userId, error })
    }
  }

  async function ensureSubmitterNameLoaded(
    userIdValue: unknown,
    fallbackName?: string
  ): Promise<void> {
    const userId = state.parsePositiveUserId(userIdValue)
    if (!userId) {
      return
    }

    const cacheKey = String(userId)
    if (state.submitterNameCache.value[cacheKey]) {
      return
    }

    if (!state.canLookupWorkflowUsers.value) {
      const fallbackDisplayName =
        state.normalizeDisplayName(fallbackName) || state.getFallbackSubmitterValue()
      state.cacheSubmitterName(userId, fallbackDisplayName)
      return
    }

    try {
      const user = await tryGetUserById(userId)
      if (!user) {
        const fallbackDisplayName =
          state.normalizeDisplayName(fallbackName) || state.getFallbackSubmitterValue()
        state.cacheSubmitterName(userId, fallbackDisplayName)
        return
      }

      const realName = state.normalizeDisplayName(user.realName)
      const username = state.normalizeDisplayName(user.username)
      state.submitterNameCache.value = {
        ...state.submitterNameCache.value,
        [cacheKey]: realName || username || cacheKey
      }
    } catch (error) {
      const fallbackDisplayName =
        state.normalizeDisplayName(fallbackName) || state.getFallbackSubmitterValue()
      state.cacheSubmitterName(userId, fallbackDisplayName)
      logger.warn('[ApprovalProgressDrawer] 提交人名称解析失败:', { userId, error })
    }
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

  async function loadPendingPlanApprovals() {
    if (!props.showPlanApprovals) {
      state.pendingPlanApprovals.value = []
      return
    }

    state.planApprovalsLoading.value = true
    try {
      if (props.departmentName) {
        await state.planStore.loadPlans()
      }

      const userId = state.authStore.user?.userId || state.authStore.user?.id || 1
      const response = await approvalApi.getPendingApprovals(userId)
      if (response.success && Array.isArray(response.data)) {
        state.pendingPlanApprovals.value = response.data
        return
      }

      state.pendingPlanApprovals.value = []
      if (response.message) {
        ElMessage.error(response.message)
      }
    } catch (error: any) {
      state.pendingPlanApprovals.value = []
      logger.error('[ApprovalProgressDrawer] 加载待审批列表失败:', error)
      ElMessage.error(error?.message || '加载待审批列表失败')
    } finally {
      state.planApprovalsLoading.value = false
    }
  }

  async function loadRelatedPlanReportSummary() {
    if (!props.showPlanApprovals || !props.plan) {
      state.relatedPlanReportSummary.value = null
      return
    }

    const planId = Number(props.plan.id ?? NaN)
    const reportOrgId = Number(
      (
        props.plan as {
          targetOrgId?: number | string
          orgId?: number | string
          target_org_id?: number | string
        }
      ).targetOrgId ??
        (props.plan as { orgId?: number | string; target_org_id?: number | string })
          .target_org_id ??
        props.plan.orgId ??
        NaN
    )

    if (
      !Number.isFinite(planId) ||
      planId <= 0 ||
      !Number.isFinite(reportOrgId) ||
      reportOrgId <= 0
    ) {
      state.relatedPlanReportSummary.value = null
      return
    }

    try {
      const { currentReport, latestReport } =
        await indicatorFillApi.getCurrentMonthPlanReportSummaries(planId, reportOrgId)

      if (state.hasPlanReportWorkflowContext(currentReport)) {
        state.relatedPlanReportSummary.value = currentReport
        return
      }

      if (state.hasPlanReportWorkflowContext(latestReport)) {
        state.relatedPlanReportSummary.value = latestReport
        return
      }

      state.relatedPlanReportSummary.value = latestReport || currentReport || null
    } catch (error) {
      state.relatedPlanReportSummary.value = null
      logger.warn('[DistributionApprovalProgressDrawer] 加载关联上报审批摘要失败:', error)
    }
  }

  async function loadPlanWorkflowDetail(
    options: { retryActive?: boolean; maxAttempts?: number; delayMs?: number } = {}
  ) {
    if (!props.showPlanApprovals || !props.plan) {
      state.planWorkflowDetail.value = null
      state.planWorkflowDetailLoading.value = false
      return
    }

    const requestSeq = ++state.planWorkflowDetailRequestSeq.value
    state.planWorkflowDetailLoading.value = true
    const maxAttempts = options.retryActive ? (options.maxAttempts ?? 12) : 1
    const delayMs = options.delayMs ?? 500

    try {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        let ignoredTerminalDetail = false

        const applyWorkflowDetail = (detail: WorkflowInstanceDetailResponse): boolean => {
          if (!state.matchesExpectedWorkflowCode(detail.flowCode)) {
            return false
          }

          if (shouldIgnoreWorkflowDetail(detail)) {
            ignoredTerminalDetail = true
            return false
          }

          if (requestSeq === state.planWorkflowDetailRequestSeq.value) {
            state.planWorkflowDetail.value = detail
          }
          return true
        }

        if (
          state.hasRelatedPlanReportActiveWorkflow.value &&
          state.relatedPlanReportSummary.value?.id
        ) {
          const response = await getWorkflowInstanceDetailByBusiness(
            'PLAN_REPORT',
            Number(state.relatedPlanReportSummary.value.id)
          )
          if (
            requestSeq === state.planWorkflowDetailRequestSeq.value &&
            response.success &&
            response.data &&
            applyWorkflowDetail(response.data)
          ) {
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
            requestSeq === state.planWorkflowDetailRequestSeq.value &&
            response.success &&
            response.data &&
            applyWorkflowDetail(response.data)
          ) {
            return
          }
        }

        const workflowInstanceId = Number(props.plan.workflowInstanceId ?? 0)
        if (Number.isFinite(workflowInstanceId) && workflowInstanceId > 0) {
          const response = await getWorkflowInstanceDetail(String(workflowInstanceId))
          if (
            requestSeq === state.planWorkflowDetailRequestSeq.value &&
            response.success &&
            response.data &&
            applyWorkflowDetail(response.data)
          ) {
            return
          }
        }

        if (requestSeq === state.planWorkflowDetailRequestSeq.value) {
          state.planWorkflowDetail.value = null
        }

        const shouldRetryActiveDetail =
          options.retryActive && (ignoredTerminalDetail || isActivePlanStatus())
        if (!shouldRetryActiveDetail || attempt >= maxAttempts - 1) {
          return
        }

        await waitForWorkflowRetry(delayMs)
      }
    } catch (error) {
      if (requestSeq === state.planWorkflowDetailRequestSeq.value) {
        state.planWorkflowDetail.value = null
      }
      logger.warn('[ApprovalProgressDrawer] 加载计划工作流详情失败:', error)
    } finally {
      if (requestSeq === state.planWorkflowDetailRequestSeq.value) {
        state.planWorkflowDetailLoading.value = false
      }
    }
  }

  async function loadWorkflowDefinitionPreview() {
    const flowCode = state.normalizeDisplayName(
      state.planWorkflowDetail.value?.flowCode ||
        (state.activePlanWorkflow.value as { flowCode?: unknown } | null)?.flowCode ||
        (Array.isArray(props.workflowCode) ? props.workflowCode[0] : props.workflowCode)
    )

    if (!flowCode) {
      state.workflowDefinitionPreview.value = null
      return
    }

    try {
      const response = await getWorkflowDefinitionPreviewByCode(flowCode)
      state.workflowDefinitionPreview.value =
        response.success && response.data ? response.data : null
    } catch (error) {
      state.workflowDefinitionPreview.value = null
      logger.warn('[DistributionApprovalProgressDrawer] 加载流程定义预览失败:', {
        flowCode,
        error
      })
    }
  }

  async function ensureWorkflowRelatedAvatarsLoaded(): Promise<void> {
    await state.ensureWorkflowTaskScopedCandidatesLoaded()

    const userIds = new Set<number>()

    state.planWorkflowTasks.value.forEach(task => {
      const assigneeId = state.parsePositiveUserId(task.assigneeId)
      if (assigneeId) {
        userIds.add(assigneeId)
      }
    })
    ;(state.workflowDefinitionPreview.value?.steps || []).forEach(step => {
      ;(step.candidateApprovers || []).forEach(candidate => {
        const candidateUserId = state.parsePositiveUserId(candidate.userId)
        if (candidateUserId) {
          userIds.add(candidateUserId)
        }
      })
    })
    Object.values(state.workflowOrgRoleCandidateCache.value).forEach(candidates => {
      candidates.forEach(candidate => {
        const candidateUserId = state.parsePositiveUserId(candidate.userId)
        if (candidateUserId) {
          userIds.add(candidateUserId)
        }
      })
    })

    await Promise.all([...userIds].map(userId => ensureWorkflowUserAvatarLoaded(userId)))
  }

  async function loadPlanWorkflowHistoryCards() {
    if (!props.showPlanApprovals || !props.plan) {
      state.planWorkflowHistoryCards.value = []
      return
    }

    if (state.historyTargets.value.length === 0) {
      state.planWorkflowHistoryCards.value = []
      return
    }

    try {
      const results = await Promise.all(
        state.historyTargets.value.map(target =>
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
      state.planWorkflowHistoryCards.value = merged.filter(item => {
        const key = String(item.instanceId || '')
        if (!key || seen.has(key)) {
          return false
        }
        seen.add(key)
        return true
      })
    } catch (error) {
      state.planWorkflowHistoryCards.value = []
      logger.warn('[ApprovalProgressDrawer] 加载计划审批历史卡片失败:', error)
    }
  }

  async function refreshPlanApprovalAfterMutation(): Promise<void> {
    const planId = Number(props.plan?.id ?? state.scopedDepartmentPlan.value?.id ?? NaN)

    await Promise.all([
      loadPendingPlanApprovals(),
      loadPlanWorkflowDetail(),
      loadPlanWorkflowHistoryCards()
    ])

    if (Number.isFinite(planId) && planId > 0) {
      await state.planStore.loadPlanDetails(planId, { force: true, background: true })
    }

    notifyApprovalStateRefresh({ source: 'distribution-approval-progress-drawer' })
  }

  /**
   * 2026-10-21：异动卡片的审批操作。
   * 与计划卡片同口径：按卡片当前步骤名解析角色（resolveExpectedApproverRoleCodesByStepName），
   * 加上「当前待办节点的审批组织 = 本人组织」判定；提交时后端 decideTask 仍是最终权威。
   */
  function canCurrentUserHandleMutationApproval(item: PlanApprovalDetailItem): boolean {
    const expectedRoleCodes = state.resolveExpectedApproverRoleCodesByStepName(item.currentStepName)
    if (
      expectedRoleCodes.length > 0 &&
      !expectedRoleCodes.some(roleCode => state.currentUserRoleCodes.value.includes(roleCode))
    ) {
      return false
    }

    const approverOrgId = Number((item as { approverOrgId?: number | string | null }).approverOrgId)
    if (
      Number.isFinite(approverOrgId) &&
      approverOrgId > 0 &&
      Number.isFinite(state.currentUserOrgId.value)
    ) {
      return state.currentUserOrgId.value === approverOrgId
    }

    return false
  }

  /**
   * 2026-10-22：异动卡片的「待处理实例清单」。
   *
   * 一次「发起异动」会为每个实体（多条指标 + 任务改名）各建一个审批实例，
   * 它们共享 batchId，审批中心聚合成一张卡。审批/驳回必须逐个处理整批，
   * 只处理 instanceId（批次里的第一条）会让其余实例永远停在审批中——
   * 用户看到的就是「点了驳回，链路没有退回」。
   */
  function resolveMutationInstanceIds(item: PlanApprovalDetailItem): number[] {
    const ids = Array.isArray(item.mutationInstanceIds) ? item.mutationInstanceIds : []
    const normalized = ids.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0)
    if (normalized.length > 0) {
      return [...new Set(normalized)]
    }
    const fallback = Number(item.instanceId)
    return Number.isFinite(fallback) && fallback > 0 ? [fallback] : []
  }

  async function handleApproveMutation(item: PlanApprovalDetailItem) {
    const mutationInstanceIds = resolveMutationInstanceIds(item)
    if (mutationInstanceIds.length === 0) {
      ElMessage.warning('未找到该异动的审批实例，请刷新后重试')
      return
    }
    if (!canCurrentUserHandleMutationApproval(item)) {
      ElMessage.warning('当前审批节点不是你，无法执行审批通过')
      return
    }

    // 2026-10-28 用户定案：审批卡片只做审批，不做鉴定——
    // 鉴定在三个表格页的指标行内完成，这里直接走普通审批确认。
    let comment = '审批通过'
    try {
      const batchSuffix =
        mutationInstanceIds.length > 1
          ? `（本次异动共 ${mutationInstanceIds.length} 项，将一并处理）`
          : ''
      const { value } = await ElMessageBox.prompt(
        `确认通过“${item.currentStepName || '异动审批'}”节点的审批？${batchSuffix}`,
        '审批通过',
        {
          confirmButtonText: '确认通过',
          cancelButtonText: '取消',
          inputPlaceholder: '请输入审批意见（可选）',
          inputType: 'textarea'
        }
      )
      if (value && String(value).trim()) {
        comment = String(value).trim()
      }
    } catch {
      return
    }

    const loadingInstance = ElLoading.service({
      lock: true,
      text: '正在审批并同步数据，请稍候...',
      background: 'rgba(0, 0, 0, 0.7)'
    })
    try {
      const userId = state.authStore.user?.userId || state.authStore.user?.id || 1
      const failures: string[] = []
      for (const instanceId of mutationInstanceIds) {
        try {
          const response = await approvalApi.approvePlan(instanceId, userId, comment)
          if (!response.success) {
            pushMutationApprovalFailure(failures, instanceId, response.message || '审批失败')
          }
        } catch (error) {
          // 2026-10-30 双弹修复：失败已计入汇总、由循环结束后统一弹一个，
          // 标记已处理让响应拦截器的兜底 toast 跳过（否则「单实例原文 + 汇总」双弹）
          markErrorHandled(error)
          pushMutationApprovalFailure(failures, instanceId, (error as Error)?.message || '审批失败')
        }
      }
      if (failures.length > 0) {
        // 2026-10-30 用户定案：单实例失败只弹该实例的错误原文（「未完成审核」类带
        // 「去完成鉴定」跳转）；多实例失败只弹汇总——一轮操作只弹一个错误弹窗。
        showApprovalFailureMessage(
          failures.length === 1
            ? failures[0]
            : `有 ${failures.length} 项审批未成功：${failures[0]}`,
          item as unknown as Record<string, unknown>
        )
        return
      }
      ElMessage.success(
        mutationInstanceIds.length > 1
          ? `已通过本次异动全部 ${mutationInstanceIds.length} 项`
          : '审批通过'
      )
      await refreshPlanApprovalAfterMutation()
      emit('refresh', {})
    } finally {
      loadingInstance.close()
    }
  }

  /**
   * 2026-10-24 指标级鉴定：详情弹窗内的「确认通过」。
   * 收集弹窗打开期间逐指标选定的等级随 decideTask 提交；后端仅在实例到达
   * 终态 APPROVED 时投影到 plan_report_indicator.appraisal_level。
   */
  /** 按实例 ID 从上报待办列表兜底取业务实体（报告）ID */
  async function handleRejectMutation(item: PlanApprovalDetailItem) {
    const mutationInstanceIds = resolveMutationInstanceIds(item)
    if (mutationInstanceIds.length === 0) {
      ElMessage.warning('未找到该异动的审批实例，请刷新后重试')
      return
    }
    if (!canCurrentUserHandleMutationApproval(item)) {
      ElMessage.warning('当前审批节点不是你，无法执行审批驳回')
      return
    }

    let reason = '审批驳回'
    try {
      const batchSuffix =
        mutationInstanceIds.length > 1
          ? `（本次异动共 ${mutationInstanceIds.length} 项，将一并退回）`
          : ''
      const { value } = await ElMessageBox.prompt(
        `请输入驳回原因（驳回后将退回上一节点）${batchSuffix}`,
        '审批驳回',
        {
          confirmButtonText: '确认驳回',
          cancelButtonText: '取消',
          inputPlaceholder: '请输入驳回原因',
          inputType: 'textarea',
          inputValidator: (val: string) => (String(val || '').trim() ? true : '驳回原因不能为空')
        }
      )
      reason = String(value || '').trim()
    } catch {
      return
    }

    const loadingInstance = ElLoading.service({
      lock: true,
      text: '正在提交驳回...',
      background: 'rgba(0, 0, 0, 0.7)'
    })
    try {
      const userId = state.authStore.user?.userId || state.authStore.user?.id || 1
      const failures: string[] = []
      for (const instanceId of mutationInstanceIds) {
        try {
          const response = await approvalApi.rejectPlan(instanceId, userId, reason)
          if (!response.success) {
            pushMutationApprovalFailure(failures, instanceId, response.message || '驳回失败')
          }
        } catch (error) {
          // 2026-10-30 双弹修复：同 handleApproveMutation——标记已处理，拦截器不再兜底弹
          markErrorHandled(error)
          pushMutationApprovalFailure(failures, instanceId, (error as Error)?.message || '驳回失败')
        }
      }
      if (failures.length > 0) {
        // 2026-10-30 用户定案：单实例失败只弹该实例的错误原文；多实例失败只弹汇总
        showApprovalFailureMessage(
          failures.length === 1
            ? failures[0]
            : `有 ${failures.length} 项驳回未成功：${failures[0]}（其余可能已退回，请刷新确认）`,
          item as unknown as Record<string, unknown>
        )
        return
      }
      ElMessage.success(
        mutationInstanceIds.length > 1
          ? `已驳回本次异动全部 ${mutationInstanceIds.length} 项`
          : '已驳回'
      )
      await refreshPlanApprovalAfterMutation()
      emit('refresh', {})
    } finally {
      loadingInstance.close()
    }
  }

  // 2026-10-30 用户定案：异动卡「撤回」按钮移除（撤回统一走战略任务页工具栏的
  // 多态「撤回」按钮），canCurrentUserWithdrawMutation / handleWithdrawMutation
  // 随之删除——异动撤回的取消接口（POST /workflows/{id}/cancel）改由
  // useStrategicTaskView 的工具栏撤回分支调用，口径保持同源。

  async function handleApprovePlanBatch() {
    if (!state.hasPlanApprovalPermission.value) {
      ElMessage.warning('当前角色或组织范围不匹配该审批节点，无法执行审批通过')
      return
    }

    if (state.hasPlanWorkflowData.value) {
      await loadPlanWorkflowDetail()
    }

    if (state.currentPlanTaskId.value) {
      if (!state.canCurrentUserHandlePlanApproval.value) {
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
          const userId = state.authStore.user?.userId || state.authStore.user?.id || 1
          const response = await approvalApi.approvePlan(
            state.currentPlanTaskId.value,
            userId,
            value || '审批通过'
          )
          if (!response.success) {
            // 2026-10-30 用户定案：「未完成审核」类拦截走带跳转的 Notification，
            // 其余保持原样 toast（单实例失败只弹这一条）
            showApprovalFailureMessage(response.message || '审批失败')
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
          state.handleClose()
        } finally {
          loadingInstance.close()
        }
        return
      } catch (error) {
        // 用户取消输入框：不是失败，静默返回（抽屉保持打开）
        if (isPromptDismissed(error)) {
          return
        }
        // 2026-10-29 修复（N-02「点了没反应」）：响应拦截器 reject 后，
        // 错误原先被整个吞掉——既没有提示也没有回源刷新，弹窗像卡住不动。
        // 这里把后端返回的原文透出，抽屉保持打开。
        showApprovalErrorToast(error, '审批失败')
      }
    }

    if (state.scopedPlanApprovals.value.length === 0) {
      // 2026-10-31（C-4）空态守卫口径统一：还有历史/上报/异动/退回可展示条目时
      // 不弹「暂无待审批实例」——避免与同屏卡片自相矛盾；真正空数据才提示。
      if (!state.hasAnyDisplayableApprovalEntry.value) {
        ElMessage.warning('当前计划暂无待审批实例')
      }
      return
    }

    // 2026-10-30 跳转增强：记录失败实例，供外层 catch 的「未完成审核」拦截通知解析跳转路由
    let batchFailureInstance: Record<string, unknown> | null = null

    try {
      const { value } = await ElMessageBox.prompt(
        `确认一键审批通过“${state.currentPlanApprovalSummary.value?.planName || '当前计划'}”下的 ${state.scopedPlanApprovals.value.length} 条审批实例？`,
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
        const userId = state.authStore.user?.userId || state.authStore.user?.id || 1
        for (const instance of state.scopedPlanApprovals.value) {
          batchFailureInstance = instance as Record<string, unknown>
          const response = await approvalApi.approvePlan(
            instance.instanceId,
            userId,
            value || '审批通过'
          )
          if (!response.success) {
            showApprovalFailureMessage(response.message || '审批失败', batchFailureInstance)
            // 2026-10-07：批量中途失败也要回源收尾——前面的实例已提交成功，
            // 跳过刷新会让抽屉停留旧状态
            await refreshPlanApprovalAfterMutation()
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
        ElMessage.success(`已一键通过 ${state.scopedPlanApprovals.value.length} 条审批实例`)
        state.handleClose()
      } finally {
        loadingInstance.close()
      }
    } catch (error) {
      // 用户取消输入框：不是失败，静默返回
      if (isPromptDismissed(error)) {
        return
      }
      // 2026-10-29 修复（N-02）：批量通过时实例接口抛错原先被整个吞掉，
      // 用户只看到「点了没反应」。这里把后端原文透出。
      showApprovalErrorToast(error, '审批失败', batchFailureInstance)
      // 批量中途失败也要回源收尾——前面的实例已提交成功，跳过刷新会让抽屉停留旧状态
      await refreshPlanApprovalAfterMutation().catch(() => undefined)
    }
  }

  async function handleRejectPlanBatch() {
    if (!state.hasPlanApprovalPermission.value) {
      ElMessage.warning('当前角色或组织范围不匹配该审批节点，无法执行审批驳回')
      return
    }

    if (state.hasPlanWorkflowData.value) {
      await loadPlanWorkflowDetail()
    }

    if (state.currentPlanTaskId.value) {
      if (!state.canCurrentUserHandlePlanApproval.value) {
        ElMessage.warning('当前审批节点不是你，无法执行审批驳回')
        return
      }

      try {
        const { value } = await ElMessageBox.prompt(
          `确认驳回“${props.plan?.name || props.planName || '当前计划'}”的审批？`,
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
          const userId = state.authStore.user?.userId || state.authStore.user?.id || 1
          const response = await approvalApi.rejectPlan(
            state.currentPlanTaskId.value,
            userId,
            value
          )
          if (!response.success) {
            // 2026-10-30 双弹修复：单实例失败只弹这一条（统一出口，含消息级去重）
            showApprovalFailureMessage(response.message || '驳回失败')
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
          ElMessage.success('审批已驳回')
          state.handleClose()
        } finally {
          loadingInstance.close()
        }
        return
      } catch (error) {
        // 用户取消输入框：不是失败，静默返回（抽屉保持打开）
        if (isPromptDismissed(error)) {
          return
        }
        // 2026-10-29 修复（N-02「点了没反应」）：响应拦截器 reject 后，
        // 错误原先被整个吞掉——既没有提示也没有回源刷新，弹窗像卡住不动。
        // 这里把后端返回的原文透出，抽屉保持打开。
        showApprovalErrorToast(error, '驳回失败')
      }
    }

    if (state.scopedPlanApprovals.value.length === 0) {
      // 2026-10-31（C-4）空态守卫口径统一：还有历史/上报/异动/退回可展示条目时
      // 不弹「暂无待审批实例」——避免与同屏卡片自相矛盾；真正空数据才提示。
      if (!state.hasAnyDisplayableApprovalEntry.value) {
        ElMessage.warning('当前计划暂无待审批实例')
      }
      return
    }

    // 2026-10-30 双弹修复：记录失败实例，供外层 catch 的统一出口解析上下文
    let batchFailureInstance: Record<string, unknown> | null = null

    try {
      const { value } = await ElMessageBox.prompt(
        `确认一键驳回“${state.currentPlanApprovalSummary.value?.planName || '当前计划'}”下的 ${state.scopedPlanApprovals.value.length} 条审批实例？`,
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
        const userId = state.authStore.user?.userId || state.authStore.user?.id || 1
        for (const instance of state.scopedPlanApprovals.value) {
          batchFailureInstance = instance as Record<string, unknown>
          const response = await approvalApi.rejectPlan(instance.instanceId, userId, value)
          if (!response.success) {
            showApprovalFailureMessage(response.message || '拒绝失败', batchFailureInstance)
            // 2026-10-07：批量中途失败也要回源收尾，避免抽屉停留旧状态
            await refreshPlanApprovalAfterMutation()
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
        ElMessage.success(`已一键驳回 ${state.scopedPlanApprovals.value.length} 条审批实例`)
        state.handleClose()
      } finally {
        loadingInstance.close()
      }
    } catch (error) {
      // 用户取消输入框：不是失败，静默返回
      if (isPromptDismissed(error)) {
        return
      }
      // 2026-10-29 修复（N-02）：批量驳回时实例接口抛错原先被整个吞掉，
      // 用户只看到「点了没反应」。这里把后端原文透出。
      showApprovalErrorToast(error, '驳回失败', batchFailureInstance)
      // 批量中途失败也要回源收尾，避免抽屉停留旧状态
      await refreshPlanApprovalAfterMutation().catch(() => undefined)
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

  async function loadPlanReportSnapshotById(reportId?: number | string | null) {
    const normalizedReportId = Number(reportId ?? NaN)
    if (!Number.isFinite(normalizedReportId) || normalizedReportId <= 0) {
      state.selectedPlanReportSnapshot.value = null
      state.selectedPlanReportSnapshotLoading.value = false
      return
    }

    state.selectedPlanReportSnapshot.value = null
    state.selectedPlanReportSnapshotLoading.value = true
    try {
      const response = await apiClient.get<ApiResponse<PlanReportSnapshotSummary>>(
        `/reports/${normalizedReportId}`
      )

      if (response.code === 200 && response.data) {
        state.selectedPlanReportSnapshot.value = response.data
        return
      }

      state.selectedPlanReportSnapshot.value = null
    } catch (error) {
      state.selectedPlanReportSnapshot.value = null
      logger.warn('[DistributionApprovalProgressDrawer] 加载审批业务快照失败:', {
        reportId: normalizedReportId,
        error
      })
    } finally {
      state.selectedPlanReportSnapshotLoading.value = false
    }
  }

  async function loadSelectedHistoryInstanceDetail(instanceId?: number | string | null) {
    const normalizedInstanceId = String(instanceId || '').trim()
    if (!normalizedInstanceId) {
      state.selectedHistoryInstanceId.value = null
      state.selectedHistoryInstanceDetail.value = null
      state.selectedHistoryInstanceDetailLoading.value = false
      state.selectedPlanReportSnapshot.value = null
      state.selectedPlanReportSnapshotLoading.value = false
      return
    }

    state.selectedHistoryInstanceId.value = normalizedInstanceId
    const cachedDetail = state.historyInstanceDetailCache.value[normalizedInstanceId]
    if (cachedDetail) {
      state.selectedHistoryInstanceDetail.value = cachedDetail
      state.selectedHistoryInstanceDetailLoading.value = false
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
        state.selectedPlanReportSnapshot.value = null
        state.selectedPlanReportSnapshotLoading.value = false
      }
      return
    }

    state.selectedHistoryInstanceDetailLoading.value = true
    state.selectedHistoryInstanceDetail.value = null

    try {
      const response = await getWorkflowInstanceDetail(normalizedInstanceId)
      state.selectedHistoryInstanceDetail.value = response.success ? (response.data ?? null) : null
      if (response.success && response.data) {
        state.historyInstanceDetailCache.value = {
          ...state.historyInstanceDetailCache.value,
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
          state.selectedPlanReportSnapshot.value = null
        }
      }
    } catch (error) {
      state.selectedHistoryInstanceDetail.value = null
      logger.warn('[ApprovalProgressDrawer] 加载历史审批实例详情失败:', {
        instanceId: normalizedInstanceId,
        error
      })
    } finally {
      state.selectedHistoryInstanceDetailLoading.value = false
    }
  }

  async function openPlanApprovalDetails(item?: PlanApprovalDetailItem) {
    // 2026-10-31（C-4）空态守卫口径统一：上报待办/异动在审/退回待重报也是可查看
    // 详情的数据源——只有全部可展示条目为空才提示空态（口径集中在 state 定义）。
    if (!state.hasAnyDisplayableApprovalEntry.value) {
      ElMessage.warning('当前计划暂无待审批实例')
      return
    }

    state.planDetailDialogVisible.value = true

    if (item?.instanceId) {
      void loadSelectedHistoryInstanceDetail(item.instanceId)
      return
    }

    state.selectedHistoryInstanceId.value = null
    state.selectedHistoryInstanceDetail.value = null
    state.selectedHistoryInstanceDetailLoading.value = false
    if (
      state.hasRelatedPlanReportActiveWorkflow.value &&
      state.relatedPlanReportSummary.value?.id
    ) {
      void loadPlanReportSnapshotById(state.relatedPlanReportSummary.value.id)
      return
    }
    state.selectedPlanReportSnapshot.value = null
    state.selectedPlanReportSnapshotLoading.value = false
  }

  async function refreshPlanWorkflowContext(
    options: { retryActive?: boolean } = {}
  ): Promise<void> {
    await loadRelatedPlanReportSummary()
    await loadPlanWorkflowDetail({ retryActive: options.retryActive })
    await loadWorkflowDefinitionPreview()
    await ensureWorkflowRelatedAvatarsLoaded()
    await loadPlanWorkflowHistoryCards()
  }

  // 2026-10-26：部门计划族实体（relatedWorkflowEntities）由页面异步构造，
  // 晚于抽屉打开时的首次历史加载——实体就绪后重拉审批历史，否则
  // 「学院 → 本部门」的上报历史卡片在首次打开时不出现。
  watch(
    () => props.relatedWorkflowEntities,
    async (next, prev) => {
      if (!props.modelValue || !props.showPlanApprovals) {
        return
      }
      if (JSON.stringify(next ?? []) === JSON.stringify(prev ?? [])) {
        return
      }
      await loadPlanWorkflowHistoryCards()
    },
    { deep: true }
  )

  const handleApprovalStateRefresh = (event?: Event) => {
    if (!props.modelValue || !props.showPlanApprovals) {
      return
    }

    const source = String(
      (event as CustomEvent<{ source?: string }> | undefined)?.detail?.source || ''
    )
    const retryActive = source.includes('plan-submit') || isActivePlanStatus()

    state.historyInstanceDetailCache.value = {}
    state.selectedHistoryInstanceId.value = null
    state.selectedHistoryInstanceDetail.value = null
    state.selectedHistoryInstanceDetailLoading.value = false
    void loadPendingPlanApprovals()
    void refreshPlanWorkflowContext({ retryActive })
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

  watch(
    () => props.modelValue,
    async val => {
      if (val) {
        // 2026-10-30 用户定案：有待处理内容默认落「计划审批」，纯查看才落「审批历史」。
        // 待处理口径 = 计划在审 + 关联上报在审 + 异动在审 + 通用上报待办；
        // 此前漏掉异动/上报待办，按钮处于「处理审批」状态时抽屉会落在空的「审批历史」页签。
        state.activeTab.value = props.showPlanApprovals
          ? state.isPlanPendingApproval.value ||
            state.hasRelatedPlanReportActiveWorkflow.value ||
            state.pendingMutationApprovalItems.value.length > 0 ||
            state.pendingReportApprovalItems.value.length > 0
            ? 'pending-plans'
            : 'history'
          : state.hasWorkflowTabContent.value
            ? 'workflow'
            : 'history'
        state.cacheSubmitterName(props.plan?.submittedBy, props.plan?.submittedByName)
        state.cacheSubmitterName(props.plan?.createdBy, props.plan?.createdByName)
        if (!state.normalizeDisplayName(props.plan?.submittedByName)) {
          void ensureSubmitterNameLoaded(props.plan?.submittedBy, props.plan?.createdByName)
        }
        void loadPendingPlanApprovals()
        await refreshPlanWorkflowContext()
      } else {
        state.selectedHistoryInstanceId.value = null
        state.selectedHistoryInstanceDetail.value = null
        state.selectedPlanReportSnapshot.value = null
        state.selectedPlanReportSnapshotLoading.value = false
      }
    }
  )

  watch(
    () => props.initialPlanWorkflowDetail,
    detail => {
      if (detail && shouldIgnoreWorkflowDetail(detail)) {
        state.planWorkflowDetail.value = null
        if (props.modelValue) {
          void loadPlanWorkflowDetail({ retryActive: true })
        }
        return
      }

      state.planWorkflowDetail.value = detail ?? null
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
      JSON.stringify(props.plan?.workflowHistory ?? []),
      state.expectedWorkflowCodes.value.join('|'),
      props.workflowEntityType,
      props.workflowEntityId,
      props.secondaryWorkflowEntityType,
      props.secondaryWorkflowEntityId
    ],
    async ([
      showPlanApprovals,
      planId,
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      ,
      workflowEntityId,
      secondaryWorkflowEntityType,
      secondaryWorkflowEntityId
    ]) => {
      if (
        !showPlanApprovals ||
        !(workflowEntityId || planId || secondaryWorkflowEntityId || secondaryWorkflowEntityType)
      ) {
        state.planWorkflowDetail.value = null
        state.relatedPlanReportSummary.value = null
        state.planWorkflowHistoryCards.value = []
        return
      }

      state.planWorkflowDetail.value = null
      await refreshPlanWorkflowContext()
    },
    { immediate: true }
  )

  watch(
    () => [state.planWorkflowDetail.value?.flowCode, props.workflowCode],
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
      state.planWorkflowTasks.value.map(task => task.assigneeId).join('|'),
      (state.workflowDefinitionPreview.value?.steps || [])
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
    () => state.relatedPlanReportSummary.value?.id,
    () => {
      if (!props.modelValue || !props.showPlanApprovals) {
        return
      }

      if (state.hasRelatedPlanReportActiveWorkflow.value) {
        state.activeTab.value = 'pending-plans'
      }
    }
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

      state.cacheSubmitterName(submittedBy, submittedByName)
      state.cacheSubmitterName(createdBy, createdByName)
      if (!state.normalizeDisplayName(submittedByName)) {
        void ensureSubmitterNameLoaded(submittedBy, state.normalizeDisplayName(createdByName))
      }
    },
    { immediate: true }
  )

  return {
    applyOptimisticPlanWorkflowPatch,
    ensureSubmitterNameLoaded,
    ensureWorkflowRelatedAvatarsLoaded,
    ensureWorkflowUserAvatarLoaded,
    formatTime,
    canCurrentUserHandleMutationApproval,
    handleApproveMutation,
    handleApprovePlanBatch,
    handleRejectMutation,
    handleRejectPlanBatch,
    loadPendingPlanApprovals,
    loadPlanWorkflowDetail,
    loadPlanWorkflowHistoryCards,
    loadSelectedHistoryInstanceDetail,
    loadWorkflowDefinitionPreview,
    openPlanApprovalDetails,
    refreshPlanWorkflowContext,
    refreshPlanApprovalAfterMutation
  }
}
