import { apiClient } from '@/shared/api/client'
import type { ApiResponse } from '@/shared/types/api'

/**
 * 2026-11-25（指标填报导入式上报 · 学院侧）：API 封装。
 *
 * <p>与 {@code features/import/api/businessImport.ts}（导入<b>下发</b>）是两条独立链路，
 * 端点路径隔离在 {@code /imports/fill/**}。
 */

/** 自评等级码（后端归一后的 AHEAD / NORMAL / DELAYED）。 */
export type ReportFillLevelCode = 'AHEAD' | 'NORMAL' | 'DELAYED'

/** 预览的一行（一条待填报的子指标）。 */
export interface ReportFillRowPreview {
  rowNo: number
  college: string
  functionalDept: string
  indicatorName: string
  weight: string
  selfRating: string
  level: ReportFillLevelCode | null
  remark: string
  indicatorId: number | null
  matchedName: string | null
  errors: string[]
  warnings: string[]
}

/** 一个归口线的分组（= 一份月报）。 */
export interface ReportFillGroup {
  functionalOrgId: number | null
  functionalOrgName: string
  planId: number | null
  rowsCount: number
  willSubmit: boolean
  /** 组级错误（非空 = 该组不可提交，标红） */
  groupError: string | null
  /** 组级跳过原因（非空且 groupError 为空 = 该组将跳过，标灰） */
  skipReason: string | null
  rows: ReportFillRowPreview[]
}

/** 预览响应。 */
export interface ReportFillPreviewResponse {
  batchId: string
  cycleId: number
  reportMonth: string
  targetCollegeOrgId: number
  targetCollegeName: string
  groups: ReportFillGroup[]
  /** 是否至少有一条可提交的归口线（前端据此决定「确认导入」能否点） */
  hasSubmittableGroup: boolean
  /** 整单不可提交（= 没有任何可提交的组）；单组出错不等于整单阻断 */
  blocking: boolean
  confirmToken: string
}

/** 单个归口线的提交结果。 */
export interface ReportFillGroupResult {
  functionalOrgId: number | null
  functionalOrgName: string
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED'
  reportId: number | null
  rowsCount: number
  message: string
}

/** 提交响应。 */
export interface ReportFillCommitResponse {
  results: ReportFillGroupResult[]
  summary: {
    success: number
    skipped: number
    failed: number
  }
}

/** 预览入参。 */
export interface ReportFillPreviewParams {
  /** 考核周期 id（用于定位「学院 × 归口」的已下发计划线） */
  cycleId: number
  /** 归属月份（yyyyMM）——模板不含月份列，由界面选择 */
  reportMonth: string
  /**
   * 导入模式。
   *
   * <p>`single` = 单归口入口（必须给 functionalOrgId，后端只提交该归口线，文件内其它线标记为将跳过）；
   * `all`（默认）= 批量入口（文件内出现的归口线全部提交）。
   *
   * <p>刻意用显式 mode 而不是「functionalOrgId 是否为 null」隐式表达——
   * null 与「没传」无法区分，会让单归口静默退化成批量。
   */
  mode: ReportFillImportModeParam
  /** 单归口入口选中的归口部门 id（mode=single 时必填） */
  functionalOrgId?: number | null
  sheetName?: string
}

/** 导入模式参数（与后端 PreviewMode 对齐）。 */
export type ReportFillImportModeParam = 'single' | 'all'

/** 提交入参。 */
export interface ReportFillCommitRequest {
  confirmToken: string
  comment?: string
}

function unwrap<T>(response: ApiResponse<T>): T {
  return response.data
}

/**
 * 上传参数清洗——**剔除 null / undefined / 空串的键**。
 *
 * <p>{@code apiClient.upload} 会把 additionalData 的每个键原样 {@code String(value)}
 * 写进 FormData：null → 字符串 "null"，后端 {@code @RequestParam Long xxx} 转换失败直接 400。
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

export const reportFillImportApi = {
  /** 解析预览：学院校验 → 归口线拆分 → 指标定位 → 等级白名单校验。 */
  async preview(file: File, params: ReportFillPreviewParams) {
    const response = await apiClient.upload<ApiResponse<ReportFillPreviewResponse>>(
      '/imports/fill/preview',
      file,
      compactUploadParams(params as unknown as Record<string, unknown>)
    )
    return unwrap(response)
  },

  /** 确认导入：逐归口线独立事务，落填报明细并提交该线的上报审批。 */
  async commit(batchId: string, request: ReportFillCommitRequest) {
    const response = await apiClient.post<ApiResponse<ReportFillCommitResponse>>(
      `/imports/fill/${encodeURIComponent(batchId)}/commit`,
      request
    )
    return unwrap(response)
  }
}
