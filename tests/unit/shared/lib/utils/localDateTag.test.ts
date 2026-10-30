import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { formatLocalDateTag, formatLocalMonthTag } from '@/shared/lib/utils/localDateTag'

/**
 * 固定到东八区（UTC+8），让「本地日期」在任何运行机器上都是确定值，
 * 避免测试结果随环境时区漂移。
 */
const FIXED_TZ = 'Asia/Shanghai'
const ORIGINAL_TZ = process.env.TZ

beforeAll(() => {
  process.env.TZ = FIXED_TZ
})

afterAll(() => {
  if (ORIGINAL_TZ === undefined) {
    delete process.env.TZ
  } else {
    process.env.TZ = ORIGINAL_TZ
  }
})

describe('formatLocalDateTag', () => {
  it('formats a normal date as YYYY-MM-DD', () => {
    expect(formatLocalDateTag(new Date(2026, 9, 15, 13, 45))).toBe('2026-10-15')
  })

  it('pads single-digit months and days with zero', () => {
    expect(formatLocalDateTag(new Date(2026, 0, 5, 8, 0))).toBe('2026-01-05')
    expect(formatLocalDateTag(new Date(2026, 8, 9, 23, 59))).toBe('2026-09-09')
  })

  it('keeps dates within the same month stable across the day boundary', () => {
    // 月初
    expect(formatLocalDateTag(new Date(2026, 9, 1, 0, 0))).toBe('2026-10-01')
    // 月末
    expect(formatLocalDateTag(new Date(2026, 9, 31, 23, 59, 59))).toBe('2026-10-31')
  })

  it('keeps the month correct when the UTC date falls in the previous month', () => {
    // 本地 2026-10-01 00:30（UTC+8）→ UTC 时刻仍是 2026-09-30
    const localMonthStart = new Date(2026, 9, 1, 0, 30)

    expect(localMonthStart.toISOString().slice(0, 10)).toBe('2026-09-30')
    expect(formatLocalDateTag(localMonthStart)).toBe('2026-10-01')
  })

  it('keeps the year correct when the UTC date falls in the previous year', () => {
    // 本地 2027-01-01 00:30（UTC+8）→ UTC 时刻仍是 2026-12-31
    const localYearStart = new Date(2027, 0, 1, 0, 30)

    expect(localYearStart.toISOString().slice(0, 10)).toBe('2026-12-31')
    expect(formatLocalDateTag(localYearStart)).toBe('2027-01-01')
  })

  it('keeps the year correct at the end of December', () => {
    expect(formatLocalDateTag(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31')
  })

  it('uses the local date when UTC and local dates differ', () => {
    // 东八区当天 00:00~08:00 之间，UTC 还停在前一天——正是导出文件名差一天的成因
    const justAfterLocalMidnight = new Date(2026, 9, 30, 0, 30)

    expect(justAfterLocalMidnight.toISOString().slice(0, 10)).toBe('2026-10-29')
    expect(formatLocalDateTag(justAfterLocalMidnight)).toBe('2026-10-30')
  })

  it('handles leap day', () => {
    expect(formatLocalDateTag(new Date(2028, 1, 29, 12, 0))).toBe('2028-02-29')
  })

  it('defaults to the current date when no argument is given', () => {
    const now = new Date()

    expect(formatLocalDateTag()).toBe(formatLocalDateTag(now))
  })
})

describe('formatLocalMonthTag', () => {
  it('formats the reporting month as YYYYMM in local time', () => {
    expect(formatLocalMonthTag(new Date(2026, 9, 15, 13, 45))).toBe('202610')
  })

  it('keeps the local month when UTC still points at the previous month', () => {
    // 本地 2026-10-01 00:30（UTC+8）→ UTC 时刻仍是 2026-09-30
    const localMonthStart = new Date(2026, 9, 1, 0, 30)

    expect(localMonthStart.toISOString().slice(0, 7)).toBe('2026-09')
    expect(formatLocalMonthTag(localMonthStart)).toBe('202610')
  })

  it('keeps the local year when UTC still points at the previous year', () => {
    // 本地 2027-01-01 00:30（UTC+8）→ UTC 时刻仍是 2026-12-31
    const localYearStart = new Date(2027, 0, 1, 0, 30)

    expect(localYearStart.toISOString().slice(0, 7)).toBe('2026-12')
    expect(formatLocalMonthTag(localYearStart)).toBe('202701')
  })
})
