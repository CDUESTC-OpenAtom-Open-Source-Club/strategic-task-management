/**
 * Workflow Feature - Type Definitions
 *
 * Types for the new workflow API (/api/v1/workflows)
 */

// ============================================================
// Workflow Types
// ============================================================

export interface WorkflowDefinitionResponse {
  definitionId: string
  definitionName: string
  description?: string
  category?: string
  version?: string
  isActive: boolean
  createTime?: string
}

export interface ApproverCandidateResponse {
  userId: number
  username?: string
  realName?: string
  orgId?: number
  orgName?: string
}

export interface WorkflowStepPreviewResponse {
  stepDefId: number
  stepOrder: number
  stepName: string
  stepType?: string
  roleId?: number
  selectable: boolean
  candidateApprovers: ApproverCandidateResponse[]
}

export interface WorkflowDefinitionPreviewResponse {
  workflowCode: string
  workflowName: string
  entityType?: string
  steps: WorkflowStepPreviewResponse[]
}

export interface WorkflowInstanceResponse {
  instanceId: string
  definitionId?: string
  status: string
  businessEntityId?: number
  starterId?: number
  startTime?: string
  endTime?: string
  currentTaskId?: string
  currentStepName?: string
  currentApproverId?: number
  currentApproverName?: string
  canWithdraw?: boolean
}

export interface WorkflowTaskResponse {
  taskId: string
  instanceId?: string
  taskName: string
  taskKey: string
  status: string
  entityType?: string
  entityId?: number | string
  businessEntityId?: number | string
  currentStepName?: string
  assigneeId?: number
  assigneeName?: string
  approverOrgId?: number
  approverOrgName?: string
  stepNo?: number
  stepType?: string
  comment?: string
  approvedAt?: string
  createdTime?: string
  startedAt?: string
}

export interface WorkflowHistoryItem {
  historyId: string
  taskId: string
  taskName: string
  stepName?: string
  operatorId?: number
  operatorName?: string
  action: string
  comment?: string
  operateTime?: string
}

export interface WorkflowHistoryCardResponse {
  instanceId: string
  instanceNo?: string
  roundNo?: number
  entityType?: string
  entityId?: number
  planId?: number
  planName?: string
  flowCode?: string
  flowName?: string
  sourceOrgId?: number
  sourceOrgName?: string
  targetOrgId?: number
  targetOrgName?: string
  status: string
  startedAt?: string
  completedAt?: string
  requesterId?: number
  requesterName?: string
}

export interface WorkflowInstanceDetailResponse {
  instanceId: string
  definitionId?: string
  definitionName?: string
  status: string
  flowCode?: string
  flowName?: string
  businessEntityId?: number
  businessEntityType?: string
  starterId?: number
  starterName?: string
  planId?: number
  planName?: string
  sourceOrgId?: number
  sourceOrgName?: string
  targetOrgId?: number
  targetOrgName?: string
  startTime?: string
  endTime?: string
  currentTaskId?: string
  currentStepName?: string
  currentApproverId?: number
  currentApproverName?: string
  canWithdraw?: boolean
  tasks: WorkflowTaskResponse[]
  history: WorkflowHistoryItem[]
}

// ============================================================
// Request Types
// ============================================================

export interface StartWorkflowRequest {
  workflowCode: string
  businessEntityId: number
  businessEntityType?: string
  variables?: Record<string, unknown>
}

export interface StartInstanceRequest {
  businessEntityId: number
  businessEntityType?: string
  variables?: Record<string, unknown>
}

export interface ApprovalRequest {
  comment?: string
}

export interface RejectionRequest {
  reason: string
}

export interface ReassignRequest {
  targetUserId: number
}

export interface WorkflowTaskDecisionRequest {
  approved: boolean
  comment?: string
  /** 鉴定进度等级（P1 上报链改造）：AHEAD=超前 / NORMAL=正常 / DELAYED=延期 */
  appraisalLevel?: string
}

// ============================================================
// Page Result
// ============================================================

export interface PageResult<T> {
  items: T[]
  total: number
  pageNum: number
  pageSize: number
}
