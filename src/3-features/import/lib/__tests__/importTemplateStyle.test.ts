import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { buildExcelBlob } from '@/shared/lib/export/excel'
import {
  buildImportTemplateSheet,
  buildImportTemplateSheets,
  getImportTemplateGuide,
  WEIGHT_COLUMN_HEADER
} from '../importTemplate'

/**
 * 2026-11-26（下发侧导入模板 01/02/03 样式全面对齐）：样式维度回归测试。
 *
 * <p>口径来源：需求方定稿样例 `导入模板样例/SISM-导入模板-01/02/03-*.xlsx`
 * （实测：表头 `#1F3864` + 微软雅黑 11 bold 白字 + center/center + wrap + thin `#BBBBBB`
 * 边框 + 行高 32；数据行 `#FFF2CC` + 微软雅黑 10 常规 + center/center（「任务类型」列 left）
 * + wrap + thin `#BBBBBB` 边框 + 行高 42；冻结 A2；网格线可见；说明页白底无边框、
 * 标题在 A1（微软雅黑 11 bold 黑字）、第 2 行空、条目行高 26、列宽 114、不冻结、
 * 垂直居中 wrap）。</p>
 *
 * <p>本测试只锁**样式维度**；序号/判组/合并语义由另一条线负责。</p>
 */

/** 读取 xlsx 内某个文件的 xml 文本 */
const readPart = async (blob: Blob, path: string): Promise<string> => {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const file = zip.file(path)
  if (!file) {
    throw new Error(`xlsx 内缺少文件：${path}`)
  }
  return file.async('string')
}

/** 生成 01/02/03 三份下发侧模板的 xlsx（数据页 + 说明页） */
const buildTemplateBlob = async (
  type: 'strategic-task' | 'distribution',
  mode: 'single' | 'all' = 'single'
): Promise<Blob> =>
  buildExcelBlob(buildImportTemplateSheets(type, undefined, mode) as never)

/** 从 sheet xml 里取出所有列宽 */
const parseColumnWidths = (sheetXml: string): Array<{ col: number; width: number }> =>
  [...sheetXml.matchAll(/<col[^>]*min="(\d+)"[^>]*max="(\d+)"[^>]*width="([\d.]+)"/g)].map(
    match => ({
      col: Number(match[1]),
      width: Number(match[3])
    })
  )

describe('下发侧导入模板 01/02/03 · 样式全面对齐（2026-11-26）', () => {
  describe('数据页：列级样式', () => {
    it('01 职能部门模板：全部列统一 #BBBBBB 边框 + 微软雅黑 + 数据行 10 号居中', () => {
      const sheet = buildImportTemplateSheet('strategic-task')

      sheet.columns.forEach(column => {
        expect(column.headerBorderColor).toBe('#BBBBBB')
        expect(column.bodyBorderColor).toBe('#BBBBBB')
        expect(column.fontFamily).toBe('微软雅黑')
        expect(column.bodyFontSize).toBe(10)
        expect(column.bodyAlignVertical).toBe('center')
      })
    })

    it('02 学院单点模板：全部列统一 #BBBBBB 边框 + 微软雅黑 + 数据行 10 号居中', () => {
      const sheet = buildImportTemplateSheet('distribution')

      sheet.columns.forEach(column => {
        expect(column.headerBorderColor).toBe('#BBBBBB')
        expect(column.bodyBorderColor).toBe('#BBBBBB')
        expect(column.fontFamily).toBe('微软雅黑')
        expect(column.bodyFontSize).toBe(10)
        expect(column.bodyAlignVertical).toBe('center')
      })
    })

    it('03 学院全部导入模板：全部列统一 #BBBBBB 边框 + 微软雅黑 + 数据行 10 号居中', () => {
      const sheet = buildImportTemplateSheet('distribution', undefined, 'all')

      sheet.columns.forEach(column => {
        expect(column.headerBorderColor).toBe('#BBBBBB')
        expect(column.bodyBorderColor).toBe('#BBBBBB')
        expect(column.fontFamily).toBe('微软雅黑')
        expect(column.bodyFontSize).toBe(10)
        expect(column.bodyAlignVertical).toBe('center')
      })
    })

    it('数据行水平对齐：除「任务类型」列 left 外，其余全部 center', () => {
      for (const sheet of [
        buildImportTemplateSheet('strategic-task'),
        buildImportTemplateSheet('distribution'),
        buildImportTemplateSheet('distribution', undefined, 'all')
      ]) {
        sheet.columns.forEach(column => {
          if (column.header === '任务类型') {
            expect(column.bodyAlign).toBe('left')
          } else {
            expect(column.bodyAlign).toBe('center')
          }
        })
      }
    })
  })

  describe('数据页：表级样式', () => {
    it('表头底色 #1F3864、表头白字、行高 32 / 42、冻结 A2、网格线可见', () => {
      for (const sheet of [
        buildImportTemplateSheet('strategic-task'),
        buildImportTemplateSheet('distribution'),
        buildImportTemplateSheet('distribution', undefined, 'all')
      ]) {
        expect(sheet.headerBackgroundColor).toBe('#1F3864')
        expect(sheet.headerTextColor).toBe('#ffffff')
        expect(sheet.headerHeight).toBe(32)
        expect(sheet.bodyRowHeight).toBe(42)
        expect(sheet.stickyRowsCount).toBe(1)
        expect(sheet.stickyColumnsCount).toBe(0)
        expect(sheet.showGridLines).toBe(true)
      }
    })

    it('列宽与样例一致：01 = 6/12/44/10/44/10/12，02·03 = 6/12/16/10/42/12/42/10/12', () => {
      expect(buildImportTemplateSheet('strategic-task').columns.map(c => c.width)).toEqual([
        6, 12, 44, 10, 44, 10, 12
      ])
      expect(buildImportTemplateSheet('distribution').columns.map(c => c.width)).toEqual([
        6, 12, 16, 10, 42, 12, 42, 10, 12
      ])
      expect(
        buildImportTemplateSheet('distribution', undefined, 'all').columns.map(c => c.width)
      ).toEqual([6, 12, 16, 10, 42, 12, 42, 10, 12])
    })
  })

  describe('说明页：白底无边框、标题在 A1、第 2 行空、行高 26、列宽 114、不冻结', () => {
    it('说明页结构与版式常量', () => {
      const sheets = buildImportTemplateSheets('strategic-task', undefined, 'single')
      const guide = sheets[1]

      expect(guide.sheetName).toBe('填写说明')
      // 样例说明页没有表头行（否则表头行会带深蓝底白字）
      expect(guide.skipHeaderRow).toBe(true)
      expect(guide.columns[0].width).toBe(114)
      expect(guide.bodyRowHeight).toBe(26)
      expect(guide.stickyRowsCount).toBe(0)
      expect(guide.stickyColumnsCount).toBe(0)
      expect(guide.showGridLines).toBe(true)

      // 标题在第 1 行、第 2 行空、条目从第 3 行起
      const rules = getImportTemplateGuide('strategic-task').rules
      expect(guide.rows).toHaveLength(rules.length + 2)
      expect(guide.rows[0].text).toBe(getImportTemplateGuide('strategic-task').rulesTitle)
      expect(guide.rows[1].text).toBe('')
      expect(guide.rows[2].text).toBe(`1. ${rules[0]}`)
    })

    it('说明页单元格：垂直居中 + wrap + 无边框 + 标题加粗', () => {
      const sheets = buildImportTemplateSheets('strategic-task', undefined, 'single')
      const column = sheets[1].columns[0]

      const title = column.getValue(sheets[1].rows[0], 0) as Record<string, unknown>
      expect(title.value).toBe(getImportTemplateGuide('strategic-task').rulesTitle)
      expect(title.fontWeight).toBe('bold')
      expect(title.alignVertical).toBe('center')
      expect(title.wrap).toBe(true)
      expect(title.borderColor).toBeUndefined()
      expect(title.borderStyle).toBeUndefined()

      const item = column.getValue(sheets[1].rows[2], 2) as Record<string, unknown>
      expect(item.fontWeight).toBeUndefined()
      expect(item.alignVertical).toBe('center')
      expect(item.wrap).toBe(true)
      expect(item.borderColor).toBeUndefined()
      expect(item.borderStyle).toBeUndefined()
    })

    it('说明页字体族为微软雅黑（标题与条目同族）', () => {
      const sheets = buildImportTemplateSheets('strategic-task', undefined, 'single')
      expect(sheets[1].columns[0].fontFamily).toBe('微软雅黑')
    })
  })

  describe('生成的 xlsx（XML 级核对）', () => {
    it('01 数据页：冻结 A2、网格线可见、行高 32/42、列宽 6/12/44/10/44/10/12', async () => {
      const blob = await buildTemplateBlob('strategic-task')
      const sheetXml = await readPart(blob, 'xl/worksheets/sheet1.xml')

      // 冻结 A2
      expect(sheetXml).toContain('ySplit="1"')
      expect(sheetXml).toContain('xSplit="0"')
      expect(sheetXml).toContain('topLeftCell="A2"')
      expect(sheetXml).toContain('state="frozen"')
      // 网格线可见（无 showGridLines="false"）
      expect(sheetXml).not.toContain('showGridLines="false"')
      // 行高
      expect(sheetXml).toContain('<row r="1" ht="32" customHeight="1">')
      expect(sheetXml).toContain('<row r="2" ht="42" customHeight="1">')
      // 列宽
      expect(parseColumnWidths(sheetXml)).toEqual([
        { col: 1, width: 6 },
        { col: 2, width: 12 },
        { col: 3, width: 44 },
        { col: 4, width: 10 },
        { col: 5, width: 44 },
        { col: 6, width: 10 },
        { col: 7, width: 12 }
      ])
    })

    it('02 / 03 数据页：冻结 A2、网格线可见、列宽 6/12/16/10/42/12/42/10/12', async () => {
      for (const mode of ['single', 'all'] as const) {
        const blob = await buildTemplateBlob('distribution', mode)
        const sheetXml = await readPart(blob, 'xl/worksheets/sheet1.xml')

        expect(sheetXml).toContain('topLeftCell="A2"')
        expect(sheetXml).toContain('state="frozen"')
        expect(sheetXml).not.toContain('showGridLines="false"')
        expect(sheetXml).toContain('<row r="1" ht="32" customHeight="1">')
        expect(sheetXml).toContain('<row r="2" ht="42" customHeight="1">')
        expect(parseColumnWidths(sheetXml)).toEqual([
          { col: 1, width: 6 },
          { col: 2, width: 12 },
          { col: 3, width: 16 },
          { col: 4, width: 10 },
          { col: 5, width: 42 },
          { col: 6, width: 12 },
          { col: 7, width: 42 },
          { col: 8, width: 10 },
          { col: 9, width: 12 }
        ])
      }
    })

    it('样式表：字体微软雅黑、边框 #BBBBBB、表头底 #1F3864、数据底 #FFF2CC', async () => {
      const blob = await buildTemplateBlob('strategic-task')
      const stylesXml = await readPart(blob, 'xl/styles.xml')

      expect(stylesXml).toContain('<name val="微软雅黑"/>')
      expect(stylesXml).toContain('rgb="FFBBBBBB"')
      expect(stylesXml).toContain('rgb="FF1F3864"')
      expect(stylesXml).toContain('rgb="FFFFF2CC"')
      // 数据行字号 10、表头字号 11
      expect(stylesXml).toContain('<sz val="10"/>')
      expect(stylesXml).toContain('<sz val="11"/>')
      // 不得残留旧的默认边框色
      expect(stylesXml).not.toContain('rgb="FF8EA9C1"')
      expect(stylesXml).not.toContain('rgb="FFD9E2EC"')
    })

    it('数据页单元格对齐：center/center（「任务类型」列 left/center）', async () => {
      const blob = await buildTemplateBlob('strategic-task')
      const stylesXml = await readPart(blob, 'xl/styles.xml')

      expect(stylesXml).toContain('<alignment horizontal="center" vertical="center" wrapText="1"/>')
      expect(stylesXml).toContain('<alignment horizontal="left" vertical="center" wrapText="1"/>')
    })

    it('说明页：A1 是标题、第 2 行空、行高 26、列宽 114、不冻结、网格线可见', async () => {
      const blob = await buildTemplateBlob('strategic-task')
      const sheetXml = await readPart(blob, 'xl/worksheets/sheet2.xml')
      const sharedStrings = await readPart(blob, 'xl/sharedStrings.xml')

      // 无独立表头行 → 第 1 行就是标题
      expect(sheetXml).toContain('<row r="1" ht="26" customHeight="1">')
      expect(sheetXml).toContain('<row r="2" ht="26" customHeight="1">')
      expect(sheetXml).toContain('<row r="3" ht="26" customHeight="1">')
      expect(sharedStrings).toContain(
        getImportTemplateGuide('strategic-task').rulesTitle
      )
      // 列宽 114
      expect(sheetXml).toContain('width="114"')
      // 不冻结
      expect(sheetXml).not.toContain('state="frozen"')
      // 网格线可见
      expect(sheetXml).not.toContain('showGridLines="false"')
    })

    it('说明页：白底（无 fill 实色）、无边框（borderId 缺省=0）', async () => {
      const blob = await buildTemplateBlob('strategic-task')
      const stylesXml = await readPart(blob, 'xl/styles.xml')

      // 说明页用到的两个 xf：bold 标题 + 常规条目，均只带 alignment，
      // 不带 borderId（缺省 0 = 无边框）、不带 fillId（缺省 0 = 白底）
      const guideXfs = [...stylesXml.matchAll(/<xf[^>]*>(?:(?!<\/xf>).)*?<\/xf>/g)].map(
        match => match[0]
      )
      const guideXfTags = guideXfs.filter(
        tag => tag.includes('applyAlignment="1"') && !tag.includes('applyFill="1"')
      )
      expect(guideXfTags.length).toBeGreaterThanOrEqual(2)
      guideXfTags.forEach(tag => {
        expect(tag).not.toContain('borderId="1"')
        expect(tag).not.toContain('fillId="2"')
        expect(tag).not.toContain('fillId="3"')
      })
      // 说明页边框：整份 styles.xml 里除数据页用的那条 #BBBBBB 细边框外，
      // 只存在默认边框（无 left/right/top/bottom style）
      const borderBlocks = [...stylesXml.matchAll(/<border>[\s\S]*?<\/border>/g)].map(m => m[0])
      const noBorderBlocks = borderBlocks.filter(block => !block.includes('style="thin"'))
      expect(noBorderBlocks.length).toBeGreaterThanOrEqual(1)
    })

    it('三份模板都生成成功，sheet 名与表头列序与样例一致', async () => {
      const expectations: Array<{
        blob: Blob
        sheetName: string
        headers: string[]
      }> = [
        {
          blob: await buildTemplateBlob('strategic-task'),
          sheetName: '职能部门指标导入模板',
          headers: ['序号', '部门', '战略任务', '任务类型', '核心指标', '指标类型']
        },
        {
          blob: await buildTemplateBlob('distribution', 'single'),
          sheetName: '学院子指标导入模板',
          headers: ['序号', '学院', '归口职能部门', '任务类型', '核心指标', '核心指标类型']
        },
        {
          blob: await buildTemplateBlob('distribution', 'all'),
          sheetName: '学院子指标全部导入模板',
          headers: ['序号', '学院', '归口职能部门', '任务类型', '核心指标', '核心指标类型']
        }
      ]

      for (const item of expectations) {
        const workbookXml = await readPart(item.blob, 'xl/workbook.xml')
        expect(workbookXml).toContain(item.sheetName)
        expect(workbookXml).toContain('填写说明')
        const sharedStrings = await readPart(item.blob, 'xl/sharedStrings.xml')
        item.headers.forEach(header => {
          expect(sharedStrings).toContain(header)
        })
        expect(sharedStrings).toContain(WEIGHT_COLUMN_HEADER)
      }
    })
  })
})
