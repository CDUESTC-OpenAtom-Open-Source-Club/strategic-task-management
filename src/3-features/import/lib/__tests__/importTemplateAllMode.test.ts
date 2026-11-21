import { describe, expect, it } from 'vitest'
import {
  buildImportTemplateFileName,
  buildImportTemplateSheet,
  FUNCTIONAL_DEPT_COLUMN_HEADER,
  getImportTemplateGuide,
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

/** 单条导入模板的 8 列表头（保持不变） */
const SINGLE_MODE_HEADERS = [
  '序号',
  '学院',
  '任务类型',
  '核心指标',
  '核心指标类型',
  '子指标名称',
  '指标类型',
  WEIGHT_COLUMN_HEADER
]

describe('importTemplate · 全部导入模板 9 列（含「职能部门」列）', () => {
  it('全部导入模式表头为 9 列，「职能部门」列插在「学院」列之后', () => {
    const sheet = buildImportTemplateSheet('distribution', undefined, 'all')

    expect(sheet.columns.map(column => column.header)).toEqual(ALL_MODE_HEADERS)
    expect(sheet.columns).toHaveLength(9)
  })

  it('单条导入模式表头保持 8 列不变（无「职能部门」列）', () => {
    const sheet = buildImportTemplateSheet('distribution')

    expect(sheet.columns.map(column => column.header)).toEqual(SINGLE_MODE_HEADERS)
    expect(sheet.columns.map(column => column.header)).not.toContain(FUNCTIONAL_DEPT_COLUMN_HEADER)
  })

  it('默认模式（不传 mode）= single，既有调用点零变化', () => {
    expect(getImportTemplateGuide('distribution').columns.map(column => column.label)).toEqual(
      SINGLE_MODE_HEADERS
    )
    expect(getImportTemplateGuide('distribution', 'single').columns.map(column => column.label)).toEqual(
      SINGLE_MODE_HEADERS
    )
  })

  it('「职能部门」列随组竖向合并（一个父级锚点 = 一个归口部门）', () => {
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

    // 第 2 列 = 职能部门（索引 2）
    const functionalDeptColumn = sheet.columns[2]
    expect(functionalDeptColumn.getValue(sheet.rows[0], 0)).toBe('教务处')
    expect(functionalDeptColumn.getValue(sheet.rows[1], 1)).toBe('数字校园建设办公室')
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

  it('单条导入的预填行**不带**「职能部门」键（保持 8 列键集不变）', () => {
    const sheet = buildImportTemplateSheet('distribution', [
      {
        parentIndicator: '父级指标甲',
        college: '工学院',
        parentIndicatorType: '定量',
        taskType: '基础性',
        functionalDept: '教务处'
      }
    ])

    expect(sheet.rows[0].functionalDept).toBeUndefined()
    expect(Object.keys(sheet.rows[0])).not.toContain('functionalDept')
  })

  it('全部导入模板的「填写说明」追加拆分规则（按职能部门分组 / 每组基础性权重=100）', () => {
    const rules = getImportTemplateGuide('distribution', 'all').rules.join('\n')

    expect(rules).toContain('「职能部门」列是本次导入的**拆分依据**')
    expect(rules).toContain('按该列把文件拆成若干组')
    expect(rules).toContain('每组（每个职能部门）**各自独立**做权重校验')
    expect(rules).toContain('该组内合计须为 100')
    // 交叉校验（防呆）说明必须在
    expect(rules).toContain('归属部门一致')
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
})
