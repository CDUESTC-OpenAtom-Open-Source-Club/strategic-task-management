import { describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'

const { mockSaveBlobAsFile } = vi.hoisted(() => ({
  mockSaveBlobAsFile: vi.fn()
}))

// 2026-11-12「全部导出」回归锁定（A1 实测缺陷报告：zip 内 19 个部门文件 md5 全同、
// 内容都是末位部门数据）。本测试不复刻 zipExport.test.ts 的全局 mock：
// buildExcelBlob（write-excel-file 真实生成 xlsx 字节）与 JSZip（真实打包/解包）
// 都走真实实现，只把浏览器下载侧 saveBlobAsFile 换成捕获桩，从而在「每部门一次
// 独立生成 → 打包 zip」的完整链路上断言：每个部门文件只含本部门数据、互不相同。
vi.mock('./excel', async importOriginal => {
  const actual = await importOriginal<typeof import('./excel')>()
  return {
    ...actual,
    saveBlobAsFile: mockSaveBlobAsFile
  }
})

vi.mock('@/5-shared/api/client', () => ({
  apiClient: {
    getAxiosInstance: () => ({
      get: vi.fn(async () => ({ data: null }))
    })
  }
}))

import JSZip from 'jszip'
import { exportDepartmentsAsZip, type DepartmentExportPayload } from './zipExport'
import type { ExcelExportSheet } from './excel'

/** 构造与真实导出同构的单部门 sheet：部门列整列合并 + 核心指标列 */
const buildDepartmentSheet = (
  department: string,
  indicatorNames: string[]
): ExcelExportSheet<{ name: string; exportDepartment: string }> => ({
  sheetName: department,
  rows: indicatorNames.map(name => ({ name, exportDepartment: department })),
  columns: [
    {
      header: '部门',
      width: 18,
      getValue: (row, index) =>
        index === 0
          ? { value: row.exportDepartment, rowSpan: indicatorNames.length, alignVertical: 'center' }
          : null
    },
    { header: '核心指标', width: 32, getValue: row => row.name }
  ]
})

const buildPayload = (department: string, indicators: string[]): DepartmentExportPayload => ({
  department,
  sheets: [buildDepartmentSheet(department, indicators) as ExcelExportSheet<unknown>],
  attachmentGroups: []
})

/** 读取 xlsx 内 sharedStrings（含表头与全部单元格文本） */
const readSharedStrings = async (xlsxBytes: Uint8Array): Promise<string[]> => {
  const workbook = await JSZip.loadAsync(xlsxBytes)
  const sharedStringsFile = workbook.file('xl/sharedStrings.xml')
  if (!sharedStringsFile) return []
  const xml = await sharedStringsFile.async('string')
  return [...xml.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(match => match[1])
}

/** 读取 workbook.xml 的 sheet name（字节级身份：不同部门必然不同名） */
const readSheetName = async (xlsxBytes: Uint8Array): Promise<string> => {
  const workbook = await JSZip.loadAsync(xlsxBytes)
  const workbookXml = await workbook.file('xl/workbook.xml')?.async('string')
  const match = workbookXml?.match(/<sheet[^>]*name="([^"]*)"/)
  return match?.[1] ?? ''
}

const md5 = (bytes: Uint8Array): string => crypto.createHash('md5').update(bytes).digest('hex')

describe('exportDepartmentsAsZip 按部门独立生成（2026-11-12 缺陷回归锁定）', () => {
  const payloads = [
    buildPayload('教务处', ['教务处核心指标一', '教务处核心指标二']),
    buildPayload('科技处', ['科技处核心指标一']),
    buildPayload('纪委办公室 - 监察处', ['纪委核心指标一']),
    buildPayload('国际合作与交流处', ['国际交流核心指标一'])
  ]

  it('每个部门文件只含本部门数据：内容互不相同，末位部门不污染其他部门', async () => {
    mockSaveBlobAsFile.mockClear()
    await exportDepartmentsAsZip(payloads, '战略任务指标总表_多部门_2026-11-12.zip')

    expect(mockSaveBlobAsFile).toHaveBeenCalledTimes(1)
    const [blob, fileName] = mockSaveBlobAsFile.mock.calls[0]
    expect(fileName).toBe('战略任务指标总表_多部门_2026-11-12.zip')
    expect(blob).toBeInstanceOf(Blob)

    const zip = await JSZip.loadAsync(blob)
    const entries = Object.values(zip.files).filter(
      file => !file.dir && file.name.endsWith('.xlsx')
    )
    expect(entries).toHaveLength(payloads.length)

    const md5ByEntry = new Map<string, string>()
    for (const entry of entries) {
      const bytes = await entry.async('uint8array')
      md5ByEntry.set(entry.name, md5(bytes))

      const folder = entry.name.split('/')[0]
      const ownPayload = payloads.find(payload => payload.department === folder)
      expect(ownPayload, `zip 内目录 ${folder} 必须来自输入 payload`).toBeDefined()

      const strings = await readSharedStrings(bytes)
      // 表头 + 本部门数据必须齐全
      expect(strings).toContain('部门')
      expect(strings).toContain('核心指标')
      for (const indicator of ownPayload ? ownPayloadSheetIndicators(ownPayload) : []) {
        expect(strings, `${folder} 必须含本部门指标「${indicator}」`).toContain(indicator)
      }
      // 其他部门的指标一个都不许出现
      for (const other of payloads) {
        if (other.department === folder) continue
        for (const indicator of ownPayloadSheetIndicators(other)) {
          expect(
            strings,
            `${folder} 不得混入 ${other.department} 的指标「${indicator}」`
          ).not.toContain(indicator)
        }
      }
      // sheet name（写进 workbook.xml 的字节）必须等于部门名
      expect(await readSheetName(bytes)).toBe(folder)
    }

    // 多部门多文件：md5 两两互不相同（缺陷报告里「全部相同」即在此被拦下）
    const uniqueMd5 = new Set(md5ByEntry.values())
    expect(uniqueMd5.size).toBe(payloads.length)
  })

  it('单部门且无附件时保持直接下载 xlsx 的既有口径', async () => {
    mockSaveBlobAsFile.mockClear()
    await exportDepartmentsAsZip([buildPayload('国际合作与交流处', ['国际交流核心指标一'])], 'x.zip')

    const [, fileName] = mockSaveBlobAsFile.mock.calls[0]
    expect(fileName).toMatch(/\.xlsx$/)
  })
})

/** 从 payload 里取 sheet 的指标名（测试内辅助，避免 any） */
function ownPayloadSheetIndicators(payload: DepartmentExportPayload): string[] {
  const sheet = payload.sheets[0] as ExcelExportSheet<{ name: string }>
  return sheet.rows.map(row => String(row.name))
}
