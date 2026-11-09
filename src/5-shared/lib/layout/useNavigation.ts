/**
 * useNavigation - 导航管理 Composable
 *
 * 职责:
 * - 管理标签页配置
 * - 处理标签页导航
 * - 计算当前激活标签
 *
 * @module composables/layout
 */

import { computed, type ComputedRef } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import type { UserRole } from '@/shared/types'
import type { Component } from 'vue'
import { DataAnalysis, Document as _Document, Edit, List, Promotion } from '@element-plus/icons-vue'

/** 标签页配置接口 */
export interface TabConfig {
  id: string
  label: string
  icon: Component
  path: string
}

/**
 * 2026-11-05（issue #96 · 1.2）：按**登录角色**彻底隐藏的导航项。
 *
 * <p>为什么不能只靠 ROLE_BASED_TABS 的移除：tabs 取「登录角色组 ∪ 视角角色组」的并集，
 * 战略发展部把顶部部门切换器切到职能部门视角后，视角组会把「指标下发与审批」并回来。
 * 该页的写功能已全部迁到「战略任务管理 → 二级学院页签」，战略部没有理由再看到它。
 *
 * <p>判定用登录角色（不受视角切换影响），与路由层 deniedLoginRoles 同一口径。
 */
const HIDDEN_TABS_BY_LOGIN_ROLE: Partial<Record<UserRole, string[]>> = {
  strategic_dept: ['distribution']
}

/** 基于角色的页面配置 */
const ROLE_BASED_TABS: Record<UserRole, TabConfig[]> = {
  strategic_dept: [
    { id: 'dashboard', label: '数据看板', icon: DataAnalysis, path: '/dashboard' },
    // 2026-11-05（issue #96 · 1.2）：战略发展部**不出现**「指标下发与审批」入口。
    // 学院指标下发的全部操作（导入 / 下载模板 / 导出 / 发起下发审批）已迁到
    // 「战略任务管理 → 二级学院页签」，本页对战略部已无用途。
    { id: 'strategic', label: '战略任务管理', icon: List, path: '/strategic-tasks' }
  ],
  functional_dept: [
    { id: 'dashboard', label: '数据看板', icon: DataAnalysis, path: '/dashboard' },
    { id: 'indicators', label: '指标填报', icon: Edit, path: '/indicators' },
    // 2026-11-05（issue #96 · 1.2）：职能部门**保留**本页 —— 页面内下发相关写功能
    // （导入 / 复制其他学院指标 / 新增指标 / 下发）已随 1.3 移植走、原地不再保留；
    // 但仍有两个不可替代的用途：① 处理落到本部门的存量审批实例（审批抽屉）；
    // ② 撤回自己在审的存量下发计划（撤回按钮只存在于本页）。
    // 2026-11-09（用户要求）：导航文案去掉「下发」，只保留「指标审批」——
    // 学院指标的下发权已统一归战略发展部，本页对职能部门只剩审批相关用途
    // （处理存量审批实例、撤回自己在审的存量计划），继续叫「指标下发与审批」会误导。
    { id: 'distribution', label: '指标审批', icon: Promotion, path: '/distribution' }
  ],
  secondary_college: [
    { id: 'dashboard', label: '数据看板', icon: DataAnalysis, path: '/dashboard' },
    { id: 'indicators', label: '指标填报', icon: Edit, path: '/indicators' }
  ]
}

export function useNavigation(
  viewingRole: ComputedRef<UserRole | null>,
  loginRole?: ComputedRef<UserRole | null>
) {
  const router = useRouter()
  const route = useRoute()

  // 标签页 = 「登录角色组」∪「视角角色组」（按 id 去重，登录角色组在前）
  //
  // 2026-11-05（学院指标直发改造）：战略发展部的「指标下发」能力整体承接了职能部门原
  // 「指标分发」页的操作，但战略部用户可以用头部部门切换器切到职能部门 / 学院视角。
  // 若只按视角角色分组，战略部一切换视角就会同时失去「战略任务管理」与「指标下发与审批」
  // 两个入口 —— 也就是「职能部门的操作能力补充给战略部」这条需求在切视角后落空。
  // 因此改为取两组并集：登录角色决定「这个账号拥有哪些页面」（放在前面，位置稳定，
  // 切回本部门视角时顺序不变）；视角角色只额外补充「当前视角下要看哪些页面」（追加在后面）。
  //
  // 非战略部用户的 viewingRole 恒等于其登录角色（见 useDepartmentSwitcher.ts:51-57），
  // 并集结果与改造前完全一致 → 职能部门与学院视角零变化。
  //
  // 2026-11-05（issue #96 · 1.2）：并集有反作用 —— 战略部把视角切到职能部门后，
  // 视角组会把「指标下发与审批」重新并进来，等于导航限制被视角切换绕过。
  // 因此再加一层「按登录角色彻底隐藏」的黑名单，在合并结果上统一过滤。
  const tabs = computed<TabConfig[]>(() => {
    const role = viewingRole.value
    if (!role) {
      return []
    }
    const login = loginRole?.value
    const merged: TabConfig[] =
      !login || login === role ? [...(ROLE_BASED_TABS[role] || [])] : buildMergedTabs(login, role)
    const denied = login ? HIDDEN_TABS_BY_LOGIN_ROLE[login] : undefined
    if (!denied?.length) {
      return merged
    }
    return merged.filter(tab => !denied.includes(tab.id))
  })

  function buildMergedTabs(login: UserRole, role: UserRole): TabConfig[] {
    const base: TabConfig[] = [...(ROLE_BASED_TABS[login] || [])]
    const existingIds = new Set(base.map(tab => tab.id))
    for (const tab of ROLE_BASED_TABS[role] || []) {
      if (!existingIds.has(tab.id)) {
        existingIds.add(tab.id)
        base.push(tab)
      }
    }
    return base
  }

  // 当前激活的tab基于路由
  // 即使 viewingRole 暂时为 null，也能正确显示激活状态
  const activeTab = computed(() => {
    const currentPath = route.path

    // 路径到标签ID的映射（不依赖 viewingRole 状态）
    const pathToTabId: Record<string, string> = {
      '/dashboard': 'dashboard',
      '/strategic-tasks': 'strategic',
      '/indicators': 'indicators',
      '/distribution': 'distribution',
      '/messages': 'messages',
      '/plans': 'plans'
    }

    // 如果当前路径在映射中，直接返回对应的标签ID
    if (pathToTabId[currentPath]) {
      return pathToTabId[currentPath]
    }

    // 处理带参数的路径 - 使用路径前缀匹配
    // /plans/:id -> plans
    // /plans/:id/edit -> plans
    // /plans/create -> plans
    if (currentPath.startsWith('/plans')) {
      return 'plans'
    }

    // 历史 audit 路径已经回收到主工作台
    if (currentPath.startsWith('/audit/')) {
      return 'strategic'
    }

    // /profile -> 不在导航标签中，返回当前路径
    // /admin/console -> 不在导航标签中，返回当前路径

    // 否则尝试从 tabs 中查找
    const tab = tabs.value.find(t => t.path === currentPath)
    return tab?.id || 'dashboard'
  })

  // 处理tab点击
  const handleTabClick = (tabPath: string) => {
    if (tabPath !== route.path) {
      router.push(tabPath)
    }
  }

  return {
    tabs,
    activeTab,
    handleTabClick
  }
}
