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

/** 置灰柱/条上的短标签（排名图用；学院图 2026-11-22 起改按线分段混色，不再整柱置灰） */
export const monthStateGrayLabel = (state: DashboardMonthState): string =>
  state === 'IN_REVIEW' ? '审批中' : '未填报'

/** 部门图灰柱 tooltip 状态行 */
export const monthStateDeptTooltip = (state: DashboardMonthState): string =>
  state === 'IN_REVIEW' ? '该部门本月上报审批中' : '该部门本月未填报'

// ============================================================================
// 学院卡按线分段混色口径（2026-11-22 用户拍板）
// 柱子总高 = 已下发指标数；走完审批（整链到终点、月报 APPROVED）的线按鉴定等级
// 出彩段（超前/正常/滞后），其余（已下发未走完）出灰段，灰彩可同柱并存——
// 一条线走完即亮一段，不再「整月未全部走完=整根灰柱」。
// 灰段数前端可算：已下发数 − (超前+正常+滞后) 合计，后端零改动。
// ============================================================================

/**
 * 学院柱「未走完」灰段数 = 已下发数 − (超前+正常+滞后) 合计（负数防御性截为 0）。
 * 三档计数本身即后端已算好的「走完审批」线数，无需区分 monthState。
 */
export const collegeGraySegmentCount = (row: {
  dispatchedCount?: number
  ahead?: number
  normal?: number
  delayed?: number
}): number =>
  Math.max(
    0,
    (row.dispatchedCount || 0) - ((row.ahead || 0) + (row.normal || 0) + (row.delayed || 0))
  )

/**
 * 学院卡 tooltip 分段计数行（2026-11-22 定稿）：
 * `已下发 X 项 ｜ 超前 a · 正常 b · 滞后 c · 未走完 d`，四段之和 = X = 柱高（彩段+灰段）。
 * 不提示未下发数——未下发不在柱子上（下发进度信号分发页徽标已有），看板不重复提示。
 * X = 0 或无数据（缺省 dispatchedCount）返回 null，调用方不出 tooltip。
 */
export const collegeTooltipCountsLine = (row: {
  dispatchedCount?: number
  ahead?: number
  normal?: number
  delayed?: number
}): string | null => {
  const dispatched = row.dispatchedCount || 0
  if (dispatched <= 0) {
    return null
  }
  return `已下发 ${dispatched} 项 ｜ 超前 ${row.ahead || 0} · 正常 ${row.normal || 0} · 滞后 ${row.delayed || 0} · 未走完 ${collegeGraySegmentCount(row)}`
}

// ============================================================================
// 学院等级统计映射（2026-11-17 新口径：后端契约数据 → 看板图表行）
// 口径：未填报学院（reported=false）照常出列，画灰柱「下发 n 项·未填报」督办；
//       等级三档来自月报鉴定（appraisal_level 优先 self_rating 兜底，后端已算好）。
// 2026-11-18 按月快照口径：行带 monthState，非 APPROVED 月份由图表置灰、不出鉴定柱。
// 2026-11-22 按线分段混色（学院卡）：三档计数即「走完审批」线数直接出彩段，
//       灰段 = 已下发 − 三档合计（collegeGraySegmentCount），灰彩同柱并存。
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
  /** 已下发指标数（按线分段混色：柱子总高 / 灰段数=已下发−三档合计的数据源） */
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

// ============================================================================
// 看板总览合计（2026-11-27 简报口径：全校视角 = 职能部门自身 + 学院）
// 全校视角原只合计学院行（7 个学院），漏掉职能部门自身的指标；职能部门 / 学院视角不变。
// 注意：全量视角 appraisal-summary.departments 里除部门自身行外，还混着学院的
// 「未填报」置灰行（等级全 0），所以部门侧只合计部门分布图实际画出的职能部门行，
// 不能把整个 departments 数组加进来（学院会被重复计一遍）。
// ============================================================================

/** 职能部门自身口径的等级行（appraisal-summary 部门行 / 看板内部门统计的数值字段） */
export interface DeptOwnLevelRow {
  ahead: number
  normal: number
  delayed: number
  total: number
  dispatchedCount?: number
}

/** 职能部门自身口径合计 */
export interface DeptOwnLevelAggregate {
  ahead: number
  normal: number
  delayed: number
  /** 已鉴定等级合计（= ahead + normal + delayed） */
  total: number
  /** 职能部门当年已下发指标数合计 */
  dispatchedTotal: number
}

export const emptyDeptOwnAggregate = (): DeptOwnLevelAggregate => ({
  ahead: 0,
  normal: 0,
  delayed: 0,
  total: 0,
  dispatchedTotal: 0
})

export const aggregateDeptOwnLevels = (rows: DeptOwnLevelRow[]): DeptOwnLevelAggregate => {
  const aggregate = emptyDeptOwnAggregate()
  rows.forEach(row => {
    aggregate.ahead += row.ahead
    aggregate.normal += row.normal
    aggregate.delayed += row.delayed
    aggregate.total += row.total
    aggregate.dispatchedTotal += row.dispatchedCount ?? 0
  })
  return aggregate
}

/** 看板总览合计（简报 / 完成情况 / 等级分布三处同源） */
export interface DashboardOverviewAggregate {
  ahead: number
  normal: number
  delayed: number
  /** 已鉴定等级合计（学院 + 职能部门自身） */
  appraisedTotal: number
  /** 完成率分母：已下发指标总数；已下发数为 0 时退回已鉴定数（沿用学院口径） */
  dispatchedTotal: number
  /** 已完成 = 超前 + 正常 */
  completed: number
  completionRate: number
}

/**
 * 学院合计 + 职能部门自身合计 → 总览。
 * 完成率分母沿用既有学院口径：已下发指标总数（未填报的计入分母、不计入完成，不缩小分母）。
 */
export const mergeLevelAggregates = (
  college: CollegeLevelAggregate,
  deptOwn: DeptOwnLevelAggregate
): DashboardOverviewAggregate => {
  const ahead = college.ahead + deptOwn.ahead
  const normal = college.normal + deptOwn.normal
  const delayed = college.delayed + deptOwn.delayed
  const appraisedTotal = college.total + deptOwn.total
  const dispatched = college.dispatchedTotal + deptOwn.dispatchedTotal
  const denominator = dispatched > 0 ? dispatched : appraisedTotal
  const completed = ahead + normal
  return {
    ahead,
    normal,
    delayed,
    appraisedTotal,
    dispatchedTotal: denominator,
    completed,
    completionRate: denominator > 0 ? Math.round((completed / denominator) * 100) : 0
  }
}
