import { describe, expect, it } from 'vitest'
import { resolveApprovalRoute } from '../approvalNotifications'

describe('approvalNotifications', () => {
  it('routes functional department PLAN_REPORT approvals to indicators', () => {
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

  it('routes college-to-functional PLAN_REPORT approvals to distribution', () => {
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

  it('keeps PLAN approvals on distribution for functional departments', () => {
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
