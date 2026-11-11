/**
 * 2026-11-11（学院页签按钮体系修正）：学院页签「下发/撤回」按钮分流、
 * 上报互斥状态归一、异动门禁权重合计口径 —— 纯函数，实现与单测共用同一份逻辑
 * （collegeDispatchEligibility 同款模式）。
 *
 * <p>背景（链路实测 5 项缺陷中的 4 项都收敛到「学院页签取错职能部门口径」）：</p>
 * <ul>
 *   <li>高①：学院页签按钮文案读异动在审（「撤回异动」），点击却恒走「发起下发审批」
 *       确认框 —— 同框实锤（2026-11-11 C1-20）；误确认还会触发后端英文报错。</li>
 *   <li>高②：学院下发计划审批中（IN_REVIEW）时按钮恒显示发起类文案 —— 相位读的是
 *       职能部门自身计划（planUiPhase → currentPlan），学院子计划的真「撤回」不可达。</li>
 *   <li>阻断 D-01：学院页签异动门禁权重读 departmentTotalWeight（职能部门集合），
 *       头部显示学院合计 100、点「发起异动」却按职能部门集合算出 90 被拦。</li>
 *   <li>阻断 D-02：学院子指标的上报互斥读了职能部门口径的上报摘要（跨部门串台误锁）。</li>
 * </ul>
 */

/** 学院页签「下发/撤回」按钮的点击动作（组件按 action 分流执行体） */
export type CollegeTabDistributeAction =
  /** 学院子计划草稿/未解析 → 发起下发审批（既有流程） */
  | 'submit-dispatch'
  /** 学院下发审批在审 → 真撤回（撤回后计划回草稿、审批实例撤回） */
  | 'withdraw-dispatch'
  /** 异动审批在审且当前用户可撤 → 撤回异动（整批退回填报人节点） */
  | 'withdraw-mutation'
  /** 学院计划已下发 → 无可撤回动作（引导查看审批） */
  | 'distributed-locked'

export interface CollegeTabDistributeButtonInput {
  /** 异动审批在审且当前用户为发起人（未过撤回窗口）——model 的 canWithdrawMutationInFlight */
  canWithdrawMutationInFlight: boolean
  /** 学院子计划原始状态（IN_REVIEW / PENDING / DRAFT / DISTRIBUTED / 未知 / null） */
  collegePlanStatus: unknown
}

export interface CollegeTabDistributeButtonDecision {
  action: CollegeTabDistributeAction
  text: string
  buttonType: 'success' | 'warning' | 'info'
}

/**
 * 学院页签按钮分流（文案/类型/动作三要素同源，杜绝「文案一套、点击另一套」）。
 *
 * <p>分流优先级：</p>
 * <ol>
 *   <li>异动在审且可撤 → 「撤回异动」（warning）——与职能页签 P-05 多态撤回同口径，
 *       优先于一切计划相位（高①的根因就是文案读这条、点击却落发起分支）；</li>
 *   <li>学院子计划审批中（PENDING/IN_REVIEW/SUBMITTED/PENDING_REVIEW）→ 「撤回」（warning）
 *       —— 真撤回下发审批（高②：此前恒显示发起类文案，撤回不可达）；</li>
 *   <li>学院子计划已下发（DISTRIBUTED/APPROVED/PUBLISHED/ACTIVE）→ 「撤回」（info）
 *       —— 无可撤动作，点击引导查看审批（与职能页签 distributed 相位的置灰口径一致）；</li>
 *   <li>其余（DRAFT / 未知 / 子计划未解析）→ 「发起审批」（success）
 *       —— 子计划未解析时由点击侧提示「还没有可提交审批的下发计划」（行为不变）。</li>
 * </ol>
 */
export const resolveCollegeTabDistributeAction = (
  input: CollegeTabDistributeButtonInput
): CollegeTabDistributeButtonDecision => {
  if (input.canWithdrawMutationInFlight) {
    return { action: 'withdraw-mutation', text: '撤回异动', buttonType: 'warning' }
  }

  const status = String(input.collegePlanStatus ?? '')
    .trim()
    .toUpperCase()
  if (['PENDING', 'IN_REVIEW', 'PENDING_REVIEW', 'PENDING_APPROVAL', 'SUBMITTED'].includes(status)) {
    return { action: 'withdraw-dispatch', text: '撤回', buttonType: 'warning' }
  }
  if (['DISTRIBUTED', 'APPROVED', 'PUBLISHED', 'ACTIVE'].includes(status)) {
    return { action: 'distributed-locked', text: '撤回', buttonType: 'info' }
  }
  return { action: 'submit-dispatch', text: '发起审批', buttonType: 'success' }
}

/** 上报审批「在途」状态集（P-24 互斥口径：含退回态 RETURNED，审批结束态不在内） */
export const REPORT_APPROVAL_IN_FLIGHT_STATUSES: readonly string[] = [
  'PENDING',
  'IN_REVIEW',
  'SUBMITTED',
  'RETURNED'
]

/**
 * 上报审批状态是否「在途」（互斥锁判定单元）。
 * 归一（去空格 + 大写）后落在在途状态集内即视为在审。
 */
export const isReportApprovalStatusInFlight = (status: unknown): boolean => {
  const normalized = String(status ?? '')
    .trim()
    .toUpperCase()
  return REPORT_APPROVAL_IN_FLIGHT_STATUSES.includes(normalized)
}

export interface MutationGateWeightTotalInput {
  /** 学院计划上下文是否激活（学院页签 + 已选学院） */
  collegeScopeActive: boolean
  /** 学院子指标集合（当前归口筛选行集）的基础性权重合计 */
  collegeBasicWeightTotal: number
  /** 职能部门口径的基础性权重合计（职能部门页签原口径） */
  departmentTotalWeight: number
}

/**
 * 「发起异动」权重门禁合计：按当前页签的指标集合同源取数（阻断 D-01）。
 *
 * <p>学院页签必须读学院子指标集合合计（collegeBasicWeightTotal —— 与头部
 * 「基础性权重合计」同一数据源 collegeTableIndicators，含异动草稿应用后的内存态），
 * 不得误用职能部门口径的 departmentTotalWeight（两集合不同源，学院 100 / 部门 90
 * 的错位拦截就是这么来的）。职能部门页签口径原样保留（零回归）。</p>
 */
export const resolveMutationGateWeightTotal = (input: MutationGateWeightTotalInput): number =>
  input.collegeScopeActive ? input.collegeBasicWeightTotal : input.departmentTotalWeight
