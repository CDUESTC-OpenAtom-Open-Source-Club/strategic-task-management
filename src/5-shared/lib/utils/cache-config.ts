import type { CachePolicy } from './cache'

export const CACHE_TTL = {
  ORG: 30 * 60 * 1000,
  CYCLE: 30 * 60 * 1000,
  LIST: 2 * 60 * 1000,
  DETAIL: 60 * 1000,
  DASHBOARD: 45 * 1000,
  WORKFLOW_TODO: 20 * 1000,
  WORKFLOW_DETAIL: 30 * 1000,
  MESSAGE_LIST: 20 * 1000,
  MESSAGE_UNREAD: 15 * 1000
} as const

export const CACHE_DEDUPE_WINDOW_MS = 1000

type PolicyOverrides = Partial<Omit<CachePolicy, 'scope' | 'dedupeWindowMs' | 'tags'>> & {
  tags: string[]
}

export function createSessionListPolicy(overrides: PolicyOverrides): CachePolicy {
  return {
    ttlMs: CACHE_TTL.LIST,
    scope: 'session',
    persist: true,
    staleWhileRevalidate: true,
    dedupeWindowMs: CACHE_DEDUPE_WINDOW_MS,
    ...overrides
  }
}

export function createMemoryDetailPolicy(overrides: PolicyOverrides): CachePolicy {
  return {
    ttlMs: CACHE_TTL.DETAIL,
    scope: 'memory',
    dedupeWindowMs: CACHE_DEDUPE_WINDOW_MS,
    ...overrides
  }
}

export function createShortMemoryPolicy(ttlMs: number, overrides: PolicyOverrides): CachePolicy {
  return {
    ttlMs,
    scope: 'memory',
    dedupeWindowMs: CACHE_DEDUPE_WINDOW_MS,
    ...overrides
  }
}

export function createPersistentReferencePolicy(overrides: PolicyOverrides): CachePolicy {
  return {
    ttlMs: CACHE_TTL.ORG,
    scope: 'session',
    persist: true,
    staleWhileRevalidate: true,
    dedupeWindowMs: CACHE_DEDUPE_WINDOW_MS,
    ...overrides
  }
}
