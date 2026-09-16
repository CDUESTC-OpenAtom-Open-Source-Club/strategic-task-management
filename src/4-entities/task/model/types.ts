/**
 * Task Entity Types
 *
 * Domain model types for strategic tasks based on backend entity structure.
 * These types represent the core task domain and are shared across features.
 *
 * Backend table: strategic_task
 * Backend VO: TaskVO
 */

/**
 * Task Type
 * Classification of strategic tasks
 */
export type TaskType =
  | 'BASIC' // 基础性任务
  | 'DEVELOPMENT' // 发展性任务

export const TaskType = {
  BASIC: 'BASIC' as const,
  DEVELOPMENT: 'DEVELOPMENT' as const
} as const

/**
 * Task Status
 * Lifecycle status of a task
 */
export type TaskStatus =
  | 'DRAFT' // 草稿
  | 'ACTIVE' // 活跃/进行中
  | 'COMPLETED' // 已完成
  | 'ARCHIVED' // 已归档
  | 'CANCELLED' // 已取消

export const TaskStatus = {
  DRAFT: 'DRAFT' as const,
  ACTIVE: 'ACTIVE' as const,
  COMPLETED: 'COMPLETED' as const,
  ARCHIVED: 'ARCHIVED' as const,
  CANCELLED: 'CANCELLED' as const
} as const

/**
 * Approval Status
 * Status of task approval workflow
 */
export type ApprovalStatus =
  | 'NONE' // 无需审批
  | 'DRAFT' // 草稿
  | 'PENDING' // 审批中
  | 'APPROVED' // 已批准
  | 'REJECTED' // 已拒绝

export const ApprovalStatus = {
  NONE: 'NONE' as const,
  DRAFT: 'DRAFT' as const,
  PENDING: 'PENDING' as const,
  APPROVED: 'APPROVED' as const,
  REJECTED: 'REJECTED' as const
} as const

/**
 * Task Entity
 * Core domain model for strategic tasks
 * Aligned with backend strategic_task table and TaskVO
 */
export interface Task {
  // Core identification
  taskId: number
  taskName: string
  taskDesc: string
  taskType: TaskType

  // Cycle and year
  cycleId: number
  cycleName: string
  year: number

  // Organization
  orgId: number
  orgName: string
  createdByOrgId: number
  createdByOrgName: string

  // Metadata
  sortOrder: number
  remark?: string

  // Approval
  approvalStatus?: ApprovalStatus

  // Timestamps
  createdAt: string
  updatedAt: string

  // Relations (optional, loaded on demand)
  planId?: number
  indicators?: Array<{
    indicatorId: number
    indicatorDesc: string
    weightPercent: number
    progress?: number
  }>
}

/**
 * Task Create Request
 * Data required to create a new task
 */
export interface TaskCreateRequest {
  taskName: string
  taskDesc: string
  taskType: TaskType
  cycleId: number
  year: number
  orgId: number
  createdByOrgId: number
  sortOrder?: number
  remark?: string
  planId?: number
}

/**
 * Task Update Request
 * Data for updating an existing task
 */
export interface TaskUpdateRequest {
  taskName?: string
  taskDesc?: string
  taskType?: TaskType
  sortOrder?: number
  remark?: string
  approvalStatus?: ApprovalStatus
}

/**
 * Task Filters
 * Query filters for task list
 */
export interface TaskFilters {
  page?: number
  size?: number
  sort?: string
  order?: 'asc' | 'desc'

  // Filter criteria
  taskName?: string
  taskType?: TaskType
  year?: number
  cycleId?: number
  orgId?: number
  createdByOrgId?: number
  approvalStatus?: ApprovalStatus

  // Search
  searchTerm?: string
}

/**
 * Task Summary
 * Lightweight task information for lists and dropdowns
 */
export interface TaskSummary {
  taskId: number
  taskName: string
  taskType: TaskType
  year: number
  cycleName: string
  orgName: string
  indicatorCount?: number
}

/**
 * Task Detail
 * Extended task information with related data
 */
export interface TaskDetail extends Task {
  // Extended indicator information
  indicators?: Array<{
    indicatorId: number
    indicatorDesc: string
    weightPercent: number
    progress?: number
    status?: string
    targetOrgName?: string
    responsibleDept?: string
  }>

  // Statistics
  totalWeight?: number
  averageProgress?: number
  completedIndicators?: number
  totalIndicators?: number
}

/**
 * Task Statistics
 * Aggregated statistics for tasks
 */
export interface TaskStatistics {
  totalTasks: number
  tasksByType: Record<TaskType, number>
  tasksByStatus: Record<string, number>
  tasksByYear: Record<number, number>
  averageIndicatorsPerTask: number
  averageProgressPerTask: number
}
