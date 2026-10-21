import { apiClient } from '@/shared/api/client'
import type { ApiResponse } from '@/shared/types'

export interface MutationHistoryItem {
  log_id: number
  action: string
  before_json: Record<string, unknown> | null
  after_json: Record<string, unknown> | null
  changed_fields: Record<string, { before?: unknown; after?: unknown }> | null
  actor_user_id: number | null
  created_at: string
}

export interface MutationInProgressItem {
  id: number
  indicator_desc: string
  weight_percent: number
  target_org_id: number
  mutation_status: string
  mutation_started_at: string
}

/**
 * P5 指标异动 API（仅战略发展部可发起）
 */
export const mutationApi = {
  /** 发起异动：原地修改+写快照+启动 PLAN_MUTATION_STRATEGY 三级审批（2026-10-20 起不再锁死其他模块） */
  async initiate(
    indicatorId: number | string,
    changes: { indicator_desc?: string; weight_percent?: number; remark?: string }
  ): Promise<ApiResponse<string>> {
    return apiClient.post(`/indicators/${indicatorId}/mutation`, changes)
  },

  /**
   * 2026-10-20：已下发计划新增指标后，立即为该新指标发起异动审批。
   * 与 initiate 的区别：无 before 值（快照记为「(新增)」），节点链相同。
   */
  async initiateForCreate(indicatorId: number | string): Promise<ApiResponse<string>> {
    return apiClient.post(`/indicators/${indicatorId}/mutation-for-create`, {})
  },

  /**
   * 2026-10-21 用户定案：一次异动可同时调整多条指标——字段攒改与新增指标
   * 整批一次提交；后端先全部应用再统一做权重合计校验，任一失败整批不生效。
   * item：{ id, create?: true 表示新增指标, indicator_desc?/weight_percent?/remark?: 变更值 }
   */
  async initiateBatch(
    items: Array<{
      id: number | string
      create?: boolean
      indicator_desc?: string
      weight_percent?: number
      remark?: string
    }>
  ): Promise<ApiResponse<string[]>> {
    return apiClient.post('/indicators/mutations/batch', { items })
  },

  /** 异动历史（已更改 N 次 + 历史版本快照） */
  async history(indicatorId: number | string): Promise<ApiResponse<MutationHistoryItem[]>> {
    return apiClient.get(`/indicators/${indicatorId}/mutation-history`)
  },

  /** 战略任务异动历史（任务改名同样计入「已更改 N 次」） */
  async taskHistory(taskId: number | string): Promise<ApiResponse<MutationHistoryItem[]>> {
    return apiClient.get(`/tasks/${taskId}/mutation-history`)
  },

  /** 异动中指标清单（看板异动汇总数据源） */
  async inMutation(): Promise<ApiResponse<MutationInProgressItem[]>> {
    return apiClient.get('/indicators/mutations/in-progress')
  },

  /** 异动审批实例清单（审批中心「异动审批」卡片数据源，含进行中与已完成） */
  async approvals(orgId: number | string): Promise<
    ApiResponse<
      Array<{
        instance_id: number
        indicator_id: number
        indicator_desc: string
        status: string
        created_at: string
        completed_at?: string
      }>
    >
  > {
    return apiClient.get('/indicators/mutation-approvals', { params: { orgId } })
  }
}
