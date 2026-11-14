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
  /** 学院子计划审批中 → 真撤回（撤回后计划回草稿、审批实例撤回） */
  | 'withdraw-dispatch'
  /** 异动审批在审且当前用户可撤 → 撤回异动（整批退回填报人节点） */
  | 'withdraw-mutation'
  /** 学院计划已下发 → 无可撤回动作（引导查看审批） */
  | 'distributed-locked'
  /**
   * 2026-11-14（撤回相位缺陷）：子计划审批中但后端 canWithdraw=false → 渲染置灰「撤回」。
   * 用户实测（2026-11-13）：flow6 三步链走到第 3 级（分管校领导待审）时按钮仍亮橙可点，
   * 点击被后端 400「当前计划状态不支持撤回」拒掉 —— 首个审批人（战略发展部负责人）动手后
   * 就不能撤了（上一步不再是「提交」步骤）。对齐职能页签 pending_locked 相位：info 灰调 +
   * tooltip「当前审批进度不支持撤回」，不再把可不可撤交给后端报错。
   */
  | 'pending-locked'

export interface CollegeTabDistributeButtonInput {
  /** 异动审批在审且当前用户为发起人（未过撤回窗口）——model 的 canWithdrawMutationInFlight */
  canWithdrawMutationInFlight: boolean
  /** 学院子计划原始状态（IN_REVIEW / PENDING / DRAFT / DISTRIBUTED / 未知 / null） */
  collegePlanStatus: unknown
  /**
   * 2026-11-14（撤回相位缺陷）：学院子计划口径的 canWithdraw —— 预载工作流详情
   * （WorkflowInstanceDetailResponse.canWithdraw，后端 PlanWorkflowSnapshotQueryService /
   * AuditInstance.canRequesterWithdraw 产出：IN_REVIEW + 有 pending 步骤 + 上一步是
   * 「提交」步骤或驳回退回）。判定口径：
   * <ul>
   *   <li>false → 命中审批中分支时改判 pending-locked（置灰，不可点）；</li>
   *   <li>true / undefined（缺省）→ 旧行为 withdraw-dispatch —— 非学院上下文（undefined）
   *       与工作流详情未预载（数据缺失）都走缺省，向后兼容零改动。</li>
   * </ul>
   */
  canWithdrawDispatch?: boolean
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
 *       —— 真撤回下发审批（高②：此前恒显示发起类文案，撤回不可达）；
 *       2026-11-14 起若 canWithdrawDispatch === false（首个审批人已动手，后端判定不可撤）
 *       → 改判 pending-locked「撤回」（info，置灰不可点），不让用户点了再吃 400；</li>
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
  if (
    ['PENDING', 'IN_REVIEW', 'PENDING_REVIEW', 'PENDING_APPROVAL', 'SUBMITTED'].includes(status)
  ) {
    // 2026-11-14（撤回相位缺陷）：预载工作流详情明确 canWithdraw=false → 审批已推进到
    // 审批节点（step3 分管校领导待审），后端必拒撤回 → 置灰。仅显式 false 锁；
    // true / undefined（非学院上下文、详情未预载）一律走旧行为（缺省=可撤，零回归）。
    if (input.canWithdrawDispatch === false) {
      return { action: 'pending-locked', text: '撤回', buttonType: 'info' }
    }
    return { action: 'withdraw-dispatch', text: '撤回', buttonType: 'warning' }
  }
  if (['DISTRIBUTED', 'APPROVED', 'PUBLISHED', 'ACTIVE'].includes(status)) {
    return { action: 'distributed-locked', text: '撤回', buttonType: 'info' }
  }
  return { action: 'submit-dispatch', text: '发起审批', buttonType: 'success' }
}

/** 「下发/撤回」多态合并按钮**席位级显隐**判定的输入（2026-11-13 用户铁律） */
export interface WithdrawControlVisibilityInput {
  /**
   * 异动审批在审且当前用户为该批发起人（未过撤回窗口）——model 的 canWithdrawMutationInFlight。
   * 已核实该 computed 内含「发起人（submitter_name 与当前登录人姓名比对）+ 撤回窗口
   * （当前节点不含终审/分管校领导）」限定，此处直接采信，不再重复比对发起人。
   */
  canWithdrawMutationInFlight: boolean
  /** 登录账号 authStore.user.roles 是否含 ROLE_REPORTER 席位码（model 的 isCurrentUserReporter） */
  isCurrentUserReporter: boolean
  /** 当前登录用户组织 id（解析失败为 null） */
  currentUserOrgId: number | null
  /**
   * 当前生效计划的创建方组织 id。口径随页签：职能页签 = currentPlan.createdByOrgId，
   * 学院页签 = effectivePlanContext 解析的 FUNC_TO_COLLEGE 子计划.createdByOrgId
   * （组件侧经 effectivePlanContext 一处取数，两页签天然同源）。
   */
  effectivePlanCreatedByOrgId: number | string | null | undefined
}

/**
 * 「下发/撤回」多态合并按钮（撤回下发审批 / 撤回上报 / 撤回异动）的**席位级显隐**。
 *
 * <p>用户铁律（2026-11-13）：按钮只允许「当前生效计划归属部门的**填报人席位**」显示；
 * 其他席位（负责人/审核人/校领导）与跨部门查看者一律不显示（v-if 隐藏，不是置灰）。
 * 显隐靠席位、置灰靠相位，两层并存——填报人自己看到时，既有相位置灰逻辑与
 * tooltip 原样保留。判定式：</p>
 * <ol>
 *   <li>异动在审分支：canWithdrawMutationInFlight（已含发起人比对与撤回窗口）→
 *       任一页签该批发起人可见；</li>
 *   <li>普通下发/撤回分支：isCurrentUserReporter && 当前生效计划 createdByOrgId ===
 *       currentUserOrgId。席位判定必须先于 org 比对——学院子计划 createdByOrgId=战略部，
 *       战略部负责人与计划同 org，纯 org 比对拦不住（zlb_final1 实测反例）。</li>
 * </ol>
 * <p>页签上下文不单列输入：两页签差异已完全落在 effectivePlanCreatedByOrgId 的取数口径里
 * （学院页签取生效子计划、职能页签取自身计划），判定式本身与页签无关（异动发起人
 * 「任一页签」可见）。未登录 / roles 缺失（isCurrentUserReporter=false、orgId 取不到）/
 * 生效计划缺失或 createdByOrgId 非法 → 一律 false（宁可隐藏，不误显示）。</p>
 */
export const resolveWithdrawControlVisible = (input: WithdrawControlVisibilityInput): boolean => {
  // 分支①异动在审：发起人（含撤回窗口）限定已由 model 的 canWithdrawMutationInFlight 保证
  if (input.canWithdrawMutationInFlight === true) {
    return true
  }
  // 分支②普通下发/撤回：先席位（ROLE_REPORTER），再「当前生效计划归属部门」
  if (input.isCurrentUserReporter !== true) {
    return false
  }
  const reporterOrgId = Number(input.currentUserOrgId)
  if (!Number.isFinite(reporterOrgId) || reporterOrgId <= 0) {
    return false
  }
  const planOrgId = Number(input.effectivePlanCreatedByOrgId)
  return Number.isFinite(planOrgId) && planOrgId > 0 && planOrgId === reporterOrgId
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

/** 「退回待重报」异动链条目的最小结构（与 mutationApi.ReturnedMutationChainItem 对齐） */
export interface ReturnedMutationChainLike {
  instance_id: number | string
  [key: string]: unknown
}

export interface CollegeReturnedChainOwnerOrgIdInput {
  /** 登录角色是否为战略发展部（isStrategicDeptLogin） */
  isStrategicDeptLogin: boolean
  /** 战略发展部组织 id（strategicDeptOrgId，解析失败时 model 兜底 35） */
  strategicDeptOrgId: number | null
  /** 当前选中职能部门的组织 id（resolveDepartmentIdByName(selectedDepartment)） */
  funcOrgId: number | null
}

/**
 * 学院页签「退回待重报」异动链查询的组织口径（C3-D1 根因修复）。
 *
 * <p>背景（2026-11-12 C3-工学院异动全链缺陷 C3-D1）：战略部直发学院子指标
 * （owner=35、target=学院）的异动被驳回后，退回活链只被
 * {@code returnedChains(funcOrgId)} 查询覆盖不到 —— 后端
 * {@code listReturnedMutationChains} 按 {@code owner_org_id = orgId OR target_org_id = orgId}
 * 命中，学院子指标 owner=35 而职能侧边栏只含职能部门（org 36 起），职能口径查询恒空，
 * 红横幅/「发起异动/取消异动」双按钮在学院页签全链不可达（数据在、前端不拉）。</p>
 *
 * <p>口径（与 resolveSelectedCollegeReportScope 的创建方分流一致）：</p>
 * <ul>
 *   <li>战略部登录 → owner 口径取战略发展部组织 id（org 35）——学院子指标的
 *       owner 侧命中；</li>
 *   <li>职能部门登录 → owner 口径取当前选中职能部门 —— 存量学院行（owner=职能部门）
 *       的退回链，与职能页签既有查询同口径（合并时按 instance_id 去重，零增量）。</li>
 * </ul>
 */
export const resolveCollegeReturnedChainOwnerOrgId = (
  input: CollegeReturnedChainOwnerOrgIdInput
): number | null => {
  const strategicOrgId = Number(input.strategicDeptOrgId)
  const funcOrgId = Number(input.funcOrgId)
  if (input.isStrategicDeptLogin) {
    return Number.isFinite(strategicOrgId) && strategicOrgId > 0 ? strategicOrgId : null
  }
  return Number.isFinite(funcOrgId) && funcOrgId > 0 ? funcOrgId : null
}

/**
 * 退回链清单合并（按 instance_id 去重）：职能口径清单已加载后，学院口径补拉结果
 * 原地并入，同一条链（两口径都可能命中，如 owner=职能部门、target=学院的存量行）
 * 不重复计入横幅批次计数。
 */
export const mergeReturnedMutationChains = <T extends ReturnedMutationChainLike>(
  existing: T[],
  incoming: T[]
): T[] => {
  const seen = new Set(existing.map(chain => String(chain.instance_id ?? '')))
  const additions = incoming.filter(chain => {
    const key = String(chain.instance_id ?? '')
    return key !== '' && !seen.has(key)
  })
  return additions.length > 0 ? [...existing, ...additions] : existing
}

/** 学院页签在审异动判定条目的最小结构（与 mutation-approvals 响应映射对齐） */
export interface CollegeMutationApprovalEntryLike {
  targetOrgId?: number | string | null
  [key: string]: unknown
}

/** 学院×部门上报摘要的最小结构（collegeScopePlanReportSummary，字段与后端对齐） */
export interface CollegeReportSummaryLike {
  id?: number | string | null
  workflowStatus?: string | null
  status?: string | null
  [key: string]: unknown
}

export interface CollegeReportApprovalStatusMetaInput {
  /** 学院×部门上报摘要（null = 该学院×部门还没有报告记录） */
  reportSummary: CollegeReportSummaryLike | null
}

export interface CollegeReportApprovalStatusMeta {
  label: string
  tagType: 'info' | 'warning' | 'danger' | 'success'
  description: string
}

/**
 * 学院页签「审批状况」签的部门口径映射（2026-11-13 上报进度按归口部门收口）。
 *
 * <p>背景：学院页签两选齐后，该签此前读 collegeTableIndicators 行级 fills 聚合
 * （getIndicatorFillHistory 恒不带 functionalOrgId = 全院报告聚合），选了职能部门
 * 也显示全院口径。改为按任务1收口后的 collegeScopePlanReportSummary（学院×部门
 * 独立报告的 workflowStatus）映射。文案全部复用 approvalFlowStatusMeta 既有映射
 * （未填报 / 审批中 / 已回退 / 已上报 / 上报已撤回），零新文案。</p>
 *
 * <p>映射口径：摘要缺失 → 未填报；DRAFT（上报中填写）→ 未填报；
 * PENDING / IN_REVIEW / SUBMITTED → 审批中；WITHDRAWN → 上报已撤回（待重新上报）；
 * REJECTED / RETURNED / CANCELLED → 已回退；APPROVED → 已上报。</p>
 */
export const resolveCollegeReportApprovalStatusMeta = (
  input: CollegeReportApprovalStatusMetaInput
): CollegeReportApprovalStatusMeta => {
  const summary = input.reportSummary
  if (!summary) {
    return { label: '未填报', tagType: 'info', description: '当前学院还没有填报记录。' }
  }
  const status = String(summary.workflowStatus ?? summary.status ?? '')
    .trim()
    .toUpperCase()
  if (['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(status)) {
    return {
      label: '审批中',
      tagType: 'warning',
      description: '当前计划有指标的填报正在审批中。'
    }
  }
  if (status === 'WITHDRAWN') {
    return {
      label: '上报已撤回（待重新上报）',
      tagType: 'warning',
      description: '本轮上报已被撤回，等待重新上报。'
    }
  }
  if (['REJECTED', 'RETURNED', 'CANCELLED'].includes(status)) {
    return {
      label: '已回退',
      tagType: 'danger',
      description: '当前计划有指标的填报被回退，等待重新上报。'
    }
  }
  if (status === 'APPROVED') {
    return {
      label: '已上报',
      tagType: 'success',
      description: '当前计划的指标填报均已上报。'
    }
  }
  // DRAFT / 未知状态：报告轮次已存在但尚未提交上报 → 未填报（上报中填写）
  return { label: '未填报', tagType: 'info', description: '当前计划有指标尚未填报。' }
}

/**
 * 学院页签「新增行」在审互斥判定（C3 观察项 O-3）：所选学院的链上是否存在
 * 进行中的异动审批。
 *
 * <p>职能页签口径 = 本部门在审异动清单非空（isMutationApprovalInFlight，只读
 * departmentMutationPendingApprovals）；学院页签对齐同款判定，但数据源必须落到
 * **学院链**：异动实例 source=战略发展部/职能部门、target=学院，按职能部门 orgId
 * 的主清单大多查不到（owner=35、target=学院都不等于职能部门 orgId），只有
 * departmentChainMutationPendingApprovals（链下学院追回清单）按学院组织补查过。
 * 两份清单合并后按 targetOrgId = 学院组织 id 收口 —— 锁的是「这个学院」的在审异动，
 * 不把其他学院的在审异动串进来（学院口径各自独立，与 D-02 解耦方向一致）。</p>
 */
export const hasCollegeMutationApprovalInFlight = (
  entries: CollegeMutationApprovalEntryLike[],
  collegeOrgId: number | null
): boolean => {
  const orgId = Number(collegeOrgId)
  if (!Number.isFinite(orgId) || orgId <= 0) {
    return false
  }
  return entries.some(entry => Number(entry.targetOrgId) === orgId)
}
