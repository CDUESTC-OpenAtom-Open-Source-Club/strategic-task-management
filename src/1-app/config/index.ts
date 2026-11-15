import { API_BASE_URL, API_TIMEOUT } from '@/shared/config/api'
import { APP_COMMIT_HASH, APP_VERSION } from '@/shared/config/app-version'

/**
 * Application Configuration
 *
 * Application-level configuration constants and settings
 *
 * **Validates: Requirements 3.1 - Application Layer**
 */

/**
 * Application version
 *
 * 构建期由 scripts/resolve-app-version.mjs 注入，禁止在 .env 手工维护。
 */
export { APP_VERSION }

/**
 * Application name
 */
export const APP_NAME = '战略指标管理系统'

/**
 * Application subtitle
 */
export const APP_SUBTITLE = 'Strategic Indicator Management System'

/**
 * Environment configuration
 */
export const ENV = {
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
  mode: import.meta.env.MODE
}

/**
 * API configuration
 */
export const API_CONFIG = {
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT
}

/**
 * Build information
 */
export const BUILD_INFO = {
  version: APP_VERSION,
  commitHash: APP_COMMIT_HASH,
  time: new Date().toISOString(),
  mode: ENV.mode
}

/**
 * Performance monitoring configuration
 */
export const PERFORMANCE_CONFIG = {
  enabled: true,
  consoleOutput: ENV.isDev,
  reportInterval: 60000, // 1 minute
  sampleRate: 1.0 // 100%
}

/**
 * Health check configuration
 */
export const HEALTH_CHECK_CONFIG = {
  enabled: true,
  interval: 300000, // 5 minutes
  endpoint: '/api/health'
}
