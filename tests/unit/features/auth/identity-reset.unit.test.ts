/**
 * 切换身份后的前端运行时状态清理
 *
 * Tests for features/auth/lib/identityReset.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createApp, ref } from 'vue'
import { createPinia, defineStore, setActivePinia } from 'pinia'

vi.mock('@/shared/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import {
  IDENTITY_SCOPED_RESET_KEEP_STORES,
  resetIdentityRuntimeState
} from '@/features/auth/lib/identityReset'
import { buildQueryKey, cacheManager } from '@/shared/lib/utils/cache'
import {
  identityStateResetPlugin,
  resetIdentityStateResetRegistryForTests
} from '@/shared/lib/store'
import * as websocketModule from '@/shared/api/websocket'

const usePlanLikeStore = defineStore('plan-like', () => {
  const plans = ref<number[]>([])
  return { plans }
})

const useAuthLikeStore = defineStore('auth', () => {
  const user = ref<{ userId: number } | null>(null)
  return { user }
})

describe('resetIdentityRuntimeState', () => {
  beforeEach(() => {
    resetIdentityStateResetRegistryForTests()
    cacheManager.clear()
    const pinia = createPinia()
    pinia.use(identityStateResetPlugin)
    // pinia 2.x 的 use() 在 app.use(pinia) 之前只是把插件暂存起来，
    // 不装到 app 上插件永远不会生效（与 app-main.ts 的真实顺序一致）
    createApp({ render: () => null }).use(pinia)
    setActivePinia(pinia)
  })

  it('清空全部查询缓存（含持久化项）', () => {
    const memoryKey = buildQueryKey('plan', 'detail', { id: 1 })
    const persistedKey = buildQueryKey('plan', 'list')
    cacheManager.set(memoryKey, { id: 1 }, { policy: { ttlMs: 60_000 } })
    cacheManager.set(persistedKey, [{ id: 1 }], {
      policy: { ttlMs: 60_000, scope: 'session', persist: true }
    })
    expect(cacheManager.getStats().size).toBe(2)

    resetIdentityRuntimeState()

    expect(cacheManager.getStats().size).toBe(0)
    expect(cacheManager.peek(memoryKey)).toBeUndefined()
    expect(cacheManager.peek(persistedKey)).toBeUndefined()
  })

  it('还原除认证状态与年度偏好之外的全部 store，并清掉 WebSocket 累积的通知', () => {
    const authStore = useAuthLikeStore()
    const planStore = usePlanLikeStore()
    authStore.user = { userId: 44 }
    planStore.plans = [1, 2, 3]
    const clearNotificationsSpy = vi.spyOn(websocketModule, 'clearNotifications')

    const resetStoreIds = resetIdentityRuntimeState()

    expect(resetStoreIds).toEqual(['plan-like'])
    expect(authStore.user).toEqual({ userId: 44 })
    expect(planStore.plans).toEqual([])
    expect(clearNotificationsSpy).toHaveBeenCalledTimes(1)
  })

  it('保留名单固定为 auth 与 timeContext', () => {
    expect(IDENTITY_SCOPED_RESET_KEEP_STORES).toEqual(['auth', 'timeContext'])
  })
})
