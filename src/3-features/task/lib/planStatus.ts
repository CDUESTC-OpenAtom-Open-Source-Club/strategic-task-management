import type { StatusTagType } from '@/shared/lib/utils/formatters'

export type CanonicalPlanStatus = 'DRAFT' | 'PENDING' | 'DISTRIBUTED'

const PLAN_STATUS_NORMALIZATION_MAP: Record<string, CanonicalPlanStatus> = {
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  IN_REVIEW: 'PENDING',
  PENDING_REVIEW: 'PENDING',
  PENDING_APPROVAL: 'PENDING',
  SUBMITTED: 'PENDING',
  APPROVED: 'DISTRIBUTED',
  PUBLISHED: 'DISTRIBUTED',
  DISTRIBUTED: 'DISTRIBUTED',
  ACTIVE: 'DISTRIBUTED',
  REJECTED: 'DRAFT',
  RETURNED: 'DRAFT',
  WITHDRAWN: 'DRAFT',
  CANCELLED: 'DRAFT',
  COMPLETED: 'DRAFT',
  ARCHIVED: 'DRAFT'
}

const PLAN_STATUS_DISPLAY_MAP: Record<CanonicalPlanStatus, { label: string; type: StatusTagType }> =
  {
    DRAFT: { label: '草稿', type: 'info' },
    PENDING: { label: '审批中', type: 'warning' },
    DISTRIBUTED: { label: '已下发', type: 'success' }
  }

export function normalizePlanStatus(status: unknown): CanonicalPlanStatus | null {
  const raw = String(status ?? '').trim()
  if (!raw) {
    return null
  }

  return PLAN_STATUS_NORMALIZATION_MAP[raw.toUpperCase()] || null
}

export function getPlanStatusDisplay(status: unknown): { label: string; type: StatusTagType } {
  const normalizedStatus = normalizePlanStatus(status)
  if (!normalizedStatus) {
    const fallback = String(status ?? '').trim()
    return {
      label: fallback || '暂无指标',
      type: 'info'
    }
  }

  return PLAN_STATUS_DISPLAY_MAP[normalizedStatus]
}

/**
 * 2026-11-25（P1 状态签自动刷新 · 收敛判据）：导入下发 commit 返回后，计划视图是否
 * 已收敛到「本次导入结果在计划列表可见」。
 *
 * <p>背景（本地真机实测）：导入 commit 返回（workflow 已 APPROVED、DB 已 DISTRIBUTED）
 * 之后立即 GET /plans，列表里**还没有**本次新建的 FUNC_TO_COLLEGE 线——后端列表
 * 可见性滞后约 4~5s。committed 回调的一次性 force 回源全部撞在这个窗口上（响应里
 * 无新线），且此后无任何机制再次回源（store 层 plans.length>0 早退 + fetchWithCache
 * 15s 快照）→ 页头「计划状态」签停在「未下发」，手动刷新才变。</p>
 *
 * <p>本判据供 committed 回调的**收敛轮询**使用（每次轮询先失效 plan.list 再 force
 * 回源，用本函数判定是否提前停止）。纯函数与单测共用（planStatus 同款模式）。</p>
 */
export interface ImportPlanViewConvergenceInput {
  /** 当前 planStore.plans（轮询回源后的最新列表） */
  plans: Array<{ id?: unknown; status?: unknown }>
  /**
   * 期望可见的计划 id 集。「全部导入」的逐组 SUCCESS 回执带 planId（精确判据）；
   * 单条导入响应无 planId → 留空，退化为按「当前生效计划状态」判定。
   */
  expectedPlanIds?: number[]
  /**
   * 当前生效计划的归一化前状态：学院页签 = 子计划状态（与页头「计划状态」签同源，
   * effectivePlanStatus）；职能页签 = 自身计划状态（currentPlanStatus）。
   * null/undefined = 上下文未解析到计划（本轮导入要新建的线还没出现）。
   */
  activePlanStatus?: unknown
  /**
   * commit 是否完成自动下发（autoSubmitAndApprove 且 workflow 推进到 APPROVED）。
   * true 时要求计划状态推进到 DISTRIBUTED；false（仅写入不下发）时要求
   * 「计划可见/已解析」即可（状态停在草稿是预期）。
   */
  autoDispatch: boolean
}

export function isImportPlanViewConverged(input: ImportPlanViewConvergenceInput): boolean {
  const { plans, expectedPlanIds, activePlanStatus, autoDispatch } = input

  if (expectedPlanIds && expectedPlanIds.length > 0) {
    return expectedPlanIds.every(id => {
      const plan = plans.find(candidate => Number(candidate?.id) === Number(id))
      if (!plan) {
        return false
      }
      if (autoDispatch && normalizePlanStatus(plan.status) !== 'DISTRIBUTED') {
        return false
      }
      return true
    })
  }

  if (activePlanStatus == null || activePlanStatus === '') {
    return false
  }
  if (!autoDispatch) {
    return true
  }
  return normalizePlanStatus(activePlanStatus) === 'DISTRIBUTED'
}
