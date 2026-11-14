import { describe, expect, it } from 'vitest'
import {
  aggregateFunctionalDeptOptions,
  filterRowsByFunctionalDept,
  normalizeFunctionalDeptSelection,
  reportMatchesFunctionalOrg,
  resolveFunctionalOrgIdForContext,
  resolveParentFunctionalDeptName,
  resolveParentFunctionalOrgId,
  resolveSelectedFunctionalDeptOption,
  type ParentFunctionalBrief
} from '../functionalDeptScope'

/** 构造父级归口摘要（后端 IndicatorResponse.targetOrgId/targetOrgName 口径） */
const parent = (targetOrgId: number, targetOrgName: string): ParentFunctionalBrief => ({
  targetOrgId,
  targetOrgName
})

/** 行构造器：pid=父级核心指标 ID；parents 模拟 parentIndicatorMap（父级异步缓存） */
const makeRows = (
  items: Array<{ id: number; pid?: number }>,
  parents: Record<number, ParentFunctionalBrief>
) =>
  items.map(item => ({
    id: item.id,
    parentIndicatorId: item.pid,
    getParent: () => (item.pid ? (parents[item.pid] ?? null) : null)
  }))

describe('resolveParentFunctionalDeptName / resolveParentFunctionalOrgId（2026-11-13 归属部门口径）', () => {
  it('优先 targetOrgName（后端权威字段）；缺失时按 responsibleDept → targetDepartment 兜底', () => {
    expect(resolveParentFunctionalDeptName(parent(5, '纪委办公室 | 监察处'))).toBe(
      '纪委办公室 | 监察处'
    )
    expect(resolveParentFunctionalDeptName({ responsibleDept: '教务处' })).toBe('教务处')
    expect(resolveParentFunctionalDeptName({ targetDepartment: '学工部' })).toBe('学工部')
    expect(resolveParentFunctionalDeptName({ targetOrgName: '  ' })).toBeNull()
    expect(resolveParentFunctionalDeptName(null)).toBeNull()
  })

  it('orgId 仅接受正整数 targetOrgId；缺失/非法返回 null（不能作为提交上下文）', () => {
    expect(resolveParentFunctionalOrgId(parent(5, '纪委办公室 | 监察处'))).toBe(5)
    expect(resolveParentFunctionalOrgId({ targetOrgId: '7' })).toBe(7)
    expect(resolveParentFunctionalOrgId({ targetOrgId: 0 })).toBeNull()
    expect(resolveParentFunctionalOrgId({ targetOrgName: '教务处' })).toBeNull()
    expect(resolveParentFunctionalOrgId(null)).toBeNull()
  })
})

describe('aggregateFunctionalDeptOptions（选项聚合）', () => {
  const parents: Record<number, ParentFunctionalBrief> = {
    101: parent(5, '纪委办公室 | 监察处'),
    102: parent(6, '教务处'),
    103: parent(5, '纪委办公室 | 监察处')
  }

  it('多部门行集 → 多个选项；按名称 zh-CN 排序（纪 ji < 教 jiao）', () => {
    const rows = makeRows(
      [
        { id: 1, pid: 102 },
        { id: 2, pid: 101 },
        { id: 3, pid: 103 }
      ],
      parents
    )
    const options = aggregateFunctionalDeptOptions(rows, row => row.getParent())
    expect(options.map(option => option.name)).toEqual(['纪委办公室 | 监察处', '教务处'])
    expect(options.find(option => option.name === '纪委办公室 | 监察处')?.orgId).toBe(5)
    expect(options.find(option => option.name === '教务处')?.orgId).toBe(6)
  })

  it('同部门多行去重为一个选项（orgId 取第一个非空）', () => {
    const rows = makeRows(
      [
        { id: 1, pid: 101 },
        { id: 2, pid: 103 }
      ],
      parents
    )
    const options = aggregateFunctionalDeptOptions(rows, row => row.getParent())
    expect(options).toHaveLength(1)
    expect(options[0]).toEqual({ name: '纪委办公室 | 监察处', orgId: 5 })
  })

  it('父级缺失/未加载完成的行不产生选项；全缺 → 空数组（UI 自动隐藏）', () => {
    const rows = makeRows([{ id: 1 }, { id: 2, pid: 999 }], parents)
    expect(aggregateFunctionalDeptOptions(rows, row => row.getParent())).toEqual([])
  })

  it('部门名齐全但 orgId 缺失时仍出选项（orgId=null，由调用方决定是否可提交）', () => {
    const rows = makeRows([{ id: 1, pid: 201 }], {
      201: { targetOrgName: '学工部' }
    })
    expect(aggregateFunctionalDeptOptions(rows, row => row.getParent())).toEqual([
      { name: '学工部', orgId: null }
    ])
  })
})

describe('filterRowsByFunctionalDept（选部门过滤 + 守卫语义）', () => {
  const parents: Record<number, ParentFunctionalBrief> = {
    101: parent(5, '纪委办公室 | 监察处'),
    102: parent(6, '教务处')
  }
  const rows = makeRows(
    [{ id: 1, pid: 101 }, { id: 2, pid: 102 }, { id: 3 }, { id: 4, pid: 101 }],
    parents
  )
  const deptName = (row: (typeof rows)[number]) =>
    row.getParent() ? row.getParent()!.targetOrgName! : null

  it('未选部门（空串）→ 不过滤，返回全部行', () => {
    expect(filterRowsByFunctionalDept(rows, '', deptName)).toHaveLength(4)
  })

  it('选中部门 → 只留该部门行；归口未加载完成的行（null）保留不误删', () => {
    const filtered = filterRowsByFunctionalDept(rows, '纪委办公室 | 监察处', deptName)
    expect(filtered.map(row => row.id)).toEqual([1, 3, 4])
  })

  it('整页零命中（父级全没加载/选中项失效）→ 不过滤整页（筛不对不过滤守卫）', () => {
    const unloaded = makeRows([{ id: 1 }, { id: 2 }], parents)
    expect(filterRowsByFunctionalDept(unloaded, '教务处', row => null)).toEqual(unloaded)
  })
})

describe('reportMatchesFunctionalOrg（报告-归口匹配，旧/新后端兼容）', () => {
  it('调用方未选部门（null/undefined）→ 恒匹配（聚合口径，旧行为）', () => {
    expect(reportMatchesFunctionalOrg({ functionalOrgId: 5 }, undefined)).toBe(true)
    expect(reportMatchesFunctionalOrg({ functionalOrgId: null }, null)).toBe(true)
    expect(reportMatchesFunctionalOrg({}, undefined)).toBe(true)
  })

  it('旧后端哨兵：报告无 functionalOrgId 字段（undefined）→ 视为匹配（退回聚合口径）', () => {
    expect(reportMatchesFunctionalOrg({}, 5)).toBe(true)
  })

  it('新后端：精确匹配；null（历史遗留报告）与所选部门不匹配', () => {
    expect(reportMatchesFunctionalOrg({ functionalOrgId: 5 }, 5)).toBe(true)
    expect(reportMatchesFunctionalOrg({ functionalOrgId: 6 }, 5)).toBe(false)
    expect(reportMatchesFunctionalOrg({ functionalOrgId: null }, 5)).toBe(false)
  })
})

// 2026-11-13 白屏修复：el-select clearable 点叉叉清空时 Element Plus 默认 emit
// undefined（valueOnClear 默认值），直落 ref 会让下游 .trim() 渲染期抛
// TypeError → 整页白屏。本组用例覆盖「叉叉清空 → 回初始态」全链路纯逻辑。
describe('归属部门叉叉清空链路（2026-11-13 白屏修复）', () => {
  const options = [
    { name: '纪委办公室 | 监察处', orgId: 5 },
    { name: '教务处', orgId: 6 }
  ]
  const parents: Record<number, ParentFunctionalBrief> = {
    101: parent(5, '纪委办公室 | 监察处'),
    102: parent(6, '教务处')
  }
  const rows = makeRows(
    [
      { id: 1, pid: 101 },
      { id: 2, pid: 102 }
    ],
    parents
  )
  const deptName = (row: (typeof rows)[number]) => row.getParent()?.targetOrgName ?? null

  it('normalizeFunctionalDeptSelection：叉叉清空的 undefined/null → ""（未选态），不抛', () => {
    expect(() => normalizeFunctionalDeptSelection(undefined)).not.toThrow()
    expect(normalizeFunctionalDeptSelection(undefined)).toBe('')
    expect(normalizeFunctionalDeptSelection(null)).toBe('')
    expect(normalizeFunctionalDeptSelection('')).toBe('')
    expect(normalizeFunctionalDeptSelection('  纪委办公室 | 监察处  ')).toBe('纪委办公室 | 监察处')
  })

  it('清空后：resolveSelectedFunctionalDeptOption → null、resolveFunctionalOrgIdForContext → undefined（不抛）', () => {
    const clearedName = normalizeFunctionalDeptSelection(undefined)
    const selected = resolveSelectedFunctionalDeptOption(options, clearedName)
    expect(selected).toBeNull()
    expect(() => resolveFunctionalOrgIdForContext(selected)).not.toThrow()
    expect(resolveFunctionalOrgIdForContext(selected)).toBeUndefined()
    expect(resolveFunctionalOrgIdForContext(null)).toBeUndefined()
    // 父级缺失的选项（orgId=null）同样回 undefined（聚合口径），不抛
    expect(resolveFunctionalOrgIdForContext({ name: '学工部', orgId: null })).toBeUndefined()
  })

  it('清空后行级过滤恢复全部（filterRowsByFunctionalDept 空串 → 原列表）', () => {
    const clearedName = normalizeFunctionalDeptSelection(undefined)
    expect(filterRowsByFunctionalDept(rows, clearedName, deptName)).toHaveLength(2)
    expect(filterRowsByFunctionalDept(rows, clearedName, deptName)).toEqual(rows)
  })

  it('清空后重新选中：名称 → 选项命中，orgId 回到提交上下文（清空后再选正常）', () => {
    const selected = resolveSelectedFunctionalDeptOption(options, '纪委办公室 | 监察处')
    expect(selected).toEqual({ name: '纪委办公室 | 监察处', orgId: 5 })
    expect(resolveFunctionalOrgIdForContext(selected)).toBe(5)
  })

  it('选中项失效（选项集中无此部门）→ null（未选态），orgId 回 undefined 不抛', () => {
    const stale = resolveSelectedFunctionalDeptOption(options, '已下线的部门')
    expect(stale).toBeNull()
    expect(resolveFunctionalOrgIdForContext(stale)).toBeUndefined()
  })
})
