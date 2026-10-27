import { describe, expect, it } from 'vitest'
import {
  buildWorkflowFocusCandidates,
  isInFlightWorkflowStatus,
  resolveWorkflowInstanceIndexLabel,
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

  it('只有一条候选时隐藏选择栏，多条时展示', () => {
    expect(shouldShowWorkflowInstanceSelector([])).toBe(false)
    expect(shouldShowWorkflowInstanceSelector([{}])).toBe(false)
    expect(shouldShowWorkflowInstanceSelector([{}, {}])).toBe(true)
  })

  it('序号统一从实例1开始', () => {
    expect(resolveWorkflowInstanceIndexLabel(0)).toBe('实例1')
    expect(resolveWorkflowInstanceIndexLabel(1)).toBe('实例2')
    expect(resolveWorkflowInstanceIndexLabel(2)).toBe('实例3')
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
