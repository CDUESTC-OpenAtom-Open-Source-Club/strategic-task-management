import { describe, expect, it } from 'vitest'
import {
  buildImportTemplateSheet,
  getImportTemplateGuide,
  type ImportTemplateParentSeed,
  WEIGHT_COLUMN_HEADER
} from '../importTemplate'

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

  it('学院模板合并口径：学院列整列合并（mergeAll），任务类型随组合并（mergeGroup）', () => {
    const guide = getImportTemplateGuide('distribution')

    expect(guide.columns.find(column => column.key === 'college')?.mergeAll).toBe(true)
    expect(guide.columns.find(column => column.key === 'college')?.mergeGroup).toBeFalsy()
    expect(guide.columns.find(column => column.key === 'taskType')?.mergeGroup).toBe(true)
  })

  it('学院模板序号列（2026-11-26 序号语义改造）：不再随组合并、不再标必填（可选，留空自动补号）', () => {
    const guide = getImportTemplateGuide('distribution')

    const serialColumn = guide.columns.find(column => column.key === 'serial')!
    expect(serialColumn.mergeGroup).toBeFalsy()
    expect(serialColumn.required).toBeFalsy()
    expect(serialColumn.label).toBe('序号')
  })

  it('学院模板填写说明（2026-11-26 序号语义改造）：序号=子指标行号语义，删除旧组号表述', () => {
    const rules = getImportTemplateGuide('distribution').rules.join('\n')

    // 新语义：每行一号、建议连续、留空自动补号、归属按核心指标列
    expect(rules).toContain('「序号」为子指标行号')
    expect(rules).toContain('留空也可以导入，系统会自动按行补号')
    expect(rules).toContain('归属按「核心指标」列判定')
    // 旧文案删除：序号不再表述为父级核心指标组号
    expect(rules).not.toContain('「序号」为父级核心指标')
    expect(rules).not.toContain('组号：按 1、2、3… 顺序给每个父级核心指标编号')
  })

  it('职能部门模板合并口径：部门列整列合并（mergeAll），战略任务/任务类型随组合并', () => {
    const guide = getImportTemplateGuide('strategic-task')

    expect(guide.columns.find(column => column.key === 'department')?.mergeAll).toBe(true)
    expect(guide.columns.find(column => column.key === 'department')?.mergeGroup).toBeFalsy()
    expect(guide.columns.find(column => column.key === 'strategicTask')?.mergeGroup).toBe(true)
    expect(guide.columns.find(column => column.key === 'taskType')?.mergeGroup).toBe(true)
  })

  it('职能部门模板序号列不变（2026-11-26 改造不涉及 01）：仍随组合并、仍必填（组号语义）', () => {
    const guide = getImportTemplateGuide('strategic-task')

    const serialColumn = guide.columns.find(column => column.key === 'serial')!
    expect(serialColumn.mergeGroup).toBe(true)
    expect(serialColumn.required).toBe(true)
  })
})

describe('buildImportTemplateSheet 序号逐行递增（2026-11-26 学院导入序号语义改造）', () => {
  it('示例行序号逐行递增 1..N：每行一号、不再留空、不再按组合并', () => {
    const sheet = buildImportTemplateSheet('distribution')

    expect(sheet.rows.map(row => row.serial)).toEqual(['1', '2', '3', '4', '5'])
    // 序号列每行显示各自号码（mergeGroup 已移除：无 rowSpan、无 null 从属格）
    const serialColumn = sheet.columns.find(column => column.header === '序号')!
    const serialValues = sheet.rows.map((row, index) => serialColumn.getValue(row, index))
    expect(serialValues).toEqual(['1', '2', '3', '4', '5'])
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

describe('buildImportTemplateSheet 学院模板（任务类型列 + 学院整列合并）', () => {
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

  it('学院列整列合并：首行 rowSpan=全部数据行，其余行 null', () => {
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

describe('buildImportTemplateSheet 职能部门模板（部门列整列合并）', () => {
  it('部门列整列合并：首行 rowSpan=全部数据行，其余行 null', () => {
    const sheet = buildImportTemplateSheet('strategic-task')

    expect(sheet.rows.length).toBe(7)
    const departmentColumn = sheet.columns[1]
    expect(departmentColumn.getValue(sheet.rows[0], 0)).toMatchObject({
      value: '教务处',
      rowSpan: 7
    })
    for (let index = 1; index < sheet.rows.length; index += 1) {
      expect(departmentColumn.getValue(sheet.rows[index], index)).toBeNull()
    }
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
    expect(sheet.rows.length).toBe(7)
    expect(sheet.rows[0].department).toBe('党委学工部 | 学生工作处')
    expect(sheet.rows[0].strategicTask).toBe('推进本科教育教学改革')

    const departmentColumn = sheet.columns.find(column => column.header === '部门')!
    expect(departmentColumn.getValue(sheet.rows[0], 0)).toMatchObject({
      value: '党委学工部 | 学生工作处',
      rowSpan: 7
    })
  })

  it('未传目标部门时部门列仍回退示例值（旧调用点不受影响）', () => {
    const sheet = buildImportTemplateSheet('strategic-task', [{ parentIndicator: '' }])

    expect(sheet.rows[0].department).toBe('教务处')
  })
})
