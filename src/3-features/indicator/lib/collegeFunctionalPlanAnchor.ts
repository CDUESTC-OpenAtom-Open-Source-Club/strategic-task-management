/**
 * /distribution（指标分发审批页）「该学院计划」锚定口径（2026-11-13 归口锚定修正）。
 *
 * <p>背景（2026-11-05 战略部直发学院指标改造后）：FUNC_TO_COLLEGE 计划统一由战略发展部
 * （org 35）创建下发，「归口职能部门」落在 plan.functional_org_id（V104 已回填存量），
 * created_by_org_id 恒为 35。职能部门的 legacy 计划（created_by=各职能部门）仍在库里
 * 作只读历史——其中很大一部分是 **空壳**（全 DRAFT、0 任务），不能作为状态展示依据。</p>
 *
 * <p>缺陷：分发页头部「计划状态 / 审批状态 / 基础性权重合计」此前按旧口径锚定
 * 「本部门创建的 FUNC_TO_COLLEGE 计划」（createdByOrgId===本部门）→ 教务处登录选工学院
 * 锚到 legacy 空壳草稿（404456 等）→ 状态「草稿」、权重 0；真正的归口计划 705488
 * （created_by=35、functional_org_id=44、DISTRIBUTED、1 指标）没被锚到。</p>
 *
 * <p>新口径：FUNC_TO_COLLEGE 且 target=所选学院 且
 * <strong>归口计划优先</strong>（functional_org_id=本部门）；无归口计划时回退兼容
 * legacy 计划（created_by_org_id=本部门）——但 legacy 必须有存活指标（空壳不参与
 * 状态展示）。同一桶内优先已下发（有审批链），再按 id 倒序取最新（沿用既有排序）。</p>
 *
 * <p>纯函数，实现与单测共用同一份逻辑（collegePlanModule 同款模式）。</p>
 */
import type { Plan } from '@/shared/types'

/** 参与锚定判定的计划运行时字段（functionalOrgId 由 planApi 映射，历史数据可能缺失） */
export type AnchorPlanLike = Plan & {
  targetOrgId?: number | string
  targetOrgName?: string
  orgId?: number | string
  orgName?: string
  org_id?: number | string
  createdByOrgId?: number | string
  created_by_org_id?: number | string
  functionalOrgId?: number | string
  functional_org_id?: number | string
  planLevel?: string
  indicators?: unknown[]
}

export interface CollegePlanAnchorContext {
  /** 所选学院的组织 ID（解析不出时为 null，退回名称匹配） */
  collegeOrgId: number | null
  /** 所选学院的归一化名称（normalizeDepartmentName 之后） */
  collegeName: string
  /** 本部门（锚定方）的组织 ID：职能部门登录=本部门；战略部登录=战略发展部 */
  ownerOrgId: number | null
  currentYear: number
  resolvePlanYear: (plan: AnchorPlanLike) => number | null
  /** 计划 target 名称归一化（部门别名表；视图层注入 normalizeDepartmentName） */
  normalizeOrgName: (value?: string | null) => string
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim()
}

function toNumber(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : Number.NaN
}

/**
 * 计划是否携带「存活指标」（totalIndicators>0 或详情 indicators 数组非空）。
 * legacy 空壳计划（0 任务）据此排除，不参与状态展示。
 */
export function planHasLivingIndicators(plan: AnchorPlanLike): boolean {
  const totalIndicators = toNumber(plan.totalIndicators)
  if (Number.isFinite(totalIndicators) && totalIndicators > 0) {
    return true
  }
  return Array.isArray(plan.indicators) && plan.indicators.length > 0
}

/**
 * 计划是否命中「本部门 × 该学院」的锚定候选（任一桶：归口桶或 legacy 桶）。
 *
 * 公共条件（与旧口径逐字兼容）：年份精确等于当前年、planLevel 为空或 FUNC_TO_COLLEGE、
 * target 组织 ID 或归一化名称命中所选学院。
 *
 * 桶条件（二选一）：
 * - 归口桶：plan.functional_org_id === 本部门 org id；
 * - legacy 桶：plan.created_by_org_id === 本部门 org id，且计划有存活指标（空壳不算）。
 */
export function matchesCollegePlanAnchor(
  plan: AnchorPlanLike,
  context: CollegePlanAnchorContext
): boolean {
  if (context.resolvePlanYear(plan) !== context.currentYear) {
    return false
  }

  const planLevel = normalizeText(plan.planLevel).toUpperCase()
  if (planLevel && planLevel !== 'FUNC_TO_COLLEGE') {
    return false
  }

  const targetOrgId = toNumber(plan.targetOrgId ?? plan.org_id ?? plan.orgId)
  const matchesOrgId =
    context.collegeOrgId != null &&
    Number.isFinite(targetOrgId) &&
    targetOrgId === context.collegeOrgId
  const targetOrgName = context.normalizeOrgName(plan.targetOrgName || plan.orgName)
  const matchesOrgName = Boolean(context.collegeName) && targetOrgName === context.collegeName
  if (!matchesOrgId && !matchesOrgName) {
    return false
  }

  const ownerOrgId = toNumber(context.ownerOrgId)
  if (!Number.isFinite(ownerOrgId)) {
    return false
  }

  const planFunctionalOrgId = toNumber(plan.functionalOrgId ?? plan.functional_org_id)
  if (Number.isFinite(planFunctionalOrgId) && planFunctionalOrgId === ownerOrgId) {
    return true
  }

  const planCreatedByOrgId = toNumber(plan.createdByOrgId ?? plan.created_by_org_id)
  return (
    Number.isFinite(planCreatedByOrgId) &&
    planCreatedByOrgId === ownerOrgId &&
    planHasLivingIndicators(plan)
  )
}

/** 已下发优先（有审批链），其次 id 倒序取最新——与旧锚定排序逐字一致 */
function compareAnchorPriority(left: AnchorPlanLike, right: AnchorPlanLike): number {
  const isDistributed = (plan: AnchorPlanLike) =>
    normalizeText((plan as { status?: unknown }).status).toUpperCase() === 'DISTRIBUTED' ? 1 : 0
  const leftDistributed = isDistributed(left)
  const rightDistributed = isDistributed(right)
  if (leftDistributed !== rightDistributed) {
    return rightDistributed - leftDistributed
  }
  return toNumber(right.id ?? 0) - toNumber(left.id ?? 0) || 0
}

/**
 * 学院计划锚定（新口径唯一入口）：
 * 1. 归口计划（functional_org_id=本部门）桶非空 → 只在归口桶内取
 *    （新口径是唯一真数据源，legacy 只读历史不参与状态展示）；
 * 2. 归口桶为空 → 回退 legacy 桶（created_by_org_id=本部门且有存活指标）。
 * 桶内排序：已下发优先 → id 倒序。无命中返回 null。
 */
export function selectCollegeFunctionalPlan(
  plans: ReadonlyArray<AnchorPlanLike>,
  context: CollegePlanAnchorContext
): AnchorPlanLike | null {
  const ownerOrgId = toNumber(context.ownerOrgId)
  if (!Number.isFinite(ownerOrgId)) {
    return null
  }

  const candidates = plans.filter(plan => matchesCollegePlanAnchor(plan, context))
  if (candidates.length === 0) {
    return null
  }

  const functionalBucket = candidates.filter(plan => {
    const planFunctionalOrgId = toNumber(plan.functionalOrgId ?? plan.functional_org_id)
    return Number.isFinite(planFunctionalOrgId) && planFunctionalOrgId === ownerOrgId
  })
  const bucket = functionalBucket.length > 0 ? functionalBucket : candidates
  return [...bucket].sort(compareAnchorPriority)[0] ?? null
}
