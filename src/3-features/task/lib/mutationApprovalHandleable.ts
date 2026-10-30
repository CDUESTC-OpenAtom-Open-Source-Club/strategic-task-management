/**
 * 2026-10-30「处理审批」按钮名单化判定（纯函数，供 useStrategicTaskView 的
 * canHandleMutationApproval 消费）。
 *
 * 缺陷背景（用户 2026-10-30 真机反馈）：填报人（战略发展部管理员，组织 35）发起异动后，
 * 当前节点「战略发展部负责人审批」的可审批成员是三位负责人；填报人与负责人同属组织 35，
 * 旧口径「approverOrgId === 当前用户组织」让填报人的按钮也亮了「处理审批」，但该节点
 * 根本轮不到他。
 *
 * 用户定案口径：按钮点亮必须是「当前节点轮到当前用户处理」——当前用户在该节点
 * **可审批成员名单**内（按用户 ID 或姓名匹配），而不仅是同组织。
 *
 * 名单来源（与审批抽屉「可审批成员」同源）：
 * 1. 流程定义预览当前步骤的 candidateApprovers（loader 按在途任务 stepNo/步骤名匹配后
 *    挂到条目 currentStepCandidates，后端候选人解析与派单、鉴权共用同一范围组织入口）；
 * 2. 实例详情当前节点的已定审批人（currentApproverId/Name，或 PENDING 任务的
 *    assigneeId/Name）——预览缺失/被弃用时它是唯一名单依据。
 *
 * 兜底：两处名单都取不到（如 workflowDetail 加载失败、预览步骤匹配不上）时，退回既有
 * 「approverOrgId === 当前用户组织」匹配，避免数据不全时按钮该亮不亮。
 */

/** 节点候选审批人（与 workflow 预览接口 ApproverCandidateResponse 同构的宽松形状） */
export interface MutationApproverCandidateLike {
  userId?: number | string | null
  username?: string | null
  realName?: string | null
  orgId?: number | string | null
}

/** 在途异动条目（canHandleMutationApproval 消费到的最小形状） */
export interface MutationPendingApprovalEntryLike {
  approverOrgId?: number | string | null
  /** 当前在途步骤候选审批人名单（loader 从流程定义预览按步骤匹配挂载，可缺省） */
  currentStepCandidates?: MutationApproverCandidateLike[] | null
  /** getWorkflowInstanceDetail 挂载的实例详情（可缺省；缺失时走组织兜底） */
  workflowDetail?: {
    currentApproverId?: number | string | null
    currentApproverName?: string | null
    tasks?: Array<{
      status?: string | null
      assigneeId?: number | string | null
      assigneeName?: string | null
    }> | null
  } | null
}

/** 当前登录用户判定所需的最小身份形状 */
export interface MutationHandleableUserLike {
  userId?: number | string | null
  /** 姓名（realName 优先，退回 username），与候选 realName/username 精确比对 */
  userName?: string | null
  orgId?: number | string | null
}

function toPositiveNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function toTrimmedText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 步骤名归一化（与审批抽屉 resolveTaskCandidateApprovers 的匹配口径一致）：
 * 去空白、去全半角括号内容、统一大写，用于预览步骤与在途步骤的名称比对。
 */
export function normalizeWorkflowStepMatchKey(value: unknown): string {
  return toTrimmedText(value)
    .replace(/\s+/g, '')
    .replace(/[（(].*?[）)]/g, '')
    .toUpperCase()
}

/**
 * 判定「当前异动在途条目的当前节点是否轮到当前用户处理」。
 *
 * 规则：
 * 1. 候选名单（预览名单 + 详情已定审批人）非空 → 当前用户必须出现在名单内
 *    （userId 或姓名命中任一即算），不再看组织；
 * 2. 预览名单与节点审批组织明显不一致（候选带组织信息且无一匹配 approverOrgId，
 *    防预览按请求方组织解析的口径漂移）→ 弃用预览名单，只认详情已定审批人；
 * 3. 名单完全缺失 → 退回既有组织级匹配（approverOrgId === user.orgId，两者均为正数）。
 */
export function canCurrentUserHandleMutationEntry(
  entry: MutationPendingApprovalEntryLike | null | undefined,
  user: MutationHandleableUserLike | null | undefined
): boolean {
  const approverOrgId = toPositiveNumber(entry?.approverOrgId)

  // 预览名单：带组织信息且与节点审批组织对不上时视为口径漂移，弃用（缺组织信息则信任）
  const previewCandidates = Array.isArray(entry?.currentStepCandidates)
    ? entry.currentStepCandidates
    : []
  const previewHasOrgSignal = previewCandidates.some(
    candidate => toPositiveNumber(candidate?.orgId) > 0
  )
  const previewUsable =
    previewCandidates.length > 0 &&
    (!approverOrgId ||
      !previewHasOrgSignal ||
      previewCandidates.some(candidate => toPositiveNumber(candidate?.orgId) === approverOrgId))

  const candidates: Array<{ userId: number; realName: string; username: string }> = []
  if (previewUsable) {
    for (const candidate of previewCandidates) {
      candidates.push({
        userId: toPositiveNumber(candidate?.userId),
        realName: toTrimmedText(candidate?.realName),
        username: toTrimmedText(candidate?.username)
      })
    }
  }

  // 详情当前节点的已定审批人（实例级 + PENDING 任务级，通常同一人，重复无副作用）：
  // 预览名单缺失/被弃用时它是唯一名单依据
  const detail = entry?.workflowDetail
  if (detail) {
    const pendingTask = Array.isArray(detail.tasks)
      ? detail.tasks.find(task => toTrimmedText(task?.status).toUpperCase() === 'PENDING')
      : null
    const assignees: Array<{ userId: unknown; name: unknown }> = [
      { userId: detail.currentApproverId, name: detail.currentApproverName },
      { userId: pendingTask?.assigneeId, name: pendingTask?.assigneeName }
    ]
    for (const assignee of assignees) {
      const userId = toPositiveNumber(assignee.userId)
      const name = toTrimmedText(assignee.name)
      if (userId || name) {
        candidates.push({ userId, realName: name, username: name })
      }
    }
  }

  // 兜底：名单完全缺失 → 既有组织级匹配
  if (candidates.length === 0) {
    const userOrgId = toPositiveNumber(user?.orgId)
    return Boolean(approverOrgId && userOrgId && approverOrgId === userOrgId)
  }

  const userId = toPositiveNumber(user?.userId)
  const userName = toTrimmedText(user?.userName)

  return candidates.some(candidate => {
    if (userId && candidate.userId && candidate.userId === userId) {
      return true
    }
    if (
      userName &&
      ((candidate.realName && candidate.realName === userName) ||
        (candidate.username && candidate.username === userName))
    ) {
      return true
    }
    return false
  })
}
