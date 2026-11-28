<script setup lang="ts">
/**
 * Application Layout Component
 *
 * Main application layout with header, navigation, and content area
 * Migrated from App.vue
 *
 * **Validates: Requirements 3.1 - Application Layout**
 */

import { watch, onMounted, onUnmounted, computed, ref, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { Switch, Monitor, Lock, SwitchButton } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ApprovalProgressDrawer, useApprovalCenter } from '@/features/approval'
import { usePlanStore } from '@/features/plan/model/store'
import YearSelector from '@/shared/ui/form/YearSelector.vue'
import CacheDebugPanel from '@/shared/ui/dev/CacheDebugPanel.vue'
import AppAvatar from '@/shared/ui/avatar/AppAvatar.vue'
import { AppFooter } from '@/shared/ui/layout'
import { useNavigation } from '@/shared/lib/layout'
import { markErrorHandled } from '@/shared/lib/utils/errorToast'
import { useAppLayout, useDepartmentSwitcher, useNotificationCenter } from './lib'
import {
  initApprovalNotifications,
  destroyApprovalNotifications
} from '@/features/approval/lib/approvalNotifications'
import { disconnectWebSocket } from '@/shared/api/websocket'
import { useTimeContextStore } from '@/shared/lib/timeContext'
import { useIndicatorRouteFocus } from '@/shared/lib/indicatorRouteFocus'
import { useAuthStore } from '@/features/auth/model/store'
import { formatIdentityTitle } from '@/features/auth/lib/identity'
import type { IdentityDTO } from '@/features/auth/api/types'

const router = useRouter()
const authStore = useAuthStore()

// 多身份：同一钉钉账号绑定 2 个及以上席位时才展示身份列表 / 角标
const identities = computed(() => authStore.identities)
const hasMultipleIdentities = computed(() => authStore.hasMultipleIdentities)
const identityMenuVisible = ref(false)

const isCurrentIdentity = (identity: IdentityDTO) =>
  authStore.currentIdentity?.sysUserId === identity.sysUserId

/**
 * 切换到指定身份。成功后 authStore 完成跳转，应用壳层随之重挂；
 * 失败时登录态未变（接口失败）或已回滚（响应落地失败），这里只负责提示。
 */
const handleSwitchIdentity = async (identity: IdentityDTO) => {
  identityMenuVisible.value = false
  const result = await authStore.switchIdentity(identity.sysUserId)
  if (!result.success) {
    // 认证层已提示，响应拦截器不再弹兜底提示
    markErrorHandled(result.cause)
    ElMessage.error(result.error || '切换身份失败，请稍后重试')
  }
}

const handleIdentityMenuCommand = (command: 'console' | 'profile' | 'logout') => {
  identityMenuVisible.value = false
  void handleDropdownCommand(command)
}

// 2026-11-20 消息中心催办/告警跳转修复：消费工作台深链 ?indicatorId= 定位参数，
// 滚动/高亮到对应指标行（催办/告警通知跳转不再丢上下文）
useIndicatorRouteFocus()

// 开发环境检测
const isDev = import.meta.env.DEV

// 使用 Layout Composables
const { currentUser, isStrategicDept, strategicDeptName, canAccessAdminConsole, handleLogout } =
  useAppLayout()

const currentUserAvatar = computed(
  () =>
    (currentUser.value as { avatar?: string; avatarUrl?: string } | null)?.avatar ||
    (currentUser.value as { avatar?: string; avatarUrl?: string } | null)?.avatarUrl ||
    ''
)
const currentUserDisplayName = computed(
  () =>
    currentUser.value?.name || currentUser.value?.realName || currentUser.value?.username || '用户'
)

// 2026-11-28（身份菜单显示各身份自己的姓名）：头像字与姓名行取 IdentityDTO.realName
// （该席位账号的姓名，后端按 sysUserId 带出），不再全部显示当前登录人；
// 旧版后端不下发 realName 时回退当前登录用户。头像字由 AppAvatar 取 name 首字符。
const identityDisplayName = (identity: IdentityDTO) =>
  identity.realName || currentUserDisplayName.value

const { viewingDept, viewingRole, viewingDeptName, deptOptions } = useDepartmentSwitcher()
const planStore = usePlanStore()
const timeContext = useTimeContextStore()

// 标签页 = 视角角色组（视角单源，见 useNavigation 注释）。
// 2026-11-24（切换器视角跟随修复）：切到哪个部门，导航就是该部门类型的导航，
// 与该部门账号直登完全一致。登录角色仅在 viewingRole 为空时作回退，
// 保证 store 尚未恢复时导航不闪空。
// 2026-11-24（返修·身份两层模型）：回退身份经 useNavigation 内部
// resolveEffectiveLoginRole 按组织维度归一（战略部组织账号=战略部导航组），
// 此处传登录用户载荷供归一判定。
const { tabs, activeTab, handleTabClick } = useNavigation(
  viewingRole,
  computed(() => authStore.userRole),
  computed(() => authStore.user)
)

const {
  unreadCount,
  unreadPreviewMessages,
  hasUnreadPreviewMessages,
  notificationPreviewLoading,
  notificationPreviewVisible,
  notificationPreviewPopperClass,
  handleNotificationHover,
  handleNotificationClick,
  handleViewAllMessages,
  formatNotificationTime,
  resolveNotificationApprovalRoute,
  Bell
} = useNotificationCenter()

// 铃铛摇摆 + Badge 动画（参考 notification-V3 Lottie 关键帧）
const bellAnimating = ref(false)
let bellAnimTimer: ReturnType<typeof setTimeout> | null = null
watch(unreadCount, (newVal, oldVal) => {
  if (newVal !== oldVal && oldVal !== undefined) {
    if (bellAnimTimer) clearTimeout(bellAnimTimer)
    bellAnimating.value = false
    nextTick(() => {
      bellAnimating.value = true
      // Lottie 动画总时长约 1.67s + 余量
      bellAnimTimer = setTimeout(() => {
        bellAnimating.value = false
      }, 1800)
    })
  }
})
const { approvalCenterVisible, approvalCenterContext, closeApprovalCenter } = useApprovalCenter()

const approvalCenterPlanId = computed(() => {
  if (approvalCenterContext.value?.workflowEntityType === 'PLAN') {
    const entityId = Number(approvalCenterContext.value.workflowEntityId ?? NaN)
    return Number.isFinite(entityId) && entityId > 0 ? entityId : null
  }

  if (
    approvalCenterContext.value?.workflowEntityType === 'PLAN_REPORT' &&
    approvalCenterContext.value?.secondaryWorkflowEntityType === 'PLAN'
  ) {
    const secondaryEntityId = Number(approvalCenterContext.value.secondaryWorkflowEntityId ?? NaN)
    return Number.isFinite(secondaryEntityId) && secondaryEntityId > 0 ? secondaryEntityId : null
  }

  return null
})

const approvalCenterPlan = computed(() => {
  if (approvalCenterPlanId.value) {
    return planStore.getPlanById(approvalCenterPlanId.value) || null
  }

  if (!viewingDept.value) {
    return null
  }

  return planStore.getPlanByTargetOrgAndYear(viewingDept.value, timeContext.currentYear) || null
})

const appContainerRef = ref<HTMLElement | null>(null)
const headerRef = ref<HTMLElement | null>(null)
const headerOffset = ref(0)
let headerResizeObserver: ResizeObserver | null = null

const syncHeaderOffset = () => {
  headerOffset.value = headerRef.value?.offsetHeight ?? 0
}

/**
 * Initialize approval notifications on mount
 */
onMounted(() => {
  initApprovalNotifications()
  void nextTick(() => {
    syncHeaderOffset()
    if (typeof ResizeObserver !== 'undefined' && headerRef.value) {
      headerResizeObserver = new ResizeObserver(() => {
        syncHeaderOffset()
      })
      headerResizeObserver.observe(headerRef.value)
    }
  })
})

/**
 * Clean up WebSocket connection on unmount
 */
onUnmounted(() => {
  destroyApprovalNotifications()
  disconnectWebSocket()
  headerResizeObserver?.disconnect()
  headerResizeObserver = null
})

/**
 * Only navigate after an actual user-triggered department switch.
 */
watch(viewingDept, (newDept, oldDept) => {
  if (!oldDept || newDept === oldDept || tabs.value.length === 0) {
    return
  }

  const firstTab = tabs.value[0]
  if (firstTab) {
    router.push(firstTab.path)
  }
})

watch(approvalCenterVisible, isVisible => {
  if (!isVisible) {
    return
  }

  if (approvalCenterPlanId.value) {
    void planStore.loadPlanDetails(approvalCenterPlanId.value, { force: true, background: true })
    return
  }

  void planStore.loadPlans()
})

/**
 * Handle menu commands（控制台 / 个人中心 / 退出）
 */
const handleDropdownCommand = async (command: string) => {
  switch (command) {
    case 'console':
      router.push('/admin/console')
      break
    case 'profile':
      // 2026-10-30 用户定案：个人中心默认落在「基本信息」，不带 tab 时
      // ProfileView 的 normalizeTab 本就回退到 basic，不指向修改密码
      router.push('/profile')
      break
    case 'logout':
      try {
        // 多身份用户退出的是全部身份（本系统每个标签页只保留一份登录态，退出口径与单身份一致）
        const isMultiIdentity = hasMultipleIdentities.value
        await ElMessageBox.confirm(
          isMultiIdentity ? '确定要退出全部身份吗?' : '确定要退出登录吗?',
          isMultiIdentity ? '退出全部身份' : '退出确认',
          {
            confirmButtonText: '确定',
            cancelButtonText: '取消',
            type: 'warning'
          }
        )
        handleLogout()
        disconnectWebSocket()
        router.push('/login')
      } catch {
        // User cancelled
      }
      break
  }
}
</script>

<template>
  <div
    ref="appContainerRef"
    class="app-container"
    :style="{ '--app-header-offset': `${headerOffset}px` }"
  >
    <!-- Header navigation -->
    <header ref="headerRef" class="app-header">
      <div class="header-content">
        <div class="header-left">
          <div class="logo-box">
            <img class="brand-logo" src="/sism-logo-header-white.png" alt="战略指标管理系统 Logo" />
          </div>
          <div class="title-box">
            <h1 class="app-title">战略指标管理系统</h1>
            <p class="app-subtitle">Strategic Indicator Management System</p>
          </div>
        </div>
        <div class="header-right">
          <!-- Year selector -->
          <YearSelector />

          <!-- Strategic department exclusive: department view switcher -->
          <div v-if="isStrategicDept" class="dept-switcher">
            <el-icon class="switcher-icon"><Switch /></el-icon>
            <el-select
              v-model="viewingDept"
              placeholder="切换部门视角"
              size="small"
              class="dept-select"
            >
              <el-option
                v-for="dept in deptOptions"
                :key="dept.value"
                :label="dept.label"
                :value="dept.value"
              >
                <span>{{ dept.label }}</span>
                <el-tag
                  v-if="dept.role === 'strategic_dept'"
                  size="small"
                  type="primary"
                  style="margin-left: 8px"
                  >管理</el-tag
                >
              </el-option>
            </el-select>
            <el-tag
              v-if="viewingDept !== strategicDeptName"
              type="warning"
              size="small"
              class="viewing-tag"
            >
              查看中: {{ viewingDeptName }}
            </el-tag>
          </div>

          <!-- Notification badge -->
          <!-- Issue #89 P4：下拉改为受控可见性 + --hidden 强制类，点击后确定收起 -->
          <el-popover
            v-model:visible="notificationPreviewVisible"
            trigger="hover"
            placement="bottom-end"
            :width="360"
            :popper-class="notificationPreviewPopperClass"
            @before-enter="handleNotificationHover"
          >
            <template #reference>
              <el-badge
                :value="unreadCount"
                :max="99"
                :hidden="unreadCount <= 0"
                class="notification-badge"
                :class="{ 'bell-active': bellAnimating }"
              >
                <el-button
                  circle
                  :aria-label="
                    unreadCount > 0 ? `消息中心，当前有 ${unreadCount} 条未处理消息` : '消息中心'
                  "
                  @click="handleNotificationClick"
                >
                  <el-icon :class="{ 'bell-swing': bellAnimating }">
                    <Bell />
                  </el-icon>
                </el-button>
              </el-badge>
            </template>

            <div class="notification-preview">
              <div class="notification-preview__header">
                <span>未读消息</span>
                <span>待审批优先 · 滚轮查看更多</span>
              </div>

              <div v-if="notificationPreviewLoading" class="notification-preview__empty">
                加载中...
              </div>
              <div v-else-if="!hasUnreadPreviewMessages" class="notification-preview__empty">
                暂无未读消息
              </div>
              <div v-else class="notification-preview__list">
                <button
                  v-for="message in unreadPreviewMessages"
                  :key="message.id"
                  type="button"
                  class="notification-preview__item"
                  :class="{ 'notification-preview__item--approval': message.approvalTodo }"
                  @click="handleNotificationClick(message)"
                >
                  <span class="notification-preview__title">
                    <span
                      class="notification-preview__kind"
                      :class="
                        message.approvalTodo
                          ? 'notification-preview__kind--approval'
                          : 'notification-preview__kind--notice'
                      "
                    >
                      {{ message.approvalTodo ? '待审批' : '通知' }}
                    </span>
                    {{ message.title }}
                  </span>
                  <span class="notification-preview__content">{{ message.content }}</span>
                  <span class="notification-preview__meta">
                    <span class="notification-preview__route">
                      {{ resolveNotificationApprovalRoute(message) }}
                    </span>
                    <span class="notification-preview__time">
                      {{ formatNotificationTime(message.createdAt) }}
                    </span>
                  </span>
                </button>
              </div>

              <button
                type="button"
                class="notification-preview__footer"
                @click="handleViewAllMessages"
              >
                查看全部消息
              </button>
            </div>
          </el-popover>

          <!-- Account & identity menu -->
          <!-- 2026-11-28 多身份切换：用户区（部门 + 姓名 + 头像）整体可点击，展开身份菜单。
               多身份时列出同一钉钉账号绑定的全部席位，点非当前身份触发切换；
               单身份时只有控制台 / 个人中心 / 退出三个入口（与改造前的下拉一致）。
               原先「点头像 = 个人中心」的入口并入菜单底部。 -->
          <el-popover
            v-model:visible="identityMenuVisible"
            trigger="click"
            placement="bottom-end"
            :width="320"
            popper-class="identity-menu-popper"
          >
            <template #reference>
              <button
                type="button"
                class="user-entry"
                :disabled="authStore.switching"
                aria-haspopup="menu"
                :aria-expanded="identityMenuVisible"
                aria-label="账号与身份菜单"
              >
                <span class="user-info">
                  <span class="dept-name">{{ currentUser?.department }}</span>
                  <span class="user-name">{{ currentUser?.name }}</span>
                </span>
                <el-badge
                  v-if="hasMultipleIdentities"
                  :value="identities.length"
                  class="identity-count-badge"
                  :aria-label="`已绑定 ${identities.length} 个身份`"
                >
                  <AppAvatar
                    class="user-avatar"
                    :size="32"
                    :src="currentUserAvatar"
                    :name="currentUserDisplayName"
                  />
                </el-badge>
                <AppAvatar
                  v-else
                  class="user-avatar"
                  :size="32"
                  :src="currentUserAvatar"
                  :name="currentUserDisplayName"
                />
              </button>
            </template>

            <div class="identity-menu">
              <template v-if="hasMultipleIdentities">
                <div class="identity-menu__head">
                  <div class="identity-menu__title">切换身份</div>
                  <div class="identity-menu__subtitle">同一钉钉账号绑定的部门席位</div>
                </div>

                <div class="identity-menu__list">
                  <button
                    v-for="identity in identities"
                    :key="identity.sysUserId"
                    type="button"
                    class="identity-menu__item"
                    :class="{ 'is-current': isCurrentIdentity(identity) }"
                    role="menuitem"
                    :disabled="authStore.switching || isCurrentIdentity(identity)"
                    :aria-current="isCurrentIdentity(identity) ? 'true' : undefined"
                    :data-identity-sys-user-id="identity.sysUserId"
                    @click="handleSwitchIdentity(identity)"
                  >
                    <AppAvatar
                      class="identity-menu__avatar"
                      :size="32"
                      :src="currentUserAvatar"
                      :name="identityDisplayName(identity)"
                    />
                    <span class="identity-menu__main">
                      <span class="identity-menu__name">{{ identityDisplayName(identity) }}</span>
                      <span class="identity-menu__desc">{{ formatIdentityTitle(identity) }}</span>
                    </span>
                    <el-tag
                      v-if="isCurrentIdentity(identity)"
                      size="small"
                      class="identity-menu__current"
                    >
                      当前
                    </el-tag>
                  </button>
                </div>
              </template>

              <div class="identity-menu__foot">
                <button
                  v-if="canAccessAdminConsole"
                  type="button"
                  role="menuitem"
                  class="identity-menu__action"
                  @click="handleIdentityMenuCommand('console')"
                >
                  <el-icon><Monitor /></el-icon>
                  <span>控制台</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  class="identity-menu__action"
                  @click="handleIdentityMenuCommand('profile')"
                >
                  <el-icon><Lock /></el-icon>
                  <span>个人中心</span>
                </button>

                <button
                  type="button"
                  role="menuitem"
                  class="identity-menu__action"
                  :class="{ 'is-divided': canAccessAdminConsole }"
                  @click="handleIdentityMenuCommand('logout')"
                >
                  <el-icon><SwitchButton /></el-icon>
                  <span>{{ hasMultipleIdentities ? '退出全部身份' : '退出登录' }}</span>
                </button>
              </div>
            </div>
          </el-popover>
        </div>
      </div>
    </header>

    <!-- Main content area -->
    <main class="app-main">
      <!-- Tab navigation -->
      <div v-if="tabs.length > 0" class="tab-nav">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          :class="['tab-item', { active: activeTab === tab.id }]"
          role="tab"
          :aria-selected="activeTab === tab.id"
          tabindex="0"
          @click.stop.prevent="handleTabClick(tab.path)"
          @keydown.enter="handleTabClick(tab.path)"
          @keydown.space.prevent="handleTabClick(tab.path)"
        >
          <el-icon :size="20"><component :is="tab.icon" /></el-icon>
          <span>{{ tab.label }}</span>
        </div>
      </div>

      <!-- Debug warning (development only) -->
      <div v-else-if="isDev" class="debug-warning">
        <p>
          ⚠️ 导航标签未显示 - 当前角色: {{ viewingRole || '未知' }} | 标签数量: {{ tabs.length }}
        </p>
      </div>

      <!-- Content area - uses router-view -->
      <div class="content-area">
        <router-view
          :viewing-role="viewingRole"
          :viewing-dept="viewingDept"
          :selected-role="viewingRole || ''"
        />
      </div>
    </main>

    <AppFooter />

    <CacheDebugPanel v-if="isDev" />

    <ApprovalProgressDrawer
      :model-value="approvalCenterVisible"
      :plan="approvalCenterPlan"
      :department-name="approvalCenterContext?.departmentName || viewingDept"
      :plan-name="approvalCenterContext?.planName || approvalCenterPlan?.name || viewingDeptName"
      :show-plan-approvals="true"
      :show-approval-section="true"
      :workflow-entity-type="approvalCenterContext?.workflowEntityType || 'PLAN'"
      :workflow-entity-id="approvalCenterContext?.workflowEntityId"
      :secondary-workflow-entity-type="approvalCenterContext?.secondaryWorkflowEntityType"
      :secondary-workflow-entity-id="approvalCenterContext?.secondaryWorkflowEntityId"
      :route-target="approvalCenterContext?.routeTarget"
      approval-type="submission"
      @update:model-value="value => !value && closeApprovalCenter()"
      @close="closeApprovalCenter"
    />
  </div>
</template>

<style scoped>
/* ========== Debug warning styles ========== */
.debug-warning {
  background: #fff3cd;
  padding: 12px;
  margin-bottom: 20px;
  border-radius: 4px;
  border: 1px solid #ffc107;
}

.debug-warning p {
  margin: 0;
  color: #856404;
}

/* ========== Academic administrative system style - main framework ========== */
.app-container {
  --primary-dark: #1a365d;
  --primary: #2c5282;
  --primary-light: #3182ce;
  --accent: #c9a227;
  --text-dark: #1e293b;
  --text-regular: #475569;
  --text-light: #94a3b8;
  --bg-page: #f1f5f9;
  --bg-card: #ffffff;
  --border: #e2e8f0;

  /* Issue #89 P1：#app 是 height:100vh 的 flex column 容器，本容器是其 flex 子项。
     默认 flex-shrink:1 会把本容器压扁到一屏高度，而 sticky 顶栏的约束范围
     恰好是父容器盒子——滚动超过一屏后顶栏就被「容器底边」推出视口，
     表现为顶栏消失、sticky 导航条上方露出滚动内容（卡片穿透观感）。
     禁止收缩后容器高度跟随内容，sticky 约束覆盖整个文档。 */
  flex-shrink: 0;

  min-height: 100vh;
  background: var(--bg-page);
}

/* ========== Header navigation ========== */
.app-header {
  background: linear-gradient(135deg, var(--primary-dark) 0%, var(--primary) 100%);
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 2px 8px rgba(26, 54, 93, 0.3);
}

.header-content {
  max-width: 1400px;
  margin: 0 auto;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo-box {
  width: 68px;
  height: 68px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.brand-logo {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

.title-box {
  display: flex;
  flex-direction: column;
}

.app-title {
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  margin: 0;
  line-height: 1.2;
  letter-spacing: 1px;
}

.app-subtitle {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.7);
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

/* Department switcher */
.dept-switcher {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.switcher-icon {
  color: var(--accent);
  font-size: 16px;
}

.dept-select {
  width: 130px;
}

.dept-select :deep(.el-input__wrapper) {
  box-shadow: none !important;
  background: transparent;
  border: none;
}

.dept-select :deep(.el-input__inner) {
  color: #fff;
  font-size: 13px;
}

.dept-select :deep(.el-input__suffix) {
  color: rgba(255, 255, 255, 0.7);
}

.viewing-tag {
  margin-left: 4px;
  background: rgba(255, 255, 255, 0.9);
  border-color: rgba(255, 255, 255, 0.9);
  color: var(--primary);
}

/* User entry：部门 + 姓名 + 头像整体可点击，展开身份菜单 */
.user-entry {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  transition: background var(--transition-fast);
}

.user-entry:hover,
.user-entry[aria-expanded='true'] {
  background: rgba(255, 255, 255, 0.15);
  border-color: transparent;
  color: inherit;
}

.user-entry:disabled {
  cursor: not-allowed;
  opacity: 0.7;
}

/* User info */
.user-info {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}

.dept-name {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.7);
}

.user-name {
  font-size: 13px;
  font-weight: 500;
  color: #fff;
}

.notification-badge {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  margin-right: 8px;
  flex: 0 0 36px;
}

.notification-badge :deep(.el-button) {
  width: 36px;
  height: 36px;
  min-height: 36px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
}

.notification-badge :deep(.el-button:hover) {
  background: rgba(255, 255, 255, 0.2);
}

.notification-badge :deep(.el-badge__content) {
  background: #dc2626;
  pointer-events: none;
}

.notification-badge :deep(.el-badge__content.is-fixed) {
  top: 0;
  right: 0;
  transform: translate(35%, -35%);
  transform-origin: center;
}

@keyframes bell-swing-anim {
  0% {
    transform: rotate(0deg);
  }
  14% {
    transform: rotate(18deg);
  }
  28% {
    transform: rotate(-18deg);
  }
  46% {
    transform: rotate(18deg);
  }
  62% {
    transform: rotate(-9deg);
  }
  76% {
    transform: rotate(5deg);
  }
  100% {
    transform: rotate(0deg);
  }
}

/* 铃铛摇摆动画 */
.bell-swing {
  display: inline-flex;
  transform-origin: top center;
  animation: bell-swing-anim 1.7s cubic-bezier(0.45, 0.05, 0.55, 0.95);
}

/* 防止铃铛摇摆时旋转溢出导致按钮尺寸变化、红点偏移 */
.notification-badge.bell-active :deep(.el-button) {
  overflow: hidden;
}

:global(.notification-preview-popper) {
  padding: 0;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 6px;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
}

/* Issue #89 P4：受控收起时强制隐藏（element-plus hover 弹层在指针
   停留内容内时可能回写 visible，单靠 v-model 收不干净） */
:global(.notification-preview-popper--hidden) {
  display: none !important;
}

.notification-preview {
  overflow: hidden;
  background: #fff;
  border-radius: 6px;
}

.notification-preview__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid #e5e7eb;
  color: #111827;
  font-size: 14px;
  font-weight: 600;
}

.notification-preview__header span:last-child {
  color: #6b7280;
  font-size: 12px;
  font-weight: 400;
}

.notification-preview__list {
  display: flex;
  flex-direction: column;
  /* 2026-10-10 N7：默认约 3 条高度，滚轮上下滚动查看更多未读 */
  max-height: 288px;
  overflow-y: auto;
}

.notification-preview__item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  padding: 10px 14px;
  border: 0;
  border-bottom: 1px solid #f1f5f9;
  border-left: 3px solid transparent;
  background: #fff;
  color: inherit;
  text-align: left;
  cursor: pointer;
  flex-shrink: 0;
}

.notification-preview__item:hover {
  background: #f8fafc;
}

/* 待审批消息：橙色系左条与底色，与普通通知区分（大小一致） */
.notification-preview__item--approval {
  border-left-color: #f59e0b;
  background: #fffbeb;
}

.notification-preview__item--approval:hover {
  background: #fef3c7;
}

.notification-preview__kind {
  display: inline-block;
  margin-right: 6px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  vertical-align: 1px;
}

.notification-preview__kind--approval {
  background: #fef3c7;
  color: #b45309;
}

.notification-preview__kind--notice {
  background: #eff6ff;
  color: #1d4ed8;
}

.notification-preview__title {
  overflow: hidden;
  color: #111827;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-preview__content {
  display: -webkit-box;
  overflow: hidden;
  color: #4b5563;
  font-size: 12px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.notification-preview__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: #6b7280;
  font-size: 11px;
  line-height: 1.3;
}

.notification-preview__route {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-preview__time {
  flex: 0 0 auto;
  white-space: nowrap;
}

.notification-preview__empty {
  padding: 24px 14px;
  color: #6b7280;
  font-size: 13px;
  text-align: center;
}

.notification-preview__footer {
  width: 100%;
  padding: 10px 14px;
  border: 0;
  border-top: 1px solid #e5e7eb;
  background: #f9fafb;
  color: #1d4ed8;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.notification-preview__footer:hover {
  background: #eef2ff;
}

.user-avatar {
  background: var(--accent);
  color: var(--primary-dark);
  font-weight: 700;
  cursor: pointer;
  border: 2px solid rgba(255, 255, 255, 0.3);
}

/* 身份数量角标（绑定 2 个及以上席位才显示），配色沿用顶栏的 accent */
.identity-count-badge {
  display: inline-flex;
  flex: none;
}

.identity-count-badge :deep(.el-badge__content) {
  background: var(--accent);
  color: var(--primary-dark);
  font-weight: 700;
  border: 1px solid rgba(255, 255, 255, 0.6);
  pointer-events: none;
}

.identity-count-badge :deep(.el-badge__content.is-fixed) {
  top: 0;
  right: 0;
  transform: translate(35%, -35%);
  transform-origin: center;
}

/* 身份菜单弹层：尺寸与阴影对齐通知弹层 */
:global(.identity-menu-popper) {
  padding: 0;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 6px;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
}

.identity-menu {
  overflow: hidden;
  background: var(--bg-white);
  border-radius: 6px;
  color: var(--text-main);
}

.identity-menu__head {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-color);
}

.identity-menu__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-main);
}

.identity-menu__subtitle {
  margin-top: 2px;
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
}

.identity-menu__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 320px;
  padding: 6px;
  overflow-y: auto;
}

.identity-menu__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-main);
  text-align: left;
  transition:
    background var(--transition-fast),
    border-color var(--transition-fast);
}

.identity-menu__item:not(:disabled):hover {
  background: var(--bg-page);
  border-color: var(--color-primary);
  color: var(--text-main);
}

/* 当前身份：高亮 + 不可点击 */
.identity-menu__item.is-current,
.identity-menu__item.is-current:hover {
  background: var(--color-primary-light);
  border-color: var(--color-primary);
  color: var(--text-main);
  cursor: default;
}

.identity-menu__item:disabled:not(.is-current) {
  opacity: 0.6;
  cursor: not-allowed;
}

.identity-menu__main {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.identity-menu__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-main);
}

.identity-menu__desc {
  overflow: hidden;
  font-size: 12px;
  color: var(--text-regular);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.identity-menu__current {
  flex: none;
  font-weight: 600;
}

.identity-menu__foot {
  display: flex;
  flex-direction: column;
  padding: 6px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-light);
}

.identity-menu__action {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-regular);
  font-size: 13px;
  text-align: left;
  transition: background var(--transition-fast);
}

.identity-menu__action:hover {
  background: var(--color-primary-light);
  border-color: transparent;
  color: var(--color-primary);
}

.identity-menu__action.is-divided {
  margin-top: 6px;
  border-top-color: var(--border-color);
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}

/* ========== Main content area ========== */
.app-main {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px 24px;
}

/* ========== Tab navigation ========== */
.tab-nav {
  background: var(--bg-card);
  border-radius: 4px;
  padding: 4px;
  margin-bottom: 20px;
  display: flex;
  gap: 4px;
  border: 1px solid var(--border);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  position: sticky;
  top: calc(var(--app-header-offset, 0px) + 12px);
  z-index: 90;
}

.tab-item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 16px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  color: var(--text-regular);
  font-weight: 500;
  font-size: 14px;
  user-select: none;
  -webkit-user-select: none;
}

.tab-item:hover {
  background: var(--bg-page);
  color: var(--primary);
}

.tab-item.active {
  background: linear-gradient(135deg, var(--primary-dark) 0%, var(--primary) 100%);
  color: #fff;
  box-shadow: 0 2px 8px rgba(26, 54, 93, 0.3);
}

.content-area {
  min-height: calc(100vh - 180px);
}

/* 仅战略任务管理页：取消强制最小高度，由页面自身按视口精确取高，避免整页滚动 */
.content-area:has(.strategic-task-container) {
  min-height: 0;
}

/* ========== Responsive ========== */
@media (max-width: 768px) {
  .header-content {
    flex-direction: column;
    gap: 12px;
    padding: 12px 16px;
  }

  .tab-nav {
    flex-wrap: wrap;
  }

  .tab-item {
    flex: 1 1 45%;
    padding: 10px 12px;
    font-size: 13px;
  }

  .app-subtitle {
    display: none;
  }

  .dept-switcher {
    display: none;
  }
}
</style>

<!-- 2026-11-20 消息中心催办/告警跳转修复：指标定位深链的行高亮样式。
     高亮类由 indicatorRouteFocus 动态加在落地页（/strategic-tasks、/indicators）
     的 el-table 行上，AppLayout 的 scoped 样式作用不到子路由视图，
     因此单独开非 scoped 块声明全局样式。 -->
<style>
.el-table .el-table__row.sism-indicator-row-focus > td.el-table__cell {
  /* !important：el-table 的 hover/斑马纹/单元格底色优先级较高，不加会被覆盖 */
  background-color: var(--el-color-primary-light-8) !important;
  transition: background-color 0.4s ease;
}
</style>
