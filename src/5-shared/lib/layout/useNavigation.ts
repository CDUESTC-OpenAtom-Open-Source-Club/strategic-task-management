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

/** 基于角色的页面配置 */
const ROLE_BASED_TABS: Record<UserRole, TabConfig[]> = {
  strategic_dept: [
    { id: 'dashboard', label: '数据看板', icon: DataAnalysis, path: '/dashboard' },
    { id: 'strategic', label: '战略任务管理', icon: List, path: '/strategic-tasks' },
    // 2026-11-05：指标下发的操作能力整体移交战略发展部 → tab 从 functional_dept 组移入本组
    { id: 'distribution', label: '指标下发与审批', icon: Promotion, path: '/distribution' }
  ],
  functional_dept: [
    { id: 'dashboard', label: '数据看板', icon: DataAnalysis, path: '/dashboard' },
    { id: 'indicators', label: '指标填报', icon: Edit, path: '/indicators' },
    // 2026-11-05（战略部直发学院指标）：下发的**操作能力**移交战略发展部，但本页仍是
    // 职能部门「查看历史下发 + 撤回自己在审计划」的唯一入口——撤回按钮只存在于本页。
    // 页面内按登录角色只读化（写操作仅战略部），因此保留 tab 不会给出新的写权限。
    { id: 'distribution', label: '指标下发与审批', icon: Promotion, path: '/distribution' }
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
  const tabs = computed<TabConfig[]>(() => {
    const role = viewingRole.value
    if (!role) {
      return []
    }
    const login = loginRole?.value
    if (!login || login === role) {
      return ROLE_BASED_TABS[role] || []
    }
    const merged: TabConfig[] = [...(ROLE_BASED_TABS[login] || [])]
    const existingIds = new Set(merged.map(tab => tab.id))
    for (const tab of ROLE_BASED_TABS[role] || []) {
      if (!existingIds.has(tab.id)) {
        existingIds.add(tab.id)
        merged.push(tab)
      }
    }
    return merged
  })

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
