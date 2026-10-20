import JSZip from 'jszip'
import {
  buildExcelBlob,
  normalizeExportAttachments,
  sanitizeFileName,
  saveBlobAsFile,
  type ExcelExportSheet,
  type ExportAttachment
} from './excel'

/**
 * 2026-10-20 用户定案：全部导出 = 每个部门一个 Excel 文件，打成 zip 一次下载；
 * 附件随包一并导出（zip 内 {部门}/附件/ 目录存放原始文件）。
 *
 * 这样解决两个老问题：
 * ① 多部门塞进一个工作簿时序号跨部门连续、回导对不上 → 现在一部门一文件，序号各自从 1 开始；
 * ② 附件只有超链接、离线打不开 → 现在原始文件就在包里。
 */

export interface DepartmentExportPayload {
  /** 部门名（用于目录与文件名） */
  department: string
  /** 该部门的导出 sheet（通常单 sheet） */
  sheets: ExcelExportSheet<unknown>[]
  /** 该部门涉及的全部附件（去重后下载） */
  attachments?: ExportAttachmentRef[]
}

export type ExportAttachmentRef = ExportAttachment

const ATTACHMENT_DIR = '附件'

/** 从若干行数据里收集附件（用于一次性下载） */
export function collectAttachmentRefs(rows: unknown[]): ExportAttachmentRef[] {
  const seen = new Set<string>()
  const result: ExportAttachmentRef[] = []
  rows.forEach(row => {
    const candidates =
      (row as { pendingAttachmentDetails?: unknown })?.pendingAttachmentDetails ??
      (row as { pendingAttachments?: unknown })?.pendingAttachments
    normalizeExportAttachments(candidates).forEach(item => {
      const key = item.attachmentId ? `id:${item.attachmentId}` : `url:${item.url || item.name}`
      if (seen.has(key)) return
      seen.add(key)
      result.push({ name: item.name, url: item.url, attachmentId: item.attachmentId })
    })
  })
  return result
}

/** 下载单个附件为 Blob（走登录态；失败返回 null，不阻断整包导出） */
async function downloadAttachment(ref: ExportAttachmentRef): Promise<Blob | null> {
  const url =
    ref.url || (ref.attachmentId ? `/api/v1/attachments/${ref.attachmentId}/download` : '')
  if (!url) return null
  try {
    // 同源请求自动带 Cookie / Authorization 由 axios 拦截器负责；这里用 fetch 简化，
    // 对需要 token 的下载接口，url 通常是相对路径且浏览器已登录（同源 Cookie 或前端已注入头）。
    const response = await fetch(url, { credentials: 'include' })
    if (!response.ok) return null
    return await response.blob()
  } catch {
    return null
  }
}

function uniqueName(name: string, used: Set<string>): string {
  const safe = sanitizeFileName(name) || '未命名'
  if (!used.has(safe)) {
    used.add(safe)
    return safe
  }
  const dot = safe.lastIndexOf('.')
  const base = dot > 0 ? safe.slice(0, dot) : safe
  const ext = dot > 0 ? safe.slice(dot) : ''
  let i = 2
  while (used.has(`${base}_${i}${ext}`)) i += 1
  const next = `${base}_${i}${ext}`
  used.add(next)
  return next
}

/**
 * 导出多个部门：每部门一个 xlsx，附件放各自部门的 附件/ 目录，统一打包 zip。
 * 只有 1 个部门且无附件时直接下 xlsx，避免不必要的解压步骤。
 */
export async function exportDepartmentsAsZip(
  payloads: DepartmentExportPayload[],
  zipFileName: string,
  options: { onProgress?: (text: string) => void } = {}
): Promise<void> {
  const { onProgress } = options
  const totalAttachments = payloads.reduce((sum, p) => sum + (p.attachments?.length || 0), 0)

  // 单部门且无附件：直接给 xlsx（符合“一个部门一个文件”）
  const single = payloads.length === 1 ? payloads[0] : null
  if (single && totalAttachments === 0) {
    const blob = await buildExcelBlob(single.sheets)
    saveBlobAsFile(
      blob,
      sanitizeFileName(`${single.department}_${zipFileName.replace(/\.zip$/i, '')}.xlsx`)
    )
    return
  }

  const zip = new JSZip()
  for (const payload of payloads) {
    onProgress?.(`正在生成 ${payload.department} 表格…`)
    const deptDir = zip.folder(sanitizeFileName(payload.department) || '部门')
    const blob = await buildExcelBlob(payload.sheets)
    deptDir?.file(sanitizeFileName(`${payload.department}.xlsx`), blob)

    const attachments = payload.attachments || []
    if (attachments.length > 0) {
      const attachDir = deptDir?.folder(ATTACHMENT_DIR)
      const used = new Set<string>()
      for (let i = 0; i < attachments.length; i += 1) {
        const ref = attachments[i]
        if (!ref) continue
        onProgress?.(`正在打包附件 ${payload.department}（${i + 1}/${attachments.length}）…`)
        const fileBlob = await downloadAttachment(ref)
        if (fileBlob) {
          attachDir?.file(uniqueName(ref.name, used), fileBlob)
        }
      }
    }
  }

  onProgress?.('正在压缩…')
  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  saveBlobAsFile(zipBlob, sanitizeFileName(zipFileName))
}
