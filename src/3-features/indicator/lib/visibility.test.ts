import { describe, expect, it } from 'vitest'
import type { StrategicIndicator } from '@/shared/types'
import { canViewReceivedPlanContent, isVisibleReceivedStrategicIndicator } from './visibility'

const createIndicator = (overrides: Partial<StrategicIndicator> = {}): StrategicIndicator =>
  ({
    id: '1001',
    name: '测试战略指标',
    taskContent: '战略任务A',
    responsibleDept: '教务部',
    ownerDept: '任意上级部门',
    isStrategic: true,
    type1: '定量',
    type2: '基础指标',
    weight: 20,
    progress: 0,
    status: 'DISTRIBUTED',
    year: 2026,
    statusAudit: [],
    ...overrides
  }) as StrategicIndicator

describe('indicator visibility rules', () => {
  describe('canViewReceivedPlanContent', () => {
    it('allows strategic departments regardless of plan status', () => {
      expect(canViewReceivedPlanContent('DRAFT', true)).toBe(true)
      expect(canViewReceivedPlanContent(null, true)).toBe(true)
    })

    it('only allows receiving departments after the plan enters a visible state', () => {
      expect(canViewReceivedPlanContent('DRAFT', false)).toBe(false)
      expect(canViewReceivedPlanContent('DISTRIBUTED', false)).toBe(true)
      expect(canViewReceivedPlanContent('APPROVED', false)).toBe(true)
      expect(canViewReceivedPlanContent('ACTIVE', false)).toBe(true)
      expect(canViewReceivedPlanContent('pending', false)).toBe(false)
      expect(canViewReceivedPlanContent('RETURNED', false)).toBe(false)
    })
  })

  describe('isVisibleReceivedStrategicIndicator', () => {
    it('shows indicators to functional department only when current department can see them', () => {
      const indicator = createIndicator({ responsibleDept: '教务部', targetOrgId: 44 } as any)

      expect(
        isVisibleReceivedStrategicIndicator({
          indicator,
          currentYear: 2026,
          realCurrentYear: 2026,
          viewingDept: '教务部',
          viewingOrgId: 44,
          isStrategicDept: false,
          canViewReceivedContent: true
        })
      ).toBe(true)
    })

    it('hides indicators if current department cannot see them on /indicators', () => {
      const indicator = createIndicator({ responsibleDept: '党委办', targetOrgId: 36 } as any)

      expect(
        isVisibleReceivedStrategicIndicator({
          indicator,
          currentYear: 2026,
          realCurrentYear: 2026,
          viewingDept: '教务部',
          viewingOrgId: 44,
          isStrategicDept: false,
          canViewReceivedContent: true
        })
      ).toBe(false)
    })

    it('hides indicators before the receiving department enters visible plan status', () => {
      const indicator = createIndicator({ responsibleDept: '教务部', targetOrgId: 44 } as any)

      expect(
        isVisibleReceivedStrategicIndicator({
          indicator,
          currentYear: 2026,
          realCurrentYear: 2026,
          viewingDept: '教务部',
          viewingOrgId: 44,
          isStrategicDept: false,
          canViewReceivedContent: false
        })
      ).toBe(false)
    })

    it('does not depend on owner department being 战略发展部', () => {
      const indicator = createIndicator({
        responsibleDept: '教务部',
        ownerDept: '党委办公室',
        targetOrgId: 44
      } as any)

      expect(
        isVisibleReceivedStrategicIndicator({
          indicator,
          currentYear: 2026,
          realCurrentYear: 2026,
          viewingDept: '教务部',
          viewingOrgId: 44,
          isStrategicDept: false,
          canViewReceivedContent: true
        })
      ).toBe(true)
    })

    it('filters out non-strategic or wrong-year indicators', () => {
      expect(
        isVisibleReceivedStrategicIndicator({
          indicator: createIndicator({ isStrategic: false, targetOrgId: 44 } as any),
          currentYear: 2026,
          realCurrentYear: 2026,
          viewingDept: '教务部',
          viewingOrgId: 44,
          isStrategicDept: false,
          canViewReceivedContent: true
        })
      ).toBe(false)

      expect(
        isVisibleReceivedStrategicIndicator({
          indicator: createIndicator({ year: 2025, targetOrgId: 44 } as any),
          currentYear: 2026,
          realCurrentYear: 2026,
          viewingDept: '教务部',
          viewingOrgId: 44,
          isStrategicDept: false,
          canViewReceivedContent: true
        })
      ).toBe(false)
    })

    it('prefers targetOrgId matching when backend provides stable department ids', () => {
      expect(
        isVisibleReceivedStrategicIndicator({
          indicator: createIndicator({
            responsibleDept: '党委办公室 | 党委统战部',
            targetOrgId: 36
          } as any),
          currentYear: 2026,
          realCurrentYear: 2026,
          viewingDept: '党委办',
          viewingOrgId: 36,
          isStrategicDept: false,
          canViewReceivedContent: true
        })
      ).toBe(true)
    })

    it('does not fall back to department names when targetOrgId does not match', () => {
      expect(
        isVisibleReceivedStrategicIndicator({
          indicator: createIndicator({
            responsibleDept: '党委办公室 | 党委统战部',
            targetOrgId: 44
          } as any),
          currentYear: 2026,
          realCurrentYear: 2026,
          viewingDept: '党委办公室 | 党委统战部',
          viewingOrgId: 36,
          isStrategicDept: false,
          canViewReceivedContent: true
        })
      ).toBe(false)
    })
  })
})
