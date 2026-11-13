import { describe, expect, it } from 'vitest'
import type { BusinessImportType } from '@/features/import/api/businessImport'
import {
  buildImportTemplateFileName,
  buildImportTemplateSheet,
  getImportTemplateGuide,
  WEIGHT_COLUMN_HEADER
} from '@/features/import/lib/importTemplate'

const importTypes: BusinessImportType[] = ['strategic-task', 'distribution']

// 2026-10-31 用户终版表头（职能部门 7 列 / 学院 8 列）；
// 2026-11-11 用户拍板：下发备注全端隐藏，两模板均不再带「下发备注」列；
// 2026-11-11 用户拍板：权重列全局统一纯数字口径（去掉 10 / 10% / 0.1 三格式混用）；
// 2026-11-12 防漂移：权重列头文案引用共享常量 WEIGHT_COLUMN_HEADER
const expectedHeaders: Record<BusinessImportType, string[]> = {
  'strategic-task': [
    '序号',
    '部门',
    '战略任务',
    '任务类型',
    '核心指标',
    '指标类型',
    WEIGHT_COLUMN_HEADER
  ],
  distribution: [
    '序号',
    '学院',
    '任务类型',
    '核心指标',
    '核心指标类型',
    '子指标名称',
    '指标类型',
    WEIGHT_COLUMN_HEADER
  ]
}

const expectedSheetNames: Record<BusinessImportType, string> = {
  'strategic-task': '职能部门指标模板',
  distribution: '学院子指标模板'
}

describe('import/lib/importTemplate', () => {
  it.each(importTypes)('%s 模板表头与后端可解析列名完全一致且不含已删列', type => {
    const sheet = buildImportTemplateSheet(type)
    const headers = sheet.columns.map(column => column.header)

    expect(headers).toEqual(expectedHeaders[type])
    expect(headers).not.toContain('预警等级')
    // 2026-10-31 层级化定案：学院模板不再有「父级战略任务」列
    expect(headers).not.toContain('父级战略任务')
    // 2026-11-11 用户拍板：下发备注全端隐藏，导入模板同步去列
    expect(headers).not.toContain('下发备注')
    // 终版表头：职能部门模板新增「任务类型」；学院模板核心指标列改名并新增「核心指标类型」
    if (type === 'strategic-task') {
      expect(headers).toContain('任务类型')
    } else {
      expect(headers).toContain('核心指标类型')
      // 旧列名不再出现（改为「核心指标」）
      expect(headers).not.toContain('父级核心指标')
    }
  })

  it.each(importTypes)('%s 模板 sheet 名称正确且包含示例行', type => {
    const sheet = buildImportTemplateSheet(type)

    expect(sheet.sheetName).toBe(expectedSheetNames[type])
    expect(sheet.rows.length).toBeGreaterThan(0)
  })

  it.each(importTypes)('%s 模板列能从组首行取到单元格值', type => {
    const sheet = buildImportTemplateSheet(type)
    const guide = getImportTemplateGuide(type)
    const firstRow = guide.rows[0]

    sheet.columns.forEach(column => {
      const guideColumn = guide.columns.find(item => item.label === column.header)
      const cell = column.getValue(firstRow, 0)
      const expected = guideColumn ? firstRow[guideColumn.key] || '' : ''
      // 组列在组首行返回携带 rowSpan 的锚点格（示例组 1 有 3 行 → rowSpan=3）；
      // 整列合并列（部门/学院）在首行返回 rowSpan=全部数据行；
      // 组内仅 1 行或非组列退回纯文本
      if (guideColumn?.mergeGroup) {
        expect(cell).toEqual({ value: expected, rowSpan: 3, alignVertical: 'center' })
      } else if (guideColumn?.mergeAll) {
        expect(cell).toEqual({
          value: expected,
          rowSpan: sheet.rows.length,
          alignVertical: 'center'
        })
      } else {
        expect(String(cell)).toBe(expected)
      }
    })
  })

  it.each(importTypes)('%s 模板文件名包含导入模板并以 .xlsx 结尾', type => {
    const fileName = buildImportTemplateFileName(type)

    expect(fileName).toContain('导入模板')
    expect(fileName.endsWith('.xlsx')).toBe(true)
  })

  it.each(importTypes)('%s 填写说明规则非空且明确列出必填列', type => {
    const guide = getImportTemplateGuide(type)

    expect(guide.rules.length).toBeGreaterThan(0)
    expect(guide.rules.every(rule => rule.trim().length > 0)).toBe(true)
    // 模板表头不能带星号（后端解析器按列名精确匹配），必填信息必须在文字规则中列明
    expect(guide.rules.some(rule => rule.includes('必填列'))).toBe(true)
    expect(guide.rules.some(rule => rule.includes('带 * 的列'))).toBe(false)
  })

  // ============ 2026-10-31 层级化改造（终版表头）：组号语义 / 留空=同上 / 合并单元格 ============
  // 2026-10-31 用户拍板（部门/学院列整列合并）：部门/学院列不再逐行填写，改跨全部数据行整列合并

  it('职能部门模板示例演示「留空=同上」：组内后续行组列留空、部门列整列合并仅首行携带', () => {
    const guide = getImportTemplateGuide('strategic-task')

    // 首行 = 组首行：序号、战略任务、任务类型必填
    expect(guide.rows[0].serial).toBe('1')
    expect(guide.rows[0].strategicTask).toBeTruthy()
    expect(guide.rows[0].taskType).toBe('基础性')
    // 组内延续行：组列（序号/战略任务/任务类型）留空（合并单元格的从属格）；
    // 部门列整列合并（一份导入锁定一个部门）：从属行留空
    const stickyRow = guide.rows[1]
    expect(stickyRow.serial).toBe('')
    expect(stickyRow.strategicTask).toBe('')
    expect(stickyRow.taskType).toBe('')
    expect(stickyRow.department).toBe('')
    // 延续行只填核心指标及其内容列
    expect(stickyRow.indicatorName).toBeTruthy()
    // 组内基础性权重合计 = 100（20+30+50 / 40+35+25）
    expect(guide.rows[6].taskType).toBe('发展性')
  })

  it('学院模板示例演示「一个父级核心指标拆多个子指标」：延续行组列留空、任务类型预填', () => {
    const guide = getImportTemplateGuide('distribution')

    expect(guide.rows[0].serial).toBe('1')
    expect(guide.rows[0].parentIndicator).toBe('建设智慧教学质量监测体系')
    // 核心指标类型=父指标自身类型（系统预填、只读校验）
    expect(guide.rows[0].parentIndicatorType).toBe('定量')
    // 2026-10-31 终版表头加列：任务类型=父级所属任务类型（系统预填、锚点只读）
    expect(guide.rows[0].taskType).toBe('基础性')
    const stickyRow = guide.rows[1]
    // 序号/任务类型/核心指标/核心指标类型四列随组竖向合并：从属格全部留空；
    // 学院列整列合并：从属行留空
    expect(stickyRow.serial).toBe('')
    expect(stickyRow.college).toBe('')
    expect(stickyRow.taskType).toBe('')
    expect(stickyRow.parentIndicator).toBe('')
    expect(stickyRow.parentIndicatorType).toBe('')
    // 同一父级下的第二个子指标
    expect(stickyRow.indicatorName).toBeTruthy()
    // 组 2 为发展性（示例演示发展性权重不占基础性池子）
    expect(guide.rows[3].taskType).toBe('发展性')
  })

  it('职能部门模板按组竖向合并「序号」「战略任务」「任务类型」，部门列整列合并：锚点格携带 rowSpan、从属格为 null', () => {
    const sheet = buildImportTemplateSheet('strategic-task')
    const serialColumn = sheet.columns[0]
    const departmentColumn = sheet.columns[1]
    const taskColumn = sheet.columns[2]
    const taskTypeColumn = sheet.columns[3]

    // 组 1 占三行：首行锚点 rowSpan=3，后续行为被合并的从属格（null）
    for (const column of [serialColumn, taskColumn, taskTypeColumn]) {
      expect(column.getValue(sheet.rows[0], 0)).toMatchObject({ rowSpan: 3 })
      expect(column.getValue(sheet.rows[1], 1)).toBeNull()
      expect(column.getValue(sheet.rows[2], 2)).toBeNull()
    }
    // 2026-10-31 用户拍板：部门列整列合并——首行 rowSpan=全部数据行，从属格 null
    expect(departmentColumn.getValue(sheet.rows[0], 0)).toMatchObject({ rowSpan: 7 })
    expect(departmentColumn.getValue(sheet.rows[1], 1)).toBeNull()
    // 组 3 仅一行：无合并，返回普通文本
    expect(serialColumn.getValue(sheet.rows[6], 6)).toBe('3')
    expect(taskTypeColumn.getValue(sheet.rows[6], 6)).toBe('发展性')
  })

  it('学院模板按组竖向合并「序号」「任务类型」「核心指标」「核心指标类型」，学院列整列合并', () => {
    const sheet = buildImportTemplateSheet('distribution')

    // 组列：序号(0)、任务类型(2)、核心指标(3)、核心指标类型(4)
    for (const columnIndex of [0, 2, 3, 4]) {
      const column = sheet.columns[columnIndex]
      expect(column.getValue(sheet.rows[0], 0)).toMatchObject({ rowSpan: 3 })
      expect(column.getValue(sheet.rows[1], 1)).toBeNull()
      expect(column.getValue(sheet.rows[2], 2)).toBeNull()
    }
    // 2026-10-31 用户拍板：学院列(1)整列合并——首行 rowSpan=全部数据行，从属格 null
    expect(sheet.columns[1].getValue(sheet.rows[0], 0)).toMatchObject({ rowSpan: 5 })
    expect(sheet.columns[1].getValue(sheet.rows[2], 2)).toBeNull()
    // 非组列（子指标名称）不受合并影响
    expect(sheet.columns[5].getValue(sheet.rows[2], 2)).toBe('建成教学质量看板')
  })

  it('学院模板预填行：序号=组号、任务类型/核心指标/核心指标类型预填，不再带父级战略任务', () => {
    const sheet = buildImportTemplateSheet('distribution', [
      {
        parentIndicator: '父级指标甲',
        college: '计算机学院',
        parentIndicatorType: '定量',
        taskType: '基础性'
      },
      { parentIndicator: '父级指标乙' }
    ])

    expect(sheet.rows).toEqual([
      {
        serial: '1',
        college: '计算机学院',
        taskType: '基础性',
        parentIndicator: '父级指标甲',
        parentIndicatorType: '定量',
        indicatorName: '',
        indicatorType: '',
        weight: ''
      },
      {
        serial: '2',
        college: '',
        taskType: '',
        parentIndicator: '父级指标乙',
        parentIndicatorType: '',
        indicatorName: '',
        indicatorType: '',
        weight: ''
      }
    ])
    // 预填行键集与终版列集一致（无 parentStrategicTask / remark 字段）
    sheet.rows.forEach(row => {
      expect(Object.keys(row)).not.toContain('parentStrategicTask')
      expect(Object.keys(row)).not.toContain('remark')
    })
    // 预填行每个父级单独成组（各占一行），组列无合并、返回纯文本
    expect(sheet.columns[0].getValue(sheet.rows[0], 0)).toBe('1')
    expect(sheet.columns[0].getValue(sheet.rows[1], 1)).toBe('2')
  })

  it.each(importTypes)('%s 规则文案写明「留空=同上」与合并单元格双写法', type => {
    const guide = getImportTemplateGuide(type)
    const rules = guide.rules.join('\n')

    expect(rules).toContain('留空')
    expect(rules).toContain('合并')
    // 2026-10-31 用户修订：模板用合并单元格，同时保留纯留空写法（两种都能导入）
    expect(rules).toContain('留空=同上')
    expect(rules).toContain('不合并单元格')
    // 序号语义：组号
    expect(rules).toContain('组号')
  })

  it.each(importTypes)('%s 规则文案写明按名称更新/新增且改名不支持', type => {
    const guide = getImportTemplateGuide(type)
    const rules = guide.rules.join('\n')

    expect(rules).toContain('同名')
    expect(rules).toContain('更新')
    expect(rules).toContain('新增')
    expect(rules).toContain('改名')
  })

  it('职能部门模板规则写明部门列整列合并、任务类型任务级落库', () => {
    const rules = getImportTemplateGuide('strategic-task').rules.join('\n')

    // 2026-10-31 用户拍板：部门列整列合并（一份导入锁定一个部门），不再逐行填写
    expect(rules).toContain('「部门」列整列合并')
    expect(rules).toContain('一份导入锁定一个部门')
    // 终版口径：任务类型=战略任务整体类型，组内继承落库；模板表头用「任务类型」
    expect(rules).toContain('任务类型')
    expect(rules).toContain('基础性')
  })

  // 2026-11-13（方案甲恢复）：学院页签下载模板恢复预填真实父级行（collegeImportParentIndicators
  // seeds），「填写说明」随之改回「已预填、只读校验」口径；锚点校验语义保持后端真实行为——
  // 任务类型/核心指标类型与系统不一致=阻断点名（2026-10-31 已从警告升级为阻断，
  // 旧文案的「警告不阻断」表述不得回归）
  it('学院模板规则写明父级列已预填、只读校验，与下发内容不一致即阻断点名', () => {
    const rules = getImportTemplateGuide('distribution').rules.join('\n')

    expect(rules).toContain('模板已按系统已下发数据预填')
    expect(rules).toContain('只读校验、请勿修改')
    expect(rules).toContain('阻断导入并点名对应行')
    // 旧文案的误导性表述不得回归（类型不一致是阻断，不是警告放行）
    expect(rules).not.toContain('不阻断导入')
    expect(rules).not.toContain('警告')
    // 不预填的旧口径不得回归（模板恢复预填后与实际行为一致）
    expect(rules).not.toContain('不预填系统数据')
    expect(rules).not.toContain('演示数据')
  })

  it('学院模板规则写明「任务类型」已按父级所属任务预填（不一致阻断点名）', () => {
    const rules = getImportTemplateGuide('distribution').rules.join('\n')

    expect(rules).toContain('「任务类型」为父级核心指标所属战略任务的类型')
    expect(rules).toContain('模板已按系统数据预填')
    expect(rules).toContain('阻断导入并点名对应行')
    expect(rules).toContain('请勿修改')
    // 子指标任务类别由父级继承链决定，不作为用户输入落库
    expect(rules).toContain('无需填写')
  })

  it('学院页签传 seeds：模板含真实父级行、无静态示例行、子指标三列留空（方案甲 2026-11-13）', () => {
    const sheet = buildImportTemplateSheet('distribution', [
      {
        parentIndicator: '完成重点提案办理与反馈督办',
        college: '工学院',
        parentIndicatorType: '定量',
        taskType: '基础性'
      },
      {
        parentIndicator: '形成党委统战领域专项推进台账',
        college: '工学院',
        parentIndicatorType: '定性',
        taskType: '发展性'
      }
    ])

    // seeds 替换静态示例行（无种子时才回退示例行）
    expect(sheet.rows).toHaveLength(2)
    expect(sheet.rows[0]).toEqual({
      serial: '1',
      college: '工学院',
      taskType: '基础性',
      parentIndicator: '完成重点提案办理与反馈督办',
      parentIndicatorType: '定量',
      indicatorName: '',
      indicatorType: '',
      weight: ''
    })
    // 每个父级行的子指标三列全部留空（用户只填子指标名称/指标类型/权重）
    sheet.rows.forEach(row => {
      expect(row.indicatorName).toBe('')
      expect(row.indicatorType).toBe('')
      expect(row.weight).toBe('')
    })
    // 组列按父级独立成组，学院列整列合并到全部数据行
    expect(sheet.columns[0].getValue(sheet.rows[0], 0)).toBe('1')
    expect(sheet.columns[0].getValue(sheet.rows[1], 1)).toBe('2')
    expect(sheet.columns[1].getValue(sheet.rows[0], 0)).toMatchObject({ rowSpan: 2 })
  })

  it('学院页签未选部门（seeds 为空）→ 回退静态示例行，不产出空模板', () => {
    const withSeeds = buildImportTemplateSheet('distribution', [])
    const fallback = buildImportTemplateSheet('distribution')

    expect(withSeeds.rows).toEqual(fallback.rows)
    expect(withSeeds.rows.length).toBeGreaterThan(0)
  })

  // ============ 2026-10-31 用户拍板：权重说明改为计划级口径 ============

  it.each(importTypes)('%s 权重说明改为计划级口径：基础性任务及指标全计划合计须为 100', type => {
    const rules = getImportTemplateGuide(type).rules.join('\n')

    // 计划级口径：两套模板同一句——基础性任务及其指标的权重全计划合计须为 100
    expect(rules).toContain('基础性任务及其指标的权重，全计划合计须为 100')
    expect(rules).toContain('基础性任务下的指标同为基础性')
    expect(rules).toContain('多个基础性任务组的权重一并计入合计')
    // 旧的「组内合计」口径不再出现
    expect(rules).not.toContain('同一任务组内基础性权重合计需为 100')
    expect(rules).not.toContain('同一父级指标组内子指标权重合计需为 100')
    expect(rules).not.toContain('合计不是 100 会给出警告')
  })
})
