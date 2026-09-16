/**
 * Approval Feature Types
 *
 * Types for approval workflow management
 */

import type { Plan, StrategicIndicator } from '@/shared/types'
import type { WorkflowInstanceDetailResponse } from '@/features/workflow/api/types'

export interface ApprovalInstance {
  instanceId: number
  instanceNo: string
  flowName: string
  entityType: string
  entityId: string
  entityTitle: string
  currentStep: string
  status: ApprovalStatus
  applicant: {
    id: number
    name: string
    orgName?: string
  }
  createdAt: string
  updatedAt?: string
}

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'CANCELLED'

export interface ApprovalFlow {
  id: number
  name: string
  code: string
  description: string
  entityType: string
  enabled: boolean
  version: number
  stepCount: number
  createdAt: string
}

export interface ApprovalStep {
  stepOrder: number
  stepCode: string
  stepName: string
  status: ApprovalStepStatus
  approvers: ApprovalUser[]
}

export type ApprovalStepStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'SKIPPED'

export interface ApprovalUser {
  id: number
  name: string
  approved: boolean
}

export interface ApprovalHistory {
  action: string
  operator: {
    id: number
    name: string
  }
  comment?: string
  operatedAt: string
}

export interface ApprovalSubmissionRequest {
  comment?: string
  flowCode: string
}

export interface ApprovalActionRequest {
  comment?: string
  decision: 'APPROVE' | 'REJECT'
}

export interface ApprovalFilters {
  page?: number
  size?: number
  instanceNo?: string
  entityType?: string
  entityId?: string
  status?: ApprovalStatus
  applicantId?: number
}

export interface PlanApprovalDetailItem {
  instanceId: number
  instanceNo: string
  title: string
  routeTitle?: string
  flowName?: string
  flowCode?: string
  submitterName: string
  currentStepName: string
  createdAt?: string
  completedAt?: string
  statusLabel?: string
  statusType?: 'success' | 'warning' | 'danger' | 'info'
  entityId?: string | number
  planName?: string
}

export interface WorkflowHistoryTarget {
  entityType: 'PLAN' | 'PLAN_REPORT'
  entityId: number
}

export interface PlanReportAttachmentItem {
  id?: number | string | null
  fileName?: string | null
  fileSize?: number | null
  fileType?: string | null
  url?: string | null
  uploadedBy?: number | string | null
  uploadedAt?: string | null
}

export interface PlanReportIndicatorDetailItem {
  indicatorId: number
  progress?: number | null
  comment?: string | null
  attachments?: PlanReportAttachmentItem[] | null
}

export interface PlanReportSnapshotSummary {
  id?: number | string
  content?: string | null
  summary?: string | null
  workflowStatus?: string | null
  status?: string | null
  workflowInstanceId?: number | string | null
  currentTaskId?: number | string | null
  currentStepName?: string | null
  indicatorDetails?: PlanReportIndicatorDetailItem[] | null
}

export interface DistributionApprovalProgressDrawerProps {
  modelValue: boolean
  indicators?: StrategicIndicator[]
  plan?: Plan | null
  initialPlanWorkflowDetail?: WorkflowInstanceDetailResponse | null
  indicatorId?: string | number
  departmentName?: string
  planName?: string
  showApprovalSection?: boolean
  showPlanApprovals?: boolean
  readonly?: boolean
  approvalType?: 'distribution' | 'submission'
  historyViewMode?: 'auto' | 'card-only'
  workflowCode?: string | string[]
  workflowEntityType?: 'PLAN' | 'PLAN_REPORT'
  workflowEntityId?: number | string
  secondaryWorkflowEntityType?: 'PLAN' | 'PLAN_REPORT'
  secondaryWorkflowEntityId?: number | string
}

export interface DistributionApprovalProgressDrawerEmit {
  (e: 'update:modelValue', value: boolean): void
  (e: 'close'): void
  (
    e: 'refresh',
    payload?: {
      status?: string
      workflowStatus?: string
      canWithdraw?: boolean
      currentTaskId?: number | null
      currentStepName?: string | null
      currentApproverId?: number | null
      currentApproverName?: string | null
    }
  ): void
}
