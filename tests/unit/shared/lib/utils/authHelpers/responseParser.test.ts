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

  it('local zlb_admin payload (orgType=admin) resolves strategic_dept via org-type mapping', () => {
    // 本地载荷形态：orgType=admin → mapOrgTypeToRole 命中 strategic_dept。
    const user = mapBackendUser({
      userId: 188,
      username: 'zlb_admin',
      realName: '战略部管理员',
      roles: ['ROLE_REPORTER'],
      orgId: 35,
      orgName: '战略发展部',
      orgType: 'admin'
    })

    expect(user?.role).toBe('strategic_dept')
    expect(user?.orgId).toBe(35)
    expect(user?.orgType).toBe('admin')
    expect(user?.roles).toEqual(['ROLE_REPORTER'])
  })

  it('does NOT normalize by org: unmappable role codes stay unparsed even for orgId=35 (2026-11-24 返修·身份两层模型)', () => {
    // 返修定案：解析结果 = API 数据层身份，必须与后端真实角色一致——
    // orgId=35 + 仅业务角色码（如 ROLE_REPORTER）+ 载荷缺 orgType 时**不做组织维度归一**，
    // 否则 UI 按战略部调用全量接口集合会被 @PreAuthorize 拒绝刷 403（线上 zlb_admin 实证）。
    // 战略部组织的导航/路由层归一由 resolveEffectiveLoginRole（strategicOrgAccess.ts）负责。
    const user = mapBackendUser({
      userId: 188,
      username: 'zlb_admin',
      realName: '战略部管理员',
      roles: ['ROLE_REPORTER'],
      orgId: 35,
      orgName: '战略发展部'
    })

    expect(user).toBeNull()
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
