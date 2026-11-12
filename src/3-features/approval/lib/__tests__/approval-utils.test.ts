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
  resolvePlanConfirmWorkflowName,
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
    // 2026-11-10 学院下发专用流程按 PLAN_DISPATCH_ 前缀归入下发族（非上报族）
    expect(isDistributionFlow('PLAN_DISPATCH_COLLEGE')).toBe(true)
    expect(isSubmissionFlow('PLAN_DISPATCH_COLLEGE')).toBe(false)
  })

  it('labels approval type by real flow code (2026-09-27 口径)', () => {
    expect(resolvePlanApprovalTypeLabel('PLAN_DISPATCH_STRATEGY')).toBe('下发审批')
    expect(resolvePlanApprovalTypeLabel('PLAN_DISPATCH_FUNCDEPT')).toBe('下发审批')
    // 学院下发新流程码沿用下发语义（与 PLAN_DISPATCH_STRATEGY 同族展示）
    expect(resolvePlanApprovalTypeLabel('PLAN_DISPATCH_COLLEGE')).toBe('下发审批')
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
    expect(showAppraisalLevelForFlow('PLAN_DISPATCH_COLLEGE')).toBe(false)
    expect(showAppraisalLevelForFlow('PLAN_MUTATION_STRATEGY')).toBe(false)
    // flowCode 未知时保守显示，维持老数据行为
    expect(showAppraisalLevelForFlow('')).toBe(true)
    expect(showAppraisalLevelForFlow(undefined)).toBe(true)
  })

  it('builds route titles from workflow context', () => {
    // 2026-11-12（D-3 统一口径）：后端已按上报方向返回 source/target
    // （source=提交方，target=审批方），上报卡直接 source -> target，不再翻转
    expect(
      resolveApprovalRouteTitle({
        flowCode: 'PLAN_APPROVAL_COLLEGE',
        sourceOrgName: '计算机学院',
        targetOrgName: '战略发展部'
      })
    ).toBe('上报审批 · 计算机学院 -> 战略发展部')

    expect(
      resolveApprovalRouteTitle({
        flowCode: 'PLAN_DISPATCH_FUNCTIONAL',
        sourceOrgName: '战略发展部',
        targetOrgName: '教务处'
      })
    ).toBe('下发审批 · 战略发展部 -> 教务处')

    // 学院下发新流程码：下发方向展示（发起方=战略发展部 → 目标学院）
    expect(
      resolveApprovalRouteTitle({
        flowCode: 'PLAN_DISPATCH_COLLEGE',
        sourceOrgName: '战略发展部',
        targetOrgName: '计算机学院'
      })
    ).toBe('下发审批 · 战略发展部 -> 计算机学院')

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

  // 2026-10-31 用户拍板（确认弹窗审批流程行）：按 flowCode 映射完整中文流程名，
  // 绝不透出后端 workflowName 的「Plan xxx」英文占位；缺 code 兜底「计划下发审批」
  it('maps confirm-dialog workflow names to full Chinese labels (2026-10-31 口径)', () => {
    expect(resolvePlanConfirmWorkflowName('PLAN_DISPATCH_STRATEGY')).toBe('计划下发审批')
    expect(resolvePlanConfirmWorkflowName('PLAN_DISPATCH_FUNCDEPT')).toBe('计划下发审批')
    expect(resolvePlanConfirmWorkflowName('PLAN_DISPATCH_COLLEGE')).toBe('计划下发审批')
    expect(resolvePlanConfirmWorkflowName('PLAN_MUTATION_STRATEGY')).toBe('计划异动审批')
    expect(resolvePlanConfirmWorkflowName('PLAN_APPROVAL_FUNCDEPT')).toBe('计划上报审批')
    expect(resolvePlanConfirmWorkflowName('PLAN_APPROVAL_COLLEGE')).toBe('计划上报审批')
    // 缺 code 时按弹窗主场景（下发链）兜底，同样不出现英文
    expect(resolvePlanConfirmWorkflowName('')).toBe('计划下发审批')
    expect(resolvePlanConfirmWorkflowName(undefined)).toBe('计划下发审批')
    expect(resolvePlanConfirmWorkflowName('CUSTOM_FLOW')).toBe('计划下发审批')
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

  // 2026-11-12（D-3 统一口径）：后端已按上报方向返回 source/target
  // （source=提交方，target=审批方），上报链不再翻转、直接 source -> target；
  // 下发/异动维持原样
  it('keeps source -> target for submission flows (D-3 统一口径：上报不翻转、下发原样)', () => {
    // 上报链确认弹窗参考标签：提交方（source）在前，审批方（target）在后
    expect(
      buildPlanReferenceLabel({
        year: 2026,
        sourceOrgName: '计算机学院',
        targetOrgName: '战略发展部'
      })
    ).toBe('2026年度 计划（计算机学院 -> 战略发展部）')
    expect(
      buildPlanReferenceLabel({
        sourceOrgName: '计算机学院',
        targetOrgName: '教务处'
      })
    ).toBe('计划（计算机学院 -> 教务处）')
    // 上报链路由标题同样不翻转
    expect(
      resolveApprovalRouteTitle({
        flowCode: 'PLAN_APPROVAL_FUNCDEPT',
        sourceOrgName: '计算机学院',
        targetOrgName: '教务处'
      })
    ).toBe('上报审批 · 计算机学院 -> 教务处')
    // 下发链维持原方向（source=下发方 -> target=接收方）
    expect(
      buildPlanReferenceLabel({
        year: 2026,
        sourceOrgName: '战略发展部',
        targetOrgName: '科技处'
      })
    ).toBe('2026年度 计划（战略发展部 -> 科技处）')
    expect(
      resolveApprovalRouteTitle({
        flowCode: 'PLAN_DISPATCH_STRATEGY',
        sourceOrgName: '战略发展部',
        targetOrgName: '科技处'
      })
    ).toBe('下发审批 · 战略发展部 -> 科技处')
    // 异动链维持原方向
    expect(
      buildPlanReferenceLabel({
        sourceOrgName: '战略发展部',
        targetOrgName: '计算机学院'
      })
    ).toBe('计划（战略发展部 -> 计算机学院）')
    // 上报链单侧流向：只显示那一侧
    expect(
      buildPlanReferenceLabel({
        sourceOrgName: '计算机学院'
      })
    ).toBe('计划（计算机学院）')
  })
})
