/**
 * Backend-Aligned Type Definitions
 *
 * This file contains TypeScript interfaces that align with the backend database schema.
 *
 * TERMINOLOGY MAPPING:
 * - Backend "strategic_task" → Frontend "Plan"
 * - Backend "indicator" → Frontend "Task" (at plan level) or "Indicator" (at execution level)
 *
 * Requirements: 1.1, 1.2, 1.5
 */

// ============================================
// Enums (matching backend)
// ============================================

export enum OrgType {
  SCHOOL = 'SCHOOL',
  FUNCTIONAL_DEPT = 'FUNCTIONAL_DEPT',
  FUNCTION_DEPT = 'FUNCTION_DEPT',
  COLLEGE = 'COLLEGE',
  STRATEGY_DEPT = 'STRATEGY_DEPT',
  DIVISION = 'DIVISION',
  OTHER = 'OTHER'
}

export enum TaskType {
  BASIC = 'BASIC',
  DEVELOPMENT = 'DEVELOPMENT'
}

export enum IndicatorLevel {
  STRAT_TO_FUNC = 'STRAT_TO_FUNC',
  FUNC_TO_COLLEGE = 'FUNC_TO_COLLEGE'
}

/**
 * Indicator lifecycle status enumeration
 * Defines the four-state lifecycle of indicators
 *
 * Four-state lifecycle flow:
 * DRAFT -> PENDING_REVIEW -> DISTRIBUTED -> ARCHIVED
 *
 * State descriptions:
 * - DRAFT: Indicator is being created/edited, not yet submitted for review
 * - PENDING_REVIEW: Indicator submitted and awaiting strategic dept approval of definition
 * - DISTRIBUTED: Indicator approved and distributed to departments for progress tracking
 * - ACTIVE: Legacy status (equivalent to DISTRIBUTED). Kept for backward compatibility.
 * - ARCHIVED: Indicator soft-deleted or end-of-lifecycle
 *
 * Note: This lifecycle status (status field) is separate from progress approval status
 * (progressApprovalStatus field). PENDING_REVIEW represents indicator definition review,
 * while ProgressApprovalStatus.PENDING represents progress submission approval.
 */
export enum IndicatorStatus {
  DRAFT = 'DRAFT',
  PENDING_REVIEW = 'PENDING_REVIEW',
  DISTRIBUTED = 'DISTRIBUTED',
  ACTIVE = 'ACTIVE', // Legacy: equivalent to DISTRIBUTED, kept for backward compatibility
  ARCHIVED = 'ARCHIVED'
}

export enum MilestoneStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  DELAYED = 'DELAYED',
  CANCELED = 'CANCELED'
}

export enum ReportStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  RETURNED = 'RETURNED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

export enum ApprovalAction {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  RETURN = 'RETURN'
}

export enum AlertSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL'
}

export enum AlertStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED'
}

export enum AdhocScopeType {
  ALL_ORGS = 'ALL_ORGS',
  BY_DEPT_ISSUED_INDICATORS = 'BY_DEPT_ISSUED_INDICATORS',
  CUSTOM = 'CUSTOM'
}

export enum AdhocTaskStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  ARCHIVED = 'ARCHIVED'
}

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  APPROVE = 'APPROVE',
  ARCHIVE = 'ARCHIVE',
  RESTORE = 'RESTORE'
}

export enum AuditEntityType {
  ORG = 'ORG',
  USER = 'USER',
  CYCLE = 'CYCLE',
  TASK = 'TASK',
  INDICATOR = 'INDICATOR',
  MILESTONE = 'MILESTONE',
  REPORT = 'REPORT',
  ADHOC_TASK = 'ADHOC_TASK',
  ALERT = 'ALERT'
}

export enum ProgressApprovalStatus {
  NONE = 'NONE',
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

// ============================================
// Core Entity Interfaces (Backend Schema)
// ============================================

/**
 * Organization entity (org table)
 */
export interface Organization {
  orgId: number
  orgName: string
  orgType: OrgType
  parentOrgId: number | null
  isActive: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/**
 * User entity (app_user table)
 */
export interface User {
  userId: number
  username: string
  realName: string
  orgId: number
  passwordHash?: string // Not exposed to frontend in normal operations
  ssoId: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Assessment Cycle entity (assessment_cycle table)
 */
export interface AssessmentCycle {
  cycleId: number
  cycleName: string
  year: number
  startDate: string
  endDate: string
  description: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Plan entity (strategic_task table in backend)
 *
 * TERMINOLOGY: Backend calls this "strategic_task", frontend calls it "Plan"
 */
export interface Plan {
  taskId: number // Backend field name
  cycleId: number
  taskName: string
  taskDesc: string | null
  taskType: TaskType
  orgId: number
  createdByOrgId: number
  sortOrder: number
  remark: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Task entity (indicator table in backend)
 *
 * TERMINOLOGY: Backend calls this "indicator", frontend calls it "Task"
 * This represents work items under a Plan
 */
export interface Task {
  indicatorId: number // Backend field name
  taskId: number // References Plan (strategic_task)
  parentIndicatorId: number | null
  level: IndicatorLevel
  ownerOrgId: number
  targetOrgId: number
  indicatorDesc: string
  weightPercent: number
  sortOrder: number
  year: number
  status: IndicatorStatus
  remark: string | null

  // Extended fields for frontend alignment
  isQualitative: boolean
  type1: '定性' | '定量'
  type2: '基础性' | '发展性'
  targetValue: number | null
  actualValue: number | null
  unit: string | null
  responsiblePerson: string | null
  canWithdraw: boolean
  progress: number
  statusAudit: StatusAuditEntry[]
  progressApprovalStatus: ProgressApprovalStatus
  pendingProgress: number | null
  pendingRemark: string | null
  pendingAttachments: string[]

  createdAt: string
  updatedAt: string
}

/**
 * Status audit entry (stored in indicator.status_audit JSONB)
 */
export interface StatusAuditEntry {
  id: string
  timestamp: string
  operator: string
  operatorName: string
  operatorDept: string
  action: 'submit' | 'approve' | 'reject' | 'revoke' | 'update' | 'distribute' | 'withdraw'
  comment?: string
  previousStatus?: string
  newStatus?: string
  previousProgress?: number
  newProgress?: number
}

/**
 * Milestone entity (milestone table)
 */
export interface Milestone {
  milestoneId: number
  indicatorId: number
  milestoneName: string
  milestoneDesc: string | null
  dueDate: string
  weightPercent: number
  status: MilestoneStatus
  sortOrder: number
  inheritedFrom: number | null
  targetProgress: number
  isPaired: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Progress Report entity (progress_report table)
 */
export interface ProgressReport {
  reportId: number
  indicatorId: number
  milestoneId: number | null
  adhocTaskId: number | null
  percentComplete: number
  achievedMilestone: boolean
  narrative: string | null
  reporterId: number
  status: ReportStatus
  isFinal: boolean
  versionNo: number
  submittedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Approval Record entity (approval_record table)
 */
export interface ApprovalRecord {
  approvalId: number
  reportId: number
  approverId: number
  action: ApprovalAction
  comments: string | null
  approvedAt: string
  createdAt: string
  updatedAt: string
}

/**
 * Alert Event entity (alert_event table)
 */
export interface AlertEvent {
  alertId: number
  indicatorId: number | null
  milestoneId: number | null
  severity: AlertSeverity
  alertMessage: string
  status: AlertStatus
  resolvedBy: number | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Audit Log entity (audit_log table)
 */
export interface AuditLog {
  logId: number
  entityType: AuditEntityType
  entityId: number
  action: AuditAction
  operatorId: number
  changesBefore: Record<string, unknown> | null
  changesAfter: Record<string, unknown> | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
}

/**
 * Refresh Token entity (refresh_token table)
 */
export interface RefreshToken {
  tokenId: number
  userId: number
  token: string
  expiresAt: string
  createdAt: string
}

/**
 * Idempotency Record entity (idempotency_record table)
 */
export interface IdempotencyRecord {
  recordId: number
  idempotencyKey: string
  requestPath: string
  requestMethod: string
  responseStatus: number
  responseBody: string | null
  createdAt: string
  expiresAt: string
}

// ============================================
// API Request/Response Types
// ============================================

/**
 * Standard API response wrapper
 * Matches backend API documentation format
 */
export interface ApiResponse<T> {
  code: number
  message: string
  data?: T
  timestamp?: string
}

/**
 * Paginated API response
 */
export interface PaginatedResponse<T> {
  code: number
  message: string
  data: T[]
  pagination?: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  timestamp?: string
}

/**
 * Error response
 * Matches backend API documentation format with business error codes
 */
export interface ApiError {
  code: number
  message: string
  timestamp?: string
  // Additional fields that may be present for specific errors
  errors?: Array<{
    field: string
    message: string
  }>
  requiredPermission?: string
  resourceType?: string
  resourceId?: string
  indicatorId?: number
  currentStatus?: string
  suggestion?: string
  errorId?: string
  [key: string]: unknown
}

// ============================================
// Frontend-Specific Types
// ============================================

/**
 * User role (derived from org_type)
 */
export type UserRole = 'strategic_dept' | 'functional_dept' | 'secondary_college'

/**
 * Permission definition
 */
export interface Permission {
  resource: string
  action: 'create' | 'read' | 'update' | 'delete' | 'approve'
  scope?: 'own' | 'department' | 'all'
}

/**
 * Attachment metadata
 */
export interface Attachment {
  id: string
  fileName: string
  fileSize: number
  fileType: string
  url: string
  uploadedBy: number
  uploadedAt: string
}

/**
 * Pagination parameters
 */
export interface PaginationParams {
  page: number
  pageSize: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

/**
 * Filter state for UI
 */
export interface FilterState {
  department?: string
  indicatorType?: '定性' | '定量'
  alertLevel?: AlertSeverity
  dateRange?: [string, string]
  sourceOwner?: string
  collegeFilter?: string
}

// ============================================
// Type Guards
// ============================================

export function isApiError(response: unknown): response is ApiError {
  return (
    response !== null &&
    typeof response === 'object' &&
    'code' in response &&
    'message' in response &&
    (response as { code: number }).code !== 200
  )
}

export function isApiResponse<T>(response: unknown): response is ApiResponse<T> {
  return (
    response !== null &&
    typeof response === 'object' &&
    'code' in response &&
    (response as { code: number }).code === 200
  )
}

export function isPaginatedResponse<T>(response: unknown): response is PaginatedResponse<T> {
  return (
    response !== null &&
    typeof response === 'object' &&
    'code' in response &&
    (response as { code: number }).code === 200 &&
    'data' in response &&
    Array.isArray((response as PaginatedResponse<T>).data)
  )
}

// ============================================
// Additional API-specific types
// ============================================

/**
 * Indicator VO (View Object) matching backend API
 */
export interface IndicatorVO {
  indicatorId: number
  parentIndicatorId?: number
  indicatorDesc: string
  year?: number | null
  type?: 'QUANTITATIVE' | 'QUALITATIVE' | '定量' | '定性'
  progress?: number
  reportProgress?: number | null
  manualAlertSeverity?: AlertSeverity | null
  hasCurrentMonthFill?: boolean
  ownerOrgId: number
  targetOrgId: number
  weightPercent: number
  sortOrder: number
  status: 'DRAFT' | 'PENDING' | 'DISTRIBUTED'
  createdAt: string
  updatedAt: string
  taskType?: 'BASIC' | 'DEVELOPMENT' | string
  // Extended fields for frontend alignment
  milestones?: MilestoneVO[]
  canDistribute?: boolean
  canWithdraw?: boolean
  targetValue?: number | null
  actualValue?: number | null
  unit?: string | null
  type1?: '定性' | '定量'
  type2?: '基础性' | '发展性'
  responsiblePerson?: string | null
  remark?: string | null
  // 后端返回的type字段（定量/定性）
  indicatorType?: string | null
}

/**
 * Milestone VO matching backend API
 */
export interface MilestoneVO {
  milestoneId: number
  indicatorId: number
  indicatorDesc: string
  milestoneName: string
  milestoneDesc?: string
  dueDate: string
  weightPercent: number
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'DELAYED' | 'CANCELED'
  sortOrder: number
  inheritedFromId?: number
  createdAt: string
  updatedAt: string
}

/**
 * Indicator create request matching backend API
 */
export interface IndicatorCreateRequest {
  indicatorDesc: string
  type?: 'QUANTITATIVE' | 'QUALITATIVE' | '定量' | '定性'
  indicatorType?: '定量' | '定性'
  type1?: '定量' | '定性'
  taskId?: number
  parentIndicatorId?: number
  ownerOrgId: number
  targetOrgId: number
  cycleId?: number
  weightPercent: number
  sortOrder?: number
  remark?: string
  progress?: number
  year?: number
  canWithdraw?: boolean
  milestones?: Array<{
    milestoneName: string
    milestoneDesc?: string
    dueDate: string
    weightPercent: number
    sortOrder?: number
  }>
}

/**
 * Indicator distribution request
 */
export interface IndicatorDistributionRequest {
  parentIndicatorId: string
  targetOrgId: string
  customDesc?: string
  actorUserId?: string
}

/**
 * Batch indicator distribution request
 */
export interface BatchDistributionRequest {
  parentIndicatorId: string
  targetOrgIds: string[]
  actorUserId?: string
}

export interface BatchDistributePageIndicatorsRequest {
  indicators: Array<{
    clientRequestId: string
    indicatorId?: number
    indicatorDesc?: string
    type?: 'QUANTITATIVE' | 'QUALITATIVE' | '定量' | '定性'
    indicatorType?: '定量' | '定性'
    type1?: '定量' | '定性'
    taskId?: number
    parentIndicatorId?: number
    ownerOrgId?: number
    targetOrgId: number
    weightPercent?: number
    sortOrder?: number
    remark?: string
    progress?: number
    customDesc?: string
    milestones?: Array<{
      milestoneName: string
      description?: string
      dueDate?: string
      targetProgress?: number
      sortOrder?: number
    }>
  }>
}

export interface BatchDistributePageIndicatorsResponse {
  totalCount: number
  items: Array<{
    clientRequestId?: string
    indicator: IndicatorVO
  }>
}

/**
 * Indicator distribution eligibility check
 */
export interface IndicatorDistributionEligibility {
  eligible: boolean
  reason?: string
  availableTargetOrgs?: Array<{
    orgId: number
    orgName: string
  }>
}

/**
 * Login credentials for authentication
 */
export interface LoginCredentials {
  username: string
  password: string
}

/**
 * Login response from backend
 */
export interface LoginResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: {
    id: number
    username: string
    realName: string
    orgId: number
    roles: string[]
  }
}

// ============================================
// Utility Types
// ============================================

/**
 * Make all properties optional recursively
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

/**
 * Make specific properties required
 */
export type RequireFields<T, K extends keyof T> = T & Required<Pick<T, K>>

/**
 * Omit multiple properties
 */
export type OmitMultiple<T, K extends keyof T> = Omit<T, K>

/**
 * Extract non-nullable properties
 */
export type NonNullableFields<T> = {
  [P in keyof T]: NonNullable<T[P]>
}
