/**
 * 父子指标关联属性测试
 *
 * **Feature: page-data-verification**
 * - **Property 10: Parent-Child Indicator Association**
 *
 * **Validates: Requirements 3.2**
 */
import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest'
import * as fc from 'fast-check'
import { setActivePinia, createPinia } from 'pinia'
import type { StrategicIndicator } from '@/shared/types'

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

const idArbitrary = fc.string({ minLength: 1, maxLength: 10 }).filter(s => s.trim().length > 0)
const taskContentArbitrary = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter(s => s.trim().length > 0)

/**
 * 创建父指标
 */
function createParentIndicator(id: string, taskContent: string): StrategicIndicator {
  return {
    id,
    name: `Parent ${id}`,
    isQualitative: false,
    type1: '定量',
    type2: '基础性',
    progress: 50,
    createTime: '2025年01月01日',
    weight: 10,
    remark: '',
    canWithdraw: false,
    taskContent,
    targetValue: 100,
    unit: '%',
    responsibleDept: '教务处',
    responsiblePerson: 'Test',
    status: 'active',
    isStrategic: true,
    ownerDept: '战略发展部',
    year: 2025,
    progressApprovalStatus: 'none'
  }
}

/**
 * 创建子指标
 */
function createChildIndicator(
  id: string,
  parentId: string,
  taskContent: string
): StrategicIndicator {
  return {
    id,
    name: `Child ${id}`,
    isQualitative: false,
    type1: '定量',
    type2: '基础性',
    progress: 30,
    createTime: '2025年01月01日',
    weight: 5,
    remark: '',
    canWithdraw: false,
    taskContent,
    targetValue: 50,
    unit: '%',
    responsibleDept: '计算机学院',
    responsiblePerson: 'Test',
    status: 'active',
    isStrategic: false,
    ownerDept: '教务处',
    year: 2025,
    progressApprovalStatus: 'none',
    parentIndicatorId: parentId
  }
}

// ============================================================================
// 验证函数
// ============================================================================

/**
 * 验证子指标的父指标是否存在
 */
function validateParentExists(
  childIndicator: StrategicIndicator,
  allIndicators: StrategicIndicator[]
): boolean {
  if (!childIndicator.parentIndicatorId) {
    return true
  } // 无父指标ID，跳过验证

  return allIndicators.some(
    i => i.id.toString() === childIndicator.parentIndicatorId && i.isStrategic
  )
}

/**
 * 验证子指标的 taskContent 是否与父指标匹配
 */
function validateTaskContentMatch(
  childIndicator: StrategicIndicator,
  allIndicators: StrategicIndicator[]
): boolean {
  if (!childIndicator.parentIndicatorId) {
    return true
  }

  const parent = allIndicators.find(i => i.id.toString() === childIndicator.parentIndicatorId)

  if (!parent) {
    return false
  }
  return childIndicator.taskContent === parent.taskContent
}

/**
 * 获取所有子指标
 */
function getChildIndicators(indicators: StrategicIndicator[]): StrategicIndicator[] {
  return indicators.filter(i => !i.isStrategic && i.parentIndicatorId)
}

/**
 * 获取指定父指标的所有子指标
 */
function getChildrenOfParent(
  parentId: string,
  indicators: StrategicIndicator[]
): StrategicIndicator[] {
  return indicators.filter(i => i.parentIndicatorId === parentId)
}

// ============================================================================
// Property 10: Parent-Child Indicator Association
// ============================================================================

describe('Property 10: Parent-Child Indicator Association', () => {
  /**
   * **Validates: Requirement 3.2**
   *
   * *For any* child indicator with a parentIndicatorId, there SHALL exist
   * a parent indicator with matching id in the indicators list, and the
   * child's taskContent SHALL match the parent's taskContent.
   */

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('Parent Existence Validation', () => {
    it('should find parent for every child indicator', () => {
      fc.assert(
        fc.property(
          fc.array(idArbitrary, { minLength: 1, maxLength: 5 }),
          taskContentArbitrary,
          (parentIds, taskContent) => {
            // 创建父指标
            const parents = parentIds.map(id => createParentIndicator(id, taskContent))

            // 为每个父指标创建子指标
            const children = parentIds.flatMap((parentId, idx) => [
              createChildIndicator(`child-${idx}`, parentId, taskContent)
            ])

            const allIndicators = [...parents, ...children]

            // 验证每个子指标都能找到父指标
            children.forEach(child => {
              expect(validateParentExists(child, allIndicators)).toBe(true)
            })

            return true
          }
        ),
        { numRuns: 100 }
      )
    })

    it('should fail validation when parent is missing', () => {
      const orphanChild = createChildIndicator('orphan', 'non-existent-parent', 'Task')
      const indicators = [orphanChild]

      expect(validateParentExists(orphanChild, indicators)).toBe(false)
    })

    it('should pass validation for indicators without parentIndicatorId', () => {
      const standaloneIndicator = createParentIndicator('standalone', 'Task')
      const indicators = [standaloneIndicator]

      expect(validateParentExists(standaloneIndicator, indicators)).toBe(true)
    })
  })

  describe('TaskContent Match Validation', () => {
    it('should have matching taskContent between parent and child', () => {
      fc.assert(
        fc.property(idArbitrary, taskContentArbitrary, (parentId, taskContent) => {
          const parent = createParentIndicator(parentId, taskContent)
          const child = createChildIndicator('child-1', parentId, taskContent)

          const allIndicators = [parent, child]

          expect(validateTaskContentMatch(child, allIndicators)).toBe(true)

          return true
        }),
        { numRuns: 100 }
      )
    })

    it('should fail when taskContent does not match', () => {
      const parent = createParentIndicator('parent-1', 'Parent Task')
      const child = createChildIndicator('child-1', 'parent-1', 'Different Task')

      const allIndicators = [parent, child]

      expect(validateTaskContentMatch(child, allIndicators)).toBe(false)
    })
  })

  describe('Child Indicator Retrieval', () => {
    it('should correctly retrieve all child indicators', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 1, max: 3 }),
          (parentCount, childrenPerParent) => {
            const parents: StrategicIndicator[] = []
            const children: StrategicIndicator[] = []

            for (let p = 0; p < parentCount; p++) {
              const parent = createParentIndicator(`parent-${p}`, `Task ${p}`)
              parents.push(parent)

              for (let c = 0; c < childrenPerParent; c++) {
                const child = createChildIndicator(`child-${p}-${c}`, `parent-${p}`, `Task ${p}`)
                children.push(child)
              }
            }

            const allIndicators = [...parents, ...children]
            const retrievedChildren = getChildIndicators(allIndicators)

            expect(retrievedChildren.length).toBe(children.length)

            return true
          }
        ),
        { numRuns: 50 }
      )
    })

    it('should correctly retrieve children of specific parent', () => {
      const parent1 = createParentIndicator('p1', 'Task 1')
      const parent2 = createParentIndicator('p2', 'Task 2')
      const child1a = createChildIndicator('c1a', 'p1', 'Task 1')
      const child1b = createChildIndicator('c1b', 'p1', 'Task 1')
      const child2a = createChildIndicator('c2a', 'p2', 'Task 2')

      const allIndicators = [parent1, parent2, child1a, child1b, child2a]

      const childrenOfP1 = getChildrenOfParent('p1', allIndicators)
      const childrenOfP2 = getChildrenOfParent('p2', allIndicators)

      expect(childrenOfP1.length).toBe(2)
      expect(childrenOfP2.length).toBe(1)
    })
  })
})
