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
 *
 * <p>「该考核周期」无需在本模块额外过滤：学院页签消费的指标列表
 * （store.indicators）本身已按当前考核周期拉取。</p>
 */

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
