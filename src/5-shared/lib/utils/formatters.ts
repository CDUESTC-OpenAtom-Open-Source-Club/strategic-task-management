/**
 * 基础工具函数
 *
 * @module utils/formatters
 */

import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import type { AlertLevel, UserRole } from '@/shared/types'
import { logger } from '@/shared/lib/utils/logger'

// Configure dayjs
dayjs.locale('zh-cn')

// ============================================================================
// 日期格式化
// ============================================================================

export const formatDate = (date: Date | string, format = 'YYYY-MM-DD HH:mm:ss') => {
  return dayjs(date).format(format)
}

export const formatDateShort = (date: Date | string) => {
  return dayjs(date).format('YYYY-MM-DD')
}

export const formatDateTime = (date: Date | string) => {
  return dayjs(date).format('YYYY-MM-DD HH:mm')
}

export const formatRelativeTime = (date: Date | string) => {
  return dayjs(date).fromNow()
}

export const formatDateChinese = (date: Date | string | null | undefined): string => {
  if (!date) {
    return '未设置'
  }
  const d = dayjs(date)
  if (!d.isValid()) {
    return '日期格式错误'
  }
  return d.format('YYYY年MM月DD日')
}

export const safeFormatDate = (
  date: Date | string | null | undefined,
  format = 'YYYY-MM-DD',
  defaultValue = '未设置'
): string => {
  if (!date) {
    return defaultValue
  }
  const d = dayjs(date)
  if (!d.isValid()) {
    return defaultValue
  }
  return d.format(format)
}

// ============================================================================
// 数字格式化
// ============================================================================

export const formatNumber = (num: number, decimals = 2) => {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(num)
}

export const formatPercentage = (value: number, decimals = 1) => {
  return `${formatNumber(value, decimals)}%`
}

export const formatCurrency = (amount: number, currency = 'CNY') => {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: currency
  }).format(amount)
}

// ============================================================================
// 颜色和标签
// ============================================================================

export const getAlertColor = (level: AlertLevel): string => {
  const colors = {
    severe: '#F56C6C',
    moderate: '#E6A23C',
    normal: '#67C23A'
  }
  return colors[level] || colors.normal
}

export const getAlertLabel = (level: AlertLevel): string => {
  const labels = {
    severe: '严重',
    moderate: '一般',
    normal: '正常'
  }
  return labels[level] || labels.normal
}

export const getRoleLabel = (role: UserRole): string => {
  const labels = {
    strategic_dept: '战略发展部',
    functional_dept: '职能部门',
    secondary_college: '二级学院'
  }
  return labels[role] || role
}

export const getStatusColor = (status: string): string => {
  const statusColors: Record<string, string> = {
    pending: '#E6A23C',
    approved: '#67C23A',
    rejected: '#F56C6C',
    draft: '#909399',
    active: '#409EFF',
    completed: '#67C23A',
    cancelled: '#F56C6C',
    normal: '#67C23A',
    warning: '#E6A23C',
    danger: '#F56C6C',
    success: '#67C23A',
    exception: '#F56C6C'
  }
  return statusColors[status] || '#909399'
}

export const getStatusLabel = (status: string): string => {
  const statusLabels: Record<string, string> = {
    pending: '审批中',
    approved: '已通过',
    rejected: '已回退',
    draft: '草稿',
    active: '进行中',
    completed: '已完成',
    cancelled: '已取消',
    normal: '正常',
    warning: '预警',
    danger: '严重',
    success: '成功',
    exception: '异常'
  }
  return statusLabels[status] || status
}

export type StatusTagType = 'success' | 'warning' | 'danger' | 'info' | 'primary'

export const getStatusTagType = (status: string): StatusTagType => {
  const map: Record<string, StatusTagType> = {
    approved: 'success',
    completed: 'success',
    passed: 'success',
    pending: 'warning',
    processing: 'warning',
    in_progress: 'warning',
    rejected: 'danger',
    overdue: 'danger',
    failed: 'danger',
    draft: 'info',
    inactive: 'info',
    active: 'primary',
    create: 'success',
    update: 'warning',
    delete: 'danger',
    submit: 'primary',
    approve: 'success',
    reject: 'danger',
    withdraw: 'info'
  }
  if (Object.hasOwn(map, status)) {
    return map[status] as StatusTagType
  }
  return 'info'
}

export const getProgressColor = (progress: number): string => {
  if (progress >= 80) {
    return 'var(--color-success)'
  }
  if (progress >= 50) {
    return 'var(--color-warning)'
  }
  return 'var(--color-danger)'
}

export const getProgressStatus = (progress: number): 'success' | 'warning' | 'exception' => {
  if (progress >= 80) {
    return 'success'
  }
  if (progress >= 50) {
    return 'warning'
  }
  return 'exception'
}

// ============================================================================
// 文件处理
// ============================================================================

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) {
    return '0 B'
  }
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

export const getFileExtension = (filename: string): string => {
  return filename.slice(((filename.lastIndexOf('.') - 1) >>> 0) + 2)
}

export const isImageFile = (filename: string): boolean => {
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']
  return imageExtensions.includes(getFileExtension(filename).toLowerCase())
}

export const isDocumentFile = (filename: string): boolean => {
  const docExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']
  return docExtensions.includes(getFileExtension(filename).toLowerCase())
}

// ============================================================================
// 验证函数
// ============================================================================

export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export const validatePhone = (phone: string): boolean => {
  const phoneRegex = /^1[3-9]\d{9}$/
  return phoneRegex.test(phone)
}

export const validatePercentage = (value: number): boolean => {
  return value >= 0 && value <= 100
}

export const validateRequired = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return false
  }
  if (typeof value === 'string') {
    return value.trim().length > 0
  }
  if (Array.isArray(value)) {
    return value.length > 0
  }
  return true
}

// ============================================================================
// 字符串工具
// ============================================================================

export const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {
    return text
  }
  return text.slice(0, maxLength) + '...'
}

export const highlightText = (text: string, highlight: string): string => {
  if (!highlight) {
    return text
  }
  const regex = new RegExp(`(${highlight})`, 'gi')
  return text.replace(regex, '<mark>$1</mark>')
}

// ============================================================================
// 数组工具
// ============================================================================

export const groupBy = <T>(array: T[], key: keyof T): Record<string, T[]> => {
  return array.reduce(
    (groups, item) => {
      const group = String(item[key])
      if (!groups[group]) {
        groups[group] = []
      }
      groups[group].push(item)
      return groups
    },
    {} as Record<string, T[]>
  )
}

export const sortBy = <T>(array: T[], key: keyof T, order: 'asc' | 'desc' = 'asc'): T[] => {
  return [...array].sort((a, b) => {
    if (order === 'asc') {
      return a[key] > b[key] ? 1 : -1
    } else {
      return a[key] < b[key] ? 1 : -1
    }
  })
}

export const uniqueBy = <T>(array: T[], key: keyof T): T[] => {
  const seen = new Set()
  return array.filter(item => {
    const value = item[key]
    if (seen.has(value)) {
      return false
    }
    seen.add(value)
    return true
  })
}

// ============================================================================
// URL 工具
// ============================================================================

export const buildUrl = (baseUrl: string, params: Record<string, unknown>): string => {
  const url = new URL(baseUrl)
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.append(key, String(value))
    }
  })
  return url.toString()
}

// ============================================================================
// 存储工具
// ============================================================================

export const storage = {
  get: <T>(key: string, defaultValue?: T): T | null => {
    try {
      const item = localStorage.getItem(key)
      return item ? JSON.parse(item) : defaultValue || null
    } catch {
      return defaultValue || null
    }
  },

  set: <T>(key: string, value: T): void => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch (error) {
      logger.error('Failed to set localStorage item:', error)
    }
  },

  remove: (key: string): void => {
    try {
      localStorage.removeItem(key)
    } catch (error) {
      logger.error('Failed to remove localStorage item:', error)
    }
  },

  clear: (): void => {
    try {
      localStorage.clear()
    } catch (error) {
      logger.error('Failed to clear localStorage:', error)
    }
  }
}

// ============================================================================
// 函数工具
// ============================================================================

export const debounce = <T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout | null = null
  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout)
    }
    timeout = setTimeout(() => func(...args), wait)
  }
}

export const throttle = <T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): ((...args: Parameters<T>) => void) => {
  let inThrottle: boolean = false
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args)
      inThrottle = true
      setTimeout(() => (inThrottle = false), limit)
    }
  }
}

export const deepClone = <T>(obj: T): T => {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T
  }
  if (obj instanceof Array) {
    return obj.map(item => deepClone(item)) as T
  }
  if (typeof obj === 'object') {
    const clonedObj = {} as T
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        clonedObj[key] = deepClone(obj[key])
      }
    }
    return clonedObj
  }
  return obj
}
