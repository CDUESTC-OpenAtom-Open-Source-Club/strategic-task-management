/**
 * Indicator Entity Types
 *
 * Domain model types for strategic indicators based on backend entity structure.
 * These types represent the core business domain and are shared across features.
 */

/**
 * Indicator Status
 * Lifecycle states: DRAFT -> PENDING_REVIEW -> DISTRIBUTED -> ARCHIVED
 */
export type IndicatorStatus =
  | 'DRAFT' // Draft indicator (草稿 - not yet submitted for review)
  | 'PENDING_REVIEW' // Pending review (待审核 - submitted and awaiting approval)
  | 'DISTRIBUTED' // Distributed (已下发 - approved and distributed to departments)
  | 'ARCHIVED' // Archived/soft-deleted indicator (已归档)
  | 'PENDING' // @deprecated Use PENDING_REVIEW instead
  | 'ACTIVE' // @deprecated Use DISTRIBUTED instead

export const IndicatorStatus = {
  DRAFT: 'DRAFT' as const,
  PENDING_REVIEW: 'PENDING_REVIEW' as const,
  DISTRIBUTED: 'DISTRIBUTED' as const,
  ARCHIVED: 'ARCHIVED' as const,
  PENDING: 'PENDING' as const,
  ACTIVE: 'ACTIVE' as const
} as const

/**
 * Indicator Level
 * Hierarchical levels in the two-tier workflow system
 */
export type IndicatorLevel =
  | 'FIRST' // First-level indicator (一级指标) - Strategic to Functional
  | 'SECOND' // Second-level indicator (二级指标) - Functional to College
  | 'PRIMARY' // @deprecated Use FIRST instead
  | 'SECONDARY' // @deprecated Use SECOND instead

export const IndicatorLevel = {
  FIRST: 'FIRST' as const,
  SECOND: 'SECOND' as const,
  PRIMARY: 'PRIMARY' as const,
  SECONDARY: 'SECONDARY' as const
} as const

/**
 * Workflow Status
 * Six-state workflow lifecycle for filling distribution workflow
 */
export type WorkflowStatus =
  | 'DRAFT' // Draft state (草稿状态)
  | 'PENDING_DISTRIBUTION' // Pending distribution confirmation (待确认接收)
  | 'DISTRIBUTED' // Distributed and active (已下发)
  | 'PENDING_APPROVAL' // Pending approval (审批中)
  | 'REJECTED' // Rejected (已驳回)
  | 'COMPLETED' // Completed (已完成)

export const WorkflowStatus = {
  DRAFT: 'DRAFT' as const,
  PENDING_DISTRIBUTION: 'PENDING_DISTRIBUTION' as const,
  DISTRIBUTED: 'DISTRIBUTED' as const,
  PENDING_APPROVAL: 'PENDING_APPROVAL' as const,
  REJECTED: 'REJECTED' as const,
  COMPLETED: 'COMPLETED' as const
} as const

/**
 * Progress Approval Status
 * Status for progress report approval workflow
 */
export type ProgressApprovalStatus =
  | 'NONE' // No pending approval (无待审批)
  | 'DRAFT' // Draft (草稿)
  | 'PENDING' // Pending approval (审批中)
  | 'APPROVED' // Approved (已通过)
  | 'REJECTED' // Rejected (已驳回)

export const ProgressApprovalStatus = {
  NONE: 'NONE' as const,
  DRAFT: 'DRAFT' as const,
  PENDING: 'PENDING' as const,
  APPROVED: 'APPROVED' as const,
  REJECTED: 'REJECTED' as const
} as const

/**
 * Indicator Type
 * Defines whether indicator is qualitative or quantitative
 */
export type IndicatorType = 'QUALITATIVE' | 'QUANTITATIVE' | '定性' | '定量'

/**
 * Indicator Target
 * Target value configuration for quantitative indicators
 */
export interface IndicatorTarget {
  /** Target value to achieve */
  targetValue: number
  /** Current/actual value */
  currentValue?: number
  /** Unit of measurement */
  unit?: string
  /** Completion rate percentage */
  completionRate?: number
}

/**
 * Distribution Chain Entry
 * Tracks indicator distribution across organizational hierarchy
 */
export interface DistributionChainEntry {
  orgId: number
  orgName: string
  receivedAt: string
  confirmedAt?: string
  status?: string
}

/**
 * Indicator Entity
 * Core domain model for strategic performance indicators
 */
export interface Indicator {
  // Core identification
  id: number
  indicatorId?: number // Alias for id
  code?: string
  name: string
  indicatorDesc?: string // Alias for name/description
  description?: string

  // Hierarchy and relationships
  taskId: number
  taskName?: string
  parentIndicatorId?: number
  parentIndicator?: Indicator
  childIndicators?: Indicator[]
  level: IndicatorLevel
  indicatorLevel?: number // Numeric level (1 or 2)

  // Organization relationships
  ownerOrgId: number
  ownerOrg?: string
  ownerDept?: string
  targetOrgId: number
  targetOrg?: string
  responsibleDept?: string
  responsiblePerson?: string

  // Type and classification
  type: string // General type field
  type1?: string // 定量/定性
  type2?: string // 基础性/发展性
  isQualitative?: boolean
  isStrategic?: boolean

  // Status tracking
  status: IndicatorStatus
  workflowStatus: WorkflowStatus
  progressApprovalStatus?: ProgressApprovalStatus

  // Values and progress
  targetValue?: number
  actualValue?: number
  currentValue?: number // Alias for actualValue
  value?: number // Generic value field
  unit?: string
  progress?: number
  completionRate?: number

  // Weight and ordering
  weight?: number
  weightPercent?: number
  sortOrder?: number

  // Dates and timeline
  year?: number
  deadline?: string
  lastReportDate?: string
  createdAt: string
  updatedAt: string
  distributionConfirmedAt?: string

  // Pending approval data
  pendingProgress?: number
  pendingRemark?: string
  pendingAttachments?: string // JSON string

  // Report status from backend (based on plan_report table)
  hasCurrentMonthFill?: boolean

  // Metadata
  remark?: string
  confirmationNotes?: string
  canWithdraw?: boolean
  isDeleted?: boolean
  version?: number
  statusAudit?: string // JSON string

  // Related entities
  distributionChain?: DistributionChainEntry[]

  // Qualitative options (for qualitative indicators)
  qualitativeOptions?: string[]
}

/**
 * Indicator Create Request
 * Data required to create a new indicator
 */
export interface IndicatorCreateRequest {
  name: string
  code?: string
  description?: string
  type: IndicatorType
  taskId: number
  ownerOrgId: number
  targetOrgId: number
  level?: IndicatorLevel
  indicatorLevel?: number
  parentIndicatorId?: number
  weight?: number
  weightPercent?: number
  targetValue?: number
  actualValue?: number
  unit?: string
  year?: number
  deadline?: string
  type1?: string
  type2?: string
  isQualitative?: boolean
  qualitativeOptions?: string[]
  remark?: string
}

/**
 * Indicator Update Request
 * Data for updating an existing indicator
 */
export interface IndicatorUpdateRequest {
  name?: string
  description?: string
  targetValue?: number
  actualValue?: number
  unit?: string
  weight?: number
  weightPercent?: number
  progress?: number
  remark?: string
  responsiblePerson?: string
  deadline?: string
  type1?: string
  type2?: string
}

/**
 * Indicator Filters
 * Query filters for indicator list
 */
export interface IndicatorFilters {
  page?: number
  size?: number
  sort?: string
  order?: 'asc' | 'desc'
  name?: string
  code?: string
  type?: string
  type1?: string
  type2?: string
  status?: IndicatorStatus
  workflowStatus?: WorkflowStatus
  taskId?: number
  ownerOrgId?: number
  targetOrgId?: number
  level?: IndicatorLevel
  indicatorLevel?: number
  year?: number
  isStrategic?: boolean
}

/**
 * Distribute Request
 * Data for distributing indicators to target organizations
 */
export interface DistributeRequest {
  targetOrgIds: number[]
  message?: string
  deadline?: string
}

/**
 * Progress Submit Request
 * Data for submitting indicator progress
 */
export interface ProgressSubmitRequest {
  value: number
  evidence?: string
  attachments?: number[]
  remark?: string
}
