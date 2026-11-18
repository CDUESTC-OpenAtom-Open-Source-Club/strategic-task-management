import { isSecondaryCollege } from '@/features/dashboard/lib/helpers'
import type { StrategicIndicator } from '@/shared/types'

/**
 * 数据看板「综合报表」导出（2026-10-29 用户定案）。
 *
 * 一个 Excel 文件、多个 Sheet 页签，一页看全局：
 *   总览 → 各部门进度 → 各学院进度 → 滞后任务清单 → 附件索引
 *
 * 总览/进度 Sheet 数据来自看板既有 store（departmentComparison / indicators）；
 * 滞后任务清单自 2026-11-17 起改由后端 /dashboard/delayed-indicators 真实供数
 * （月报鉴定 DELAYED，等级制填报后 indicator.progress 恒 0，旧 progress<50 判定已死）。
 *
 * 2026-11-17 用户拍板（等级制填报收尾）：「各部门/各学院进度」两个 Sheet
 * 弃用旧的 indicator.progress 百分比（等级制填报后该字段恒 0，整表死数据），
 * 改按**鉴定等级**出表，口径与看板滞后任务卡/学院等级图同源：
 *   COALESCE(appraisal_level, self_rating)——上级鉴定优先，没鉴定看自评。
 * 前端数据链上 appraisal_level = 指标行的 manualAlertSeverity
 * （AHEAD/NORMAL/DELAYED 三档，旧预警码 INFO/WARNING/CRITICAL 已在
 * strategic store 归并为 DELAYED，这里再做一次防御性归并）；
 * self_rating 在看板指标行里不承载（只随填报记录走），拿不到即「未评定」，
 * 若未来数据链补上该字段，本函数自动接管兜底分支。
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
  指标总数: number
  // 等级重写侧：旧 已完成/进行中/滞后预警/状态 四列退役（HEAD 侧仅改名）
  超前完成: number
  正常: number
  滞后: number
  未评定: number
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

/** 滞后任务清单的外部真实源（/dashboard/delayed-indicators 行结构，HEAD 侧新增） */
export interface ComprehensiveReportLaggingSource {
  indicatorId: number
  indicatorName: string | null
  orgName: string
  ownerOrgName: string | null
  selfRating: string | null
  appraisalLevel: string | null
}

/** 鉴定等级三档（与全局「滞后」文案统一口径一致，不再写「延期」；等级重写侧新增） */
export type AppraisalLevelCode = 'AHEAD' | 'NORMAL' | 'DELAYED'

export const APPRAISAL_LEVEL_LABEL: Record<AppraisalLevelCode, string> = {
  AHEAD: '超前完成',
  NORMAL: '正常',
  DELAYED: '滞后'
}

/**
 * 归并一档等级码：三档直通；旧预警档（INFO/WARNING/CRITICAL）按用户
 * 2026-09-18 定案一律视为「滞后」；未知/空值返回 null（→「未评定」）。
 */
function normalizeAppraisalCode(value: unknown): AppraisalLevelCode | null {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
  if (normalized === 'AHEAD' || normalized === 'NORMAL' || normalized === 'DELAYED') {
    return normalized
  }
  if (normalized === 'INFO' || normalized === 'WARNING' || normalized === 'CRITICAL') {
    return 'DELAYED'
  }
  return null
}

/**
 * 单行指标的鉴定等级：COALESCE(appraisal_level, self_rating)。
 * appraisal_level 常规落点是 manualAlertSeverity（兼容未来改名 appraisalLevel），
 * self_rating 目前看板指标行不承载，仅作兜底读取（存在即生效）。
 */
export function resolveIndicatorAppraisalLevel(
  item: StrategicIndicator
): AppraisalLevelCode | null {
  const extended = item as StrategicIndicator & {
    appraisalLevel?: unknown
    selfRating?: unknown
  }
  return (
    normalizeAppraisalCode(extended.appraisalLevel) ??
    normalizeAppraisalCode(item.manualAlertSeverity) ??
    normalizeAppraisalCode(extended.selfRating)
  )
}

// 冲突融合说明：原 STATUS_LABEL（优秀/良好/需改进）随单位 Sheet「状态」列
// 一并退役（等级重写不再产出该列），其类型依赖 ComparisonItem 亦已从
// import 移除，故不再保留。

const RATING_LABEL: Record<string, string> = {
  AHEAD: '超前完成',
  NORMAL: '正常',
  DELAYED: '滞后'
}

// 冲突融合说明：原 isLagging（progress<50 遗留口径）随单位进度列退役移除——
// 融合后单位 Sheet 聚合鉴定等级分布（resolveIndicatorAppraisalLevel），
// 滞后清单/总览滞后数均来自 /dashboard/delayed-indicators 真实源，无残余调用方。

export function buildComprehensiveReport(
  indicators: StrategicIndicator[],
  laggingSource: ComprehensiveReportLaggingSource[] = []
): ComprehensiveReportSheets {
  // ---- 单位维度聚合（部门 + 学院分离；2026-11-17 起聚合鉴定等级分布） ----
  const groupBy = new Map<string, StrategicIndicator[]>()
  for (const item of indicators) {
    const dept = item.responsibleDept || (item as { ownerDept?: string }).ownerDept || '未分配'
    const list = groupBy.get(dept) || []
    list.push(item)
    groupBy.set(dept, list)
  }

  const toUnitRows = (filter: (dept: string) => boolean): DashboardUnitRow[] => {
    const rows: Array<DashboardUnitRow & { _rankKey: [number, number, number] }> = []
    for (const [dept, list] of groupBy) {
      if (!filter(dept)) {
        continue
      }
      const total = list.length
      const aheadCount = list.filter(
        item => resolveIndicatorAppraisalLevel(item) === 'AHEAD'
      ).length
      const normalCount = list.filter(
        item => resolveIndicatorAppraisalLevel(item) === 'NORMAL'
      ).length
      const delayedCount = list.filter(
        item => resolveIndicatorAppraisalLevel(item) === 'DELAYED'
      ).length
      const unratedCount = total - (aheadCount + normalCount + delayedCount)
      rows.push({
        排名: 0,
        单位: dept,
        类型: isSecondaryCollege(dept) ? '二级学院' : '职能部门',
        指标总数: total,
        超前完成: aheadCount,
        正常: normalCount,
        滞后: delayedCount,
        未评定: unratedCount,
        // 排序键：滞后少者靠前 → 超前多者靠前 → 未评定少者靠前（原完成率已退役）
        _rankKey: [delayedCount, -aheadCount, unratedCount]
      })
    }
    rows.sort((a, b) => {
      const [aDelayed, aAheadNeg, aUnrated] = a._rankKey
      const [bDelayed, bAheadNeg, bUnrated] = b._rankKey
      return aDelayed - bDelayed || aAheadNeg - bAheadNeg || aUnrated - bUnrated
    })
    rows.forEach((row, index) => {
      row.排名 = index + 1
    })
    return rows.map(({ _rankKey: _ignored, ...rest }) => rest)
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
