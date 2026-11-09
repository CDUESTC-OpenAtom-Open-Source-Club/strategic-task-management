import type { UserRole } from '@/shared/types'

interface RouteAccessInput {
  allowedRoles?: string[]
  /**
   * 2026-11-05（issue #96 · 1.2/N1）：按**登录角色**彻底关闭的路由。
   *
   * <p>为什么需要它：下面第 42 行有一条既有的「战略部登录 → 直接放行所有带 roles 的路由」
   * 的超级角色规则（战略部可进任何页面）。但本次改造要求战略部**不可见**「指标下发与审批」页，
   * 而该页的 roles 判定用的是「视角角色」——战略部把顶部部门切换器切到职能部门后
   * 仍能进入该页并拿到全部写按钮，等于绕开导航限制。
   * 黑名单按登录角色判定，不受视角切换影响。
   */
  deniedLoginRoles?: string[]
  effectiveRole?: UserRole | null
  hasAdminConsoleAccess?: boolean
  isAuthenticated: boolean
  path: string
  requiresAuth: boolean
  userRole?: UserRole | null
}

export function resolveProtectedRouteRedirect({
  allowedRoles,
  deniedLoginRoles,
  effectiveRole,
  hasAdminConsoleAccess,
  isAuthenticated,
  path,
  requiresAuth,
  userRole
}: RouteAccessInput): string | null {
  if (requiresAuth && !isAuthenticated) {
    return '/login'
  }

  if (!requiresAuth || !isAuthenticated) {
    return null
  }

  if (!userRole) {
    return '/login'
  }

  // 登录角色黑名单优先于一切 roles 判定（含下面的战略部超级角色放行）
  if (deniedLoginRoles?.length && deniedLoginRoles.includes(userRole)) {
    return '/dashboard'
  }

  if (!allowedRoles?.length) {
    return null
  }

  if (path.startsWith('/admin')) {
    return hasAdminConsoleAccess ? null : '/403'
  }

  if (userRole === 'strategic_dept') {
    return null
  }

  if (!effectiveRole) {
    return '/login'
  }

  if (allowedRoles.includes(effectiveRole)) {
    return null
  }

  return path.startsWith('/admin') ? '/403' : '/dashboard'
}
