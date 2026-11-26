import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { buildExcelBlob } from '@/shared/lib/export/excel'
import {
  buildImportTemplateSheet,
  buildImportTemplateSheets,
  getImportTemplateGuide,
  type ImportTemplateParentSeed,
  WEIGHT_COLUMN_HEADER
} from '../importTemplate'

type TemplateType = 'strategic-task' | 'distribution'

/** 读取生成的 xlsx 数据页 XML（去掉样式索引，便于断言取值） */
const readDataSheetXml = async (
  type: TemplateType,
  mode: 'single' | 'all' = 'single'
): Promise<string> => {
  const blob = await buildExcelBlob(buildImportTemplateSheets(type, undefined, mode) as never)
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const sheet = zip.file('xl/worksheets/sheet1.xml')
  if (!sheet) {
    throw new Error('xlsx 内缺少数据页 xl/worksheets/sheet1.xml')
  }
  return (await sheet.async('string')).replace(/ s="\d+"/g, '')
}

/** 数据页全部合并区（如 B2:B4），按字典序排列 */
const readSortedMergeRefs = async (type: TemplateType, mode: 'single' | 'all' = 'single') => {
  const sheetXml = await readDataSheetXml(type, mode)
  return [...sheetXml.matchAll(/<mergeCell ref="([^"]+)"/g)].map(match => match[1]).sort()
}

describe('getImportTemplateGuide 学院模板加「任务类型」列（2026-10-31 终版表头加列定案）', () => {
  it('学院模板 9 列：归口职能部门位于学院之后、任务类型之前（2026-11-25 对齐 02 样例）', () => {
    const guide = getImportTemplateGuide('distribution')

    expect(guide.columns.map(column => column.label)).toEqual([
      '序号',
      '学院',
      '归口职能部门',
      '任务类型',
      '核心指标',
      '核心指标类型',
      '子指标名称',
      '指标类型',
      WEIGHT_COLUMN_HEADER
    ])
  })

  it('学院模板合并口径（2026-11-26 对齐 02/03 样例）：学院列 + 归口职能部门列按块合并（mergeBlock），任务类型/核心指标/核心指标类型随组合并（mergeGroup）', () => {
    const guide = getImportTemplateGuide('distribution')
    const column = (key: string) => guide.columns.find(item => item.key === key)

    expect(column('college')?.mergeBlock).toBe(true)
    expect(column('college')?.mergeGroup).toBeFalsy()
    expect(column('functionalDept')?.mergeBlock).toBe(true)
    expect(column('functionalDept')?.mergeGroup).toBeFalsy()
    expect(column('taskType')?.mergeGroup).toBe(true)
    expect(column('parentIndicator')?.mergeGroup).toBe(true)
    expect(column('parentIndicatorType')?.mergeGroup).toBe(true)
  })

  it('学院模板序号列（2026-11-26 序号语义改造）：不随组合并、不标必填（可选，留空自动补号）、写数值型', () => {
    const guide = getImportTemplateGuide('distribution')

    const serialColumn = guide.columns.find(column => column.key === 'serial')!
    expect(serialColumn.mergeGroup).toBeFalsy()
    expect(serialColumn.mergeBlock).toBeFalsy()
    expect(serialColumn.required).toBeFalsy()
    expect(serialColumn.numeric).toBe(true)
    expect(serialColumn.label).toBe('序号')
    // 权重同样写数值型（样例为数字）
    expect(guide.columns.find(column => column.key === 'weight')?.numeric).toBe(true)
  })

  it('学院模板填写说明（2026-11-26 收口对齐 02 样例）：7 条、逐字取自样例「填写说明」原文', () => {
    const guide = getImportTemplateGuide('distribution')

    expect(guide.rulesTitle).toBe('填写说明（02 · 战略部下发二级学院 · 单学院单归口导入）')
    expect(guide.rules).toHaveLength(7)
    expect(guide.rules[0]).toBe(
      '使用者：战略发展部在「战略任务管理 → 二级学院页签」选中学院后用「导入」按钮上传；一次导入 = 一个学院 × 一个归口部门的一条线。'
    )
    expect(guide.rules[2]).toBe(
      '🔴 目标校验：「学院」+「归口职能部门」两列共同声明下发目标（文理学院 ← 预算部），解析时与页面选定学院/部门比对——不一致整单拒绝。'
    )
    expect(guide.rules[6]).toBe('黄色底纹行为示例数据（文理学院真实指标），正式使用前请替换。')
  })

  it('职能部门模板合并口径（2026-11-26 对齐 01 样例）：部门列按块合并（mergeBlock），战略任务/任务类型随组合并（mergeGroup）', () => {
    const guide = getImportTemplateGuide('strategic-task')
    const column = (key: string) => guide.columns.find(item => item.key === key)

    expect(column('department')?.mergeBlock).toBe(true)
    expect(column('department')?.mergeGroup).toBeFalsy()
    expect(column('strategicTask')?.mergeGroup).toBe(true)
    expect(column('taskType')?.mergeGroup).toBe(true)
  })

  it('职能部门模板序号列（2026-11-26 下发侧语义修正）：不再随组合并、仍必填、写数值型', () => {
    const guide = getImportTemplateGuide('strategic-task')

    const serialColumn = guide.columns.find(column => column.key === 'serial')!
    expect(serialColumn.mergeGroup).toBeFalsy()
    expect(serialColumn.mergeBlock).toBeFalsy()
    expect(serialColumn.required).toBe(true)
    expect(serialColumn.numeric).toBe(true)
    expect(guide.columns.find(column => column.key === 'weight')?.numeric).toBe(true)
  })
})

describe('buildImportTemplateSheet 序号逐行递增（2026-11-26 学院导入序号语义改造）', () => {
  it('示例行序号逐行递增 1..N：每行一号、不再留空、不再按组合并', () => {
    const sheet = buildImportTemplateSheet('distribution')

    expect(sheet.rows.map(row => row.serial)).toEqual(['1', '2', '3', '4', '5'])
    // 序号列每行显示各自号码（mergeGroup 已移除：无 rowSpan、无 null 从属格），且为数值型
    const serialColumn = sheet.columns.find(column => column.header === '序号')!
    const serialValues = sheet.rows.map((row, index) => serialColumn.getValue(row, index))
    expect(serialValues).toEqual([1, 2, 3, 4, 5])
  })

  it('锚点预填行（parentSeeds）序号逐行递增 1..N（N=锚点行数）', () => {
    const sheet = buildImportTemplateSheet('distribution', [
      { parentIndicator: '父级指标甲', college: '工学院', taskType: '基础性' },
      { parentIndicator: '父级指标乙', college: '工学院', taskType: '发展性' },
      { parentIndicator: '父级指标丙', college: '工学院', taskType: '发展性' }
    ])

    expect(sheet.rows).toHaveLength(3)
    expect(sheet.rows.map(row => row.serial)).toEqual(['1', '2', '3'])
  })

  it('序号不再按组合并后，任务类型等组列仍按「核心指标列非空」锚定竖向合并（版式不回退）', () => {
    const sheet = buildImportTemplateSheet('distribution')

    const taskTypeColumn = sheet.columns.find(column => column.header === '任务类型')!
    expect(taskTypeColumn.getValue(sheet.rows[0], 0)).toMatchObject({ value: '基础性', rowSpan: 3 })
    expect(taskTypeColumn.getValue(sheet.rows[1], 1)).toBeNull()
    expect(taskTypeColumn.getValue(sheet.rows[3], 3)).toMatchObject({ value: '发展性', rowSpan: 2 })
  })
})

describe('buildImportTemplateSheet 学院模板（任务类型列 + 学院列/归口列按块合并）', () => {
  it('任务类型随组竖向合并：组锚点 rowSpan=组行数、从属格 null', () => {
    const sheet = buildImportTemplateSheet('distribution')

    expect(sheet.rows.length).toBe(5)
    const taskTypeColumn = sheet.columns.find(column => column.header === '任务类型')!
    // 组 1（前 3 行，基础性）：锚点 rowSpan=3，从属格 null
    expect(taskTypeColumn.getValue(sheet.rows[0], 0)).toMatchObject({ value: '基础性', rowSpan: 3 })
    expect(taskTypeColumn.getValue(sheet.rows[1], 1)).toBeNull()
    expect(taskTypeColumn.getValue(sheet.rows[2], 2)).toBeNull()
    // 组 2（后 2 行，发展性）：锚点 rowSpan=2，从属格 null
    expect(taskTypeColumn.getValue(sheet.rows[3], 3)).toMatchObject({ value: '发展性', rowSpan: 2 })
    expect(taskTypeColumn.getValue(sheet.rows[4], 4)).toBeNull()
  })

  it('学院列按块合并（2026-11-26 对齐 02 样例）：示例两个核心指标组归口相同并成一块——首行 rowSpan=全部数据行，其余行 null', () => {
    const sheet = buildImportTemplateSheet('distribution')

    const collegeColumn = sheet.columns.find(column => column.header === '学院')!
    expect(collegeColumn.getValue(sheet.rows[0], 0)).toMatchObject({
      value: '计算机学院',
      rowSpan: 5
    })
    for (let index = 1; index < sheet.rows.length; index += 1) {
      expect(collegeColumn.getValue(sheet.rows[index], index)).toBeNull()
    }
  })

  it('样例 02 版式：归口相同的两个核心指标组——学院列/归口列跨组并成一块，任务类型/核心指标/核心指标类型仍按组合并', () => {
    const sheet = buildImportTemplateSheet('distribution')
    const column = (header: string) => sheet.columns.find(item => item.header === header)!

    // 学院列、归口职能部门列：整块合并（rowSpan=5，跨两个核心指标组）
    for (const header of ['学院', '归口职能部门']) {
      expect(column(header).getValue(sheet.rows[0], 0)).toMatchObject({ rowSpan: 5 })
      for (let index = 1; index < 5; index += 1) {
        expect(column(header).getValue(sheet.rows[index], index)).toBeNull()
      }
    }
    // 任务类型/核心指标/核心指标类型：按核心指标组各自合并（组 1 = 前 3 行、组 2 = 后 2 行）
    for (const header of ['任务类型', '核心指标', '核心指标类型']) {
      expect(column(header).getValue(sheet.rows[0], 0)).toMatchObject({ rowSpan: 3 })
      expect(column(header).getValue(sheet.rows[2], 2)).toBeNull()
      expect(column(header).getValue(sheet.rows[3], 3)).toMatchObject({ rowSpan: 2 })
      expect(column(header).getValue(sheet.rows[4], 4)).toBeNull()
    }
  })

  it('预填行归口断开即分块（样例 03 版式）：归口列按归口连续块合并，学院列同块并在每块锚点重复写值', () => {
    const sheet = buildImportTemplateSheet('distribution', [
      {
        parentIndicator: '父级指标甲',
        college: '工学院',
        taskType: '基础性',
        functionalDept: '教务处'
      },
      {
        parentIndicator: '父级指标乙',
        college: '工学院',
        taskType: '基础性',
        functionalDept: '教务处'
      },
      {
        parentIndicator: '父级指标丙',
        college: '工学院',
        taskType: '发展性',
        functionalDept: '财务处'
      },
      {
        parentIndicator: '父级指标丁',
        college: '工学院',
        taskType: '发展性',
        functionalDept: '教务处'
      }
    ])
    const column = (header: string) => sheet.columns.find(item => item.header === header)!

    // 归口块 = [甲,乙] / [丙] / [丁]：归口相同的相邻锚点并块，断开后即使归口回到「教务处」也是新块
    const deptColumn = column('归口职能部门')
    expect(deptColumn.getValue(sheet.rows[0], 0)).toMatchObject({ value: '教务处', rowSpan: 2 })
    expect(deptColumn.getValue(sheet.rows[1], 1)).toBeNull()
    expect(deptColumn.getValue(sheet.rows[2], 2)).toBe('财务处')
    expect(deptColumn.getValue(sheet.rows[3], 3)).toBe('教务处')

    // 学院列与归口块同几何，每块锚点重复写同一个学院名
    const collegeColumn = column('学院')
    expect(collegeColumn.getValue(sheet.rows[0], 0)).toMatchObject({ value: '工学院', rowSpan: 2 })
    expect(collegeColumn.getValue(sheet.rows[1], 1)).toBeNull()
    expect(collegeColumn.getValue(sheet.rows[2], 2)).toBe('工学院')
    expect(collegeColumn.getValue(sheet.rows[3], 3)).toBe('工学院')
    // 锚点写值全表一致（后端「与页面选定不一致整单拒绝」不会被重复写值触发）
    const anchors = sheet.rows.filter(
      (_, index) => collegeColumn.getValue(sheet.rows[index], index) !== null
    )
    expect(anchors.map(row => row.college)).toEqual(['工学院', '工学院', '工学院'])
  })

  it('模板下载预填（parentSeeds）：任务类型按父级所属任务预填进「任务类型」列', () => {
    const parentSeeds: ImportTemplateParentSeed[] = [
      {
        parentIndicator: '完善课程建设与专业评估机制',
        college: '工学院',
        parentIndicatorType: '定性',
        taskType: '基础性'
      },
      {
        parentIndicator: '让我出说说花花。',
        college: '工学院',
        parentIndicatorType: '定量',
        taskType: '发展性'
      }
    ]
    const sheet = buildImportTemplateSheet('distribution', parentSeeds)

    expect(sheet.rows).toHaveLength(2)
    expect(sheet.rows[0]).toMatchObject({
      serial: '1',
      college: '工学院',
      taskType: '基础性',
      parentIndicator: '完善课程建设与专业评估机制',
      parentIndicatorType: '定性'
    })
    expect(sheet.rows[1].taskType).toBe('发展性')
  })
})

describe('buildImportTemplateSheet 职能部门模板（序号=核心指标行号 + 部门列按块合并）', () => {
  it('序号 = 核心指标行号（2026-11-26 对齐 01 样例）：逐行递增 1..4、写数值型、不参与合并', () => {
    const sheet = buildImportTemplateSheet('strategic-task')
    const serialColumn = sheet.columns[0]

    expect(sheet.rows.map(row => row.serial)).toEqual(['1', '2', '3', '4'])
    // 每行各有一号：无 rowSpan 锚点格、无 null 从属格
    expect(sheet.rows.map((row, index) => serialColumn.getValue(row, index))).toEqual([1, 2, 3, 4])
  })

  it('判组依据 = 「战略任务」列非空（不再看序号列）：序号每行都有值，战略任务/任务类型仍按组竖向合并', () => {
    const sheet = buildImportTemplateSheet('strategic-task')
    const column = (header: string) => sheet.columns.find(item => item.header === header)!
    const group2Task =
      '统筹协调教务处年度跨部门教学管理协同事项与突发教学运行保障工作，建立与学工、人事、财务等部门的联动会商机制，保障全校教学工作平稳有序运转'

    for (const header of ['战略任务', '任务类型']) {
      // 组 1（前 3 行，基础性）：锚点 rowSpan=3、从属格 null
      expect(column(header).getValue(sheet.rows[0], 0)).toMatchObject({ rowSpan: 3 })
      expect(column(header).getValue(sheet.rows[1], 1)).toBeNull()
      expect(column(header).getValue(sheet.rows[2], 2)).toBeNull()
      // 组 2 仅一行（发展性）：无合并，返回普通文本（样例 01 第 5 行版式）
      expect(column(header).getValue(sheet.rows[3], 3)).toBe(
        header === '战略任务' ? group2Task : '发展性'
      )
    }
  })

  it('部门列按块合并（2026-11-26 对齐 01 样例）：每个战略任务组一块、每块锚点重复写值', () => {
    const sheet = buildImportTemplateSheet('strategic-task')

    expect(sheet.rows.length).toBe(4)
    const departmentColumn = sheet.columns[1]
    // 块 1 = 任务 1（前 3 行）：锚点 rowSpan=3（样例 B2:B4），从属格 null
    expect(departmentColumn.getValue(sheet.rows[0], 0)).toMatchObject({
      value: '教务处',
      rowSpan: 3
    })
    expect(departmentColumn.getValue(sheet.rows[1], 1)).toBeNull()
    expect(departmentColumn.getValue(sheet.rows[2], 2)).toBeNull()
    // 块 2 = 任务 2（末行，单行块）：锚点重复写值（样例 B5 再写「教务处」）
    expect(departmentColumn.getValue(sheet.rows[3], 3)).toBe('教务处')
  })

  it('表头列序收敛为 7 列（2026-11-11 用户拍板：隐藏「下发备注」列）', () => {
    const sheet = buildImportTemplateSheet('strategic-task')

    expect(sheet.columns.map(column => column.header)).toEqual([
      '序号',
      '部门',
      '战略任务',
      '任务类型',
      '核心指标',
      '指标类型',
      WEIGHT_COLUMN_HEADER
    ])
  })

  it('部门列跟随当前下发部门（2026-11-25 用户反馈：不同部门下载到同一份「教务处」）', () => {
    const sheet = buildImportTemplateSheet('strategic-task', [
      { parentIndicator: '', department: '党委学工部 | 学生工作处' }
    ])

    // 示例内容不变，只有「部门」列被替换成真实目标部门
    expect(sheet.rows.length).toBe(4)
    expect(sheet.rows[0].department).toBe('党委学工部 | 学生工作处')
    expect(sheet.rows[0].strategicTask).toBe(
      '深入推进教务处年度本科教育教学改革与人才培养质量提升工程，完善课程建设、专业评估与教学质量监测体系，健全教考分离与持续改进闭环机制'
    )

    const departmentColumn = sheet.columns.find(column => column.header === '部门')!
    expect(departmentColumn.getValue(sheet.rows[0], 0)).toMatchObject({
      value: '党委学工部 | 学生工作处',
      rowSpan: 3
    })
    // 每块锚点重复写值，且与下发目标部门完全一致（块 1 前 3 行 + 块 2 末行单行块）
    const anchors = sheet.rows.filter(
      (_, index) => departmentColumn.getValue(sheet.rows[index], index) !== null
    )
    expect(anchors.map(row => row.department)).toEqual([
      '党委学工部 | 学生工作处',
      '党委学工部 | 学生工作处'
    ])
  })

  it('未传目标部门时部门列仍回退示例值（旧调用点不受影响）', () => {
    const sheet = buildImportTemplateSheet('strategic-task', [{ parentIndicator: '' }])

    expect(sheet.rows[0].department).toBe('教务处')
  })

  it('序号/权重写数值型（2026-11-26 对齐样例）：单元格值为 number，行数据仍为字符串', () => {
    const sheet = buildImportTemplateSheet('strategic-task')
    const column = (header: string) => sheet.columns.find(item => item.header === header)!

    expect(sheet.rows.map((row, index) => column('序号').getValue(row, index))).toEqual([
      1, 2, 3, 4
    ])
    expect(
      sheet.rows.map((row, index) => column(WEIGHT_COLUMN_HEADER).getValue(row, index))
    ).toEqual([40, 30, 30, 100])
    // 行数据模型保持字符串（预填行权重留空 → 空串原样输出）
    expect(sheet.rows[0].serial).toBe('1')
    expect(sheet.rows[0].weight).toBe('40')

    const seeded = buildImportTemplateSheet('distribution', [
      { parentIndicator: '父级指标甲', college: '工学院' }
    ])
    const weightColumn = seeded.columns.find(item => item.header === WEIGHT_COLUMN_HEADER)!
    expect(weightColumn.getValue(seeded.rows[0], 0)).toBe('')
  })
})

describe('生成的 xlsx：合并区与样例一致（2026-11-26 序号/判组/合并语义修正）', () => {
  it('01：序号列无合并区；部门列按战略任务组分块（每块一格）；战略任务/任务类型按组合并', async () => {
    // 与样例 01 合并区逐区一致：B2:B4 / C2:C4 / D2:D4（第 5 行单行块/单行组不产生合并区）
    expect(await readSortedMergeRefs('strategic-task')).toEqual(['B2:B4', 'C2:C4', 'D2:D4'])
  })

  it('02：学院列/归口列跨两个核心指标组并成一块，任务类型/核心指标/核心指标类型按组合并，序号列无合并区', async () => {
    expect(await readSortedMergeRefs('distribution', 'single')).toEqual([
      'B2:B6',
      'C2:C6',
      'D2:D4',
      'D5:D6',
      'E2:E4',
      'E5:E6',
      'F2:F4',
      'F5:F6'
    ])
  })

  it('03：示例行合并区与样例 03 逐区一致（B2:B3 / C2:C3 / D2:D3 / E2:E3 / F2:F3）', async () => {
    expect(await readSortedMergeRefs('distribution', 'all')).toEqual([
      'B2:B3',
      'C2:C3',
      'D2:D3',
      'E2:E3',
      'F2:F3'
    ])
  })

  it('序号/权重单元格为数值型（无 t="s" 共享字符串标记），与样例一致', async () => {
    const sheetXml = await readDataSheetXml('strategic-task')
    const row2 = sheetXml.match(/<row r="2"[^>]*>[\s\S]*?<\/row>/)![0]

    // A2 序号、G2 权重为数值格；文本列为共享字符串
    expect(row2).toContain('<c r="A2"><v>1</v></c>')
    expect(row2).toContain('<c r="G2"><v>40</v></c>')
    expect(row2).toContain('<c r="B2" t="s">')
  })
})
