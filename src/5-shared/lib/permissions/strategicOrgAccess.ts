/**
 * 战略发展部组织维度判定
 *
 * 2026-11-24（v1.5.4 登录回归修复）：「战略发展部账号」的判定口径从
 * 「拥有 strategic_dept 角色码」修正为「属于战略发展部组织」——
 * 战略部组织（orgId=35）的账号可以只挂业务角色码（如 ROLE_REPORTER），
 * 按角色码判定会把这类账号漏出超角色放行，导致登录后被守卫弹回。
 */
import type { User } from '@/shared/types'
import { isAdminOrgType } from './adminConsoleAccess'

/**
 * 战略发展部组织的固定 orgId。
 *
 * sys_org 种子与生产一致：org 35 = 战略发展部，type='admin'，
 * 是全部职能组织（36+，type='functional'）的父组织。
 */
export const STRATEGIC_DEPT_ORG_ID = 35

/** orgId 是否为战略发展部组织（容忍 string/number 双形态，见 User.orgId） */
export function isStrategicOrgId(orgId: unknown): boolean {
  return Number(orgId) === STRATEGIC_DEPT_ORG_ID
}

/**
 * 用户是否属于战略发展部组织（组织维度，与角色码解耦）。
 *
 * 判定顺序：
 * 1. orgType=admin（既有 isAdminOrgType 口径，org 35 的种子类型）；
 * 2. orgId=35 兜底——覆盖后端载荷缺失 orgType 的场景
 *    （v1.5.4 线上 zlb_admin 登录回归：角色码 ROLE_REPORTER 无法映射前端角色，
 *    组织维度判定保证战略部组织账号不被弹回）。
 */
export function isStrategicOrgAccount(
  user: Pick<User, 'orgType' | 'orgId'> | null | undefined
): boolean {
  if (isAdminOrgType(user?.orgType)) {
    return true
  }
  return isStrategicOrgId(user?.orgId)
}
