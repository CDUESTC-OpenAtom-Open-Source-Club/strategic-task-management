import { API_BASE_URL, API_TIMEOUT } from '@/shared/config/api'

/**
 * Application Configuration
 *
 * Application-level configuration constants and settings
 *
 * **Validates: Requirements 3.1 - Application Layer**
 */

/**
 * Application version
 */
export const APP_VERSION = import.meta.env['VITE_APP_VERSION'] || '1.3.0'

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
  commitHash: import.meta.env['VITE_APP_COMMIT_HASH'] || 'unknown',
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
