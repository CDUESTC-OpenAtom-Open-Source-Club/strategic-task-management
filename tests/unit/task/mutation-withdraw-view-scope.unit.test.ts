import { describe, expect, it } from 'vitest'
import { resolveViewScopedMutationPendingApprovals } from '@/features/task/lib/collegeTabDistribute'

/**
 * 2026-11-15（撤回异动按钮全局显示回归修复）：「撤回异动」判定/批次归组清单的
 * 视角收口契约。
 *
 * <p>缺陷（线上实测）：a7f4173 把主清单与链下学院追回清单**无条件合并**进
 * canWithdrawMutationInFlight —— 链下追回清单聚合的是下发链上全部学院的在审批次
 * （loader 逐学院查询，与当前视角无关），发起人对任一学院的在审批次都会把标志在
 * 所有部门/学院视角点亮 →「撤回异动」按钮全局显示（无任何异动的部门也显示）。</p>
 *
 * <p>收口口径（resolveViewScopedMutationPendingApprovals，与 model 消费方共用）：</p>
 * <ul>
 *   <li>职能页签：只读主清单（后端已按选中部门查询，视角隔离）——当前部门无批次时，
 *       即使全局其他学院有在审批次也不得点亮；</li>
 *   <li>学院页签：两份清单合并后按 targetOrgId = 选中学院收口——只有该学院的批次
 *       保留（a7f4173 的发起人撤回入口不回退），其他学院的批次不点亮当前视角；</li>
 *   <li>学院上下文但学院 org 解析失败 → 空清单（宁可隐藏，不误显示）。</li>
 * </ul>
 */

/** 条目工厂：targetOrgId + submitterName（形状与 mutation-approvals 映射对齐） */
const entry = (targetOrgId: number | null, submitterName = '战略发展部填报人1') => ({
  targetOrgId,
  submitterName,
  currentStepName: '职能部门审批人审批',
  instanceId: Math.floor(Math.random() * 100000) + 1
})

describe('resolveViewScopedMutationPendingApprovals（撤回异动清单视角收口）', () => {
  const mainList = [entry(41), entry(null)] // 职能部门自身批次（target 可能是部门 org 或空）
  const chainList = [entry(51), entry(52), entry(53)] // 学院 A/B/C 的在审批次

  it('职能页签：只读主清单——链清单里的其他学院批次不得并入（全局批次不点亮部门视角）', () => {
    const scoped = resolveViewScopedMutationPendingApprovals({
      isCollegeScopeActive: false,
      collegeOrgId: null,
      mainEntries: mainList,
      chainEntries: chainList
    })
    expect(scoped).toEqual(mainList)
    expect(scoped.some(e => Number(e.targetOrgId) === 51)).toBe(false)
  })

  it('当前视角无在审批次（主清单为空）→ 收口清单为空 → 消费方判定 false（按钮不显示）', () => {
    // 线上报的场景：战略部选「党委组织部」（无任何异动），链清单却有其他学院批次
    const scoped = resolveViewScopedMutationPendingApprovals({
      isCollegeScopeActive: false,
      collegeOrgId: null,
      mainEntries: [],
      chainEntries: chainList
    })
    expect(scoped).toEqual([])
    expect(scoped.length === 0).toBe(true) // canWithdrawMutationInFlight 的 length===0 短路
  })

  it('学院页签选中学院 A：主/链清单中 targetOrgId=A 的批次保留，其他学院批次排除', () => {
    const scoped = resolveViewScopedMutationPendingApprovals({
      isCollegeScopeActive: true,
      collegeOrgId: 51,
      mainEntries: [entry(51), entry(41)],
      chainEntries: [entry(51), entry(52), entry(53)]
    })
    expect(scoped).toHaveLength(2)
    expect(scoped.every(e => Number(e.targetOrgId) === 51)).toBe(true)
  })

  it('a7f4173 修复目标不回退：学院子指标异动（主清单 owner 侧命中，target=学院）在学院页签保留', () => {
    const scoped = resolveViewScopedMutationPendingApprovals({
      isCollegeScopeActive: true,
      collegeOrgId: 51,
      mainEntries: [entry(51)], // 战略部发起、target=学院 A 的批次（主清单 owner=35 命中）
      chainEntries: []
    })
    expect(scoped).toHaveLength(1)
  })

  it('targetOrgId 数字/字符串归一（Number 比对，与后端原始返回形状解耦）', () => {
    const scoped = resolveViewScopedMutationPendingApprovals({
      isCollegeScopeActive: true,
      collegeOrgId: 51,
      mainEntries: [],
      chainEntries: [{ targetOrgId: '51' }, { targetOrgId: 52 }]
    })
    expect(scoped).toHaveLength(1)
    expect(Number(scoped[0].targetOrgId)).toBe(51)
  })

  it('学院上下文但学院 org 解析失败（null / 非法）→ 空清单（宁可隐藏，不误显示）', () => {
    expect(
      resolveViewScopedMutationPendingApprovals({
        isCollegeScopeActive: true,
        collegeOrgId: null,
        mainEntries: mainList,
        chainEntries: chainList
      })
    ).toEqual([])

    expect(
      resolveViewScopedMutationPendingApprovals({
        isCollegeScopeActive: true,
        collegeOrgId: Number.NaN,
        mainEntries: mainList,
        chainEntries: chainList
      })
    ).toEqual([])
  })
})
