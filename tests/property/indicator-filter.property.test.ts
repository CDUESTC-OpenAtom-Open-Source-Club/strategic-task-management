/**
 * 指标过滤属性测试
 *
 * **Feature: page-data-verification**
 * - **Property 2: Filter Logic Correctness** (年份、部门过滤)
 *
 * **Validates: Requirements 2.2, 2.3**
 */
import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest'
import * as fc from 'fast-check'
import { setActivePinia, createPinia } from 'pinia'
import type { StrategicIndicator, ProgressApprovalStatus } from '@/shared/types'
import { PROGRESS_APPROVAL_STATUS_VALUES } from '@/shared/config/validationRules'

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
// 数据生成器
// ============================================================================

const departmentNames = [
  '战略发展部',
  '教务处',
  '科研处',
  '人事处',
  '财务处',
  '计算机学院',
  '机械工程学院',
  '电子信息学院',
  '经济管理学院'
]

const departmentArbitrary = fc.constantFrom(...departmentNames)
const yearArbitrary = fc.integer({ min: 2023, max: 2026 })
const progressArbitrary = fc.integer({ min: 0, max: 100 })

/**
 * 生成有效的指标对象
 */
const indicatorArbitrary: fc.Arbitrary<StrategicIndicator> = fc.record({
  id: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
  name: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
  isQualitative: fc.boolean(),
  type1: fc.constantFrom('定量', '定性') as fc.Arbitrary<'定量' | '定性'>,
  type2: fc.constantFrom('发展性', '基础性') as fc.Arbitrary<'发展性' | '基础性'>,
  progress: progressArbitrary,
  createTime: fc.constant('2025年01月01日'),
  weight: fc.float({ min: 0, max: 100, noNaN: true }),
  remark: fc.string({ maxLength: 100 }),
  canWithdraw: fc.boolean(),
  taskContent: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
  targetValue: fc.integer({ min: 0, max: 100 }),
  unit: fc.constantFrom('%', '个', '项'),
  responsibleDept: departmentArbitrary,
  responsiblePerson: fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
  status: fc.constantFrom('active', 'pending', 'approved', 'draft') as fc.Arbitrary<
    'active' | 'pending' | 'approved' | 'draft' | 'archived' | 'distributed'
  >,
  isStrategic: fc.boolean(),
  ownerDept: departmentArbitrary,
  year: yearArbitrary,
  progressApprovalStatus: fc.constantFrom(
    ...PROGRESS_APPROVAL_STATUS_VALUES
  ) as fc.Arbitrary<ProgressApprovalStatus>
})

// ============================================================================
// 过滤函数（从 IndicatorListView 提取的纯函数）
// ============================================================================

/**
 * 按年份过滤指标
 */
function filterByYear(
  indicators: StrategicIndicator[],
  targetYear: number,
  defaultYear: number = 2025
): StrategicIndicator[] {
  return indicators.filter(i => {
    const indicatorYear = i.year || defaultYear
    return indicatorYear === targetYear
  })
}

/**
 * 按责任部门过滤指标
 */
function filterByResponsibleDept(
  indicators: StrategicIndicator[],
  dept: string | undefined
): StrategicIndicator[] {
  if (!dept) {
    return indicators
  }
  return indicators.filter(i => i.responsibleDept === dept)
}

/**
 * 按来源部门过滤指标
 */
function filterByOwnerDept(
  indicators: StrategicIndicator[],
  dept: string | undefined
): StrategicIndicator[] {
  if (!dept) {
    return indicators
  }
  return indicators.filter(i => i.ownerDept === dept)
}

/**
 * 按部门过滤（责任部门或来源部门匹配）
 */
function filterByDeptMatch(
  indicators: StrategicIndicator[],
  viewingDept: string | undefined
): StrategicIndicator[] {
  if (!viewingDept) {
    return indicators
  }
  return indicators.filter(i => i.responsibleDept === viewingDept || i.ownerDept === viewingDept)
}

// ============================================================================
// Property 2: Filter Logic Correctness - 年份过滤
// ============================================================================

describe('Property 2: Filter Logic Correctness - Year Filter', () => {
  /**
   * **Validates: Requirement 2.2**
   * WHEN 指标按年份筛选时, THE Data_Validator SHALL 验证 year 字段正确过滤数据
   */

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('should return only indicators matching target year', () => {
    fc.assert(
      fc.property(
        fc.array(indicatorArbitrary, { minLength: 1, maxLength: 30 }),
        yearArbitrary,
        (indicators, targetYear) => {
          const result = filterByYear(indicators, targetYear)

          // 所有结果的年份应匹配目标年份
          result.forEach(i => {
            const year = i.year || 2025
            expect(year).toBe(targetYear)
          })

          return true
        }
      ),
      { numRuns: 100 }
    )
  })

  it('should return subset of original list', () => {
    fc.assert(
      fc.property(
        fc.array(indicatorArbitrary, { minLength: 0, maxLength: 30 }),
        yearArbitrary,
        (indicators, targetYear) => {
          const result = filterByYear(indicators, targetYear)

          expect(result.length).toBeLessThanOrEqual(indicators.length)
          result.forEach(r => {
            expect(indicators.some(i => i.id === r.id)).toBe(true)
          })

          return true
        }
      ),
      { numRuns: 100 }
    )
  })

  it('should use default year for indicators without year field', () => {
    const indicatorsWithoutYear = [
      { ...createMinimalIndicator('1'), year: undefined as unknown as number },
      { ...createMinimalIndicator('2'), year: 2025 },
      { ...createMinimalIndicator('3'), year: 2024 }
    ]

    const result = filterByYear(indicatorsWithoutYear, 2025, 2025)

    // 应该返回 year=2025 和 year=undefined（默认2025）的指标
    expect(result.length).toBe(2)
  })
})

// ============================================================================
// Property 2: Filter Logic Correctness - 部门过滤
// ============================================================================

describe('Property 2: Filter Logic Correctness - Department Filter', () => {
  /**
   * **Validates: Requirement 2.3**
   * WHEN 指标按部门筛选时, THE Data_Validator SHALL 验证 responsibleDept 和 ownerDept 字段正确匹配
   */

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('should return only indicators with matching responsibleDept', () => {
    fc.assert(
      fc.property(
        fc.array(indicatorArbitrary, { minLength: 1, maxLength: 30 }),
        departmentArbitrary,
        (indicators, targetDept) => {
          const result = filterByResponsibleDept(indicators, targetDept)

          result.forEach(i => {
            expect(i.responsibleDept).toBe(targetDept)
          })

          return true
        }
      ),
      { numRuns: 100 }
    )
  })

  it('should return only indicators with matching ownerDept', () => {
    fc.assert(
      fc.property(
        fc.array(indicatorArbitrary, { minLength: 1, maxLength: 30 }),
        departmentArbitrary,
        (indicators, targetDept) => {
          const result = filterByOwnerDept(indicators, targetDept)

          result.forEach(i => {
            expect(i.ownerDept).toBe(targetDept)
          })

          return true
        }
      ),
      { numRuns: 100 }
    )
  })

  it('should return indicators where responsibleDept OR ownerDept matches', () => {
    fc.assert(
      fc.property(
        fc.array(indicatorArbitrary, { minLength: 1, maxLength: 30 }),
        departmentArbitrary,
        (indicators, viewingDept) => {
          const result = filterByDeptMatch(indicators, viewingDept)

          result.forEach(i => {
            const matches = i.responsibleDept === viewingDept || i.ownerDept === viewingDept
            expect(matches).toBe(true)
          })

          return true
        }
      ),
      { numRuns: 100 }
    )
  })

  it('should return all indicators when department filter is undefined', () => {
    fc.assert(
      fc.property(fc.array(indicatorArbitrary, { minLength: 0, maxLength: 30 }), indicators => {
        const result1 = filterByResponsibleDept(indicators, undefined)
        const result2 = filterByOwnerDept(indicators, undefined)
        const result3 = filterByDeptMatch(indicators, undefined)

        expect(result1.length).toBe(indicators.length)
        expect(result2.length).toBe(indicators.length)
        expect(result3.length).toBe(indicators.length)

        return true
      }),
      { numRuns: 100 }
    )
  })
})

// ============================================================================
// 辅助函数
// ============================================================================

function createMinimalIndicator(id: string): StrategicIndicator {
  return {
    id,
    name: `Test Indicator ${id}`,
    isQualitative: false,
    type1: '定量',
    type2: '基础性',
    progress: 50,
    createTime: '2025年01月01日',
    weight: 10,
    remark: '',
    canWithdraw: false,
    taskContent: 'Test Task',
    targetValue: 100,
    unit: '%',
    responsibleDept: '教务处',
    responsiblePerson: 'Test Person',
    status: 'active',
    isStrategic: true,
    ownerDept: '战略发展部',
    year: 2025,
    progressApprovalStatus: 'none'
  }
}
