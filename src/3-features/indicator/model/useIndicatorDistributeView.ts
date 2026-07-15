/**
 * 指标下发与审批页面（职能部门专用）
 * 功能：接收战略任务 → 查看战略指标 → 拆分子指标 → 下发给学院 → 审批学院提交
 */
import { ref, computed, reactive, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import {
  Plus,
  Promotion,
  Check,
  Close,
  View,
  Search,
  RefreshLeft,
  Timer,
  Delete
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, ElLoading } from 'element-plus'
import type { StrategicIndicator } from '@/shared/types'
import { useStrategicStore } from '@/features/task/model/strategic'
import { useAuthStore } from '@/features/auth/model/store'
import { useTimeContextStore } from '@/shared/lib/timeContext'
import { useOrgStore } from '@/features/organization/model/store'
import { usePlanStore } from '@/features/plan/model/store'
import { useApprovalRouteAutopen } from '@/features/approval/lib'
import { indicatorFillApi } from '@/features/plan/api/planApi'
import { getUsersByOrgId } from '@/features/user/api/query'
import { indicatorApi } from '@/features/indicator/api'
import { milestoneApi } from '@/entities/milestone/api/milestoneApi'
import { logger } from '@/shared/lib/utils/logger'
import { resolveMilestoneDisplayState } from '@/shared/lib/utils/milestoneDisplay'
import type { Plan } from '@/shared/types'
import { canUseAsFunctionalParentIndicator } from '@/features/indicator/lib/scope'
import { sortMilestonesByProgress } from '@/shared/lib/utils/milestoneSort'
import { getPlanStatusDisplay, normalizePlanStatus } from '@/features/task/lib/planStatus'
import { strategicApi } from '@/features/task/api/strategicApi'
import { getWorkflowDefinitionPreviewByCode } from '@/features/workflow/api'
import type {
  WorkflowDefinitionPreviewResponse,
  WorkflowInstanceDetailResponse
} from '@/features/workflow/api/types'
import { getWorkflowInstanceDetailByBusiness } from '@/features/workflow/api/queries'
import { buildQueryKey, invalidateQueries } from '@/shared/lib/utils/cache'
import {
  GLOBAL_DATA_REFRESH_REQUEST_EVENT,
  type GlobalDataRefreshDetail
} from '@/5-shared/lib/dataFreshness'

export interface IndicatorDistributeViewProps {
  viewingRole?: string
  viewingDept?: string
}

export function useIndicatorDistributeView(props: IndicatorDistributeViewProps) {
  // Stores
  const strategicStore = useStrategicStore()
  const authStore = useAuthStore()
  const timeContext = useTimeContextStore()
  const orgStore = useOrgStore()
  const planStore = usePlanStore()
  let globalDataRefreshPromise: Promise<void> | null = null

  // 当前用户部门（优先使用视角切换的部门）
  const currentDept = computed(
    () => props.viewingDept || authStore.effectiveDepartment || authStore.userDepartment || ''
  )

  const departmentAliasNameMap = computed(() => {
    const map = new Map<string, string>()

    orgStore.departments.forEach(dept => {
      const canonical = String(dept.name || '').trim()
      const id = String(dept.id || '').trim()
      if (!canonical) {
        return
      }

      map.set(canonical, canonical)
      if (id) {
        map.set(id, canonical)
      }

      canonical
        .split('|')
        .map(part => part.trim())
        .filter(Boolean)
        .forEach(part => {
          map.set(part, canonical)
        })
    })

    return map
  })

  const normalizeDepartmentName = (value?: string | null): string => {
    const trimmed = String(value || '').trim()
    if (!trimmed) {
      return ''
    }

    return departmentAliasNameMap.value.get(trimmed) || trimmed
  }

  const isSameDepartment = (left?: string | null, right?: string | null): boolean => {
    const normalizedLeft = normalizeDepartmentName(left)
    const normalizedRight = normalizeDepartmentName(right)
    return Boolean(normalizedLeft) && normalizedLeft === normalizedRight
  }

  const currentDepartmentOrgId = computed(() => {
    const authOrgId = Number(authStore.user?.orgId ?? NaN)
    const matchedOrgId = getOrgIdByDeptName(currentDept.value)
    if (matchedOrgId != null) {
      return matchedOrgId
    }
    return Number.isFinite(authOrgId) && authOrgId > 0 ? authOrgId : null
  })

  const currentDepartmentOrgIdFromTable = computed(() => {
    const matchedOrgId = getOrgIdByDeptName(currentDept.value)
    return matchedOrgId != null ? matchedOrgId : null
  })

  const getIndicatorTaskId = (indicator: StrategicIndicator): string => {
    const raw = indicator as StrategicIndicator & {
      taskId?: string | number
      task_id?: string | number
      planId?: string | number
      strategicTaskId?: string | number
      cycleId?: string | number
      parentIndicatorId?: string | number
    }
    const directTaskId = String(
      raw.taskId ?? raw.task_id ?? raw.planId ?? raw.strategicTaskId ?? raw.cycleId ?? ''
    ).trim()
    if (directTaskId) {
      return directTaskId
    }

    const indicatorById = new Map(
      strategicStore.indicators.map(item => [String(item.id), item] as const)
    )
    const visited = new Set<string>()
    let currentParentId = String(raw.parentIndicatorId ?? '').trim()

    while (currentParentId && !visited.has(currentParentId)) {
      visited.add(currentParentId)
      const parent = indicatorById.get(currentParentId)
      if (!parent) {
        break
      }
      const parentRaw = parent as StrategicIndicator & {
        taskId?: string | number
        task_id?: string | number
        planId?: string | number
        strategicTaskId?: string | number
        cycleId?: string | number
        parentIndicatorId?: string | number
      }
      const parentTaskId = String(
        parentRaw.taskId ??
          parentRaw.task_id ??
          parentRaw.planId ??
          parentRaw.strategicTaskId ??
          parentRaw.cycleId ??
          ''
      ).trim()
      if (parentTaskId) {
        return parentTaskId
      }
      currentParentId = String(parentRaw.parentIndicatorId ?? '').trim()
    }

    return ''
  }

  const getOrgIdByDeptName = (deptName: string): number | undefined => {
    const normalized = normalizeDepartmentName(deptName)
    if (!normalized) {
      return undefined
    }
    const match = orgStore.departments.find(
      dept => normalizeDepartmentName(dept.name) === normalized
    )
    if (!match) {
      return undefined
    }
    const id = Number(match.id)
    return Number.isFinite(id) && id > 0 ? id : undefined
  }

  const getDeptNameByOrgId = (orgId?: number | string | null): string | null => {
    const numericOrgId = Number(orgId ?? NaN)
    if (!Number.isFinite(numericOrgId) || numericOrgId <= 0) {
      return null
    }

    const match = orgStore.departments.find(dept => Number(dept.id ?? NaN) === numericOrgId)
    return match?.name ? normalizeDepartmentName(match.name) : null
  }

  const matchesDepartment = (value: string | string[] | undefined, deptName: string): boolean => {
    const normalizedDeptName = normalizeDepartmentName(deptName)
    if (!normalizedDeptName || !value) {
      return false
    }

    if (Array.isArray(value)) {
      return value.some(dept => normalizeDepartmentName(dept) === normalizedDeptName)
    }

    return normalizeDepartmentName(value) === normalizedDeptName
  }

  const resolvePlanYear = (
    plan: Partial<Plan> & { year?: number | string; cycleId?: number | string }
  ) => {
    const planRecord = plan as Partial<Plan> & {
      year?: number | string
      cycleId?: number | string
      cycle?: { year?: number | string }
    }
    const explicitYear = planRecord.year ?? planRecord.cycle?.year
    if (explicitYear != null && explicitYear !== '') {
      const numericYear = Number(explicitYear)
      return Number.isFinite(numericYear) ? numericYear : null
    }

    return timeContext.resolveCycleYear(planRecord.cycleId)
  }

  function getPlanIndicatorText(indicator: Record<string, unknown>, ...keys: string[]): string {
    for (const key of keys) {
      const value = indicator[key]
      if (value !== undefined && value !== null) {
        const text = String(value).trim()
        if (text) {
          return text
        }
      }
    }
    return ''
  }

  function normalizeIndicatorTypeLabel(value?: unknown): '定性' | '定量' | '' {
    const normalized = String(value || '')
      .trim()
      .toUpperCase()
    if (!normalized) {
      return ''
    }
    if (normalized === '定性' || normalized === 'QUALITATIVE') {
      return '定性'
    }
    if (normalized === '定量' || normalized === 'QUANTITATIVE') {
      return '定量'
    }
    return ''
  }

  function getIndicatorTypeLabel(
    indicator?:
      | (Partial<StrategicIndicator> & {
          type?: unknown
          indicatorType?: unknown
          indicatorType1?: unknown
          isQualitative?: unknown
        })
      | null
  ): '定性' | '定量' {
    if (!indicator) {
      return '定量'
    }

    return (
      normalizeIndicatorTypeLabel(indicator.type1) ||
      normalizeIndicatorTypeLabel(indicator.indicatorType1) ||
      normalizeIndicatorTypeLabel(indicator.indicatorType) ||
      normalizeIndicatorTypeLabel(indicator.type) ||
      (indicator.isQualitative === true ? '定性' : '') ||
      '定量'
    )
  }

  function isQualitativeIndicator(
    indicator?:
      | (Partial<StrategicIndicator> & {
          type?: unknown
          indicatorType?: unknown
          indicatorType1?: unknown
          isQualitative?: unknown
        })
      | null
  ): boolean {
    return getIndicatorTypeLabel(indicator) === '定性'
  }

  function getPlanIndicatorNumber(indicator: Record<string, unknown>, ...keys: string[]): number {
    for (const key of keys) {
      const value = indicator[key]
      const numericValue = Number(value)
      if (Number.isFinite(numericValue)) {
        return numericValue
      }
    }
    return 0
  }

  function normalizeTaskTypeToCategory(taskType: unknown): '发展性' | '基础性' | '' {
    const normalized = String(taskType || '')
      .trim()
      .toUpperCase()
    if (normalized === 'DEVELOPMENT') {
      return '发展性'
    }
    if (normalized === 'BASIC') {
      return '基础性'
    }
    return ''
  }

  // 判断是否为战略发展部（只能查看，不能编辑）
  const isStrategicDept = computed(() => {
    // 使用视角角色判断
    return props.viewingRole === 'strategic_dept'
  })

  // 判断是否为职能部门（可以编辑子指标）
  const isFunctionalDept = computed(() => {
    return props.viewingRole === 'functional_dept'
  })

  const currentDispatchWorkflowCode = computed(() => {
    if (isStrategicDept.value) {
      return 'PLAN_DISPATCH_STRATEGY'
    }

    return 'PLAN_DISPATCH_FUNCDEPT'
  })

  // 只读模式：战略发展部或者历史快照模式
  const _isReadOnly = computed(() => timeContext.isReadOnly || isStrategicDept.value)

  // 获取所有学院（从数据库动态获取）
  const colleges = computed(() => orgStore.getAllCollegeNames())

  // ================== 学院模式 ==================
  // 当前选中的学院
  const selectedCollege = ref<string | null>(null)
  type CurrentCollegePlanReportSummary = Awaited<
    ReturnType<typeof indicatorFillApi.getCurrentMonthPlanReport>
  >
  const currentCollegePlanReportSummary = ref<CurrentCollegePlanReportSummary>(null)
  const latestCollegePlanReportSummary = ref<{ id: number } | null>(null)
  const pendingCollegePlanUiState = ref<null | 'submitted' | 'withdrawn' | 'approved' | 'rejected'>(
    null
  )
  const isBatchDistributing = ref(false)
  const pageBootstrapPromise = ref<Promise<void> | null>(null)
  const refreshDistributionPromise = ref<Promise<void> | null>(null)
  const copyIndicatorDialogVisible = ref(false)
  const copySourceCollege = ref('')
  const copyClearExisting = ref(false)

  // 搜索关键词
  const searchKeyword = ref('')

  // 指标详情侧边栏
  const detailDrawerVisible = ref(false)
  const currentDetailIndicator = ref<StrategicIndicator | null>(null)
  const addRowFormRef = ref<HTMLElement | null>(null)
  const lastEditTime = ref(new Date().toLocaleString())

  // 任务审批抽屉状态
  const taskApprovalVisible = ref(false)
  const currentCollegeWorkflowDetail = ref<WorkflowInstanceDetailResponse | null>(null)
  const approvalStatusPopoverLoading = ref(false)

  // 专门用于审批抽屉的指标列表（当前选中学院的所有子指标，只显示当前部门下发的）
  const approvalIndicators = computed(() => {
    if (!selectedCollege.value) {
      return []
    }
    // 只返回当前部门下发给该学院的指标
    return strategicStore.indicators.filter(i => {
      if (i.isStrategic) {
        return false
      }
      if (!isSameDepartment(i.ownerDept, currentDept.value)) {
        return false
      }
      return matchesDepartment(i.responsibleDept, selectedCollege.value!)
    }) as StrategicIndicator[]
  })

  // 待审批数量（用于按钮显示）- 基于 progressApprovalStatus === 'PENDING'
  // 注意：这是进度审批状态（progress approval），不是指标定义审核状态（lifecycle status）
  const pendingApprovalCount = computed(() => {
    const reportWorkflowStatus = String(
      currentCollegePlanReportSummary.value?.workflowStatus ||
        currentCollegePlanReportSummary.value?.status ||
        ''
    )
      .trim()
      .toUpperCase()

    if (currentCollegePlanReportSummary.value?.id) {
      return ['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(reportWorkflowStatus) ? 1 : 0
    }

    if (!selectedCollege.value) {
      return 0
    }

    return 0
  })

  const currentDepartmentPlan = computed<Plan | null>(() => {
    const departmentName = normalizeDepartmentName(currentDept.value)
    if (!departmentName) {
      return null
    }

    const departmentId = getOrgIdByDeptName(departmentName)

    return (
      planStore.plans.find(plan => {
        const planAny = plan as Plan & {
          targetOrgId?: number | string
          targetOrgName?: string
          orgId?: number | string
          orgName?: string
          year?: number | string
          cycleId?: number | string
        }
        const planYear = resolvePlanYear(planAny)
        const targetOrgId = Number(planAny.targetOrgId ?? planAny.org_id ?? planAny.orgId ?? NaN)
        const targetOrgName = normalizeDepartmentName(
          planAny.targetOrgName || planAny.orgName || ''
        )
        const matchesOrgId =
          departmentId != null && Number.isFinite(targetOrgId) && targetOrgId === departmentId
        const matchesOrgName = targetOrgName === departmentName

        return planYear === timeContext.currentYear && (matchesOrgId || matchesOrgName)
      }) || null
    )
  })

  const currentSelectedCollegePlan = computed<Plan | null>(() => {
    const collegeName = normalizeDepartmentName(selectedCollege.value)
    if (!collegeName) {
      return null
    }

    const collegeOrgId = getOrgIdByDeptName(collegeName)
    const currentOrgId = currentDepartmentOrgId.value

    return (
      planStore.plans.find(plan => {
        const planAny = plan as Plan & {
          targetOrgId?: number | string
          targetOrgName?: string
          orgId?: number | string
          orgName?: string
          createdByOrgId?: number | string
          year?: number | string
          cycleId?: number | string
        }
        const planYear = resolvePlanYear(planAny)
        const targetOrgId = Number(planAny.targetOrgId ?? planAny.org_id ?? planAny.orgId ?? NaN)
        const targetOrgName = normalizeDepartmentName(
          planAny.targetOrgName || planAny.orgName || ''
        )
        const createdByOrgId = Number(planAny.createdByOrgId ?? NaN)
        const matchesOrgId =
          collegeOrgId != null && Number.isFinite(targetOrgId) && targetOrgId === collegeOrgId
        const matchesOrgName = targetOrgName === collegeName
        const matchesCreatedByOrg =
          currentOrgId == null ||
          !Number.isFinite(createdByOrgId) ||
          createdByOrgId === currentOrgId

        return (
          planYear === timeContext.currentYear &&
          (matchesOrgId || matchesOrgName) &&
          matchesCreatedByOrg
        )
      }) || null
    )
  })

  const currentDepartmentPlanDetails = ref<Plan | null>(null)
  const currentSelectedCollegePlanDetails = ref<Plan | null>(null)
  const currentPlanTaskTypeMap = ref<Record<string, string>>({})

  const resolveCurrentCycleId = (): number | undefined => {
    const selectedPlan = currentSelectedCollegePlan.value as
      | (Plan & { cycleId?: number | string; cycle_id?: number | string })
      | null
    const selectedPlanDetails = currentSelectedCollegePlanDetails.value as
      | (Plan & { cycleId?: number | string; cycle_id?: number | string })
      | null
    const departmentPlan = currentDepartmentPlan.value as
      | (Plan & { cycleId?: number | string; cycle_id?: number | string })
      | null
    const departmentPlanDetails = currentDepartmentPlanDetails.value as
      | (Plan & { cycleId?: number | string; cycle_id?: number | string })
      | null

    const directCycleId =
      selectedPlanDetails?.cycleId ??
      selectedPlanDetails?.cycle_id ??
      selectedPlan?.cycleId ??
      selectedPlan?.cycle_id ??
      departmentPlanDetails?.cycleId ??
      departmentPlanDetails?.cycle_id ??
      departmentPlan?.cycleId ??
      departmentPlan?.cycle_id
    const numericDirectCycleId = Number(directCycleId)
    if (Number.isFinite(numericDirectCycleId) && numericDirectCycleId > 0) {
      return numericDirectCycleId
    }

    const cycle = timeContext.cycles.find(item => Number(item.year) === timeContext.currentYear) as
      | { cycleId?: number | string; id?: number | string }
      | undefined
    const numericCycleId = Number(cycle?.cycleId ?? cycle?.id)
    return Number.isFinite(numericCycleId) && numericCycleId > 0 ? numericCycleId : undefined
  }

  const getApiErrorMessage = (error: unknown, fallback: string): string => {
    const candidates = [
      (error as { details?: { message?: unknown } } | null)?.details?.message,
      (error as { response?: { data?: { message?: unknown } } } | null)?.response?.data?.message,
      (error as { message?: unknown } | null)?.message
    ]

    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim()
        if (trimmed && trimmed !== '[object Object]') {
          return trimmed
        }
      }
    }

    return fallback
  }

  const matchesCurrentDepartmentPlanContext = (plan: Plan | null | undefined): plan is Plan => {
    if (!plan) {
      return false
    }

    const departmentName = normalizeDepartmentName(currentDept.value)
    if (!departmentName) {
      return false
    }

    const departmentId = getOrgIdByDeptName(departmentName)
    const planAny = plan as Plan & {
      targetOrgId?: number | string
      targetOrgName?: string
      orgId?: number | string
      orgName?: string
    }
    const planYear = resolvePlanYear(planAny)
    const targetOrgId = Number(planAny.targetOrgId ?? planAny.org_id ?? planAny.orgId ?? NaN)
    const targetOrgName = normalizeDepartmentName(planAny.targetOrgName || planAny.orgName || '')
    const matchesOrgId =
      departmentId != null && Number.isFinite(targetOrgId) && targetOrgId === departmentId
    const matchesOrgName = targetOrgName === departmentName

    return planYear === timeContext.currentYear && (matchesOrgId || matchesOrgName)
  }

  const matchesCurrentSelectedCollegePlanContext = (
    plan: Plan | null | undefined
  ): plan is Plan => {
    if (!plan) {
      return false
    }

    const collegeName = normalizeDepartmentName(selectedCollege.value)
    if (!collegeName) {
      return false
    }

    const collegeOrgId = getOrgIdByDeptName(collegeName)
    const currentOrgId = currentDepartmentOrgId.value
    const planAny = plan as Plan & {
      targetOrgId?: number | string
      targetOrgName?: string
      orgId?: number | string
      orgName?: string
      createdByOrgId?: number | string
    }
    const planYear = resolvePlanYear(planAny)
    const targetOrgId = Number(planAny.targetOrgId ?? planAny.org_id ?? planAny.orgId ?? NaN)
    const targetOrgName = normalizeDepartmentName(planAny.targetOrgName || planAny.orgName || '')
    const createdByOrgId = Number(planAny.createdByOrgId ?? NaN)
    const matchesOrgId =
      collegeOrgId != null && Number.isFinite(targetOrgId) && targetOrgId === collegeOrgId
    const matchesOrgName = targetOrgName === collegeName
    const matchesCreatedByOrg =
      currentOrgId == null || !Number.isFinite(createdByOrgId) || createdByOrgId === currentOrgId

    return (
      planYear === timeContext.currentYear &&
      (matchesOrgId || matchesOrgName) &&
      matchesCreatedByOrg
    )
  }

  const buildTaskTypeMap = (tasks: Array<Record<string, unknown>>): Record<string, string> => {
    const map: Record<string, string> = {}
    tasks.forEach(task => {
      const taskId = String(
        (task as { taskId?: string | number; id?: string | number }).taskId ?? ''
      ).trim()
      const fallbackTaskId = String((task as { id?: string | number }).id ?? '').trim()
      const taskType = String((task as { taskType?: string }).taskType || '').trim()
      const key = taskId || fallbackTaskId
      if (key && taskType) {
        map[key] = taskType
      }
    })
    return map
  }

  const loadCurrentDepartmentPlanTaskTypeMap = async (planId: number | string | undefined) => {
    const normalizedPlanId = Number(planId ?? NaN)
    if (!Number.isFinite(normalizedPlanId) || normalizedPlanId <= 0) {
      currentPlanTaskTypeMap.value = {}
      return
    }

    try {
      const response = await strategicApi.getTasksByPlanId(normalizedPlanId)
      if (!response?.success || !Array.isArray(response.data)) {
        currentPlanTaskTypeMap.value = {}
        return
      }
      currentPlanTaskTypeMap.value = buildTaskTypeMap(
        response.data as Array<Record<string, unknown>>
      )
    } catch (error) {
      currentPlanTaskTypeMap.value = {}
      logger.warn('[IndicatorDistributeView] 加载当前计划任务类型映射失败:', error)
    }
  }

  const normalizedCurrentDepartmentPlanStatus = computed(() => {
    const stableDepartmentPlanDetails = matchesCurrentDepartmentPlanContext(
      currentDepartmentPlanDetails.value
    )
      ? currentDepartmentPlanDetails.value
      : null

    return normalizePlanStatus(
      stableDepartmentPlanDetails?.status || currentDepartmentPlan.value?.status || null
    )
  })

  const normalizedSelectedCollegePlanStatus = computed(() => {
    const stableSelectedCollegePlanDetails = matchesCurrentSelectedCollegePlanContext(
      currentSelectedCollegePlanDetails.value
    )
      ? currentSelectedCollegePlanDetails.value
      : null

    return normalizePlanStatus(
      stableSelectedCollegePlanDetails?.status || currentSelectedCollegePlan.value?.status || null
    )
  })

  const currentActiveCollegePlan = computed<Plan | null>(() => {
    const stableSelectedCollegePlanDetails = matchesCurrentSelectedCollegePlanContext(
      currentSelectedCollegePlanDetails.value
    )
      ? currentSelectedCollegePlanDetails.value
      : null

    return stableSelectedCollegePlanDetails || currentSelectedCollegePlan.value || null
  })

  const normalizedCurrentActiveCollegeWorkflowStatus = computed(() => {
    const reportWorkflowStatus = String(
      currentCollegePlanReportSummary.value?.workflowStatus ||
        currentCollegePlanReportSummary.value?.status ||
        ''
    )
      .trim()
      .toUpperCase()

    if (reportWorkflowStatus) {
      return reportWorkflowStatus
    }

    return String(currentActiveCollegePlan.value?.workflowStatus || '')
      .trim()
      .toUpperCase()
  })

  const currentCollegePlanReportUiStatus = computed(() => {
    const reportBusinessStatus = String(currentCollegePlanReportSummary.value?.status || '')
      .trim()
      .toUpperCase()
    const reportWorkflowStatus = String(currentCollegePlanReportSummary.value?.workflowStatus || '')
      .trim()
      .toUpperCase()

    if (
      pendingCollegePlanUiState.value === 'submitted' &&
      (!reportWorkflowStatus || ['DRAFT', 'WITHDRAWN', 'CANCELLED'].includes(reportWorkflowStatus))
    ) {
      return 'SUBMITTED'
    }

    if (
      pendingCollegePlanUiState.value === 'withdrawn' &&
      (!reportWorkflowStatus ||
        ['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(reportWorkflowStatus))
    ) {
      return 'DRAFT'
    }

    if (
      pendingCollegePlanUiState.value === 'approved' &&
      ['DRAFT', 'PENDING', 'IN_REVIEW', 'SUBMITTED', ''].includes(reportWorkflowStatus)
    ) {
      return 'APPROVED'
    }

    if (
      pendingCollegePlanUiState.value === 'rejected' &&
      ['DRAFT', 'PENDING', 'IN_REVIEW', 'SUBMITTED', ''].includes(reportWorkflowStatus)
    ) {
      return 'REJECTED'
    }

    if (reportBusinessStatus === 'DRAFT') {
      return 'DRAFT'
    }

    if (reportWorkflowStatus) {
      return reportWorkflowStatus
    }

    return reportBusinessStatus
  })

  const selectedCollegePlanUiStatus = computed(() => {
    const reportWorkflowStatus = currentCollegePlanReportUiStatus.value

    if (['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(reportWorkflowStatus)) {
      return reportWorkflowStatus
    }

    if (reportWorkflowStatus === 'DRAFT') {
      return 'DRAFT'
    }

    const planStatus = normalizedSelectedCollegePlanStatus.value
    if (['DRAFT', 'RETURNED', 'DISTRIBUTED'].includes(planStatus)) {
      return planStatus
    }

    const workflowStatus = normalizedCurrentActiveCollegeWorkflowStatus.value
    if (['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(workflowStatus)) {
      return workflowStatus
    }

    return planStatus || workflowStatus
  })

  const currentCollegePlanActionState = computed<
    'draft' | 'pending_withdrawable' | 'pending_locked' | 'distributed'
  >(() => {
    const uiStatus = selectedCollegePlanUiStatus.value

    if (['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(uiStatus)) {
      return canWithdrawCurrentCollegePlan.value ? 'pending_withdrawable' : 'pending_locked'
    }

    if (uiStatus === 'DISTRIBUTED') {
      return 'distributed'
    }

    return 'draft'
  })

  const canEditCurrentCollegePlan = computed(() => {
    return currentCollegePlanActionState.value === 'draft'
  })

  const canWithdrawCurrentCollegePlan = computed(() => {
    if (currentCollegePlanReportUiStatus.value === 'DRAFT') {
      return false
    }

    const canWithdraw =
      currentCollegePlanReportSummary.value?.canWithdraw ??
      currentActiveCollegePlan.value?.canWithdraw

    return (
      ['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(selectedCollegePlanUiStatus.value) &&
      isCurrentUserReporter.value &&
      Boolean(canWithdraw)
    )
  })

  // 是否可以编辑子指标（只有职能部门可以，审批中锁定）
  const canEditChild = computed(() => {
    return (
      isFunctionalDept.value &&
      !timeContext.isReadOnly &&
      canEditCurrentCollegePlan.value &&
      canCurrentUserSubmitCurrentDepartmentDistribution.value
    )
  })

  const retainedRouteApprovalEntityType = ref<'PLAN' | 'PLAN_REPORT' | undefined>(undefined)
  const retainedRouteApprovalEntityId = ref<string | undefined>(undefined)
  const retainedRouteApprovalDepartment = ref<string | undefined>(undefined)

  const effectiveRouteApprovalEntityType = computed<'PLAN' | 'PLAN_REPORT' | undefined>(() => {
    return routeApprovalEntityType.value || retainedRouteApprovalEntityType.value
  })

  const effectiveRouteApprovalEntityId = computed<string | undefined>(() => {
    return routeApprovalEntityId.value || retainedRouteApprovalEntityId.value
  })

  const effectiveRouteApprovalDepartment = computed<string | undefined>(() => {
    return routeApprovalDepartment.value || retainedRouteApprovalDepartment.value
  })

  const routeApprovalPlan = computed<Plan | null>(() => {
    if (effectiveRouteApprovalEntityType.value === 'PLAN_REPORT') {
      return null
    }

    const routePlanId = Number(effectiveRouteApprovalEntityId.value ?? NaN)
    if (!Number.isFinite(routePlanId) || routePlanId <= 0) {
      return null
    }

    const candidatePlans = [
      currentDepartmentPlanDetails.value,
      currentDepartmentPlan.value,
      currentSelectedCollegePlanDetails.value,
      currentSelectedCollegePlan.value,
      planStore.getPlanById(routePlanId) || null
    ]

    return (
      candidatePlans.find(plan => Number(plan?.id ?? NaN) === routePlanId) ||
      planStore.getPlanById(routePlanId) ||
      null
    )
  })

  const approvalDrawerPlan = computed<Plan | null>(() => {
    return (
      routeApprovalPlan.value ||
      currentActiveCollegePlan.value ||
      currentDepartmentPlanDetails.value ||
      currentDepartmentPlan.value ||
      null
    )
  })

  const hasActiveCollegePlanWorkflow = computed(() => {
    const workflowStatus = String(currentActiveCollegePlan.value?.workflowStatus || '')
      .trim()
      .toUpperCase()
    const currentTaskId = Number(currentActiveCollegePlan.value?.currentTaskId ?? NaN)
    const currentStepName = String(currentActiveCollegePlan.value?.currentStepName || '').trim()

    return (
      ['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(workflowStatus) ||
      (Number.isFinite(currentTaskId) && currentTaskId > 0) ||
      Boolean(currentStepName)
    )
  })

  const hasPlanReportWorkflowContext = (
    summary:
      | {
          id?: number | string
          status?: string | null
          workflowStatus?: string | null
          workflowInstanceId?: number | string | null
          currentTaskId?: number | string | null
          currentStepName?: string | null
        }
      | null
      | undefined
  ) => {
    if (!summary?.id) {
      return false
    }

    const workflowStatus = String(summary.workflowStatus || summary.status || '')
      .trim()
      .toUpperCase()
    const workflowInstanceId = Number(summary.workflowInstanceId ?? NaN)
    const currentTaskId = Number(summary.currentTaskId ?? NaN)
    const currentStepName = String(summary.currentStepName || '').trim()

    return (
      (workflowStatus !== '' &&
        workflowStatus !== 'DRAFT' &&
        workflowStatus !== 'WITHDRAWN' &&
        workflowStatus !== 'CANCELLED') ||
      (Number.isFinite(workflowInstanceId) && workflowInstanceId > 0) ||
      (Number.isFinite(currentTaskId) && currentTaskId > 0) ||
      Boolean(currentStepName)
    )
  }

  const approvalWorkflowReportSummary = computed(() => {
    if (hasActiveCollegePlanWorkflow.value) {
      return null
    }

    if (hasPlanReportWorkflowContext(currentCollegePlanReportSummary.value)) {
      return currentCollegePlanReportSummary.value
    }

    if (hasPlanReportWorkflowContext(latestCollegePlanReportSummary.value)) {
      return latestCollegePlanReportSummary.value
    }

    return latestCollegePlanReportSummary.value
  })

  const currentApprovalWorkflowCode = computed<string | string[]>(() => {
    if (
      approvalWorkflowReportSummary.value?.id ||
      hasPlanReportWorkflowContext(latestCollegePlanReportSummary.value)
    ) {
      return ['PLAN_APPROVAL_COLLEGE', currentDispatchWorkflowCode.value]
    }

    return currentDispatchWorkflowCode.value
  })

  const normalizeWorkflowStepName = (value?: string | null) => {
    return String(value || '')
      .replace(/\s+/g, '')
      .trim()
  }

  const normalizePreviewCandidateDisplayName = (
    candidate: WorkflowDefinitionPreviewResponse['steps'][number]['candidateApprovers'][number]
  ) => {
    return candidate.realName || candidate.username || `用户${candidate.userId}`
  }

  const {
    routeApprovalEntityType,
    routeApprovalEntityId,
    routeApprovalDepartment,
    shouldAutoOpenApprovalFromRoute
  } = useApprovalRouteAutopen({
    supportedEntityTypes: ['PLAN', 'PLAN_REPORT'] as const,
    onAutoOpen: () => Promise.resolve().then(() => handleOpenApproval()),
    onClearFailure: error => {
      logger.warn('[IndicatorDistributeView] 清理审批自动打开参数失败:', error)
    }
  })

  const currentApprovalEntityType = computed<'PLAN' | 'PLAN_REPORT'>(() => {
    if (effectiveRouteApprovalEntityType.value) {
      return effectiveRouteApprovalEntityType.value
    }
    if (hasActiveCollegePlanWorkflow.value) {
      return 'PLAN'
    }
    if (approvalWorkflowReportSummary.value?.id) {
      return 'PLAN_REPORT'
    }
    return currentActiveCollegePlan.value?.id ? 'PLAN' : 'PLAN_REPORT'
  })

  const currentApprovalEntityId = computed<number | string | undefined>(() => {
    if (effectiveRouteApprovalEntityId.value) {
      return effectiveRouteApprovalEntityId.value
    }
    if (hasActiveCollegePlanWorkflow.value) {
      return currentActiveCollegePlan.value?.id
    }
    if (approvalWorkflowReportSummary.value?.id) {
      return approvalWorkflowReportSummary.value.id
    }

    return currentActiveCollegePlan.value?.id || latestCollegePlanReportSummary.value?.id
  })

  const secondaryApprovalEntityType = computed<'PLAN' | 'PLAN_REPORT' | undefined>(() => {
    if (currentApprovalEntityType.value === 'PLAN_REPORT') {
      return 'PLAN'
    }

    return latestCollegePlanReportSummary.value?.id ? 'PLAN_REPORT' : undefined
  })

  const secondaryApprovalEntityId = computed<number | string | undefined>(() => {
    if (currentApprovalEntityType.value === 'PLAN_REPORT') {
      return currentActiveCollegePlan.value?.id
    }

    if (currentApprovalEntityType.value === 'PLAN') {
      return latestCollegePlanReportSummary.value?.id
    }

    return latestCollegePlanReportSummary.value?.id
  })

  const currentApprovalType = computed<'distribution' | 'submission'>(() => {
    return currentApprovalEntityType.value === 'PLAN_REPORT' ? 'submission' : 'distribution'
  })

  const usePlanReportFlow = computed(() => currentApprovalType.value === 'submission')

  const currentApprovalWorkflowStatus = computed(() => {
    return String(
      currentCollegeWorkflowDetail.value?.status ||
        currentActiveCollegePlan.value?.workflowStatus ||
        currentCollegePlanReportSummary.value?.workflowStatus ||
        currentCollegePlanReportSummary.value?.status ||
        selectedCollegePlanUiStatus.value ||
        ''
    )
      .trim()
      .toUpperCase()
  })

  const currentApprovalStepName = computed(() => {
    return String(
      currentCollegeWorkflowDetail.value?.currentStepName ||
        currentActiveCollegePlan.value?.currentStepName ||
        currentCollegePlanReportSummary.value?.currentStepName ||
        ''
    ).trim()
  })

  const currentApprovalApproverName = computed(() => {
    return String(
      currentCollegeWorkflowDetail.value?.currentApproverName ||
        currentActiveCollegePlan.value?.currentApproverName ||
        currentCollegePlanReportSummary.value?.currentApproverName ||
        ''
    ).trim()
  })

  const currentApprovalFlowName = computed(() => {
    return String(
      currentCollegeWorkflowDetail.value?.flowName ||
        currentCollegeWorkflowDetail.value?.definitionName ||
        approvalWorkflowPreview.value?.workflowName ||
        ''
    ).trim()
  })

  const currentApprovalStepPreview = computed(() => {
    const stepName = normalizeWorkflowStepName(currentApprovalStepName.value)
    if (!stepName || !approvalWorkflowPreview.value?.steps?.length) {
      return null
    }

    return (
      approvalWorkflowPreview.value.steps.find(
        step => normalizeWorkflowStepName(step.stepName) === stepName
      ) || null
    )
  })

  const currentApprovalRuntimeCandidateNames = ref<string[]>([])
  const approvalCandidateCache = new Map<string, string[]>()
  const canLookupWorkflowUsers = computed(() => authStore.userRole === 'strategic_dept')

  const normalizeOrgRoleUserDisplayName = (user: {
    realName?: unknown
    name?: unknown
    username?: unknown
  }): string => {
    return String(user.realName || user.name || user.username || '').trim()
  }

  async function loadCurrentApprovalRuntimeCandidateNames(): Promise<void> {
    const currentTaskId = Number(
      currentCollegeWorkflowDetail.value?.currentTaskId ??
        currentCollegePlanReportSummary.value?.currentTaskId ??
        currentActiveCollegePlan.value?.currentTaskId ??
        NaN
    )
    const currentTask = Array.isArray(currentCollegeWorkflowDetail.value?.tasks)
      ? currentCollegeWorkflowDetail.value.tasks.find(
          task => Number(task.taskId ?? NaN) === currentTaskId
        )
      : null
    const orgId =
      Number(currentTask?.approverOrgId ?? NaN) > 0 ? Number(currentTask?.approverOrgId) : null

    const stepName = String(
      currentCollegeWorkflowDetail.value?.currentStepName ||
        currentCollegePlanReportSummary.value?.currentStepName ||
        currentActiveCollegePlan.value?.currentStepName ||
        ''
    ).trim()

    const roleCodes = (() => {
      if (!stepName) {
        return []
      }
      if (
        stepName.includes('职能部门审批') ||
        stepName.includes('职能部门终审') ||
        stepName.includes('二级学院审批')
      ) {
        return ['ROLE_APPROVER']
      }
      if (stepName.includes('战略发展部')) {
        return ['ROLE_STRATEGY_DEPT_HEAD']
      }
      if (stepName.includes('分管校领导') || stepName.includes('学院院长')) {
        return ['ROLE_VICE_PRESIDENT']
      }
      return []
    })()

    if (!canLookupWorkflowUsers.value || !orgId || roleCodes.length === 0) {
      currentApprovalRuntimeCandidateNames.value = []
      return
    }

    const cacheKey = `${orgId}::${roleCodes.slice().sort().join(',')}`
    const cached = approvalCandidateCache.get(cacheKey)
    if (cached) {
      currentApprovalRuntimeCandidateNames.value = cached
      return
    }

    try {
      const users = await getUsersByOrgId(orgId)
      const names = users
        .filter(user => user.isActive !== false)
        .filter(user => {
          const userRoles = Array.isArray(user.roles) ? user.roles.filter(Boolean) : []
          return roleCodes.some(roleCode => userRoles.includes(roleCode))
        })
        .map(user => normalizeOrgRoleUserDisplayName(user))
        .filter(Boolean)

      const uniqueNames = [...new Set(names)]
      approvalCandidateCache.set(cacheKey, uniqueNames)
      currentApprovalRuntimeCandidateNames.value = uniqueNames
    } catch (error) {
      currentApprovalRuntimeCandidateNames.value = []
      logger.warn('[IndicatorDistributeView] 加载页面级审批候选人失败:', {
        orgId,
        roleCodes,
        error
      })
    }
  }

  const currentApprovalCandidateNames = computed(() => {
    if (currentApprovalRuntimeCandidateNames.value.length > 0) {
      return currentApprovalRuntimeCandidateNames.value
    }

    const candidates = currentApprovalStepPreview.value?.candidateApprovers
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return []
    }

    return candidates
      .map(candidate => normalizePreviewCandidateDisplayName(candidate))
      .filter(Boolean)
  })

  watch(
    () => [
      currentApprovalStepName.value,
      String(currentCollegeWorkflowDetail.value?.currentTaskId || ''),
      JSON.stringify(currentCollegeWorkflowDetail.value?.tasks || [])
    ],
    () => {
      void loadCurrentApprovalRuntimeCandidateNames()
    },
    { immediate: true }
  )

  const approvalFlowStatusMeta = computed(() => {
    const workflowStatus = currentApprovalWorkflowStatus.value
    const stepName = currentApprovalStepName.value
    const approverName = currentApprovalApproverName.value
    const candidateNames = currentApprovalCandidateNames.value

    if (
      workflowStatus === 'APPROVED' ||
      workflowStatus === 'COMPLETED' ||
      workflowStatus === 'FINISHED' ||
      workflowStatus === 'DISTRIBUTED'
    ) {
      return {
        label: '已完成审批',
        tagType: 'success' as const,
        description: '当前计划审批流程已完成。'
      }
    }

    if (
      workflowStatus === 'REJECTED' ||
      workflowStatus === 'RETURNED' ||
      workflowStatus === 'WITHDRAWN' ||
      workflowStatus === 'CANCELLED'
    ) {
      return {
        label: '已退回',
        tagType: 'danger' as const,
        description: stepName ? `当前流程已在“${stepName}”环节退回。` : '当前计划审批流程已退回。'
      }
    }

    if (
      stepName ||
      approverName ||
      ['SUBMITTED', 'IN_REVIEW', 'PENDING'].includes(workflowStatus)
    ) {
      return {
        label: stepName ? `待${stepName}审批` : '审批中',
        tagType: 'warning' as const,
        description:
          candidateNames.length > 0
            ? `当前节点有 ${candidateNames.length} 位可审批人。`
            : stepName
              ? `当前节点：${stepName}`
              : '当前计划正在审批中。'
      }
    }

    if (
      approvalWorkflowReportSummary.value?.id ||
      currentActiveCollegePlan.value?.workflowInstanceId
    ) {
      return {
        label: '查看流程',
        tagType: 'info' as const,
        description: '当前计划已有审批记录，可进入审批中心查看。'
      }
    }

    return {
      label: '未发起流程',
      tagType: 'info' as const,
      description: '当前计划还未发起审批流程。'
    }
  })

  const currentUserPermissionCodes = computed(() => {
    const permissions = (authStore.user as { permissions?: unknown[] } | null)?.permissions
    if (!Array.isArray(permissions)) {
      return []
    }
    return permissions
      .map(permission => (typeof permission === 'string' ? permission.trim() : ''))
      .filter(Boolean)
  })

  const currentUserRoleCodes = computed(() => {
    const roles = (authStore.user as { roles?: unknown[] } | null)?.roles
    if (!Array.isArray(roles)) {
      return []
    }
    return roles.map(role => (typeof role === 'string' ? role.trim() : '')).filter(Boolean)
  })

  const currentUserNormalizedRoleCodes = computed(() => {
    return currentUserRoleCodes.value.map(role => role.trim().toUpperCase()).filter(Boolean)
  })

  const isCurrentUserReporter = computed(() => {
    return currentUserNormalizedRoleCodes.value.includes('ROLE_REPORTER')
  })

  const currentUserOrgId = computed(() => {
    const rawOrgId = Number(authStore.user?.orgId ?? NaN)
    return Number.isFinite(rawOrgId) && rawOrgId > 0 ? rawOrgId : null
  })

  const canCurrentUserSubmitCurrentDepartmentDistribution = computed(() => {
    const currentOrgId = currentDepartmentOrgIdFromTable.value
    if (!currentOrgId || !currentUserOrgId.value || !isCurrentUserReporter.value) {
      return false
    }

    return currentUserOrgId.value === currentOrgId
  })

  const resolveCurrentStepExpectedRoleCodes = () => {
    const stepName = String(currentActiveCollegePlan.value?.currentStepName || '').trim()
    if (!stepName) {
      return []
    }

    if (
      stepName.includes('职能部门审批') ||
      stepName.includes('职能部门终审') ||
      stepName.includes('二级学院审批')
    ) {
      return ['ROLE_APPROVER']
    }

    if (stepName.includes('战略发展部')) {
      return ['ROLE_STRATEGY_DEPT_HEAD']
    }

    if (stepName.includes('分管校领导') || stepName.includes('学院院长')) {
      return ['ROLE_VICE_PRESIDENT']
    }

    return []
  }

  const canCurrentUserApproveCurrentPlan = computed(() => {
    if (!['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(selectedCollegePlanUiStatus.value)) {
      return false
    }

    const currentStepName = String(
      currentCollegeWorkflowDetail.value?.currentStepName ||
        currentCollegePlanReportSummary.value?.currentStepName ||
        currentActiveCollegePlan.value?.currentStepName ||
        ''
    ).trim()

    const expectedRoles = (() => {
      if (!currentStepName) {
        return []
      }

      if (
        currentStepName.includes('职能部门审批') ||
        currentStepName.includes('职能部门终审') ||
        currentStepName.includes('二级学院审批')
      ) {
        return ['ROLE_APPROVER']
      }

      if (currentStepName.includes('战略发展部')) {
        return ['ROLE_STRATEGY_DEPT_HEAD']
      }

      if (currentStepName.includes('分管校领导') || currentStepName.includes('学院院长')) {
        return ['ROLE_VICE_PRESIDENT']
      }

      return []
    })()
    if (expectedRoles.length > 0) {
      const hasExpectedRole = expectedRoles.some(role => currentUserRoleCodes.value.includes(role))
      if (!hasExpectedRole) {
        return false
      }
    }

    const currentTaskId = Number(
      currentCollegeWorkflowDetail.value?.currentTaskId ??
        currentCollegePlanReportSummary.value?.currentTaskId ??
        currentActiveCollegePlan.value?.currentTaskId ??
        NaN
    )
    const currentTask = Array.isArray(currentCollegeWorkflowDetail.value?.tasks)
      ? currentCollegeWorkflowDetail.value.tasks.find(
          task => Number(task.taskId ?? NaN) === currentTaskId
        )
      : null

    const currentOrgId =
      Number(currentTask?.approverOrgId ?? NaN) > 0
        ? Number(currentTask?.approverOrgId)
        : currentDepartmentOrgId.value
    if (
      currentOrgId != null &&
      Number.isFinite(currentUserOrgId.value) &&
      currentUserOrgId.value > 0
    ) {
      return currentUserOrgId.value === currentOrgId
    }

    return true
  })

  const hasCurrentCollegePendingApproval = computed(() => {
    return currentCollegePlanActionState.value.startsWith('pending')
  })

  const distributionApprovalButtonType = computed(() => {
    return hasCurrentCollegePendingApproval.value ? 'warning' : 'default'
  })

  const distributionApprovalButtonText = computed(() => {
    if (currentCollegePlanActionState.value.startsWith('pending')) {
      return '审批中'
    }
    return '查看审批进度'
  })

  const withdrawButtonVisible = computed(() => {
    if (!selectedCollege.value) {
      return false
    }

    return currentCollegePlanActionState.value === 'pending_withdrawable'
  })

  const withdrawButtonType = computed(() => {
    return canWithdrawCurrentCollegePlan.value ? 'warning' : 'info'
  })

  const withdrawButtonDisabledReason = computed(() => {
    if (timeContext.isReadOnly) {
      return '历史快照为只读状态'
    }

    const status = selectedCollegePlanUiStatus.value
    if (
      ['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(status) &&
      !canWithdrawCurrentCollegePlan.value
    ) {
      return isCurrentUserReporter.value
        ? '当前审批进度不支持撤回'
        : '当前登录身份不是填报人，不能撤回'
    }

    if (!withdrawButtonVisible.value) {
      return '当前状态不可撤回'
    }

    return ''
  })

  const withdrawButtonDisabled = computed(() => {
    return isBatchDistributing.value || Boolean(withdrawButtonDisabledReason.value)
  })

  const distributionSubmitButtonDisabledReason = computed(() => {
    if (timeContext.isReadOnly) {
      return '历史快照为只读状态'
    }

    if (!currentDepartmentOrgIdFromTable.value) {
      return '当前部门未在组织表中匹配到有效组织，暂不能下发'
    }

    if (!canCurrentUserSubmitCurrentDepartmentDistribution.value) {
      return '只有当前部门组织下的填报人才可以下发'
    }

    if (collegeTotalWeight.value !== 100) {
      return '权重未等于百分之百'
    }

    if (isBatchDistributing.value) {
      return '正在下发中，请稍候'
    }

    return ''
  })

  const distributionSubmitButtonType = computed(() => {
    return distributionSubmitButtonDisabledReason.value ? 'info' : 'success'
  })

  const distributionSubmitButtonText = computed(() => {
    return '发起下发审批'
  })

  const approvalSetupDialogVisible = ref(false)
  const approvalPreviewLoading = ref(false)
  const approvalSubmitting = ref(false)
  const approvalSubmitComment = ref('')
  const approvalWorkflowPreview = ref<WorkflowDefinitionPreviewResponse | null>(null)

  const resetApprovalSetupDialog = () => {
    approvalWorkflowPreview.value = null
    approvalSubmitComment.value = ''
  }

  const handleCloseApprovalSetupDialog = () => {
    approvalSetupDialogVisible.value = false
    resetApprovalSetupDialog()
  }

  const openDistributionApprovalSetupDialog = async () => {
    const planId = Number(currentActiveCollegePlan.value?.id ?? NaN)
    if (!Number.isFinite(planId) || planId <= 0) {
      ElMessage.warning('当前学院还没有可提交审批的计划')
      return
    }

    approvalPreviewLoading.value = true
    approvalSetupDialogVisible.value = true

    try {
      const response = await getWorkflowDefinitionPreviewByCode(currentDispatchWorkflowCode.value)
      if (!response.success || !response.data) {
        throw new Error(response.message || '加载审批流程失败')
      }
      approvalWorkflowPreview.value = response.data
    } catch (error) {
      approvalSetupDialogVisible.value = false
      resetApprovalSetupDialog()
      logger.error('[IndicatorDistributeView] Failed to load workflow preview:', error)
      const message = error instanceof Error ? error.message : '加载审批流程失败'
      if (message.includes('Workflow definition not found')) {
        ElMessage.error('当前环境未配置审批流程定义，无法发起审批')
        return
      }
      if (message.includes('No available approver candidates')) {
        ElMessage.error('当前审批节点未匹配到可用审批人，无法发起审批')
        return
      }
      if (message.includes('missing role assignment')) {
        ElMessage.error('当前审批流程配置不完整，无法发起审批')
        return
      }
      ElMessage.error(message)
    } finally {
      approvalPreviewLoading.value = false
    }
  }

  const confirmDepartmentPlanApprovalSubmission = async () => {
    const planId = Number(currentActiveCollegePlan.value?.id ?? NaN)
    if (!Number.isFinite(planId) || planId <= 0) {
      ElMessage.warning('当前计划不存在，无法发起审批')
      return
    }

    const preview = approvalWorkflowPreview.value
    if (!preview || !Array.isArray(preview.steps) || preview.steps.length === 0) {
      ElMessage.warning('审批流程尚未准备完成')
      return
    }

    approvalSubmitting.value = true
    try {
      await planStore.submitPlanForApproval(planId, {
        workflowCode: preview.workflowCode || currentDispatchWorkflowCode.value,
        comment: approvalSubmitComment.value.trim() || undefined
      })
      applyLocalCollegePlanPatch({
        status: 'PENDING' as Plan['status'],
        workflowStatus: 'IN_REVIEW',
        canWithdraw: true,
        currentStepName: preview.steps[0]?.stepName || '审批中'
      })
      applyLocalCollegePlanReportSummaryPatch('submitted')
      await refreshDistributionData()
      handleCloseApprovalSetupDialog()
      taskApprovalVisible.value = true
      ElMessage.success('已发起下发审批')
    } catch (error) {
      logger.error('[IndicatorDistributeView] Failed to submit dispatch approval:', error)
    } finally {
      approvalSubmitting.value = false
    }
  }

  const loadCurrentDepartmentPlanDetails = async (force = false) => {
    const stablePlan = matchesCurrentDepartmentPlanContext(currentDepartmentPlanDetails.value)
      ? currentDepartmentPlanDetails.value
      : null
    const plan = stablePlan ?? currentDepartmentPlan.value
    if (!plan?.id) {
      currentDepartmentPlanDetails.value = null
      currentPlanTaskTypeMap.value = {}
      return null
    }

    const currentDetail = currentDepartmentPlanDetails.value
    if (!force && currentDetail?.id === plan.id) {
      return currentDetail
    }

    try {
      const latestPlan = await planStore.loadPlanDetails(plan.id, { force, background: true })
      currentDepartmentPlanDetails.value = latestPlan ?? plan
      await loadCurrentDepartmentPlanTaskTypeMap(plan.id)
      return currentDepartmentPlanDetails.value
    } catch (error) {
      currentDepartmentPlanDetails.value = plan
      await loadCurrentDepartmentPlanTaskTypeMap(plan.id)
      logger.warn('[IndicatorDistributeView] 加载当前部门计划详情失败:', error)
      return currentDepartmentPlanDetails.value
    }
  }

  const loadCurrentSelectedCollegePlanDetails = async (force = false) => {
    const stablePlan = matchesCurrentSelectedCollegePlanContext(
      currentSelectedCollegePlanDetails.value
    )
      ? currentSelectedCollegePlanDetails.value
      : null
    const plan = stablePlan ?? currentSelectedCollegePlan.value
    if (!plan?.id) {
      currentSelectedCollegePlanDetails.value = null
      currentPlanTaskTypeMap.value = {}
      return null
    }

    const currentDetail = currentSelectedCollegePlanDetails.value
    if (!force && currentDetail?.id === plan.id) {
      return currentDetail
    }

    try {
      const latestPlan = await planStore.loadPlanDetails(plan.id, { force, background: true })
      currentSelectedCollegePlanDetails.value = latestPlan ?? plan
      await loadCurrentDepartmentPlanTaskTypeMap(plan.id)
      return currentSelectedCollegePlanDetails.value
    } catch (error) {
      currentSelectedCollegePlanDetails.value = plan
      await loadCurrentDepartmentPlanTaskTypeMap(plan.id)
      logger.warn('[IndicatorDistributeView] 加载当前学院计划详情失败:', error)
      return currentSelectedCollegePlanDetails.value
    }
  }

  const refreshDistributionData = async () => {
    if (refreshDistributionPromise.value) {
      await refreshDistributionPromise.value
      return
    }

    refreshDistributionPromise.value = (async () => {
      invalidateQueries([
        'indicator.list',
        'task.list',
        'task.scope',
        'plan.list',
        'plan.detail',
        'dashboard.overview',
        buildQueryKey('task', 'list', { year: timeContext.currentYear })
      ])

      const reloadJobs: Array<{ source: string; job: Promise<unknown> }> = [
        {
          source: 'indicators',
          job: strategicStore.loadIndicatorsByYear(timeContext.currentYear, { force: true })
        },
        {
          source: 'plans',
          job: planStore.loadPlans({ force: true, background: true })
        },
        {
          source: 'reportSummary',
          job: loadCurrentCollegePlanReportSummary()
        },
        {
          source: 'taskTypeMap',
          job: loadCurrentDepartmentPlanTaskTypeMap(currentActiveCollegePlan.value?.id)
        }
      ]

      const results = await Promise.allSettled(reloadJobs.map(item => item.job))

      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const source = reloadJobs[index]?.source || 'unknown'
          logger.warn(`[IndicatorDistributeView] 加载 ${source} 数据失败:`, result.reason)
        }
      })

      await loadCurrentDepartmentPlanDetails(true)
      await loadCurrentSelectedCollegePlanDetails(true)
      await loadCurrentCollegePlanReportSummary()
      await preloadCurrentCollegeWorkflowDetail()
      lastEditTime.value = new Date().toLocaleString()
    })()

    try {
      await refreshDistributionPromise.value
    } finally {
      refreshDistributionPromise.value = null
    }
  }

  const waitForPageBootstrap = async () => {
    if (pageBootstrapPromise.value) {
      await pageBootstrapPromise.value
    }
  }

  const loadCurrentCollegePlanReportSummary = async () => {
    if (!selectedCollege.value) {
      currentCollegePlanReportSummary.value = null
      latestCollegePlanReportSummary.value = null
      return
    }

    const planId = Number(currentActiveCollegePlan.value?.id ?? NaN)
    const reportOrgId = Number(getOrgIdByDeptName(selectedCollege.value) ?? NaN)

    if (
      !Number.isFinite(planId) ||
      planId <= 0 ||
      !Number.isFinite(reportOrgId) ||
      reportOrgId <= 0
    ) {
      currentCollegePlanReportSummary.value = null
      latestCollegePlanReportSummary.value = null
      return
    }

    try {
      // 页面态与 /strategic-tasks 对齐：
      // 优先展示当前轮次 report 的业务状态（如退回后回到草稿），
      // 审批中心再通过 workflow 详情补足历史轨迹。
      currentCollegePlanReportSummary.value = await indicatorFillApi.getCurrentMonthPlanReport(
        planId,
        reportOrgId
      )
      latestCollegePlanReportSummary.value = await indicatorFillApi.getLatestCurrentMonthPlanReport(
        planId,
        reportOrgId
      )

      const rawReportStatus = String(currentCollegePlanReportSummary.value?.status || '')
        .trim()
        .toUpperCase()
      const rawWorkflowStatus = String(currentCollegePlanReportSummary.value?.workflowStatus || '')
        .trim()
        .toUpperCase()

      if (
        pendingCollegePlanUiState.value === 'submitted' &&
        (Boolean(currentCollegePlanReportSummary.value?.canWithdraw) ||
          ['APPROVED', 'WITHDRAWN', 'CANCELLED', 'REJECTED'].includes(
            rawWorkflowStatus || rawReportStatus
          ))
      ) {
        pendingCollegePlanUiState.value = null
      }

      if (
        pendingCollegePlanUiState.value === 'withdrawn' &&
        (rawReportStatus === 'DRAFT' || rawWorkflowStatus === 'WITHDRAWN')
      ) {
        pendingCollegePlanUiState.value = null
      }

      if (
        pendingCollegePlanUiState.value === 'approved' &&
        (rawReportStatus === 'APPROVED' || rawWorkflowStatus === 'APPROVED')
      ) {
        pendingCollegePlanUiState.value = null
      }

      if (
        pendingCollegePlanUiState.value === 'rejected' &&
        (rawReportStatus === 'REJECTED' || rawWorkflowStatus === 'REJECTED')
      ) {
        pendingCollegePlanUiState.value = null
      }
    } catch (error) {
      currentCollegePlanReportSummary.value = null
      latestCollegePlanReportSummary.value = null
      logger.warn('[IndicatorDistributeView] 加载当前学院 plan_report 失败:', {
        planId,
        reportOrgId,
        error
      })
    }
  }

  function applyLocalCollegePlanPatch(
    patch: Partial<Plan> & {
      workflowStatus?: string
      canWithdraw?: boolean
      currentTaskId?: number | undefined
      currentStepName?: string | undefined
      currentApproverId?: number | undefined
      currentApproverName?: string | undefined
    }
  ) {
    const effectivePatch = (() => {
      if (!usePlanReportFlow.value) {
        return patch
      }

      const { status: _ignoredStatus, ...rest } = patch
      return rest
    })()

    if (currentDepartmentPlanDetails.value) {
      currentDepartmentPlanDetails.value = {
        ...currentDepartmentPlanDetails.value,
        ...effectivePatch
      }
    }

    if (currentSelectedCollegePlanDetails.value) {
      currentSelectedCollegePlanDetails.value = {
        ...currentSelectedCollegePlanDetails.value,
        ...effectivePatch
      }
    }
  }

  function applyLocalCollegePlanReportSummaryPatch(target: 'submitted' | 'withdrawn') {
    pendingCollegePlanUiState.value = target
    const nextSummary = {
      ...(currentCollegePlanReportSummary.value || {}),
      status: target === 'withdrawn' ? 'DRAFT' : 'SUBMITTED',
      workflowStatus: target === 'withdrawn' ? 'WITHDRAWN' : 'IN_REVIEW',
      canWithdraw: target === 'submitted'
    }

    currentCollegePlanReportSummary.value = nextSummary
    if (Number.isFinite(Number(nextSummary.id)) && Number(nextSummary.id) > 0) {
      latestCollegePlanReportSummary.value = { id: Number(nextSummary.id) }
    }
  }

  const formatDetailDate = (time: string | Date | undefined): string => {
    if (!time) {
      return '-'
    }

    const date = new Date(time)
    if (Number.isNaN(date.getTime())) {
      return String(time).slice(0, 10) || '-'
    }

    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const syncSelectedCollegeFromApprovalRoute = async () => {
    await waitForPageBootstrap()

    const routeDepartmentName = normalizeDepartmentName(effectiveRouteApprovalDepartment.value)

    let nextCollege = routeDepartmentName

    if (!nextCollege && effectiveRouteApprovalEntityType.value !== 'PLAN_REPORT') {
      const routePlanId = Number(effectiveRouteApprovalEntityId.value ?? NaN)
      if (!Number.isFinite(routePlanId) || routePlanId <= 0) {
        return
      }

      let routePlan = planStore.getPlanById(routePlanId) || null
      if (!routePlan) {
        routePlan = await planStore.loadPlanDetails(routePlanId, { force: true, background: true })
      }

      if (!routePlan) {
        return
      }

      const planAny = routePlan as Plan & {
        targetOrgId?: number | string
        targetOrgName?: string
        orgId?: number | string
        orgName?: string
      }

      nextCollege =
        normalizeDepartmentName(planAny.targetOrgName || planAny.orgName || '') ||
        getDeptNameByOrgId(planAny.targetOrgId ?? planAny.org_id ?? planAny.orgId) ||
        ''
    }

    if (
      !nextCollege ||
      (selectedCollege.value && isSameDepartment(selectedCollege.value, nextCollege))
    ) {
      return
    }

    selectedCollege.value = nextCollege
    await nextTick()
    await loadCurrentSelectedCollegePlanDetails(true)
    await loadCurrentCollegePlanReportSummary()
  }

  // 打开任务审批抽屉
  const handleOpenApproval = async () => {
    if (shouldAutoOpenApprovalFromRoute.value) {
      retainedRouteApprovalEntityType.value = routeApprovalEntityType.value
      retainedRouteApprovalEntityId.value = routeApprovalEntityId.value
      retainedRouteApprovalDepartment.value = routeApprovalDepartment.value
    }

    await syncSelectedCollegeFromApprovalRoute()
    await loadCurrentCollegePlanReportSummary()
    await preloadCurrentCollegeWorkflowDetail()
    taskApprovalVisible.value = true
  }

  watch(taskApprovalVisible, visible => {
    if (visible) {
      return
    }

    retainedRouteApprovalEntityType.value = undefined
    retainedRouteApprovalEntityId.value = undefined
    retainedRouteApprovalDepartment.value = undefined
  })

  async function preloadCurrentCollegeWorkflowDetail(): Promise<void> {
    currentCollegeWorkflowDetail.value = null

    const entityType = currentApprovalEntityType.value
    const entityId = Number(currentApprovalEntityId.value ?? NaN)
    if (!entityType || !Number.isFinite(entityId) || entityId <= 0) {
      return
    }

    try {
      const response = await getWorkflowInstanceDetailByBusiness(entityType, entityId)
      if (response.success && response.data) {
        currentCollegeWorkflowDetail.value = response.data
      }
    } catch (error) {
      logger.warn('[IndicatorDistributeView] 预加载审批工作流详情失败:', {
        entityType,
        entityId,
        error
      })
    }
  }

  const handleApprovalStatusPopoverShow = async () => {
    if (!selectedCollege.value) {
      return
    }

    approvalStatusPopoverLoading.value = true
    try {
      if (!currentCollegeWorkflowDetail.value) {
        await preloadCurrentCollegeWorkflowDetail()
      }

      if (!approvalWorkflowPreview.value) {
        try {
          const response = await getWorkflowDefinitionPreviewByCode(
            currentDispatchWorkflowCode.value
          )
          if (response.success && response.data) {
            approvalWorkflowPreview.value = response.data
          }
        } catch (error) {
          logger.warn('[IndicatorDistributeView] 加载流程状态候选审批人失败:', error)
        }
      }
    } finally {
      approvalStatusPopoverLoading.value = false
    }
  }

  // 审批后刷新
  const handleApprovalRefresh = async (
    payload?: Partial<Plan> & {
      workflowStatus?: string
      canWithdraw?: boolean
      currentTaskId?: number | null
      currentStepName?: string | null
      currentApproverId?: number | null
      currentApproverName?: string | null
    }
  ) => {
    if (payload) {
      applyLocalCollegePlanPatch({
        ...payload,
        currentTaskId:
          payload.currentTaskId === null ? undefined : (payload.currentTaskId ?? undefined),
        currentStepName:
          payload.currentStepName === null ? undefined : (payload.currentStepName ?? undefined),
        currentApproverId:
          payload.currentApproverId === null ? undefined : (payload.currentApproverId ?? undefined),
        currentApproverName:
          payload.currentApproverName === null
            ? undefined
            : (payload.currentApproverName ?? undefined)
      })

      if (payload.workflowStatus === 'APPROVED') {
        pendingCollegePlanUiState.value = 'approved'
        applyLocalCollegePlanReportSummaryPatch('submitted')
        if (currentCollegePlanReportSummary.value) {
          currentCollegePlanReportSummary.value = {
            ...currentCollegePlanReportSummary.value,
            workflowStatus: 'APPROVED',
            status: 'APPROVED',
            canWithdraw: false
          }
        }
      } else if (payload.workflowStatus === 'REJECTED') {
        pendingCollegePlanUiState.value = 'rejected'
        applyLocalCollegePlanReportSummaryPatch('withdrawn')
        if (currentCollegePlanReportSummary.value) {
          currentCollegePlanReportSummary.value = {
            ...currentCollegePlanReportSummary.value,
            workflowStatus: 'REJECTED',
            status: 'REJECTED',
            canWithdraw: false
          }
        }
      }
    }

    void refreshDistributionData()
  }

  // ================== 数据获取 ==================

  // 筛选后的学院列表（用于侧边栏搜索）
  const filteredColleges = computed(() => {
    if (!searchKeyword.value) {
      return colleges.value
    }
    const keyword = searchKeyword.value.toLowerCase()
    return colleges.value.filter(c => c.toLowerCase().includes(keyword))
  })

  const copySourceCollegeOptions = computed(() => {
    const currentCollege = normalizeDepartmentName(selectedCollege.value)
    return colleges.value
      .filter(college => normalizeDepartmentName(college) !== currentCollege)
      .map(college => ({
        value: college,
        label: college,
        count: getCollegeChildCount(college)
      }))
      .filter(option => option.count > 0)
  })

  const distributionRecordCount = computed(() => {
    if (!selectedCollege.value) {
      return 0
    }

    return collegeTableData.value.length
  })

  const isCollegeSidebarLoading = computed(
    () => orgStore.loading && !orgStore.loaded && colleges.value.length === 0
  )

  // 获取学院的子指标数量（只统计当前部门下发的）
  const getCollegeChildCount = (college: string) => {
    return strategicStore.indicators.filter(i => {
      if (i.isStrategic) {
        return false
      }
      // 只统计当前部门下发的指标
      if (!isSameDepartment(i.ownerDept, currentDept.value)) {
        return false
      }
      return matchesDepartment(i.responsibleDept, college)
    }).length
  }

  // 获取选中学院的所有子指标（按父指标分组，只显示当前部门下发的）
  const currentDepartmentPlanIndicators = computed<StrategicIndicator[]>(() => {
    const plan = currentSelectedCollegePlanDetails.value as
      | (Plan & { indicators?: unknown[] })
      | null
    if (!plan || !Array.isArray(plan.indicators)) {
      return []
    }

    const storeIndicatorMap = new Map(
      strategicStore.indicators.map(indicator => [String(indicator.id), indicator] as const)
    )

    return plan.indicators.map(rawIndicator => {
      const source =
        rawIndicator && typeof rawIndicator === 'object'
          ? (rawIndicator as Record<string, unknown>)
          : {}
      const indicatorId = String(source.id ?? source.indicatorId ?? '')
      const storeIndicator = indicatorId ? storeIndicatorMap.get(indicatorId) : undefined
      const parentIndicatorId =
        getPlanIndicatorText(source, 'parentIndicatorId', 'parent_indicator_id', 'parentId') ||
        storeIndicator?.parentIndicatorId ||
        ''
      const parentIndicator = parentIndicatorId
        ? strategicStore.indicators.find(item => String(item.id) === parentIndicatorId)
        : undefined
      const planIndicatorTaskId = String(
        source.taskId ??
          source.task_id ??
          source.planId ??
          source.strategicTaskId ??
          source.cycleId ??
          ''
      ).trim()
      const mappedTaskType =
        currentPlanTaskTypeMap.value[planIndicatorTaskId] ||
        currentPlanTaskTypeMap.value[getIndicatorTaskId(storeIndicator as StrategicIndicator)] ||
        currentPlanTaskTypeMap.value[getIndicatorTaskId(parentIndicator as StrategicIndicator)] ||
        ''
      const resolvedType2 =
        normalizeTaskTypeToCategory(getPlanIndicatorText(source, 'taskType')) ||
        normalizeTaskTypeToCategory(mappedTaskType) ||
        String(storeIndicator?.type2 || '').trim() ||
        String(parentIndicator?.type2 || '').trim() ||
        '其他'

      const normalizedIndicator = {
        ...(storeIndicator || {}),
        id: indicatorId || storeIndicator?.id || String(Date.now()),
        name: getPlanIndicatorText(source, 'indicatorName', 'name') || storeIndicator?.name || '',
        taskContent:
          getPlanIndicatorText(source, 'taskName', 'taskContent') ||
          storeIndicator?.taskContent ||
          '',
        type1:
          normalizeIndicatorTypeLabel(
            getPlanIndicatorText(source, 'type1', 'indicatorType', 'indicatorType1', 'type')
          ) ||
          normalizeIndicatorTypeLabel(source.type) ||
          normalizeIndicatorTypeLabel(storeIndicator?.type1) ||
          (storeIndicator?.isQualitative ? '定性' : '') ||
          '定量',
        type2: resolvedType2,
        status: (getPlanIndicatorText(source, 'status').toUpperCase() ||
          storeIndicator?.status ||
          'DISTRIBUTED') as StrategicIndicator['status'],
        isStrategic: storeIndicator?.isStrategic ?? true,
        responsibleDept:
          getPlanIndicatorText(source, 'targetOrgName', 'responsibleDept') ||
          storeIndicator?.responsibleDept ||
          selectedCollege.value ||
          currentDept.value,
        ownerDept:
          getPlanIndicatorText(source, 'ownerOrgName', 'ownerDept') ||
          storeIndicator?.ownerDept ||
          '',
        progress: getPlanIndicatorNumber(source, 'progress') || storeIndicator?.progress || 0,
        weight:
          getPlanIndicatorNumber(source, 'weightPercent', 'weight') || storeIndicator?.weight || 0,
        year: Number(source.year) || storeIndicator?.year || timeContext.currentYear,
        milestones: storeIndicator?.milestones || [],
        statusAudit: storeIndicator?.statusAudit || [],
        parentIndicatorId: parentIndicatorId || undefined
      } as StrategicIndicator & {
        targetOrgId?: number
        ownerOrgId?: number
      }

      const targetOrgId =
        getPlanIndicatorNumber(source, 'targetOrgId', 'target_org_id') ||
        Number(
          (storeIndicator as StrategicIndicator & { targetOrgId?: number | string })?.targetOrgId ??
            0
        )
      if (Number.isFinite(targetOrgId) && targetOrgId > 0) {
        normalizedIndicator.targetOrgId = targetOrgId
      }

      const ownerOrgId =
        getPlanIndicatorNumber(source, 'ownerOrgId', 'owner_org_id') ||
        Number(
          (storeIndicator as StrategicIndicator & { ownerOrgId?: number | string })?.ownerOrgId ?? 0
        )
      if (Number.isFinite(ownerOrgId) && ownerOrgId > 0) {
        normalizedIndicator.ownerOrgId = ownerOrgId
      }

      return normalizedIndicator
    })
  })

  const availableParentIndicators = computed<StrategicIndicator[]>(() => {
    if (!isFunctionalDept.value) {
      return strategicStore.indicators.filter(i => i.isStrategic)
    }

    const currentOrgId = currentDepartmentOrgId.value
    const mergedIndicators = new Map<string, StrategicIndicator>()

    strategicStore.indicators.forEach(indicator => {
      const indicatorId = String(indicator.id || '').trim()
      if (!indicatorId) {
        return
      }
      mergedIndicators.set(indicatorId, indicator)
    })

    currentDepartmentPlanIndicators.value.forEach(indicator => {
      const indicatorId = String(indicator.id || '').trim()
      if (!indicatorId) {
        return
      }

      const existingIndicator = mergedIndicators.get(indicatorId)
      mergedIndicators.set(indicatorId, {
        ...(existingIndicator || {}),
        ...indicator
      })
    })

    return Array.from(mergedIndicators.values()).filter(indicator => {
      if (!indicator.isStrategic) {
        return false
      }

      const isRootIndicator = String(indicator.parentIndicatorId || '').trim().length === 0
      if (!isRootIndicator) {
        return false
      }

      if (canUseAsFunctionalParentIndicator(indicator, currentOrgId, true)) {
        return true
      }

      const runtimeIndicator = indicator as StrategicIndicator & {
        targetOrgName?: string
        ownerOrgName?: string
      }

      return (
        matchesDepartment(indicator.responsibleDept, currentDept.value) ||
        isSameDepartment(runtimeIndicator.targetOrgName, currentDept.value) ||
        isSameDepartment(runtimeIndicator.ownerOrgName, currentDept.value)
      )
    })
  })

  const receivedParentIndicators = computed<StrategicIndicator[]>(() => {
    return availableParentIndicators.value
  })

  const collegeIndicators = computed(() => {
    if (!selectedCollege.value) {
      return []
    }

    return receivedParentIndicators.value
  })

  // 获取指标的子指标（只显示当前部门下发的）
  const _getChildIndicators = (parentId: string) => {
    return strategicStore.indicators.filter(
      i =>
        i.parentIndicatorId === parentId &&
        !i.isStrategic &&
        isSameDepartment(i.ownerDept, currentDept.value)
    )
  }

  // ================== 添加指标弹框相关 ==================

  // 添加指标表单是否可见（改为底部表单）
  const isAddingIndicator = ref(false)

  // 新增指标保存中状态
  const isSavingIndicator = ref(false)
  const deletingChildId = ref<string | null>(null)

  // 新增指标数据（单个）
  const newIndicatorForm = ref<NewIndicatorItem>({
    id: '',
    parentIndicatorId: '',
    parentIndicatorName: '',
    taskContent: '',
    type1: '定量',
    name: '',
    remark: '',
    weight: 10,
    targetProgress: 100,
    milestones: []
  })

  // 选择关联指标弹框是否可见（保留用于内联选择）
  const selectParentDialogVisible = ref(false)

  // 新增指标列表（支持一次添加多个）
  interface NewIndicatorItem {
    id: string
    parentIndicatorId: string // 关联的父指标ID
    parentIndicatorName: string // 关联的父指标名称（用于显示）
    taskContent: string // 父指标所属的战略任务
    type1: '定量' | '定性' // 指标类型
    name: string // 指标内容
    remark: string // 备注
    weight: number // 权重
    targetProgress: number // 定量指标目标进度
    milestones: { id: string; name: string; targetProgress: number; deadline: string }[] // 里程碑
  }

  type FormMilestone = NewIndicatorItem['milestones'][number]

  // 弹框中的新增指标列表
  const _newIndicatorList = ref<NewIndicatorItem[]>([])

  // 当前正在选择关联指标的新增指标索引
  const _selectingParentForIndex = ref<number>(-1)

  // 计划和指标数据（用于选择关联指标弹框）
  const plansWithIndicators = computed(() => {
    const indicators = availableParentIndicators.value

    const taskMap = new Map<string, StrategicIndicator[]>()

    indicators.forEach(indicator => {
      const taskContent = indicator.taskContent || '未分类'
      if (!taskMap.has(taskContent)) {
        taskMap.set(taskContent, [])
      }
      taskMap.get(taskContent)!.push(indicator)
    })

    return Array.from(taskMap.entries()).map(([taskContent, indicators]) => ({
      taskContent,
      type2: indicators[0]?.type2 || '发展性',
      indicators
    }))
  })

  // 选择关联指标弹框 - 展平的表格数据（用于合并单元格显示）
  interface SelectParentTableRow {
    taskContent: string
    type2: '发展性' | '基础性'
    indicator: StrategicIndicator
    isFirstOfTask: boolean // 是否是该任务的第一行
    taskRowSpan: number // 任务单元格需要合并的行数
  }

  const selectParentTableData = computed((): SelectParentTableRow[] => {
    const data: SelectParentTableRow[] = []

    plansWithIndicators.value.forEach(task => {
      const taskIndicators = task.indicators
      taskIndicators.forEach((indicator, index) => {
        data.push({
          taskContent: task.taskContent,
          type2: task.type2 as '发展性' | '基础性',
          indicator,
          isFirstOfTask: index === 0,
          taskRowSpan: index === 0 ? taskIndicators.length : 0
        })
      })
    })

    return data
  })

  // 选择关联指标弹框 - 单元格合并方法
  const _selectParentSpanMethod = ({
    row,
    columnIndex
  }: {
    row: SelectParentTableRow
    columnIndex: number
  }) => {
    // 第一列（战略任务）需要合并
    if (columnIndex === 0) {
      if (row.isFirstOfTask) {
        return { rowspan: row.taskRowSpan, colspan: 1 }
      } else {
        return { rowspan: 0, colspan: 0 }
      }
    }
    return { rowspan: 1, colspan: 1 }
  }

  // 打开添加指标表单
  const openAddIndicatorForm = () => {
    if (!canEditCurrentCollegePlan.value) {
      ElMessage.warning('当前计划审批中，暂不能编辑或新增子指标')
      return
    }

    // 检查是否有已下发的指标（下发后不能再添加）
    if (selectedCollege.value) {
      const collegeStatus = getCollegeStatus(selectedCollege.value)
      if (
        collegeStatus.distributed > 0 ||
        collegeStatus.pending > 0 ||
        collegeStatus.approved > 0
      ) {
        ElMessage.warning('存在已下发的指标，请先撤回后再添加新指标')
        return
      }
    }

    // 重置表单
    newIndicatorForm.value = {
      id: `new-${Date.now()}`,
      parentIndicatorId: '',
      parentIndicatorName: '',
      taskContent: '',
      type1: '定量',
      name: '',
      remark: '',
      weight: 10,
      targetProgress: 100,
      milestones: []
    }
    isAddingIndicator.value = true

    nextTick(() => {
      addRowFormRef.value?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      })
    })
  }

  const openCopyIndicatorsDialog = () => {
    if (!selectedCollege.value) {
      ElMessage.warning('请先选择学院')
      return
    }
    if (!canEditChild.value || currentCollegePlanActionState.value !== 'draft') {
      ElMessage.warning('当前学院计划不处于可复制指标的草稿状态')
      return
    }
    if (copySourceCollegeOptions.value.length === 0) {
      ElMessage.warning('暂无其它学院可复制指标')
      return
    }

    copySourceCollege.value = copySourceCollegeOptions.value[0]?.value || ''
    copyClearExisting.value = false
    copyIndicatorDialogVisible.value = true
  }

  const closeCopyIndicatorsDialog = () => {
    copyIndicatorDialogVisible.value = false
    copySourceCollege.value = ''
    copyClearExisting.value = false
  }

  // 取消添加指标
  const cancelAddIndicator = () => {
    isAddingIndicator.value = false
    newIndicatorForm.value = {
      id: '',
      parentIndicatorId: '',
      parentIndicatorName: '',
      taskContent: '',
      type1: '定量',
      name: '',
      remark: '',
      weight: 10,
      targetProgress: 100,
      milestones: []
    }
  }

  const cloneParentMilestonesForForm = (indicator: StrategicIndicator): FormMilestone[] => {
    if (!Array.isArray(indicator.milestones) || indicator.milestones.length === 0) {
      return []
    }

    return indicator.milestones.map((milestone, index) => {
      const rawMilestone = milestone as {
        id?: string | number
        name?: string
        targetProgress?: number | string
        progress?: number | string
        deadline?: string
        expectedDate?: string
      }

      const rawProgress = Number(rawMilestone.targetProgress ?? rawMilestone.progress ?? 0)

      return {
        // 新增子指标时复制父指标里程碑，只继承内容，不复用已有数据库主键。
        id: `copied-ms-${Date.now()}-${index}`,
        name: String(rawMilestone.name || indicator.name || `里程碑 ${index + 1}`),
        targetProgress: Number.isFinite(rawProgress) ? rawProgress : 0,
        deadline: String(rawMilestone.deadline || rawMilestone.expectedDate || '')
      }
    })
  }

  const buildDraftMilestonesFromForm = (
    milestones: FormMilestone[]
  ): StrategicIndicator['milestones'] =>
    milestones.map(m => ({
      id: m.id,
      name: m.name,
      targetProgress: m.targetProgress,
      deadline: m.deadline,
      status: 'pending' as const
    }))

  const buildLocalMilestonesFromForm = (milestones: FormMilestone[]): LocalMilestone[] =>
    milestones.map(m => ({
      id: m.id,
      name: m.name,
      expectedDate: m.deadline,
      progress: m.targetProgress
    }))

  const resolveTargetValueFromMilestones = (
    milestones: Array<
      | FormMilestone
      | LocalMilestone
      | {
          targetProgress?: number | string
          progress?: number | string
        }
    >,
    fallback = 100
  ): number => {
    const lastMilestone = milestones[milestones.length - 1]
    if (!lastMilestone) {
      return fallback
    }

    const rawValue =
      'targetProgress' in lastMilestone
        ? lastMilestone.targetProgress
        : 'progress' in lastMilestone
          ? lastMilestone.progress
          : fallback
    const resolvedValue = Number(rawValue)
    return Number.isFinite(resolvedValue) ? resolvedValue : fallback
  }

  const resolveParentTargetProgress = (indicator: StrategicIndicator): number => {
    const targetValue = Number(indicator.targetValue ?? NaN)
    if (Number.isFinite(targetValue) && targetValue >= 0) {
      return targetValue
    }

    if (Array.isArray(indicator.milestones) && indicator.milestones.length > 0) {
      const lastMilestone = indicator.milestones[indicator.milestones.length - 1] as
        | { targetProgress?: number | string; progress?: number | string }
        | undefined
      const fallbackProgress = Number(
        lastMilestone?.targetProgress ?? lastMilestone?.progress ?? NaN
      )
      if (Number.isFinite(fallbackProgress) && fallbackProgress >= 0) {
        return fallbackProgress
      }
    }

    return 100
  }

  // 选择关联指标
  const selectParentIndicator = (indicator: StrategicIndicator) => {
    const copiedMilestones = cloneParentMilestonesForForm(indicator)
    const resolvedType = getIndicatorTypeLabel(indicator)

    newIndicatorForm.value.parentIndicatorId = indicator.id.toString()
    newIndicatorForm.value.parentIndicatorName = indicator.name
    newIndicatorForm.value.taskContent = indicator.taskContent || ''
    // 继承父指标的名称和说明
    newIndicatorForm.value.name = indicator.name || ''
    newIndicatorForm.value.remark = indicator.remark || ''
    newIndicatorForm.value.weight = Number(indicator.weight ?? 10) || 10
    newIndicatorForm.value.targetProgress = resolveParentTargetProgress(indicator)
    newIndicatorForm.value.type1 = resolvedType
    newIndicatorForm.value.milestones = copiedMilestones
    // 如果父指标没有里程碑，再按原有规则兜底生成
    if (newIndicatorForm.value.type1 === '定量' && newIndicatorForm.value.milestones.length === 0) {
      generateMonthlyMilestonesForForm()
    }
    selectParentDialogVisible.value = false
  }

  const handleParentIndicatorChange = (value: string) => {
    const indicator = plansWithIndicators.value
      .flatMap(task => task.indicators)
      .find(item => item.id.toString() === value)

    if (indicator) {
      selectParentIndicator(indicator)
    }
  }

  // 为表单生成12个月里程碑（定量指标）
  const generateMonthlyMilestonesForForm = () => {
    const currentYear = timeContext.currentYear
    const indicatorName = newIndicatorForm.value.name || '指标完成'
    newIndicatorForm.value.milestones = []

    for (let month = 1; month <= 12; month++) {
      const lastDay = new Date(currentYear, month, 0).getDate()
      const deadline = `${currentYear}-${String(month).padStart(2, '0')}-${lastDay}`
      const progress = Math.round((month / 12) * 100)

      newIndicatorForm.value.milestones.push({
        id: `ms-${Date.now()}-${month}`,
        name: indicatorName,
        targetProgress: progress,
        deadline: deadline
      })
    }
  }

  // 指标类型变更时的处理
  const handleFormIndicatorTypeChange = (newType: '定量' | '定性') => {
    if (newType === '定量') {
      // 定量指标：只有当没有里程碑时才自动生成12个月里程碑
      if (newIndicatorForm.value.milestones.length === 0) {
        generateMonthlyMilestonesForForm()
      }
      // 如果已有里程碑，保留它们不做任何操作
    }
    // 定性指标：保留已有里程碑，让用户手动管理
    // 不再清空里程碑
  }

  // 添加里程碑（表单）
  const addFormMilestone = () => {
    newIndicatorForm.value.milestones.push({
      id: `ms-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: '',
      targetProgress: 0,
      deadline: ''
    })
  }

  // 删除里程碑（表单）
  const removeFormMilestone = (index: number) => {
    newIndicatorForm.value.milestones.splice(index, 1)
  }

  const toMilestoneBatchPayload = (
    milestones: Array<
      | { id?: string | number; name?: string; targetProgress?: number; deadline?: string }
      | { id?: string | number; name?: string; progress?: number; expectedDate?: string }
    >,
    options: {
      includeExistingIds?: boolean
    } = {}
  ) =>
    milestones.map((milestone, index) => {
      const rawId = Number(milestone.id)
      const numericId =
        options.includeExistingIds !== false && Number.isFinite(rawId) && rawId > 0
          ? rawId
          : undefined
      const targetProgress =
        'targetProgress' in milestone
          ? Number(milestone.targetProgress) || 0
          : 'progress' in milestone
            ? Number(milestone.progress) || 0
            : 0
      const dueDate =
        'deadline' in milestone
          ? milestone.deadline || null
          : 'expectedDate' in milestone
            ? milestone.expectedDate || null
            : null

      return {
        ...(numericId ? { id: numericId } : {}),
        milestoneName: String(milestone.name || '').trim() || `里程碑 ${index + 1}`,
        targetProgress,
        dueDate,
        status: 'NOT_STARTED',
        sortOrder: index + 1
      }
    })

  const persistIndicatorMilestones = async (
    indicatorId: number,
    milestones: Array<
      | { id?: string | number; name?: string; targetProgress?: number; deadline?: string }
      | { id?: string | number; name?: string; progress?: number; expectedDate?: string }
    >,
    options: {
      includeExistingIds?: boolean
    } = {}
  ) => {
    if (!Number.isFinite(indicatorId) || indicatorId <= 0 || milestones.length === 0) {
      return
    }

    logger.info(
      `[IndicatorDistributeView] Batch saving ${milestones.length} milestones for indicator ${indicatorId}`
    )

    await milestoneApi.saveMilestonesForIndicator(
      String(indicatorId),
      toMilestoneBatchPayload(milestones, options)
    )
  }

  // 保存新增指标（状态为草稿）- 立即调用后端API创建
  const saveNewIndicator = async () => {
    // 验证数据
    if (!newIndicatorForm.value.parentIndicatorId) {
      ElMessage.warning('请选择关联的核心指标')
      return
    }
    if (!newIndicatorForm.value.name) {
      ElMessage.warning('请填写指标内容')
      return
    }

    if (!selectedCollege.value) {
      ElMessage.warning('请先选择学院')
      return
    }

    const weight = Number(newIndicatorForm.value.weight)
    if (!Number.isFinite(weight) || weight <= 0) {
      ElMessage.warning('请填写大于 0 的权重')
      return
    }

    // 开始保存
    isSavingIndicator.value = true

    try {
      // 获取父指标信息
      const parentIndicator = availableParentIndicators.value.find(
        i => i.id.toString() === newIndicatorForm.value.parentIndicatorId
      )

      if (!parentIndicator) {
        throw new Error('找不到关联的核心指标')
      }

      const indicatorTaskId = Number(getIndicatorTaskId(parentIndicator as StrategicIndicator))
      const parentIndicatorId = Number(newIndicatorForm.value.parentIndicatorId)
      const ownerOrgId = getOrgIdByDeptName(currentDept.value)
      const targetOrgId = getOrgIdByDeptName(selectedCollege.value)

      // 验证必要参数
      if (!Number.isFinite(indicatorTaskId) || indicatorTaskId <= 0) {
        throw new Error('指标缺少有效 taskId')
      }
      if (!ownerOrgId) {
        throw new Error(`无法解析当前部门组织ID: ${currentDept.value}`)
      }
      if (!targetOrgId) {
        throw new Error(`无法解析目标学院组织ID: ${selectedCollege.value}`)
      }

      // 调用后端API创建指标
      const createResp = await indicatorApi.createIndicator({
        taskId: indicatorTaskId,
        indicatorDesc: newIndicatorForm.value.name,
        ownerOrgId,
        targetOrgId,
        weightPercent: weight,
        sortOrder: 0,
        remark: newIndicatorForm.value.remark || '',
        progress: 0,
        cycleId: resolveCurrentCycleId(),
        year: timeContext.currentYear,
        canWithdraw: false,
        parentIndicatorId,
        type: newIndicatorForm.value.type1
      })

      if (!createResp.success || !createResp.data) {
        throw new Error(createResp.message || '创建指标失败')
      }

      // 后端返回的真实ID
      const backendId = createResp.data.id
      if (!backendId) {
        throw new Error('后端返回的数据缺少ID字段')
      }
      const newBackendId = String(backendId)

      // 创建本地指标对象用于前端显示
      const newIndicator: StrategicIndicator = {
        id: newBackendId,
        name: newIndicatorForm.value.name,
        isQualitative: newIndicatorForm.value.type1 === '定性',
        type1: newIndicatorForm.value.type1,
        type2: parentIndicator?.type2 || '发展性',
        progress: 0,
        createTime: new Date().toLocaleDateString('zh-CN'),
        weight,
        remark: newIndicatorForm.value.remark,
        canWithdraw: false,
        taskContent: newIndicatorForm.value.taskContent,
        milestones: buildDraftMilestonesFromForm(newIndicatorForm.value.milestones),
        targetValue:
          newIndicatorForm.value.type1 === '定量'
            ? resolveTargetValueFromMilestones(
                newIndicatorForm.value.milestones,
                newIndicatorForm.value.targetProgress
              )
            : newIndicatorForm.value.milestones.length,
        unit: newIndicatorForm.value.type1 === '定量' ? '%' : '个里程碑',
        responsibleDept: selectedCollege.value!,
        responsiblePerson: '',
        status: 'draft',
        isStrategic: false,
        ownerDept: currentDept.value,
        parentIndicatorId: newIndicatorForm.value.parentIndicatorId,
        year: timeContext.currentYear,
        statusAudit: []
      }
      ;(newIndicator as StrategicIndicator & { taskId?: string }).taskId = String(indicatorTaskId)

      // 添加到前端store
      strategicStore.addDraftIndicator(newIndicator)

      let milestonesPersisted = true
      if (newIndicatorForm.value.milestones.length > 0) {
        try {
          await persistIndicatorMilestones(
            Number(newBackendId),
            newIndicatorForm.value.milestones,
            {
              includeExistingIds: false
            }
          )
        } catch (milestoneError) {
          milestonesPersisted = false
          logger.error(
            '[IndicatorDistributeView] persist new indicator milestones failed:',
            milestoneError
          )
        }
      }

      if (milestonesPersisted) {
        ElMessage.success('已添加指标（草稿状态）')
      } else {
        ElMessage.warning('指标已创建，但里程碑保存失败，请重新编辑里程碑')
      }
      cancelAddIndicator()
      await refreshDistributionData()
    } catch (error: any) {
      logger.error('[IndicatorDistributeView] saveNewIndicator failed:', error)
      ElMessage.error(getApiErrorMessage(error, '保存指标失败，请重试'))
    } finally {
      isSavingIndicator.value = false
    }
  }

  const clearLocalDraftRowsForCollege = (college: string) => {
    Object.entries(newChildIndicators).forEach(([parentId, children]) => {
      const remainingChildren = children.filter(child => !child.college.includes(college))
      if (remainingChildren.length === 0) {
        delete newChildIndicators[parentId]
        return
      }
      newChildIndicators[parentId] = remainingChildren
    })
  }

  const cloneSourceMilestonesForCopy = (
    milestones: StrategicIndicator['milestones'] | undefined,
    fallbackName: string
  ): FormMilestone[] => {
    if (!Array.isArray(milestones) || milestones.length === 0) {
      return []
    }

    return milestones.map((milestone, index) => ({
      id: `copy-ms-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      name: String(milestone.name || fallbackName || `里程碑 ${index + 1}`),
      targetProgress: Number(milestone.targetProgress ?? 0) || 0,
      deadline: String(milestone.deadline || '')
    }))
  }

  const copyIndicatorsFromCollege = async () => {
    const targetCollege = selectedCollege.value
    const sourceCollege = copySourceCollege.value

    if (!targetCollege) {
      ElMessage.warning('请先选择目标学院')
      return
    }
    if (!sourceCollege) {
      ElMessage.warning('请选择来源学院')
      return
    }
    if (!canEditChild.value || currentCollegePlanActionState.value !== 'draft') {
      ElMessage.warning('当前学院计划不处于可复制指标的草稿状态')
      return
    }

    const sourceIndicators = getMyCollegeIndicators(sourceCollege)
    if (sourceIndicators.length === 0) {
      ElMessage.warning('来源学院当前没有可复制的子指标')
      return
    }

    const currentIndicators = getMyCollegeIndicators(targetCollege)
    if (copyClearExisting.value) {
      const blockedIndicator = currentIndicators.find(indicator => !canManageChildDraft(indicator))
      if (blockedIndicator) {
        ElMessage.warning('当前学院存在已进入流程的指标，不能执行清空复制')
        return
      }
    }

    const loading = ElLoading.service({
      lock: true,
      text: '正在复制学院指标...',
      background: 'rgba(0, 0, 0, 0.45)'
    })

    try {
      if (copyClearExisting.value) {
        cancelAddIndicator()
        clearLocalDraftRowsForCollege(targetCollege)
        for (const indicator of currentIndicators) {
          await strategicStore.deleteIndicator(String(indicator.id))
        }
      }

      let copiedCount = 0
      for (const sourceIndicator of sourceIndicators) {
        const parentIndicatorId = Number(sourceIndicator.parentIndicatorId ?? NaN)
        if (!Number.isFinite(parentIndicatorId) || parentIndicatorId <= 0) {
          logger.warn('[IndicatorDistributeView] skip copying indicator without valid parent', {
            sourceIndicatorId: sourceIndicator.id
          })
          continue
        }

        const parentIndicator = availableParentIndicators.value.find(
          indicator => Number(indicator.id) === parentIndicatorId
        )
        const ownerOrgId = getOrgIdByDeptName(currentDept.value)
        const targetOrgId = getOrgIdByDeptName(targetCollege)
        const indicatorTaskId = Number(
          parentIndicator
            ? getIndicatorTaskId(parentIndicator)
            : getIndicatorTaskId(sourceIndicator)
        )

        if (
          !ownerOrgId ||
          !targetOrgId ||
          !Number.isFinite(indicatorTaskId) ||
          indicatorTaskId <= 0
        ) {
          logger.warn('[IndicatorDistributeView] skip copying indicator due to missing context', {
            sourceIndicatorId: sourceIndicator.id,
            ownerOrgId,
            targetOrgId,
            indicatorTaskId
          })
          continue
        }

        const type1 = getIndicatorTypeLabel(sourceIndicator)
        const weight = Number(sourceIndicator.weight ?? 0)
        const targetProgress = resolveParentTargetProgress(sourceIndicator)
        const copiedMilestones = cloneSourceMilestonesForCopy(
          sourceIndicator.milestones,
          sourceIndicator.name || '复制指标'
        )

        const createResp = await indicatorApi.createIndicator({
          taskId: indicatorTaskId,
          indicatorDesc: sourceIndicator.name,
          ownerOrgId,
          targetOrgId,
          weightPercent: Number.isFinite(weight) && weight > 0 ? weight : 10,
          sortOrder: 0,
          remark: sourceIndicator.remark || '',
          progress: 0,
          cycleId: resolveCurrentCycleId(),
          year: timeContext.currentYear,
          canWithdraw: false,
          parentIndicatorId,
          type: type1
        })

        if (!createResp.success || !createResp.data?.id) {
          throw new Error(createResp.message || `复制指标 ${sourceIndicator.name} 失败`)
        }

        if (copiedMilestones.length > 0) {
          await persistIndicatorMilestones(Number(createResp.data.id), copiedMilestones, {
            includeExistingIds: false
          })
        }

        copiedCount += 1
      }

      await refreshDistributionData()
      closeCopyIndicatorsDialog()
      ElMessage.success(
        copyClearExisting.value
          ? `已清空并复制 ${copiedCount} 个子指标`
          : `已复制追加 ${copiedCount} 个子指标`
      )
    } catch (error) {
      logger.error('[IndicatorDistributeView] copyIndicatorsFromCollege failed:', error)
      await refreshDistributionData()
      ElMessage.error(getApiErrorMessage(error, '复制学院指标失败'))
    } finally {
      loading.close()
    }
  }

  // 判断当前学院是否可以新增指标（没有已下发状态的指标）
  const _canAddIndicator = computed(() => {
    if (!selectedCollege.value) {
      return false
    }
    const status = getCollegeStatus(selectedCollege.value)
    return status.distributed === 0 && status.pending === 0 && status.approved === 0
  })

  // ================== 子指标新增相关 ==================

  // 里程碑接口
  // 本地里程碑接口（用于编辑）
  interface LocalMilestone {
    id: string
    name: string
    expectedDate: string
    progress: number // 0-100
  }

  const sortLocalMilestonesByDate = (milestones: LocalMilestone[]): LocalMilestone[] => {
    const toTime = (value: string) => {
      if (!value) {
        return Number.POSITIVE_INFINITY
      }

      const time = new Date(value).getTime()
      return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY
    }

    return [...milestones].sort((a, b) => {
      const dateDiff = toTime(a.expectedDate) - toTime(b.expectedDate)
      if (dateDiff !== 0) {
        return dateDiff
      }

      return Number(a.progress ?? 0) - Number(b.progress ?? 0)
    })
  }

  // 新增子指标的临时存储（按父指标ID分组）
  interface NewChildIndicator {
    id: string
    name: string
    college: string[] // 改为数组支持多选
    targetValue: number
    unit: string
    weight: number
    remark: string
    type1: '定量' | '定性' // 指标类型
    targetProgress: number // 定量指标目标进度 0-100
    milestones: LocalMilestone[] // 定性指标里程碑列表
    isNew: boolean // 标记是否为新增的未保存行
  }

  // 导出供模板使用
  type _NewChild = NewChildIndicator

  const newChildIndicators = reactive<Record<string, NewChildIndicator[]>>({})

  // 正在添加子指标的父指标ID
  const addingParentId = ref<string | null>(null)

  // 当前正在编辑的新增子指标ID（用于点击外部保存）
  const editingNewChildId = ref<string | null>(null)

  // 验证并保存新增子指标（点击外部时调用）
  const validateAndSaveNewChild = (parentId: string, childId: string) => {
    const children = newChildIndicators[parentId]
    if (!children) {
      return
    }

    const childIndex = children.findIndex(c => c.id === childId)
    if (childIndex === -1) {
      return
    }

    const child = children[childIndex]
    if (!child) {
      return
    }

    // 如果名称和学院都为空，删除该行
    if (!child.name && (!child.college || child.college.length === 0)) {
      children.splice(childIndex, 1)
      if (children.length === 0) {
        delete newChildIndicators[parentId]
      }
      editingNewChildId.value = null
      return
    }

    // 数据有效，保持该行，退出编辑状态
    editingNewChildId.value = null
  }

  // 点击新增子指标行时进入编辑状态
  const handleNewChildRowClick = (childId: string, parentId: string) => {
    editingNewChildId.value = childId
    addingParentId.value = parentId
  }

  // 添加新的子指标行
  const _addNewChildRow = (parentIndicatorId: string) => {
    if (!canEditChild.value) {
      ElMessage.warning('您没有权限添加子指标')
      return
    }

    // 如果有正在编辑的新增子指标，先保存它
    if (editingNewChildId.value && addingParentId.value) {
      validateAndSaveNewChild(addingParentId.value, editingNewChildId.value)
    }

    // 获取父指标信息
    const parentIndicator = collegeIndicators.value.find(i => i.id.toString() === parentIndicatorId)
    const resolvedType =
      parentIndicator?.type1 || (parentIndicator?.isQualitative ? '定性' : '定量') || '定性'
    const copiedMilestones = parentIndicator ? cloneParentMilestonesForForm(parentIndicator) : []

    if (!newChildIndicators[parentIndicatorId]) {
      newChildIndicators[parentIndicatorId] = []
    }

    const newChildId = `new-${Date.now()}`

    // 自动设置当前选中的学院
    const defaultCollege = selectedCollege.value ? [selectedCollege.value] : []

    newChildIndicators[parentIndicatorId].push({
      id: newChildId,
      name: parentIndicator?.name || '', // 继承父指标名称
      college: defaultCollege,
      targetValue:
        resolvedType === '定量'
          ? resolveTargetValueFromMilestones(
              copiedMilestones,
              parentIndicator ? resolveParentTargetProgress(parentIndicator) : 100
            )
          : copiedMilestones.length,
      unit: resolvedType === '定量' ? '%' : '个里程碑',
      weight: Number(parentIndicator?.weight ?? 10) || 10,
      remark: parentIndicator?.remark || '', // 继承父指标备注
      type1: resolvedType,
      targetProgress:
        resolvedType === '定量'
          ? resolveTargetValueFromMilestones(
              copiedMilestones,
              parentIndicator ? resolveParentTargetProgress(parentIndicator) : 100
            )
          : 0,
      milestones: buildLocalMilestonesFromForm(copiedMilestones),
      isNew: true
    })

    addingParentId.value = parentIndicatorId
    editingNewChildId.value = newChildId // 设置当前编辑的新增子指标
  }

  // 删除临时子指标行
  const removeNewChildRow = (parentId: string, index: number) => {
    if (newChildIndicators[parentId]) {
      newChildIndicators[parentId].splice(index, 1)
      if (newChildIndicators[parentId].length === 0) {
        delete newChildIndicators[parentId]
      }
    }
  }

  // 删除已有子指标
  const removeChildIndicator = async (child: StrategicIndicator) => {
    if (deletingChildId.value === String(child.id)) {
      return
    }

    if (!canManageChildDraft(child)) {
      ElMessage.warning('当前学院指标需按批量流程统一管理，请先批量撤回后再删除')
      return
    }

    try {
      await ElMessageBox.confirm(`确认删除子指标"${child.name}"？此操作不可恢复。`, '删除确认', {
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
        type: 'warning'
      })
    } catch {
      return
    }

    try {
      deletingChildId.value = String(child.id)
      cancelChildEdit()
      await strategicStore.deleteIndicator(String(child.id))

      await refreshDistributionData()
      const stillExists = strategicStore.indicators.some(
        indicator => String(indicator.id) === String(child.id)
      )

      if (stillExists) {
        throw new Error('删除请求已提交，但刷新后该指标仍存在，请稍后重试')
      }

      ElMessage.success('已删除子指标')
    } catch (error) {
      await refreshDistributionData()
      const stillExists = strategicStore.indicators.some(
        indicator => String(indicator.id) === String(child.id)
      )
      if (!stillExists) {
        ElMessage.success('已删除子指标')
        return
      }

      logger.error('[IndicatorDistributeView] 删除子指标失败:', {
        indicatorId: child.id,
        error
      })
      ElMessage.error(error instanceof Error ? error.message : '删除失败，请稍后重试')
    } finally {
      if (deletingChildId.value === String(child.id)) {
        deletingChildId.value = null
      }
    }
  }

  // 获取所有待下发的子指标数量
  const _getPendingChildCount = (parentId: string) => {
    return (newChildIndicators[parentId] || []).length
  }

  // 下发所有新增的子指标
  const _distributeNewChildren = (parentIndicator: StrategicIndicator) => {
    const parentId = parentIndicator.id.toString()
    const parentTaskId = getIndicatorTaskId(parentIndicator)
    const children = newChildIndicators[parentId] || []

    if (children.length === 0) {
      ElMessage.warning('没有待下发的子指标')
      return
    }

    // 验证所有子指标数据
    for (const child of children) {
      if (!child.name) {
        ElMessage.warning('请填写子指标名称')
        return
      }
      if (!child.college || child.college.length === 0) {
        ElMessage.warning('请选择下发学院')
        return
      }
    }

    ElMessageBox.confirm(
      `确认发起下发审批，将 ${children.length} 个子指标下发到对应学院？`,
      '发起下发审批确认',
      {
        confirmButtonText: '确认发起',
        cancelButtonText: '取消',
        type: 'info'
      }
    ).then(() => {
      // 创建子指标
      children.forEach(child => {
        const newIndicator: StrategicIndicator = {
          id: `${Date.now()}-${child.college}-${Math.random().toString(36).substr(2, 9)}`,
          name: child.name,
          isQualitative: child.type1 === '定性',
          type1: child.type1,
          type2: parentIndicator.type2,
          progress: 0,
          createTime: new Date().toLocaleDateString('zh-CN'),
          weight: child.weight,
          remark: child.remark,
          canWithdraw: false,
          taskContent: parentIndicator.taskContent,
          milestones: child.milestones.map(m => ({
            id: m.id,
            name: m.name,
            targetProgress: m.progress,
            deadline: m.expectedDate,
            status: 'pending' as const
          })),
          targetValue:
            child.type1 === '定量'
              ? resolveTargetValueFromMilestones(child.milestones, child.targetProgress)
              : child.milestones.length,
          unit: child.type1 === '定量' ? '%' : '个里程碑',
          responsibleDept: Array.isArray(child.college) ? child.college.join(',') : child.college,
          responsiblePerson: '',
          status: 'draft',
          isStrategic: false,
          ownerDept: currentDept.value,
          parentIndicatorId: parentId,
          year: timeContext.currentYear,
          statusAudit: [] // 默认为空，状态为草稿
        }
        ;(newIndicator as StrategicIndicator & { taskId?: string }).taskId = parentTaskId
        // Step1: 只保存到前端临时状态，不调用后端
        strategicStore.addDraftIndicator(newIndicator)
      })

      // 清空临时数据
      delete newChildIndicators[parentId]
      addingParentId.value = null

      ElMessage.success(`已成功添加 ${children.length} 个子指标，请点击“发起下发审批”按钮继续操作`)
    })
  }

  // ================== 子指标编辑相关 ==================

  // 当前编辑的子指标
  const editingChildId = ref<string | null>(null)
  const editingChildField = ref<string | null>(null)
  const editingChildValue = ref<Record<string, unknown> | null>(null)
  const savingChildId = ref<string | null>(null)
  const savingChildField = ref<string | null>(null)

  // 学院下拉菜单是否打开
  const collegeDropdownVisible = ref(false)
  // 是否正在与学院选择器交互（点击 select 或其 dropdown）
  const isInteractingWithCollegeSelect = ref(false)

  // 全局 mousedown 监听器
  const handleGlobalMousedown = (e: MouseEvent) => {
    const target = e.target as HTMLElement
    // 检查是否点击了编辑中的 select 或其 dropdown
    const isInSelect = !!target.closest('.college-select-editing')
    const isInDropdown = !!target.closest('.el-select-dropdown')
    isInteractingWithCollegeSelect.value = isInSelect || isInDropdown

    if (isAddingIndicator.value) {
      const clickedInsideAddForm = !!addRowFormRef.value && addRowFormRef.value.contains(target)
      const clickedInsidePopup =
        !!target.closest('.el-popper') ||
        !!target.closest('.el-select-dropdown') ||
        !!target.closest('.el-picker__popper')

      if (!clickedInsideAddForm && !clickedInsidePopup) {
        cancelAddIndicator()
        return
      }
    }

    // 处理新增子指标行的点击外部保存
    if (editingNewChildId.value && addingParentId.value) {
      // 检查是否点击在新增子指标行内
      const isInNewChildRow = !!target.closest('.new-child-row')
      // 检查是否点击在下拉菜单内
      const isInPopper = !!target.closest('.el-popper') || !!target.closest('.el-select-dropdown')

      if (!isInNewChildRow && !isInPopper) {
        // 点击在新增行外部，保存并退出编辑
        validateAndSaveNewChild(addingParentId.value, editingNewChildId.value)
      }
    }
  }

  onMounted(() => {
    document.addEventListener('mousedown', handleGlobalMousedown, true)
    pageBootstrapPromise.value = (async () => {
      await orgStore.loadDepartments()
      await refreshDistributionData()
    })().finally(() => {
      pageBootstrapPromise.value = null
    })
    if (typeof window !== 'undefined') {
      window.addEventListener(
        GLOBAL_DATA_REFRESH_REQUEST_EVENT,
        handleGlobalDataRefreshRequest as EventListener
      )
    }
  })

  onBeforeUnmount(() => {
    document.removeEventListener('mousedown', handleGlobalMousedown, true)
    if (typeof window !== 'undefined') {
      window.removeEventListener(
        GLOBAL_DATA_REFRESH_REQUEST_EVENT,
        handleGlobalDataRefreshRequest as EventListener
      )
    }
  })

  const handleGlobalDataRefreshRequest = (event: Event) => {
    if (globalDataRefreshPromise) {
      return
    }

    const detail = (event as CustomEvent<GlobalDataRefreshDetail>).detail
    globalDataRefreshPromise = (async () => {
      logger.info('[IndicatorDistributeView] handling global data refresh request', detail)
      await waitForPageBootstrap()
      await refreshDistributionData()
    })().finally(() => {
      globalDataRefreshPromise = null
    })
  }

  watch(
    () => [currentDept.value, timeContext.currentYear, currentDepartmentPlan.value?.id],
    () => {
      void (async () => {
        await waitForPageBootstrap()
        await loadCurrentDepartmentPlanDetails()
      })()
    },
    { immediate: true }
  )

  watch(
    () => [
      selectedCollege.value,
      currentSelectedCollegePlanDetails.value?.id,
      currentSelectedCollegePlan.value?.id
    ],
    () => {
      void (async () => {
        await waitForPageBootstrap()
        await loadCurrentSelectedCollegePlanDetails()
        await loadCurrentCollegePlanReportSummary()
      })()
    },
    { immediate: true }
  )

  // 双击编辑子指标
  const handleChildDblClick = (child: StrategicIndicator, field: string) => {
    if (!canEditChild.value) {
      return
    }

    if (isDeletingChild(child)) {
      return
    }

    if (savingChildId.value === child.id.toString()) {
      return
    }

    // 检查状态：只有草稿状态才能编辑
    if (!canManageChildDraft(child)) {
      ElMessage.warning('当前学院指标需按批量流程统一管理，请先批量撤回后再编辑')
      return
    }

    editingChildId.value = child.id.toString()
    editingChildField.value = field

    // 如果编辑学院字段，需要将字符串解析为数组
    if (field === 'responsibleDept') {
      editingChildValue.value = parseColleges(child.responsibleDept)
    } else {
      editingChildValue.value = child[field as keyof StrategicIndicator]
    }

    // 自动聚焦到编辑元素
    nextTick(() => {
      const editingEl = document.querySelector('.editing-field') as HTMLElement
      if (editingEl) {
        // 处理不同类型的输入元素
        const input = editingEl.querySelector('input, textarea') as
          | HTMLInputElement
          | HTMLTextAreaElement
        if (input) {
          input.focus()
          // 如果是文本输入框，选中所有文本
          if (input.select) {
            input.select()
          }
        }
      }
    })
  }

  const isSavingChildCell = (child: StrategicIndicator | undefined, field: string) => {
    if (!child) {
      return false
    }

    return savingChildId.value === child.id.toString() && savingChildField.value === field
  }

  const isDeletingChild = (child: StrategicIndicator | undefined) => {
    if (!child) {
      return false
    }

    return deletingChildId.value === child.id.toString()
  }

  // 保存子指标编辑
  const saveChildEdit = async (child: StrategicIndicator, field: string) => {
    if (editingChildId.value === null) {
      return
    }

    if (!canEditChild.value) {
      cancelChildEdit()
      ElMessage.warning('当前计划已进入审批或下发流程，暂不允许编辑子指标')
      return
    }

    if (!canManageChildDraft(child)) {
      cancelChildEdit()
      ElMessage.warning('当前学院指标需按批量流程统一管理，请先批量撤回后再编辑')
      return
    }

    let valueToSave = editingChildValue.value

    // 如果是学院字段，需要验证至少有一个学院
    if (field === 'responsibleDept') {
      if (!Array.isArray(valueToSave) || valueToSave.length === 0) {
        ElMessage.warning('至少选择一个学院')
        return
      }
      // 将数组转换为逗号分隔的字符串
      valueToSave = valueToSave.join(',')
    }

    // 如果是进度字段，需要验证范围
    if (field === 'progress') {
      const progressValue = Number(valueToSave)
      if (isNaN(progressValue) || progressValue < 0 || progressValue > 100) {
        ElMessage.warning('进度必须在0-100之间')
        return
      }
      valueToSave = progressValue
    }

    const updates = {
      [field]: valueToSave
    } as Record<string, unknown>

    savingChildId.value = child.id.toString()
    savingChildField.value = field
    cancelChildEdit()

    try {
      await strategicStore.updateIndicator(child.id.toString(), updates)
      await refreshDistributionData()
    } catch (error) {
      logger.error('[IndicatorDistributeView] 保存子指标编辑失败:', {
        indicatorId: child.id,
        field,
        error
      })
      ElMessage.error(error instanceof Error ? error.message : '保存失败，请稍后重试')
    } finally {
      savingChildId.value = null
      savingChildField.value = null
    }
  }

  // 学院选择器下拉框可见性变化
  const _handleCollegeSelectClose = (visible: boolean) => {
    collegeDropdownVisible.value = visible
  }

  // 学院选择器失焦处理
  const _handleCollegeSelectBlur = (child: StrategicIndicator) => {
    // 延迟检查，确保 mousedown 事件先处理完成
    setTimeout(() => {
      // 如果正在与 select 或 dropdown 交互，不保存
      if (isInteractingWithCollegeSelect.value) {
        isInteractingWithCollegeSelect.value = false
        return
      }
      // 如果下拉菜单还开着，不保存
      if (collegeDropdownVisible.value) {
        return
      }
      // 确认当前仍在编辑学院字段
      if (
        editingChildId.value === child.id.toString() &&
        editingChildField.value === 'responsibleDept'
      ) {
        saveChildEdit(child, 'responsibleDept')
      }
    }, 100)
  }

  // 取消子指标编辑
  const cancelChildEdit = () => {
    editingChildId.value = null
    editingChildField.value = null
    editingChildValue.value = null
  }

  // ================== 审批相关 ==================

  // 辅助函数：获取当前部门下发给指定学院的子指标
  const getMyCollegeIndicators = (college: string) => {
    return strategicStore.indicators.filter(i => {
      if (i.isStrategic) {
        return false
      }
      if (i.ownerDept !== currentDept.value) {
        return false
      }
      if (Array.isArray(i.responsibleDept)) {
        return i.responsibleDept.includes(college)
      }
      return i.responsibleDept === college
    })
  }

  const resolveIndicatorTaskType = (indicator: StrategicIndicator): string => {
    const directType = String(indicator.type2 || '').trim()
    if (directType) {
      return directType
    }

    const parentIndicatorId = String(indicator.parentIndicatorId || '').trim()
    if (!parentIndicatorId) {
      return ''
    }

    const parentIndicator = availableParentIndicators.value.find(
      item => String(item.id) === parentIndicatorId
    )
    return String(parentIndicator?.type2 || '').trim()
  }

  const isBasicTaskIndicator = (indicator: StrategicIndicator): boolean =>
    resolveIndicatorTaskType(indicator) === '基础性'

  // 进度审批已统一迁移到真实工作流待办抽屉，避免前端直接改写审批状态。

  // 批量撤回：仅允许撤回仍处于 pending 边界的子指标，和上级下发流程保持一致。
  const handleBatchWithdraw = async (college: string) => {
    if (!canWithdrawCurrentCollegePlan.value) {
      ElMessage.warning('当前计划不处于可撤回状态')
      return
    }

    const childIndicators = getMyCollegeIndicators(college)
    const withdrawableIndicators = childIndicators

    // 分离出真实后端ID的指标和临时ID的指标
    const realBackendIndicators = withdrawableIndicators.filter(i => /^\d+$/.test(i.id.toString()))
    const tempIdIndicators = withdrawableIndicators.filter(i => !/^\d+$/.test(i.id.toString()))

    if (withdrawableIndicators.length === 0) {
      ElMessage.warning('当前没有可撤回的子指标')
      return
    }

    try {
      await ElMessageBox.confirm(
        `确认撤回【${college}】的 ${withdrawableIndicators.length} 个子指标？撤回后将恢复到可编辑状态。`,
        '批量撤回确认',
        {
          confirmButtonText: '确认撤回',
          cancelButtonText: '取消',
          type: 'warning'
        }
      )
    } catch {
      return
    }

    const errors: string[] = []

    // 如果有真实后端ID的指标，使用批量撤回API
    if (realBackendIndicators.length > 0) {
      try {
        const ownerOrgId = getOrgIdByDeptName(currentDept.value)
        const targetOrgId = getOrgIdByDeptName(college)
        const planId = Number(currentActiveCollegePlan.value?.id ?? NaN)

        if (!ownerOrgId) {
          throw new Error(`无法解析当前部门组织ID: ${currentDept.value}`)
        }
        if (!targetOrgId) {
          throw new Error(`无法解析目标学院组织ID: ${college}`)
        }
        if (!Number.isFinite(planId) || planId <= 0) {
          throw new Error('无法识别当前部门计划，不能执行批量撤回')
        }

        applyLocalCollegePlanReportSummaryPatch('withdrawn')

        const result = await indicatorApi.batchWithdrawIndicators(
          ownerOrgId,
          targetOrgId,
          planId,
          '批量撤销下发'
        )

        if (result.success && result.data) {
          const {
            successCount,
            failedCount,
            withdrawnIndicatorIds,
            errors: batchErrors
          } = result.data

          // 更新前端状态
          for (const indicatorId of withdrawnIndicatorIds) {
            strategicStore.addStatusAuditEntry(indicatorId.toString(), {
              operator: authStore.user?.userId || 'admin',
              operatorName: authStore.user?.name || '管理员',
              operatorDept: currentDept.value,
              action: 'withdraw',
              comment: '批量撤销下发'
            })
            await strategicStore.updateIndicator(indicatorId.toString(), {
              status: 'draft',
              canWithdraw: true
            })
          }

          if (failedCount > 0 && batchErrors?.length > 0) {
            errors.push(...batchErrors)
          }

          if (failedCount === 0) {
            ElMessage.success(`已成功撤销 ${successCount} 个指标`)
          } else {
            ElMessage.warning(`成功撤销 ${successCount} 个指标，失败 ${failedCount} 个`)
          }
        } else {
          ElMessage.error(result.message || '批量撤回失败')
        }
      } catch (err: any) {
        ElMessage.error(`批量撤回失败: ${err.message || err}`)
      }
    }

    // 临时 ID 不应进入可撤回集合，这里仅兜底兼容旧本地状态数据。
    for (const indicator of tempIdIndicators) {
      try {
        strategicStore.addStatusAuditEntry(indicator.id.toString(), {
          operator: authStore.user?.userId || 'admin',
          operatorName: authStore.user?.name || '管理员',
          operatorDept: currentDept.value,
          action: 'withdraw',
          comment: '批量撤回下发'
        })
        strategicStore.patchIndicator(indicator.id.toString(), {
          status: 'draft',
          canWithdraw: true
        })
      } catch (err) {
        errors.push(indicator.name)
      }
    }

    if (errors.length > 0 && realBackendIndicators.length === 0) {
      ElMessage.error(`以下指标撤销失败：${errors.join('、')}`)
    }

    await refreshDistributionData()
  }

  const toBatchDistributionMilestones = (indicator: StrategicIndicator) =>
    sortMilestonesByProgress(indicator.milestones || []).map((milestone, index) => ({
      milestoneName: milestone.name,
      description: undefined,
      dueDate: milestone.deadline || undefined,
      targetProgress: Number(milestone.targetProgress || 0),
      sortOrder: index + 1
    }))

  // 下发：针对学院下所有草稿状态的子指标
  const handleBatchDistribute = async (college: string) => {
    if (isBatchDistributing.value) {
      return
    }

    if (!canCurrentUserSubmitCurrentDepartmentDistribution.value) {
      ElMessage.warning('只有当前部门组织下的填报人才可以下发')
      return
    }

    if (!canEditCurrentCollegePlan.value) {
      ElMessage.warning('当前计划审批中，暂不能继续下发')
      return
    }

    const childIndicators = getMyCollegeIndicators(college)
    const basicTaskIndicators = childIndicators.filter(isBasicTaskIndicator)
    const basicTaskWeightTotal = basicTaskIndicators.reduce(
      (sum, indicator) => sum + Number(indicator.weight || 0),
      0
    )

    if (basicTaskWeightTotal !== 100) {
      ElMessage.warning('仅当基础性任务下子指标权重合计恰好为 100 时，才可以下发')
      return
    }

    const draftIndicators = childIndicators.filter(
      i => getChildLifecycleStatus(i as StrategicIndicator) === 'draft'
    )
    const planId = Number(currentActiveCollegePlan.value?.id ?? NaN)

    if (draftIndicators.length === 0) {
      if (childIndicators.length === 0) {
        ElMessage.warning('没有可下发的子指标')
        return
      }

      try {
        isBatchDistributing.value = true
        await planStore.submitPlanForApproval(planId, {
          workflowCode: currentDispatchWorkflowCode.value
        })
        applyLocalCollegePlanPatch({
          status: 'PENDING' as Plan['status'],
          workflowStatus: 'IN_REVIEW',
          canWithdraw: true,
          currentStepName: '审批中'
        })
        applyLocalCollegePlanReportSummaryPatch('submitted')
        await refreshDistributionData()
        ElMessage.success('已发起下发审批')
      } catch (error) {
        logger.error('[IndicatorDistributeView] submit distribution approval failed:', error)
        ElMessage.error(error instanceof Error ? error.message : '发起下发审批失败')
      } finally {
        isBatchDistributing.value = false
      }
      return
    }

    try {
      await ElMessageBox.confirm(
        `确认发起下发审批，将【${college}】的 ${draftIndicators.length} 个子指标下发？`,
        '发起下发审批确认',
        {
          confirmButtonText: '确认发起',
          cancelButtonText: '取消',
          type: 'success'
        }
      )
    } catch {
      return
    }

    const ownerOrgId = getOrgIdByDeptName(currentDept.value)
    const targetOrgId = getOrgIdByDeptName(college)

    if (!ownerOrgId || !targetOrgId) {
      ElMessage.error(`无法解析组织ID，owner=${currentDept.value}, target=${college}`)
      return
    }
    if (!Number.isFinite(planId) || planId <= 0) {
      ElMessage.error('无法识别当前学院计划，不能发起下发审批')
      return
    }

    let loadingInstance: ReturnType<typeof ElLoading.service> | null = null

    try {
      isBatchDistributing.value = true
      loadingInstance = ElLoading.service({
        lock: true,
        text: '正在下发指标并刷新状态，请稍候...',
        background: 'rgba(0, 0, 0, 0.45)'
      })

      const response = await indicatorApi.batchDistributePageIndicators({
        indicators: draftIndicators.map((indicator, index) => {
          const indicatorId = indicator.id.toString()
          const isRealBackendId = /^\d+$/.test(indicatorId)
          const indicatorTaskId = Number(getIndicatorTaskId(indicator as StrategicIndicator))

          if (!isRealBackendId && (!Number.isFinite(indicatorTaskId) || indicatorTaskId <= 0)) {
            throw new Error(`指标缺少有效 taskId，无法挂载到同一计划: ${indicator.name}`)
          }

          return {
            clientRequestId: indicatorId,
            indicatorId: isRealBackendId ? Number(indicatorId) : undefined,
            indicatorDesc: isRealBackendId ? undefined : indicator.name,
            type: getIndicatorTypeLabel(indicator),
            indicatorType: getIndicatorTypeLabel(indicator),
            type1: getIndicatorTypeLabel(indicator),
            taskId: isRealBackendId ? undefined : indicatorTaskId,
            parentIndicatorId:
              !isRealBackendId && indicator.parentIndicatorId
                ? Number(indicator.parentIndicatorId)
                : undefined,
            ownerOrgId: isRealBackendId ? undefined : ownerOrgId,
            targetOrgId,
            weightPercent: isRealBackendId ? undefined : Number(indicator.weight || 0),
            sortOrder: index + 1,
            remark: isRealBackendId ? undefined : indicator.remark || '',
            progress: isRealBackendId ? undefined : Number(indicator.progress || 0),
            customDesc: indicator.name,
            milestones: isRealBackendId ? [] : toBatchDistributionMilestones(indicator)
          }
        })
      })

      if (!response.success || !response.data) {
        throw new Error(response.message || '下发失败')
      }

      response.data.items.forEach(item => {
        const clientRequestId = String(item.clientRequestId || '')
        const backendId = String(item.indicatorId || '')
        if (!clientRequestId || !backendId) {
          return
        }

        if (clientRequestId !== backendId) {
          strategicStore.replaceIndicatorId(clientRequestId, backendId)
        }

        strategicStore.addStatusAuditEntry(backendId, {
          operator: authStore.user?.userId || 'admin',
          operatorName: authStore.user?.name || '管理员',
          operatorDept: currentDept.value,
          action: 'distribute',
          comment: '下发'
        })
        strategicStore.patchIndicator(backendId, {
          status: 'distributed',
          canWithdraw: false
        })
      })

      await planStore.submitPlanForApproval(planId, {
        workflowCode: currentDispatchWorkflowCode.value
      })
      applyLocalCollegePlanPatch({
        status: 'PENDING' as Plan['status'],
        workflowStatus: 'IN_REVIEW',
        canWithdraw: true,
        currentStepName: '审批中'
      })
      applyLocalCollegePlanReportSummaryPatch('submitted')
      await refreshDistributionData()
      ElMessage.success(`已成功下发并发起审批 ${response.data.totalCount} 个指标`)
    } catch (error) {
      logger.error('[IndicatorDistributeView] batch distribute failed:', error)
      ElMessage.error(error instanceof Error ? error.message : '下发失败，请重试')
    } finally {
      loadingInstance?.close()
      isBatchDistributing.value = false
    }
  }

  // 获取学院下子指标的统一状态（用于判断显示哪些批量操作按钮，只统计当前部门下发的）
  const getCollegeStatus = (college: string) => {
    // 只统计当前部门下发给该学院的指标
    const childIndicators = strategicStore.indicators.filter(i => {
      if (i.isStrategic) {
        return false
      }
      if (i.ownerDept !== currentDept.value) {
        return false
      }
      if (Array.isArray(i.responsibleDept)) {
        return i.responsibleDept.includes(college)
      }
      return i.responsibleDept === college
    })
    if (childIndicators.length === 0) {
      return { draft: 0, distributed: 0, pending: 0, approved: 0 }
    }

    // 统计各状态数量
    const statusCounts = {
      draft: 0,
      distributed: 0,
      pending: 0,
      approved: 0
    }

    childIndicators.forEach(i => {
      const status = getChildStatus(i as StrategicIndicator) as keyof typeof statusCounts
      if (status in statusCounts) {
        statusCounts[status]++
      }
    })

    return statusCounts
  }

  // 计算当前选中学院的整体状态（用于表头显示）
  // 统一对齐 /strategic-tasks：
  // 直接映射 plan.status，不再把 DRAFT 二次包装成“待下发”。
  const collegeOverallStatus = computed(() => {
    if (!selectedCollege.value) {
      return { label: '暂无指标', type: 'info' }
    }

    const status = getCollegeStatus(selectedCollege.value)
    const total = status.draft + status.distributed + status.pending + status.approved
    if (currentCollegePlanActionState.value === 'draft') {
      return { label: '草稿', type: 'info' }
    }

    if (currentCollegePlanActionState.value === 'distributed') {
      return { label: '已下发', type: 'success' }
    }

    if (currentCollegePlanActionState.value.startsWith('pending')) {
      return { label: '审批中', type: 'warning' }
    }

    if (total === 0) {
      return { label: '暂无指标', type: 'info' }
    }

    // plan 状态缺失时，再退回到内容态兜底。
    if (status.pending > 0) {
      return { label: '审批中', type: 'warning' }
    }
    if (status.draft > 0) {
      return { label: '草稿', type: 'info' }
    }
    if (status.distributed > 0 || status.approved > 0) {
      return { label: '已下发', type: 'success' }
    }

    return { label: '暂无指标', type: 'info' }
  })

  const currentCollegePlanStatusMeta = computed(() => {
    if (!selectedCollege.value) {
      return { label: '暂无指标', type: 'info' as const }
    }

    if (currentActiveCollegePlan.value) {
      return getPlanStatusDisplay(
        currentActiveCollegePlan.value.status || currentActiveCollegePlan.value.workflowStatus
      )
    }

    const planStatus = normalizedSelectedCollegePlanStatus.value
    if (planStatus) {
      return getPlanStatusDisplay(planStatus)
    }

    return collegeOverallStatus.value
  })

  // 计算当前选中学院基础性任务下子指标的总权重
  const collegeTotalWeight = computed(() => {
    if (!selectedCollege.value) {
      return 0
    }

    return getMyCollegeIndicators(selectedCollege.value)
      .filter(isBasicTaskIndicator)
      .reduce((sum, indicator) => sum + Number(indicator.weight || 0), 0)
  })

  // 下发/撤销统一处理函数
  const _handleDistributeOrWithdraw = (command: string) => {
    if (!selectedCollege.value) {
      return
    }

    if (command === 'distribute') {
      handleBatchDistribute(selectedCollege.value)
    } else if (command === 'withdraw') {
      handleBatchWithdraw(selectedCollege.value)
    }
  }

  // 单条指标进度审批也统一由工作流待办处理。

  const getSortedMilestones = (milestones?: StrategicIndicator['milestones']) =>
    sortMilestonesByProgress(milestones || [])

  const normalizeMilestonesForDetail = (
    milestones: Array<Record<string, unknown>>
  ): StrategicIndicator['milestones'] =>
    milestones.map((milestone, index) => {
      const rawTargetProgress = Number(
        milestone.targetProgress ?? milestone.progress ?? milestone.weightPercent ?? 0
      )

      return {
        id: String(
          milestone.id ?? milestone.milestoneId ?? milestone.indicatorId ?? `milestone-${index + 1}`
        ),
        name: String(milestone.name ?? milestone.milestoneName ?? `里程碑 ${index + 1}`),
        targetProgress: Number.isFinite(rawTargetProgress) ? rawTargetProgress : 0,
        deadline: String(milestone.deadline ?? milestone.dueDate ?? milestone.expectedDate ?? ''),
        status: 'pending' as const
      }
    })

  // 查看详情
  const handleViewDetail = async (indicator: StrategicIndicator) => {
    const indicatorId = String(indicator.id ?? '').trim()
    const persistedIndicator = indicatorId
      ? strategicStore.indicators.find(item => String(item.id) === indicatorId)
      : null

    const detailIndicator: StrategicIndicator = {
      ...(persistedIndicator || indicator),
      ...indicator,
      milestones: indicator.milestones?.length
        ? indicator.milestones
        : (persistedIndicator?.milestones ?? [])
    }

    currentDetailIndicator.value = detailIndicator
    detailDrawerVisible.value = true

    if (!indicatorId || !/^\d+$/.test(indicatorId) || detailIndicator.milestones?.length) {
      return
    }

    try {
      const response = await milestoneApi.getMilestonesByIndicator(indicatorId)
      if (!response?.success || !Array.isArray(response.data) || response.data.length === 0) {
        return
      }

      const normalizedMilestones = normalizeMilestonesForDetail(
        response.data as Array<Record<string, unknown>>
      )

      currentDetailIndicator.value = {
        ...detailIndicator,
        milestones: normalizedMilestones
      }
    } catch (error) {
      logger.warn('[IndicatorDistributeView] 加载指标详情里程碑失败:', {
        indicatorId,
        error
      })
    }
  }

  const resolveSelectedCollegePlanDrivenChildStatus = (
    child: StrategicIndicator
  ): 'draft' | 'distributed' | 'pending' | 'approved' | null => {
    if (!selectedCollege.value) {
      return null
    }

    const belongsToSelectedCollege = Array.isArray(child.responsibleDept)
      ? child.responsibleDept.includes(selectedCollege.value)
      : child.responsibleDept === selectedCollege.value

    if (!belongsToSelectedCollege) {
      return null
    }

    switch (normalizedSelectedCollegePlanStatus.value) {
      case 'DRAFT':
      case 'RETURNED':
        return 'draft'
      case 'PENDING':
        return 'pending'
      case 'DISTRIBUTED':
        return 'distributed'
      default:
        return null
    }
  }

  // 获取子指标状态
  // 状态流转：draft(草稿) → distributed(已下发) → pending(待审批，下级提交后) → approved(已通过)
  // 打回后回到 distributed 状态，撤销后回到 draft 状态
  // 注意：这里的 pending 状态是指进度审批待审批（progressApprovalStatus），不是指标定义审核（lifecycle status 的 PENDING_REVIEW）
  // Legacy ACTIVE status is treated as equivalent to DISTRIBUTED
  const getChildStatus = (child: StrategicIndicator) => {
    const planDrivenStatus = resolveSelectedCollegePlanDrivenChildStatus(child)
    if (planDrivenStatus) {
      return planDrivenStatus
    }

    const normalizedStatus = String(child.status || '').toUpperCase()
    const statusMap: Record<string, string> = {
      DRAFT: 'draft',
      PENDING: 'pending',
      PENDING_REVIEW: 'pending',
      DISTRIBUTED: 'distributed',
      ACTIVE: 'distributed',
      APPROVED: 'approved',
      REJECTED: 'distributed'
    }
    if (normalizedStatus) {
      return statusMap[normalizedStatus] ?? 'draft'
    }

    // fallback：兼容本地 statusAudit 推导
    const audit = child.statusAudit || []
    if (audit.length === 0) {
      return 'draft'
    }
    const lastAudit = audit[audit.length - 1]
    if (!lastAudit) {
      return 'draft'
    }
    const lastAction = lastAudit.action
    if (lastAction === 'submit') {
      return 'pending'
    }
    if (lastAction === 'approve') {
      return 'approved'
    }
    if (lastAction === 'reject') {
      return 'distributed'
    }
    if (lastAction === 'distribute') {
      return 'distributed'
    }
    if (lastAction === 'withdraw') {
      return 'draft'
    }
    return 'draft'
  }

  const getDisplayedReportedProgress = (indicator: StrategicIndicator): number | null => {
    const reportedProgress = Number(
      (indicator as StrategicIndicator & { reportProgress?: number | null }).reportProgress
    )
    if (!Number.isFinite(reportedProgress)) {
      return null
    }
    return reportedProgress
  }

  const shouldShowReportedProgress = (indicator: StrategicIndicator): boolean => {
    const reportedProgress = getDisplayedReportedProgress(indicator)
    if (reportedProgress === null) {
      return false
    }
    return reportedProgress !== Number(indicator.progress || 0)
  }

  const getChildLifecycleStatus = (child: StrategicIndicator) => {
    const normalizedStatus = String(child.status || '').toUpperCase()
    const statusMap: Record<string, string> = {
      DRAFT: 'draft',
      PENDING: 'pending',
      PENDING_REVIEW: 'pending',
      DISTRIBUTED: 'distributed',
      ACTIVE: 'distributed',
      APPROVED: 'approved',
      REJECTED: 'distributed'
    }
    if (normalizedStatus) {
      return statusMap[normalizedStatus] ?? 'draft'
    }

    const audit = child.statusAudit || []
    if (audit.length === 0) {
      return 'draft'
    }
    const lastAudit = audit[audit.length - 1]
    if (!lastAudit) {
      return 'draft'
    }
    const lastAction = lastAudit.action
    if (lastAction === 'submit') {
      return 'pending'
    }
    if (lastAction === 'approve') {
      return 'approved'
    }
    if (lastAction === 'reject') {
      return 'distributed'
    }
    if (lastAction === 'distribute') {
      return 'distributed'
    }
    if (lastAction === 'withdraw') {
      return 'draft'
    }
    return 'draft'
  }

  const canManageChildDraft = (child: StrategicIndicator | undefined): boolean => {
    if (!child || !canEditChild.value) {
      return false
    }

    // 该页面按“学院维度”统一下发与撤回；
    // 一旦学院整体已进入待审批/进行中，不再允许对单条草稿指标做逐条编辑或删除。
    if (currentCollegePlanActionState.value !== 'draft') {
      return false
    }

    return getChildStatus(child) === 'draft'
  }

  const canDeletePersistedChild = (child: StrategicIndicator | undefined): boolean => {
    return canManageChildDraft(child)
  }

  // 获取状态标签类型
  const _getStatusTagType = (status: string) => {
    switch (status) {
      case 'draft':
        return 'info' // 草稿 - 灰色 (Element Plus info 是灰色)
      case 'distributed':
        return 'primary' // 已下发 - 蓝色 (Element Plus primary 是蓝色)
      case 'active':
        return 'primary' // 已下发 (legacy) - 蓝色
      case 'pending':
        return 'warning' // 待审批 - 橙色
      case 'approved':
        return 'success' // 已通过 - 绿色
      default:
        return 'info'
    }
  }

  // 获取状态文本
  const _getStatusText = (status: string) => {
    switch (status) {
      case 'draft':
        return '草稿'
      case 'distributed':
        return '已下发'
      case 'active':
        return '已下发' // Legacy ACTIVE status
      case 'pending':
        return '审批中'
      case 'approved':
        return '已通过'
      default:
        return '已下发'
    }
  }

  // 格式化学院显示（完整列表）
  const _formatColleges = (depts: string | string[] | undefined): string => {
    if (!depts) {
      return '-'
    }
    if (Array.isArray(depts)) {
      return depts.join('、')
    }
    return depts.split(',').join('、')
  }

  // 格式化学院显示（简短版，超过2个显示+N）
  const _formatCollegesShort = (depts: string | string[] | undefined): string => {
    if (!depts) {
      return '-'
    }
    const arr = Array.isArray(depts) ? depts : depts.split(',')
    if (arr.length <= 2) {
      return arr.join('、')
    }
    return `${arr.slice(0, 2).join('、')} +${arr.length - 2}`
  }

  // 解析学院字符串为数组（用于编辑时）
  const parseColleges = (depts: string | string[] | undefined): string[] => {
    if (!depts) {
      return []
    }
    if (Array.isArray(depts)) {
      return depts
    }
    return depts.split(',')
  }

  // 获取任务类型对应的颜色（基于指标的type2：发展性/基础性）
  const _getTaskTypeColor = (type2: string) => {
    return type2 === '发展性' ? '#409EFF' : '#67C23A'
  }

  // 获取指标类型颜色（定性/定量）
  const _getIndicatorTypeColor = (type1: string) => {
    return type1 === '定性'
      ? 'var(--color-qualitative, #9333ea)'
      : 'var(--color-quantitative, #0891b2)'
  }

  // 为已有子指标生成12个月里程碑（Milestone类型）
  const generateMonthlyMilestonesForExisting = (
    childName: string
  ): {
    id: string
    name: string
    targetProgress: number
    deadline: string
    status: 'pending'
  }[] => {
    const currentYear = timeContext.currentYear
    const indicatorName = childName || '指标完成'
    const milestones: {
      id: string
      name: string
      targetProgress: number
      deadline: string
      status: 'pending'
    }[] = []

    for (let month = 1; month <= 12; month++) {
      const lastDay = new Date(currentYear, month, 0).getDate()
      const deadline = `${currentYear}-${String(month).padStart(2, '0')}-${lastDay}`
      const progress = Math.round((month / 12) * 100)

      milestones.push({
        id: `ms-${Date.now()}-${month}`,
        name: `${indicatorName} - ${month}月`,
        targetProgress: progress,
        deadline: deadline,
        status: 'pending'
      })
    }
    return milestones
  }

  // 为新增子指标生成12个月里程碑（LocalMilestone类型）
  const generateMonthlyMilestonesLocal = (childName: string): LocalMilestone[] => {
    const currentYear = timeContext.currentYear
    const indicatorName = childName || '指标完成'
    const milestones: LocalMilestone[] = []

    for (let month = 1; month <= 12; month++) {
      const lastDay = new Date(currentYear, month, 0).getDate()
      const expectedDate = `${currentYear}-${String(month).padStart(2, '0')}-${lastDay}`
      const progress = Math.round((month / 12) * 100)

      milestones.push({
        id: `ms-${Date.now()}-${month}`,
        name: `${indicatorName} - ${month}月`,
        expectedDate: expectedDate,
        progress: progress
      })
    }
    return milestones
  }

  // 计算定量指标当月的目标进度
  const _getCurrentMonthTargetProgress = (
    child: StrategicIndicator | NewChildIndicator
  ): number => {
    const milestones = child.milestones || []
    if (milestones.length === 0) {
      return 100
    }

    const currentMonth = new Date().getMonth() + 1 // 1-12
    const currentYear = timeContext.currentYear

    // 查找当月的里程碑
    for (const ms of milestones) {
      // 兼容两种里程碑类型：Milestone (deadline, targetProgress) 和 LocalMilestone (expectedDate, progress)
      const dateStr =
        'deadline' in ms && ms.deadline ? ms.deadline : 'expectedDate' in ms ? ms.expectedDate : ''
      const progressVal =
        'targetProgress' in ms && ms.targetProgress !== undefined
          ? ms.targetProgress
          : 'progress' in ms
            ? ms.progress
            : 0

      if (dateStr) {
        const deadline = new Date(dateStr)
        if (deadline.getFullYear() === currentYear && deadline.getMonth() + 1 === currentMonth) {
          return progressVal
        }
      }
    }

    // 如果没找到当月里程碑，返回最近的一个里程碑进度
    const now = new Date()
    let closestProgress = 100
    let minDiff = Infinity

    for (const ms of milestones) {
      const dateStr =
        'deadline' in ms && ms.deadline ? ms.deadline : 'expectedDate' in ms ? ms.expectedDate : ''
      const progressVal =
        'targetProgress' in ms && ms.targetProgress !== undefined
          ? ms.targetProgress
          : 'progress' in ms
            ? ms.progress
            : 0

      if (dateStr) {
        const deadline = new Date(dateStr)
        const diff = Math.abs(deadline.getTime() - now.getTime())
        if (diff < minDiff) {
          minDiff = diff
          closestProgress = progressVal
        }
      }
    }

    return closestProgress
  }

  // 处理子指标类型变更
  const _handleChildTypeChange = async (
    child: NewChildIndicator | StrategicIndicator,
    newType: '定量' | '定性'
  ) => {
    // 检查状态：只有草稿状态才能编辑
    if (!('isNew' in child && child.isNew)) {
      const status = getChildStatus(child as StrategicIndicator)
      if (status !== 'draft') {
        ElMessage.warning('只有草稿状态的指标才能编辑，请先撤销下发')
        return
      }
    }

    if ('isNew' in child && child.isNew) {
      // 新增的子指标 - 使用 LocalMilestone 类型
      child.type1 = newType
      if (newType === '定量') {
        child.targetProgress = 100
        // 自动生成12个月里程碑（LocalMilestone类型）
        child.milestones = generateMonthlyMilestonesLocal(child.name)
      } else {
        child.targetProgress = 0
        child.milestones = []
      }
    } else {
      // 已有的子指标 - 使用 Milestone 类型
      const indicator = child as StrategicIndicator
      const newMilestones =
        newType === '定量' ? generateMonthlyMilestonesForExisting(indicator.name) : []

      const updates: Partial<StrategicIndicator> = {
        type1: newType,
        isQualitative: newType === '定性',
        targetValue: newType === '定量' ? 100 : 0,
        milestones: newMilestones
      }
      await strategicStore.updateIndicator(indicator.id.toString(), updates)
      await refreshDistributionData()
    }

    ElMessage.success(`已切换为${newType}指标`)
  }

  // 里程碑弹窗相关
  const milestonesDialogVisible = ref(false)
  const editingMilestonesChild = ref<NewChildIndicator | StrategicIndicator | null>(null)
  const editingMilestones = ref<LocalMilestone[]>([])
  const isSavingMilestones = ref(false)

  // 打开里程碑编辑弹窗
  const openMilestonesDialog = (child: NewChildIndicator | StrategicIndicator) => {
    editingMilestonesChild.value = child
    if ('isNew' in child && child.isNew) {
      editingMilestones.value = sortLocalMilestonesByDate(
        JSON.parse(JSON.stringify(child.milestones || []))
      )
    } else {
      // 从已有子指标的milestones转换
      const existing = (child as StrategicIndicator).milestones || []
      editingMilestones.value = sortLocalMilestonesByDate(
        existing.map(m => ({
          id: m.id || `ms-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: m.name,
          expectedDate: m.deadline || '',
          progress: m.targetProgress || 0
        }))
      )
    }
    milestonesDialogVisible.value = true
  }

  // 获取正在编辑的子指标名称
  const getEditingChildName = (): string => {
    if (!editingMilestonesChild.value) {
      return ''
    }
    if ('isNew' in editingMilestonesChild.value && editingMilestonesChild.value.isNew) {
      return editingMilestonesChild.value.name || '新增指标'
    }
    return (editingMilestonesChild.value as StrategicIndicator).name || ''
  }

  // 获取正在编辑的子指标类型
  const getEditingChildType = (): string => {
    if (!editingMilestonesChild.value) {
      return '定性'
    }
    if ('isNew' in editingMilestonesChild.value && editingMilestonesChild.value.isNew) {
      return editingMilestonesChild.value.type1 || '定性'
    }
    const indicator = editingMilestonesChild.value as StrategicIndicator
    return indicator.type1 || (indicator.isQualitative ? '定性' : '定量')
  }

  // 添加里程碑
  const addMilestone = () => {
    const autoName = getEditingChildType() === '定量' ? getEditingChildName() : ''
    const lastProgress =
      editingMilestones.value.length > 0
        ? (editingMilestones.value[editingMilestones.value.length - 1]?.progress ?? 0)
        : 0
    editingMilestones.value.push({
      id: `ms-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: autoName,
      expectedDate: '',
      progress: lastProgress
    })
    editingMilestones.value = sortLocalMilestonesByDate(editingMilestones.value)
  }

  // 生成12个月里程碑
  const generateMonthlyMilestones = () => {
    const currentYear = new Date().getFullYear()
    const indicatorName = getEditingChildName() || '指标完成'
    editingMilestones.value = []

    for (let month = 1; month <= 12; month++) {
      const lastDay = new Date(currentYear, month, 0).getDate()
      const deadline = `${currentYear}-${String(month).padStart(2, '0')}-${lastDay}`
      const progress = Math.round((month / 12) * 100)

      editingMilestones.value.push({
        id: `-${month}`, // 使用负数字符串作为临时 ID，后端会识别为新里程碑
        name: `${indicatorName} - ${month}月`,
        expectedDate: deadline,
        progress: progress
      })
    }

    editingMilestones.value = sortLocalMilestonesByDate(editingMilestones.value)
  }

  // 删除里程碑
  const removeMilestone = (index: number) => {
    editingMilestones.value.splice(index, 1)
  }

  // 验证里程碑进度（后面的不能小于前面的）
  const validateMilestoneProgress = (index: number) => {
    const current = editingMilestones.value[index]
    if (!current) {
      return
    }

    // 检查是否小于前一个里程碑的进度
    if (index > 0) {
      const prev = editingMilestones.value[index - 1]
      if (prev && current.progress < prev.progress) {
        ElMessage.warning(
          `第 ${index + 1} 个里程碑的进度不能小于第 ${index} 个里程碑的进度 (${prev.progress}%)`
        )
        current.progress = prev.progress
        return
      }
    }

    // 检查是否大于后一个里程碑的进度
    if (index < editingMilestones.value.length - 1) {
      const next = editingMilestones.value[index + 1]
      if (next && current.progress > next.progress) {
        ElMessage.warning(
          `第 ${index + 1} 个里程碑的进度不能大于第 ${index + 2} 个里程碑的进度 (${next.progress}%)`
        )
        current.progress = next.progress
        return
      }
    }
  }

  const handleMilestoneDateChange = () => {
    editingMilestones.value = sortLocalMilestonesByDate(editingMilestones.value)
  }

  // 保存里程碑
  const saveMilestones = async () => {
    if (!editingMilestonesChild.value || isSavingMilestones.value) {
      return
    }

    const child = editingMilestonesChild.value
    if ('isNew' in child && child.isNew) {
      child.milestones = JSON.parse(
        JSON.stringify(sortLocalMilestonesByDate(editingMilestones.value))
      )
      milestonesDialogVisible.value = false
      editingMilestonesChild.value = null
      editingMilestones.value = []
    } else {
      isSavingMilestones.value = true
      try {
        const sortedMilestones = sortLocalMilestonesByDate(editingMilestones.value)
        const indicator = child as StrategicIndicator

        logger.info(
          `[IndicatorDistributionView] Saving ${sortedMilestones.length} milestones for indicator ${indicator.id}`
        )

        await persistIndicatorMilestones(Number(indicator.id), sortedMilestones)
        milestonesDialogVisible.value = false
        editingMilestonesChild.value = null
        editingMilestones.value = []
        ElMessage.success('里程碑已更新')

        logger.info(`[IndicatorDistributionView] Reloading indicators after milestone update...`)
        try {
          await refreshDistributionData()
          const reloadedIndicator = strategicStore.indicators.find(i => i.id === indicator.id)
          if (reloadedIndicator) {
            logger.info(
              `[IndicatorDistributionView] After reload, indicator ${reloadedIndicator.id} has ${reloadedIndicator.milestones?.length || 0} milestones`
            )
          }
        } catch (error) {
          logger.warn('[IndicatorDistributionView] Refresh after milestone update failed:', error)
        }
      } catch (error) {
        console.error('Failed to save milestones:', error)
        ElMessage.error('里程碑更新失败')
      } finally {
        isSavingMilestones.value = false
      }
    }
  }

  // 格式化里程碑显示
  const _formatMilestones = (child: StrategicIndicator | NewChildIndicator): string => {
    if ('isNew' in child && child.isNew) {
      return `${child.milestones?.length || 0} 个里程碑`
    }
    const indicator = child as StrategicIndicator
    return `${indicator.milestones?.length || 0} 个里程碑`
  }

  // 获取里程碑列表用于tooltip显示
  const getMilestonesTooltip = (
    child: StrategicIndicator | NewChildIndicator
  ): LocalMilestone[] => {
    if ('isNew' in child && child.isNew) {
      return sortLocalMilestonesByDate(child.milestones || [])
    }
    const indicator = child as StrategicIndicator
    return sortLocalMilestonesByDate(
      (indicator.milestones || []).map(m => ({
        id: m.id || '',
        name: m.name,
        expectedDate: m.deadline || '',
        progress: m.targetProgress || 0
      }))
    )
  }

  // 判断里程碑是否已完成（指标当前进度 >= 里程碑目标进度）
  const isMilestoneCompleted = (
    child: StrategicIndicator | NewChildIndicator,
    milestoneProgress: number
  ): boolean => {
    if ('isNew' in child && child.isNew) {
      return false // 新增的子指标还没有进度
    }
    const indicator = child as StrategicIndicator
    return (indicator.progress || 0) >= milestoneProgress
  }

  // ================== 表格数据类型 ==================

  // 表格行数据类型
  interface TableRowData {
    type: 'child' | 'new-child' | 'indicator-only' // indicator-only 表示没有子指标的父指标
    taskTitle: string
    indicator: StrategicIndicator // 父指标
    child?: StrategicIndicator | NewChildIndicator // 子指标
    parentIndicatorId: string
    rowIndex?: number // 新增子指标的索引
  }

  // ================== 学院视图数据 ==================

  // 学院视图表格数据
  const collegeTableData = computed(() => {
    if (!selectedCollege.value) {
      return []
    }

    const data: TableRowData[] = []
    const indicators = collegeIndicators.value

    indicators.forEach(indicator => {
      const indicatorId = indicator.id.toString()

      // 获取下发给该学院的子指标（支持字符串或数组格式）
      const children = strategicStore.indicators.filter(i => {
        if (i.parentIndicatorId !== indicatorId || i.isStrategic) {
          return false
        }
        // 支持字符串或数组格式的 responsibleDept
        if (Array.isArray(i.responsibleDept)) {
          return i.responsibleDept.includes(selectedCollege.value!)
        }
        return i.responsibleDept === selectedCollege.value
      })

      // 获取新增的子指标（只显示分配给当前学院的）
      const newChildren = (newChildIndicators[indicatorId] || []).filter(nc =>
        nc.college.includes(selectedCollege.value!)
      )

      // 仅显示真实存在的子指标和正在新增的子指标，不再为“尚未分解”的父指标补空占位行
      children.forEach(child => {
        data.push({
          type: 'child',
          taskTitle: indicator.taskContent || '',
          indicator,
          child,
          parentIndicatorId: indicatorId
        })
      })

      newChildren.forEach((newChild, newIdx) => {
        // 查找原始索引
        const originalIdx = (newChildIndicators[indicatorId] || []).findIndex(
          nc => nc.id === newChild.id
        )
        data.push({
          type: 'new-child',
          taskTitle: indicator.taskContent || '',
          indicator,
          child: newChild,
          parentIndicatorId: indicatorId,
          rowIndex: originalIdx >= 0 ? originalIdx : newIdx
        })
      })
    })

    return data
  })

  // 获取行的 class 名称（用于标识新增子指标行）
  const getRowClassName = ({ row }: { row: TableRowData }) => {
    if (row.type === 'child' && isDeletingChild(row.child as StrategicIndicator | undefined)) {
      return 'deleting-child-row'
    }

    if (row.type === 'new-child') {
      return 'new-child-row'
    }
    return ''
  }

  return {
    _addNewChildRow,
    _canAddIndicator,
    _distributeNewChildren,
    _formatColleges,
    _formatCollegesShort,
    _formatMilestones,
    _getChildIndicators,
    _getCurrentMonthTargetProgress,
    _getIndicatorTypeColor,
    _getPendingChildCount,
    _getStatusTagType,
    _getStatusText,
    _getTaskTypeColor,
    _handleChildTypeChange,
    _handleCollegeSelectBlur,
    _handleCollegeSelectClose,
    _handleDistributeOrWithdraw,
    _isReadOnly,
    _newIndicatorList,
    _selectParentSpanMethod,
    _selectingParentForIndex,
    addFormMilestone,
    addMilestone,
    addRowFormRef,
    addingParentId,
    applyLocalCollegePlanPatch,
    applyLocalCollegePlanReportSummaryPatch,
    approvalDrawerPlan,
    approvalFlowStatusMeta,
    approvalIndicators,
    approvalPreviewLoading,
    approvalSetupDialogVisible,
    approvalSubmitComment,
    approvalStatusPopoverLoading,
    approvalSubmitting,
    approvalWorkflowPreview,
    approvalWorkflowReportSummary,
    authStore,
    availableParentIndicators,
    buildDraftMilestonesFromForm,
    buildLocalMilestonesFromForm,
    buildTaskTypeMap,
    canCurrentUserApproveCurrentPlan,
    canCurrentUserSubmitCurrentDepartmentDistribution,
    canDeletePersistedChild,
    canEditChild,
    canEditCurrentCollegePlan,
    canManageChildDraft,
    canWithdrawCurrentCollegePlan,
    cancelAddIndicator,
    cancelChildEdit,
    cloneParentMilestonesForForm,
    collegeDropdownVisible,
    collegeIndicators,
    collegeOverallStatus,
    collegeTableData,
    collegeTotalWeight,
    colleges,
    closeCopyIndicatorsDialog,
    confirmDepartmentPlanApprovalSubmission,
    copyClearExisting,
    copyIndicatorDialogVisible,
    copyIndicatorsFromCollege,
    copySourceCollege,
    copySourceCollegeOptions,
    currentActiveCollegePlan,
    currentApprovalApproverName,
    currentApprovalCandidateNames,
    currentApprovalEntityId,
    currentApprovalEntityType,
    currentApprovalFlowName,
    currentApprovalStepName,
    currentApprovalStepPreview,
    currentApprovalType,
    currentApprovalWorkflowCode,
    currentApprovalWorkflowStatus,
    currentCollegePlanActionState,
    currentCollegePlanReportSummary,
    currentCollegePlanReportUiStatus,
    currentCollegePlanStatusMeta,
    currentCollegeWorkflowDetail,
    currentDepartmentOrgId,
    currentDepartmentOrgIdFromTable,
    currentDepartmentPlan,
    currentDepartmentPlanDetails,
    currentDepartmentPlanIndicators,
    currentDept,
    currentDetailIndicator,
    currentDispatchWorkflowCode,
    currentPlanTaskTypeMap,
    currentSelectedCollegePlan,
    currentSelectedCollegePlanDetails,
    currentUserNormalizedRoleCodes,
    currentUserOrgId,
    currentUserPermissionCodes,
    currentUserRoleCodes,
    deletingChildId,
    departmentAliasNameMap,
    detailDrawerVisible,
    distributionApprovalButtonText,
    distributionApprovalButtonType,
    distributionRecordCount,
    distributionSubmitButtonDisabledReason,
    distributionSubmitButtonText,
    distributionSubmitButtonType,
    editingChildField,
    editingChildId,
    editingChildValue,
    editingMilestones,
    editingMilestonesChild,
    editingNewChildId,
    filteredColleges,
    formatDetailDate,
    generateMonthlyMilestones,
    generateMonthlyMilestonesForExisting,
    generateMonthlyMilestonesForForm,
    generateMonthlyMilestonesLocal,
    getChildLifecycleStatus,
    getChildStatus,
    getCollegeChildCount,
    getCollegeStatus,
    getDeptNameByOrgId,
    getDisplayedReportedProgress,
    getEditingChildName,
    getEditingChildType,
    getIndicatorTaskId,
    getIndicatorTypeLabel,
    getMilestonesTooltip,
    getMyCollegeIndicators,
    getOrgIdByDeptName,
    getPlanIndicatorNumber,
    getPlanIndicatorText,
    getRowClassName,
    getSortedMilestones,
    handleApprovalRefresh,
    handleApprovalStatusPopoverShow,
    handleBatchDistribute,
    handleBatchWithdraw,
    handleChildDblClick,
    handleCloseApprovalSetupDialog,
    handleFormIndicatorTypeChange,
    handleGlobalMousedown,
    handleMilestoneDateChange,
    handleNewChildRowClick,
    handleOpenApproval,
    handleParentIndicatorChange,
    handleViewDetail,
    hasCurrentCollegePendingApproval,
    isAddingIndicator,
    isBasicTaskIndicator,
    isBatchDistributing,
    isCollegeSidebarLoading,
    isCurrentUserReporter,
    isDeletingChild,
    isFunctionalDept,
    isInteractingWithCollegeSelect,
    isMilestoneCompleted,
    isQualitativeIndicator,
    isSameDepartment,
    isSavingChildCell,
    isSavingIndicator,
    isSavingMilestones,
    isStrategicDept,
    lastEditTime,
    latestCollegePlanReportSummary,
    loadCurrentCollegePlanReportSummary,
    loadCurrentDepartmentPlanDetails,
    loadCurrentDepartmentPlanTaskTypeMap,
    loadCurrentSelectedCollegePlanDetails,
    matchesCurrentDepartmentPlanContext,
    matchesCurrentSelectedCollegePlanContext,
    matchesDepartment,
    milestonesDialogVisible,
    newChildIndicators,
    newIndicatorForm,
    normalizeDepartmentName,
    normalizeIndicatorTypeLabel,
    normalizePreviewCandidateDisplayName,
    normalizeTaskTypeToCategory,
    normalizeWorkflowStepName,
    normalizedCurrentActiveCollegeWorkflowStatus,
    normalizedCurrentDepartmentPlanStatus,
    normalizedSelectedCollegePlanStatus,
    openAddIndicatorForm,
    openCopyIndicatorsDialog,
    openDistributionApprovalSetupDialog,
    openMilestonesDialog,
    orgStore,
    pageBootstrapPromise,
    parseColleges,
    pendingApprovalCount,
    pendingCollegePlanUiState,
    persistIndicatorMilestones,
    planStore,
    plansWithIndicators,
    preloadCurrentCollegeWorkflowDetail,
    receivedParentIndicators,
    refreshDistributionData,
    refreshDistributionPromise,
    removeChildIndicator,
    removeFormMilestone,
    removeMilestone,
    removeNewChildRow,
    resetApprovalSetupDialog,
    resolveCurrentStepExpectedRoleCodes,
    resolveIndicatorTaskType,
    resolveParentTargetProgress,
    resolvePlanYear,
    routeApprovalPlan,
    saveChildEdit,
    saveMilestones,
    saveNewIndicator,
    savingChildField,
    savingChildId,
    searchKeyword,
    secondaryApprovalEntityId,
    secondaryApprovalEntityType,
    selectParentDialogVisible,
    selectParentIndicator,
    selectParentTableData,
    selectedCollege,
    selectedCollegePlanUiStatus,
    sortLocalMilestonesByDate,
    strategicStore,
    shouldShowReportedProgress,
    syncSelectedCollegeFromApprovalRoute,
    taskApprovalVisible,
    timeContext,
    toBatchDistributionMilestones,
    toMilestoneBatchPayload,
    validateAndSaveNewChild,
    validateMilestoneProgress,
    waitForPageBootstrap,
    withdrawButtonDisabled,
    withdrawButtonDisabledReason,
    withdrawButtonType,
    withdrawButtonVisible
  }
}
