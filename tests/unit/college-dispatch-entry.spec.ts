/**
 * 「指标审批」（/distribution）入口口径单测。
 *
 * 2026-11-24（切换器视角跟随修复）新口径：路由与导航完全按**视角角色**判定，
 * 与该角色账号直登完全一致——
 * 1. 战略部直登（无视角）：保持既有超角色放行（守卫口径不变），
 *    但导航无本页入口，正常使用不可达；
 * 2. 战略部视角=职能部门：导航出现本页入口，URL 直闯放行（审批深链可用）；
 * 3. 职能部门直登：仍保留本页（审批处理与撤回入口唯一所在页）。
 *
 * 旧口径（2026-11-05 issue #96 · 1.2/N1 的登录角色黑名单 deniedLoginRoles +
 * 导航并集）已随切换器视角跟随修复一并移除。
 */
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { resolveProtectedRouteRedirect } from '@/app/providers/lib/routeAccess'
import { useNavigation } from '@/shared/lib/layout/useNavigation'

describe('routeAccess · /distribution 按视角角色判定（2026-11-24）', () => {
  const base = {
    isAuthenticated: true,
    requiresAuth: true,
    path: '/distribution',
    allowedRoles: ['functional_dept']
  }

  it('战略部直登（无视角）保持超角色放行（守卫口径不变，导航无入口故正常使用不可达）', () => {
    expect(
      resolveProtectedRouteRedirect({
        ...base,
        userRole: 'strategic_dept',
        effectiveRole: 'strategic_dept'
      })
    ).toBeNull()
  })

  it('战略部视角=职能部门后放行（与职能部门直登一致，审批深链可用）', () => {
    expect(
      resolveProtectedRouteRedirect({
        ...base,
        userRole: 'strategic_dept',
        effectiveRole: 'functional_dept'
      })
    ).toBeNull()
  })

  it('职能部门正常进入（保留审批处理与撤回）', () => {
    expect(
      resolveProtectedRouteRedirect({
        ...base,
        userRole: 'functional_dept',
        effectiveRole: 'functional_dept'
      })
    ).toBeNull()
  })

  it('战略部视角=学院同样不放行', () => {
    expect(
      resolveProtectedRouteRedirect({
        ...base,
        userRole: 'strategic_dept',
        effectiveRole: 'secondary_college'
      })
    ).toBe('/dashboard')
  })

  it('战略部组织账号（orgId=35，角色码 ROLE_REPORTER）视角=职能部门放行（返修口径：上游已归一 userRole）', () => {
    expect(
      resolveProtectedRouteRedirect({
        ...base,
        userRole: 'strategic_dept',
        effectiveRole: 'functional_dept'
      })
    ).toBeNull()
  })

  it('未登录仍先去登录页', () => {
    expect(
      resolveProtectedRouteRedirect({
        ...base,
        isAuthenticated: false,
        userRole: null,
        effectiveRole: null
      })
    ).toBe('/login')
  })
})

describe('useNavigation · 「指标审批」入口跟随视角角色（2026-11-24）', () => {
  const tabsFor = (
    viewing: 'strategic_dept' | 'functional_dept' | null,
    login?: 'strategic_dept' | 'functional_dept'
  ) => {
    const navigation = useNavigation<never>(
      (viewing === null ? ref(null) : ref(viewing)) as never,
      login ? (ref(login) as never) : undefined
    )
    return navigation.tabs.value
  }

  it('战略部登录（无视角）的导航里没有「指标审批」', () => {
    const tabs = tabsFor('strategic_dept', 'strategic_dept')
    expect(tabs.some(tab => tab.path === '/distribution')).toBe(false)
    expect(tabs.some(tab => tab.path === '/strategic-tasks')).toBe(true)
  })

  it('战略部切到职能部门视角后，导航与职能部门直登完全一致（含「指标审批」）', () => {
    const tabs = tabsFor('functional_dept', 'strategic_dept')
    expect(tabs.map(tab => tab.id)).toEqual(['dashboard', 'indicators', 'distribution'])
  })

  it('职能部门的导航里仍保留「指标审批」（撤回入口唯一所在页）', () => {
    const tabs = tabsFor('functional_dept', 'functional_dept')
    expect(tabs.some(tab => tab.path === '/distribution')).toBe(true)
  })
})
