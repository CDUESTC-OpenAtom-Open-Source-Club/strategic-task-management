import { describe, expect, it } from 'vitest'
import { isKnownUserRole, mapBackendUser } from '@/shared/lib/utils/authHelpers'

describe('responseParser', () => {
  it('recognizes explicit frontend roles without remapping them', () => {
    const user = mapBackendUser({
      userId: 7,
      username: 'jiaowu_report',
      realName: '教务处填报员',
      role: 'functional_dept',
      orgName: '教务处',
      orgType: 'functional'
    })

    expect(user?.role).toBe('functional_dept')
    expect(user?.orgType).toBe('functional')
  })

  it('preserves admin org type for downstream permission checks', () => {
    const user = mapBackendUser({
      userId: 8,
      username: 'zlb_admin',
      realName: '战略部管理员',
      orgType: 'admin',
      orgName: '战略发展部'
    })

    expect(user?.role).toBe('strategic_dept')
    expect(user?.orgType).toBe('admin')
  })

  it('returns null when the response does not contain a valid frontend role', () => {
    const user = mapBackendUser({
      userId: 9,
      username: 'mystery_user',
      realName: '未知角色用户',
      role: 'ROLE_SUPER_REVIEWER',
      orgType: '',
      orgName: '测试组织'
    })

    expect(user).toBeNull()
  })

  it('falls back to strategic_dept for strategic-org accounts whose role codes cannot map (v1.5.4 zlb_admin login regression)', () => {
    // 线上 v1.5.4 实测：zlb_admin 属战略发展部组织（orgId=35），只挂 ROLE_REPORTER，
    // 载荷缺 orgType 时角色码映射失败 → 此前整个用户解析为 null 被登出弹回。
    const user = mapBackendUser({
      userId: 188,
      username: 'zlb_admin',
      realName: '战略部管理员',
      role: 'ROLE_REPORTER',
      roles: ['ROLE_REPORTER'],
      orgId: 35,
      orgName: '战略发展部'
    })

    expect(user?.role).toBe('strategic_dept')
    expect(user?.orgId).toBe(35)
    expect(user?.orgType).toBeNull()
  })

  it('still returns null for unmappable roles outside the strategic org (orgId !== 35)', () => {
    const user = mapBackendUser({
      userId: 9,
      username: 'mystery_user',
      realName: '未知角色用户',
      role: 'ROLE_SUPER_REVIEWER',
      orgId: 44,
      orgName: '教务处'
    })

    expect(user).toBeNull()
  })

  it('accepts only the three supported frontend roles', () => {
    expect(isKnownUserRole('strategic_dept')).toBe(true)
    expect(isKnownUserRole('functional_dept')).toBe(true)
    expect(isKnownUserRole('secondary_college')).toBe(true)
    expect(isKnownUserRole('ROLE_APPROVER')).toBe(false)
    expect(isKnownUserRole('')).toBe(false)
  })
})
