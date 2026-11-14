/**
 * 2026-11-05（issue #96 第一部分）：学院下发入口口径单测。
 *
 * 覆盖三件事，都是"改错了不会报错、只会静默放宽"的那类：
 * 1. 战略部**不可见**「指标下发与审批」页 —— 且把顶部部门切换器切到职能部门视角也不行；
 * 2. 职能部门**仍能进**该页（保留审批处理与撤回，1.4 开放口径采纳"保留"）；
 * 3. 导航配置里战略部不再出现该 tab，职能部门仍保留。
 */
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { resolveProtectedRouteRedirect } from '@/app/providers/lib/routeAccess'
import { useNavigation } from '@/shared/lib/layout/useNavigation'

describe('routeAccess · /distribution 对战略部彻底关闭（issue #96 · 1.2/N1）', () => {
  const base = {
    isAuthenticated: true,
    requiresAuth: true,
    path: '/distribution',
    allowedRoles: ['functional_dept'],
    deniedLoginRoles: ['strategic_dept']
  }

  it('战略部登录（视角=战略部）被重定向走', () => {
    expect(
      resolveProtectedRouteRedirect({
        ...base,
        userRole: 'strategic_dept',
        effectiveRole: 'strategic_dept'
      })
    ).toBe('/dashboard')
  })

  it('战略部把视角切到职能部门后，仍然被重定向走（此前会因超级角色规则放行）', () => {
    expect(
      resolveProtectedRouteRedirect({
        ...base,
        userRole: 'strategic_dept',
        effectiveRole: 'functional_dept'
      })
    ).toBe('/dashboard')
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

describe('useNavigation · 战略部导航不再出现下发页（issue #96 · 1.2）', () => {
  const tabsFor = (
    viewing: 'strategic_dept' | 'functional_dept',
    login?: 'strategic_dept' | 'functional_dept'
  ) => {
    const navigation = useNavigation<never>(
      ref(viewing) as never,
      login ? (ref(login) as never) : undefined
    )
    return navigation.tabs.value
  }

  it('战略部登录的导航里没有「指标下发与审批」', () => {
    const tabs = tabsFor('strategic_dept', 'strategic_dept')
    expect(tabs.some(tab => tab.path === '/distribution')).toBe(false)
    expect(tabs.some(tab => tab.path === '/strategic-tasks')).toBe(true)
  })

  it('战略部切到职能部门视角后，并集也不会把下发页带回来', () => {
    const tabs = tabsFor('functional_dept', 'strategic_dept')
    expect(tabs.some(tab => tab.path === '/distribution')).toBe(false)
  })

  it('职能部门的导航里仍保留「指标下发与审批」（撤回入口唯一所在页）', () => {
    const tabs = tabsFor('functional_dept', 'functional_dept')
    expect(tabs.some(tab => tab.path === '/distribution')).toBe(true)
  })
})
