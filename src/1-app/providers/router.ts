/**
 * Router Provider
 *
 * Vue Router configuration for application-level routing
 * Migrated from src/router/index.ts
 *
 * **Validates: Requirements 3.2 - Application Providers**
 * **Updated**: 2026-03-15 - Migrated from Pages to Features layer
 */

import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/features/auth/model/store'
import { isDingTalkContainer, tryDingTalkAutoLogin } from '@/features/auth/lib/dingtalk'
import { tokenManager } from '@/shared/lib/utils/tokenManager'
import { logger } from '@/shared/lib/utils/logger'
import { hasAdminConsoleAccess } from '@/shared/lib/permissions/adminConsoleAccess'
import { startProgress, doneProgress } from './router-progress'
import { resolveProtectedRouteRedirect } from './lib/routeAccess'
import './router-progress.css'

const resolveAuthenticatedHome = (authStore: ReturnType<typeof useAuthStore>) => {
  return authStore.userRole === 'strategic_dept' ? '/strategic-tasks' : '/dashboard'
}

// 确保从 localStorage 恢复认证状态
const ensureAuthRestored = async () => {
  const authStore = useAuthStore()
  await authStore.initializeAuth()

  if (authStore.token && !tokenManager.hasValidToken()) {
    authStore.logout({ redirect: false })
    return
  }

  // 如果有 token 但没有 user 或 user 没有 userId，尝试从 localStorage 恢复
  if (authStore.token && (!authStore.user || !authStore.user.userId)) {
    const savedUser = localStorage.getItem('currentUser')
    if (savedUser) {
      try {
        authStore.user = JSON.parse(savedUser)
      } catch (e) {
        // Failed to restore user from localStorage
        authStore.logout({ redirect: false })
      }
    }
  }
}

const routes: RouteRecordRaw[] = [
  {
    // 钉钉工作台 applink 的 path 不能带查询参数（会 404），
    // 因此 sourceId 编在路径段里，由本重定向转为消息中心查询参数
    path: '/mt/:sourceId',
    name: 'DingTalkTodoPathRedirect',
    redirect: to => ({
      path: '/messages',
      query: { sourceId: String(to.params.sourceId || '') }
    })
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/features/auth/ui/LoginView.vue'),
    meta: { requiresAuth: false, title: '登录 - 战略指标管理系统' }
  },
  {
    path: '/forgot-password',
    name: 'ForgotPassword',
    component: () => import('@/features/auth/ui/ForgotPassword.vue'),
    meta: { requiresAuth: false, title: '找回密码 - 战略指标管理系统' }
  },
  {
    path: '/403',
    name: 'Forbidden',
    component: () => import('@/shared/ui/error/ForbiddenView.vue'),
    meta: { requiresAuth: false, title: '禁止访问 - 战略指标管理系统' }
  },
  {
    path: '/',
    component: () => import('@/app/layouts/AppLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        redirect: '/dashboard'
      },
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/features/dashboard/ui/DashboardView.vue'),
        meta: { title: '仪表盘 - 战略指标管理系统' }
      },
      {
        path: 'strategic-tasks',
        name: 'StrategicTasks',
        component: () => import('@/features/task/ui/StrategicTaskView.vue'),
        meta: { roles: ['strategic_dept'], title: '战略任务 - 战略指标管理系统' }
      },
      {
        path: 'indicators',
        name: 'Indicators',
        component: () => import('@/features/indicator/ui/IndicatorListView.vue'),
        meta: { title: '指标列表 - 战略指标管理系统' }
      },
      {
        path: 'distribution',
        name: 'Distribution',
        component: () => import('@/features/indicator/ui/IndicatorDistributeView.vue'),
        meta: { roles: ['functional_dept'], title: '指标分配 - 战略指标管理系统' }
      },
      {
        path: 'messages',
        name: 'Messages',
        component: () => import('@/features/messages/ui/MessageCenterView.vue'),
        meta: { title: '消息中心 - 战略指标管理系统' }
      },
      {
        path: 'profile',
        name: 'Profile',
        component: () => import('@/features/profile/ui/ProfileView.vue'),
        meta: { title: '个人资料 - 战略指标管理系统' }
      },
      {
        path: 'admin/console',
        name: 'AdminConsole',
        component: () => import('@/features/admin/ui/AdminConsoleView.vue'),
        meta: {
          roles: ['strategic_dept'],
          title: '管理控制台 - 战略指标管理系统'
        }
      },

      // ============================================================
      // 新数据结构路由 (Plan -> Task -> Indicator -> IndicatorFill)
      // ============================================================

      /**
       * @deprecated As a formal entry point.
       * Plan management is being consolidated into `/strategic-tasks`.
       * This route is retained temporarily for compatibility and backup access.
       */
      {
        path: 'plans',
        name: 'PlanList',
        component: () => import('@/features/plan/ui/PlanListView.vue'),
        meta: { title: '计划列表 - 战略指标管理系统' }
      },

      /**
       * @deprecated As a formal entry point.
       * Retained temporarily while the strategic workbench absorbs plan detail flows.
       */
      {
        path: 'plans/:id',
        name: 'plan-detail',
        component: () => import('@/features/plan/ui/PlanDetailView.vue'),
        meta: { title: '计划详情 - 战略指标管理系统' }
      },

      /**
       * @deprecated As a formal entry point.
       * Retained temporarily while the strategic workbench absorbs plan editing flows.
       */
      {
        path: 'plans/:id/edit',
        name: 'plan-edit',
        component: () => import('@/features/plan/ui/PlanEditView.vue'),
        meta: { roles: ['strategic_dept'], title: '编辑计划 - 战略指标管理系统' }
      },

      /**
       * @deprecated As a formal entry point.
       * Retained temporarily while the strategic workbench absorbs plan creation flows.
       */
      {
        path: 'plans/create',
        name: 'plan-create',
        component: () => import('@/features/plan/ui/PlanEditView.vue'),
        meta: { roles: ['strategic_dept'], title: '创建计划 - 战略指标管理系统' }
      },

      /**
       * 历史错误入口兼容
       * 指标编辑应统一在 /strategic-tasks 内完成
       */
      {
        path: 'indicators/:indicatorId/progress',
        redirect: '/strategic-tasks'
      },
      {
        path: 'fills/indicator/:indicatorId',
        redirect: '/strategic-tasks'
      },

      /**
       * 冗余审批页面入口已下线。
       * 历史链接统一回收到主工作台，避免进入已废弃页面。
       */
      {
        path: 'audit/plan/:fillId',
        redirect: '/strategic-tasks'
      },
      {
        path: 'audit/pending',
        redirect: '/strategic-tasks'
      }
    ]
  },

  {
    path: '/:pathMatch(.*)*',
    name: '404',
    component: () => import('@/shared/ui/error/NotFoundView.vue'),
    meta: { title: '页面未找到 - 战略指标管理系统' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// Navigation guards

router.beforeEach(async (to, _from, next) => {
  // 钉钉工作台 applink 拼装会产生双斜杠路径（首页根地址尾斜杠 + path 头斜杠），
  // 例：//mt/xxx —— 路由匹配会失败落到 404，这里统一剥掉多余的斜杠
  if (to.path.startsWith('//')) {
    next({ path: to.path.replace(/^\/+/, '/'), query: to.query, hash: to.hash, replace: true })
    return
  }

  // 开始进度进度条（如果是页面导航）
  if (_from.name !== undefined) {
    startProgress()
  }

  // 设置页面标题
  if (to.meta['title']) {
    document.title = to.meta['title'] as string
  } else {
    document.title = '战略指标管理系统'
  }

  // 确保认证状态已从 localStorage 恢复
  await ensureAuthRestored()

  // 钉钉容器内且当前未登录：先尝试静默免登（结果会话内缓存）。
  // 成功则直接放行原目标路由（待办深链直达审批页）；失败则落到登录页并展示原因。
  if (!useAuthStore().isAuthenticated && isDingTalkContainer()) {
    await tryDingTalkAutoLogin()
  }

  const authStore = useAuthStore()
  const currentOrgId = Number(authStore.user?.orgId ?? NaN)
  const canAccessAdminConsole = hasAdminConsoleAccess(authStore.user)
  logger.debug('[Router] auth restored', {
    path: to.path,
    authenticated: authStore.isAuthenticated,
    role: authStore.userRole,
    effectiveRole: authStore.effectiveRole,
    orgId: currentOrgId,
    orgType: authStore.user?.orgType,
    canAccessAdminConsole
  })

  const protectedRouteRedirect = resolveProtectedRouteRedirect({
    requiresAuth: Boolean(to.meta['requiresAuth']),
    isAuthenticated: authStore.isAuthenticated,
    hasAdminConsoleAccess: canAccessAdminConsole,
    userRole: authStore.userRole,
    effectiveRole: authStore.effectiveRole,
    allowedRoles: Array.isArray(to.meta['roles']) ? (to.meta['roles'] as string[]) : undefined,
    path: to.path
  })

  if (protectedRouteRedirect) {
    if (protectedRouteRedirect === '/login' && authStore.isAuthenticated) {
      logger.warn('[Router] authenticated session missing valid role, clearing auth state', {
        path: to.path,
        role: authStore.userRole,
        effectiveRole: authStore.effectiveRole
      })
      authStore.logout({ redirect: false })
    }
    next(protectedRouteRedirect)
    return
  }

  // Redirect authenticated users away from login page
  if (to.path === '/login' && authStore.isAuthenticated) {
    if (!authStore.userRole) {
      authStore.logout({ redirect: false })
      next('/login')
      return
    }
    next(resolveAuthenticatedHome(authStore))
    return
  }

  next()
})

// 路由切换完成后结束进度条
router.afterEach(() => {
  doneProgress()
})

// 路由切换失败时也要结束进度条
router.onError(() => {
  doneProgress()
})

export default router
