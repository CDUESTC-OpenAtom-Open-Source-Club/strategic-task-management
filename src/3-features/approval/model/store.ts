/**
 * Approval Feature Store
 *
 * Migrated from stores/approval.ts
 * Multi-level approval workflow state management
 * Now using new /api/v1/workflows API
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ApprovalInstance, ApprovalHistory } from './types'
import { useAuthStore } from '@/features/auth/model/store'
import { logger } from '@/shared/lib/utils/logger'
import { ElMessage } from 'element-plus'
import { getMyPendingTasks, getWorkflowInstanceDetail, decideTask } from '@/features/workflow/api'
import type { WorkflowTaskResponse, WorkflowInstanceDetailResponse } from '@/features/workflow/api'

export const useApprovalStore = defineStore('approval', () => {
  // ============ State ============

  // Pending approvals for current user
  const pendingApprovals = ref<ApprovalInstance[]>([])

  // Current approval being viewed/edited
  const currentApproval = ref<ApprovalInstance | null>(null)

  // Approval history
  const approvalHistory = ref<ApprovalHistory[]>([])

  // Loading states
  const loading = ref(false)
  const submitting = ref(false)
  const error = ref<string | null>(null)

  // ============ Getters ============

  // Count of pending approvals
  const pendingCount = computed(() => pendingApprovals.value.length)

  // Pending count by status
  const pendingByStatus = computed(() => {
    const result = {
      pending: 0,
      approved: 0,
      rejected: 0,
      cancelled: 0
    }

    pendingApprovals.value.forEach(approval => {
      switch (approval.status) {
        case 'PENDING':
          result.pending++
          break
        case 'APPROVED':
          result.approved++
          break
        case 'REJECTED':
          result.rejected++
          break
        case 'CANCELLED':
          result.cancelled++
          break
      }
    })

    return result
  })

  // Check if user has approvals pending
  const hasPendingForCurrentUser = computed(() => {
    const authStore = useAuthStore()
    const userId = authStore.user?.userId

    if (!userId) {
      return false
    }

    return pendingApprovals.value.some(
      approval => approval.status === 'PENDING' && approval.applicant.id === userId
    )
  })

  // ============ Actions ============

  /**
   * Load pending approvals for current user
   */
  const loadPendingApprovals = async () => {
    const authStore = useAuthStore()
    const userId = authStore.user?.userId

    if (!userId) {
      logger.warn('[Approval Store] No user ID found')
      return
    }

    loading.value = true
    error.value = null

    try {
      logger.info('[Approval Store] Loading pending approvals for user:', userId)

      // Use new workflow API
      const response = await getMyPendingTasks(1)

      if (response.success && response.data) {
        const pageResult = response.data as unknown as {
          items: WorkflowTaskResponse[]
          total: number
        }
        // Convert WorkflowTaskResponse to ApprovalInstance format
        pendingApprovals.value = pageResult.items.map(
          task =>
            ({
              instanceId: Number(task.instanceId ?? task.taskId),
              entityType: task.entityType || 'TASK',
              entityId: task.entityId || 0,
              status: task.status === 'PENDING' ? 'PENDING' : 'APPROVED',
              // 2026-10-26 修复：保留流程码与组织上下文——审批中心据此区分
              // 「计划下发 / 上报审批 / 异动审批」并判断卡片与当前部门是否相关；
              // 缺这些字段时上报待办会被整体过滤（学院审核人看不到本学院上报卡）
              flowCode: task.flowCode,
              // 2026-10-26：审批权限判定依赖「待办指派人 = 当前用户」，保留顶层字段
              assigneeId: task.assigneeId,
              currentApproverId: task.assigneeId,
              sourceOrgId: task.sourceOrgId,
              sourceOrgName: task.sourceOrgName,
              targetOrgId: task.targetOrgId,
              targetOrgName: task.targetOrgName,
              approverOrgId: task.approverOrgId,
              currentStepName: task.taskName,
              currentStepOrder: 0,
              applicant: { id: userId, name: task.assigneeName || 'Unknown' },
              pendingApprovers: task.assigneeId ? [task.assigneeId] : [],
              approvedApprovers: [],
              rejectedApprovers: [],
              submitterDeptId: 0,
              directSupervisorId: 0,
              level2SupervisorId: 0,
              superiorDeptId: 0,
              initiatedBy: userId,
              initiatedAt: task.createdTime || new Date().toISOString(),
              completedAt: undefined
            }) as unknown as ApprovalInstance
        )
        logger.info('[Approval Store] Loaded', pendingApprovals.value.length, 'pending approvals')
      } else {
        pendingApprovals.value = []
        logger.warn('[Approval Store] No pending approvals loaded')
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : '加载待审批列表失败'
      logger.error('[Approval Store] Failed to load pending approvals:', err)
      ElMessage.error('加载待审批列表失败')
    } finally {
      loading.value = false
    }
  }

  /**
   * Load approval details
   */
  const loadApprovalDetail = async (instanceId: number) => {
    loading.value = true
    error.value = null

    try {
      logger.info('[Approval Store] Loading approval detail:', instanceId)

      // Use new workflow API
      const response = await getWorkflowInstanceDetail(String(instanceId))

      if (response.success && response.data) {
        const detail = response.data as unknown as WorkflowInstanceDetailResponse
        // Convert to ApprovalInstance format
        currentApproval.value = {
          instanceId: Number(detail.instanceId),
          entityType: detail.businessEntityType || 'TASK',
          entityId: detail.businessEntityId || 0,
          status: detail.status as ApprovalInstance['status'],
          currentStepName: detail.tasks[0]?.taskName || '',
          currentStepOrder: 0,
          applicant: { id: detail.starterId || 0, name: detail.starterName || 'Unknown' },
          pendingApprovers: detail.tasks
            .filter(t => t.status === 'PENDING')
            .map(t => t.assigneeId || 0),
          approvedApprovers: detail.tasks
            .filter(t => t.status === 'COMPLETED')
            .map(t => t.assigneeId || 0),
          rejectedApprovers: [],
          submitterDeptId: 0,
          directSupervisorId: 0,
          level2SupervisorId: 0,
          superiorDeptId: 0,
          initiatedBy: detail.starterId || 0,
          initiatedAt: detail.startTime || '',
          completedAt: detail.endTime || undefined
        } as unknown as ApprovalInstance
        logger.info('[Approval Store] Loaded approval detail')
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : '加载审批详情失败'
      logger.error('[Approval Store] Failed to load approval detail:', err)
      ElMessage.error('加载审批详情失败')
    } finally {
      loading.value = false
    }
  }

  /**
   * Approve an approval instance
   */
  const approve = async (instanceId: number, comment?: string) => {
    const authStore = useAuthStore()
    const userId = authStore.user?.userId

    if (!userId) {
      ElMessage.error('用户未登录')
      return
    }

    submitting.value = true
    error.value = null

    try {
      logger.info('[Approval Store] Approving:', instanceId)

      // Use new workflow API
      await decideTask(String(instanceId), {
        approved: true,
        comment
      })

      ElMessage.success('审批通过')

      // Remove from pending list
      pendingApprovals.value = pendingApprovals.value.filter(a => a.instanceId !== instanceId)

      logger.info('[Approval Store] Approval successful')
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : '审批失败'
      logger.error('[Approval Store] Failed to approve:', err)
      ElMessage.error(error.value)
      throw err
    } finally {
      submitting.value = false
    }
  }

  /**
   * Reject an approval instance
   */
  const reject = async (instanceId: number, reason: string) => {
    const authStore = useAuthStore()
    const userId = authStore.user?.userId

    if (!userId) {
      ElMessage.error('用户未登录')
      return
    }

    if (!reason.trim()) {
      ElMessage.warning('请输入驳回原因')
      return
    }

    submitting.value = true
    error.value = null

    try {
      logger.info('[Approval Store] Rejecting:', instanceId, 'reason:', reason)

      // Use new workflow API
      await decideTask(String(instanceId), {
        approved: false,
        comment: reason
      })

      ElMessage.success('已驳回')

      // Remove from pending list
      pendingApprovals.value = pendingApprovals.value.filter(a => a.instanceId !== instanceId)

      logger.info('[Approval Store] Rejection successful')
      return true
    } catch (err) {
      error.value = err instanceof Error ? err.message : '驳回失败'
      logger.error('[Approval Store] Failed to reject:', err)
      ElMessage.error(error.value)
      throw err
    } finally {
      submitting.value = false
    }
  }

  /**
   * Load approval history
   */
  const loadApprovalHistory = async (instanceId: number) => {
    loading.value = true
    error.value = null

    try {
      logger.info('[Approval Store] Loading history for:', instanceId)

      // Use new workflow API - get detail includes history
      const response = await getWorkflowInstanceDetail(String(instanceId))

      if (response.success && response.data) {
        const detail = response.data as unknown as WorkflowInstanceDetailResponse
        // Convert history items to ApprovalHistory format
        approvalHistory.value = detail.history.map(h => ({
          action: h.action,
          actor: h.operatorName || 'Unknown',
          comment: h.comment || '',
          timestamp: h.operateTime || ''
        })) as unknown as ApprovalHistory[]
        logger.info('[Approval Store] Loaded approval history')
      }
    } catch (err) {
      error.value = err instanceof Error ? err.message : '加载审批历史失败'
      logger.error('[Approval Store] Failed to load history:', err)
      ElMessage.error('加载审批历史失败')
    } finally {
      loading.value = false
    }
  }

  /**
   * Clear current approval
   */
  const clearCurrentApproval = () => {
    currentApproval.value = null
    approvalHistory.value = []
  }

  /**
   * Get step name for display
   */
  const getStepName = (stepName: string): string => {
    // 根据步骤名称返回显示名称
    const stepNames: Record<string, string> = {
      DEPT_REVIEW: '部门审核',
      SCHOOL_REVIEW: '校级审批',
      FINAL_REVIEW: '最终审批'
    }
    return stepNames[stepName] || stepName
  }

  return {
    // State
    pendingApprovals,
    currentApproval,
    approvalHistory,
    loading,
    submitting,
    error,

    // Getters
    pendingCount,
    pendingByStatus,
    hasPendingForCurrentUser,

    // Actions
    loadPendingApprovals,
    loadApprovalDetail,
    approve,
    reject,
    loadApprovalHistory,
    clearCurrentApproval,
    getStepName
  }
})
