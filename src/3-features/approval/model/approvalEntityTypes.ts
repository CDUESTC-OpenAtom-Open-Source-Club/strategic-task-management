/**
 * 审批相关实体的类型归一化与「在审实例卡片」标题构造。
 *
 * 2026-10-27 抽出：此前 useApprovalProgressState（分发页审批抽屉）与
 * useApprovalProgressDrawer（消息中心审批抽屉）各有一份同名同逻辑的
 * normalizeWorkflowEntityType / resolveExternalTodoCard，改一处漏一处。
 * 统一到本模块后，两个入口口径必然一致。
 */

/** 审批流程涉及的实体类型 */
export type ApprovalEntityType = 'PLAN' | 'PLAN_REPORT' | 'INDICATOR' | 'TASK' | ''

/**
 * 归一化实体类型（大小写不敏感）。
 * 异动审批（PLAN_MUTATION_STRATEGY）挂在指标/任务实体上。
 */
export function normalizeApprovalEntityType(value: unknown): ApprovalEntityType {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
  if (normalized === 'PLAN_REPORT') {
    return 'PLAN_REPORT'
  }
  if (normalized === 'PLAN') {
    return 'PLAN'
  }
  if (normalized === 'INDICATOR') {
    return 'INDICATOR'
  }
  if (normalized === 'TASK') {
    return 'TASK'
  }
  return ''
}

/** 异动类实体（指标异动 / 任务异动）——两者共用 PLAN_MUTATION_STRATEGY 审批链 */
export function isMutationEntityType(entityType: unknown): boolean {
  const normalized = normalizeApprovalEntityType(entityType)
  return normalized === 'INDICATOR' || normalized === 'TASK'
}

/**
 * 审批待办实例的最小结构（两个 hook 都能提供这些字段）。
 */
export interface ApprovalTodoInstance {
  entityType?: unknown
  entityId?: unknown
  planName?: unknown
  entityTitle?: unknown
  title?: unknown
  sourceOrgName?: unknown
  targetOrgName?: unknown
  [key: string]: unknown
}

export interface ResolveExternalTodoCardParams {
  instance: ApprovalTodoInstance
  /** 当前抽屉打开的实体类型（用于抑制重复卡） */
  contextEntityType?: unknown
  /** 当前抽屉打开的实体 ID（用于抑制重复卡） */
  contextEntityId?: number | null
  /** 把 org id 解析为名称 */
  resolveOrgName?: (orgId: number | null) => string
  /** 取可显示的名称（空值归一） */
  normalizeDisplayName?: (value: unknown) => string
}

/**
 * 异动待办实例 → 有意义的卡片标题。
 *
 * 异动实例在待办列表里没有 entityTitle/planName，直接渲染会退化成占位文案
 * （此前是「上报审批」，实为异动）。这里统一成
 * 「指标异动审批 · 源 -> 目标」/「任务异动审批 · 源 -> 目标」。
 *
 * 当前抽屉正在看的那个实体不重复出卡（由完整卡展示）。
 */
export function resolveExternalTodoCard(
  params: ResolveExternalTodoCardParams
): Record<string, unknown> {
  const { instance } = params
  const entityType = normalizeApprovalEntityType(instance.entityType)
  if (!isMutationEntityType(entityType)) {
    return instance as Record<string, unknown>
  }

  const contextEntityType = normalizeApprovalEntityType(params.contextEntityType)
  const contextEntityId = Number(params.contextEntityId ?? NaN)
  const instanceEntityId = Number(instance.entityId ?? NaN)
  if (
    entityType === contextEntityType &&
    Number.isFinite(contextEntityId) &&
    contextEntityId > 0 &&
    instanceEntityId === contextEntityId
  ) {
    return { ...instance, __suppressTodoCard: true }
  }

  const normalizeName =
    params.normalizeDisplayName ?? ((value: unknown) => String(value || '').trim())
  const sourceOrgName = normalizeName(instance.sourceOrgName)
  const targetOrgName = normalizeName(instance.targetOrgName)
  const routeDisplay =
    sourceOrgName && targetOrgName
      ? `${sourceOrgName} -> ${targetOrgName}`
      : sourceOrgName || targetOrgName || '流向待补充'

  const mutationLabel = entityType === 'TASK' ? '任务异动审批' : '指标异动审批'
  const routeTitle =
    routeDisplay && routeDisplay !== '流向待补充'
      ? `${mutationLabel} · ${routeDisplay}`
      : mutationLabel

  const entityTitle =
    normalizeName(instance.planName) ||
    normalizeName(instance.entityTitle) ||
    normalizeName(instance.title) ||
    ''

  return {
    ...instance,
    routeTitle,
    title: entityTitle || routeTitle
  }
}
