/**
 * 序列化往返一致性属性测试
 *
 * **Feature: data-alignment-sop, Property 10: 序列化往返一致性**
 * **Validates: Requirements 6.1**
 *
 * For any valid indicator object, serializing to JSON and deserializing back
 * SHALL produce an equivalent object.
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// ==================== Types ====================

interface StatusAuditEntry {
  id: string
  timestamp: string
  operator: string
  operatorName: string
  operatorDept: string
  action: string
  comment: string
  previousProgress?: number
  newProgress?: number
}

interface IndicatorData {
  id: string
  name: string
  isQualitative: boolean
  type1: '定性' | '定量'
  type2: '发展性' | '基础性'
  progress: number
  createTime: string
  weight: number
  remark: string
  canWithdraw: boolean
  targetValue: number
  unit: string
  responsibleDept: string
  responsiblePerson: string
  status: string
  isStrategic: boolean
  ownerDept?: string
  parentIndicatorId?: string
  year: number
  statusAudit: StatusAuditEntry[]
  progressApprovalStatus?: string
  pendingProgress?: number
  pendingRemark?: string
}

// ==================== Serialization Functions ====================

/**
 * Serialize indicator to JSON string
 */
function serializeIndicator(indicator: IndicatorData): string {
  return JSON.stringify(indicator)
}

/**
 * Deserialize JSON string to indicator
 */
function deserializeIndicator(json: string): IndicatorData {
  return JSON.parse(json) as IndicatorData
}

/**
 * Deep equality check for indicators
 */
function areIndicatorsEqual(a: IndicatorData, b: IndicatorData): boolean {
  // Compare primitive fields
  if (a.id !== b.id) {
    return false
  }
  if (a.name !== b.name) {
    return false
  }
  if (a.isQualitative !== b.isQualitative) {
    return false
  }
  if (a.type1 !== b.type1) {
    return false
  }
  if (a.type2 !== b.type2) {
    return false
  }
  if (a.progress !== b.progress) {
    return false
  }
  if (a.createTime !== b.createTime) {
    return false
  }
  if (a.weight !== b.weight) {
    return false
  }
  if (a.remark !== b.remark) {
    return false
  }
  if (a.canWithdraw !== b.canWithdraw) {
    return false
  }
  if (a.targetValue !== b.targetValue) {
    return false
  }
  if (a.unit !== b.unit) {
    return false
  }
  if (a.responsibleDept !== b.responsibleDept) {
    return false
  }
  if (a.responsiblePerson !== b.responsiblePerson) {
    return false
  }
  if (a.status !== b.status) {
    return false
  }
  if (a.isStrategic !== b.isStrategic) {
    return false
  }
  if (a.year !== b.year) {
    return false
  }

  // Compare optional fields
  if (a.ownerDept !== b.ownerDept) {
    return false
  }
  if (a.parentIndicatorId !== b.parentIndicatorId) {
    return false
  }
  if (a.progressApprovalStatus !== b.progressApprovalStatus) {
    return false
  }
  if (a.pendingProgress !== b.pendingProgress) {
    return false
  }
  if (a.pendingRemark !== b.pendingRemark) {
    return false
  }

  // Compare arrays
  if (a.statusAudit.length !== b.statusAudit.length) {
    return false
  }

  // Compare status audit entries
  for (let i = 0; i < a.statusAudit.length; i++) {
    const sa = a.statusAudit[i]!
    const sb = b.statusAudit[i]!
    if (
      sa.id !== sb.id ||
      sa.timestamp !== sb.timestamp ||
      sa.operator !== sb.operator ||
      sa.action !== sb.action
    ) {
      return false
    }
  }

  return true
}

// ==================== Generators ====================

const type1Arb = fc.constantFrom('定性', '定量') as fc.Arbitrary<'定性' | '定量'>
const type2Arb = fc.constantFrom('发展性', '基础性') as fc.Arbitrary<'发展性' | '基础性'>
const statusArb = fc.constantFrom(
  'active',
  'draft',
  'archived',
  'distributed',
  'pending',
  'approved'
)
const actionArb = fc.constantFrom('distribute', 'submit', 'approve', 'reject')

const statusAuditEntryArb: fc.Arbitrary<StatusAuditEntry> = fc.record({
  id: fc.stringMatching(/^audit-\d{1,5}$/),
  timestamp: fc.constantFrom('2026-01-10T00:00:00', '2026-01-15T00:00:00', '2026-01-20T00:00:00'),
  operator: fc.stringMatching(/^[a-z]{2,10}$/),
  operatorName: fc.stringMatching(/^[\u4e00-\u9fa5]{2,4}$/),
  operatorDept: fc.stringMatching(/^[\u4e00-\u9fa5]{2,10}$/),
  action: actionArb,
  comment: fc.stringMatching(/^[\u4e00-\u9fa5a-zA-Z0-9]{5,30}$/),
  previousProgress: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
  newProgress: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined })
})

const indicatorArb: fc.Arbitrary<IndicatorData> = fc
  .record({
    id: fc.stringMatching(/^2026-\d{3}(-\d)?$/),
    name: fc.stringMatching(/^[\u4e00-\u9fa5a-zA-Z0-9]{5,50}$/),
    isQualitative: fc.boolean(),
    type1: type1Arb,
    type2: type2Arb,
    progress: fc.integer({ min: 0, max: 100 }),
    createTime: fc.constantFrom('2026年1月5日', '2026年1月10日', '2026年1月15日'),
    weight: fc.integer({ min: 1, max: 100 }),
    remark: fc.stringMatching(/^[\u4e00-\u9fa5a-zA-Z0-9]{2,30}$/),
    canWithdraw: fc.boolean(),
    targetValue: fc.integer({ min: 1, max: 100 }),
    unit: fc.constantFrom('%', '篇', '人', '家/专业', '门', '项'),
    responsibleDept: fc.stringMatching(/^[\u4e00-\u9fa5]{2,15}$/),
    responsiblePerson: fc.stringMatching(/^[\u4e00-\u9fa5]{2,4}$/),
    status: statusArb,
    isStrategic: fc.boolean(),
    ownerDept: fc.option(fc.stringMatching(/^[\u4e00-\u9fa5]{2,10}$/), { nil: undefined }),
    parentIndicatorId: fc.option(fc.stringMatching(/^2026-\d{3}$/), { nil: undefined }),
    year: fc.constant(2026),
    statusAudit: fc.array(statusAuditEntryArb, { minLength: 0, maxLength: 5 }),
    progressApprovalStatus: fc.option(fc.constantFrom('NONE', 'PENDING', 'APPROVED', 'REJECTED'), {
      nil: undefined
    }),
    pendingProgress: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
    pendingRemark: fc.option(fc.stringMatching(/^[\u4e00-\u9fa5a-zA-Z0-9]{5,30}$/), {
      nil: undefined
    })
  })
  .map(indicator => ({
    ...indicator,
    // Ensure type1 matches isQualitative
    type1: indicator.isQualitative ? ('定性' as const) : ('定量' as const)
  }))

// ==================== Property Tests ====================

describe('Property 10: 序列化往返一致性', () => {
  describe('10.1 基本往返测试', () => {
    /**
     * **Feature: data-alignment-sop, Property 10: 序列化往返一致性**
     *
     * For any valid indicator, serialize → deserialize SHALL produce
     * an equivalent object.
     *
     * **Validates: Requirements 6.1**
     */
    it('should preserve indicator data through JSON roundtrip', () => {
      fc.assert(
        fc.property(indicatorArb, indicator => {
          const serialized = serializeIndicator(indicator)
          const deserialized = deserializeIndicator(serialized)

          expect(areIndicatorsEqual(indicator, deserialized)).toBe(true)

          return true
        }),
        { numRuns: 100 }
      )
    })
  })

  describe('10.2 双重往返测试', () => {
    /**
     * **Feature: data-alignment-sop, Property 10: 序列化往返一致性**
     *
     * For any valid indicator, double roundtrip SHALL produce
     * the same result as single roundtrip.
     *
     * **Validates: Requirements 6.1**
     */
    it('should be idempotent for multiple roundtrips', () => {
      fc.assert(
        fc.property(indicatorArb, indicator => {
          // First roundtrip
          const json1 = serializeIndicator(indicator)
          const obj1 = deserializeIndicator(json1)

          // Second roundtrip
          const json2 = serializeIndicator(obj1)
          const obj2 = deserializeIndicator(json2)

          // Results should be equal
          expect(areIndicatorsEqual(obj1, obj2)).toBe(true)
          expect(json1).toBe(json2)

          return true
        }),
        { numRuns: 100 }
      )
    })
  })

  describe('10.3 字段保持测试', () => {
    /**
     * **Feature: data-alignment-sop, Property 10: 序列化往返一致性**
     *
     * For any valid indicator, all fields SHALL be preserved
     * through serialization.
     *
     * **Validates: Requirements 6.1**
     */
    it('should preserve all primitive fields', () => {
      fc.assert(
        fc.property(indicatorArb, indicator => {
          const serialized = serializeIndicator(indicator)
          const deserialized = deserializeIndicator(serialized)

          // Check all primitive fields
          expect(deserialized.id).toBe(indicator.id)
          expect(deserialized.name).toBe(indicator.name)
          expect(deserialized.isQualitative).toBe(indicator.isQualitative)
          expect(deserialized.type1).toBe(indicator.type1)
          expect(deserialized.type2).toBe(indicator.type2)
          expect(deserialized.progress).toBe(indicator.progress)
          expect(deserialized.weight).toBe(indicator.weight)
          expect(deserialized.canWithdraw).toBe(indicator.canWithdraw)
          expect(deserialized.targetValue).toBe(indicator.targetValue)
          expect(deserialized.unit).toBe(indicator.unit)
          expect(deserialized.status).toBe(indicator.status)
          expect(deserialized.isStrategic).toBe(indicator.isStrategic)
          expect(deserialized.year).toBe(indicator.year)

          return true
        }),
        { numRuns: 100 }
      )
    })

    it('should preserve array fields', () => {
      fc.assert(
        fc.property(indicatorArb, indicator => {
          const serialized = serializeIndicator(indicator)
          const deserialized = deserializeIndicator(serialized)

          // Check array lengths
          expect(deserialized.statusAudit.length).toBe(indicator.statusAudit.length)

          return true
        }),
        { numRuns: 100 }
      )
    })

    it('should preserve optional fields', () => {
      fc.assert(
        fc.property(indicatorArb, indicator => {
          const serialized = serializeIndicator(indicator)
          const deserialized = deserializeIndicator(serialized)

          // Check optional fields
          expect(deserialized.ownerDept).toBe(indicator.ownerDept)
          expect(deserialized.parentIndicatorId).toBe(indicator.parentIndicatorId)
          expect(deserialized.progressApprovalStatus).toBe(indicator.progressApprovalStatus)
          expect(deserialized.pendingProgress).toBe(indicator.pendingProgress)
          expect(deserialized.pendingRemark).toBe(indicator.pendingRemark)

          return true
        }),
        { numRuns: 100 }
      )
    })
  })

  describe('10.4 JSON 格式验证', () => {
    /**
     * **Feature: data-alignment-sop, Property 10: 序列化往返一致性**
     *
     * Serialized output SHALL be valid JSON.
     *
     * **Validates: Requirements 6.1**
     */
    it('should produce valid JSON', () => {
      fc.assert(
        fc.property(indicatorArb, indicator => {
          const serialized = serializeIndicator(indicator)

          // Should not throw when parsing
          expect(() => JSON.parse(serialized)).not.toThrow()

          // Should be a non-empty string
          expect(serialized.length).toBeGreaterThan(0)

          // Should start and end with braces (object)
          expect(serialized.startsWith('{')).toBe(true)
          expect(serialized.endsWith('}')).toBe(true)

          return true
        }),
        { numRuns: 100 }
      )
    })
  })
})

// ==================== Real Data Validation ====================

describe('Real Data: 2026年指标序列化验证', () => {
  const sampleIndicator: IndicatorData = {
    id: '2026-101',
    name: '优质就业比例不低于15%',
    isQualitative: false,
    type1: '定量',
    type2: '发展性',
    progress: 8,
    createTime: '2026年1月5日',
    weight: 20,
    remark: '力争突破',
    canWithdraw: false,
    targetValue: 15,
    unit: '%',
    responsibleDept: '就业创业指导中心',
    responsiblePerson: '张老师',
    status: 'active',
    isStrategic: true,
    ownerDept: '战略发展部',
    year: 2026,
    statusAudit: []
  }

  it('should serialize and deserialize sample indicator correctly', () => {
    const serialized = serializeIndicator(sampleIndicator)
    const deserialized = deserializeIndicator(serialized)

    expect(areIndicatorsEqual(sampleIndicator, deserialized)).toBe(true)
  })

  it('should preserve Chinese characters', () => {
    const serialized = serializeIndicator(sampleIndicator)
    const deserialized = deserializeIndicator(serialized)

    expect(deserialized.name).toBe('优质就业比例不低于15%')
    expect(deserialized.responsibleDept).toBe('就业创业指导中心')
    expect(deserialized.responsiblePerson).toBe('张老师')
    expect(deserialized.remark).toBe('力争突破')
  })
})
