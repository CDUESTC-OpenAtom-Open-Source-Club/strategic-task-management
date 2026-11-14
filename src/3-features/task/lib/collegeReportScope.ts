/**
 * 2026-11-13（学院页签状态签归口收口）：学院页签「职能部门 → 学院」子计划解析
 * （纯函数，实现与单测共用同一份逻辑 —— collegeDispatchEligibility / collegeTabDistribute 同款模式）。
 *
 * <p><b>缺陷（用户实测）</b>：战略部（zlb_admin）→ 「战略任务管理」→ 二级学院页签 →
 * 选「计算机学院」→ 右侧部门下拉选「教务处」→ 表格 No Data、审批状况「未填报」、
 * 基础性权重合计 0/100，但右上角「计划状态」却显示「已下发」。切到「纪委办公室 | 监察处」
 * 时「已下发」是对的。</p>
 *
 * <p><b>根因</b>：学院页签解析 FUNC_TO_COLLEGE 子计划时，战略部登录的匹配条件只看
 * 「目标学院 + 创建方=战略发展部(35)」，<b>完全不看归口部门</b>——同一学院下多个归口部门的
 * 计划创建方相同（恒为 35），于是计算机学院名下唯一符合的 FUNC_TO_COLLEGE 计划
 * （705489，归口=纪委办(37)）在选「教务处」时也被命中 → 状态签显示「已下发」，
 * 而表格/权重/审批状况读的是另一个（部门收口）数据源 → 三个签互相矛盾。</p>
 *
 * <p><b>新口径</b>（战略部登录）：创建方 = 战略发展部（35）<b>且</b>归口部门 = 当前所选归属部门。
 * 归口判定：</p>
 * <ul>
 *   <li><b>归口优先</b>：计划带 {@code functional_org_id}（后端 V104 起回填存量）时，
 *       必须精确等于所选部门 orgId；</li>
 *   <li><b>legacy 兜底</b>：归口字段为空的历史计划，仅当「计划确有存活指标」且
 *       「该学院的活跃子指标（parent_indicator_id 非空）其父级核心指标的归口部门 =
 *       所选部门」时才匹配（指标父级反查归口）——存量空壳计划（0 指标）一律不参与，
 *       否则会命中别的部门的空计划（匹配上就是空表）；</li>
 *   <li>归口字段有值但不等于所选部门 → 一律不匹配（不回落 legacy 桶）。</li>
 * </ul>
 *
 * <p><b>职能部门登录</b>：创建方仍是当前选中职能部门，<b>零变化红线</b>——不启用归口收口
 * （职能部门的历史学院计划 created_by=本部门、归口字段普遍为空，按归口收口会把它们
 * 全部排除，属回归）。</p>
 *
 * <p><b>解析失败</b>：一律返回 null（保守，宁可空，不串数据）→ 状态签显示「未下发」，
 * 表格空，两边一致。</p>
 */

/** 参与解析的计划运行时字段（宽松兼容前端 Plan / 后端 VO） */
export interface CollegeReportScopePlanLike {
  id?: number | string | null
  status?: unknown
  planLevel?: unknown
  plan_level?: unknown
  targetOrgId?: unknown
  orgId?: unknown
  org_id?: unknown
  createdByOrgId?: unknown
  created_by_org_id?: unknown
  functionalOrgId?: unknown
  functional_org_id?: unknown
  totalIndicators?: unknown
  indicators?: unknown
  [key: string]: unknown
}

/** 参与「指标父级反查归口」的指标行最小形状 */
export interface CollegeReportScopeIndicatorLike {
  id?: number | string | null
  parentIndicatorId?: number | string | null
  targetOrgId?: unknown
  responsibleDept?: unknown
  targetOrgName?: unknown
  [key: string]: unknown
}

export interface CollegeReportScopeContext {
  /** 所选学院组织 ID（解析不出为 null → 直接返回 null） */
  collegeOrgId: number | null
  /** 所选学院归一化名（指标归口反查时判定「该学院的子指标」） */
  collegeName: string
  /** 计划创建方组织 ID：战略部登录=战略发展部；职能部门登录=当前选中职能部门 */
  creatorOrgId: number | null
  /** 是否按「归口部门」收口（战略部登录=true；职能部门登录=false——零变化红线） */
  scopeByFunctionalOrg: boolean
  /** 学院页签右侧下拉所选归属部门组织 ID（scopeByFunctionalOrg=true 时必填） */
  selectedDeptOrgId: number | null
  /** 学院页签右侧下拉所选归属部门归一化名（归口字段为空时的兜底反查用） */
  selectedDeptName: string
  /** 当前考核年度 */
  currentYear: number
  /** 计划年份解析（调用方注入既有 resolvePlanYear） */
  resolvePlanYear: (plan: CollegeReportScopePlanLike) => number | null
  /** 部门/学院名归一化（调用方注入 normalizeDepartmentName） */
  normalize: (value?: string | null) => string
}

export interface CollegeReportScope {
  /** 命中的 FUNC_TO_COLLEGE 子计划 id */
  planId: number
  /** 上报归属组织 id（学院 orgId） */
  orgId: number
}

/**
 * 读组织 ID：null / undefined / 空串 / 非正数一律按「无值」处理。
 *
 * <p>注意不可用 {@code Number(value)} 直接判 finite——{@code Number(null)} === 0，
 * 会把「归口字段为空」误判成「归口=0」，导致 legacy 兜底桶永远进不去。</p>
 */
const readOrgId = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

/** 计划是否带存活指标（totalIndicators>0 或详情 indicators 非空；legacy 空壳=false） */
export const collegeScopePlanHasLivingIndicators = (plan: CollegeReportScopePlanLike): boolean => {
  const total = Number(plan.totalIndicators)
  if (Number.isFinite(total) && total > 0) {
    return true
  }
  return Array.isArray(plan.indicators) && plan.indicators.length > 0
}

/** 计划的归口部门 ID（functional_org_id 优先；无值 → null） */
export const collegeScopePlanFunctionalOrgId = (plan: CollegeReportScopePlanLike): number | null =>
  readOrgId(plan.functionalOrgId ?? plan.functional_org_id)

/** 基础匹配：层级 FUNC_TO_COLLEGE + 目标学院 + 创建方 */
const matchesBasePlan = (
  plan: CollegeReportScopePlanLike,
  collegeOrgId: number,
  creatorOrgId: number
): boolean => {
  const level = String(plan.planLevel ?? plan.plan_level ?? '')
    .trim()
    .toUpperCase()
  if (level !== 'FUNC_TO_COLLEGE') {
    return false
  }
  const targetOrgId = readOrgId(plan.targetOrgId ?? plan.org_id ?? plan.orgId)
  if (targetOrgId !== collegeOrgId) {
    return false
  }
  const createdByOrgId = readOrgId(plan.createdByOrgId ?? plan.created_by_org_id)
  return createdByOrgId === creatorOrgId
}

/**
 * legacy 兜底：归口字段为空的历史计划，按「指标父级反查归口」判定归属部门。
 *
 * <p>判定：所选学院名下存在**活跃子指标**（parent_indicator_id 非空），且其父级核心指标
 * 的归口部门（父级的 target/responsible 部门）等于所选部门。父级反查是学院单层下发
 * 改造后唯一的归口线索（子指标本身 target=学院、父级 target=职能部门）。</p>
 *
 * <p>调用方还需叠加「该计划确有存活指标」条件——存量空壳计划（0 指标）不参与。</p>
 */
const legacyIndicatorDeptMatches = (
  indicators: readonly CollegeReportScopeIndicatorLike[],
  context: CollegeReportScopeContext
): boolean => {
  const selectedDeptName = context.normalize(context.selectedDeptName || '')
  const collegeName = context.normalize(context.collegeName || '')
  if (!selectedDeptName) {
    return false
  }
  const indicatorById = new Map<string, CollegeReportScopeIndicatorLike>()
  for (const indicator of indicators) {
    indicatorById.set(String(indicator.id ?? ''), indicator)
  }
  const sameDept = (left: string, right: string): boolean =>
    left === right ||
    (left.length > 0 && right.length > 0 && left.includes(right)) ||
    (left.length > 0 && right.length > 0 && right.includes(left))

  for (const indicator of indicators) {
    const parentId = indicator.parentIndicatorId
    if (parentId === null || parentId === undefined || parentId === '') {
      continue
    }
    // 只认该学院的子指标
    const indicatorTargetOrgId = readOrgId(indicator.targetOrgId)
    const indicatorDept = context.normalize(String(indicator.responsibleDept ?? ''))
    const belongsToCollege =
      (indicatorTargetOrgId !== null && indicatorTargetOrgId === context.collegeOrgId) ||
      (Boolean(collegeName) && sameDept(indicatorDept, collegeName))
    if (!belongsToCollege) {
      continue
    }
    const parent = indicatorById.get(String(parentId))
    if (!parent) {
      continue
    }
    const parentDept = context.normalize(
      String(parent.responsibleDept ?? parent.targetOrgName ?? '')
    )
    if (parentDept && sameDept(parentDept, selectedDeptName)) {
      return true
    }
  }
  return false
}

/**
 * 归口收口（战略部登录）：在基础匹配 + 年度命中后的候选里，按所选归属部门收口。
 *
 * <p>桶优先级：<b>归口桶优先</b>（functional_org_id 精确命中）→ 归口桶为空时才走
 * legacy 兜底桶（归口字段为空 + 有存活指标 + 指标父级反查归口命中）。</p>
 */
const scopeByFunctionalOrg = (
  plans: readonly CollegeReportScopePlanLike[],
  indicators: readonly CollegeReportScopeIndicatorLike[],
  selectedDeptOrgId: number,
  context: CollegeReportScopeContext
): CollegeReportScopePlanLike[] => {
  const functionalBucket = plans.filter(
    plan => collegeScopePlanFunctionalOrgId(plan) === selectedDeptOrgId
  )
  if (functionalBucket.length > 0) {
    return functionalBucket
  }
  return plans.filter(plan => {
    // 归口字段有值但不等于所选部门 → 不回落 legacy 桶（不串台）
    if (collegeScopePlanFunctionalOrgId(plan) !== null) {
      return false
    }
    if (!collegeScopePlanHasLivingIndicators(plan)) {
      return false
    }
    return legacyIndicatorDeptMatches(indicators, context)
  })
}

/**
 * 学院页签 FUNC_TO_COLLEGE 子计划解析（唯一入口，纯函数）。
 *
 * @param plans 全量计划（planStore.plans）
 * @param indicators 全量指标行（normalizedIndicators，用于 legacy 兜底的归口反查）
 * @param context 解析上下文（学院/创建方/所选部门/年度）
 * @returns 命中的计划 id + 上报归属组织 id；解析失败返回 null（调用方按「未下发」保守处理）
 */
export const resolveCollegeReportPlanScope = (
  plans: readonly CollegeReportScopePlanLike[],
  indicators: readonly CollegeReportScopeIndicatorLike[],
  context: CollegeReportScopeContext
): CollegeReportScope | null => {
  const collegeOrgId = readOrgId(context.collegeOrgId)
  const creatorOrgId = readOrgId(context.creatorOrgId)
  if (collegeOrgId === null || creatorOrgId === null) {
    return null
  }

  // 归口收口模式（战略部登录）：所选部门必须解析得到，否则保守不解析
  let selectedDeptOrgId: number | null = null
  if (context.scopeByFunctionalOrg) {
    selectedDeptOrgId = readOrgId(context.selectedDeptOrgId)
    if (selectedDeptOrgId === null) {
      return null
    }
  }

  const baseCandidates = plans.filter(plan => matchesBasePlan(plan, collegeOrgId, creatorOrgId))
  if (baseCandidates.length === 0) {
    return null
  }

  // 跨年度同组合计划并存，必须优先命中年份精确等于当年的；年度不可判定的
  // （resolvePlanYear 返回 null）仅作兜底，否则会把其他年度的空计划当成当前目标。
  const currentYearCandidates = baseCandidates.filter(
    plan => context.resolvePlanYear(plan) === context.currentYear
  )
  const yearCandidates =
    currentYearCandidates.length > 0
      ? currentYearCandidates
      : baseCandidates.filter(plan => context.resolvePlanYear(plan) === null)
  if (yearCandidates.length === 0) {
    return null
  }

  const scopedCandidates =
    selectedDeptOrgId === null
      ? yearCandidates
      : scopeByFunctionalOrg(yearCandidates, indicators, selectedDeptOrgId, context)
  if (scopedCandidates.length === 0) {
    return null
  }

  const planId = readOrgId(scopedCandidates[0].id)
  if (planId === null) {
    return null
  }
  return { planId, orgId: collegeOrgId }
}
