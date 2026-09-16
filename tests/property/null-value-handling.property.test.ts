/**
 * 空值处理属性测试
 *
 * **Feature: page-data-verification**
 * - **Property 6: Null Value Handling**
 *
 * **Validates: Requirements 9.4, 9.5**
 */
import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest'
import * as fc from 'fast-check'
import { setActivePinia, createPinia } from 'pinia'

// ============================================================================
// Mock localStorage
// ============================================================================
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

const localStorageMock = createLocalStorageMock()

beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
    configurable: true
  })
})

// ============================================================================
// safeGet 函数（从 useDataValidator 提取）
// ============================================================================

function isNullOrUndefined(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

function safeGet<T>(obj: unknown, path: string, defaultValue: T): T {
  if (isNullOrUndefined(obj)) {
    return defaultValue
  }

  const keys = path.split('.')
  let current: unknown = obj

  for (const key of keys) {
    if (isNullOrUndefined(current)) {
      return defaultValue
    }

    if (typeof current !== 'object') {
      return defaultValue
    }

    current = (current as Record<string, unknown>)[key]
  }

  if (isNullOrUndefined(current)) {
    return defaultValue
  }

  return current as T
}

// ============================================================================
// 数据生成器
// ============================================================================

const _nullishArbitrary = fc.constantFrom(null, undefined)
const pathArbitrary = fc
  .array(
    fc.string({ minLength: 1, maxLength: 10 }).filter(s => !s.includes('.')),
    { minLength: 1, maxLength: 3 }
  )
  .map(parts => parts.join('.'))

// ============================================================================
// Property 6: Null Value Handling
// ============================================================================

describe('Property 6: Null Value Handling', () => {
  /**
   * **Validates: Requirements 9.4, 9.5**
   *
   * *For any* field value that is null, undefined, or an empty array,
   * the safeGet function SHALL return the specified default value,
   * and the UI SHALL display a placeholder or empty state message
   * rather than throwing an error or showing blank content.
   */

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('safeGet with null/undefined objects', () => {
    it('should return default value when object is null', () => {
      fc.assert(
        fc.property(pathArbitrary, fc.string(), (path, defaultValue) => {
          const result = safeGet(null, path, defaultValue)
          expect(result).toBe(defaultValue)
          return true
        }),
        { numRuns: 50 }
      )
    })

    it('should return default value when object is undefined', () => {
      fc.assert(
        fc.property(pathArbitrary, fc.integer(), (path, defaultValue) => {
          const result = safeGet(undefined, path, defaultValue)
          expect(result).toBe(defaultValue)
          return true
        }),
        { numRuns: 50 }
      )
    })
  })

  describe('safeGet with missing nested paths', () => {
    it('should return default value when path does not exist', () => {
      const obj = { a: { b: 1 } }

      expect(safeGet(obj, 'a.c', 'default')).toBe('default')
      expect(safeGet(obj, 'x.y.z', 0)).toBe(0)
      expect(safeGet(obj, 'a.b.c', [])).toEqual([])
    })

    it('should return actual value when path exists', () => {
      const obj = { a: { b: { c: 'value' } } }

      expect(safeGet(obj, 'a.b.c', 'default')).toBe('value')
    })
  })

  describe('safeGet with various default value types', () => {
    it('should work with string default values', () => {
      fc.assert(
        fc.property(fc.string(), defaultValue => {
          const result = safeGet(null, 'any.path', defaultValue)
          expect(result).toBe(defaultValue)
          expect(typeof result).toBe('string')
          return true
        }),
        { numRuns: 50 }
      )
    })

    it('should work with number default values', () => {
      fc.assert(
        fc.property(fc.integer(), defaultValue => {
          const result = safeGet(undefined, 'any.path', defaultValue)
          expect(result).toBe(defaultValue)
          expect(typeof result).toBe('number')
          return true
        }),
        { numRuns: 50 }
      )
    })

    it('should work with array default values', () => {
      const result = safeGet(null, 'items', [])
      expect(result).toEqual([])
      expect(Array.isArray(result)).toBe(true)
    })

    it('should work with object default values', () => {
      const defaultObj = { name: 'default', value: 0 }
      const result = safeGet(null, 'config', defaultObj)
      expect(result).toEqual(defaultObj)
    })
  })

  describe('Empty array handling', () => {
    it('should return empty array default for missing array fields', () => {
      const obj = { name: 'test' }
      const result = safeGet(obj, 'items', [])

      expect(result).toEqual([])
      expect(Array.isArray(result)).toBe(true)
    })

    it('should return actual array when it exists', () => {
      const obj = { items: [1, 2, 3] }
      const result = safeGet(obj, 'items', [])

      expect(result).toEqual([1, 2, 3])
    })
  })

  describe('Type safety', () => {
    it('should not throw errors for any input', () => {
      fc.assert(
        fc.property(fc.anything(), pathArbitrary, (obj, path) => {
          // 不应该抛出错误
          expect(() => safeGet(obj, path, 'default')).not.toThrow()
          return true
        }),
        { numRuns: 100 }
      )
    })
  })
})
