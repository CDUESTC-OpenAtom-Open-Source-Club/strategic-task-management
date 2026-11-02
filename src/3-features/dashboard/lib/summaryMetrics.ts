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
 *   `college-levels` 系列接口供数（只算已提交/已审批月报、只看上级鉴定三档），
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
// 学院等级统计映射（2026-10-31 新口径：后端契约数据 → 看板图表行）
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
  /** 排名分数 = 完成率（(超前+正常)/总计 × 100，保留一位小数） */
  value: number
  total: number
  completed: number
  ahead: number
  normal: number
  delayed: number
}

/** 契约学院统计 → 柱形图行（接口不返回的学院不画，原样透传） */
export const toCollegeBarRows = (colleges: DashboardCollegeLevelStat[]): CollegeLevelBarRow[] =>
  colleges.map(college => ({
    name: shortenOrgName(college.orgName),
    fullName: college.orgName,
    orgId: college.orgId,
    ahead: college.ahead,
    normal: college.normal,
    delayed: college.delayed,
    total: college.total
  }))

/**
 * 契约月度趋势 → 单学院趋势行。
 * x 轴只画接口返回的月份（months 只到最晚有数据月份）；
 * 某月 colleges 未含该学院时按 0 值绘制（该月无上报数据）。
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
        total: stat?.total ?? 0
      }
    })

/**
 * 契约学院统计 → 分院排名行（基于新接口数据重排）。
 * 分数 = 完成率 = (超前 + 正常) / 总计 × 100（完成口径：超前与正常计入完成）。
 */
export const toCollegeRankingRows = (colleges: DashboardCollegeLevelStat[]): CollegeRankingRow[] =>
  colleges
    .map(college => {
      const completed = college.ahead + college.normal
      const rate = college.total > 0 ? (completed / college.total) * 100 : 0
      return {
        name: shortenOrgName(college.orgName),
        fullName: college.orgName,
        orgId: college.orgId,
        value: Math.round(rate * 10) / 10,
        total: college.total,
        completed,
        ahead: college.ahead,
        normal: college.normal,
        delayed: college.delayed
      }
    })
    .sort((a, b) => b.value - a.value || b.completed - a.completed)

/** 契约学院统计 → 全校等级汇总（总览简报 / 等级分布 / 完成率供数） */
export const aggregateCollegeLevels = (colleges: DashboardCollegeLevelStat[]) => {
  const aggregate = { ahead: 0, normal: 0, delayed: 0, total: 0 }
  colleges.forEach(college => {
    aggregate.ahead += college.ahead
    aggregate.normal += college.normal
    aggregate.delayed += college.delayed
    aggregate.total += college.total
  })
  return aggregate
}
