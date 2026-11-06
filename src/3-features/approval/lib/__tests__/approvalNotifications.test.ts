import { describe, expect, it } from 'vitest'
import { resolveApprovalRoute } from '../approvalNotifications'

/**
 * 2026-11-05（战略部直发学院指标）：审批通知跳转口径随下发链路改造调整。
 *
 * 关键事实：学院上报链 PLAN_APPROVAL_COLLEGE 未停用，其「分管职能部门」席位 scope
 * 取自 plan.createdByOrgId；存量计划 createdBy=职能部门 → 待办仍会派给职能部门。
 * 而只有 /distribution 的审批抽屉能加载 PLAN_APPROVAL_COLLEGE / PLAN_DISPATCH_FUNCDEPT
 * 实例（/indicators 的白名单不含这两个流程码，落过去抽屉是空的），且「撤回」也在该页。
 *
 * - 职能部门的学院上报类（PLAN_REPORT，存在上报方向）仍落 /distribution。
 * - 职能部门自己的计划审批（PLAN）仍落 /distribution。
 * - 指标下发审批（INDICATOR_DISTRIBUTION）保持落 /distribution。
 * - 学院（secondary_college）落 /indicators；战略部落 /strategic-tasks，口径不变。
 */
describe('approvalNotifications', () => {
  it('routes functional department report approvals to the distribution workbench', () => {
    expect(
      resolveApprovalRoute({
        entityType: 'PLAN_REPORT',
        entityId: 123,
        approvalInstanceId: 456,
        viewerRole: 'functional_dept',
        departmentName: '继续教育部',
        sourceOrgName: '战略发展部',
        targetOrgName: '继续教育部',
        currentDepartmentName: '继续教育部'
      })
    ).toBe(
      '/distribution?openApproval=1&approvalEntityType=PLAN_REPORT&approvalEntityId=123&approvalInstanceId=456&approvalDepartment=%E7%BB%A7%E7%BB%AD%E6%95%99%E8%82%B2%E9%83%A8&approvalSourceOrg=%E6%88%98%E7%95%A5%E5%8F%91%E5%B1%95%E9%83%A8&approvalTargetOrg=%E7%BB%A7%E7%BB%AD%E6%95%99%E8%82%B2%E9%83%A8'
    )
  })

  it('routes functional department college report approvals to the distribution workbench', () => {
    expect(
      resolveApprovalRoute({
        entityType: 'PLAN_REPORT',
        entityId: 321,
        approvalInstanceId: 654,
        viewerRole: 'functional_dept',
        departmentName: '计算机学院',
        sourceOrgName: '继续教育部',
        targetOrgName: '计算机学院',
        currentDepartmentName: '继续教育部'
      })
    ).toBe(
      '/distribution?openApproval=1&approvalEntityType=PLAN_REPORT&approvalEntityId=321&approvalInstanceId=654&approvalDepartment=%E8%AE%A1%E7%AE%97%E6%9C%BA%E5%AD%A6%E9%99%A2&approvalSourceOrg=%E7%BB%A7%E7%BB%AD%E6%95%99%E8%82%B2%E9%83%A8&approvalTargetOrg=%E8%AE%A1%E7%AE%97%E6%9C%BA%E5%AD%A6%E9%99%A2'
    )
  })

  it('routes college PLAN_REPORT approvals to indicators', () => {
    expect(
      resolveApprovalRoute({
        entityType: 'PLAN_REPORT',
        entityId: 88,
        viewerRole: 'secondary_college',
        departmentName: '计算机学院'
      })
    ).toBe(
      '/indicators?openApproval=1&approvalEntityType=PLAN_REPORT&approvalEntityId=88&approvalDepartment=%E8%AE%A1%E7%AE%97%E6%9C%BA%E5%AD%A6%E9%99%A2'
    )
  })

  it('keeps PLAN approvals of functional departments on the distribution workbench', () => {
    expect(
      resolveApprovalRoute({
        entityType: 'PLAN',
        entityId: 77,
        viewerRole: 'functional_dept',
        departmentName: '继续教育部'
      })
    ).toBe(
      '/distribution?openApproval=1&approvalEntityType=PLAN&approvalEntityId=77&approvalDepartment=%E7%BB%A7%E7%BB%AD%E6%95%99%E8%82%B2%E9%83%A8'
    )
  })

  it('keeps indicator distribution approvals on the distribution workbench', () => {
    expect(
      resolveApprovalRoute({
        entityType: 'INDICATOR_DISTRIBUTION',
        entityId: 55,
        viewerRole: 'strategic_dept',
        departmentName: '计算机学院'
      })
    ).toBe(
      '/distribution?openApproval=1&approvalEntityType=INDICATOR_DISTRIBUTION&approvalEntityId=55&approvalDepartment=%E8%AE%A1%E7%AE%97%E6%9C%BA%E5%AD%A6%E9%99%A2'
    )
  })

  it('replaces backend dashboard path for approval workbench jumps', () => {
    expect(
      resolveApprovalRoute({
        entityType: 'PLAN_REPORT',
        entityId: 123,
        approvalInstanceId: 456,
        viewerRole: 'functional_dept',
        actionUrl: '/dashboard?approvalInstanceId=19',
        sourceOrgName: '战略发展部',
        targetOrgName: '继续教育部',
        currentDepartmentName: '继续教育部'
      })
    ).toBe(
      '/distribution?approvalInstanceId=456&openApproval=1&approvalEntityType=PLAN_REPORT&approvalEntityId=123&approvalDepartment=%E7%BB%A7%E7%BB%AD%E6%95%99%E8%82%B2%E9%83%A8&approvalSourceOrg=%E6%88%98%E7%95%A5%E5%8F%91%E5%B1%95%E9%83%A8&approvalTargetOrg=%E7%BB%A7%E7%BB%AD%E6%95%99%E8%82%B2%E9%83%A8'
    )
  })
})
