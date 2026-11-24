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

  // 2026-11-24（返修·身份两层模型）：zlb_admin（REPORTER@35）链路核查——
  // API 数据层身份（mapBackendUser 解析结果）与导航层身份（resolveEffectiveLoginRole
  // 组织维度归一）解耦：载荷带 orgType=admin 时解析为 strategic_dept（本地形态）；
  // 载荷缺 orgType 时解析为 null（不归一，否则 UI 按战略部调用全量接口集合会被
  // @PreAuthorize 拒绝刷 403）——但导航层仍按组织维度给出战略部导航组。
  describe('zlb_admin（REPORTER@35）两层身份组合链路', () => {
    const zlbAdminPayload = (orgType?: string) => ({
      userId: 188,
      username: 'zlb_admin',
      realName: '战略部管理员',
      roles: ['ROLE_REPORTER'],
      orgId: 35,
      orgName: '战略发展部',
      ...(orgType ? { orgType } : {})
    })
    const tabsForUser = (
      viewing: UserRole | null,
      user: ReturnType<typeof zlbAdminPayload> | null
    ) => {
      const loginRole = (mapBackendUser(user as Record<string, unknown>)?.role ??
        null) as UserRole | null
      const navigation = useNavigation<never>(
        ref(viewing) as never,
        ref(loginRole) as never,
        ref(user) as never
      )
      return navigation.tabs.value
    }

    it('本地载荷形态（orgType=admin）：解析=strategic_dept，无视角导航=战略部组', () => {
      const user = zlbAdminPayload('admin')
      expect(mapBackendUser(user as Record<string, unknown>)?.role).toBe('strategic_dept')
      expect(tabsForUser(null, user).map(tab => tab.id)).toEqual(['dashboard', 'strategic'])
    })

    it('载荷缺 orgType（线上形态）：解析不归一，导航层仍按组织维度=战略部组', () => {
      const user = zlbAdminPayload()
      expect(mapBackendUser(user as Record<string, unknown>)).toBeNull()
      expect(tabsForUser(null, user).map(tab => tab.id)).toEqual(['dashboard', 'strategic'])
    })

    it('切教务处视角=[看板/填报/审批]，切学院视角=[看板/填报]，切回恢复战略部组（两种载荷形态一致）', () => {
      for (const user of [zlbAdminPayload('admin'), zlbAdminPayload()]) {
        expect(tabsForUser('functional_dept', user).map(tab => tab.id)).toEqual([
          'dashboard',
          'indicators',
          'distribution'
        ])
        expect(tabsForUser('secondary_college', user).map(tab => tab.id)).toEqual([
          'dashboard',
          'indicators'
        ])
        expect(tabsForUser('strategic_dept', user).map(tab => tab.id)).toEqual([
          'dashboard',
          'strategic'
        ])
      }
    })
  })
})
