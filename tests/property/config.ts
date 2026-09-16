/**
 * Property-Based Testing Configuration
 *
 * This file provides configuration and utilities for property-based tests using fast-check.
 *
 * Requirements: Testing framework configuration (fast-check)
 * Design: Property-Based Testing Configuration section
 */

import fc from 'fast-check'

/**
 * Default configuration for property-based tests
 *
 * Minimum 100 iterations per property test as specified in design document
 */
export const DEFAULT_PROPERTY_TEST_CONFIG: fc.Parameters<unknown> = {
  numRuns: 100,
  verbose: false,
  seed: undefined, // Random seed for reproducibility
  path: undefined,
  endOnFailure: false
}

/**
 * Configuration for quick property tests (during development)
 */
export const QUICK_PROPERTY_TEST_CONFIG: fc.Parameters<unknown> = {
  numRuns: 20,
  verbose: false
}

/**
 * Configuration for thorough property tests (CI/CD)
 */
export const THOROUGH_PROPERTY_TEST_CONFIG: fc.Parameters<unknown> = {
  numRuns: 1000,
  verbose: true
}

/**
 * Get property test configuration based on environment
 */
export function getPropertyTestConfig(): fc.Parameters<unknown> {
  const env = process.env.NODE_ENV
  const ci = process.env.CI === 'true'

  if (ci) {
    return THOROUGH_PROPERTY_TEST_CONFIG
  }

  if (env === 'development') {
    return QUICK_PROPERTY_TEST_CONFIG
  }

  return DEFAULT_PROPERTY_TEST_CONFIG
}

/**
 * Custom arbitraries for domain-specific types
 */
export const arbitraries = {
  /**
   * Generate valid organization IDs (positive integers)
   */
  orgId: () => fc.integer({ min: 1, max: 1000 }),

  /**
   * Generate valid user IDs (positive integers)
   */
  userId: () => fc.integer({ min: 1, max: 10000 }),

  /**
   * Generate valid plan IDs (positive integers)
   */
  planId: () => fc.integer({ min: 1, max: 1000 }),

  /**
   * Generate valid task IDs (positive integers)
   */
  taskId: () => fc.integer({ min: 1, max: 10000 }),

  /**
   * Generate valid indicator IDs (positive integers)
   */
  indicatorId: () => fc.integer({ min: 1, max: 100000 }),

  /**
   * Generate valid years (2020-2030)
   */
  year: () => fc.integer({ min: 2020, max: 2030 }),

  /**
   * Generate valid progress values (0-100)
   */
  progress: () => fc.integer({ min: 0, max: 100 }),

  /**
   * Generate valid weight percentages (0-100)
   */
  weightPercent: () => fc.float({ min: 0, max: 100, noNaN: true }),

  /**
   * Generate valid ISO date strings
   */
  isoDate: () => fc.date().map(d => d.toISOString()),

  /**
   * Generate valid organization types
   */
  orgType: () =>
    fc.constantFrom(
      'SCHOOL',
      'FUNCTIONAL_DEPT',
      'FUNCTION_DEPT',
      'COLLEGE',
      'STRATEGY_DEPT',
      'DIVISION',
      'OTHER'
    ),

  /**
   * Generate valid task types
   */
  taskType: () =>
    fc.constantFrom('BASIC', 'REGULAR', 'KEY', 'SPECIAL', 'QUANTITATIVE', 'DEVELOPMENT'),

  /**
   * Generate valid indicator statuses
   */
  indicatorStatus: () => fc.constantFrom('ACTIVE', 'ARCHIVED'),

  /**
   * Generate valid report statuses
   */
  reportStatus: () => fc.constantFrom('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED'),

  /**
   * Generate valid progress approval statuses
   */
  progressApprovalStatus: () => fc.constantFrom('NONE', 'DRAFT', 'PENDING', 'APPROVED', 'REJECTED'),

  /**
   * Generate valid Chinese organization names
   */
  orgName: () =>
    fc.constantFrom(
      '战略发展部',
      '教务处',
      '科研处',
      '学生处',
      '计算机学院',
      '经济学院',
      '文学院',
      '理学院'
    ),

  /**
   * Generate valid Chinese person names
   */
  personName: () => fc.constantFrom('张三', '李四', '王五', '赵六', '钱七', '孙八', '周九', '吴十'),

  /**
   * Generate valid indicator types (定性/定量)
   */
  indicatorType1: () => fc.constantFrom('定性', '定量'),

  /**
   * Generate valid indicator types (基础性/发展性)
   */
  indicatorType2: () => fc.constantFrom('基础性', '发展性'),

  /**
   * Generate non-empty strings
   */
  nonEmptyString: () => fc.string({ minLength: 1, maxLength: 100 }),

  /**
   * Generate valid email addresses
   */
  email: () => fc.emailAddress(),

  /**
   * Generate valid URLs
   */
  url: () => fc.webUrl(),

  /**
   * Generate valid HTTP status codes
   */
  httpStatus: () => fc.integer({ min: 100, max: 599 }),

  /**
   * Generate retryable HTTP status codes
   */
  retryableHttpStatus: () => fc.constantFrom(408, 429, 500, 502, 503, 504),

  /**
   * Generate non-retryable HTTP status codes
   */
  nonRetryableHttpStatus: () => fc.constantFrom(400, 401, 403, 404, 422),

  /**
   * Generate valid idempotency keys (UUIDs)
   */
  idempotencyKey: () => fc.uuid(),

  /**
   * Generate valid JWT tokens (mock)
   */
  jwtToken: () => fc.string({ minLength: 100, maxLength: 200 }).map(s => `eyJ${s}`),

  /**
   * Generate valid file sizes (bytes)
   */
  fileSize: () => fc.integer({ min: 0, max: 100 * 1024 * 1024 }), // 0-100MB

  /**
   * Generate valid file names
   */
  fileName: () => fc.string({ minLength: 1, maxLength: 50 }).map(s => `${s}.pdf`),

  /**
   * Generate valid IP addresses
   */
  ipAddress: () => fc.ipV4(),

  /**
   * Generate valid user agents
   */
  userAgent: () =>
    fc.constantFrom(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
    )
}

/**
 * Helper to create a property test with standard configuration
 */
export function createPropertyTest<T>(
  name: string,
  property: fc.IProperty<T>,
  config?: Partial<fc.Parameters<T>>
): void {
  const finalConfig = { ...getPropertyTestConfig(), ...config }
  fc.assert(property, finalConfig)
}

/**
 * Helper to format property test descriptions
 *
 * Format: "Feature: frontend-optimization, Property {number}: {description}"
 */
export function formatPropertyDescription(
  propertyNumber: number,
  description: string,
  requirements: string[]
): string {
  return `Feature: frontend-optimization, Property ${propertyNumber}: ${description}\nValidates: Requirements ${requirements.join(', ')}`
}
