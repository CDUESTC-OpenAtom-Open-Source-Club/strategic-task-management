/**
 * Number Formatting Tests
 *
 * Unit tests for number formatting utilities
 */

import { describe, it, expect } from 'vitest'
import {
  formatNumber,
  formatCurrency,
  formatPercentage,
  formatFileSize,
  formatWeightPercent,
  parseNumber,
  clamp,
  roundTo
} from '../number'

describe('Number Formatting', () => {
  describe('formatNumber', () => {
    it('should format number with default decimals', () => {
      expect(formatNumber(1234.5678)).toBe('1,234.57')
    })

    it('should format number with custom decimals', () => {
      expect(formatNumber(1234.5678, 3)).toBe('1,234.568')
    })

    it('should format number with zero decimals', () => {
      expect(formatNumber(1234.5678, 0)).toBe('1,235')
    })

    it('should format integer', () => {
      expect(formatNumber(1234, 2)).toBe('1,234.00')
    })

    it('should format zero', () => {
      expect(formatNumber(0)).toBe('0.00')
    })

    it('should format negative number', () => {
      expect(formatNumber(-1234.56)).toBe('-1,234.56')
    })

    it('should format large number', () => {
      expect(formatNumber(1234567.89)).toBe('1,234,567.89')
    })
  })

  describe('formatCurrency', () => {
    it('should format as CNY by default', () => {
      const result = formatCurrency(1234.56)
      expect(result).toContain('1,234.56')
      expect(result).toContain('¥')
    })

    it('should format with custom currency', () => {
      const result = formatCurrency(1234.56, 'USD')
      expect(result).toContain('1,234.56')
    })

    it('should format zero', () => {
      const result = formatCurrency(0)
      expect(result).toContain('0.00')
    })

    it('should format negative amount', () => {
      const result = formatCurrency(-1234.56)
      expect(result).toContain('1,234.56')
    })
  })

  describe('formatPercentage', () => {
    it('should format percentage with default decimals', () => {
      expect(formatPercentage(85.5)).toBe('85.5%')
    })

    it('should format percentage with custom decimals', () => {
      expect(formatPercentage(85.567, 2)).toBe('85.57%')
    })

    it('should format zero percentage', () => {
      expect(formatPercentage(0)).toBe('0.0%')
    })

    it('should format 100 percentage', () => {
      expect(formatPercentage(100)).toBe('100.0%')
    })

    it('should format percentage over 100', () => {
      expect(formatPercentage(150.5)).toBe('150.5%')
    })
  })

  describe('formatFileSize', () => {
    it('should format bytes', () => {
      expect(formatFileSize(0)).toBe('0 B')
      expect(formatFileSize(500)).toBe('500 B')
    })

    it('should format kilobytes', () => {
      expect(formatFileSize(1024)).toBe('1 KB')
      expect(formatFileSize(1536)).toBe('1.5 KB')
    })

    it('should format megabytes', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1 MB')
      expect(formatFileSize(1024 * 1024 * 2.5)).toBe('2.5 MB')
    })

    it('should format gigabytes', () => {
      expect(formatFileSize(1024 * 1024 * 1024)).toBe('1 GB')
      expect(formatFileSize(1024 * 1024 * 1024 * 1.5)).toBe('1.5 GB')
    })

    it('should format terabytes', () => {
      expect(formatFileSize(1024 * 1024 * 1024 * 1024)).toBe('1 TB')
    })
  })

  describe('parseNumber', () => {
    it('should parse integer string', () => {
      expect(parseNumber('1234')).toBe(1234)
    })

    it('should parse decimal string', () => {
      expect(parseNumber('1234.56')).toBe(1234.56)
    })

    it('should parse negative number', () => {
      expect(parseNumber('-1234.56')).toBe(-1234.56)
    })

    it('should parse number with commas', () => {
      expect(parseNumber('1,234.56')).toBe(1234.56)
    })

    it('should parse number with currency symbol', () => {
      expect(parseNumber('¥1,234.56')).toBe(1234.56)
    })

    it('should return null for invalid string', () => {
      expect(parseNumber('abc')).toBe(null)
    })

    it('should return null for empty string', () => {
      expect(parseNumber('')).toBe(null)
    })
  })

  describe('clamp', () => {
    it('should clamp value within range', () => {
      expect(clamp(50, 0, 100)).toBe(50)
    })

    it('should clamp value to minimum', () => {
      expect(clamp(-10, 0, 100)).toBe(0)
    })

    it('should clamp value to maximum', () => {
      expect(clamp(150, 0, 100)).toBe(100)
    })

    it('should handle equal min and max', () => {
      expect(clamp(50, 10, 10)).toBe(10)
    })

    it('should handle negative range', () => {
      expect(clamp(-50, -100, -10)).toBe(-50)
    })
  })

  describe('roundTo', () => {
    it('should round to decimal places', () => {
      expect(roundTo(1.2345, 2)).toBe(1.23)
    })

    it('should round up', () => {
      expect(roundTo(1.2367, 2)).toBe(1.24)
    })

    it('should round to zero decimals', () => {
      expect(roundTo(1.567, 0)).toBe(2)
    })

    it('should handle negative numbers', () => {
      expect(roundTo(-1.2345, 2)).toBe(-1.23)
    })

    it('should handle zero', () => {
      expect(roundTo(0, 2)).toBe(0)
    })
  })

  describe('formatWeightPercent', () => {
    // 2026-10-28：权重口径为「本计划内全部指标合计 100%」，取值本身已是百分数
    it('should append percent sign', () => {
      expect(formatWeightPercent(60)).toBe('60%')
      expect(formatWeightPercent(4.16)).toBe('4.16%')
    })

    it('should drop meaningless trailing zeros', () => {
      expect(formatWeightPercent(60.0)).toBe('60%')
      expect(formatWeightPercent(4.16)).toBe('4.16%')
    })

    it('should return em dash for empty values', () => {
      expect(formatWeightPercent(null)).toBe('—')
      expect(formatWeightPercent(undefined)).toBe('—')
      expect(formatWeightPercent('')).toBe('—')
    })

    it('should return em dash for non-numeric values', () => {
      expect(formatWeightPercent('abc')).toBe('—')
      expect(formatWeightPercent(Number.NaN)).toBe('—')
    })
  })
})
