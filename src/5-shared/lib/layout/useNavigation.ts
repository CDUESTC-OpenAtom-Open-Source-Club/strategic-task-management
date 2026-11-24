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

  // 标签页 = **视角单源**：按当前视角角色直接取对应导航组。
  //
  // 2026-11-24（切换器视角跟随修复）：此前 tabs 取「登录角色组 ∪ 视角角色组」并集再减
  // 登录角色黑名单，导致战略发展部用顶部切换器切到职能部门后，导航仍残留
  // 「战略任务管理」——与该部门账号直登的导航形态不一致。
  // 现改为：viewingRole 非空时 tabs = ROLE_BASED_TABS[viewingRole]，
  // 与「切换器切到哪个部门，导航就是这个部门类型的导航」的用户预期一致；
  // 切换后自动跳 tabs[0] 的既有逻辑（AppLayout watch）不受影响。
  //
  // viewingRole 为空（未切换视角）时回退登录角色组 —— 使用方传入的 viewingRole
  // 可能短暂为 null（如 store 尚未恢复），此时保持登录账号自己的导航不闪空。
  const tabs = computed<TabConfig[]>(() => {
    const role = viewingRole.value || loginRole?.value || null
    if (!role) {
      return []
    }
    return [...(ROLE_BASED_TABS[role] || [])]
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
