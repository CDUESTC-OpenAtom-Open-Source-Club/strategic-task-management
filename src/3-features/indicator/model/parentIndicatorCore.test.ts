/**
 * 2026-11-25（看板来源归属修复）：任务来源归组键纯函数单测。
 * 口径：学院承接任务的来源部门 = 归口职能部门（父级核心指标 targetOrg）；
 * ownerDept（战略发展部代发通道）仅作父级解析失败时的兜底。
 */
import { describe, expect, it } from 'vitest'
import { resolveTaskSourceDept, type ParentIndicatorCore } from './parentIndicatorCore'

const makeParent = (overrides: Partial<ParentIndicatorCore> = {}): ParentIndicatorCore => ({
  name: '核心指标A',
  ...overrides
})

describe('resolveTaskSourceDept（看板任务来源归组键）', () => {
  it('父级 targetOrgName 存在时优先归口部门（战略部代发不算来源）', () => {
    const item = { ownerDept: '战略发展部', parentIndicatorId: '2005' }
    const map = { '2005': makeParent({ targetOrgName: '教务处' }) }
    expect(resolveTaskSourceDept(item, map)).toBe('教务处')
  })

  it('父级缺失时回退 ownerDept（旧行为兜底，老数据不消失）', () => {
    const item = { ownerDept: '战略发展部', parentIndicatorId: '9999' }
    expect(resolveTaskSourceDept(item, {})).toBe('战略发展部')
  })

  it('父级存在但归口名解析不出时回退 ownerDept', () => {
    const item = { ownerDept: '战略发展部', parentIndicatorId: '2005' }
    const map = { '2005': makeParent({ targetOrgName: '  ' }) }
    expect(resolveTaskSourceDept(item, map)).toBe('战略发展部')
  })

  it('父级与 ownerDept 都缺失时归「其他」', () => {
    expect(resolveTaskSourceDept({ ownerDept: '', parentIndicatorId: null }, {})).toBe('其他')
    expect(resolveTaskSourceDept({ ownerDept: undefined, parentIndicatorId: '' }, {})).toBe('其他')
  })

  it('item 为 null 时归「其他」（不抛错）', () => {
    expect(resolveTaskSourceDept(null, {})).toBe('其他')
  })

  it('parentIndicatorId 为数字类型时同样命中父级归口', () => {
    const item = { ownerDept: '战略发展部', parentIndicatorId: 2042 }
    const map = { '2042': makeParent({ targetOrgName: '教务处' }) }
    expect(resolveTaskSourceDept(item, map)).toBe('教务处')
  })

  it('id 带空白时按 trim 后命中', () => {
    const item = { ownerDept: '战略发展部', parentIndicatorId: ' 2005 ' }
    const map = { '2005': makeParent({ targetOrgName: '教务处' }) }
    expect(resolveTaskSourceDept(item, map)).toBe('教务处')
  })

  it('看板聚合场景：两条航空学院线（父级 2005/2042）都归教务处', () => {
    const map = {
      '2005': makeParent({ targetOrgName: '教务处' }),
      '2042': makeParent({ targetOrgName: '教务处' })
    }
    const rowsWithPid = [
      { ownerDept: '战略发展部', parentIndicatorId: '2005' },
      { ownerDept: '战略发展部', parentIndicatorId: '2042' }
    ]
    const grouped = new Map<string, number>()
    rowsWithPid.forEach(i => {
      const key = resolveTaskSourceDept(i, map)
      grouped.set(key, (grouped.get(key) || 0) + 1)
    })
    expect(grouped.get('教务处')).toBe(2)
    expect(grouped.size).toBe(1)
  })

  it('不同归口分行展示（教务处 + 学工部）', () => {
    const map = {
      '2005': makeParent({ targetOrgName: '教务处' }),
      '3001': makeParent({ targetOrgName: '学工部' })
    }
    const grouped = new Map<string, number>()
    ;[
      { ownerDept: '战略发展部', parentIndicatorId: '2005' },
      { ownerDept: '战略发展部', parentIndicatorId: '3001' },
      { ownerDept: '战略发展部', parentIndicatorId: '2005' }
    ].forEach(i => {
      const key = resolveTaskSourceDept(i, map)
      grouped.set(key, (grouped.get(key) || 0) + 1)
    })
    expect(grouped.get('教务处')).toBe(2)
    expect(grouped.get('学工部')).toBe(1)
  })
})
