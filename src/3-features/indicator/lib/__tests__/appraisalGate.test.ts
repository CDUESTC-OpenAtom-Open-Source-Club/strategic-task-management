import { describe, expect, it } from 'vitest'
import {
  APPRAISAL_GATE_FALLBACK_MESSAGES,
  APPRAISAL_LEVEL_OPTIONS,
  getAppraisalGateMessage,
  getAppraisalLevelDisplay,
  resolveAppraisalGateReason
} from '../appraisalGate'

describe('appraisal gate (2026-10-31 定稿)', () => {
  it('可选等级只有三档，不含「未评定」空值选项', () => {
    expect(APPRAISAL_LEVEL_OPTIONS.map(option => option.label)).toEqual([
      '超前完成',
      '正常',
      '延期'
    ])
    expect(APPRAISAL_LEVEL_OPTIONS.map(option => option.value)).toEqual([
      'AHEAD',
      'NORMAL',
      'DELAYED'
    ])
    expect(APPRAISAL_LEVEL_OPTIONS.some(option => String(option.value).trim() === '')).toBe(false)
  })

  it('canAppraise=true 时无锁定原因', () => {
    expect(resolveAppraisalGateReason({ canAppraise: true })).toBeNull()
    expect(getAppraisalGateMessage({ canAppraise: true })).toBe(
      APPRAISAL_GATE_FALLBACK_MESSAGES.NOT_IN_REPORTING_PERIOD
    )
  })

  it('后端原因③文案（含节点名）→ NOT_CURRENT_STEP_APPROVER', () => {
    const context = {
      canAppraise: false,
      lockHint: '您不是当前审批环节（分管职能部门负责人审批）的评定人，无法评定'
    }
    expect(resolveAppraisalGateReason(context)).toBe('NOT_CURRENT_STEP_APPROVER')
    // 提示语优先用后端 lockHint（带节点名），而不是兜底句
    expect(getAppraisalGateMessage(context)).toBe(
      '您不是当前审批环节（分管职能部门负责人审批）的评定人，无法评定'
    )
  })

  it('后端原因②文案 → NO_APPROVAL_SEAT_ROLE', () => {
    const context = { canAppraise: false, lockHint: '当前角色无评定权限，无法评定审核进度' }
    expect(resolveAppraisalGateReason(context)).toBe('NO_APPROVAL_SEAT_ROLE')
    expect(getAppraisalGateMessage(context)).toBe('当前角色无评定权限，无法评定审核进度')
  })

  it('后端原因①细分文案（未启动/已结束/已重置）→ NOT_IN_REPORTING_PERIOD', () => {
    for (const lockHint of [
      '上报审批尚未启动，暂不能调整审核进度',
      '本轮上报审批已结束（当前状态：APPROVED），暂不能调整审核进度',
      '上报尚未提交或已重置，暂不能调整审核进度'
    ]) {
      expect(resolveAppraisalGateReason({ canAppraise: false, lockHint })).toBe(
        'NOT_IN_REPORTING_PERIOD'
      )
    }
  })

  it('lockHint 缺失时按原因退到统一兜底句', () => {
    expect(getAppraisalGateMessage(null)).toBe(
      APPRAISAL_GATE_FALLBACK_MESSAGES.NOT_IN_REPORTING_PERIOD
    )
    expect(getAppraisalGateMessage(undefined)).toBe(
      APPRAISAL_GATE_FALLBACK_MESSAGES.NOT_IN_REPORTING_PERIOD
    )
    expect(getAppraisalGateMessage({ canAppraise: false, lockHint: '   ' })).toBe(
      APPRAISAL_GATE_FALLBACK_MESSAGES.NOT_IN_REPORTING_PERIOD
    )
  })

  it('等级显示态：三档映射正确，空值与未知码退「未评定」info', () => {
    expect(getAppraisalLevelDisplay('AHEAD')).toEqual({ label: '超前完成', type: 'success' })
    expect(getAppraisalLevelDisplay('ahead')).toEqual({ label: '超前完成', type: 'success' })
    expect(getAppraisalLevelDisplay('NORMAL')).toEqual({ label: '正常', type: 'success' })
    expect(getAppraisalLevelDisplay('DELAYED')).toEqual({ label: '延期', type: 'warning' })
    expect(getAppraisalLevelDisplay(null)).toEqual({ label: '未评定', type: 'info' })
    expect(getAppraisalLevelDisplay(undefined)).toEqual({ label: '未评定', type: 'info' })
    expect(getAppraisalLevelDisplay('')).toEqual({ label: '未评定', type: 'info' })
    expect(getAppraisalLevelDisplay('INFO')).toEqual({ label: '未评定', type: 'info' })
  })
})
