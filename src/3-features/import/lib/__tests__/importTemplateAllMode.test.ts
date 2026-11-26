import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { buildExcelBlob } from '@/shared/lib/export/excel'
import {
  buildImportTemplateFileName,
  buildImportTemplateSheet,
  FUNCTIONAL_DEPT_COLUMN_HEADER,
  getImportTemplateGuide,
  type ImportTemplateParentSeed,
  WEIGHT_COLUMN_HEADER
} from '../importTemplate'

/**
 * 2026-11-19（学院全部导入 · 规划书第一节）：模板 9 列（含新增「职能部门」列）+
 * 拆分规则说明；单条导入模板 8 列保持不变（不新增职能部门列）。
 */

/** 全部导入模板的 9 列表头（职能部门列插在「学院」列之后） */
const ALL_MODE_HEADERS = [
  '序号',
  '学院',
  FUNCTIONAL_DEPT_COLUMN_HEADER,
  '任务类型',
  '核心指标',
  '核心指标类型',
  '子指标名称',
  '指标类型',
  WEIGHT_COLUMN_HEADER
]

/** 单条导入模板的 9 列表头（2026-11-25 用户定案：与 02 样例一致，也带「归口职能部门」列） */
const SINGLE_MODE_HEADERS = ALL_MODE_HEADERS

/** 读取生成的 xlsx 数据页全部合并区（如 B2:B3），按字典序排列 */
const readSortedMergeRefs = async (
  seeds: ImportTemplateParentSeed[] | undefined
): Promise<string[]> => {
  const blob = await buildExcelBlob([
    buildImportTemplateSheet('distribution', seeds, 'all') as never
  ])
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const sheet = zip.file('xl/worksheets/sheet1.xml')
  if (!sheet) {
    throw new Error('xlsx 内缺少数据页 xl/worksheets/sheet1.xml')
  }
  const sheetXml = await sheet.async('string')
  return [...sheetXml.matchAll(/<mergeCell ref="([^"]+)"/g)].map(match => match[1]).sort()
}

/**
 * 真机下载形态的父级锚点 seeds（2026-11-26 实测 zlb_admin → 文理学院「全部导入」模板）：
 * 每个父级核心指标预填一行，归口依次为
 * 党委办公室|党委统战部×4 / 教务处×4 / 财务部×2 / 数字校园建设办公室×2 / 预算部×3。
 */
const REAL_DOWNLOAD_SEEDS: ImportTemplateParentSeed[] = [
  ...Array<string>(4).fill('党委办公室 | 党委统战部'),
  ...Array<string>(4).fill('教务处'),
  ...Array<string>(2).fill('财务部'),
  ...Array<string>(2).fill('数字校园建设办公室'),
  ...Array<string>(3).fill('预算部')
].map((functionalDept, index) => ({
  parentIndicator: `父级核心指标${index + 1}`,
  college: '文理学院',
  parentIndicatorType: '定量',
  taskType: '基础性',
  functionalDept
}))

describe('importTemplate · 全部导入模板 9 列（含「职能部门」列）', () => {
  it('全部导入模式表头为 9 列，「职能部门」列插在「学院」列之后', () => {
    const sheet = buildImportTemplateSheet('distribution', undefined, 'all')

    expect(sheet.columns.map(column => column.header)).toEqual(ALL_MODE_HEADERS)
    expect(sheet.columns).toHaveLength(9)
  })

  it('单条导入模式表头同为 9 列（2026-11-25 定案：单归口也带「归口职能部门」列）', () => {
    const sheet = buildImportTemplateSheet('distribution')

    expect(sheet.columns.map(column => column.header)).toEqual(SINGLE_MODE_HEADERS)
    expect(sheet.columns.map(column => column.header)).toContain(FUNCTIONAL_DEPT_COLUMN_HEADER)
  })

  it('默认模式（不传 mode）= single，既有调用点零变化', () => {
    expect(getImportTemplateGuide('distribution').columns.map(column => column.label)).toEqual(
      SINGLE_MODE_HEADERS
    )
    expect(
      getImportTemplateGuide('distribution', 'single').columns.map(column => column.label)
    ).toEqual(SINGLE_MODE_HEADERS)
  })

  it('「归口职能部门」列按归口连续块竖向合并（2026-11-26 对齐 03 样例）：一个父级锚点 = 一个归口部门，归口不同即断块', () => {
    const sheet = buildImportTemplateSheet(
      'distribution',
      [
        {
          parentIndicator: '推进课堂教学改革与课程思政建设',
          college: '文理学院',
          parentIndicatorType: '定量',
          taskType: '基础性',
          functionalDept: '教务处'
        },
        {
          parentIndicator: '建设数字化校园管理平台',
          college: '文理学院',
          parentIndicatorType: '定量',
          taskType: '发展性',
          functionalDept: '数字校园建设办公室'
        }
      ],
      'all'
    )

    // 第 3 列 = 归口职能部门（索引 2）：两个锚点归口不同 → 各自成块，直接写值
    const functionalDeptColumn = sheet.columns[2]
    expect(functionalDeptColumn.getValue(sheet.rows[0], 0)).toBe('教务处')
    expect(functionalDeptColumn.getValue(sheet.rows[1], 1)).toBe('数字校园建设办公室')
  })

  it('相邻锚点归口相同 → 并成一块：归口列合并一格，学院列同块并在每块锚点重复写值', () => {
    const sheet = buildImportTemplateSheet(
      'distribution',
      [
        {
          parentIndicator: '父级指标甲',
          college: '文理学院',
          parentIndicatorType: '定量',
          taskType: '基础性',
          functionalDept: '教务处'
        },
        {
          parentIndicator: '父级指标乙',
          college: '文理学院',
          parentIndicatorType: '定性',
          taskType: '基础性',
          functionalDept: '教务处'
        },
        {
          parentIndicator: '父级指标丙',
          college: '文理学院',
          parentIndicatorType: '定量',
          taskType: '发展性',
          functionalDept: '财务处'
        }
      ],
      'all'
    )

    // 归口块 = [甲,乙] / [丙]：归口相同的相邻父级组共用一格，归口断开即新块并重写值
    expect(sheet.columns[2].getValue(sheet.rows[0], 0)).toMatchObject({
      value: '教务处',
      rowSpan: 2
    })
    expect(sheet.columns[2].getValue(sheet.rows[1], 1)).toBeNull()
    expect(sheet.columns[2].getValue(sheet.rows[2], 2)).toBe('财务处')
    // 学院列（索引 1）与归口块同几何，每块锚点重复写同一个学院名
    expect(sheet.columns[1].getValue(sheet.rows[0], 0)).toMatchObject({
      value: '文理学院',
      rowSpan: 2
    })
    expect(sheet.columns[1].getValue(sheet.rows[1], 1)).toBeNull()
    expect(sheet.columns[1].getValue(sheet.rows[2], 2)).toBe('文理学院')
  })

  it('预填行带「职能部门」名（拆批依据）+ 锚点只读列，子指标三列留空', () => {
    const sheet = buildImportTemplateSheet(
      'distribution',
      [
        {
          parentIndicator: '推进课堂教学改革与课程思政建设',
          college: '文理学院',
          parentIndicatorType: '定量',
          taskType: '基础性',
          functionalDept: '教务处'
        }
      ],
      'all'
    )

    expect(sheet.rows).toHaveLength(1)
    expect(sheet.rows[0]).toMatchObject({
      serial: '1',
      college: '文理学院',
      functionalDept: '教务处',
      taskType: '基础性',
      parentIndicator: '推进课堂教学改革与课程思政建设',
      parentIndicatorType: '定量',
      indicatorName: '',
      indicatorType: '',
      weight: ''
    })
  })

  it('单条导入的预填行同样带「归口职能部门」键（2026-11-25 定案）', () => {
    const sheet = buildImportTemplateSheet('distribution', [
      {
        parentIndicator: '父级指标甲',
        college: '工学院',
        parentIndicatorType: '定量',
        taskType: '基础性',
        functionalDept: '教务处'
      }
    ])

    expect(sheet.rows[0].functionalDept).toBe('教务处')
    expect(Object.keys(sheet.rows[0])).toContain('functionalDept')
  })

  it('全部导入模板的「填写说明」（2026-11-26 收口对齐 03 样例）：8 条、逐字取自样例原文', () => {
    const guide = getImportTemplateGuide('distribution', 'all')

    expect(guide.rulesTitle).toBe('填写说明（03 · 战略部下发二级学院 · 多归口全部导入）')
    expect(guide.rules).toHaveLength(8)
    // 拆组规则（样例第 2 条）与按归口组独立权重校验（样例第 5 条）必须在
    expect(guide.rules[1]).toBe(
      '用途：一份表可含多个归口职能部门给同一学院的指标行，系统按「职能部门」列自动拆组、逐组独立下发（流程6 自动审批通过）。'
    )
    expect(guide.rules[4]).toBe(
      '同名规则：核心指标同名 = 挂接既有；子指标同名 = 更新，新名 = 新增；权重按归口组独立合计 100。'
    )
    // 交叉校验（防呆）说明必须在（样例第 3 条）
    expect(guide.rules[2]).toContain('不一致的组拒绝')
  })

  it('单条导入的「填写说明」**不**含全部导入专属的拆分规则（两条链路互不污染）', () => {
    const rules = getImportTemplateGuide('distribution', 'single').rules.join('\n')

    expect(rules).not.toContain('拆分依据')
    expect(rules).not.toContain('「职能部门」列')
  })

  it('全部导入模板文件名带「全部导入」标记，且以 .xlsx 结尾', () => {
    const fileName = buildImportTemplateFileName('distribution', 'all')

    expect(fileName).toContain('全部导入')
    expect(fileName).toContain('导入模板')
    expect(fileName.endsWith('.xlsx')).toBe(true)
  })

  it('全部导入模板 sheet 名带「全部导入」标记', () => {
    const sheet = buildImportTemplateSheet('distribution', undefined, 'all')
    expect(sheet.sheetName).toContain('全部导入')
  })

  it('全部导入模板示例演示「一份文件两个职能部门」', () => {
    const sheet = buildImportTemplateSheet('distribution', undefined, 'all')
    const depts = sheet.rows.map(row => row.functionalDept).filter(Boolean)

    expect(new Set(depts).size).toBeGreaterThanOrEqual(2)
  })

  it('全部导入模板序号逐行递增（2026-11-26 序号语义改造）：示例行每行一号、不再留空', () => {
    const sheet = buildImportTemplateSheet('distribution', undefined, 'all')

    expect(sheet.rows.map(row => row.serial)).toEqual(['1', '2', '3'])
    // 序号列不再随组合并：每行显示各自号码（数值型，与样例一致）
    const serialColumn = sheet.columns.find(column => column.header === '序号')!
    expect(sheet.rows.map((row, index) => serialColumn.getValue(row, index))).toEqual([1, 2, 3])
  })

  it('全部导入模板填写说明（2026-11-26 收口对齐 03 样例）：前置条件/下发流程/示例数据条目在位', () => {
    const rules = getImportTemplateGuide('distribution', 'all').rules.join('\n')

    expect(rules).toContain('前置条件：子指标所挂核心指标须为该系统已下发的锚点')
    expect(rules).toContain('下发流程：解析预览（将下发/将跳过/错误组三类信息）')
    expect(rules).toContain('彩色底纹行为示例数据（绿=预算部组 / 黄=数字校园组）')
  })

  it('全部导入模板锚点预填行序号逐行递增 1..N（N=锚点行数）', () => {
    const sheet = buildImportTemplateSheet(
      'distribution',
      [
        {
          parentIndicator: '推进课堂教学改革与课程思政建设',
          college: '文理学院',
          parentIndicatorType: '定量',
          taskType: '基础性',
          functionalDept: '教务处'
        },
        {
          parentIndicator: '建设数字化校园管理平台',
          college: '文理学院',
          parentIndicatorType: '定量',
          taskType: '发展性',
          functionalDept: '数字校园建设办公室'
        }
      ],
      'all'
    )

    expect(sheet.rows.map(row => row.serial)).toEqual(['1', '2'])
  })

  // ============ 2026-11-26（下发侧语义修正）：判组依据 = 「核心指标」列非空 ============

  it('示例行合并几何与样例 03 逐区一致：C/D/E/F 按核心指标组合并、归口断开处分块、学院列每块锚点重复写值', () => {
    const sheet = buildImportTemplateSheet('distribution', undefined, 'all')
    const column = (index: number) => sheet.columns[index]

    // 组 1 = 前 2 行（同一父级核心指标「推进课堂教学改革与课程思政建设」）：
    // 归口职能部门(2)/任务类型(3)/核心指标(4)/核心指标类型(5) 各合并成 2 行一格
    for (const columnIndex of [2, 3, 4, 5]) {
      expect(column(columnIndex).getValue(sheet.rows[0], 0)).toMatchObject({ rowSpan: 2 })
      expect(column(columnIndex).getValue(sheet.rows[1], 1)).toBeNull()
    }
    // 第 3 行 = 新父级组 + 新归口块（单行块/单行组）：锚点直接写值
    expect(column(2).getValue(sheet.rows[2], 2)).toBe('数字校园建设办公室')
    expect(column(3).getValue(sheet.rows[2], 2)).toBe('发展性')
    expect(column(4).getValue(sheet.rows[2], 2)).toBe('建设数字化校园管理平台')
    expect(column(5).getValue(sheet.rows[2], 2)).toBe('定量')
    // 学院列：B2:B3 合并 + B4 再写值（样例 03 版式）
    expect(column(1).getValue(sheet.rows[0], 0)).toMatchObject({ value: '文理学院', rowSpan: 2 })
    expect(column(1).getValue(sheet.rows[1], 1)).toBeNull()
    expect(column(1).getValue(sheet.rows[2], 2)).toBe('文理学院')
    // 序号列：每行一号，不参与合并
    expect(sheet.rows.map((row, index) => column(0).getValue(row, index))).toEqual([1, 2, 3])
  })

  it('真实预填形态（每个父级锚点各占一行）：归口列按归口连续块合并、学院列每块锚点重复写值、序号 1..N', () => {
    const sheet = buildImportTemplateSheet('distribution', REAL_DOWNLOAD_SEEDS, 'all')
    const column = (header: string) => sheet.columns.find(item => item.header === header)!

    expect(sheet.rows).toHaveLength(15)
    const deptColumn = column(FUNCTIONAL_DEPT_COLUMN_HEADER)
    const collegeColumn = column('学院')

    // 归口块 = 行 0-3 / 4-7 / 8-9 / 10-11 / 12-14（锚点在 0/4/8/10/12）
    const blockStarts = [0, 4, 8, 10, 12]
    sheet.rows.forEach((_, index) => {
      const position = blockStarts.indexOf(index)
      if (position === -1) {
        expect(deptColumn.getValue(sheet.rows[index], index)).toBeNull()
        expect(collegeColumn.getValue(sheet.rows[index], index)).toBeNull()
        return
      }
      const span = (blockStarts[position + 1] ?? sheet.rows.length) - index
      expect(deptColumn.getValue(sheet.rows[index], index)).toMatchObject({
        rowSpan: span
      })
      expect(collegeColumn.getValue(sheet.rows[index], index)).toMatchObject({
        value: '文理学院',
        rowSpan: span
      })
    })
    // 每块锚点的归口/学院写值：归口随块变化，学院全表同一个值（与页面选定完全一致）
    expect(blockStarts.map(index => sheet.rows[index].functionalDept)).toEqual([
      '党委办公室 | 党委统战部',
      '教务处',
      '财务部',
      '数字校园建设办公室',
      '预算部'
    ])
    expect(blockStarts.map(index => sheet.rows[index].college)).toEqual(
      Array<string>(5).fill('文理学院')
    )

    // 每个父级锚点各成一个单行组：任务类型/核心指标/核心指标类型直接写值（无合并）
    const groupColumnKeys: Array<[string, string]> = [
      ['任务类型', 'taskType'],
      ['核心指标', 'parentIndicator'],
      ['核心指标类型', 'parentIndicatorType']
    ]
    for (const [header, key] of groupColumnKeys) {
      sheet.rows.forEach((row, index) => {
        expect(column(header).getValue(row, index)).toBe(row[key])
      })
    }

    // 序号逐行 1..15、数值型
    expect(sheet.rows.map((row, index) => column('序号').getValue(row, index))).toEqual(
      Array.from({ length: 15 }, (_, index) => index + 1)
    )
  })

  it('真实预填形态生成的 xlsx：合并区只有学院列 + 归口列的 5 个归口块，序号/组列无合并区', async () => {
    expect(await readSortedMergeRefs(REAL_DOWNLOAD_SEEDS)).toEqual([
      'B10:B11',
      'B12:B13',
      'B14:B16',
      'B2:B5',
      'B6:B9',
      'C10:C11',
      'C12:C13',
      'C14:C16',
      'C2:C5',
      'C6:C9'
    ])
  })
})
