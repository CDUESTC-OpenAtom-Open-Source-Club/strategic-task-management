/**
 * Approval Feature Types
 *
 * Types for approval workflow management
 */

import type { Plan, StrategicIndicator } from '@/shared/types'
import type { WorkflowInstanceDetailResponse } from '@/features/workflow/api/types'
import type { ReturnedMutationChainItem } from '@/features/indicator/api/mutationApi'

export interface ApprovalInstance {
  instanceId: number
  instanceNo: string
  flowName: string
  /** 2026-10-26 修复：保留流程码与组织上下文——审批中心据此区分流程类型与部门归属 */
  flowCode?: string
  sourceOrgId?: number | string | null
  sourceOrgName?: string | null
  targetOrgId?: number | string | null
  targetOrgName?: string | null
  approverOrgId?: number | string | null
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
  /** 2026-10-21：异动批次号（同一次提交的多条改动共享，用于聚合展示与按批回滚） */
  batchId?: string | null
  /** 2026-10-21：本次异动的字段变更明细（字段 → before/after），详情弹窗逐字段展示 */
  changedFields?: Record<string, { before?: unknown; after?: unknown }> | null
  /** 2026-10-21：异动实体类型，决定字段名与业务文案 */
  mutationEntityType?: 'INDICATOR' | 'TASK'
  /**
   * 2026-10-22：本卡片聚合的全部异动实例 ID（同一次提交按实体各建一个实例）。
   * 审批/驳回必须逐个处理，只处理 instanceId 会让同批其余实例永远停在审批中。
   */
  mutationInstanceIds?: number[]
  /** 当前待办节点的审批组织（异动卡片据此判定审批按钮可见性） */
  approverOrgId?: number | string | null
}

export interface WorkflowHistoryTarget {
  entityType: 'PLAN' | 'PLAN_REPORT' | 'INDICATOR' | 'TASK'
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
  selfRating?: string | null
  /** 2026-10-28：上一节点已评定的审核进度（预填行内下拉用） */
  appraisalLevel?: string | null
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
  /** 2026-10-19：上报审批卡片提交人/时间的数据来源（后端 PlanReportSimpleResponse 补齐） */
  submittedBy?: number | string | null
  submittedAt?: string | null
  createdAt?: string | null
  /** 工作流发起人姓名（enrichPlanReportWorkflow 合并工作流详情时写入） */
  submitterName?: string | null
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
  workflowEntityType?: 'PLAN' | 'PLAN_REPORT' | 'INDICATOR' | 'TASK'
  workflowEntityId?: number | string
  secondaryWorkflowEntityType?: 'PLAN' | 'PLAN_REPORT' | 'INDICATOR' | 'TASK'
  secondaryWorkflowEntityId?: number | string
  /** 2026-10-10：指标异动审批实例（审批历史「异动审批」卡片数据源） */
  /** 2026-10-21：任务改名异动同样走该链路，故实体类型可为 TASK */
  mutationWorkflowEntities?: Array<{ entityId: number | string; entityType?: 'INDICATOR' | 'TASK' }>
  /** 2026-10-21：审批中的异动实例（「计划审批」看板数据源），使发起人/部门视角可见异动 */
  mutationPendingApprovals?: Array<Record<string, any>>
  /**
   * 2026-10-30 用户定案：「退回待重报」的异动活链清单（计划审批 tab 退回状态卡 +
   * 审批流程 tab 选择栏候选的数据源）。流程没终结（取消/整链通过）前，
   * 这条活链不得在审批中心消失。
   */
  returnedMutationApprovals?: ReturnedMutationChainItem[]
  /**
   * 2026-10-26：部门计划族补充历史实体——
   * 部门卡片抽屉锚定的是本部门主计划（如 战略发展部→教务处），而
   * 「教务处→学院」子计划与其学院上报（PLAN_REPORT）挂在子计划实体上，
   * 不在主计划锚定范围内，导致战略任务页审批历史看不到学院→部门的上报链。
   * 由页面按当前部门构造（子计划 PLAN + 各自 latestReport PLAN_REPORT）传入。
   */
  relatedWorkflowEntities?: Array<{
    entityType: 'PLAN' | 'PLAN_REPORT'
    entityId: number | string
  }>
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
