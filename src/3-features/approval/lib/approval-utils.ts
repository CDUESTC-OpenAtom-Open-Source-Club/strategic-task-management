import type { ApprovalHistoryItem } from '@/shared/types'
import type { WorkflowHistoryCardResponse } from '@/features/workflow/api/types'

export type ApprovalStatusTag = {
  label: string
  type: 'success' | 'warning' | 'danger' | 'info'
}

export function normalizeDisplayName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeWorkflowCode(value: unknown): string {
  return String(value || '')
    .trim()
    .toUpperCase()
}

export function parsePositiveUserId(value: unknown): number | null {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null
  }
  return numericValue
}

export function toPositiveNumber(value: unknown): number | null {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null
}

export function isSubmissionFlow(flowCode?: string): boolean {
  return String(flowCode || '')
    .toUpperCase()
    .startsWith('PLAN_APPROVAL_')
}

export function isDistributionFlow(flowCode?: string): boolean {
  return String(flowCode || '')
    .toUpperCase()
    .startsWith('PLAN_DISPATCH_')
}

export function isMutationFlow(flowCode?: string): boolean {
  return (
    String(flowCode || '')
      .trim()
      .toUpperCase() === 'PLAN_MUTATION_STRATEGY'
  )
}

// 2026-09-27 用户拍板：审批卡片标题必须按真实流程类型区分——
// 战略部/职能部门发起的下发是「下发审批」，只有上报链路才叫「上报审批」，
// 指标异动是「异动审批」。flowCode 缺失时保守回退「上报审批」维持旧行为。
export function resolvePlanApprovalTypeLabel(flowCode?: string): string {
  const code = normalizeWorkflowCode(flowCode)
  if (isDistributionFlow(code)) {
    return '下发审批'
  }
  if (isMutationFlow(code)) {
    return '异动审批'
  }
  return '上报审批'
}

// 2026-10-31 用户拍板（「确认审批流程」弹窗）：审批流程行显示完整中文流程名
// （如「计划下发审批」），绝不透出后端 workflowName 的「Plan xxx」英文占位。
// 缺 code 时按该弹窗主场景（战略部下发链）兜底「计划下发审批」。
export function resolvePlanConfirmWorkflowName(flowCode?: string): string {
  const code = normalizeWorkflowCode(flowCode)
  if (isDistributionFlow(code)) {
    return '计划下发审批'
  }
  if (isMutationFlow(code)) {
    return '计划异动审批'
  }
  if (isSubmissionFlow(code)) {
    return '计划上报审批'
  }
  return '计划下发审批'
}

// 审核进度只属于上报链路（V88 口径）：下发/异动流程不显示审核进度选择器。
// flowCode 未知时保持显示，避免老数据丢功能。
export function showAppraisalLevelForFlow(flowCode?: string): boolean {
  const code = normalizeWorkflowCode(flowCode)
  return !code || isSubmissionFlow(code)
}

// 2026-11-12（D-3 统一口径）：后端 API 已按上报方向返回 source/target
// （source=提交方，target=审批方），上报卡不再翻转为 target -> source；
// 上报/下发/异动统一直接 source -> target。
export function resolveApprovalRouteTitle(
  card: Pick<WorkflowHistoryCardResponse, 'flowCode' | 'sourceOrgName' | 'targetOrgName'>
): string {
  const sourceOrgName = normalizeDisplayName(card.sourceOrgName) || '战略发展部'
  const targetOrgName = normalizeDisplayName(card.targetOrgName) || '目标部门'

  if (isSubmissionFlow(card.flowCode)) {
    return `上报审批 · ${sourceOrgName} -> ${targetOrgName}`
  }

  if (isDistributionFlow(card.flowCode)) {
    return `下发审批 · ${sourceOrgName} -> ${targetOrgName}`
  }

  if (isMutationFlow(card.flowCode)) {
    return `异动审批 · ${sourceOrgName} -> ${targetOrgName}`
  }

  return normalizeDisplayName(card.flowCode) || '审批流程'
}

/**
 * 2026-10-31 用户定案（确认弹窗去计划编号）：计划类确认弹窗以
 * 「{年份}年度 计划（{source} -> {target}）」口径指代计划（例：
 * 「2026年度 计划（战略发展部 -> 科技处）」）。字段取不到就略写：
 * 无年份只写「计划」，无流向只写计划本体，全缺时回退 fallback（如「当前计划」）。
 * 绝不把「Plan 404457」这类后端自动生成的占位计划名/裸数字 ID 拼进弹窗。
 *
 * 2026-11-12（D-3 统一口径）：后端 API 已按上报方向返回 source/target
 * （source=提交方，target=审批方），上报链不再内部交换方向——
 * 上报/下发/异动/缺 code 统一直接 source -> target 展示。
 */
export function buildPlanReferenceLabel(params: {
  year?: unknown
  sourceOrgName?: unknown
  targetOrgName?: unknown
  fallback?: string
}): string {
  const routeSourceOrgName = normalizeDisplayName(params.sourceOrgName)
  const routeTargetOrgName = normalizeDisplayName(params.targetOrgName)

  const year = Number(params.year)
  const hasYear = Number.isFinite(year) && year > 0

  const route =
    routeSourceOrgName && routeTargetOrgName
      ? `（${routeSourceOrgName} -> ${routeTargetOrgName}）`
      : routeSourceOrgName || routeTargetOrgName
        ? `（${routeSourceOrgName || routeTargetOrgName}）`
        : ''
  const label = `${hasYear ? `${year}年度 ` : ''}计划${route}`

  if (label === '计划' && params.fallback && normalizeDisplayName(params.fallback)) {
    return normalizeDisplayName(params.fallback)
  }
  return label
}

// 2026-11-12（审批弹窗用实例业务名）：后端对未命名实体自动生成的占位名
// （「Plan 404457」式英文占位 / 裸数字 ID），绝不能亮给用户。
const PLAN_INSTANCE_PLACEHOLDER_NAME_PATTERN = /^(Plan\s*\d+|\d+)$/i

/**
 * 2026-11-12（审批通过/驳回确认弹窗用实例业务名）：
 * 优先取实例业务名（PLAN_REPORT 实例的 planName，后端=plan_report.planName，
 * 如「2026年度 11月上报（计算机学院 -> 战略发展部）」），次选 props.planName；
 * 候选缺失或命中占位名（「Plan 404457」/裸数字 ID）时，回退
 * buildPlanReferenceLabel 拼出的「{年份}年度 计划（流向）」参考标签。
 * useApprovalProgressDrawer / useApprovalProgressState / useApprovalProgressWorkflow
 * 三份 resolvePlanReferenceLabel 同口径复用。
 */
export function resolvePlanInstanceReferenceLabel(params: {
  instancePlanName?: unknown
  fallbackPlanName?: unknown
  referenceLabel: string
}): string {
  for (const candidate of [params.instancePlanName, params.fallbackPlanName]) {
    const name = normalizeDisplayName(candidate)
    if (name && !PLAN_INSTANCE_PLACEHOLDER_NAME_PATTERN.test(name)) {
      return name
    }
  }
  return params.referenceLabel
}

/**
 * 2026-11-12（审批抽屉「驳回原因」串实例修复 HIGH②）：
 * 实例自身审批步骤里 status=REJECTED 的 step.comment 才是「这条实例」的驳回意见
 * （多轮被拒取 step_no 最大的一条；stepNo 平手看 taskId，与异动任务排序口径一致）。
 * 此前 rejectionReason 只读 PLAN 级 lastRejectReason（下发实例的最后驳回意见），
 * 上报实例 #6 的抽屉显示的是下发实例 #3 的意见——串实例。
 * taskSources 按「审批流程」页签当前渲染的步骤链优先级依次传入
 * （焦点实例 → 上报 → 异动 → 计划下发链），第一个解析出 REJECTED 意见的来源生效；
 * 全部不可用才回退 fallbackReason（PLAN 级 lastRejectReason），维持旧显示兜底。
 * useApprovalProgressState / useApprovalProgressDrawer 两份 rejectionReason 同口径复用。
 */
export function resolveInstanceRejectionComment(params: {
  taskSources?: ReadonlyArray<readonly unknown[] | null | undefined>
  fallbackReason?: unknown
}): string {
  for (const source of params.taskSources ?? []) {
    const tasks = Array.isArray(source) ? source : []
    let best: { stepNo: number; taskId: number; comment: string } | null = null
    for (const raw of tasks) {
      if (!raw || typeof raw !== 'object') {
        continue
      }
      const task = raw as Record<string, unknown>
      if (String(task.status ?? '').trim().toUpperCase() !== 'REJECTED') {
        continue
      }
      const comment = typeof task.comment === 'string' ? task.comment.trim() : ''
      if (!comment) {
        continue
      }
      const stepNo = Number(task.stepNo)
      const taskId = Number(task.taskId)
      const candidate = {
        stepNo: Number.isFinite(stepNo) ? stepNo : Number.NEGATIVE_INFINITY,
        taskId: Number.isFinite(taskId) ? taskId : Number.NEGATIVE_INFINITY,
        comment
      }
      if (
        !best ||
        candidate.stepNo > best.stepNo ||
        (candidate.stepNo === best.stepNo && candidate.taskId > best.taskId)
      ) {
        best = candidate
      }
    }
    if (best) {
      return best.comment
    }
  }
  const fallback = params.fallbackReason
  if (typeof fallback === 'string') {
    return fallback
  }
  return fallback ? String(fallback) : ''
}

export function resolveHistoryStatusTag(status?: string): ApprovalStatusTag {
  const normalized = String(status || '').toUpperCase()
  if (normalized === 'APPROVED') {
    return { label: '已通过', type: 'success' }
  }
  if (normalized === 'REJECTED') {
    return { label: '已回退', type: 'danger' }
  }
  if (normalized === 'WITHDRAWN') {
    return { label: '已回退', type: 'info' }
  }
  // 2026-10-30 用户定案（异动驳回后重报/取消闭环）：填报人「取消异动」主动终结
  // 的链与已通过同归审批历史，状态标签单列「已取消」
  if (normalized === 'CANCELLED') {
    return { label: '已取消', type: 'info' }
  }
  if (normalized === 'IN_REVIEW' || normalized === 'PENDING' || normalized === 'SUBMITTED') {
    return { label: '审批中', type: 'warning' }
  }
  return { label: normalized || '未知', type: 'info' }
}

export function isTerminalHistoryStatus(status?: string): boolean {
  const normalized = String(status || '')
    .trim()
    .toUpperCase()
  // 2026-10-30（异动驳回后重报/取消闭环）：CANCELLED（取消异动）与 APPROVED/REJECTED
  // 同为链条终态，历史页签按终态准入
  return ['APPROVED', 'REJECTED', 'CANCELLED'].includes(normalized)
}

export function normalizeWorkflowAction(action?: string): ApprovalHistoryItem['action'] {
  const normalized = String(action || '')
    .trim()
    .toUpperCase()
  if (normalized.includes('REJECT')) {
    return 'reject'
  }
  if (normalized.includes('WITHDRAW') || normalized.includes('CANCEL')) {
    return 'withdraw'
  }
  if (normalized.includes('START') || normalized.includes('SUBMIT')) {
    return 'submit'
  }
  return 'approve'
}

export function shouldDisplayWorkflowHistoryItem(
  item: { action?: string } | null | undefined
): boolean {
  const normalized = String(item?.action || '')
    .trim()
    .toUpperCase()
  return !normalized.includes('START')
}
