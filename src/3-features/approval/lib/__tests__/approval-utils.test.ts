import { describe, expect, it } from 'vitest'
import {
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
    expect(resolveHistoryStatusTag('rejected')).toEqual({ label: '已驳回', type: 'danger' })
    expect(resolveHistoryStatusTag('submitted')).toEqual({ label: '审批中', type: 'warning' })
    expect(resolveHistoryStatusTag(undefined)).toEqual({ label: '未知', type: 'info' })
    expect(isTerminalHistoryStatus('approved')).toBe(true)
    expect(isTerminalHistoryStatus('withdrawn')).toBe(false)
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
})
