import { onMounted, onUnmounted, watch } from 'vue'
import { ElLoading, ElMessage, ElMessageBox } from 'element-plus'
import { approvalApi } from '@/features/task/api/strategicApi'
import { decideTask } from '@/features/workflow/api/mutations'
import { indicatorFillApi } from '@/features/plan/api/planApi'
import { tryGetUserById } from '@/features/user/api/query'
import { APPROVAL_STATE_REFRESH_EVENT, notifyApprovalStateRefresh } from '@/features/approval/lib'
import { apiClient } from '@/shared/api'
import type { ApiResponse } from '@/shared/types'
import { logger } from '@/shared/lib/utils/logger'
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

export function useApprovalProgressWorkflow({
  props,
  emit,
  state
}: UseApprovalProgressWorkflowOptions) {
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

    // 2026-10-24 用户定案（指标级鉴定）：上报链末级审批节点（上级部门鉴定环节）
    // 不再弹确认框——打开审批详情，逐指标评定等级后点「确认通过」提交。
    const isAppraisal = await state.resolveIsReportApprovalChainItem(
      item as unknown as Record<string, any>
    )
    state.appraisalDialogActive.value = isAppraisal
    state.appraisalDialogInstanceId.value = isAppraisal ? item.instanceId : null
    if (isAppraisal) {
      // 直接驱动详情弹窗原语（openPlanApprovalDetails 的计划空态守卫会拦下报告实例）
      state.planDetailDialogVisible.value = true
      await state.loadSelectedHistoryInstanceDetail(item.instanceId)
      ElMessage.info('请在详情中逐指标评定「鉴定进度等级」，然后点击「确认通过」')
      return
    }

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
            failures.push(`${instanceId}: ${response.message || '审批失败'}`)
          }
        } catch (error) {
          failures.push(`${instanceId}: ${(error as Error)?.message || '审批失败'}`)
        }
      }
      if (failures.length > 0) {
        ElMessage.error(`有 ${failures.length} 项审批未成功：${failures[0]}`)
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
  function itemEntityIdOfInstance(instanceId: number | string | null | undefined): number {
    const entry = (state.pendingReportApprovalItems.value as Array<Record<string, any>>).find(
      candidate => String(candidate.instanceId) === String(instanceId)
    )
    const entityId = Number(entry?.entityId)
    return Number.isFinite(entityId) ? entityId : NaN
  }

  async function confirmAppraisalDialogApproval() {
    // 读打开弹窗时快照的实例 ID（全局 selectedHistoryInstanceId 会被刷新事件异步清空）
    const instanceId = state.appraisalDialogInstanceId.value
    if (!instanceId) {
      ElMessage.warning('未找到当前审批实例，请重新打开详情')
      return
    }

    const reportId = Number(
      state.selectedPlanReportSnapshot.value?.id ?? itemEntityIdOfInstance(instanceId)
    )
    const indicatorLevels = state.collectPlanIndicatorAppraisalLevels(
      Number.isFinite(reportId) ? reportId : null
    )

    const loadingInstance = ElLoading.service({
      lock: true,
      text: '正在提交审批与鉴定等级...',
      background: 'rgba(0, 0, 0, 0.7)'
    })
    try {
      const response = await decideTask(String(instanceId), {
        approved: true,
        comment: '审批通过',
        indicatorLevels: Object.keys(indicatorLevels).length > 0 ? indicatorLevels : undefined
      })
      if (!response.success) {
        ElMessage.error(response.message || '审批失败')
        return
      }
      state.clearPlanIndicatorAppraisalLevels()
      state.appraisalDialogActive.value = false
      state.appraisalDialogInstanceId.value = null
      state.planDetailDialogVisible.value = false
      ElMessage.success('审批通过')
      await refreshPlanApprovalAfterMutation()
      emit('refresh', {})
    } catch (error) {
      ElMessage.error((error as Error)?.message || '审批失败')
    } finally {
      loadingInstance.close()
    }
  }

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
            failures.push(`${instanceId}: ${response.message || '驳回失败'}`)
          }
        } catch (error) {
          failures.push(`${instanceId}: ${(error as Error)?.message || '驳回失败'}`)
        }
      }
      if (failures.length > 0) {
        ElMessage.error(
          `有 ${failures.length} 项驳回未成功：${failures[0]}${
            failures.length > 1 ? '（其余可能已退回，请刷新确认）' : ''
          }`
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

  /**
   * 异动撤回：与上报审批的「一键撤回」同源——都调 POST /workflows/{instanceId}/cancel，
   * 后端 BusinessWorkflowApplicationService.cancelInstance 校验「只有发起人可撤回」，
   * 且取消窗口由 AuditInstance.canRequesterWithdraw() 卡住（负责人通过后即不可撤回）。
   * 撤回后走 WorkflowBusinessStatusSyncService → 清 mutation_status，指标回到稳定态。
   */
  function canCurrentUserWithdrawMutation(item: PlanApprovalDetailItem): boolean {
    const instanceId = Number(item.instanceId)
    if (!Number.isFinite(instanceId) || instanceId <= 0) {
      return false
    }
    // 只有发起人可撤回：卡片上的提交人姓名与当前登录人比对
    const currentUserName = String(
      state.authStore.user?.realName || state.authStore.user?.userName || ''
    ).trim()
    const submitterName = String(item.submitterName || '').trim()
    if (!currentUserName || !submitterName || currentUserName !== submitterName) {
      return false
    }
    // 只在审批中可撤回
    const stepName = String(item.currentStepName || '')
    return !stepName.includes('终审') && !stepName.includes('分管校领导')
  }

  async function handleWithdrawMutation(item: PlanApprovalDetailItem) {
    // 2026-10-22：同审批/驳回——一次异动提交对应多个实例，撤回必须整批一起撤，
    // 否则会留下一半仍在审批中的实例。
    const instanceIds = resolveMutationInstanceIds(item)
    if (instanceIds.length === 0) {
      ElMessage.warning('未找到该异动的审批实例，请刷新后重试')
      return
    }

    try {
      const batchSuffix =
        instanceIds.length > 1 ? `\n\n本次异动共 ${instanceIds.length} 项，将一并撤回。` : ''
      await ElMessageBox.confirm(
        `确认撤回本次异动审批？${batchSuffix}\n\n撤回后异动回到未提交状态，改动内容保留，可重新修改后再发起。`,
        '撤回异动审批',
        { confirmButtonText: '确定撤回', cancelButtonText: '取消', type: 'warning' }
      )
    } catch {
      return
    }

    const loadingInstance = ElLoading.service({
      lock: true,
      text: '正在撤回...',
      background: 'rgba(0, 0, 0, 0.7)'
    })
    try {
      const { cancelWorkflow } = await import('@/features/workflow/api/mutations')
      const failures: string[] = []
      for (const instanceId of instanceIds) {
        try {
          const response = await cancelWorkflow(String(instanceId))
          if (!response.success) {
            failures.push(`${instanceId}: ${response.message || '撤回失败'}`)
          }
        } catch (error) {
          failures.push(`${instanceId}: ${(error as Error)?.message || '撤回失败'}`)
        }
      }
      if (failures.length > 0) {
        ElMessage.error(`有 ${failures.length} 项撤回未成功：${failures[0]}`)
        return
      }
      ElMessage.success(
        instanceIds.length > 1
          ? `已撤回本次异动全部 ${instanceIds.length} 项`
          : '已撤回本次异动审批'
      )
      await refreshPlanApprovalAfterMutation()
      // 异动卡片的列表由父组件（StrategicTaskView）按部门拉取后经 prop 传入，
      // 这里必须通知父组件重新拉取，否则撤回成功后卡片仍停留在「审批中」。
      emit('refresh', {})
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : '撤回失败')
    } finally {
      loadingInstance.close()
    }
  }

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
          state.handleClose()
        } finally {
          loadingInstance.close()
        }
        return
      } catch {
        return
      }
    }

    if (state.scopedPlanApprovals.value.length === 0) {
      ElMessage.warning('当前计划暂无待审批实例')
      return
    }

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
          const response = await approvalApi.approvePlan(
            instance.instanceId,
            userId,
            value || '审批通过'
          )
          if (!response.success) {
            ElMessage.error(response.message || '审批失败')
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
    } catch {
      // 批量通过失败时静默处理，已在内部显示错误提示
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
          ElMessage.success('审批已驳回')
          state.handleClose()
        } finally {
          loadingInstance.close()
        }
        return
      } catch {
        return
      }
    }

    if (state.scopedPlanApprovals.value.length === 0) {
      ElMessage.warning('当前计划暂无待审批实例')
      return
    }

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
          const response = await approvalApi.rejectPlan(instance.instanceId, userId, value)
          if (!response.success) {
            ElMessage.error(response.message || '拒绝失败')
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
    } catch {
      // 批量驳回失败时静默处理，已在内部显示错误提示
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
    if (
      state.currentPlanApprovalItems.value.length === 0 &&
      state.historicalPlanApprovalItems.value.length === 0 &&
      !state.hasPlanWorkflowData.value
    ) {
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
        state.activeTab.value = props.showPlanApprovals
          ? state.isPlanPendingApproval.value || state.hasRelatedPlanReportActiveWorkflow.value
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
    canCurrentUserWithdrawMutation,
    handleApproveMutation,
    confirmAppraisalDialogApproval,
    handleApprovePlanBatch,
    handleRejectMutation,
    handleRejectPlanBatch,
    handleWithdrawMutation,
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
