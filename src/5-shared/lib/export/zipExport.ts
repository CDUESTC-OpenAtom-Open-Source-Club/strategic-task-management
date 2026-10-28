import JSZip from 'jszip'
import { apiClient } from '@/5-shared/api/client'
import {
  buildExcelBlob,
  normalizeExportAttachments,
  sanitizeFileName,
  saveBlobAsFile,
  type ExcelExportSheet,
  type ExportAttachment
} from './excel'
import {
  buildAttachmentFileName,
  buildIndicatorDirName,
  ensureUniqueName,
  sanitizePathSegment
} from './fileName'

/**
 * 2026-10-28 用户定案（替代 2026-10-20 版本）：
 * 全部导出 = 每个部门一个 Excel 文件，打成 zip 一次下载；附件随包一并导出。
 *
 * 包内结构：
 *   {部门}/{部门}.xlsx
 *   {部门}/附件/{序号}_{指标名截断}/R{轮次}_{填报日期}_{原文件名}
 *
 * 指标名可能上百字，目录名按 UTF-8 字节安全截断（见 fileName.ts），
 * 序号才是稳定主键；Excel 的「附件目录」列写包内相对路径，保持指标与附件的关联。
 *
 * 附件来源必须与页面可见性同构（2026-10-28 业务规则）：
 * 由后端按「当前登录人可见范围」返回最新一轮填报附件，前端只负责打包。
 */

export interface ExportAttachmentGroup {
  /** 导出表里的序号（与 Excel「序号」列一致） */
  seq: number
  /** 指标名称（仅用于生成可读目录名，会按字节截断） */
  indicatorName: string
  /** 填报轮次（1 起）；下发阶段附件没有轮次 */
  round?: number
  /** 填报日期 YYYY-MM-DD；下发阶段附件没有日期 */
  fillDate?: string
  attachments: ExportAttachment[]
}

export interface DepartmentExportPayload {
  /** 部门名（用于目录与文件名） */
  department: string
  /** 该部门的导出 sheet（通常单 sheet） */
  sheets: ExcelExportSheet<unknown>[]
  /** 该部门涉及的全部附件（按指标分组） */
  attachmentGroups?: ExportAttachmentGroup[]
}

export type ExportAttachmentRef = ExportAttachment

export const ATTACHMENT_DIR = '附件'

/** Excel「附件目录」列的值：包内相对路径（未解压时也能看出该指标有附件） */
export function buildAttachmentRelativeDir(
  group: Pick<ExportAttachmentGroup, 'seq' | 'indicatorName'>
): string {
  return `${ATTACHMENT_DIR}/${buildIndicatorDirName(group.seq, group.indicatorName)}`
}

/** 从若干行数据里按指标收集附件（用于一次性下载） */
export function collectAttachmentGroups(
  rows: Array<{
    seq: number
    indicatorName: string
    attachments?: unknown
    round?: number
    fillDate?: string
  }>
): ExportAttachmentGroup[] {
  const groups: ExportAttachmentGroup[] = []

  rows.forEach(row => {
    // 只在本行内去重：同一附件若确实关联到两个指标，两个目录里都要有，
    // 否则 Excel 的「附件目录」会指向一个不存在的路径。
    const seen = new Set<string>()
    const attachments = normalizeExportAttachments(row.attachments)
      .map(item => ({
        name: item.name,
        url: item.url,
        attachmentId: item.attachmentId
      }))
      .filter(item => {
        const key = item.attachmentId ? `id:${item.attachmentId}` : `url:${item.url || item.name}`
        if (seen.has(key)) {
          return false
        }
        seen.add(key)
        return true
      })

    if (attachments.length === 0) {
      return
    }

    groups.push({
      seq: row.seq,
      indicatorName: row.indicatorName,
      round: row.round,
      fillDate: row.fillDate,
      attachments
    })
  })

  return groups
}

/** 统计一批导出任务里的附件总数（用于给用户准确的成功提示） */
export function countExportAttachments(payloads: DepartmentExportPayload[]): number {
  return payloads.reduce(
    (sum, payload) =>
      sum +
      (payload.attachmentGroups || []).reduce(
        (groupSum, group) => groupSum + group.attachments.length,
        0
      ),
    0
  )
}

/** 下载单个附件为 Blob（走登录态；失败返回 null，不阻断整包导出） */
async function downloadAttachment(ref: ExportAttachmentRef): Promise<Blob | null> {
  const url =
    ref.url || (ref.attachmentId ? `/api/v1/attachments/${ref.attachmentId}/download` : '')
  if (!url) return null
  try {
    // 走 apiClient（axios 实例）以复用鉴权拦截器，避免绕过统一请求层
    const response = await apiClient.getAxiosInstance().get(url, { responseType: 'blob' })
    return new Blob([response.data])
  } catch {
    return null
  }
}

/**
 * 导出多个部门：每部门一个 xlsx，附件放各自部门的 附件/{序号}_{指标名}/ 目录，统一打包 zip。
 * 只有 1 个部门且无附件时直接下 xlsx，避免不必要的解压步骤。
 */
export async function exportDepartmentsAsZip(
  payloads: DepartmentExportPayload[],
  zipFileName: string,
  options: { onProgress?: (text: string) => void } = {}
): Promise<void> {
  const { onProgress } = options
  const totalAttachments = countExportAttachments(payloads)

  // 单部门且无附件：直接给 xlsx（符合“一个部门一个文件”）
  const single = payloads.length === 1 ? payloads[0] : null
  if (single && totalAttachments === 0) {
    const blob = await buildExcelBlob(single.sheets)
    // zipFileName 由调用方拼好（已含部门/范围与日期），这里只换扩展名，避免部门名重复
    saveBlobAsFile(blob, sanitizeFileName(`${zipFileName.replace(/\.zip$/i, '')}.xlsx`))
    return
  }

  const zip = new JSZip()
  for (const payload of payloads) {
    const departmentName = sanitizePathSegment(payload.department)
    onProgress?.(`正在生成 ${departmentName} 表格…`)

    const departmentDir = zip.folder(departmentName)
    const blob = await buildExcelBlob(payload.sheets)
    departmentDir?.file(sanitizePathSegment(`${departmentName}.xlsx`), blob)

    const groups = payload.attachmentGroups || []
    const totalInDepartment = groups.reduce((sum, group) => sum + group.attachments.length, 0)
    let downloaded = 0

    for (const group of groups) {
      const attachmentDir = departmentDir?.folder(buildAttachmentRelativeDir(group))
      const usedNames = new Set<string>()

      for (const ref of group.attachments) {
        downloaded += 1
        onProgress?.(`正在打包附件 ${departmentName}（${downloaded}/${totalInDepartment}）…`)
        const fileBlob = await downloadAttachment(ref)
        if (fileBlob) {
          attachmentDir?.file(
            ensureUniqueName(
              buildAttachmentFileName(ref.name, { round: group.round, fillDate: group.fillDate }),
              usedNames
            ),
            fileBlob
          )
        }
      }
    }
  }

  onProgress?.('正在压缩…')
  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  saveBlobAsFile(zipBlob, sanitizeFileName(zipFileName))
}
