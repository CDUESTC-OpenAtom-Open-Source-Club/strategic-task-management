import { describe, it, expect } from 'vitest'
import {
  getSafeApprovalStatus,
  isApprovalStatus,
  getLifecycleStatusText,
  getLifecycleStatusType,
  getApprovalStatusText,
  getApprovalStatusType,
  getWorkflowStatusText,
  getWorkflowStatusType,
  showApprovalBadge,
  getCompositeStatusInfo,
  isTerminalState,
  isActiveState,
  isEditableState,
  isPendingState,
  getAllowedTransitions,
  isValidTransition
} from './status-management'
import type { Indicator } from '@/entities/indicator/model/types'
import {
  IndicatorStatus,
  ProgressApprovalStatus,
  WorkflowStatus
} from '@/entities/indicator/model/types'

describe('Advanced Status Management', () => {
  // 创建测试用的基础指标对象
  const createTestIndicator = (
    status: string = IndicatorStatus.DRAFT,
    approvalStatus: string = ProgressApprovalStatus.NONE,
    workflowStatus: string = WorkflowStatus.DRAFT
  ): Indicator => ({
    id: 1,
    name: 'Test Indicator',
    taskId: 1,
    ownerOrgId: 1,
    targetOrgId: 1,
    level: 'FIRST',
    type: 'QUANTITATIVE',
    status,
    progressApprovalStatus: approvalStatus,
    workflowStatus,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  })

  describe('getSafeApprovalStatus', () => {
    it('should return valid status', () => {
      const indicator = createTestIndicator(IndicatorStatus.DRAFT, ProgressApprovalStatus.PENDING)
      expect(getSafeApprovalStatus(indicator)).toBe(ProgressApprovalStatus.PENDING)
    })

    it('should handle invalid status', () => {
      const indicator = createTestIndicator(IndicatorStatus.DRAFT, 'INVALID_STATUS' as any)
      // 验证会返回默认值
      expect(getSafeApprovalStatus(indicator)).toBe(ProgressApprovalStatus.NONE)
    })

    it('should use custom fallback', () => {
      const indicator = createTestIndicator(IndicatorStatus.DRAFT, 'INVALID_STATUS' as any)
      expect(getSafeApprovalStatus(indicator, ProgressApprovalStatus.DRAFT)).toBe(
        ProgressApprovalStatus.DRAFT
      )
    })
  })

  describe('isApprovalStatus', () => {
    it('should check status correctly', () => {
      const indicator = createTestIndicator(IndicatorStatus.DRAFT, ProgressApprovalStatus.PENDING)
      expect(isApprovalStatus(indicator, ProgressApprovalStatus.PENDING)).toBe(true)
    })

    it('should handle invalid status', () => {
      const indicator = createTestIndicator(IndicatorStatus.DRAFT, 'INVALID_STATUS' as any)
      expect(isApprovalStatus(indicator, 'INVALID_STATUS')).toBe(false)
    })
  })

  describe('Lifecycle Status Display', () => {
    it('should get correct display text', () => {
      expect(getLifecycleStatusText(IndicatorStatus.DRAFT)).toBe('草稿')
      expect(getLifecycleStatusText(IndicatorStatus.PENDING_REVIEW)).toBe('待审核')
      expect(getLifecycleStatusText(IndicatorStatus.DISTRIBUTED)).toBe('已下发')
      expect(getLifecycleStatusText(IndicatorStatus.ARCHIVED)).toBe('已归档')
    })

    it('should handle deprecated status', () => {
      expect(getLifecycleStatusText(IndicatorStatus.PENDING)).toBe('待审核')
      expect(getLifecycleStatusText(IndicatorStatus.ACTIVE)).toBe('已下发')
    })

    it('should handle unknown status', () => {
      expect(getLifecycleStatusText('UNKNOWN')).toBe('未知状态')
    })

    it('should get correct tag type', () => {
      expect(getLifecycleStatusType(IndicatorStatus.DRAFT)).toBe('info')
      expect(getLifecycleStatusType(IndicatorStatus.PENDING_REVIEW)).toBe('warning')
      expect(getLifecycleStatusType(IndicatorStatus.DISTRIBUTED)).toBe('success')
    })
  })

  describe('Approval Status Display', () => {
    it('should get correct approval text', () => {
      expect(getApprovalStatusText(ProgressApprovalStatus.NONE)).toBe('无待审批')
      expect(getApprovalStatusText(ProgressApprovalStatus.PENDING)).toBe('审批中')
      expect(getApprovalStatusText(ProgressApprovalStatus.APPROVED)).toBe('已通过')
      expect(getApprovalStatusText(ProgressApprovalStatus.REJECTED)).toBe('已回退')
    })

    it('should get correct approval tag type', () => {
      expect(getApprovalStatusType(ProgressApprovalStatus.NONE)).toBe('info')
      expect(getApprovalStatusType(ProgressApprovalStatus.PENDING)).toBe('warning')
      expect(getApprovalStatusType(ProgressApprovalStatus.APPROVED)).toBe('success')
      expect(getApprovalStatusType(ProgressApprovalStatus.REJECTED)).toBe('danger')
    })
  })

  describe('Workflow Status Display', () => {
    it('should get correct workflow text', () => {
      expect(getWorkflowStatusText(WorkflowStatus.DRAFT)).toBe('草稿')
      expect(getWorkflowStatusText(WorkflowStatus.PENDING_DISTRIBUTION)).toBe('待确认接收')
      expect(getWorkflowStatusText(WorkflowStatus.DISTRIBUTED)).toBe('已下发')
      expect(getWorkflowStatusText(WorkflowStatus.PENDING_APPROVAL)).toBe('审批中')
      expect(getWorkflowStatusText(WorkflowStatus.REJECTED)).toBe('已回退')
      expect(getWorkflowStatusText(WorkflowStatus.COMPLETED)).toBe('已完成')
    })

    it('should get correct workflow tag type', () => {
      expect(getWorkflowStatusType(WorkflowStatus.DRAFT)).toBe('info')
      expect(getWorkflowStatusType(WorkflowStatus.PENDING_DISTRIBUTION)).toBe('warning')
      expect(getWorkflowStatusType(WorkflowStatus.DISTRIBUTED)).toBe('success')
      expect(getWorkflowStatusType(WorkflowStatus.REJECTED)).toBe('danger')
    })
  })

  describe('Composite Status Info', () => {
    it('should return complete status information', () => {
      const indicator = createTestIndicator(
        IndicatorStatus.DISTRIBUTED,
        ProgressApprovalStatus.APPROVED,
        WorkflowStatus.COMPLETED
      )
      const info = getCompositeStatusInfo(indicator)

      expect(info.lifecycle.text).toBe('已下发')
      expect(info.lifecycle.type).toBe('success')
      expect(info.approval.text).toBe('已通过')
      expect(info.approval.type).toBe('success')
      expect(info.approval.show).toBe(true)
      expect(info.workflow.text).toBe('已完成')
      expect(info.workflow.type).toBe('success')
    })

    it('should hide approval badge for NONE status', () => {
      const indicator = createTestIndicator(
        IndicatorStatus.DISTRIBUTED,
        ProgressApprovalStatus.NONE
      )
      expect(getCompositeStatusInfo(indicator).approval.show).toBe(false)
    })

    it('should hide approval badge for DRAFT status', () => {
      const indicator = createTestIndicator(
        IndicatorStatus.DISTRIBUTED,
        ProgressApprovalStatus.DRAFT
      )
      expect(getCompositeStatusInfo(indicator).approval.show).toBe(false)
    })
  })

  describe('State Checkers', () => {
    it('should check terminal state', () => {
      expect(isTerminalState(createTestIndicator(IndicatorStatus.ARCHIVED))).toBe(true)
      expect(isTerminalState(createTestIndicator(IndicatorStatus.DRAFT))).toBe(false)
    })

    it('should check active state', () => {
      expect(isActiveState(createTestIndicator(IndicatorStatus.DISTRIBUTED))).toBe(true)
      expect(isActiveState(createTestIndicator(IndicatorStatus.DRAFT))).toBe(false)
    })

    it('should check editable state', () => {
      expect(isEditableState(createTestIndicator(IndicatorStatus.DRAFT))).toBe(true)
      expect(isEditableState(createTestIndicator(IndicatorStatus.DISTRIBUTED))).toBe(false)
    })

    it('should check pending state', () => {
      expect(isPendingState(createTestIndicator(IndicatorStatus.PENDING_REVIEW))).toBe(true)
      expect(
        isPendingState(createTestIndicator(IndicatorStatus.DRAFT, ProgressApprovalStatus.PENDING))
      ).toBe(true)
      expect(isPendingState(createTestIndicator(IndicatorStatus.DISTRIBUTED))).toBe(false)
    })

    it('should check show approval badge', () => {
      expect(
        showApprovalBadge(
          createTestIndicator(IndicatorStatus.DISTRIBUTED, ProgressApprovalStatus.PENDING)
        )
      ).toBe(true)
      expect(
        showApprovalBadge(
          createTestIndicator(IndicatorStatus.DISTRIBUTED, ProgressApprovalStatus.NONE)
        )
      ).toBe(false)
      expect(
        showApprovalBadge(
          createTestIndicator(IndicatorStatus.DISTRIBUTED, ProgressApprovalStatus.DRAFT)
        )
      ).toBe(false)
    })
  })

  describe('Transitions', () => {
    it('should get allowed transitions for draft', () => {
      expect(getAllowedTransitions(createTestIndicator(IndicatorStatus.DRAFT))).toEqual([
        IndicatorStatus.PENDING_REVIEW
      ])
    })

    it('should get allowed transitions for pending review', () => {
      expect(getAllowedTransitions(createTestIndicator(IndicatorStatus.PENDING_REVIEW))).toEqual(
        expect.arrayContaining([IndicatorStatus.DISTRIBUTED, IndicatorStatus.DRAFT])
      )
    })

    it('should get allowed transitions for distributed', () => {
      expect(getAllowedTransitions(createTestIndicator(IndicatorStatus.DISTRIBUTED))).toEqual([
        IndicatorStatus.ARCHIVED
      ])
    })

    it('should get allowed transitions for archived', () => {
      expect(getAllowedTransitions(createTestIndicator(IndicatorStatus.ARCHIVED))).toEqual([])
    })

    it('should validate valid transitions', () => {
      expect(
        isValidTransition(
          createTestIndicator(IndicatorStatus.DRAFT),
          IndicatorStatus.PENDING_REVIEW
        )
      ).toBe(true)
      expect(
        isValidTransition(
          createTestIndicator(IndicatorStatus.PENDING_REVIEW),
          IndicatorStatus.DISTRIBUTED
        )
      ).toBe(true)
      expect(
        isValidTransition(
          createTestIndicator(IndicatorStatus.PENDING_REVIEW),
          IndicatorStatus.DRAFT
        )
      ).toBe(true)
      expect(
        isValidTransition(
          createTestIndicator(IndicatorStatus.DISTRIBUTED),
          IndicatorStatus.ARCHIVED
        )
      ).toBe(true)
    })

    it('should invalidate invalid transitions', () => {
      expect(
        isValidTransition(createTestIndicator(IndicatorStatus.DRAFT), IndicatorStatus.ARCHIVED)
      ).toBe(false)
      expect(
        isValidTransition(createTestIndicator(IndicatorStatus.DISTRIBUTED), IndicatorStatus.DRAFT)
      ).toBe(false)
    })
  })
})
