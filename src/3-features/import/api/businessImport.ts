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
  /**
   * 2026-11-17（学院线粒度改造 · 规格书 4.9①）：归口部门组织 ID（Long，可空=未指定）。
   *
   * <p>学院子指标导入按「学院 × 归口部门」定位计划（线）——同一个学院在同一考核年度
   * 可以有多条归口部门各自的线。字段名由规格书第六节「契约」固定为 {@code functionalOrgId}，
   * 前端不得改名。缺省（undefined/null）= 未指定，后端回退既有定位口径。</p>
   *
   * <p>职能部门指标导入（strategic-task）不涉及归口维度，一律不传该字段。</p>
   */
  functionalOrgId?: number | null
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
  /** 2026-10-19：真覆盖模式软删除的旧指标数（不在文件覆盖集合中） */
  deletedCount: number
  workflow: ImportWorkflowResult
}

/**
 * 2026-11-19（学院全部导入 · 规划书 3.1③）：「全部导入」分组预览与逐组提交的 DTO。
 *
 * <p>后端把一份 Excel 按「职能部门」列拆成 N 组（每组 = 一个归口部门 = 一条
 * 「学院 × 归口」线），逐组独立校验与下发。前端只负责：分组预览渲染 → 执行清单 →
 * 逐组结果汇报，**不做任何本地业务判定**（组级权重、线状态、错误一律以后端为准）。</p>
 */

/** 单组线状态（后端 lineStatus） */
export type ImportGroupLineStatus = 'NONE' | 'DRAFT' | 'PENDING' | 'IN_REVIEW' | 'DISTRIBUTED'

/** 单组预览（后端 groups[] 元素） */
export interface ImportGroupPreview {
  /** 归口部门组织 ID；无法识别归属部门时为 null */
  functionalOrgId: number | null
  /** 归口部门名称；无法识别时为 null */
  functionalOrgName: string | null
  /** 该组对应的「学院 × 归口」线的状态 */
  lineStatus: ImportGroupLineStatus
  /** 本组是否会下发（true=常规下发；false=跳过或错误） */
  willDispatch: boolean
  /** 跳过原因（该线已下发等）；不下发时可能为 null */
  skipReason: string | null
  /** 组级错误（组内基础性权重合计 ≠ 100、该线在审等）；无错时为 null */
  groupError: string | null
  /** 组内基础性权重合计 */
  basicWeightTotal: number
  /** 组内行数 */
  rowsCount: number
  /** 组内行预览（形状同既有 ImportRowPreview） */
  rows: ImportRowPreview[]
}

/** 全部导入预览响应（后端 all-preview） */
export interface ImportAllPreviewResponse {
  batchId: string
  cycleId: number
  targetCollegeOrgId: number
  targetCollegeName: string
  groups: ImportGroupPreview[]
  /** 无法识别归属部门的行（反查不出归口） */
  unassignedRows: ImportRowPreview[]
  /** 是否存在阻断项（存在错误组时为 true → 前端置灰确认按钮） */
  blocking: boolean
  /** 提交凭证（commit 时回传，后端校验分组快照一致） */
  confirmToken?: string
}

/** 全部导入提交请求（后端 all-commit） */
export interface ImportAllCommitRequest {
  confirmToken: string
  autoSubmitAndApprove?: boolean
}

/** 单组提交结果（后端 results[] 元素） */
export interface ImportAllGroupResult {
  functionalOrgId: number | null
  functionalOrgName: string | null
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED'
  /** 成功组的计划（线）ID */
  planId: number | null
  rowsCount: number
  /** 跳过/失败原因 */
  message: string | null
}

/** 全部导入提交响应（后端 all-commit） */
export interface ImportAllCommitResponse {
  results: ImportAllGroupResult[]
  summary: {
    success: number
    skipped: number
    failed: number
  }
}

export interface StrategicImportPreviewParams {
  cycleId: number
  targetOrgId: number
  sheetName?: string
}

export interface DistributionImportPreviewParams {
  cycleId: number
  targetCollegeOrgId: number
  sourceOrgId?: number
  /**
   * 2026-11-17（学院线粒度改造 · 规格书 4.9①）：归口部门组织 ID（Long，可空=未指定）。
   *
   * <p>学院子指标表按「学院 × 归口部门」定位计划（线）：同一个学院在同一考核年度可以有
   * 多条归口部门各自的线，后端据此定位/新建该线并与文件父级反查做**交叉校验**
   * （跨归口或与所选归口不一致 → 阻断，提示「请按归口部门分别导入」）。
   * 字段名由规格书第六节「契约」固定为 {@code functionalOrgId}，前端不得改名。</p>
   *
   * <p>取值来源：学院页签右侧「请选择职能部门」下拉的生效值（归一化部门名）解析出的
   * 组织 ID。未选归口部门时不传（undefined）——但前端门禁本就不允许未选归口发起导入。</p>
   */
  functionalOrgId?: number | null
  sheetName?: string
}

/**
 * 2026-11-19（学院全部导入）：全部导入预览入参。
 *
 * <p>与单条 {@link DistributionImportPreviewParams} 的差别：**不传 functionalOrgId**
 * （归口由文件内「职能部门」列解析，前端不做前置选择）；其余字段口径一致。</p>
 */
export interface DistributionAllImportPreviewParams {
  cycleId: number
  targetCollegeOrgId: number
  sourceOrgId?: number
  sheetName?: string
}

function unwrap<T>(response: ApiResponse<T>): T {
  return response.data
}

/**
 * 2026-11-17（学院线粒度改造）：上传参数清洗——**剔除 null / undefined 键**。
 *
 * <p>{@code apiClient.upload} 会把 additionalData 的每个键原样 {@code String(value)}
 * 写进 FormData：null → 字符串 "null"、undefined → 字符串 "undefined"，后端
 * {@code @RequestParam Long xxx} 收到后转换失败直接 400。新增的可选入参
 * （如归口部门 functionalOrgId）在未指定时必须**整个键不出现**，不能塞空串。</p>
 */
const compactUploadParams = (params: Record<string, unknown>): Record<string, unknown> => {
  const compacted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') {
      continue
    }
    compacted[key] = value
  }
  return compacted
}

export const businessImportApi = {
  async previewStrategicTaskImport(file: File, params: StrategicImportPreviewParams) {
    const response = await apiClient.upload<ApiResponse<ImportPreviewResponse>>(
      '/imports/strategic-tasks/preview',
      file,
      compactUploadParams(params as unknown as Record<string, unknown>)
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
      compactUploadParams(params as unknown as Record<string, unknown>)
    )
    return unwrap(response)
  },

  async commitDistributionImport(batchId: string, request: ImportCommitRequest) {
    const response = await apiClient.post<ApiResponse<ImportCommitResponse>>(
      `/imports/distribution/${encodeURIComponent(batchId)}/commit`,
      request
    )
    return unwrap(response)
  },

  /**
   * 2026-11-19（学院全部导入）：分组解析预览——后端按「职能部门」列把文件拆成 N 组。
   *
   * <p>入参沿用 {@link compactUploadParams} 清洗：null/undefined 键整个不出现
   * （apiClient.upload 会把 null 序列化成字符串 "null" 导致后端 400）。</p>
   */
  async previewDistributionAll(file: File, params: DistributionAllImportPreviewParams) {
    const response = await apiClient.upload<ApiResponse<ImportAllPreviewResponse>>(
      '/imports/distribution/all-preview',
      file,
      compactUploadParams(params as unknown as Record<string, unknown>)
    )
    return unwrap(response)
  },

  /**
   * 2026-11-19（学院全部导入）：逐组提交——后端按分组快照逐组建线/下发。
   */
  async commitDistributionAll(batchId: string, request: ImportAllCommitRequest) {
    const response = await apiClient.post<ApiResponse<ImportAllCommitResponse>>(
      `/imports/distribution/${encodeURIComponent(batchId)}/all-commit`,
      request
    )
    return unwrap(response)
  }
}
