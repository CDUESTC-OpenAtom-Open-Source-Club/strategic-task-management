import { indicatorFillApi } from '@/features/plan/api/planApi'
import { normalizeExportAttachments, type ExportAttachment } from '@/shared/lib/export/excel'
import { logger } from '@/shared/lib/utils/logger'

/**
 * 指标「当前登录人可见」的最新一轮填报附件（2026-10-28 用户定案）。
 *
 * 导出必须与页面同构：
 *  - 填报组织本人：最新一轮（含尚未发起审批的草稿，页面实时可见）；
 *  - 上级/其他组织：最新一轮非草稿（上一轮已上报快照）。
 *
 * 可见性由后端判定，前端只做展示与打包，不再自行拼装附件来源。
 */
export interface IndicatorAttachmentSummary {
  indicatorId: string
  round?: number
  fillDate?: string
  attachments: ExportAttachment[]
}

export type IndicatorAttachmentSummaryMap = Map<string, IndicatorAttachmentSummary>

/**
 * 批量加载可见附件。
 * 返回 `null` 表示接口失败——调用方应回退到行内附件，而不是当成「没有附件」。
 */
export async function loadIndicatorAttachmentSummaryMap(
  indicatorIds: Array<string | number | null | undefined>
): Promise<IndicatorAttachmentSummaryMap | null> {
  const uniqueIds = Array.from(
    new Set(
      indicatorIds
        .map(id => (id === null || id === undefined ? '' : String(id).trim()))
        .filter(id => /^\d+$/.test(id))
    )
  )
  if (uniqueIds.length === 0) {
    return new Map()
  }

  try {
    // 后端单次上限 2000 个指标：分片请求后合并，避免大导出直接 400
    const chunkSize = 2000
    const chunks: string[][] = []
    for (let index = 0; index < uniqueIds.length; index += chunkSize) {
      chunks.push(uniqueIds.slice(index, index + chunkSize))
    }

    const responses = await Promise.all(
      chunks.map(chunk => indicatorFillApi.getLatestVisibleIndicatorAttachments(chunk))
    )
    const map: IndicatorAttachmentSummaryMap = new Map()

    responses.forEach(response => {
      const list = Array.isArray(response?.data) ? response.data : []
      list.forEach(item => {
        const indicatorId = String(item.indicatorId)
        map.set(indicatorId, {
          indicatorId,
          round: item.round,
          fillDate: item.fillDate,
          attachments: normalizeExportAttachments(item.attachments)
        })
      })
    })

    return map
  } catch (error) {
    logger.warn('[indicatorAttachmentSummary] 批量查询可见附件失败，回退到行内附件:', error)
    return null
  }
}

/** 取某指标的可见附件汇总；接口失败时返回 undefined */
export function getAttachmentSummary(
  map: IndicatorAttachmentSummaryMap | null,
  indicatorId: string | number | null | undefined
): IndicatorAttachmentSummary | undefined {
  if (map === null || indicatorId === null || indicatorId === undefined) {
    return undefined
  }
  return map.get(String(indicatorId))
}

/**
 * 解析某指标在本次导出中应带的附件。
 * 接口成功时以服务端可见结果为准（即使为空）；仅接口失败时回退到行内附件。
 */
export function resolveVisibleAttachments(
  map: IndicatorAttachmentSummaryMap | null,
  indicatorId: string | number | null | undefined,
  fallback: () => ExportAttachment[]
): ExportAttachment[] {
  if (map === null) {
    return fallback()
  }
  return getAttachmentSummary(map, indicatorId)?.attachments ?? []
}
