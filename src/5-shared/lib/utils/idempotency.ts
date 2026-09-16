/**
 * Idempotency Key Generator
 *
 * **Feature: sism-enterprise-optimization**
 *
 * Generates unique idempotency keys for write operations to prevent duplicate
 * requests from creating duplicate data. The key is based on SHA-256 hash of
 * the request content (method, URL, and data).
 *
 * **Validates: Requirements 2.2.1**
 *
 * Key Properties:
 * - P7: Same request content generates the same idempotency key
 * - Different request content generates different keys
 * - Keys are deterministic and reproducible
 */

/**
 * HTTP methods that require idempotency protection
 */
export const WRITE_METHODS = ['POST', 'PUT', 'DELETE', 'PATCH'] as const
export type WriteMethod = (typeof WRITE_METHODS)[number]

/**
 * Check if a method is a write operation that needs idempotency protection
 */
export function isWriteMethod(method: string | undefined): boolean {
  if (!method) {
    return false
  }
  return WRITE_METHODS.includes(method.toUpperCase() as WriteMethod)
}

/**
 * Idempotency request payload structure
 */
export interface IdempotencyPayload {
  method: string
  url: string
  data: unknown
}

/**
 * Normalize data for consistent hashing
 *
 * This ensures that semantically equivalent data produces the same hash:
 * - Objects are sorted by keys
 * - Arrays maintain order
 * - Undefined values are converted to null
 * - Functions are excluded
 *
 * @param data - Data to normalize
 * @returns Normalized data
 */
export function normalizeData(data: unknown): unknown {
  if (data === null || data === undefined) {
    return null
  }

  if (typeof data === 'function') {
    return null
  }

  if (typeof data !== 'object') {
    return data
  }

  if (Array.isArray(data)) {
    return data.map(item => normalizeData(item))
  }

  if (data instanceof Date) {
    return data.toISOString()
  }

  // Sort object keys for consistent ordering
  const sortedObj: Record<string, unknown> = {}
  const keys = Object.keys(data as Record<string, unknown>).sort()

  for (const key of keys) {
    const value = (data as Record<string, unknown>)[key]
    if (value !== undefined && typeof value !== 'function') {
      sortedObj[key] = normalizeData(value)
    }
  }

  return sortedObj
}

/**
 * Create a canonical string representation of the request payload
 *
 * @param payload - Request payload
 * @returns Canonical string for hashing
 */
export function createCanonicalString(payload: IdempotencyPayload): string {
  const normalizedPayload = {
    method: payload.method.toUpperCase(),
    url: payload.url,
    data: normalizeData(payload.data)
  }

  return JSON.stringify(normalizedPayload)
}

/**
 * Convert ArrayBuffer to hex string
 *
 * @param buffer - ArrayBuffer from crypto.subtle.digest
 * @returns Hex string representation
 */
export function arrayBufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generate SHA-256 hash of a string (async version using Web Crypto API)
 *
 * @param input - String to hash
 * @returns Promise resolving to hex-encoded SHA-256 hash
 */
export async function sha256Async(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return arrayBufferToHex(hashBuffer)
}

/**
 * Generate SHA-256 hash of a string (sync version for environments without Web Crypto)
 *
 * This is a simple implementation for testing/fallback purposes.
 * In production, the async version using Web Crypto API should be preferred.
 *
 * @param input - String to hash
 * @returns Hex-encoded hash (simplified for sync operation)
 */
export function sha256Sync(input: string): string {
  // Simple hash function for sync operation (djb2 variant)
  // This is NOT cryptographically secure, only for fallback/testing
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i)
    hash = hash >>> 0 // Convert to unsigned 32-bit integer
  }

  // Generate a longer hash by combining multiple rounds
  const parts: string[] = []
  let current = hash
  for (let i = 0; i < 8; i++) {
    current = ((current << 5) + current) ^ (hash + i * 31)
    current = current >>> 0
    parts.push(current.toString(16).padStart(8, '0'))
  }

  return parts.join('')
}

/**
 * Generate an idempotency key for a request (async version)
 *
 * The key is a SHA-256 hash of the canonical representation of:
 * - HTTP method (normalized to uppercase)
 * - Request URL
 * - Request data (normalized and sorted)
 *
 * **Property P7**: Same request content generates the same idempotency key
 *
 * @param method - HTTP method (POST, PUT, DELETE, PATCH)
 * @param url - Request URL
 * @param data - Request body data
 * @returns Promise resolving to 64-character hex string (SHA-256 hash)
 */
export async function generateIdempotencyKey(
  method: string,
  url: string,
  data: unknown
): Promise<string> {
  const payload: IdempotencyPayload = { method, url, data }
  const canonicalString = createCanonicalString(payload)
  return sha256Async(canonicalString)
}

/**
 * Generate an idempotency key for a request (sync version)
 *
 * Use this version when async is not available or for testing.
 * Note: This uses a simplified hash function, not cryptographic SHA-256.
 *
 * @param method - HTTP method (POST, PUT, DELETE, PATCH)
 * @param url - Request URL
 * @param data - Request body data
 * @returns 64-character hex string
 */
export function generateIdempotencyKeySync(method: string, url: string, data: unknown): string {
  const payload: IdempotencyPayload = { method, url, data }
  const canonicalString = createCanonicalString(payload)
  return sha256Sync(canonicalString)
}

/**
 * Configuration for idempotency behavior
 */
export interface IdempotencyConfig {
  /** Header name for the idempotency key (default: 'X-Idempotency-Key') */
  headerName: string
  /** List of URL patterns that require idempotency protection */
  protectedPaths: string[]
  /** Whether to enable idempotency for all write operations (default: false) */
  enableForAllWrites: boolean
}

/**
 * Default idempotency configuration
 */
export const DEFAULT_IDEMPOTENCY_CONFIG: IdempotencyConfig = {
  headerName: 'X-Idempotency-Key',
  protectedPaths: ['/indicators', '/tasks', '/approvals', '/progress'],
  enableForAllWrites: false
}

/**
 * Check if a URL path requires idempotency protection
 *
 * @param url - Request URL
 * @param config - Idempotency configuration
 * @returns true if the path requires idempotency protection
 */
export function requiresIdempotency(
  url: string,
  config: IdempotencyConfig = DEFAULT_IDEMPOTENCY_CONFIG
): boolean {
  if (config.enableForAllWrites) {
    return true
  }

  return config.protectedPaths.some(path => url.includes(path))
}

/**
 * Check if a request should have an idempotency key
 *
 * @param method - HTTP method
 * @param url - Request URL
 * @param config - Idempotency configuration
 * @returns true if the request should have an idempotency key
 */
export function shouldAddIdempotencyKey(
  method: string | undefined,
  url: string,
  config: IdempotencyConfig = DEFAULT_IDEMPOTENCY_CONFIG
): boolean {
  return isWriteMethod(method) && requiresIdempotency(url, config)
}
