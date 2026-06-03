/**
 * Types 统一导出
 *
 * 本文件提供所有类型定义的统一入口
 * 同时导出 TypeScript 类型和 Zod 运行时验证 Schema
 *
 * @module types
 */

// ============================================================================
// 统一实体类型导出 (与后端完全对齐)
// ============================================================================
/* eslint-disable no-restricted-syntax -- Backend-aligned types must use backend terminology */
export type {
  StrategicTask,
  Indicator,
  Milestone,
  User,
  AssessmentCycle,
  ProgressReport,
  StatusAuditEntry,
  PageResponse,
  ApiResponse,
  CreateStrategicTaskRequest,
  UpdateStrategicTaskRequest,
  CreateIndicatorRequest,
  UpdateIndicatorRequest,
  SubmitProgressApprovalRequest,
  ApproveProgressRequest,
  CreateMilestoneRequest,
  UpdateMilestoneRequest
} from './entities'
/* eslint-enable no-restricted-syntax */

export {
  MilestoneStatus,
  ProgressApprovalStatus,
  AuditAction,
  IndicatorStatus,
  UserRole
} from './entities'

// UI-only milestone type (frontend-friendly) to unify milestone display data
export interface MilestoneUI {
  id: string | number
  name: string
  deadline?: string
  targetProgress: number
  status?: string
  completed?: boolean
}

// ============================================================================
// Backend-Aligned VO Types (统一后端对齐类型)
// ============================================================================
export type {
  IndicatorVO,
  MilestoneVO,
  IndicatorCreateRequest,
  IndicatorDistributionRequest,
  BatchDistributionRequest,
  BatchDistributePageIndicatorsRequest,
  BatchDistributePageIndicatorsResponse,
  IndicatorDistributionEligibility
} from './backend-aligned'

export { TaskType } from './backend-aligned'

// 重新导出从 Schema 推断的类型
/* eslint-disable no-restricted-syntax -- Backend-aligned types inferred from schemas */
export type { LoginCredentials, StrategicIndicator } from './schemas'
/* eslint-enable no-restricted-syntax */

// ============================================================================
// 原有类型定义保持兼容性
// ============================================================================

// Core System Types
export type DrillDownLevel = 'organization' | 'department' | 'indicator'

export type EntityType = 'task' | 'indicator' | 'approval'

// User and Permission Types

export interface Permission {
  resource: string
  action: 'create' | 'read' | 'update' | 'delete' | 'approve'
}

// ============================================================================
// 以下是 UI 特有的类型定义
// 实体类型(StrategicTask, Indicator, Milestone 等)已移至 entities.ts
// 请使用: import { StrategicTask, Indicator, Milestone } from '@/shared/types'
// ============================================================================

// 里程碑配对状态摘要
export interface MilestonePairingStatus {
  totalMilestones: number
  pairedCount: number
  unpairedCount: number
  nextMilestoneToReport: any | null
  isAllPaired: boolean
  pairingProgress: number // 配对进度百分比
}

// 里程碑填报验证结果
export interface MilestoneReportValidation {
  milestoneId: string
  canReport: boolean
  message: string
  nextMilestoneToReport: any | null
}

// 仪表盘数据类型 (Enhanced)
export interface DashboardData {
  totalScore: number
  basicScore: number
  developmentScore: number
  completionRate: number
  warningCount: number
  totalIndicators: number
  completedIndicators: number
  alertIndicators: {
    severe: number
    moderate: number
    normal: number
  }
}

// 部门进度类型 (Enhanced)
export interface DepartmentProgress {
  dept: string
  progress: number
  score: number
  status: 'success' | 'warning' | 'exception'
  totalIndicators: number
  completedIndicators: number
  alertCount: number
}

// 指标类型 (Enhanced)

// 待审批项类型 (Enhanced)
export interface PendingApproval {
  id: string
  title: string
  submitter: string
  time: string
  type: string
  priority: 'high' | 'medium' | 'low'
  alertDescription?: string
  approvalStatus: string
}

// Approval Types
export interface ApprovalRequest {
  id: string
  indicatorId: string
  indicatorName: string
  submittedBy: string
  submittedDept: string
  submittedAt: Date
  approvalStatus: string
  approverId?: string
  approvedAt?: Date
  rejectionReason?: string
  priority: 'high' | 'medium' | 'low'
  alertDescription?: string
  attachments?: any[]
}

export interface ApprovalHistory {
  id: string
  requestId: string
  approverId: string
  approverName: string
  action: 'approved' | 'rejected'
  comment?: string
  timestamp: Date
}

// Reporting Types
// ProgressReport 已移至 entities.ts,请使用: import { ProgressReport } from '@/shared/types'

// Message Types
export type MessageType = 'alert' | 'approval' | 'reminder' | 'system'
export type AlertLevel = 'severe' | 'moderate' | 'normal'
export type MessageCategory = 'ALL' | 'TODO' | 'APPROVAL' | 'REMINDER' | 'SYSTEM' | 'RISK'
export type MessageBizType =
  | 'APPROVAL_TODO'
  | 'APPROVAL_RESULT'
  | 'REMINDER_NOTICE'
  | 'SYSTEM_NOTICE'
  | 'BUSINESS_NOTICE'
  | 'RISK_WARNING'
  | 'RISK_ALERT'

export interface Message {
  id: string
  messageId?: string
  type: MessageType
  title: string
  content: string
  detailContent?: string
  severity?: AlertLevel
  recipientRoles?: string[] // 接收者角色
  recipientDept?: string | string[] // 接收者部门
  recipientId?: string // 特定接收者ID
  isRead: boolean
  createdAt: Date
  relatedId?: string
  actionUrl?: string // 操作链接
  entityType?: string
  entityId?: string
  approvalInstanceId?: number
  status?: string
  category?: MessageCategory
  bizType?: MessageBizType
  readState?: 'UNREAD' | 'READ'
  actionState?: 'ACTION_REQUIRED' | 'DONE'
  canMarkAsRead?: boolean
  canViewDetail?: boolean
  canProcess?: boolean
  senderDisplay?: string
  currentStepName?: string
  currentAssigneeDisplay?: string
  metadata?: Record<string, unknown>
  syntheticSource?: 'notification' | 'pending_approval'
}

export interface NotificationSettings {
  userId: string
  emailNotifications: boolean
  alertNotifications: boolean
  approvalNotifications: boolean
  systemNotifications: boolean
}

// Tab 类型
export interface TabItem {
  id: string
  label: string
  icon: string
}

// 角色选项类型
export interface RoleOption {
  value: string
  label: string
}

// Utility Types
export interface Attachment {
  id: string
  fileName: string
  fileSize: number
  fileType: string
  url: string
  uploadedBy: number
  uploadedAt: string
}

export interface PaginationParams {
  page: number
  pageSize: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

// Form Types
// 注意: 以下表单类型需要与后端 VO 对齐
// eslint-disable-next-line no-restricted-syntax -- Comment references backend-aligned type names
// 使用 CreateStrategicTaskRequest / UpdateStrategicTaskRequest 代替

export interface PlanForm {
  taskName: string // 与后端对齐: taskName
  taskDesc: string | null // 与后端对齐: taskDesc
  cycleId: number // 与后端对齐: cycleId
  taskType: TaskType // 与后端对齐: taskType
  responsibleDept: string // 与后端对齐
  weight: number // 与后端对齐
  targetValue: number | null // 与后端对齐
}

export interface IndicatorForm {
  taskId: string
  name: string
  type: string
  targetValue: number
  unit: string
  description?: string
  responsibleDept: string
  responsiblePerson: string
  isStrategic: boolean
}

export interface ApprovalForm {
  requestId: string
  action: 'approve' | 'reject'
  comment?: string
  rejectionReason?: string
}

export interface ReportForm {
  indicatorId: string
  actualValue: number
  evidence?: string
  attachments?: File[]
}

// Chart and Visualization Types
export interface ChartData {
  labels: string[]
  datasets: ChartDataset[]
}

export interface ChartDataset {
  label: string
  data: number[]
  backgroundColor?: string | string[]
  borderColor?: string
  borderWidth?: number
}

export interface GaugeData {
  value: number
  min: number
  max: number
  thresholds: {
    severe: number
    moderate: number
    normal: number
  }
}

// System Configuration Types
export interface SystemConfig {
  alertThresholds: {
    severe: number
    moderate: number
  }
  approvalWorkflow: {
    autoApproveBelowThreshold: boolean
    threshold: number
  }
  reporting: {
    allowLateSubmission: boolean
    maxAttachments: number
    maxAttachmentSize: number
  }
}

// Error Types
export interface ApiError {
  code: string
  message: string
  details?: Record<string, unknown>
  timestamp: Date
}

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

export interface ValidationError {
  field: string
  message: string
  value?: unknown
}

// 面包屑导航
export interface BreadcrumbItem {
  level: DrillDownLevel
  label: string
  value?: string
}

// 筛选状态
export interface FilterState {
  department?: string
  indicatorType?: string
  alertLevel?: string
  dateRange?: [Date, Date]
  sourceOwner?: string // 任务来源过滤 (发布方部门)
  collegeFilter?: string // 学院过滤
}

// 审计日志
export interface AuditLogItem {
  id: string
  entityType: EntityType
  entityId: string
  entityName: string
  action: string
  operator: string
  operatorName: string
  operateTime: Date
  ipAddress?: string
  dataBefore?: Record<string, unknown>
  dataAfter?: Record<string, unknown>
  changes?: FieldChange[]
}

export interface FieldChange {
  field: string
  fieldLabel: string
  oldValue: unknown
  newValue: unknown
}

export interface AuditLogFilters {
  operator?: string
  entityType?: EntityType
  action?: string | string[]
  dateRange?: [Date, Date]
}

// 审批流程节点
export interface WorkflowNodeAttachment {
  name: string
  url: string
  attachmentId?: number
}

export interface WorkflowNode {
  id: string
  name: string
  status: 'completed' | 'current' | 'pending' | 'waiting' | 'rejected' | 'withdrawn'
  operator?: string
  operatorName?: string
  operatorAvatar?: string
  operateTime?: Date
  comment?: string
  attachments?: WorkflowNodeAttachment[]
  approverCandidates?: Array<{
    userId?: number
    username?: string
    realName?: string
    displayName: string
    avatar?: string
    approved?: boolean
    rejected?: boolean
  }>
}

// 审批历史项
export interface ApprovalHistoryItem {
  id: string
  action: 'submit' | 'approve' | 'reject' | 'withdraw'
  operator: string
  operatorName: string
  operatorAvatar?: string
  operateTime: Date
  stepName?: string
  comment?: string
  dataBefore?: Record<string, unknown>
  dataAfter?: Record<string, unknown>
}

// 热力图数据
export interface HeatmapData {
  taskId: string
  taskName: string
  progress: number
  status: 'success' | 'warning' | 'danger'
}

// 预警汇总
export interface AlertSummary {
  severe: number
  moderate: number
  normal: number
  total: number
}

// Dashboard Three-tier Drilldown Types

// 进度对比数据 (用于 ComparisonChart)
export interface ComparisonItem {
  dept: string // 部门名称
  progress: number // 平均进度 (0-100)
  score: number // 综合得分
  completionRate: number // 完成率 (0-100)
  totalIndicators: number // 指标总数
  completedIndicators: number // 已完成指标数
  alertCount: number // 预警数量
  status: 'success' | 'warning' | 'danger' // 状态
  rank: number // 排名
}

// 桑基图数据 (用于 TaskSankeyChart)
export interface SankeyLink {
  source: string // 源节点名称
  target: string // 目标节点名称
  value: number // 流量值 (任务数量)
}

export interface SankeyNode {
  name: string // 节点名称
  depth?: number // 深度 (层级)
}

export interface SankeyData {
  nodes: SankeyNode[] // 节点列表
  links: SankeyLink[] // 链接列表
}

// 任务来源分布 (用于 SourcePieChart)
export interface SourcePieData {
  name: string // 来源部门名称
  value: number // 任务数量
  percentage: number // 占比 (0-100)
}

// 扩展下钻层级类型
export type OrgLevel = 'strategy' | 'functional' | 'college'

// ============================================================
// 新数据结构类型定义 (Plan -> Task -> Indicator -> IndicatorFill)
// ============================================================

// Plan 状态类型
export type PlanStatus = 'draft' | 'pending' | 'returned' | 'published' | 'archived'

// Plan 审核状态
export type PlanFillStatus = 'submitted' | 'approved' | 'rejected'

// Task 类型
export type TaskType = 'qualitative' | 'quantitative'

/**
 * Plan (计划 - 顶层容器)
 * 相当于原来的"Task Plan"，作为一个"大文件夹"包含多个任务
 */
export interface Plan {
  id: string | number
  name: string
  cycle: string // 周期，如 '2023-2025'
  org_id: string | number // 所属组织
  status: PlanStatus
  tasks: Task[] // 包含的任务
  createdAt?: string
  updatedAt?: string
  createdBy?: string
  createdByOrgId?: number
  createdByOrgName?: string
  createdByName?: string
  description?: string
  targetOrgId?: number | string
  targetOrgName?: string
  orgName?: string
  planLevel?: string
  // 前端辅助字段
  totalIndicators?: number // 总指标数
  completedIndicators?: number // 已完成指标数
  completionPercentage?: number // 后端已计算好的完成百分比
  latestFillDate?: string // 最近填报日期
  workflowInstanceId?: number
  workflowStatus?: string
  currentTaskId?: number
  currentStep?: string
  currentStepName?: string
  currentApproverId?: number
  currentApproverName?: string
  canWithdraw?: boolean
  canEdit?: boolean
  canResubmit?: boolean
  submittedBy?: number
  submittedByName?: string
  submittedAt?: string
  lastRejectReason?: string
  workflowHistory?: Array<{
    taskId?: number
    stepName?: string
    operatorId?: number
    operatorName?: string
    action?: string
    comment?: string
    operateTime?: string
  }>
}

/**
 * Task (任务 - 逻辑分组)
 * 文件夹里的"分类隔板"，用于给指标分类，本身没有状态
 */
export interface Task {
  id: string | number
  plan_id: string | number
  name: string
  type: TaskType // qualitative | quantitative
  description?: string
  sortOrder?: number // 排序
  indicators: any[]
}

/**
 * IndicatorFill (指标填报历史 - 新增核心表)
 * 这张表格背后的"修改记录本"
 */
export interface IndicatorFill {
  id: string | number
  indicator_id: string | number
  plan_fill_id: string | number // 关联到某次整体填报
  report_id?: string | number
  fill_date: string // 填报日期
  progress: number // 当前进度百分比
  content: string // 填报说明/批注
  attachments: Attachment[] // 附件列表
  filled_by: string // 填报人ID
  filled_by_name: string // 填报人姓名
  created_at: string
  updated_at: string

  // 审核相关字段
  status?: PlanFillStatus // 当前填报的审核状态
  audit_comment?: string // 审核意见
  audited_by?: string // 审核人ID
  audited_at?: string // 审核时间
  workflowInstanceId?: string | number
  currentTaskId?: string | number
  workflowStatus?: string
  currentStepName?: string
  currentApproverId?: number
  currentApproverName?: string

  // 关联的里程碑（如果有）
  milestone_id?: string | number
  milestone_name?: string
}

/**
 * PlanFill (整体填报记录 - 用于审核)
 * 记录整个 Plan 的一次提交，包含多个 IndicatorFill
 */
export interface PlanFill {
  id: string | number
  plan_id: string | number
  submit_date: string
  status: PlanFillStatus
  submitted_by: string // 提交人ID
  submitted_by_name: string // 提交人姓名
  fills: IndicatorFill[] // 包含的所有指标填报记录
  audit_logs: AuditLogItem[] // 审核日志
  created_at: string
  updated_at: string
  total_indicators: number // 本次提交的指标总数
  completed_indicators: number // 已完成的指标数
}

/**
 * UserRoleWithPermission (权限相关)
 * 通过 Org ID 控制数据权限
 */
export interface UserRoleWithPermission {
  user_id: string | number
  role_name: string
  org_id: string | number // 核心：通过Org ID控制数据权限
  org_name: string
  permissions: Permission[] // 页面按钮级别的权限标识
  is_active: boolean
}

/**
 * 权限标识枚举
 */
export const PermissionCode = {
  // Plan 相关
  PLAN_CREATE: 'plan.create',
  PLAN_VIEW: 'plan.view',
  PLAN_EDIT: 'plan.edit',
  PLAN_DELETE: 'plan.delete',
  PLAN_SUBMIT: 'plan.submit',

  // Indicator 相关
  INDICATOR_VIEW: 'indicator.view',
  INDICATOR_FILL: 'indicator.fill',
  INDICATOR_EDIT: 'indicator.edit',

  // 审核相关
  AUDIT_VIEW: 'audit.view',
  AUDIT_APPROVE: 'audit.approve',
  AUDIT_REJECT: 'audit.reject',

  // Task 相关
  TASK_CREATE: 'task.create',
  TASK_EDIT: 'task.edit',
  TASK_DELETE: 'task.delete',

  // 战略任务审批相关权限
  BTN_STRATEGY_TASK_DISPATCH_APPROVE: 'BTN_STRATEGY_TASK_DISPATCH_APPROVE',
  BTN_STRATEGY_TASK_REPORT_APPROVE: 'BTN_STRATEGY_TASK_REPORT_APPROVE'
} as const
export type PermissionCode = (typeof PermissionCode)[keyof typeof PermissionCode]

/**
 * 填报记录表单
 */
export interface IndicatorFillForm {
  indicator_id: string | number
  progress: number
  content: string
  attachments?: File[]
  milestone_id?: string | number
  batch_items?: Array<{
    indicator_id: string | number
    indicator_name?: string
    progress: number
    content: string
    milestone_id?: string | number
    attachment_ids?: number[]
  }>
}

/**
 * Plan 提交表单
 */
export interface PlanSubmitForm {
  plan_id: string | number
  comment?: string
  attachments?: File[]
}

/**
 * 审核表单 - 后端API格式
 */
export interface AuditForm {
  fill_id?: string | number // 可以是 PlanFill 或 IndicatorFill 的 ID（前端使用）
  action: 'approve' | 'reject' | 'return' // 前端使用
  comment?: string
  userId?: number // 用户ID（后端API需要）
  // 后端API格式字段
  reportId?: string | number
  approved?: boolean
  action?: 'APPROVE' | 'REJECT' | 'RETURN'
  approvalNotes?: string
  rejectionReason?: string
  improvementSuggestions?: string
  reason?: string // 驳回原因（后端reject接口使用）
}

// ============================================================
// 用户管理相关类型 (User Management)
// ============================================================

/**
 * 用户管理项 - 用于管理后台列表
 */
export interface UserManagementItem {
  id: string | number
  username: string // 登录用户名
  realName: string // 真实姓名
  email?: string
  phone?: string
  orgId: string | number // 所属组织ID (核心权限控制字段)
  orgName: string // 所属组织名称
  roles: string[] // 用户角色列表 (支持多角色)
  status: 'active' | 'disabled' | 'locked'
  createdAt: string
  updatedAt: string
}

/**
 * 用户表单 - 创建/编辑用户
 */
export interface UserForm {
  id?: string | number // 编辑时有ID
  username: string
  password?: string // 新建时必填，编辑时留空表示不修改
  realName: string
  email?: string
  phone?: string
  orgId: string | number // 必填 - 决定数据权限
  roles: string[] // 必填 - 至少一个角色
  status: 'active' | 'disabled'
}

/**
 * 组织结构 - 用于用户管理中的组织选择器
 */
export interface Organization {
  id: string | number
  name: string
  type: string // strategic_dept | functional_dept | secondary_college
  parentId?: string | number
  children?: Organization[]
}

/**
 * 审批流程模板
 */
export interface ApprovalTemplate {
  id: string | number
  name: string // 模板名称，如 "标准审批流程"
  description?: string
  isDefault: boolean // 是否为默认模板
  steps: ApprovalTemplateStep[] // 审批步骤
  applicableRoles?: string[] // 适用角色
  createdAt: string
  updatedAt: string
}

/**
 * 审批流程步骤
 */
export interface ApprovalTemplateStep {
  id: string | number
  stepOrder: number // 步骤顺序
  stepName: string // 步骤名称，如 "主任审核"
  requiredRole: string // 需要的角色
  allowCustomApprover: boolean // 是否允许自定义审批人
  customApproverId?: string | number // 自定义审批人ID (可选)
  autoApprove: boolean // 是否自动通过
}
