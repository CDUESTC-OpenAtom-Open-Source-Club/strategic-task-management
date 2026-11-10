/**
 * /distribution 学院子指标「归口部门」口径单测（2026-11-10 归口可见性修复）。
 *
 * 锁住四条口径：
 * ① 归口职能部门视角能看到「本部门归口的战略部下发子指标」（学院卡片计数与展开表格同源）；
 * ② 职能部门存量行（职能部门创建）可见性逐字不变；战略部登录全量可见不回归；
 * ③ 父级缺失孤儿行退回 ownerDept 的兜底；
 * ④ 权重合计（下发方自有行口径）只算归口本部门（= 下发方）的行，写路径零变化。
 *
 * 判定逻辑与被测视图（useIndicatorDistributeView）共用同一份纯函数实现。
 */
import { describe, expect, it } from 'vitest'
import type { StrategicIndicator } from '@/shared/types'
import {
  resolveRowOwningDeptCore,
  resolveRowOwnerDept,
  STRATEGIC_DEPT_ROLE
} from '@/5-shared/lib/permissions/strategyDispatchAccess'
import {
  filterDispatchOwnedCollegeIndicators,
  groupDispatchCollegeChildIndicators,
  resolveDispatchRowOwningDept
} from '../distributeRowOwnership'

const normalizeDepartmentName = (value?: string | null): string => String(value ?? '').trim()

const createIndicator = (overrides: Partial<StrategicIndicator> = {}): StrategicIndicator =>
  ({
    id: 1,
    name: '测试子指标',
    taskContent: '战略任务A',
    responsibleDept: '计算机学院',
    ownerDept: '战略发展部',
    isStrategic: false,
    type1: '定量',
    type2: '基础指标',
    weight: 10,
    progress: 0,
    status: 'DISTRIBUTED',
    year: 2026,
    statusAudit: [],
    ...overrides
  }) as StrategicIndicator

// 场景基线（与链路实测一致）：
// - 核心指标 101：战略部 → 纪委办（归口部门）；102：战略部 → 教务处；
// - 201：战略部直发、归口纪委办、落计算机学院（修复前纪委办视角看不见）；
// - 202：战略部直发、归口教务处、落计算机学院（纪委办不应看见）；
// - 203：纪委办存量行；204：教务处存量行（存量口径零变化）；
// - 205：战略部直发孤儿行（父级 999 不在列表，落软件学院）。
const parentJiWei = createIndicator({
  id: 101,
  isStrategic: true,
  ownerDept: '战略发展部',
  responsibleDept: '纪委办'
})
const parentJiaoWu = createIndicator({
  id: 102,
  isStrategic: true,
  ownerDept: '战略发展部',
  responsibleDept: '教务处'
})
const strategyRowForJiWei = createIndicator({
  id: 201,
  ownerDept: '战略发展部',
  parentIndicatorId: 101,
  responsibleDept: '计算机学院',
  weight: 40
})
const strategyRowForJiaoWu = createIndicator({
  id: 202,
  ownerDept: '战略发展部',
  parentIndicatorId: 102,
  responsibleDept: '计算机学院',
  weight: 30
})
const legacyRowForJiWei = createIndicator({
  id: 203,
  ownerDept: '纪委办',
  parentIndicatorId: null,
  responsibleDept: '计算机学院',
  weight: 60
})
const legacyRowForJiaoWu = createIndicator({
  id: 204,
  ownerDept: '教务处',
  parentIndicatorId: null,
  responsibleDept: '计算机学院'
})
const orphanStrategyRow = createIndicator({
  id: 205,
  ownerDept: '战略发展部',
  parentIndicatorId: 999,
  responsibleDept: '软件学院'
})

const allIndicators = [
  parentJiWei,
  parentJiaoWu,
  strategyRowForJiWei,
  strategyRowForJiaoWu,
  legacyRowForJiWei,
  legacyRowForJiaoWu,
  orphanStrategyRow
]

const groupRows = (params: {
  loginRole: string | null | undefined
  currentDept: string
  indicators?: StrategicIndicator[]
}) =>
  groupDispatchCollegeChildIndicators({
    indicators: params.indicators ?? allIndicators,
    loginRole: params.loginRole,
    currentDept: params.currentDept,
    strategicDeptName: '战略发展部',
    normalizeDepartmentName
  })

describe('resolveRowOwningDeptCore（共享归属解析核心，登录无关）', () => {
  it('存量行（owner=职能部门）→ ownerDept 原样', () => {
    expect(
      resolveRowOwningDeptCore({
        strategicDeptName: '战略发展部',
        rowOwnerDept: '纪委办',
        parentTargetDept: '纪委办'
      })
    ).toBe('纪委办')
  })

  it('战略部自有行 → 父级核心指标的目标部门（归口职能部门）', () => {
    expect(
      resolveRowOwningDeptCore({
        strategicDeptName: '战略发展部',
        rowOwnerDept: '战略发展部',
        parentTargetDept: '纪委办'
      })
    ).toBe('纪委办')
  })

  it('父级目标部门解析不出（孤儿行）→ 退回 ownerDept 兜底', () => {
    expect(
      resolveRowOwningDeptCore({
        strategicDeptName: '战略发展部',
        rowOwnerDept: '战略发展部',
        parentTargetDept: ''
      })
    ).toBe('战略发展部')
  })

  it('两侧空白归一化后再比较', () => {
    expect(
      resolveRowOwningDeptCore({
        strategicDeptName: ' 战略发展部 ',
        rowOwnerDept: ' 战略发展部 ',
        parentTargetDept: ' 纪委办 '
      })
    ).toBe('纪委办')
  })
})

describe('resolveRowOwnerDept（战略任务页登录门控包装——行为保持不回归）', () => {
  it('职能部门登录 → ownerDept 原样返回（零变化，即使战略部自有行也不解析父级）', () => {
    expect(
      resolveRowOwnerDept({
        loginRole: 'functional_dept',
        strategicDeptName: '战略发展部',
        rowOwnerDept: '战略发展部',
        parentTargetDept: '纪委办'
      })
    ).toBe('战略发展部')
  })

  it('战略部登录 → 套用共享核心口径（存量原样 / 自有行取父级目标 / 孤儿退 owner）', () => {
    expect(
      resolveRowOwnerDept({
        loginRole: STRATEGIC_DEPT_ROLE,
        strategicDeptName: '战略发展部',
        rowOwnerDept: '纪委办',
        parentTargetDept: ''
      })
    ).toBe('纪委办')
    expect(
      resolveRowOwnerDept({
        loginRole: STRATEGIC_DEPT_ROLE,
        strategicDeptName: '战略发展部',
        rowOwnerDept: '战略发展部',
        parentTargetDept: '纪委办'
      })
    ).toBe('纪委办')
    expect(
      resolveRowOwnerDept({
        loginRole: STRATEGIC_DEPT_ROLE,
        strategicDeptName: '战略发展部',
        rowOwnerDept: '战略发展部',
        parentTargetDept: ''
      })
    ).toBe('战略发展部')
  })
})

describe('resolveDispatchRowOwningDept（/distribution 行归属口径）', () => {
  const resolveRow = (row: StrategicIndicator, indicators: StrategicIndicator[] = allIndicators) =>
    resolveDispatchRowOwningDept({
      row,
      indicators,
      strategicDeptName: '战略发展部',
      normalizeDepartmentName
    })

  it('存量行 → ownerDept 原样（部门别名归一化后）', () => {
    expect(resolveRow(legacyRowForJiWei)).toBe('纪委办')
  })

  it('战略部自有行 → 父级核心指标的归口部门（responsibleDept 优先）', () => {
    expect(resolveRow(strategyRowForJiWei)).toBe('纪委办')
    expect(resolveRow(strategyRowForJiaoWu)).toBe('教务处')
  })

  it('父级 responsibleDept 缺失时按 targetDepartment / targetOrgName 兜底', () => {
    const parent = createIndicator({
      id: 103,
      isStrategic: true,
      ownerDept: '战略发展部',
      responsibleDept: undefined,
      targetDepartment: '教务处'
    } as Partial<StrategicIndicator>)
    const row = createIndicator({ id: 206, parentIndicatorId: 103 })
    expect(resolveRow(row, [...allIndicators, parent])).toBe('教务处')

    const parentByOrgName = createIndicator({
      id: 104,
      isStrategic: true,
      ownerDept: '战略发展部',
      responsibleDept: undefined,
      targetDepartment: undefined,
      targetOrgName: '纪委办'
    } as Partial<StrategicIndicator>)
    const row2 = createIndicator({ id: 207, parentIndicatorId: 104 })
    expect(resolveRow(row2, [...allIndicators, parentByOrgName])).toBe('纪委办')
  })

  it('父级缺失 / 父级不在列表（孤儿行）→ 退回 ownerDept 兜底', () => {
    expect(resolveRow(orphanStrategyRow)).toBe('战略发展部')
    expect(
      resolveRow(createIndicator({ id: 208, ownerDept: '战略发展部', parentIndicatorId: null }))
    ).toBe('战略发展部')
  })
})

describe('groupDispatchCollegeChildIndicators（学院卡片计数 + 展开表格同一数据源）', () => {
  it('①归口职能部门（纪委办）视角：能看到归口本部门的战略部下发子指标（计数=表格）', () => {
    const grouped = groupRows({ loginRole: 'functional_dept', currentDept: '纪委办' })
    const collegeRows = grouped.get('计算机学院') ?? []
    // 归口纪委办的战略行 201 + 纪委办存量行 203
    expect(collegeRows.map(row => row.id)).toEqual([201, 203])
    expect(grouped.get('软件学院')).toBeUndefined()
  })

  it('①b归口职能部门视角：看不到归口其它部门的战略行与存量行', () => {
    const grouped = groupRows({ loginRole: 'functional_dept', currentDept: '纪委办' })
    const ids = (grouped.get('计算机学院') ?? []).map(row => row.id)
    expect(ids).not.toContain(202) // 战略部直发、归口教务处
    expect(ids).not.toContain(204) // 教务处存量
  })

  it('②职能部门存量行可见性逐字不变：本部门存量可见，他部门存量不可见', () => {
    const jiWeiGrouped = groupRows({ loginRole: 'functional_dept', currentDept: '纪委办' })
    expect((jiWeiGrouped.get('计算机学院') ?? []).map(row => row.id)).toContain(203)

    const jiaoWuGrouped = groupRows({ loginRole: 'functional_dept', currentDept: '教务处' })
    expect((jiaoWuGrouped.get('计算机学院') ?? []).map(row => row.id)).toEqual([202, 204])
  })

  it('②b战略部登录全量可见不回归（isDispatchOwnerVisible 放宽口径保持）', () => {
    const grouped = groupRows({ loginRole: 'strategic_dept', currentDept: '战略发展部' })
    expect((grouped.get('计算机学院') ?? []).map(row => row.id).sort()).toEqual([201, 202, 203, 204])
    expect((grouped.get('软件学院') ?? []).map(row => row.id)).toEqual([205])
  })

  it('③孤儿战略行（父级缺失）退回 ownerDept：归口部门视角不可见，战略部视角仍可见', () => {
    const jiWeiGrouped = groupRows({ loginRole: 'functional_dept', currentDept: '纪委办' })
    expect(jiWeiGrouped.get('软件学院')).toBeUndefined()

    const strategicGrouped = groupRows({ loginRole: 'strategic_dept', currentDept: '战略发展部' })
    expect((strategicGrouped.get('软件学院') ?? []).map(row => row.id)).toEqual([205])
  })

  it('职能部门视角部门为空时不显示任何行（与原 isSameDepartment 空串不匹配口径一致）', () => {
    const grouped = groupRows({ loginRole: 'functional_dept', currentDept: '' })
    expect(grouped.size).toBe(0)
  })

  it('战略指标本体（isStrategic）永不进入学院子指标分组', () => {
    const grouped = groupRows({ loginRole: 'strategic_dept', currentDept: '战略发展部' })
    const all = [...grouped.values()].flat()
    expect(all.some(row => row.isStrategic)).toBe(false)
  })
})

describe('filterDispatchOwnedCollegeIndicators（权重合计 / 写路径：下发方自有行口径）', () => {
  const filterRows = (params: {
    loginRole: string | null | undefined
    currentDept: string
    dispatchOwnerDept: string
    college?: string
    indicators?: StrategicIndicator[]
  }) =>
    filterDispatchOwnedCollegeIndicators({
      indicators: params.indicators ?? allIndicators,
      college: params.college ?? '计算机学院',
      loginRole: params.loginRole,
      currentDept: params.currentDept,
      dispatchOwnerDept: params.dispatchOwnerDept
    })

  it('④战略部登录：权重合计只算归口本部门（=下发方 战略发展部）的行，存量行不计入', () => {
    const rows = filterRows({
      loginRole: 'strategic_dept',
      currentDept: '战略发展部',
      dispatchOwnerDept: '战略发展部'
    })
    expect(rows.map(row => row.id).sort()).toEqual([201, 202])
    // 权重合计语义：40 + 30 = 70（存量 60 不并入，否则永远凑不满 100）
    expect(rows.reduce((sum, row) => sum + Number(row.weight || 0), 0)).toBe(70)
  })

  it('④b职能部门登录：只算本部门存量行；战略部直发行即使归口本部门也不计入（写路径零变化）', () => {
    const rows = filterRows({
      loginRole: 'functional_dept',
      currentDept: '纪委办',
      dispatchOwnerDept: '纪委办'
    })
    expect(rows.map(row => row.id)).toEqual([203])
    expect(rows.reduce((sum, row) => sum + Number(row.weight || 0), 0)).toBe(60)
  })

  it('④c其它部门（教务处）登录：只算教务处存量行', () => {
    const rows = filterRows({
      loginRole: 'functional_dept',
      currentDept: '教务处',
      dispatchOwnerDept: '教务处'
    })
    expect(rows.map(row => row.id)).toEqual([204])
  })

  it('④d学院维度过滤：其它学院的行不进入该学院权重', () => {
    const rows = filterRows({
      loginRole: 'strategic_dept',
      currentDept: '战略发展部',
      dispatchOwnerDept: '战略发展部',
      college: '软件学院'
    })
    expect(rows.map(row => row.id)).toEqual([205])
  })

  it('④e战略指标本体（isStrategic）永不参与权重合计', () => {
    const rows = filterRows({
      loginRole: 'strategic_dept',
      currentDept: '战略发展部',
      dispatchOwnerDept: '战略发展部',
      indicators: [parentJiWei, strategyRowForJiWei]
    })
    expect(rows.map(row => row.id)).toEqual([201])
  })
})
