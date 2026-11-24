/**
 * 2026-11-24（切换器视角跟随修复）：导航 tabs 视角单源矩阵单测。
 *
 * 修复前：tabs = 「登录角色组 ∪ 视角角色组」并集 − 登录角色黑名单，
 * 战略部用顶部切换器切到职能部门后导航仍残留「战略任务管理」。
 * 修复后：viewingRole 非空时 tabs = ROLE_BASED_TABS[viewingRole]，
 * 与该角色账号直登的导航形态**完全一致**；viewingRole 为空时回退登录角色组。
 *
 * 基线（代码声明 = 真机一致）：
 * - strategic_dept：[数据看板, 战略任务管理]
 * - functional_dept：[数据看板, 指标填报, 指标审批]
 * - secondary_college：[数据看板, 指标填报]
 */
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useNavigation } from '@/shared/lib/layout/useNavigation'
import { mapBackendUser } from '@/shared/lib/utils/authHelpers/responseParser'
import type { UserRole } from '@/shared/types'

const tabsFor = (viewing: UserRole | null, login: UserRole | null) => {
  const navigation = useNavigation<never>(ref(viewing) as never, ref(login) as never)
  return navigation.tabs.value
}

describe('useNavigation · tabs 视角单源矩阵（2026-11-24）', () => {
  it('无视角：三角色各自 tabs = 各自登录角色组', () => {
    expect(tabsFor(null, 'strategic_dept').map(tab => tab.id)).toEqual(['dashboard', 'strategic'])
    expect(tabsFor(null, 'functional_dept').map(tab => tab.id)).toEqual([
      'dashboard',
      'indicators',
      'distribution'
    ])
    expect(tabsFor(null, 'secondary_college').map(tab => tab.id)).toEqual([
      'dashboard',
      'indicators'
    ])
  })

  it('战略部登录 + 视角=functional_dept：导航与职能部门直登完全一致', () => {
    const tabs = tabsFor('functional_dept', 'strategic_dept')
    expect(tabs.map(tab => tab.id)).toEqual(['dashboard', 'indicators', 'distribution'])
    expect(tabs.some(tab => tab.path === '/strategic-tasks')).toBe(false)
    expect(tabs.find(tab => tab.id === 'distribution')?.path).toBe('/distribution')
  })

  it('战略部登录 + 视角=secondary_college：导航与学院直登完全一致', () => {
    const tabs = tabsFor('secondary_college', 'strategic_dept')
    expect(tabs.map(tab => tab.id)).toEqual(['dashboard', 'indicators'])
    expect(tabs.some(tab => tab.path === '/strategic-tasks')).toBe(false)
    expect(tabs.some(tab => tab.path === '/distribution')).toBe(false)
  })

  it('视角=战略部（未切换或切回本部门）：保持战略部三件套口径（无审批页）', () => {
    const tabs = tabsFor('strategic_dept', 'strategic_dept')
    expect(tabs.map(tab => tab.id)).toEqual(['dashboard', 'strategic'])
    expect(tabs.some(tab => tab.path === '/distribution')).toBe(false)
  })

  it('视角=null 回登录角色组（store 未恢复时不闪空）', () => {
    expect(tabsFor(null, 'functional_dept').map(tab => tab.id)).toEqual([
      'dashboard',
      'indicators',
      'distribution'
    ])
  })

  it('视角与登录角色均为 null：tabs 为空数组', () => {
    expect(tabsFor(null, null)).toEqual([])
  })

  // 2026-11-24（v1.5.4 登录回归修复）同族核查：zlb_admin（REPORTER@35）登录时，
  // responseParser 按「战略发展部组织」口径兜底解析出 strategic_dept（见
  // responseParser.ts 组织维度兜底），authStore.userRole 随之正确，
  // useNavigation 的登录角色推导不需要再补组织维度——此处用
  // 「mapBackendUser → 登录角色 → tabs」的组合用例钉住该链路。
  describe('zlb_admin（REPORTER@35）组合链路', () => {
    const zlbAdminLoginRole = () => {
      const user = mapBackendUser({
        userId: 188,
        username: 'zlb_admin',
        realName: '战略部管理员',
        role: 'ROLE_REPORTER',
        roles: ['ROLE_REPORTER'],
        orgId: 35,
        orgName: '战略发展部'
      })
      return (user?.role ?? null) as UserRole | null
    }

    it('角色解析兜底为 strategic_dept，无视角导航=战略部组（数据看板/战略任务管理）', () => {
      expect(zlbAdminLoginRole()).toBe('strategic_dept')
      expect(tabsFor(null, zlbAdminLoginRole()).map(tab => tab.id)).toEqual([
        'dashboard',
        'strategic'
      ])
    })

    it('切教务处视角=[看板/填报/审批]，切学院视角=[看板/填报]，切回恢复战略部组', () => {
      const login = zlbAdminLoginRole()
      expect(tabsFor('functional_dept', login).map(tab => tab.id)).toEqual([
        'dashboard',
        'indicators',
        'distribution'
      ])
      expect(tabsFor('secondary_college', login).map(tab => tab.id)).toEqual([
        'dashboard',
        'indicators'
      ])
      expect(tabsFor('strategic_dept', login).map(tab => tab.id)).toEqual([
        'dashboard',
        'strategic'
      ])
    })
  })
})
