/**
 * 查询缓存 clear() 的世代守卫
 *
 * 背景：切换身份会 clear() 全部查询缓存，但清空之前已在途的请求
 * 返回后仍会回写缓存 / 被同名 key 的新请求复用——上一身份的数据就这样
 * 留给了新身份。clear() 之后这些在途请求必须整体作废。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/shared/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

import { buildQueryKey, cacheManager, fetchWithCache } from '@/shared/lib/utils/cache'

const POLICY = { ttlMs: 60 * 1000, dedupeWindowMs: 10 * 1000 }
const KEY = buildQueryKey('plan', 'list', { year: 2026 })

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

describe('cache clear epoch', () => {
  beforeEach(() => {
    cacheManager.clear()
    cacheManager.resetStats()
  })

  it('clear() 递增缓存世代', () => {
    const before = cacheManager.getEpoch()
    cacheManager.clear()
    expect(cacheManager.getEpoch()).toBe(before + 1)
  })

  it('clear() 之后新发起的请求照常回写缓存', async () => {
    const data = await fetchWithCache({
      key: KEY,
      policy: POLICY,
      fetcher: async () => [{ id: 1 }]
    })

    expect(data).toEqual([{ id: 1 }])
    expect(cacheManager.peek(KEY)?.data).toEqual([{ id: 1 }])
  })

  it('清空前已在途的请求返回后不回写缓存（结果仍交给发起方）', async () => {
    const deferred = createDeferred<Array<{ id: number }>>()
    const pending = fetchWithCache({
      key: KEY,
      policy: POLICY,
      fetcher: () => deferred.promise
    })

    cacheManager.clear()
    deferred.resolve([{ id: 'old-identity' }])
    expect(await pending).toEqual([{ id: 'old-identity' }])

    expect(cacheManager.peek(KEY)).toBeUndefined()
    expect(cacheManager.getStats().counters.writes).toBe(0)
  })

  it('清空后同名 key 的新请求不复用旧的在途请求', async () => {
    const oldDeferred = createDeferred<Array<{ id: string }>>()
    const oldRequest = fetchWithCache({
      key: KEY,
      policy: POLICY,
      fetcher: () => oldDeferred.promise
    })

    cacheManager.clear()

    const newRequest = fetchWithCache({
      key: KEY,
      policy: POLICY,
      fetcher: async () => [{ id: 'new-identity' }]
    })

    expect(await newRequest).toEqual([{ id: 'new-identity' }])
    expect(cacheManager.getStats().counters.dedupedRequests).toBe(0)

    oldDeferred.resolve([{ id: 'old-identity' }])
    expect(await oldRequest).toEqual([{ id: 'old-identity' }])

    // 旧请求收尾不得清掉新请求的缓存
    expect(cacheManager.peek(KEY)?.data).toEqual([{ id: 'new-identity' }])
  })

  it('旧请求收尾不会误删同名 key 上新请求的去重标记', async () => {
    const oldDeferred = createDeferred<Array<{ id: string }>>()
    const oldRequest = fetchWithCache({
      key: KEY,
      policy: POLICY,
      fetcher: () => oldDeferred.promise
    })

    cacheManager.clear()

    const newDeferred = createDeferred<Array<{ id: string }>>()
    const newFetcher = vi.fn(() => newDeferred.promise)
    const newRequest = fetchWithCache({ key: KEY, policy: POLICY, fetcher: newFetcher })

    oldDeferred.resolve([{ id: 'old-identity' }])
    await oldRequest

    // 此时新请求仍在途：再来的请求应复用新请求，而不是第三次发请求
    const deduped = fetchWithCache({ key: KEY, policy: POLICY, fetcher: newFetcher })
    expect(newFetcher).toHaveBeenCalledTimes(1)

    // deduped 复用的正是 newRequest 的在途 promise，二者要等同一次 resolve 才会落定，
    // 必须先 resolve 再 await，否则互相等待（测试挂死）
    newDeferred.resolve([{ id: 'new-identity' }])
    expect(await deduped).toBe(await newRequest)
  })
})
