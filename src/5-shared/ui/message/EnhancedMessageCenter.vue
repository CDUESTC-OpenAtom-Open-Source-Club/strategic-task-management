<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  ElCard,
  ElBadge,
  ElButton,
  ElIcon,
  ElEmpty,
  ElScrollbar,
  ElTooltip,
  ElAvatar as _ElAvatar,
  ElTag,
  ElInput,
  ElDropdown,
  ElDropdownMenu,
  ElDropdownItem,
  ElMessage
} from 'element-plus'
import {
  Bell,
  Check,
  Close,
  Delete,
  Refresh,
  Search,
  Select,
  CircleCheck,
  Warning,
  InfoFilled,
  WarnTriangleFilled,
  CircleClose as _CircleClose
} from '@element-plus/icons-vue'
import type { Message, MessageType, AlertLevel } from '@/shared/types'
import { formatDateShort, formatDateTime } from '@/shared/lib/utils'

/**
 * 增强型消息中心组件
 *
 * 功能：
 * - 左侧：分类导航（全部、待处理、审批、系统、任务）
 * - 右侧：消息列表
 * - 一键全部已读
 * - 点击消息跳转并定位
 * - 批量操作
 */

const router = useRouter()

// ============ 状态 ============
const loading = ref(false)
const messages = ref<Message[]>([])
const activeCategory = ref<MessageCategory>('all')
const searchKeyword = ref('')

// 消息分类类型
type MessageCategory = 'all' | 'unread' | 'approval' | 'system' | 'task' | 'alert'
import type { Component } from 'vue'

// 分类配置
const categories: Array<{
  key: MessageCategory
  label: string
  icon: Component
  filter?: (m: Message) => boolean
}> = [
  { key: 'all', label: '全部消息', icon: Bell },
  { key: 'unread', label: '待处理', icon: Select, filter: m => !m.isRead },
  { key: 'approval', label: '审批消息', icon: Check, filter: m => m.type === 'approval' },
  { key: 'system', label: '系统通知', icon: InfoFilled, filter: m => m.type === 'system' },
  { key: 'task', label: '任务消息', icon: Select, filter: m => m.type === 'task' },
  { key: 'alert', label: '预警消息', icon: Warning, filter: m => m.type === 'alert' }
]

// ============ 计算属性 ============

// 过滤后的消息
const filteredMessages = computed(() => {
  let result = messages.value

  // 分类筛选
  const category = categories.find(c => c.key === activeCategory.value)
  if (category?.filter) {
    result = result.filter(category.filter)
  }

  // 关键词搜索
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase()
    result = result.filter(
      m => m.title.toLowerCase().includes(keyword) || m.content.toLowerCase().includes(keyword)
    )
  }

  // 按时间倒序
  return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
})

// 未读数量
const unreadCount = computed(() => {
  return messages.value.filter(m => !m.isRead).length
})

// 各分类未读数
const categoryUnreadCount = computed(() => {
  return {
    all: unreadCount.value,
    unread: unreadCount.value,
    approval: messages.value.filter(m => m.type === 'approval' && !m.isRead).length,
    system: messages.value.filter(m => m.type === 'system' && !m.isRead).length,
    task: messages.value.filter(m => m.type === 'task' && !m.isRead).length,
    alert: messages.value.filter(m => m.type === 'alert' && !m.isRead).length
  }
})

// 获取消息类型图标
const getMessageIcon = (type: MessageType) => {
  switch (type) {
    case 'approval':
      return Check
    case 'alert':
      return WarnTriangleFilled
    case 'task':
      return Select
    default:
      return InfoFilled
  }
}

// 获取消息类型标签
const getMessageTypeLabel = (type: MessageType) => {
  const labels: Record<MessageType, string> = {
    approval: '审批',
    alert: '预警',
    task: '任务',
    system: '系统'
  }
  return labels[type]
}

// 获取严重程度标签
const getSeverityLabel = (severity?: AlertLevel) => {
  const labels: Record<AlertLevel, string> = {
    severe: '严重',
    moderate: '一般',
    normal: '正常'
  }
  return severity ? labels[severity] : ''
}

// 格式化相对时间
const getRelativeTime = (date: Date) => {
  const now = new Date()
  const diff = now.getTime() - new Date(date).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) {
    return '刚刚'
  }
  if (minutes < 60) {
    return `${minutes}分钟前`
  }
  if (hours < 24) {
    return `${hours}小时前`
  }
  if (days < 7) {
    return `${days}天前`
  }
  if (days < 30) {
    return `${Math.floor(days / 7)}周前`
  }
  return formatDateShort(date)
}

// 获取消息图标样式
const getIconClass = (message: Message) => {
  if (message.isRead) {
    return 'icon-read'
  }

  const classes: Record<MessageType, string> = {
    approval: 'icon-approval',
    alert: message.severity === 'severe' ? 'icon-severe' : 'icon-alert',
    task: 'icon-task',
    system: 'icon-system'
  }
  return classes[message.type]
}

// ============ 方法 ============

// 加载消息
const loadMessages = async () => {
  loading.value = true
  try {
    // TODO: 调用实际API
    // const response = await api.getMessages()
    // messages.value = response.data

    // 模拟数据
    messages.value = [
      {
        id: 'msg-001',
        type: 'approval',
        title: '指标填报审批待处理',
        content: '您提交的「科研项目立项数」指标填报记录等待审核，请及时处理。',
        severity: 'normal',
        recipientRole: 'functional_dept',
        isRead: false,
        createdAt: new Date(Date.now() - 300000), // 5分钟前
        relatedId: 'ind-003',
        actionUrl: '/plan/plan-001?indicator=ind-003&tab=approval'
      },
      {
        id: 'msg-002',
        type: 'alert',
        title: '指标进度预警',
        content: '「学生就业率」指标当前进度为0%，距离里程碑截止日期仅剩30天，请及时填报。',
        severity: 'moderate',
        recipientRole: 'secondary_college',
        isRead: false,
        createdAt: new Date(Date.now() - 3600000), // 1小时前
        relatedId: 'ind-004',
        actionUrl: '/plan/plan-001?indicator=ind-004'
      },
      {
        id: 'msg-003',
        type: 'alert',
        title: '严重预警：党建工作成效',
        content: '「党建工作成效」指标已逾期未填报，请立即处理！',
        severity: 'severe',
        recipientRole: 'secondary_college',
        isRead: false,
        createdAt: new Date(Date.now() - 7200000), // 2小时前
        relatedId: 'ind-001',
        actionUrl: '/plan/plan-001?indicator=ind-001'
      },
      {
        id: 'msg-004',
        type: 'system',
        title: '系统维护通知',
        content: '系统将于今晚22:00-23:00进行维护，期间可能无法访问，请提前做好准备。',
        severity: 'normal',
        isRead: true,
        createdAt: new Date(Date.now() - 86400000), // 1天前
        actionUrl: '/system/notice'
      },
      {
        id: 'msg-005',
        type: 'approval',
        title: '填报已通过',
        content: '您提交的「党建工作成效」指标填报记录已通过审核。',
        severity: 'normal',
        isRead: true,
        createdAt: new Date(Date.now() - 172800000), // 2天前
        relatedId: 'ind-001',
        actionUrl: '/plan/plan-001?indicator=ind-001&tab=history'
      }
    ]
  } catch (error) {
    ElMessage.error('加载消息失败')
  } finally {
    loading.value = false
  }
}

// 标记单个消息为已读
const markAsRead = async (messageId: string) => {
  const message = messages.value.find(m => m.id === messageId)
  if (message && !message.isRead) {
    message.isRead = true
    // TODO: 调用API标记已读
  }
}

// 标记所有消息为已读
const markAllAsRead = async () => {
  try {
    // TODO: 调用API批量标记已读
    messages.value.forEach(m => (m.isRead = true))
    ElMessage.success('已全部标记为已读')
  } catch (error) {
    ElMessage.error('操作失败')
  }
}

// 清除已读消息
const clearReadMessages = async () => {
  try {
    // TODO: 调用API清除已读消息
    messages.value = messages.value.filter(m => !m.isRead)
    ElMessage.success('已清除已读消息')
  } catch (error) {
    ElMessage.error('操作失败')
  }
}

// 删除消息
const deleteMessage = async (messageId: string) => {
  try {
    // TODO: 调用API删除消息
    messages.value = messages.value.filter(m => m.id !== messageId)
    ElMessage.success('消息已删除')
  } catch (error) {
    ElMessage.error('删除失败')
  }
}

// 点击消息处理
const handleMessageClick = (message: Message) => {
  // 标记为已读
  markAsRead(message.id)

  // 跳转到相关页面
  if (message.actionUrl) {
    // 解析URL，可能包含查询参数
    const [path, query] = message.actionUrl.split('?')
    const params: Record<string, string> = {}

    if (query) {
      query.split('&').forEach(param => {
        const [key, value] = param.split('=')
        params[key] = value
      })
    }

    router.push({ path, query: params })
  }
}

// 刷新消息
const refreshMessages = () => {
  loadMessages()
  ElMessage.success('刷新成功')
}

// 切换分类
const switchCategory = (category: MessageCategory) => {
  activeCategory.value = category
}

// ============ 生命周期 ============
onMounted(() => {
  loadMessages()
})
</script>

<template>
  <div class="enhanced-message-center">
    <!-- 左侧分类导航 -->
    <div class="message-sidebar">
      <ElCard class="sidebar-card" shadow="never">
        <template #header>
          <div class="sidebar-header">
            <span class="sidebar-title">
              <el-icon><Bell /></el-icon>
              消息中心
            </span>
            <ElButton :icon="Refresh" size="small" circle @click="refreshMessages" />
          </div>
        </template>

        <!-- 分类列表 -->
        <div class="category-list">
          <div
            v-for="category in categories"
            :key="category.key"
            :class="['category-item', { 'is-active': activeCategory === category.key }]"
            @click="switchCategory(category.key)"
          >
            <div class="category-left">
              <el-icon class="category-icon">
                <component :is="category.icon" />
              </el-icon>
              <span class="category-label">{{ category.label }}</span>
            </div>
            <ElBadge
              v-if="categoryUnreadCount[category.key] > 0"
              :value="categoryUnreadCount[category.key]"
              :max="99"
              class="category-badge"
            />
          </div>
        </div>

        <!-- 批量操作 -->
        <div class="sidebar-actions">
          <ElButton
            type="primary"
            size="small"
            :icon="CircleCheck"
            :disabled="unreadCount === 0"
            @click="markAllAsRead"
          >
            全部已读
          </ElButton>
          <ElButton size="small" :icon="Close" @click="clearReadMessages"> 清除已读 </ElButton>
        </div>
      </ElCard>
    </div>

    <!-- 右侧消息列表 -->
    <div class="message-content">
      <ElCard class="content-card" shadow="never">
        <!-- 搜索栏 -->
        <div class="content-header">
          <ElInput
            v-model="searchKeyword"
            placeholder="搜索消息内容..."
            :prefix-icon="Search"
            clearable
            class="search-input"
          />
          <div class="header-info">
            <span class="message-count"> 共 {{ filteredMessages.length }} 条消息 </span>
            <span v-if="unreadCount > 0" class="unread-hint"> {{ unreadCount }} 条未读 </span>
          </div>
        </div>

        <!-- 消息列表 -->
        <ElScrollbar class="message-list-scroll">
          <!-- 加载状态 -->
          <div v-if="loading" class="loading-container">
            <div v-for="i in 3" :key="i" class="message-skeleton">
              <div class="skeleton-header"></div>
              <div class="skeleton-content"></div>
            </div>
          </div>

          <!-- 空状态 -->
          <div v-else-if="filteredMessages.length === 0" class="empty-container">
            <el-empty description="暂无消息">
              <template #image>
                <el-icon class="empty-icon"><Bell /></el-icon>
              </template>
            </el-empty>
          </div>

          <!-- 消息列表 -->
          <div v-else class="message-list">
            <div
              v-for="message in filteredMessages"
              :key="message.id"
              :class="['message-item', { 'is-unread': !message.isRead }]"
              @click="handleMessageClick(message)"
            >
              <!-- 未读指示器 -->
              <div v-if="!message.isRead" class="unread-dot"></div>

              <!-- 消息图标 -->
              <div class="message-icon" :class="getIconClass(message)">
                <el-icon>
                  <component :is="getMessageIcon(message.type)" />
                </el-icon>
              </div>

              <!-- 消息内容 -->
              <div class="message-body">
                <div class="message-header">
                  <div class="message-title-row">
                    <h4 class="message-title">{{ message.title }}</h4>
                    <div class="message-tags">
                      <ElTag
                        :type="
                          message.type === 'approval'
                            ? 'warning'
                            : message.type === 'alert'
                              ? 'danger'
                              : 'info'
                        "
                        size="small"
                        effect="light"
                      >
                        {{ getMessageTypeLabel(message.type) }}
                      </ElTag>
                      <ElTag
                        v-if="message.severity && message.severity !== 'normal'"
                        :type="message.severity === 'severe' ? 'danger' : 'warning'"
                        size="small"
                        effect="plain"
                      >
                        {{ getSeverityLabel(message.severity) }}
                      </ElTag>
                    </div>
                  </div>
                  <div class="message-time">
                    <ElTooltip :content="formatDateTime(message.createdAt)">
                      <span>{{ getRelativeTime(message.createdAt) }}</span>
                    </ElTooltip>
                  </div>
                </div>

                <p class="message-text">{{ message.content }}</p>

                <!-- 操作按钮 -->
                <div class="message-actions" @click.stop>
                  <ElButton
                    v-if="!message.isRead"
                    type="primary"
                    size="small"
                    link
                    @click="markAsRead(message.id)"
                  >
                    标为已读
                  </ElButton>
                  <ElDropdown trigger="click">
                    <ElButton size="small" link>
                      更多
                      <el-icon class="el-icon--right"><Close /></el-icon>
                    </ElButton>
                    <template #dropdown>
                      <ElDropdownMenu>
                        <ElDropdownItem :icon="Delete" @click="deleteMessage(message.id)">
                          删除消息
                        </ElDropdownItem>
                      </ElDropdownMenu>
                    </template>
                  </ElDropdown>
                </div>
              </div>
            </div>
          </div>
        </ElScrollbar>
      </ElCard>
    </div>
  </div>
</template>

<style scoped>
.enhanced-message-center {
  display: flex;
  gap: 20px;
  height: calc(100vh - 140px);
}

/* 左侧边栏 */
.message-sidebar {
  width: 240px;
  flex-shrink: 0;
}

.sidebar-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.sidebar-card :deep(.el-card__body) {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sidebar-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

/* 分类列表 */
.category-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.category-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  margin-bottom: 4px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.category-item:hover {
  background: var(--el-fill-color-light);
}

.category-item.is-active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.category-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.category-icon {
  font-size: 18px;
}

.category-label {
  font-size: 14px;
}

.category-badge :deep(.el-badge__content) {
  font-size: 10px;
  height: 16px;
  line-height: 16px;
  padding: 0 4px;
  border-radius: 8px;
}

/* 批量操作 */
.sidebar-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-light);
}

.sidebar-actions .el-button {
  width: 100%;
}

/* 右侧内容区 */
.message-content {
  flex: 1;
  min-width: 0;
}

.content-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.content-card :deep(.el-card__body) {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}

/* 搜索栏 */
.content-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--el-border-color-light);
}

.search-input {
  width: 300px;
}

.header-info {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.unread-hint {
  color: var(--el-color-warning);
  font-weight: 500;
}

/* 消息列表滚动区 */
.message-list-scroll {
  flex: 1;
}

.message-list {
  padding: 12px 20px;
}

/* 消息项 */
.message-item {
  display: flex;
  gap: 16px;
  padding: 16px;
  margin-bottom: 12px;
  background: var(--el-bg-color-page);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  position: relative;
  overflow: hidden;
}

.message-item:hover {
  background: var(--el-fill-color-light);
  transform: translateX(4px);
}

.message-item.is-unread {
  background: var(--el-color-primary-light-9);
}

.message-item.is-unread:hover {
  background: var(--el-color-primary-light-8);
}

/* 未读指示点 */
.unread-dot {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: linear-gradient(
    180deg,
    var(--el-color-primary) 0%,
    var(--el-color-primary-light-3) 100%
  );
}

/* 消息图标 */
.message-icon {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  font-size: 20px;
}

.message-icon.icon-approval {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
}

.message-icon.icon-alert {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
}

.message-icon.icon-severe {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

.message-icon.icon-task {
  background: var(--el-color-info-light-9);
  color: var(--el-color-info);
}

.message-icon.icon-system {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
}

.message-icon.icon-read {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-placeholder);
}

/* 消息内容 */
.message-body {
  flex: 1;
  min-width: 0;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.message-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.message-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-item.is-unread .message-title {
  color: var(--el-color-primary);
}

.message-tags {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.message-time {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  flex-shrink: 0;
  margin-left: 8px;
}

.message-text {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--el-text-color-regular);
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.message-actions {
  display: flex;
  gap: 8px;
}

/* 加载骨架屏 */
.loading-container {
  padding: 20px;
}

.message-skeleton {
  padding: 16px;
  margin-bottom: 12px;
  background: var(--el-bg-color-page);
  border-radius: var(--radius-md);
}

.skeleton-header {
  width: 60%;
  height: 20px;
  background: linear-gradient(
    90deg,
    var(--el-fill-color-light) 25%,
    var(--el-fill-color) 50%,
    var(--el-fill-color-light) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s infinite;
  border-radius: 4px;
  margin-bottom: 12px;
}

.skeleton-content {
  width: 100%;
  height: 14px;
  background: linear-gradient(
    90deg,
    var(--el-fill-color-light) 25%,
    var(--el-fill-color) 50%,
    var(--el-fill-color-light) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s infinite;
  border-radius: 4px;
}

@keyframes skeleton-loading {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

/* 空状态 */
.empty-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
}

.empty-icon {
  font-size: 64px;
  color: var(--el-text-color-placeholder);
}

/* 响应式 */
@media (max-width: 768px) {
  .enhanced-message-center {
    flex-direction: column;
  }

  .message-sidebar {
    width: 100%;
    max-height: 200px;
  }

  .category-list {
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .category-item {
    flex-shrink: 0;
    margin-right: 8px;
    margin-bottom: 0;
  }

  .search-input {
    width: 200px;
  }
}
</style>
