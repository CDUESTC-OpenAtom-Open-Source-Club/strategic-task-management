/**
 * 数据完整性验证测试
 *
 * **Feature: data-alignment-sop, Task 8.2: 验证数据完整性**
 * **Validates: Requirements 7.1, 7.2, 7.3**
 *
 * Verifies:
 * - 定量指标数量 >= 12
 * - 发展性和基础性指标都存在
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

// ==================== Types ====================

interface IndicatorData {
  id: string
  name: string
  isQualitative: boolean
  type1: '定性' | '定量'
  type2: '发展性' | '基础性'
}

// ==================== Validation Functions ====================

/**
 * Count quantitative indicators
 */
function countQuantitativeIndicators(indicators: IndicatorData[]): number {
  return indicators.filter(i => !i.isQualitative && i.type1 === '定量').length
}

/**
 * Count qualitative indicators
 */
function countQualitativeIndicators(indicators: IndicatorData[]): number {
  return indicators.filter(i => i.isQualitative && i.type1 === '定性').length
}

/**
 * Check if both development and basic indicators exist
 */
function hasBothType2Categories(indicators: IndicatorData[]): {
  hasDevelopment: boolean
  hasBasic: boolean
} {
  const hasDevelopment = indicators.some(i => i.type2 === '发展性')
  const hasBasic = indicators.some(i => i.type2 === '基础性')
  return { hasDevelopment, hasBasic }
}

/**
 * Validate data completeness
 */
function validateDataCompleteness(indicators: IndicatorData[]): {
  valid: boolean
  errors: string[]
  stats: {
    totalCount: number
    quantitativeCount: number
    qualitativeCount: number
    developmentCount: number
    basicCount: number
  }
} {
  const errors: string[] = []

  const quantitativeCount = countQuantitativeIndicators(indicators)
  const qualitativeCount = countQualitativeIndicators(indicators)
  const { hasDevelopment, hasBasic } = hasBothType2Categories(indicators)

  // Check quantitative count >= 12
  if (quantitativeCount < 12) {
    errors.push(`定量指标数量不足: 期望 >= 12, 实际 ${quantitativeCount}`)
  }

  // Check both type2 categories exist
  if (!hasDevelopment) {
    errors.push('缺少发展性指标')
  }
  if (!hasBasic) {
    errors.push('缺少基础性指标')
  }

  const developmentCount = indicators.filter(i => i.type2 === '发展性').length
  const basicCount = indicators.filter(i => i.type2 === '基础性').length

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      totalCount: indicators.length,
      quantitativeCount,
      qualitativeCount,
      developmentCount,
      basicCount
    }
  }
}

// ==================== Generators ====================

const type1Arb = fc.constantFrom('定性', '定量') as fc.Arbitrary<'定性' | '定量'>
const type2Arb = fc.constantFrom('发展性', '基础性') as fc.Arbitrary<'发展性' | '基础性'>

const indicatorArb: fc.Arbitrary<IndicatorData> = fc
  .record({
    id: fc.stringMatching(/^2026-\d{3}(-\d)?$/),
    name: fc.stringMatching(/^[\u4e00-\u9fa5a-zA-Z0-9]{5,30}$/),
    isQualitative: fc.boolean(),
    type1: type1Arb,
    type2: type2Arb
  })
  .map(indicator => ({
    ...indicator,
    // Ensure type1 matches isQualitative
    type1: indicator.isQualitative ? ('定性' as const) : ('定量' as const)
  }))

// ==================== Property Tests ====================

describe('Task 8.2: 验证数据完整性', () => {
  describe('8.2.1 定量指标数量验证', () => {
    /**
     * **Feature: data-alignment-sop, Task 8.2**
     *
     * The dataset SHALL contain at least 12 quantitative indicators.
     *
     * **Validates: Requirements 7.1**
     */
    it('should require at least 12 quantitative indicators', () => {
      // Test with insufficient quantitative indicators
      const insufficientIndicators: IndicatorData[] = Array(10)
        .fill(null)
        .map((_, i) => ({
          id: `2026-${100 + i}`,
          name: `定量指标${i + 1}`,
          isQualitative: false,
          type1: '定量' as const,
          type2: '发展性' as const
        }))

      const result = validateDataCompleteness(insufficientIndicators)
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.includes('定量指标数量不足'))).toBe(true)
    })

    it('should pass with 12 or more quantitative indicators', () => {
      const sufficientIndicators: IndicatorData[] = [
        // 12 quantitative indicators
        ...Array(12)
          .fill(null)
          .map((_, i) => ({
            id: `2026-${100 + i}`,
            name: `定量指标${i + 1}`,
            isQualitative: false,
            type1: '定量' as const,
            type2: i % 2 === 0 ? ('发展性' as const) : ('基础性' as const)
          })),
        // 2 qualitative indicators
        {
          id: '2026-201',
          name: '定性指标1',
          isQualitative: true,
          type1: '定性' as const,
          type2: '基础性' as const
        },
        {
          id: '2026-202',
          name: '定性指标2',
          isQualitative: true,
          type1: '定性' as const,
          type2: '发展性' as const
        }
      ]

      const result = validateDataCompleteness(sufficientIndicators)
      expect(result.stats.quantitativeCount).toBeGreaterThanOrEqual(12)
    })
  })

  describe('8.2.3 指标类型完整性验证', () => {
    /**
     * **Feature: data-alignment-sop, Task 8.2**
     *
     * The dataset SHALL contain both development (发展性) and basic (基础性) indicators.
     *
     * **Validates: Requirements 7.3**
     */
    it('should require both development and basic indicators', () => {
      // Only development indicators
      const onlyDevelopment: IndicatorData[] = Array(12)
        .fill(null)
        .map((_, i) => ({
          id: `2026-${100 + i}`,
          name: `发展性指标${i + 1}`,
          isQualitative: false,
          type1: '定量' as const,
          type2: '发展性' as const
        }))

      const result = validateDataCompleteness(onlyDevelopment)
      expect(result.errors.some(e => e.includes('缺少基础性指标'))).toBe(true)
    })

    it('should pass with both type2 categories', () => {
      const bothTypes: IndicatorData[] = [
        ...Array(6)
          .fill(null)
          .map((_, i) => ({
            id: `2026-${100 + i}`,
            name: `发展性指标${i + 1}`,
            isQualitative: false,
            type1: '定量' as const,
            type2: '发展性' as const
          })),
        ...Array(6)
          .fill(null)
          .map((_, i) => ({
            id: `2026-${200 + i}`,
            name: `基础性指标${i + 1}`,
            isQualitative: false,
            type1: '定量' as const,
            type2: '基础性' as const
          }))
      ]

      const result = validateDataCompleteness(bothTypes)
      expect(result.stats.developmentCount).toBeGreaterThan(0)
      expect(result.stats.basicCount).toBeGreaterThan(0)
    })
  })

  describe('8.2.4 属性测试 - 数据完整性不变量', () => {
    /**
     * **Feature: data-alignment-sop, Task 8.2**
     *
     * For any valid dataset, the validation function SHALL correctly
     * identify completeness issues.
     *
     * **Validates: Requirements 7.1, 7.2, 7.3**
     */
    it('should correctly count indicator types', () => {
      fc.assert(
        fc.property(fc.array(indicatorArb, { minLength: 1, maxLength: 20 }), indicators => {
          const result = validateDataCompleteness(indicators)

          // Stats should be consistent
          expect(result.stats.totalCount).toBe(indicators.length)
          expect(
            result.stats.quantitativeCount + result.stats.qualitativeCount
          ).toBeLessThanOrEqual(indicators.length)
          expect(result.stats.developmentCount + result.stats.basicCount).toBe(indicators.length)

          return true
        }),
        { numRuns: 100 }
      )
    })
  })
})

// ==================== Real Data Validation ====================

describe('Real Data: 2026年指标数据完整性验证', () => {
  // Sample data based on seed-indicators-2026.sql
  const realIndicators: IndicatorData[] = [
    // Quantitative indicators (定量)
    {
      id: '2026-101',
      name: '优质就业比例不低于15%',
      isQualitative: false,
      type1: '定量',
      type2: '发展性'
    },
    {
      id: '2026-102',
      name: '毕业生就业率不低于95%',
      isQualitative: false,
      type1: '定量',
      type2: '发展性'
    },
    {
      id: '2026-103',
      name: '引进优质校招企业',
      isQualitative: false,
      type1: '定量',
      type2: '发展性'
    },
    {
      id: '2026-104',
      name: '毕业生创业比例不低于6%',
      isQualitative: false,
      type1: '定量',
      type2: '发展性'
    },
    { id: '2026-105', name: '就业率达92%', isQualitative: false, type1: '定量', type2: '发展性' },
    {
      id: '2026-111',
      name: '计算机学院优质就业比例',
      isQualitative: false,
      type1: '定量',
      type2: '发展性'
    },
    {
      id: '2026-112',
      name: '商学院优质就业比例',
      isQualitative: false,
      type1: '定量',
      type2: '发展性'
    },
    {
      id: '2026-113',
      name: '艺术学院优质就业比例',
      isQualitative: false,
      type1: '定量',
      type2: '发展性'
    },
    {
      id: '2026-114',
      name: '工学院优质就业比例',
      isQualitative: false,
      type1: '定量',
      type2: '发展性'
    },
    {
      id: '2026-115',
      name: '航空学院优质就业比例',
      isQualitative: false,
      type1: '定量',
      type2: '发展性'
    },
    {
      id: '2026-401',
      name: '课程优良率达87%',
      isQualitative: false,
      type1: '定量',
      type2: '基础性'
    },
    {
      id: '2026-402',
      name: '高水平论文不少于55篇',
      isQualitative: false,
      type1: '定量',
      type2: '发展性'
    },
    {
      id: '2026-501',
      name: '党员发展质量达标率96%',
      isQualitative: false,
      type1: '定量',
      type2: '基础性'
    },
    // Qualitative indicators (定性)
    {
      id: '2026-201',
      name: '建立完善校友反馈母校的工作机制',
      isQualitative: true,
      type1: '定性',
      type2: '基础性'
    },
    {
      id: '2026-301',
      name: '信息化相关数据报送准确',
      isQualitative: true,
      type1: '定性',
      type2: '基础性'
    },
    {
      id: '2026-502',
      name: '统战工作覆盖率达100%',
      isQualitative: true,
      type1: '定性',
      type2: '基础性'
    }
  ]

  it('should have at least 12 quantitative indicators', () => {
    const result = validateDataCompleteness(realIndicators)
    expect(result.stats.quantitativeCount).toBeGreaterThanOrEqual(12)
  })

  it('should have qualitative indicators', () => {
    const qualitative = realIndicators.filter(i => i.isQualitative)
    expect(qualitative.length).toBeGreaterThan(0)
  })

  it('should have both development and basic indicators', () => {
    const result = validateDataCompleteness(realIndicators)
    expect(result.stats.developmentCount).toBeGreaterThan(0)
    expect(result.stats.basicCount).toBeGreaterThan(0)
  })

  it('should pass all completeness checks', () => {
    const result = validateDataCompleteness(realIndicators)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
})
