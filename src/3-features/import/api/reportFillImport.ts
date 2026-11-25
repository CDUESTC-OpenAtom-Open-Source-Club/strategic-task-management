import { apiClient } from '@/shared/api/client'
import type { ApiResponse } from '@/shared/types/api'

/**
 * 2026-11-25（指标填报导入式上报）：API 封装。
 *
 * <p>与 {@code features/import/api/businessImport.ts}（导入<b>下发</b>）是两条独立链路，
 * 端点路径隔离在 {@code /imports/fill/**}。
 *
 * <p>覆盖两条上报流向（标准模板 04/05/06）：职能部门 → 战略发展部；学院 → 归口职能部门。
 */

/** 自评等级码（后端归一后的 AHEAD / NORMAL / DELAYED）。 */
export type ReportFillLevelCode = 'AHEAD' | 'NORMAL' | 'DELAYED'

/** 上报类型：FUNC_DEPT = 04 职能部门上报；COLLEGE = 05/06 学院上报。 */
export type ReportFillReportType = 'FUNC_DEPT' | 'COLLEGE'

/** 导入模式：single = 只提交所选目标部门那条线；all = 文件内出现的线全部提交。 */
export type ReportFillPreviewMode = 'single' | 'all'

/** 预览的一行（一条待填报的子指标）。 */
export interface ReportFillRowPreview {
  /** Excel 物理行号（1-based，含表头行） */
  rowNo: number
  /** 责任部门（来源）——必须等于登录人所在组织 */
  responsibleDept: string
  /** 目标部门 / 上报目标 */
  targetDept: string
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

/** 一条上报线的分组（= 一份月报）。 */
export interface ReportFillGroup {
  /** 目标部门 org id（04 = 战略发展部；05/06 = 归口职能部门） */
  targetOrgId: number | null
  targetOrgName: string
  planId: number | null
  rowsCount: number
  willSubmit: boolean
  /** 组级错误（非空 = 不可提交，标红） */
  groupError: string | null
  /** 组级跳过原因（非空且 groupError 为空 = 将跳过，标灰） */
  skipReason: string | null
  rows: ReportFillRowPreview[]
}

/** 预览响应。 */
export interface ReportFillPreviewResponse {
  reportType: ReportFillReportType
  batchId: string
  cycleId: number
  reportMonth: string
  responsibleOrgId: number
  responsibleOrgName: string
  groups: ReportFillGroup[]
  /** 是否至少有一条可提交的线（前端据此决定「确认导入」能否点） */
  hasSubmittableGroup: boolean
  /** 整单不可提交（= 没有任何可提交的组） */
  blocking: boolean
  confirmToken: string
}

/** 单条线的提交结果。 */
export interface ReportFillGroupResult {
  targetOrgId: number | null
  targetOrgName: string
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
  /** 考核周期 id */
  cycleId: number
  /** 归属月份（yyyyMM）——模板不含月份列，由界面选择 */
  reportMonth: string
  /**
   * 导入模式。
   *
   * <p>`single` = 05 单归口入口（必须给 targetOrgId，后端只提交该线，文件内其它线标记为将跳过）；
   * `all` = 04 职能部门单点 / 06 批量入口（文件内出现的线全部提交）。
   *
   * <p>刻意用显式 mode 而不是「targetOrgId 是否为 null」隐式表达——
   * null 与「没传」无法区分，会让单归口静默退化成批量。
   */
  mode: ReportFillPreviewMode
  /** 单归口入口选中的目标部门（归口职能部门）id */
  targetOrgId?: number | null
  sheetName?: string
}

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
  /** 解析预览：责任部门校验 → 按目标部门拆线 → 指标定位 → 等级白名单校验。 */
  async preview(file: File, params: ReportFillPreviewParams) {
    const response = await apiClient.upload<ApiResponse<ReportFillPreviewResponse>>(
      '/imports/fill/preview',
      file,
      compactUploadParams(params as unknown as Record<string, unknown>)
    )
    return unwrap(response)
  },

  /** 确认导入：逐线独立事务，落填报明细并提交该线的上报审批。 */
  async commit(batchId: string, request: ReportFillCommitRequest) {
    const response = await apiClient.post<ApiResponse<ReportFillCommitResponse>>(
      `/imports/fill/${encodeURIComponent(batchId)}/commit`,
      request
    )
    return unwrap(response)
  }
}
