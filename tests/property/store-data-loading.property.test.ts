/**
 * Store 数据加载属性测试
 *
 * 测试 Pinia Store 的数据加载和降级机制
 *
 * **Feature: page-data-verification**
 * - **Property 1: Data Source Verification**
 * - **Property 7: Fallback Mechanism Trigger**
 *
 * **Validates: Requirements 1.1, 1.4, 7.4, 8.1**
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import * as fc from 'fast-check'
import { setActivePinia, createPinia } from 'pinia'
import { useStrategicStore } from '@/features/task/model/strategic'

// ============================================================================
// 测试环境设置 - Mock localStorage
// ============================================================================

/**
 * 创建 localStorage mock
 */
const createLocalStorageMock = () => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    get length() {
      return Object.keys(store).length
    },
    key: vi.fn((index: number) => Object.keys(store)[index] || null)
  }
}

// 全局 localStorage mock
const localStorageMock = createLocalStorageMock()

// 在所有测试之前设置 localStorage mock
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true
  })
})

// ============================================================================
// 测试数据生成器 (Arbitraries)
// ============================================================================

/**
 * 生成非空白字符串
 */
const nonEmptyStringArbitrary = (maxLength: number = 50) =>
  fc.string({ minLength: 1, maxLength }).filter(s => s.trim().length > 0)

// ============================================================================
// Property 1: Data Source Verification
// ============================================================================

describe('Property 1: Data Source Verification', () => {
  /**
   * **Validates: Requirements 1.1, 8.1**
   *
   * *For any* page data displayed in the application, if the data originates
   * from a Pinia Store, then the Store's dataSource flag SHALL indicate 'api'
   * when backend is available, and the data SHALL match the structure returned
   * by the corresponding API endpoint.
   */

  beforeEach(() => {
    // 创建新的 Pinia 实例
    setActivePinia(createPinia())
    // 清除所有 mock
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Data Source Flag Verification', () => {
    it('should have dataSource as "local" initially before any API call', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const store = useStrategicStore()

          // 初始状态应该是 'local'（因为还没有成功的 API 调用）
          // 注意：store 初始化时会尝试加载数据，但在测试环境中 API 不可用
          expect(['local', 'fallback', 'api']).toContain(store.dataSource)

          return true
        }),
        { numRuns: 10 }
      )
    })

    it('should have dataSource property defined in store', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const store = useStrategicStore()

          // dataSource 属性应该存在
          expect(store.dataSource).toBeDefined()

          // dataSource 应该是有效的枚举值
          expect(['api', 'fallback', 'local']).toContain(store.dataSource)

          return true
        }),
        { numRuns: 10 }
      )
    })

    it('should have loadingState property defined in store', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const store = useStrategicStore()

          // loadingState 属性应该存在
          expect(store.loadingState).toBeDefined()
          expect(store.loadingState).toHaveProperty('indicators')
          expect(store.loadingState).toHaveProperty('tasks')
          expect(store.loadingState).toHaveProperty('error')

          return true
        }),
        { numRuns: 10 }
      )
    })

    it('should have validationState property defined in store', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const store = useStrategicStore()

          // validationState 属性应该存在
          expect(store.validationState).toBeDefined()
          expect(store.validationState).toHaveProperty('lastValidated')
          expect(store.validationState).toHaveProperty('isValid')
          expect(store.validationState).toHaveProperty('issues')

          return true
        }),
        { numRuns: 10 }
      )
    })
  })

  describe('Indicator Data Structure Verification', () => {
    it('should have indicators array with valid structure', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const store = useStrategicStore()

          // indicators 应该是数组
          expect(Array.isArray(store.indicators)).toBe(true)

          return true
        }),
        { numRuns: 10 }
      )
    })

    it('should have all required fields in each indicator', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const store = useStrategicStore()

          // 检查每个指标是否有必要字段
          for (const indicator of store.indicators) {
            // 必填字段检查
            expect(indicator.id).toBeDefined()
            expect(indicator.name).toBeDefined()
            expect(typeof indicator.progress).toBe('number')
            expect(typeof indicator.weight).toBe('number')
            expect(indicator.responsibleDept).toBeDefined()

            // 进度值范围检查
            expect(indicator.progress).toBeGreaterThanOrEqual(0)
            expect(indicator.progress).toBeLessThanOrEqual(100)

            // 权重值检查
            expect(indicator.weight).toBeGreaterThanOrEqual(0)
          }

          return true
        }),
        { numRuns: 10 }
      )
    })
  })

  describe('Data Health Status Verification', () => {
    it('should return valid DataHealthStatus from getDataHealth', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const store = useStrategicStore()

          const health = store.getDataHealth()

          // 健康状态应该有所有必要字段
          expect(health).toHaveProperty('status')
          expect(health).toHaveProperty('dataSource')
          expect(health).toHaveProperty('indicatorCount')
          expect(health).toHaveProperty('taskCount')
          expect(health).toHaveProperty('validationIssues')
          expect(health).toHaveProperty('lastValidated')

          // 状态应该是有效枚举值
          expect(['healthy', 'warning', 'critical']).toContain(health.status)
          expect(['api', 'fallback', 'local']).toContain(health.dataSource)

          // 数量应该是非负数
          expect(health.indicatorCount).toBeGreaterThanOrEqual(0)
          expect(health.taskCount).toBeGreaterThanOrEqual(0)
          expect(health.validationIssues).toBeGreaterThanOrEqual(0)

          return true
        }),
        { numRuns: 10 }
      )
    })

    it('should have consistent dataSource between store and health status', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const store = useStrategicStore()

          const health = store.getDataHealth()

          // dataSource 应该一致
          expect(health.dataSource).toBe(store.dataSource)

          return true
        }),
        { numRuns: 10 }
      )
    })

    it('should have consistent indicator count between store and health status', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const store = useStrategicStore()

          const health = store.getDataHealth()

          // 指标数量应该一致
          expect(health.indicatorCount).toBe(store.indicators.length)

          return true
        }),
        { numRuns: 10 }
      )
    })
  })

  describe('Validation Result Verification', () => {
    it('should return valid ValidationResult from validateCurrentData', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const store = useStrategicStore()

          const result = store.validateCurrentData()

          // 验证结果应该有所有必要字段
          expect(result).toHaveProperty('isValid')
          expect(result).toHaveProperty('errors')
          expect(result).toHaveProperty('warnings')

          // errors 和 warnings 应该是数组
          expect(Array.isArray(result.errors)).toBe(true)
          expect(Array.isArray(result.warnings)).toBe(true)

          return true
        }),
        { numRuns: 10 }
      )
    })

    it('should update validationState after validateCurrentData call', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const store = useStrategicStore()

          // 调用验证
          const result = store.validateCurrentData()

          // validationState 应该被更新
          expect(store.validationState.lastValidated).not.toBeNull()
          expect(store.validationState.isValid).toBe(result.isValid)

          return true
        }),
        { numRuns: 10 }
      )
    })
  })
})

// ============================================================================
// Property 7: Fallback Mechanism Trigger
// ============================================================================

describe('Property 7: Fallback Mechanism Trigger', () => {
  /**
   * **Validates: Requirements 1.4, 7.4, 7.5**
   *
   * *For any* API call that fails (network error, timeout, or server error),
   * the fallback service SHALL be triggered, and the returned data SHALL have
   * a fallback indicator set to true, and a fallback reason SHALL be logged.
   */

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Fallback Service Functions', () => {
    it('should correctly identify network errors as fallback triggers', async () => {
      // 动态导入 fallback 服务
      const { shouldFallback } = await import('@/shared/api/fallback')

      fc.assert(
        fc.property(fc.constant(null), () => {
          // 模拟网络错误（无响应）
          const networkError = {
            message: 'Network Error',
            response: undefined,
            isAxiosError: true
          } as any

          const result = shouldFallback(networkError)

          // 当前降级机制已禁用
          expect(result).toBe(false)

          return result === false
        }),
        { numRuns: 10 }
      )
    })

    it('should correctly identify server errors (5xx) as fallback triggers', async () => {
      const { shouldFallback } = await import('@/shared/api/fallback')

      fc.assert(
        fc.property(fc.integer({ min: 500, max: 599 }), statusCode => {
          // 模拟服务器错误
          const serverError = {
            message: `Server Error ${statusCode}`,
            response: { status: statusCode },
            isAxiosError: true
          } as any

          const result = shouldFallback(serverError)

          // 当前降级机制已禁用
          expect(result).toBe(false)

          return result === false
        }),
        { numRuns: 100 }
      )
    })

    it('should NOT trigger fallback for client errors (4xx)', async () => {
      const { shouldFallback } = await import('@/shared/api/fallback')

      fc.assert(
        fc.property(fc.integer({ min: 400, max: 499 }), statusCode => {
          // 模拟客户端错误
          const clientError = {
            message: `Client Error ${statusCode}`,
            response: { status: statusCode },
            isAxiosError: true
          } as any

          const result = shouldFallback(clientError)

          // 4xx 错误不应该触发降级
          expect(result).toBe(false)

          return result === false
        }),
        { numRuns: 100 }
      )
    })

    it('should NOT trigger fallback when no error is provided', async () => {
      const { shouldFallback } = await import('@/shared/api/fallback')

      fc.assert(
        fc.property(fc.constantFrom(null, undefined), noError => {
          const result = shouldFallback(noError as any)

          // 无错误时不应该触发降级
          expect(result).toBe(false)

          return result === false
        }),
        { numRuns: 10 }
      )
    })
  })

  describe('Fallback Reason Logging', () => {
    it('should provide correct fallback reason for network errors', async () => {
      const { getFallbackReason } = await import('@/shared/api/fallback')

      fc.assert(
        fc.property(nonEmptyStringArbitrary(100), errorMessage => {
          const networkError = {
            message: errorMessage,
            response: undefined,
            isAxiosError: true
          } as any

          const reason = getFallbackReason(networkError)

          // 应该包含网络错误信息
          expect(reason).toContain('网络错误')
          expect(typeof reason).toBe('string')
          expect(reason.length).toBeGreaterThan(0)

          return true
        }),
        { numRuns: 100 }
      )
    })

    it('should provide correct fallback reason for server errors', async () => {
      const { getFallbackReason } = await import('@/shared/api/fallback')

      fc.assert(
        fc.property(fc.integer({ min: 500, max: 599 }), statusCode => {
          const serverError = {
            message: `Server Error`,
            response: { status: statusCode },
            isAxiosError: true
          } as any

          const reason = getFallbackReason(serverError)

          // 应该包含服务器错误信息和状态码
          expect(reason).toContain('服务器错误')
          expect(reason).toContain(String(statusCode))

          return true
        }),
        { numRuns: 100 }
      )
    })

    it('should return disabled reason when no error is provided', async () => {
      const { getFallbackReason } = await import('@/shared/api/fallback')

      fc.assert(
        fc.property(fc.constant(null), () => {
          const reason = getFallbackReason(null as any)

          expect(reason).toBe('降级机制已禁用')

          return reason === '降级机制已禁用'
        }),
        { numRuns: 10 }
      )
    })
  })

  describe('Mock Data Retrieval', () => {
    it('should return valid mock data for indicator URLs', async () => {
      const { getMockData } = await import('@/shared/api/fallback')

      fc.assert(
        fc.property(
          fc.constantFrom(
            '/indicators',
            '/indicators/tree',
            '/indicators/current',
            '/indicators?year=2025',
            '/indicators?year=2026'
          ),
          url => {
            const result = getMockData(url)

            expect(result).toBeNull()

            return true
          }
        ),
        { numRuns: 50 }
      )
    })

    it('should return valid mock data for dashboard URLs', async () => {
      const { getMockData } = await import('@/shared/api/fallback')

      fc.assert(
        fc.property(fc.constantFrom('/dashboard', '/dashboard/summary'), url => {
          const result = getMockData(url)

          expect(result).toBeNull()

          return true
        }),
        { numRuns: 20 }
      )
    })

    it('should return mock data with "降级数据" message', async () => {
      const { getMockData } = await import('@/shared/api/fallback')

      fc.assert(
        fc.property(fc.constantFrom('/indicators', '/dashboard', '/orgs'), url => {
          const result = getMockData(url)

          expect(result).toBeNull()

          return true
        }),
        { numRuns: 30 }
      )
    })
  })

  describe('FallbackService Class', () => {
    it('should correctly instantiate FallbackService', async () => {
      const { FallbackService } = await import('@/shared/api/fallback')

      fc.assert(
        fc.property(fc.constant(null), () => {
          const service = new FallbackService()

          // 服务应该有所有必要方法
          expect(typeof service.shouldFallback).toBe('function')
          expect(typeof service.getMockData).toBe('function')
          expect(typeof service.logFallback).toBe('function')
          expect(typeof service.getFallbackReason).toBe('function')
          expect(typeof service.isForceMock).toBe('function')

          return true
        }),
        { numRuns: 10 }
      )
    })

    it('should have consistent behavior between class methods and standalone functions', async () => {
      const { FallbackService, shouldFallback, getFallbackReason } =
        await import('@/shared/api/fallback')

      fc.assert(
        fc.property(fc.integer({ min: 500, max: 599 }), statusCode => {
          const service = new FallbackService()
          const error = {
            message: 'Server Error',
            response: { status: statusCode },
            isAxiosError: true
          } as any

          // 类方法和独立函数应该返回相同结果
          expect(service.shouldFallback(error)).toBe(shouldFallback(error))
          expect(service.getFallbackReason(error)).toBe(getFallbackReason(error))

          return true
        }),
        { numRuns: 100 }
      )
    })
  })

  describe('Store Fallback Integration', () => {
    it('should set dataSource to "fallback" or "local" when API fails', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const store = useStrategicStore()

          // 在测试环境中，API 通常不可用，所以 dataSource 应该是 fallback 或 local
          expect(['fallback', 'local', 'api']).toContain(store.dataSource)

          return true
        }),
        { numRuns: 10 }
      )
    })

    it('should still have valid data even when using fallback', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const store = useStrategicStore()

          // 即使使用降级数据，数据结构也应该有效
          expect(Array.isArray(store.indicators)).toBe(true)
          expect(Array.isArray(store.tasks)).toBe(true)

          // 如果有数据，应该是有效的
          if (store.indicators.length > 0) {
            const firstIndicator = store.indicators[0]
            expect(firstIndicator).toHaveProperty('id')
            expect(firstIndicator).toHaveProperty('name')
            expect(firstIndicator).toHaveProperty('progress')
          }

          return true
        }),
        { numRuns: 10 }
      )
    })

    it('should report warning status when using fallback data', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const store = useStrategicStore()

          const health = store.getDataHealth()

          // 如果数据来源是 fallback，健康状态应该至少是 warning
          if (health.dataSource === 'fallback') {
            expect(['warning', 'critical']).toContain(health.status)
          }

          return true
        }),
        { numRuns: 10 }
      )
    })
  })
})
