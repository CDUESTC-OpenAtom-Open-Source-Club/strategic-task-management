import { apiClient } from '@/shared/api/client'
import { withRetry } from '@/shared/api/wrappers'
import {
  buildQueryKey,
  fetchWithCache,
  invalidateQueries,
  refreshCachePattern
} from '@/shared/lib/utils/cache'
import { getCachedUserContext } from '@/shared/lib/utils/cacheContext'
import type {
  ApiResponse,
  IndicatorDistributionRequest,
  IndicatorDistributionEligibility,
  BatchDistributionRequest
} from '@/shared/types'
import type { IndicatorVO, IndicatorCreateRequest } from '@/shared/types/backend-aligned'

/**
 * 指标 API 服务
 * 包含指标下发相关的接口
 *
 * Note: IndicatorVO and related types are now imported from backend-aligned.ts
 * to ensure consistency across the application.
 */

// Re-export types for backward compatibility
export type { IndicatorVO, IndicatorCreateRequest } from '@/shared/types/backend-aligned'

function withIndicatorCacheContext(params?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...getCachedUserContext(),
    ...(params ?? {}),
    version: 'v1'
  }
}

function invalidateIndicatorListCaches(indicatorId?: string): void {
  const targets: Array<string | ReturnType<typeof buildQueryKey>> = ['indicator.list']

  if (indicatorId) {
    targets.push(
      'indicator.detail',
      `indicator.detail.${indicatorId}`,
      buildQueryKey(
        'indicator',
        'detail',
        withIndicatorCacheContext({ indicatorId: String(indicatorId) })
      )
    )
  }

  invalidateQueries(targets)
  refreshCachePattern(/indicators/i)
}

export const indicatorApi = {
  /**
   * 获取所有活跃指标
   * @param year 可选的年份过滤参数
   */
  async getAllIndicators(
    year?: number,
    pagination?: { page?: number; size?: number },
    options: { force?: boolean } = {}
  ): Promise<ApiResponse<IndicatorVO[]>> {
    const params: Record<string, number> = {}
    if (typeof year === 'number') {
      params.year = year
    }
    if (typeof pagination?.page === 'number') {
      params.page = pagination.page
    }
    if (typeof pagination?.size === 'number') {
      params.size = pagination.size
    }
    return fetchWithCache({
      key: buildQueryKey('indicator', 'list', withIndicatorCacheContext(params)),
      policy: {
        ttlMs: 2 * 60 * 1000,
        scope: 'session',
        persist: true,
        staleWhileRevalidate: true,
        dedupeWindowMs: 1000,
        tags: ['indicator.list']
      },
      force: options.force === true,
      fetcher: () => apiClient.get<ApiResponse<IndicatorVO[]>>('/indicators', params)
    })
  },

  /**
   * 获取指标详情
   */
  async getIndicatorById(indicatorId: string): Promise<ApiResponse<IndicatorVO>> {
    return fetchWithCache({
      key: buildQueryKey(
        'indicator',
        'detail',
        withIndicatorCacheContext({ indicatorId: String(indicatorId) })
      ),
      policy: {
        ttlMs: 60 * 1000,
        scope: 'memory',
        dedupeWindowMs: 1000,
        tags: ['indicator.detail', `indicator.detail.${indicatorId}`]
      },
      fetcher: () => apiClient.get<ApiResponse<IndicatorVO>>(`/indicators/${indicatorId}`)
    })
  },

  /**
   * 按任务获取指标
   */
  async getIndicatorsByTask(taskId: string): Promise<ApiResponse<IndicatorVO[]>> {
    return fetchWithCache({
      key: buildQueryKey(
        'indicator',
        'list',
        withIndicatorCacheContext({ taskId: String(taskId) })
      ),
      policy: {
        ttlMs: 2 * 60 * 1000,
        scope: 'session',
        persist: true,
        staleWhileRevalidate: true,
        dedupeWindowMs: 1000,
        tags: ['indicator.list', `indicator.task.${taskId}`]
      },
      fetcher: () => apiClient.get<ApiResponse<IndicatorVO[]>>(`/indicators/task/${taskId}`)
    })
  },

  /**
   * 获取任务的根指标
   */
  async getRootIndicatorsByTask(taskId: string): Promise<ApiResponse<IndicatorVO[]>> {
    return apiClient.get<ApiResponse<IndicatorVO[]>>(`/indicators/task/${taskId}/root`)
  },

  /**
   * 按发布方组织获取指标
   */
  async getIndicatorsByOwnerOrg(ownerOrgId: string): Promise<ApiResponse<IndicatorVO[]>> {
    return fetchWithCache({
      key: buildQueryKey(
        'indicator',
        'list',
        withIndicatorCacheContext({ ownerOrgId: String(ownerOrgId) })
      ),
      policy: {
        ttlMs: 2 * 60 * 1000,
        scope: 'session',
        persist: true,
        staleWhileRevalidate: true,
        dedupeWindowMs: 1000,
        tags: ['indicator.list', `indicator.ownerOrg.${ownerOrgId}`]
      },
      fetcher: () => apiClient.get<ApiResponse<IndicatorVO[]>>(`/indicators/owner/${ownerOrgId}`)
    })
  },

  /**
   * 按责任方组织获取指标
   */
  async getIndicatorsByTargetOrg(targetOrgId: string): Promise<ApiResponse<IndicatorVO[]>> {
    return fetchWithCache({
      key: buildQueryKey(
        'indicator',
        'list',
        withIndicatorCacheContext({ targetOrgId: String(targetOrgId) })
      ),
      policy: {
        ttlMs: 2 * 60 * 1000,
        scope: 'session',
        persist: true,
        staleWhileRevalidate: true,
        dedupeWindowMs: 1000,
        tags: ['indicator.list', `indicator.targetOrg.${targetOrgId}`]
      },
      fetcher: () => apiClient.get<ApiResponse<IndicatorVO[]>>(`/indicators/target/${targetOrgId}`)
    })
  },

  /**
   * 搜索指标
   */
  async searchIndicators(keyword: string): Promise<ApiResponse<IndicatorVO[]>> {
    return fetchWithCache({
      key: buildQueryKey('indicator', 'search', withIndicatorCacheContext({ keyword })),
      policy: {
        ttlMs: 2 * 60 * 1000,
        scope: 'session',
        persist: true,
        staleWhileRevalidate: true,
        dedupeWindowMs: 1000,
        tags: ['indicator.list', 'indicator.search']
      },
      fetcher: () =>
        apiClient.get<ApiResponse<IndicatorVO[]>>('/indicators/search', { params: { keyword } })
    })
  },

  // ==================== 指标下发相关接口 ====================

  /**
   * 检查指标是否可以下发
   */
  async checkDistributionEligibility(
    indicatorId: string
  ): Promise<ApiResponse<IndicatorDistributionEligibility>> {
    return apiClient.get<ApiResponse<IndicatorDistributionEligibility>>(
      `/indicators/${indicatorId}/distribution-eligibility`
    )
  },

  /**
   * 下发指标到目标组织
   *
   * 这是一个关键操作，使用显式重试逻辑（最多3次，指数退避）
   * 因为指标下发涉及数据库写入和组织关系建立，网络不稳定可能导致失败
   *
   * **Validates: Requirements 2.4**
   *
   * @param request 下发请求参数
   */
  async distributeIndicator(
    request: IndicatorDistributionRequest
  ): Promise<ApiResponse<IndicatorVO>> {
    return withRetry(async () => {
      const params = new URLSearchParams()
      params.append('targetOrgId', request.targetOrgId)
      if (request.customDesc) {
        params.append('customDesc', request.customDesc)
      }
      if (request.actorUserId) {
        params.append('actorUserId', request.actorUserId)
      }

      return apiClient.post<ApiResponse<IndicatorVO>>(
        `/indicators/${request.parentIndicatorId}/distribute?${params.toString()}`
      )
    })
  },

  /**
   * 批量下发指标到多个目标组织
   *
   * 这是一个关键操作，使用显式重试逻辑（最多3次，指数退避）
   * 批量操作涉及多个数据库事务，失败后重试可以提高成功率
   *
   * **Validates: Requirements 2.4**
   *
   * @param request 批量下发请求参数
   */
  async batchDistributeIndicator(
    request: BatchDistributionRequest
  ): Promise<ApiResponse<IndicatorVO[]>> {
    return withRetry(async () => {
      const params = request.actorUserId ? `?actorUserId=${request.actorUserId}` : ''

      return apiClient.post<ApiResponse<IndicatorVO[]>>(
        `/indicators/${request.parentIndicatorId}/distribute/batch${params}`,
        request.targetOrgIds.map(id => parseInt(id, 10))
      )
    })
  },

  async batchDistributePageIndicators(request: {
    indicators: Array<{
      clientRequestId: string
      indicatorId?: number
      targetOrgId: number
      customDesc?: string
    }>
  }): Promise<
    ApiResponse<{
      totalCount: number
      items: Array<{
        clientRequestId: string
        indicatorId: number
      }>
    }>
  > {
    return withRetry(async () => {
      return apiClient.post<
        ApiResponse<{
          totalCount: number
          items: Array<{
            clientRequestId: string
            indicatorId: number
          }>
        }>
      >('/indicators/actions/batch-distribute', request)
    })
  },

  /**
   * 获取已下发的子指标列表
   */
  async getDistributedIndicators(parentIndicatorId: string): Promise<ApiResponse<IndicatorVO[]>> {
    return apiClient.get<ApiResponse<IndicatorVO[]>>(`/indicators/${parentIndicatorId}/distributed`)
  },

  /**
   * 撤回已下发的指标
   * 将指标状态从 DISTRIBUTED 改回 DRAFT，允许重新编辑
   *
   * 这是一个关键操作，使用显式重试逻辑（最多3次，指数退避）
   * 撤回操作需要确保成功，避免数据不一致
   *
   * 权限要求: 仅战略发展部可以调用
   *
   * @param indicatorId 指标ID
   */
  async withdrawIndicator(indicatorId: string): Promise<ApiResponse<IndicatorVO>> {
    return withRetry(async () => {
      return apiClient.post<ApiResponse<IndicatorVO>>(`/indicators/${indicatorId}/withdraw`)
    })
  },

  /**
   * 批量撤回指标
   * 撤回指定发布部门发给目标学院的所有已下发指标
   *
   * 这是一个关键操作，使用显式重试逻辑（最多3次，指数退避）
   * 批量撤回操作在单个事务中完成，确保数据一致性
   *
   * 权限要求: 仅战略发展部可以调用
   *
   * @param ownerOrgId 发布部门ID
   * @param targetOrgId 目标学院ID
   * @param reason 撤回原因（可选）
   */
  async batchWithdrawIndicators(
    ownerOrgId: number,
    targetOrgId: number,
    planId?: number,
    reason?: string
  ): Promise<
    ApiResponse<{
      totalCount: number
      successCount: number
      failedCount: number
      withdrawnIndicatorIds: number[]
      errors: string[]
    }>
  > {
    return withRetry(async () => {
      return apiClient.post<
        ApiResponse<{
          totalCount: number
          successCount: number
          failedCount: number
          withdrawnIndicatorIds: number[]
          errors: string[]
        }>
      >('/indicators/batch-withdraw', {
        ownerOrgId,
        targetOrgId,
        ...(typeof planId === 'number' ? { planId } : {}),
        reason: reason || ''
      })
    })
  },

  /**
   * 更新指标
   *
   * 这是一个关键操作，使用显式重试逻辑（最多3次，指数退避）
   * 指标更新可能涉及复杂的业务逻辑和数据验证，重试可以处理临时性错误
   *
   * **Validates: Requirements 2.4**
   *
   * @param indicatorId 指标ID
   * @param updates 更新的字段
   */
  async updateIndicator(
    indicatorId: string,
    updates: Partial<IndicatorVO>
  ): Promise<ApiResponse<IndicatorVO>> {
    return withRetry(async () => {
      console.log('[API] updateIndicator request:', indicatorId, updates)
      const result = await apiClient.put<ApiResponse<IndicatorVO>>(
        `/indicators/${indicatorId}`,
        updates
      )
      console.log('[API] updateIndicator response:', result)
      invalidateIndicatorListCaches(indicatorId)
      return result
    })
  },

  /**
   * 创建新指标
   *
   * 这是一个关键操作，使用显式重试逻辑（最多3次，指数退避）
   * 指标创建是核心业务操作，需要确保成功率
   *
   * **Validates: Requirements 2.4**
   *
   * @param request 指标创建请求
   */
  async createIndicator(request: IndicatorCreateRequest): Promise<ApiResponse<IndicatorVO>> {
    return withRetry(async () => {
      const result = await apiClient.post<ApiResponse<IndicatorVO>>('/indicators', request)
      const createdId = result.data?.data?.id
      invalidateIndicatorListCaches(createdId ? String(createdId) : undefined)
      return result
    })
  },

  /**
   * 删除指标
   *
   * 这是一个关键操作，使用显式重试逻辑（最多3次，指数退避）
   * 删除操作需要确保执行成功，避免数据不一致
   *
   * **Validates: Requirements 2.4**
   *
   * @param indicatorId 指标ID
   */
  async deleteIndicator(indicatorId: string): Promise<ApiResponse<void>> {
    return withRetry(async () => {
      const result = await apiClient.delete<ApiResponse<void>>(`/indicators/${indicatorId}`)
      invalidateIndicatorListCaches(indicatorId)
      return result
    })
  },

  // ==================== 指标审核工作流接口 ====================

  /**
   * 提交指标进行定义审核
   * 状态转换: DRAFT → PENDING_REVIEW
   *
   * 这是一个关键操作，使用显式重试逻辑（最多3次，指数退避）
   * 提交审核是指标生命周期的重要节点，需要确保成功
   *
   * **Validates: Requirements 2.3, 2.5, 2.6**
   *
   * @param indicatorId 指标ID
   */
  async submitIndicatorForReview(indicatorId: string): Promise<ApiResponse<IndicatorVO>> {
    return withRetry(async () => {
      return apiClient.post<ApiResponse<IndicatorVO>>(`/indicators/${indicatorId}/submit`)
    })
  },

  /**
   * 批准指标定义审核
   * 状态转换: PENDING_REVIEW → DISTRIBUTED
   *
   * 这是一个关键操作，使用显式重试逻辑（最多3次，指数退避）
   * 审核批准是指标生命周期的关键节点，需要确保成功
   *
   * 权限要求: 仅战略发展部可以调用
   *
   * **Validates: Requirements 2.7, 2.8**
   *
   * @param indicatorId 指标ID
   */
  async approveIndicatorReview(indicatorId: string): Promise<ApiResponse<IndicatorVO>> {
    return withRetry(async () => {
      return apiClient.post<ApiResponse<IndicatorVO>>(`/indicators/${indicatorId}/approve`)
    })
  },

  /**
   * 驳回指标定义审核
   * 状态转换: PENDING_REVIEW → DRAFT
   *
   * 这是一个关键操作，使用显式重试逻辑（最多3次，指数退避）
   * 审核驳回需要记录原因并确保状态正确回退
   *
   * 权限要求: 仅战略发展部可以调用
   *
   * **Validates: Requirements 2.7, 2.8**
   *
   * @param indicatorId 指标ID
   * @param reason 驳回原因（必填）
   */
  async rejectIndicatorReview(
    indicatorId: string,
    reason: string
  ): Promise<ApiResponse<IndicatorVO>> {
    return withRetry(async () => {
      return apiClient.post<ApiResponse<IndicatorVO>>(`/indicators/${indicatorId}/reject`, {
        reason
      })
    })
  }
}

export default indicatorApi
