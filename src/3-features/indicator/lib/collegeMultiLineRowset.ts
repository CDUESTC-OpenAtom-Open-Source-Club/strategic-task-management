/**
 * 学院「多归口线」行集聚合口径（2026-11-18 用户拍板：学院×多线填报修复）。
 *
 * 业务背景：同一学院可能同时收到**多条** FUNC_TO_COLLEGE 归口线（每条 = 一个
 * FUNC_TO_COLLEGE plan，归口职能部门各不相同，如「教务处」一条、「数字校园建设
 * 办公室」一条）。修复前填报页行集基座取「单一 selectedCollegePlan」的 plan 子指标
 * （collegePlanCandidates.find 只取第一条），其它线整条不可见、归属部门下拉只剩一个
 * 选项（2026-11-18 复现报告 B1/B2）。
 *
 * 本模块是纯函数集合，供 useIndicatorListView 的多线聚合行集共用：
 * - buildCollegePlanLineSnapshots：逐线快照（状态/可见性/下发月/是否有内容），
 *   可见性沿用既有口径 canViewReceivedPlanContent（非 DISTRIBUTED 不下发内容）；
 * - mergeCollegeLineRows：可见线子指标合并（按行 id 去重、保持线的先后顺序，
 *   排序由调用方 compareCollegeIndicatorRows 负责）；
 * - resolveCollegeLinePlanIdByFunctionalDept：行级归口反查——选中「归属部门」
 *   → 该归口所在线的 planId（选中归口与计划线的绑定关系）；
 * - resolveCollegeAggregateDispatchMonth：多线下发月取 earliest（未选归口时的
 *   填报周期起算月兜底）；
 * - resolveCollegePlanStatusSummary：多线计划状态汇总（全同=单态；不同=mixed，
 *   供「多线汇总」类展示判定）。
 *
 * 单测见 __tests__/collegeMultiLineRowset.test.ts。
 */

import { canViewReceivedPlanContent as canViewPlanContentByStatus } from './visibility'

/** 学院候选计划线的最小字段形状（plan 列表行或详情缓存，弱类型兼容） */
export interface CollegePlanLineSource {
  id?: number | string | null
  status?: string | null
  dispatchMonth?: string | null
  indicatorCount?: number | string | null
  indicators?: unknown
}

/** 逐线快照：多线行集聚合与展示判定的最小依据 */
export interface CollegePlanLineSnapshot {
  planId: string
  /** 归一化大写状态；缺失为 null */
  status: string | null
  /** 该线内容对学院是否可见（非战略视角：仅 DISTRIBUTED，沿用既有口径） */
  visible: boolean
  /** 6 位下发月（YYYYMM）；缺失/非法为 '' */
  dispatchMonth: string
  /** 该线是否有可展示的指标内容（明细 indicators 非空，或 indicatorCount>0） */
  hasIndicatorContent: boolean
}

function toLineKey(value: unknown): string {
  return String(value ?? '')
}

function normalizeDispatchMonth(value: unknown): string {
  const raw = String(value ?? '').trim()
  return /^\d{6}$/.test(raw) ? raw : ''
}

function countIsPositive(value: unknown): boolean {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0
}

/**
 * 逐线快照聚合：候选 plans × 详情缓存 → 每条线的状态/可见性/下发月/内容标记。
 *
 * - 详情缓存（planDetailsMap）字段优先，plan 列表行兜底（与既有读取顺序一致）；
 * - visible 用非战略视角口径 canViewPlanContentByStatus(status, false)——
 *   与填报页「已下发才可见」、全部导出「未下发不导出」同一条口径。
 */
export function buildCollegePlanLineSnapshots(
  plans: ReadonlyArray<CollegePlanLineSource>,
  planDetailsMap: Record<string, CollegePlanLineSource | undefined> = {}
): CollegePlanLineSnapshot[] {
  return plans.map(plan => {
    const planId = toLineKey(plan.id)
    const detail = planDetailsMap[planId]
    const status =
      String(detail?.status ?? plan.status ?? '')
        .trim()
        .toUpperCase() || null
    const dispatchMonth = normalizeDispatchMonth(detail?.dispatchMonth ?? plan.dispatchMonth)
    const detailIndicators = detail?.indicators
    const planIndicators = plan.indicators
    const hasIndicatorContent =
      (Array.isArray(detailIndicators) && detailIndicators.length > 0) ||
      (Array.isArray(planIndicators) && planIndicators.length > 0) ||
      countIsPositive(detail?.indicatorCount ?? plan.indicatorCount)
    return {
      planId,
      status,
      visible: canViewPlanContentByStatus(status, false),
      dispatchMonth,
      hasIndicatorContent
    }
  })
}

/**
 * 可见线子指标合并：按线先后顺序 concat，行 id 重复时保留首个（详情行优先于兜底行）。
 * 不排序——学院页排序统一由调用方 compareCollegeIndicatorRows 收口。
 */
export function mergeCollegeLineRows<T extends { id?: number | string | null }>(
  lineRows: ReadonlyArray<ReadonlyArray<T>>
): T[] {
  const seen = new Set<string>()
  const merged: T[] = []
  lineRows.forEach(rows => {
    rows.forEach(row => {
      const key = toLineKey(row?.id)
      if (key && seen.has(key)) {
        return
      }
      if (key) {
        seen.add(key)
      }
      merged.push(row)
    })
  })
  return merged
}

/** 行集线引用：该线的 planId + 已映射行（供行级归口反查绑定） */
export interface CollegeLineRowsRef<T> {
  planId: string
  rows: ReadonlyArray<T>
}

/**
 * 行级归口反查：选中「归属部门」→ 该归口所在线的 planId。
 *
 * - 命中 = 线内至少一行经 getRowDeptName 解析出的归口部门名 === 选中部门；
 * - 多线同归口（理论上不应出现，同名归口选项已去重）取先出现的线；
 * - 找不到（父级 map 未加载完/选中项失效）→ null，由调用方走既有兜底，
 *   不让计划上下文闪空。
 */
export function resolveCollegeLinePlanIdByFunctionalDept<T>(
  lineRows: ReadonlyArray<CollegeLineRowsRef<T>>,
  selectedDept: string,
  getRowDeptName: (row: T) => string | null
): string | null {
  const selected = String(selectedDept ?? '').trim()
  if (!selected) {
    return null
  }
  const matched = lineRows.find(line => line.rows.some(row => getRowDeptName(row) === selected))
  return matched ? matched.planId : null
}

/**
 * 多线下发月汇总：未选归口时的填报周期起算月 = 所有可见线中**最早**的下发月
 * （6 位 YYYYMM 取最小）；全不可得时 ''（调用方降级既有口径）。
 */
export function resolveCollegeAggregateDispatchMonth(
  months: ReadonlyArray<string | null | undefined>
): string {
  const valid = months
    .map(month => normalizeDispatchMonth(month))
    .filter(month => month !== '')
    .sort()
  return valid[0] ?? ''
}

/** 多线计划状态汇总：全同= single（携带该状态）；不同= mixed；无线/全缺失= none */
export function resolveCollegePlanStatusSummary(
  statuses: ReadonlyArray<string | null | undefined>
): {
  kind: 'none' | 'single' | 'mixed'
  status: string | null
} {
  const normalized = statuses
    .map(status =>
      String(status ?? '')
        .trim()
        .toUpperCase()
    )
    .filter(Boolean)
  if (normalized.length === 0) {
    return { kind: 'none', status: null }
  }
  const unique = Array.from(new Set(normalized))
  if (unique.length === 1) {
    return { kind: 'single', status: unique[0] ?? null }
  }
  return { kind: 'mixed', status: null }
}
