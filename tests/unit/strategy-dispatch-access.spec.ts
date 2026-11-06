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
  canWithdrawDispatchPlan,
  canWithdrawDistributionPlan,
  canWriteDispatchOwnedRow,
  canWriteDistributionPage,
  isDispatchOwnerVisible,
  isDistributionPageReadOnly,
  resolveRowOwnerDept,
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

// ---------------------------------------------------------------------------
// 2026-11-05（codex PR 审查 R1/R2/R5）：可见性放宽后，写闸门与作用域必须同步收紧。
// 这三条是本次改造的系统性风险点，单独成组以免被后续改动无声破坏。
// ---------------------------------------------------------------------------

describe('strategyDispatchAccess · 行级写闸门（R1 / codex P1-1）', () => {
  it('战略部只能写本次下发方（战略发展部）自己的行', () => {
    expect(
      canWriteDispatchOwnedRow({
        loginRole: 'strategic_dept',
        rowOwnerDept: '战略发展部',
        dispatchOwnerDept: '战略发展部'
      })
    ).toBe(true)
  })

  it('战略部不能改写/删除职能部门 owner 的存量行（需求4：存量只读历史）', () => {
    expect(
      canWriteDispatchOwnedRow({
        loginRole: 'strategic_dept',
        rowOwnerDept: '继续教育部',
        dispatchOwnerDept: '战略发展部'
      })
    ).toBe(false)
  })

  it('职能部门登录时口径与改造前等价（归属部门 == 当前部门即可写）', () => {
    expect(
      canWriteDispatchOwnedRow({
        loginRole: 'functional_dept',
        rowOwnerDept: '继续教育部',
        dispatchOwnerDept: '继续教育部'
      })
    ).toBe(true)
    expect(
      canWriteDispatchOwnedRow({
        loginRole: 'functional_dept',
        rowOwnerDept: '计算机学院',
        dispatchOwnerDept: '继续教育部'
      })
    ).toBe(false)
  })

  it('归属部门缺失时保守拒绝写入', () => {
    expect(
      canWriteDispatchOwnedRow({
        loginRole: 'strategic_dept',
        rowOwnerDept: '',
        dispatchOwnerDept: '战略发展部'
      })
    ).toBe(false)
    expect(
      canWriteDispatchOwnedRow({
        loginRole: 'functional_dept',
        rowOwnerDept: '继续教育部',
        dispatchOwnerDept: ''
      })
    ).toBe(false)
  })
})

describe('strategyDispatchAccess · 撤回闸门（R5 / codex P1-2）', () => {
  it('战略部无 ROLE_REPORTER 也能撤回自己刚提交的下发（否则审批卡死）', () => {
    expect(canWithdrawDispatchPlan({ loginRole: 'strategic_dept', isReporter: false })).toBe(true)
  })

  it('职能部门仍必须持 ROLE_REPORTER 才能撤回（行为零变化）', () => {
    expect(canWithdrawDispatchPlan({ loginRole: 'functional_dept', isReporter: false })).toBe(false)
    expect(canWithdrawDispatchPlan({ loginRole: 'functional_dept', isReporter: true })).toBe(true)
  })
})

describe('strategyDispatchAccess · 学院 tab 归属部门（R2 / codex P2-5）', () => {
  it('存量行归属其 owner 职能部门', () => {
    expect(
      resolveRowOwnerDept({
        loginRole: 'strategic_dept',
        strategicDeptName: '战略发展部',
        rowOwnerDept: '继续教育部',
        parentTargetDept: '计算机学院'
      })
    ).toBe('继续教育部')
  })

  it('战略部自有行归属其父级核心指标的目标部门', () => {
    expect(
      resolveRowOwnerDept({
        loginRole: 'strategic_dept',
        strategicDeptName: '战略发展部',
        rowOwnerDept: '战略发展部',
        parentTargetDept: '继续教育部'
      })
    ).toBe('继续教育部')
  })

  it('父级缺失时退回 owner（不误杀）', () => {
    expect(
      resolveRowOwnerDept({
        loginRole: 'strategic_dept',
        strategicDeptName: '战略发展部',
        rowOwnerDept: '战略发展部',
        parentTargetDept: ''
      })
    ).toBe('战略发展部')
  })

  it('职能部门登录时原样返回 owner（零变化）', () => {
    expect(
      resolveRowOwnerDept({
        loginRole: 'functional_dept',
        strategicDeptName: '战略发展部',
        rowOwnerDept: '继续教育部',
        parentTargetDept: '计算机学院'
      })
    ).toBe('继续教育部')
  })
})
