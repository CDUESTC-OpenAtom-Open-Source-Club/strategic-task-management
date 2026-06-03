import { requestGlobalDataRefresh } from '@/shared/lib/dataFreshness'
import { invalidateQueries } from '@/shared/lib/utils/cache'

const MESSAGE_CENTER_CACHE_KEYS = ['messages.summary', 'messages.unread', 'messages.list'] as const

export function requestMessageCenterRefresh(): void {
  invalidateQueries(MESSAGE_CENTER_CACHE_KEYS)
  requestGlobalDataRefresh({ source: 'message-mutation', silent: true })
}
