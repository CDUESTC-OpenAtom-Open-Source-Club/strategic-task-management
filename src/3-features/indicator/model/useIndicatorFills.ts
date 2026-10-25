import type { IndicatorFill } from '@/shared/types'
import { usePlanStore } from '@/features/plan/model/store'

// 2026-10-13 上报资料列/上报历史小标共用：同指标并发请求共享同一 Promise，避免一行两处重复拉取
const cache = new Map<string | number, Promise<IndicatorFill[]>>()

export function useIndicatorFills(indicatorId: number | string | null | undefined) {
  if (indicatorId === null || indicatorId === undefined || indicatorId === '') {
    return Promise.resolve([])
  }
  const key = String(indicatorId)
  let pending = cache.get(key)
  if (!pending) {
    const planStore = usePlanStore()
    pending = planStore
      .loadIndicatorFillHistory(indicatorId)
      .then(history =>
        Array.isArray(history)
          ? // 草稿不算上报历史：DRAFT 经状态映射后为 undefined，只有 submitted/approved/rejected 才进入上报资料与历史小标
            history.filter(fill => Boolean(fill?.status))
          : []
      )
      .catch(() => [])
    cache.set(key, pending)
  }
  return pending
}

export function invalidateIndicatorFills(indicatorId?: number | string | null): void {
  if (indicatorId === null || indicatorId === undefined || indicatorId === '') {
    cache.clear()
    return
  }
  cache.delete(String(indicatorId))
}

// #82 填报数据刷新信号：审批等动作后先 invalidate 重填缓存，再广播让订阅方重读。
// 头部「异动状态」聚合与「上报状态」单元格（ReportStatusCell）共用同一信号，
// 保证两端同源同鲜度，不会出现「头部已刷新、列还停在旧状态」的新矛盾。
const fillRefreshListeners = new Set<() => void>()

export function notifyIndicatorFillsRefresh(): void {
  fillRefreshListeners.forEach(listener => listener())
}

export function onIndicatorFillsRefresh(listener: () => void): () => void {
  fillRefreshListeners.add(listener)
  return () => {
    fillRefreshListeners.delete(listener)
  }
}
