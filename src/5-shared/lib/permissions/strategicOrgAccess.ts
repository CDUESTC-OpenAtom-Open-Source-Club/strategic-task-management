/**
 * 战略发展部组织维度判定
 *
 * 2026-11-24（v1.5.4 登录回归修复）：「战略发展部账号」的判定口径从
 * 「拥有 strategic_dept 角色码」修正为「属于战略发展部组织」——
 * 战略部组织（orgId=35）的账号可以只挂业务角色码（如 ROLE_REPORTER），
 * 按角色码判定会把这类账号漏出超角色放行，导致登录后被守卫弹回。
 *
 * 2026-11-24（返修·身份两层模型）：orgId=35 的载荷可能缺 orgType 且角色码
 * 不可映射（线上 zlb_admin 实证），**认证解析层（responseParser）不再做角色归一**
 * ——API 数据层身份保持后端真实角色（接口调用集合与 v1.5.3 一致，@PreAuthorize 不拒）；
 * 导航/路由层身份（守卫放行、tabs、切换器、默认落地）统一经 resolveEffectiveLoginRole
 * 按**组织维度**归一为 strategic_dept 语义。本模块是组织维度归一的**唯一实现**，
 * 各导航层消费方（router 守卫 / useNavigation / useDepartmentSwitcher / useAppLayout）
 * 一律经由它取登录身份，不得各自再写组织判定。
 */
import type { User, UserRole } from '@/shared/types'
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

/**
 * 导航/路由层登录身份（唯一归一入口）。
 *
 * 战略发展部组织的账号（无论角色码解析结果如何，含解析失败为 null）按
 * strategic_dept 语义放行导航与守卫；其余账号维持登录角色码原样
 * （null 原样返回，由守卫按无角色处理）。
 *
 * 只供导航/路由层使用；API 数据层身份一律取 authStore.user 真实解析结果，
 * 不经本函数（两层身份模型，见文件头注）。
 */
export function resolveEffectiveLoginRole(
  user: Pick<User, 'orgType' | 'orgId'> | null | undefined,
  loginRole: UserRole | null | undefined
): UserRole | null {
  if (loginRole === 'strategic_dept' || isStrategicOrgAccount(user)) {
    return 'strategic_dept'
  }
  return (loginRole ?? null) as UserRole | null
}
