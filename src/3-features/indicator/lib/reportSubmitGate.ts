/**
 * /indicators 填报页「一键提交」按钮锁定原因（2026-10-31 用户拍板「灰而可点」）。
 *
 * 与下发页 distributionSubmitGate 同范式：锁的作用域不变（异动期间锁上报是
 * 2026-10-24 互斥锁②的既有设计），只是把「置灰点不动」升级为
 * 「点击当场弹第一条命中原因」：
 * - 本模块是纯函数，同时供三处使用：按钮置灰判定、悬停 title、点击 gate toast——
 *   单一事实源，条件优先级只有一份；
 * - 文案口径（说人话、无内部 ID、最少化）：异动锁与既有 toast 完全同口径，
 *   自评缺口与既有悬停 title 完全同口径，绝不出现 Plan N / 实例 ID。
 *
 * 2026-11-15（用户拍板「提交按钮隐藏改主动引导」）：草稿态/归属部门/未来月三条件
 * 从「整颗按钮 v-if 不渲染」并入本原因链（按钮始终渲染，置灰 + el-tooltip 说明
 * 缺什么，与一键撤回同款结构）。多条件同时缺时文案按优先级取第一条：
 * 部门 > 未来月 > 草稿（紧随既有状态门之后，异动锁/自评缺口保持其后不变）。
 */

export interface ReportSubmitGateInput {
  /** 历史快照模式只读 */
  isReadOnly: boolean
  /** 当前计划下存在可提交的指标行 */
  hasIndicators: boolean
  /** 本部门指标异动审批在途（2026-10-24 互斥锁②：同一学院链上上报与异动二选一） */
  mutationInFlight: boolean
  /** 存在未填写自评进度的指标行数 */
  missingSelfRatingCount: number
  /**
   * 2026-11-13（学院上报按归口部门分批提交）：是否已选择「归属部门」。
   * 仅学院页签传入：未选（false）时一键提交/一键撤回禁用并提示先选部门；
   * 缺省（undefined）视为已选——非学院链路调用方零改动。
   */
  functionalDeptSelected?: boolean
  /**
   * 2026-11-15（用户拍板「未来月放填报、拦提交」原显隐条件并入置灰引导）：
   * 提交目标月是否晚于当前真实月份。未来月（true）时一键提交置灰并提示
   * 「未来周期暂不能提交」；填报存草稿不受影响。后端提交端点有同口径校验兜底
   * （前端置灰只是入口收敛，不能替代服务端防线）。缺省视为非未来月。
   */
  isFutureMonth?: boolean
  /**
   * 2026-11-15：是否走 PlanReport 上报流程（原显隐条件并入置灰引导）。
   * 缺省（undefined）视为 true——与旧显隐函数口径一致。
   */
  usePlanReportFlow?: boolean
  /**
   * 2026-11-15：PlanReport 流的报告动作态是否为 draft（原显隐条件并入置灰引导）。
   * 走 PlanReport 流且非 draft（在审/已批等）时置灰并提示「暂无可提交的填报内容」；
   * 传统链（usePlanReportFlow=false）不适用。缺省视为草稿态。
   */
  isPlanReportDraftState?: boolean
}

/**
 * 按条件优先级取第一条命中的锁定原因；全部通过返回空串。
 * 优先级：状态门（只读 → 空列表）→ 归属部门门（2026-11-13）→ 未来月门（2026-11-15）→
 * 草稿态门（2026-11-15）→ 异动锁 → 内容门（自评缺口）。
 * 三门（部门 > 未来月 > 草稿）的相对顺序为 2026-11-15 用户拍板的 tooltip 文案优先级。
 * 2026-11-18（学院未选归口=行集置空，用户定案）：学院未选归属部门时填报行集为空
 * （selectCollegeFillRows），空列表门不得抢在部门门之前——否则引导文案从
 * 「请先选择归属部门」退化为「没有可提交的指标」。仅当部门门不命中
 * （非学院/已选部门）时空列表门照旧生效。
 */
export function resolveReportSubmitLockReason(input: ReportSubmitGateInput): string {
  if (input.isReadOnly) {
    return '历史快照为只读状态，暂不能提交上报'
  }

  if (!input.hasIndicators && input.functionalDeptSelected !== false) {
    return '没有可提交的指标'
  }

  // 2026-11-13：一键提交必须先选归属部门——后端按报告归口派审批席位，
  // 未选部门时无法确定提交上下文（报告按 (月, 归口部门) 隔离）
  if (input.functionalDeptSelected === false) {
    return '请先选择归属部门'
  }

  // 2026-11-15（用户拍板：未来月放填报、拦提交，原 v-if 隐藏并入置灰引导）：
  // 提交目标月晚于当前真实月份 → 置灰并提示；填报存草稿不受影响
  if (input.isFutureMonth === true) {
    return '未来周期暂不能提交'
  }

  // 2026-11-15（原「非草稿态不渲染」并入置灰引导）：报告在审/已批等非 draft 态
  // 没有可提交的草稿内容；传统链不适用（usePlanReportFlow=false 或缺省时跳过）
  if ((input.usePlanReportFlow ?? true) && input.isPlanReportDraftState === false) {
    return '暂无可提交的填报内容'
  }

  // 2026-10-24 互斥锁②：异动审批在途时不能提交上报——文案与既有点击守卫同口径
  if (input.mutationInFlight) {
    return '当前部门存在进行中的异动审批，暂不能提交上报；请等异动审批结束或撤回后再操作'
  }

  if (input.missingSelfRatingCount > 0) {
    return '存在未填写自评进度的指标，请先完成全部指标的自评进度评定，再提交上报'
  }

  return ''
}

/**
 * 2026-11-13（B-1 修复，用户全链回归实测）：上报「驳回退回待重报」判定。
 *
 * 驳回/发起人撤回后实例是活链（rawStatus 仍 IN_REVIEW），但当前 pending 节点
 * 已回到「填报人提交」——业务上等同草稿：填报人要能直接修改并重新提交。
 * 此前 UiStatus 保持 IN_REVIEW → currentPlanReportActionState 判
 * pending_withdrawable → 「一键提交」不渲染，填报人只能绕行「一键撤回」再重报。
 *
 * @param rawStatus 工作流实例状态（IN_REVIEW/SUBMITTED/PENDING/…）
 * @param currentStepName 当前 pending 节点名（驳回退回的唯一落点 = 填报人提交）
 */
export function isReportReturnedToSubmitter(rawStatus: unknown, currentStepName: unknown): boolean {
  const status = String(rawStatus ?? '')
    .trim()
    .toUpperCase()
  if (!['SUBMITTED', 'IN_REVIEW', 'PENDING'].includes(status)) {
    return false
  }
  return String(currentStepName ?? '').includes('填报人提交')
}

/**
 * 2026-11-26（撤回窗口收窄，用户定调最初设计）：上报撤回窗口=「填报人提交之后 →
 * 第一个审批环节审核之前」。学院线第一审批环节=学院审核人审批，职能线=职能部门
 * 审批人审批（口径按链泛化）。环节推进（学院审核人/职能部门审批人已通过，推进到
 * 分管职能部门负责人审批/分管校领导审批等后续节点）后返回 false——撤回钮隐藏、
 * 撤回判定不放行，与后端环节门（CancelWorkflowUseCase 撤回 409）同口径兜底。
 *
 * @param isSecondaryCollege 当前视角是否二级学院（学院线/职能线取不同第一环节名）
 * @param currentStepName 上报实例当前待办环节名（audit_step_instance.step_name）
 */
export function isReportAtFirstApprovalStage(input: {
  isSecondaryCollege: boolean
  currentStepName: unknown
}): boolean {
  const stepName = String(input.currentStepName ?? '')
    .replace(/\s+/g, '')
    .trim()
  if (!stepName) {
    return false
  }
  const firstApprovalStageName = input.isSecondaryCollege ? '学院审核人审批' : '职能部门审批人审批'
  return stepName.includes(firstApprovalStageName)
}

/**
 * 2026-11-17（e2e 缺陷②修复）：上报「驳回退回待重报（WITHDRAWN 活链）」判定。
 *
 * <p>2026-11-17 起驳回落点 = plan_report→DRAFT + audit_instance→WITHDRAWN
 * （completed_at 为空的重报复活实例，ReportApplicationService.
 * markWorkflowReturnedForResubmission 保留 report.audit_instance_id 指向它）。
 * 填报页此前只认「IN_REVIEW 且当前节点=填报人提交」的活链态
 * （isReportReturnedToSubmitter），WITHDRAWN 活链一律落进「草稿」灰章，
 * 2026-11-13 定案要求的「退回态可见」缺失。</p>
 *
 * <p>口径（与异动侧「退回待重报」横幅同构，参照 returnedMutationChains：
 * 驳回与发起人撤回都归「退回待重报」）：</p>
 * <ul>
 *   <li>当前报告轮已回草稿态（reportStatus=DRAFT，currentPlanReportUiStatus 已把
 *       原始 DRAFT / 退回待重报等价态归到这里）——有 DRAFT 报告且有对应退回实例；</li>
 *   <li>实例状态 = WITHDRAWN 且 endTime（completed_at）为空 = 活链（未终结）；</li>
 *   <li>IN_REVIEW 正常在审 / APPROVED 已通过 / 实例已终结（endTime 非空）/ 摘要缺失
 *       一律 false——防「正常在审误报退回」「新月份草稿误挂历史退回链」。</li>
 * </ul>
 *
 * <p>重报提交后实例复活为 IN_REVIEW（reactivateWithdrawnStep）→ reportStatus 离开
 * DRAFT → false（横幅消失）；审批通过 APPROVED → false。纯函数，实现与单测共用。</p>
 */
export function isReportReturnedChainAlive(input: {
  /** 当前报告轮状态（currentPlanReportUiStatus：DRAFT=草稿/退回待重报等价态） */
  reportStatus: unknown
  /** 上报实例状态（WorkflowInstanceDetailResponse.status） */
  instanceStatus: unknown
  /** 实例终结时间（WorkflowInstanceDetailResponse.endTime；空 = completed_at 为空活链） */
  instanceEndTime?: unknown
}): boolean {
  const reportStatus = String(input.reportStatus ?? '')
    .trim()
    .toUpperCase()
  if (reportStatus !== 'DRAFT') {
    return false
  }
  const instanceStatus = String(input.instanceStatus ?? '')
    .trim()
    .toUpperCase()
  if (instanceStatus !== 'WITHDRAWN') {
    return false
  }
  return String(input.instanceEndTime ?? '').trim() === ''
}
