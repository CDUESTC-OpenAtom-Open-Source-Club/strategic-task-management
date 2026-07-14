/**
 * 战略任务和指标 API 服务
 * 从后端获取数据库中的数据
 * 使用简化的 apiClient，在业务层实现必要的重试逻辑
 *
 * **Validates: Requirements 2.4, 2.6**
 */
import { apiClient } from '@/shared/api/client'
import { withRetry } from '@/shared/api/wrappers'
import { buildQueryKey, fetchWithCache, invalidateQueries } from '@/shared/lib/utils/cache'
import { getCachedUserContext } from '@/shared/lib/utils/cacheContext'
import { logger } from '@/shared/lib/utils/logger'
import {
  getMyPendingTasks,
  getWorkflowInstanceDetail,
  approveTask as workflowApproveTask,
  rejectTask as workflowRejectTask
} from '@/features/workflow/api'
/* eslint-disable no-restricted-syntax -- Backend types use strategic_task terminology */
import type {
  ApiResponse,
  StrategicTask,
  StrategicIndicator,
  CreateStrategicTaskRequest,
  UpdateStrategicTaskRequest,
  PendingApproval
} from '@/shared/types'
/* eslint-enable no-restricted-syntax */
// 导入统一的 IndicatorVO 接口，避免重复定义
import type {
  IndicatorVO,
  AssessmentCycle as AssessmentCycleVO
} from '@/shared/types/backend-aligned'

interface StrategicTaskVO {
  taskId?: number
  id?: number
  planId?: number | null
  taskName?: string
  name?: string
  taskDesc?: string | null
  desc?: string | null
  taskType?: string
  createdAt: string
  year?: number
  cycleId?: number | null
  createdByOrgName?: string
  createdByOrgId?: number | null
}

interface BackendTaskCreateRequest {
  taskName?: string
  name?: string
  taskType: string
  planId: number
  cycleId: number
  orgId: number
  createdByOrgId: number
  sortOrder?: number
  taskDesc?: string | null
  desc?: string | null
  remark?: string | null
}

interface CyclePageResponse<T> {
  content: T[]
}

function isForbiddenError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const status =
    'response' in error
      ? Number((error as { response?: { status?: number } }).response?.status ?? NaN)
      : Number((error as { status?: number }).status ?? NaN)

  return status === 403
}

function getErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const responseStatus =
    'response' in error
      ? Number((error as { response?: { status?: number } }).response?.status ?? NaN)
      : NaN
  if (Number.isFinite(responseStatus)) {
    return responseStatus
  }

  const topLevelStatus = Number((error as { status?: number }).status ?? NaN)
  return Number.isFinite(topLevelStatus) ? topLevelStatus : null
}

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return ''
  }

  const responseMessage =
    'response' in error
      ? String(
          (error as { response?: { data?: { message?: string } } }).response?.data?.message || ''
        )
      : ''
  if (responseMessage) {
    return responseMessage
  }

  return String((error as { message?: string }).message || '')
}

function shouldFallbackToWorkflowInstanceResolution(error: unknown): boolean {
  const status = getErrorStatus(error)
  const message = getErrorMessage(error)

  if (status === 400 || status === 403) {
    return /task not found|workflow task not found|pending task not found|invalid task/i.test(
      message
    )
  }

  return status === 404
}

function withTaskCacheContext(params?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...getCachedUserContext(),
    ...(params ?? {}),
    version: 'v1'
  }
}

function invalidateTaskCaches(taskId?: number | string, year?: number): void {
  const targets: Array<string | readonly [string, string, Record<string, string | number>]> = [
    'task.list',
    'task.scope',
    'plan.detail',
    'dashboard.overview'
  ]
  if (typeof year === 'number') {
    targets.push(buildQueryKey('task', 'list', { year }))
  }
  if (taskId !== undefined) {
    targets.push(`task.detail.${taskId}`)
  }
  invalidateQueries(targets)
}

/**
 * 将后端 VO 转换为前端 StrategicTask 类型
 */
// eslint-disable-next-line no-restricted-syntax -- Converter function for backend VO
function convertTaskVOToStrategicTask(vo: StrategicTaskVO): StrategicTask {
  const taskId = vo.taskId ?? vo.id ?? 0
  const taskYear = vo.year ?? new Date().getFullYear()
  const taskName = vo.taskName ?? vo.name ?? ''
  const taskDesc = vo.taskDesc ?? vo.desc ?? ''
  return {
    id: String(taskId),
    title: taskName,
    desc: taskDesc,
    createTime: new Date(vo.createdAt).toLocaleDateString('zh-CN'),
    cycle: `${taskYear}年度`,
    startDate: new Date(`${taskYear}-01-01`),
    endDate: new Date(`${taskYear}-12-31`),
    status: 'active',
    createdBy: vo.createdByOrgName || '',
    indicators: [],
    year: taskYear,
    isRecurring: vo.taskType === 'BASIC' || vo.taskType === 'DEVELOPMENT'
  }
}

/**
 * 将后端 VO 转换为前端 StrategicIndicator 类型
 */
function convertIndicatorVOToStrategicIndicator(vo: IndicatorVO): StrategicIndicator {
  const resolvedYear = typeof vo.year === 'number' ? vo.year : new Date().getFullYear()

  // 转换里程碑状态
  const convertMilestoneStatus = (status: string): 'pending' | 'completed' | 'overdue' => {
    if (status === 'COMPLETED') {
      return 'completed'
    }
    if (status === 'DELAYED' || status === 'CANCELED') {
      return 'overdue'
    }
    return 'pending' // NOT_STARTED, IN_PROGRESS 都映射为 pending
  }

  // 转换里程碑
  const milestones =
    vo.milestones?.map(m => ({
      id: String(m.milestoneId),
      name: m.milestoneName,
      targetProgress: m.targetProgress ?? m.weightPercent,
      deadline: m.dueDate,
      status: convertMilestoneStatus(m.status),
      isPaired: m.isPaired ?? false,
      weightPercent: m.weightPercent,
      sortOrder: m.sortOrder
    })) || []

  // 转换进度审批状态
  const convertProgressApprovalStatus = (
    status?: string
  ): 'none' | 'draft' | 'pending' | 'approved' | 'rejected' => {
    if (!status) {
      return 'none'
    }
    const map: Record<string, 'none' | 'draft' | 'pending' | 'approved' | 'rejected'> = {
      NONE: 'none',
      DRAFT: 'draft',
      PENDING: 'pending',
      APPROVED: 'approved',
      REJECTED: 'rejected'
    }
    return map[status] || 'none'
  }

  // 解析 statusAudit JSON
  let statusAudit: Array<Record<string, unknown>> = []
  if (vo.statusAudit) {
    try {
      statusAudit = JSON.parse(vo.statusAudit)
    } catch {
      statusAudit = []
    }
  }

  // 解析 pendingAttachments JSON
  let pendingAttachments: string[] = []
  if (vo.pendingAttachments) {
    try {
      pendingAttachments = JSON.parse(vo.pendingAttachments)
    } catch {
      pendingAttachments = []
    }
  }

  return {
    id: String(vo.indicatorId),
    name: vo.indicatorDesc,
    // 使用后端返回的新字段，提供默认值
    isQualitative: vo.isQualitative ?? false,
    // indicatorType 是后端返回的 type 字段，定量/定性
    type1:
      (vo.type1 as '定性' | '定量') ??
      (vo.indicatorType === '定量' ? '定量' : vo.indicatorType === '定性' ? '定性' : '定量'),
    type2:
      (vo.type2 as '发展性' | '基础性') ?? (vo.level === 'STRAT_TO_FUNC' ? '发展性' : '基础性'),
    progress: vo.progress ?? calculateProgress(milestones),
    manualAlertSeverity: vo.manualAlertSeverity ?? null,
    createTime: new Date(vo.createdAt).toLocaleDateString('zh-CN'),
    weight: vo.weightPercent,
    remark: vo.remark || '',
    canWithdraw: vo.canWithdraw ?? vo.level === 'STRAT_TO_FUNC',
    taskContent: vo.taskName,
    milestones,
    targetValue: vo.targetValue ?? 100,
    actualValue: vo.actualValue,
    unit: vo.unit ?? '%',
    responsibleDept: vo.responsibleDept ?? vo.targetOrgName,
    responsiblePerson: vo.responsiblePerson ?? '',
    status: vo.status === 'ACTIVE' ? 'active' : 'archived',
    isStrategic: vo.isStrategic ?? vo.level === 'STRAT_TO_FUNC',
    ownerDept: vo.ownerDept ?? vo.ownerOrgName,
    year: resolvedYear,
    parentIndicatorId: vo.parentIndicatorId ? String(vo.parentIndicatorId) : undefined,
    progressApprovalStatus: convertProgressApprovalStatus(vo.progressApprovalStatus),
    pendingProgress: vo.pendingProgress,
    pendingRemark: vo.pendingRemark,
    pendingAttachments,
    statusAudit
  }
}

/**
 * 根据里程碑计算进度
 */
function calculateProgress(milestones: { status: string }[]): number {
  if (milestones.length === 0) {
    return 0
  }
  const completed = milestones.filter(m => m.status === 'completed').length
  return Math.round((completed / milestones.length) * 100)
}

export const strategicApi = {
  /**
   * 获取所有考核周期（带内存缓存，TTL 10 分钟）
   */
  async getAllCycles(): Promise<ApiResponse<AssessmentCycleVO[]>> {
    return fetchWithCache<ApiResponse<AssessmentCycleVO[]>>({
      key: buildQueryKey('cycle', 'list'),
      policy: {
        ttlMs: 10 * 60 * 1000,
        scope: 'memory',
        staleWhileRevalidate: true,
        dedupeWindowMs: 1000,
        tags: ['cycles.list']
      },
      fetcher: () => apiClient.get<ApiResponse<AssessmentCycleVO[]>>('/cycles/list')
    })
  },

  /**
   * 获取所有可用的年份（从周期表，带内存缓存）
   */
  async getAvailableYears(): Promise<ApiResponse<number[]>> {
    try {
      const response = await fetchWithCache<ApiResponse<AssessmentCycleVO[]>>({
        key: buildQueryKey('cycle', 'list'),
        policy: {
          ttlMs: 10 * 60 * 1000,
          scope: 'memory',
          staleWhileRevalidate: true,
          dedupeWindowMs: 1000,
          tags: ['cycles.list']
        },
        fetcher: () => apiClient.get<ApiResponse<AssessmentCycleVO[]>>('/cycles/list')
      })
      if (!response.success || !response.data) {
        return {
          ...response,
          data: []
        }
      }

      const years = response.data
        .map(cycle => cycle.year)
        .filter((year): year is number => typeof year === 'number')
      const uniqueYears = [...new Set(years)].sort((left, right) => right - left)

      return {
        ...response,
        data: uniqueYears
      }
    } catch (error) {
      logger.error('[StrategicAPI] Failed to derive available years from /cycles/list', { error })
      return {
        success: false,
        data: [],
        message: 'Failed to fetch available years',
        timestamp: new Date()
      }
    }
  },

  /**
   * 获取指定年份的考核周期
   */
  async getCycleByYear(year: number): Promise<ApiResponse<AssessmentCycleVO | null>> {
    try {
      const response = await fetchWithCache({
        key: buildQueryKey('cycle', 'detail', withTaskCacheContext({ year })),
        policy: {
          ttlMs: 30 * 60 * 1000,
          scope: 'session',
          persist: true,
          staleWhileRevalidate: true,
          dedupeWindowMs: 1000,
          tags: ['cycles.list']
        },
        fetcher: () =>
          apiClient.get<ApiResponse<CyclePageResponse<AssessmentCycleVO>>>('/cycles', {
            params: { year, page: 0, size: 1 }
          })
      })
      if (response.success && response.data) {
        const cycle = response.data.content?.[0] || null
        return { ...response, data: cycle }
      }
      return { ...response, data: null }
    } catch {
      return { success: false, data: null, message: 'Failed to get cycle', timestamp: new Date() }
    }
  },

  /**
   * 获取指定计划的战略任务
   */
  // eslint-disable-next-line no-restricted-syntax -- Backend API returns StrategicTaskVO
  async getTasksByPlanId(planId: number | string): Promise<ApiResponse<StrategicTaskVO[]>> {
    try {
      return await apiClient.get<ApiResponse<StrategicTaskVO[]>>(`/tasks/by-plan/${planId}`)
    } catch (error) {
      if (isForbiddenError(error)) {
        logger.warn('[strategicApi] tasks by plan forbidden, downgrade to empty list', { planId })
        return {
          success: true,
          code: 200,
          message: '当前账号无权查看该计划任务，已按空数据处理',
          data: [],
          timestamp: new Date().toISOString()
        }
      }
      throw error
    }
  },

  /**
   * 获取指定年份的战略任务（通过 cycle）
   */
  // eslint-disable-next-line no-restricted-syntax -- Backend API returns StrategicTaskVO
  async getTasksByYear(
    year: number,
    options: { force?: boolean } = {}
  ): Promise<ApiResponse<StrategicTaskVO[]>> {
    try {
      return fetchWithCache({
        key: buildQueryKey('task', 'list', withTaskCacheContext({ year })),
        policy: {
          ttlMs: 2 * 60 * 1000,
          scope: 'session',
          persist: true,
          staleWhileRevalidate: true,
          dedupeWindowMs: 1000,
          tags: ['task.list', `task.list.${year}`]
        },
        force: options.force === true,
        fetcher: async () => {
          const cycleResponse = await this.getCycleByYear(year)
          if (!cycleResponse.success || !cycleResponse.data) {
            return {
              success: false,
              data: [],
              message: cycleResponse.message || `No cycle found for year ${year}`,
              timestamp: new Date()
            }
          }

          const cycleId =
            (cycleResponse.data as AssessmentCycleVO & { cycleId?: number; id?: number }).cycleId ||
            (cycleResponse.data as AssessmentCycleVO & { id?: number }).id

          if (!cycleId) {
            return {
              success: false,
              data: [],
              message: `Cycle ID missing for year ${year}`,
              timestamp: new Date()
            }
          }

          try {
            return await apiClient.get<ApiResponse<StrategicTaskVO[]>>(`/tasks/by-cycle/${cycleId}`)
          } catch (error) {
            if (isForbiddenError(error)) {
              logger.warn('[strategicApi] tasks by cycle forbidden, downgrade to empty list', {
                year,
                cycleId
              })
              return {
                success: true,
                code: 200,
                message: '当前账号无权查看该年度任务，已按空数据处理',
                data: [],
                timestamp: new Date().toISOString()
              }
            }
            throw error
          }
        }
      })
    } catch {
      return { success: false, data: [], message: 'Failed to get tasks', timestamp: new Date() }
    }
  },

  /**
   * 获取所有战略任务
   */
  // eslint-disable-next-line no-restricted-syntax -- Backend API returns StrategicTaskVO
  async getAllTasks(options: { force?: boolean } = {}): Promise<ApiResponse<StrategicTaskVO[]>> {
    return fetchWithCache({
      key: buildQueryKey('task', 'list', withTaskCacheContext()),
      policy: {
        ttlMs: 2 * 60 * 1000,
        scope: 'session',
        persist: true,
        staleWhileRevalidate: true,
        dedupeWindowMs: 1000,
        tags: ['task.list']
      },
      force: options.force === true,
      fetcher: () => apiClient.get<ApiResponse<StrategicTaskVO[]>>('/tasks')
    })
  },

  /**
   * 获取指定年份的指标（包含里程碑）
   */
  async getIndicatorsByYear(year: number): Promise<ApiResponse<IndicatorVO[]>> {
    try {
      return await fetchWithCache({
        key: buildQueryKey('indicator', 'list', withTaskCacheContext({ year })),
        policy: {
          ttlMs: 2 * 60 * 1000,
          scope: 'session',
          persist: true,
          staleWhileRevalidate: true,
          dedupeWindowMs: 1000,
          tags: ['indicator.list']
        },
        fetcher: () => apiClient.get<ApiResponse<IndicatorVO[]>>('/indicators', { year })
      })
    } catch {
      return {
        success: false,
        data: [],
        message: 'Failed to get indicators',
        timestamp: new Date()
      }
    }
  },

  /**
   * 获取所有指标
   * @param year 可选的年份过滤参数
   */
  async getAllIndicators(year?: number): Promise<ApiResponse<IndicatorVO[]>> {
    const params = year ? { year } : {}
    return fetchWithCache({
      key: buildQueryKey('indicator', 'list', year ? { year } : undefined),
      policy: {
        ttlMs: 2 * 60 * 1000,
        scope: 'memory',
        dedupeWindowMs: 1000,
        tags: ['indicator.list', ...(typeof year === 'number' ? [`indicator.list.${year}`] : [])]
      },
      fetcher: () => apiClient.get<ApiResponse<IndicatorVO[]>>('/indicators', { params })
    })
  },

  /**
   * 获取指定任务的指标
   */
  async getIndicatorsByTask(taskId: string): Promise<ApiResponse<IndicatorVO[]>> {
    return apiClient.get<ApiResponse<IndicatorVO[]>>(`/indicators/task/${taskId}`)
  },

  /**
   * 创建新的战略任务
   */
  // eslint-disable-next-line no-restricted-syntax -- Backend API returns StrategicTaskVO
  async createTask(request: CreateStrategicTaskRequest): Promise<ApiResponse<StrategicTaskVO>> {
    logger.info('[API] Creating new strategic task', { request })

    try {
      const response = await withRetry(() =>
        // eslint-disable-next-line no-restricted-syntax -- Backend API returns StrategicTaskVO
        apiClient.post<ApiResponse<StrategicTaskVO>>('/tasks', request)
      )

      invalidateTaskCaches(response.data?.taskId, request.year)
      logger.info('[API] Successfully created task', { taskId: response.data?.taskId })
      return response
    } catch (error) {
      logger.error('[API] Failed to create task', { error, request })
      throw error
    }
  },

  /**
   * 更新现有的战略任务
   */
  // eslint-disable-next-line no-restricted-syntax -- Backend API returns StrategicTaskVO
  async updateTask(
    taskId: number,
    request: UpdateStrategicTaskRequest
  ): Promise<ApiResponse<StrategicTaskVO>> {
    logger.info('[API] Updating strategic task', { taskId, request })

    try {
      const response = await withRetry(() =>
        // eslint-disable-next-line no-restricted-syntax -- Backend API returns StrategicTaskVO
        apiClient.put<ApiResponse<StrategicTaskVO>>(`/tasks/${taskId}`, request)
      )

      invalidateTaskCaches(taskId, request.year)
      logger.info('[API] Successfully updated task', { taskId })
      return response
    } catch (error) {
      logger.error('[API] Failed to update task', { error, taskId, request })
      throw error
    }
  },

  async updateTaskName(
    taskId: number | string,
    taskName: string
  ): Promise<ApiResponse<StrategicTaskVO>> {
    logger.info('[API] Updating strategic task name', { taskId, taskName })

    try {
      return await withRetry(() =>
        apiClient.put<ApiResponse<StrategicTaskVO>>(`/tasks/${taskId}/name`, {
          name: taskName
        })
      )
    } catch (error) {
      logger.error('[API] Failed to update task name', { error, taskId, taskName })
      throw error
    }
  },

  async createBackendTask(
    request: BackendTaskCreateRequest
  ): Promise<ApiResponse<StrategicTaskVO>> {
    const payload = {
      name: request.name ?? request.taskName ?? '',
      taskType: request.taskType,
      planId: request.planId,
      cycleId: request.cycleId,
      orgId: request.orgId,
      createdByOrgId: request.createdByOrgId,
      sortOrder: request.sortOrder ?? 0,
      desc: request.desc ?? request.taskDesc ?? null,
      remark: request.remark ?? null
    }

    logger.info('[API] Creating backend task for indicator binding', { request, payload })

    try {
      const response = await withRetry(() =>
        apiClient.post<ApiResponse<StrategicTaskVO>>('/tasks', payload)
      )
      invalidateTaskCaches(response.data?.taskId ?? response.data?.id)
      return response
    } catch (error) {
      logger.error('[API] Failed to create backend task for indicator binding', {
        error,
        request,
        payload
      })
      throw error
    }
  },

  /**
   * 删除战略任务
   */
  async deleteTask(taskId: number): Promise<ApiResponse<void>> {
    logger.info('[API] Deleting strategic task', { taskId })

    try {
      const response = await withRetry(() =>
        apiClient.delete<ApiResponse<void>>(`/tasks/${taskId}`)
      )

      invalidateTaskCaches(taskId)
      logger.info('[API] Successfully deleted task', { taskId })
      return response
    } catch (error) {
      logger.error('[API] Failed to delete task', { error, taskId })
      throw error
    }
  },

  // 转换函数导出
  // eslint-disable-next-line no-restricted-syntax -- Converter function for backend VO
  convertTaskVOToStrategicTask,
  convertIndicatorVOToStrategicIndicator
}

export default strategicApi

/**
 * ==========================================
 * 审批流程 API
 * ==========================================
 */

/**
 * 审批通过
 * @param instanceId 审批实例ID
 * @param approverId 审批人ID (unused, taken from JWT)
 * @param comment 审批意见（可选）
 */
async function approvePlan(
  instanceId: number,
  approverId: number,
  comment?: string
): Promise<ApiResponse<string>> {
  logger.info('[API] Approving plan', { instanceId })

  try {
    await workflowApproveTask(String(instanceId), { comment })
    logger.info('[API] Successfully approved plan', { instanceId })
    return { success: true, message: '审批通过', data: String(instanceId) }
  } catch (error) {
    if (!shouldFallbackToWorkflowInstanceResolution(error)) {
      throw error
    }

    logger.warn('[API] Direct task approval failed, trying workflow instance resolution', {
      instanceId,
      approverId,
      error
    })

    const detailResponse = await getWorkflowInstanceDetail(String(instanceId))
    const detail = detailResponse.data as unknown as {
      tasks?: Array<{
        taskId: string
        status?: string
        assigneeId?: number
      }>
    }

    const pendingTask =
      detail.tasks?.find(
        task =>
          String(task.status || '').toUpperCase() === 'PENDING' &&
          Number(task.assigneeId) === Number(approverId)
      ) || detail.tasks?.find(task => String(task.status || '').toUpperCase() === 'PENDING')

    if (!pendingTask?.taskId) {
      logger.error('[API] Failed to resolve pending task for plan approval', {
        instanceId,
        approverId,
        detail
      })
      throw error
    }

    await workflowApproveTask(String(pendingTask.taskId), { comment })
    logger.info('[API] Successfully approved plan via resolved task', {
      instanceId,
      taskId: pendingTask.taskId
    })
    return { success: true, message: '审批通过', data: String(pendingTask.taskId) }
  }
}

/**
 * 审批拒绝
 * @param instanceId 审批实例ID
 * @param approverId 审批人ID (unused, taken from JWT)
 * @param comment 拒绝原因（必填）
 */
async function rejectPlan(
  instanceId: number,
  approverId: number,
  comment: string
): Promise<ApiResponse<string>> {
  logger.info('[API] Rejecting plan', { instanceId })

  try {
    await workflowRejectTask(String(instanceId), { reason: comment })
    logger.info('[API] Successfully rejected plan', { instanceId })
    return { success: true, message: '审批拒绝', data: String(instanceId) }
  } catch (error) {
    if (!shouldFallbackToWorkflowInstanceResolution(error)) {
      throw error
    }

    logger.warn('[API] Direct task rejection failed, trying workflow instance resolution', {
      instanceId,
      approverId,
      error
    })

    const detailResponse = await getWorkflowInstanceDetail(String(instanceId))
    const detail = detailResponse.data as unknown as {
      tasks?: Array<{
        taskId: string
        status?: string
        assigneeId?: number
      }>
    }

    const pendingTask =
      detail.tasks?.find(
        task =>
          String(task.status || '').toUpperCase() === 'PENDING' &&
          Number(task.assigneeId) === Number(approverId)
      ) || detail.tasks?.find(task => String(task.status || '').toUpperCase() === 'PENDING')

    if (!pendingTask?.taskId) {
      logger.error('[API] Failed to resolve pending task for plan rejection', {
        instanceId,
        approverId,
        detail
      })
      throw error
    }

    await workflowRejectTask(String(pendingTask.taskId), { reason: comment })
    logger.info('[API] Successfully rejected plan via resolved task', {
      instanceId,
      taskId: pendingTask.taskId
    })
    return { success: true, message: '审批拒绝', data: String(pendingTask.taskId) }
  }
}

/**
 * 获取用户待审批列表
 * @param userId 用户ID (unused, taken from JWT)
 */
async function getPendingApprovals(_userId: number): Promise<ApiResponse<PendingApproval[]>> {
  logger.info('[API] Getting pending approvals')

  try {
    const response = await getMyPendingTasks(1)
    if (response.success && response.data) {
      const pageResult = response.data as unknown as {
        items: Array<{
          taskId: string
          instanceId?: string
          taskName: string
          status: string
          flowCode?: string
          flowName?: string
          entityId?: number
          entityType?: string
          approverOrgId?: number
          approverOrgName?: string
          sourceOrgId?: number
          sourceOrgName?: string
          targetOrgId?: number
          targetOrgName?: string
          planId?: number
          planName?: string
          currentStepName?: string
          createdTime?: string
        }>
      }
      logger.info('[API] Successfully got pending approvals', { count: pageResult.items.length })
      return {
        ...response,
        data: pageResult.items.map(item => ({
          instanceId: Number(item.instanceId) || 0,
          taskId: Number(item.taskId) || 0,
          title: item.planName || item.taskName,
          entityType: item.entityType || 'TASK',
          status: item.status,
          flowCode: item.flowCode,
          flowName: item.flowName,
          entityId: item.entityId,
          businessEntityType: item.entityType,
          approverOrgId: item.approverOrgId,
          approverOrgName: item.approverOrgName,
          sourceOrgId: item.sourceOrgId,
          sourceOrgName: item.sourceOrgName,
          targetOrgId: item.targetOrgId,
          targetOrgName: item.targetOrgName,
          planId: item.planId,
          planName: item.planName,
          currentStepName: item.currentStepName || item.taskName,
          createdAt: item.createdTime
        })) as unknown as PendingApproval[]
      }
    }
    return { ...response, data: [] as unknown as PendingApproval[] }
  } catch (error) {
    logger.error('[API] Failed to get pending approvals', { error })
    throw error
  }
}

/**
 * 获取计划审批状态
 * @param instanceId 审批实例ID
 */
async function getPlanApprovalStatus(instanceId: number): Promise<ApiResponse<unknown>> {
  logger.info('[API] Getting plan approval status', { instanceId })

  try {
    const response = await getWorkflowInstanceDetail(String(instanceId))
    if (response.success) {
      logger.info('[API] Successfully got plan approval status', { instanceId })
      return {
        ...response,
        data: {
          status: (response.data as unknown as { status: string }).status,
          stepInstances: (
            response.data as unknown as { tasks: { stepIndex: number; stepName: string }[] }
          ).tasks.map((t, i) => ({
            stepIndex: i,
            stepName: t.stepName
          }))
        }
      }
    }
    return response
  } catch (error) {
    logger.error('[API] Failed to get plan approval status', { error, instanceId })
    throw error
  }
}

/**
 * 获取待审批数量
 * @param userId 用户ID (unused, taken from JWT)
 */
async function countPendingApprovals(_userId: number): Promise<ApiResponse<number>> {
  logger.info('[API] Counting pending approvals')

  try {
    const response = await getMyPendingTasks(1)
    if (response.success && response.data) {
      const pageResult = response.data as unknown as { total: number }
      logger.info('[API] Successfully counted pending approvals', { count: pageResult.total })
      return { ...response, data: pageResult.total }
    }
    return { ...response, data: 0 }
  } catch (error) {
    const msg =
      error instanceof Error
        ? error.message
        : error && typeof error === 'object' && 'message' in error
          ? String((error as { message: unknown }).message)
          : '未知错误'
    logger.error('[API] Failed to count pending approvals', msg)
    throw error
  }
}

/**
 * 获取当前审批步骤描述
 * @param instanceId 审批实例ID
 */
async function getCurrentStep(instanceId: number): Promise<ApiResponse<string>> {
  logger.info('[API] Getting current step', { instanceId })

  try {
    const response = await getWorkflowInstanceDetail(String(instanceId))
    if (response.success && response.data) {
      const detail = response.data as unknown as {
        tasks: { taskName: string }[]
        history: { taskName: string }[]
      }
      const stepName = detail.tasks[0]?.taskName || detail.history[0]?.taskName || '未知步骤'
      logger.info('[API] Successfully got current step', { instanceId, stepName })
      return { ...response, data: stepName }
    }
    return response
  } catch (error) {
    logger.error('[API] Failed to get current step', { error, instanceId })
    throw error
  }
}

/**
 * 获取审批时间轴（基于审批实例详情）
 */
async function getApprovalTimeline(instanceId: number): Promise<
  ApiResponse<{
    instanceId: number
    currentStepIndex?: number
    timeline: Array<{
      stepIndex: number
      stepName: string
      status: string
      approverName?: string
      approvedAt?: string | null
      comment?: string | null
    }>
  }>
> {
  logger.info('[API] Getting approval timeline', { instanceId })

  try {
    const response = await getWorkflowInstanceDetail(String(instanceId))
    if (response.success && response.data) {
      const detail = response.data as unknown as {
        tasks: Array<{
          taskName: string
          status: string
          assigneeName?: string
        }>
        history: Array<{
          taskName: string
          action: string
          operatorName?: string
          operateTime?: string
          comment?: string
        }>
      }

      // Build timeline from tasks and history
      const timeline = detail.tasks.map((task, index) => ({
        stepIndex: index,
        stepName: task.taskName || '未知步骤',
        status: task.status || 'PENDING',
        approverName: task.assigneeName,
        approvedAt: null,
        comment: null
      }))

      return {
        ...response,
        data: {
          instanceId,
          currentStepIndex: 0,
          timeline
        }
      }
    }
    return response as unknown as ApiResponse<{
      instanceId: number
      currentStepIndex?: number
      timeline: Array<{
        stepIndex: number
        stepName: string
        status: string
        approverName?: string
        approvedAt?: string | null
        comment?: string | null
      }>
    }>
  } catch (error) {
    logger.error('[API] Failed to get approval timeline', { error, instanceId })
    throw error
  }
}

// 导出审批相关API
export const approvalApi = {
  approvePlan,
  rejectPlan,
  getPendingApprovals,
  getPlanApprovalStatus,
  countPendingApprovals,
  getCurrentStep,
  getApprovalTimeline
}
