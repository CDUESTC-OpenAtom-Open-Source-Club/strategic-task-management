import type { UserRole } from '@/shared/types'

interface RouteAccessInput {
  allowedRoles?: string[]
  effectiveRole?: UserRole | null
  hasAdminConsoleAccess?: boolean
  isAuthenticated: boolean
  path: string
  requiresAuth: boolean
  userRole?: UserRole | null
}

export function resolveProtectedRouteRedirect({
  allowedRoles,
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

  if (!allowedRoles?.length) {
    return null
  }

  if (path.startsWith('/admin')) {
    return hasAdminConsoleAccess ? null : '/403'
  }

  // 2026-11-24（切换器视角跟随修复）：战略部登录的分角色判定。
  //
  // 无视角（effectiveRole 即登录角色）：保持既有「战略部登录超角色放行一切」，
  // 战略部可进任何带 roles 的页面。
  //
  // 有视角（顶部部门切换器切到职能部门 / 学院）：按**视角角色**的路由权限判定，
  // 与该角色账号直登完全一致——
  // - 视角=functional_dept：/strategic-tasks（roles 含 functional_dept）只读放行（既有设计），
  //   /distribution（roles=functional_dept）放行（指标审批深链）；
  // - 视角=secondary_college：直闯 /strategic-tasks 弹回，与学院账号直登一致。
  if (userRole === 'strategic_dept') {
    if (!effectiveRole || effectiveRole === userRole) {
      return null
    }
    return allowedRoles.includes(effectiveRole) ? null : '/dashboard'
  }

  if (!effectiveRole) {
    return '/login'
  }

  if (allowedRoles.includes(effectiveRole)) {
    return null
  }

  return path.startsWith('/admin') ? '/403' : '/dashboard'
}
