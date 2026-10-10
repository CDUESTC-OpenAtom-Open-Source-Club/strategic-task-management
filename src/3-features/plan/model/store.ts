/**
 * Plan Feature Store
 *
 * Migrated from stores/plan.ts
 * Plan management state (Plan -> Task -> Indicator -> IndicatorFill)
 */

import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Plan, PlanStatus, PlanFill, IndicatorFill, IndicatorFillForm } from '@/shared/types'
import { useAuthStore } from '@/features/auth/model/store'
import { useTimeContextStore } from '@/shared/lib/timeContext'
import { logger } from '@/shared/lib/utils/logger'
import { withExponentialRetry } from '@/shared/api/wrappers'
import { ElMessage } from 'element-plus'

function hasApiData<T>(response: { success?: boolean; code?: number; data?: T | null }) {
  return (
    (response.success ?? response.code === 200) &&
    response.data !== undefined &&
    response.data !== null
  )
}

export const usePlanStore = defineStore('plan', () => {
  // ============ State ============
  const plans = ref<Plan[]>([])
  const currentPlan = ref<Plan | null>(null)
  const planFills = ref<PlanFill[]>([])
  const currentPlanFill = ref<PlanFill | null>(null)
  const currentIndicatorFill = ref<IndicatorFill | null>(null)

  const loading = ref(false)
  const submitting = ref(false)
  const error = ref<string | null>(null)
  const loadingPlansPromise = ref<Promise<Plan[]> | null>(null)

  const filterStatus = ref<PlanStatus | 'all'>('all')
  const filterOrgId = ref<number | string | null>(null)

  // ============ Getters ============
  const filteredPlans = computed(() => {
    let result = plans.value

    if (filterStatus.value !== 'all') {
      result = result.filter(p => p.status === filterStatus.value)
    }

    if (filterOrgId.value) {
      result = result.filter(p => p.org_id === filterOrgId.value)
    }

    return result
  })

  const visiblePlans = computed(() => {
    const authStore = useAuthStore()
    const rawUserOrgId = authStore.user?.orgId
    const userOrgId =
      typeof rawUserOrgId === 'number'
        ? rawUserOrgId
        : typeof rawUserOrgId === 'string'
          ? Number(rawUserOrgId)
          : NaN

    if (authStore.user?.role === 'strategic_dept') {
      return filteredPlans.value
    }

    if (!Number.isFinite(userOrgId)) {
      return []
    }

    return filteredPlans.value.filter(p => p.org_id === userOrgId)
  })

  const getPlanById = (id: number | string) => {
    return plans.value.find(p => p.id === id)
  }

  const getPlanFillsByPlanId = (planId: number | string) => {
    return planFills.value.filter(fill => String(fill.planId) === String(planId))
  }

  const pendingPlanFills = computed(() => {
    return planFills.value.filter(pf => pf.status === 'submitted')
  })

  const visiblePendingFills = computed(() => {
    const authStore = useAuthStore()
    const userId = authStore.user?.id

    if (!userId || authStore.user?.role === 'strategic_dept') {
      return pendingPlanFills.value
    }

    return pendingPlanFills.value.filter(fill => fill.submitted_by !== userId)
  })

  const resolvePlanYear = (plan: Plan): number | null => {
    const planRecord = plan as Plan & {
      year?: number | string
      cycleId?: number | string
      cycle?: { year?: number | string }
    }
    const explicitYear = planRecord.year ?? planRecord.cycle?.year
    if (explicitYear != null && explicitYear !== '') {
      const numericYear = Number(explicitYear)
      return Number.isFinite(numericYear) ? numericYear : null
    }

    return useTimeContextStore().resolveCycleYear(planRecord.cycleId)
  }

  // ============ Actions ============
  const loadPlans = async (options: { force?: boolean; background?: boolean } = {}) => {
    if (!options.force && plans.value.length > 0) {
      return plans.value
    }
    if (loadingPlansPromise.value) {
      return loadingPlansPromise.value
    }

    loading.value = true
    error.value = null

    const request = (async () => {
      try {
        logger.info('[Plan Store] Loading plans...')
        const { planApi } = await import('@/features/plan/api/planApi')
        const response = await withExponentialRetry(() => planApi.getAllPlans(), {
          maxRetries: 3,
          baseDelay: 800,
          maxDelay: 2500
        })

        if (hasApiData(response)) {
          plans.value = response.data
          logger.info(`[Plan Store] Loaded ${response.data.length} plans`)
          return response.data
        }

        plans.value = []
        logger.warn('[Plan Store] No plans loaded')
        return []
      } catch (err) {
        error.value =
          err instanceof Error
            ? err.message
            : err && typeof err === 'object' && 'message' in err
              ? String((err as { message: unknown }).message)
              : '加载计划失败'
        logger.error('[Plan Store] Failed to load plans:', error.value)
        ElMessage.error('加载计划失败')
        return []
      } finally {
        loading.value = false
        loadingPlansPromise.value = null
      }
    })()

    loadingPlansPromise.value = request
    return request
  }

  const loadPlan = async (
    planId: number | string,
    options: { force?: boolean; background?: boolean } = {}
  ) => {
    if (!options.force) {
      const existing = plans.value.find(p => p.id === planId)
      if (existing) {
        currentPlan.value = existing
        return existing
      }
    }

    if (!options.background) {
      loading.value = true
    }
    error.value = null

    try {
      logger.info(`[Plan Store] Loading plan ${planId}...`)
      const { planApi } = await import('@/features/plan/api/planApi')
      const response = await planApi.getPlanById(planId)

      if (hasApiData(response)) {
        currentPlan.value = response.data
        const index = plans.value.findIndex(p => p.id === planId)
        if (index !== -1) {
          plans.value[index] = response.data
        } else {
          plans.value.push(response.data)
        }
        logger.info(`[Plan Store] Loaded plan ${planId}`)
        return response.data
      } else {
        currentPlan.value = null
        error.value = '计划不存在'
        return null
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : '加载计划失败'
      logger.error('[Plan Store] Failed to load plan:', err)
      return null
    } finally {
      if (!options.background) {
        loading.value = false
      }
    }
  }

  /**
   * 加载 Plan 详情（包含指标和里程碑）
   * 调用后端的 /api/v1/plans/{id}/details 接口
   */
  const loadPlanDetails = async (
    planId: number | string,
    options: { force?: boolean; background?: boolean } = {}
  ) => {
    if (!options.force && currentPlan.value?.id === planId && currentPlan.value.tasks?.length) {
      return currentPlan.value
    }

    if (!options.background) {
      loading.value = true
    }
    error.value = null

    try {
      logger.info(`[Plan Store] Loading plan details ${planId}...`)
      const { planApi } = await import('@/features/plan/api/planApi')
      const response = await planApi.getPlanDetails(planId)

      if (hasApiData(response) && response.data) {
        const existingPlan = plans.value.find(p => p.id === planId)
        const existingStatus = String(
          (existingPlan as (Plan & { status?: unknown }) | undefined)?.status || ''
        )
          .trim()
          .toUpperCase()
        const incomingStatus = String((response.data as Plan & { status?: unknown }).status || '')
          .trim()
          .toUpperCase()
        const incomingWorkflowStatus = String(
          (response.data as Plan & { workflowStatus?: unknown }).workflowStatus || ''
        )
          .trim()
          .toUpperCase()
        // 2026-10-10 跨窗口实时修复：乐观保护只针对「提交后工作流异步落库」的窗口期，
        // 即详情回包没有带回明确工作流状态的情况。若回包已带权威终态（撤回/驳回/通过/下发），
        // 说明其他窗口/用户完成了真实状态流转，必须采用，否则本窗口会永远卡在旧的「审批中」。
        const AUTHORITATIVE_WORKFLOW_STATUSES = [
          'WITHDRAWN',
          'CANCELLED',
          'REJECTED',
          'RETURNED',
          'APPROVED',
          'COMPLETED',
          'FINISHED',
          'DISTRIBUTED'
        ]
        const shouldPreserveOptimisticApprovalState =
          existingStatus === 'PENDING' &&
          (incomingStatus === '' || incomingStatus === 'DRAFT') &&
          !AUTHORITATIVE_WORKFLOW_STATUSES.includes(incomingWorkflowStatus)

        const mergedPlan = {
          ...(existingPlan || {}),
          ...response.data,
          ...(shouldPreserveOptimisticApprovalState
            ? {
                status: (existingPlan as Plan & { status?: unknown }).status,
                workflowStatus:
                  (existingPlan as (Plan & { workflowStatus?: unknown }) | undefined)
                    ?.workflowStatus ??
                  (response.data as Plan & { workflowStatus?: unknown }).workflowStatus,
                canWithdraw:
                  (existingPlan as (Plan & { canWithdraw?: boolean }) | undefined)?.canWithdraw ??
                  (response.data as Plan & { canWithdraw?: boolean }).canWithdraw
              }
            : {}),
          targetOrgName:
            response.data.targetOrgName ||
            (existingPlan as (Plan & { targetOrgName?: string }) | undefined)?.targetOrgName,
          targetOrgId:
            response.data.targetOrgId ??
            (existingPlan as (Plan & { targetOrgId?: number | string }) | undefined)?.targetOrgId,
          year:
            (response.data as Plan & { year?: number | string }).year ??
            (existingPlan as (Plan & { year?: number | string }) | undefined)?.year,
          cycleId:
            response.data.cycleId ??
            (existingPlan as (Plan & { cycleId?: number | string }) | undefined)?.cycleId
        } as Plan

        currentPlan.value = mergedPlan
        // 更新 plans 列表中的数据
        const index = plans.value.findIndex(p => p.id === planId)
        if (index !== -1) {
          plans.value[index] = mergedPlan
        } else {
          plans.value.push(mergedPlan)
        }
        logger.info(
          `[Plan Store] Loaded plan details ${planId} with ${response.data.tasks?.length || 0} tasks`
        )
        return mergedPlan
      } else {
        currentPlan.value = null
        error.value = '计划不存在'
        return null
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : '加载计划详情失败'
      logger.error('[Plan Store] Failed to load plan details:', err)
      return null
    } finally {
      if (!options.background) {
        loading.value = false
      }
    }
  }

  /**
   * 根据目标部门名称获取当前年份的 Plan
   */
  const getPlanByTargetOrgAndYear = (targetOrgName: string, year: number) => {
    return plans.value.find(plan => {
      const p = plan as Plan & {
        targetOrgName?: string
        orgName?: string
      }
      const orgName = p.targetOrgName || p.orgName || ''
      const cycleYear = resolvePlanYear(plan)
      return orgName === targetOrgName && cycleYear === year
    })
  }

  const createPlan = async (data: Partial<Plan>) => {
    loading.value = true
    error.value = null

    try {
      logger.info('[Plan Store] Creating plan...', data)
      const { planApi } = await import('@/features/plan/api/planApi')
      const response = await planApi.createPlan(data)

      if (hasApiData(response)) {
        plans.value.push(response.data)
        ElMessage.success('创建成功')
        return response.data
      } else {
        throw new Error(response.message || '创建失败')
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : '创建计划失败'
      logger.error('[Plan Store] Failed to create plan:', err)
      ElMessage.error(error.value)
      throw err
    } finally {
      loading.value = false
    }
  }

  const updatePlan = async (planId: number | string, data: Partial<Plan>) => {
    loading.value = true
    error.value = null

    try {
      logger.info(`[Plan Store] Updating plan ${planId}...`, data)
      const { planApi } = await import('@/features/plan/api/planApi')
      const response = await planApi.updatePlan(planId, data)

      if (hasApiData(response)) {
        const index = plans.value.findIndex(p => p.id === planId)
        if (index !== -1) {
          plans.value[index] = response.data
        }
        if (currentPlan.value?.id === planId) {
          currentPlan.value = response.data
        }
        ElMessage.success('更新成功')
        return response.data
      } else {
        throw new Error(response.message || '更新失败')
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : '更新计划失败'
      logger.error('[Plan Store] Failed to update plan:', err)
      ElMessage.error(error.value)
      throw err
    } finally {
      loading.value = false
    }
  }

  const deletePlan = async (planId: number | string) => {
    loading.value = true
    error.value = null

    try {
      logger.info(`[Plan Store] Deleting plan ${planId}...`)
      const { planApi } = await import('@/features/plan/api/planApi')
      const response = await planApi.deletePlan(planId)

      if (response.success ?? response.code === 200) {
        const index = plans.value.findIndex(p => p.id === planId)
        if (index !== -1) {
          plans.value.splice(index, 1)
        }
        if (currentPlan.value?.id === planId) {
          currentPlan.value = null
        }
        ElMessage.success('删除成功')
      } else {
        throw new Error(response.message || '删除失败')
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : '删除计划失败'
      logger.error('[Plan Store] Failed to delete plan:', err)
      ElMessage.error(error.value)
      throw err
    } finally {
      loading.value = false
    }
  }

  const setFilter = (status: PlanStatus | 'all', orgId?: number | string | null) => {
    filterStatus.value = status
    if (orgId !== undefined) {
      filterOrgId.value = orgId
    }
  }

  const resetFilter = () => {
    filterStatus.value = 'all'
    filterOrgId.value = null
  }

  const clearCurrentPlan = () => {
    currentPlan.value = null
  }

  const submitPlan = async (form: { plan_id: number | string; comment?: string }) => {
    submitting.value = true
    error.value = null

    try {
      logger.info('[Plan Store] Submitting plan...', form)
      const { planApi } = await import('@/features/plan/api/planApi')
      const response = await planApi.submitPlan(form)

      if (hasApiData(response)) {
        planFills.value.unshift(response.data)
        await loadPlans()
        ElMessage.success('提交成功')
        return response.data
      }

      throw new Error(response.message || '提交失败')
    } catch (err) {
      error.value = err instanceof Error ? err.message : '提交计划失败'
      logger.error('[Plan Store] Failed to submit plan:', err)
      ElMessage.error(error.value)
      throw err
    } finally {
      submitting.value = false
    }
  }

  // ==================== Plan Approval Workflow ====================
  // @requirement: Plan-centric status - Plan 审批流程方法

  /**
   * 提交 Plan 审批
   * @param planId Plan ID
   */
  const submitPlanForApproval = async (
    planId: number | string,
    payload: {
      workflowCode: string
      comment?: string
    }
  ) => {
    submitting.value = true
    error.value = null

    try {
      logger.info(`[Plan Store] Submitting plan ${planId} for approval...`)
      const { planApi } = await import('@/features/plan/api/planApi')
      const response = await planApi.submitPlanForApproval(planId, payload)

      if (hasApiData(response)) {
        // 乐观更新本地 Plan 状态，避免等待后端异步工作流回写时按钮和表格仍停留在草稿态。
        const optimisticPatch = {
          status: 'PENDING',
          workflowStatus: 'IN_REVIEW',
          canWithdraw: true
        }
        const mergedPlan = {
          ...response.data,
          ...optimisticPatch
        }

        // 更新本地 Plan 状态
        const index = plans.value.findIndex(p => p.id === planId)
        if (index !== -1) {
          plans.value[index] = { ...plans.value[index], ...mergedPlan }
        }
        if (currentPlan.value?.id === planId) {
          currentPlan.value = { ...currentPlan.value, ...mergedPlan }
        }
        ElMessage.success('已提交审批')
        return mergedPlan
      }

      throw new Error(response.message || '提交审批失败')
    } catch (err) {
      error.value = err instanceof Error ? err.message : '提交审批失败'
      logger.error('[Plan Store] Failed to submit plan for approval:', err)
      ElMessage.error(error.value)
      throw err
    } finally {
      submitting.value = false
    }
  }

  /**
   * 审批通过 Plan
   * @param planId Plan ID
   */
  const approvePlan = async (planId: number | string) => {
    submitting.value = true
    error.value = null

    try {
      logger.info(`[Plan Store] Approving plan ${planId}...`)
      const { planApi } = await import('@/features/plan/api/planApi')
      const response = await planApi.approvePlan(planId)

      if (hasApiData(response)) {
        // 更新本地 Plan 状态
        const index = plans.value.findIndex(p => p.id === planId)
        if (index !== -1) {
          plans.value[index] = { ...plans.value[index], ...response.data }
        }
        if (currentPlan.value?.id === planId) {
          currentPlan.value = { ...currentPlan.value, ...response.data }
        }
        ElMessage.success('审批通过')
        return response.data
      }

      throw new Error(response.message || '审批失败')
    } catch (err) {
      error.value = err instanceof Error ? err.message : '审批失败'
      logger.error('[Plan Store] Failed to approve plan:', err)
      ElMessage.error(error.value)
      throw err
    } finally {
      submitting.value = false
    }
  }

  /**
   * 驳回 Plan
   * @param planId Plan ID
   * @param reason 驳回原因
   */
  const rejectPlan = async (planId: number | string, reason?: string) => {
    submitting.value = true
    error.value = null

    try {
      logger.info(`[Plan Store] Rejecting plan ${planId}...`, { reason })
      const { planApi } = await import('@/features/plan/api/planApi')
      const response = await planApi.rejectPlan(planId, reason)

      if (hasApiData(response)) {
        // 更新本地 Plan 状态
        const index = plans.value.findIndex(p => p.id === planId)
        if (index !== -1) {
          plans.value[index] = { ...plans.value[index], ...response.data }
        }
        if (currentPlan.value?.id === planId) {
          currentPlan.value = { ...currentPlan.value, ...response.data }
        }
        ElMessage.success('已驳回')
        return response.data
      }

      throw new Error(response.message || '驳回失败')
    } catch (err) {
      error.value = err instanceof Error ? err.message : '驳回失败'
      logger.error('[Plan Store] Failed to reject plan:', err)
      ElMessage.error(error.value)
      throw err
    } finally {
      submitting.value = false
    }
  }

  /**
   * 撤回 Plan 到草稿
   * @param planId Plan ID
   */
  const withdrawPlan = async (planId: number | string) => {
    submitting.value = true
    error.value = null

    try {
      logger.info(`[Plan Store] Withdrawing plan ${planId}...`)
      const { planApi } = await import('@/features/plan/api/planApi')
      const response = await planApi.withdrawPlan(planId)

      if (hasApiData(response)) {
        // 更新本地 Plan 状态
        const index = plans.value.findIndex(p => p.id === planId)
        if (index !== -1) {
          plans.value[index] = { ...plans.value[index], ...response.data }
        }
        if (currentPlan.value?.id === planId) {
          currentPlan.value = { ...currentPlan.value, ...response.data }
        }
        ElMessage.success('已撤回')
        return response.data
      }

      throw new Error(response.message || '撤回失败')
    } catch (err) {
      error.value = err instanceof Error ? err.message : '撤回失败'
      logger.error('[Plan Store] Failed to withdraw plan:', err)
      ElMessage.error(error.value)
      throw err
    } finally {
      submitting.value = false
    }
  }

  /**
   * 下发 Plan (发布)
   * @param planId Plan ID
   */
  const publishPlan = async (planId: number | string) => {
    submitting.value = true
    error.value = null

    try {
      logger.info(`[Plan Store] Publishing plan ${planId}...`)
      const { planApi } = await import('@/features/plan/api/planApi')
      const response = await planApi.publishPlan(planId)

      if (hasApiData(response)) {
        // 更新本地 Plan 状态
        const index = plans.value.findIndex(p => p.id === planId)
        if (index !== -1) {
          plans.value[index] = { ...plans.value[index], ...response.data }
        }
        if (currentPlan.value?.id === planId) {
          currentPlan.value = { ...currentPlan.value, ...response.data }
        }
        ElMessage.success('下发成功')
        return response.data
      }

      throw new Error(response.message || '下发失败')
    } catch (err) {
      error.value = err instanceof Error ? err.message : '下发失败'
      logger.error('[Plan Store] Failed to publish plan:', err)
      ElMessage.error(error.value)
      throw err
    } finally {
      submitting.value = false
    }
  }

  /**
   * 归档 Plan
   * @param planId Plan ID
   */
  const archivePlan = async (planId: number | string) => {
    submitting.value = true
    error.value = null

    try {
      logger.info(`[Plan Store] Archiving plan ${planId}...`)
      const { planApi } = await import('@/features/plan/api/planApi')
      const response = await planApi.archivePlan(planId)

      if (hasApiData(response)) {
        // 更新本地 Plan 状态
        const index = plans.value.findIndex(p => p.id === planId)
        if (index !== -1) {
          plans.value[index] = { ...plans.value[index], ...response.data }
        }
        if (currentPlan.value?.id === planId) {
          currentPlan.value = { ...currentPlan.value, ...response.data }
        }
        ElMessage.success('归档成功')
        return response.data
      }

      throw new Error(response.message || '归档失败')
    } catch (err) {
      error.value = err instanceof Error ? err.message : '归档失败'
      logger.error('[Plan Store] Failed to archive plan:', err)
      ElMessage.error(error.value)
      throw err
    } finally {
      submitting.value = false
    }
  }

  const loadPendingFills = async () => {
    loading.value = true
    error.value = null

    try {
      logger.info('[Plan Store] Loading pending plan fills...')
      const { planFillApi } = await import('@/features/plan/api/planApi')
      const authStore = useAuthStore()
      const response = await planFillApi.getPendingPlanFills(authStore.user?.id)

      if (hasApiData(response)) {
        planFills.value = response.data
        logger.info(`[Plan Store] Loaded ${response.data.length} pending fills`)
      } else {
        planFills.value = []
        logger.warn('[Plan Store] No pending fills loaded')
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : '加载待审核列表失败'
      planFills.value = []
      logger.error('[Plan Store] Failed to load pending plan fills:', err)
      ElMessage.error('加载待审核列表失败')
    } finally {
      loading.value = false
    }
  }

  const loadIndicatorFillHistory = async (indicatorId: number | string) => {
    loading.value = true
    error.value = null

    try {
      logger.info(`[Plan Store] Loading indicator fill history for ${indicatorId}...`)
      const { indicatorFillApi } = await import('@/features/plan/api/planApi')
      const response = await indicatorFillApi.getIndicatorFillHistory(indicatorId)

      if (hasApiData(response)) {
        logger.info(
          `[Plan Store] Loaded ${response.data.length} fill records for indicator ${indicatorId}`
        )
        return response.data
      }

      throw new Error(response.message || '加载指标填报历史失败')
    } catch (err) {
      error.value = err instanceof Error ? err.message : '加载指标填报历史失败'
      logger.error('[Plan Store] Failed to load indicator fill history:', err)
      ElMessage.error(error.value)
      throw err
    } finally {
      loading.value = false
    }
  }

  const loadIndicatorFillById = async (fillId: number | string, indicatorId?: number | string) => {
    loading.value = true
    error.value = null

    try {
      logger.info(`[Plan Store] Loading indicator fill detail ${fillId}...`)
      const { indicatorFillApi } = await import('@/features/plan/api/planApi')
      const response = await indicatorFillApi.getFillById(fillId, indicatorId)

      if (hasApiData(response)) {
        return response.data
      }

      throw new Error(response.message || '加载指标填报详情失败')
    } catch (err) {
      error.value = err instanceof Error ? err.message : '加载指标填报详情失败'
      logger.error('[Plan Store] Failed to load indicator fill detail:', err)
      ElMessage.error(error.value)
      throw err
    } finally {
      loading.value = false
    }
  }

  const saveIndicatorFill = async (form: IndicatorFillForm) => {
    submitting.value = true
    error.value = null

    try {
      logger.info('[Plan Store] Saving indicator fill...', form)
      const { indicatorFillApi } = await import('@/features/plan/api/planApi')
      const response = await indicatorFillApi.saveFill(form)

      if (hasApiData(response)) {
        currentIndicatorFill.value = response.data
        logger.info(`[Plan Store] Saved indicator fill ${response.data.id}`)
        return response.data
      }

      throw new Error(response.message || '保存指标填报失败')
    } catch (err) {
      error.value = err instanceof Error ? err.message : '保存指标填报失败'
      logger.error('[Plan Store] Failed to save indicator fill:', err)
      ElMessage.error(error.value)
      throw err
    } finally {
      submitting.value = false
    }
  }

  const submitIndicatorFill = async (fillId: number | string) => {
    submitting.value = true
    error.value = null

    try {
      logger.info(`[Plan Store] Submitting indicator fill ${fillId}...`)
      const { indicatorFillApi } = await import('@/features/plan/api/planApi')
      const response = await indicatorFillApi.submitFill(fillId)

      if (hasApiData(response)) {
        currentIndicatorFill.value = response.data
        logger.info(`[Plan Store] Submitted indicator fill ${fillId}`)
        return response.data
      }

      throw new Error(response.message || '提交指标填报失败')
    } catch (err) {
      error.value = err instanceof Error ? err.message : '提交指标填报失败'
      logger.error('[Plan Store] Failed to submit indicator fill:', err)
      ElMessage.error(error.value)
      throw err
    } finally {
      submitting.value = false
    }
  }

  // 审核计划填报
  const auditPlanFill = async (
    fillId: number | string,
    form: {
      action: 'approve' | 'reject' | 'return'
      comment?: string
      userId?: number
    }
  ) => {
    submitting.value = true
    error.value = null

    try {
      logger.info(`[Plan Store] Auditing plan fill ${fillId}...`, form)
      const { planFillApi } = await import('@/features/plan/api/planApi')
      const authStore = useAuthStore()
      const response = await planFillApi.auditPlanFill(fillId, {
        ...form,
        userId: form.userId ?? Number(authStore.user?.id ?? 0)
      })

      if (hasApiData(response)) {
        // 更新本地状态
        const index = planFills.value.findIndex(pf => pf.id === fillId)
        if (index !== -1) {
          planFills.value[index] = response.data
        }
        if (currentPlanFill.value?.id === fillId) {
          currentPlanFill.value = response.data
        }

        ElMessage.success(form.action === 'approve' ? '审核通过' : '已驳回')
        return response.data
      } else {
        throw new Error(response.message || '审核失败')
      }
    } catch (err) {
      const errObj = err as { message?: string; code?: number; details?: unknown }
      const errMessage = err instanceof Error ? err.message : errObj?.message || '审核失败'
      error.value = errMessage
      logger.error('[Plan Store] Failed to audit plan fill:', {
        message: errMessage,
        code: errObj?.code,
        details: errObj?.details
      })
      ElMessage.error(error.value)
      throw err
    } finally {
      submitting.value = false
    }
  }

  // 监听年份变化
  const timeContext = useTimeContextStore()
  watch(
    () => timeContext.currentYear,
    newYear => {
      logger.info(`[Plan Store] Year changed to ${newYear}, reloading plans...`)
      void loadPlans({ force: true })
    }
  )

  return {
    // State
    plans,
    currentPlan,
    planFills,
    currentPlanFill,
    currentIndicatorFill,
    loading,
    submitting,
    error,
    filterStatus,
    filterOrgId,

    // Getters
    filteredPlans,
    visiblePlans,
    getPlanById,
    getPlanFillsByPlanId,
    getPlanByTargetOrgAndYear,
    pendingPlanFills,
    visiblePendingFills,

    // Actions
    loadPlans,
    loadPlan,
    loadPlanDetails,
    loadPendingFills,
    loadIndicatorFillHistory,
    loadIndicatorFillById,
    createPlan,
    updatePlan,
    deletePlan,
    submitPlan,
    saveIndicatorFill,
    submitIndicatorFill,
    auditPlanFill,
    setFilter,
    resetFilter,
    clearCurrentPlan,

    // Plan approval workflow
    submitPlanForApproval,
    approvePlan,
    rejectPlan,
    withdrawPlan,
    publishPlan,
    archivePlan
  }
})
