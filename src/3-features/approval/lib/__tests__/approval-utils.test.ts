import { describe, expect, it } from 'vitest'
import {
  buildPlanReferenceLabel,
  isDistributionFlow,
  isSubmissionFlow,
  isTerminalHistoryStatus,
  normalizeDisplayName,
  normalizeWorkflowAction,
  normalizeWorkflowCode,
  parsePositiveUserId,
  resolveApprovalRouteTitle,
  resolveHistoryStatusTag,
  resolvePlanApprovalTypeLabel,
  shouldDisplayWorkflowHistoryItem,
  showAppraisalLevelForFlow,
  toPositiveNumber
} from '../approval-utils'

describe('approval-utils', () => {
  it('normalizes display names and workflow codes', () => {
    expect(normalizeDisplayName('  战略发展部  ')).toBe('战略发展部')
    expect(normalizeDisplayName(null)).toBe('')
    expect(normalizeWorkflowCode('  plan_approval_college  ')).toBe('PLAN_APPROVAL_COLLEGE')
  })

  it('parses positive identifiers safely', () => {
    expect(parsePositiveUserId('12')).toBe(12)
    expect(parsePositiveUserId(0)).toBeNull()
    expect(parsePositiveUserId('abc')).toBeNull()
    expect(toPositiveNumber('18')).toBe(18)
    expect(toPositiveNumber(-1)).toBeNull()
  })

  it('recognizes workflow families', () => {
    expect(isSubmissionFlow('PLAN_APPROVAL_COLLEGE')).toBe(true)
    expect(isSubmissionFlow('PLAN_DISPATCH_FUNCTIONAL')).toBe(false)
    expect(isDistributionFlow('PLAN_DISPATCH_FUNCTIONAL')).toBe(true)
    expect(isDistributionFlow('OTHER_FLOW')).toBe(false)
  })

  it('labels approval type by real flow code (2026-09-27 口径)', () => {
    expect(resolvePlanApprovalTypeLabel('PLAN_DISPATCH_STRATEGY')).toBe('下发审批')
    expect(resolvePlanApprovalTypeLabel('PLAN_DISPATCH_FUNCDEPT')).toBe('下发审批')
    expect(resolvePlanApprovalTypeLabel('PLAN_APPROVAL_FUNCDEPT')).toBe('上报审批')
    expect(resolvePlanApprovalTypeLabel('PLAN_APPROVAL_COLLEGE')).toBe('上报审批')
    expect(resolvePlanApprovalTypeLabel('PLAN_MUTATION_STRATEGY')).toBe('异动审批')
    expect(resolvePlanApprovalTypeLabel('')).toBe('上报审批')
    expect(resolvePlanApprovalTypeLabel(undefined)).toBe('上报审批')
  })

  it('shows appraisal level select only on submission flows', () => {
    expect(showAppraisalLevelForFlow('PLAN_APPROVAL_FUNCDEPT')).toBe(true)
    expect(showAppraisalLevelForFlow('plan_approval_college')).toBe(true)
    expect(showAppraisalLevelForFlow('PLAN_DISPATCH_STRATEGY')).toBe(false)
    expect(showAppraisalLevelForFlow('PLAN_MUTATION_STRATEGY')).toBe(false)
    // flowCode 未知时保守显示，维持老数据行为
    expect(showAppraisalLevelForFlow('')).toBe(true)
    expect(showAppraisalLevelForFlow(undefined)).toBe(true)
  })

  it('builds route titles from workflow context', () => {
    expect(
      resolveApprovalRouteTitle({
        flowCode: 'PLAN_APPROVAL_COLLEGE',
        sourceOrgName: '战略发展部',
        targetOrgName: '计算机学院'
      })
    ).toBe('上报审批 · 计算机学院 -> 战略发展部')

    expect(
      resolveApprovalRouteTitle({
        flowCode: 'PLAN_DISPATCH_FUNCTIONAL',
        sourceOrgName: '战略发展部',
        targetOrgName: '教务处'
      })
    ).toBe('下发审批 · 战略发展部 -> 教务处')

    expect(
      resolveApprovalRouteTitle({
        flowCode: 'CUSTOM_FLOW',
        sourceOrgName: '',
        targetOrgName: ''
      })
    ).toBe('CUSTOM_FLOW')
  })

  it('maps workflow history statuses consistently', () => {
    expect(resolveHistoryStatusTag('APPROVED')).toEqual({ label: '已通过', type: 'success' })
    expect(resolveHistoryStatusTag('rejected')).toEqual({ label: '已回退', type: 'danger' })
    expect(resolveHistoryStatusTag('submitted')).toEqual({ label: '审批中', type: 'warning' })
    expect(resolveHistoryStatusTag(undefined)).toEqual({ label: '未知', type: 'info' })
    expect(isTerminalHistoryStatus('approved')).toBe(true)
    expect(isTerminalHistoryStatus('withdrawn')).toBe(false)
  })

  // 2026-10-30（取消闭环）：取消异动终态与已通过同归审批历史，标签单列「已取消」
  it('treats CANCELLED (取消异动) as a terminal history status with its own tag', () => {
    expect(resolveHistoryStatusTag('CANCELLED')).toEqual({ label: '已取消', type: 'info' })
    expect(resolveHistoryStatusTag('cancelled')).toEqual({ label: '已取消', type: 'info' })
    expect(isTerminalHistoryStatus('CANCELLED')).toBe(true)
  })

  it('normalizes workflow history actions for display', () => {
    expect(normalizeWorkflowAction('reject_task')).toBe('reject')
    expect(normalizeWorkflowAction('cancel_process')).toBe('withdraw')
    expect(normalizeWorkflowAction('submit_form')).toBe('submit')
    expect(normalizeWorkflowAction('approve_task')).toBe('approve')
    expect(shouldDisplayWorkflowHistoryItem({ action: 'START_PROCESS' })).toBe(false)
    expect(shouldDisplayWorkflowHistoryItem({ action: 'APPROVE_TASK' })).toBe(true)
    expect(shouldDisplayWorkflowHistoryItem(undefined)).toBe(true)
  })

  // 2026-10-31 用户定案（确认弹窗去计划编号）：以「年份 + 方向」指代计划，
  // 绝不把「Plan 404457」式占位计划名/裸数字 ID 拼进确认弹窗
  it('builds year+route plan reference labels for confirm dialogs (2026-10-31 口径)', () => {
    // 年份 + 双向齐全：标准口径
    expect(
      buildPlanReferenceLabel({ year: 2026, sourceOrgName: '战略发展部', targetOrgName: '科技处' })
    ).toBe('2026年度 计划（战略发展部 -> 科技处）')
    // 年份是字符串数字（计划对象里可能以 string 存 year）同样可用
    expect(
      buildPlanReferenceLabel({
        year: '2026',
        sourceOrgName: '教务处',
        targetOrgName: '计算机学院'
      })
    ).toBe('2026年度 计划（教务处 -> 计算机学院）')
    // 取得到的字段略写：无年份
    expect(buildPlanReferenceLabel({ sourceOrgName: '教务处', targetOrgName: '计算机学院' })).toBe(
      '计划（教务处 -> 计算机学院）'
    )
    // 只有单侧流向：只写那一侧
    expect(buildPlanReferenceLabel({ year: 2026, targetOrgName: '科技处' })).toBe(
      '2026年度 计划（科技处）'
    )
    // 全缺：回退 fallback，不输出裸「计划」
    expect(buildPlanReferenceLabel({ fallback: '当前计划' })).toBe('当前计划')
    expect(
      buildPlanReferenceLabel({ year: 'abc', sourceOrgName: '  ', fallback: '当前计划' })
    ).toBe('当前计划')
  })
})
