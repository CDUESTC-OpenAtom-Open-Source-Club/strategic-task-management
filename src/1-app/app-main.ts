/**
 * Application Main Entry Point
 *
 * Vue application initialization and setup
 * Migrated from src/main.ts
 *
 * **Validates: Requirements 3.1 - Application Layer**
 */

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './providers/router'

// Element Plus全量样式
import 'element-plus/dist/index.css'
// Element Plus Icons样式
import '@element-plus/icons-vue'

// Global styles
import './styles/index.css'
import './styles/unified-styles.css'
import './styles/_colors.css'

// App component
import App from './App.vue'

// Utilities
import { autoHealthCheck } from '@/shared/lib/utils/apiHealth'
import { performanceMonitor } from '@/shared/lib/utils/performance'
import { registerSharedDirectives } from '@/shared/lib/directives'

/**
 * Create Vue application instance
 */
const app = createApp(App)
const pinia = createPinia()

/**
 * Register global directives
 */
registerSharedDirectives(app)

/**
 * Use plugins
 */
app.use(pinia)
app.use(router)

/**
 * Global error handling
 */
app.config.errorHandler = (err, _vm, info) => {
  console.error('Global error:', err)
  console.error('Error info:', info)
}

/**
 * Mount application
 */
app.mount('#app')

/**
 * Print application version information
 */
const version = import.meta.env['VITE_APP_VERSION'] || '1.3.0'
const commitHash = import.meta.env['VITE_APP_COMMIT_HASH'] || 'unknown'
const buildTime = new Date().toISOString()
if (import.meta.env.DEV || import.meta.env.PROD) {
  // eslint-disable-next-line no-console
  console.log(
    `%c🚀 战略指标管理系统 SISM v${version}`,
    'color: #409EFF; font-size: 16px; font-weight: bold'
  )
  // eslint-disable-next-line no-console
  console.log(`%c🔖 Commit: ${commitHash}`, 'color: #909399; font-size: 12px')
  // eslint-disable-next-line no-console
  console.log(`%c📅 构建时间: ${buildTime}`, 'color: #67C23A; font-size: 12px')
  // eslint-disable-next-line no-console
  console.log(`%c🌍 环境: ${import.meta.env.MODE}`, 'color: #E6A23C; font-size: 12px')
}

/**
 * Initialize performance monitoring
 * **Validates: Requirements 4.1.1, 4.1.2, 4.1.3, 4.1.4, 4.1.5**
 */
performanceMonitor.init({
  enabled: true,
  consoleOutput: import.meta.env.DEV, // 开发环境在控制台输出
  reportInterval: 60000, // 每分钟上报一次
  sampleRate: 1.0 // 100% 采样
  // endpoint: '/api/v1/metrics/performance', // 可配置上报端点
})

/**
 * Development environment logging
 */
if (import.meta.env.DEV) {
  // eslint-disable-next-line no-console
  console.log('🚀 [App Main] Application started')
}

/**
 * Auto health check
 * Delay diagnostics until the initial route/auth state settles.
 */
void router.isReady().then(() => {
  window.setTimeout(() => {
    autoHealthCheck()
  }, 3000)
})

/**
 * Export app instance for testing purposes
 */
export { app, pinia, router }
