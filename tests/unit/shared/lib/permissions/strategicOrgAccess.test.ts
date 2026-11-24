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
  isStrategicOrgId
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
