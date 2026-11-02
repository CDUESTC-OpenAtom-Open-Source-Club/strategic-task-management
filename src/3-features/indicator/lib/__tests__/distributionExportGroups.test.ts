import { describe, expect, it } from 'vitest'
import { buildDistributionExportRowGrouping } from '../distributionExportGroups'

describe('buildDistributionExportRowGrouping (2026-10-31 导出序号=父级核心指标组号定案)', () => {
  it('组号按父级核心指标首次出现顺序递增，组内多行共用一个组号', () => {
    const { groupNumberByIndex, spanByIndex } = buildDistributionExportRowGrouping([
      'P1',
      'P1',
      'P2',
      'P3',
      'P3'
    ])

    expect(groupNumberByIndex).toEqual([1, 1, 2, 3, 3])
    // 合并跨度：组首行带 rowSpan，从属行 0（格传 null），独占行 1
    expect(spanByIndex).toEqual([2, 0, 1, 2, 0])
  })

  it('同任务不串行：同一战略任务下的不同父级核心指标各自成组、组号不共享', () => {
    // 两条父级指标同属一个战略任务（键不同即不同组），绝不能因为任务相同而共用组号
    const { groupNumberByIndex } = buildDistributionExportRowGrouping(['P1', 'P2', 'P2'])

    expect(groupNumberByIndex).toEqual([1, 2, 2])
  })

  it('同一父级核心指标非相邻出现：组号一致但不跨组合并单元格', () => {
    const { groupNumberByIndex, spanByIndex } = buildDistributionExportRowGrouping([
      'P1',
      'P2',
      'P1'
    ])

    expect(groupNumberByIndex).toEqual([1, 2, 1])
    expect(spanByIndex).toEqual([1, 1, 1])
  })

  it('每行独占一组时组号逐行递增、无合并', () => {
    const { groupNumberByIndex, spanByIndex } = buildDistributionExportRowGrouping([
      'P1',
      'P2',
      'P3'
    ])

    expect(groupNumberByIndex).toEqual([1, 2, 3])
    expect(spanByIndex).toEqual([1, 1, 1])
  })

  it('空行集返回空分组', () => {
    expect(buildDistributionExportRowGrouping([])).toEqual({
      groupNumberByIndex: [],
      spanByIndex: []
    })
  })

  it('单行输入：组号 1、跨度 1', () => {
    const { groupNumberByIndex, spanByIndex } = buildDistributionExportRowGrouping(['P1'])

    expect(groupNumberByIndex).toEqual([1])
    expect(spanByIndex).toEqual([1])
  })
})
