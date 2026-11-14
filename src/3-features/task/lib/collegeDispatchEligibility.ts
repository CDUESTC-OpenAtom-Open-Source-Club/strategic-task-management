/**
 * 2026-11-10（用户拍板）：学院页签「职能部门」下拉的**下发资格判定**（纯函数，
 * 供 useStrategicTaskView 的 collegeDeptDispatchOptions / handleCollegeDeptFilterChange 消费）。
 *
 * <p>用户原口径：只有存在「<b>已下发</b>」核心指标的职能部门才可选中；未收到已下发
 * 任务的部门 → 灰色样式，可点击但点击弹提示「当前职能部门未有已下发的任务」且不选中。</p>
 *
 * <p>资格口径（技术实现）：<b>该部门在该考核周期内至少存在一条「核心指标」
 * （无父指标，即 parentIndicatorId 为空）且其指标状态为「已下发」（DISTRIBUTED）</b>。
 * 状态取值依据共享类型 {@code IndicatorStatus}（5-shared/types/backend-aligned.ts）：
 * 生命周期 DRAFT → PENDING_REVIEW → <b>DISTRIBUTED</b> → ARCHIVED，
 * 其中 <b>ACTIVE 是旧数据的「已下发」等价状态</b>（与 task/lib/planStatus.ts 的
 * ACTIVE→DISTRIBUTED 归一同口径）。子指标（有 parentIndicatorId）不算资格依据
 * ——子指标是学院在核心指标下拆分的，不代表「该部门下发过」。</p>
 * ——子指标是学院在核心指标下拆分的，不代表「该部门下发过」。</p>
 *
 * <p>「该考核周期」无需在本模块额外过滤：学院页签消费的指标列表
 * （store.indicators）本身已按当前考核周期拉取。</p>
 */

import { normalizePlanStatus } from './planStatus'

/** 学院页签下拉项（collegeDeptDropdownItems 的最小形状） */
export interface CollegeDeptDispatchOptionLike {
  dept: string
  /** 该部门在该考核周期存在「已下发」核心指标 = true（可选中） */
  eligible: boolean
}

/** 指标行的最小形状（宽松兼容后端 VO / 前端归一化行） */
export interface DispatchEligibilityIndicatorLike {
  status?: unknown
  parentIndicatorId?: number | string | null
  [key: string]: unknown
}

/**
 * 无资格部门点击下拉时的统一提示文案（实现与单测共用同一常量，防漂移）。
 */
export const COLLEGE_DEPT_INELIGIBLE_WARNING = '当前职能部门未有已下发的任务'

/**
 * 单条指标是否构成「已下发核心指标」（资格依据的最小单元）。
 *
 * <ul>
 *   <li>状态归一（去空格、大写）后等于 DISTRIBUTED 视为已下发；ACTIVE 为旧数据
 *       等价状态，同样视为已下发（与 planStatus.ts 归一表同口径）；</li>
 *   <li>核心指标 = parentIndicatorId 为空（null / undefined / 空串）；
 *       有父指标的子指标不构成资格依据。</li>
 * </ul>
 */
export const isDistributedCoreIndicator = (
  indicator: DispatchEligibilityIndicatorLike
): boolean => {
  const status = String(indicator.status ?? '')
    .trim()
    .toUpperCase()
  if (status !== 'DISTRIBUTED' && status !== 'ACTIVE') {
    return false
  }
  const parentId = indicator.parentIndicatorId
  return parentId === null || parentId === undefined || parentId === ''
}

/**
 * 部门是否有下发资格：该部门的指标里存在至少一条「已下发核心指标」。
 *
 * @param indicators 该部门（在该学院、该考核周期）名下的全部指标行
 */
export const isCollegeDispatchDeptEligible = (
  indicators: readonly DispatchEligibilityIndicatorLike[]
): boolean => indicators.some(isDistributedCoreIndicator)

/**
 * 全量资格聚合：遍历**全量**指标行（**不按学院过滤**），对每条「已下发核心指标」，
 * 以其目标部门为键标记 eligible。
 *
 * <p>2026-11-10 缺陷修复背景：collegeDeptDispatchOptions 原先只聚合「学院行」
 * （target=所选学院），而核心指标行（owner=战略部、target=职能部门）在「按学院
 * 过滤」阶段就被 continue 跳过，永远进不了 eligible 判定 —— 「纪委办名下 3 条
 * DISTRIBUTED 核心指标（target=纪委办、parent 为空），学院名下却零学院行」时
 * 该部门被误判无资格、点击被拦截。本函数补全这一数据源：核心指标的 target
 * 即其归属职能部门，取部门名的字段链与学院行聚合一致
 * （targetDepartment || targetOrgName || responsibleDept，用 `||` 使空串也兜底）。</p>
 *
 * <p>「该考核周期」无需额外过滤：normalizedIndicators 本身按当前考核周期全量
 * 拉取（store 走 getAllIndicators，不分学院）。</p>
 *
 * @param indicators 全量指标行（normalizedIndicators）
 * @param resolveDeptName 行 → 目标部门标准名（调用方注入 normalizeDepartmentName，
 *        内含别名/ID 映射兜底，lib 层保持零依赖）
 */
export const buildCollegeDeptEligibleByDept = (
  indicators: readonly DispatchEligibilityIndicatorLike[],
  resolveDeptName: (indicator: DispatchEligibilityIndicatorLike) => string
): Map<string, boolean> => {
  const eligibleByDept = new Map<string, boolean>()
  for (const item of indicators) {
    if (!isDistributedCoreIndicator(item)) {
      continue
    }
    const dept = resolveDeptName(item)
    if (!dept) {
      continue
    }
    eligibleByDept.set(dept, true)
  }
  return eligibleByDept
}

/**
 * 下拉选中分流：eligible 部门放行；无资格（或未知）部门拦截。
 *
 * <p>拦截后由调用方弹 {@link COLLEGE_DEPT_INELIGIBLE_WARNING} 提示并**不落选**——
 * 选中值 collegeDispatchDeptFilter 保持原样，两步选择的 gate 逻辑因此自洽。</p>
 */
export const resolveCollegeDeptFilterSelection = (
  items: readonly CollegeDeptDispatchOptionLike[],
  command: unknown
): { accepted: boolean; dept: string; intercepted: boolean } => {
  const dept = String(command ?? '')
  const hit = items.find(item => item.dept === dept)
  if (!hit || !hit.eligible) {
    return { accepted: false, dept, intercepted: true }
  }
  return { accepted: true, dept, intercepted: false }
}

/**
 * 学院页签「当前所选部门」回显（2026-11-13 回显缺陷修复，纯函数，实现与单测共用）。
 *
 * <p>缺陷（用户实测）：学院页签选完职能部门后，页签上的下拉按钮仍显示占位
 * 「请选择职能部门」。复现 dump（zlb_admin → 工学院 → 选「纪委办公室 | 监察处」）：
 * filter="纪委办公室 | 监察处"、effective=同值、collegeDeptDispatchOptions=[]（当前库
 * 该学院名下零学院行）→ 旧实现只在 dispatchOptions 里找 → find 不命中 → current=null。</p>
 *
 * <p>根因：旧注释假设「filter 只可能命中 eligible 部门，而 eligible 部门必然在
 * dispatchOptions 里」不成立——资格（eligible）来自「已下发核心指标」（target=职能部门），
 * 而 dispatchOptions 只聚合「target=所选学院」的学院行；部门有资格但尚无学院行时
 * 不在 dispatchOptions 里。另一个潜在坑：dispatchOptions 的 dept 是
 * resolveRowOwnerDept 的原始串（未过 normalizeDepartmentName），与 effective
 * （归一化值）做全等比较，别名形态会失配。</p>
 *
 * <p>修复口径：双侧归一后比较，依次回退 dispatchOptions → dropdownItems（覆盖全部
 * 可选部门，回显与下拉项一致的全名）→ filter 归一值兜底（选中态永不丢）。</p>
 */
export const resolveCollegeDeptCurrent = (params: {
  /** 归一化后的筛选值（collegeDispatchDeptEffective） */
  effectiveDept: string
  /** 学院行聚合选项（可为空数组——零学院行部门的常态） */
  dispatchOptions: readonly CollegeDeptDispatchOptionLike[]
  /** 下拉完整选项（全部职能部门，含无资格部门） */
  dropdownItems: readonly CollegeDeptDispatchOptionLike[]
  normalize: (value?: string | null) => string
}): CollegeDeptDispatchOptionLike | null => {
  const effective = params.normalize(params.effectiveDept || '')
  if (!effective) {
    return null
  }
  const match = (items: readonly CollegeDeptDispatchOptionLike[]) =>
    items.find(item => params.normalize(item.dept) === effective) ?? null
  return (
    match(params.dispatchOptions) ??
    match(params.dropdownItems) ?? {
      // 兜底：filter 只能经 resolveCollegeDeptFilterSelection 的 eligible 放行写入，
      // 走到这说明两份列表都没赶上数据刷新——按选中态回显归一值本身
      dept: effective,
      count: 0,
      eligible: true,
      dispatchStatus: 'none',
      reportStatus: 'none'
    }
  )
}

/**
 * 学院锚点核心指标（2026-11-13 方案甲恢复，纯函数，实现与单测共用）。
 *
 * <p>口径与后端导入锚点（BusinessImportApplicationService → JpaIndicatorRepository
 * {@code findCoreDispatchAnchors}）逐条对齐：</p>
 * <ul>
 *   <li>根指标（parentIndicatorId 为空，{@link isDistributedCoreIndicator} 同时收敛
 *       「status=DISTRIBUTED/ACTIVE」——草稿核心指标不能做父级锚点）；</li>
 *   <li>owner = 战略发展部（「战略部 → 职能部门」那批核心指标）；</li>
 *   <li>目标部门 = 学院页签右侧下拉所选职能部门（collegeDispatchDeptEffective）；
 *       学院本身只作为子指标接收方，不参与父级筛选；</li>
 *   <li>按 id 升序输出——后端锚点 ORDER BY i.id，导入的父级组顺序校验按该序做
 *       子序列判定，前端预填/下拉若乱序会误触发「顺序不符」阻断。</li>
 * </ul>
 *
 * @param indicators 全量指标行（normalizedIndicators，已按当前考核周期拉取）
 * @param params.ownerDept 学院页签右侧下拉所选职能部门（未选为空 → 无锚点）
 * @param params.strategicDeptName 战略发展部标准名（取不到时跳过 owner 校验，fail-open）
 * @param params.normalize 调用方注入 normalizeDepartmentName（别名/ID 映射兜底）
 */
export const buildCollegeParentAnchorIndicators = (
  indicators: readonly DispatchEligibilityIndicatorLike[],
  params: {
    ownerDept: string
    strategicDeptName: string
    normalize: (value?: string | null) => string
  }
): DispatchEligibilityIndicatorLike[] => {
  const ownerDept = params.normalize(params.ownerDept || '')
  if (!ownerDept) {
    return []
  }
  const strategic = params.normalize(params.strategicDeptName || '')
  return indicators
    .filter(item => {
      if (!isDistributedCoreIndicator(item)) {
        return false
      }
      const candidate = item as {
        ownerDept?: string
        targetDepartment?: string
        targetOrgName?: string
        responsibleDept?: string
      }
      if (strategic && params.normalize(candidate.ownerDept || '') !== strategic) {
        return false
      }
      const targetDeptName = params.normalize(
        String(
          candidate.targetDepartment ?? candidate.targetOrgName ?? candidate.responsibleDept ?? ''
        )
      )
      return targetDeptName === ownerDept || targetDeptName.includes(ownerDept)
    })
    .sort((left, right) => Number(left.id ?? 0) - Number(right.id ?? 0))
}

/**
 * 学院页签下拉「部门 × 所选学院」的下发计划状态表（2026-11-13 状态徽标修正，
 * 纯函数，实现与单测共用）。
 *
 * <p>缺陷（用户实测）：工学院 × 教务处已有 DISTRIBUTED 下发计划 705488，但下拉里
 * 「教务处」右侧空白——旧判定 basis 是「学院行聚合」（target=学院 的指标行按
 * ownerDept 分组取 indicator.status），教务处在该学院名下没有 owner=教务处 的行
 * （改造后子指标 owner=战略发展部），dispatchStatus 落 'none'；而 eligible 又因
 * 「已下发核心指标 target=教务处」为 true → 「未下发」tag 不显示、其它 tag 也不
 * 命中 → 空白。用户口径：已下发 → 「已下发」，没下发 → 「未下发」，不允许空白。</p>
 *
 * <p>新口径：判定基准改为「战略发展部 → 该学院 × 该部门的 FUNC_TO_COLLEGE 计划
 * （created_by=35，V104 起归口部门在 plan.functional_org_id）的计划状态」：</p>
 * <ul>
 *   <li>DISTRIBUTED / APPROVED → 「已下发」；</li>
 *   <li>PENDING / IN_REVIEW / SUBMITTED → 「审批中」；</li>
 *   <li>DRAFT / WITHDRAWN / 其余 → 「草稿」；</li>
 *   <li>无计划 → 「未下发」（沿用既有 tag，模板按 statusMap 缺失回退）。</li>
 *   文案复用 planStatus.ts 既有词表（getPlanStatusDisplay），零新文案。</li>
 * </ul>
 *
 * <p>匹配口径（与 /distribution 分发页归口锚定同族）：</p>
 * <ul>
 *   <li>planLevel = FUNC_TO_COLLEGE、target = 所选学院（orgId 或归一化名）、
 *       年份精确等于当前年；</li>
 *   <li>部门归属：<b>归口优先</b>（plan.functional_org_id = 部门 orgId）；
 *       缺失时回退 legacy（plan.created_by_org_id = 部门 orgId）且计划必须有
 *       <b>存活指标</b>——legacy 空壳计划（0 任务，如 404456）不参与状态展示，
 *       否则工学院下拉全员变「草稿」，验收口径「其余部门=未下发」被破坏；</li>
 *   <li>同部门多份计划：归口桶优先 → 已下发优先 → id 倒序。</li>
 * </ul>
 */
export interface CollegeDeptPlanStatusPlanLike {
  id?: number | string | null
  status?: unknown
  planLevel?: unknown
  targetOrgId?: unknown
  orgId?: unknown
  org_id?: unknown
  targetOrgName?: unknown
  orgName?: unknown
  createdByOrgId?: unknown
  created_by_org_id?: unknown
  functionalOrgId?: unknown
  functional_org_id?: unknown
  totalIndicators?: unknown
  indicators?: unknown
  [key: string]: unknown
}

export interface CollegeDeptPlanStatusContext {
  /** 所选学院组织 ID（解析不出为 null，退归一化名匹配） */
  collegeOrgId: number | null
  /** 所选学院归一化名 */
  collegeName: string
  currentYear: number
  /** 计划年份解析（调用方注入既有 resolvePlanYear） */
  resolvePlanYear: (plan: CollegeDeptPlanStatusPlanLike) => number | null
  /** 部门名 → 组织 ID（调用方注入 resolveDepartmentIdByName） */
  resolveDeptOrgId: (deptName: string) => number | null
  /** 部门/学院名归一化（调用方注入 normalizeDepartmentName） */
  normalize: (value?: string | null) => string
}

const toFiniteNumber = (value: unknown): number => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : Number.NaN
}

/** 计划是否带存活指标（totalIndicators>0 或详情 indicators 非空；legacy 空壳=false） */
const hasLivingIndicators = (plan: CollegeDeptPlanStatusPlanLike): boolean => {
  const total = toFiniteNumber(plan.totalIndicators)
  if (Number.isFinite(total) && total > 0) {
    return true
  }
  return Array.isArray(plan.indicators) && plan.indicators.length > 0
}

export interface CollegeDeptPlanWinner {
  /** 获胜计划的 id（Number 归一；解析不出为 null——仅状态可用） */
  planId: number | null
  /** 获胜计划的原始状态串（trim 后；映射到词表由消费方/resolveCollegeDeptPhaseBadge 做） */
  status: string
}

export const buildCollegeDeptPlanWinnerByDept = (
  plans: readonly CollegeDeptPlanStatusPlanLike[],
  depts: readonly string[],
  context: CollegeDeptPlanStatusContext
): Map<string, CollegeDeptPlanWinner> => {
  const winnerByDept = new Map<string, CollegeDeptPlanWinner>()

  // 学院公共匹配先算一次（与部门无关）
  const collegePlans = plans.filter(plan => {
    if (context.resolvePlanYear(plan) !== context.currentYear) {
      return false
    }
    const planLevel = String(plan.planLevel ?? '')
      .trim()
      .toUpperCase()
    if (planLevel && planLevel !== 'FUNC_TO_COLLEGE') {
      return false
    }
    const targetOrgId = toFiniteNumber(plan.targetOrgId ?? plan.org_id ?? plan.orgId)
    const matchesOrgId =
      context.collegeOrgId != null &&
      Number.isFinite(targetOrgId) &&
      targetOrgId === context.collegeOrgId
    if (matchesOrgId) {
      return true
    }
    const targetName = context.normalize(String(plan.targetOrgName ?? plan.orgName ?? '').trim())
    return Boolean(context.collegeName) && targetName === context.collegeName
  })

  const statusRank = (plan: CollegeDeptPlanStatusPlanLike): number =>
    String(plan.status ?? '')
      .trim()
      .toUpperCase() === 'DISTRIBUTED'
      ? 1
      : 0

  for (const dept of depts) {
    const deptName = context.normalize(dept)
    if (!deptName || winnerByDept.has(deptName)) {
      continue
    }
    const deptOrgId = context.resolveDeptOrgId(dept)
    if (deptOrgId == null || !Number.isFinite(deptOrgId)) {
      continue
    }

    const candidates = collegePlans.filter(plan => {
      const planFunctionalOrgId = toFiniteNumber(plan.functionalOrgId ?? plan.functional_org_id)
      if (Number.isFinite(planFunctionalOrgId)) {
        // 归口桶：functional_org_id 命中即为真数据源（不看 created_by）
        return planFunctionalOrgId === deptOrgId
      }
      // legacy 回退桶：created_by 命中且必须有存活指标（空壳不算）
      const planCreatedByOrgId = toFiniteNumber(plan.createdByOrgId ?? plan.created_by_org_id)
      return (
        Number.isFinite(planCreatedByOrgId) &&
        planCreatedByOrgId === deptOrgId &&
        hasLivingIndicators(plan)
      )
    })
    if (candidates.length === 0) {
      continue
    }

    const functionalBucket = candidates.filter(plan => {
      const planFunctionalOrgId = toFiniteNumber(plan.functionalOrgId ?? plan.functional_org_id)
      return Number.isFinite(planFunctionalOrgId) && planFunctionalOrgId === deptOrgId
    })
    const bucket = functionalBucket.length > 0 ? functionalBucket : candidates
    const winner = [...bucket].sort(
      (left, right) =>
        statusRank(right) - statusRank(left) ||
        toFiniteNumber(right.id ?? 0) - toFiniteNumber(left.id ?? 0)
    )[0]
    if (winner) {
      const winnerPlanId = toFiniteNumber(winner.id)
      winnerByDept.set(deptName, {
        planId: Number.isFinite(winnerPlanId) ? winnerPlanId : null,
        status: String(winner.status ?? '').trim()
      })
    }
  }

  return winnerByDept
}

/**
 * 学院页签下拉「部门 × 所选学院」的下发计划状态表（2026-11-13 状态徽标修正，
 * 纯函数，实现与单测共用）。
 *
 * <p>{@link buildCollegeDeptPlanWinnerByDept} 的状态视图（Map&lt;部门名, 计划原始状态&gt;），
 * 既有消费方（单测/模板契约）沿用该签名；需要获胜计划 id（上报状态按 plan 拉取分组）
 * 的消费方改用 winner 版本。</p>
 */
export const buildCollegeDeptPlanStatusByDept = (
  plans: readonly CollegeDeptPlanStatusPlanLike[],
  depts: readonly string[],
  context: CollegeDeptPlanStatusContext
): Map<string, string> => {
  const statusByDept = new Map<string, string>()
  for (const [dept, winner] of buildCollegeDeptPlanWinnerByDept(plans, depts, context)) {
    statusByDept.set(dept, winner.status)
  }
  return statusByDept
}

/**
 * PLAN_REPORT 行的最小形状（宽松兼容 PlanReportSimpleResponse / 前端归一化行）。
 */
export interface CollegeDeptPlanReportLike {
  id?: number | string | null
  /** 报告归口职能部门 ID（后端 2026-11-13 新契约；历史遗留报告为 null，旧后端无此字段） */
  functionalOrgId?: number | string | null
  status?: unknown
  /** 工作流状态（enrichPlanReportWorkflow 合并写入；优先于 status 取用） */
  workflowStatus?: unknown
  submittedAt?: string | null
  createdAt?: string | null
  isDeleted?: boolean | null
  [key: string]: unknown
}

/**
 * 「部门 × 所选学院」的上报状态表（2026-11-13 徽标合并：上报维度并入单一 tag，
 * 纯函数，实现与单测共用）。
 *
 * <p>数据源方案（避免每部门单独发请求）：对每个部门的**获胜计划**各拉一次
 * {@code GET /reports/plan/{planId}} 全量报告列表（planApi 缓存 + 在途去重），
 * 前端按 report.functionalOrgId 分组归属到部门——旧共享计划（一份计划装多部门
 * 报告）一次拉全即覆盖全部部门；V104 起每部门独立计划时每计划一次请求（已是
 * 后端能提供的最小粒度）。调用方把多份列表按 planId 装进 reportsByPlanId 传入。</p>
 *
 * <ul>
 *   <li>过滤 isDeleted === true 的行；</li>
 *   <li>归口匹配：report.functionalOrgId 为数字 → 精确等于部门 orgId 才归属；
 *       null（历史遗留）/ undefined（旧后端）→ 无法按部门隔离，归属到**该部门的
 *       获胜计划**名下（报告挂在该部门自己的计划上，保守归该部门）；</li>
 *   <li>同部门多份报告取「最新一轮」：submittedAt（提交固定时刻）→ createdAt → id
 *       降序（与 planApi 轮次排序同口径，updatedAt 语义是"任何修改"不可用）；</li>
 *   <li>状态取 workflowStatus ?? status 归一（trim + 大写）；无状态不入表。</li>
 * </ul>
 */
export const buildCollegeDeptReportStatusByDept = (params: {
  winnerByDept: ReadonlyMap<string, CollegeDeptPlanWinner>
  reportsByPlanId: ReadonlyMap<number | string, readonly CollegeDeptPlanReportLike[]>
  resolveDeptOrgId: (deptName: string) => number | null
}): Map<string, string> => {
  const reportStatusByDept = new Map<string, string>()

  const reportRecencyRank = (report: CollegeDeptPlanReportLike): number => {
    const submittedAt = Date.parse(String(report.submittedAt ?? ''))
    if (Number.isFinite(submittedAt)) {
      return submittedAt
    }
    const createdAt = Date.parse(String(report.createdAt ?? ''))
    if (Number.isFinite(createdAt)) {
      return createdAt
    }
    return toFiniteNumber(report.id ?? 0) || 0
  }

  for (const [dept, winner] of params.winnerByDept) {
    if (winner.planId == null) {
      continue
    }
    const reports =
      params.reportsByPlanId.get(winner.planId) ??
      params.reportsByPlanId.get(String(winner.planId)) ??
      []
    const deptOrgId = params.resolveDeptOrgId(dept)
    if (deptOrgId == null || !Number.isFinite(deptOrgId)) {
      continue
    }
    const deptReports = reports.filter(report => {
      if (report.isDeleted === true) {
        return false
      }
      if (report.functionalOrgId === undefined || report.functionalOrgId === null) {
        return true
      }
      return Number(report.functionalOrgId) === deptOrgId
    })
    if (deptReports.length === 0) {
      continue
    }
    const latest = [...deptReports].sort(
      (left, right) => reportRecencyRank(right) - reportRecencyRank(left)
    )[0]
    const status = String(latest?.workflowStatus ?? latest?.status ?? '')
      .trim()
      .toUpperCase()
    if (status) {
      reportStatusByDept.set(dept, status)
    }
  }

  return reportStatusByDept
}

/** 下拉单一状态徽标（label = 既有词表文案；tagType 供 el-tag :type 与内联着色） */
export interface CollegeDeptPhaseBadge {
  label: string
  tagType: 'success' | 'warning' | 'info' | 'danger'
}

/**
 * 「无 FUNC_TO_COLLEGE 计划」的徽标兜底（模板既有「未下发」warning tag 收口进词表常量）。
 *
 * <p>2026-11-13 徽标合并后模板改为**单一无条件 el-tag**（label/type 全绑定）：
 * 消费方对 resolveCollegeDeptPhaseBadge 的 null（无计划）套用本常量。此前
 * 「v-if 徽标 + v-else 兜底」的分支写法在菜单隐藏（popper display:none）期间
 * 换分支时，el-tag 内置 el-zoom-in-center 过渡的 leave 动画收不到 transitionend、
 * 新旧两个 tag 同时滞留 DOM（工学院×纪委办实测「已上报+未下发」并存）——
 * 单实例绑定让 el-tag 永不卸载，从根上消除双 tag。</p>
 */
export const COLLEGE_DEPT_NOT_DISPATCHED_BADGE: CollegeDeptPhaseBadge = {
  label: '未下发',
  tagType: 'warning'
}

/**
 * 单一状态徽标判定（2026-11-13 用户拍板「只能显示一个状态」，纯函数，实现与单测共用）。
 *
 * <p>合并口径（业务流转当前阶段，阶段优先取最新）：</p>
 * <ul>
 *   <li>无 FUNC_TO_COLLEGE 计划（planStatus 归一不出）→ null（模板回退「未下发」，
 *       该词为模板既有文案）；</li>
 *   <li>计划 DRAFT / WITHDRAWN / 其余（REJECTED 等回退态按 planStatus 归一表落
 *       DRAFT）→ 「草稿」（planStatus.ts 既有词表）；</li>
 *   <li>计划下发审批中（PENDING，归一表含 IN_REVIEW / SUBMITTED）→ 「审批中」；</li>
 *   <li>计划已下发（DISTRIBUTED，归一表含 APPROVED / ACTIVE 等）——此后以该学院×
 *       部门的<b>上报侧最新状态</b>为主：</li>
 * </ul>
 *
 * <p>上报侧映射（词全部为代码库既有文案，零新增）：</p>
 * <ul>
 *   <li>PENDING / IN_REVIEW / SUBMITTED（上报在审）→ 「审批中」（与下发在审同词，
 *       用户明确接受「两个审批中共用同一个词」）；</li>
 *   <li>REJECTED / RETURNED / CANCELLED（上报被退回）→ 「已回退」（既有文案，
 *       见 approvalFlowStatusMeta / resolveCollegeReportApprovalStatusMeta）；
 *       WITHDRAWN（上报自撤回）按同族「退回待重报」语义并入「已回退」——其专属
 *       文案「上报已撤回（待重新上报）」对本下拉属新增词，词表零新增约束下保守
 *       复用「已回退」；</li>
 *   <li>APPROVED（上报归档）→ 「已上报」；</li>
 *   <li>尚无上报 / 上报草稿 / 未知 → 「已下发」（上报未开始，停留已下发阶段）。</li>
 * </ul>
 */
export const resolveCollegeDeptPhaseBadge = (params: {
  planStatus?: string | null
  reportStatus?: string | null
}): CollegeDeptPhaseBadge | null => {
  const canonical = normalizePlanStatus(params.planStatus)
  if (!canonical) {
    return null
  }
  if (canonical === 'PENDING') {
    return { label: '审批中', tagType: 'warning' }
  }
  if (canonical === 'DRAFT') {
    return { label: '草稿', tagType: 'info' }
  }
  // canonical === 'DISTRIBUTED'：下发已完成，展示上报侧最新状态
  const reportStatus = String(params.reportStatus ?? '')
    .trim()
    .toUpperCase()
  if (['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(reportStatus)) {
    return { label: '审批中', tagType: 'warning' }
  }
  if (['REJECTED', 'RETURNED', 'CANCELLED', 'WITHDRAWN'].includes(reportStatus)) {
    return { label: '已回退', tagType: 'danger' }
  }
  if (reportStatus === 'APPROVED') {
    return { label: '已上报', tagType: 'success' }
  }
  return { label: '已下发', tagType: 'success' }
}
