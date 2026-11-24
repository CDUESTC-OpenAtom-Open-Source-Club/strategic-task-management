/**
 * 战略发展部组织维度判定单测（2026-11-24 v1.5.4 登录回归修复）。
 *
 * 线上回归：zlb_admin 属战略发展部组织（orgId=35）但角色码只有 ROLE_REPORTER，
 * 旧守卫按角色码（userRole === 'strategic_dept'）判定超角色放行，该账号漏判
 * 被弹回登录页。修复口径：判定「战略发展部组织的账号」（orgType=admin 或
 * orgId=35），与角色码解耦。
 */
import { describe, expect, it } from 'vitest'
import {
  STRATEGIC_DEPT_ORG_ID,
  isStrategicOrgAccount,
  isStrategicOrgId,
  resolveEffectiveLoginRole
} from '@/shared/lib/permissions/strategicOrgAccess'

describe('isStrategicOrgId', () => {
  it('orgId=35（战略发展部）命中，容忍 string/number 双形态', () => {
    expect(isStrategicOrgId(35)).toBe(true)
    expect(isStrategicOrgId('35')).toBe(true)
  })

  it('非 35 的组织不命中（含空值/非法输入）', () => {
    expect(isStrategicOrgId(36)).toBe(false)
    expect(isStrategicOrgId('36')).toBe(false)
    expect(isStrategicOrgId('')).toBe(false)
    expect(isStrategicOrgId(null)).toBe(false)
    expect(isStrategicOrgId(undefined)).toBe(false)
    expect(isStrategicOrgId('abc')).toBe(false)
  })

  it('常量与 sys_org 种子一致（35=战略发展部）', () => {
    expect(STRATEGIC_DEPT_ORG_ID).toBe(35)
  })
})

describe('isStrategicOrgAccount', () => {
  it('zlb_admin 口径：orgId=35 + 仅业务角色码（orgType 缺失）→ 命中', () => {
    expect(isStrategicOrgAccount({ orgType: null, orgId: 35 })).toBe(true)
    expect(isStrategicOrgAccount({ orgType: undefined, orgId: '35' })).toBe(true)
  })

  it('orgType=admin 命中（战略部组织种子类型）', () => {
    expect(isStrategicOrgAccount({ orgType: 'admin', orgId: 35 })).toBe(true)
    expect(isStrategicOrgAccount({ orgType: 'ADMIN', orgId: null })).toBe(true)
  })

  it('职能部门 / 学院账号不命中（组织豁免不外溢）', () => {
    expect(isStrategicOrgAccount({ orgType: 'functional', orgId: 36 })).toBe(false)
    expect(isStrategicOrgAccount({ orgType: 'academic', orgId: 41 })).toBe(false)
    expect(isStrategicOrgAccount({ orgType: null, orgId: 44 })).toBe(false)
  })

  it('空用户不命中', () => {
    expect(isStrategicOrgAccount(null)).toBe(false)
    expect(isStrategicOrgAccount(undefined)).toBe(false)
  })
})

describe('resolveEffectiveLoginRole（导航/路由层身份唯一归一入口 · 2026-11-24 返修）', () => {
  it('zlb_admin 口径：orgId=35 + 角色码解析失败（null）→ 导航层归一 strategic_dept', () => {
    expect(resolveEffectiveLoginRole({ orgType: null, orgId: 35 }, null)).toBe('strategic_dept')
    expect(resolveEffectiveLoginRole({ orgType: undefined, orgId: '35' }, null)).toBe(
      'strategic_dept'
    )
  })

  it('orgType=admin（本地载荷形态）→ 归一 strategic_dept', () => {
    expect(resolveEffectiveLoginRole({ orgType: 'admin', orgId: 35 }, 'strategic_dept')).toBe(
      'strategic_dept'
    )
    expect(resolveEffectiveLoginRole({ orgType: 'admin', orgId: null }, null)).toBe(
      'strategic_dept'
    )
  })

  it('orgId=35 + 角色码解析为其他前端角色 → 组织维度仍归一 strategic_dept（导航层语义）', () => {
    expect(resolveEffectiveLoginRole({ orgType: null, orgId: 35 }, 'secondary_college')).toBe(
      'strategic_dept'
    )
  })

  it('职能部门 / 学院账号：登录角色码原样透传（API 数据层身份不归一）', () => {
    expect(resolveEffectiveLoginRole({ orgType: 'functional', orgId: 36 }, 'functional_dept')).toBe(
      'functional_dept'
    )
    expect(resolveEffectiveLoginRole({ orgType: 'academic', orgId: 41 }, 'secondary_college')).toBe(
      'secondary_college'
    )
  })

  it('非战略部组织 + 角色码解析失败：null 原样返回（守卫按无角色弹回）', () => {
    expect(resolveEffectiveLoginRole({ orgType: null, orgId: 44 }, null)).toBeNull()
    expect(resolveEffectiveLoginRole(null, null)).toBeNull()
    expect(resolveEffectiveLoginRole(null, 'functional_dept')).toBe('functional_dept')
  })
})
