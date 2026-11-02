/**
 * Time Context Store
 *
 * Manages the current year context for the application.
 * Supports viewing historical data by switching years.
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiClient } from '@/shared/api/client'
import { logger } from '@/shared/lib/utils/logger'
import { buildQueryKey, fetchWithCache } from '@/shared/lib/utils/cache'
import { createPersistentReferencePolicy } from '@/shared/lib/utils/cache-config'
import { getCachedUserContext } from '@/shared/lib/utils/cacheContext'
import { localStorage as storage } from '@/shared/lib/storage'
import type { AssessmentCycle as AssessmentCycleVO } from '@/shared/types/backend-aligned'

/**
 * 年份选择的持久化（2026-10-31 用户拍板：跨刷新记忆）。
 *
 * - 只存「用户主动选择」的年份（YearSelector 的 set/switch 路径），初始化时读取；
 *   非法值（非 4 位数字、超出合理区间）一律忽略并回退当前年。
 * - 只读状态（isReadOnly）按年份与当前年比较推导，自然跟随，无需单独存。
 * - localStorage 不可用（隐私模式等）时由 storage 包装层 try/catch 静默降级。
 */
const SELECTED_YEAR_STORAGE_KEY = 'sism.selectedYear'
const MIN_VALID_YEAR = 2000
const MAX_VALID_YEAR = 2100

/**
 * 是否为合法的可持久化年份（整数、4 位数字、合理区间 2000-2100）。
 */
function isValidSelectableYear(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_VALID_YEAR &&
    value <= MAX_VALID_YEAR
  )
}

/**
 * 从 localStorage 读取上次选择的年份；无记录或值非法返回 null。
 */
export function readPersistedSelectedYear(): number | null {
  const stored = storage.getItem<number>(SELECTED_YEAR_STORAGE_KEY)
  return isValidSelectableYear(stored) ? stored : null
}

/**
 * 持久化用户选择的年份（非法值不写，避免污染下次初始化）。
 */
function persistSelectedYear(year: number): void {
  if (isValidSelectableYear(year)) {
    storage.setItem(SELECTED_YEAR_STORAGE_KEY, year)
  }
}

/**
 * 清掉持久化的年份（回当前年时保持语义一致：不残留历史选择）。
 */
function clearPersistedSelectedYear(): void {
  storage.removeItem(SELECTED_YEAR_STORAGE_KEY)
}

export const useTimeContextStore = defineStore('timeContext', () => {
  // ============ State ============

  /**
   * Current year being viewed (can be historical)
   *
   * 初始化时优先采用上次用户选择的年份（跨刷新记忆），无记录/非法则回退当前年。
   */
  const currentYear = ref<number>(readPersistedSelectedYear() ?? new Date().getFullYear())

  /**
   * Real current year (always the actual current year)
   */
  const realCurrentYear = computed(() => new Date().getFullYear())

  /**
   * Loading state for fetching years from API
   */
  const loading = ref(false)

  /**
   * Available years for selection (from backend API)
   */
  const availableYears = ref<number[]>([])

  /**
   * Full cycle list from backend API.
   * Used to resolve the real year from cycleId instead of relying on hardcoded mappings.
   */
  const cycles = ref<AssessmentCycleVO[]>([])

  /**
   * Fallback years if API fails
   */
  const fallbackYears = computed(() => {
    const current = realCurrentYear.value
    const years: number[] = []
    years.push(current)
    for (let i = 1; i <= 5; i++) {
      const year = current - i
      if (year >= 2020) {
        years.push(year)
      }
    }
    return years
  })

  /**
   * Computed available years (use API data if available, fallback otherwise)
   */
  const yearsForSelector = computed(() => {
    if (availableYears.value.length > 0) {
      return availableYears.value
    }
    return fallbackYears.value
  })

  const cycleYearMap = computed(() => {
    const entries = cycles.value
      .map(cycle => {
        const cycleId = Number(cycle.cycleId)
        const year = Number(cycle.year)
        return Number.isFinite(cycleId) && cycleId > 0 && Number.isFinite(year)
          ? ([cycleId, year] as const)
          : null
      })
      .filter((entry): entry is readonly [number, number] => entry !== null)

    return new Map<number, number>(entries)
  })

  /**
   * Whether we're viewing historical data
   */
  const isHistoricalMode = computed(() => currentYear.value !== realCurrentYear.value)

  /**
   * Whether the data is read-only (historical mode)
   */
  const isReadOnly = computed(() => isHistoricalMode.value)

  /**
   * Whether we're viewing current year
   */
  const isCurrentYear = computed(() => currentYear.value === realCurrentYear.value)
  const selectedYear = computed(() => currentYear.value)

  // ============ Actions ============

  /**
   * Fetch available years from backend API
   */
  async function fetchAvailableYears(options: { force?: boolean } = {}) {
    if (!options.force && (availableYears.value.length > 0 || cycles.value.length > 0)) {
      return
    }

    if (loading.value) {
      return
    }

    loading.value = true
    try {
      const userContext = getCachedUserContext()
      const response = await fetchWithCache<{
        success?: boolean
        data?: AssessmentCycleVO[]
        message?: string
      }>({
        key: buildQueryKey('cycle', 'list', {
          ...userContext,
          version: 'v1'
        }),
        policy: createPersistentReferencePolicy({
          tags: ['cycles.list']
        }),
        fetcher: () =>
          apiClient.get<{
            success?: boolean
            data?: AssessmentCycleVO[]
            message?: string
          }>('/cycles/list')
      })

      const years = Array.isArray(response.data)
        ? response.data
            .map(cycle => cycle.year)
            .filter((year): year is number => typeof year === 'number')
        : []

      cycles.value = Array.isArray(response.data) ? response.data : []

      if (response.success && years.length > 0) {
        availableYears.value = [...new Set(years)].sort((left, right) => right - left)
      } else {
        logger.warn('[TimeContext] No years returned from API, using fallback')
        availableYears.value = fallbackYears.value
      }
    } catch (error) {
      logger.error('[TimeContext] Failed to fetch available years:', error)
      cycles.value = []
      availableYears.value = fallbackYears.value
    } finally {
      loading.value = false
    }
  }

  /**
   * Initialize - fetch years from API
   */
  const initializePromise = ref<Promise<void> | null>(null)

  async function initialize(options: { force?: boolean } = {}) {
    if (!options.force && (availableYears.value.length > 0 || cycles.value.length > 0)) {
      return
    }

    if (initializePromise.value) {
      return initializePromise.value
    }

    const task = (async () => {
      try {
        await fetchAvailableYears(options)
      } finally {
        initializePromise.value = null
      }
    })()

    initializePromise.value = task
    return task
  }

  /**
   * Set the current year context
   *
   * 用户主动选择的年份持久化到 localStorage（跨刷新记忆）。
   */
  function setYear(year: number) {
    currentYear.value = year
    persistSelectedYear(year)
  }

  /**
   * Reset to current year
   *
   * 回到当前年即放弃历史选择，同步清掉持久化记录，保证语义一致。
   */
  function resetToCurrentYear() {
    currentYear.value = realCurrentYear.value
    clearPersistedSelectedYear()
  }

  /**
   * Get status of a year (history, current, or future)
   */
  function getYearStatus(year: number): 'history' | 'current' | 'future' {
    if (year === realCurrentYear.value) {
      return 'current'
    }
    if (year > realCurrentYear.value) {
      return 'future'
    }
    return 'history'
  }

  /**
   * Switch to a specific year
   *
   * 年份切换器（YearSelector）的入口，同样持久化用户选择。
   */
  async function switchYear(year: number) {
    currentYear.value = year
    persistSelectedYear(year)
  }

  function resolveCycleYear(cycleId: unknown): number | null {
    const numericCycleId = Number(cycleId)
    if (!Number.isFinite(numericCycleId) || numericCycleId <= 0) {
      return null
    }

    return cycleYearMap.value.get(numericCycleId) ?? null
  }

  // Auto-initialize on store creation
  initialize()

  return {
    currentYear,
    selectedYear,
    realCurrentYear,
    loading,
    availableYears: yearsForSelector,
    cycles,
    cycleYearMap,
    isHistoricalMode,
    isCurrentYear,
    isReadOnly,
    setYear,
    resetToCurrentYear,
    getYearStatus,
    resolveCycleYear,
    switchYear,
    initialize
  }
})
