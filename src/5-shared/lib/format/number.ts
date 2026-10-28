/**
 * Number Formatting Utilities
 *
 * Number formatting and parsing functions
 */

/**
 * Format number with thousand separators
 * @param value - Number to format
 * @param decimals - Number of decimal places (default: 2)
 */
export function formatNumber(value: number, decimals = 2): string {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value)
}

/**
 * Format as currency (CNY)
 * @param value - Amount to format
 * @param currency - Currency code (default: 'CNY')
 */
export function formatCurrency(value: number, currency = 'CNY'): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: currency
  }).format(value)
}

/**
 * Format as percentage
 * @param value - Value to format as percentage
 * @param decimals - Number of decimal places (default: 1)
 */
export function formatPercentage(value: number, decimals = 1): string {
  return `${formatNumber(value, decimals)}%`
}

/**
 * 权重显示格式化（2026-10-28）
 *
 * 列表里的权重口径是「本计划内全部指标的权重占比，合计 100」，本身就是百分数
 * （如 60、40、100），因此不能再乘 100。这里统一补 `%` 并去掉无意义的小数位，
 * 空值显示为 `—`，避免出现 60 / 60.00 / 6000% 三种写法混用。
 *
 * 注意：不要与 feature 内的 formatWeightAsPercentage（src/3-features/indicator/lib/calculations.ts，
 * 把 0-1 小数转百分比）混用——两者口径不同。
 */
export function formatWeightPercent(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '—'
  }

  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return '—'
  }

  return `${Number(numeric.toFixed(2))}%`
}

/**
 * Format file size in human-readable format
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) {
    return '0 B'
  }

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

/**
 * Parse number from string
 */
export function parseNumber(value: string): number | null {
  const cleaned = value.replace(/[^\d.-]/g, '')
  const parsed = parseFloat(cleaned)
  return isNaN(parsed) ? null : parsed
}

/**
 * Clamp number between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Round to decimal places
 */
export function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}
