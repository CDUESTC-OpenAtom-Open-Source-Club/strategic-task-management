import { isSecondaryCollege } from '@/features/dashboard/lib/helpers'
import type { ComparisonItem, StrategicIndicator } from '@/shared/types'

/**
 * 数据看板「综合报表」导出（2026-10-29 用户定案）。
 *
 * 一个 Excel 文件、多个 Sheet 页签，一页看全局：
 *   总览 → 各部门进度 → 各学院进度 → 滞后任务清单 → 附件索引
 *
 * 数据来源全部来自看板既有 store（departmentComparison / indicators），
 * 不新增后端接口。
 */

export interface DashboardOverviewRow {
  指标总数: number
  已完成: number
  进行中: number
  延期预警: number
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
  延期预警: number
  状态: string
}

export interface DashboardLaggingRow {
  序号: number
  指标内容: string
  所属部门: string
  当前进度: string
  自评等级: string
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

const STATUS_LABEL: Record<ComparisonItem['status'], string> = {
  success: '优秀',
  warning: '良好',
  danger: '需改进'
}

const RATING_LABEL: Record<string, string> = {
  AHEAD: '超前完成',
  NORMAL: '正常',
  DELAYED: '延期'
}

/** 判断指标是否滞后：进度 < 50 视为滞后（与后端催办门槛一致） */
const isLagging = (progress: number): boolean => progress < 50

export function buildComprehensiveReport(
  indicators: StrategicIndicator[]
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
        延期预警: alertCount,
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
  const laggingList = indicators.filter(item => isLagging(Number(item.progress ?? 0)))
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
      延期预警: laggingList.length,
      平均进度: `${avgProgress}%`,
      附件覆盖率: `${attachmentCoverage}%`
    }
  ]

  // ---- 滞后任务清单 ----
  const lagging: DashboardLaggingRow[] = laggingList
    .slice()
    .sort((a, b) => Number(a.progress ?? 0) - Number(b.progress ?? 0))
    .map((item, index) => ({
      序号: index + 1,
      指标内容: item.name || '未命名指标',
      所属部门: item.responsibleDept || item.ownerDept || '未分配',
      当前进度: `${item.progress ?? 0}%`,
      自评等级: item.selfRating ? (RATING_LABEL[item.selfRating] ?? item.selfRating) : '未评定'
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
