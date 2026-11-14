/**
 * 学院「归属部门」口径（2026-11-13 用户拍板：学院上报按归口部门分批提交）。
 *
 * 业务背景：学院子指标由战略发展部创建（owner=战略发展部），但每个学院子指标挂在
 * 某父级核心指标下（parentIndicatorId）；**父级核心指标的归口职能部门
 * （targetOrgId / targetOrgName）才是该子指标的「归属部门」**。
 *
 * 与后端契约对齐（backend ReportApplicationService 2026-11-13）：
 * - 提交时权威归口 = 「报告明细指标 → 父级核心指标.target_org_id」反查落列；
 * - 报告唯一性 = (plan, report_org, month, functional_org_id) 四元组；
 * - 查询端点 GET /reports/plan/{planId}、GET /reports/month/{month}/org/{orgId}
 *   支持可选 query 参数 functionalOrgId（传了=只看该部门的报告）。
 *
 * 本模块是纯函数集合，供 useIndicatorListView（选项聚合/行过滤/提交门禁）与
 * planApi（报告-归口兼容匹配）共用；单测见 functionalDeptScope.unit.test.ts。
 */

/** 行上参与归属解析所需的最小字段（运行时真实字段，弱类型行兼容） */
export interface FunctionalDeptRowLike {
  id?: string | number
  parentIndicatorId?: string | number | null
}

/** 父级核心指标摘要里参与归口解析的字段（来自 getIndicatorById 的 IndicatorResponse） */
export interface ParentFunctionalBrief {
  /** 后端 IndicatorResponse.targetOrgId —— 归口职能部门组织 ID（权威） */
  targetOrgId?: number | string | null
  /** 后端 IndicatorResponse.targetOrgName —— 归口职能部门名称（权威） */
  targetOrgName?: string | null
  /** 兜底字段优先级与 distributeRowOwnership 同口径：responsibleDept → targetDepartment */
  responsibleDept?: string | null
  targetDepartment?: string | null
}

/** 「归属部门」下拉选项：名称 + 归口组织 ID（开草稿/查询透传 functionalOrgId 用） */
export interface FunctionalDeptOption {
  name: string
  /** 父级 targetOrgId；父级缺失 ID 时为 null（此时不能作为提交上下文） */
  orgId: number | null
}

/** 读父级摘要里的归口部门名（优先级 targetOrgName → responsibleDept → targetDepartment） */
export function resolveParentFunctionalDeptName(
  parent: ParentFunctionalBrief | null | undefined
): string | null {
  if (!parent) {
    return null
  }
  const name = String(
    parent.targetOrgName ?? parent.responsibleDept ?? parent.targetDepartment ?? ''
  ).trim()
  return name || null
}

/** 读父级摘要里的归口组织 ID（targetOrgId，正整数才有效） */
export function resolveParentFunctionalOrgId(
  parent: ParentFunctionalBrief | null | undefined
): number | null {
  if (!parent) {
    return null
  }
  const orgId = Number(parent.targetOrgId ?? NaN)
  return Number.isFinite(orgId) && orgId > 0 ? orgId : null
}

/**
 * 「归属部门」选项聚合：行集按父级反查出归口部门集合。
 *
 * - 按名称去重（同一部门多行只出一个选项）；orgId 取该部门下第一个非空 targetOrgId；
 * - 排序：按名称 localeCompare('zh-CN')，稳定且与用户预期一致；
 * - 父级缺失 / 未加载完成的行不产生选项（父级 map 异步补齐后选项自动出现）。
 */
export function aggregateFunctionalDeptOptions<T extends FunctionalDeptRowLike>(
  rows: ReadonlyArray<T>,
  getParent: (row: T) => ParentFunctionalBrief | null | undefined
): FunctionalDeptOption[] {
  const byName = new Map<string, FunctionalDeptOption>()
  rows.forEach(row => {
    const parent = getParent(row)
    const name = resolveParentFunctionalDeptName(parent)
    if (!name) {
      return
    }
    const orgId = resolveParentFunctionalOrgId(parent)
    const existing = byName.get(name)
    if (existing) {
      if (existing.orgId === null && orgId !== null) {
        byName.set(name, { name, orgId })
      }
      return
    }
    byName.set(name, { name, orgId })
  })
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

/**
 * 选中归属部门后的行过滤（精确匹配 functionalDeptName）。
 *
 * 守卫语义（沿用 2026-11-05「筛不对不过滤」口径的行级版）：
 * - 未选部门（空串）→ 不过滤，返回原列表；
 * - 归口未加载完成的行（解析不出部门名）→ **保留**，不误删（宁可多显示，不可显示为空）；
 * - 命中行 = functionalDeptName === 选中部门。
 */
export function filterRowsByFunctionalDept<T extends FunctionalDeptRowLike>(
  list: ReadonlyArray<T>,
  selectedDept: string,
  getRowDeptName: (row: T) => string | null
): T[] {
  const filter = String(selectedDept ?? '').trim()
  if (!filter) {
    return [...list]
  }
  const matched = list.filter(row => getRowDeptName(row) === filter)
  // 整页都没命中（父级全没加载完 / 选中项已失效）→ 不过滤，避免整页滤空
  if (matched.length === 0) {
    return [...list]
  }
  // 归口未加载完成的行（null）保留，不因选中部门被误删
  return list.filter(row => {
    const deptName = getRowDeptName(row)
    return deptName === null || deptName === filter
  })
}

/**
 * 旧/新后端兼容的报告-归口匹配（GET /reports/plan/{planId}?functionalOrgId= 的读侧兜底）。
 *
 * - 调用方未选部门（functionalOrgId 为空）→ 恒匹配（聚合口径，旧行为）；
 * - 新后端：响应报告恒带 functionalOrgId 字段（可能为 null）→ 精确匹配，
 *   null（历史遗留报告）与所选部门不匹配（与后端过滤语义一致）；
 * - 旧后端（本地联调 jar 未含新契约）：响应报告**完全没有** functionalOrgId 字段
 *   （JSON undefined）→ 无法按部门隔离，退回聚合口径（视为匹配），保持旧链路可用。
 */
export function reportMatchesFunctionalOrg(
  report: { functionalOrgId?: number | string | null },
  functionalOrgId?: number | string | null
): boolean {
  if (functionalOrgId === undefined || functionalOrgId === null) {
    return true
  }
  if (report.functionalOrgId === undefined) {
    // 旧后端哨兵：字段缺失 = 无法按部门过滤
    return true
  }
  return Number(report.functionalOrgId) === Number(functionalOrgId)
}

/**
 * 「归属部门」选中值写入侧归一（2026-11-13 白屏修复）。
 *
 * el-select clearable 点叉叉清空时 Element Plus 默认 emit **undefined**
 * （valueOnClear 默认值），不是空串——直落 ref 会让下游读
 * `filterOwnerDept.value.trim()` 的 computed 在渲染期抛
 * `TypeError: Cannot read properties of undefined (reading 'trim')`
 * → 整页组件树卸载白屏。在唯一写入口归一回 ''（= 未选态语义不变：
 * 占位符「请选择归属部门」、行集全显、摘要链回聚合口径）。
 */
export function normalizeFunctionalDeptSelection(value: unknown): string {
  return String(value ?? '').trim()
}

/**
 * 名称 → 选中「归属部门」选项（useIndicatorListView.selectedFunctionalDeptOption 的纯逻辑）：
 * 未选（空串）→ null；选项集里找不到（选中项已失效）→ null。
 */
export function resolveSelectedFunctionalDeptOption(
  options: ReadonlyArray<FunctionalDeptOption>,
  selectedName: unknown
): FunctionalDeptOption | null {
  const selected = normalizeFunctionalDeptSelection(selectedName)
  if (!selected) {
    return null
  }
  return options.find(option => option.name === selected) ?? null
}

/**
 * 选中选项 → 提交上下文归口组织 ID（useIndicatorListView.currentFunctionalOrgId 的纯逻辑）：
 * 未选（null/undefined）→ undefined（聚合口径，与旧行为一致，绝不抛）；
 * 选项无有效 orgId（父级缺失）→ undefined。
 */
export function resolveFunctionalOrgIdForContext(
  option: FunctionalDeptOption | null | undefined
): number | undefined {
  const orgId = option?.orgId
  return typeof orgId === 'number' && orgId > 0 ? orgId : undefined
}
