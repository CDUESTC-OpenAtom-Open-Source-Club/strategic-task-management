import { apiClient } from '@/shared/api/client'
import type { ApiResponse } from '@/shared/types/api'

/**
 * 2026-11-25（二级学院填报导入）：填报页「导入 / 批量导入」接口。
 *
 * <p>与战略发展部的「学院子指标下发」导入（/imports/distribution）不同：
 * 这里只写「自评等级 + 进度说明」，落库结果是月度草稿，不触发审批。
 */

export type ReportFillRowAction = 'UPDATE' | 'SKIP' | 'ERROR'

export interface ReportFillPreviewRow {
  rowNo: number
  indicatorId: number | null
  indicatorName: string
  selfRating: string | null
  selfRatingLabel: string | null
  description: string
  existingSelfRating: string | null
  existingDescription: string | null
  weight: string
  action: ReportFillRowAction
  errors: string[]
  warnings: string[]
}

export interface ReportFillPreviewGroup {
  functionalOrgId: number | null
  functionalOrgName: string
  planId: number | null
  planStatus: string | null
  reportId: number | null
  reportStatus: string | null
  rows: ReportFillPreviewRow[]
  errors: string[]
}

export interface ReportFillPreviewSummary {
  totalRows: number
  validRows: number
  skipRows: number
  errorRows: number
}

export interface ReportFillPreviewResponse {
  batchId: string
  fileName: string
  cycleId: number
  reportMonth: string
  targetOrgId: number
  targetOrgName: string
  summary: ReportFillPreviewSummary
  groups: ReportFillPreviewGroup[]
  confirmToken: string
}

export interface ReportFillCommitGroupResult {
  functionalOrgId: number | null
  functionalOrgName: string
  planId: number | null
  reportId: number | null
  savedRows: number
  status: string
  message: string
}

export interface ReportFillCommitResponse {
  batchId: string
  status: string
  totalSaved: number
  blockedGroups: number
  groups: ReportFillCommitGroupResult[]
}

export interface ReportFillPreviewParams {
  cycleId: number
  reportMonth: string
}

function unwrap<T>(response: ApiResponse<T>): T {
  // 与 businessImport.ts 保持一致的约定：非 2xx 由 apiClient 抛错，载荷直接取 data
  if (!response) {
    throw new Error('请求失败')
  }
  return response.data
}

export const reportFillImportApi = {
  async preview(file: File, params: ReportFillPreviewParams) {
    const response = await apiClient.upload<ApiResponse<ReportFillPreviewResponse>>(
      '/imports/report-fill/preview',
      file,
      { cycleId: params.cycleId, reportMonth: params.reportMonth }
    )
    return unwrap(response)
  },

  async commit(batchId: string, request: { confirmToken?: string; comment?: string }) {
    const response = await apiClient.post<ApiResponse<ReportFillCommitResponse>>(
      `/imports/report-fill/${encodeURIComponent(batchId)}/commit`,
      request
    )
    return unwrap(response)
  }
}
