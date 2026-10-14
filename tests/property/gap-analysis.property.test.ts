/**
 * 差距分析属性测试
 *
 * **Feature: data-alignment-sop, Property 3: 差距分类正确性**
 * **Validates: Requirements 2.1, 2.2, 2.3**
 *
 * For any pair of field sets (frontend, database), the gap analysis SHALL correctly
 * classify each field as present (✅), missing (❌), or inconsistent (⚠️) with no misclassifications.
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// ==================== Types ====================

type FieldStatus = 'present' | 'missing' | 'inconsistent'

interface FieldDefinition {
  name: string
  type: string
  required: boolean
}

interface GapAnalysisResult {
  field: string
  status: FieldStatus
  frontendType?: string
  backendType?: string
  reason?: string
}

// ==================== Gap Analysis Functions ====================

/**
 * Normalize type names for comparison
 * Maps TypeScript types to Java/SQL equivalents
 */
function normalizeType(type: string): string {
  const typeMap: Record<string, string> = {
    // TypeScript → normalized
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    'string[]': 'array',
    'number[]': 'array',
    object: 'object',
    Date: 'datetime',
    // Java → normalized
    String: 'string',
    Long: 'number',
    Integer: 'number',
    BigDecimal: 'number',
    Boolean: 'boolean',
    LocalDateTime: 'datetime',
    LocalDate: 'date',
    List: 'array',
    // SQL → normalized
    VARCHAR: 'string',
    TEXT: 'string',
    BIGINT: 'number',
    INTEGER: 'number',
    DECIMAL: 'number',
    BOOLEAN: 'boolean',
    TIMESTAMP: 'datetime',
    DATE: 'date',
    JSONB: 'object',
    JSON: 'object'
  }

  // Handle generic types like List<X>
  const baseType = type.replace(/<.*>/, '').trim()
  return typeMap[baseType] || type.toLowerCase()
}

/**
 * Check if two types are compatible
 */
function areTypesCompatible(frontendType: string, backendType: string): boolean {
  const normalizedFrontend = normalizeType(frontendType)
  const normalizedBackend = normalizeType(backendType)

  // Direct match
  if (normalizedFrontend === normalizedBackend) {
    return true
  }

  // Date/datetime compatibility
  if (
    (normalizedFrontend === 'string' ||
      normalizedFrontend === 'datetime' ||
      normalizedFrontend === 'date') &&
    (normalizedBackend === 'datetime' || normalizedBackend === 'date')
  ) {
    return true
  }

  // Number compatibility (string IDs can map to numeric IDs)
  if (normalizedFrontend === 'string' && normalizedBackend === 'number') {
    return true // ID fields often have this pattern
  }

  return false
}

/**
 * Perform gap analysis between frontend and backend field sets
 */
function analyzeGaps(
  frontendFields: FieldDefinition[],
  backendFields: FieldDefinition[]
): GapAnalysisResult[] {
  const results: GapAnalysisResult[] = []
  const backendFieldMap = new Map(backendFields.map(f => [f.name.toLowerCase(), f]))
  const processedBackendFields = new Set<string>()

  // Check each frontend field against backend
  for (const frontendField of frontendFields) {
    const normalizedName = frontendField.name.toLowerCase()
    const backendField = backendFieldMap.get(normalizedName)

    if (!backendField) {
      // Field missing in backend
      results.push({
        field: frontendField.name,
        status: 'missing',
        frontendType: frontendField.type,
        reason: 'Field exists in frontend but not in backend'
      })
    } else {
      processedBackendFields.add(normalizedName)

      // Check type compatibility
      if (areTypesCompatible(frontendField.type, backendField.type)) {
        results.push({
          field: frontendField.name,
          status: 'present',
          frontendType: frontendField.type,
          backendType: backendField.type
        })
      } else {
        results.push({
          field: frontendField.name,
          status: 'inconsistent',
          frontendType: frontendField.type,
          backendType: backendField.type,
          reason: `Type mismatch: frontend=${frontendField.type}, backend=${backendField.type}`
        })
      }
    }
  }

  return results
}

/**
 * Classify a single field comparison
 */
function classifyField(
  frontendField: FieldDefinition | undefined,
  backendField: FieldDefinition | undefined
): FieldStatus {
  if (!frontendField && !backendField) {
    throw new Error('At least one field must be defined')
  }

  if (!backendField) {
    return 'missing'
  }

  if (!frontendField) {
    return 'present' // Extra backend field is considered present
  }

  if (areTypesCompatible(frontendField.type, backendField.type)) {
    return 'present'
  }

  return 'inconsistent'
}

// ==================== Generators ====================

const fieldNameArb = fc.stringMatching(/^[a-z][a-zA-Z0-9]{2,20}$/)

const typeScriptTypeArb = fc.oneof(
  fc.constant('string'),
  fc.constant('number'),
  fc.constant('boolean'),
  fc.constant('string[]'),
  fc.constant('Date'),
  fc.constant('object')
)

const javaTypeArb = fc.oneof(
  fc.constant('String'),
  fc.constant('Long'),
  fc.constant('Integer'),
  fc.constant('BigDecimal'),
  fc.constant('Boolean'),
  fc.constant('LocalDateTime'),
  fc.constant('LocalDate'),
  fc.constant('List<String>')
)

const frontendFieldArb: fc.Arbitrary<FieldDefinition> = fc.record({
  name: fieldNameArb,
  type: typeScriptTypeArb,
  required: fc.boolean()
})

const backendFieldArb: fc.Arbitrary<FieldDefinition> = fc.record({
  name: fieldNameArb,
  type: javaTypeArb,
  required: fc.boolean()
})

// ==================== Property Tests ====================

describe('Property 3: 差距分类正确性', () => {
  describe('3.1 缺失字段检测', () => {
    /**
     * **Feature: data-alignment-sop, Property 3: 差距分类正确性**
     *
     * For any frontend field that does not exist in backend,
     * the gap analysis SHALL classify it as 'missing'.
     *
     * **Validates: Requirements 2.2**
     */
    it('should classify frontend-only fields as missing', () => {
      fc.assert(
        fc.property(fc.array(frontendFieldArb, { minLength: 1, maxLength: 10 }), frontendFields => {
          // Backend has no fields
          const backendFields: FieldDefinition[] = []

          const results = analyzeGaps(frontendFields, backendFields)

          // All frontend fields should be classified as missing
          for (const result of results) {
            expect(result.status).toBe('missing')
          }

          // Number of results should match number of frontend fields
          expect(results.length).toBe(frontendFields.length)

          return true
        }),
        { numRuns: 100 }
      )
    })
  })

  describe('3.2 存在字段检测', () => {
    /**
     * **Feature: data-alignment-sop, Property 3: 差距分类正确性**
     *
     * For any field that exists in both frontend and backend with compatible types,
     * the gap analysis SHALL classify it as 'present'.
     *
     * **Validates: Requirements 2.1**
     */
    it('should classify matching fields as present', () => {
      fc.assert(
        fc.property(fc.array(fieldNameArb, { minLength: 1, maxLength: 10 }), fieldNames => {
          // Create matching frontend and backend fields with compatible types
          const frontendFields: FieldDefinition[] = fieldNames.map(name => ({
            name,
            type: 'string',
            required: true
          }))

          const backendFields: FieldDefinition[] = fieldNames.map(name => ({
            name,
            type: 'String', // Java String is compatible with TS string
            required: true
          }))

          const results = analyzeGaps(frontendFields, backendFields)

          // All fields should be classified as present
          for (const result of results) {
            expect(result.status).toBe('present')
          }

          return true
        }),
        { numRuns: 100 }
      )
    })
  })

  describe('3.3 类型不匹配检测', () => {
    /**
     * **Feature: data-alignment-sop, Property 3: 差距分类正确性**
     *
     * For any field that exists in both frontend and backend with incompatible types,
     * the gap analysis SHALL classify it as 'inconsistent'.
     *
     * **Validates: Requirements 2.3**
     */
    it('should classify type mismatches as inconsistent', () => {
      fc.assert(
        fc.property(fc.array(fieldNameArb, { minLength: 1, maxLength: 10 }), fieldNames => {
          // Create fields with incompatible types
          const frontendFields: FieldDefinition[] = fieldNames.map(name => ({
            name,
            type: 'boolean', // boolean
            required: true
          }))

          const backendFields: FieldDefinition[] = fieldNames.map(name => ({
            name,
            type: 'LocalDateTime', // datetime - incompatible with boolean
            required: true
          }))

          const results = analyzeGaps(frontendFields, backendFields)

          // All fields should be classified as inconsistent
          for (const result of results) {
            expect(result.status).toBe('inconsistent')
          }

          return true
        }),
        { numRuns: 100 }
      )
    })
  })

  describe('3.4 分类完整性', () => {
    /**
     * **Feature: data-alignment-sop, Property 3: 差距分类正确性**
     *
     * For any pair of field sets, every frontend field SHALL be classified
     * into exactly one category: present, missing, or inconsistent.
     *
     * **Validates: Requirements 2.1, 2.2, 2.3**
     */
    it('should classify every frontend field into exactly one category', () => {
      fc.assert(
        fc.property(
          // 2026-10-14：生成器按字段名去重——analyzeGaps 忠实保留输入重复，
          // 输入重名会让「输出无重复」断言必然失败（分类器不该替调用方去重）。
          fc.array(frontendFieldArb, { minLength: 1, maxLength: 15 }).map(fields => {
            const seen = new Set<string>()
            return fields.filter(field =>
              seen.has(field.name) ? false : (seen.add(field.name), true)
            )
          }),
          fc.array(backendFieldArb, { minLength: 0, maxLength: 15 }),
          (frontendFields, backendFields) => {
            const results = analyzeGaps(frontendFields, backendFields)

            // Every frontend field should have exactly one result
            expect(results.length).toBe(frontendFields.length)

            // Each result should have a valid status
            for (const result of results) {
              expect(['present', 'missing', 'inconsistent']).toContain(result.status)
            }

            // No duplicate field names in results
            const fieldNames = results.map(r => r.field)
            const uniqueNames = new Set(fieldNames)
            expect(uniqueNames.size).toBe(fieldNames.length)

            return true
          }
        ),
        { numRuns: 100 }
      )
    })
  })

  describe('3.5 分类互斥性', () => {
    /**
     * **Feature: data-alignment-sop, Property 3: 差距分类正确性**
     *
     * For any single field, the classification SHALL be mutually exclusive:
     * a field cannot be both 'present' and 'missing', etc.
     *
     * **Validates: Requirements 2.1, 2.2, 2.3**
     */
    it('should produce mutually exclusive classifications', () => {
      fc.assert(
        fc.property(
          frontendFieldArb,
          fc.option(backendFieldArb, { nil: undefined }),
          (frontendField, backendField) => {
            const status = classifyField(frontendField, backendField)

            // Status should be exactly one of the three values
            const validStatuses: FieldStatus[] = ['present', 'missing', 'inconsistent']
            expect(validStatuses).toContain(status)

            // Verify the classification logic
            if (!backendField) {
              expect(status).toBe('missing')
            } else if (areTypesCompatible(frontendField.type, backendField.type)) {
              expect(status).toBe('present')
            } else {
              expect(status).toBe('inconsistent')
            }

            return true
          }
        ),
        { numRuns: 100 }
      )
    })
  })

  describe('3.6 类型兼容性对称性', () => {
    /**
     * **Feature: data-alignment-sop, Property 3: 差距分类正确性**
     *
     * Type normalization SHALL be consistent: normalizing a type twice
     * should produce the same result as normalizing once.
     *
     * **Validates: Requirements 2.1**
     */
    it('should have idempotent type normalization', () => {
      fc.assert(
        fc.property(fc.oneof(typeScriptTypeArb, javaTypeArb), type => {
          const normalized1 = normalizeType(type)
          const normalized2 = normalizeType(normalized1)

          // Normalizing twice should give the same result
          expect(normalized2).toBe(normalized1)

          return true
        }),
        { numRuns: 100 }
      )
    })
  })
})

// ==================== Real Data Validation ====================

describe('Real Data: Indicator 字段差距分析', () => {
  // Frontend StrategicIndicator fields from data dictionary
  const frontendIndicatorFields: FieldDefinition[] = [
    { name: 'id', type: 'string', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'isQualitative', type: 'boolean', required: true },
    { name: 'type1', type: 'string', required: true },
    { name: 'type2', type: 'string', required: true },
    { name: 'progress', type: 'number', required: true },
    { name: 'createTime', type: 'string', required: true },
    { name: 'weight', type: 'number', required: true },
    { name: 'remark', type: 'string', required: true },
    { name: 'canWithdraw', type: 'boolean', required: true },
    { name: 'targetValue', type: 'number', required: true },
    { name: 'unit', type: 'string', required: true },
    { name: 'responsiblePerson', type: 'string', required: true },
    { name: 'status', type: 'string', required: true },
    { name: 'year', type: 'number', required: false },
    { name: 'statusAudit', type: 'object', required: false },
    { name: 'progressApprovalStatus', type: 'string', required: false },
    { name: 'pendingProgress', type: 'number', required: false },
    { name: 'pendingRemark', type: 'string', required: false }
  ]

  // Backend IndicatorVO fields (current state)
  const backendIndicatorFields: FieldDefinition[] = [
    { name: 'indicatorId', type: 'Long', required: true },
    { name: 'indicatorDesc', type: 'String', required: true },
    { name: 'weightPercent', type: 'BigDecimal', required: true },
    { name: 'year', type: 'Integer', required: true },
    { name: 'status', type: 'String', required: true },
    { name: 'remark', type: 'String', required: false },
    { name: 'createdAt', type: 'LocalDateTime', required: true },
    { name: 'updatedAt', type: 'LocalDateTime', required: true }
  ]

  it('should identify missing fields in current backend', () => {
    const results = analyzeGaps(frontendIndicatorFields, backendIndicatorFields)

    // Count missing fields
    const missingFields = results.filter(r => r.status === 'missing')

    // We expect many fields to be missing based on the gap analysis report
    expect(missingFields.length).toBeGreaterThan(0)

    // Specific fields that should be missing
    const expectedMissing = [
      'isQualitative',
      'type1',
      'type2',
      'progress',
      'canWithdraw',
      'targetValue',
      'unit',
      'responsiblePerson',
      'statusAudit',
      'progressApprovalStatus',
      'pendingProgress',
      'pendingRemark'
    ]

    const missingFieldNames = missingFields.map(f => f.field)
    for (const expected of expectedMissing) {
      expect(missingFieldNames).toContain(expected)
    }
  })

  it('should identify present fields in current backend', () => {
    const results = analyzeGaps(frontendIndicatorFields, backendIndicatorFields)

    // Count present fields
    const presentFields = results.filter(r => r.status === 'present')

    // Some fields should be present (with name mapping)
    expect(presentFields.length).toBeGreaterThan(0)
  })
})
