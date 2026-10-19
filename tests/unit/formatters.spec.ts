/**
 * 表单工具函数单元测试
 *
 * 测试 src/utils/formatters.ts 中的各项功能
 */

import { describe, it, expect } from 'vitest'
import {
  formatDate,
  formatDateShort,
  formatDateTime,
  formatDateChinese,
  safeFormatDate,
  formatNumber,
  formatPercentage,
  formatCurrency,
  getAlertColor,
  getAlertLabel,
  getRoleLabel,
  getStatusColor,
  getStatusLabel,
  getStatusTagType,
  getProgressColor,
  getProgressStatus,
  formatFileSize,
  validateEmail,
  validatePhone,
  validatePercentage,
  truncateText,
  groupBy,
  sortBy
} from '@/shared/lib/utils/formatters'

describe('Formatters - Date Functions', () => {
  describe('formatDate', () => {
    it('should format date with default format', () => {
      const date = '2024-01-15T10:30:00'
      const result = formatDate(date)
      expect(result).toBe('2024-01-15 10:30:00')
    })

    it('should format date with custom format', () => {
      const date = '2024-01-15T10:30:00'
      const result = formatDate(date, 'YYYY-MM-DD')
      expect(result).toBe('2024-01-15')
    })
  })

  describe('formatDateShort', () => {
    it('should format date to short format', () => {
      const date = '2024-01-15T10:30:00'
      const result = formatDateShort(date)
      expect(result).toBe('2024-01-15')
    })
  })

  describe('formatDateTime', () => {
    it('should format date to datetime format', () => {
      const date = '2024-01-15T10:30:00'
      const result = formatDateTime(date)
      expect(result).toBe('2024-01-15 10:30')
    })
  })

  describe('formatDateChinese', () => {
    it('should format date to Chinese format', () => {
      const date = '2024-01-15'
      const result = formatDateChinese(date)
      expect(result).toBe('2024年01月15日')
    })

    it('should return 未设置 for null', () => {
      expect(formatDateChinese(null)).toBe('未设置')
    })

    it('should return 未设置 for undefined', () => {
      expect(formatDateChinese(undefined)).toBe('未设置')
    })
  })

  describe('safeFormatDate', () => {
    it('should format valid date', () => {
      const date = '2024-01-15'
      const result = safeFormatDate(date)
      expect(result).toBe('2024-01-15')
    })

    it('should return default value for null', () => {
      expect(safeFormatDate(null)).toBe('未设置')
    })

    it('should return default value for undefined', () => {
      expect(safeFormatDate(undefined)).toBe('未设置')
    })

    it('should return custom default value', () => {
      expect(safeFormatDate(null, 'YYYY-MM-DD', '-')).toBe('-')
    })
  })
})

describe('Formatters - Number Functions', () => {
  describe('formatNumber', () => {
    it('should format number with default decimals', () => {
      expect(formatNumber(1234)).toBe('1,234.00')
    })

    it('should format large number', () => {
      expect(formatNumber(1234567)).toBe('1,234,567.00')
    })

    it('should format decimal', () => {
      expect(formatNumber(1234.56)).toBe('1,234.56')
    })

    it('should format with custom decimals', () => {
      expect(formatNumber(1234.567, 3)).toBe('1,234.567')
    })

    it('should handle zero', () => {
      expect(formatNumber(0)).toBe('0.00')
    })

    it('should handle negative number', () => {
      expect(formatNumber(-1234)).toBe('-1,234.00')
    })
  })

  describe('formatPercentage', () => {
    it('should format decimal to percentage', () => {
      expect(formatPercentage(0.5)).toBe('0.5%')
    })

    it('should format integer to percentage', () => {
      expect(formatPercentage(75)).toBe('75.0%')
    })

    it('should handle zero', () => {
      expect(formatPercentage(0)).toBe('0.0%')
    })
  })

  describe('formatCurrency', () => {
    it('should format as CNY by default', () => {
      expect(formatCurrency(1234.56)).toBe('¥1,234.56')
    })

    it('should format with custom currency', () => {
      expect(formatCurrency(1234.56, 'USD')).toContain('1,234.56')
    })
  })
})

describe('Formatters - Label Functions', () => {
  describe('getAlertLabel', () => {
    it('should return correct label for severe', () => {
      expect(getAlertLabel('severe')).toBe('严重')
    })

    it('should return correct label for moderate', () => {
      expect(getAlertLabel('moderate')).toBe('一般')
    })

    it('should return correct label for normal', () => {
      expect(getAlertLabel('normal')).toBe('正常')
    })
  })

  describe('getRoleLabel', () => {
    it('should format strategic_dept role', () => {
      expect(getRoleLabel('strategic_dept')).toBe('战略发展部')
    })

    it('should format functional_dept role', () => {
      expect(getRoleLabel('functional_dept')).toBe('职能部门')
    })

    it('should format secondary_college role', () => {
      expect(getRoleLabel('secondary_college')).toBe('二级学院')
    })
  })

  describe('getStatusLabel', () => {
    it('should return correct label for pending', () => {
      expect(getStatusLabel('pending')).toBe('审批中')
    })

    it('should return correct label for approved', () => {
      expect(getStatusLabel('approved')).toBe('已通过')
    })

    it('should return correct label for rejected', () => {
      expect(getStatusLabel('rejected')).toBe('已回退')
    })

    it('should return correct label for draft', () => {
      expect(getStatusLabel('draft')).toBe('草稿')
    })

    it('should return original status for unknown', () => {
      expect(getStatusLabel('unknown_status')).toBe('unknown_status')
    })
  })

  describe('getStatusTagType', () => {
    it('should return success for approved', () => {
      expect(getStatusTagType('approved')).toBe('success')
    })

    it('should return warning for pending', () => {
      expect(getStatusTagType('pending')).toBe('warning')
    })

    it('should return danger for rejected', () => {
      expect(getStatusTagType('rejected')).toBe('danger')
    })

    it('should return info for draft', () => {
      expect(getStatusTagType('draft')).toBe('info')
    })

    it('should return info for unknown status', () => {
      expect(getStatusTagType('unknown')).toBe('info')
    })
  })
})

describe('Formatters - Color Functions', () => {
  describe('getAlertColor', () => {
    it('should return correct color for severe', () => {
      expect(getAlertColor('severe')).toBe('#F56C6C')
    })

    it('should return correct color for moderate', () => {
      expect(getAlertColor('moderate')).toBe('#E6A23C')
    })

    it('should return correct color for normal', () => {
      expect(getAlertColor('normal')).toBe('#67C23A')
    })
  })

  describe('getStatusColor', () => {
    it('should return correct color for pending', () => {
      expect(getStatusColor('pending')).toBe('#E6A23C')
    })

    it('should return correct color for approved', () => {
      expect(getStatusColor('approved')).toBe('#67C23A')
    })

    it('should return correct color for rejected', () => {
      expect(getStatusColor('rejected')).toBe('#F56C6C')
    })
  })

  describe('getProgressColor', () => {
    it('should return success color for high progress', () => {
      expect(getProgressColor(80)).toBe('var(--color-success)')
      expect(getProgressColor(90)).toBe('var(--color-success)')
    })

    it('should return warning color for medium progress', () => {
      expect(getProgressColor(50)).toBe('var(--color-warning)')
      expect(getProgressColor(70)).toBe('var(--color-warning)')
    })

    it('should return danger color for low progress', () => {
      expect(getProgressColor(30)).toBe('var(--color-danger)')
      expect(getProgressColor(10)).toBe('var(--color-danger)')
    })
  })

  describe('getProgressStatus', () => {
    it('should return success for high progress', () => {
      expect(getProgressStatus(80)).toBe('success')
      expect(getProgressStatus(100)).toBe('success')
    })

    it('should return warning for medium progress', () => {
      expect(getProgressStatus(50)).toBe('warning')
      expect(getProgressStatus(70)).toBe('warning')
    })

    it('should return exception for low progress', () => {
      expect(getProgressStatus(30)).toBe('exception')
      expect(getProgressStatus(10)).toBe('exception')
    })
  })
})

describe('Formatters - File Functions', () => {
  describe('formatFileSize', () => {
    it('should format bytes', () => {
      expect(formatFileSize(0)).toBe('0 B')
      expect(formatFileSize(1024)).toBe('1 KB')
      expect(formatFileSize(1024 * 1024)).toBe('1 MB')
      expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB')
    })

    it('should format decimal values', () => {
      expect(formatFileSize(1536)).toBe('1.5 KB')
    })
  })
})

describe('Formatters - Validation Functions', () => {
  describe('validateEmail', () => {
    it('should validate correct email', () => {
      expect(validateEmail('test@example.com')).toBe(true)
      expect(validateEmail('user.name+tag@domain.co.uk')).toBe(true)
    })

    it('should reject invalid email', () => {
      expect(validateEmail('invalid')).toBe(false)
      expect(validateEmail('@example.com')).toBe(false)
      expect(validateEmail('test@')).toBe(false)
    })
  })

  describe('validatePhone', () => {
    it('should validate correct phone number', () => {
      expect(validatePhone('13800138000')).toBe(true)
      expect(validatePhone('15912345678')).toBe(true)
    })

    it('should reject invalid phone number', () => {
      expect(validatePhone('12345')).toBe(false)
      expect(validatePhone('12345678901')).toBe(false)
      expect(validatePhone('1380013800a')).toBe(false)
    })
  })

  describe('validatePercentage', () => {
    it('should accept valid percentage', () => {
      expect(validatePercentage(0)).toBe(true)
      expect(validatePercentage(50)).toBe(true)
      expect(validatePercentage(100)).toBe(true)
    })

    it('should reject invalid percentage', () => {
      expect(validatePercentage(-1)).toBe(false)
      expect(validatePercentage(101)).toBe(false)
    })
  })
})

describe('Formatters - String Functions', () => {
  describe('truncateText', () => {
    it('should not truncate short text', () => {
      expect(truncateText('Hello', 10)).toBe('Hello')
    })

    it('should truncate long text', () => {
      expect(truncateText('Hello World', 5)).toBe('Hello...')
    })

    it('should handle exact length', () => {
      expect(truncateText('Hello', 5)).toBe('Hello')
    })
  })
})

describe('Formatters - Array Functions', () => {
  describe('groupBy', () => {
    const data = [
      { category: 'A', value: 1 },
      { category: 'B', value: 2 },
      { category: 'A', value: 3 }
    ]

    it('should group array by key', () => {
      const result = groupBy(data, 'category')
      expect(result['A']).toHaveLength(2)
      expect(result['B']).toHaveLength(1)
      expect(result['A'][0].value).toBe(1)
      expect(result['A'][1].value).toBe(3)
    })
  })

  describe('sortBy', () => {
    const data = [
      { name: 'Charlie', age: 30 },
      { name: 'Alice', age: 25 },
      { name: 'Bob', age: 35 }
    ]

    it('should sort array ascending', () => {
      const result = sortBy(data, 'age', 'asc')
      expect(result[0].age).toBe(25)
      expect(result[2].age).toBe(35)
    })

    it('should sort array descending', () => {
      const result = sortBy(data, 'age', 'desc')
      expect(result[0].age).toBe(35)
      expect(result[2].age).toBe(25)
    })

    it('should sort by name alphabetically', () => {
      const result = sortBy(data, 'name', 'asc')
      expect(result[0].name).toBe('Alice')
      expect(result[2].name).toBe('Charlie')
    })
  })
})
