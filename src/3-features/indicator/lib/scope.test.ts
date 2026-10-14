import { describe, expect, it } from 'vitest'
import type { StrategicIndicator } from '@/shared/types'
import {
  canUseAsFunctionalParentIndicator,
  filterIndicatorsForViewerRole,
  getIndicatorOwnerOrgId,
  getIndicatorTargetOrgId,
  isIndicatorOwnedByOrg,
  isIndicatorTargetedToOrg,
  isRootIndicator
} from './scope'

const createIndicator = (overrides: Partial<StrategicIndicator> = {}): StrategicIndicator =>
  ({
    id: '1001',
    name: '测试指标',
    taskContent: '任务A',
    responsibleDept: '党委办公室 | 党委统战部',
    ownerDept: '战略发展部',
    isStrategic: true,
    type1: '定量',
    type2: '基础性',
    weight: 20,
    progress: 0,
    status: 'DISTRIBUTED',
    year: 2026,
    statusAudit: [],
    ...overrides
  }) as StrategicIndicator

describe('indicator scope rules', () => {
  it('reads target org id from runtime field', () => {
    expect(getIndicatorTargetOrgId(createIndicator({ targetOrgId: 36 } as any))).toBe(36)
    expect(getIndicatorTargetOrgId(createIndicator())).toBeNull()
  })

  it('reads owner org id from runtime field', () => {
    expect(getIndicatorOwnerOrgId(createIndicator({ ownerOrgId: 36 } as any))).toBe(36)
    expect(getIndicatorOwnerOrgId(createIndicator())).toBeNull()
  })

  it('distinguishes root and child indicators by parentIndicatorId', () => {
    expect(isRootIndicator(createIndicator())).toBe(true)
    expect(isRootIndicator(createIndicator({ parentIndicatorId: '2001' }))).toBe(false)
  })

  it('functional departments only see root indicators for their own org', () => {
    const result = filterIndicatorsForViewerRole(
      [
        createIndicator({ id: '2001', targetOrgId: 36 } as any),
        createIndicator({
          id: '2041',
          targetOrgId: 57,
          parentIndicatorId: '2001',
          isStrategic: false
        } as any)
      ],
      'functional_dept',
      36,
      true
    )

    expect(result.map(item => item.id)).toEqual(['2001'])
  })

  it('secondary colleges can see indicators targeted to their own org', () => {
    const result = filterIndicatorsForViewerRole(
      [
        createIndicator({
          id: '2041',
          targetOrgId: 57,
          parentIndicatorId: '2001',
          isStrategic: false
        } as any),
        createIndicator({
          id: '2042',
          targetOrgId: 55,
          parentIndicatorId: '2001',
          isStrategic: false
        } as any)
      ],
      'secondary_college',
      57,
      true
    )

    expect(result.map(item => item.id)).toEqual(['2041'])
  })

  it('functional parent candidate must be strategic root indicator for current org', () => {
    expect(
      canUseAsFunctionalParentIndicator(createIndicator({ targetOrgId: 36 } as any), 36, true)
    ).toBe(true)

    expect(
      canUseAsFunctionalParentIndicator(
        createIndicator({ targetOrgId: 57, parentIndicatorId: '2001' } as any),
        36,
        true
      )
    ).toBe(false)
  })

  it('matches distribution ownership and college target by org ids', () => {
    const child = createIndicator({
      id: '2041',
      isStrategic: false,
      ownerOrgId: 36,
      targetOrgId: 68,
      ownerDept: '',
      responsibleDept: '',
      parentIndicatorId: '2002'
    } as any)

    expect(isIndicatorOwnedByOrg(child, 36)).toBe(true)
    expect(isIndicatorOwnedByOrg(child, 44)).toBe(false)
    expect(isIndicatorTargetedToOrg(child, 68)).toBe(true)
    expect(isIndicatorTargetedToOrg(child, 57)).toBe(false)
  })
})
