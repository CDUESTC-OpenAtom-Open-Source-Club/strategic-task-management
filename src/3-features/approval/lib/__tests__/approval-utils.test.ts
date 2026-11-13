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
  resolveInstanceRejectionComment,
  resolvePlanApprovalTypeLabel,
  resolvePlanConfirmWorkflowName,
  resolvePlanInstanceReferenceLabel,
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

  // 2026-11-12（审批弹窗用实例业务名）：确认弹窗优先展示实例业务名
  // （PLAN_REPORT 实例的 planName = plan_report.planName），
  // 「Plan 404457」式占位名/裸数字 ID 不外透，回退 buildPlanReferenceLabel 参考标签
  it('prefers the instance business name and falls back on placeholder names (2026-11-12 口径)', () => {
    const referenceLabel = '2026年度 计划（计算机学院 -> 战略发展部）'
    // 业务名优先：实例 planName 直接透出
    expect(
      resolvePlanInstanceReferenceLabel({
        instancePlanName: '2026年度 11月上报（计算机学院 -> 战略发展部）',
        fallbackPlanName: '',
        referenceLabel
      })
    ).toBe('2026年度 11月上报（计算机学院 -> 战略发展部）')
    // 实例名是「Plan 404457」占位时，次选 props.planName 业务名
    expect(
      resolvePlanInstanceReferenceLabel({
        instancePlanName: 'Plan 404457',
        fallbackPlanName: '教务处年度计划',
        referenceLabel
      })
    ).toBe('教务处年度计划')
    // 候选全缺或全是占位名（含裸数字 ID）：回退参考标签
    expect(
      resolvePlanInstanceReferenceLabel({
        instancePlanName: '',
        fallbackPlanName: '404457',
        referenceLabel
      })
    ).toBe(referenceLabel)
    expect(
      resolvePlanInstanceReferenceLabel({
        instancePlanName: 'Plan 404457',
        fallbackPlanName: '  ',
        referenceLabel
      })
    ).toBe(referenceLabel)
  })

  // 2026-11-12（HIGH② 审批抽屉「驳回原因」串实例修复）：实例自身 REJECTED
  // 步骤意见优先，PLAN 级 lastRejectReason 只作兜底——上报实例 #6 的抽屉
  // 不再串显下发实例 #3 的驳回意见（B2-部门上报驳回后收尾，截图 02d/04b）。
  // taskSources 顺序模拟两份 composable 接线（焦点/上报/异动/计划链按渲染优先级）。
  it('prefers the instance REJECTED step comment over the PLAN-level lastRejectReason (HIGH② 串实例修复)', () => {
    const planLevelReason = '组6部门上报驳回：台账佐证不足，退回审批人补充后再报'
    // 上报实例 #6：step3 被驳回，意见挂在实例自身步骤上
    const reportInstanceSteps = [
      { taskId: '601', stepNo: 1, status: 'APPROVED', comment: '同意' },
      { taskId: '602', stepNo: 2, status: 'APPROVED', comment: '通过' },
      {
        taskId: '603',
        stepNo: 3,
        status: 'REJECTED',
        comment: '台账佐证不足，请补充 11 月支出凭证后重新提交'
      }
    ]
    // ① 实例带 REJECTED 步骤 → 取该步骤 comment，绝不是 PLAN 级意见
    expect(
      resolveInstanceRejectionComment({
        taskSources: [reportInstanceSteps],
        fallbackReason: planLevelReason
      })
    ).toBe('台账佐证不足，请补充 11 月支出凭证后重新提交')
    // 多轮被拒（step1 与 step3 均 REJECTED）→ 取 step_no 最大的那条
    expect(
      resolveInstanceRejectionComment({
        taskSources: [
          [
            { taskId: '601', stepNo: 1, status: 'REJECTED', comment: '第一轮：附件缺失' },
            { taskId: '602', stepNo: 2, status: 'APPROVED', comment: '' },
            { taskId: '603', stepNo: 3, status: 'REJECTED', comment: '第三轮：台账佐证不足' }
          ]
        ],
        fallbackReason: planLevelReason
      })
    ).toBe('第三轮：台账佐证不足')
    // stepNo 平手看 taskId（与异动任务排序口径一致）
    expect(
      resolveInstanceRejectionComment({
        taskSources: [
          [
            { taskId: '711', stepNo: 2, status: 'REJECTED', comment: 'taskId 较小' },
            { taskId: '712', stepNo: 2, status: 'REJECTED', comment: 'taskId 较大' }
          ]
        ],
        fallbackReason: ''
      })
    ).toBe('taskId 较大')
    // REJECTED 步骤 comment 为空时不采纳，继续找同链其他 REJECTED 步骤
    expect(
      resolveInstanceRejectionComment({
        taskSources: [
          [
            { taskId: '601', stepNo: 3, status: 'REJECTED', comment: '   ' },
            { taskId: '600', stepNo: 1, status: 'REJECTED', comment: '附件缺失' }
          ]
        ],
        fallbackReason: planLevelReason
      })
    ).toBe('附件缺失')
    // 来源优先级：焦点实例链命中即停，不串看后续计划链
    expect(
      resolveInstanceRejectionComment({
        taskSources: [
          [{ taskId: '603', stepNo: 3, status: 'REJECTED', comment: '焦点实例自己的意见' }],
          [{ taskId: '303', stepNo: 3, status: 'REJECTED', comment: '下发链的意见' }]
        ],
        fallbackReason: planLevelReason
      })
    ).toBe('焦点实例自己的意见')
  })

  it('falls back to the PLAN-level lastRejectReason when the instance has no REJECTED step (HIGH② 回退口径)', () => {
    const planLevelReason = '组6部门上报驳回：台账佐证不足，退回审批人补充后再报'
    // ② 实例步骤全非 REJECTED（如审批中/已通过）→ 回退 PLAN 级
    expect(
      resolveInstanceRejectionComment({
        taskSources: [
          [
            { taskId: '601', stepNo: 1, status: 'APPROVED', comment: '同意' },
            { taskId: '602', stepNo: 2, status: 'PENDING', comment: '' }
          ]
        ],
        fallbackReason: planLevelReason
      })
    ).toBe(planLevelReason)
    // 实例步骤不可用（详情未加载/空链）→ 同样回退 PLAN 级（原行为）
    expect(
      resolveInstanceRejectionComment({
        taskSources: [[], null, undefined],
        fallbackReason: planLevelReason
      })
    ).toBe(planLevelReason)
    expect(resolveInstanceRejectionComment({ fallbackReason: planLevelReason })).toBe(
      planLevelReason
    )
    // 全链不可用且 PLAN 级为空 → 返回空串（调用方继续走指标级 statusAudit 兜底）
    expect(resolveInstanceRejectionComment({ taskSources: [[]], fallbackReason: '' })).toBe('')
    expect(resolveInstanceRejectionComment({})).toBe('')
  })

  // 2026-11-12（审批抽屉驳回原因汇总行上报场景修复）：后端快照服务只对
  // entity_type='PLAN' 填充 lastRejectReason → 上报场景 fallbackReason=null，
  // 汇总行旧绑定 activePlanWorkflow?.lastRejectReason 必为空 → 行隐藏。
  // rejectionReason 改绑后即使 fallback 不可用，实例自身 REJECTED 步骤意见仍能显示。
  it('resolves the report-instance REJECTED comment when the PLAN-level fallback is null (上报场景 fallback 不可用)', () => {
    // 上报实例（PLAN_REPORT）自身步骤带 REJECTED 意见，PLAN 级 lastRejectReason=null
    const reportInstanceSteps = [
      { taskId: '801', stepNo: 1, status: 'APPROVED', comment: '初审同意' },
      { taskId: '802', stepNo: 2, status: 'REJECTED', comment: '数据口径有误，请核对后重新上报' }
    ]
    expect(
      resolveInstanceRejectionComment({
        taskSources: [reportInstanceSteps],
        fallbackReason: null
      })
    ).toBe('数据口径有误，请核对后重新上报')
    // 对照：同场景若仍绑 PLAN 级 lastRejectReason（修复前口径）则无任何文案可取
    expect(resolveInstanceRejectionComment({ fallbackReason: null })).toBe('')
    expect(resolveInstanceRejectionComment({ taskSources: [[]], fallbackReason: null })).toBe('')
  })

  it('keeps the distribution-instance behavior intact (HIGH② 下发实例不回归)', () => {
    // ③ 下发实例（PLAN 分发链）自身被驳回：链上 REJECTED 步骤意见与
    // PLAN 级 lastRejectReason 同源，实例步骤优先取到同一文案
    const dispatchReason = '预算科目不符合口径，请调整后重新报送'
    const dispatchInstanceSteps = [
      { taskId: '301', stepNo: 1, status: 'APPROVED', comment: '初审通过' },
      { taskId: '302', stepNo: 2, status: 'PENDING', comment: '' },
      { taskId: '303', stepNo: 3, status: 'REJECTED', comment: dispatchReason }
    ]
    expect(
      resolveInstanceRejectionComment({
        taskSources: [dispatchInstanceSteps],
        fallbackReason: dispatchReason
      })
    ).toBe(dispatchReason)
    // 下发实例步骤不可用时仍回退 PLAN 级（修复前唯一路径，行为保持）
    expect(
      resolveInstanceRejectionComment({ taskSources: [null], fallbackReason: dispatchReason })
    ).toBe(dispatchReason)
    // PLAN 级意见为原始字符串原样返回（不做 trim/改写，兼容旧显示）
    expect(
      resolveInstanceRejectionComment({ taskSources: [[]], fallbackReason: '  保留原样  ' })
    ).toBe('  保留原样  ')
  })
})
