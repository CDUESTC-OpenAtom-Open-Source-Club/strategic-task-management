import { describe, expect, it } from 'vitest'
import { resolveProtectedRouteRedirect } from '@/app/providers/lib/routeAccess'

describe('resolveProtectedRouteRedirect', () => {
  it('redirects unauthenticated users on protected routes', () => {
    expect(
      resolveProtectedRouteRedirect({
        requiresAuth: true,
        isAuthenticated: false,
        userRole: null,
        effectiveRole: null,
        path: '/dashboard'
      })
    ).toBe('/login')
  })

  it('redirects authenticated users with missing roles back to login', () => {
    expect(
      resolveProtectedRouteRedirect({
        requiresAuth: true,
        isAuthenticated: true,
        userRole: null,
        effectiveRole: null,
        path: '/dashboard'
      })
    ).toBe('/login')
  })

  it('sends non-admin users away from admin-only routes', () => {
    expect(
      resolveProtectedRouteRedirect({
        requiresAuth: true,
        isAuthenticated: true,
        userRole: 'functional_dept',
        effectiveRole: 'functional_dept',
        allowedRoles: ['strategic_dept'],
        path: '/admin/console'
      })
    ).toBe('/403')
  })

  it('allows strategic department users through role-guarded routes', () => {
    expect(
      resolveProtectedRouteRedirect({
        requiresAuth: true,
        isAuthenticated: true,
        userRole: 'strategic_dept',
        effectiveRole: 'strategic_dept',
        allowedRoles: ['strategic_dept'],
        path: '/strategic-tasks'
      })
    ).toBeNull()
  })
})

describe('resolveProtectedRouteRedirect · 切换器视角判定（2026-11-24 视角跟随修复）', () => {
  const strategicTasksRoute = {
    requiresAuth: true,
    isAuthenticated: true,
    // 与 router.ts 中 /strategic-tasks 的 meta.roles 保持一致
    allowedRoles: ['strategic_dept', 'functional_dept'],
    path: '/strategic-tasks'
  }

  it('无视角的战略部访问 /strategic-tasks 保持放行（超角色规则不变）', () => {
    expect(
      resolveProtectedRouteRedirect({
        ...strategicTasksRoute,
        userRole: 'strategic_dept',
        effectiveRole: 'strategic_dept'
      })
    ).toBeNull()
  })

  it('视角=functional_dept 访问 /strategic-tasks 只读放行（职能直闯只读是既有设计）', () => {
    expect(
      resolveProtectedRouteRedirect({
        ...strategicTasksRoute,
        userRole: 'strategic_dept',
        effectiveRole: 'functional_dept'
      })
    ).toBeNull()
  })

  it('视角=secondary_college 访问 /strategic-tasks 被弹回（与学院直登一致）', () => {
    expect(
      resolveProtectedRouteRedirect({
        ...strategicTasksRoute,
        userRole: 'strategic_dept',
        effectiveRole: 'secondary_college'
      })
    ).toBe('/dashboard')
  })

  it('学院角色不受战略部视角分支影响，仍按 roles 判定', () => {
    expect(
      resolveProtectedRouteRedirect({
        ...strategicTasksRoute,
        userRole: 'secondary_college',
        effectiveRole: 'secondary_college'
      })
    ).toBe('/dashboard')
  })
})
