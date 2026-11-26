import type { Cell, SheetData } from 'write-excel-file/browser'
import { formatLocalDateTag } from '@/shared/lib/utils/localDateTag'
import {
  clearSheetExtras,
  isEmptySheetExtras,
  registerSheetExtras,
  xlsxExtrasFeature,
  type SheetDataValidation
} from './xlsxFeatures'

export type ExcelRowTone = 'default' | 'basic' | 'development' | 'draft' | 'warning' | 'template'

export interface ExcelExportColumn<T> {
  header: string
  width?: number
  align?: 'left' | 'center' | 'right'
  getValue: (row: T, index: number) => Cell
  /**
   * 该列隐藏：写入 `<col ... hidden="1"/>`。
   * 注意：隐藏列仍然写数据（例如「来源说明」这类辅助列）。
   */
  hidden?: boolean
  /**
   * 该列输出**裸值**：表头格与数据格都不套任何样式对象。
   * 由于全局 `fontFamily/fontSize` 会让每个格子带上 `s="0"`，
   * 真正「裸」还需要 XML 层剥离 `s` 索引（由 `xlsxFeatures` 的 plainColumns 完成）。
   */
  plain?: boolean
  /** 表头底色覆盖（缺省沿用 sheet.headerBackgroundColor / 默认深蓝） */
  headerBackgroundColor?: string
  /** 表头文字颜色覆盖（缺省沿用 sheet.headerTextColor / 默认白色） */
  headerTextColor?: string
  /** 表头字号覆盖 */
  headerFontSize?: number
  /** 表头边框颜色覆盖 */
  headerBorderColor?: string
  /**
   * 该列字体族覆盖（表头与数据格都生效）。
   *
   * 2026-11-26（上报模板对齐）：需求方样例（SISM-导入模板-04/05/06）正文用「微软雅黑」，
   * 而工作簿全局默认字体是另一个字体名，故按列覆盖。
   * 缺省不产出该字段 → 与改动前逐字节一致。
   */
  fontFamily?: string
  /** 数据行底色覆盖 */
  bodyBackgroundColor?: string
  /** 数据行文字颜色覆盖 */
  bodyTextColor?: string
  /** 数据行字号覆盖 */
  bodyFontSize?: number
  /** 数据行垂直对齐覆盖 */
  bodyAlignVertical?: 'top' | 'center' | 'bottom'
  /** 数据行边框颜色覆盖 */
  bodyBorderColor?: string
  /** 数据行水平对齐覆盖（优先级高于 column.align） */
  bodyAlign?: 'left' | 'center' | 'right'
}

export interface ExcelExportSheet<T> {
  sheetName: string
  rows: T[]
  columns: ExcelExportColumn<T>[]
  emptyMessage?: string
  getRowTone?: (row: T, index: number) => ExcelRowTone
  getRowTextColor?: (row: T, index: number) => string | undefined
  /** 表头底色（默认深蓝 #1f4e78；传 '#ffffff' 可做「无底色标题区」） */
  headerBackgroundColor?: string
  /** 表头文字颜色（默认白色） */
  headerTextColor?: string
  /** 表头行高（磅），不传则用默认 */
  headerHeight?: number
  /** 数据行高（磅），不传则用默认 */
  bodyRowHeight?: number
  /** 冻结行数（默认 1；0 表示不冻结） */
  stickyRowsCount?: number
  /** 冻结列数（默认 0） */
  stickyColumnsCount?: number
  /** 是否显示网格线（默认 false，与既有导出一致） */
  showGridLines?: boolean
  /**
   * 不生成表头行：`rows[0]` 即第 1 行（用于「填写说明」这类无表头说明页）。
   *
   * <p>缺省（undefined/false）仍生成表头行——既有调用方行为零变化。
   * 开启后表头相关的 sheet 级字段（headerHeight/headerBackgroundColor…）不生效。
   */
  skipHeaderRow?: boolean
  /** 隐藏列（1-based 列号，与 columns[].hidden 取并集） */
  hiddenColumns?: number[]
  /** 裸值列（1-based 列号，与 columns[].plain 取并集） */
  plainColumns?: number[]
  /** 数据有效性（下拉）规则 */
  dataValidations?: SheetDataValidation[]
  /** 工作表保护（整表保护；逐格 locked 解锁属已知限制，见 xlsxFeatures 注释） */
  sheetProtection?: {
    /** 保护密码（明文写入 `password` 属性） */
    password?: string
  }
}

export interface ExportAttachment {
  name: string
  url?: string
  attachmentId?: number | string | null
}

type CellObject = Exclude<Cell, string | number | boolean | Date | null | undefined>

/**
 * 单元格样式覆盖属性。
 *
 * 不能直接用 `Partial<CellObject>`：本仓库的 `CellObject` 别名是
 * `Exclude<Cell, string | number | boolean | Date | null | undefined>`，
 * 而 write-excel-file 的 `Value` 里含 `String`/`Number`/`Boolean` **构造器**类型，
 * 它们不在 exclude 名单里 → `Partial<CellObject>` 变成联合类型，
 * 访问 `backgroundColor` 等属性会报 TS2339。故此处显式声明本模块用到的样式字段。
 */
interface ExcelCellStyle {
  backgroundColor?: string
  textColor?: string
  fontSize?: number
  fontFamily?: string
  borderColor?: string
  alignVertical?: 'top' | 'center' | 'bottom'
}

/**
 * 2026-10-31 用户拍板（部门/学院列整列合并）：一份导入/导出锁定一个部门或学院，
 * 该列跨全部数据行合并成 1 格——首行携带 rowSpan=数据行数，其余行传 null
 * （write-excel-file 语义同组内合并：被上方 rowSpan 覆盖的从属格必须传 null）。
 * 解析兼容：合并从属格读空=默认当前部门/学院，既有语义不变。
 */
export function buildWholeColumnMergedCell(
  index: number,
  totalRows: number,
  value: string | number
): Cell {
  if (totalRows <= 1 || index < 0 || index >= totalRows) {
    return value
  }
  if (index === 0) {
    return { value, rowSpan: totalRows, alignVertical: 'center' }
  }
  return null
}

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
  warning: { backgroundColor: '#fff1f0' },
  // 导入模板示例数据行底色（对齐纸质模板样式）
  template: { backgroundColor: '#fff2cc' }
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

function toStyledCell<T>(
  value: Cell,
  style: ExcelCellStyle,
  column: Pick<ExcelExportColumn<T>, 'align' | 'bodyAlign'>,
  rowTone: ExcelRowTone,
  rowTextColor?: string
): Cell {
  const base = isCellObject(value) ? value : { value: value ?? '' }
  return {
    ...bodyStyle,
    ...toneStyleMap[rowTone],
    align: column.bodyAlign ?? column.align ?? 'left',
    ...base,
    ...(rowTextColor ? { textColor: rowTextColor } : {}),
    ...style
  }
}

/** 表头格的列级样式覆盖（缺省一律不产出，保证与改动前逐字节一致） */
function buildHeaderCellOverride<T>(column: ExcelExportColumn<T>): ExcelCellStyle {
  const override: ExcelCellStyle = {}
  if (column.headerBackgroundColor !== undefined) {
    override.backgroundColor = column.headerBackgroundColor
  }
  if (column.headerTextColor !== undefined) {
    override.textColor = column.headerTextColor
  }
  if (column.headerFontSize !== undefined) {
    override.fontSize = column.headerFontSize
  }
  if (column.headerBorderColor !== undefined) {
    override.borderColor = column.headerBorderColor
  }
  if (column.fontFamily !== undefined) {
    override.fontFamily = column.fontFamily
  }
  return override
}

/** 数据格的列级样式覆盖（缺省一律不产出，保证与改动前逐字节一致） */
function buildBodyCellOverride<T>(column: ExcelExportColumn<T>): ExcelCellStyle {
  const override: ExcelCellStyle = {}
  if (column.bodyBackgroundColor !== undefined) {
    override.backgroundColor = column.bodyBackgroundColor
  }
  if (column.bodyTextColor !== undefined) {
    override.textColor = column.bodyTextColor
  }
  if (column.bodyFontSize !== undefined) {
    override.fontSize = column.bodyFontSize
  }
  if (column.bodyAlignVertical !== undefined) {
    override.alignVertical = column.bodyAlignVertical
  }
  if (column.bodyBorderColor !== undefined) {
    override.borderColor = column.bodyBorderColor
  }
  if (column.fontFamily !== undefined) {
    override.fontFamily = column.fontFamily
  }
  return override
}

/**
 * 把单元格对象还原成「裸值」：只保留值/类型/数字格式，去掉一切样式属性。
 * 非对象值（原样 string/number/boolean/Date）直接返回。
 */
function toPlainCell(value: Cell): Cell {
  if (!isCellObject(value)) {
    return value
  }
  const plain: Record<string, unknown> = {}
  if ('value' in value) {
    plain.value = value.value
  }
  const typed = value as { type?: unknown; format?: unknown }
  if (typed.type !== undefined) {
    plain.type = typed.type
  }
  if (typed.format !== undefined) {
    plain.format = typed.format
  }
  return plain as Cell
}

export function buildSheetData<T>(sheet: ExcelExportSheet<T>): SheetData {
  const headerBackgroundColor = sheet.headerBackgroundColor ?? headerStyle.backgroundColor
  const headerTextColor = sheet.headerTextColor ?? headerStyle.textColor
  const headerRow = sheet.columns.map(column => {
    // `plain` 列的表头格输出裸值：不套任何样式对象。
    if (column.plain) {
      return column.header
    }
    return {
      value: column.header,
      ...headerStyle,
      backgroundColor: headerBackgroundColor,
      textColor: headerTextColor,
      ...buildHeaderCellOverride(column),
      ...(sheet.headerHeight ? { height: sheet.headerHeight } : {})
    }
  })

  if (sheet.rows.length === 0) {
    if (sheet.skipHeaderRow) {
      // 无表头页且无数据行 → 空表（不塞「暂无数据」占位行，避免与样例口径不符）
      return []
    }
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
      // `plain` 列的数据格输出裸值：不套任何样式对象。
      if (column.plain) {
        return toPlainCell(value)
      }
      const cell = toStyledCell(value, buildBodyCellOverride(column), column, rowTone, rowTextColor)
      if (sheet.bodyRowHeight && isCellObject(cell)) {
        return { ...cell, height: sheet.bodyRowHeight }
      }
      return cell
    })
  })

  return sheet.skipHeaderRow ? bodyRows : [headerRow, ...bodyRows]
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
 * 收集某个 sheet 的隐藏列 / 裸值列（1-based 列号）。
 * 来源：columns[].hidden / columns[].plain（按列下标 +1）与 sheet 级 hiddenColumns / plainColumns。
 */
function collectColumnFlags<T>(sheet: ExcelExportSheet<T>): {
  hiddenColumns: number[]
  plainColumns: number[]
} {
  const hiddenColumns = new Set<number>(sheet.hiddenColumns ?? [])
  const plainColumns = new Set<number>(sheet.plainColumns ?? [])

  sheet.columns.forEach((column, index) => {
    const columnNumber = index + 1
    if (column.hidden) {
      hiddenColumns.add(columnNumber)
    }
    if (column.plain) {
      plainColumns.add(columnNumber)
    }
  })

  return {
    hiddenColumns: [...hiddenColumns].sort((a, b) => a - b),
    plainColumns: [...plainColumns].sort((a, b) => a - b)
  }
}

/**
 * 2026-10-20：把多 sheet 工作簿构建为 Blob（不触发下载），
 * 供「按部门打包 zip」等场景复用。
 */
export async function buildExcelBlob(sheets: ExcelExportSheet<unknown>[]): Promise<Blob> {
  const { default: writeXlsxFile } = await loadExcelWriter()
  const usedSheetNames = new Set<string>()

  // 先算好最终 sheet 名（重名会被加后缀），再按最终名注册附加能力，
  // 否则 feature 里按 sheetOptions.sheet 查不到注册项。
  const prepared = sheets.map(sheet => {
    const sheetName = createUniqueSheetName(sheet.sheetName, usedSheetNames)
    const flags = collectColumnFlags(sheet)
    const extras = {
      hiddenColumns: flags.hiddenColumns,
      plainColumns: flags.plainColumns,
      dataValidations: sheet.dataValidations,
      sheetProtection: sheet.sheetProtection
    }
    if (!isEmptySheetExtras(extras)) {
      registerSheetExtras(sheetName, extras)
    }
    return {
      data: buildSheetData(sheet),
      sheet: sheetName,
      columns: sheet.columns.map(column => ({ width: column.width ?? 18 })),
      stickyRowsCount: sheet.stickyRowsCount ?? 1,
      stickyColumnsCount: sheet.stickyColumnsCount ?? 0,
      showGridLines: sheet.showGridLines ?? false
    }
  })

  try {
    return await writeXlsxFile(prepared, {
      fontFamily: 'Microsoft YaHei',
      fontSize: 11,
      features: [xlsxExtrasFeature]
    }).toBlob()
  } finally {
    // 每次生成后清理注册表，避免跨次泄漏。
    clearSheetExtras()
  }
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
