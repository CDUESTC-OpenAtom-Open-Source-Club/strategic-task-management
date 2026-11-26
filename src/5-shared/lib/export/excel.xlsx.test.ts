import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { buildExcelBlob, buildSheetData, type ExcelExportSheet } from './excel'
import { clearSheetExtras, getSheetExtras, registerSheetExtras } from './xlsxFeatures'

/** 读取 xlsx 内某个文件的 xml 文本 */
const readPart = async (blob: Blob, path: string): Promise<string> => {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const file = zip.file(path)
  if (!file) {
    throw new Error(`xlsx 内缺少文件：${path}`)
  }
  return file.async('string')
}

/** 读取 xlsx 内所有文件的路径清单 */
const readPartNames = async (blob: Blob): Promise<string[]> => {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  return Object.keys(zip.files)
    .filter(name => !zip.files[name].dir)
    .sort()
}

/** 取出某个 `<c r="XX" ...>` 开始标签 */
const getCellTag = (sheetXml: string, reference: string): string => {
  const match = sheetXml.match(new RegExp(`<c r="${reference}"[^>]*>`))
  return match?.[0] ?? ''
}

/**
 * 校验 sheet xml 是**格式良好**的 XML。
 * （2026-11-26 实测事故：自闭合标签 `<col .../>` 上追加属性时若插在 `/` 之后，
 *  会产出 `<col .../ hidden="1">` 这种非法 XML，Excel/openpyxl 直接解析失败。
 *  故此处用 DOMParser 做格式良好性断言，防止回归。）
 */
const assertWellFormedXml = (xml: string, label: string): void => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const error = doc.querySelector('parsererror')
  expect(error, `${label} 必须是格式良好的 XML：${error?.textContent ?? ''}`).toBeNull()
}

type DemoRow = {
  id: number
  name: string
  weight: number
  level: string
  remark: string
}

/** 构造带全部新能力的样例 sheet（8 列，对齐纸质模板结构） */
const buildDemoSheet = (): ExcelExportSheet<DemoRow> =>
  ({
    sheetName: '学院上报单归口',
    rows: [
      { id: 1, name: '计算机学院', weight: 55, level: '提前完成', remark: '资到位到位' },
      { id: 2, name: '计算机学院', weight: 45, level: '正常', remark: '数据治理子项' }
    ],
    columns: [
      { header: '序号', width: 6, getValue: row => row.id },
      { header: '责任部门', width: 16, getValue: row => row.name },
      { header: '指标部门', width: 16, getValue: row => row.name },
      { header: '子指标名称', width: 44, getValue: row => row.remark },
      { header: '权重', width: 13, getValue: row => row.weight },
      {
        header: '自评等级（请选填）',
        width: 14,
        getValue: row => row.level
      },
      {
        header: '进度说明（请填写）',
        width: 36,
        plain: true,
        getValue: row => row.remark
      },
      {
        header: '（来源说明，勿动）',
        width: 13,
        hidden: true,
        getValue: row => row.level
      }
    ],
    stickyRowsCount: 1,
    stickyColumnsCount: 2,
    dataValidations: [
      {
        sqref: 'F2:F1000',
        formula1: '=$H$2:$H$4',
        errorTitle: '自评等级填写错误',
        error: '自评等级只能从下拉中选择',
        promptTitle: '自评等级',
        prompt: '请从单元格右侧下拉选择',
        allowBlank: false
      }
    ],
    sheetProtection: {}
  }) as ExcelExportSheet<DemoRow>

describe('excel 样式层扩容（2026-11-26 模板样式全面对齐 · 基础能力层）', () => {
  it('buildSheetData：plain 列的表头格与数据格输出裸值（不套样式对象）', () => {
    const sheet = buildDemoSheet()
    const data = buildSheetData(sheet)

    // 第 7 列（G 列）plain：表头是裸字符串，数据格是裸值（无任何样式字段）
    expect(data[0][6]).toBe('进度说明（请填写）')
    expect(data[1][6]).toBe('资到位到位')
    expect(data[1][6]).not.toHaveProperty('backgroundColor')
    expect(data[1][6]).not.toHaveProperty('borderColor')
    expect(data[1][6]).not.toHaveProperty('align')

    // 非 plain 列仍然带全套样式（零回归）
    expect(data[0][0]).toMatchObject({
      value: '序号',
      backgroundColor: '#1f4e78',
      textColor: '#ffffff'
    })
    expect(data[1][0]).toMatchObject({
      value: 1,
      borderColor: '#d9e2ec',
      align: 'left',
      alignVertical: 'top'
    })
  })

  it('buildSheetData：列级样式覆盖字段生效（表头/数据各自独立）', () => {
    const sheet = buildDemoSheet()
    sheet.columns[0] = {
      ...sheet.columns[0],
      headerBackgroundColor: '#595959',
      headerTextColor: '#ffffff',
      headerFontSize: 10,
      headerBorderColor: '#bbbbbb',
      bodyBackgroundColor: '#ededed',
      bodyTextColor: '#111111',
      bodyFontSize: 9,
      bodyAlignVertical: 'center',
      bodyBorderColor: '#cccccc',
      bodyAlign: 'center'
    }

    const data = buildSheetData(sheet)
    expect(data[0][0]).toMatchObject({
      value: '序号',
      backgroundColor: '#595959',
      textColor: '#ffffff',
      fontSize: 10,
      borderColor: '#bbbbbb'
    })
    expect(data[1][0]).toMatchObject({
      value: 1,
      backgroundColor: '#ededed',
      textColor: '#111111',
      fontSize: 9,
      alignVertical: 'center',
      borderColor: '#cccccc',
      align: 'center'
    })
  })

  it('buildSheetData：未传新字段时输出与改动前逐字节一致（零回归）', () => {
    const sheet: ExcelExportSheet<{ name: string }> = {
      sheetName: '测试',
      rows: [{ name: '指标一' }],
      columns: [{ header: '名称', getValue: row => row.name }]
    }
    const data = buildSheetData(sheet)

    // 表头：字段集合与取值与改动前完全一致
    expect(data[0][0]).toEqual({
      value: '名称',
      fontWeight: 'bold',
      textColor: '#ffffff',
      backgroundColor: '#1f4e78',
      align: 'center',
      alignVertical: 'center',
      borderColor: '#8ea9c1',
      borderStyle: 'thin',
      wrap: true
    })
    // 数据格：字段集合与取值与改动前完全一致
    expect(data[1][0]).toEqual({
      alignVertical: 'top',
      borderColor: '#d9e2ec',
      borderStyle: 'thin',
      wrap: true,
      align: 'left',
      value: '指标一'
    })
  })

  it('buildExcelBlob：hidden 列写出 hidden="1" 属性', async () => {
    const blob = await buildExcelBlob([buildDemoSheet() as ExcelExportSheet<unknown>])
    const sheetXml = await readPart(blob, 'xl/worksheets/sheet1.xml')

    // 必须是格式良好的 XML（属性不得被插到自闭合斜杠之后）
    assertWellFormedXml(sheetXml, 'sheet1.xml')

    expect(sheetXml).toContain('hidden="1"')
    // 第 8 列被隐藏
    expect(sheetXml).toMatch(/<col[^>]*min="8"[^>]*hidden="1"/)
    // 第 1/2 列未被隐藏
    expect(sheetXml).toMatch(/<col min="1" max="1"[^>]*>/)
    expect(sheetXml).not.toMatch(/<col min="1" max="1"[^>]*hidden=/)
  })

  it('buildExcelBlob：sheet xml 整体是格式良好的 XML（含新增四种能力）', async () => {
    const blob = await buildExcelBlob([buildDemoSheet() as ExcelExportSheet<unknown>])
    const sheetXml = await readPart(blob, 'xl/worksheets/sheet1.xml')
    assertWellFormedXml(sheetXml, 'sheet1.xml（含 hidden/dataValidations/sheetProtection）')
  })

  it('buildExcelBlob：plain 列单元格不再带 s 样式索引（非 plain 列仍带）', async () => {
    const blob = await buildExcelBlob([buildDemoSheet() as ExcelExportSheet<unknown>])
    const sheetXml = await readPart(blob, 'xl/worksheets/sheet1.xml')

    // G 列（plain）：表头 G1 与数据 G2 都没有 s 属性
    const g1 = getCellTag(sheetXml, 'G1')
    const g2 = getCellTag(sheetXml, 'G2')
    expect(g1).not.toBe('')
    expect(g1).not.toMatch(/\ss="/)
    expect(g2).not.toMatch(/\ss="/)

    // A 列（非 plain）：仍带 s 属性
    expect(getCellTag(sheetXml, 'A1')).toMatch(/\ss="/)
    expect(getCellTag(sheetXml, 'A2')).toMatch(/\ss="/)
  })

  it('buildExcelBlob：dataValidation 按 schema 保序插入且 formula1 正确', async () => {
    const blob = await buildExcelBlob([buildDemoSheet() as ExcelExportSheet<unknown>])
    const sheetXml = await readPart(blob, 'xl/worksheets/sheet1.xml')

    expect(sheetXml).toContain('<dataValidations count="1">')
    expect(sheetXml).toContain('<formula1>=$H$2:$H$4</formula1>')
    expect(sheetXml).toContain('sqref="F2:F1000"')
    expect(sheetXml).toContain('errorTitle="自评等级填写错误"')
    expect(sheetXml).toContain('allowBlank="0"')
    expect(sheetXml).toContain('type="list"')
  })

  it('buildExcelBlob：sheetProtection 写入工作表保护', async () => {
    const blob = await buildExcelBlob([buildDemoSheet() as ExcelExportSheet<unknown>])
    const sheetXml = await readPart(blob, 'xl/worksheets/sheet1.xml')

    expect(sheetXml).toContain('<sheetProtection')
    expect(sheetXml).toMatch(/<sheetProtection[^>]*sheet="1"/)
    expect(sheetXml).toMatch(/<sheetProtection[^>]*objects="1"/)
    expect(sheetXml).toMatch(/<sheetProtection[^>]*scenarios="1"/)
  })

  it('buildExcelBlob：stickyRowsCount/stickyColumnsCount 冻结到 C2（topLeftCell="C2"）', async () => {
    const blob = await buildExcelBlob([buildDemoSheet() as ExcelExportSheet<unknown>])
    const sheetXml = await readPart(blob, 'xl/worksheets/sheet1.xml')

    expect(sheetXml).toContain('topLeftCell="C2"')
    expect(sheetXml).toContain('xSplit="2"')
    expect(sheetXml).toContain('ySplit="1"')
    expect(sheetXml).toContain('state="frozen"')
  })

  it('buildExcelBlob：sheetProtection 在 dataValidations 之前（schema 顺序）', async () => {
    const blob = await buildExcelBlob([buildDemoSheet() as ExcelExportSheet<unknown>])
    const sheetXml = await readPart(blob, 'xl/worksheets/sheet1.xml')

    const protectionIndex = sheetXml.indexOf('<sheetProtection')
    const validationsIndex = sheetXml.indexOf('<dataValidations')
    expect(protectionIndex).toBeGreaterThan(-1)
    expect(validationsIndex).toBeGreaterThan(-1)
    expect(protectionIndex).toBeLessThan(validationsIndex)
  })

  it('buildExcelBlob：未使用新能力时生成结果与改动前基线逐字节一致（零回归）', async () => {
    const sheet: ExcelExportSheet<{ name: string }> = {
      sheetName: '基线表',
      rows: [{ name: '指标一' }],
      columns: [
        { header: '序号', width: 10, getValue: () => 1 },
        { header: '名称', width: 30, getValue: row => row.name }
      ]
    }

    const blob = await buildExcelBlob([sheet as ExcelExportSheet<unknown>])
    const sheetXml = await readPart(blob, 'xl/worksheets/sheet1.xml')
    const stylesXml = await readPart(blob, 'xl/styles.xml')

    // 不得出现任何新增能力带来的标记
    expect(sheetXml).not.toContain('hidden="1"')
    expect(sheetXml).not.toContain('<dataValidations')
    expect(sheetXml).not.toContain('<sheetProtection')
    // 冻结行为与改动前一致：stickyRowsCount 缺省仍为 1
    expect(sheetXml).toContain('topLeftCell="A2"')
    expect(sheetXml).toContain('ySplit="1"')
    expect(sheetXml).toContain('xSplit="0"')
    // 网格线仍然关闭
    expect(sheetXml).toContain('showGridLines="false"')
    // 列宽仍然按 column.width 写
    expect(sheetXml).toContain('<col min="1" max="1" width="10" customWidth="1"/>')
    expect(sheetXml).toContain('<col min="2" max="2" width="30" customWidth="1"/>')
    // 样式表数量与改动前一致（默认字体 1 套 + 表头 1 套 + 表体 1 套 = 3）
    expect(stylesXml).toContain('<cellXfs count="3">')
    expect(stylesXml).toContain('<fonts count="2">')
    expect(stylesXml).toContain('<fills count="3">')
    expect(stylesXml).toContain('<borders count="3">')
    // 包内文件清单与改动前一致（不因 feature 引入额外文件）
    expect(await readPartNames(blob)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/sharedStrings.xml',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/_rels/sheet1.xml.rels',
      'xl/worksheets/sheet1.xml'
    ])
  })

  it('buildExcelBlob：生成后清空注册表（不跨次泄漏）', async () => {
    await buildExcelBlob([buildDemoSheet() as ExcelExportSheet<unknown>])
    expect(getSheetExtras('学院上报单归口')).toBeUndefined()
  })

  it('registerSheetExtras / clearSheetExtras：注册表读写与清理', () => {
    registerSheetExtras('Sheet1', { hiddenColumns: [3] })
    expect(getSheetExtras('Sheet1')).toEqual({ hiddenColumns: [3] })
    clearSheetExtras()
    expect(getSheetExtras('Sheet1')).toBeUndefined()
  })
})
