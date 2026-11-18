import { describe, expect, it } from 'vitest'
import {
  buildCollegePlanLineSnapshots,
  mergeCollegeLineRows,
  resolveCollegeAggregateDispatchMonth,
  resolveCollegeLinePlanIdByFunctionalDept,
  resolveCollegePlanStatusSummary,
  type CollegeLineRowsRef
} from '../collegeMultiLineRowset'

describe('buildCollegePlanLineSnapshots', () => {
  it('两线均 DISTRIBUTED → 均可见，详情缓存字段优先于列表行', () => {
    const plans = [
      { id: 705542, status: 'DISTRIBUTED', dispatchMonth: '202603' },
      { id: 705543, status: 'DISTRIBUTED', dispatchMonth: '202602' }
    ]
    const snapshots = buildCollegePlanLineSnapshots(plans, {
      '705543': { id: 705543, status: 'DISTRIBUTED', dispatchMonth: '202605' }
    })
    expect(snapshots).toHaveLength(2)
    expect(snapshots[0]).toMatchObject({
      planId: '705542',
      status: 'DISTRIBUTED',
      visible: true,
      dispatchMonth: '202603'
    })
    // 详情缓存（planDetailsMap）的下发月覆盖列表行
    expect(snapshots[1].dispatchMonth).toBe('202605')
  })

  it('某线非 DISTRIBUTED（IN_REVIEW/PENDING/DRAFT）→ 该线不可见，行集须排除', () => {
    const snapshots = buildCollegePlanLineSnapshots([
      { id: 1, status: 'DISTRIBUTED' },
      { id: 2, status: 'IN_REVIEW' },
      { id: 3, status: 'PENDING' },
      { id: 4, status: 'DRAFT' },
      { id: 5, status: null }
    ])
    expect(snapshots.map(line => line.visible)).toEqual([true, false, false, false, false])
  })

  it('hasIndicatorContent：明细 indicators 非空或 indicatorCount>0 均算有内容', () => {
    const snapshots = buildCollegePlanLineSnapshots([
      { id: 1, status: 'DISTRIBUTED', indicators: [{ id: 2072 }, { id: 2073 }] },
      { id: 2, status: 'DISTRIBUTED', indicatorCount: 2 },
      { id: 3, status: 'DISTRIBUTED' }
    ])
    expect(snapshots.map(line => line.hasIndicatorContent)).toEqual([true, true, false])
  })
})

describe('mergeCollegeLineRows', () => {
  it('两线行合并：保持线先后顺序，4 条子指标都在', () => {
    const lineA = [
      { id: '2072', name: 'A1' },
      { id: '2073', name: 'A2' }
    ]
    const lineB = [
      { id: '2074', name: 'B1' },
      { id: '2075', name: 'B2' }
    ]
    const merged = mergeCollegeLineRows([lineA, lineB])
    expect(merged.map(row => row.id)).toEqual(['2072', '2073', '2074', '2075'])
  })

  it('跨线重复行 id 去重（保留首个/先出现线），空线跳过', () => {
    const lineA = [{ id: '2072', name: 'detail' }]
    const lineB = [
      { id: '2072', name: 'store-fallback' },
      { id: '2074', name: 'B1' }
    ]
    const merged = mergeCollegeLineRows([lineA, lineB, []])
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ id: '2072', name: 'detail' })
    expect(merged[1]).toMatchObject({ id: '2074', name: 'B1' })
  })
})

describe('resolveCollegeLinePlanIdByFunctionalDept', () => {
  interface Row {
    id: string
    parentIndicatorId?: string | null
  }
  const getRowDeptName = (row: Row): string | null => {
    if (row.parentIndicatorId === '2005') return '教务处'
    if (row.parentIndicatorId === '2029') return '数字校园建设办公室'
    return null
  }
  const lineRows: Array<CollegeLineRowsRef<Row>> = [
    {
      planId: '705542',
      rows: [
        { id: '2072', parentIndicatorId: '2005' },
        { id: '2073', parentIndicatorId: '2005' }
      ]
    },
    {
      planId: '705543',
      rows: [
        { id: '2074', parentIndicatorId: '2029' },
        { id: '2075', parentIndicatorId: '2029' }
      ]
    }
  ]

  it('选中教务处 → 绑定教务处线（705542）；选中数字校园 → 绑定 705543（行级归口透传基座）', () => {
    expect(resolveCollegeLinePlanIdByFunctionalDept(lineRows, '教务处', getRowDeptName)).toBe(
      '705542'
    )
    expect(
      resolveCollegeLinePlanIdByFunctionalDept(lineRows, '数字校园建设办公室', getRowDeptName)
    ).toBe('705543')
  })

  it('归口解析不出（父级未加载）→ null；未选部门 → null', () => {
    const orphanLines: Array<CollegeLineRowsRef<Row>> = [{ planId: '1', rows: [{ id: 'a' }] }]
    expect(
      resolveCollegeLinePlanIdByFunctionalDept(orphanLines, '教务处', getRowDeptName)
    ).toBeNull()
    expect(resolveCollegeLinePlanIdByFunctionalDept(lineRows, '', getRowDeptName)).toBeNull()
    expect(resolveCollegeLinePlanIdByFunctionalDept(lineRows, '   ', getRowDeptName)).toBeNull()
  })
})

describe('resolveCollegeAggregateDispatchMonth', () => {
  it('未选归口时取最早下发月', () => {
    expect(resolveCollegeAggregateDispatchMonth(['202605', '202603', '202611'])).toBe('202603')
  })

  it('非法/缺失月份被剔除，全不可得返回空串', () => {
    expect(resolveCollegeAggregateDispatchMonth(['', 'bad', null, '202604'])).toBe('202604')
    expect(resolveCollegeAggregateDispatchMonth([])).toBe('')
    expect(resolveCollegeAggregateDispatchMonth(['x', ''])).toBe('')
  })
})

describe('resolveCollegePlanStatusSummary', () => {
  it('两线同状态 → single；状态不同 → mixed；无线 → none', () => {
    expect(resolveCollegePlanStatusSummary(['DISTRIBUTED', 'DISTRIBUTED'])).toEqual({
      kind: 'single',
      status: 'DISTRIBUTED'
    })
    expect(resolveCollegePlanStatusSummary(['DISTRIBUTED', 'IN_REVIEW'])).toEqual({
      kind: 'mixed',
      status: null
    })
    expect(resolveCollegePlanStatusSummary([null, undefined, ''])).toEqual({
      kind: 'none',
      status: null
    })
  })
})
