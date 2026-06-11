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
import { ElMessageBox } from 'element-plus'
import { ApprovalProgressDrawer, useApprovalCenter } from '@/features/approval'
import { usePlanStore } from '@/features/plan/model/store'
import YearSelector from '@/shared/ui/form/YearSelector.vue'
import CacheDebugPanel from '@/shared/ui/dev/CacheDebugPanel.vue'
import AppAvatar from '@/shared/ui/avatar/AppAvatar.vue'
import { AppFooter } from '@/shared/ui/layout'
import { useNavigation } from '@/shared/lib/layout'
import { useAppLayout, useDepartmentSwitcher, useNotificationCenter } from './lib'
import {
  initApprovalNotifications,
  destroyApprovalNotifications
} from '@/features/approval/lib/approvalNotifications'
import { disconnectWebSocket } from '@/shared/api/websocket'
import { useTimeContextStore } from '@/shared/lib/timeContext'

const router = useRouter()

// 开发环境检测
const isDev = import.meta.env.DEV

// 使用 Layout Composables
const { currentUser, isStrategicDept, strategicDeptName, canAccessAdminConsole, handleLogout } =
  useAppLayout()

const { viewingDept, viewingRole, viewingDeptName, deptOptions } = useDepartmentSwitcher()
const planStore = usePlanStore()
const timeContext = useTimeContextStore()

const { tabs, activeTab, handleTabClick } = useNavigation(viewingRole)

const {
  unreadCount,
  pendingApprovalPreviewMessages,
  hasPendingApprovalPreviewMessages,
  notificationPreviewLoading,
  handleNotificationHover,
  handleNotificationClick,
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
 * Handle dropdown menu commands
 */
const handleDropdownCommand = async (command: string) => {
  switch (command) {
    case 'console':
      router.push('/admin/console')
      break
    case 'changePassword':
      router.push('/profile?tab=password')
      break
    case 'logout':
      try {
        await ElMessageBox.confirm('确定要退出登录吗?', '退出确认', {
          confirmButtonText: '确定',
          cancelButtonText: '取消',
          type: 'warning'
        })
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

          <!-- User info -->
          <div class="user-info">
            <span class="dept-name">{{ currentUser?.department }}</span>
            <span class="user-name">{{ currentUser?.name }}</span>
          </div>

          <!-- Notification badge -->
          <el-popover
            trigger="hover"
            placement="bottom-end"
            :width="360"
            popper-class="notification-preview-popper"
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
                <span>待审批通知</span>
                <span>最多 3 条</span>
              </div>

              <div v-if="notificationPreviewLoading" class="notification-preview__empty">
                加载中...
              </div>
              <div
                v-else-if="!hasPendingApprovalPreviewMessages"
                class="notification-preview__empty"
              >
                暂无待审批通知
              </div>
              <div v-else class="notification-preview__list">
                <button
                  v-for="message in pendingApprovalPreviewMessages"
                  :key="message.id"
                  type="button"
                  class="notification-preview__item"
                  @click="handleNotificationClick"
                >
                  <span class="notification-preview__title">{{ message.title }}</span>
                  <span class="notification-preview__content">{{ message.content }}</span>
                  <span class="notification-preview__meta">
                    <span class="notification-preview__route">
                      {{ resolveNotificationApprovalRoute(message) || '待补充' }}
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
                @click="handleNotificationClick"
              >
                查看全部消息
              </button>
            </div>
          </el-popover>

          <!-- User dropdown menu -->
          <el-dropdown @command="handleDropdownCommand">
            <AppAvatar
              class="user-avatar"
              :size="32"
              :src="
                (currentUser as { avatar?: string; avatarUrl?: string } | null)?.avatar ||
                (currentUser as { avatar?: string; avatarUrl?: string } | null)?.avatarUrl
              "
              :name="currentUser?.name || currentUser?.realName || currentUser?.username || '用户'"
            />
            <template #dropdown>
              <el-dropdown-menu>
                <!-- Admin exclusive menu -->
                <el-dropdown-item v-if="canAccessAdminConsole" command="console">
                  <el-icon><Monitor /></el-icon>
                  控制台
                </el-dropdown-item>

                <!-- All users visible -->
                <el-dropdown-item command="changePassword">
                  <el-icon><Lock /></el-icon>
                  修改密码
                </el-dropdown-item>

                <el-dropdown-item command="logout" :divided="canAccessAdminConsole">
                  <el-icon><SwitchButton /></el-icon>
                  退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
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

/* User info */
.user-info {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  margin-right: 8px;
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
}

.notification-preview__item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  padding: 10px 14px;
  border: 0;
  border-bottom: 1px solid #f1f5f9;
  background: #fff;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.notification-preview__item:hover {
  background: #f8fafc;
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
