/**
 * Plan API 服务
 * 新数据结构: Plan -> Task -> Indicator -> IndicatorFill
 *
 * 这是配合后端数据库重构的新 API 层
 * 使用简化的 apiClient，在业务层实现必要的重试逻辑
 *
 * **Validates: Requirements 2.4, 2.6**
 */
import { apiClient } from '@/shared/api/client'
import { withRetry } from '@/shared/api/wrappers'
import { USE_MOCK } from '@/shared/config/api'
import { buildQueryKey, fetchWithCache, invalidateQueries } from '@/shared/lib/utils/cache'
import { getCachedUserContext } from '@/shared/lib/utils/cacheContext'
import { useTimeContextStore } from '@/shared/lib/timeContext'
import { logger } from '@/shared/lib/utils/logger'
import type {
  ApiResponse,
  Plan,
  PlanFill,
  PlanFillStatus,
  PlanStatus,
  IndicatorFill,
  Indicator,
  Task,
  IndicatorFillForm,
  PlanSubmitForm,
  AuditForm,
  Attachment
} from '@/shared/types'
import {
  getMyPendingTasks,
  approveTask,
  rejectTask,
  cancelWorkflow,
  getWorkflowInstanceDetail,
  getWorkflowInstanceDetailByBusiness
} from '@/features/workflow/api'
import { useAuthStore } from '@/features/auth/model/store'

export interface SubmitPlanApprovalPayload {
  workflowCode: string
  comment?: string
}

const PLAN_WITHDRAW_TIMEOUT_MS = 90000
const PLAN_REPORTS_CACHE_TTL_MS = 15 * 1000
const PLAN_REPORTS_CACHE_MAX_ENTRIES = 100
const planReportsByPlanIdCache = new Map<string, PlanReportSimpleResponse[]>()
const planReportsByPlanIdCacheTime = new Map<string, number>()
const planReportsByPlanIdInFlight = new Map<string, Promise<PlanReportSimpleResponse[]>>()

// ============================================================
// 后端 VO 类型定义 (与后端约定)
// Note: PlanVO and TaskVO are now imported from backend-aligned.ts
// ============================================================

export interface PlanVO {
  planId: number
  planName: string
  cycle: string
  orgId: number
  orgName: string
  status: string
  createdAt: string
  updatedAt: string
  createdBy: string
  description?: string
}

export interface TaskVO {
  taskId: number
  planId: number
  taskName: string
  taskType: string
  description?: string
  sortOrder?: number
}

// 计划模块专用的指标 VO（简化版本，仅用于计划填报）
export interface PlanIndicatorVO {
  indicatorId: number
  taskId: number
  name: string
  definition: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface IndicatorFillVO {
  fillId: number
  indicatorId: number
  planFillId: number
  fillDate: string
  progress: number
  content: string
  attachments: string
  filledBy: string
  filledByName: string
  createdAt: string
  updatedAt: string
  status?: 'SUBMITTED' | 'APPROVED' | 'REJECTED'
  auditComment?: string
  auditedBy?: string
  auditedAt?: string
  milestoneId?: number
  milestoneName?: string
}

export interface PlanFillVO {
  fillId: number
  planId: number
  submitDate: string
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED'
  submittedBy: string
  submittedByName: string
  createdAt: string
  updatedAt: string
  totalIndicators: number
  completedIndicators: number
}

function hasApiData<T>(response: { success?: boolean; code?: number; data?: T | null }) {
  return Boolean(response) && (response.success === true || response.code === 200)
}

type SilentApiResult<T> = {
  status: number
  data?: ApiResponse<T> | T
}

async function silentApiGet<T>(url: string): Promise<SilentApiResult<T>> {
  const response = await apiClient.getAxiosInstance().get<ApiResponse<T> | T>(url, {
    validateStatus: () => true,
    _skipBusinessErrorThrow: true
  })

  // `getAxiosInstance()` 仍会经过共享响应拦截器。
  // 在当前客户端实现下，这里拿到的可能已经不是原始 AxiosResponse，
  // 而是业务层 envelope（{ success, code, data, message }）或直接 data。
  // 因此需要同时兼容：
  // 1. 原始 AxiosResponse
  // 2. 规范化后的 ApiResponse
  // 3. 直接返回的数据对象
  if (
    response &&
    typeof response === 'object' &&
    ('success' in response || 'code' in response || 'message' in response) &&
    !('status' in response)
  ) {
    return {
      status: Number((response as ApiResponse<T>).code ?? 200),
      data: response as ApiResponse<T>
    }
  }

  return {
    status: (response as { status?: number }).status,
    data: (response as { data?: ApiResponse<T> | T }).data
  }
}

function invalidatePlanCaches(planId?: number | string): void {
  const targets: Array<string | readonly [string, string, Record<string, string>]> = [
    'plan.list',
    'dashboard.overview',
    'workflow.todo',
    'workflow.detail',
    'workflow.instances',
    'workflow.statistics'
  ]
  if (planId !== undefined) {
    targets.push('plan.detail', `plan.detail.${planId}`)
    targets.push(buildQueryKey('plan', 'detail', { planId: String(planId), kind: 'basic' }))
    targets.push(buildQueryKey('plan', 'detail', { planId: String(planId), kind: 'full' }))
  }
  invalidateQueries(targets)
}

function normalizeApprovalStatus(status?: string): PlanFillStatus {
  if (status === 'APPROVED') {
    return 'approved'
  }
  if (status === 'REJECTED') {
    return 'rejected'
  }
  return 'submitted'
}

function unwrapPlanCollection(
  data: Plan[] | { items?: Plan[]; content?: Plan[]; records?: Plan[] } | null | undefined
): Plan[] {
  if (Array.isArray(data)) {
    return data
  }

  if (data && typeof data === 'object') {
    if ('items' in data && Array.isArray(data.items)) {
      return data.items
    }
    if ('content' in data && Array.isArray(data.content)) {
      return data.content
    }
    if ('records' in data && Array.isArray(data.records)) {
      return data.records
    }
  }

  return []
}

function normalizeYear(value: unknown): number | null {
  if (value == null || value === '') {
    return null
  }

  const numericYear = Number(value)
  return Number.isFinite(numericYear) ? numericYear : null
}

function withPlanCacheContext(params?: Record<string, unknown>): Record<string, unknown> {
  return {
    ...getCachedUserContext(),
    ...(params ?? {}),
    version: 'v1'
  }
}

function resolvePlanYear(
  raw: Record<string, any>,
  resolveCycleYear?: (cycleId: unknown) => number | null
): number | null {
  return normalizeYear(raw.year ?? raw.cycle?.year) ?? resolveCycleYear?.(raw.cycleId) ?? null
}

function convertBackendPlanToPlan(
  raw: Record<string, any>,
  resolveCycleYear?: (cycleId: unknown) => number | null
): Plan {
  const inferredYear = resolvePlanYear(raw, resolveCycleYear)
  const cycleLabel = raw.year ?? inferredYear ?? raw.cycle ?? ''
  const resolvedTargetOrgName =
    typeof raw.targetOrgName === 'string' && raw.targetOrgName.trim()
      ? raw.targetOrgName.trim()
      : typeof raw.orgName === 'string' && raw.orgName.trim()
        ? raw.orgName.trim()
        : undefined
  // Business views must follow the persisted plan status.
  // workflowStatus is retained separately for approval detail rendering,
  // but it must not override DRAFT after a withdraw.
  const effectiveStatus = raw.status
  const normalizedCompletionPercentage = Number(raw.completionPercentage)
  const normalizedCompletedIndicators = Number(raw.completedIndicators)
  const normalizedTotalIndicators = Number(raw.indicatorCount ?? raw.totalIndicators)

  return {
    id: raw.id ?? raw.planId,
    name: raw.planName ?? raw.name ?? '',
    cycle: String(cycleLabel),
    org_id: raw.targetOrgId ?? raw.orgId ?? raw.org_id ?? '',
    status: planApi.convertStatusFromBackend(effectiveStatus),
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    createdAt: raw.createTime ?? raw.createdAt,
    updatedAt: raw.updatedAt,
    createdBy: raw.createdByOrgId != null ? String(raw.createdByOrgId) : raw.createdBy,
    ...('createdByOrgId' in raw ? { createdByOrgId: Number(raw.createdByOrgId) || undefined } : {}),
    ...('createdByOrgName' in raw ? { createdByOrgName: raw.createdByOrgName } : {}),
    ...('createdByName' in raw ? { createdByName: raw.createdByName } : {}),
    description: raw.description,
    ...(Number.isFinite(normalizedTotalIndicators)
      ? { totalIndicators: normalizedTotalIndicators }
      : {}),
    ...(Number.isFinite(normalizedCompletedIndicators)
      ? { completedIndicators: normalizedCompletedIndicators }
      : {}),
    ...(Number.isFinite(normalizedCompletionPercentage)
      ? { completionPercentage: normalizedCompletionPercentage }
      : {}),
    // Preserve backend fields used by existing views during the migration period.
    ...('targetOrgId' in raw || 'orgId' in raw
      ? { targetOrgId: raw.targetOrgId ?? raw.orgId }
      : {}),
    ...(resolvedTargetOrgName ? { targetOrgName: resolvedTargetOrgName } : {}),
    ...('orgName' in raw ? { orgName: raw.orgName } : {}),
    ...('cycleId' in raw ? { cycleId: raw.cycleId } : {}),
    ...(inferredYear != null ? { year: inferredYear } : {}),
    ...('planLevel' in raw ? { planLevel: raw.planLevel } : {}),
    ...('workflowInstanceId' in raw
      ? { workflowInstanceId: Number(raw.workflowInstanceId) || undefined }
      : {}),
    ...('currentTaskId' in raw ? { currentTaskId: Number(raw.currentTaskId) || undefined } : {}),
    ...('workflowStatus' in raw ? { workflowStatus: raw.workflowStatus } : {}),
    ...('currentStepName' in raw
      ? { currentStepName: raw.currentStepName, currentStep: raw.currentStepName }
      : {}),
    ...('currentApproverId' in raw
      ? { currentApproverId: Number(raw.currentApproverId) || undefined }
      : {}),
    ...('currentApproverName' in raw ? { currentApproverName: raw.currentApproverName } : {}),
    ...('canWithdraw' in raw ? { canWithdraw: Boolean(raw.canWithdraw) } : {}),
    ...('canEdit' in raw ? { canEdit: Boolean(raw.canEdit) } : {}),
    ...('canResubmit' in raw ? { canResubmit: Boolean(raw.canResubmit) } : {}),
    ...('submittedBy' in raw ? { submittedBy: Number(raw.submittedBy) || undefined } : {}),
    ...('submittedByName' in raw ? { submittedByName: raw.submittedByName } : {}),
    ...('submittedAt' in raw ? { submittedAt: raw.submittedAt } : {}),
    ...('lastRejectReason' in raw ? { lastRejectReason: raw.lastRejectReason } : {}),
    ...('workflowHistory' in raw && Array.isArray(raw.workflowHistory)
      ? { workflowHistory: raw.workflowHistory }
      : {})
  } as Plan
}

function convertApprovalDetailToPlanFill(
  detail: ApprovalDetail & Record<string, unknown>
): PlanFill {
  return {
    id: detail.id,
    plan_id: detail.entityId,
    submit_date:
      (detail.startedAt as string) ||
      (detail.initiatedAt as string) ||
      (detail.createdAt as string) ||
      '',
    status: normalizeApprovalStatus(detail.status),
    submitted_by: String(detail.requesterId ?? detail.initiatedBy ?? ''),
    submitted_by_name:
      (detail.requesterName as string) ||
      (detail.title as string) ||
      (detail.requesterId ? `申请人 #${detail.requesterId}` : '待确认提交人'),
    fills: [],
    audit_logs: [],
    created_at:
      (detail.createdAt as string) ||
      (detail.startedAt as string) ||
      (detail.initiatedAt as string) ||
      '',
    updated_at:
      (detail.updatedAt as string) ||
      (detail.completedAt as string) ||
      (detail.startedAt as string) ||
      '',
    total_indicators: 0,
    completed_indicators: 0
  }
}

// ============================================================
// 假数据生成器 (用于前端开发，后端就绪后移除)
// ============================================================

const mockPlans: PlanVO[] = [
  {
    planId: 1,
    planName: '2025年度战略指标考核计划',
    cycle: '2025',
    orgId: 100,
    orgName: '战略发展部',
    status: 'PUBLISHED',
    createdAt: '2025-01-01T00:00:00',
    updatedAt: '2025-01-01T00:00:00',
    createdBy: 'admin',
    description: '2025年度全校战略指标考核计划'
  },
  {
    planId: 2,
    planName: '2025年第一季度指标填报',
    cycle: '2025-Q1',
    orgId: 200,
    orgName: '教务处',
    status: 'PENDING',
    createdAt: '2025-01-15T00:00:00',
    updatedAt: '2025-02-01T00:00:00',
    createdBy: 'dept_admin',
    description: '第一季度教学相关指标填报'
  },
  {
    planId: 100,
    planName: '2026 教务处年度计划',
    cycle: '2026',
    year: '2026',
    orgId: 3,
    orgName: '教务处',
    status: 'DRAFT',
    createdAt: '2026-01-05T00:00:00',
    updatedAt: '2026-03-15T10:00:00',
    createdBy: 'jiaowuchu',
    description: '2026年度教务处下发计划',
    targetOrgId: 3,
    targetOrgName: '教务处',
    createdByOrgId: 3
  },
  {
    planId: 101,
    planName: '2026 计算机学院计划',
    cycle: '2026',
    year: '2026',
    orgId: 5,
    orgName: '计算机学院',
    status: 'PENDING',
    createdAt: '2026-03-15T10:00:00',
    updatedAt: '2026-03-15T10:00:00',
    createdBy: 'jiaowuchu',
    description: '教务处下发给计算机学院的年度计划',
    targetOrgId: 5,
    targetOrgName: '计算机学院',
    createdByOrgId: 3,
    workflowStatus: 'PENDING',
    workflowInstanceId: 9001,
    currentTaskId: 9001,
    currentStepName: '职能部门审批',
    currentApproverId: 4,
    currentApproverName: '王五',
    canWithdraw: false
  }
]

const mockTasks: TaskVO[] = [
  {
    taskId: 1,
    planId: 1,
    taskName: '教学质量提升',
    taskType: 'QUALITATIVE',
    description: '定性指标：教学质量评估与提升',
    sortOrder: 1
  },
  {
    taskId: 2,
    planId: 1,
    taskName: '科研产出指标',
    taskType: 'QUANTITATIVE',
    description: '定量指标：科研项目与成果统计',
    sortOrder: 2
  },
  {
    taskId: 3,
    planId: 2,
    taskName: '学生满意度',
    taskType: 'QUANTITATIVE',
    description: '学生满意度调查统计',
    sortOrder: 1
  },
  {
    taskId: 10101,
    planId: 101,
    taskName: '教学质量提升',
    taskType: 'QUANTITATIVE',
    description: '计算机学院年度教学质量指标',
    sortOrder: 1
  }
]

const mockIndicators: PlanIndicatorVO[] = [
  {
    indicatorId: 1,
    taskId: 1,
    name: '课程思政建设成效',
    definition: '评估课程思政建设的实施情况和效果',
    sortOrder: 1,
    createdAt: '2025-01-01T00:00:00',
    updatedAt: '2025-01-01T00:00:00'
  },
  {
    indicatorId: 2,
    taskId: 1,
    name: '教学方法创新',
    definition: '教学方法的改革与创新实践',
    sortOrder: 2,
    createdAt: '2025-01-01T00:00:00',
    updatedAt: '2025-01-01T00:00:00'
  },
  {
    indicatorId: 3,
    taskId: 2,
    name: '国家级项目立项数',
    definition: '当年获批国家级科研项目数量',
    sortOrder: 1,
    createdAt: '2025-01-01T00:00:00',
    updatedAt: '2025-01-01T00:00:00'
  },
  {
    indicatorId: 4,
    taskId: 2,
    name: '高水平论文发表数',
    definition: '发表在顶级期刊的论文数量',
    sortOrder: 2,
    createdAt: '2025-01-01T00:00:00',
    updatedAt: '2025-01-01T00:00:00'
  },
  {
    indicatorId: 5,
    taskId: 3,
    name: '本科生满意度',
    definition: '本科生对教学质量的满意度评分',
    sortOrder: 1,
    createdAt: '2025-01-15T00:00:00',
    updatedAt: '2025-01-15T00:00:00'
  }
]

const mockIndicatorFills: IndicatorFillVO[] = [
  {
    fillId: 1,
    indicatorId: 1,
    planFillId: 1,
    fillDate: '2025-01-15',
    progress: 75,
    content: '已完成5门课程的思政建设，学生反馈良好',
    attachments: '[]',
    filledBy: 'user001',
    filledByName: '张老师',
    createdAt: '2025-01-15T10:30:00',
    updatedAt: '2025-01-15T10:30:00',
    status: 'APPROVED',
    auditComment: '审核通过',
    auditedBy: 'admin',
    auditedAt: '2025-01-16T09:00:00'
  },
  {
    fillId: 2,
    indicatorId: 1,
    planFillId: 2,
    fillDate: '2025-02-15',
    progress: 85,
    content: '新增2门课程思政案例，组织一次教学研讨会',
    attachments: '[{"name":"研讨会照片.jpg","url":"/files/seminar.jpg"}]',
    filledBy: 'user001',
    filledByName: '张老师',
    createdAt: '2025-02-15T14:20:00',
    updatedAt: '2025-02-15T14:20:00',
    status: 'SUBMITTED',
    milestoneId: 1,
    milestoneName: '第一季度里程碑'
  },
  {
    fillId: 3,
    indicatorId: 3,
    planFillId: 1,
    fillDate: '2025-01-20',
    progress: 60,
    content: '已提交2项国家级项目申请',
    attachments: '[]',
    filledBy: 'user002',
    filledByName: '李老师',
    createdAt: '2025-01-20T16:00:00',
    updatedAt: '2025-01-20T16:00:00',
    status: 'APPROVED',
    auditComment: '符合预期',
    auditedBy: 'admin',
    auditedAt: '2025-01-21T10:30:00'
  },
  {
    fillId: 4,
    indicatorId: 5,
    planFillId: 2,
    fillDate: '2025-02-10',
    progress: 92,
    content: '本季度满意度调查结果良好',
    attachments: '[{"name":"满意度报告.pdf","url":"/files/report.pdf"}]',
    filledBy: 'user003',
    filledByName: '王老师',
    createdAt: '2025-02-10T11:00:00',
    updatedAt: '2025-02-10T11:00:00',
    status: 'PENDING'
  }
]

const mockPlanFills: PlanFillVO[] = [
  {
    fillId: 1,
    planId: 1,
    submitDate: '2025-01-31',
    status: 'APPROVED',
    submittedBy: 'user001',
    submittedByName: '张老师',
    createdAt: '2025-01-31T23:59:00',
    updatedAt: '2025-02-01T09:00:00',
    totalIndicators: 4,
    completedIndicators: 4
  },
  {
    fillId: 2,
    planId: 1,
    submitDate: '2025-02-15',
    status: 'SUBMITTED',
    submittedBy: 'user001',
    submittedByName: '张老师',
    createdAt: '2025-02-15T18:00:00',
    updatedAt: '2025-02-15T18:00:00',
    totalIndicators: 4,
    completedIndicators: 3
  }
]

// ============================================================
// 类型转换函数
// ============================================================

function convertFillStatus(status: string): PlanFillStatus {
  const map: Record<string, PlanFillStatus> = {
    SUBMITTED: 'submitted',
    APPROVED: 'approved',
    REJECTED: 'rejected',
    PENDING: 'submitted' // PENDING 映射为 SUBMITTED
  }
  return map[status] || 'submitted'
}

function parseAttachments(attachmentsStr: string): Attachment[] {
  try {
    return JSON.parse(attachmentsStr || '[]')
  } catch {
    return []
  }
}

function convertPlanVOToPlan(vo: PlanVO, tasks: Task[]): Plan {
  return {
    ...convertBackendPlanToPlan(vo as unknown as Record<string, any>),
    tasks
  }
}

function convertTaskVOToTask(vo: TaskVO, indicators: Indicator[]): Task {
  return {
    id: vo.taskId,
    plan_id: vo.planId,
    name: vo.taskName,
    type: vo.taskType.toLowerCase() as 'qualitative' | 'quantitative',
    description: vo.description,
    sortOrder: vo.sortOrder,
    indicators
  }
}

function convertIndicatorVOToIndicator(vo: PlanIndicatorVO): Indicator {
  // 查找该指标的最新填报记录
  const fills = mockIndicatorFills.filter(f => f.indicatorId === vo.indicatorId)
  const latestFill = fills.sort(
    (a, b) => new Date(b.fillDate).getTime() - new Date(a.fillDate).getTime()
  )[0]

  return {
    id: vo.indicatorId,
    task_id: vo.taskId,
    name: vo.name,
    definition: vo.definition,
    milestones: [], // 里程碑将单独获取
    createdAt: vo.createdAt,
    updatedAt: vo.updatedAt,
    latest_progress: latestFill?.progress,
    latest_fill_date: latestFill?.fillDate,
    latest_fill_id: latestFill?.fillId?.toString(),
    fill_count: fills.length
  }
}

function convertIndicatorFillVOToIndicatorFill(vo: IndicatorFillVO): IndicatorFill {
  return {
    id: vo.fillId,
    indicator_id: vo.indicatorId,
    plan_fill_id: vo.planFillId,
    fill_date: vo.fillDate,
    progress: vo.progress,
    content: vo.content,
    attachments: parseAttachments(vo.attachments),
    filled_by: vo.filledBy,
    filled_by_name: vo.filledByName,
    created_at: vo.createdAt,
    updated_at: vo.updatedAt,
    status: vo.status ? convertFillStatus(vo.status) : undefined,
    audit_comment: vo.auditComment,
    audited_by: vo.auditedBy,
    audited_at: vo.auditedAt,
    milestone_id: vo.milestoneId,
    milestone_name: vo.milestoneName
  }
}

interface PlanReportSimpleResponse {
  id: number
  planId?: number
  reportMonth?: string
  reportOrgId?: number
  reportOrgType?: 'FUNC_DEPT' | 'COLLEGE'
  auditInstanceId?: number | null
  title?: string | null
  content?: string | null
  summary?: string | null
  progress?: number | null
  issues?: string | null
  nextPlan?: string | null
  status?: string | null
  submittedBy?: number | null
  submittedAt?: string | null
  approvedBy?: number | null
  approvedAt?: string | null
  rejectionReason?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  workflowInstanceId?: number | null
  currentTaskId?: number | null
  workflowStatus?: string | null
  currentStepName?: string | null
  currentApproverId?: number | null
  currentApproverName?: string | null
  canWithdraw?: boolean
  indicatorDetails?: PlanReportIndicatorDetailResponse[] | null
}

interface PlanReportIndicatorDetailResponse {
  indicatorId: number
  progress?: number | null
  comment?: string | null
  milestoneNote?: string | null
  attachments?: Attachment[] | null
}

interface IndicatorReportContext {
  indicatorId: number
  taskId: number
  planId: number
  reportOrgId: number
  reportOrgType: 'FUNC_DEPT' | 'COLLEGE'
  reportMonth: string
  indicatorName: string
}

function convertReportStatusToFillStatus(status?: string | null): PlanFillStatus | undefined {
  const normalized = String(status || '').toUpperCase()
  const map: Record<string, PlanFillStatus> = {
    SUBMITTED: 'submitted',
    IN_REVIEW: 'submitted',
    APPROVED: 'approved',
    REJECTED: 'rejected'
  }
  return map[normalized]
}

function mapPlanReportToIndicatorFill(
  report: PlanReportSimpleResponse,
  context: Pick<IndicatorReportContext, 'indicatorId' | 'indicatorName'>
): IndicatorFill {
  const matchedDetail = Array.isArray(report.indicatorDetails)
    ? report.indicatorDetails.find(
        detail => Number(detail.indicatorId) === Number(context.indicatorId)
      )
    : undefined
  const fallbackDetail =
    !matchedDetail && Array.isArray(report.indicatorDetails) && report.indicatorDetails.length === 1
      ? report.indicatorDetails[0]
      : undefined
  const resolvedDetail = matchedDetail ?? fallbackDetail
  const normalizedProgress = Number(resolvedDetail?.progress ?? report.progress ?? 0)
  const fillDate =
    report.reportMonth && /^\d{6}$/.test(report.reportMonth)
      ? `${report.reportMonth.slice(0, 4)}-${report.reportMonth.slice(4, 6)}-01`
      : report.reportMonth && /^\d{4}-\d{2}$/.test(report.reportMonth)
        ? `${report.reportMonth}-01`
        : report.updatedAt || report.createdAt || new Date().toISOString()

  return {
    id: report.id,
    indicator_id: context.indicatorId,
    plan_fill_id: report.planId ?? 0,
    report_id: report.id,
    fill_date: fillDate,
    progress: Number.isFinite(normalizedProgress) ? normalizedProgress : 0,
    content: resolvedDetail?.comment || report.content || report.summary || report.title || '',
    attachments: Array.isArray(resolvedDetail?.attachments) ? resolvedDetail.attachments : [],
    filled_by: report.submittedBy != null ? String(report.submittedBy) : '',
    filled_by_name: report.submittedBy != null ? `用户${report.submittedBy}` : '当前部门',
    created_at: report.createdAt || fillDate,
    updated_at: report.updatedAt || report.createdAt || fillDate,
    status: convertReportStatusToFillStatus(report.status),
    audit_comment: report.rejectionReason || undefined,
    audited_by: report.approvedBy != null ? String(report.approvedBy) : undefined,
    audited_at: report.approvedAt || undefined,
    workflowInstanceId: report.workflowInstanceId ?? report.auditInstanceId ?? undefined,
    currentTaskId: report.currentTaskId ?? undefined,
    workflowStatus: report.workflowStatus ?? undefined,
    currentStepName: report.currentStepName ?? undefined,
    currentApproverId: report.currentApproverId ?? undefined,
    currentApproverName: report.currentApproverName ?? undefined
  }
}

async function enrichPlanReportWorkflow(
  report: PlanReportSimpleResponse
): Promise<PlanReportSimpleResponse> {
  if (!report?.id) {
    return report
  }

  const auditInstanceId = Number(report.auditInstanceId ?? NaN)

  try {
    if (Number.isFinite(auditInstanceId) && auditInstanceId > 0) {
      const workflowResponse = await getWorkflowInstanceDetail(String(auditInstanceId))
      if (hasApiData(workflowResponse) && workflowResponse.data) {
        return {
          ...report,
          workflowInstanceId: Number(workflowResponse.data.instanceId) || auditInstanceId,
          currentTaskId: Number(workflowResponse.data.currentTaskId) || undefined,
          workflowStatus: workflowResponse.data.status,
          canWithdraw: Boolean(workflowResponse.data.canWithdraw),
          currentStepName: workflowResponse.data.currentStepName ?? undefined,
          currentApproverId: workflowResponse.data.currentApproverId ?? undefined,
          currentApproverName: workflowResponse.data.currentApproverName ?? undefined
        }
      }
    }
  } catch (error) {
    console.warn('[planApi] load workflow detail by auditInstanceId failed', {
      reportId: report.id,
      auditInstanceId,
      error
    })
  }

  try {
    const workflowResponse = await getWorkflowInstanceDetailByBusiness('PLAN_REPORT', report.id)
    if (hasApiData(workflowResponse) && workflowResponse.data) {
      return {
        ...report,
        workflowInstanceId: Number(workflowResponse.data.instanceId) || undefined,
        currentTaskId: Number(workflowResponse.data.currentTaskId) || undefined,
        workflowStatus: workflowResponse.data.status,
        canWithdraw: Boolean(workflowResponse.data.canWithdraw),
        currentStepName: workflowResponse.data.currentStepName ?? undefined,
        currentApproverId: workflowResponse.data.currentApproverId ?? undefined,
        currentApproverName: workflowResponse.data.currentApproverName ?? undefined
      }
    }
  } catch (error) {
    console.warn('[planApi] load workflow detail by business entity failed', {
      reportId: report.id,
      error
    })
  }

  return report
}

function mapRoleToReportOrgType(
  role?: string | null,
  departmentName?: string | null
): 'FUNC_DEPT' | 'COLLEGE' {
  switch (role) {
    case 'secondary_college':
      return 'COLLEGE'
    default:
      return String(departmentName || '').includes('学院') ? 'COLLEGE' : 'FUNC_DEPT'
  }
}

function getCurrentReportMonth(): string {
  return new Date().toISOString().slice(0, 7).replace('-', '')
}

function getNormalizedReportStatus(status?: string | null): string {
  return String(status || '')
    .trim()
    .toUpperCase()
}

function isActiveCurrentReportStatus(status?: string | null): boolean {
  const normalizedStatus = getNormalizedReportStatus(status)
  return (
    normalizedStatus === 'DRAFT' ||
    normalizedStatus === 'REJECTED' ||
    normalizedStatus === 'PENDING' ||
    normalizedStatus === 'IN_REVIEW' ||
    normalizedStatus === 'SUBMITTED'
  )
}

function isLockedPlanReportStatus(status?: string | null): boolean {
  return ['SUBMITTED', 'IN_REVIEW', 'APPROVED'].includes(getNormalizedReportStatus(status))
}

async function resolveIndicatorFillSaveContext(indicatorId: number | string): Promise<{
  context: IndicatorReportContext
  currentMonthReports: PlanReportSimpleResponse[]
  latestCurrentMonthReport?: PlanReportSimpleResponse
  editableExistingReport?: PlanReportSimpleResponse
}> {
  const context = await resolveIndicatorReportContext(indicatorId)
  const reports = await loadPlanReportsByPlanId(context.planId)
  const currentMonthReports = reports
    .filter(
      report =>
        Number(report.reportOrgId) === context.reportOrgId &&
        report.reportMonth === context.reportMonth
    )
    .sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt || 0).getTime() -
        new Date(a.updatedAt || a.createdAt || 0).getTime()
    )

  const latestCurrentMonthReport = currentMonthReports[0]
  const editableExistingReport = currentMonthReports.find(report => {
    const normalizedStatus = getNormalizedReportStatus(report.status)
    return normalizedStatus === 'DRAFT' || normalizedStatus === 'REJECTED'
  })

  if (latestCurrentMonthReport && !editableExistingReport) {
    const lockedStatus = getNormalizedReportStatus(latestCurrentMonthReport.status)
    if (lockedStatus === 'IN_REVIEW' || lockedStatus === 'SUBMITTED') {
      throw new Error('本月已有上报正在审批中，暂时不能重复保存或提交')
    }
  }

  return {
    context,
    currentMonthReports,
    latestCurrentMonthReport,
    editableExistingReport
  }
}

async function resolveIndicatorReportContext(
  indicatorId: number | string
): Promise<IndicatorReportContext> {
  const { indicatorApi } = await import('@/features/indicator/api')
  const { useOrgStore } = await import('@/features/organization/model/store')
  const timeContext = useTimeContextStore()

  const indicatorResponse = await indicatorApi.getIndicatorById(String(indicatorId))
  if (!hasApiData(indicatorResponse) || !indicatorResponse.data) {
    throw new Error('加载指标详情失败，无法建立填报上下文')
  }

  const indicatorData = indicatorResponse.data as Record<string, unknown>
  const numericIndicatorId = Number(indicatorData.id ?? indicatorData.indicatorId ?? indicatorId)
  const taskId = Number(indicatorData.taskId ?? indicatorData.task_id)

  const authStore = useAuthStore()
  const orgStore = useOrgStore()
  if (!orgStore.loaded || orgStore.departments.length === 0) {
    await orgStore.loadDepartments()
  }

  const targetDepartmentName = String(
    indicatorData.targetOrgName ?? authStore.effectiveDepartment ?? authStore.userDepartment ?? ''
  )
  const matchedDepartment = orgStore.getDepartmentByName(targetDepartmentName)
  const fallbackOrgId = Number(
    indicatorData.targetOrgId ?? matchedDepartment?.id ?? indicatorData.ownerOrgId
  )
  const reportOrgId = Number(indicatorData.targetOrgId ?? matchedDepartment?.id ?? fallbackOrgId)

  if (!Number.isFinite(reportOrgId)) {
    throw new Error('无法识别当前部门组织ID，无法保存填报')
  }

  const inferredRole =
    matchedDepartment?.type === 'secondary_college'
      ? 'secondary_college'
      : matchedDepartment?.type === 'functional_dept'
        ? 'functional_dept'
        : authStore.effectiveRole

  const isCollegeReportContext =
    inferredRole === 'secondary_college' ||
    String(targetDepartmentName).includes('学院') ||
    (Number(authStore.user?.orgId ?? NaN) > 0 &&
      Number(authStore.user?.orgId ?? NaN) === reportOrgId &&
      Number(indicatorData.ownerOrgId ?? NaN) > 0 &&
      Number(indicatorData.ownerOrgId ?? NaN) !== reportOrgId)

  const sourceOrgId = Number(indicatorData.ownerOrgId ?? NaN)
  const currentYear = Number(timeContext.currentYear ?? NaN)

  const resolvePlanIdFromVisiblePlans = async (): Promise<number | null> => {
    if (
      !Number.isFinite(reportOrgId) ||
      reportOrgId <= 0 ||
      !Number.isFinite(currentYear) ||
      currentYear <= 0
    ) {
      return null
    }

    const resolveCycleYear = await getCycleYearResolver()
    const allPlans = await fetchAllPlansFromPages(resolveCycleYear)

    if (isCollegeReportContext) {
      const matchedCollegeReceivingPlan = allPlans.find(plan => {
        const candidateTargetOrgId = Number(plan.targetOrgId ?? plan.orgId ?? NaN)
        const candidateCreatedByOrgId = Number(
          (plan as Record<string, unknown>).createdByOrgId ?? NaN
        )
        const candidatePlanLevel = String((plan as Record<string, unknown>).planLevel || '')
          .trim()
          .toUpperCase()
        const candidateYear = Number(plan.year ?? resolveCycleYear(plan.cycleId) ?? NaN)

        return (
          Number.isFinite(candidateTargetOrgId) &&
          candidateTargetOrgId === reportOrgId &&
          Number.isFinite(candidateCreatedByOrgId) &&
          candidateCreatedByOrgId === sourceOrgId &&
          candidatePlanLevel === 'FUNC_TO_COLLEGE' &&
          Number.isFinite(candidateYear) &&
          candidateYear === currentYear
        )
      })

      if (matchedCollegeReceivingPlan?.id) {
        return Number(matchedCollegeReceivingPlan.id)
      }
    }

    const matchedPlan = allPlans.find(plan => {
      const candidateTargetOrgId = Number(plan.targetOrgId ?? plan.orgId ?? NaN)
      const candidateYear = Number(plan.year ?? resolveCycleYear(plan.cycleId) ?? NaN)
      return (
        Number.isFinite(candidateTargetOrgId) &&
        candidateTargetOrgId === reportOrgId &&
        Number.isFinite(candidateYear) &&
        candidateYear === currentYear
      )
    })

    return matchedPlan?.id ? Number(matchedPlan.id) : null
  }

  let resolvedPlanId = Number(indicatorData.planId ?? indicatorData.plan_id ?? NaN)

  if (!Number.isFinite(resolvedPlanId) || resolvedPlanId <= 0) {
    if (Number.isFinite(taskId) && taskId > 0) {
      try {
        const taskResponse = await apiClient
          .getAxiosInstance()
          .get<ApiResponse<Record<string, unknown>> | Record<string, unknown>>(`/tasks/${taskId}`, {
            validateStatus: () => true,
            _skipBusinessErrorThrow: true
          })

        if (taskResponse.status >= 200 && taskResponse.status < 300) {
          const taskPayload =
            taskResponse.data &&
            typeof taskResponse.data === 'object' &&
            'data' in taskResponse.data
              ? ((taskResponse.data as { data?: Record<string, unknown> }).data ?? null)
              : (taskResponse.data as Record<string, unknown> | null)

          if (taskPayload) {
            const taskPlanId = Number(taskPayload.planId ?? taskPayload.plan_id)
            if (Number.isFinite(taskPlanId) && taskPlanId > 0) {
              resolvedPlanId = taskPlanId
            }
          }
        }
      } catch (error) {
        logger.warn(
          '[indicatorFillApi] Failed to load task detail for report context, fallback to visible plan lookup',
          {
            indicatorId,
            taskId,
            error
          }
        )
      }
    }
  }

  if (!Number.isFinite(resolvedPlanId) || resolvedPlanId <= 0) {
    const fallbackPlanId = await resolvePlanIdFromVisiblePlans()
    if (Number.isFinite(fallbackPlanId) && (fallbackPlanId as number) > 0) {
      resolvedPlanId = fallbackPlanId as number
    }
  }

  if (!Number.isFinite(resolvedPlanId) || resolvedPlanId <= 0) {
    throw new Error('无法定位关联计划，无法保存填报')
  }

  return {
    indicatorId: Number.isFinite(numericIndicatorId) ? numericIndicatorId : Number(indicatorId),
    taskId,
    planId: resolvedPlanId,
    reportOrgId,
    reportOrgType: mapRoleToReportOrgType(inferredRole, targetDepartmentName),
    reportMonth: getCurrentReportMonth(),
    indicatorName: String(
      indicatorData.indicatorName ?? indicatorData.name ?? indicatorData.indicatorDesc ?? '指标填报'
    )
  }
}

async function loadPlanReportsByPlanId(planId: number): Promise<PlanReportSimpleResponse[]> {
  const normalizedPlanId = Number(planId)
  if (!Number.isFinite(normalizedPlanId) || normalizedPlanId <= 0) {
    return []
  }

  cleanupExpiredPlanReportCacheEntries()

  const cacheKey = String(normalizedPlanId)
  const cachedAt = planReportsByPlanIdCacheTime.get(cacheKey) ?? 0
  const cachedReports = planReportsByPlanIdCache.get(cacheKey)
  const now = Date.now()

  if (cachedReports && now - cachedAt < PLAN_REPORTS_CACHE_TTL_MS) {
    return cachedReports
  }

  const inFlightRequest = planReportsByPlanIdInFlight.get(cacheKey)
  if (inFlightRequest) {
    return inFlightRequest
  }

  const requestPromise = (async () => {
    const response = await apiClient.get<ApiResponse<PlanReportSimpleResponse[]>>(
      `/reports/plan/${normalizedPlanId}`
    )
    if (!hasApiData(response)) {
      throw new Error(
        typeof response.message === 'string'
          ? response.message || '加载计划报告失败'
          : '加载计划报告失败'
      )
    }

    const reports = Array.isArray(response.data) ? response.data : []
    const enrichedReports = await Promise.all(
      reports.map(report => enrichPlanReportWorkflow(report))
    )
    planReportsByPlanIdCache.set(cacheKey, enrichedReports)
    planReportsByPlanIdCacheTime.set(cacheKey, Date.now())
    evictOldestPlanReportCacheEntryIfNeeded()
    return enrichedReports
  })()

  planReportsByPlanIdInFlight.set(cacheKey, requestPromise)

  try {
    return await requestPromise
  } finally {
    planReportsByPlanIdInFlight.delete(cacheKey)
  }
}

function invalidatePlanReportsCache(planId: number | string): void {
  const normalizedPlanId = Number(planId)
  if (!Number.isFinite(normalizedPlanId) || normalizedPlanId <= 0) {
    return
  }

  const cacheKey = String(normalizedPlanId)
  planReportsByPlanIdCache.delete(cacheKey)
  planReportsByPlanIdCacheTime.delete(cacheKey)
  planReportsByPlanIdInFlight.delete(cacheKey)
}

function cleanupExpiredPlanReportCacheEntries(now = Date.now()): void {
  for (const [key, cachedAt] of planReportsByPlanIdCacheTime.entries()) {
    if (now - cachedAt < PLAN_REPORTS_CACHE_TTL_MS) {
      continue
    }

    planReportsByPlanIdCache.delete(key)
    planReportsByPlanIdCacheTime.delete(key)
  }
}

function evictOldestPlanReportCacheEntryIfNeeded(): void {
  if (planReportsByPlanIdCache.size <= PLAN_REPORTS_CACHE_MAX_ENTRIES) {
    return
  }

  let oldestKey: string | null = null
  let oldestTimestamp = Number.POSITIVE_INFINITY

  for (const [key, timestamp] of planReportsByPlanIdCacheTime.entries()) {
    if (timestamp >= oldestTimestamp) {
      continue
    }

    oldestKey = key
    oldestTimestamp = timestamp
  }

  if (!oldestKey) {
    return
  }

  planReportsByPlanIdCache.delete(oldestKey)
  planReportsByPlanIdCacheTime.delete(oldestKey)
}

function resolveCurrentMonthPlanReportSummaries(
  reports: PlanReportSimpleResponse[],
  reportOrgId: number,
  reportMonth: string
): {
  currentReport: PlanReportSimpleResponse | null
  latestReport: PlanReportSimpleResponse | null
} {
  const currentMonthReports = reports
    .filter(
      report =>
        Number(report.reportOrgId) === Number(reportOrgId) && report.reportMonth === reportMonth
    )
    .sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt || 0).getTime() -
        new Date(a.updatedAt || a.createdAt || 0).getTime()
    )

  const currentWorkflowReport =
    currentMonthReports.find(report => {
      const normalizedStatus = getNormalizedReportStatus(report.status)
      return ['PENDING', 'IN_REVIEW', 'SUBMITTED', 'APPROVED'].includes(normalizedStatus)
    }) ||
    currentMonthReports.find(report => {
      const normalizedStatus = getNormalizedReportStatus(report.status)
      return (
        Boolean(report.workflowInstanceId ?? report.auditInstanceId) &&
        !['DRAFT', 'REJECTED', 'WITHDRAWN', 'CANCELLED'].includes(normalizedStatus)
      )
    }) ||
    null

  const currentEditableReport =
    currentMonthReports.find(report =>
      ['DRAFT', 'REJECTED'].includes(getNormalizedReportStatus(report.status))
    ) || null

  return {
    currentReport: currentWorkflowReport || currentEditableReport || currentMonthReports[0] || null,
    latestReport:
      currentMonthReports.find(report => {
        const normalizedStatus = getNormalizedReportStatus(report.status)
        return (
          Boolean(report.workflowInstanceId ?? report.auditInstanceId) ||
          ['PENDING', 'IN_REVIEW', 'SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN'].includes(
            normalizedStatus
          )
        )
      }) ||
      currentMonthReports[0] ||
      null
  }
}

async function loadPlanReportById(reportId: number | string): Promise<PlanReportSimpleResponse> {
  const result = await silentApiGet<PlanReportSimpleResponse>(`/reports/${reportId}`)
  const response = result.data as ApiResponse<PlanReportSimpleResponse> | undefined
  if (result.status >= 500 || !response || !hasApiData(response) || !response.data) {
    throw new Error(
      typeof response.message === 'string'
        ? response.message || '加载报告详情失败'
        : '加载报告详情失败'
    )
  }
  return enrichPlanReportWorkflow(response.data)
}

function normalizePlanCollection(
  data: Plan[] | { items?: Plan[]; content?: Plan[]; records?: Plan[] } | null | undefined,
  resolveCycleYear?: (cycleId: unknown) => number | null
): Plan[] {
  return unwrapPlanCollection(data).map(item =>
    convertBackendPlanToPlan(item as Record<string, any>, resolveCycleYear)
  )
}

type PaginatedPlanCollection = {
  items?: Plan[]
  content?: Plan[]
  records?: Plan[]
  totalPages?: number
  page?: number
  pageSize?: number
  total?: number
  last?: boolean
}

async function fetchAllPlansFromPages(
  resolveCycleYear?: (cycleId: unknown) => number | null
): Promise<Plan[]> {
  const pageSize = 1000
  const firstResponse = await apiClient.get<ApiResponse<Plan[] | PaginatedPlanCollection>>(
    '/plans',
    {
      page: 0,
      size: pageSize
    }
  )
  const allPlans = normalizePlanCollection(firstResponse.data, resolveCycleYear)

  if (!hasApiData(firstResponse)) {
    return allPlans
  }

  const payload = firstResponse.data?.data
  if (!payload || Array.isArray(payload)) {
    return allPlans
  }

  const totalPages = Number(payload.totalPages)
  if (!Number.isFinite(totalPages) || totalPages <= 1) {
    return allPlans
  }

  const planMap = new Map(allPlans.map(plan => [String(plan.id), plan]))

  for (let page = 1; page < totalPages; page += 1) {
    const response = await apiClient.get<ApiResponse<Plan[] | PaginatedPlanCollection>>('/plans', {
      page,
      size: pageSize
    })
    if (!hasApiData(response)) {
      break
    }

    normalizePlanCollection(response.data, resolveCycleYear).forEach(plan => {
      planMap.set(String(plan.id), plan)
    })
  }

  return Array.from(planMap.values())
}

async function getCycleYearResolver(): Promise<(cycleId: unknown) => number | null> {
  const timeContext = useTimeContextStore()
  await timeContext.initialize()
  return (cycleId: unknown) => timeContext.resolveCycleYear(cycleId)
}

async function loadPlansByCycleFallback(): Promise<ApiResponse<Plan[]>> {
  const resolveCycleYear = await getCycleYearResolver()
  const cyclesResponse =
    await apiClient.get<ApiResponse<Array<{ id?: number | string; cycleId?: number | string }>>>(
      '/cycles/list'
    )

  const cycles = Array.isArray(cyclesResponse.data) ? cyclesResponse.data : []
  const cycleIds = cycles
    .map(cycle => Number(cycle.id ?? cycle.cycleId ?? NaN))
    .filter(cycleId => Number.isFinite(cycleId) && cycleId > 0)

  if (cycleIds.length === 0) {
    return {
      ...(cyclesResponse as ApiResponse<Plan[]>),
      data: []
    }
  }

  const cyclePlanResponses = await Promise.all(
    cycleIds.map(async cycleId => {
      const response = await apiClient.get<ApiResponse<Plan[]>>(`/plans/cycle/${cycleId}`)
      return Array.isArray(response.data) ? response.data : []
    })
  )

  const planMap = new Map<string, Plan>()
  cyclePlanResponses
    .flat()
    .map(plan => convertBackendPlanToPlan(plan as Record<string, any>, resolveCycleYear))
    .forEach(plan => {
      const key = String(plan.id ?? '')
      if (key) {
        planMap.set(key, plan)
      }
    })

  const data = Array.from(planMap.values()).sort((a, b) => {
    const left = new Date(String((a as Plan & { created_at?: string }).created_at || '')).getTime()
    const right = new Date(String((b as Plan & { created_at?: string }).created_at || '')).getTime()
    return right - left
  })

  return {
    success: true,
    code: 200,
    message: '获取成功（周期兜底）',
    data,
    timestamp: new Date().toISOString()
  }
}

function convertPlanFillVOToPlanFill(vo: PlanFillVO, fills: IndicatorFill[]): PlanFill {
  return {
    id: vo.fillId,
    plan_id: vo.planId,
    submit_date: vo.submitDate,
    status: convertFillStatus(vo.status),
    submitted_by: vo.submittedBy,
    submitted_by_name: vo.submittedByName,
    fills,
    audit_logs: [], // 审核日志将单独获取
    created_at: vo.createdAt,
    updated_at: vo.updatedAt,
    total_indicators: vo.totalIndicators,
    completed_indicators: vo.completedIndicators
  }
}

// ============================================================
// Plan API 服务
// ============================================================

export const planApi = {
  // 使用模拟数据标志（后端就绪后设为 false）
  useMockData: USE_MOCK,

  /**
   * 获取所有 Plan
   */
  async getAllPlans(): Promise<ApiResponse<Plan[]>> {
    if (this.useMockData) {
      // 使用假数据
      const plans = mockPlans.map(planVO => {
        const tasks = mockTasks
          .filter(t => t.planId === planVO.planId)
          .map(taskVO => {
            const indicators = mockIndicators
              .filter(i => i.taskId === taskVO.taskId)
              .map(convertIndicatorVOToIndicator)
            return convertTaskVOToTask(taskVO, indicators)
          })
        return convertPlanVOToPlan(planVO, tasks)
      })

      return {
        code: 200,
        data: plans,
        message: '获取成功',
        timestamp: new Date().toISOString()
      }
    }

    // 真实 API 调用（后端就绪后启用）
    return fetchWithCache({
      key: buildQueryKey('plan', 'list', withPlanCacheContext()),
      policy: {
        // Plan status is workflow-critical. Keep only a short-lived in-memory cache
        // so a reopened page does not render an outdated persisted status snapshot.
        ttlMs: 15 * 1000,
        scope: 'memory',
        staleWhileRevalidate: false,
        dedupeWindowMs: 1000,
        tags: ['plan.list']
      },
      fetcher: async () => {
        try {
          const resolveCycleYear = await getCycleYearResolver()
          const data = await fetchAllPlansFromPages(resolveCycleYear)
          return {
            success: true,
            code: 200,
            message: '获取成功',
            data,
            timestamp: new Date().toISOString()
          }
        } catch (error) {
          const fallbackResponse = await loadPlansByCycleFallback()
          return fallbackResponse
        }
      }
    })
  },

  /**
   * 根据 org_id 获取 Plan 列表
   * 后端不支持 /plans/org/{orgId}，改为使用 /plans 配合过滤参数
   * 注意：后端返回分页格式，需要转换
   */
  async getPlansByOrg(orgId: number | string): Promise<ApiResponse<Plan[]>> {
    if (this.useMockData) {
      const allPlans = await this.getAllPlans()
      const filtered = allPlans.data?.filter(p => p.org_id === orgId) || []
      return {
        ...allPlans,
        data: filtered
      }
    }

    // 后端使用 /plans 端点，不支持按 orgId 过滤
    // 返回空数组或使用其他方式过滤
    const response = await apiClient.get<
      ApiResponse<Plan[] | { items?: Plan[]; content?: Plan[]; records?: Plan[] }>
    >('/plans', { page: 0, size: 1000 })
    const resolveCycleYear = await getCycleYearResolver()
    return {
      ...response,
      data: normalizePlanCollection(response.data, resolveCycleYear).filter(
        p => String(p.org_id) === String(orgId)
      )
    }
  },

  /**
   * 根据 status 获取 Plan 列表
   * 使用后端 /plans?status=xxx 接口
   */
  async getPlansByStatus(status: PlanStatus): Promise<ApiResponse<Plan[]>> {
    if (this.useMockData) {
      const allPlans = await this.getAllPlans()
      const filtered = allPlans.data?.filter(p => p.status === status) || []
      return {
        ...allPlans,
        data: filtered
      }
    }

    // 使用后端支持的状态过滤参数
    const response = await apiClient.get<
      ApiResponse<Plan[] | { items?: Plan[]; content?: Plan[]; records?: Plan[] }>
    >('/plans', { status, page: 0, size: 1000 })
    const resolveCycleYear = await getCycleYearResolver()
    return {
      ...response,
      data: normalizePlanCollection(response.data, resolveCycleYear)
    }
  },

  /**
   * 获取单个 Plan 详情
   */
  async getPlanById(planId: number | string): Promise<ApiResponse<Plan | null>> {
    if (this.useMockData) {
      const planVO = mockPlans.find(p => p.planId === Number(planId))
      if (!planVO) {
        return {
          code: 1002,
          data: null,
          message: 'Plan not found',
          timestamp: new Date().toISOString()
        }
      }

      const tasks = mockTasks
        .filter(t => t.planId === planVO.planId)
        .map(taskVO => {
          const indicators = mockIndicators
            .filter(i => i.taskId === taskVO.taskId)
            .map(convertIndicatorVOToIndicator)
          return convertTaskVOToTask(taskVO, indicators)
        })

      return {
        code: 200,
        data: convertPlanVOToPlan(planVO, tasks),
        message: '获取成功',
        timestamp: new Date().toISOString()
      }
    }

    return fetchWithCache({
      key: buildQueryKey(
        'plan',
        'detail',
        withPlanCacheContext({ planId: String(planId), kind: 'basic' })
      ),
      policy: {
        ttlMs: 60 * 1000,
        scope: 'memory',
        dedupeWindowMs: 1000,
        tags: ['plan.detail', `plan.detail.${planId}`]
      },
      fetcher: async () => {
        const resolveCycleYear = await getCycleYearResolver()
        const response = await apiClient.get<ApiResponse<Plan>>(`/plans/${planId}`)
        if (hasApiData(response) && response.data) {
          return {
            ...response,
            data: convertBackendPlanToPlan(response.data as Record<string, any>, resolveCycleYear)
          }
        }

        return response
      }
    })
  },

  /**
   * 获取 Plan 详情（包含指标和里程碑）
   * 调用后端的 /api/v1/plans/{id}/details 接口
   */
  async getPlanDetails(planId: number | string): Promise<ApiResponse<Plan | null>> {
    if (this.useMockData) {
      // Mock 数据实现：复用 getPlanById
      return this.getPlanById(planId)
    }

    // 调用后端的 Plan 详情接口
    return fetchWithCache({
      key: buildQueryKey(
        'plan',
        'detail',
        withPlanCacheContext({ planId: String(planId), kind: 'full' })
      ),
      policy: {
        ttlMs: 60 * 1000,
        scope: 'memory',
        dedupeWindowMs: 1000,
        tags: ['plan.detail', `plan.detail.${planId}`]
      },
      fetcher: async () => {
        const resolveCycleYear = await getCycleYearResolver()
        const result = await silentApiGet<Plan>(`/plans/${planId}/details`)
        const response = result.data as ApiResponse<Plan> | undefined

        if (result.status >= 500 || !response || !hasApiData(response) || !response.data) {
          logger.warn('[planApi] plan details endpoint unavailable, fallback to basic plan', {
            planId,
            status: result.status,
            message:
              response && typeof response === 'object' && 'message' in response
                ? response.message
                : undefined
          })
          return this.getPlanById(planId)
        }

        if (hasApiData(response) && response.data) {
          const backendData = response.data as any
          const tasks: Task[] = []
          const indicators = backendData.indicators || []

          if (indicators.length > 0) {
            tasks.push({
              id: planId,
              plan_id: planId,
              name: backendData.planName || '指标任务',
              type: 'quantitative',
              description: backendData.description,
              sortOrder: 0,
              indicators: indicators.map((ind: any) => ({
                id: ind.id,
                task_id: planId,
                name: ind.indicatorName || ind.name || '',
                definition: ind.indicatorDesc || ind.description || '',
                milestones: [],
                createdAt: ind.createdAt,
                updatedAt: ind.updatedAt,
                latest_progress: ind.progress,
                latest_fill_date: undefined,
                latest_fill_id: undefined,
                fill_count: 0
              }))
            })
          }

          const plan: Plan = {
            ...convertBackendPlanToPlan(backendData, resolveCycleYear),
            tasks
          }

          return {
            ...response,
            data: {
              ...plan,
              indicators
            } as Plan
          }
        }

        return response
      }
    })
  },

  /**
   * 转换后端状态到前端状态
   */
  convertStatusFromBackend(status: string): PlanStatus {
    const map: Record<string, PlanStatus> = {
      DRAFT: 'draft',
      PENDING: 'pending',
      IN_REVIEW: 'pending',
      PENDING_APPROVAL: 'pending',
      RETURNED: 'draft',
      REJECTED: 'draft',
      WITHDRAWN: 'draft',
      CANCELLED: 'draft',
      COMPLETED: 'draft',
      APPROVED: 'published',
      DISTRIBUTED: 'published',
      ACTIVE: 'published',
      PUBLISHED: 'published',
      ARCHIVED: 'archived'
    }
    return map[status] || 'draft'
  },

  /**
   * 创建 Plan
   */
  async createPlan(data: Partial<Plan>): Promise<ApiResponse<Plan>> {
    if (this.useMockData) {
      const newPlan: Plan = {
        id: mockPlans.length + 1,
        ...data,
        tasks: data.tasks || []
      } as Plan

      mockPlans.push({
        planId: newPlan.id as number,
        planName: newPlan.name,
        cycle: newPlan.cycle,
        orgId: newPlan.org_id as number,
        orgName: '',
        status: (newPlan.status?.toUpperCase() as 'DRAFT' | 'ACTIVE' | 'ARCHIVED') || 'DRAFT',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: newPlan.createdBy || 'current_user',
        description: newPlan.description
      })

      return {
        code: 200,
        data: newPlan,
        message: '创建成功',
        timestamp: new Date().toISOString()
      }
    }

    return withRetry(async () => {
      const response = await apiClient.post<ApiResponse<Plan>>('/plans', data)
      invalidatePlanCaches(response.data?.id ?? response.data?.plan_id)
      return response
    })
  },

  /**
   * 更新 Plan
   */
  async updatePlan(planId: number | string, data: Partial<Plan>): Promise<ApiResponse<Plan>> {
    if (this.useMockData) {
      const index = mockPlans.findIndex(p => p.planId === Number(planId))
      if (index !== -1) {
        mockPlans[index] = { ...mockPlans[index], ...data }
        return {
          code: 200,
          data: convertPlanVOToPlan(mockPlans[index], []),
          message: '更新成功',
          timestamp: new Date().toISOString()
        }
      }
      return {
        code: 1002,
        data: null as never,
        message: 'Plan not found',
        timestamp: new Date().toISOString()
      }
    }

    return withRetry(async () => {
      const response = await apiClient.put<ApiResponse<Plan>>(`/plans/${planId}`, data)
      invalidatePlanCaches(planId)
      return response
    })
  },

  /**
   * 删除 Plan
   */
  async deletePlan(planId: number | string): Promise<ApiResponse<void>> {
    if (this.useMockData) {
      const index = mockPlans.findIndex(p => p.planId === Number(planId))
      if (index !== -1) {
        mockPlans.splice(index, 1)
        return {
          success: true,
          data: undefined,
          message: '删除成功',
          timestamp: new Date().toISOString()
        }
      }
      return {
        code: 1002,
        data: undefined,
        message: 'Plan not found',
        timestamp: new Date().toISOString()
      }
    }

    return withRetry(async () => {
      const response = await apiClient.delete<ApiResponse<void>>(`/plans/${planId}`)
      invalidatePlanCaches(planId)
      return response
    })
  },

  /**
   * 提交 Plan（整包提交）- 用于填报提交
   */
  async submitPlan(form: PlanSubmitForm): Promise<ApiResponse<PlanFill>> {
    if (this.useMockData) {
      const newPlanFill: PlanFill = {
        id: mockPlanFills.length + 1,
        plan_id: form.plan_id,
        submit_date: new Date().toISOString().split('T')[0],
        status: 'submitted',
        submitted_by: 'current_user',
        submitted_by_name: '当前用户',
        fills: [],
        audit_logs: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        total_indicators: 0,
        completed_indicators: 0
      }

      mockPlanFills.push({
        fillId: newPlanFill.id as number,
        planId: form.plan_id as number,
        submitDate: newPlanFill.submit_date,
        status: 'SUBMITTED',
        submittedBy: newPlanFill.submitted_by,
        submittedByName: newPlanFill.submitted_by_name,
        createdAt: newPlanFill.created_at,
        updatedAt: newPlanFill.updated_at,
        totalIndicators: newPlanFill.total_indicators,
        completedIndicators: newPlanFill.completed_indicators
      })

      return {
        code: 200,
        data: newPlanFill,
        message: '提交成功',
        timestamp: new Date().toISOString()
      }
    }

    void form
    return {
      code: 501,
      data: null as never,
      message: '当前 OpenAPI 未提供计划填报提交流程',
      timestamp: new Date().toISOString()
    }
  },

  /**
   * 提交 Plan 审批（上报审批）
   * 将 Plan 状态从 DRAFT 变为 PENDING
   */
  async submitPlanForApproval(
    planId: number | string,
    payload: SubmitPlanApprovalPayload
  ): Promise<ApiResponse<Plan>> {
    if (this.useMockData) {
      const planVO = mockPlans.find(p => p.planId === Number(planId))
      if (!planVO) {
        return {
          code: 1002,
          data: null as never,
          message: 'Plan not found',
          timestamp: new Date().toISOString()
        }
      }
      planVO.status = 'PENDING'
      return {
        code: 200,
        data: convertPlanVOToPlan(planVO, []),
        message: '提交审批成功',
        timestamp: new Date().toISOString()
      }
    }

    return withRetry(async () => {
      const response = await apiClient.post<ApiResponse<Plan>>(
        `/plans/${planId}/submit-dispatch`,
        payload
      )
      invalidatePlanReportsCache(planId)
      invalidatePlanCaches(planId)
      return response
    })
  },

  /**
   * 审批通过 Plan
   * 将 Plan 状态从 PENDING 变为 ACTIVE（已下发）
   */
  async approvePlan(planId: number | string): Promise<ApiResponse<Plan>> {
    if (this.useMockData) {
      const planVO = mockPlans.find(p => p.planId === Number(planId))
      if (!planVO) {
        return {
          code: 1002,
          data: null as never,
          message: 'Plan not found',
          timestamp: new Date().toISOString()
        }
      }
      planVO.status = 'ACTIVE'
      return {
        code: 200,
        data: convertPlanVOToPlan(planVO, []),
        message: '审批通过',
        timestamp: new Date().toISOString()
      }
    }

    return withRetry(async () => {
      const response = await apiClient.post<ApiResponse<Plan>>(`/plans/${planId}/publish`)
      invalidatePlanCaches(planId)
      return response
    })
  },

  /**
   * 驳回 Plan
   * 将 Plan 状态从 PENDING 变为 REJECTED
   */
  async rejectPlan(planId: number | string, reason?: string): Promise<ApiResponse<Plan>> {
    if (this.useMockData) {
      const planVO = mockPlans.find(p => p.planId === Number(planId))
      if (!planVO) {
        return {
          code: 1002,
          data: null as never,
          message: 'Plan not found',
          timestamp: new Date().toISOString()
        }
      }
      planVO.status = 'REJECTED'
      return {
        code: 200,
        data: convertPlanVOToPlan(planVO, []),
        message: '已驳回',
        timestamp: new Date().toISOString()
      }
    }

    void reason
    return withRetry(async () => {
      const response = await apiClient.post<ApiResponse<Plan>>(`/plans/${planId}/archive`)
      invalidatePlanCaches(planId)
      return response
    })
  },

  /**
   * 撤回 Plan 到草稿
   * 将 Plan 状态从 PENDING/REJECTED 变为 DRAFT
   */
  async withdrawPlan(planId: number | string): Promise<ApiResponse<Plan>> {
    if (this.useMockData) {
      const planVO = mockPlans.find(p => p.planId === Number(planId))
      if (!planVO) {
        return {
          code: 1002,
          data: null as never,
          message: 'Plan not found',
          timestamp: new Date().toISOString()
        }
      }
      planVO.status = 'DRAFT'
      return {
        code: 200,
        data: convertPlanVOToPlan(planVO, []),
        message: '撤回成功',
        timestamp: new Date().toISOString()
      }
    }

    return withRetry(async () => {
      const response = await apiClient
        .getAxiosInstance()
        .post<
          ApiResponse<Plan>
        >(`/plans/${planId}/withdraw`, undefined, { timeout: PLAN_WITHDRAW_TIMEOUT_MS })
      invalidatePlanReportsCache(planId)
      invalidatePlanCaches(planId)
      invalidateQueries([
        'workflow.todo',
        'workflow.detail',
        'workflow.instances',
        'workflow.statistics',
        'plan.list',
        'plan.detail',
        'indicator.list',
        'indicator.detail',
        'task.list',
        'task.detail',
        'dashboard.overview'
      ])
      return response
    })
  },

  /**
   * 根据 Task ID 获取关联的 Plan
   * 用于指标列表中根据 taskId 获取 Plan 状态
   */
  async getPlanByTaskId(taskId: number | string): Promise<ApiResponse<Plan | null>> {
    if (this.useMockData) {
      // Mock 数据：假设 taskId 对应 planId
      return this.getPlanById(taskId)
    }

    return Promise.resolve({
      code: 501,
      data: null,
      message: '当前 OpenAPI 未提供按 taskId 反查计划的接口',
      timestamp: new Date().toISOString()
    })
  },

  /**
   * 发布 Plan（下发）
   * 将 Plan 状态变为 ACTIVE
   */
  async publishPlan(planId: number | string): Promise<ApiResponse<Plan>> {
    if (this.useMockData) {
      const planVO = mockPlans.find(p => p.planId === Number(planId))
      if (!planVO) {
        return {
          code: 1002,
          data: null as never,
          message: 'Plan not found',
          timestamp: new Date().toISOString()
        }
      }
      planVO.status = 'ACTIVE'
      return {
        code: 200,
        data: convertPlanVOToPlan(planVO, []),
        message: '发布成功',
        timestamp: new Date().toISOString()
      }
    }

    return withRetry(async () => {
      const response = await apiClient.post<ApiResponse<Plan>>(`/plans/${planId}/publish`)
      invalidatePlanCaches(planId)
      return response
    })
  },

  /**
   * 归档 Plan
   * 将 Plan 状态变为 ARCHIVED
   */
  async archivePlan(planId: number | string): Promise<ApiResponse<Plan>> {
    if (this.useMockData) {
      const planVO = mockPlans.find(p => p.planId === Number(planId))
      if (!planVO) {
        return {
          code: 1002,
          data: null as never,
          message: 'Plan not found',
          timestamp: new Date().toISOString()
        }
      }
      planVO.status = 'ARCHIVED'
      return {
        code: 200,
        data: convertPlanVOToPlan(planVO, []),
        message: '归档成功',
        timestamp: new Date().toISOString()
      }
    }

    return withRetry(async () => {
      const response = await apiClient.post<ApiResponse<Plan>>(`/plans/${planId}/archive`)
      invalidatePlanCaches(planId)
      return response
    })
  }
}

// ============================================================
// IndicatorFill API 服务
// ============================================================

export const indicatorFillApi = {
  // 使用模拟数据标志（后端就绪后设为 false）
  useMockData: USE_MOCK,

  async ensureEditable(indicatorId: number | string): Promise<void> {
    if (this.useMockData) {
      return
    }

    await resolveIndicatorFillSaveContext(indicatorId)
  },

  /**
   * 获取指标的所有填报历史
   */
  async getIndicatorFillHistory(
    indicatorId: number | string
  ): Promise<ApiResponse<IndicatorFill[]>> {
    if (this.useMockData) {
      const fills = mockIndicatorFills
        .filter(f => f.indicatorId === Number(indicatorId))
        .map(convertIndicatorFillVOToIndicatorFill)
        .sort((a, b) => new Date(b.fill_date).getTime() - new Date(a.fill_date).getTime())

      return {
        code: 200,
        data: fills,
        message: '获取成功',
        timestamp: new Date().toISOString()
      }
    }

    try {
      const context = await resolveIndicatorReportContext(indicatorId)
      const reports = await loadPlanReportsByPlanId(context.planId)
      const scopedReports = reports
        .filter(report => Number(report.reportOrgId) === context.reportOrgId)
        .sort(
          (a, b) =>
            new Date(b.updatedAt || b.createdAt || 0).getTime() -
            new Date(a.updatedAt || a.createdAt || 0).getTime()
        )

      return {
        code: 200,
        data: scopedReports.map(report =>
          mapPlanReportToIndicatorFill(report, {
            indicatorId: context.indicatorId,
            indicatorName: context.indicatorName
          })
        ),
        message: '获取成功',
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      logger.warn('[indicatorFillApi] Failed to load real indicator fill history:', error)
      return {
        code: 200,
        data: [],
        message: error instanceof Error ? error.message : '加载指标填报历史失败',
        timestamp: new Date().toISOString()
      }
    }
  },

  /**
   * 获取单次填报记录详情
   */
  async getFillById(
    fillId: number | string,
    indicatorId?: number | string
  ): Promise<ApiResponse<IndicatorFill | null>> {
    if (this.useMockData) {
      const fillVO = mockIndicatorFills.find(f => f.fillId === Number(fillId))
      if (!fillVO) {
        return {
          code: 1002,
          data: null,
          message: 'Fill not found',
          timestamp: new Date().toISOString()
        }
      }

      return {
        code: 200,
        data: convertIndicatorFillVOToIndicatorFill(fillVO),
        message: '获取成功',
        timestamp: new Date().toISOString()
      }
    }

    try {
      const report = await loadPlanReportById(fillId)
      const resolvedIndicatorId = Number(
        indicatorId ?? report.indicatorDetails?.[0]?.indicatorId ?? NaN
      )
      const indicatorName = String(report.title || '指标填报').trim() || '指标填报'

      return {
        code: 200,
        data: mapPlanReportToIndicatorFill(report, {
          indicatorId:
            Number.isFinite(resolvedIndicatorId) && resolvedIndicatorId > 0
              ? resolvedIndicatorId
              : 0,
          indicatorName
        }),
        message: '获取成功',
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      return {
        code: 500,
        data: null,
        message: error instanceof Error ? error.message : '加载填报详情失败',
        timestamp: new Date().toISOString()
      }
    }
  },

  /**
   * 创建/保存填报记录
   */
  async saveFill(form: IndicatorFillForm): Promise<ApiResponse<IndicatorFill>> {
    if (this.useMockData) {
      const newFill: IndicatorFill = {
        id: mockIndicatorFills.length + 1,
        indicator_id: form.indicator_id,
        plan_fill_id: 0, // 暂时关联到 plan_fill
        fill_date: new Date().toISOString().split('T')[0],
        progress: form.progress,
        content: form.content,
        attachments: form.attachments ? [] : [],
        filled_by: 'current_user',
        filled_by_name: '当前用户',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        milestone_id: form.milestone_id
      }

      mockIndicatorFills.push({
        fillId: newFill.id as number,
        indicatorId: form.indicator_id as number,
        planFillId: newFill.plan_fill_id as number,
        fillDate: newFill.fill_date,
        progress: newFill.progress,
        content: newFill.content,
        attachments: JSON.stringify(newFill.attachments),
        filledBy: newFill.filled_by,
        filledByName: newFill.filled_by_name,
        createdAt: newFill.created_at,
        updatedAt: newFill.updated_at,
        milestoneId: newFill.milestone_id as number
      })

      return {
        code: 200,
        data: newFill,
        message: '保存成功',
        timestamp: new Date().toISOString()
      }
    }

    const { context, editableExistingReport } = await resolveIndicatorFillSaveContext(
      form.indicator_id
    )

    const operatorUserId =
      Number(
        useAuthStore().user?.id ?? (useAuthStore().user as { userId?: number } | null)?.userId
      ) || undefined

    const normalizedBatchItems = (
      Array.isArray(form.batch_items) && form.batch_items.length > 0
        ? form.batch_items
        : [
            {
              indicator_id: form.indicator_id,
              indicator_name: context.indicatorName,
              progress: form.progress,
              content: form.content,
              milestone_id: form.milestone_id,
              attachment_ids: []
            }
          ]
    )
      .map(item => ({
        indicatorId: Number(item.indicator_id),
        indicatorName: String(item.indicator_name || ''),
        progress: Number(item.progress),
        content: String(item.content || ''),
        milestoneId: item.milestone_id,
        attachmentIds: Array.isArray((item as { attachment_ids?: unknown[] }).attachment_ids)
          ? ((item as { attachment_ids?: unknown[] }).attachment_ids ?? [])
              .map(value => Number(value))
              .filter(value => Number.isFinite(value) && value > 0)
          : []
      }))
      .filter(item => Number.isFinite(item.indicatorId) && Number.isFinite(item.progress))
      .filter(
        (item, index, list) =>
          list.findIndex(candidate => candidate.indicatorId === item.indicatorId) === index
      )

    const ensureCurrentMonthReport = async (): Promise<PlanReportSimpleResponse> => {
      if (editableExistingReport) {
        return editableExistingReport
      }

      const createResponse = await apiClient.post<ApiResponse<PlanReportSimpleResponse>>(
        '/reports',
        {
          reportMonth: context.reportMonth,
          reportOrgId: context.reportOrgId,
          reportOrgType: context.reportOrgType,
          planId: context.planId,
          createdBy: operatorUserId
        }
      )
      if (!hasApiData(createResponse) || !createResponse.data) {
        throw new Error(createResponse.message || '创建填报草稿失败')
      }
      return createResponse.data
    }

    const reportDraft = await ensureCurrentMonthReport()
    const updateResponse = await apiClient.put<ApiResponse<PlanReportSimpleResponse>>(
      `/reports/${reportDraft.id}`,
      {
        title: context.indicatorName,
        indicatorId: context.indicatorId,
        content: form.content,
        summary: form.content,
        progress: form.progress,
        issues: form.content,
        nextPlan: form.content,
        operatorUserId,
        indicatorDetails: normalizedBatchItems.map(item => ({
          indicatorId: item.indicatorId,
          title: item.indicatorName || context.indicatorName,
          content: item.content,
          summary: item.content,
          progress: item.progress,
          issues: item.content,
          nextPlan: item.content,
          milestoneNote: item.milestoneId ? String(item.milestoneId) : null,
          attachmentIds: item.attachmentIds
        }))
      }
    )
    if (!hasApiData(updateResponse) || !updateResponse.data) {
      throw new Error(
        typeof updateResponse.message === 'string'
          ? updateResponse.message || '保存指标填报失败'
          : '保存指标填报失败'
      )
    }
    const savedReport = updateResponse.data

    return {
      code: 200,
      data: mapPlanReportToIndicatorFill(
        {
          ...savedReport,
          progress: form.progress,
          content: form.content,
          summary: form.content,
          title: context.indicatorName
        },
        {
          indicatorId: context.indicatorId,
          indicatorName: context.indicatorName
        }
      ),
      message: '保存成功',
      timestamp: new Date().toISOString()
    }
  },

  /**
   * 更新填报记录
   */
  async updateFill(
    fillId: number | string,
    form: Partial<IndicatorFillForm>
  ): Promise<ApiResponse<IndicatorFill>> {
    if (this.useMockData) {
      const index = mockIndicatorFills.findIndex(f => f.fillId === Number(fillId))
      if (index !== -1) {
        mockIndicatorFills[index] = {
          ...mockIndicatorFills[index],
          progress: form.progress ?? mockIndicatorFills[index].progress,
          content: form.content ?? mockIndicatorFills[index].content
        }

        return {
          code: 200,
          data: convertIndicatorFillVOToIndicatorFill(mockIndicatorFills[index]),
          message: '更新成功',
          timestamp: new Date().toISOString()
        }
      }
      return {
        code: 1002,
        data: null as never,
        message: 'Fill not found',
        timestamp: new Date().toISOString()
      }
    }

    void fillId
    void form
    return {
      code: 501,
      data: null as never,
      message: '当前 OpenAPI 未提供填报更新接口',
      timestamp: new Date().toISOString()
    }
  },

  /**
   * 提交填报记录（加入待审核队列）
   */
  async submitFill(fillId: number | string): Promise<ApiResponse<IndicatorFill>> {
    if (this.useMockData) {
      const fillVO = mockIndicatorFills.find(f => f.fillId === Number(fillId))
      if (fillVO) {
        fillVO.status = 'SUBMITTED'
        return {
          code: 200,
          data: convertIndicatorFillVOToIndicatorFill(fillVO),
          message: '提交成功',
          timestamp: new Date().toISOString()
        }
      }
      return {
        code: 1002,
        data: null as never,
        message: 'Fill not found',
        timestamp: new Date().toISOString()
      }
    }

    const authStore = useAuthStore()
    const userId = Number(authStore.user?.id)

    if (!Number.isFinite(userId)) {
      throw new Error('当前登录用户缺少 userId，无法提交填报')
    }

    const response = await apiClient.post<ApiResponse<PlanReportSimpleResponse>>(
      `/reports/${fillId}/submit?userId=${userId}`
    )

    if (!hasApiData(response) || !response.data) {
      throw new Error(
        typeof response.message === 'string'
          ? response.message || '提交指标填报失败'
          : '提交指标填报失败'
      )
    }

    const reportDetail = await loadPlanReportById(response.data.id).catch(() => response.data)

    return {
      code: 200,
      data: mapPlanReportToIndicatorFill(reportDetail, {
        indicatorId: Number((reportDetail as Record<string, unknown>).indicatorId ?? 0),
        indicatorName: String(reportDetail.title || '指标填报')
      }),
      message: '提交成功',
      timestamp: new Date().toISOString()
    }
  },

  async getCurrentMonthPlanReport(
    planId: number | string,
    reportOrgId: number,
    reportMonth: string = getCurrentReportMonth()
  ): Promise<PlanReportSimpleResponse | null> {
    const reports = await loadPlanReportsByPlanId(Number(planId))
    return resolveCurrentMonthPlanReportSummaries(reports, reportOrgId, reportMonth).currentReport
  },

  async getLatestCurrentMonthPlanReport(
    planId: number | string,
    reportOrgId: number,
    reportMonth: string = getCurrentReportMonth()
  ): Promise<PlanReportSimpleResponse | null> {
    const reports = await loadPlanReportsByPlanId(Number(planId))
    return resolveCurrentMonthPlanReportSummaries(reports, reportOrgId, reportMonth).latestReport
  },

  async getCurrentMonthPlanReportSummaries(
    planId: number | string,
    reportOrgId: number,
    reportMonth: string = getCurrentReportMonth()
  ): Promise<{
    currentReport: PlanReportSimpleResponse | null
    latestReport: PlanReportSimpleResponse | null
  }> {
    const reports = await loadPlanReportsByPlanId(Number(planId))
    return resolveCurrentMonthPlanReportSummaries(reports, reportOrgId, reportMonth)
  },

  async submitCurrentMonthPlanReport(
    planId: number | string,
    reportOrgId: number,
    reportMonth: string = getCurrentReportMonth()
  ): Promise<PlanReportSimpleResponse> {
    invalidatePlanReportsCache(planId)
    const currentReport = await this.getCurrentMonthPlanReport(planId, reportOrgId, reportMonth)
    if (!currentReport?.id) {
      throw new Error('当前计划下还没有可提交的上报草稿，请先完成指标填报')
    }

    const normalizedStatus = getNormalizedReportStatus(currentReport.status)
    if (normalizedStatus === 'IN_REVIEW' || normalizedStatus === 'SUBMITTED') {
      throw new Error('当前上报已进入审批中，不能重复提交')
    }
    if (normalizedStatus === 'APPROVED') {
      throw new Error('当前上报已审批通过，不能重复提交')
    }

    const authStore = useAuthStore()
    const userId = Number(
      authStore.user?.id ?? (authStore.user as { userId?: number } | null)?.userId
    )
    if (!Number.isFinite(userId) || userId <= 0) {
      throw new Error('当前登录用户缺少 userId，无法提交上报')
    }

    const response = await apiClient.post<ApiResponse<PlanReportSimpleResponse>>(
      `/reports/${currentReport.id}/submit?userId=${userId}`
    )
    if (!hasApiData(response) || !response.data) {
      throw new Error(response.message || '提交上报失败')
    }

    invalidatePlanReportsCache(planId)
    return loadPlanReportById(response.data.id).catch(() => enrichPlanReportWorkflow(response.data))
  },

  async withdrawCurrentMonthPlanReport(
    planId: number | string,
    reportOrgId: number,
    reportMonth: string = getCurrentReportMonth()
  ): Promise<PlanReportSimpleResponse> {
    invalidatePlanReportsCache(planId)
    const currentReport = await this.getCurrentMonthPlanReport(planId, reportOrgId, reportMonth)
    if (!currentReport?.id) {
      throw new Error('当前没有可撤回的上报记录')
    }
    if (!currentReport.workflowInstanceId) {
      throw new Error('当前上报未绑定审批流程，无法撤回')
    }
    if (!currentReport.canWithdraw) {
      throw new Error('当前审批进度不支持撤回')
    }

    await cancelWorkflow(String(currentReport.workflowInstanceId))
    invalidatePlanReportsCache(planId)

    const startedAt = Date.now()
    while (Date.now() - startedAt < PLAN_WITHDRAW_TIMEOUT_MS) {
      const refreshedReport = await loadPlanReportById(currentReport.id)
      const normalizedStatus = getNormalizedReportStatus(refreshedReport.status)

      if (
        normalizedStatus === 'DRAFT' ||
        normalizedStatus === 'REJECTED' ||
        normalizedStatus === 'WITHDRAWN' ||
        normalizedStatus === 'CANCELLED'
      ) {
        invalidatePlanReportsCache(planId)
        return refreshedReport
      }

      await new Promise(resolve => window.setTimeout(resolve, 1000))
    }

    throw new Error('撤回请求已发送，但上报状态尚未完成回退，请稍后重试')
  }
}

// ============================================================
// PlanFill API 服务
// ============================================================

export const planFillApi = {
  // 使用模拟数据标志（后端就绪后设为 false）
  useMockData: USE_MOCK,

  /**
   * 获取 Plan 的所有提交记录
   */
  async getPlanFills(planId: number | string): Promise<ApiResponse<PlanFill[]>> {
    if (this.useMockData) {
      const fills = mockPlanFills
        .filter(f => f.planId === Number(planId))
        .map(planFillVO => {
          const indicatorFills = mockIndicatorFills
            .filter(ifill => ifill.planFillId === planFillVO.fillId)
            .map(convertIndicatorFillVOToIndicatorFill)
          return convertPlanFillVOToPlanFill(planFillVO, indicatorFills)
        })
        .sort((a, b) => new Date(b.submit_date).getTime() - new Date(a.submit_date).getTime())

      return {
        code: 200,
        data: fills,
        message: '获取成功',
        timestamp: new Date().toISOString()
      }
    }

    void planId
    return {
      code: 200,
      data: [],
      message: '当前 OpenAPI 未提供计划填报记录接口，返回空列表',
      timestamp: new Date().toISOString()
    }
  },

  /**
   * 获取待审核的 PlanFill 列表（审核人视角）
   */
  async getPendingPlanFills(_auditorOrgId?: number | string): Promise<ApiResponse<PlanFill[]>> {
    if (this.useMockData) {
      const fills = mockPlanFills
        .filter(f => f.status === 'SUBMITTED')
        .map(planFillVO => {
          const indicatorFills = mockIndicatorFills
            .filter(ifill => ifill.planFillId === planFillVO.fillId)
            .map(convertIndicatorFillVOToIndicatorFill)
          return convertPlanFillVOToPlanFill(planFillVO, indicatorFills)
        })

      return {
        code: 200,
        data: fills,
        message: '获取成功',
        timestamp: new Date().toISOString()
      }
    }

    const response = await getMyPendingTasks(1)

    return {
      ...response,
      data: Array.isArray((response.data as unknown as { items: unknown[] })?.items)
        ? (response.data as unknown as { items: unknown[] }).items.map(
            convertApprovalDetailToPlanFill
          )
        : []
    }
  },

  /**
   * 审核 PlanFill
   */
  async auditPlanFill(fillId: number | string, form: AuditForm): Promise<ApiResponse<PlanFill>> {
    if (this.useMockData) {
      const planFillVO = mockPlanFills.find(f => f.fillId === Number(fillId))
      if (planFillVO) {
        planFillVO.status = form.action === 'approve' ? 'APPROVED' : 'REJECTED'

        // 同时更新关联的 IndicatorFill 状态
        mockIndicatorFills
          .filter(f => f.planFillId === Number(fillId))
          .forEach(fillVO => {
            fillVO.status = form.action === 'approve' ? 'APPROVED' : 'REJECTED'
            fillVO.auditComment = form.comment
            fillVO.auditedBy = 'current_user'
            fillVO.auditedAt = new Date().toISOString()
          })

        const indicatorFills = mockIndicatorFills
          .filter(ifill => ifill.planFillId === planFillVO.fillId)
          .map(convertIndicatorFillVOToIndicatorFill)

        return {
          code: 200,
          data: convertPlanFillVOToPlanFill(planFillVO, indicatorFills),
          message: form.action === 'approve' ? '审核通过' : '已驳回',
          timestamp: new Date().toISOString()
        }
      }
      return {
        code: 1002,
        data: null as never,
        message: 'Fill not found',
        timestamp: new Date().toISOString()
      }
    }

    return withRetry(async () => {
      if (form.action?.toLowerCase() === 'approve') {
        await approveTask(String(fillId), { comment: form.comment || '' })
      } else {
        await rejectTask(String(fillId), { reason: form.comment || '' })
      }

      return {
        success: true,
        data: null,
        message: form.action === 'approve' ? '审核通过' : '已驳回'
      } as unknown as ApiResponse<PlanFill>
    })
  }
}

export default planApi
