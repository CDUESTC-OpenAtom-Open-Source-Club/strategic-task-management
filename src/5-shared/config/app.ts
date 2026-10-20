/**
 * Application Configuration
 *
 * General application settings and constants
 */

/**
 * Application name
 */
export const APP_NAME = '战略任务管理系统'

/**
 * Application version
 */
export const APP_VERSION = import.meta.env['VITE_APP_VERSION'] || '1.3.0'

/**
 * Default page size for pagination
 */
export const DEFAULT_PAGE_SIZE = 20

/**
 * Page size options
 */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

/**
 * Date format
 */
export const DATE_FORMAT = 'YYYY-MM-DD'

/**
 * DateTime format
 */
export const DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss'

/**
 * Time format
 */
export const TIME_FORMAT = 'HH:mm:ss'

/**
 * Supported locales
 */
export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const

/**
 * Default locale
 */
export const DEFAULT_LOCALE = 'zh-CN'

/**
 * Token storage key
 */
export const TOKEN_KEY = 'auth_token'

/**
 * Refresh token storage key
 */
export const REFRESH_TOKEN_KEY = 'refresh_token'

/**
 * User info storage key
 */
export const USER_INFO_KEY = 'user_info'

/**
 * Theme storage key
 */
export const THEME_KEY = 'theme'

/**
 * Language storage key
 */
export const LANGUAGE_KEY = 'language'

/**
 * Max file upload size (bytes)
 */
export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

/**
 * Allowed file types for upload
 */
export const ALLOWED_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]

/**
 * Debounce delay (ms)
 */
export const DEBOUNCE_DELAY = 300

/**
 * Throttle delay (ms)
 */
export const THROTTLE_DELAY = 1000
