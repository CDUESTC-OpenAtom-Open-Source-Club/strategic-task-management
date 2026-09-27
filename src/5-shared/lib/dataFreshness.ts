export const GLOBAL_DATA_REFRESH_REQUEST_EVENT = 'global-data-refresh-request'

// 2026-09-27 用户拍板：细粒度异步刷新——事件携带受影响的数据域（domains），
// 各视图只处理包含自己域的刷新请求，不再"一条通知全员全量刷"。
// 域集合：message（消息中心/铃铛）、workflow（审批待办）、plan（计划/任务视图）、
// indicator（指标列表/下发页）、dashboard（看板聚合数据）。
export interface GlobalDataRefreshDetail {
  source?:
    | 'approval-notification'
    | 'approval-state-refresh'
    | 'window-focus'
    | 'visibility-return'
    | 'heartbeat'
    | 'message-mutation'
    | 'manual'
  silent?: boolean
  domains?: string[]
}

let lastDispatchAt = 0
let lastDispatchSource = ''
const MIN_DISPATCH_INTERVAL_MS = 800

export function requestGlobalDataRefresh(detail: GlobalDataRefreshDetail = {}): void {
  if (typeof window === 'undefined') {
    return
  }

  const now = Date.now()
  const source = String(detail.source || 'manual')
  if (source === lastDispatchSource && now - lastDispatchAt < MIN_DISPATCH_INTERVAL_MS) {
    return
  }

  lastDispatchAt = now
  lastDispatchSource = source

  window.dispatchEvent(
    new CustomEvent<GlobalDataRefreshDetail>(GLOBAL_DATA_REFRESH_REQUEST_EVENT, {
      detail
    })
  )
}

/**
 * 域过滤判定：事件携带 domains 时仅当与视图所需域有交集才刷新；
 * 旧事件（无 domains）按 legacyRefresh（默认 true）保持向后兼容。
 */
export function shouldRefreshForDomains(
  detail: GlobalDataRefreshDetail | undefined | null,
  requiredDomains: string[],
  options?: { legacyRefresh?: boolean }
): boolean {
  const domains = detail?.domains
  if (!domains || domains.length === 0) {
    return options?.legacyRefresh !== false
  }
  return domains.some(domain => requiredDomains.includes(domain))
}
