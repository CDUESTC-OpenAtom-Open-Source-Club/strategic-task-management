/**
 * Format Module
 *
 * Exports all formatting utilities
 */

// Date formatting
export {
  formatDate,
  formatDateShort,
  formatDateTime,
  formatTime,
  formatDateChinese,
  safeFormatDate,
  getRelativeTime,
  parseDate,
  isValidDate,
  getDateRange
} from './date'

// Number formatting
export {
  formatNumber,
  formatCurrency,
  formatPercentage,
  formatWeightPercent,
  formatFileSize,
  parseNumber,
  clamp,
  roundTo
} from './number'

// String formatting
export {
  capitalize,
  toTitleCase,
  truncate,
  highlightText,
  stripHtml,
  toKebabCase,
  toCamelCase,
  toSnakeCase,
  escapeHtml,
  randomString
} from './string'
