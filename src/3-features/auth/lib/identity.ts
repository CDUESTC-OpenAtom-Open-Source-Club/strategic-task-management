/**
 * 多身份：身份列表的解析与展示文案（纯函数）。
 *
 * 身份 = 同一钉钉账号绑定的一个部门席位（一个 sys_user 行，有自己的 orgId + 角色）。
 * 切换身份 = 换 token 到另一个账号，状态流转见 model/store.ts 的 switchIdentity。
 * 本模块不碰 store / router / DOM，只做数据整形，便于单测。
 */

import type { IdentityDTO } from '../api/types'
import type { User } from '@/shared/types'

/** 槽位展示文案：1 = 一号（默认），2 = 二号；3 及以后按数字顺延 */
const SLOT_LABELS: Record<number, string> = { 1: '一号', 2: '二号' }

/** 角色码 → 展示名，与后端 sys_role 的角色名一致 */
const ROLE_CODE_LABELS: Record<string, string> = {
  ROLE_REPORTER: '填报人',
  ROLE_APPROVER: '审核人',
  ROLE_STRATEGY_DEPT_HEAD: '战略发展部负责人',
  ROLE_VICE_PRESIDENT: '分管校领导',
  ROLE_SYSTEM_ADMIN: '系统管理员'
}

const ROLE_CODE_PREFIX = 'ROLE_'

/** 登录/切换响应里与多身份相关的可选字段 */
export interface IdentityContext {
  identities: IdentityDTO[]
  /** 当前钉钉账号的用户 ID；后端未下发时为 null */
  dingTalkUserId: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 槽位 → 「一号 / 二号」；槽位非法时返回空串 */
export function getIdentitySlotLabel(slot: number | null | undefined): string {
  const value = Number(slot)
  if (!Number.isInteger(value) || value < 1) {
    return ''
  }
  return SLOT_LABELS[value] ?? `${value}号`
}

/** 角色码 → 展示名；未收录的角色码去掉 ROLE_ 前缀原样展示 */
export function getIdentityRoleLabel(roleCode: string | null | undefined): string {
  const code = toText(roleCode)
  if (!code) {
    return ''
  }
  const knownLabel = ROLE_CODE_LABELS[code]
  if (knownLabel) {
    return knownLabel
  }
  return code.startsWith(ROLE_CODE_PREFIX) ? code.slice(ROLE_CODE_PREFIX.length) || code : code
}

/** 角色码列表 → 「填报人 / 审核人」 */
export function formatIdentityRoles(roles: readonly string[] | null | undefined): string {
  if (!Array.isArray(roles)) {
    return ''
  }
  const labels = roles.map(getIdentityRoleLabel).filter(Boolean)
  return Array.from(new Set(labels)).join(' / ')
}

/** 「部门 · 角色」；角色为空时只有部门 */
export function formatIdentityTitle(identity: Pick<IdentityDTO, 'orgName' | 'roles'>): string {
  return [toText(identity?.orgName), formatIdentityRoles(identity?.roles)]
    .filter(Boolean)
    .join(' · ')
}

/**
 * 「部门 · 角色」
 *
 * 2026-11-28 用户定：界面上不出现「一号/二号」槽位文案——身份列表与切换过场都只显示
 * 部门与角色，槽位号仅作数据层排序依据。槽位文案渲染随身份菜单一并移除。
 */
export function formatIdentityLabel(identity: Pick<IdentityDTO, 'orgName' | 'roles'>): string {
  return formatIdentityTitle(identity)
}

/** 按槽位排序（slot 相同按 sysUserId），不改动入参 */
export function sortIdentities<T extends Pick<IdentityDTO, 'sysUserId' | 'slot'>>(
  identities: readonly T[]
): T[] {
  return [...identities].sort(
    (left, right) => left.slot - right.slot || left.sysUserId - right.sysUserId
  )
}

/** 只有绑定 2 个及以上席位才展示多身份 UI（角标 / 身份列表） */
export function hasMultipleIdentities(identities: readonly unknown[] | null | undefined): boolean {
  return Array.isArray(identities) && identities.length > 1
}

/** 当前登录账号对应的席位；列表里没有当前账号时返回 null */
export function resolveCurrentIdentity(
  identities: readonly Pick<IdentityDTO, 'sysUserId'>[] | null | undefined,
  user: Pick<User, 'userId'> | null | undefined
): IdentityDTO | null {
  const userId = Number(user?.userId)
  if (!userId || !Array.isArray(identities)) {
    return null
  }
  return identities.find(identity => Number(identity.sysUserId) === userId) ?? null
}

/**
 * 校验并归一化后端下发的身份列表：丢弃缺 sysUserId 的条目、按 sysUserId 去重、按槽位排序。
 * 非数组一律视为「没有身份列表」，不抛错——该字段是可选契约。
 */
export function normalizeIdentities(value: unknown): IdentityDTO[] {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<number>()
  const result: IdentityDTO[] = []

  value.forEach(item => {
    if (!isRecord(item)) {
      return
    }
    const sysUserId = Number(item.sysUserId)
    if (!Number.isInteger(sysUserId) || sysUserId <= 0 || seen.has(sysUserId)) {
      return
    }
    seen.add(sysUserId)

    const slot = Number(item.slot)
    const identity: IdentityDTO = {
      sysUserId,
      orgId: Number(item.orgId) || 0,
      orgName: toText(item.orgName),
      orgType: toText(item.orgType),
      roles: Array.isArray(item.roles)
        ? item.roles.filter(
            (role): role is string => typeof role === 'string' && role.trim() !== ''
          )
        : [],
      // 后端漏发 slot 时按已接受条目的顺序补位，保证每个席位都有槽位文案
      slot: Number.isInteger(slot) && slot >= 1 ? slot : result.length + 1
    }
    // 姓名可选下发（旧版后端没有）；缺省时不落键，避免造出 realName: undefined 的脏数据
    const realName = toText(item.realName)
    if (realName) {
      identity.realName = realName
    }
    result.push(identity)
  })

  return sortIdentities(result)
}

/**
 * 从登录 / 切换身份响应里提取 identities 与 dingTalkUserId。
 *
 * 两者都是可选字段：账号密码登录、旧版后端不会下发，此时返回空列表 / null，
 * 由上层决定是否展示多身份入口。响应可能带一层 data 包装，两处都取。
 */
export function extractIdentityContext(response: unknown): IdentityContext {
  const root = isRecord(response) ? response : {}
  const nested = isRecord(root.data) ? root.data : null
  const user = isRecord(root.user) ? root.user : isRecord(nested?.user) ? nested.user : null

  const rawDingTalkUserId = root.dingTalkUserId ?? nested?.dingTalkUserId ?? user?.dingTalkUserId

  return {
    identities: normalizeIdentities(root.identities ?? nested?.identities),
    dingTalkUserId: toText(rawDingTalkUserId) || null
  }
}

/** 当前登录账号自己的「部门 · 角色」，用于身份列表里找不到当前账号时的兜底 */
export function formatUserIdentityTitle(
  user: Pick<User, 'department' | 'orgName' | 'roles'> | null | undefined
): string {
  return formatIdentityTitle({
    orgName: toText(user?.department) || toText(user?.orgName),
    roles: Array.isArray(user?.roles) ? user.roles : []
  })
}
