import { describe, expect, it } from 'vitest'
import {
  findEarliestUnfilledReportMonth,
  isLockingPlanReportStatus,
  resolvePlanReportEntryLock
} from '@/features/indicator/model/planReportEntryLock'
import { formatPendingApprovalLabel } from '@/shared/lib/utils/workflowStepLabel'

const YEAR = 2026

describe('findEarliestUnfilledReportMonth（最早未填报月）', () => {
  it('returns null when the existing months set is unavailable (caller degrades)', () => {
    expect(findEarliestUnfilledReportMonth(null, YEAR)).toBeNull()
  })

  it('returns the first month of the year when nothing has been reported', () => {
    expect(findEarliestUnfilledReportMonth([], YEAR)).toBe('202601')
  })

  it('skips months that already have reports', () => {
    expect(findEarliestUnfilledReportMonth(['202601'], YEAR)).toBe('202602')
    expect(findEarliestUnfilledReportMonth(['202601', '202602', '202603'], YEAR)).toBe('202604')
  })

  it("returns '' when all 12 months have reports (no fillable month)", () => {
    const allMonths = Array.from(
      { length: 12 },
      (_, index) => `2026${String(index + 1).padStart(2, '0')}`
    )
    expect(findEarliestUnfilledReportMonth(allMonths, YEAR)).toBe('')
  })
})

describe('resolvePlanReportEntryLock（填报入口锁定，报告批准后按钮不应永久消失）', () => {
  it('does not lock when the target (earliest unfilled) month has no report yet', () => {
    expect(
      resolvePlanReportEntryLock({
        usePlanReportFlow: true,
        lockState: { earliestUnfilledMonth: '202610', targetMonthReportStatus: '' }
      })
    ).toBe(false)
  })

  it('locks when the target month report is in approval', () => {
    for (const status of ['SUBMITTED', 'IN_REVIEW', 'PENDING']) {
      expect(
        resolvePlanReportEntryLock({
          usePlanReportFlow: true,
          lockState: { earliestUnfilledMonth: '202609', targetMonthReportStatus: status }
        })
      ).toBe(true)
    }
  })

  it('locks when the target month report is approved', () => {
    expect(
      resolvePlanReportEntryLock({
        usePlanReportFlow: true,
        lockState: { earliestUnfilledMonth: '202609', targetMonthReportStatus: 'APPROVED' }
      })
    ).toBe(true)
  })

  it('locks when every month of the year already has a report (nothing left to fill)', () => {
    expect(
      resolvePlanReportEntryLock({
        usePlanReportFlow: true,
        lockState: { earliestUnfilledMonth: '', targetMonthReportStatus: 'APPROVED' }
      })
    ).toBe(true)
  })

  it('never locks when the plan report flow is disabled or data is unavailable', () => {
    expect(
      resolvePlanReportEntryLock({
        usePlanReportFlow: false,
        lockState: { earliestUnfilledMonth: '202609', targetMonthReportStatus: 'APPROVED' }
      })
    ).toBe(false)

    expect(resolvePlanReportEntryLock({ usePlanReportFlow: true, lockState: null })).toBe(false)
  })
})

describe('isLockingPlanReportStatus（降级口径：当前月报告状态）', () => {
  it('treats in-approval and approved statuses as locking', () => {
    expect(isLockingPlanReportStatus('SUBMITTED')).toBe(true)
    expect(isLockingPlanReportStatus('in_review')).toBe(true)
    expect(isLockingPlanReportStatus('pending')).toBe(true)
    expect(isLockingPlanReportStatus('APPROVED')).toBe(true)
  })

  it('treats draft-like statuses as non-locking', () => {
    expect(isLockingPlanReportStatus('DRAFT')).toBe(false)
    expect(isLockingPlanReportStatus('REJECTED')).toBe(false)
    expect(isLockingPlanReportStatus('')).toBe(false)
    expect(isLockingPlanReportStatus(undefined)).toBe(false)
  })
})

describe('formatPendingApprovalLabel（审批状态章去「审批审批」重复字）', () => {
  it('does not append 审批 when the step name already ends with it', () => {
    expect(formatPendingApprovalLabel('战略发展部负责人审批')).toBe('待战略发展部负责人审批')
    expect(formatPendingApprovalLabel('学院院长审批')).toBe('待学院院长审批')
  })

  it('appends 审批 when the step name has no suffix', () => {
    expect(formatPendingApprovalLabel('职能部门终审')).toBe('待职能部门终审审批')
    expect(formatPendingApprovalLabel('校领导审核')).toBe('待校领导审核审批')
  })

  it('falls back to 审批中 for empty step names', () => {
    expect(formatPendingApprovalLabel('')).toBe('审批中')
    expect(formatPendingApprovalLabel('   ')).toBe('审批中')
    expect(formatPendingApprovalLabel(null)).toBe('审批中')
    expect(formatPendingApprovalLabel(undefined)).toBe('审批中')
  })
})
