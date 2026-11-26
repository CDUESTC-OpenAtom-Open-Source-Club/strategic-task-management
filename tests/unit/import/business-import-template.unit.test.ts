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
    '归口职能部门',
    '任务类型',
    '核心指标',
    '核心指标类型',
    '子指标名称',
    '指标类型',
    WEIGHT_COLUMN_HEADER
  ]
}

const expectedSheetNames: Record<BusinessImportType, string> = {
  'strategic-task': '职能部门指标导入模板',
  distribution: '学院子指标导入模板'
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

    // 组列在组首行返回携带 rowSpan 的锚点格（示例组 1 有 3 行 → rowSpan=3）；
    // 按块合并列（部门 / 归口职能部门 / 学院）：01 首块 = 首个战略任务组（3 行）；
    // 02 首块 = 两个核心指标组归口相同并成一块（全部 5 行）；
    // 数值列（序号/权重）写 number；单行块/组或非合并列退回纯文本
    const blockSpan = type === 'strategic-task' ? 3 : sheet.rows.length
    sheet.columns.forEach(column => {
      const guideColumn = guide.columns.find(item => item.label === column.header)
      const cell = column.getValue(firstRow, 0)
      const expected = guideColumn ? firstRow[guideColumn.key] || '' : ''
      if (guideColumn?.mergeGroup) {
        expect(cell).toEqual({ value: expected, rowSpan: 3, alignVertical: 'center' })
      } else if (guideColumn?.mergeBlock) {
        expect(cell).toEqual({ value: expected, rowSpan: blockSpan, alignVertical: 'center' })
      } else if (guideColumn?.numeric) {
        expect(cell).toBe(Number(expected))
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

  it.each(importTypes)('%s 填写说明规则非空且按定稿样例列出列结构与校验规则（2026-11-26 收口）', type => {
    const guide = getImportTemplateGuide(type)

    expect(guide.rules.length).toBeGreaterThan(0)
    expect(guide.rules.every(rule => rule.trim().length > 0)).toBe(true)
    // 2026-11-26 收口：说明文案逐字取自定稿样例——列结构逐列列明（必填口径由
    // 「列结构 + 校验」表达，不再使用旧「必填列」归纳句）；表头不带星号（后端按列名精确匹配）
    expect(guide.rules.some(rule => rule.includes('列结构'))).toBe(true)
    expect(guide.rules.some(rule => rule.includes('校验'))).toBe(true)
    expect(guide.rules.some(rule => rule.includes('带 * 的列'))).toBe(false)
  })

  // ============ 2026-10-31 层级化改造（终版表头）：留空=同上 / 合并单元格 ============
  // 2026-11-26（下发侧语义修正，对齐 01/02/03 样例）：序号 = 最末级指标行号（逐行、不合并、数值型）；
  // 判组依据 = 关键列非空（01 战略任务 / 02·03 核心指标）；部门/学院列按块合并（取代整列合并）、
  // 每块锚点重复写值；序号/权重写数值型。

  it('职能部门模板示例演示（2026-11-26 对齐 01 定稿样例逐字内容）：组内后续行组列留空、序号逐行递增', () => {
    const guide = getImportTemplateGuide('strategic-task')

    // 首行 = 组首行：战略任务、任务类型必填；序号 = 核心指标行号 1
    expect(guide.rows[0].serial).toBe('1')
    expect(guide.rows[0].strategicTask).toContain('深入推进教务处年度本科教育教学改革')
    expect(guide.rows[0].taskType).toBe('基础性')
    // 组内延续行：组列（战略任务/任务类型）留空（合并单元格的从属格）；
    // 部门列由构建函数按块在锚点行重复写值，示例数据沿用「首行携带」写法
    const stickyRow = guide.rows[1]
    expect(stickyRow.serial).toBe('2')
    expect(stickyRow.strategicTask).toBe('')
    expect(stickyRow.taskType).toBe('')
    expect(stickyRow.department).toBe('')
    // 延续行只填核心指标及其内容列
    expect(stickyRow.indicatorName).toBeTruthy()
    // 组 2 = 发展性单行（样例第 5 行：部门列锚点重复写「教务处」）
    expect(guide.rows[3].taskType).toBe('发展性')
    expect(guide.rows[3].department).toBe('教务处')
    // 全部示例行序号逐行递增 1..N（样例 01：序号 1/2/3/4 对应四个核心指标）
    expect(guide.rows.map(row => row.serial)).toEqual(['1', '2', '3', '4'])
    // 组内基础性权重合计 = 100（样例 40+30+30；发展性单行 100）
    expect(guide.rows.map(row => row.weight)).toEqual(['40', '30', '30', '100'])
  })

  it('学院模板示例演示「一个父级核心指标拆多个子指标」：序号逐行递增、延续行组列留空、任务类型预填', () => {
    const guide = getImportTemplateGuide('distribution')

    expect(guide.rows[0].serial).toBe('1')
    expect(guide.rows[0].parentIndicator).toBe('建设智慧教学质量监测体系')
    // 核心指标类型=父指标自身类型（系统预填、只读校验）
    expect(guide.rows[0].parentIndicatorType).toBe('定量')
    // 2026-10-31 终版表头加列：任务类型=父级所属任务类型（系统预填、锚点只读）
    expect(guide.rows[0].taskType).toBe('基础性')
    const stickyRow = guide.rows[1]
    // 2026-11-26 序号语义改造：序号=子指标行号，逐行递增（不再随组留空/合并）
    expect(stickyRow.serial).toBe('2')
    // 任务类型/核心指标/核心指标类型三列随组竖向合并：从属格留空；
    // 学院列按块合并：示例数据沿用「首行携带」写法，构建函数在每块锚点行重复写值
    expect(stickyRow.college).toBe('')
    expect(stickyRow.taskType).toBe('')
    expect(stickyRow.parentIndicator).toBe('')
    expect(stickyRow.parentIndicatorType).toBe('')
    // 同一父级下的第二个子指标
    expect(stickyRow.indicatorName).toBeTruthy()
    // 组 2 为发展性（示例演示发展性权重不占基础性池子）
    expect(guide.rows[3].taskType).toBe('发展性')
    // 全部示例行序号逐行递增 1..N
    expect(guide.rows.map(row => row.serial)).toEqual(['1', '2', '3', '4', '5'])
  })

  it('职能部门模板按组竖向合并「战略任务」「任务类型」，序号逐行不合并，部门列按战略任务组分块合并（2026-11-26 对齐 01 样例）', () => {
    const sheet = buildImportTemplateSheet('strategic-task')
    const serialColumn = sheet.columns[0]
    const departmentColumn = sheet.columns[1]
    const taskColumn = sheet.columns[2]
    const taskTypeColumn = sheet.columns[3]

    // 组 1（基础性，前 3 行）：首行锚点 rowSpan=3，后续行为被合并的从属格（null）
    for (const column of [taskColumn, taskTypeColumn]) {
      expect(column.getValue(sheet.rows[0], 0)).toMatchObject({ rowSpan: 3 })
      expect(column.getValue(sheet.rows[1], 1)).toBeNull()
      expect(column.getValue(sheet.rows[2], 2)).toBeNull()
    }
    // 序号 = 核心指标行号，逐行一号、数值型、不参与合并（样例 1/2/3/4）
    expect(sheet.rows.map((row, index) => serialColumn.getValue(row, index))).toEqual([1, 2, 3, 4])
    // 部门列按块合并——块 1 = 任务组 1（样例 B2:B4，锚点 rowSpan=3）；
    // 块 2 = 任务组 2 单行（样例 B5 锚点重复写值）
    expect(departmentColumn.getValue(sheet.rows[0], 0)).toMatchObject({
      value: '教务处',
      rowSpan: 3
    })
    expect(departmentColumn.getValue(sheet.rows[1], 1)).toBeNull()
    expect(departmentColumn.getValue(sheet.rows[3], 3)).toBe('教务处')
    // 组 2 仅一行：无合并，返回普通文本
    expect(taskTypeColumn.getValue(sheet.rows[3], 3)).toBe('发展性')
  })

  it('学院模板按组竖向合并「任务类型」「核心指标」「核心指标类型」等组列（序号不合并），学院列/归口列按归口块合并', () => {
    const sheet = buildImportTemplateSheet('distribution')

    // 2026-11-25：第 3 列插入「归口职能部门」，组列后移一位。
    // 2026-11-26 序号语义修正：序号列(0)逐行显示行号（数值型、不合并）；
    // 组列：任务类型(3)、核心指标(4)、核心指标类型(5)，合并锚点 =「核心指标列非空」的组首行
    // （与后端归组口径一致；示例组 1 = 前 3 行、组 2 = 后 2 行）
    for (const columnIndex of [3, 4, 5]) {
      const column = sheet.columns[columnIndex]
      expect(column.getValue(sheet.rows[0], 0)).toMatchObject({ rowSpan: 3 })
      expect(column.getValue(sheet.rows[1], 1)).toBeNull()
      expect(column.getValue(sheet.rows[2], 2)).toBeNull()
      expect(column.getValue(sheet.rows[3], 3)).toMatchObject({ rowSpan: 2 })
      expect(column.getValue(sheet.rows[4], 4)).toBeNull()
    }
    // 序号列(0)逐行显示各自行号（数值型；无 rowSpan、无非 null 从属格）
    const serialColumn = sheet.columns[0]
    expect(sheet.rows.map((row, index) => serialColumn.getValue(row, index))).toEqual([
      1, 2, 3, 4, 5
    ])
    // 2026-11-26 对齐 02 样例：归口职能部门列(2)按归口连续块合并——示例两个核心指标组归口同为
    // 教务处 → 并成一块（rowSpan=5）；学院列(1)与归口块同几何
    for (const columnIndex of [1, 2]) {
      expect(sheet.columns[columnIndex].getValue(sheet.rows[0], 0)).toMatchObject({ rowSpan: 5 })
      expect(sheet.columns[columnIndex].getValue(sheet.rows[2], 2)).toBeNull()
      expect(sheet.columns[columnIndex].getValue(sheet.rows[4], 4)).toBeNull()
    }
    // 非组列（子指标名称）不受合并影响
    expect(sheet.columns[6].getValue(sheet.rows[2], 2)).toBe('建成教学质量看板')
  })

  it('学院模板预填行：序号=子指标行号（逐行递增）、任务类型/核心指标/核心指标类型预填，不再带父级战略任务', () => {
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
        functionalDept: '',
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
        functionalDept: '',
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
    // 预填行每个父级单独成组（各占一行），组列无合并、返回纯文本；序号为数值型行号
    expect(sheet.columns[0].getValue(sheet.rows[0], 0)).toBe(1)
    expect(sheet.columns[0].getValue(sheet.rows[1], 1)).toBe(2)
  })

  it.each(importTypes)('%s 规则文案按定稿样例写明合并版式与纯数字权重（2026-11-26 收口）', type => {
    const guide = getImportTemplateGuide(type)
    const rules = guide.rules.join('\n')

    // 样例口径：黄色示例行提示 + 权重纯数字；下发目标校验文案在位
    expect(rules).toContain('黄色底纹行为示例数据')
    expect(rules).toContain('权重（纯数字）')
    if (type === 'strategic-task') {
      expect(rules).toContain('随组竖向合并')
      expect(rules).toContain('🔴 部门校验')
      expect(rules).toContain('不一致整单拒绝')
    } else {
      expect(rules).toContain('🔴 目标校验')
      expect(rules).toContain('同组基础性权重合计应为 100')
    }
  })

  it.each(importTypes)('%s 规则文案写明同名挂接/更新与新名称新建（2026-11-26 对齐样例文案）', type => {
    const guide = getImportTemplateGuide(type)
    const rules = guide.rules.join('\n')

    expect(rules).toContain('同名')
    expect(rules).toContain('新建')
    if (type === 'strategic-task') {
      expect(rules).toContain('更新子指标')
    } else {
      expect(rules).toContain('挂接既有核心指标')
    }
  })

  it('职能部门模板规则写明部门校验与任务类型口径（2026-11-26 对齐 01 样例文案）', () => {
    const rules = getImportTemplateGuide('strategic-task').rules.join('\n')

    // 样例口径：「部门」列 = 下发目标，解析时与页面选定部门比对——不一致整单拒绝；
    // 任务类型随组竖向合并；同组基础性权重合计应为 100
    expect(rules).toContain('🔴 部门校验')
    expect(rules).toContain('不一致整单拒绝')
    expect(rules).toContain('任务类型：基础性 / 发展性（随组竖向合并）')
    expect(rules).toContain('同组基础性权重合计应为 100')
  })

  // 2026-11-13（方案甲恢复）：学院页签下载模板恢复预填真实父级行（collegeImportParentIndicators
  // seeds），「填写说明」随之改回「已预填、只读校验」口径；锚点校验语义保持后端真实行为——
  // 任务类型/核心指标类型与系统不一致=阻断点名（2026-10-31 已从警告升级为阻断，
  // 旧文案的「警告不阻断」表述不得回归）
  it('学院模板规则写明核心指标按名称反查、目标校验整单拒绝（2026-11-26 对齐 02 样例文案）', () => {
    const rules = getImportTemplateGuide('distribution').rules.join('\n')

    // 样例口径：核心指标列系统按名称反查所属任务；「学院」+「归口职能部门」共同声明
    // 下发目标，解析时与页面选定学院/部门比对——不一致整单拒绝
    expect(rules).toContain('核心指标列：系统按名称反查所属任务')
    expect(rules).toContain('🔴 目标校验')
    expect(rules).toContain('不一致整单拒绝')
    // 误导性表述不得回归（校验是整单拒绝，不是警告放行）
    expect(rules).not.toContain('不阻断导入')
    expect(rules).not.toContain('警告')
    expect(rules).not.toContain('演示数据')
  })

  it('学院模板规则写明列结构与权重口径（2026-11-26 对齐 02 样例文案）', () => {
    const rules = getImportTemplateGuide('distribution').rules.join('\n')

    expect(rules).toContain(
      '列结构（9 列）：序号 / 学院 / 归口职能部门 / 任务类型 / 核心指标 / 核心指标类型 / 子指标名称 / 指标类型 / 权重（纯数字）'
    )
    expect(rules).toContain('权重：纯数字；同组基础性权重合计应为 100')
    expect(rules).toContain('下发流程：导入成功 → 自动发起下发审批')
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
      functionalDept: '',
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
    // 组列按父级独立成组；学院列按块合并——两个父级的归口列均为空（留空=延续上一块）
    // → 并成一块 rowSpan=2（同 02 样例「归口相同的相邻组共用一格」版式）
    expect(sheet.columns[0].getValue(sheet.rows[0], 0)).toBe(1)
    expect(sheet.columns[0].getValue(sheet.rows[1], 1)).toBe(2)
    expect(sheet.columns[1].getValue(sheet.rows[0], 0)).toMatchObject({ rowSpan: 2 })
  })

  it('学院页签未选部门（seeds 为空）→ 回退静态示例行，不产出空模板', () => {
    const withSeeds = buildImportTemplateSheet('distribution', [])
    const fallback = buildImportTemplateSheet('distribution')

    expect(withSeeds.rows).toEqual(fallback.rows)
    expect(withSeeds.rows.length).toBeGreaterThan(0)
  })

  // ============ 2026-10-31 用户拍板：权重说明改为计划级口径 ============

  it.each(importTypes)('%s 权重说明按定稿样例：同组基础性权重合计应为 100（2026-11-26 收口文案）', type => {
    const rules = getImportTemplateGuide(type).rules.join('\n')

    // 2026-11-26 定稿样例文案：同组基础性权重合计应为 100（取代旧「全计划合计」归纳句）
    expect(rules).toContain('同组基础性权重合计应为 100')
    expect(rules).toContain('权重（纯数字）')
    // 旧口径不再出现
    expect(rules).not.toContain('同一任务组内基础性权重合计需为 100')
    expect(rules).not.toContain('同一父级指标组内子指标权重合计需为 100')
    expect(rules).not.toContain('合计不是 100 会给出警告')
  })
})
