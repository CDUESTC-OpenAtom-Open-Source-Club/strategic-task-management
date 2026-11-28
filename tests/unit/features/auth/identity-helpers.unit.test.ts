/**
 * 多身份：身份列表解析与展示文案（纯函数）
 *
 * Tests for features/auth/lib/identity.ts
 */

import { describe, it, expect } from 'vitest'
import {
  extractIdentityContext,
  formatIdentityLabel,
  formatIdentityRoles,
  formatIdentityTitle,
  formatUserIdentityTitle,
  getIdentityRoleLabel,
  getIdentitySlotLabel,
  hasMultipleIdentities,
  normalizeIdentities,
  resolveCurrentIdentity,
  sortIdentities
} from '@/features/auth/lib/identity'
import type { IdentityDTO } from '@/features/auth/api/types'

const strategicIdentity: IdentityDTO = {
  sysUserId: 188,
  orgId: 35,
  orgName: '战略发展部',
  orgType: 'admin',
  roles: ['ROLE_REPORTER'],
  slot: 1
}

const academicAffairsIdentity: IdentityDTO = {
  sysUserId: 44,
  orgId: 44,
  orgName: '教务处',
  orgType: 'functional',
  roles: ['ROLE_APPROVER'],
  slot: 2
}

describe('槽位与角色文案', () => {
  it('槽位 1 / 2 展示为一号 / 二号，其余按数字顺延', () => {
    expect(getIdentitySlotLabel(1)).toBe('一号')
    expect(getIdentitySlotLabel(2)).toBe('二号')
    expect(getIdentitySlotLabel(3)).toBe('3号')
  })

  it('槽位非法时返回空串', () => {
    expect(getIdentitySlotLabel(0)).toBe('')
    expect(getIdentitySlotLabel(-1)).toBe('')
    expect(getIdentitySlotLabel(null)).toBe('')
    expect(getIdentitySlotLabel(undefined)).toBe('')
  })

  it('角色码按后端角色名展示，未收录的角色码去掉 ROLE_ 前缀', () => {
    expect(getIdentityRoleLabel('ROLE_REPORTER')).toBe('填报人')
    expect(getIdentityRoleLabel('ROLE_APPROVER')).toBe('审核人')
    expect(getIdentityRoleLabel('ROLE_STRATEGY_DEPT_HEAD')).toBe('战略发展部负责人')
    expect(getIdentityRoleLabel('ROLE_VICE_PRESIDENT')).toBe('分管校领导')
    expect(getIdentityRoleLabel('ROLE_SYSTEM_ADMIN')).toBe('系统管理员')
    expect(getIdentityRoleLabel('ROLE_SOMETHING_NEW')).toBe('SOMETHING_NEW')
    expect(getIdentityRoleLabel('')).toBe('')
  })

  it('多个角色去重后用斜杠连接', () => {
    expect(formatIdentityRoles(['ROLE_REPORTER', 'ROLE_APPROVER', 'ROLE_REPORTER'])).toBe(
      '填报人 / 审核人'
    )
    expect(formatIdentityRoles([])).toBe('')
    expect(formatIdentityRoles(undefined)).toBe('')
  })

  it('身份标题与身份标签均为「部门 · 角色」，不含槽位文案', () => {
    expect(formatIdentityTitle(strategicIdentity)).toBe('战略发展部 · 填报人')
    expect(formatIdentityLabel(strategicIdentity)).toBe('战略发展部 · 填报人')
    expect(formatIdentityLabel(academicAffairsIdentity)).toBe('教务处 · 审核人')
  })

  it('角色为空时只显示部门', () => {
    expect(formatIdentityTitle({ orgName: '教务处', roles: [] })).toBe('教务处')
    expect(formatIdentityLabel({ orgName: '教务处', roles: [] })).toBe('教务处')
  })
})

describe('身份列表归一化与排序', () => {
  it('按槽位排序，slot 相同按 sysUserId，不改动入参', () => {
    const input = [academicAffairsIdentity, strategicIdentity]
    const sorted = sortIdentities(input)

    expect(sorted.map(item => item.slot)).toEqual([1, 2])
    expect(input[0]).toBe(academicAffairsIdentity)
  })

  it('丢弃缺 sysUserId 的条目、按 sysUserId 去重、缺失的 slot 按已接受条目的顺序补位', () => {
    const normalized = normalizeIdentities([
      {
        sysUserId: 44,
        orgId: 44,
        orgName: '教务处',
        orgType: 'functional',
        roles: ['ROLE_APPROVER']
      },
      { sysUserId: 44, orgId: 44, orgName: '教务处', orgType: 'functional', roles: [] },
      { orgName: '没有账号 ID 的脏数据' },
      'not-an-object',
      null,
      {
        sysUserId: 188,
        orgId: 35,
        orgName: '战略发展部',
        orgType: 'admin',
        roles: ['ROLE_REPORTER', 42, '']
      }
    ])

    expect(normalized).toEqual([
      {
        sysUserId: 44,
        orgId: 44,
        orgName: '教务处',
        orgType: 'functional',
        roles: ['ROLE_APPROVER'],
        slot: 1
      },
      {
        sysUserId: 188,
        orgId: 35,
        orgName: '战略发展部',
        orgType: 'admin',
        roles: ['ROLE_REPORTER'],
        slot: 2
      }
    ])
  })

  it('透传 realName：每个席位带上自己的姓名，缺省或空白不落键', () => {
    const normalized = normalizeIdentities([
      {
        sysUserId: 44,
        orgId: 44,
        orgName: '教务处',
        orgType: 'functional',
        roles: ['ROLE_APPROVER'],
        slot: 2,
        realName: '李红'
      },
      {
        sysUserId: 188,
        orgId: 35,
        orgName: '战略发展部',
        orgType: 'admin',
        roles: ['ROLE_REPORTER'],
        slot: 1,
        realName: '  '
      },
      { sysUserId: 66, orgId: 1, orgName: '科技处', orgType: 'academic', roles: [] }
    ])

    // 姓名逐条对应各自的席位，供身份菜单显示各身份自己的姓名
    expect(normalized.map(item => item.realName)).toEqual([undefined, '李红', undefined])
    expect('realName' in normalized[0]).toBe(false)
    expect('realName' in normalized[2]).toBe(false)
    expect(normalized[1].realName).toBe('李红')
  })

  it('非数组一律视为没有身份列表', () => {
    expect(normalizeIdentities(undefined)).toEqual([])
    expect(normalizeIdentities(null)).toEqual([])
    expect(normalizeIdentities('identities')).toEqual([])
  })

  it('是否多身份：2 个及以上才算', () => {
    expect(hasMultipleIdentities([])).toBe(false)
    expect(hasMultipleIdentities([strategicIdentity])).toBe(false)
    expect(hasMultipleIdentities([strategicIdentity, academicAffairsIdentity])).toBe(true)
    expect(hasMultipleIdentities(null)).toBe(false)
  })

  it('按当前登录账号找到对应席位，找不到返回 null', () => {
    const identities = [strategicIdentity, academicAffairsIdentity]

    expect(resolveCurrentIdentity(identities, { userId: 44 })).toBe(academicAffairsIdentity)
    expect(resolveCurrentIdentity(identities, { userId: 999 })).toBeNull()
    expect(resolveCurrentIdentity([], { userId: 44 })).toBeNull()
    expect(resolveCurrentIdentity(identities, null)).toBeNull()
  })
})

describe('从登录 / 切换响应提取身份上下文', () => {
  const identities = [strategicIdentity, academicAffairsIdentity]

  it('带 data 包装的响应（apiClient 归一化后的形态）', () => {
    expect(
      extractIdentityContext({
        success: true,
        code: 200,
        data: { token: 't', user: { userId: 44 }, identities, dingTalkUserId: 'dd-001' }
      })
    ).toEqual({ identities, dingTalkUserId: 'dd-001' })
  })

  it('不带 data 包装的响应', () => {
    expect(extractIdentityContext({ token: 't', identities, dingTalkUserId: 'dd-001' })).toEqual({
      identities,
      dingTalkUserId: 'dd-001'
    })
  })

  it('dingTalkUserId 兜底取 user.dingTalkUserId', () => {
    expect(extractIdentityContext({ data: { user: { dingTalkUserId: 'dd-002' } } })).toEqual({
      identities: [],
      dingTalkUserId: 'dd-002'
    })
  })

  it('identities / dingTalkUserId 缺失时返回空值而不报错（可选契约）', () => {
    expect(
      extractIdentityContext({ success: true, data: { token: 't', user: { userId: 1 } } })
    ).toEqual({ identities: [], dingTalkUserId: null })
    expect(extractIdentityContext(undefined)).toEqual({ identities: [], dingTalkUserId: null })
    expect(extractIdentityContext('nope')).toEqual({ identities: [], dingTalkUserId: null })
  })

  it('响应里的身份列表同样做归一化：按槽位排序、丢弃脏数据', () => {
    const context = extractIdentityContext({
      data: { identities: [academicAffairsIdentity, { sysUserId: 'x' }, strategicIdentity] }
    })

    expect(context.identities.map(item => item.sysUserId)).toEqual([188, 44])
  })
})

describe('登录账号自身的身份文案', () => {
  const currentUser = {
    userId: 44,
    department: '教务处',
    orgName: '教务处',
    roles: ['ROLE_APPROVER']
  }

  it('登录账号自身的「部门 · 角色」', () => {
    expect(formatUserIdentityTitle(currentUser)).toBe('教务处 · 审核人')
    expect(formatUserIdentityTitle({ department: '', orgName: '教务处', roles: [] })).toBe('教务处')
    expect(formatUserIdentityTitle(null)).toBe('')
  })
})
