export const GLOBAL_DATA_REFRESH_REQUEST_EVENT = 'global-data-refresh-request'

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
