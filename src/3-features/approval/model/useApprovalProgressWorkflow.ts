import { watch } from 'vue'
import { ElLoading, ElMessage, ElMessageBox } from 'element-plus'
import { approvalApi } from '@/features/task/api/strategicApi'
import { indicatorFillApi } from '@/features/plan/api/planApi'
import { tryGetUserById } from '@/features/user/api/query'
import { notifyApprovalStateRefresh } from '@/features/approval/lib'
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

  async function loadPlanWorkflowDetail() {
    if (!props.showPlanApprovals || !props.plan) {
      state.planWorkflowDetail.value = null
      return
    }

    const requestSeq = ++state.planWorkflowDetailRequestSeq.value

    try {
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
          state.matchesExpectedWorkflowCode(response.data.flowCode)
        ) {
          state.planWorkflowDetail.value = response.data
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
          state.matchesExpectedWorkflowCode(response.data.flowCode)
        ) {
          state.planWorkflowDetail.value = response.data
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
          state.matchesExpectedWorkflowCode(response.data.flowCode)
        ) {
          state.planWorkflowDetail.value = response.data
          return
        }
      }

      if (requestSeq === state.planWorkflowDetailRequestSeq.value) {
        state.planWorkflowDetail.value = null
      }
    } catch (error) {
      if (requestSeq === state.planWorkflowDetailRequestSeq.value) {
        state.planWorkflowDetail.value = null
      }
      logger.warn('[ApprovalProgressDrawer] 加载计划工作流详情失败:', error)
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

    const date = new Date(timestamp)
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

  watch(
    () => props.modelValue,
    val => {
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
        void loadPlanWorkflowDetail()
        void loadRelatedPlanReportSummary()
        void loadWorkflowDefinitionPreview()
        void ensureWorkflowRelatedAvatarsLoaded()
        void loadPlanWorkflowHistoryCards()
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
    ([
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
      void loadPlanWorkflowDetail()
      void loadRelatedPlanReportSummary()
      void loadWorkflowDefinitionPreview()
      void ensureWorkflowRelatedAvatarsLoaded()
      void loadPlanWorkflowHistoryCards()
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

      state.planWorkflowDetail.value = null
      void loadPlanWorkflowDetail()
      void loadWorkflowDefinitionPreview()
      void ensureWorkflowRelatedAvatarsLoaded()
      void loadPlanWorkflowHistoryCards()

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
    handleApprovePlanBatch,
    handleRejectPlanBatch,
    loadPendingPlanApprovals,
    loadPlanWorkflowDetail,
    loadPlanWorkflowHistoryCards,
    loadSelectedHistoryInstanceDetail,
    loadWorkflowDefinitionPreview,
    openPlanApprovalDetails,
    refreshPlanApprovalAfterMutation
  }
}
