import { describe, expect, it } from 'vitest'

import {
  requiresApprovalCenterFallback,
  resolveApprovalRoute
} from '@/features/approval/lib/approvalNotifications'

describe('approval route fallbacks', () => {
  it('uses approval-center fallback for plan approval entities', () => {
    expect(
      requiresApprovalCenterFallback({
        entityType: 'PLAN',
        approvalInstanceId: 3
      })
    ).toBe(true)
  })

  it('keeps task approvals on the strategic task route', () => {
    expect(
      resolveApprovalRoute({
        entityType: 'TASK',
        entityId: 401,
        approvalInstanceId: 16
      })
    ).toBe(
      '/strategic-tasks?openApproval=1&approvalEntityType=TASK&approvalEntityId=401&approvalInstanceId=16'
    )
  })

  it('keeps functional department plan approvals on the distribution workbench', () => {
    // 2026-11-05：学院上报链与存量下发链的在审实例只有 /distribution 的审批抽屉能加载
    // （/indicators 白名单不含这两个流程码），且撤回也在该页 →
    // 职能部门仍落 /distribution（该页已按登录角色只读化，不影响审批能力）。
    expect(
      resolveApprovalRoute({
        entityType: 'PLAN',
        approvalInstanceId: 3,
        entityId: 4044,
        actionUrl: '/strategic-tasks?tab=approval&approvalInstanceId=3',
        viewerRole: 'functional_dept'
      })
    ).toBe(
      '/distribution?tab=approval&approvalInstanceId=3&openApproval=1&approvalEntityType=PLAN&approvalEntityId=4044'
    )
  })

  it('keeps indicator distribution approvals on the distribution workbench', () => {
    expect(
      resolveApprovalRoute({
        entityType: 'INDICATOR_DISTRIBUTION',
        approvalInstanceId: 9,
        entityId: 5050,
        viewerRole: 'strategic_dept'
      })
    ).toBe(
      '/distribution?openApproval=1&approvalEntityType=INDICATOR_DISTRIBUTION&approvalEntityId=5050&approvalInstanceId=9'
    )
  })
})
