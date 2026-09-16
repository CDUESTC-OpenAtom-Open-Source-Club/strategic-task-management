/**
 * DataValidator 属性测试
 *
 * 测试数据验证器的核心属性，确保验证逻辑的正确性
 *
 * **Feature: page-data-verification**
 * - **Property 3: Data Completeness Validation**
 * - **Property 4: Enum Value Validation**
 * - **Property 5: Data Format Validation**
 *
 * **Validates: Requirements 2.4, 2.6, 5.2, 9.1, 9.2, 9.3**
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { useDataValidator } from '@/shared/lib/validation/useDataValidator'
import { PROGRESS_APPROVAL_STATUS_VALUES, USER_ROLE_VALUES } from '@/shared/config/validationRules'

// ============================================================================
// 测试数据生成器 (Arbitraries)
// ============================================================================

/**
 * 生成非空白字符串（至少包含一个非空白字符）
 * 验证器会 trim 字符串，所以需要确保字符串不是纯空白
 */
const nonEmptyStringArbitrary = (maxLength: number = 50) =>
  fc.string({ minLength: 1, maxLength }).filter(s => s.trim().length > 0)

/**
 * 生成有效的指标对象
 */
const validIndicatorArbitrary = fc.record({
  id: nonEmptyStringArbitrary(50),
  name: nonEmptyStringArbitrary(200),
  progress: fc.integer({ min: 0, max: 100 }),
  weight: fc.float({ min: 0, max: 100, noNaN: true }),
  responsibleDept: nonEmptyStringArbitrary(100),
  year: fc.integer({ min: 2020, max: 2030 }),
  progressApprovalStatus: fc.constantFrom(...PROGRESS_APPROVAL_STATUS_VALUES)
})

/**
 * 生成有效的用户对象
 */
const validUserArbitrary = fc.record({
  id: nonEmptyStringArbitrary(50),
  name: nonEmptyStringArbitrary(50),
  role: fc.constantFrom(...USER_ROLE_VALUES),
  department: nonEmptyStringArbitrary(100)
})

/**
 * 生成缺少必填字段的指标对象
 */
const incompleteIndicatorArbitrary = fc.oneof(
  // 缺少 id
  fc.record({
    name: nonEmptyStringArbitrary(100),
    progress: fc.integer({ min: 0, max: 100 }),
    weight: fc.float({ min: 0, noNaN: true }),
    responsibleDept: nonEmptyStringArbitrary(100),
    year: fc.integer({ min: 2020, max: 2030 })
  }),
  // 缺少 name
  fc.record({
    id: nonEmptyStringArbitrary(50),
    progress: fc.integer({ min: 0, max: 100 }),
    weight: fc.float({ min: 0, noNaN: true }),
    responsibleDept: nonEmptyStringArbitrary(100),
    year: fc.integer({ min: 2020, max: 2030 })
  }),
  // 缺少 progress
  fc.record({
    id: nonEmptyStringArbitrary(50),
    name: nonEmptyStringArbitrary(100),
    weight: fc.float({ min: 0, noNaN: true }),
    responsibleDept: nonEmptyStringArbitrary(100),
    year: fc.integer({ min: 2020, max: 2030 })
  }),
  // 缺少 responsibleDept
  fc.record({
    id: nonEmptyStringArbitrary(50),
    name: nonEmptyStringArbitrary(100),
    progress: fc.integer({ min: 0, max: 100 }),
    weight: fc.float({ min: 0, noNaN: true }),
    year: fc.integer({ min: 2020, max: 2030 })
  })
)

// ============================================================================
// Property 3: Data Completeness Validation
// ============================================================================

describe('Property 3: Data Completeness Validation', () => {
  /**
   * **Validates: Requirements 2.4, 3.4, 4.4**
   *
   * *For any* indicator object, user object, or audit log entry,
   * the validation function SHALL return isValid=true if and only if
   * all required fields (as defined in validationRules) are present and non-null.
   */
  const { validateIndicator, validateUser } = useDataValidator()

  describe('Indicator Completeness', () => {
    it('should return isValid=true for any indicator with all required fields present and non-null', () => {
      fc.assert(
        fc.property(validIndicatorArbitrary, indicator => {
          const result = validateIndicator(indicator)

          // 验证结果应该为有效
          expect(result.isValid).toBe(true)
          expect(result.errors).toHaveLength(0)

          return result.isValid === true
        }),
        { numRuns: 100 }
      )
    })

    it('should return isValid=false for any indicator missing required fields', () => {
      fc.assert(
        fc.property(incompleteIndicatorArbitrary, incompleteIndicator => {
          const result = validateIndicator(incompleteIndicator)

          // 缺少必填字段时应该返回无效
          expect(result.isValid).toBe(false)
          expect(result.errors.length).toBeGreaterThan(0)

          return result.isValid === false
        }),
        { numRuns: 100 }
      )
    })

    it('should return isValid=false when required fields are null', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('id', 'name', 'progress', 'weight', 'responsibleDept', 'year'),
          fieldToNull => {
            const indicator = {
              id: 'test-id',
              name: 'Test Indicator',
              progress: 50,
              weight: 10,
              responsibleDept: 'Test Dept',
              year: 2025,
              [fieldToNull]: null
            }

            const result = validateIndicator(indicator)

            // 必填字段为 null 时应该返回无效
            expect(result.isValid).toBe(false)
            expect(result.errors.some(e => e.field === fieldToNull)).toBe(true)

            return result.isValid === false
          }
        ),
        { numRuns: 100 }
      )
    })
  })

  describe('User Completeness', () => {
    it('should return isValid=true for any user with all required fields present and non-null', () => {
      fc.assert(
        fc.property(validUserArbitrary, user => {
          const result = validateUser(user)

          expect(result.isValid).toBe(true)
          expect(result.errors).toHaveLength(0)

          return result.isValid === true
        }),
        { numRuns: 100 }
      )
    })

    it('should return isValid=false when user required fields are null or missing', () => {
      fc.assert(
        fc.property(fc.constantFrom('id', 'name', 'role', 'department'), fieldToNull => {
          const user = {
            id: 'user-1',
            name: 'Test User',
            role: 'functional_dept' as const,
            department: 'Test Department',
            [fieldToNull]: null
          }

          const result = validateUser(user)

          expect(result.isValid).toBe(false)
          expect(result.errors.some(e => e.field === fieldToNull)).toBe(true)

          return result.isValid === false
        }),
        { numRuns: 100 }
      )
    })
  })
})

// ============================================================================
// Property 4: Enum Value Validation
// ============================================================================

describe('Property 4: Enum Value Validation', () => {
  /**
   * **Validates: Requirements 2.6, 5.2**
   *
   * *For any* field defined as an enum type (role, progressApprovalStatus),
   * the validation function SHALL return true if and only if the value is one of the
   * predefined valid enum values.
   */
  const { validateEnum } = useDataValidator()

  describe('Progress Approval Status Enum', () => {
    it('should return true for any valid progressApprovalStatus value', () => {
      fc.assert(
        fc.property(fc.constantFrom(...PROGRESS_APPROVAL_STATUS_VALUES), status => {
          const result = validateEnum(status, PROGRESS_APPROVAL_STATUS_VALUES)

          expect(result).toBe(true)
          return result === true
        }),
        { numRuns: 100 }
      )
    })

    it('should return false for any invalid progressApprovalStatus value', () => {
      // 生成不在有效枚举值中的字符串
      const invalidStatusArbitrary = fc
        .string({ minLength: 1, maxLength: 50 })
        .filter(
          s =>
            !PROGRESS_APPROVAL_STATUS_VALUES.includes(
              s as (typeof PROGRESS_APPROVAL_STATUS_VALUES)[number]
            )
        )

      fc.assert(
        fc.property(invalidStatusArbitrary, invalidStatus => {
          const result = validateEnum(invalidStatus, PROGRESS_APPROVAL_STATUS_VALUES)

          expect(result).toBe(false)
          return result === false
        }),
        { numRuns: 100 }
      )
    })
  })

  describe('User Role Enum', () => {
    it('should return true for any valid user role value', () => {
      fc.assert(
        fc.property(fc.constantFrom(...USER_ROLE_VALUES), role => {
          const result = validateEnum(role, USER_ROLE_VALUES)

          expect(result).toBe(true)
          return result === true
        }),
        { numRuns: 100 }
      )
    })

    it('should return false for any invalid user role value', () => {
      const invalidRoleArbitrary = fc
        .string({ minLength: 1, maxLength: 50 })
        .filter(s => !USER_ROLE_VALUES.includes(s as (typeof USER_ROLE_VALUES)[number]))

      fc.assert(
        fc.property(invalidRoleArbitrary, invalidRole => {
          const result = validateEnum(invalidRole, USER_ROLE_VALUES)

          expect(result).toBe(false)
          return result === false
        }),
        { numRuns: 100 }
      )
    })
  })

  describe('Enum Validation with Entity Validators', () => {
    const { validateIndicator, validateUser } = useDataValidator()

    it('should validate indicator with valid progressApprovalStatus enum', () => {
      fc.assert(
        fc.property(fc.constantFrom(...PROGRESS_APPROVAL_STATUS_VALUES), status => {
          const indicator = {
            id: 'test-id',
            name: 'Test Indicator',
            progress: 50,
            weight: 10,
            responsibleDept: 'Test Dept',
            year: 2025,
            progressApprovalStatus: status
          }

          const result = validateIndicator(indicator)

          // 应该没有关于 progressApprovalStatus 的错误
          const statusErrors = result.errors.filter(e => e.field === 'progressApprovalStatus')
          expect(statusErrors).toHaveLength(0)

          return statusErrors.length === 0
        }),
        { numRuns: 100 }
      )
    })

    it('should reject indicator with invalid progressApprovalStatus enum', () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1, maxLength: 20 })
            .filter(
              s =>
                !PROGRESS_APPROVAL_STATUS_VALUES.includes(
                  s as (typeof PROGRESS_APPROVAL_STATUS_VALUES)[number]
                )
            ),
          invalidStatus => {
            const indicator = {
              id: 'test-id',
              name: 'Test Indicator',
              progress: 50,
              weight: 10,
              responsibleDept: 'Test Dept',
              year: 2025,
              progressApprovalStatus: invalidStatus
            }

            const result = validateIndicator(indicator)

            // 应该有关于 progressApprovalStatus 的错误
            const statusErrors = result.errors.filter(e => e.field === 'progressApprovalStatus')
            expect(statusErrors.length).toBeGreaterThan(0)

            return statusErrors.length > 0
          }
        ),
        { numRuns: 100 }
      )
    })

    it('should validate user with valid role enum', () => {
      fc.assert(
        fc.property(fc.constantFrom(...USER_ROLE_VALUES), role => {
          const user = {
            id: 'user-1',
            name: 'Test User',
            role: role,
            department: 'Test Department'
          }

          const result = validateUser(user)

          expect(result.isValid).toBe(true)
          return result.isValid === true
        }),
        { numRuns: 100 }
      )
    })

    it('should reject user with invalid role enum', () => {
      fc.assert(
        fc.property(
          fc
            .string({ minLength: 1, maxLength: 20 })
            .filter(s => !USER_ROLE_VALUES.includes(s as (typeof USER_ROLE_VALUES)[number])),
          invalidRole => {
            const user = {
              id: 'user-1',
              name: 'Test User',
              role: invalidRole,
              department: 'Test Department'
            }

            const result = validateUser(user)

            // 应该有关于 role 的错误
            const roleErrors = result.errors.filter(e => e.field === 'role')
            expect(roleErrors.length).toBeGreaterThan(0)

            return roleErrors.length > 0
          }
        ),
        { numRuns: 100 }
      )
    })
  })
})

// ============================================================================
// Property 5: Data Format Validation
// ============================================================================

describe('Property 5: Data Format Validation', () => {
  /**
   * **Validates: Requirements 9.1, 9.2, 9.3**
   *
   * *For any* date field, the formatted output SHALL match the pattern "YYYY年MM月DD日" or "YYYY-MM-DD".
   * *For any* progress value, it SHALL be a number in the range [0, 100].
   * *For any* weight value, it SHALL be a non-negative number.
   */
  const { validateDateFormat, validateProgress, validateIndicator } = useDataValidator()

  describe('Date Format Validation (Requirement 9.1)', () => {
    it('should return true for any valid Date object', () => {
      fc.assert(
        fc.property(
          fc
            .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
            .filter(d => !isNaN(d.getTime())),
          date => {
            const result = validateDateFormat(date)

            expect(result).toBe(true)
            return result === true
          }
        ),
        { numRuns: 100 }
      )
    })

    it('should return true for any valid ISO date string (YYYY-MM-DD)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2020, max: 2030 }),
          fc.integer({ min: 1, max: 12 }),
          fc.integer({ min: 1, max: 28 }), // 使用28避免月份天数问题
          (year, month, day) => {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const result = validateDateFormat(dateStr)

            expect(result).toBe(true)
            return result === true
          }
        ),
        { numRuns: 100 }
      )
    })

    it('should return true for any valid timestamp number', () => {
      fc.assert(
        fc.property(
          fc.integer({
            min: new Date('2020-01-01').getTime(),
            max: new Date('2030-12-31').getTime()
          }),
          timestamp => {
            const result = validateDateFormat(timestamp)

            expect(result).toBe(true)
            return result === true
          }
        ),
        { numRuns: 100 }
      )
    })

    it('should return false for null or undefined date values', () => {
      fc.assert(
        fc.property(fc.constantFrom(null, undefined), invalidDate => {
          const result = validateDateFormat(invalidDate)

          expect(result).toBe(false)
          return result === false
        }),
        { numRuns: 10 }
      )
    })

    it('should return false for invalid date strings', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('invalid-date', 'not-a-date', '2025-13-45', 'abc123'),
          invalidDateStr => {
            const result = validateDateFormat(invalidDateStr)

            expect(result).toBe(false)
            return result === false
          }
        ),
        { numRuns: 10 }
      )
    })
  })

  describe('Progress Value Validation (Requirement 9.2)', () => {
    it('should return true for any progress value in range [0, 100]', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 100 }), progress => {
          const result = validateProgress(progress)

          expect(result).toBe(true)
          return result === true
        }),
        { numRuns: 100 }
      )
    })

    it('should return true for any float progress value in range [0, 100]', () => {
      fc.assert(
        fc.property(fc.float({ min: 0, max: 100, noNaN: true }), progress => {
          const result = validateProgress(progress)

          expect(result).toBe(true)
          return result === true
        }),
        { numRuns: 100 }
      )
    })

    it('should return false for any progress value less than 0', () => {
      fc.assert(
        fc.property(fc.integer({ min: -1000, max: -1 }), negativeProgress => {
          const result = validateProgress(negativeProgress)

          expect(result).toBe(false)
          return result === false
        }),
        { numRuns: 100 }
      )
    })

    it('should return false for any progress value greater than 100', () => {
      fc.assert(
        fc.property(fc.integer({ min: 101, max: 1000 }), overProgress => {
          const result = validateProgress(overProgress)

          expect(result).toBe(false)
          return result === false
        }),
        { numRuns: 100 }
      )
    })

    it('should return false for non-number progress values', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.constant(null), fc.constant(undefined), fc.constant(NaN)),
          invalidProgress => {
            const result = validateProgress(invalidProgress)

            expect(result).toBe(false)
            return result === false
          }
        ),
        { numRuns: 100 }
      )
    })

    it('should validate indicator progress field is in range [0, 100]', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 100 }), progress => {
          const indicator = {
            id: 'test-id',
            name: 'Test Indicator',
            progress: progress,
            weight: 10,
            responsibleDept: 'Test Dept',
            year: 2025
          }

          const result = validateIndicator(indicator)

          // 不应该有关于 progress 的错误
          const progressErrors = result.errors.filter(e => e.field === 'progress')
          expect(progressErrors).toHaveLength(0)

          return progressErrors.length === 0
        }),
        { numRuns: 100 }
      )
    })

    it('should reject indicator with progress outside range [0, 100]', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.integer({ min: -1000, max: -1 }), fc.integer({ min: 101, max: 1000 })),
          invalidProgress => {
            const indicator = {
              id: 'test-id',
              name: 'Test Indicator',
              progress: invalidProgress,
              weight: 10,
              responsibleDept: 'Test Dept',
              year: 2025
            }

            const result = validateIndicator(indicator)

            // 应该有关于 progress 的错误
            const progressErrors = result.errors.filter(e => e.field === 'progress')
            expect(progressErrors.length).toBeGreaterThan(0)

            return progressErrors.length > 0
          }
        ),
        { numRuns: 100 }
      )
    })
  })

  describe('Weight Value Validation (Requirement 9.3)', () => {
    it('should validate indicator with any non-negative weight value', () => {
      fc.assert(
        fc.property(fc.float({ min: 0, max: 1000, noNaN: true }), weight => {
          const indicator = {
            id: 'test-id',
            name: 'Test Indicator',
            progress: 50,
            weight: weight,
            responsibleDept: 'Test Dept',
            year: 2025
          }

          const result = validateIndicator(indicator)

          // 不应该有关于 weight 的错误
          const weightErrors = result.errors.filter(e => e.field === 'weight')
          expect(weightErrors).toHaveLength(0)

          return weightErrors.length === 0
        }),
        { numRuns: 100 }
      )
    })

    it('should reject indicator with negative weight value', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(-1000), max: Math.fround(-0.01), noNaN: true }),
          negativeWeight => {
            const indicator = {
              id: 'test-id',
              name: 'Test Indicator',
              progress: 50,
              weight: negativeWeight,
              responsibleDept: 'Test Dept',
              year: 2025
            }

            const result = validateIndicator(indicator)

            // 应该有关于 weight 的错误
            const weightErrors = result.errors.filter(e => e.field === 'weight')
            expect(weightErrors.length).toBeGreaterThan(0)

            return weightErrors.length > 0
          }
        ),
        { numRuns: 100 }
      )
    })

    it('should reject indicator with NaN weight value', () => {
      const indicator = {
        id: 'test-id',
        name: 'Test Indicator',
        progress: 50,
        weight: NaN,
        responsibleDept: 'Test Dept',
        year: 2025
      }

      const result = validateIndicator(indicator)

      // 应该有关于 weight 的错误
      const weightErrors = result.errors.filter(e => e.field === 'weight')
      expect(weightErrors.length).toBeGreaterThan(0)
    })

    it('should reject indicator with non-number weight value', () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.string(), fc.constant(null), fc.constant(undefined)),
          invalidWeight => {
            const indicator = {
              id: 'test-id',
              name: 'Test Indicator',
              progress: 50,
              weight: invalidWeight,
              responsibleDept: 'Test Dept',
              year: 2025
            }

            const result = validateIndicator(indicator)

            // 应该有关于 weight 的错误
            const weightErrors = result.errors.filter(e => e.field === 'weight')
            expect(weightErrors.length).toBeGreaterThan(0)

            return weightErrors.length > 0
          }
        ),
        { numRuns: 100 }
      )
    })
  })

  describe('Combined Format Validation', () => {
    it('should validate indicator with all format-correct fields', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }), // progress
          fc.float({ min: 0, max: 100, noNaN: true }), // weight
          fc.integer({ min: 2020, max: 2030 }), // year
          (progress, weight, year) => {
            const indicator = {
              id: 'test-id',
              name: 'Test Indicator',
              progress: progress,
              weight: weight,
              responsibleDept: 'Test Dept',
              year: year
            }

            const result = validateIndicator(indicator)

            expect(result.isValid).toBe(true)
            return result.isValid === true
          }
        ),
        { numRuns: 100 }
      )
    })
  })
})
