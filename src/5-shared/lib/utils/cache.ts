/**
 * Unified query cache and compatibility utilities.
 *
 * This module now serves two roles:
 * 1. Structured query cache used by feature APIs and stores.
 * 2. Backward-compatible helpers used by existing Axios interceptors.
 */

import { logger } from './logger'

export type QueryScope = 'memory' | 'session' | 'local'
export type QueryKeyParams = Record<string, unknown> | undefined
export type QueryKey = readonly [domain: string, resource: string, params?: QueryKeyParams]
export type InvalidationTag = string
export type CacheSource = 'network' | 'memory' | 'session' | 'local'

export interface CachePolicy {
  ttlMs: number
  scope?: QueryScope
  staleWhileRevalidate?: boolean
  persist?: boolean
  dedupeWindowMs?: number
  invalidateOn?: InvalidationTag[]
  tags?: InvalidationTag[]
  version?: string
  useEtag?: boolean
  useLastModified?: boolean
}

export interface QueryCacheEntry<T = unknown> {
  data: T
  updatedAt: number
  expiresAt: number
  etag?: string
  lastModified?: string
  source: CacheSource
  version: string
  tags: InvalidationTag[]
  key: string
  scope: QueryScope
}

export interface CacheEntry<T = unknown> {
  data: T
  etag?: string
  lastModified?: string
  createdAt: number
  expiresAt: number
}

type PendingRequest<T = unknown> = {
  promise: Promise<T>
  startedAt: number
}

type QueryStoragePayload<T = unknown> = Omit<QueryCacheEntry<T>, 'source'>

type QueryCacheStats = {
  hits: number
  misses: number
  staleHits: number
  writes: number
  invalidations: number
  dedupedRequests: number
}

const DEFAULT_QUERY_VERSION = 'v1'
const DEFAULT_TTL = 60 * 1000
const STORAGE_PREFIX = 'query_cache:'

const defaultStats = (): QueryCacheStats => ({
  hits: 0,
  misses: 0,
  staleHits: 0,
  writes: 0,
  invalidations: 0,
  dedupedRequests: 0
})

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    )
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
  }

  return JSON.stringify(value)
}

function normalizeParams(params?: QueryKeyParams): QueryKeyParams {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return params
  }

  return Object.keys(params)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = params[key]
      return acc
    }, {})
}

export function buildQueryKey(domain: string, resource: string, params?: QueryKeyParams): QueryKey {
  return [domain, resource, normalizeParams(params)]
}

export function serializeQueryKey(key: QueryKey | string): string {
  if (typeof key === 'string') {
    return key
  }

  const [domain, resource, params] = key
  const normalizedParams = normalizeParams(params)
  return stableStringify([domain, resource, normalizedParams ?? null])
}

export function matchesInvalidationTags(
  candidate: readonly string[] | undefined,
  tagsOrKeys: readonly (string | QueryKey)[]
): boolean {
  if (!candidate || candidate.length === 0) {
    return false
  }

  const normalized = new Set(
    tagsOrKeys.map(item => (typeof item === 'string' ? item : serializeQueryKey(item)))
  )
  return candidate.some(item => normalized.has(item))
}

function getStorage(scope: QueryScope): Storage | null {
  if (typeof window === 'undefined') {
    return null
  }

  if (scope === 'session') {
    return window.sessionStorage
  }

  if (scope === 'local') {
    return window.localStorage
  }

  return null
}

function toStorageKey(serializedKey: string): string {
  return `${STORAGE_PREFIX}${serializedKey}`
}

function fromStoragePayload<T>(
  serializedKey: string,
  scope: QueryScope,
  payload: QueryStoragePayload<T>
): QueryCacheEntry<T> {
  return {
    ...payload,
    key: serializedKey,
    scope,
    source: scope
  }
}

function isExpired(entry: QueryCacheEntry | CacheEntry): boolean {
  return entry.expiresAt < Date.now()
}

function isStale(entry: QueryCacheEntry | CacheEntry): boolean {
  return entry.expiresAt <= Date.now()
}

export const DEFAULT_CACHE_CONFIGS: Record<string, CachePolicy> = {
  '["org","departments",null]': {
    ttlMs: 30 * 60 * 1000,
    scope: 'session',
    persist: true,
    staleWhileRevalidate: true,
    dedupeWindowMs: 1000,
    tags: ['org.list']
  },
  '["cycle","list",null]': {
    ttlMs: 30 * 60 * 1000,
    scope: 'session',
    persist: true,
    staleWhileRevalidate: true,
    dedupeWindowMs: 1000,
    tags: ['cycles.list']
  },
  '["plan","list",null]': {
    ttlMs: 2 * 60 * 1000,
    scope: 'session',
    persist: true,
    staleWhileRevalidate: true,
    dedupeWindowMs: 1000,
    tags: ['plan.list']
  },
  '["plan","detail",null]': {
    ttlMs: 60 * 1000,
    scope: 'memory',
    dedupeWindowMs: 1000,
    tags: ['plan.detail']
  },
  '["indicator","list",null]': {
    ttlMs: 2 * 60 * 1000,
    scope: 'session',
    persist: true,
    staleWhileRevalidate: true,
    dedupeWindowMs: 1000,
    tags: ['indicator.list']
  },
  '["task","list",null]': {
    ttlMs: 2 * 60 * 1000,
    scope: 'session',
    persist: true,
    staleWhileRevalidate: true,
    dedupeWindowMs: 1000,
    tags: ['task.list']
  },
  '["dashboard","overview",null]': {
    ttlMs: 45 * 1000,
    scope: 'memory',
    staleWhileRevalidate: true,
    dedupeWindowMs: 1000,
    tags: ['dashboard.overview']
  },
  '["auth","user",null]': {
    ttlMs: 10 * 60 * 1000,
    scope: 'session',
    persist: true,
    dedupeWindowMs: 1000,
    tags: ['auth.user']
  }
}

function createUrlPatternPolicyMap(): Map<string, CachePolicy> {
  const map = new Map<string, CachePolicy>()
  map.set('/organizations', {
    ttlMs: 30 * 60 * 1000,
    scope: 'session',
    persist: true,
    staleWhileRevalidate: true,
    dedupeWindowMs: 1000,
    tags: ['org.list']
  })
  map.set('/orgs', {
    ttlMs: 30 * 60 * 1000,
    scope: 'session',
    persist: true,
    staleWhileRevalidate: true,
    dedupeWindowMs: 1000,
    tags: ['org.list']
  })
  map.set('/cycles/list', {
    ttlMs: 30 * 60 * 1000,
    scope: 'session',
    persist: true,
    staleWhileRevalidate: true,
    dedupeWindowMs: 1000,
    tags: ['cycles.list']
  })
  map.set('/cycles', {
    ttlMs: 30 * 60 * 1000,
    scope: 'session',
    persist: true,
    staleWhileRevalidate: true,
    dedupeWindowMs: 1000,
    tags: ['cycles.list']
  })
  map.set('/plans', {
    ttlMs: 2 * 60 * 1000,
    scope: 'session',
    persist: true,
    staleWhileRevalidate: true,
    dedupeWindowMs: 1000,
    tags: ['plan.list']
  })
  map.set('/indicators', {
    ttlMs: 2 * 60 * 1000,
    scope: 'session',
    persist: true,
    staleWhileRevalidate: true,
    dedupeWindowMs: 1000,
    useLastModified: true,
    tags: ['indicator.list']
  })
  map.set('/tasks', {
    ttlMs: 2 * 60 * 1000,
    scope: 'session',
    persist: true,
    staleWhileRevalidate: true,
    dedupeWindowMs: 1000,
    tags: ['task.list']
  })
  return map
}

export class CacheManager {
  private memory = new Map<string, QueryCacheEntry>()
  private queryPolicies = new Map<string, CachePolicy>()
  private urlPolicies = createUrlPatternPolicyMap()
  private pendingRequests = new Map<string, PendingRequest>()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null
  private stats: QueryCacheStats = defaultStats()

  constructor() {
    Object.entries(DEFAULT_CACHE_CONFIGS).forEach(([serializedKey, policy]) => {
      this.queryPolicies.set(serializedKey, policy)
    })
    this.startCleanup()
  }

  private startCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanupExpired()
    }, 60 * 1000)
  }

  public stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  public registerPolicy(key: QueryKey | string, policy: CachePolicy): void {
    this.queryPolicies.set(serializeQueryKey(key), policy)
  }

  public registerUrlPolicy(urlPattern: string, policy: CachePolicy): void {
    const normalized = urlPattern.replace(/^\/api\/v1/, '').replace(/^\/api/, '')
    this.urlPolicies.set(normalized || '/', policy)
  }

  public getPolicy(key: QueryKey | string): CachePolicy | undefined {
    const serializedKey = serializeQueryKey(key)
    return this.queryPolicies.get(serializedKey)
  }

  public getConfig(urlOrKey: string): CachePolicy | undefined {
    if (this.queryPolicies.has(urlOrKey)) {
      return this.queryPolicies.get(urlOrKey)
    }

    const normalizedUrl = urlOrKey.replace(/^\/api\/v1/, '').replace(/^\/api/, '')
    for (const [pattern, policy] of this.urlPolicies.entries()) {
      if (normalizedUrl === pattern || normalizedUrl.startsWith(`${pattern}/`)) {
        return policy
      }
    }
    return undefined
  }

  public peek<T>(key: QueryKey | string): QueryCacheEntry<T> | undefined {
    const serializedKey = serializeQueryKey(key)
    const memoryEntry = this.memory.get(serializedKey) as QueryCacheEntry<T> | undefined
    if (memoryEntry) {
      return memoryEntry
    }

    const policy = this.getPolicy(serializedKey)
    if (!policy) {
      return undefined
    }

    return this.readFromPersistentScope<T>(serializedKey, policy)
  }

  public get<T>(key: QueryKey | string): QueryCacheEntry<T> | undefined {
    const entry = this.peek<T>(key)
    if (!entry) {
      this.stats.misses += 1
      return undefined
    }

    if (isExpired(entry)) {
      this.invalidate(key)
      this.stats.misses += 1
      return undefined
    }

    this.stats.hits += 1
    return entry
  }

  public set<T>(
    key: QueryKey | string,
    data: T,
    options: {
      etag?: string
      lastModified?: string
      ttl?: number
      source?: CacheSource
      tags?: InvalidationTag[]
      policy?: CachePolicy
    } = {}
  ): QueryCacheEntry<T> {
    const serializedKey = serializeQueryKey(key)
    const policy = options.policy ?? this.getPolicy(serializedKey) ?? this.getConfig(serializedKey)
    const scope = policy?.scope ?? 'memory'
    const ttl = options.ttl ?? policy?.ttlMs ?? DEFAULT_TTL
    const now = Date.now()
    const version = policy?.version ?? DEFAULT_QUERY_VERSION
    const entry: QueryCacheEntry<T> = {
      data,
      etag: options.etag,
      lastModified: options.lastModified,
      updatedAt: now,
      expiresAt: now + ttl,
      source: options.source ?? 'network',
      version,
      tags: Array.from(new Set([...(policy?.tags ?? []), ...(options.tags ?? [])])),
      key: serializedKey,
      scope
    }

    this.memory.set(serializedKey, entry)
    this.writeToPersistentScope(entry, policy)
    this.stats.writes += 1
    return entry
  }

  public isValid(key: QueryKey | string): boolean {
    const entry = this.peek(key)
    return !!entry && !isExpired(entry)
  }

  public getEtag(key: QueryKey | string): string | undefined {
    return this.peek(key)?.etag
  }

  public getLastModified(key: QueryKey | string): string | undefined {
    return this.peek(key)?.lastModified
  }

  public invalidate(key: QueryKey | string): boolean {
    const serializedKey = serializeQueryKey(key)
    const existing = this.peek(serializedKey)
    this.memory.delete(serializedKey)
    this.removeFromPersistentScopes(serializedKey)
    if (existing) {
      this.stats.invalidations += 1
      logger.debug(`[Cache] Invalidated: ${serializedKey}`)
    }
    return !!existing
  }

  public invalidateMany(tagsOrKeys: readonly (InvalidationTag | QueryKey)[]): number {
    let count = 0
    const serializedKeys = new Set<string>()
    const tags = new Set<string>()

    tagsOrKeys.forEach(item => {
      if (typeof item === 'string') {
        tags.add(item)
      } else {
        serializedKeys.add(serializeQueryKey(item))
      }
    })

    const invalidateIfMatched = (entry: QueryCacheEntry) => {
      if (serializedKeys.has(entry.key) || entry.tags.some(tag => tags.has(tag))) {
        count += this.invalidate(entry.key) ? 1 : 0
      }
    }

    Array.from(this.memory.values()).forEach(invalidateIfMatched)
    ;(['session', 'local'] as const).forEach(scope => {
      const storage = getStorage(scope)
      if (!storage) {
        return
      }
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const storageKey = storage.key(index)
        if (!storageKey || !storageKey.startsWith(STORAGE_PREFIX)) {
          continue
        }
        try {
          const serialized = storageKey.slice(STORAGE_PREFIX.length)
          const raw = storage.getItem(storageKey)
          if (!raw) {
            continue
          }
          const payload = JSON.parse(raw) as QueryStoragePayload
          const entry = fromStoragePayload(serialized, scope, payload)
          if (serializedKeys.has(entry.key) || entry.tags.some(tag => tags.has(tag))) {
            storage.removeItem(storageKey)
            this.memory.delete(serialized)
            count += 1
          }
        } catch (error) {
          logger.warn('[Cache] Failed to inspect persistent entry during invalidation:', error)
        }
      }
    })

    return count
  }

  public invalidatePattern(pattern: string | RegExp): number {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
    let count = 0
    Array.from(this.memory.keys()).forEach(key => {
      if (regex.test(key) && this.invalidate(key)) {
        count += 1
      }
    })
    return count
  }

  public clear(): void {
    const size = this.memory.size
    this.memory.clear()
    ;(['session', 'local'] as const).forEach(scope => {
      const storage = getStorage(scope)
      if (!storage) {
        return
      }
      const keys: string[] = []
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index)
        if (key?.startsWith(STORAGE_PREFIX)) {
          keys.push(key)
        }
      }
      keys.forEach(key => storage.removeItem(key))
    })
    logger.debug(`[Cache] Cleared all ${size} memory entries`)
  }

  public cleanupExpired(): void {
    Array.from(this.memory.entries()).forEach(([key, entry]) => {
      if (isExpired(entry)) {
        this.memory.delete(key)
      }
    })
    ;(['session', 'local'] as const).forEach(scope => {
      const storage = getStorage(scope)
      if (!storage) {
        return
      }

      const expiredKeys: string[] = []
      for (let index = 0; index < storage.length; index += 1) {
        const storageKey = storage.key(index)
        if (!storageKey || !storageKey.startsWith(STORAGE_PREFIX)) {
          continue
        }
        const raw = storage.getItem(storageKey)
        if (!raw) {
          expiredKeys.push(storageKey)
          continue
        }
        try {
          const payload = JSON.parse(raw) as QueryStoragePayload
          if (payload.expiresAt < Date.now()) {
            expiredKeys.push(storageKey)
          }
        } catch {
          expiredKeys.push(storageKey)
        }
      }
      expiredKeys.forEach(key => storage.removeItem(key))
    })
  }

  public getStats(): {
    size: number
    entries: Array<{
      key: string
      expiresIn: number
      hasEtag: boolean
      tags: string[]
      scope: QueryScope
    }>
    counters: QueryCacheStats
  } {
    const now = Date.now()
    return {
      size: this.memory.size,
      entries: Array.from(this.memory.values()).map(entry => ({
        key: entry.key,
        expiresIn: Math.max(0, entry.expiresAt - now),
        hasEtag: !!entry.etag,
        tags: entry.tags,
        scope: entry.scope
      })),
      counters: { ...this.stats }
    }
  }

  public resetStats(): void {
    this.stats = defaultStats()
  }

  public getPendingRequest<T>(key: QueryKey | string): PendingRequest<T> | undefined {
    return this.pendingRequests.get(serializeQueryKey(key)) as PendingRequest<T> | undefined
  }

  public setPendingRequest<T>(key: QueryKey | string, promise: Promise<T>): void {
    this.pendingRequests.set(serializeQueryKey(key), {
      promise,
      startedAt: Date.now()
    })
  }

  public clearPendingRequest(key: QueryKey | string): void {
    this.pendingRequests.delete(serializeQueryKey(key))
  }

  public markDedupedRequest(): void {
    this.stats.dedupedRequests += 1
  }

  public markStaleHit(): void {
    this.stats.staleHits += 1
  }

  private writeToPersistentScope(entry: QueryCacheEntry, policy?: CachePolicy): void {
    if (!policy || entry.scope === 'memory') {
      return
    }

    if (entry.scope === 'local' && !policy.persist) {
      return
    }

    const storage = getStorage(entry.scope)
    if (!storage) {
      return
    }

    const payload: QueryStoragePayload = {
      data: entry.data,
      updatedAt: entry.updatedAt,
      expiresAt: entry.expiresAt,
      etag: entry.etag,
      lastModified: entry.lastModified,
      version: entry.version,
      tags: entry.tags,
      key: entry.key,
      scope: entry.scope
    }

    try {
      storage.setItem(toStorageKey(entry.key), JSON.stringify(payload))
    } catch (error) {
      logger.warn('[Cache] Failed to persist cache entry:', error)
    }
  }

  private readFromPersistentScope<T>(
    serializedKey: string,
    policy: CachePolicy
  ): QueryCacheEntry<T> | undefined {
    const scope = policy.scope ?? 'memory'
    const storage = getStorage(scope)
    if (!storage) {
      return undefined
    }

    try {
      const raw = storage.getItem(toStorageKey(serializedKey))
      if (!raw) {
        return undefined
      }

      const payload = JSON.parse(raw) as QueryStoragePayload<T>
      if (payload.version !== (policy.version ?? DEFAULT_QUERY_VERSION)) {
        storage.removeItem(toStorageKey(serializedKey))
        return undefined
      }

      if (payload.expiresAt < Date.now()) {
        storage.removeItem(toStorageKey(serializedKey))
        return undefined
      }

      const entry = fromStoragePayload(serializedKey, scope, payload)
      this.memory.set(serializedKey, entry)
      return entry
    } catch (error) {
      logger.warn('[Cache] Failed to read persistent cache entry:', error)
      return undefined
    }
  }

  private removeFromPersistentScopes(serializedKey: string): void {
    ;(['session', 'local'] as const).forEach(scope => {
      const storage = getStorage(scope)
      storage?.removeItem(toStorageKey(serializedKey))
    })
  }
}

export const cacheManager = new CacheManager()
export const queryCache = cacheManager

function toLegacyCacheKey(url: string, params?: Record<string, unknown>): string {
  const normalizedUrl = url.replace(/^\/api\/v1/, '').replace(/^\/api/, '')
  if (!params || Object.keys(params).length === 0) {
    return normalizedUrl
  }
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${stableStringify(params[key])}`)
    .join('&')
  return `${normalizedUrl}?${sortedParams}`
}

export function generateCacheKey(url: string, params?: Record<string, unknown>): string {
  return toLegacyCacheKey(url, params)
}

export function shouldCache(method: string, url: string): boolean {
  if (method.toUpperCase() !== 'GET') {
    return false
  }
  return cacheManager.getConfig(url) !== undefined
}

export function getCacheValidationHeaders(
  url: string,
  params?: Record<string, unknown>
): Record<string, string> {
  const cacheKey = generateCacheKey(url, params)
  const config = cacheManager.getConfig(url)
  const headers: Record<string, string> = {}

  if (!config) {
    return headers
  }

  if (config.useEtag) {
    const etag = cacheManager.getEtag(cacheKey)
    if (etag) {
      headers['If-None-Match'] = etag
    }
  }

  if (config.useLastModified) {
    const lastModified = cacheManager.getLastModified(cacheKey)
    if (lastModified) {
      headers['If-Modified-Since'] = lastModified
    }
  }

  return headers
}

export function handleCacheResponse<T>(
  url: string,
  params: Record<string, unknown> | undefined,
  response: {
    status: number
    data: T
    headers: {
      etag?: string
      'last-modified'?: string
      [key: string]: string | undefined
    }
  }
): { data: T; fromCache: boolean } {
  const cacheKey = generateCacheKey(url, params)

  if (response.status === 304) {
    const cached = cacheManager.get<T>(cacheKey)
    if (cached) {
      logger.debug(`[Cache] 304 Not Modified, using cached data: ${cacheKey}`)
      return { data: cached.data, fromCache: true }
    }
  }

  cacheManager.set(cacheKey, response.data, {
    etag: response.headers.etag || response.headers['etag'],
    lastModified: response.headers['last-modified']
  })

  return { data: response.data, fromCache: false }
}

export function getFromCache<T>(url: string, params?: Record<string, unknown>): T | undefined {
  return cacheManager.get<T>(generateCacheKey(url, params))?.data
}

export function refreshCache(url: string, params?: Record<string, unknown>): void {
  cacheManager.invalidate(generateCacheKey(url, params))
}

export function refreshCachePattern(pattern: string | RegExp): number {
  return cacheManager.invalidatePattern(pattern)
}

type FetchWithCacheOptions<T> = {
  key: QueryKey
  policy: CachePolicy
  fetcher: () => Promise<T>
  tags?: InvalidationTag[]
  force?: boolean
  background?: boolean
  onHit?: (entry: QueryCacheEntry<T>) => void
}

export async function fetchWithCache<T>({
  key,
  policy,
  fetcher,
  tags,
  force = false,
  background = false,
  onHit
}: FetchWithCacheOptions<T>): Promise<T> {
  const serializedKey = serializeQueryKey(key)
  cacheManager.registerPolicy(serializedKey, policy)

  const cached = !force ? cacheManager.peek<T>(serializedKey) : undefined
  if (cached && !isStale(cached)) {
    onHit?.(cached)
    cacheManager.get(serializedKey)
    return cached.data
  }

  if (cached && policy.staleWhileRevalidate && !background) {
    onHit?.(cached)
    cacheManager.markStaleHit()
    void fetchWithCache({
      key,
      policy,
      fetcher,
      tags,
      force: true,
      background: true
    }).catch(error => {
      logger.warn('[Cache] Background revalidation failed:', error)
    })
    return cached.data
  }

  // 2026-10-27 修复：force 必须真正发起新请求。
  // 此前 force 只跳过了「已缓存结果」，但仍会命中 pending 请求去重——
  // 复用那个尚未包含最新数据的老 promise。结果是「删除/复制指标后立刻刷新」
  // 拿到的是操作前的列表，界面上残留旧行，只有整页刷新才会更正。
  const pending = force ? undefined : cacheManager.getPendingRequest<T>(serializedKey)
  if (pending && Date.now() - pending.startedAt < (policy.dedupeWindowMs ?? 0)) {
    cacheManager.markDedupedRequest()
    return pending.promise
  }

  const promise = (async () => {
    try {
      const data = await fetcher()
      cacheManager.set(serializedKey, data, {
        policy,
        tags,
        source: 'network'
      })
      return data
    } finally {
      cacheManager.clearPendingRequest(serializedKey)
    }
  })()

  cacheManager.setPendingRequest(serializedKey, promise)
  return promise
}

export function invalidateQueries(tagsOrKeys: readonly (InvalidationTag | QueryKey)[]): number {
  return cacheManager.invalidateMany(tagsOrKeys)
}

export type { QueryCacheStats }
