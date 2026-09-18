import { describe, expect, it } from 'vitest'
import { toStrategicIndicator } from '@/features/task/model/strategic'

/**
 * A1 回归：normalizeManualAlertSeverity 白名单曾漏 DELAYED，
 * 导致任务页保存「延期」后刷新回显为空（未评定）。
 */
describe('three-tier progress level normalization (A1 回归)', () => {
  const cases: Array<{ raw: string; expected: string | null }> = [
    { raw: 'AHEAD', expected: 'AHEAD' },
    { raw: 'ahead', expected: 'AHEAD' },
    { raw: 'NORMAL', expected: 'NORMAL' },
    { raw: 'DELAYED', expected: 'DELAYED' },
    { raw: 'delayed', expected: 'DELAYED' },
    { raw: 'INFO', expected: 'INFO' },
    { raw: 'WARNING', expected: 'WARNING' },
    { raw: 'CRITICAL', expected: 'CRITICAL' },
    { raw: 'bogus', expected: null },
    { raw: '', expected: null }
  ]

  it.each(cases)('normalizes $raw -> $expected', ({ raw, expected }) => {
    const indicator = toStrategicIndicator({
      id: 1,
      name: '测试指标',
      manualAlertSeverity: raw
    })
    expect(indicator.manualAlertSeverity).toBe(expected)
  })
})
