import { describe, expect, it } from 'vitest'
import {
  isReportReturnedToSubmitter,
  resolveReportSubmitAllButtonVisible,
  resolveReportSubmitLockReason
} from '@/features/indicator/lib/reportSubmitGate'

/**
 * 2026-11-13（B-1 修复，用户全链回归实测）：上报「驳回退回待重报」态判定。
 *
 * 驳回/发起人撤回后实例是活链（rawStatus 仍 IN_REVIEW），但当前 pending 节点
 * 已回到「填报人提交」——业务等同草稿：一键提交要恢复渲染、状态签显示
 * 「已回退待重报」（B-2）。此前 UiStatus 保持 IN_REVIEW → ActionState 判
 * pending_withdrawable → 一键提交不渲染，填报人只能绕行「一键撤回」再重报。
 */
describe('reportSubmitGate · isReportReturnedToSubmitter（B-1 驳回退回待重报）', () => {
  it('实例在审（IN_REVIEW）+ 当前节点=填报人提交 → 判定成立', () => {
    expect(isReportReturnedToSubmitter('IN_REVIEW', '填报人提交')).toBe(true)
  })

  it('在审状态集（SUBMITTED/PENDING）+ 填报人提交 → 成立（归一大小写与空白）', () => {
    expect(isReportReturnedToSubmitter('submitted', ' 填报人提交 ')).toBe(true)
    expect(isReportReturnedToSubmitter('PENDING', '填报人提交')).toBe(true)
  })

  it('在审但当前节点是其他审批节点（如职能部门审批人审批）→ 不成立（正常审批中）', () => {
    expect(isReportReturnedToSubmitter('IN_REVIEW', '职能部门审批人审批')).toBe(false)
  })

  it('节点含「填报人提交」字样的更长节点名 → 成立（includes 语义）', () => {
    expect(isReportReturnedToSubmitter('IN_REVIEW', '第 3 轮填报人提交')).toBe(true)
  })

  it('实例已终态（APPROVED/REJECTED/CANCELLED）→ 不成立', () => {
    expect(isReportReturnedToSubmitter('APPROVED', '填报人提交')).toBe(false)
    expect(isReportReturnedToSubmitter('REJECTED', '填报人提交')).toBe(false)
    expect(isReportReturnedToSubmitter('CANCELLED', '填报人提交')).toBe(false)
  })

  it('空值/未知状态 → 不成立（保守）', () => {
    expect(isReportReturnedToSubmitter(null, '填报人提交')).toBe(false)
    expect(isReportReturnedToSubmitter('IN_REVIEW', null)).toBe(false)
    expect(isReportReturnedToSubmitter('', '')).toBe(false)
    expect(isReportReturnedToSubmitter('UNKNOWN', '填报人提交')).toBe(false)
  })

  it('B-1 联动：退回待重报成立时一键提交可见（isPlanReportDraftState=true）', () => {
    expect(
      resolveReportSubmitAllButtonVisible({
        showBatchActions: true,
        isReportLocked: false,
        usePlanReportFlow: true,
        isPlanReportDraftState: true,
        functionalDeptSelected: true
      })
    ).toBe(true)
  })

  it('B-1 反例：正常审批中（非草稿态）一键提交仍不渲染', () => {
    expect(
      resolveReportSubmitAllButtonVisible({
        showBatchActions: true,
        isReportLocked: false,
        usePlanReportFlow: true,
        isPlanReportDraftState: false,
        functionalDeptSelected: true
      })
    ).toBe(false)
  })

  it('锁门禁文案不受本次改动影响（回归）', () => {
    expect(
      resolveReportSubmitLockReason({
        isReadOnly: false,
        hasIndicators: true,
        mutationInFlight: false,
        missingSelfRatingCount: 0,
        functionalDeptSelected: true
      })
    ).toBe('')
    expect(
      resolveReportSubmitLockReason({
        isReadOnly: false,
        hasIndicators: true,
        mutationInFlight: true,
        missingSelfRatingCount: 0,
        functionalDeptSelected: true
      })
    ).toContain('异动审批')
  })
})
