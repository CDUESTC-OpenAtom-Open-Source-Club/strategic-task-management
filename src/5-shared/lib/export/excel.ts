import type { Cell, SheetData } from 'write-excel-file/browser'
import { formatLocalDateTag } from '@/shared/lib/utils/localDateTag'

export type ExcelRowTone = 'default' | 'basic' | 'development' | 'draft' | 'warning'

export interface ExcelExportColumn<T> {
  header: string
  width?: number
  align?: 'left' | 'center' | 'right'
  getValue: (row: T, index: number) => Cell
}

export interface ExcelExportSheet<T> {
  sheetName: string
  rows: T[]
  columns: ExcelExportColumn<T>[]
  emptyMessage?: string
  getRowTone?: (row: T, index: number) => ExcelRowTone
  getRowTextColor?: (row: T, index: number) => string | undefined
}

export interface ExportAttachment {
  name: string
  url?: string
  attachmentId?: number | string | null
}

type CellObject = Exclude<Cell, string | number | boolean | Date | null | undefined>

const headerStyle = {
  fontWeight: 'bold' as const,
  textColor: '#ffffff',
  backgroundColor: '#1f4e78',
  align: 'center' as const,
  alignVertical: 'center' as const,
  borderColor: '#8ea9c1',
  borderStyle: 'thin' as const,
  wrap: true
}

const bodyStyle = {
  alignVertical: 'top' as const,
  borderColor: '#d9e2ec',
  borderStyle: 'thin' as const,
  wrap: true
}

const toneStyleMap: Record<ExcelRowTone, Partial<CellObject>> = {
  default: {},
  basic: { backgroundColor: '#f3f9ec' },
  development: { backgroundColor: '#eaf4ff' },
  draft: { backgroundColor: '#fff7e6' },
  warning: { backgroundColor: '#fff1f0' }
}

let excelWriterPromise: Promise<typeof import('write-excel-file/browser')> | null = null

async function loadExcelWriter() {
  if (!excelWriterPromise) {
    excelWriterPromise = import('write-excel-file/browser')
  }
  return excelWriterPromise
}

function isCellObject(value: Cell): value is CellObject {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    !(value instanceof Date) &&
    !Array.isArray(value) &&
    ('value' in value || 'type' in value)
  )
}

function toStyledCell(
  value: Cell,
  style: Partial<CellObject>,
  column: Pick<ExcelExportColumn<unknown>, 'align'>,
  rowTone: ExcelRowTone,
  rowTextColor?: string
): Cell {
  const base = isCellObject(value) ? value : { value: value ?? '' }
  return {
    ...bodyStyle,
    ...toneStyleMap[rowTone],
    align: column.align ?? 'left',
    ...base,
    ...(rowTextColor ? { textColor: rowTextColor } : {}),
    ...style
  }
}

export function buildSheetData<T>(sheet: ExcelExportSheet<T>): SheetData {
  const headerRow = sheet.columns.map(column => ({
    value: column.header,
    ...headerStyle
  }))

  if (sheet.rows.length === 0) {
    return [
      headerRow,
      [
        {
          value: sheet.emptyMessage || '暂无可导出的数据',
          columnSpan: sheet.columns.length,
          align: 'center',
          alignVertical: 'center',
          borderColor: '#d9e2ec',
          borderStyle: 'thin',
          backgroundColor: '#f8fafc',
          textColor: '#64748b'
        }
      ]
    ]
  }

  const bodyRows = sheet.rows.map((row, rowIndex) => {
    const rowTone = sheet.getRowTone?.(row, rowIndex) ?? 'default'
    const rowTextColor = sheet.getRowTextColor?.(row, rowIndex)
    return sheet.columns.map(column => {
      const value = column.getValue(row, rowIndex)
      // 2026-10-14：getValue 返回 null 表示该单元格被上方 rowSpan 合并覆盖，
      // write-excel-file 要求被覆盖单元格原样传 null/undefined，不得携带值。
      if (value === null || value === undefined) {
        return null
      }
      return toStyledCell(value, {}, column, rowTone, rowTextColor)
    })
  })

  return [headerRow, ...bodyRows]
}

function createUniqueSheetName(name: string, usedNames: Set<string>): string {
  const baseName = normalizeSheetName(name)
  let nextName = baseName
  let index = 2

  while (usedNames.has(nextName)) {
    const suffix = `_${index}`
    nextName = `${baseName.slice(0, 31 - suffix.length)}${suffix}`
    index += 1
  }

  usedNames.add(nextName)
  return nextName
}

export async function exportRowsToExcel<T>(
  sheet: ExcelExportSheet<T>,
  fileName: string
): Promise<void> {
  await exportSheetsToExcel([sheet as ExcelExportSheet<unknown>], fileName)
}

export async function exportSheetsToExcel(
  sheets: ExcelExportSheet<unknown>[],
  fileName: string
): Promise<void> {
  const blob = await buildExcelBlob(sheets)
  await saveBlobAsFile(blob, sanitizeFileName(fileName))
}

/**
 * 2026-10-20：把多 sheet 工作簿构建为 Blob（不触发下载），
 * 供「按部门打包 zip」等场景复用。
 */
export async function buildExcelBlob(sheets: ExcelExportSheet<unknown>[]): Promise<Blob> {
  const { default: writeXlsxFile } = await loadExcelWriter()
  const usedSheetNames = new Set<string>()
  const excelSheets = sheets.map(sheet => ({
    data: buildSheetData(sheet),
    sheet: createUniqueSheetName(sheet.sheetName, usedSheetNames),
    columns: sheet.columns.map(column => ({ width: column.width ?? 18 })),
    stickyRowsCount: 1,
    showGridLines: false
  }))

  return writeXlsxFile(excelSheets, {
    fontFamily: 'Microsoft YaHei',
    fontSize: 11
  }).toBlob()
}

/** 触发浏览器下载（统一封装，避免各处重复写 a[download] 逻辑） */
export function saveBlobAsFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function buildExportFileName(pageName: string, scopeName?: string): string {
  // 2026-10-30（N-20）：改用本地时区日期标签。原先用 toISOString()（UTC），
  // 东八区本地 00:00~08:00 之间导出会把文件名写成前一天。
  const dateText = formatLocalDateTag()
  const parts = [pageName, scopeName, dateText].filter(Boolean)
  return `${sanitizeFileName(parts.join('_'))}.xlsx`
}

export function normalizeSheetName(value: string): string {
  const normalized = String(value || 'Sheet')
    .replace(/[\\/?*:[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return (normalized || 'Sheet').slice(0, 31)
}

export function sanitizeFileName(value: string): string {
  return String(value || 'export.xlsx')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

export function formatProgress(currentValue: unknown, reportedValue?: unknown): string {
  const current = toFiniteNumber(currentValue)
  const reported = toFiniteNumber(reportedValue)
  const currentText = `当前进度：${formatPercent(current)}`

  if (reported === null) {
    return currentText
  }

  return `${currentText}（填报进度：${formatPercent(reported)}）`
}

export function normalizeExportAttachments(input: unknown): ExportAttachment[] {
  if (!input) {
    return []
  }

  const source = typeof input === 'string' ? parseAttachmentString(input) : input
  const list = Array.isArray(source) ? source : [source]

  return list
    .map((item, index): ExportAttachment | null => {
      if (typeof item === 'string') {
        const url = normalizeAttachmentUrl(item)
        return {
          name: getNameFromUrl(url) || `附件${index + 1}`,
          url
        }
      }

      if (!isRecord(item)) {
        return null
      }

      const attachmentId = getFirstValue(item, ['attachmentId', 'id'])
      const rawUrl =
        getFirstText(item, ['url', 'downloadUrl', 'publicUrl', 'public_url', 'href']) ||
        (attachmentId ? `/api/v1/attachments/${attachmentId}/download` : '')
      const url = normalizeAttachmentUrl(rawUrl)
      const name =
        getFirstText(item, ['fileName', 'originalName', 'original_name', 'name', 'title']) ||
        getNameFromUrl(url) ||
        `附件${index + 1}`

      return {
        name,
        url,
        attachmentId: attachmentId as string | number | null | undefined
      }
    })
    .filter((item): item is ExportAttachment => Boolean(item && (item.name || item.url)))
}

export function buildAttachmentCell(input: unknown): Cell {
  const attachments = normalizeExportAttachments(input)

  if (attachments.length === 0) {
    return '-'
  }

  if (attachments.length === 1 && attachments[0].url) {
    const attachment = attachments[0]
    return {
      value: `=HYPERLINK("${escapeFormulaText(attachment.url)}","${escapeFormulaText(
        attachment.name
      )}")`,
      type: 'Formula',
      textColor: '#0563c1',
      textDecoration: { underline: true },
      wrap: true
    }
  }

  return attachments
    .map(attachment =>
      attachment.url ? `${attachment.name}：${attachment.url}` : `${attachment.name}`
    )
    .join('\n')
}

/**
 * 2026-10-28：附件本体打进 zip 后，Excel 里只列文件名，
 * 由「附件目录」列给出包内相对路径，避免单元格里塞长 URL。
 */
export function buildAttachmentNameCell(input: unknown): Cell {
  const attachments = normalizeExportAttachments(input)

  if (attachments.length === 0) {
    return '-'
  }

  return attachments.map(attachment => attachment.name).join('\n')
}

function parseAttachmentString(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) {
    return []
  }

  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
    return trimmed
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

function normalizeAttachmentUrl(value: unknown): string {
  const rawUrl = String(value || '').trim()
  if (!rawUrl) {
    return ''
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(rawUrl)) {
    return rawUrl
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return new URL(rawUrl, window.location.origin).href
  }

  return rawUrl
}

function getNameFromUrl(url: string): string {
  const lastSegment = url.split('/').pop() || ''
  return decodeURIComponent(lastSegment.split('?')[0] || '').trim()
}

function escapeFormulaText(value: string): string {
  return String(value).replace(/"/g, '""')
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return '-'
  }
  return Number.isInteger(value) ? `${value}%` : `${Number(value.toFixed(2))}%`
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0')
}

function toFiniteNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : null
}

function getFirstText(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (value === undefined || value === null) {
      continue
    }

    const text = String(value).trim()
    if (text) {
      return text
    }
  }

  return ''
}

function getFirstValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) {
      return record[key]
    }
  }

  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
