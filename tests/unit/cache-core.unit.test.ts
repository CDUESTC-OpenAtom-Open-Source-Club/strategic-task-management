import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildQueryKey,
  cacheManager,
  CacheManager,
  fetchWithCache,
  invalidateQueries,
  serializeQueryKey
} from '@/shared/lib/utils/cache'

describe('query cache core', () => {
  beforeEach(() => {
    cacheManager.clear()
    cacheManager.resetStats()
    sessionStorage.clear()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cacheManager.clear()
    cacheManager.resetStats()
    sessionStorage.clear()
    localStorage.clear()
  })

  it('serializes query keys deterministically', () => {
    const keyA = buildQueryKey('plan', 'detail', { b: 2, a: 1 })
    const keyB = buildQueryKey('plan', 'detail', { a: 1, b: 2 })

    expect(serializeQueryKey(keyA)).toBe(serializeQueryKey(keyB))
  })

  it('deduplicates concurrent requests by query key', async () => {
    const fetcher = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
      return { ok: true }
    })

    const key = buildQueryKey('task', 'list', { year: 2026 })
    const policy = {
      ttlMs: 1000,
      scope: 'memory' as const,
      dedupeWindowMs: 500,
      tags: ['task.list']
    }

    const [left, right] = await Promise.all([
      fetchWithCache({ key, policy, fetcher }),
      fetchWithCache({ key, policy, fetcher })
    ])

    expect(left).toEqual({ ok: true })
    expect(right).toEqual({ ok: true })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(cacheManager.getStats().counters.dedupedRequests).toBe(1)
  })

  it('invalidates entries by tag without touching unrelated entries', async () => {
    await fetchWithCache({
      key: buildQueryKey('plan', 'list'),
      policy: { ttlMs: 1000, scope: 'memory', dedupeWindowMs: 100, tags: ['plan.list'] },
      fetcher: async () => ['plan-a']
    })

    await fetchWithCache({
      key: buildQueryKey('task', 'list', { year: 2026 }),
      policy: { ttlMs: 1000, scope: 'memory', dedupeWindowMs: 100, tags: ['task.list'] },
      fetcher: async () => ['task-a']
    })

    expect(cacheManager.get(buildQueryKey('plan', 'list'))?.data).toEqual(['plan-a'])
    expect(cacheManager.get(buildQueryKey('task', 'list', { year: 2026 }))?.data).toEqual(['task-a'])

    invalidateQueries(['plan.list'])

    expect(cacheManager.get(buildQueryKey('plan', 'list'))).toBeUndefined()
    expect(cacheManager.get(buildQueryKey('task', 'list', { year: 2026 }))?.data).toEqual(['task-a'])
  })

  it('serves stale data for SWR entries but truly refetches when force is passed', async () => {
    let revision = 0
    const fetcher = vi.fn(async () => {
      revision += 1
      return { revision }
    })

    const key = buildQueryKey('workflow', 'historyByBusiness', { entityId: '1' })
    const policy = {
      ttlMs: 20,
      scope: 'memory' as const,
      staleWhileRevalidate: true,
      dedupeWindowMs: 100,
      tags: ['workflow.detail']
    }

    // 首次回源写入 revision 1
    const first = await fetchWithCache({ key, policy, fetcher })
    expect(first).toEqual({ revision: 1 })
    expect(fetcher).toHaveBeenCalledTimes(1)

    // 等 TTL 过期，条目进入 stale
    await new Promise(resolve => setTimeout(resolve, 30))

    // SWR：过期条目先返回旧数据，刷新走后台（不阻塞调用方）
    const stale = await fetchWithCache({ key, policy, fetcher })
    expect(stale).toEqual({ revision: 1 })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(fetcher).toHaveBeenCalledTimes(2)

    // force：不吃 SWR 旧数据、绕过 pending 去重，真正回源拿最新值
    // （一键下发后抽屉打开必须回源审批历史的依赖路径）
    const forced = await fetchWithCache({ key, policy, fetcher, force: true })
    expect(forced).toEqual({ revision: 3 })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('invalidates every workflow domain entry when a tag list is passed', async () => {
    const historyKey = buildQueryKey('workflow', 'historyByBusiness', { entityId: '9' })
    const todoKey = buildQueryKey('workflow', 'todo', { pageNum: 1 })
    const planKey = buildQueryKey('plan', 'list')
    const basePolicy = { ttlMs: 60_000, scope: 'memory' as const, dedupeWindowMs: 100 }

    await fetchWithCache({
      key: historyKey,
      policy: { ...basePolicy, tags: ['workflow.detail'] },
      fetcher: async () => ['history-card']
    })
    await fetchWithCache({
      key: todoKey,
      policy: { ...basePolicy, tags: ['workflow.todo'] },
      fetcher: async () => ({ records: [] })
    })
    await fetchWithCache({
      key: planKey,
      policy: { ...basePolicy, tags: ['plan.list'] },
      fetcher: async () => ['plan-a']
    })

    invalidateQueries(['workflow.detail', 'workflow.todo'])

    expect(cacheManager.get(historyKey)).toBeUndefined()
    expect(cacheManager.get(todoKey)).toBeUndefined()
    // 与 workflow 域无关的条目不受影响
    expect(cacheManager.get(planKey)?.data).toEqual(['plan-a'])
  })

  it('persists session-scoped entries and restores them from storage', async () => {
    const key = buildQueryKey('auth', 'user')
    const policy = {
      ttlMs: 60_000,
      scope: 'session' as const,
      persist: true,
      dedupeWindowMs: 100,
      tags: ['auth.user']
    }

    await fetchWithCache({
      key,
      policy,
      fetcher: async () => ({ id: 1, name: 'tester' })
    })

    const serialized = serializeQueryKey(key)
    expect(sessionStorage.getItem(`query_cache:${serialized}`)).not.toBeNull()

    const freshManager = new CacheManager()
    freshManager.registerPolicy(key, policy)

    expect(freshManager.get<{ id: number; name: string }>(key)?.data).toEqual({
      id: 1,
      name: 'tester'
    })
    freshManager.stopCleanup()
  })
})
