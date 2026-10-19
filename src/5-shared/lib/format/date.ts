/**
 * Date Formatting Utilities
 *
 * Date formatting and parsing functions using Day.js
 *
 * 时区口径（2026-10-19 用户定案）：不硬编码时区——后端记录的是服务器本地时间，
 * 前端按「浏览器所在时区」展示。部署到不同时区的服务器/用户时自动适配。
 * 带明确时区标记的串（Z / ±HH:mm）按标记换算到浏览器时区；
 * 无标记的朴素串（后端 LocalDateTime，即服务器本地时间）按浏览器本地解析。
 */

import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import relativeTime from 'dayjs/plugin/relativeTime'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

/** 浏览器本地时区（运行时解析，不做硬编码） */
export const APP_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

// Configure dayjs
dayjs.locale('zh-cn')
dayjs.extend(relativeTime)
dayjs.extend(customParseFormat)
dayjs.extend(utc)
dayjs.extend(timezone)

/**
 * 归一化时间输入：带明确时区标记（Z / ±HH:mm）的串换算到浏览器本地时区；
 * 无标记的朴素时间（后端 LocalDateTime = 服务器本地时间）与 Date 对象按本地解析。
 */
export function toLocalTime(date: Date | string | number): dayjs.Dayjs {
  if (typeof date === 'string') {
    const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(date.trim())
    if (hasExplicitZone) {
      return dayjs(date).tz(APP_TIMEZONE)
    }
  }
  return dayjs(date)
}

/** 兼容旧名（历史调用方仍引用 toBeijingTime） */
export const toBeijingTime = toLocalTime

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
