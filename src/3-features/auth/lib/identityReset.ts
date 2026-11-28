/**
 * 切换身份后的前端运行时状态清理。
 *
 * 切换身份 = 换 token 到另一个系统账号，上一身份留在前端的数据必须整体清掉。
 * 只清查询缓存不够：各 store 普遍带「已加载就不再请求」的短路
 * （planStore.plans.length、strategicStore.indicators、orgStore.loaded……），
 * 上个账号的数据会留在 store 里被新身份直接渲染。
 *
 * 这里集中处理三处：
 * 1. 查询缓存（内存 + sessionStorage / localStorage 持久化项）；
 * 2. 各 Pinia store 的身份级数据（还原到初始值，见 5-shared/lib/store/identityStateReset）；
 * 3. WebSocket 推送累积的通知列表（连接本身随 AppLayout 重挂，按新身份重连）。
 *
 * 组件树由 App.vue 在切换过场期间整体卸载重挂（见 authStore.identityShellSuspended），
 * 页面局部状态随之复位，各视图重新走一遍挂载加载。
 */

import { cacheManager } from '@/shared/lib/utils/cache'
import { resetIdentityScopedStores } from '@/shared/lib/store'
import { clearNotifications } from '@/shared/api/websocket'

/**
 * 切换身份时保留的 store：
 * - auth：认证状态本身就是切换的结果；
 * - timeContext：年度选择是用户偏好，与身份无关。
 */
export const IDENTITY_SCOPED_RESET_KEEP_STORES = ['auth', 'timeContext'] as const

/** 清掉上一身份留在前端的运行时状态（不含认证状态本身） */
export function resetIdentityRuntimeState(): string[] {
  cacheManager.clear()
  const resetStoreIds = resetIdentityScopedStores({
    keep: IDENTITY_SCOPED_RESET_KEEP_STORES
  })
  clearNotifications()
  return resetStoreIds
}
