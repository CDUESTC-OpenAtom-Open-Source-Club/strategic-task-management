/**
 * Date Formatting Utilities
 *
 * Date formatting and parsing functions using Day.js
 *
 * 时区口径：全系统统一按北京时间（Asia/Shanghai）展示。
 * 后端已把 JVM 时区锁定为 Asia/Shanghai，返回的 LocalDateTime 即北京时间；
 * 但历史数据或第三方接口可能返回带 Z 的 UTC 串，因此这里注册 utc/timezone
 * 插件，遇到明确带时区标记的时间先换算到北京时间再格式化，避免少 8 小时。
 */

import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import relativeTime from 'dayjs/plugin/relativeTime'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

export const APP_TIMEZONE = 'Asia/Shanghai'

// Configure dayjs
dayjs.locale('zh-cn')
dayjs.extend(relativeTime)
dayjs.extend(customParseFormat)
dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * 归一化时间输入：仅当字符串带有明确时区标记（Z / ±HH:mm，如第三方接口的 UTC 串）
 * 时才换算为北京时间；无时区标记的朴素时间（后端 LocalDateTime，已是北京时间）
 * 与 Date 对象保持既有行为，不做二次偏移。
 */
export function toBeijingTime(date: Date | string | number): dayjs.Dayjs {
  if (typeof date === 'string') {
    const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(date.trim())
    if (hasExplicitZone) {
      return dayjs(date).tz(APP_TIMEZONE)
    }
  }
  return dayjs(date)
}

/**
 * Format date to string with default format YYYY-MM-DD
 */
export function formatDate(date: Date | string | number, format = 'YYYY-MM-DD'): string {
  return toBeijingTime(date).format(format)
}

/**
 * Format date to short format (YYYY-MM-DD)
 */
export function formatDateShort(date: Date | string | number): string {
  return toBeijingTime(date).format('YYYY-MM-DD')
}

/**
 * Format datetime to string with default format YYYY-MM-DD HH:mm:ss
 */
export function formatDateTime(
  date: Date | string | number,
  format = 'YYYY-MM-DD HH:mm:ss'
): string {
  return toBeijingTime(date).format(format)
}

/**
 * Format time to string
 */
export function formatTime(date: Date | string | number, format = 'HH:mm:ss'): string {
  return toBeijingTime(date).format(format)
}

/**
 * Format date to Chinese format (YYYY年MM月DD日)
 */
export function formatDateChinese(date: Date | string | null | undefined): string {
  if (!date) {
    return '未设置'
  }
  const d = dayjs(date)
  if (!d.isValid()) {
    return '日期格式错误'
  }
  return d.format('YYYY年MM月DD日')
}

/**
 * Safe format date with fallback value
 */
export function safeFormatDate(
  date: Date | string | null | undefined,
  format = 'YYYY-MM-DD',
  defaultValue = '未设置'
): string {
  if (!date) {
    return defaultValue
  }
  const d = dayjs(date)
  if (!d.isValid()) {
    return defaultValue
  }
  return d.format(format)
}

/**
 * Get relative time (e.g., "2 hours ago", "3天前")
 */
export function getRelativeTime(date: Date | string | number): string {
  return dayjs(date).fromNow()
}

/**
 * Parse date string
 */
export function parseDate(dateString: string, format?: string): Date {
  return dayjs(dateString, format).toDate()
}

/**
 * Check if date is valid
 */
export function isValidDate(date: unknown): boolean {
  return dayjs(date).isValid()
}

/**
 * Get date range between start and end dates
 */
export function getDateRange(start: Date | string, end: Date | string): Date[] {
  const dates: Date[] = []
  let current = dayjs(start)
  const endDate = dayjs(end)

  while (current.isBefore(endDate) || current.isSame(endDate)) {
    dates.push(current.toDate())
    current = current.add(1, 'day')
  }

  return dates
}
