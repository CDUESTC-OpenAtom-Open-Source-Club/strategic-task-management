import { describe, expect, it } from 'vitest'
import { getApprovalRouteDisplay } from '../approvalMessageDisplay'

/**
 * 2026-11-12（D-3 统一口径）：后端 metadata 已按上报方向返回 source/target
 * （source=提交方，target=审批方），审批消息流向统一直接 source -> target——
 * 上报（PLAN_REPORT）不再翻转，下发/异动维持原样。
 */
const buildMessage = (overrides: {
  entityType?: string
  sourceOrgName?: string
  targetOrgName?: string
}) => ({
  content: '',
  currentStepName: '',
  detailContent: '',
  entityType: overrides.entityType ?? '',
  metadata: {
    sourceOrgName: overrides.sourceOrgName ?? '',
    targetOrgName: overrides.targetOrgName ?? ''
  },
  senderDisplay: ''
})

describe('getApprovalRouteDisplay（D-3 统一口径：上报不翻转、下发原样）', () => {
  it('上报消息直接按 source -> target 展示（提交方在前），不再翻转为 target -> source', () => {
    expect(
      getApprovalRouteDisplay(
        buildMessage({
          entityType: 'PLAN_REPORT',
          sourceOrgName: '计算机学院',
          targetOrgName: '战略发展部'
        })
      )
    ).toBe('计算机学院 -> 战略发展部')
  })

  it('下发消息维持 source -> target 原方向', () => {
    expect(
      getApprovalRouteDisplay(
        buildMessage({
          entityType: 'PLAN',
          sourceOrgName: '战略发展部',
          targetOrgName: '教务处'
        })
      )
    ).toBe('战略发展部 -> 教务处')
  })

  it('单侧组织名缺失时只显示已有的一侧', () => {
    expect(
      getApprovalRouteDisplay(
        buildMessage({
          entityType: 'PLAN_REPORT',
          sourceOrgName: '计算机学院'
        })
      )
    ).toBe('计算机学院')
    expect(getApprovalRouteDisplay(buildMessage({ entityType: 'PLAN_REPORT' }))).toBe('')
  })
})
