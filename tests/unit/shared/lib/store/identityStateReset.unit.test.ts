/**
 * 身份级状态重置（Pinia 插件）
 *
 * Tests for 5-shared/lib/store/identityStateReset.ts
 *
 * 切换身份后各 store 必须回到初始状态，且还原的是「等价的新实例」——
 * 初始数组被原地 push 过也不能把脏数据带回来。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { computed, createApp, nextTick, reactive, ref, toRaw } from 'vue'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import {
  identityStateResetPlugin,
  resetIdentityScopedStores,
  resetIdentityStateResetRegistryForTests
} from '@/shared/lib/store/identityStateReset'

/** 形态对齐业务 store：数组 / 普通对象 / Set / Promise / 初始非空数组 */
const usePlanLikeStore = defineStore('plan-like', () => {
  const plans = ref<Array<{ id: number }>>([])
  const filters = ref<{ status: string; orgId: number | null }>({ status: 'all', orgId: null })
  const loading = ref(false)
  const inFlight = ref<Promise<void> | null>(null)
  const seen = ref(new Set<string>())
  const breadcrumbs = ref([{ level: 'organization', label: '组织总览' }])
  const meta = reactive({ version: 1, tags: ['a'] })
  const planCount = computed(() => plans.value.length)

  const load = () => {
    loading.value = true
    plans.value.push({ id: plans.value.length + 1 })
  }

  return { plans, filters, loading, inFlight, seen, breadcrumbs, meta, planCount, load }
})

const useAuthLikeStore = defineStore('auth', () => {
  const user = ref<{ userId: number } | null>(null)
  const setUser = (userId: number) => {
    user.value = { userId }
  }
  return { user, setUser }
})

function createRegisteredPinia() {
  const pinia = createPinia()
  pinia.use(identityStateResetPlugin)
  // pinia 2.x 的 use() 在 app.use(pinia) 之前只是把插件暂存起来，
  // 不装到 app 上插件永远不会生效（与 app-main.ts 的真实顺序一致）
  createApp({ render: () => null }).use(pinia)
  setActivePinia(pinia)
  return pinia
}

describe('identityStateResetPlugin', () => {
  beforeEach(() => {
    resetIdentityStateResetRegistryForTests()
  })

  it('把数组 / 普通对象 / Set / 原始值还原成与初始值等价的新实例', async () => {
    createRegisteredPinia()
    const store = usePlanLikeStore()

    const initialFilters = store.filters
    const initialBreadcrumbs = store.breadcrumbs

    store.load()
    store.load()
    store.filters.status = 'done'
    store.filters.orgId = 35
    store.inFlight = Promise.resolve()
    store.seen.add('x')
    store.breadcrumbs.push({ level: 'department', label: '教务处' })
    await nextTick()
    expect(store.planCount).toBe(2)

    const resetStoreIds = resetIdentityScopedStores()

    expect(resetStoreIds).toEqual(['plan-like'])
    expect(store.plans).toEqual([])
    expect(store.filters).toEqual({ status: 'all', orgId: null })
    expect(store.filters).not.toBe(initialFilters)
    expect(store.loading).toBe(false)
    expect(store.inFlight).toBeNull()
    expect(store.seen).toBeInstanceOf(Set)
    expect(store.seen.size).toBe(0)
    // 初始数组被原地 push 过：还原后仍是创建时的内容，且是新数组
    expect(store.breadcrumbs).toEqual([{ level: 'organization', label: '组织总览' }])
    expect(store.breadcrumbs).not.toBe(initialBreadcrumbs)
    expect(store.planCount).toBe(0)
  })

  it('reactive 状态就地还原（对象身份不变），计算属性同步刷新', () => {
    createRegisteredPinia()
    const store = usePlanLikeStore()
    const rawMeta = toRaw(store.meta)

    store.meta.version = 9
    store.meta.tags.push('b')

    resetIdentityScopedStores()

    expect(toRaw(store.meta)).toBe(rawMeta)
    expect(store.meta).toEqual({ version: 1, tags: ['a'] })
  })

  it('keep 列表里的 store 不动（认证状态本身、跨身份通用的用户偏好）', () => {
    createRegisteredPinia()
    const authStore = useAuthLikeStore()
    const planStore = usePlanLikeStore()
    authStore.setUser(44)
    planStore.load()

    const resetStoreIds = resetIdentityScopedStores({ keep: ['auth'] })

    expect(resetStoreIds).toEqual(['plan-like'])
    expect(authStore.user).toEqual({ userId: 44 })
    expect(planStore.plans).toEqual([])
  })

  it('插件注册之前创建的 store 不在登记表里，不会被重置', () => {
    setActivePinia(createPinia())
    const store = usePlanLikeStore()
    store.load()

    expect(resetIdentityScopedStores()).toEqual([])
    expect(store.plans).toHaveLength(1)
  })

  it('多次切换身份可重复还原', () => {
    createRegisteredPinia()
    const store = usePlanLikeStore()

    store.load()
    resetIdentityScopedStores()
    store.load()
    store.load()
    resetIdentityScopedStores()

    expect(store.plans).toEqual([])
    expect(store.filters).toEqual({ status: 'all', orgId: null })
  })
})
