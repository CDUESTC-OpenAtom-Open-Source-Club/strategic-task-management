/**
 * 战略部直发学院指标 —— 前端权限口径纯函数单测（2026-11-05）。
 *
 * 覆盖三组判定：
 * 1. 分发页 / 战略任务页的「能不能操作」（一律按**真实登录角色**，不看视角角色）；
 * 2. 子指标归属可见性（战略部：本下发方 + 存量兼容；职能部门：口径零变化）；
 * 3. 学院「来源部门」筛选（筛选值与数据对不上时不过滤，避免整页滤空）。
 */
import { describe, expect, it } from 'vitest'
import {
  canOperateDistributionPage,
  canOperateStrategicTaskPage,
  canWithdrawDistributionPlan,
  canWriteDistributionPage,
  isDispatchOwnerVisible,
  isDistributionPageReadOnly,
  shouldApplyOwnerDeptFilter
} from '@/5-shared/lib/permissions/strategyDispatchAccess'

describe('strategyDispatchAccess · 分发页操作能力', () => {
  it('让战略部与职能部门都能进入分发页', () => {
    expect(canOperateDistributionPage('strategic_dept')).toBe(true)
    expect(canOperateDistributionPage('functional_dept')).toBe(true)
  })

  it('学院角色不能进入分发页', () => {
    expect(canOperateDistributionPage('secondary_college')).toBe(false)
    expect(canOperateDistributionPage(null)).toBe(false)
    expect(canOperateDistributionPage(undefined)).toBe(false)
  })

  it('分发页写操作只给战略部（职能部门只读）', () => {
    expect(canWriteDistributionPage('strategic_dept')).toBe(true)
    expect(canWriteDistributionPage('functional_dept')).toBe(false)
    expect(canWriteDistributionPage('secondary_college')).toBe(false)
  })

  it('撤回对职能部门保留（历史上发起的在审计划要能撤回）', () => {
    expect(canWithdrawDistributionPlan('strategic_dept')).toBe(true)
    expect(canWithdrawDistributionPlan('functional_dept')).toBe(true)
    expect(canWithdrawDistributionPlan('secondary_college')).toBe(false)
  })

  it('只读判定只认历史快照与角色，不认视角角色', () => {
    // 历史快照恒只读
    expect(isDistributionPageReadOnly({ loginRole: 'strategic_dept', timeReadOnly: true })).toBe(
      true
    )
    expect(isDistributionPageReadOnly({ loginRole: 'functional_dept', timeReadOnly: true })).toBe(
      true
    )
    // 正常年份：战略部/职能部门都可操作
    expect(isDistributionPageReadOnly({ loginRole: 'strategic_dept', timeReadOnly: false })).toBe(
      false
    )
    expect(isDistributionPageReadOnly({ loginRole: 'functional_dept', timeReadOnly: false })).toBe(
      false
    )
    // 其它角色保守只读
    expect(
      isDistributionPageReadOnly({ loginRole: 'secondary_college', timeReadOnly: false })
    ).toBe(true)
  })
})

describe('strategyDispatchAccess · 战略任务页操作能力', () => {
  it('只有战略部可写（职能部门只读）', () => {
    expect(canOperateStrategicTaskPage('strategic_dept')).toBe(true)
    expect(canOperateStrategicTaskPage('functional_dept')).toBe(false)
    expect(canOperateStrategicTaskPage('secondary_college')).toBe(false)
    expect(canOperateStrategicTaskPage(null)).toBe(false)
  })
})

describe('strategyDispatchAccess · 子指标归属可见性', () => {
  it('战略部登录可见全部（本下发方 + 存量兼容）', () => {
    expect(
      isDispatchOwnerVisible({ loginRole: 'strategic_dept', ownerMatchesCurrentDept: false })
    ).toBe(true)
    expect(
      isDispatchOwnerVisible({ loginRole: 'strategic_dept', ownerMatchesCurrentDept: true })
    ).toBe(true)
  })

  it('职能部门登录沿用改造前口径（零变化）', () => {
    expect(
      isDispatchOwnerVisible({ loginRole: 'functional_dept', ownerMatchesCurrentDept: true })
    ).toBe(true)
    expect(
      isDispatchOwnerVisible({ loginRole: 'functional_dept', ownerMatchesCurrentDept: false })
    ).toBe(false)
  })
})

describe('strategyDispatchAccess · 来源部门筛选', () => {
  it('筛选值为空时不过滤', () => {
    expect(shouldApplyOwnerDeptFilter({ filterOwnerDept: '', matchedCount: 0 })).toBe(false)
    expect(shouldApplyOwnerDeptFilter({ filterOwnerDept: '   ', matchedCount: 3 })).toBe(false)
  })

  it('筛选值命中数据时生效', () => {
    expect(shouldApplyOwnerDeptFilter({ filterOwnerDept: '战略发展部', matchedCount: 2 })).toBe(
      true
    )
  })

  it('筛选值与任何数据都对不上时不过滤（避免把学院指标全滤空）', () => {
    expect(shouldApplyOwnerDeptFilter({ filterOwnerDept: '战略发展部', matchedCount: 0 })).toBe(
      false
    )
  })
})
