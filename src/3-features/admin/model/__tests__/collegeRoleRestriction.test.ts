import { describe, expect, it } from 'vitest'
import {
  COLLEGE_ORG_TYPES,
  COLLEGE_VICE_PRESIDENT_ERROR_MESSAGE,
  VICE_PRESIDENT_ROLE_CODE,
  filterRolesForOrg,
  isCollegeOrgType,
  isRoleAssignmentAllowed
} from '../collegeRoleRestriction'

// 2026-10-25 用户定案：战略发展部人员均可创建账号，但学院下不得创建「分管校领导」。
describe('二级学院角色创建限制', () => {
  it('识别学院组织类型（前端映射值与后端预置值都算学院）', () => {
    expect(isCollegeOrgType('secondary_college')).toBe(true)
    expect(isCollegeOrgType('academic')).toBe(true)
    expect(isCollegeOrgType('college')).toBe(true)
    expect(COLLEGE_ORG_TYPES.has('secondary_college')).toBe(true)
  })

  it('战略发展部/职能部门不受限制', () => {
    expect(isCollegeOrgType('strategic_dept')).toBe(false)
    expect(isCollegeOrgType('functional_dept')).toBe(false)
    expect(isCollegeOrgType('')).toBe(false)
    expect(isCollegeOrgType(null)).toBe(false)
  })

  it('学院下勾选分管校领导会被移除', () => {
    const result = filterRolesForOrg([VICE_PRESIDENT_ROLE_CODE], 'secondary_college')
    expect(result.removed).toBe(true)
    expect(result.roles).toEqual([])
  })

  it('学院下其他角色不受影响', () => {
    const result = filterRolesForOrg(['ROLE_REPORTER', 'ROLE_APPROVER'], 'academic')
    expect(result.removed).toBe(false)
    expect(result.roles).toEqual(['ROLE_REPORTER', 'ROLE_APPROVER'])
  })

  it('学院下混合角色时只移除分管校领导', () => {
    const result = filterRolesForOrg(
      ['ROLE_REPORTER', VICE_PRESIDENT_ROLE_CODE, 'ROLE_APPROVER'],
      'secondary_college'
    )
    expect(result.removed).toBe(true)
    expect(result.roles).toEqual(['ROLE_REPORTER', 'ROLE_APPROVER'])
  })

  it('非学院下允许分管校领导', () => {
    const roles = [VICE_PRESIDENT_ROLE_CODE]
    const result = filterRolesForOrg(roles, 'strategic_dept')
    expect(result.removed).toBe(false)
    expect(isRoleAssignmentAllowed(roles, 'functional_dept')).toBe(true)
  })

  it('学院下分管校领导组合判定为不允许', () => {
    expect(isRoleAssignmentAllowed([VICE_PRESIDENT_ROLE_CODE], 'secondary_college')).toBe(false)
    expect(isRoleAssignmentAllowed(['ROLE_REPORTER'], 'secondary_college')).toBe(true)
  })

  it('错误提示文案明确指向审核人替代', () => {
    expect(COLLEGE_VICE_PRESIDENT_ERROR_MESSAGE).toContain('二级学院')
    expect(COLLEGE_VICE_PRESIDENT_ERROR_MESSAGE).toContain('分管校领导')
    expect(COLLEGE_VICE_PRESIDENT_ERROR_MESSAGE).toContain('审核人')
  })
})
