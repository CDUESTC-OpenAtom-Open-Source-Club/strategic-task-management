import { apiClient } from '@/shared/api/client'
import type { ApiResponse } from '@/shared/types/api'

export type BusinessImportType = 'strategic-task' | 'distribution'
export type ImportAction = 'CREATE' | 'UPDATE' | 'SKIP' | 'ERROR'
export type ConflictMode = 'APPEND' | 'UPDATE' | 'REPLACE_SCOPE'

export interface ImportSummary {
  totalRows: number
  validRows: number
  createRows: number
  updateRows: number
  skipRows: number
  errorRows: number
  warningRows: number
}

export interface ImportFieldMapping {
  sourceColumn: string
  targetField: string
  confidence: string
}

export interface ImportMilestoneValue {
  name: string
  dueAt: string | null
  targetProgress: number | null
}

export interface ImportNormalizedRow {
  department?: string
  college?: string
  taskType?: string
  strategicTask?: string
  parentStrategicTask?: string
  parentIndicator?: string
  indicatorName?: string
  indicatorType?: string
  weight?: number | string | null
  remark?: string
  parentIndicatorId?: number | string | null
  milestones?: ImportMilestoneValue[]
}

export interface ImportRowPreview {
  rowNo: number
  action: ImportAction
  businessKey: string
  normalized: ImportNormalizedRow
  source: Record<string, string>
  errors: string[]
  warnings: string[]
}

export interface ImportPreviewResponse {
  batchId: string
  type: 'STRATEGIC_TASK' | 'DISTRIBUTION'
  fileName: string
  sheetName: string
  targetOrgId: number
  targetOrgName: string
  summary: ImportSummary
  fieldMappings: ImportFieldMapping[]
  rows: ImportRowPreview[]
  blocking: boolean
  confirmToken: string
}

export interface ImportCommitRequest {
  confirmToken: string
  conflictMode: ConflictMode
  autoSubmitAndApprove: boolean
  comment?: string
}

export interface ImportWorkflowResult {
  autoSubmitAndApprove: boolean
  workflowCode?: string | null
  instanceId?: number | null
  status?: string | null
  approvedSteps?: number | null
  failedStep?: string | null
  message?: string | null
}

export interface ImportCommitResponse {
  batchId: string
  status: string
  createdCount: number
  updatedCount: number
  skippedCount: number
  workflow: ImportWorkflowResult
}

export interface StrategicImportPreviewParams {
  cycleId: number
  targetOrgId: number
  sheetName?: string
}

export interface DistributionImportPreviewParams {
  cycleId: number
  targetCollegeOrgId: number
  sheetName?: string
}

function unwrap<T>(response: ApiResponse<T>): T {
  return response.data
}

export const businessImportApi = {
  async previewStrategicTaskImport(file: File, params: StrategicImportPreviewParams) {
    const response = await apiClient.upload<ApiResponse<ImportPreviewResponse>>(
      '/imports/strategic-tasks/preview',
      file,
      params as unknown as Record<string, unknown>
    )
    return unwrap(response)
  },

  async commitStrategicTaskImport(batchId: string, request: ImportCommitRequest) {
    const response = await apiClient.post<ApiResponse<ImportCommitResponse>>(
      `/imports/strategic-tasks/${encodeURIComponent(batchId)}/commit`,
      request
    )
    return unwrap(response)
  },

  async previewDistributionImport(file: File, params: DistributionImportPreviewParams) {
    const response = await apiClient.upload<ApiResponse<ImportPreviewResponse>>(
      '/imports/distribution/preview',
      file,
      params as unknown as Record<string, unknown>
    )
    return unwrap(response)
  },

  async commitDistributionImport(batchId: string, request: ImportCommitRequest) {
    const response = await apiClient.post<ApiResponse<ImportCommitResponse>>(
      `/imports/distribution/${encodeURIComponent(batchId)}/commit`,
      request
    )
    return unwrap(response)
  }
}
