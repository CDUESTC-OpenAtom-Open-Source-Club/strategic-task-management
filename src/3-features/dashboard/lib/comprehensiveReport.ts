import { isSecondaryCollege } from '@/features/dashboard/lib/helpers'
import type { ComparisonItem, StrategicIndicator } from '@/shared/types'

/**
 * 数据看板「综合报表」导出（2026-10-29 用户定案）。
 *
 * 一个 Excel 文件、多个 Sheet 页签，一页看全局：
 *   总览 → 各部门进度 → 各学院进度 → 滞后任务清单 → 附件索引
 *
 * 总览/进度 Sheet 数据来自看板既有 store（departmentComparison / indicators）；
 * 滞后任务清单自 2026-11-17 起改由后端 /dashboard/delayed-indicators 真实供数
 * （月报鉴定 DELAYED，等级制填报后 indicator.progress 恒 0，旧 progress<50 判定已死）。
 */

export interface DashboardOverviewRow {
  指标总数: number
  已完成: number
  进行中: number
  滞后预警: number
  平均进度: string
  附件覆盖率: string
}

export interface DashboardUnitRow {
  排名: number
  单位: string
  类型: string
  平均进度: string
  综合得分: number
  完成率: string
  指标总数: number
  已完成: number
  进行中: number
  滞后预警: number
  状态: string
}

export interface DashboardLaggingRow {
  序号: number
  指标内容: string
  所属学院: string
  来源部门: string
  自评等级: string
  鉴定等级: string
}

export interface DashboardAttachmentRow {
  序号: number
  指标内容: string
  所属单位: string
  文件名: string
}

export interface ComprehensiveReportSheets {
  overview: DashboardOverviewRow[]
  departments: DashboardUnitRow[]
  colleges: DashboardUnitRow[]
  lagging: DashboardLaggingRow[]
  attachments: DashboardAttachmentRow[]
}

/** 滞后任务清单的外部真实源（/dashboard/delayed-indicators 行结构） */
export interface ComprehensiveReportLaggingSource {
  indicatorId: number
  indicatorName: string | null
  orgName: string
  ownerOrgName: string | null
  selfRating: string | null
  appraisalLevel: string | null
}

const STATUS_LABEL: Record<ComparisonItem['status'], string> = {
  success: '优秀',
  warning: '良好',
  danger: '需改进'
}

const RATING_LABEL: Record<string, string> = {
  AHEAD: '超前完成',
  NORMAL: '正常',
  DELAYED: '滞后'
}

/** 判断指标是否滞后：进度 < 50（遗留口径，仅用于单位进度列；滞后清单已切月报鉴定源） */
const isLagging = (progress: number): boolean => progress < 50

export function buildComprehensiveReport(
  indicators: StrategicIndicator[],
  laggingSource: ComprehensiveReportLaggingSource[] = []
): ComprehensiveReportSheets {
  // ---- 单位维度聚合（部门 + 学院分离） ----
  const groupBy = new Map<string, StrategicIndicator[]>()
  for (const item of indicators) {
    const dept = item.responsibleDept || item.ownerDept || '未分配'
    const list = groupBy.get(dept) || []
    list.push(item)
    groupBy.set(dept, list)
  }

  const toUnitRows = (filter: (dept: string) => boolean): DashboardUnitRow[] => {
    const rows: Array<DashboardUnitRow & { _completionRate: number }> = []
    for (const [dept, list] of groupBy) {
      if (!filter(dept)) {
        continue
      }
      const total = list.length
      const completed = list.filter(item => Number(item.progress ?? 0) >= 100).length
      const inProgress = total - completed
      const alertCount = list.filter(item => isLagging(Number(item.progress ?? 0))).length
      const avgProgress =
        total > 0
          ? Math.round(list.reduce((sum, item) => sum + Number(item.progress ?? 0), 0) / total)
          : 0
      const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0
      const status: ComparisonItem['status'] =
        completionRate >= 80 ? 'success' : completionRate >= 50 ? 'warning' : 'danger'
      rows.push({
        排名: 0,
        单位: dept,
        类型: isSecondaryCollege(dept) ? '二级学院' : '职能部门',
        平均进度: `${avgProgress}%`,
        综合得分: avgProgress,
        完成率: `${completionRate}%`,
        指标总数: total,
        已完成: completed,
        进行中: inProgress,
        滞后预警: alertCount,
        状态: STATUS_LABEL[status],
        _completionRate: completionRate
      })
    }
    rows.sort((a, b) => b._completionRate - a._completionRate)
    rows.forEach((row, index) => {
      row.排名 = index + 1
    })
    return rows.map(({ _completionRate: _ignored, ...rest }) => rest)
  }

  const departments = toUnitRows(dept => !isSecondaryCollege(dept))
  const colleges = toUnitRows(dept => isSecondaryCollege(dept))

  // ---- 总览 ----
  const total = indicators.length
  const completed = indicators.filter(item => Number(item.progress ?? 0) >= 100).length
  const inProgress = total - completed
  const avgProgress =
    total > 0
      ? Math.round(indicators.reduce((sum, item) => sum + Number(item.progress ?? 0), 0) / total)
      : 0
  const withAttachments = indicators.filter(item => {
    const details = (item as { pendingAttachmentDetails?: unknown }).pendingAttachmentDetails
    return Array.isArray(details) && details.length > 0
  }).length
  const attachmentCoverage = total > 0 ? Math.round((withAttachments / total) * 100) : 0

  const overview: DashboardOverviewRow[] = [
    {
      指标总数: total,
      已完成: completed,
      进行中: inProgress,
      // 滞后数来自月报鉴定真实源（progress 恒 0，进度判定不再可信）
      滞后预警: laggingSource.length,
      平均进度: `${avgProgress}%`,
      附件覆盖率: `${attachmentCoverage}%`
    }
  ]

  // ---- 滞后任务清单（月报鉴定 DELAYED 明细，appraisal_level 优先 self_rating） ----
  const lagging: DashboardLaggingRow[] = laggingSource.map((item, index) => ({
    序号: index + 1,
    指标内容: item.indicatorName || `指标#${item.indicatorId}`,
    所属学院: item.orgName,
    来源部门: item.ownerOrgName || '—',
    自评等级: item.selfRating ? (RATING_LABEL[item.selfRating] ?? item.selfRating) : '未评定',
    鉴定等级: item.appraisalLevel
      ? (RATING_LABEL[item.appraisalLevel] ?? item.appraisalLevel)
      : '未评定'
  }))

  // ---- 附件索引 ----
  const attachments: DashboardAttachmentRow[] = []
  for (const item of indicators) {
    const details = (item as { pendingAttachmentDetails?: Array<{ fileName?: string }> })
      .pendingAttachmentDetails
    if (!Array.isArray(details) || details.length === 0) {
      continue
    }
    for (const detail of details) {
      attachments.push({
        序号: attachments.length + 1,
        指标内容: item.name || '未命名指标',
        所属单位: item.responsibleDept || item.ownerDept || '未分配',
        文件名: String(detail.fileName ?? '')
      })
    }
  }

  return { overview, departments, colleges, lagging, attachments }
}
