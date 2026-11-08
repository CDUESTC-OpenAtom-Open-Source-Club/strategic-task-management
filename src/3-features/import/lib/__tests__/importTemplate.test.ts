import { describe, expect, it } from 'vitest'
import { buildImportTemplateSheet, getImportTemplateGuide } from '../importTemplate'

describe('getImportTemplateGuide 学院模板（2026-11-08 单层口径：无父级 + 归口职能部门）', () => {
  it('学院模板 8 列：不再有核心指标/核心指标类型，末尾是归口职能部门', () => {
    const guide = getImportTemplateGuide('distribution')

    expect(guide.columns.map(column => column.label)).toEqual([
      '序号',
      '学院',
      '任务类型',
      '指标名称',
      '指标类型',
      '权重（可填 10 / 10% / 0.1）',
      '下发备注',
      '归口职能部门'
    ])
  })

  it('学院模板合并口径：只有学院列整列合并（mergeAll），无任何随组列', () => {
    const guide = getImportTemplateGuide('distribution')

    expect(guide.columns.find(column => column.key === 'college')?.mergeAll).toBe(true)
    expect(guide.columns.find(column => column.key === 'college')?.mergeGroup).toBeFalsy()
    // 2026-11-08（单层口径）：没有「组」了，任务类型/序号都不再随组合并
    expect(guide.columns.find(column => column.key === 'taskType')?.mergeGroup).toBeFalsy()
    expect(guide.columns.find(column => column.key === 'serial')?.mergeGroup).toBeFalsy()
  })

  it('职能部门模板合并口径：部门列整列合并（mergeAll），战略任务/任务类型随组合并', () => {
    const guide = getImportTemplateGuide('strategic-task')

    expect(guide.columns.find(column => column.key === 'department')?.mergeAll).toBe(true)
    expect(guide.columns.find(column => column.key === 'department')?.mergeGroup).toBeFalsy()
    expect(guide.columns.find(column => column.key === 'strategicTask')?.mergeGroup).toBe(true)
    expect(guide.columns.find(column => column.key === 'taskType')?.mergeGroup).toBe(true)
  })
})

describe('buildImportTemplateSheet 学院模板（单层口径：无父级 + 学院整列合并）', () => {
  it('任务类型不再随组竖向合并：每行各自携带自己的任务类型', () => {
    const sheet = buildImportTemplateSheet('distribution')

    // 2026-11-08（单层口径）：学院模板的 3 条示例是独立指标，不再有「组」，
    // 序号/任务类型都不做组内合并
    expect(sheet.rows.length).toBe(3)
    const taskTypeColumn = sheet.columns[2]
    expect(taskTypeColumn.getValue(sheet.rows[0], 0)).toBe('基础性')
    expect(taskTypeColumn.getValue(sheet.rows[1], 1)).toBe('基础性')
    expect(taskTypeColumn.getValue(sheet.rows[2], 2)).toBe('发展性')
  })

  it('学院列整列合并：首行 rowSpan=全部数据行，其余行 null', () => {
    const sheet = buildImportTemplateSheet('distribution')

    const collegeColumn = sheet.columns[1]
    expect(collegeColumn.getValue(sheet.rows[0], 0)).toMatchObject({
      value: '计算机学院',
      rowSpan: 3
    })
    for (let index = 1; index < sheet.rows.length; index += 1) {
      expect(collegeColumn.getValue(sheet.rows[index], index)).toBeNull()
    }
  })

  it('单层口径：表头不含任何父级列，含「归口职能部门」', () => {
    const sheet = buildImportTemplateSheet('distribution')
    const headers = sheet.columns.map(column => column.header)

    expect(headers).not.toContain('核心指标')
    expect(headers).not.toContain('核心指标类型')
    expect(headers).toContain('归口职能部门')
    expect(headers).toContain('任务类型')
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

  it('表头列序保持 8 列不变（本轮不动职能部门模板列序）', () => {
    const sheet = buildImportTemplateSheet('strategic-task')

    expect(sheet.columns.map(column => column.header)).toEqual([
      '序号',
      '部门',
      '战略任务',
      '任务类型',
      '核心指标',
      '指标类型',
      '权重（可填 10 / 10% / 0.1）',
      '下发备注'
    ])
  })
})
