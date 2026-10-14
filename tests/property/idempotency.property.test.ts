/**
 * Property-Based Tests for Idempotency Key Generator
 *
 * **Feature: sism-enterprise-optimization**
 *
 * These tests verify the correctness property P7 defined in the design document
 * for the idempotency key generator.
 *
 * **Validates: Requirements 2.2.1**
 */

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  generateIdempotencyKeySync,
  generateIdempotencyKey,
  createCanonicalString,
  normalizeData,
  arrayBufferToHex,
  isWriteMethod,
  shouldAddIdempotencyKey,
  requiresIdempotency,
  WRITE_METHODS,
  DEFAULT_IDEMPOTENCY_CONFIG,
  type IdempotencyPayload,
  type IdempotencyConfig
} from '@/shared/lib/utils/idempotency'

// ==================== Generators ====================

/**
 * Generator for HTTP methods
 */
const _httpMethodArb = fc.constantFrom('GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS')

/**
 * Generator for write methods only
 */
const writeMethodArb = fc.constantFrom('POST', 'PUT', 'DELETE', 'PATCH')

/**
 * Generator for read methods only
 */
const readMethodArb = fc.constantFrom('GET', 'HEAD', 'OPTIONS')

/**
 * Generator for URL paths
 */
const urlPathArb = fc.oneof(
  fc.constant('/api/indicators'),
  fc.constant('/api/tasks'),
  fc.constant('/api/users'),
  fc.constant('/api/orgs'),
  fc.stringMatching(/^\/api\/[a-z]+\/[0-9]+$/),
  fc.stringMatching(/^\/api\/[a-z]+$/)
)

/**
 * Generator for simple JSON-serializable values
 */
const jsonValueArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.boolean(),
  fc.constant(null)
)

/**
 * Generator for JSON-serializable objects (shallow)
 */
const jsonObjectArb = fc.dictionary(
  fc.string().filter(s => s.length > 0 && s.length < 20),
  jsonValueArb,
  { minKeys: 0, maxKeys: 10 }
)

/**
 * Generator for request data (can be object, array, or primitive)
 */
const requestDataArb: fc.Arbitrary<unknown> = fc.oneof(
  jsonObjectArb,
  fc.array(jsonValueArb, { maxLength: 10 }),
  jsonValueArb,
  fc.constant(undefined)
)

/**
 * Generator for idempotency payloads
 */
const idempotencyPayloadArb = fc.record({
  method: writeMethodArb,
  url: urlPathArb,
  data: requestDataArb
})

// ==================== Property Tests ====================

/**
 * **Property P7: 幂等性 Key 唯一性**
 * **Validates: Requirements 2.2.1**
 *
 * 属性: 相同请求内容生成相同的幂等性 Key
 *
 * ∀ (method, url, data):
 *   generateKey(method, url, data) === generateKey(method, url, data)
 */
describe('Property P7: 幂等性 Key 唯一性 - 相同请求生成相同 Key', () => {
  it('should generate identical keys for identical requests (sync)', () => {
    fc.assert(
      fc.property(idempotencyPayloadArb, payload => {
        const key1 = generateIdempotencyKeySync(payload.method, payload.url, payload.data)
        const key2 = generateIdempotencyKeySync(payload.method, payload.url, payload.data)

        return key1 === key2
      }),
      { numRuns: 200 }
    )
  })

  it('should generate identical keys for identical requests (async)', async () => {
    await fc.assert(
      fc.asyncProperty(idempotencyPayloadArb, async payload => {
        const key1 = await generateIdempotencyKey(payload.method, payload.url, payload.data)
        const key2 = await generateIdempotencyKey(payload.method, payload.url, payload.data)

        return key1 === key2
      }),
      { numRuns: 100 }
    )
  })

  it('should generate different keys for different methods', () => {
    fc.assert(
      fc.property(
        urlPathArb,
        requestDataArb,
        fc.tuple(writeMethodArb, writeMethodArb).filter(([m1, m2]) => m1 !== m2),
        (url, data, [method1, method2]) => {
          const key1 = generateIdempotencyKeySync(method1, url, data)
          const key2 = generateIdempotencyKeySync(method2, url, data)

          return key1 !== key2
        }
      ),
      { numRuns: 100 }
    )
  })

  it('should generate different keys for different URLs', () => {
    fc.assert(
      fc.property(
        writeMethodArb,
        requestDataArb,
        fc.tuple(urlPathArb, urlPathArb).filter(([u1, u2]) => u1 !== u2),
        (method, data, [url1, url2]) => {
          const key1 = generateIdempotencyKeySync(method, url1, data)
          const key2 = generateIdempotencyKeySync(method, url2, data)

          return key1 !== key2
        }
      ),
      { numRuns: 100 }
    )
  })

  it('should generate different keys for different data', () => {
    fc.assert(
      fc.property(
        writeMethodArb,
        urlPathArb,
        fc
          .tuple(jsonObjectArb, jsonObjectArb)
          .filter(([d1, d2]) => JSON.stringify(d1) !== JSON.stringify(d2)),
        (method, url, [data1, data2]) => {
          const key1 = generateIdempotencyKeySync(method, url, data1)
          const key2 = generateIdempotencyKeySync(method, url, data2)

          return key1 !== key2
        }
      ),
      { numRuns: 100 }
    )
  })

  it('should be case-insensitive for HTTP methods', () => {
    fc.assert(
      fc.property(writeMethodArb, urlPathArb, requestDataArb, (method, url, data) => {
        const keyUpper = generateIdempotencyKeySync(method.toUpperCase(), url, data)
        const keyLower = generateIdempotencyKeySync(method.toLowerCase(), url, data)
        const keyMixed = generateIdempotencyKeySync(
          method.charAt(0).toUpperCase() + method.slice(1).toLowerCase(),
          url,
          data
        )

        return keyUpper === keyLower && keyLower === keyMixed
      }),
      { numRuns: 100 }
    )
  })

  it('should generate 64-character hex strings (sync)', () => {
    fc.assert(
      fc.property(idempotencyPayloadArb, payload => {
        const key = generateIdempotencyKeySync(payload.method, payload.url, payload.data)

        // Should be 64 characters (256 bits / 4 bits per hex char)
        return key.length === 64 && /^[0-9a-f]+$/.test(key)
      }),
      { numRuns: 100 }
    )
  })

  it('should generate 64-character hex strings (async)', async () => {
    await fc.assert(
      fc.asyncProperty(idempotencyPayloadArb, async payload => {
        const key = await generateIdempotencyKey(payload.method, payload.url, payload.data)

        // Should be 64 characters (256 bits / 4 bits per hex char)
        return key.length === 64 && /^[0-9a-f]+$/.test(key)
      }),
      { numRuns: 100 }
    )
  })
})

/**
 * Tests for data normalization
 */
describe('Data Normalization', () => {
  it('should produce same canonical string for objects with same keys in different order', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string().filter(s => s.length > 0 && s.length < 10),
          jsonValueArb,
          { minKeys: 2, maxKeys: 5 }
        ),
        obj => {
          // Create two objects with same content but different key order
          const keys = Object.keys(obj)
          const reversedKeys = [...keys].reverse()

          const obj1: Record<string, unknown> = {}
          const obj2: Record<string, unknown> = {}

          for (const key of keys) {
            obj1[key] = obj[key]
          }
          for (const key of reversedKeys) {
            obj2[key] = obj[key]
          }

          const normalized1 = normalizeData(obj1)
          const normalized2 = normalizeData(obj2)

          return JSON.stringify(normalized1) === JSON.stringify(normalized2)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('should handle null and undefined consistently', () => {
    expect(normalizeData(null)).toBe(null)
    expect(normalizeData(undefined)).toBe(null)
  })

  it('should handle Date objects by converting to ISO string', () => {
    const date = new Date('2024-01-15T10:30:00Z')
    expect(normalizeData(date)).toBe('2024-01-15T10:30:00.000Z')
  })

  it('should exclude functions from normalized data', () => {
    const obj = {
      name: 'test',
      callback: () => {},
      nested: {
        fn: function () {},
        value: 42
      }
    }

    const normalized = normalizeData(obj) as Record<string, unknown>
    expect(normalized).not.toHaveProperty('callback')
    expect(normalized.nested as Record<string, unknown>).not.toHaveProperty('fn')
    expect((normalized.nested as Record<string, unknown>).value).toBe(42)
  })

  it('should preserve array order', () => {
    fc.assert(
      fc.property(fc.array(jsonValueArb, { minLength: 2, maxLength: 10 }), arr => {
        const normalized = normalizeData(arr) as unknown[]

        // Check that order is preserved
        for (let i = 0; i < arr.length; i++) {
          const expected = normalizeData(arr[i])
          const actual = normalized[i]
          if (JSON.stringify(expected) !== JSON.stringify(actual)) {
            return false
          }
        }
        return true
      }),
      { numRuns: 100 }
    )
  })

  it('should handle nested objects', () => {
    const obj = {
      level1: {
        level2: {
          level3: {
            value: 'deep'
          }
        }
      }
    }

    const normalized = normalizeData(obj) as Record<string, unknown>
    expect(
      ((normalized.level1 as Record<string, unknown>).level2 as Record<string, unknown>)
        .level3 as Record<string, unknown>
    ).toEqual({ value: 'deep' })
  })
})

/**
 * Tests for canonical string creation
 */
describe('Canonical String Creation', () => {
  it('should create deterministic canonical strings', () => {
    fc.assert(
      fc.property(idempotencyPayloadArb, payload => {
        const str1 = createCanonicalString(payload)
        const str2 = createCanonicalString(payload)

        return str1 === str2
      }),
      { numRuns: 100 }
    )
  })

  it('should normalize method to uppercase in canonical string', () => {
    const payload1: IdempotencyPayload = { method: 'post', url: '/api/test', data: {} }
    const payload2: IdempotencyPayload = { method: 'POST', url: '/api/test', data: {} }

    expect(createCanonicalString(payload1)).toBe(createCanonicalString(payload2))
  })

  it('should produce valid JSON strings', () => {
    fc.assert(
      fc.property(idempotencyPayloadArb, payload => {
        const str = createCanonicalString(payload)

        try {
          JSON.parse(str)
          return true
        } catch {
          return false
        }
      }),
      { numRuns: 100 }
    )
  })
})

/**
 * Tests for write method detection
 */
describe('Write Method Detection', () => {
  it('should identify all write methods', () => {
    for (const method of WRITE_METHODS) {
      expect(isWriteMethod(method)).toBe(true)
      expect(isWriteMethod(method.toLowerCase())).toBe(true)
    }
  })

  it('should not identify read methods as write methods', () => {
    fc.assert(
      fc.property(readMethodArb, method => {
        return isWriteMethod(method) === false
      }),
      { numRuns: 50 }
    )
  })

  it('should handle undefined and empty string', () => {
    expect(isWriteMethod(undefined)).toBe(false)
    expect(isWriteMethod('')).toBe(false)
  })
})

/**
 * Tests for idempotency requirement checking
 */
describe('Idempotency Requirement Checking', () => {
  it('should require idempotency for protected paths', () => {
    for (const path of DEFAULT_IDEMPOTENCY_CONFIG.protectedPaths) {
      expect(requiresIdempotency(`/api${path}`)).toBe(true)
      expect(requiresIdempotency(`/api${path}/123`)).toBe(true)
    }
  })

  it('should not require idempotency for unprotected paths', () => {
    expect(requiresIdempotency('/api/users')).toBe(false)
    expect(requiresIdempotency('/api/orgs')).toBe(false)
    expect(requiresIdempotency('/api/auth/login')).toBe(false)
  })

  it('should require idempotency for all writes when enableForAllWrites is true', () => {
    const config: IdempotencyConfig = {
      ...DEFAULT_IDEMPOTENCY_CONFIG,
      enableForAllWrites: true
    }

    fc.assert(
      fc.property(urlPathArb, url => {
        return requiresIdempotency(url, config) === true
      }),
      { numRuns: 50 }
    )
  })

  it('should add idempotency key only for write methods on protected paths', () => {
    // Write method on protected path - should add key
    expect(shouldAddIdempotencyKey('POST', '/api/indicators')).toBe(true)
    expect(shouldAddIdempotencyKey('DELETE', '/api/tasks/1')).toBe(true)

    // Read method on protected path - should NOT add key
    expect(shouldAddIdempotencyKey('GET', '/api/indicators')).toBe(false)

    // Write method on unprotected path - should NOT add key
    expect(shouldAddIdempotencyKey('POST', '/api/users')).toBe(false)
  })
})

/**
 * Tests for arrayBufferToHex utility
 */
describe('ArrayBuffer to Hex Conversion', () => {
  it('should convert ArrayBuffer to correct hex string', () => {
    // Test with known values
    const buffer = new Uint8Array([0, 1, 15, 16, 255]).buffer
    const hex = arrayBufferToHex(buffer)

    expect(hex).toBe('00010f10ff')
  })

  it('should produce lowercase hex strings', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 32 }), bytes => {
        const hex = arrayBufferToHex(bytes.buffer)
        return /^[0-9a-f]+$/.test(hex)
      }),
      { numRuns: 100 }
    )
  })

  it('should produce hex string with length = 2 * byte count', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 1, maxLength: 32 }), bytes => {
        const hex = arrayBufferToHex(bytes.buffer)
        return hex.length === bytes.length * 2
      }),
      { numRuns: 100 }
    )
  })
})

/**
 * Integration tests
 */
describe('Integration Tests', () => {
  it('should generate consistent keys for real-world payloads', async () => {
    const testCases = [
      {
        method: 'POST',
        url: '/api/indicators',
        data: { name: '科研成果', target: 100, unit: '项' }
      },
      {
        method: 'PUT',
        data: { status: 'completed', progress: 100 }
      },
      {
        method: 'DELETE',
        url: '/api/tasks/123',
        data: null
      },
      {
        method: 'PATCH',
        url: '/api/approvals/456',
        data: { approved: true, comment: '同意' }
      }
    ]

    for (const testCase of testCases) {
      const key1 = await generateIdempotencyKey(testCase.method, testCase.url, testCase.data)
      const key2 = await generateIdempotencyKey(testCase.method, testCase.url, testCase.data)

      expect(key1).toBe(key2)
      expect(key1.length).toBe(64)
      expect(/^[0-9a-f]+$/.test(key1)).toBe(true)
    }
  })

  it('should handle Chinese characters in data', async () => {
    const data = {
      name: '战略指标管理系统',
      description: '这是一个测试描述',
      tags: ['重要', '紧急', '待办']
    }

    const key1 = await generateIdempotencyKey('POST', '/api/indicators', data)
    const key2 = await generateIdempotencyKey('POST', '/api/indicators', data)

    expect(key1).toBe(key2)
  })

  it('should handle empty data', async () => {
    const key1 = await generateIdempotencyKey('POST', '/api/test', {})
    const key2 = await generateIdempotencyKey('POST', '/api/test', {})
    const key3 = await generateIdempotencyKey('POST', '/api/test', null)
    const key4 = await generateIdempotencyKey('POST', '/api/test', undefined)

    expect(key1).toBe(key2)
    expect(key3).toBe(key4)
    // Empty object and null should produce different keys
    expect(key1).not.toBe(key3)
  })
})
