import { describe, expect, it } from 'vitest'
import {
  buildImportTemplateSheet,
  getImportTemplateGuide,
  type ImportTemplateParentSeed
} from '../importTemplate'

describe('getImportTemplateGuide 学院模板加「任务类型」列（2026-10-31 终版表头加列定案）', () => {
  it('学院模板 8 列：任务类型位于学院之后、核心指标之前（2026-11-11 起隐藏「下发备注」列）', () => {
    const guide = getImportTemplateGuide('distribution')

    expect(guide.columns.map(column => column.label)).toEqual([
      '序号',
      '学院',
      '任务类型',
      '核心指标',
      '核心指标类型',
      '子指标名称',
      '指标类型',
      '权重（可填 10 / 10% / 0.1）'
    ])
  })

  it('学院模板合并口径：学院列整列合并（mergeAll），任务类型随组合并（mergeGroup）', () => {
    const guide = getImportTemplateGuide('distribution')

    expect(guide.columns.find(column => column.key === 'college')?.mergeAll).toBe(true)
    expect(guide.columns.find(column => column.key === 'college')?.mergeGroup).toBeFalsy()
    expect(guide.columns.find(column => column.key === 'taskType')?.mergeGroup).toBe(true)
  })

  it('职能部门模板合并口径：部门列整列合并（mergeAll），战略任务/任务类型随组合并', () => {
    const guide = getImportTemplateGuide('strategic-task')

    expect(guide.columns.find(column => column.key === 'department')?.mergeAll).toBe(true)
    expect(guide.columns.find(column => column.key === 'department')?.mergeGroup).toBeFalsy()
    expect(guide.columns.find(column => column.key === 'strategicTask')?.mergeGroup).toBe(true)
    expect(guide.columns.find(column => column.key === 'taskType')?.mergeGroup).toBe(true)
  })
})

describe('buildImportTemplateSheet 学院模板（任务类型列 + 学院整列合并）', () => {
  it('任务类型随组竖向合并：组锚点 rowSpan=组行数、从属格 null', () => {
    const sheet = buildImportTemplateSheet('distribution')

    expect(sheet.rows.length).toBe(5)
    const taskTypeColumn = sheet.columns[2]
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

    const collegeColumn = sheet.columns[1]
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
      '权重（可填 10 / 10% / 0.1）'
    ])
  })
})
