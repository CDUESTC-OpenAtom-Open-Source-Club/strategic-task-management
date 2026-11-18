import type {
  DashboardCollegeLevelStat,
  DashboardCollegeLevelsMonth,
  DashboardMonthState
} from '@/features/dashboard/api/dashboardApi'

// ============================================================================
// 月份快照状态解析（2026-11-18 按月快照口径）
// 契约：monthState ∈ APPROVED / IN_REVIEW / NOT_REPORTED，只有 APPROVED 出鉴定值；
// 兜底优先级：行级 monthState → 月级 monthState → reported=false → APPROVED（旧响应兼容）。
// ============================================================================

/**
 * monthState 兜底解析（返回值保证非空）。
 * 优先级：行级 monthState > 行级 reported=false > 月级 monthState > 响应级 monthState
 * > APPROVED（旧响应兼容）。行内明确字段（含 reported）优先于整月/响应级包裹，
 * 避免「整月 APPROVED」把个别未填报部门解除置灰。
 */
export const resolveMonthState = (
  row: { monthState?: DashboardMonthState; reported?: boolean } | undefined,
  monthEnvelope?: { monthState?: DashboardMonthState } | null,
  responseEnvelope?: { monthState?: DashboardMonthState } | null
): DashboardMonthState => {
  if (row?.monthState) {
    return row.monthState
  }
  if (row?.reported === false) {
    return 'NOT_REPORTED'
  }
  if (monthEnvelope?.monthState) {
    return monthEnvelope.monthState
  }
  if (responseEnvelope?.monthState) {
    return responseEnvelope.monthState
  }
  return 'APPROVED'
}

/** 非 APPROVED 月份一律置灰（#C0C4CC），不出鉴定柱 */
export const isGrayMonth = (state: DashboardMonthState): boolean => state !== 'APPROVED'

/** 置灰柱/条上的短标签（学院图与排名图共用） */
export const monthStateGrayLabel = (state: DashboardMonthState): string =>
  state === 'IN_REVIEW' ? '审批中' : '未填报'

/** 学院图灰柱 tooltip 状态行 */
export const monthStateCollegeTooltip = (state: DashboardMonthState): string =>
  state === 'IN_REVIEW' ? '本月上报审批中（灰柱督办）' : '本月未填报（灰柱督办）'

/** 部门图灰柱 tooltip 状态行 */
export const monthStateDeptTooltip = (state: DashboardMonthState): string =>
  state === 'IN_REVIEW' ? '该部门本月上报审批中' : '该部门本月未填报'

// ============================================================================
// 学院等级统计映射（2026-11-17 新口径：后端契约数据 → 看板图表行）
// 口径：未填报学院（reported=false）照常出列，画灰柱「下发 n 项·未填报」督办；
//       等级三档来自月报鉴定（appraisal_level 优先 self_rating 兜底，后端已算好）。
// 2026-11-18 按月快照口径：行带 monthState，非 APPROVED 月份由图表置灰、不出鉴定柱。
// ============================================================================

const shortenOrgName = (orgName: string): string =>
  orgName.length > 8 ? orgName.slice(0, 8) + '...' : orgName

/** 学院柱形图行（第一层：学院视图） */
export interface CollegeLevelBarRow {
  name: string
  fullName: string
  orgId: number
  ahead: number
  normal: number
  delayed: number
  total: number
  /** 已下发指标数（未填报灰柱显示「下发 n 项·未填报」） */
  dispatchedCount: number
  /** 未下发指标数 */
  undispatchedCount: number
  /** 未填报标记：false → 灰柱督办 */
  reported: boolean
  /** 该学院该月快照状态（非 APPROVED → 图表置灰） */
  monthState: DashboardMonthState
}

/** 学院月度趋势行（第二层：学院月度视图） */
export interface CollegeLevelTrendRow extends CollegeLevelBarRow {
  month: number
}

/** 分院排名行 */
export interface CollegeRankingRow {
  name: string
  fullName: string
  orgId: number
  /** 排名分数 = 完成率（(超前+正常)/已下发数 × 100，保留一位小数） */
  value: number
  /** 已下发指标数（完成率分母） */
  total: number
  /** 完成 = 超前 + 正常 */
  completed: number
  ahead: number
  normal: number
  delayed: number
  /** 未填报标记（未填报学院按 0 分垫底，督办可见） */
  reported: boolean
  /** 该学院该月快照状态（非 APPROVED → 排名条置灰） */
  monthState: DashboardMonthState
}

/** 契约学院统计 → 柱形图行（含未填报学院，未填报时 reported=false） */
export const toCollegeBarRows = (colleges: DashboardCollegeLevelStat[]): CollegeLevelBarRow[] =>
  colleges.map(college => ({
    name: shortenOrgName(college.orgName),
    fullName: college.orgName,
    orgId: college.orgId,
    ahead: college.ahead,
    normal: college.normal,
    delayed: college.delayed,
    total: college.total,
    dispatchedCount: college.dispatchedCount ?? 0,
    undispatchedCount: college.undispatchedCount ?? 0,
    reported: college.reported ?? true,
    monthState: resolveMonthState(college)
  }))

/**
 * 契约月度趋势 → 单学院趋势行（2026-11-17 口径：接口固定返回 1-12 月全量，
 * 每月都画；某月 colleges 未含该学院时按 0 值灰柱绘制（该月未填报）。
 * 2026-11-18 按月快照口径：行级 monthState 优先，其次月级 monthState，
 * 最后按 reported 兜底（缺行=该月未填报）。
 */
export const toCollegeTrendRows = (
  months: DashboardCollegeLevelsMonth[],
  collegeName: string
): CollegeLevelTrendRow[] =>
  [...months]
    .sort((a, b) => a.month - b.month)
    .map(({ month, colleges, monthState }) => {
      const stat = colleges.find(college => college.orgName === collegeName)
      // 某月未含该学院 → 按未填报兜底（reported=false → NOT_REPORTED 灰柱）
      const reported = stat?.reported ?? false
      return {
        name: `${month}月`,
        month,
        orgId: stat?.orgId ?? 0,
        fullName: stat?.orgName ?? collegeName,
        ahead: stat?.ahead ?? 0,
        normal: stat?.normal ?? 0,
        delayed: stat?.delayed ?? 0,
        total: stat?.total ?? 0,
        dispatchedCount: stat?.dispatchedCount ?? 0,
        undispatchedCount: stat?.undispatchedCount ?? 0,
        reported,
        monthState: resolveMonthState({ monthState: stat?.monthState, reported }, { monthState })
      }
    })

/**
 * 契约学院统计 → 分院排名行（基于新接口数据重排）。
 * 分数 = 完成率 = (超前 + 正常) / 已下发数 × 100（完成口径：超前与正常计入完成；
 * 未填报学院分母仍为已下发数，未上报导致 0 分垫底，督办场景可见谁没报）。
 */
export const toCollegeRankingRows = (colleges: DashboardCollegeLevelStat[]): CollegeRankingRow[] =>
  colleges
    .map(college => {
      const completed = college.ahead + college.normal
      const denominator = college.dispatchedCount ?? college.total
      const rate = denominator > 0 ? (completed / denominator) * 100 : 0
      return {
        name: shortenOrgName(college.orgName),
        fullName: college.orgName,
        orgId: college.orgId,
        value: Math.round(rate * 10) / 10,
        total: denominator,
        completed,
        ahead: college.ahead,
        normal: college.normal,
        delayed: college.delayed,
        reported: college.reported ?? true,
        monthState: resolveMonthState(college)
      }
    })
    .sort((a, b) => b.value - a.value || b.completed - a.completed)

/** 契约学院统计 → 全校等级汇总（总览简报 / 等级分布 / 完成率供数） */
export interface CollegeLevelAggregate {
  ahead: number
  normal: number
  delayed: number
  /** 已鉴定等级合计（= ahead + normal + delayed） */
  total: number
  /** 全校已下发指标总数（完成率分母，未填报学院也计入） */
  dispatchedTotal: number
  /** 全校未下发指标总数 */
  undispatchedTotal: number
  /** 未填报学院数（灰柱督办） */
  unreportedColleges: number
}

export const aggregateCollegeLevels = (
  colleges: DashboardCollegeLevelStat[]
): CollegeLevelAggregate => {
  const aggregate: CollegeLevelAggregate = {
    ahead: 0,
    normal: 0,
    delayed: 0,
    total: 0,
    dispatchedTotal: 0,
    undispatchedTotal: 0,
    unreportedColleges: 0
  }
  colleges.forEach(college => {
    aggregate.ahead += college.ahead
    aggregate.normal += college.normal
    aggregate.delayed += college.delayed
    aggregate.total += college.total
    aggregate.dispatchedTotal += college.dispatchedCount ?? 0
    aggregate.undispatchedTotal += college.undispatchedCount ?? 0
    if (college.reported === false) {
      aggregate.unreportedColleges += 1
    }
  })
  return aggregate
}
