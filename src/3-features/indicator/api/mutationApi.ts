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
  /** 发起异动：原地修改+写快照+启动 PLAN_MUTATION_STRATEGY 三级审批并全面锁死该组织 */
  async initiate(
    indicatorId: number | string,
    changes: { indicator_desc?: string; weight_percent?: number; remark?: string }
  ): Promise<ApiResponse<string>> {
    return apiClient.post(`/indicators/${indicatorId}/mutation`, changes)
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
  }
}
