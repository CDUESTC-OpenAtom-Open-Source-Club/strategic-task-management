import { describe, expect, it } from 'vitest'
import {
  buildWorkflowFocusCandidates,
  isInFlightWorkflowStatus,
  shouldShowWorkflowInstanceSelector
} from '../workflowFocusCandidates'

describe('workflowFocusCandidates', () => {
  // 2026-10-27 用户定案：选择栏只承载「当前正在审批的实例」，
  // 已完成（已通过/已驳回/已撤回）的实例归审批历史，不出现在这里
  it('计划已下发（不在审批中）时，计划自身不进选择栏', () => {
    const candidates = buildWorkflowFocusCandidates({
      isPlanPending: false,
      planLabel: '人力资源部计划',
      reports: [],
      mutations: []
    })
    expect(candidates).toEqual([])
    expect(candidates.some(item => item.kind === 'plan')).toBe(false)
  })

  it('计划仍在审批中时，计划自身作为一条候选', () => {
    const candidates = buildWorkflowFocusCandidates({
      isPlanPending: true,
      planLabel: '人力资源部计划',
      reports: [],
      mutations: []
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0].kind).toBe('plan')
    expect(candidates[0].label).toBe('人力资源部计划')
  })

  it('进行中的上报与异动各占一条候选', () => {
    const candidates = buildWorkflowFocusCandidates({
      isPlanPending: true,
      planLabel: '教务处计划',
      reports: [{ instanceId: 11, label: '上报审批 · 航空学院 -> 教务处', step: '学院审核人审批' }],
      mutations: [{ instanceId: 12, label: '指标异动审批 · 战略发展部 -> 教务处' }]
    })
    expect(candidates.map(item => item.kind)).toEqual(['plan', 'report', 'mutation'])
    expect(candidates[1].instanceId).toBe(11)
    expect(candidates[1].step).toBe('学院审核人审批')
    expect(candidates[2].instanceId).toBe(12)
  })

  it('缺少实例号的条目被跳过（无实例无法点开）', () => {
    const candidates = buildWorkflowFocusCandidates({
      isPlanPending: false,
      planLabel: '教务处计划',
      reports: [{ instanceId: '', label: '无实例上报' }],
      mutations: []
    })
    expect(candidates).toEqual([])
  })

  // 2026-10-30 用户定案：退回待重报的异动活链（未终结）同样进选择栏——
  // 流程没结束前不得在审批中心消失
  it('有退回待重报活链时，作为一条候选出现（returned: 前缀 key）', () => {
    const candidates = buildWorkflowFocusCandidates({
      isPlanPending: false,
      planLabel: '教务处计划',
      returnedMutations: [
        { instanceId: 21, label: '异动审批 · 战略发展部 -> 教务处', step: '退回待重报' }
      ]
    })
    expect(candidates).toHaveLength(1)
    expect(candidates[0].kind).toBe('mutation')
    expect(candidates[0].key).toBe('returned:21')
    expect(candidates[0].instanceId).toBe(21)
    expect(candidates[0].step).toBe('退回待重报')
  })

  it('无退回链时不产生 returned 候选', () => {
    const candidates = buildWorkflowFocusCandidates({
      isPlanPending: false,
      planLabel: '教务处计划'
    })
    expect(candidates).toEqual([])
    expect(candidates.some(item => item.key.startsWith('returned:'))).toBe(false)
  })

  it('退回链与在审实例共存：key 不冲突、各占一条候选', () => {
    const candidates = buildWorkflowFocusCandidates({
      isPlanPending: true,
      planLabel: '教务处计划',
      mutations: [
        { instanceId: 30, label: '异动审批 · 战略发展部 -> 教务处', step: '战略发展部审批' }
      ],
      returnedMutations: [
        { instanceId: 30, label: '异动审批 · 教务处 -> 学院', step: '退回待重报' }
      ]
    })
    expect(candidates.map(item => item.key)).toEqual(['plan:current', 'mutation:30', 'returned:30'])
    expect(candidates.filter(item => item.kind === 'mutation')).toHaveLength(2)
  })

  it('只有一条候选时隐藏选择栏，多条时展示', () => {
    expect(shouldShowWorkflowInstanceSelector([])).toBe(false)
    expect(shouldShowWorkflowInstanceSelector([{}])).toBe(false)
    expect(shouldShowWorkflowInstanceSelector([{}, {}])).toBe(true)
  })

  // 2026-10-30 用户定案：选择栏去掉「实例N」编号前缀，计划候选标签由调用方
  // 拼好方向标题（{审批类型} · source -> target）经 planLabel 传入，builder 原样透传
  it('计划候选标签原样透传调用方给的标题（方向标题或计划名回退）', () => {
    const withRouteTitle = buildWorkflowFocusCandidates({
      isPlanPending: true,
      planLabel: '下发审批 · 战略发展部 -> 教务处'
    })
    expect(withRouteTitle[0].key).toBe('plan:current')
    expect(withRouteTitle[0].label).toBe('下发审批 · 战略发展部 -> 教务处')

    const withPlanNameFallback = buildWorkflowFocusCandidates({
      isPlanPending: true,
      planLabel: '教务处计划',
      departmentName: '教务处'
    })
    expect(withPlanNameFallback[0].label).toBe('教务处计划')
  })

  it('在审状态判定：已完成状态不算在审', () => {
    expect(isInFlightWorkflowStatus('PENDING')).toBe(true)
    expect(isInFlightWorkflowStatus('IN_REVIEW')).toBe(true)
    expect(isInFlightWorkflowStatus('submitted')).toBe(true)
    expect(isInFlightWorkflowStatus('APPROVED')).toBe(false)
    expect(isInFlightWorkflowStatus('REJECTED')).toBe(false)
    expect(isInFlightWorkflowStatus('WITHDRAWN')).toBe(false)
    expect(isInFlightWorkflowStatus('')).toBe(false)
  })
})
