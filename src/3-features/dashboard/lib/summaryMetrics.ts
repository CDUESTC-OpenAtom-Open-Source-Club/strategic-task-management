import type { Indicator } from '@/shared/types'
import type {
  DashboardCollegeLevelStat,
  DashboardCollegeLevelsMonth
} from '@/features/dashboard/api/dashboardApi'

export type DashboardIndicatorStatus = 'normal' | 'ahead' | 'warning' | 'delayed'

/**
 * 指标在某月的执行状态（兜底口径）。
 *
 * 2026-10-31 数据看板新口径：
 * - 看板的等级统计（学院柱形图 / 月度趋势 / 分院排名 / 总览等级分布）已改由后端
 *   `college-levels` 系列接口供数（只算已提交/已审批月报、鉴定等级三档），
 *   本函数仅服务「职能部门堆叠图 / 指标明细清单」等无接口数据源的兜底场景。
 * - 手动预警等级（manualAlertSeverity / alert_event）彻底退出看板统计，
 *   原读取 manualAlertLevel 的分支为死代码（Indicator 上不存在该字段），已删除。
 *
 * 判定规则：
 * 1. 未下发（DRAFT）/已驳回（REJECTED）→ warning（不算完成，不虚报为正常）
 * 2. 其余 → normal
 */
export const getIndicatorStatusAtMonth = (
  indicator: Indicator,
  _month: number,
  _year: number
): DashboardIndicatorStatus => {
  const status = String(indicator.workflowStatus ?? indicator.status ?? '').toUpperCase()
  if (status === 'DRAFT' || status === 'REJECTED') {
    return 'warning'
  }
  return 'normal'
}

// ============================================================================
// 学院等级统计映射（2026-11-17 新口径：后端契约数据 → 看板图表行）
// 口径：未填报学院（reported=false）照常出列，画灰柱「下发 n 项·未填报」督办；
//       等级三档来自月报鉴定（appraisal_level 优先 self_rating 兜底，后端已算好）。
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
    reported: college.reported ?? true
  }))

/**
 * 契约月度趋势 → 单学院趋势行（2026-11-17 口径：接口固定返回 1-12 月全量，
 * 每月都画；某月 colleges 未含该学院时按 0 值灰柱绘制（该月未填报）。
 */
export const toCollegeTrendRows = (
  months: DashboardCollegeLevelsMonth[],
  collegeName: string
): CollegeLevelTrendRow[] =>
  [...months]
    .sort((a, b) => a.month - b.month)
    .map(({ month, colleges }) => {
      const stat = colleges.find(college => college.orgName === collegeName)
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
        reported: stat?.reported ?? false
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
        reported: college.reported ?? true
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

export const aggregateCollegeLevels = (colleges: DashboardCollegeLevelStat[]): CollegeLevelAggregate => {
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
