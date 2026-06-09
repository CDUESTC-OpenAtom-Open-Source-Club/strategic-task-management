<template>
  <div class="login-page">
    <!-- 背景层 - 轮换风景图 -->
    <div class="bg-layer">
      <transition-group name="bg-fade">
        <div
          v-for="(img, index) in bgImages"
          v-show="currentBgIndex === index"
          :key="img.id"
          class="bg-image"
          :style="{ background: img.background }"
        ></div>
      </transition-group>
      <div class="bg-overlay"></div>
    </div>

    <!-- 主内容区 -->
    <div class="login-wrapper">
      <!-- 左侧：学校信息展示区 -->
      <div class="info-panel">
        <div class="school-brand">
          <div class="school-emblem">
            <svg viewBox="0 0 80 80" class="emblem-svg">
              <rect
                x="10"
                y="10"
                width="60"
                height="60"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              />
              <rect
                x="20"
                y="20"
                width="40"
                height="40"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              />
              <path
                d="M40 25 L40 55 M30 35 L50 35 M30 45 L50 45"
                stroke="currentColor"
                stroke-width="2"
              />
            </svg>
          </div>
          <div class="school-text">
            <h1 class="school-name">战略指标管理系统</h1>
            <p class="school-name-en">Strategic Indicator Management System</p>
          </div>
        </div>

        <div class="info-content">
          <div class="info-stats">
            <div class="stat-item">
              <div class="stat-value">{{ currentTime }}</div>
              <div class="stat-label">当前时间</div>
            </div>
            <div class="stat-divider"></div>
            <div class="stat-item">
              <div class="stat-value">{{ currentDate }}</div>
              <div class="stat-label">{{ currentWeekday }}</div>
            </div>
          </div>

          <div class="info-notice">
            <div class="notice-header">
              <span class="notice-icon">📢</span>
              <span class="notice-title">系统公告</span>
            </div>
            <ul class="notice-list">
              <li v-for="announcement in loginAnnouncements" :key="announcement.id">
                {{ announcement.title }}
              </li>
            </ul>
          </div>

          <div class="info-links">
            <a href="#" class="info-link">使用手册</a>
            <span class="link-divider">|</span>
            <a href="#" class="info-link">常见问题</a>
            <span class="link-divider">|</span>
            <a href="#" class="info-link">技术支持</a>
          </div>
        </div>
      </div>

      <!-- 右侧：登录表单区 -->
      <div class="login-panel">
        <div class="login-card">
          <div class="login-header">
            <h2 class="login-title">用户登录</h2>
            <p class="login-subtitle">User Login</p>
          </div>

          <LoginForm
            ref="loginFormRef"
            :loading="loading"
            :error-message="errorMessage"
            @submit="handleSubmit"
            @forgot-password="handleForgotPassword"
          />

          <div class="login-footer">
            <div class="footer-status">
              <span class="status-indicator" :class="{ online: systemOnline }"></span>
              <span>{{ systemOnline ? '系统运行正常' : '系统维护中' }}</span>
            </div>
          </div>
        </div>

        <div class="copyright">
          <p>© 2024-{{ new Date().getFullYear() }} 战略发展部 版权所有</p>
          <p>
            <a
              href="https://beian.miit.gov.cn/"
              target="_blank"
              rel="noopener noreferrer"
              class="icp-link"
            >
              蜀ICP备2025177084号
            </a>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/features/auth/model/store'
import LoginForm from './LoginForm.vue'
import { announcementApi } from '@/features/admin/api/announcementApi'

const router = useRouter()
const authStore = useAuthStore()

// Background rotation
interface BgImage {
  id: number
  background: string
  label?: string
}

const bgImages = ref<BgImage[]>([])
const currentBgIndex = ref(0)
let bgInterval: ReturnType<typeof setInterval> | null = null
const loginAnnouncements = ref<
  Array<{
    id: number
    title: string
  }>
>([
  { id: 1, title: '2025年度战略指标填报工作已启动' },
  { id: 2, title: '请各部门于12月15日前完成数据提交' },
  { id: 3, title: '系统维护时间：每周日 02:00-06:00' }
])

const defaultBgImages: BgImage[] = [
  {
    id: 1,
    background:
      'url(https://images.unsplash.com/photo-1562774053-701939374585?w=1920&q=80) center/cover no-repeat',
    label: 'Campus Building'
  },
  {
    id: 2,
    background:
      'url(https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?w=1920&q=80) center/cover no-repeat',
    label: 'University Library'
  },
  {
    id: 3,
    background:
      'url(https://images.unsplash.com/photo-1541339907198-e08756dedf3f?w=1920&q=80) center/cover no-repeat',
    label: 'Graduation Ceremony'
  },
  {
    id: 4,
    background:
      'url(https://images.unsplash.com/photo-1498243691581-b145c3f54a5a?w=1920&q=80) center/cover no-repeat',
    label: 'Historic Hall'
  },
  {
    id: 5,
    background:
      'url(https://images.unsplash.com/photo-1571260899304-425eee4c7efc?w=1920&q=80) center/cover no-repeat',
    label: 'Evening Campus'
  }
]

// Preload background images and wait for completion
const preloadImages = (): Promise<void[]> => {
  const tasks = defaultBgImages.map(
    img =>
      new Promise<void>(resolve => {
        const match = img.background.match(/url\((.*?)\)/)
        if (!match) {
          resolve()
          return
        }
        const imgEl = new Image()
        imgEl.onload = () => resolve()
        imgEl.onerror = () => resolve()
        imgEl.src = match[1]
      })
  )
  return Promise.all(tasks)
}

const startBgRotation = () => {
  bgInterval = setInterval(() => {
    currentBgIndex.value = (currentBgIndex.value + 1) % bgImages.value.length
  }, 8000)
}

// Time display
const currentTime = ref('')
const currentDate = ref('')
const currentWeekday = ref('')
let timeInterval: ReturnType<typeof setInterval> | null = null

const updateTime = () => {
  const now = new Date()
  currentTime.value = now.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  currentDate.value = now.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
  currentWeekday.value = now.toLocaleDateString('zh-CN', { weekday: 'long' })
}

// System status
const systemOnline = ref(true)

// Login state
const loading = ref(false)
const errorMessage = ref('')
const loginFormRef = ref<InstanceType<typeof LoginForm> | null>(null)

interface LoginResultLike {
  success?: boolean
  error?: string
  shouldCountAttempt?: boolean
  isLocked?: boolean
  code?: number
}

function normalizeLoginError(
  payload: LoginResultLike | null | undefined,
  credentials: { account: string; password: string }
): { message: string; shouldCountAttempt: boolean } {
  const account = String(credentials.account || '').trim()
  const password = String(credentials.password || '')
  const rawMessage = String(payload?.error || '').trim()
  const code = Number(payload?.code ?? NaN)

  if (!account) {
    return { message: '请输入账号', shouldCountAttempt: false }
  }

  if (!password) {
    return { message: '请输入密码', shouldCountAttempt: false }
  }

  if (rawMessage.includes('账号已被禁用')) {
    return { message: '当前账号已被禁用，请联系管理员处理。', shouldCountAttempt: false }
  }

  if (
    rawMessage.includes('登录失败次数过多') ||
    rawMessage.includes('账户已被临时锁定') ||
    rawMessage.includes('账户已锁定') ||
    payload?.isLocked
  ) {
    return { message: '登录失败次数过多，请稍后再试或联系管理员。', shouldCountAttempt: false }
  }

  if (
    rawMessage.includes('用户名或密码错误') ||
    rawMessage.includes('账号或密码错误') ||
    rawMessage.includes('请求参数不合法') ||
    code === 2001 ||
    code === 1001
  ) {
    return { message: '账号或密码不正确，请重新输入。', shouldCountAttempt: true }
  }

  if (rawMessage.includes('参数验证失败')) {
    return { message: '请输入正确的账号和密码后再登录。', shouldCountAttempt: false }
  }

  if (
    rawMessage.includes('网络') ||
    rawMessage.includes('超时') ||
    rawMessage.includes('服务器') ||
    rawMessage.includes('请求失败')
  ) {
    return { message: '登录失败，请检查网络或稍后重试。', shouldCountAttempt: false }
  }

  return {
    message: rawMessage || '登录失败，请检查账号和密码后重试。',
    shouldCountAttempt: Boolean(payload?.shouldCountAttempt)
  }
}

// Handle login submit
const handleSubmit = async (credentials: { account: string; password: string }) => {
  loading.value = true
  errorMessage.value = ''

  try {
    const result = await authStore.login({
      account: credentials.account,
      password: credentials.password
    })

    if (result.success) {
      loginFormRef.value?.resetErrorCount()
      ElMessage.success(`欢迎回来，${authStore.userDepartment}`)
      const defaultRoute =
        authStore.userRole === 'strategic_dept' ? '/strategic-tasks' : '/dashboard'
      router.push(defaultRoute)
    } else {
      const normalizedError = normalizeLoginError(result, credentials)
      if (normalizedError.shouldCountAttempt) {
        loginFormRef.value?.incrementErrorCount()
      }
      errorMessage.value = normalizedError.message
      ElMessage.error(normalizedError.message)
    }
  } catch (error: unknown) {
    const normalizedError = normalizeLoginError(
      {
        error: (error as { message?: string }).message || '登录失败，请检查网络连接'
      },
      credentials
    )
    if (normalizedError.shouldCountAttempt) {
      loginFormRef.value?.incrementErrorCount()
    }
    errorMessage.value = normalizedError.message
    ElMessage.error(normalizedError.message)
  } finally {
    loading.value = false
  }
}

const handleForgotPassword = () => {
  void router.push('/forgot-password')
}

const loadLoginAnnouncements = async () => {
  try {
    const page = await announcementApi.listPublic(0, 3)
    if (Array.isArray(page.content) && page.content.length > 0) {
      loginAnnouncements.value = page.content.map(item => ({
        id: item.id,
        title: item.title
      }))
    }
  } catch (error) {
    // keep fallback static announcements
  }
}

// Lifecycle
onMounted(async () => {
  bgImages.value = defaultBgImages
  await preloadImages() // 等待所有图片加载完成后再启动轮播
  await loadLoginAnnouncements()
  startBgRotation()
  updateTime()
  timeInterval = setInterval(updateTime, 1000)
})

onUnmounted(() => {
  if (timeInterval) {
    clearInterval(timeInterval)
  }
  if (bgInterval) {
    clearInterval(bgInterval)
  }
})
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
    'Microsoft YaHei', sans-serif;
  position: relative;
  overflow: hidden;
}

/* Background layer */
.bg-layer {
  position: absolute;
  inset: 0;
  z-index: 0;
}

.bg-image {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  background-color: var(--color-primary-dark);
  transform: scale(1.05);
  transition: transform 10s ease-out;
}

.bg-fade-enter-active,
.bg-fade-leave-active {
  transition: opacity 2s ease;
}

.bg-fade-enter-from,
.bg-fade-leave-to {
  opacity: 0;
}

.bg-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(43, 109, 231, 0.85) 0%, rgba(64, 158, 255, 0.7) 100%);
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 40px 40px;
}

/* Main container */
.login-wrapper {
  position: relative;
  z-index: 10;
  display: flex;
  width: 100%;
  max-width: 1100px;
  min-height: 600px;
  margin: var(--spacing-xl);
  background: var(--bg-white);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

/* Left info panel */
.info-panel {
  flex: 1;
  background: linear-gradient(180deg, var(--color-primary-dark) 0%, #1a4a8a 100%);
  padding: calc(var(--spacing-2xl) * 2) var(--spacing-2xl);
  display: flex;
  flex-direction: column;
  color: var(--bg-white);
  position: relative;
}

.info-panel::after {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 1px;
  background: linear-gradient(180deg, transparent, var(--color-warning), transparent);
}

/* School brand */
.school-brand {
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
  margin-bottom: calc(var(--spacing-2xl) * 2);
  padding-bottom: var(--spacing-2xl);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.school-emblem {
  width: 64px;
  height: 64px;
  color: var(--color-warning);
  flex-shrink: 0;
}

.emblem-svg {
  width: 100%;
  height: 100%;
}

.school-text {
  flex: 1;
}

.school-name {
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 var(--spacing-xs) 0;
  letter-spacing: 2px;
  color: var(--bg-white);
}

.school-name-en {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  margin: 0;
  letter-spacing: 1px;
  text-transform: uppercase;
}

/* Info content */
.info-content {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.info-stats {
  display: flex;
  align-items: center;
  gap: var(--spacing-2xl);
  padding: var(--spacing-2xl);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--radius-md);
  margin-bottom: var(--spacing-2xl);
}

.stat-item {
  flex: 1;
  text-align: center;
}

.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--color-warning);
  font-family: 'Consolas', 'Monaco', monospace;
  letter-spacing: 1px;
}

.stat-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin-top: var(--spacing-xs);
}

.stat-divider {
  width: 1px;
  height: 40px;
  background: rgba(255, 255, 255, 0.2);
}

.info-notice {
  flex: 1;
  padding: var(--spacing-xl);
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--radius-md);
  margin-bottom: var(--spacing-2xl);
}

.notice-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-lg);
  padding-bottom: var(--spacing-md);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.notice-icon {
  font-size: 16px;
}

.notice-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-warning);
}

.notice-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.notice-list li {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  padding: var(--spacing-sm) 0;
  padding-left: var(--spacing-lg);
  position: relative;
  line-height: 1.5;
}

.notice-list li::before {
  content: '•';
  position: absolute;
  left: 0;
  color: var(--color-warning);
}

.notice-list li + li {
  border-top: 1px dashed rgba(255, 255, 255, 0.1);
}

.info-links {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-md);
  padding-top: var(--spacing-lg);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.info-link {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  text-decoration: none;
  transition: color var(--transition-fast);
}

.info-link:hover {
  color: var(--color-warning);
}

.link-divider {
  color: rgba(255, 255, 255, 0.3);
  font-size: 12px;
}

/* Right login panel */
.login-panel {
  width: 420px;
  padding: calc(var(--spacing-2xl) * 2) var(--spacing-2xl);
  display: flex;
  flex-direction: column;
  background: var(--bg-white);
}

.login-card {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.login-header {
  text-align: center;
  margin-bottom: calc(var(--spacing-2xl) + var(--spacing-lg));
}

.login-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--color-primary-dark);
  margin: 0 0 var(--spacing-sm) 0;
  letter-spacing: 4px;
}

.login-subtitle {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 2px;
}

.login-footer {
  margin-top: auto;
  padding-top: var(--spacing-2xl);
  border-top: 1px solid var(--border-color);
}

.footer-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  font-size: 12px;
  color: var(--text-secondary);
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-danger);
}

.status-indicator.online {
  background: var(--color-success);
  box-shadow: 0 0 0 3px rgba(103, 194, 58, 0.2);
}

.copyright {
  text-align: center;
  margin-top: var(--spacing-2xl);
  padding-top: var(--spacing-lg);
  border-top: 1px solid var(--border-color);
}

.copyright p {
  margin: 0;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.8;
}

.copyright .icp-link {
  color: var(--text-secondary);
  text-decoration: none;
  transition: color var(--transition-fast);
}

.copyright .icp-link:hover {
  color: var(--color-primary);
}

/* Responsive */
@media (max-width: 900px) {
  .login-wrapper {
    flex-direction: column;
    max-width: 480px;
    min-height: auto;
  }

  .info-panel {
    padding: var(--spacing-2xl);
  }

  .info-panel::after {
    display: none;
  }

  .school-brand {
    margin-bottom: var(--spacing-2xl);
    padding-bottom: var(--spacing-lg);
  }

  .info-stats {
    margin-bottom: var(--spacing-xl);
    padding: var(--spacing-lg);
  }

  .info-notice {
    display: none;
  }

  .login-panel {
    width: 100%;
    padding: var(--spacing-2xl);
  }

  .login-header {
    margin-bottom: var(--spacing-2xl);
  }
}

@media (max-width: 480px) {
  .login-wrapper {
    margin: 0;
    border-radius: 0;
    min-height: 100vh;
  }

  .school-emblem {
    width: 48px;
    height: 48px;
  }

  .school-name {
    font-size: 18px;
  }

  .stat-value {
    font-size: 18px;
  }

  .login-title {
    font-size: 20px;
    letter-spacing: 2px;
  }
}
</style>
