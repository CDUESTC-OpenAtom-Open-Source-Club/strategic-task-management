export interface WorkflowApprovalActorContext {
  currentUserId?: number | null
  currentUserOrgId?: number | null
  currentUserRoleCodes?: string[]
  hasApprovalPermission: boolean
  isPendingApproval: boolean
  explicitApproverId?: number | null
  expectedApproverRoleCodes?: string[]
  expectedApproverOrgId?: number | null
}

function normalizePositiveNumber(value: unknown): number | null {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null
  }
  return numericValue
}

function normalizeRoleCodes(roleCodes?: string[]): string[] {
  if (!Array.isArray(roleCodes)) {
    return []
  }

  return roleCodes
    .map(roleCode => (typeof roleCode === 'string' ? roleCode.trim() : ''))
    .filter(Boolean)
}

export function canCurrentUserHandleWorkflowApproval(
  context: WorkflowApprovalActorContext
): boolean {
  // `hasApprovalPermission` is retained only for legacy signature compatibility.
  if (!context.isPendingApproval) {
    return false
  }

  const explicitApproverId = normalizePositiveNumber(context.explicitApproverId)
  const currentUserId = normalizePositiveNumber(context.currentUserId)
  if (explicitApproverId) {
    return explicitApproverId === currentUserId
  }

  const expectedRoleCodes = normalizeRoleCodes(context.expectedApproverRoleCodes)
  const currentUserRoleCodes = normalizeRoleCodes(context.currentUserRoleCodes)
  if (expectedRoleCodes.length > 0) {
    const hasExpectedRole = expectedRoleCodes.some(roleCode =>
      currentUserRoleCodes.includes(roleCode)
    )
    if (!hasExpectedRole) {
      return false
    }
  }

  const expectedApproverOrgId = normalizePositiveNumber(context.expectedApproverOrgId)
  const currentUserOrgId = normalizePositiveNumber(context.currentUserOrgId)
  if (expectedApproverOrgId && currentUserOrgId) {
    return expectedApproverOrgId === currentUserOrgId
  }

  return true
}

/**
 * 2026-11-15（审批中心「审批通过/审批驳回」按钮候选人显隐）：单条上报/异动待办卡
 * 「轮到当前登录人」判定。
 *
 * <p>背景（线上实测缺陷）：学院上报五级链走到「分管职能部门校领导审批」时，学院/
 * 归口部门账号打开审批中心抽屉，操作位显示「审批流已锁定」（canCurrentUserHandlePlanApproval
 * = false，判定正确），但待办卡上的绿色「审批通过」/红色「审批驳回」按钮仍然渲染，
 * 点击才吃后端 403。根因：按钮显隐读的 canCurrentUserHandleReportTodo 是**全局标志**
 * ——只要当前登录人名下有**任意一条**待办（或旧口径兜底：持有任一审批角色
 * hasAnyPlanApprovalRole）就整页点亮，与「这张卡是不是我的节点」无关。</p>
 *
 * <p>判定口径（后端已有权威字段，前端直接接，不新增接口）：待办条目上
 * `currentApproverId`（实例**当前活动节点**审批人；/approval/instances/my-pending
 * 条目与实例详情 WorkflowReadModelMapper 都取当前 PENDING 步 approverId）优先，
 * 缺失时回退 `assigneeId`（/workflows/my-tasks 任务条目指派）。与 currentUserId
 * 相等即「轮到我」。工作流引擎每步解析**唯一审批人**
 * （ApproverResolver.resolveByRoleId 对角色+组织范围内候选 findFirst），不存在
 * 「或签多候选各持任务」的形态——审批人相等即候选人的完整镜像，与后端 decision
 * 接口的授权判定同源；两字段都取不到（脏数据）时按 false 处理（宁可隐藏，不误显示，
 * 后端 403 兜底不变）。currentApproverId 优先：模型层 reportTodoDetailCards 会用
 * 实例详情的当前节点审批人覆盖列表条目（列表条目的 assigneeId 可能是**已办完的
 * 旧任务**指派——归口审核人批完第 3 级后旧清单里 assigneeId 还是自己，不能作为
 * 「轮到我」的证据，见 useApprovalProgressDrawer 2026-11-15 注）。</p>
 */
export interface ReportTodoEntryLike {
  assigneeId?: number | string | null
  currentApproverId?: number | string | null
  [key: string]: unknown
}

export function canCurrentUserHandleTodoEntry(
  entry: ReportTodoEntryLike,
  currentUserId: number | null | undefined
): boolean {
  const userId = normalizePositiveNumber(currentUserId)
  if (!userId) {
    return false
  }
  const approverId = normalizePositiveNumber(entry.currentApproverId ?? entry.assigneeId)
  return !!approverId && approverId === userId
}
