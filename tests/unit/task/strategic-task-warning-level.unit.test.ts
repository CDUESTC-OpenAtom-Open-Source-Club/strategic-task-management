import { describe, expect, it } from 'vitest'
import {
  MANUAL_ALERT_LOCKED_HINT,
  MANUAL_ALERT_READONLY_HINT,
  MANUAL_ALERT_WORKFLOW_LOCKED_HINT,
  canEditManualAlertLevel
} from '@/features/task/lib/warning-level'

describe('canEditManualAlertLevel', () => {
  it('locks manual alert level for DRAFT plans', () => {
    expect(canEditManualAlertLevel('DRAFT', { workflowInFlight: true })).toBe(false)
  })

  it('locks manual alert level for PENDING plans', () => {
    expect(canEditManualAlertLevel('PENDING', { workflowInFlight: true })).toBe(false)
  })

  it('allows manual alert level editing for DISTRIBUTED plans with in-flight workflow', () => {
    expect(canEditManualAlertLevel('DISTRIBUTED', { workflowInFlight: true })).toBe(true)
  })

  it('locks manual alert level when reporting workflow is not in flight', () => {
    // 2026-10-18 用户定案：平时（流程未发起/已结束/已退回）锁死
    expect(canEditManualAlertLevel('DISTRIBUTED')).toBe(false)
    expect(canEditManualAlertLevel('DISTRIBUTED', { workflowInFlight: false })).toBe(false)
    expect(canEditManualAlertLevel('DISTRIBUTED', { workflowInFlight: undefined })).toBe(false)
  })

  it('matches plan status case-insensitively', () => {
    expect(canEditManualAlertLevel('distributed', { workflowInFlight: true })).toBe(true)
    expect(canEditManualAlertLevel('Distributed', { workflowInFlight: true })).toBe(true)
  })

  it('locks manual alert level when plan status is missing', () => {
    expect(canEditManualAlertLevel(undefined, { workflowInFlight: true })).toBe(false)
    expect(canEditManualAlertLevel(null, { workflowInFlight: true })).toBe(false)
    expect(canEditManualAlertLevel('', { workflowInFlight: true })).toBe(false)
    expect(canEditManualAlertLevel('   ', { workflowInFlight: true })).toBe(false)
  })

  it('locks manual alert level in read-only historical years even for DISTRIBUTED plans', () => {
    expect(canEditManualAlertLevel('DISTRIBUTED', { readOnly: true, workflowInFlight: true })).toBe(
      false
    )
    expect(
      canEditManualAlertLevel('DISTRIBUTED', { readOnly: false, workflowInFlight: true })
    ).toBe(true)
  })
})

describe('MANUAL_ALERT_LOCKED_HINT', () => {
  it('explains why the control is locked', () => {
    expect(MANUAL_ALERT_LOCKED_HINT).toBe('计划正式下发后才能调整进度等级')
  })

  it('explains the workflow-in-flight requirement', () => {
    expect(MANUAL_ALERT_WORKFLOW_LOCKED_HINT).toBe('上报流程进行中才能调整进度等级，平时为锁定状态')
  })

  it('explains why the control is locked in read-only years', () => {
    expect(MANUAL_ALERT_READONLY_HINT).toBe('历史年份只读，不能调整进度等级')
  })
})
