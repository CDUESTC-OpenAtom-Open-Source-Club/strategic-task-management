import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  Plus,
  View,
  Download,
  Delete,
  ArrowDown,
  Promotion,
  RefreshLeft,
  Check,
  Close,
  Upload,
  Edit,
  Refresh,
  Loading,
  Timer
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, ElLoading } from 'element-plus'
import type { ElTable } from 'element-plus'
// eslint-disable-next-line no-restricted-syntax -- Backend-aligned types
import type { StrategicTask as _StrategicTask, StrategicIndicator } from '@/shared/types'
import { IndicatorStatus } from '@/shared/types/entities'
import { useStrategicStore, toStrategicIndicator } from '@/features/task/model/strategic'
import type { ApiResponse } from '@/features/indicator/api/types'
import { useAuthStore } from '@/features/auth/model/store'
import { useTimeContextStore } from '@/shared/lib/timeContext'
import { useOrgStore } from '@/features/organization/model/store'
import { usePermission } from '@/5-shared/lib/permissions'
import AppAvatar from '@/shared/ui/avatar/AppAvatar.vue'
import { logger } from '@/shared/lib/utils/logger'
import { resolveIndicatorYear } from '@/shared/lib/utils/indicatorYear'
import { formatPendingApprovalLabel } from '@/shared/lib/utils/workflowStepLabel'
import { buildQueryKey, fetchWithCache, invalidateQueries } from '@/shared/lib/utils/cache'
import strategicApi, { approvalApi as taskApprovalApi } from '@/features/task/api/strategicApi'
import {
  getWorkflowDefinitionPreviewByCode,
  startWorkflow,
  getWorkflowInstanceDetail,
  getWorkflowInstanceDetailByBusiness,
  approveTask,
  rejectTask
} from '@/features/workflow/api'
import {
  getStatusText as _getStatusText,
  getStatusType as _getStatusType,
  getStatusIcon as _getStatusIcon
} from '@/shared/lib/utils/indicatorStatus'
import { getPlanStatusDisplay, normalizePlanStatus } from '@/features/task/lib'
import { ApprovalProgressDrawer } from '@/features/approval'
import { notifyApprovalStateRefresh } from '@/features/approval/lib'
import { useApprovalRouteAutopen } from '@/features/approval/lib'
import { useApprovalStore } from '@/features/approval/model/store'
import { indicatorApi } from '@/features/indicator/api'
import { usePlanStore } from '@/features/plan/model/store'
import { indicatorFillApi } from '@/features/plan/api/planApi'
import {
  useIndicatorFills,
  invalidateIndicatorFills,
  notifyIndicatorFillsRefresh
} from '@/features/indicator/model/useIndicatorFills'
import { getUsersByOrgId } from '@/features/user/api/query'
import { sleep } from '@/5-shared/api/retry'
import {
  GLOBAL_DATA_REFRESH_REQUEST_EVENT,
  shouldRefreshForDomains,
  type GlobalDataRefreshDetail
} from '@/5-shared/lib/dataFreshness'
import {
  canCurrentUserHandleIndicatorWorkflow,
  getIndicatorWorkflowStatusLabel,
  getIndicatorWorkflowTagType,
  resolveLatestIndicatorWorkflowSnapshot,
  type IndicatorWorkflowSnapshot
} from '@/features/plan/lib/indicatorWorkflow'
import type {
  WorkflowDefinitionPreviewResponse,
  WorkflowHistoryItem,
  WorkflowInstanceDetailResponse,
  WorkflowTaskResponse
} from '@/features/workflow/api/types'

export interface StrategicTaskViewProps {
  selectedRole: string
}

export function useStrategicTaskView(props: StrategicTaskViewProps) {
  // 使用共享 Store
  const strategicStore = useStrategicStore()
  const authStore = useAuthStore()
  const timeContext = useTimeContextStore()
  const orgStore = useOrgStore()
  const planStore = usePlanStore()
  const approvalStore = useApprovalStore()
  const route = useRoute()
  const router = useRouter()
  const currentUserId = computed(() => Number(authStore.user?.userId ?? 0))
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

  const isCurrentUserReporter = computed(() => {
    const roles = Array.isArray(authStore.user?.roles)
      ? authStore.user.roles
          .map(role => (typeof role === 'string' ? role.trim().toUpperCase() : ''))
          .filter(Boolean)
      : []

    return roles.includes('ROLE_REPORTER')
  })

  // 使用统一的权限管理工具
  const permissionUtil = usePermission()

  const currentUserOrgId = computed(() => {
    const rawOrgId = Number((authStore.user as { orgId?: string | number } | null)?.orgId ?? NaN)
    return Number.isFinite(rawOrgId) && rawOrgId > 0 ? rawOrgId : null
  })

  // 只读模式（历史年份为只读）
  const isReadOnly = computed(() => timeContext.isReadOnly)

  /**
   * 编辑权只属于填报人（2026-10-21 用户定案）。
   *
   * 口径：从草稿计划到已下发计划，能改数据的始终只有填报人——草稿阶段是他填报，
   * 已下发之后是他发起异动；负责人和校领导只做审批，不编辑任何字段。
   * 因此这里不再按「是不是战略发展部」判断，而是要求具备 ROLE_REPORTER。
   *
   * 兼容：若账号没有下发 roles（旧会话/演示数据），退回原来的「战略部即可编辑」，
   * 避免因数据缺失把正常填报人锁死在只读态。
   */
  const isReporter = computed(() => {
    if (currentUserRoleCodes.value.length === 0) {
      return authStore.userRole === 'strategic_dept' || props.selectedRole === 'strategic_dept'
    }
    return isCurrentUserReporter.value
  })

  const canEdit = computed(() => {
    if (isReadOnly.value) {
      return false
    }
    return isReporter.value
  })

  // 首屏加载态：接口未返回前展示骨架，避免先渲染"暂无数据"造成误判
  const taskTypeMapLoading = ref(false)
  const currentPlanScopeLoading = ref(false)
  const pageTransitionLoading = ref(false)
  const isDepartmentSwitching = ref(false)
  let departmentSwitchingTimer: ReturnType<typeof setTimeout> | null = null
  let globalDataRefreshPromise: Promise<void> | null = null
  let lastLightRefreshAt = 0
  let lightRefreshBackoffUntil = 0
  const LIGHT_REFRESH_MIN_INTERVAL_MS = 45 * 1000
  const LIGHT_REFRESH_BACKOFF_MS = 90 * 1000

  const isInitialDataLoading = computed(() => {
    return isBootstrappingPage.value || pageTransitionLoading.value
  })

  // 当前选中任务索引
  const currentTaskIndex = ref(0)
  const isAddingOrEditing = ref(false)
  const addRowFormRef = ref<HTMLElement | null>(null)

  // 视图模式：table（表格视图）或 card（卡片视图）
  const viewMode = ref<'table' | 'card'>('table')

  // 卡片视图当前指标索引
  const currentIndicatorIndex = ref(0)
  const isBootstrappingPage = ref(true)

  // 职能部门列表（从 orgStore 动态获取）
  const functionalDepartments = computed(() => orgStore.getAllFunctionalDepartmentNames())
  const selectedDepartmentStorageKey = computed(() => {
    const userId = String(authStore.user?.userId ?? authStore.user?.id ?? '').trim()
    const role = String(props.selectedRole || authStore.userRole || '').trim()
    const orgId = String(authStore.user?.orgId ?? '').trim()
    const scope = [userId, role, orgId].filter(Boolean).join(':') || 'anonymous'
    return `strategic-task-management:selected-department:${scope}`
  })

  // 选中的部门 - 默认选中第一个
  const selectedDepartment = ref('')

  const getRouteQueryText = (value: unknown): string => {
    const candidate = Array.isArray(value) ? value[0] : value
    return String(candidate ?? '').trim()
  }

  function normalizeDepartmentName(value?: string | null): string {
    if (!value) {
      return ''
    }

    const trimmed = String(value).trim()
    if (!trimmed) {
      return ''
    }

    return (
      departmentAliasNameMap.value.get(trimmed) || departmentIdNameMap.value.get(trimmed) || trimmed
    )
  }

  const readPersistedSelectedDepartment = (): string => {
    if (typeof window === 'undefined') {
      return ''
    }

    try {
      return normalizeDepartmentName(
        window.localStorage.getItem(selectedDepartmentStorageKey.value)
      )
    } catch (error) {
      logger.warn('[StrategicTaskView] 读取持久化部门选择失败:', error)
      return ''
    }
  }

  const persistSelectedDepartment = (dept: string): void => {
    if (typeof window === 'undefined') {
      return
    }

    try {
      if (dept) {
        window.localStorage.setItem(selectedDepartmentStorageKey.value, dept)
      } else {
        window.localStorage.removeItem(selectedDepartmentStorageKey.value)
      }
    } catch (error) {
      logger.warn('[StrategicTaskView] 持久化部门选择失败:', error)
    }
  }

  const departmentIdNameMap = computed(() => {
    const map = new Map<string, string>()
    orgStore.departments.forEach(dept => {
      map.set(String(dept.id), dept.name)
    })
    return map
  })

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

  const departmentNameIdMap = computed(() => {
    const map = new Map<string, number>()
    orgStore.departments.forEach(dept => {
      map.set(dept.name, Number(dept.id))
    })
    return map
  })

  const resolveDepartmentIdByName = (departmentName?: string | null): number | null => {
    const normalized = normalizeDepartmentName(departmentName)
    if (!normalized) {
      return null
    }
    return departmentNameIdMap.value.get(normalized) ?? null
  }

  const ensureInitialSelectedDepartment = (departments: string[]): void => {
    if (departments.length === 0 || selectedDepartment.value) {
      return
    }

    const persistedDepartment = readPersistedSelectedDepartment()
    const matchedPersistedDepartment = departments.find(
      dept => normalizeDepartmentName(dept) === persistedDepartment
    )

    if (matchedPersistedDepartment) {
      selectedDepartment.value = matchedPersistedDepartment
      persistSelectedDepartment(matchedPersistedDepartment)
      return
    }

    selectedDepartment.value = departments[0] ?? ''
    if (selectedDepartment.value) {
      persistSelectedDepartment(selectedDepartment.value)
    }
  }

  // 初始化选中部门 - 默认选中第一个职能部门
  watch(
    functionalDepartments,
    newDeps => {
      ensureInitialSelectedDepartment(newDeps)
    },
    { immediate: true }
  )

  const resolvePlanYear = (plan: Record<string, unknown>): number | null => {
    const explicitYear = plan?.cycle?.year ?? plan?.year
    if (explicitYear != null && explicitYear !== '') {
      return Number(explicitYear)
    }

    const cycleId = Number(plan?.cycleId)
    if (cycleId === 4 || cycleId === 90) {
      return 2026
    }
    if (cycleId === 7) {
      return 2025
    }

    return null
  }

  const findCurrentPlanByDepartment = () => {
    if (!selectedDepartment.value) {
      return null
    }

    const selectedDepartmentId = resolveDepartmentIdByName(selectedDepartment.value)
    const normalizedDepartmentName = normalizeDepartmentName(selectedDepartment.value)

    const sameDepartment = (planAny: Record<string, unknown>) => {
      const planTargetOrgId = Number(planAny.targetOrgId ?? planAny.org_id ?? planAny.orgId ?? NaN)
      const orgName = normalizeDepartmentName(
        String(planAny.targetOrgName || planAny.orgName || '')
      )
      return (
        (selectedDepartmentId != null &&
          Number.isFinite(planTargetOrgId) &&
          planTargetOrgId === selectedDepartmentId) ||
        orgName === normalizedDepartmentName
      )
    }

    const plans = planStore.plans.filter(p => {
      const planAny = p as Record<string, unknown>
      const planYear = resolvePlanYear(planAny)
      return sameDepartment(planAny) && planYear === timeContext.currentYear
    })

    const strictMatch =
      plans.find(p => {
        const planAny = p as Record<string, unknown>
        const candidateCreatedByOrgId = Number(
          planAny.createdByOrgId ?? planAny.created_by_org_id ?? NaN
        )
        const candidatePlanLevel = String(planAny.planLevel || planAny.plan_level || '')
          .trim()
          .toUpperCase()

        return candidateCreatedByOrgId === 35 && candidatePlanLevel === 'STRAT_TO_FUNC'
      }) || null

    return strictMatch || plans[0] || null
  }

  const findCurrentPlanByOrgId = (orgId?: number | null) => {
    if (!orgId || !Number.isFinite(orgId)) {
      return null
    }

    return (
      planStore.plans.find(p => {
        const planAny = p as Record<string, unknown>
        const planYear = resolvePlanYear(planAny)
        const planCreatedByOrgId = Number(
          planAny.createdByOrgId ?? planAny.created_by_org_id ?? NaN
        )

        return (
          planYear === timeContext.currentYear &&
          Number.isFinite(planCreatedByOrgId) &&
          planCreatedByOrgId === orgId
        )
      }) || null
    )
  }

  // 后端任务类型映射：taskId -> taskType（BASIC/DEVELOPMENT/...）
  const backendTaskTypeMap = ref<Record<string, string>>({})
  const currentPlanTaskTypeMap = ref<Record<string, string>>({})
  const currentPlanTaskIdSet = ref<Set<string>>(new Set())

  const currentPlanTaskIdSetSignature = computed(() =>
    Array.from(currentPlanTaskIdSet.value).sort().join(',')
  )

  const normalizeTaskId = (value: unknown): string => {
    const normalized = String(value ?? '').trim()
    return normalized
  }

  const indicatorByIdMap = computed(() => {
    const map = new Map<string, StrategicIndicator>()
    strategicStore.indicators.forEach(item => {
      map.set(String(item.id), item)
    })
    return map
  })

  const getIndicatorTaskId = (indicator: StrategicIndicator): string => {
    const raw = indicator as StrategicIndicator & {
      taskId?: string | number
      task_id?: string | number
      planId?: string | number
      strategicTaskId?: string | number
      parentIndicatorId?: string | number
    }

    const directTaskId = normalizeTaskId(raw.taskId ?? raw.task_id ?? raw.strategicTaskId)
    if (directTaskId) {
      return directTaskId
    }

    const visited = new Set<string>()
    let currentParentId = normalizeTaskId(raw.parentIndicatorId)

    // 子指标 task_id 为空时，沿父指标链回溯 task_id
    while (currentParentId && !visited.has(currentParentId)) {
      visited.add(currentParentId)
      const parent = indicatorByIdMap.value.get(currentParentId)
      if (!parent) {
        break
      }
      const parentRaw = parent as StrategicIndicator & {
        taskId?: string | number
        task_id?: string | number
        planId?: string | number
        strategicTaskId?: string | number
        parentIndicatorId?: string | number
      }
      const parentTaskId = normalizeTaskId(
        parentRaw.taskId ?? parentRaw.task_id ?? parentRaw.strategicTaskId
      )
      if (parentTaskId) {
        return parentTaskId
      }
      currentParentId = normalizeTaskId(parentRaw.parentIndicatorId)
    }

    return ''
  }

  const isBasicTaskType = (taskType?: string): boolean => {
    const normalized = String(taskType || '')
      .trim()
      .toUpperCase()
    return normalized === 'BASIC'
  }

  const isDevelopmentTaskType = (taskType?: string): boolean => {
    const normalized = String(taskType || '')
      .trim()
      .toUpperCase()
    return normalized === 'DEVELOPMENT'
  }

  const getIndicatorMappedTaskType = (indicator: StrategicIndicator): string => {
    const indicatorTaskId = getIndicatorTaskId(indicator)
    if (!indicatorTaskId) {
      return ''
    }
    return (
      currentPlanTaskTypeMap.value[indicatorTaskId] ||
      backendTaskTypeMap.value[indicatorTaskId] ||
      ''
    )
  }

  const getTaskCategoryLabel = (taskType?: string): '基础性' | '发展性' => {
    if (isBasicTaskType(taskType)) {
      return '基础性'
    }
    return '发展性'
  }

  const getIndicatorCategoryLabel = (indicator: StrategicIndicator): '基础性' | '发展性' => {
    return getTaskCategoryLabel(getIndicatorMappedTaskType(indicator))
  }

  const isBasicIndicatorForCurrentRules = (indicator: StrategicIndicator): boolean => {
    const mappedTaskType = getIndicatorMappedTaskType(indicator)
    if (mappedTaskType) {
      return isBasicTaskType(mappedTaskType)
    }

    // 兜底：任务类型映射尚未返回时，回退到当前展示标签，避免页面临时显示 0 / 100。
    return String(indicator.type2 || '').trim() === '基础性'
  }

  const buildTaskTypeMap = (tasks: Array<Record<string, unknown>>): Record<string, string> => {
    const map: Record<string, string> = {}
    tasks.forEach(task => {
      const taskId = normalizeTaskId(
        (task as { taskId?: string | number; id?: string | number }).taskId
      )
      const fallbackTaskId = normalizeTaskId((task as { id?: string | number }).id)
      const taskType = String((task as { taskType?: string }).taskType || '').trim()
      const key = taskId || fallbackTaskId
      if (key && taskType) {
        map[key] = taskType
      }
    })
    return map
  }

  const buildTaskIdSet = (tasks: Array<Record<string, unknown>>): string[] => {
    return tasks
      .map(
        task =>
          normalizeTaskId((task as { taskId?: string | number; id?: string | number }).taskId) ||
          normalizeTaskId((task as { id?: string | number }).id)
      )
      .filter(Boolean)
  }

  const loadBackendTaskTypeMap = async (options: { force?: boolean } = {}) => {
    taskTypeMapLoading.value = true
    try {
      const byYearResponse = await strategicApi.getTasksByYear(timeContext.currentYear, {
        force: options.force
      })
      if (
        byYearResponse?.success &&
        Array.isArray(byYearResponse.data) &&
        byYearResponse.data.length > 0
      ) {
        backendTaskTypeMap.value = buildTaskTypeMap(
          byYearResponse.data as Array<Record<string, unknown>>
        )
        return
      }

      // 兼容回退：部分环境按年查询任务为空（周期口径不一致），改用全量任务建立映射
      const allTasksResponse = await strategicApi.getAllTasks({ force: options.force })
      if (allTasksResponse?.success && Array.isArray(allTasksResponse.data)) {
        backendTaskTypeMap.value = buildTaskTypeMap(
          allTasksResponse.data as Array<Record<string, unknown>>
        )
        return
      }

      backendTaskTypeMap.value = {}
    } catch (error) {
      backendTaskTypeMap.value = {}
      logger.error('[StrategicTaskView] 加载后端任务类型失败:', error)
    } finally {
      taskTypeMapLoading.value = false
    }
  }

  const loadCurrentPlanTaskScope = async (options: { force?: boolean } = {}) => {
    const dept = selectedDepartment.value
    if (!dept) {
      currentPlanScopeLoading.value = false
      return
    }

    currentPlanScopeLoading.value = true
    const currentPlan = findCurrentPlanByDepartment()
    const planId = currentPlan?.id

    if (!planId) {
      currentPlanTaskTypeMap.value = {}
      currentPlanTaskIdSet.value = new Set()
      currentPlanScopeLoading.value = false
      return
    }

    try {
      const scope = await fetchWithCache({
        key: buildQueryKey('task', 'scope', {
          department: dept,
          planId: String(planId),
          year: timeContext.currentYear
        }),
        policy: {
          ttlMs: 2 * 60 * 1000,
          scope: 'memory',
          dedupeWindowMs: 1000,
          tags: ['task.scope', `task.scope.${planId}`, 'plan.detail']
        },
        force: options.force === true,
        fetcher: async () => {
          const response = await strategicApi.getTasksByPlanId(planId)
          if (!response?.success || !Array.isArray(response.data)) {
            return {
              taskTypeMap: {} as Record<string, string>,
              taskIdSet: [] as string[]
            }
          }
          const planTaskMap = buildTaskTypeMap(response.data as Array<Record<string, unknown>>)
          const planTaskIds = buildTaskIdSet(response.data as Array<Record<string, unknown>>)
          return {
            taskTypeMap: planTaskMap,
            // 计划范围判断只依赖 task 主键，不应被 taskType 缺失误伤。
            taskIdSet: planTaskIds
          }
        }
      })

      currentPlanTaskTypeMap.value = scope.taskTypeMap
      currentPlanTaskIdSet.value = new Set(scope.taskIdSet)
    } catch (error) {
      currentPlanTaskTypeMap.value = {}
      currentPlanTaskIdSet.value = new Set()
      logger.error('[StrategicTaskView] 加载当前计划任务范围失败:', error)
    } finally {
      currentPlanScopeLoading.value = false
    }
  }

  const isIndicatorInCurrentPlanScope = (indicator: StrategicIndicator): boolean => {
    const indicatorTaskId = getIndicatorTaskId(indicator)
    if (!indicatorTaskId) {
      return false
    }
    if (currentPlanTaskIdSet.value.size === 0) {
      // 存在当前计划但任务列表为空时，按严格口径不计入当前计划范围。
      const hasCurrentPlan = Boolean(findCurrentPlanByDepartment()?.id)
      return !hasCurrentPlan
    }
    return currentPlanTaskIdSet.value.has(indicatorTaskId)
  }

  const matchFunctionalDepartmentName = (candidate?: string | null): string => {
    const normalized = normalizeDepartmentName(candidate)
    if (!normalized) {
      return ''
    }

    return (
      functionalDepartments.value.find(dept => normalizeDepartmentName(dept) === normalized) || ''
    )
  }

  const resolveRouteApprovalDepartment = async (): Promise<string> => {
    if (!orgStore.loaded || orgStore.departments.length === 0) {
      await orgStore.loadDepartments()
    }

    const queryDepartment = matchFunctionalDepartmentName(
      getRouteQueryText(route.query.approvalDepartment)
    )
    if (queryDepartment) {
      return queryDepartment
    }

    const approvalEntityType = getRouteQueryText(route.query.approvalEntityType).toUpperCase()
    const approvalEntityId = getRouteQueryText(route.query.approvalEntityId)
    if (approvalEntityType !== 'PLAN' || !approvalEntityId) {
      return ''
    }

    const cachedPlan =
      planStore.plans.find(
        plan => String((plan as Record<string, unknown>).id) === approvalEntityId
      ) || null
    const plan =
      cachedPlan ||
      (await planStore.loadPlanDetails(approvalEntityId, {
        force: true,
        background: true
      }))

    const planRecord = (plan || {}) as Record<string, unknown>
    const directDepartment = matchFunctionalDepartmentName(
      String(planRecord.targetOrgName || planRecord.orgName || '')
    )
    if (directDepartment) {
      return directDepartment
    }

    const planOrgId = Number(
      planRecord.targetOrgId ??
        planRecord.target_org_id ??
        planRecord.orgId ??
        planRecord.org_id ??
        NaN
    )
    if (!Number.isFinite(planOrgId) || planOrgId <= 0) {
      return ''
    }

    return matchFunctionalDepartmentName(departmentIdNameMap.value.get(String(planOrgId)) || '')
  }

  async function syncSelectedDepartmentFromRoute(): Promise<void> {
    const routeApprovalDepartment = await resolveRouteApprovalDepartment()
    if (!routeApprovalDepartment) {
      return
    }

    if (selectedDepartment.value !== routeApprovalDepartment) {
      selectedDepartment.value = routeApprovalDepartment
      persistSelectedDepartment(routeApprovalDepartment)
    }

    if (getRouteQueryText(route.query.approvalDepartment)) {
      const nextQuery = { ...route.query }
      delete nextQuery.approvalDepartment
      await router.replace({ query: nextQuery })
    }
  }

  watch(
    () => [
      route.query.approvalDepartment,
      route.query.approvalEntityType,
      route.query.approvalEntityId,
      functionalDepartments.value.length
    ],
    () => {
      if (
        getRouteQueryText(route.query.approvalDepartment) ||
        (getRouteQueryText(route.query.approvalEntityType).toUpperCase() === 'PLAN' &&
          getRouteQueryText(route.query.approvalEntityId))
      ) {
        void syncSelectedDepartmentFromRoute()
      }
    },
    { immediate: true }
  )

  const normalizedIndicators = computed(() =>
    strategicStore.indicators.map(i => ({
      ...i,
      ownerDept: normalizeDepartmentName(i.ownerDept),
      responsibleDept: normalizeDepartmentName(i.responsibleDept)
    }))
  )

  watch(
    () => timeContext.currentYear,
    () => {
      invalidateQueries(['task.scope'])
    }
  )

  // 计算当前选中部门的指标权重总和（用于下发验证）
  // 2026-10-28 口径对齐（详见 Issue #91）：后端 BasicTaskWeightValidationService 校验的是
  // 「计划内全部指标合计 100%」，此前前端只统计基础性任务子集 —— 教务处（基础性 50 / 计划 100）、
  // 数字校园（基础性 0 / 计划 100）这类部门即使计划合计已等于 100，「发起审批」按钮也会被禁用。
  const departmentTotalWeight = computed(() => {
    if (!selectedDepartment.value) {
      return 0
    }

    // 计算权重之和（计划内全部指标）
    // 按两位小数归整后再比较：后端按两位小数分配权重，浮点直接比较会出现
    // 100.00000000000001 / 99.99999999999999，导致「发起审批」按钮被误禁用。
    const total = indicators.value.reduce((sum, i) => sum + Number(i.weight || 0), 0)
    return Math.round(total * 100) / 100
  })

  const ensurePlanCanDistribute = (): boolean => {
    if (departmentTotalWeight.value !== 100) {
      ElMessage.warning(
        `计划内指标权重合计必须为100%（按当前部门全部指标计算），当前为${departmentTotalWeight.value}`
      )
      return false
    }
    return true
  }

  // 整体状态：直接使用 Plan 的状态，不再根据指标状态混合计算
  // 兼容后端大写状态和 Plan 模块的小写状态
  const overallStatus = computed(() => {
    const planStatus = currentPlanStatus.value
    if (!planStatus) {
      return { label: '暂无指标', type: 'info' }
    }

    return getPlanStatusDisplay(planStatus) || { label: String(planStatus), type: 'info' }
  })

  // 获取当前选中部门对应的 Plan（包含审批实例信息）
  const currentPlan = computed(() => {
    return findCurrentPlanByDepartment()
  })

  const currentDepartmentOrgId = computed(() => resolveDepartmentIdByName(selectedDepartment.value))

  const currentPlanReportSummary = ref<{
    id: number
    workflowInstanceId?: number | null
    currentTaskId?: number | null
    workflowStatus?: string | null
    currentStepName?: string | null
    currentApproverName?: string | null
    canWithdraw?: boolean
    status?: string | null
  } | null>(null)
  const latestPlanReportSummary = ref<{ id: number } | null>(null)

  const approvalWorkflowReportSummary = computed(() => {
    const currentWorkflowInstanceId = Number(
      currentPlanReportSummary.value?.workflowInstanceId ?? NaN
    )
    const currentStatus = String(
      currentPlanReportSummary.value?.workflowStatus || currentPlanReportSummary.value?.status || ''
    )
      .trim()
      .toUpperCase()

    if (
      currentPlanReportSummary.value?.id &&
      Number.isFinite(currentWorkflowInstanceId) &&
      currentWorkflowInstanceId > 0 &&
      currentStatus !== 'DRAFT'
    ) {
      return currentPlanReportSummary.value
    }

    // 当前轮次摘要即使还没拿到完整 workflow 绑定，也应该优先用于页面态展示，
    // 避免旧的 latest 记录把刚提交/刚撤回的当前状态覆盖掉。
    if (currentPlanReportSummary.value) {
      return currentPlanReportSummary.value
    }

    return latestPlanReportSummary.value
  })

  function hasWorkflowBinding(
    summary:
      | {
          id?: number | null
          workflowInstanceId?: number | null
          currentTaskId?: number | null
          workflowStatus?: string | null
          status?: string | null
          currentStepName?: string | null
        }
      | null
      | undefined
  ): boolean {
    if (!summary?.id) {
      return false
    }

    const workflowInstanceId = Number(summary.workflowInstanceId ?? NaN)
    if (Number.isFinite(workflowInstanceId) && workflowInstanceId > 0) {
      return true
    }

    const currentTaskId = Number(summary.currentTaskId ?? NaN)
    if (Number.isFinite(currentTaskId) && currentTaskId > 0) {
      return true
    }

    const workflowStatus = String(summary.workflowStatus || summary.status || '')
      .trim()
      .toUpperCase()
    if (workflowStatus && workflowStatus !== 'DRAFT') {
      return true
    }

    return Boolean(String(summary.currentStepName || '').trim())
  }

  const hasApprovalWorkflowReportBinding = computed(() =>
    hasWorkflowBinding(
      approvalWorkflowReportSummary.value as
        | {
            id?: number | null
            workflowInstanceId?: number | null
            currentTaskId?: number | null
            workflowStatus?: string | null
            status?: string | null
            currentStepName?: string | null
          }
        | null
        | undefined
    )
  )

  const shouldPreferCurrentReportWorkflow = computed(() => {
    const reportWorkflowStatus = String(
      approvalWorkflowReportSummary.value?.workflowStatus ||
        approvalWorkflowReportSummary.value?.status ||
        ''
    )
      .trim()
      .toUpperCase()

    return (
      hasApprovalWorkflowReportBinding.value &&
      (['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(reportWorkflowStatus) ||
        Boolean(approvalWorkflowReportSummary.value?.currentTaskId) ||
        Boolean(String(approvalWorkflowReportSummary.value?.currentStepName || '').trim()))
    )
  })

  // 获取当前选中部门对应的 Plan 状态
  const currentPlanStatus = computed(() => {
    return normalizePlanStatus(currentPlan.value?.status)
  })

  const currentApprovalWorkflowStatus = computed(() => {
    if (shouldPreferCurrentReportWorkflow.value) {
      return String(
        approvalWorkflowReportSummary.value?.workflowStatus ||
          approvalWorkflowReportSummary.value?.status ||
          preloadedPlanWorkflowDetail.value?.status ||
          currentPlan.value?.workflowStatus ||
          currentPlan.value?.status ||
          ''
      )
        .trim()
        .toUpperCase()
    }

    return String(
      preloadedPlanWorkflowDetail.value?.status ||
        currentPlan.value?.workflowStatus ||
        currentPlan.value?.status ||
        approvalWorkflowReportSummary.value?.workflowStatus ||
        approvalWorkflowReportSummary.value?.status ||
        ''
    )
      .trim()
      .toUpperCase()
  })

  // 2026-10-24 用户定案：计划审批中（下发审批待负责人/校领导处理）内容冻结——
  // 「新增行」与行内「+」对填报人锁死；审批通过走异动链、驳回/撤回后自动放开。
  const isCurrentPlanUnderApproval = computed(() =>
    ['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(currentApprovalWorkflowStatus.value)
  )

  const currentApprovalStepName = computed(() => {
    if (shouldPreferCurrentReportWorkflow.value) {
      return String(
        approvalWorkflowReportSummary.value?.currentStepName ||
          preloadedPlanWorkflowDetail.value?.currentStepName ||
          (currentPlan.value as { currentStepName?: string } | null)?.currentStepName ||
          ''
      ).trim()
    }

    return String(
      preloadedPlanWorkflowDetail.value?.currentStepName ||
        (currentPlan.value as { currentStepName?: string } | null)?.currentStepName ||
        approvalWorkflowReportSummary.value?.currentStepName ||
        ''
    ).trim()
  })

  const currentApprovalApproverName = computed(() => {
    if (shouldPreferCurrentReportWorkflow.value) {
      return String(
        (approvalWorkflowReportSummary.value as { currentApproverName?: string | null } | null)
          ?.currentApproverName ||
          preloadedPlanWorkflowDetail.value?.currentApproverName ||
          ((currentPlan.value as { currentApproverName?: string } | null)?.currentApproverName ??
            '') ||
          ''
      ).trim()
    }

    return String(
      preloadedPlanWorkflowDetail.value?.currentApproverName ||
        ((currentPlan.value as { currentApproverName?: string } | null)?.currentApproverName ??
          '') ||
        (approvalWorkflowReportSummary.value as { currentApproverName?: string | null } | null)
          ?.currentApproverName ||
        ''
    ).trim()
  })

  const currentApprovalFlowName = computed(() => {
    return String(
      preloadedPlanWorkflowDetail.value?.flowName ||
        preloadedPlanWorkflowDetail.value?.definitionName ||
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

  const preloadedPlanWorkflowDetail = ref<WorkflowInstanceDetailResponse | null>(null)
  const approvalStatusPopoverLoading = ref(false)
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
    const orgId = resolveExpectedApproverOrgIdForCurrentPlan()
    const roleCodes = resolveExpectedApproverRoleCodesForCurrentPlan()
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
      logger.warn('[StrategicTaskView] 加载页面级审批候选人失败:', {
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
      resolveExpectedApproverOrgIdForCurrentPlan(),
      resolveExpectedApproverRoleCodesForCurrentPlan().join('|')
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

    // PR#83 头部「审批状态」与学院页签「上报状态」列逐态对齐：
    // 有在审→审批中；否则有回退→已回退；否则有未填报→未填报；全部已上报→已上报。
    // 仅在学院页签生效（该页签才有「上报状态」列）；职能部门页签保持原计划级语义。
    const fillApproval = currentPlanFillApprovalSummary.value

    // 2026-10-24 用户定案（学院隔离 + C 项口径）：学院页签标签名「审批状况」，
    // 状态聚合 = 该学院的「上报审批 + 异动审批」合并视角——两者互斥：
    // 异动在审时上报被锁（不会同时存在两条在途），异动在审优先显示；
    // 聚合未就绪显示加载中、无任何在途与填报行按「未填报」——绝不回落到计划级/其他实例的状态
    // （否则宣传部上下文会把自己上报给战略部的环节显示到马院语境里，互相掺杂）。
    if (collegeFillStatusScope.value) {
      // 异动审批在审（该部门上下文的异动实例）：优先级最高，互斥锁生效的可见信号
      const mutationPending = departmentMutationPendingApprovals.value
      if (mutationPending.length > 0) {
        const top = mutationPending[0]
        return {
          label: `异动审批中 · ${String(top.currentStepName || '').trim()}`.replace(/ ·\s*$/, ''),
          tagType: 'warning' as const,
          description: '该学院存在进行中的异动审批；异动期间上报提交被锁定。'
        }
      }

      if (!fillApproval.loaded) {
        return {
          label: '…',
          tagType: 'info' as const,
          description: '正在加载该学院的审批状态。'
        }
      }

      if (fillApproval.hasRows) {
        if (fillApproval.hasSubmitted) {
          return {
            label: '审批中',
            tagType: 'warning' as const,
            description: '当前计划有指标的填报正在审批中。'
          }
        }

        if (fillApproval.hasRejected) {
          return {
            label: '已回退',
            tagType: 'danger' as const,
            description: '当前计划有指标的填报被回退，等待重新上报。'
          }
        }

        if (fillApproval.hasUnfilled) {
          return {
            label: '未填报',
            tagType: 'info' as const,
            description: '当前计划有指标尚未填报。'
          }
        }

        return {
          label: '已上报',
          tagType: 'success' as const,
          description: '当前计划的指标填报均已上报。'
        }
      }

      return {
        label: '未填报',
        tagType: 'info' as const,
        description: '当前学院还没有填报记录。'
      }
    }

    if (
      workflowStatus === 'APPROVED' ||
      workflowStatus === 'COMPLETED' ||
      workflowStatus === 'FINISHED'
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
        label: '已回退',
        tagType: 'danger' as const,
        description: stepName ? `当前流程已在“${stepName}”环节退回。` : '当前计划审批流程已回退。'
      }
    }

    if (
      stepName ||
      approverName ||
      workflowStatus === 'PENDING' ||
      workflowStatus === 'IN_REVIEW'
    ) {
      const label = formatPendingApprovalLabel(stepName)

      return {
        label,
        tagType: 'warning' as const,
        description:
          candidateNames.length > 0
            ? `当前节点有 ${candidateNames.length} 位可审批人。`
            : stepName
              ? `当前节点：${stepName}`
              : '当前计划正在审批中。'
      }
    }

    if (hasApprovalWorkflowReportBinding.value) {
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

  function resolveExpectedApproverRoleCodesForCurrentPlan(): string[] {
    const stepName = String(
      approvalWorkflowReportSummary.value?.currentStepName ||
        preloadedPlanWorkflowDetail.value?.currentStepName ||
        (currentPlan.value as { currentStepName?: string } | null)?.currentStepName ||
        ''
    ).trim()

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

  function resolveExpectedApproverOrgIdForCurrentPlan(): number | null {
    const plan = currentPlan.value as
      | ({
          currentStepName?: string
          createdByOrgId?: string | number
          targetOrgId?: string | number
        } & Record<string, unknown>)
      | null

    const stepName = String(
      approvalWorkflowReportSummary.value?.currentStepName ||
        preloadedPlanWorkflowDetail.value?.currentStepName ||
        plan?.currentStepName ||
        ''
    ).trim()
    if (!stepName) {
      return null
    }

    if (stepName.includes('战略发展部')) {
      const sourceOrgId = Number(
        preloadedPlanWorkflowDetail.value?.sourceOrgId ?? plan?.createdByOrgId ?? NaN
      )
      return Number.isFinite(sourceOrgId) && sourceOrgId > 0 ? sourceOrgId : null
    }

    if (
      stepName.includes('职能部门审批') ||
      stepName.includes('职能部门终审') ||
      stepName.includes('二级学院审批')
    ) {
      const targetOrgId = Number(
        preloadedPlanWorkflowDetail.value?.targetOrgId ?? plan?.targetOrgId ?? NaN
      )
      return Number.isFinite(targetOrgId) && targetOrgId > 0 ? targetOrgId : null
    }

    return null
  }

  const hydratingPlanDetail = ref(false)
  const departmentViewRequestId = ref(0)
  const departmentViewLoadingRequestId = ref(0)
  let currentPlanReportSummaryPromise: Promise<{
    currentReport: Awaited<ReturnType<typeof indicatorFillApi.getCurrentMonthPlanReport>>
    latestReport: Awaited<ReturnType<typeof indicatorFillApi.getLatestCurrentMonthPlanReport>>
  }> | null = null
  let currentPlanReportSummaryKey = ''

  async function syncCurrentPlanReportSummaries(
    options: { force?: boolean; collegeScope?: boolean } = {}
  ): Promise<void> {
    // 2026-10-19 修复：二级学院 tab 查看的是「职能部门→学院」的上报，报告挂在
    // FUNC_TO_COLLEGE 计划下（如 纪委办→计算机学院 403757），与左侧职能部门自身的
    // STRAT_TO_FUNC 计划不同。此前恒按部门 plan+org 查询，学院链路的自评/说明永远为空。
    const collegeScope = options.collegeScope === true ? resolveSelectedCollegeReportScope() : null
    const planId =
      options.collegeScope === true
        ? Number(collegeScope?.planId ?? NaN)
        : Number(currentPlan.value?.id ?? NaN)
    const reportOrgId =
      options.collegeScope === true
        ? Number(collegeScope?.orgId ?? NaN)
        : Number(currentDepartmentOrgId.value ?? NaN)
    if (
      !(Number.isFinite(planId) && planId > 0 && Number.isFinite(reportOrgId) && reportOrgId > 0)
    ) {
      currentPlanReportSummary.value = null
      latestPlanReportSummary.value = null
      return
    }

    const cacheKey = `${planId}:${reportOrgId}:${timeContext.currentYear}`
    if (
      !options.force &&
      currentPlanReportSummaryPromise &&
      currentPlanReportSummaryKey === cacheKey
    ) {
      logger.debug('[StrategicTaskView] reuse plan report summaries request', { cacheKey })
      const summaries = await currentPlanReportSummaryPromise
      currentPlanReportSummary.value = summaries.currentReport
      latestPlanReportSummary.value = summaries.latestReport
      return
    }

    currentPlanReportSummaryKey = cacheKey
    logger.debug('[StrategicTaskView] load plan report summaries', {
      planId,
      reportOrgId,
      year: timeContext.currentYear,
      force: options.force === true
    })
    currentPlanReportSummaryPromise = indicatorFillApi.getCurrentMonthPlanReportSummaries(
      planId,
      reportOrgId
    )

    try {
      const summaries = await currentPlanReportSummaryPromise
      currentPlanReportSummary.value = summaries.currentReport
      latestPlanReportSummary.value = summaries.latestReport
    } finally {
      currentPlanReportSummaryPromise = null
    }
  }

  const hydrateCurrentPlanWorkflowState = async (options: { force?: boolean } = {}) => {
    const planId = Number(currentPlan.value?.id ?? NaN)
    if (!Number.isFinite(planId) || planId <= 0) {
      return
    }

    const status = currentPlanStatus.value
    // 2026-10-10 跨窗口实时修复：状态守卫读的是本地（可能过期的）计划状态。
    // 他窗"重新发起审批"时本窗状态是 DRAFT/已回退，若守卫拦下 force 刷新，
    // 详情永远拉不回来。force 是明确的"有变更要收敛"信号，必须放行。
    if (!options.force && status !== 'PENDING' && status !== 'DISTRIBUTED') {
      return
    }

    const plan = currentPlan.value as
      | (typeof currentPlan.value & {
          canWithdraw?: boolean
          workflowInstanceId?: number
          currentTaskId?: number
        })
      | null

    const needHydration =
      options.force ||
      (status === 'PENDING' && typeof plan?.canWithdraw !== 'boolean') ||
      plan?.workflowInstanceId == null ||
      plan?.currentTaskId == null

    if (!needHydration || hydratingPlanDetail.value) {
      return
    }

    hydratingPlanDetail.value = true
    try {
      await planStore.loadPlanDetails(planId, { force: true, background: true })
    } catch (error) {
      logger.warn('[StrategicTaskView] 预加载 Plan 工作流详情失败:', { planId, error })
    } finally {
      hydratingPlanDetail.value = false
    }
  }

  const refreshCurrentDepartmentView = async (
    options: { showLoading?: boolean; force?: boolean; reloadIndicators?: boolean } = {}
  ) => {
    const requestId = departmentViewRequestId.value + 1
    departmentViewRequestId.value = requestId
    logger.debug('[StrategicTaskView] refresh department view', {
      requestId,
      department: selectedDepartment.value,
      planId: currentPlan.value?.id ?? null,
      year: timeContext.currentYear,
      force: options.force === true
    })

    if (options.showLoading) {
      pageTransitionLoading.value = true
      departmentViewLoadingRequestId.value = requestId
    }

    try {
      await planStore.loadPlans({ force: options.force, background: true })
      await hydrateCurrentPlanWorkflowState()
      if (options.reloadIndicators === true || strategicStore.indicators.length === 0) {
        await strategicStore.loadIndicatorsByYear(timeContext.currentYear, {
          force: options.force
        })
      }
      // 2026-10-22：刷新/重进页面后回填「待提交新增」标记（sessionStorage 持久化）
      hydratePendingCreatedIndicators()
      await loadCurrentPlanTaskScope({ force: options.force })
      await syncCurrentPlanReportSummaries({ force: options.force })
      if (
        currentPlanStatus.value === 'PENDING' ||
        currentPlanStatus.value === 'DISTRIBUTED' ||
        hasApprovalWorkflowReportBinding.value
      ) {
        await preloadApprovalWorkflowDetail()
      }
    } finally {
      if (options.showLoading && departmentViewLoadingRequestId.value === requestId) {
        pageTransitionLoading.value = false
        departmentViewLoadingRequestId.value = 0
      }
    }
  }

  const PLAN_APPROVAL_SUBMIT_WORKFLOW_CODE = 'PLAN_DISPATCH_STRATEGY'
  const PLAN_APPROVAL_HISTORY_WORKFLOW_CODES = [
    'PLAN_DISPATCH_STRATEGY',
    'PLAN_DISPATCH_FUNCDEPT',
    'PLAN_APPROVAL_FUNCDEPT',
    'PLAN_APPROVAL_COLLEGE',
    'PLAN_MUTATION_STRATEGY'
  ] as const

  const approvalSetupDialogVisible = ref(false)
  const approvalPreviewLoading = ref(false)
  const approvalSubmitting = ref(false)
  const approvalSubmitComment = ref('')
  const approvalWorkflowPreview = ref<WorkflowDefinitionPreviewResponse | null>(null)

  const hasApprovalPreview = computed(() => {
    return (approvalWorkflowPreview.value?.steps?.length || 0) > 0
  })

  const normalizePreviewCandidateDisplayName = (
    candidate: WorkflowDefinitionPreviewResponse['steps'][number]['candidateApprovers'][number]
  ) => {
    return candidate.realName || candidate.username || `用户${candidate.userId}`
  }

  const hasApprovalStepCandidates = (
    candidates?: WorkflowDefinitionPreviewResponse['steps'][number]['candidateApprovers']
  ) => {
    return Array.isArray(candidates) && candidates.length > 0
  }

  const normalizeWorkflowStepName = (value?: string | null) => {
    return String(value || '')
      .replace(/\s+/g, '')
      .trim()
  }

  const getCurrentCycleId = async (): Promise<number> => {
    const cycleResponse = await strategicApi.getCycleByYear(timeContext.currentYear)
    const cycleId =
      (cycleResponse.data as { cycleId?: number; id?: number } | null)?.cycleId ||
      (cycleResponse.data as { id?: number } | null)?.id

    if (!cycleResponse.success || !cycleId) {
      throw new Error(`未找到 ${timeContext.currentYear} 年对应的考核周期`)
    }

    return Number(cycleId)
  }

  const canCurrentUserSubmitCurrentPlan = computed(() => {
    const plan = currentPlan.value as
      | (typeof currentPlan.value & {
          createdByOrgId?: string | number
          createdByOrgName?: string
          targetOrgId?: string | number
          orgId?: string | number
          targetOrgName?: string
          orgName?: string
        })
      | null

    if (!plan || !currentUserOrgId.value || !isCurrentUserReporter.value) {
      return false
    }

    const planOrgId = Number(plan.createdByOrgId ?? NaN)
    if (Number.isFinite(planOrgId) && planOrgId > 0) {
      return currentUserOrgId.value === planOrgId
    }

    const planOrgName = normalizeDepartmentName(plan.createdByOrgName || '')
    const currentUserOrgName = normalizeDepartmentName(
      departmentIdNameMap.value.get(String(currentUserOrgId.value)) || ''
    )

    return Boolean(planOrgName) && planOrgName === currentUserOrgName
  })

  const getTaskTypeForPersistence = (taskCategory?: string): 'BASIC' | 'DEVELOPMENT' => {
    return String(taskCategory || '').trim() === '基础性' ? 'BASIC' : 'DEVELOPMENT'
  }

  const findExistingTaskIdByName = async (
    planId: number,
    taskName: string
  ): Promise<number | null> => {
    const existingTasksResponse = await strategicApi.getTasksByPlanId(planId)
    if (!existingTasksResponse.success || !Array.isArray(existingTasksResponse.data)) {
      return null
    }

    const matchedTask = existingTasksResponse.data.find(
      task => String(task.taskName || '').trim() === taskName
    )
    const matchedTaskId = Number(matchedTask?.taskId ?? matchedTask?.id ?? NaN)
    return Number.isFinite(matchedTaskId) ? matchedTaskId : null
  }

  const ensurePersistedTaskIdForIndicator = async (
    indicator: Pick<
      StrategicIndicator,
      'taskContent' | 'type2' | 'remark' | 'responsibleDept' | 'ownerDept'
    > & {
      taskId?: string | number | null
    }
  ): Promise<number> => {
    const trimmedTaskName = String(indicator.taskContent || '').trim()
    if (!trimmedTaskName) {
      throw new Error('请先填写战略任务')
    }

    const explicitTaskId = Number(indicator.taskId ?? NaN)
    if (Number.isFinite(explicitTaskId) && explicitTaskId > 0) {
      return explicitTaskId
    }

    const plan = currentPlan.value as Record<string, unknown> | null
    const planId = Number(plan?.id ?? plan?.taskId ?? NaN)
    if (!Number.isFinite(planId)) {
      throw new Error('未找到当前部门对应的计划，无法创建战略任务')
    }

    const existingTaskId = await findExistingTaskIdByName(planId, trimmedTaskName)
    if (existingTaskId) {
      return existingTaskId
    }

    const cycleId = await getCurrentCycleId()
    const targetOrgId =
      Number(plan?.targetOrgId ?? plan?.orgId ?? NaN) ||
      resolveDepartmentIdByName(indicator.responsibleDept || selectedDepartment.value) ||
      null
    const createdByOrgId =
      Number(plan?.createdByOrgId ?? NaN) ||
      resolveDepartmentIdByName(indicator.ownerDept || '战略发展部') ||
      null

    if (!targetOrgId || !createdByOrgId) {
      throw new Error('缺少任务归属部门信息，无法创建战略任务')
    }

    const createTaskResponse = await strategicApi.createBackendTask({
      taskName: trimmedTaskName,
      taskType: getTaskTypeForPersistence(indicator.type2),
      planId,
      cycleId,
      orgId: targetOrgId,
      createdByOrgId,
      sortOrder: 0,
      taskDesc: trimmedTaskName,
      remark: indicator.remark || null
    })

    const persistedTaskId = Number(
      createTaskResponse.data?.taskId ?? createTaskResponse.data?.id ?? NaN
    )
    if (!Number.isFinite(persistedTaskId)) {
      throw new Error('创建战略任务成功，但未返回任务ID')
    }

    return persistedTaskId
  }

  const registerTaskLocally = (taskId: string | number, taskType: 'BASIC' | 'DEVELOPMENT') => {
    const normalizedTaskId = String(taskId).trim()
    if (!normalizedTaskId) {
      return
    }

    backendTaskTypeMap.value = {
      ...backendTaskTypeMap.value,
      [normalizedTaskId]: taskType
    }

    currentPlanTaskTypeMap.value = {
      ...currentPlanTaskTypeMap.value,
      [normalizedTaskId]: taskType
    }

    const nextTaskIds = new Set(currentPlanTaskIdSet.value)
    nextTaskIds.add(normalizedTaskId)
    currentPlanTaskIdSet.value = nextTaskIds
  }

  const normalizeEditableText = (value: unknown): string => {
    const trimmed = String(value ?? '').trim()
    if (!trimmed) {
      return ''
    }

    const normalized = trimmed.toLowerCase()
    if (normalized === 'null' || normalized === 'undefined') {
      return ''
    }

    return trimmed
  }

  const persistTaskContentEdit = async (row: StrategicIndicator, taskName: string) => {
    const trimmedTaskName = normalizeEditableText(taskName)
    if (!trimmedTaskName) {
      throw new Error('战略任务名称不能为空')
    }

    const existingTaskId = getIndicatorTaskId(row)
    if (existingTaskId) {
      await strategicApi.updateTaskName(existingTaskId, trimmedTaskName)
      strategicStore.patchIndicatorsByTaskId(existingTaskId, {
        taskContent: trimmedTaskName
      })
      return
    }

    const taskType = getTaskTypeForPersistence(row.type2)
    const persistedTaskId = await ensurePersistedTaskIdForIndicator({
      taskContent: trimmedTaskName,
      type2: row.type2,
      remark: row.remark,
      responsibleDept: row.responsibleDept,
      ownerDept: row.ownerDept
    })

    await strategicStore.updateIndicator(row.id.toString(), {
      taskId: persistedTaskId
    })
    strategicStore.patchIndicator(row.id.toString(), {
      taskId: String(persistedTaskId),
      taskContent: trimmedTaskName
    })
    registerTaskLocally(persistedTaskId, taskType)
  }

  // 判断 Plan 是否已下发（已审批通过，不能撤回）
  const isPlanDistributed = computed(() => {
    const status = currentPlanStatus.value
    return status === 'DISTRIBUTED'
  })

  const normalizeWorkflowRuntimeValue = (value: unknown): string =>
    String(value || '')
      .trim()
      .toUpperCase()

  const isSubmitLikeWorkflowTask = (task: WorkflowTaskResponse | null | undefined): boolean => {
    const stepNo = Number(task?.stepNo ?? NaN)
    if (Number.isFinite(stepNo) && stepNo === 1) {
      return true
    }

    const stepType = normalizeWorkflowRuntimeValue(task?.stepType)
    if (stepType === 'SUBMIT' || stepType === 'START') {
      return true
    }

    const taskText = normalizeWorkflowRuntimeValue(
      [task?.taskKey, task?.taskName, task?.currentStepName].filter(Boolean).join(' ')
    )
    return (
      taskText.includes('SUBMIT') ||
      taskText.includes('START') ||
      taskText.includes('提交') ||
      taskText.includes('发起')
    )
  }

  const isSubmitLikeWorkflowHistoryItem = (
    item: WorkflowHistoryItem | null | undefined
  ): boolean => {
    const stepText = normalizeWorkflowRuntimeValue(
      [item?.taskName, item?.stepName].filter(Boolean).join(' ')
    )
    return (
      stepText.includes('SUBMIT') ||
      stepText.includes('START') ||
      stepText.includes('提交') ||
      stepText.includes('发起')
    )
  }

  const isCompletedWorkflowTask = (task: WorkflowTaskResponse): boolean => {
    const status = normalizeWorkflowRuntimeValue(task.status)
    return ['APPROVED', 'COMPLETED', 'PASSED'].includes(status) || Boolean(task.approvedAt)
  }

  const isWorkflowHistoryDecision = (item: WorkflowHistoryItem): boolean => {
    const action = normalizeWorkflowRuntimeValue(item.action)
    return action.includes('APPROVE') || action.includes('PASS') || action.includes('REJECT')
  }

  const resolvePreviousCompletedWorkflowTask = (
    pendingTask: WorkflowTaskResponse,
    tasks: WorkflowTaskResponse[]
  ): WorkflowTaskResponse | null => {
    const pendingStepNo = Number(pendingTask.stepNo ?? NaN)
    if (!Number.isFinite(pendingStepNo)) {
      return null
    }

    return (
      tasks
        .filter(task => {
          const taskStepNo = Number(task.stepNo ?? NaN)
          return (
            Number.isFinite(taskStepNo) &&
            taskStepNo < pendingStepNo &&
            isCompletedWorkflowTask(task)
          )
        })
        .sort((left, right) => {
          const leftStepNo = Number(left.stepNo ?? Number.MIN_SAFE_INTEGER)
          const rightStepNo = Number(right.stepNo ?? Number.MIN_SAFE_INTEGER)
          if (leftStepNo !== rightStepNo) {
            return rightStepNo - leftStepNo
          }
          return String(right.approvedAt || right.createdTime || '').localeCompare(
            String(left.approvedAt || left.createdTime || '')
          )
        })[0] || null
    )
  }

  const resolveLatestWorkflowHistoryDecision = (
    history: WorkflowHistoryItem[]
  ): WorkflowHistoryItem | null => {
    return history.filter(isWorkflowHistoryDecision).at(-1) || null
  }

  const isPlanPreviousNodeSubmitterWithdrawStage = computed(() => {
    const detail = preloadedPlanWorkflowDetail.value
    if (!detail) {
      return true
    }

    const tasks = Array.isArray(detail.tasks) ? detail.tasks : []
    const pendingTask = currentPendingPlanWorkflowTask.value
    if (tasks.length > 0 && !pendingTask) {
      return false
    }

    if (pendingTask && isSubmitLikeWorkflowTask(pendingTask)) {
      return false
    }

    if (pendingTask) {
      const previousTask = resolvePreviousCompletedWorkflowTask(pendingTask, tasks)
      if (previousTask) {
        return isSubmitLikeWorkflowTask(previousTask)
      }
    }

    const history = Array.isArray(detail.history) ? detail.history : []
    const latestHistoryDecision = resolveLatestWorkflowHistoryDecision(history)
    if (latestHistoryDecision) {
      return isSubmitLikeWorkflowHistoryItem(latestHistoryDecision)
    }

    return true
  })

  const hasPlanWorkflowNodeEvidence = computed(() => {
    const detail = preloadedPlanWorkflowDetail.value
    const hasTaskEvidence = Array.isArray(detail?.tasks) && detail.tasks.length > 0
    const hasHistoryEvidence = Array.isArray(detail?.history) && detail.history.length > 0
    return hasTaskEvidence || hasHistoryEvidence
  })

  // 判断 Plan 是否可以撤回
  // 业务口径：只允许“上一个已完成节点是填报/提交节点”时撤回。
  // 上一个节点一旦变成审批人节点，后续审批中即使后端 canWithdraw 仍为 true，前端也必须置灰。
  // 撤回权限只跟当前部门填报人走，不在前端额外放宽跨部门管理权限。
  const canWithdrawPlan = computed(() => {
    const status = currentPlanStatus.value
    const workflowStatus = currentApprovalWorkflowStatus.value
    const canWithdrawFlag =
      preloadedPlanWorkflowDetail.value?.canWithdraw ??
      (approvalWorkflowReportSummary.value as { canWithdraw?: boolean } | null)?.canWithdraw ??
      currentPlan.value?.canWithdraw

    if (status === 'DISTRIBUTED') {
      return false
    }

    const isPendingWorkflow =
      status === 'PENDING' || ['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(workflowStatus)
    const isSubmitterWithdrawStage = isPlanPreviousNodeSubmitterWithdrawStage.value
    const isWorkflowNodeWithdrawable = hasPlanWorkflowNodeEvidence.value
      ? isSubmitterWithdrawStage
      : Boolean(canWithdrawFlag)

    return isPendingWorkflow && isCurrentUserReporter.value && isWorkflowNodeWithdrawable
  })

  // 判断当前页面指标是否已进入“不可编辑”的流程阶段
  // @requirement: Plan-centric status - 使用 Plan 状态判断指标是否在流程中
  // 统一使用 Plan 状态作为口径，一个 Plan 下的所有指标共享同一个状态
  const isIndicatorInFlowStage = (_indicator: StrategicIndicator): boolean => {
    // Plan 处于待审核或已下发状态时，指标都处于流程中
    return currentPlanStatus.value === 'DISTRIBUTED' || currentPlanStatus.value === 'PENDING'
  }

  // 判断是否可以编辑（未下发状态才能编辑）
  const canEditIndicators = computed(() => {
    if (isReadOnly.value) {
      return false
    }
    if (!canEdit.value) {
      return false
    }
    return !hasDistributedIndicators.value
  })

  // @requirement: Plan-centric status - 使用 Plan 状态判断是否可以删除指标
  // 只有 Plan 处于草稿状态时才能删除指标
  /**
   * 删除按钮可见性。
   * 草稿计划：直接删除（原有路径）。
   * 已下发计划：2026-10-21 用户定案——删除和修改、新增一样走异动审批，
   * 点击后进异动草稿，随「发起异动」整批提交，审批通过后才真正生效。
   */
  const canDeleteIndicator = (indicator: StrategicIndicator): boolean => {
    if (isReadOnly.value) {
      return false
    }
    if (!canEdit.value) {
      return false
    }

    // 必须是有真实ID的指标行（排除分组/汇总等无ID行）
    if (!indicator || indicator.id === null || indicator.id === undefined || indicator.id === '') {
      return false
    }

    // 已有异动在审批中的指标不能再发起删除异动
    if (hasDistributedIndicators.value) {
      return !indicatorMutationInFlight(indicator)
    }

    // Plan 必须处于草稿状态才能直接删除指标
    const isPlanDraft = currentPlanStatus.value === 'DRAFT' || !currentPlanStatus.value
    return isPlanDraft
  }

  /**
   * 2026-10-23 用户定案：二级学院看板也能删，但**只能删子指标**。
   *
   * 口径：核心指标是战略发展部下发给职能部门的，其删除权限归属
   * 「职能部门战略任务管理」那条链路；学院看板里出现的核心指标只是
   * 展示用的分组列，不提供删除入口。
   */
  const canDeleteCollegeIndicator = (indicator: StrategicIndicator): boolean => {
    const parentId = (indicator as { parentIndicatorId?: unknown })?.parentIndicatorId
    if (parentId === null || parentId === undefined || parentId === '') {
      return false
    }
    return canDeleteIndicator(indicator)
  }

  /** 该指标是否已有进行中的异动（后端 mutation_status = IN_MUTATION） */
  const indicatorMutationInFlight = (indicator: StrategicIndicator): boolean => {
    const raw = indicator as { mutationStatus?: unknown; mutation_status?: unknown }
    const status = raw.mutationStatus ?? raw.mutation_status
    return (
      String(status || '')
        .trim()
        .toUpperCase() === 'IN_MUTATION'
    )
  }

  const currentPendingPlanWorkflowTask = computed(() => {
    const detail = preloadedPlanWorkflowDetail.value
    if (!detail || !Array.isArray(detail.tasks) || detail.tasks.length === 0) {
      return null
    }

    const currentTaskId = String(detail.currentTaskId || '').trim()
    if (currentTaskId) {
      const matchedCurrentTask = detail.tasks.find(
        task => String(task.taskId || '') === currentTaskId
      )
      if (
        matchedCurrentTask &&
        String(matchedCurrentTask.status || '')
          .trim()
          .toUpperCase() === 'PENDING'
      ) {
        return matchedCurrentTask
      }
    }

    return (
      detail.tasks.find(
        task =>
          String(task.status || '')
            .trim()
            .toUpperCase() === 'PENDING'
      ) || null
    )
  })

  // 判定当前用户是否具备处理「计划当前待审节点」的权限。
  // 2026-10-27 缺陷修复（填报人点「发起审批」后瞬时闪成「处理审批」+ 红点）：
  // 提交成功后 applyLocalPlanWorkflowUiPatch 会把计划置为 PENDING 并清空
  // preloadedPlanWorkflowDetail，但当前步骤名尚未回填；
  // 旧实现经由 canCurrentUserHandleWorkflowApproval 的兜底（期望角色为空即放行）
  // 得出「我是审批人」，导致按钮/红点在详情回来前误判，约 40ms~数秒后才恢复。
  // 现在改为 fail-closed：解析不出当前节点的期望角色/期望组织就不做审批人推断。
  const hasCurrentPlanApprovalPermission = computed(() => {
    const workflowStatus = currentApprovalWorkflowStatus.value
    const isPendingApproval = ['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(workflowStatus)
    if (!isPendingApproval) {
      return false
    }

    const expectedRoleCodes = resolveExpectedApproverRoleCodesForCurrentPlan()
    if (expectedRoleCodes.length === 0) {
      return false
    }

    const currentRoleCodes = currentUserRoleCodes.value
    if (!expectedRoleCodes.some(roleCode => currentRoleCodes.includes(roleCode))) {
      return false
    }

    const expectedApproverOrgId = resolveExpectedApproverOrgIdForCurrentPlan()
    if (!expectedApproverOrgId) {
      return false
    }

    return Number(currentUserOrgId.value) === Number(expectedApproverOrgId)
  })

  const canHandleCurrentPlanApproval = computed(() => {
    const workflowStatus = currentApprovalWorkflowStatus.value
    const isPendingApproval = ['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(workflowStatus)
    if (!isPendingApproval) {
      return false
    }

    const explicitApproverId = Number(
      preloadedPlanWorkflowDetail.value?.currentApproverId ??
        approvalWorkflowReportSummary.value?.currentApproverId ??
        currentPlan.value?.currentApproverId ??
        0
    )
    const currentUserIdValue = Number(currentUserId.value ?? 0)
    if (
      Number.isFinite(explicitApproverId) &&
      explicitApproverId > 0 &&
      Number.isFinite(currentUserIdValue) &&
      currentUserIdValue > 0
    ) {
      if (explicitApproverId === currentUserIdValue) {
        return true
      }
    }

    const pendingTaskAssigneeId = Number(currentPendingPlanWorkflowTask.value?.assigneeId ?? 0)
    if (
      Number.isFinite(pendingTaskAssigneeId) &&
      pendingTaskAssigneeId > 0 &&
      Number.isFinite(currentUserIdValue) &&
      currentUserIdValue > 0
    ) {
      if (pendingTaskAssigneeId === currentUserIdValue) {
        return true
      }
    }

    // 兜底不再「无条件 true」：必须能解析出期望角色与期望组织并匹配，
    // 与抽屉侧 canCurrentUserHandlePlanApproval 的终局 false 保持一致。
    return hasCurrentPlanApprovalPermission.value
  })

  // @requirement: Plan-centric status - 使用 Plan 状态判断待审批数量
  // Plan 处于 PENDING 状态时，表示有待审批的内容
  const pendingApprovalCount = computed(() => {
    return canHandleCurrentPlanApproval.value ? 1 : 0
  })

  const planUiPhase = computed<'draft' | 'pending_withdrawable' | 'pending_locked' | 'distributed'>(
    () => {
      const status = currentPlanStatus.value
      const workflowStatus = currentApprovalWorkflowStatus.value

      if (status === 'DISTRIBUTED') {
        return 'distributed'
      }

      if (status === 'PENDING' || ['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(workflowStatus)) {
        return canWithdrawPlan.value ? 'pending_withdrawable' : 'pending_locked'
      }

      if (workflowStatus === 'APPROVED') {
        return 'distributed'
      }

      return 'draft'
    }
  )

  const approvalEntryButtonText = computed(() => {
    if (canHandleCurrentPlanApproval.value) {
      return '处理审批'
    }
    return '查看审批'
  })

  // 任务审批抽屉状态
  const taskApprovalVisible = ref(false)
  const retainedRouteApprovalEntityType = ref<'PLAN' | 'PLAN_REPORT' | undefined>(undefined)
  const retainedRouteApprovalEntityId = ref<string | undefined>(undefined)
  watch(taskApprovalVisible, visible => {
    if (visible) {
      return
    }

    retainedRouteApprovalEntityType.value = undefined
    retainedRouteApprovalEntityId.value = undefined
  })

  const { routeApprovalEntityType, routeApprovalEntityId } = useApprovalRouteAutopen({
    supportedEntityTypes: ['PLAN', 'PLAN_REPORT', 'INDICATOR', 'TASK'] as const,
    onAutoOpen: async () => {
      // 2026-10-23 用户定案（异动审批跳转缺陷修复）：异动深链（INDICATOR/TASK）
      // 不携带 PLAN 流程上下文——审批抽屉里的异动卡片由部门级
      // mutation-workflow-entities / mutation-pending-approvals 渲染，
      // 只需选中目标部门、刷新看板后打开抽屉；若把 INDICATOR 塞进
      // workflowEntityType，抽屉会拿指标 ID 去查 PLAN 流程导致详情为空。
      if (
        routeApprovalEntityType.value === 'INDICATOR' ||
        routeApprovalEntityType.value === 'TASK'
      ) {
        try {
          await syncSelectedDepartmentFromRoute()
          await nextTick()
          await refreshCurrentDepartmentView({ showLoading: true, force: true })
        } catch (error) {
          logger.warn('[StrategicTaskView] 异动深链刷新失败，降级使用当前页面数据:', error)
        } finally {
          await nextTick()
          taskApprovalVisible.value = true
        }
        return
      }
      retainedRouteApprovalEntityType.value = routeApprovalEntityType.value as
        | 'PLAN'
        | 'PLAN_REPORT'
        | undefined
      retainedRouteApprovalEntityId.value = routeApprovalEntityId.value
      try {
        await syncSelectedDepartmentFromRoute()
        await nextTick()
        await refreshCurrentDepartmentView({ showLoading: true, force: true })
        await preloadApprovalWorkflowDetail()
      } catch (error) {
        logger.warn('[StrategicTaskView] 自动打开审批前刷新失败，降级使用当前页面数据:', error)
      } finally {
        await nextTick()
        taskApprovalVisible.value = true
      }
    },
    onClearFailure: error => {
      logger.warn('[StrategicTaskView] 清理审批自动打开参数失败:', error)
    }
  })

  const effectiveRouteApprovalEntityType = computed<'PLAN' | 'PLAN_REPORT' | undefined>(() => {
    return routeApprovalEntityType.value || retainedRouteApprovalEntityType.value
  })

  const effectiveRouteApprovalEntityId = computed<string | undefined>(() => {
    return routeApprovalEntityId.value || retainedRouteApprovalEntityId.value
  })

  const primaryApprovalWorkflowEntityType = computed<'PLAN' | 'PLAN_REPORT'>(() => {
    if (effectiveRouteApprovalEntityType.value) {
      return effectiveRouteApprovalEntityType.value
    }

    if (shouldPreferCurrentReportWorkflow.value) {
      return 'PLAN_REPORT'
    }

    const planWorkflowStatus = String(
      preloadedPlanWorkflowDetail.value?.status ||
        currentPlan.value?.workflowStatus ||
        currentPlan.value?.status ||
        ''
    )
      .trim()
      .toUpperCase()
    const hasPlanWorkflowBinding =
      Boolean(preloadedPlanWorkflowDetail.value?.instanceId) ||
      Boolean(currentPlan.value?.workflowInstanceId) ||
      Boolean(currentPlan.value?.currentTaskId) ||
      ['PENDING', 'IN_REVIEW', 'SUBMITTED', 'APPROVED', 'WITHDRAWN', 'REJECTED'].includes(
        planWorkflowStatus
      )

    return hasPlanWorkflowBinding
      ? 'PLAN'
      : hasApprovalWorkflowReportBinding.value
        ? 'PLAN_REPORT'
        : 'PLAN'
  })

  const primaryApprovalWorkflowEntityId = computed<number | string | undefined>(() => {
    if (primaryApprovalWorkflowEntityType.value === 'PLAN') {
      return effectiveRouteApprovalEntityId.value ?? currentPlan.value?.id
    }

    return (
      effectiveRouteApprovalEntityId.value ??
      (hasApprovalWorkflowReportBinding.value
        ? approvalWorkflowReportSummary.value?.id
        : undefined) ??
      currentPlan.value?.id
    )
  })

  const secondaryApprovalWorkflowEntityType = computed<'PLAN' | 'PLAN_REPORT' | undefined>(() => {
    // 战略任务页主流程固定优先展示 PLAN；若存在当前月 PLAN_REPORT，再作为补充历史展示。
    if (
      primaryApprovalWorkflowEntityType.value === 'PLAN' &&
      hasApprovalWorkflowReportBinding.value
    ) {
      return 'PLAN_REPORT'
    }

    if (primaryApprovalWorkflowEntityType.value === 'PLAN_REPORT' && currentPlan.value?.id) {
      return 'PLAN'
    }

    return undefined
  })

  const secondaryApprovalWorkflowEntityId = computed<number | string | undefined>(() => {
    if (secondaryApprovalWorkflowEntityType.value === 'PLAN_REPORT') {
      return approvalWorkflowReportSummary.value?.id ?? latestPlanReportSummary.value?.id
    }

    if (secondaryApprovalWorkflowEntityType.value === 'PLAN') {
      return currentPlan.value?.id
    }

    return undefined
  })

  const currentApprovalWorkflowCode = computed(() => {
    return String(preloadedPlanWorkflowDetail.value?.flowCode || '').trim()
  })

  // ==================== 下发/撤回按钮逻辑 ====================
  // 判断是否有已下发的指标
  const hasDistributedIndicators = computed(() => {
    // 2026-10-20 修复（复盘 P4b：已下发计划的导入按钮点击无反应）：
    // 原实现只看「当前选中计划」状态。同一部门存在多份计划时（如 4040 已下发、
    // 5040/6040 仍草稿），currentPlan 可能选中草稿计划，导致已下发部门仍能进导入流程，
    // 提交时才被后端拦住。改为：当前计划已下发，或该部门存在任一份已下发计划，都算已下发。
    const status = normalizePlanStatus(currentPlan.value?.status)
    if (status === 'DISTRIBUTED' || status === 'PENDING') {
      return true
    }

    const list = indicators.value
    if (list.length === 0) {
      return false
    }

    return list.some(isIndicatorInFlowStage)
  })

  // 判断是否处于"可以下发"状态（Plan 是草稿状态）
  const canDistribute = computed(() => {
    if (isReadOnly.value) {
      return false
    }
    if (!canEdit.value) {
      return false
    }

    // Plan 必须处于草稿状态才能下发
    const canSubmitPlan = currentPlanStatus.value === 'DRAFT' || !currentPlanStatus.value
    if (!canSubmitPlan) {
      return false
    }

    // 有指标且 Plan 处于草稿状态时可以下发
    return indicators.value.length > 0
  })

  // 下发/撤回按钮文本
  // 基于 Plan 状态：
  // - 草稿状态 → 下发
  // - 待审批/已下发状态 → 撤回
  const distributeButtonText = computed(() => {
    if (planUiPhase.value === 'draft') {
      return '发起审批'
    }
    return '撤回'
  })

  // 下发/撤回按钮类型
  const distributeButtonType = computed(() => {
    if (planUiPhase.value === 'draft') {
      return 'success'
    }
    return planUiPhase.value === 'pending_withdrawable' ? 'warning' : 'info'
  })

  // 下发/撤回按钮图标
  const distributeButtonIcon = computed(() => {
    if (planUiPhase.value === 'draft') {
      return Promotion
    }
    return RefreshLeft
  })

  const distributeButtonDisabledReason = computed(() => {
    if (isReadOnly.value) {
      return '历史快照为只读状态'
    }

    if (planUiPhase.value === 'draft' && !canCurrentUserSubmitCurrentPlan.value) {
      return '只有当前计划归属部门的填报人才可以发起审批'
    }

    if (planUiPhase.value === 'draft' && departmentTotalWeight.value !== 100) {
      return '权重未等于百分之百'
    }

    if (planUiPhase.value === 'pending_locked') {
      return isCurrentUserReporter.value
        ? '当前审批进度不支持撤回'
        : '当前登录身份不是填报人，不能撤回'
    }

    if (planUiPhase.value === 'distributed') {
      return '当前状态不可操作'
    }

    return ''
  })

  // 下发/撤回按钮是否禁用
  // 基于 Plan 状态：
  // - 只读状态：禁用
  // - 草稿状态：启用（下发）
  // - 待审批状态：检查是否在第一个节点
  // - 已下发状态：禁用（不可撤回）
  const distributeButtonDisabled = computed(() => {
    return Boolean(distributeButtonDisabledReason.value)
  })

  const resetApprovalSetupDialog = () => {
    approvalWorkflowPreview.value = null
    approvalSubmitComment.value = ''
  }

  const openApprovalSetupDialog = async () => {
    const planId = Number(currentPlan.value?.id ?? NaN)
    if (!Number.isFinite(planId) || planId <= 0) {
      ElMessage.warning('当前部门还没有可提交审批的计划')
      return
    }

    approvalPreviewLoading.value = true
    approvalSetupDialogVisible.value = true

    try {
      const response = await getWorkflowDefinitionPreviewByCode(PLAN_APPROVAL_SUBMIT_WORKFLOW_CODE)
      if (!response.success || !response.data) {
        throw new Error(response.message || '加载审批流程失败')
      }

      approvalWorkflowPreview.value = response.data
    } catch (error) {
      approvalSetupDialogVisible.value = false
      resetApprovalSetupDialog()
      logger.error('[StrategicTaskView] Failed to load workflow preview:', error)
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

  const handleCloseApprovalSetupDialog = () => {
    approvalSetupDialogVisible.value = false
    resetApprovalSetupDialog()
  }

  const refreshApprovalCenterLiveView = async () => {
    await refreshApprovalWorkflowSummaries()
    await preloadApprovalWorkflowDetail()
  }

  const applyLocalPlanWorkflowUiPatch = (target: 'submitted' | 'withdrawn') => {
    const nextStatus = target === 'withdrawn' ? 'WITHDRAWN' : 'IN_REVIEW'
    const nextBusinessStatus = target === 'withdrawn' ? 'DRAFT' : 'SUBMITTED'
    const nextPlanStatus = target === 'withdrawn' ? 'DRAFT' : 'PENDING'
    const nextCanWithdraw = target === 'submitted'

    // 2026-10-10 计划状态即时修复：乐观补丁此前只盖了审批状态摘要，
    // 没更新"计划状态"标签的数据源（planStore 中 plan.status），且提交后
    // 20s UI 挂起会拦截一切能修正它的刷新——计划状态只能等心跳/手动刷新。
    // 这里同步更新计划状态，两个标签与按钮瞬时一致。
    const plan = currentPlan.value as { status?: unknown } | null
    if (plan) {
      plan.status = nextPlanStatus
    }

    currentPlanReportSummary.value = {
      ...(currentPlanReportSummary.value || {}),
      status: nextBusinessStatus,
      workflowStatus: nextStatus,
      canWithdraw: nextCanWithdraw
    }

    if (target === 'submitted') {
      preloadedPlanWorkflowDetail.value = null
      return
    }

    if (preloadedPlanWorkflowDetail.value) {
      preloadedPlanWorkflowDetail.value = {
        ...preloadedPlanWorkflowDetail.value,
        status: nextStatus,
        canWithdraw: nextCanWithdraw
      }
    }
  }

  const confirmPlanApprovalSubmission = async () => {
    if (!ensurePlanCanDistribute()) {
      return
    }

    const planId = Number(currentPlan.value?.id ?? NaN)
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
    planSubmitUiHoldUntil = Date.now() + PLAN_SUBMIT_UI_HOLD_MS
    try {
      await planStore.submitPlanForApproval(planId, {
        workflowCode: preview.workflowCode || PLAN_APPROVAL_SUBMIT_WORKFLOW_CODE,
        comment: approvalSubmitComment.value.trim() || undefined
      })
      applyLocalPlanWorkflowUiPatch('submitted')
      // 2026-09-27 用户反馈：提交成功立即关闭弹窗，重刷新链后台异步执行，
      // 不让用户对着确认框等全量刷新跑完。
      handleCloseApprovalSetupDialog()
      // 2026-10-26 用户反馈：底层 planStore.submitPlanForApproval 已弹「已提交审批」，
      // 这里不再重复弹第二条成功提示（此前页面会同时出现两条堆叠消息）。
      // 只刷新消息铃铛（message 域）；不做全量广播——提交瞬间回源只会拉回
      // 尚未回写的旧审批状态，把乐观补丁冲回「已回退」。
      requestGlobalDataRefresh({
        source: 'message-mutation',
        silent: true,
        domains: ['message']
      })
      void (async () => {
        await waitForPlanWorkflowReady()
        planSubmitUiHoldUntil = 0
        await refreshCurrentDepartmentView({ force: true })
        await refreshApprovalCenterLiveView()
        await preloadApprovalWorkflowDetail()
        await loadPendingPlanApprovalCount()
        notifyApprovalStateRefresh({ source: 'strategic-task-plan-submit' })
      })().catch(error => {
        logger.warn('[StrategicTaskView] post-submit background refresh failed', error)
      })
    } catch (error) {
      planSubmitUiHoldUntil = 0
      logger.error('[StrategicTaskView] Failed to submit plan approval:', error)
    } finally {
      approvalSubmitting.value = false
    }
  }

  // 下发/撤回按钮点击处理
  const handleDistributeOrWithdraw = () => {
    if (distributeButtonDisabled.value) {
      if (distributeButtonDisabledReason.value) {
        ElMessage.warning(distributeButtonDisabledReason.value)
      }
      return
    }

    const status = currentPlanStatus.value

    if (status === 'DRAFT' || !status) {
      // 草稿状态：确认流程后发起整体计划审批
      void openApprovalSetupDialog()
    } else {
      // 待审批/已下发状态：撤回
      if (canWithdrawPlan.value) {
        handleWithdrawAll()
      }
    }
  }

  // 表格引用和选中的指标
  const tableRef = ref<InstanceType<typeof ElTable>>()
  const selectedIndicators = ref<StrategicIndicator[]>([])

  // 当前指标（卡片视图用）
  const currentIndicator = computed(() => {
    const list = indicators.value
    return list[currentIndicatorIndex.value] || null
  })

  const indicatorWorkflowCache = ref<Record<string, IndicatorWorkflowSnapshot | null>>({})
  const currentIndicatorWorkflowLoading = ref(false)

  const currentIndicatorWorkflow = computed(() => {
    const indicatorId = currentIndicator.value?.id
    if (indicatorId === undefined || indicatorId === null) {
      return null
    }
    return indicatorWorkflowCache.value[String(indicatorId)] ?? null
  })

  const canCurrentUserHandleCurrentIndicatorWorkflow = computed(() =>
    canCurrentUserHandleIndicatorWorkflow(
      currentIndicatorWorkflow.value,
      currentUserId.value,
      currentUserPermissionCodes.value
    )
  )

  const loadIndicatorWorkflowSnapshot = async (
    indicatorId: number | string,
    options: { force?: boolean } = {}
  ) => {
    const cacheKey = String(indicatorId)
    if (!options.force && cacheKey in indicatorWorkflowCache.value) {
      return indicatorWorkflowCache.value[cacheKey]
    }

    try {
      const response = await indicatorFillApi.getIndicatorFillHistory(indicatorId)
      const fills = Array.isArray(response.data) ? response.data : []
      const baseSnapshot = resolveLatestIndicatorWorkflowSnapshot(fills)
      let snapshot = baseSnapshot

      if (baseSnapshot?.workflowInstanceId) {
        try {
          const workflowResponse = await getWorkflowInstanceDetail(
            String(baseSnapshot.workflowInstanceId)
          )
          if (workflowResponse.success && workflowResponse.data) {
            snapshot = {
              ...baseSnapshot,
              workflowInstanceId:
                workflowResponse.data.instanceId || baseSnapshot.workflowInstanceId,
              currentTaskId: workflowResponse.data.currentTaskId || baseSnapshot.currentTaskId,
              workflowStatus: workflowResponse.data.status || baseSnapshot.workflowStatus,
              currentStepName:
                workflowResponse.data.currentStepName || baseSnapshot.currentStepName,
              currentApproverId:
                workflowResponse.data.currentApproverId ?? baseSnapshot.currentApproverId,
              currentApproverName:
                workflowResponse.data.currentApproverName || baseSnapshot.currentApproverName
            }
          }
        } catch (error) {
          logger.warn('[StrategicTaskView] 按实例刷新指标工作流快照失败:', {
            indicatorId,
            workflowInstanceId: baseSnapshot.workflowInstanceId,
            error
          })
        }
      } else if (baseSnapshot?.reportId) {
        try {
          const workflowResponse = await getWorkflowInstanceDetailByBusiness(
            'PLAN_REPORT',
            baseSnapshot.reportId
          )
          if (workflowResponse.success && workflowResponse.data) {
            snapshot = {
              ...baseSnapshot,
              workflowInstanceId:
                workflowResponse.data.instanceId || baseSnapshot.workflowInstanceId,
              currentTaskId: workflowResponse.data.currentTaskId || baseSnapshot.currentTaskId,
              workflowStatus: workflowResponse.data.status || baseSnapshot.workflowStatus,
              currentStepName:
                workflowResponse.data.currentStepName || baseSnapshot.currentStepName,
              currentApproverId:
                workflowResponse.data.currentApproverId ?? baseSnapshot.currentApproverId,
              currentApproverName:
                workflowResponse.data.currentApproverName || baseSnapshot.currentApproverName
            }
          }
        } catch (error) {
          logger.warn('[StrategicTaskView] 按业务实体刷新指标工作流快照失败:', {
            indicatorId,
            reportId: baseSnapshot.reportId,
            error
          })
        }
      }

      indicatorWorkflowCache.value = {
        ...indicatorWorkflowCache.value,
        [cacheKey]: snapshot
      }
      return snapshot
    } catch (error) {
      logger.warn('[StrategicTaskView] 加载指标工作流快照失败:', { indicatorId, error })
      indicatorWorkflowCache.value = {
        ...indicatorWorkflowCache.value,
        [cacheKey]: null
      }
      return null
    }
  }

  const refreshIndicatorWorkflowContext = async (indicatorId: number | string) => {
    const workflowSnapshot = await loadIndicatorWorkflowSnapshot(indicatorId, { force: true })
    if (workflowSnapshot?.workflowStatus) {
      const optimisticPlanStatus = ['APPROVED', 'COMPLETED'].includes(
        String(workflowSnapshot.workflowStatus).toUpperCase()
      )
        ? 'DISTRIBUTED'
        : ['REJECTED', 'RETURNED', 'WITHDRAWN', 'CANCELLED'].includes(
              String(workflowSnapshot.workflowStatus).toUpperCase()
            )
          ? 'DRAFT'
          : 'PENDING'

      if (currentPlan.value) {
        currentPlan.value = {
          ...currentPlan.value,
          status: optimisticPlanStatus,
          workflowStatus: workflowSnapshot.workflowStatus,
          currentTaskId: workflowSnapshot.currentTaskId ?? currentPlan.value.currentTaskId,
          currentStepName: workflowSnapshot.currentStepName ?? currentPlan.value.currentStepName,
          currentApproverId:
            workflowSnapshot.currentApproverId ?? currentPlan.value.currentApproverId,
          currentApproverName:
            workflowSnapshot.currentApproverName ?? currentPlan.value.currentApproverName,
          canWithdraw:
            optimisticPlanStatus === 'PENDING'
              ? false
              : optimisticPlanStatus === 'DRAFT'
                ? true
                : false
        }
      }
    }

    invalidateQueries([
      'indicator.list',
      'task.list',
      'plan.detail',
      'workflow.todo',
      'workflow.detail',
      'workflow.instances',
      'workflow.statistics',
      'dashboard.overview',
      buildQueryKey('task', 'list', { year: timeContext.currentYear })
    ])
    const planId = currentPlan.value?.id
    await strategicStore.loadIndicatorsByYear(timeContext.currentYear)
    if (planId !== undefined && planId !== null && planId !== '') {
      await planStore.loadPlanDetails(planId, { force: true, background: true })
    }
    await loadPendingPlanApprovalCount()
    await approvalStore.loadPendingApprovals()
  }

  const refreshTaskPageAfterIndicatorMutation = async () => {
    const planId = currentPlan.value?.id
    resetApprovalWorkflowStateCache()
    const invalidateTargets: Array<string | ReturnType<typeof buildQueryKey>> = [
      'indicator.list',
      'task.list',
      'task.scope',
      'plan.detail',
      'workflow.todo',
      'workflow.detail',
      'workflow.instances',
      'workflow.statistics',
      'dashboard.overview',
      buildQueryKey('task', 'list', { year: timeContext.currentYear })
    ]

    if (planId !== undefined && planId !== null && planId !== '') {
      invalidateTargets.push(
        buildQueryKey('task', 'scope', {
          department: selectedDepartment.value,
          planId: String(planId),
          year: timeContext.currentYear
        })
      )
    }

    invalidateQueries(invalidateTargets)

    // 开始全量并发刷新各维度数据
    await Promise.all([
      strategicStore.loadIndicatorsByYear(timeContext.currentYear, { force: true }),
      loadBackendTaskTypeMap(),
      loadCurrentPlanTaskScope({ force: true }),
      loadPendingPlanApprovalCount(),
      refreshCurrentDepartmentView({ force: true })
    ])
  }

  const isLightGlobalRefreshSource = (source?: GlobalDataRefreshDetail['source']): boolean => {
    return (
      source === 'heartbeat' ||
      source === 'window-focus' ||
      source === 'visibility-return' ||
      // 2026-10-24 跨窗口数据同步：DATA_CHANGED 广播走轻刷新（整表数据静默收敛），
      // 单行精度补丁由 indicator-data-changed 事件单独处理
      source === 'data-change-push'
    )
  }

  const isApprovalDrivenRefreshSource = (source?: GlobalDataRefreshDetail['source']): boolean => {
    return source === 'approval-state-refresh' || source === 'approval-notification'
  }

  const refreshCurrentDepartmentViewLightweight = async (
    detail: GlobalDataRefreshDetail = {}
  ): Promise<void> => {
    const source = detail.source
    const now = Date.now()

    if (isLightGlobalRefreshSource(source)) {
      if (now < lightRefreshBackoffUntil) {
        logger.debug('[StrategicTaskView] skip light refresh during backoff', {
          source,
          waitMs: lightRefreshBackoffUntil - now
        })
        return
      }

      if (now - lastLightRefreshAt < LIGHT_REFRESH_MIN_INTERVAL_MS) {
        logger.debug('[StrategicTaskView] skip duplicated light refresh', {
          source,
          elapsedMs: now - lastLightRefreshAt
        })
        return
      }
    }

    try {
      await Promise.all([
        loadPendingPlanApprovalCount(),
        loadCurrentPlanTaskScope({ force: true }),
        syncCurrentPlanReportSummaries({ force: true })
      ])

      if (isApprovalDrivenRefreshSource(source)) {
        await Promise.allSettled([
          approvalStore.loadPendingApprovals(),
          hydrateCurrentPlanWorkflowState({ force: true })
        ])

        // PR#83 审批流转后重算指标级填报审批态聚合，保持头部「审批状态」与「上报状态」列同步
        void refreshCurrentPlanFillApprovalSummary()

        if (
          currentPlanStatus.value === 'PENDING' ||
          currentPlanStatus.value === 'DISTRIBUTED' ||
          hasApprovalWorkflowReportBinding.value
        ) {
          await preloadApprovalWorkflowDetail()
        }
      } else if (isLightGlobalRefreshSource(source)) {
        // 2026-10-10 跨窗口实时修复③：WS 推送断线时的心跳/聚焦兜底——
        // 强制刷新计划审批详情与待办任务，避免他窗状态流转后本窗状态/按钮卡死。
        // light 源在入口处已有 45s 节流，这里不会造成请求风暴。
        await Promise.allSettled([
          approvalStore.loadPendingApprovals(),
          hydrateCurrentPlanWorkflowState({ force: true })
        ])

        // PR#83 轻量刷新同样重算填报审批态聚合，避免陈旧的 hasSubmitted/hasRejected
        // 覆盖刚刷新出来的终态工作流
        void refreshCurrentPlanFillApprovalSummary()
        if (currentPlanStatus.value === 'PENDING' || currentPlanStatus.value === 'DISTRIBUTED') {
          await preloadApprovalWorkflowDetail()
        }
      }

      if (isLightGlobalRefreshSource(source)) {
        lastLightRefreshAt = Date.now()
      }
    } catch (error) {
      const errorCode =
        error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      const errorMessage =
        error instanceof Error
          ? error.message
          : error && typeof error === 'object' && 'message' in error
            ? String(error.message)
            : ''

      if (
        isLightGlobalRefreshSource(source) &&
        (errorCode === 'ECONNABORTED' || errorMessage.toLowerCase().includes('timeout'))
      ) {
        lightRefreshBackoffUntil = Date.now() + LIGHT_REFRESH_BACKOFF_MS
      }

      throw error
    }
  }

  const handleApproveCurrentIndicatorWorkflow = async () => {
    const indicator = currentIndicator.value
    const snapshot = currentIndicatorWorkflow.value
    if (!indicator || !snapshot?.currentTaskId) {
      ElMessage.warning('当前指标没有可审批的工作流任务')
      return
    }
    if (!canCurrentUserHandleCurrentIndicatorWorkflow.value) {
      ElMessage.warning('当前审批节点不是你，或当前账号缺少报告审批权限')
      return
    }

    try {
      const { value } = await ElMessageBox.prompt('请输入审批意见（可选）', '审批通过', {
        confirmButtonText: '确认通过',
        cancelButtonText: '取消',
        inputType: 'textarea'
      })
      const loading = ElLoading.service({ lock: true, text: '正在审批...' })
      try {
        await approveTask(String(snapshot.currentTaskId), {
          comment: value || '审批通过'
        })
        ElMessage.success('审批通过成功')
        await refreshIndicatorWorkflowContext(indicator.id)
      } finally {
        loading.close()
      }
    } catch {
      // user cancelled
    }
  }

  const handleRejectCurrentIndicatorWorkflow = async () => {
    const indicator = currentIndicator.value
    const snapshot = currentIndicatorWorkflow.value
    if (!indicator || !snapshot?.currentTaskId) {
      ElMessage.warning('当前指标没有可审批的工作流任务')
      return
    }
    if (!canCurrentUserHandleCurrentIndicatorWorkflow.value) {
      ElMessage.warning('当前审批节点不是你，或当前账号缺少报告审批权限')
      return
    }

    try {
      const { value } = await ElMessageBox.prompt('请输入驳回原因', '审批驳回', {
        confirmButtonText: '确认驳回',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputValidator: input => (String(input || '').trim() ? true : '请填写驳回原因')
      })
      const loading = ElLoading.service({ lock: true, text: '正在驳回...' })
      try {
        await rejectTask(String(snapshot.currentTaskId), {
          reason: String(value).trim()
        })
        ElMessage.success('审批驳回成功')
        await refreshIndicatorWorkflowContext(indicator.id)
      } finally {
        loading.close()
      }
    } catch {
      // user cancelled
    }
  }

  // 切换视图模式
  const _toggleViewMode = () => {
    viewMode.value = viewMode.value === 'table' ? 'card' : 'table'
    // 切换到卡片视图时，如果没有指标则重置索引
    if (viewMode.value === 'card' && indicators.value.length === 0) {
      currentIndicatorIndex.value = 0
    }
  }

  // 卡片视图导航
  const goToPrevIndicator = () => {
    if (currentIndicatorIndex.value > 0) {
      currentIndicatorIndex.value--
    }
  }

  const goToNextIndicator = () => {
    if (currentIndicatorIndex.value < indicators.value.length - 1) {
      currentIndicatorIndex.value++
    }
  }

  // 跳转到指定指标
  const _goToIndicator = (index: number) => {
    if (index >= 0 && index < indicators.value.length) {
      currentIndicatorIndex.value = index
    }
  }

  // 从 Store 获取任务列表
  const taskList = computed(() =>
    strategicStore.tasks.map(t => ({
      id: Number(t.id),
      title: t.title,
      desc: t.desc,
      createTime: t.createTime,
      cycle: t.cycle
    }))
  )

  // 当前选中的任务
  const _currentTask = computed(
    () =>
      taskList.value[currentTaskIndex.value] || {
        id: 0,
        title: '暂无任务',
        desc: '',
        createTime: '',
        cycle: ''
      }
  )

  // 2026-10-19 修复（上级/本级看不见自评等级与进度说明）：战略任务管理页此前没有把
  // 「当期报告明细」覆盖到行上——自评等级/进度说明列永远为空。与指标填报页的
  // applyReportDetailOverlay 同构：按 indicatorId 把报告明细覆盖到行。
  const reportDetailByIndicatorId = computed(() => {
    const map = new Map<string, Record<string, unknown>>()
    const details = (currentPlanReportSummary.value as { indicatorDetails?: unknown } | null)
      ?.indicatorDetails
    if (Array.isArray(details)) {
      details.forEach((detail: Record<string, unknown>) => {
        const indicatorId = detail?.indicatorId
        if (indicatorId !== undefined && indicatorId !== null) {
          map.set(String(indicatorId), detail)
        }
      })
    }
    return map
  })

  const applyReportDetailOverlayToRow = <T>(row: T): T => {
    const indicatorId = (row as { id?: unknown } | null)?.id
    const detail = reportDetailByIndicatorId.value.get(String(indicatorId))
    if (!detail) {
      return row
    }
    const remark = String(detail.description ?? detail.comment ?? '').trim()
    const attachments = detail.attachments
    const current = row as {
      selfRating?: string | null
      pendingRemark?: string | null
      pendingAttachmentDetails?: StrategicIndicator['pendingAttachmentDetails']
    }
    return {
      ...(row as object),
      selfRating: (detail.selfRating as string | null) || current.selfRating,
      pendingRemark: remark || current.pendingRemark || null,
      pendingAttachmentDetails: Array.isArray(attachments)
        ? (attachments as StrategicIndicator['pendingAttachmentDetails'])
        : current.pendingAttachmentDetails
    } as T
  }

  // 2026-10-19 修复（二级学院链路组织错配）：二级学院表展示的是「当前职能部门 → 选中学院」
  // 的上报，报告挂在 FUNC_TO_COLLEGE 计划（如 纪委办→计算机学院 403757）下，
  // 与左侧选中职能部门的 STRAT_TO_FUNC 计划不同。解析失败时返回 null（宁可空，不串数据）。
  const resolveSelectedCollegeReportScope = (): { planId: number; orgId: number } | null => {
    const collegeOrgId = resolveDepartmentIdByName(selectedCollege.value)
    const funcOrgId = resolveDepartmentIdByName(selectedDepartment.value)
    if (!collegeOrgId || !funcOrgId) {
      return null
    }
    const planCombination = plan => {
      const planAny = plan as Record<string, unknown>
      const level = String(planAny.planLevel ?? planAny.plan_level ?? '')
        .trim()
        .toUpperCase()
      return {
        match:
          level === 'FUNC_TO_COLLEGE' &&
          Number(planAny.targetOrgId ?? planAny.orgId ?? NaN) === collegeOrgId &&
          Number(planAny.createdByOrgId ?? planAny.created_by_org_id ?? NaN) === funcOrgId,
        year: resolvePlanYear(planAny)
      }
    }
    // 跨年度同组合计划并存（如 403757/503757），必须优先命中年份精确等于当年的；
    // 年度不可判定的（resolvePlanYear 返回 null，如 cycleId 不在已知映射内）仅作兜底，
    // 否则会把其他年度的空计划当成当前查询目标，明细恒为空。
    const combinationPlans = planStore.plans
      .map(plan => ({ plan, ...planCombination(plan) }))
      .filter(candidate => candidate.match)
    const matchedPlan =
      combinationPlans.find(candidate => candidate.year === timeContext.currentYear)?.plan ||
      combinationPlans.find(candidate => candidate.year === null)?.plan ||
      null
    if (!matchedPlan?.id) {
      return null
    }
    return { planId: Number(matchedPlan.id), orgId: collegeOrgId }
  }

  // 从 Store 获取指标列表（带里程碑），按年份和部门过滤，按任务类型和战略任务分组排序
  const indicators = computed(() => {
    // 过滤当前年份的指标
    let list = normalizedIndicators.value.filter(
      i => resolveIndicatorYear(i, timeContext.currentYear) === timeContext.currentYear
    )

    // 左侧部门未确定前不要回退成“显示全部部门”，避免切页返回时短暂展示全量任务。
    if (!selectedDepartment.value) {
      return []
    }

    // 根据选中的部门筛选指标
    list = list.filter(
      i =>
        i.ownerDept === '战略发展部' && // 由战略发展部创建的指标
        i.responsibleDept === selectedDepartment.value && // 下发给选中部门的指标
        i.isStrategic === true && // 只显示战略指标，不显示子指标
        isIndicatorInCurrentPlanScope(i) // 严格限定当前计划任务范围
    )

    const mappedList = list.map(i => ({
      ...applyReportDetailOverlayToRow(i),
      // type2 仅用于展示标签；业务判断统一走 task_type 映射。
      type2: getIndicatorCategoryLabel(i)
    }))

    // 先按任务类型（后端 task_type）排序，再按任务名称排序
    return mappedList.sort((a, b) => {
      const taskTypeA = getIndicatorMappedTaskType(a)
      const taskTypeB = getIndicatorMappedTaskType(b)
      if (taskTypeA !== taskTypeB) {
        // 发展性优先，其次基础性，最后其他类型
        const rank = (taskType: string) => {
          if (isDevelopmentTaskType(taskType)) {
            return 0
          }
          if (isBasicTaskType(taskType)) {
            return 1
          }
          return 2
        }
        return rank(taskTypeA) - rank(taskTypeB)
      }
      // 2026-10-27 用户定案：组内按下发顺序（sort_order + id）对齐——
      // 与指标填报页/学院视图保持同一顺序
      const orderA = Number(a.sortOrder ?? 0) || 0
      const orderB = Number(b.sortOrder ?? 0) || 0
      if (orderA !== orderB) {
        return orderA - orderB
      }
      return Number(a.id) - Number(b.id)
    })
  })

  watch(
    () => currentIndicator.value?.id,
    async indicatorId => {
      if (indicatorId === undefined || indicatorId === null) {
        return
      }
      currentIndicatorWorkflowLoading.value = true
      try {
        await loadIndicatorWorkflowSnapshot(indicatorId)
      } finally {
        currentIndicatorWorkflowLoading.value = false
      }
    },
    { immediate: true }
  )

  const taskSpanMetaMap = computed(() => {
    const map = new Map<number, { rowspan: number; colspan: number }>()
    const dataList = indicators.value

    let startIndex = 0
    while (startIndex < dataList.length) {
      const currentTask = dataList[startIndex].taskContent || '未关联任务'
      let endIndex = startIndex + 1

      while (
        endIndex < dataList.length &&
        (dataList[endIndex].taskContent || '未关联任务') === currentTask
      ) {
        endIndex++
      }

      map.set(startIndex, { rowspan: endIndex - startIndex, colspan: 1 })
      for (let index = startIndex + 1; index < endIndex; index++) {
        map.set(index, { rowspan: 0, colspan: 0 })
      }

      startIndex = endIndex
    }

    return map
  })

  const taskGroupRowsMap = computed(() => {
    const map = new Map<string, StrategicIndicator[]>()

    indicators.value.forEach(indicator => {
      const taskContent = indicator.taskContent || '未命名任务'
      const groupRows = map.get(taskContent)
      if (groupRows) {
        groupRows.push(indicator)
        return
      }
      map.set(taskContent, [indicator])
    })

    return map
  })

  // 计算单元格合并信息
  const getSpanMethod = ({
    row: _row,
    column: _column,
    rowIndex,
    columnIndex
  }: {
    row: Record<string, unknown>
    column: unknown
    rowIndex: number
    columnIndex: number
  }) => {
    // 战略任务列需要合并
    if (columnIndex === 0) {
      return taskSpanMetaMap.value.get(rowIndex) ?? { rowspan: 1, colspan: 1 }
    }
    return { rowspan: 1, colspan: 1 }
  }

  // 获取当前行所属的任务组
  const getTaskGroup = (row: StrategicIndicator) => {
    const taskContent = row.taskContent || '未命名任务'
    return { taskContent, rows: taskGroupRowsMap.value.get(taskContent) ?? [] }
  }

  // 获取任务级别状态（基于 Plan 的状态）
  // Plan-centric: 状态由 Plan 控制，不是指标自己的 canWithdraw 字段
  const getTaskStatus = (_row: StrategicIndicator) => {
    const planStatus = currentPlanStatus.value

    // 根据 Plan 状态返回对应的显示
    if (planStatus === 'DRAFT' || !planStatus) {
      return { label: '待下发', type: 'info', canWithdraw: true }
    }
    if (planStatus === 'DISTRIBUTED') {
      return { label: '已下发', type: 'success', canWithdraw: false }
    }
    if (planStatus === 'PENDING') {
      return { label: '审批中', type: 'warning', canWithdraw: false }
    }
    // 默认返回待下发
    return { label: '待下发', type: 'info', canWithdraw: true }
  }

  const getPersistedWithdrawableRows = (rows: StrategicIndicator[]): StrategicIndicator[] => {
    return rows.filter(row => {
      const normalizedId = String(row.id ?? '').trim()
      return Boolean(normalizedId) && /^\d+$/.test(normalizedId)
    })
  }

  // 撤回整个任务（撤回同一战略任务下的所有指标）
  const _handleWithdrawTask = async (row: StrategicIndicator) => {
    const group = getTaskGroup(row)
    const distributedRows = getPersistedWithdrawableRows(group.rows)

    if (distributedRows.length === 0) {
      ElMessage.warning('该任务下没有已下发的指标')
      return
    }

    ElMessageBox.confirm(
      `确认撤回任务 "${group.taskContent}" 下的 ${distributedRows.length} 个已下发指标？`,
      '撤回确认',
      {
        confirmButtonText: '确认撤回',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
      .then(async () => {
        // 显示加载状态
        const loading = ElMessage({
          message: '正在撤回指标...',
          type: 'info',
          duration: 0
        })

        try {
          // 等待所有指标撤回完成
          await Promise.all(
            distributedRows.map(r => strategicStore.withdrawIndicator(r.id.toString()))
          )

          await refreshTaskPageAfterIndicatorMutation()
          loading.close()
          ElMessage.success(`已成功撤回 ${distributedRows.length} 个指标`)
          updateEditTime()
        } catch (err) {
          loading.close()
          ElMessage.error('撤回失败，请稍后重试')
          logger.error('Withdraw task failed:', err)
        }
      })
      .catch(() => {
        // 用户取消操作
      })
  }

  // 格式化更新时间
  const _formatUpdateTime = (time: string | Date | undefined) => {
    if (!time) {
      return '-'
    }
    const date = new Date(time)
    return `${date.getMonth() + 1}/${date.getDate()}`
  }

  const formatDetailDate = (time: string | Date | undefined) => {
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

  // 获取进度数字的样式类
  const _getProgressClass = (progress: number) => {
    if (progress >= 80) {
      return 'progress-success'
    }
    if (progress >= 50) {
      return 'progress-warning'
    }
    return 'progress-danger'
  }

  // 按类别筛选指标（基于后端 task_type）
  const developmentIndicators = computed(() =>
    indicators.value.filter(i => isDevelopmentTaskType(getIndicatorMappedTaskType(i)))
  )
  const basicIndicators = computed(() =>
    indicators.value.filter(i => isBasicTaskType(getIndicatorMappedTaskType(i)))
  )

  const groupIndicatorsByTask = (list: StrategicIndicator[]) => {
    const groups: Array<{ taskContent: string; rows: StrategicIndicator[] }> = []
    const indexMap: Record<string, number> = {}

    list.forEach(item => {
      const key = item.taskContent || '未命名任务'
      if (indexMap[key] === undefined) {
        groups.push({ taskContent: key, rows: [item] })
        indexMap[key] = groups.length - 1
      } else {
        groups[indexMap[key]].rows.push(item)
      }
    })

    return groups
  }

  const _groupedDevelopmentIndicators = computed(() =>
    groupIndicatorsByTask(developmentIndicators.value)
  )
  const _groupedBasicIndicators = computed(() => groupIndicatorsByTask(basicIndicators.value))

  // 获取已有的任务名称列表（从当前部门的指标中提取）
  const existingTaskNames = computed(() => {
    // 从当前显示的指标中提取已使用的 taskContent（战略任务名称）
    const taskNames = indicators.value
      .filter(i => i.taskContent && i.taskContent !== '未命名任务')
      .map(i => i.taskContent)

    // 去重
    return [...new Set(taskNames)]
  })

  // 获取任务名称对应的任务类型映射
  const taskTypeMap = computed(() => {
    const map: Record<string, '发展性' | '基础性'> = {}
    indicators.value.forEach(i => {
      if (i.taskContent && i.taskContent !== '未命名任务') {
        const category = getTaskCategoryLabel(getIndicatorMappedTaskType(i))
        if (category === '发展性' || category === '基础性') {
          map[i.taskContent] = category
        }
      }
    })
    return map
  })

  const preservePrefilledTaskBindingOnce = ref(false)

  // 选择战略任务时自动更新任务类型
  const handleTaskSelect = (taskName: string) => {
    if (preservePrefilledTaskBindingOnce.value && String(newRow.value.taskId || '').trim()) {
      preservePrefilledTaskBindingOnce.value = false
      return
    }

    newRow.value.taskId = ''

    if (taskTypeMap.value[taskName]) {
      newRow.value.type2 = taskTypeMap.value[taskName]
    }

    void (async () => {
      const plan = currentPlan.value as Record<string, unknown> | null
      const planId = Number(plan?.id ?? plan?.taskId ?? NaN)
      if (!Number.isFinite(planId) || planId <= 0) {
        return
      }

      const existingTaskId = await findExistingTaskIdByName(planId, taskName)
      if (existingTaskId) {
        newRow.value.taskId = String(existingTaskId)
      }
    })()
  }

  // 战略任务选择器ref
  const taskSelectRef = ref<{
    $el?: { querySelector: (selector: string) => HTMLInputElement }
  } | null>(null)

  // 处理战略任务下拉框关闭 - 保存输入的值
  const handleTaskVisibleChange = (visible: boolean) => {
    if (!visible && taskSelectRef.value) {
      // 下拉框关闭时，如果有输入内容但未选择，则保存输入的值
      const inputEl = taskSelectRef.value.$el?.querySelector('input')
      const inputValue = inputEl?.value || ''
      if (inputValue.trim() && !newRow.value.taskContent) {
        newRow.value.taskContent = inputValue.trim()
        newRow.value.taskId = ''
      }
    }
  }

  // 2026-10-10：新增行战略任务改用 el-autocomplete——
  // 手输内容失焦即保留在 v-model（原 el-select allow-create 不按回车会回退丢字），
  // 失焦时若与已有任务精确匹配则自动绑定任务类型与任务 ID。
  const querySearchTask = (queryString: string, cb: (results: { value: string }[]) => void) => {
    const q = queryString.trim().toLowerCase()
    const results = existingTaskNames.value
      .filter(name => !q || name.toLowerCase().includes(q))
      .map(name => ({ value: name }))
    cb(results)
  }

  const onTaskOptionSelect = (item: { value: string }) => {
    newRow.value.taskContent = item.value
    handleTaskSelect(item.value)
  }

  const onTaskInputBlur = (event: FocusEvent) => {
    const text = String((event.target as HTMLInputElement)?.value || '').trim()
    if (text && existingTaskNames.value.includes(text)) {
      handleTaskSelect(text)
    }
  }

  // 新增行数据
  const newRow = ref({
    taskId: '',
    taskContent: '',
    name: '',
    type1: '定量' as '定性' | '定量',
    type2: '基础性' as '发展性' | '基础性',
    weight: 0,
    remark: '',
    /** 2026-10-23：二级学院 tab 新增子指标时，必须指定挂靠的核心指标 */
    parentIndicatorId: '' as string
  })

  /**
   * 2026-10-23 用户定案：二级学院 tab 的「新增行」= 给该学院建子指标。
   *
   * 复用「指标下发与管理」页新增子指标的同一套契约：
   *   ownerOrgId  = 当前选中的职能部门（创建方）
   *   targetOrgId = 当前选中的学院（接收方）
   *   parentIndicatorId = 所选核心指标
   * 与战略部直接建核心指标（parentIndicatorId 为空）严格区分。
   */
  const collegeAddMode = ref(false)

  /**
   * 二级学院 tab 可挂靠的核心指标。
   *
   * 数据口径（实测）：核心指标 ownerDept=战略发展部、responsibleDept=职能部门；
   * 子指标 ownerDept=职能部门、responsibleDept=学院。
   * 因此「当前职能部门可下发给该学院的核心指标」= 无父指标 + responsibleDept=当前职能部门。
   * 学院只作为接收方（targetOrgId），不参与父指标筛选。
   */
  const collegeParentIndicatorOptions = computed(() => {
    const ownerDept = normalizeDepartmentName(selectedDepartment.value || '')
    if (!ownerDept) {
      return []
    }
    const seen = new Set<string>()
    const options: Array<{ id: string; name: string; taskContent: string }> = []
    normalizedIndicators.value.forEach(item => {
      if (item.parentIndicatorId) {
        return
      }
      const candidate = item as {
        targetDepartment?: string
        targetOrgName?: string
        responsibleDept?: string
      }
      const deptName = normalizeDepartmentName(
        String(
          candidate.targetDepartment ?? candidate.targetOrgName ?? candidate.responsibleDept ?? ''
        )
      )
      if (deptName !== ownerDept && !deptName.includes(ownerDept)) {
        return
      }
      const key = String(item.id)
      if (seen.has(key)) {
        return
      }
      seen.add(key)
      options.push({
        id: key,
        name: String(item.name || ''),
        taskContent: String(item.taskContent || '')
      })
    })
    return options
  })

  /** 二级学院 tab 新增子指标：校验 → 调后端 createIndicator → 进待发起异动列表 */
  const saveCollegeChildIndicator = async (weight: number) => {
    if (!selectedCollege.value) {
      ElMessage.warning('请先在左侧选择学院')
      return
    }
    const parentIdRaw = String(newRow.value.parentIndicatorId || '').trim()
    if (!parentIdRaw) {
      ElMessage.warning('请选择关联的核心指标')
      return
    }
    const parentIndicatorId = Number(parentIdRaw)
    if (!Number.isFinite(parentIndicatorId) || parentIndicatorId <= 0) {
      ElMessage.warning('关联的核心指标无效')
      return
    }
    const ownerOrgId = resolveDepartmentIdByName(selectedDepartment.value)
    const targetOrgId = resolveDepartmentIdByName(selectedCollege.value)
    if (!ownerOrgId) {
      ElMessage.warning(`无法解析当前职能部门：${selectedDepartment.value}`)
      return
    }
    if (!targetOrgId) {
      ElMessage.warning(`无法解析目标学院：${selectedCollege.value}`)
      return
    }
    const parentOption = collegeParentIndicatorOptions.value.find(o => o.id === parentIdRaw)
    const parentRow = strategicStore.indicators.find(
      item => String(item.id) === String(parentIndicatorId)
    )
    const taskId = Number(getIndicatorTaskId(parentRow as StrategicIndicator))
    if (!Number.isFinite(taskId) || taskId <= 0) {
      ElMessage.warning('关联的核心指标缺少有效任务，无法新增子指标')
      return
    }

    const loading = ElLoading.service({
      lock: true,
      text: '正在保存子指标...',
      background: 'rgba(0, 0, 0, 0.7)'
    })
    try {
      const createResp = await indicatorApi.createIndicator({
        taskId,
        indicatorDesc: String(newRow.value.name || '').trim(),
        ownerOrgId,
        targetOrgId,
        weightPercent: weight,
        sortOrder: 0,
        remark: newRow.value.remark || '',
        progress: 0,
        year: timeContext.currentYear,
        canWithdraw: false,
        parentIndicatorId,
        type: newRow.value.type1
      })
      if (!createResp.success || !createResp.data) {
        throw new Error(createResp.message || '创建子指标失败')
      }
      const createdId = Number(createResp.data.id)
      if (!Number.isFinite(createdId) || createdId <= 0) {
        throw new Error('后端返回的子指标缺少有效 ID')
      }
      pendingCreatedIndicatorIds.value = [...pendingCreatedIndicatorIds.value, createdId]
      ElMessage.info('子指标已新增；请确认学院指标权重合计为 100 后点顶部「发起异动」提交审批')
      logger.info('[StrategicTaskView] 学院 tab 新增子指标:', {
        createdId,
        parentIndicatorId,
        ownerOrgId,
        targetOrgId,
        taskContent: parentOption?.taskContent
      })
      await refreshTaskPageAfterIndicatorMutation()
      cancelAdd()
      updateEditTime()
    } catch (error) {
      logger.error('[StrategicTaskView] 学院 tab 新增子指标失败:', error)
      ElMessage.error((error as { message?: string })?.message || '新增子指标失败')
    } finally {
      loading.close()
    }
  }

  // 任务下发相关状态
  const showAssignmentDialog = ref(false)
  const assignmentTarget = ref('')
  const assignmentMethod = ref<'self' | 'college'>('self')

  // 当前日期
  const _currentDate = '2025年12月5日'

  // 编辑状态管理（任务详情）
  const editingField = ref<string | null>(null)
  const editingValue = ref('')

  // 指标列表编辑状态
  const editingIndicatorId = ref<number | null>(null)
  const editingIndicatorField = ref<string | null>(null)
  const editingIndicatorValue = ref<Record<string, unknown> | null>(null)
  // 2026-10-26 修复：进入编辑时记录原值快照——失焦比对用快照而不是 row[field]。
  // 此前用 row 字段当原值，在合并单元格表格下 row 引用错位会读到 undefined，
  // 被 applyMutationDraftChange 误判为「有变化」→ 没改内容也入异动草稿、按钮误现。
  const editingIndicatorOriginal = ref<unknown>(null)
  const isSavingIndicatorEdit = ref(false)
  const savingIndicatorId = ref<number | null>(null)
  const savingIndicatorField = ref<string | null>(null)

  // 任务详情双击编辑处理
  const _handleDoubleClick = (field: 'title' | 'desc' | 'cycle' | 'createTime', value: string) => {
    if (!canEdit.value) {
      return
    }
    editingField.value = field
    editingValue.value = value
  }

  // 任务详情保存编辑
  const _saveEdit = (field: 'title' | 'desc' | 'cycle' | 'createTime') => {
    // 如果值没有变化或者被清空（根据需求，这里假设如果不填则取消编辑或保留原值，这里逻辑是如果不填则取消）
    if (editingValue.value === undefined || editingValue.value === null) {
      cancelEdit()
      return
    }

    const task = taskList.value[currentTaskIndex.value]
    if (field === 'title') {
      task.title = editingValue.value
    } else if (field === 'desc') {
      task.desc = editingValue.value
    } else if (field === 'cycle') {
      task.cycle = editingValue.value
    } else if (field === 'createTime') {
      task.createTime = editingValue.value
    }

    cancelEdit()
  }

  // 任务详情取消编辑
  const cancelEdit = () => {
    editingField.value = null
    editingValue.value = ''
  }

  // ===== 2026-10-14 用户定案：P8 异动改为「表单式就地编辑 + 顶部一键发起」=====
  // 2026-10-21 用户定案（修正）：一次异动可同时调整多条指标——双击编辑只攒内存
  // 草稿（不落库、刷新即丢），中途不做任何拦截；顶部「发起异动」把全部指标的
  // 攒改与新增指标一起上报，走 PLAN_MUTATION_STRATEGY 审批。
  const mutationDrafts = ref<
    Array<{
      indicatorId: string | number
      changes: { indicator_desc?: string; weight_percent?: number; remark?: string }
      labels: string[]
      /** 已下发计划上的删除：与字段攒改互斥，删除优先 */
      deleteRequested?: boolean
      /** 删除草稿的显示名，用于取消时还原表格行 */
      indicatorName?: string
    }>
  >([])

  /**
   * 2026-10-21 用户定案：战略任务列与指标字段同一套异动口径——
   * 已下发后双击任务名同样只攒内存草稿（刷新即丢），随「发起异动」一起上报。
   * 任务改名以 sys_task 为主键（一次异动覆盖该任务下全部指标行）。
   */
  const taskNameDrafts = ref<Array<{ taskId: string | number; before: string; after: string }>>([])

  const mutationApiLoading = ref(false)

  /**
   * 2026-10-20 用户定案：已下发计划新增的指标先落库但不立即发起异动，
   * 记在这里；点「发起异动」时与字段攒改一起统一上报、统一做权重合计校验。
   */
  const pendingCreatedIndicatorIds = ref<Array<string | number>>([])

  /**
   * 2026-10-22 修复（刷新丢失「待提交新增」标记 → 孤儿指标）：
   * 新增指标是「先落库、审批通过才生效」的，而标记此前只存内存——刷新即丢，
   * 「发起异动」按钮随之消失，指标既提交不了、又计入权重合计把后续异动卡死。
   * 现在把标记随每次变更同步持久化到 sessionStorage，页面重载后按
   * 「指标仍存在且仍为草稿」回填；提交/取消/删除等链路照常清空。
   */
  const PENDING_CREATE_STORAGE_KEY = 'sism.mutation.pending-created-indicators'

  const persistPendingCreatedIndicators = () => {
    if (typeof window === 'undefined') {
      return
    }
    try {
      if (pendingCreatedIndicatorIds.value.length === 0) {
        window.sessionStorage.removeItem(PENDING_CREATE_STORAGE_KEY)
      } else {
        window.sessionStorage.setItem(
          PENDING_CREATE_STORAGE_KEY,
          JSON.stringify(pendingCreatedIndicatorIds.value)
        )
      }
    } catch (error) {
      logger.warn('[StrategicTaskView] 持久化待提交新增指标失败:', error)
    }
  }

  const hydratePendingCreatedIndicators = () => {
    if (typeof window === 'undefined' || pendingCreatedIndicatorIds.value.length > 0) {
      return
    }
    let stored: unknown = null
    try {
      const raw = window.sessionStorage.getItem(PENDING_CREATE_STORAGE_KEY)
      stored = raw ? JSON.parse(raw) : null
    } catch (error) {
      logger.warn('[StrategicTaskView] 读取待提交新增指标失败:', error)
      return
    }
    if (!Array.isArray(stored) || stored.length === 0) {
      return
    }
    const rows = strategicStore.indicators
    // 数据尚未加载成功时先原样保留，避免把标记误清
    const restored =
      rows.length === 0
        ? stored
        : stored.filter(id =>
            rows.some(row => String(row.id) === String(id) && row.status === 'DRAFT')
          )
    logger.info('[StrategicTaskView] 回填待提交新增指标:', { stored, restored })
    pendingCreatedIndicatorIds.value = restored
  }

  // flush: 'sync' 保证每次变更立即落盘，与提交/取消等后续动作零竞态
  watch(pendingCreatedIndicatorIds, persistPendingCreatedIndicators, {
    deep: true,
    flush: 'sync'
  })

  const hasMutationDraft = computed(() => {
    // 2026-10-26 修复：脏草稿壳（changes 空、labels 空、未请求删除）不再计入——
    // 此前 unchanged 失焦会先 push 空壳再清字段，时序上壳可能残留，
    // 导致「没修改任何内容也出现发起异动按钮」（用户实测反馈）。
    const hasRealMutationDraft = mutationDrafts.value.some(
      draft => draft.deleteRequested || Object.keys(draft.changes || {}).length > 0
    )
    return (
      hasRealMutationDraft ||
      taskNameDrafts.value.length > 0 ||
      pendingCreatedIndicatorIds.value.length > 0
    )
  })

  const MUTATION_FIELD_MAP: Record<
    string,
    { payloadKey: 'indicator_desc' | 'weight_percent' | 'remark'; label: string }
  > = {
    name: { payloadKey: 'indicator_desc', label: '指标内容' },
    weight: { payloadKey: 'weight_percent', label: '权重' },
    remark: { payloadKey: 'remark', label: '备注' }
  }

  /**
   * 已下发计划上的删除 → 进异动草稿（不立即删库）。
   *
   * 2026-10-21 用户定案：删除与修改、新增同属异动，审批通过后才生效。
   * 草稿期只在表格里把该行隐藏，用户点「取消异动」或刷新页面即还原。
   */
  const applyDeleteMutationDraft = (row: StrategicIndicator) => {
    const indicatorId = row?.id
    if (indicatorId === null || indicatorId === undefined || indicatorId === '') {
      ElMessage.warning('当前行不是可删除的指标数据')
      return
    }

    // 2026-10-22：本次异动里刚新增、尚未提交审批的指标，直接撤掉即可。
    // 若照常记成「删除异动」，同一 ID 会同时出现在 create 与 delete 两个条目里，
    // 后端先给它打异动标记、再报「该指标已有异动在审批中」，整批提交直接失败。
    const isPendingCreate = pendingCreatedIndicatorIds.value.some(
      id => String(id) === String(indicatorId)
    )
    if (isPendingCreate) {
      pendingCreatedIndicatorIds.value = pendingCreatedIndicatorIds.value.filter(
        id => String(id) !== String(indicatorId)
      )
      void strategicStore.deleteIndicator(String(indicatorId)).catch(error => {
        logger.warn('[StrategicTaskView] 撤销本次新增指标失败:', { indicatorId, error })
      })
      const createdIndex = strategicStore.indicators.findIndex(
        item => String(item.id) === String(indicatorId)
      )
      if (createdIndex !== -1) {
        strategicStore.indicators.splice(createdIndex, 1)
      }
      ElMessage.info('已撤销本次新增的指标')
      return
    }

    const existing = mutationDrafts.value.find(
      item => String(item.indicatorId) === String(indicatorId)
    )
    if (existing) {
      existing.deleteRequested = true
      existing.changes = {}
      existing.labels = ['删除']
    } else {
      mutationDrafts.value.push({
        indicatorId,
        changes: {},
        labels: ['删除'],
        deleteRequested: true,
        indicatorName: String(row.name || '')
      })
    }

    // 表格里先隐藏该行（刷新或取消异动即还原，因为后端尚未删除）
    const index = strategicStore.indicators.findIndex(
      item => String(item.id) === String(indicatorId)
    )
    if (index !== -1) {
      strategicStore.indicators.splice(index, 1)
    }
    ElMessage.info('已标记删除；点顶部「发起异动」提交审批后生效')
  }

  // 就地编辑保存 → 已下发时写入草稿而不是落库（2026-10-21 用户定案：可攒多条指标，无拦截）
  const applyMutationDraftChange = (row: StrategicIndicator, field: string, rawValue: unknown) => {
    const mapping = MUTATION_FIELD_MAP[field]
    if (!mapping) {
      return false
    }

    let nextValue: string | number
    if (mapping.payloadKey === 'weight_percent') {
      const num = Number(rawValue)
      if (!Number.isFinite(num) || num < 0 || num > 100) {
        ElMessage.warning('权重需为 0-100 之间的数字')
        return false
      }
      nextValue = num
    } else {
      const text = String(rawValue ?? '').trim()
      if (!text) {
        ElMessage.warning(`${mapping.label}不能为空`)
        return false
      }
      nextValue = text
    }

    // 2026-10-26 修复：原值取「进入编辑时的快照」，不取 row 现值——
    // 合并单元格表格下 row 引用可能错位（读到 undefined 被误判为有变化）。
    // 快照也为空时回退到全局指标库行（strategicStore.indicators 按主键匹配），
    // 保证「没改内容就不算异动」的判定永远有可靠的原值可比。
    let originalValue =
      mapping.payloadKey === 'weight_percent'
        ? Number(editingIndicatorOriginal.value ?? 0)
        : String((editingIndicatorOriginal.value as string | number | undefined) ?? '')
    if (
      (mapping.payloadKey === 'weight_percent' && originalValue === '0') ||
      (mapping.payloadKey !== 'weight_percent' && originalValue === '')
    ) {
      const authoritative = strategicStore.indicators.find(
        item => String(item.id) === String(row.id)
      )
      if (authoritative) {
        if (mapping.payloadKey === 'weight_percent') {
          originalValue = Number(authoritative.weight ?? 0)
        } else if (field === 'name') {
          originalValue = String(authoritative.name ?? '')
        } else if (field === 'remark') {
          originalValue = String(authoritative.remark ?? '')
        }
      }
    }
    const unchanged =
      mapping.payloadKey === 'weight_percent'
        ? Number(originalValue) === nextValue
        : String(originalValue).trim() === String(nextValue)

    let draft = mutationDrafts.value.find(item => String(item.indicatorId) === String(row.id))
    if (unchanged) {
      // 2026-10-26 修复：无变化时不创建/保留空壳草稿
      if (draft) {
        delete draft.changes[mapping.payloadKey]
        draft.labels = draft.labels.filter(label => label !== mapping.label)
        if (draft.labels.length === 0 && !draft.deleteRequested) {
          mutationDrafts.value = mutationDrafts.value.filter(item => item !== draft)
        }
      }
      return true
    }
    if (!draft) {
      draft = { indicatorId: row.id, changes: {}, labels: [] }
      mutationDrafts.value.push(draft)
    }
    {
      draft.changes[mapping.payloadKey] = nextValue
      if (!draft.labels.includes(mapping.label)) {
        draft.labels.push(mapping.label)
      }
    }
    // 该指标的攒改全部改回原值时，把它从本次异动中移出
    if (draft.labels.length === 0) {
      mutationDrafts.value = mutationDrafts.value.filter(item => item !== draft)
    }

    // 同步内存显示（表格立即反映编辑结果，刷新后还原）
    const target = strategicStore.indicators.find(item => String(item.id) === String(row.id))
    if (target) {
      if (mapping.payloadKey === 'weight_percent') {
        ;(target as { weight?: number }).weight = Number(nextValue)
      } else if (mapping.payloadKey === 'indicator_desc') {
        ;(target as { name?: string }).name = String(nextValue)
      } else {
        ;(target as { remark?: string }).remark = String(nextValue)
      }
    }
    return true
  }

  /**
   * 战略任务改名 → 已下发时写入草稿（与指标字段攒改同构）。
   * 任务名以 sys_task 为单位，同一任务下的多行指标共享一次改名。
   */
  const applyTaskNameDraftChange = (row: StrategicIndicator, rawValue: unknown) => {
    const nextName = normalizeEditableText(rawValue)
    if (!nextName) {
      ElMessage.warning('战略任务名称不能为空')
      return false
    }

    const taskId = getIndicatorTaskId(row)
    // 任务异动以后端 sys_task 主键为锚点，非数字/占位值（如 "null"）无法走审批链
    const numericTaskId = Number(taskId)
    if (!taskId || !Number.isFinite(numericTaskId) || numericTaskId <= 0) {
      ElMessage.warning('该任务尚未落库，无法发起任务异动')
      return false
    }

    const currentName = normalizeEditableText(editingIndicatorOriginal.value ?? row.taskContent)
    const existing = taskNameDrafts.value.find(item => String(item.taskId) === String(taskId))
    const originalName = existing ? existing.before : currentName

    if (nextName === originalName) {
      taskNameDrafts.value = taskNameDrafts.value.filter(
        item => String(item.taskId) !== String(taskId)
      )
    } else if (existing) {
      existing.after = nextName
    } else {
      taskNameDrafts.value.push({ taskId, before: originalName, after: nextName })
    }

    // 同步内存显示（整列任务名一起变，刷新后还原）
    strategicStore.patchIndicatorsByTaskId(taskId, { taskContent: nextName })
    return true
  }

  /**
   * 取消异动 = 放弃尚未提交的本地草稿，等价于一次局部刷新。
   *
   * 2026-10-21 修复：此前只清两个内存集合，漏了 pendingCreatedIndicatorIds。
   * 已下发计划新增指标是「先落库、再等发起异动」的，落库那一刻数据已在库里，
   * 所以取消必须把它真的删掉，否则会出现两类事故：
   *   a) 按钮不消失（集合非空），下次点「发起异动」把用户以为已取消的指标一起提交；
   *   b) 残留的 DRAFT 指标继续计入权重合计，把整个部门的异动全部卡死（实测 110/100）。
   */
  const cancelMutationDraft = async () => {
    const createdIds = [...pendingCreatedIndicatorIds.value]
    mutationDrafts.value = []
    taskNameDrafts.value = []
    pendingCreatedIndicatorIds.value = []

    const failedIds: string[] = []
    for (const id of createdIds) {
      try {
        await strategicStore.deleteIndicator(String(id))
      } catch (error) {
        failedIds.push(String(id))
        logger.warn('[StrategicTaskView] 取消异动时删除新增指标失败:', { id, error })
      }
    }

    if (failedIds.length > 0) {
      // 删不掉就不能假装取消成功：留在待提交列表里，让用户能看见并重试
      pendingCreatedIndicatorIds.value = failedIds
      ElMessage.error(`有 ${failedIds.length} 条新增指标未能撤销，请重试或手动删除`)
    } else {
      ElMessage.info('已取消本次异动编辑')
    }
    void refreshTaskPageAfterIndicatorMutation()
  }

  // 顶部「发起异动」：指标攒改 + 新增指标 + 战略任务改名一起上报
  // （2026-10-21 用户定案：不做拦截、整批校验）
  const submitMutationDraft = async () => {
    const drafts = mutationDrafts.value
    const taskDrafts = taskNameDrafts.value
    const pendingCreates = pendingCreatedIndicatorIds.value
    if (drafts.length === 0 && taskDrafts.length === 0 && pendingCreates.length === 0) {
      return
    }

    // 2026-10-24 用户定案（互斥锁①）：上报审批在途时不能发起异动——
    // 两者对同一学院链二选一，避免上报审批期间表内容被异动改动
    if (isReportApprovalInFlight.value) {
      ElMessage.warning('当前计划的上报正在审批中，暂不能发起异动；请等上报审批结束或撤回后再操作')
      return
    }

    // 2026-10-22 修复（指标 2051 卡死整批提交）：剔除「无实际变更」的草稿条目。
    // 一条 changes 为空、又没标记删除的脏草稿会让后端整批拒绝
    // （400 异动内容为空：指标 X 未提供有效变更字段），
    // 用户看到的就是「点了确认发起却什么都没发生」。
    const effectiveDrafts = drafts.filter(
      draft => draft.deleteRequested || Object.keys(draft.changes).length > 0
    )
    const skippedIds = drafts
      .filter(draft => !draft.deleteRequested && Object.keys(draft.changes).length === 0)
      .map(draft => draft.indicatorId)
    if (skippedIds.length > 0) {
      logger.warn('[StrategicTaskView] 发起异动跳过无实际变更的草稿:', skippedIds)
      ElMessage.info(`已跳过 ${skippedIds.length} 条无实际变更的指标（${skippedIds.join('、')}）`)
    }
    if (effectiveDrafts.length === 0 && taskDrafts.length === 0 && pendingCreates.length === 0) {
      ElMessage.warning('本次没有可提交的异动内容')
      return
    }

    try {
      // 2026-10-21 用户定案：改动内容可能很多、弹窗里列不全，且发起人自己清楚改了什么，
      // 这里只做「是否发起」的确认，不罗列改动清单。
      await ElMessageBox.confirm(
        '确认发起本次异动审批？审批期间其他模块不受影响；驳回后可修改后重新发起。',
        '发起异动',
        { confirmButtonText: '确认发起', cancelButtonText: '取消', type: 'warning' }
      )
    } catch {
      return
    }
    try {
      mutationApiLoading.value = true
      const { mutationApi } = await import('@/features/indicator/api/mutationApi')

      // 一起上报：新增指标、字段攒改、删除与任务改名整批一次提交，
      // 后端统一做权重合计校验，任一失败整批不生效
      const items = [
        ...pendingCreates.map(id => ({ id, create: true })),
        ...effectiveDrafts.map(draft =>
          draft.deleteRequested
            ? { id: draft.indicatorId, delete: true }
            : { id: draft.indicatorId, ...draft.changes }
        ),
        ...taskDrafts.map(draft => ({
          id: draft.taskId,
          entity_type: 'TASK' as const,
          name: draft.after
        }))
      ]
      const response = await mutationApi.initiateBatch(items)
      if (!response.success) {
        throw new Error(response.message || '发起异动失败')
      }

      mutationDrafts.value = []
      taskNameDrafts.value = []
      pendingCreatedIndicatorIds.value = []
      ElMessage.success('异动已提交审批；审批期间其他模块不受影响')
      void refreshTaskPageAfterIndicatorMutation()
    } catch (error) {
      const msg = (error as { message?: string })?.message
      ElMessage.error(msg || '发起异动失败')
    } finally {
      mutationApiLoading.value = false
      // 提交耗时超过 MessageBox 的自动关闭时机时，确认框会残留；
      // 这里显式收起，避免挡住后续操作（实测需再按 Esc 才能关）。
      ElMessageBox.close()
    }
  }

  // 指标双击编辑
  const handleIndicatorDblClick = (row: StrategicIndicator, field: string) => {
    if (!canEdit.value) {
      return
    }
    // 2026-10-14 用户定案：已下发指标双击进入就地编辑，改动攒入异动草稿，
    // 由顶部「发起异动」按钮统一提交；未下发指标维持原有直接落库编辑。
    // 2026-10-21 用户定案：战略任务列（taskContent）与指标字段同构——
    // 已下发后同样可双击改名，攒入草稿随「发起异动」一起上报，不再锁死。
    if (hasDistributedIndicators.value) {
      const isTaskNameField = field === 'taskContent'
      const mapping = MUTATION_FIELD_MAP[field]
      if (!mapping && !isTaskNameField) {
        return
      }
      if (savingIndicatorId.value === row.id) {
        return
      }
      editingIndicatorId.value = row.id
      editingIndicatorField.value = field
      editingIndicatorValue.value = row[field as keyof StrategicIndicator]
      editingIndicatorOriginal.value = row[field as keyof StrategicIndicator]
      return
    }
    if (savingIndicatorId.value === row.id) {
      return
    }
    editingIndicatorId.value = row.id
    editingIndicatorField.value = field
    editingIndicatorValue.value = row[field as keyof StrategicIndicator]
    editingIndicatorOriginal.value = row[field as keyof StrategicIndicator]
  }

  /**
   * 已下发指标的异动入口：仅填报人可发起；支持 指标内容/权重/备注 三类字段。
   * 提交后走异动审批链；2026-10-20 定案：审批期间不再锁死其他模块（人为处理）。
   * 2026-10-21 定案：发起权收紧到填报人，负责人/校领导只审批不发起。
   */
  const openMutationDialogForField = async (row: StrategicIndicator, field: string) => {
    if (!canEdit.value) {
      ElMessage.warning('已下发的指标只能由填报人发起异动调整')
      return
    }

    const fieldMap: Record<
      string,
      { payloadKey: 'indicator_desc' | 'weight_percent' | 'remark'; label: string }
    > = {
      name: { payloadKey: 'indicator_desc', label: '指标内容' },
      weight: { payloadKey: 'weight_percent', label: '权重' },
      remark: { payloadKey: 'remark', label: '备注' }
    }
    const mapping = fieldMap[field]
    if (!mapping) {
      return
    }

    const currentValue =
      mapping.payloadKey === 'weight_percent'
        ? String(Number(row.weight ?? 0))
        : String((row[field as keyof StrategicIndicator] as string | number | undefined) ?? '')

    try {
      const { value } = await ElMessageBox.prompt(
        `该指标已下发，直接修改会被系统拒绝。是否发起「指标异动」调整${mapping.label}？` +
          '确认后将启动异动审批（填报人修改 → 战略发展部负责人审批 → 分管校领导审批）。' +
          '审批期间其他模块不受影响，异动结果由审批链决定。',
        `发起指标异动 · ${mapping.label}`,
        {
          confirmButtonText: '发起异动',
          cancelButtonText: '取消',
          inputType: mapping.payloadKey === 'weight_percent' ? 'number' : 'textarea',
          inputPlaceholder: `请输入新的${mapping.label}`,
          inputValue: currentValue,
          inputValidator: val => {
            const trimmed = String(val ?? '').trim()
            if (!trimmed) {
              return `${mapping.label}不能为空`
            }
            if (mapping.payloadKey === 'weight_percent') {
              const num = Number(trimmed)
              if (!Number.isFinite(num) || num < 0 || num > 100) {
                return '权重需为 0-100 之间的数字'
              }
            }
            if (trimmed === currentValue.trim()) {
              return `新${mapping.label}与当前值相同，无需异动`
            }
            return true
          }
        }
      )

      const payload =
        mapping.payloadKey === 'weight_percent'
          ? { weight_percent: Number(String(value).trim()) }
          : { [mapping.payloadKey]: String(value).trim() }

      const { mutationApi } = await import('@/features/indicator/api/mutationApi')
      const response = await mutationApi.initiate(row.id as number, payload)
      if (response.success) {
        ElMessage.success('异动已提交审批；审批期间其他模块不受影响')
        void refreshTaskPageAfterIndicatorMutation()
      } else {
        ElMessage.error(response.message || '发起异动失败')
      }
    } catch (error) {
      if (error !== 'cancel' && error !== 'close') {
        ElMessage.error(error instanceof Error ? error.message : '发起异动失败')
      }
    }
  }

  const isSavingIndicatorCell = (row: StrategicIndicator, field: string) =>
    savingIndicatorId.value === row.id && savingIndicatorField.value === field

  // 保存指标编辑
  const saveIndicatorEdit = async (row: StrategicIndicator, field: string) => {
    if (isSavingIndicatorEdit.value) {
      return
    }

    // 如果已经在取消过程中或值无效，直接退出
    if (editingIndicatorId.value === null) {
      return
    }

    if (editingIndicatorValue.value === null || editingIndicatorValue.value === undefined) {
      cancelIndicatorEdit()
      return
    }

    // 前端字段名到后端字段名的映射
    const fieldMapping: Record<string, string> = {
      name: 'indicatorDesc',
      weight: 'weightPercent',
      progress: 'progress',
      remark: 'remark',
      sortOrder: 'sortOrder'
    }

    // 2026-10-14 用户定案：已下发指标的就地编辑只攒入异动草稿（内存态，不落库），
    // 由顶部「发起异动」按钮一次性提交走审批；刷新页面即丢弃未发起的改动。
    // 2026-10-21 用户定案：战略任务改名同构——有 taskId 时攒草稿，没有则维持原直写。
    if (hasDistributedIndicators.value && MUTATION_FIELD_MAP[field]) {
      const value = editingIndicatorValue.value
      cancelIndicatorEdit()
      applyMutationDraftChange(row, field, value)
      return
    }

    if (hasDistributedIndicators.value && field === 'taskContent') {
      // 有真实 taskId 的任务走异动草稿；无 taskId 的临时任务仍按原路径直写
      if (getIndicatorTaskId(row)) {
        const value = editingIndicatorValue.value
        cancelIndicatorEdit()
        applyTaskNameDraftChange(row, value)
        return
      }
    }

    try {
      isSavingIndicatorEdit.value = true
      savingIndicatorId.value = row.id
      savingIndicatorField.value = field
      // 使用 Store 更新指标
      const updates: Record<string, unknown> = {}
      const mappedField = fieldMapping[field] || field

      console.log(
        '[saveIndicatorEdit] row.id:',
        row.id,
        'field:',
        field,
        'mappedField:',
        mappedField,
        'value:',
        editingIndicatorValue.value
      )

      if (field === 'taskContent') {
        const normalizedTaskName = normalizeEditableText(editingIndicatorValue.value)
        if (!normalizedTaskName) {
          cancelIndicatorEdit()
          ElMessage.warning('战略任务名称不能为空')
          return
        }
        if (normalizedTaskName === normalizeEditableText(row.taskContent)) {
          cancelIndicatorEdit()
          return
        }
        cancelIndicatorEdit()
        await persistTaskContentEdit(row, normalizedTaskName)
        updateEditTime()
        return
      }

      if (field === 'weight' || field === 'progress') {
        // 权重和进度字段强制转换为数字
        updates[mappedField] = Number(editingIndicatorValue.value)
      } else if (field === 'type1' || field === 'type2') {
        updates[field] = editingIndicatorValue.value
        // 更新 isQualitative 状态如果修改的是 type1
        if (field === 'type1') {
          updates.isQualitative = editingIndicatorValue.value === '定性'
        }
      } else {
        updates[mappedField] = editingIndicatorValue.value
      }

      // 如果编辑的是核心指标名称，且当前没有指标类型，则设置默认类型为"定性"
      if (field === 'name' && !row.type1) {
        updates.type1 = '定性'
        updates.isQualitative = true
      }

      console.log('[saveIndicatorEdit] updates:', updates)
      cancelIndicatorEdit()
      await strategicStore.updateIndicator(row.id.toString(), updates)
      updateEditTime()
    } catch (error) {
      console.error('[saveIndicatorEdit] Error details:', error)
      logger.error('[StrategicTaskView] Failed to save indicator:', error)
      const message =
        error instanceof Error && error.message ? error.message : '保存失败，请稍后重试'
      ElMessage.error(message)
    } finally {
      isSavingIndicatorEdit.value = false
      savingIndicatorId.value = null
      savingIndicatorField.value = null
    }
  }

  // 取消指标编辑
  const cancelIndicatorEdit = () => {
    editingIndicatorId.value = null
    editingIndicatorField.value = null
    editingIndicatorValue.value = null
    editingIndicatorOriginal.value = null
  }

  // 全局点击事件处理 - 点击编辑区域外退出编辑
  const handleGlobalClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement

    if (isAddingOrEditing.value) {
      const clickedInsideAddForm = !!addRowFormRef.value && addRowFormRef.value.contains(target)
      const clickedInsidePopup =
        !!target.closest('.el-popper') ||
        !!target.closest('.el-select-dropdown') ||
        !!target.closest('.el-picker__popper')

      if (!clickedInsideAddForm && !clickedInsidePopup) {
        cancelAdd()
        return
      }
    }

    // 如果没有正在编辑的字段，直接返回
    if (
      editingIndicatorId.value === null ||
      editingIndicatorField.value === null ||
      isSavingIndicatorEdit.value
    ) {
      return
    }

    // 检查点击是否在 el-select 或其下拉菜单内
    const isInSelect = target.closest('.el-select') || target.closest('.el-select-dropdown')
    // 检查点击是否在 el-input 内
    const isInInput = target.closest('.el-input') || target.closest('.el-textarea')

    const blurManagedFields = new Set(['taskContent', 'name', 'remark', 'weight', 'progress'])

    // 这些字段已经在组件自身的 blur 事件里保存，避免点击捕获阶段再触发一次。
    if (blurManagedFields.has(editingIndicatorField.value)) {
      return
    }

    // 仅对非 blur 驱动的编辑控件兜底
    if (!isInSelect && !isInInput) {
      const currentRow = indicators.value.find(
        item => String(item.id) === String(editingIndicatorId.value)
      )
      const currentField = editingIndicatorField.value

      if (currentRow && currentField) {
        void saveIndicatorEdit(currentRow, currentField)
        return
      }

      cancelIndicatorEdit()
    }
  }

  // 挂载和卸载全局点击监听
  onMounted(async () => {
    await Promise.all([
      (async () => {
        if (orgStore.departments.length === 0) {
          try {
            await orgStore.loadDepartments()
          } catch (error) {
            logger.error('[StrategicTaskView] 初始加载部门失败:', error)
          }
        }
      })(),
      (async () => {
        try {
          await planStore.loadPlans({ force: true, background: true })
        } catch (error) {
          logger.error('[StrategicTaskView] 初始加载 Plan 失败:', error)
        }
      })(),
      loadBackendTaskTypeMap({ force: true })
    ])

    ensureInitialSelectedDepartment(functionalDepartments.value)
    await refreshCurrentDepartmentView({ force: true })
    isBootstrappingPage.value = false

    document.addEventListener('click', handleGlobalClick, true)
    if (typeof window !== 'undefined') {
      window.addEventListener(
        GLOBAL_DATA_REFRESH_REQUEST_EVENT,
        handleGlobalDataRefreshRequest as EventListener
      )
      // 2026-10-24 跨窗口数据同步：别人改了哪条指标，本窗就局部刷哪条——
      // 单行拉取 + patch，权重合计 chip 是 computed 会自动重算
      window.addEventListener('indicator-data-changed', handleIndicatorDataChanged as EventListener)
    }
  })

  onUnmounted(() => {
    document.removeEventListener('click', handleGlobalClick, true)
    if (typeof window !== 'undefined') {
      window.removeEventListener(
        GLOBAL_DATA_REFRESH_REQUEST_EVENT,
        handleGlobalDataRefreshRequest as EventListener
      )
      window.removeEventListener(
        'indicator-data-changed',
        handleIndicatorDataChanged as EventListener
      )
    }
    if (departmentSwitchingTimer) {
      clearTimeout(departmentSwitchingTimer)
      departmentSwitchingTimer = null
    }
  })

  // 2026-10-07 重新发起审批：提交成功后后端工作流回写是异步的，窗口期内全局刷新
  // 拉回的可能是旧的「已回退」状态，会冲掉乐观补丁，导致必须手动刷新才更新。
  // 提交后 20s 内挂起外部触发的视图刷新，由提交链路的等待+强刷负责收敛。
  // 2026-10-10 跨窗口实时修复④：挂起期内到达的审批推送不再直接丢弃——
  // 记录挂起并在到期后补一次定向刷新，否则他人恰在挂起窗口内审批时
  // 本窗会一直停在旧状态直到下一次心跳。
  let planSubmitUiHoldUntil = 0
  let planSubmitHoldFlushTimer: ReturnType<typeof setTimeout> | null = null
  const PLAN_SUBMIT_UI_HOLD_MS = 20 * 1000

  const scheduleHoldFlush = () => {
    if (planSubmitHoldFlushTimer) {
      return
    }
    const waitMs = Math.max(500, planSubmitUiHoldUntil - Date.now() + 500)
    planSubmitHoldFlushTimer = setTimeout(() => {
      planSubmitHoldFlushTimer = null
      if (Date.now() >= planSubmitUiHoldUntil) {
        void requestGlobalDataRefresh({
          source: 'approval-state-refresh',
          silent: true,
          domains: ['plan', 'workflow']
        })
      }
    }, waitMs)
  }

  // 2026-10-24 跨窗口数据同步（用户定案：修改哪个指标，那个指标就局部异步刷新）：
  // 收到后端 DATA_CHANGED 广播后，只对当前视图里存在的那一行做「单行拉取 + patch」，
  // 不整表重载；权重合计 chip 是 computed，随行数据自动重算。
  // 行外变更（当前部门看不到的指标）直接忽略；行已删（404）则交由轻刷新收敛。
  const handleIndicatorDataChanged = (event: Event) => {
    const detail = (event as CustomEvent<{ entityType?: string; entityId?: number }>).detail || {}
    if (String(detail.entityType || '').toUpperCase() !== 'INDICATOR' || !detail.entityId) {
      return
    }
    const indicatorId = Number(detail.entityId)
    if (!Number.isFinite(indicatorId)) {
      return
    }
    void (async () => {
      try {
        const exists = strategicStore.indicators.some(item => Number(item.id) === indicatorId)
        if (!exists) {
          return
        }
        // 直接走 apiClient 绕过查询缓存，确保拿到的是提交后的最新值
        const { apiClient } = await import('@/shared/api/client')
        const response = await apiClient.get<ApiResponse<Record<string, unknown>>>(
          `/indicators/${indicatorId}`
        )
        if (!response?.success || !response.data) {
          return
        }
        const incoming = toStrategicIndicator(response.data)
        const patch: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(incoming)) {
          if (value !== undefined && value !== null) {
            patch[key] = value
          }
        }
        strategicStore.patchIndicator(String(indicatorId), patch)
      } catch (error) {
        logger.warn('[StrategicTaskView] 局部刷新指标行失败（等待轻刷新收敛）:', {
          indicatorId,
          error
        })
      }
    })()
  }

  const handleGlobalDataRefreshRequest = (event: Event) => {
    if (isBootstrappingPage.value || globalDataRefreshPromise) {
      return
    }

    if (Date.now() < planSubmitUiHoldUntil) {
      scheduleHoldFlush()
      return
    }

    const detail = (event as CustomEvent<GlobalDataRefreshDetail>).detail
    // 2026-09-27 细粒度异步刷新：仅计划/审批/指标域变更才刷本视图
    if (!shouldRefreshForDomains(detail, ['plan', 'workflow', 'indicator'])) {
      return
    }
    globalDataRefreshPromise = (async () => {
      logger.info('[StrategicTaskView] handling global data refresh request', detail)
      if (
        isLightGlobalRefreshSource(detail?.source) ||
        isApprovalDrivenRefreshSource(detail?.source)
      ) {
        await refreshCurrentDepartmentViewLightweight(detail)
        return
      }

      await refreshTaskPageAfterIndicatorMutation()
    })()
      .catch(error => {
        logger.warn('[StrategicTaskView] global data refresh failed', {
          detail,
          error
        })
      })
      .finally(() => {
        globalDataRefreshPromise = null
      })
  }

  watch(
    () => timeContext.currentYear,
    async () => {
      if (isBootstrappingPage.value) {
        return
      }
      resetApprovalWorkflowStateCache()
      await loadBackendTaskTypeMap({ force: true })
      await refreshCurrentDepartmentView({ showLoading: true, force: true, reloadIndicators: true })
    }
  )

  watch([selectedDepartment, () => planStore.plans.length], async () => {
    if (isBootstrappingPage.value) {
      return
    }
    resetApprovalWorkflowStateCache()
    await refreshCurrentDepartmentView({
      showLoading: false,
      force: false,
      reloadIndicators: false
    })
  })

  watch(
    [() => currentPlan.value?.id, currentPlanStatus],
    async ([planId, status], [prevPlanId, prevStatus]) => {
      if (isBootstrappingPage.value) {
        return
      }

      if (planId === prevPlanId && status === prevStatus) {
        return
      }

      preloadedPlanWorkflowDetail.value = null
      await hydrateCurrentPlanWorkflowState()
    }
  )

  // 方法
  const resetNewRow = (
    overrides: Partial<{
      taskId: string
      taskContent: string
      type1: '定性' | '定量'
      type2: '发展性' | '基础性'
    }> = {}
  ) => {
    preservePrefilledTaskBindingOnce.value = false
    newRow.value = {
      taskId: overrides.taskId ?? '',
      taskContent: overrides.taskContent ?? '',
      name: '',
      type1: overrides.type1 ?? '定量',
      type2: overrides.type2 ?? '基础性',
      weight: 0,
      remark: '',
      parentIndicatorId: ''
    }
  }

  const openNewRowDialog = (
    overrides: Partial<{
      taskId: string
      taskContent: string
      type1: '定性' | '定量'
      type2: '发展性' | '基础性'
    }> = {}
  ) => {
    resetNewRow(overrides)
    if (overrides.taskId !== undefined) {
      newRow.value.taskId = overrides.taskId
    }
    isAddingOrEditing.value = true
  }

  const addNewRow = () => {
    // 2026-10-24 用户定案：计划审批中内容冻结，不能新增行（后端 createIndicator 同口径守卫）
    if (isCurrentPlanUnderApproval.value) {
      ElMessage.warning('计划正在审批中，暂不能新增：请等审批结束或先撤回本次审批')
      return
    }
    openNewRowDialog()
  }

  // 在指定类别中添加新指标
  const _addIndicatorToCategory = (category: '发展性' | '基础性') => {
    logger.info(`[StrategicTaskView] addIndicatorToCategory called with category: ${category}`)
    openNewRowDialog({ type2: category })
  }

  // 为指定任务新增指标（点击单元格右下角加号）
  const handleAddIndicatorToTask = (row: StrategicIndicator) => {
    preservePrefilledTaskBindingOnce.value = true
    openNewRowDialog({
      taskId: getIndicatorTaskId(row),
      taskContent: row.taskContent || '',
      type2: row.type2 === '基础性' ? '基础性' : '发展性'
    })
  }

  const cancelAdd = () => {
    isAddingOrEditing.value = false
    resetNewRow()
    updateEditTime()
  }

  const getCurrentActorUserId = () => {
    const userRecord = authStore.user as { id?: string | number; userId?: string | number } | null
    const candidateId = Number(userRecord?.userId ?? userRecord?.id ?? NaN)
    return Number.isFinite(candidateId) && candidateId > 0 ? candidateId : null
  }

  // 保存新行
  const saveNewRow = async () => {
    // 2026-10-23 用户定案：二级学院 tab 的新增行 = 给该学院建子指标，
    // 必须挂到一个核心指标下（与「指标下发与管理」页的新增子指标同构）。
    // 走独立分支，复用同一个 createIndicator 契约（parentIndicatorId + ownerOrgId + targetOrgId）。
    // 注意：子指标的战略任务/任务类型从所选核心指标继承，因此不校验 newRow.taskContent。
    if (collegeAddMode.value) {
      const collegeWeight = Number(newRow.value.weight)
      if (!String(newRow.value.name || '').trim()) {
        ElMessage.warning('请填写子指标内容')
        return
      }
      if (!Number.isFinite(collegeWeight) || collegeWeight <= 0) {
        ElMessage.warning('请填写大于 0 的权重')
        return
      }
      await saveCollegeChildIndicator(collegeWeight)
      return
    }

    if (!String(newRow.value.taskContent || '').trim()) {
      ElMessage.warning('请填写战略任务')
      return
    }

    if (!String(newRow.value.name || '').trim()) {
      ElMessage.warning('请填写核心指标内容')
      return
    }

    const weight = Number(newRow.value.weight)
    if (!Number.isFinite(weight) || weight <= 0) {
      ElMessage.warning('请填写大于 0 的权重')
      return
    }

    // 显示加载状态
    const loading = ElLoading.service({
      lock: true,
      text: '正在保存指标...',
      background: 'rgba(0, 0, 0, 0.7)'
    })

    try {
      const persistedTaskId = await ensurePersistedTaskIdForIndicator({
        taskId: newRow.value.taskId || null,
        taskContent: newRow.value.taskContent,
        type2: newRow.value.type2,
        remark: newRow.value.remark,
        responsibleDept: selectedDepartment.value || '战略发展部',
        ownerDept: '战略发展部'
      })

      // 添加日志记录 taskContent
      logger.info(
        `[StrategicTaskView] Saving indicator with taskContent: "${newRow.value.taskContent}"`
      )

      // 调用 Store 添加指标（现在是异步的，会调用后端 API）
      const createdIndicatorResponse = await strategicStore.addIndicator({
        id: Date.now().toString(),
        taskId: persistedTaskId,
        taskContent: String(newRow.value.taskContent || '').trim(),
        name: String(newRow.value.name || '').trim(),
        isQualitative: newRow.value.type1 === '定性',
        type1: newRow.value.type1,
        type2: newRow.value.type2,
        progress: 0,
        createTime: new Date().toLocaleDateString('zh-CN'),
        weight,
        remark: newRow.value.remark || '无备注',
        canWithdraw: true,
        targetValue: 100,
        unit: '%',
        responsibleDept: selectedDepartment.value || '战略发展部', // 责任部门是选中的部门
        ownerDept: '战略发展部', // 创建者始终是战略发展部
        responsiblePerson: authStore.userName || '未分配',
        status: 'active',
        isStrategic: true,
        year: timeContext.currentYear,
        statusAudit: []
      })

      const createdIndicatorId = Number(
        createdIndicatorResponse?.data?.indicatorId ?? createdIndicatorResponse?.data?.id ?? NaN
      )

      // 2026-10-20 用户定案：已下发计划新增的指标必须走异动审批链，
      // 落库后立即为该新指标发起 PLAN_MUTATION_STRATEGY（审批通过才正式生效）。
      // 2026-10-20 用户定案：已下发计划新增指标时**不立即发起异动**、也不做权重校验。
      // 新增的指标先落库并计入「异动草稿」，用户可继续调整其他指标权重使合计回到 100，
      // 再点顶部「发起异动」时统一校验（校验不通过则整批不提交）。
      if (
        hasDistributedIndicators.value &&
        Number.isFinite(createdIndicatorId) &&
        createdIndicatorId > 0
      ) {
        pendingCreatedIndicatorIds.value = [...pendingCreatedIndicatorIds.value, createdIndicatorId]
        logger.info(
          '[StrategicTaskView] 已下发计划新增指标，已加入待发起异动列表:',
          createdIndicatorId
        )
        ElMessage.info('指标已新增；请确认计划内权重合计为 100 后点顶部「发起异动」提交审批')
      }

      // 统一走“变更后刷新”链路，避免新增后被旧缓存覆盖，导致主页仍显示上一版状态。
      logger.info('[StrategicTaskView] Refreshing task page after successful indicator creation...')
      await refreshTaskPageAfterIndicatorMutation()
      logger.info('[StrategicTaskView] Task page refreshed successfully after indicator creation')

      // 成功：关闭表单并更新 UI
      cancelAdd()
      updateEditTime()
    } catch (error) {
      // 错误已在 Store 中处理并显示消息
      logger.error('[StrategicTaskView] Failed to save indicator:', error)
    } finally {
      loading.close()
    }
  }

  // 删除指标
  const _deleteIndicator = (indicator: StrategicIndicator) => {
    const indicatorId = indicator?.id
    if (indicatorId === null || indicatorId === undefined || indicatorId === '') {
      ElMessage.warning('当前行不是可删除的指标数据')
      return
    }

    ElMessageBox.confirm(`确定要删除指标 "${indicator.name}" 吗？删除后无法恢复。`, '删除确认', {
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
      .then(async () => {
        const loading = ElLoading.service({
          lock: true,
          text: '正在删除指标并刷新数据...',
          background: 'rgba(0, 0, 0, 0.5)'
        })

        try {
          await strategicStore.deleteIndicator(indicatorId.toString())
          pendingCreatedIndicatorIds.value = pendingCreatedIndicatorIds.value.filter(
            id => String(id) !== String(indicatorId)
          )
          await refreshTaskPageAfterIndicatorMutation()
          ElMessage.success('指标已删除')
          updateEditTime()
        } catch (error) {
          logger.error('[StrategicTaskView] 删除指标失败:', error)
          ElMessage.error('删除失败，请稍后重试')
        } finally {
          loading.close()
        }
      })
      .catch(() => {
        // 用户取消操作
      })
  }

  // 最后编辑时间
  const lastEditTime = ref(new Date().toLocaleString())

  // 更新最后编辑时间的函数
  const updateEditTime = () => {
    lastEditTime.value = new Date().toLocaleString()
  }

  const selectDepartment = (dept: string) => {
    if (selectedDepartment.value === dept) {
      return
    }

    isDepartmentSwitching.value = true
    if (departmentSwitchingTimer) {
      clearTimeout(departmentSwitchingTimer)
    }
    departmentSwitchingTimer = setTimeout(() => {
      isDepartmentSwitching.value = false
      departmentSwitchingTimer = null
    }, 280)

    selectedDepartment.value = dept
    persistSelectedDepartment(dept)
  }

  // ===== 2026-10-11 二级学院表格化（用户定案）：左侧选学院 → 表格展示该学院收到的指标 → 双击异动 =====
  // ===== 2026-10-13 用户定案：二级学院 tab 按左侧已选职能部门下钻——学院列表与表格都只呈现
  // "当前职能部门 → 二级学院"这条下发链上的数据，不混入其他职能部门下发的指标 =====
  const collegeDepartments = computed(() => orgStore.getAllCollegeNames())
  const selectedCollege = ref('')

  // 当前职能部门（职能部门 tab 左侧选中项）下发给学院的全部目标学院
  const collegeDepartmentsScoped = computed(() => {
    const allColleges = collegeDepartments.value
    const ownerDept = normalizeDepartmentName(selectedDepartment.value || '')
    if (!ownerDept) {
      return allColleges
    }
    const scoped = new Set<string>()
    for (const item of normalizedIndicators.value) {
      if (item.ownerDept !== ownerDept) {
        continue
      }
      const candidate = item as {
        targetOrgName?: string
        targetDepartment?: string
        responsibleDept?: string
      }
      const target = normalizeDepartmentName(
        String(
          candidate.targetOrgName ?? candidate.targetDepartment ?? candidate.responsibleDept ?? ''
        )
      )
      const matched = allColleges.find(college => normalizeDepartmentName(college) === target)
      if (matched) {
        scoped.add(matched)
      }
    }
    return [...scoped].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  })

  const selectCollege = (college: string) => {
    if (selectedCollege.value === college) {
      return
    }
    selectedCollege.value = college
    // 2026-10-19 修复：切换学院后重新拉取该学院的上报摘要（自评等级/进度说明回显依据）
    void syncCurrentPlanReportSummaries({ force: true, collegeScope: true })
  }

  // 切换职能部门时，原选中学院可能不在新部门的下发范围——自动清空选中
  watch(collegeDepartmentsScoped, scoped => {
    if (selectedCollege.value && !scoped.includes(selectedCollege.value)) {
      selectedCollege.value = ''
    }
  })

  // 该学院收到的指标：只取"当前职能部门 → 该学院"链路（ownerDept 过滤）
  // 二级学院 tab：指标 id→完整指标映射，用于子指标行显示所属核心指标（名称+定性定量配色）
  const indicatorById = computed(() => {
    const map = new Map<string | number, (typeof normalizedIndicators.value)[number]>()
    for (const item of normalizedIndicators.value) {
      map.set(item.id, item)
    }
    return map
  })

  const collegeTableIndicators = computed(() => {
    if (!selectedCollege.value) {
      return []
    }
    const target = normalizeDepartmentName(selectedCollege.value)
    const ownerDept = normalizeDepartmentName(selectedDepartment.value || '')
    return normalizedIndicators.value
      .map(item => applyReportDetailOverlayToRow(item))
      .filter(item => {
        if (ownerDept && item.ownerDept !== ownerDept) {
          return false
        }
        const candidate = item as {
          responsibleDept?: string
          targetDepartment?: string
          targetOrgName?: string
        }
        const deptName = normalizeDepartmentName(
          String(
            candidate.targetDepartment ?? candidate.targetOrgName ?? candidate.responsibleDept ?? ''
          )
        )
        return deptName === target || deptName.includes(target)
      })
      .sort((a, b) => {
        // 按所属核心指标分组相邻（同组同序），与职能部门 tab 的任务分组展示同构
        const parentA = indicatorById.value.get(a.parentIndicatorId ?? '')?.name ?? ''
        const parentB = indicatorById.value.get(b.parentIndicatorId ?? '')?.name ?? ''
        if (parentA !== parentB) {
          return parentA.localeCompare(parentB)
        }
        return Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0)
      })
  })

  // PR#83 头部「审批状态」与二级学院页签「上报状态」列一致性：
  // 「上报状态」列只存在于学院页签表格（数据源即 collegeTableIndicators），且学院链路
  // 查看的是「职能部门→学院」的上报（collegeScope），因此聚合只在该页签激活时进行，
  // 数据源与 ReportStatusCell 严格同批行。口径与 ReportStatusCell 完全一致
  // （同取 fills[0]：approved→已上报 / submitted→审批中 / rejected→已回退）。
  // 2026-10-26 修复：异动待办 ref 从 UI 组件上提到 model 层单例——
  // 此前学院 chip 与互斥锁在 model 层引用 UI 组件的本地 ref（未定义），
  // 渲染期间抛 ReferenceError 导致整页白屏/表格清空。
  const departmentMutationPendingApprovals = ref<Array<Record<string, any>>>([])
  const collegeFillStatusScope = ref(false)

  // 2026-10-10：异动审批实例 → 审批中心「审批历史」卡片（P1 修复：异动链不缺失前端）
  // 2026-10-21：任务改名异动（entity_type=TASK）与指标异动并列，需按各自类型取历史
  // 2026-10-26：loader 从 UI 组件下沉到 model——handleApprovalRefresh（本文件）此前
  // 跨作用域引用 UI 本地函数，运行时审批后刷新链在这里 ReferenceError 断裂
  const departmentMutationWorkflowEntities = ref<
    Array<{ entityId: number; entityType?: 'INDICATOR' | 'TASK' }>
  >([])
  const loadDepartmentMutationWorkflowEntities = async () => {
    try {
      const orgId = resolveDepartmentIdByName(selectedDepartment.value)
      if (!orgId) {
        departmentMutationWorkflowEntities.value = []
        departmentMutationPendingApprovals.value = []
        return
      }
      const { mutationApi } = await import('@/features/indicator/api/mutationApi')
      const response = await mutationApi.approvals(orgId)
      const items = Array.isArray(response.data) ? response.data : []
      departmentMutationWorkflowEntities.value = items
        .map(item => ({
          entityId: Number(item.indicator_id),
          entityType:
            String(item.entity_type || 'INDICATOR').toUpperCase() === 'TASK'
              ? ('TASK' as const)
              : ('INDICATOR' as const)
        }))
        .filter(item => Number.isFinite(item.entityId) && item.entityId > 0)
      departmentMutationPendingApprovals.value = items
        .filter(item => String(item.status || '').toUpperCase() === 'IN_REVIEW')
        .map(item => ({
          instanceId: item.instance_id,
          entityId: Number(item.indicator_id),
          entityType:
            String(item.entity_type || 'INDICATOR').toUpperCase() === 'TASK'
              ? ('TASK' as const)
              : ('INDICATOR' as const),
          flowCode: item.flow_code || 'PLAN_MUTATION_STRATEGY',
          status: 'IN_REVIEW',
          title: item.indicator_desc,
          currentStepName: item.current_step_name,
          approverOrgId: item.approver_org_id,
          sourceOrgId: item.source_org_id,
          sourceOrgName: item.source_org_name,
          targetOrgId: item.target_org_id,
          targetOrgName: item.target_org_name,
          // 2026-10-21：批次号与字段变更明细，供看板聚合与详情弹窗逐字段展示
          batchId: item.batch_id || null,
          changedFields: item.changed_fields || null,
          // 提交人取后端真实发起人（audit_instance.requester 的姓名）
          submitterName: item.submitter_name,
          createdAt: item.created_at
        }))

      // 2026-10-21：异动本身也是一条审批流程，「审批流程」页签要能显示它走到哪一步。
      // 按实例取流程详情挂到对应条目上（与计划审批同一套 getWorkflowInstanceDetail 接口）。
      const { getWorkflowInstanceDetail } = await import('@/features/workflow/api/queries')
      departmentMutationPendingApprovals.value = await Promise.all(
        departmentMutationPendingApprovals.value.map(async entry => {
          try {
            const detail = await getWorkflowInstanceDetail(String(entry.instanceId))
            return detail?.success && detail.data
              ? { ...entry, workflowDetail: detail.data }
              : entry
          } catch (error) {
            logger.warn('[StrategicTaskView] 加载异动流程详情失败:', {
              instanceId: entry.instanceId,
              error
            })
            return entry
          }
        })
      )
    } catch (error) {
      logger.warn('[StrategicTaskView] 加载异动审批实例失败:', error)
    }
  }

  // 2026-10-24 用户定案（异动/上报互斥）：同一学院链上「上报审批在途」与「异动审批在途」
  // 二选一——上报在审时异动发起入口锁定；异动在审时上报提交被锁（另一方向同理）。
  // 信号源：当前部门上下文的上报审批摘要（workflowStatus 处于在途态即视为上报在审）。
  const isReportApprovalInFlight = computed(() => {
    const status = String(
      currentPlanReportSummary.value?.workflowStatus || currentPlanReportSummary.value?.status || ''
    )
      .trim()
      .toUpperCase()
    return ['PENDING', 'IN_REVIEW', 'SUBMITTED', 'RETURNED'].includes(status)
  })

  const isMutationApprovalInFlight = computed(
    () => departmentMutationPendingApprovals.value.length > 0
  )

  const currentPlanFillApprovalSummary = ref<{
    loaded: boolean
    hasRows: boolean
    hasSubmitted: boolean
    hasRejected: boolean
    hasUnfilled: boolean
  }>({
    loaded: false,
    hasRows: false,
    hasSubmitted: false,
    hasRejected: false,
    hasUnfilled: false
  })

  let fillApprovalSummaryRequestId = 0

  async function refreshCurrentPlanFillApprovalSummary(): Promise<void> {
    // 只在学院页签聚合：职能部门页签没有逐指标状态列，不存在该矛盾，保持原有计划级语义
    const rows = collegeFillStatusScope.value ? collegeTableIndicators.value : []
    const requestId = ++fillApprovalSummaryRequestId

    if (rows.length === 0) {
      currentPlanFillApprovalSummary.value = {
        loaded: true,
        hasRows: false,
        hasSubmitted: false,
        hasRejected: false,
        hasUnfilled: false
      }
      return
    }

    try {
      // 先统一失效再重取：useIndicatorFills 缓存按 indicatorId 长期驻留，
      // 不失效则审批流转后拿到的仍是首屏旧响应，头部会卡在旧状态直到整页重载。
      invalidateIndicatorFills()
      const fillsPerIndicator = await Promise.all(rows.map(row => useIndicatorFills(row.id)))
      // 丢弃过期响应，避免快速切换学院/部门时旧数据覆盖新数据
      if (requestId !== fillApprovalSummaryRequestId) {
        return
      }

      let hasSubmitted = false
      let hasRejected = false
      let hasUnfilled = false

      fillsPerIndicator.forEach(fills => {
        const latest = fills[0]
        if (!latest) {
          hasUnfilled = true
          return
        }
        if (latest.status === 'submitted') {
          hasSubmitted = true
        } else if (latest.status === 'rejected') {
          hasRejected = true
        } else if (latest.status !== 'approved') {
          hasUnfilled = true
        }
      })

      currentPlanFillApprovalSummary.value = {
        loaded: true,
        hasRows: true,
        hasSubmitted,
        hasRejected,
        hasUnfilled
      }

      // 缓存已重填，广播让「上报状态」单元格直接重读：两端同源同鲜度，且不产生重复请求
      notifyIndicatorFillsRefresh()
    } catch (error) {
      // 拉取失败时保持既有计划级语义，不阻塞页面渲染
      logger.warn('[StrategicTaskView] 聚合指标填报审批态失败:', { error })
    }
  }

  watch(
    () =>
      [
        collegeFillStatusScope.value ? 'college' : 'functional',
        selectedCollege.value,
        collegeTableIndicators.value.map(indicator => indicator.id).join(',')
      ].join('|'),
    () => {
      void refreshCurrentPlanFillApprovalSummary()
    },
    { immediate: true }
  )

  // 二级学院 tab：核心指标列合并单元格元数据（同属一个核心指标的行首行 rowspan=组内行数）
  const collegeSpanMetaMap = computed(() => {
    const meta = new Map<number, { rowspan: number; colspan: number }>()
    const rows = collegeTableIndicators.value
    let index = 0
    while (index < rows.length) {
      const head = rows[index]
      const parentKey = String(head?.parentIndicatorId ?? head?.id ?? '')
      let end = index + 1
      while (end < rows.length) {
        const candidate = rows[end]
        if (!candidate || String(candidate.parentIndicatorId ?? candidate.id ?? '') !== parentKey) {
          break
        }
        end += 1
      }
      meta.set(index, { rowspan: end - index, colspan: 1 })
      for (let i = index + 1; i < end; i += 1) {
        meta.set(i, { rowspan: 0, colspan: 0 })
      }
      index = end
    }
    return meta
  })

  const collegeSpanMethod = ({
    rowIndex,
    columnIndex
  }: {
    row: Record<string, unknown>
    column: unknown
    rowIndex: number
    columnIndex: number
  }) => {
    // 仅核心指标列（第 0 列）合并
    if (columnIndex === 0) {
      return collegeSpanMetaMap.value.get(rowIndex) ?? { rowspan: 1, colspan: 1 }
    }
    return { rowspan: 1, colspan: 1 }
  }

  const _selectTask = (index: number) => {
    currentTaskIndex.value = index
  }

  // 表格选择变化处理
  const handleSelectionChange = (selection: StrategicIndicator[]) => {
    selectedIndicators.value = selection
  }

  // 任务下发相关方法
  const handleCancelAssignment = () => {
    showAssignmentDialog.value = false
    assignmentTarget.value = ''
    assignmentMethod.value = 'self'
  }

  const confirmAssignment = () => {
    if (!assignmentTarget.value) {
      ElMessage.warning('请选择下发目标')
      return
    }

    const indicatorNames = selectedIndicators.value.map(ind => ind.name).join('、')
    const targetName =
      assignmentMethod.value === 'self' ? '自己完成' : `下发给${assignmentTarget.value}`

    ElMessageBox.confirm(`确认将以下指标${targetName}？\n\n${indicatorNames}`, '确认下发', {
      confirmButtonText: '确定下发',
      cancelButtonText: '取消',
      type: 'info'
    })
      .then(() => {
        // 这里应该调用API进行任务下发
        ElMessage.success(
          `成功下发${selectedIndicators.value.length}项指标到${assignmentTarget.value}`
        )
        showAssignmentDialog.value = false
        assignmentTarget.value = ''
        assignmentMethod.value = 'self'
      })
      .catch(() => {
        // 用户取消操作
      })
  }

  // ================== 详情抽屉 & 单个下发/撤回 ==================

  // 详情抽屉状态
  const detailDrawerVisible = ref(false)
  const currentDetail = ref<StrategicIndicator | null>(null)
  // P3 上报记录分区
  const reportHistoryOpen = ref<string[]>([])

  // 专门用于审批抽屉的指标列表（显示当前选中部门的所有指标，一个部门的所有指标状态应该统一）
  const approvalIndicators = computed(() => {
    if (!selectedDepartment.value) {
      return []
    }
    return normalizedIndicators.value
      .filter(i => resolveIndicatorYear(i, timeContext.currentYear) === timeContext.currentYear)
      .filter(i => i.responsibleDept === selectedDepartment.value) // 只显示当前选中部门的指标
      .filter(i => i.isStrategic === true) // 只显示战略指标（一级指标）
  })

  // 判断当前选中部门是否有待审批的指标（用于按钮显示和状态判断）
  const _hasPendingApprovalForDept = computed(() => {
    if (!selectedDepartment.value) {
      return false
    }
    return approvalIndicators.value.some(i => i.progressApprovalStatus === 'PENDING')
  })

  function resetApprovalWorkflowStateCache(): void {
    preloadedPlanWorkflowDetail.value = null
    currentPlanReportSummary.value = null
    latestPlanReportSummary.value = null
    currentPlanReportSummaryPromise = null
    currentPlanReportSummaryKey = ''
  }

  async function refreshApprovalWorkflowSummaries(): Promise<void> {
    await syncCurrentPlanReportSummaries({ force: true })
  }

  function normalizeWorkflowRuntimeStatus(value: unknown): string {
    return String(value || '')
      .trim()
      .toUpperCase()
  }

  function isActiveApprovalWorkflowDetail(
    detail: WorkflowInstanceDetailResponse | null | undefined
  ): boolean {
    const status = normalizeWorkflowRuntimeStatus(detail?.status)
    if (['PENDING', 'IN_REVIEW', 'SUBMITTED'].includes(status)) {
      return true
    }

    if (
      ['WITHDRAWN', 'CANCELLED', 'REJECTED', 'RETURNED', 'APPROVED', 'DISTRIBUTED'].includes(status)
    ) {
      return false
    }

    return false
  }

  async function waitForPlanWorkflowReady(
    options: { maxAttempts?: number; delayMs?: number } = {}
  ): Promise<void> {
    const maxAttempts = options.maxAttempts ?? 16
    const delayMs = options.delayMs ?? 500

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await preloadApprovalWorkflowDetail()

      const detail = preloadedPlanWorkflowDetail.value
      const isActiveDetail = isActiveApprovalWorkflowDetail(detail)
      const hasPendingTask =
        Array.isArray(detail?.tasks) &&
        detail.tasks.some(
          task =>
            String(task.status || '')
              .trim()
              .toUpperCase() === 'PENDING'
        )
      const hasWorkflowPointer = Boolean(
        detail?.currentTaskId || detail?.currentApproverId || detail?.currentStepName
      )

      if (isActiveDetail && (hasPendingTask || hasWorkflowPointer)) {
        return
      }

      const planId = currentPlan.value?.id
      if (planId !== undefined && planId !== null && planId !== '') {
        await planStore.loadPlanDetails(planId, { force: true, background: true })
      }

      if (attempt < maxAttempts - 1) {
        await sleep(delayMs)
      }
    }

    preloadedPlanWorkflowDetail.value = null
  }

  async function preloadApprovalWorkflowDetail(): Promise<void> {
    preloadedPlanWorkflowDetail.value = null

    const reportId = Number(
      hasApprovalWorkflowReportBinding.value
        ? (approvalWorkflowReportSummary.value?.id ?? NaN)
        : NaN
    )
    if (shouldPreferCurrentReportWorkflow.value && Number.isFinite(reportId) && reportId > 0) {
      try {
        // 2026-10-10 跨窗口实时修复：审批详情预加载必须拿最新实例状态，
        // 绕过 30s WORKFLOW_DETAIL 内存缓存，否则撤回/重发的推送会被旧缓存吃掉。
        const response = await getWorkflowInstanceDetailByBusiness('PLAN_REPORT', reportId, {
          force: true
        })
        if (response.success && response.data) {
          preloadedPlanWorkflowDetail.value = response.data
          // 2026-10-07：偏好的上报实例若已终态（撤回/退回），不能就此返回——
          // 重新发起审批后新实例挂在 PLAN 业务上，必须回落继续查，
          // 否则 waitForPlanWorkflowReady 每轮都拿旧实例、必然超时。
          if (isActiveApprovalWorkflowDetail(response.data)) {
            return
          }
        }
      } catch (error) {
        logger.warn('[StrategicTaskView] 优先预加载 PlanReport 审批详情失败，回退 PLAN:', {
          reportId,
          error
        })
      }
    }

    const planId = currentPlan.value?.id
    if (planId === undefined || planId === null || planId === '') {
      if (Number.isFinite(reportId) && reportId > 0) {
        try {
          const response = await getWorkflowInstanceDetailByBusiness('PLAN_REPORT', reportId, {
            force: true
          })
          if (response.success && response.data) {
            preloadedPlanWorkflowDetail.value = response.data
          }
        } catch (error) {
          logger.warn('[StrategicTaskView] 预加载 PlanReport 审批抽屉工作流详情失败:', {
            reportId,
            error
          })
        }
      }
      return
    }

    await planStore.loadPlanDetails(planId, { force: true, background: true })

    const latestPlan = currentPlan.value
    if (!latestPlan) {
      return
    }

    try {
      const businessEntityId = Number(latestPlan.id ?? 0)
      if (Number.isFinite(businessEntityId) && businessEntityId > 0) {
        const response = await getWorkflowInstanceDetailByBusiness('PLAN', businessEntityId, {
          force: true
        })
        if (response.success && response.data) {
          preloadedPlanWorkflowDetail.value = response.data
        }
        return
      }

      const workflowInstanceId = Number(latestPlan.workflowInstanceId ?? 0)
      if (Number.isFinite(workflowInstanceId) && workflowInstanceId > 0) {
        const response = await getWorkflowInstanceDetail(String(workflowInstanceId))
        if (response.success && response.data) {
          preloadedPlanWorkflowDetail.value = response.data
        }
      }
    } catch (error) {
      logger.warn('[StrategicTaskView] 预加载审批抽屉工作流详情失败:', {
        planId,
        error
      })
    }

    if (Number.isFinite(reportId) && reportId > 0) {
      try {
        const response = await getWorkflowInstanceDetailByBusiness('PLAN_REPORT', reportId)
        if (response.success && response.data) {
          preloadedPlanWorkflowDetail.value = response.data
        }
      } catch (error) {
        logger.warn(
          '[StrategicTaskView] PLAN detail 不可用，回退加载 PlanReport 审批抽屉工作流详情失败:',
          {
            reportId,
            error
          }
        )
      }
    }
  }

  // 打开任务审批抽屉
  const handleOpenApproval = async () => {
    await refreshApprovalWorkflowSummaries()
    await preloadApprovalWorkflowDetail()
    taskApprovalVisible.value = true
  }

  const handleApprovalStatusPopoverShow = async () => {
    if (!hasApprovalWorkflowReportBinding.value && !currentPlan.value?.id) {
      return
    }

    approvalStatusPopoverLoading.value = true

    try {
      if (!preloadedPlanWorkflowDetail.value) {
        await refreshApprovalWorkflowSummaries()
        await preloadApprovalWorkflowDetail()
      }

      const previewWorkflowCode =
        currentApprovalWorkflowCode.value || PLAN_APPROVAL_SUBMIT_WORKFLOW_CODE
      if (
        previewWorkflowCode &&
        approvalWorkflowPreview.value?.workflowCode !== previewWorkflowCode
      ) {
        try {
          const response = await getWorkflowDefinitionPreviewByCode(previewWorkflowCode)
          if (response.success && response.data) {
            approvalWorkflowPreview.value = response.data
          }
        } catch (error) {
          logger.warn('[StrategicTaskView] 加载流程状态候选审批人失败:', error)
        }
      }
    } finally {
      approvalStatusPopoverLoading.value = false
    }
  }

  // ==================== 2026-10-26 部门计划族补充历史实体 ====================
  // 战略任务页部门卡片抽屉锚定主计划（战略部→本部门），而「本部门→学院」的
  // FUNC_TO_COLLEGE 子计划与各自学院上报（PLAN_REPORT）挂在子计划实体上，
  // 不在锚定范围内，审批历史因此缺「学院→本部门」的上报链。
  // 按当前部门构造：子计划 PLAN + 各自 latestReport 的 PLAN_REPORT 实体 id，
  // 经 relatedWorkflowEntities prop 传给审批中心抽屉。
  const departmentPlanFamilyWorkflowEntities = ref<
    Array<{ entityType: 'PLAN' | 'PLAN_REPORT'; entityId: number }>
  >([])
  const departmentPlanFamilyLoadKey = ref('')
  const loadDepartmentPlanFamilyWorkflowEntities = async () => {
    const orgId = resolveDepartmentIdByName(selectedDepartment.value)
    const loadKey = `${orgId ?? ''}:${timeContext.currentYear}`
    if (!orgId) {
      departmentPlanFamilyWorkflowEntities.value = []
      departmentPlanFamilyLoadKey.value = loadKey
      return
    }
    // planStore 尚未加载完成时不写缓存 key——部门 watch 是 immediate 的，
    // 若此刻 plans 为空就固化 key，后续永不重试，学院上报历史将一直缺失
    if (!Array.isArray(planStore.plans) || planStore.plans.length === 0) {
      return
    }
    if (loadKey === departmentPlanFamilyLoadKey.value) {
      return
    }
    departmentPlanFamilyLoadKey.value = loadKey
    const anchoredPlanId = Number(currentPlan.value?.id ?? NaN)
    const familyPlans = planStore.plans.filter(p => {
      const planAny = p as Record<string, unknown>
      const createdByOrgId = Number(planAny.createdByOrgId ?? planAny.created_by_org_id ?? NaN)
      const planLevel = String(planAny.planLevel || planAny.plan_level || '')
        .trim()
        .toUpperCase()
      return (
        createdByOrgId === orgId &&
        planLevel === 'FUNC_TO_COLLEGE' &&
        resolvePlanYear(planAny) === timeContext.currentYear &&
        Number(planAny.id ?? NaN) !== anchoredPlanId
      )
    })
    const entities: Array<{ entityType: 'PLAN' | 'PLAN_REPORT'; entityId: number }> = []
    await Promise.all(
      familyPlans.map(async plan => {
        const planAny = plan as Record<string, unknown>
        const planId = Number(planAny.id ?? NaN)
        if (!Number.isFinite(planId) || planId <= 0) {
          return
        }
        entities.push({ entityType: 'PLAN', entityId: planId })
        const reportOrgId = Number(planAny.targetOrgId ?? planAny.org_id ?? planAny.orgId ?? NaN)
        if (!(Number.isFinite(reportOrgId) && reportOrgId > 0)) {
          return
        }
        try {
          const summaries = await indicatorFillApi.getCurrentMonthPlanReportSummaries(
            planId,
            reportOrgId
          )
          const reportId = Number(summaries?.latestReport?.id ?? NaN)
          if (Number.isFinite(reportId) && reportId > 0) {
            entities.push({ entityType: 'PLAN_REPORT', entityId: reportId })
          }
        } catch (error) {
          logger.warn('[StrategicTaskView] 加载子计划上报摘要失败:', { planId, error })
        }
      })
    )
    departmentPlanFamilyWorkflowEntities.value = entities
  }

  // 审批后刷新
  const handleApprovalRefresh = async () => {
    // 使用统一的变更后刷新逻辑，确保指标列表、计划详情、上报摘要、待办数量全部同步
    await refreshTaskPageAfterIndicatorMutation()

    // 异动卡片的数据源是父组件按部门拉取的（经 prop 传入抽屉），
    // 审批/撤回后必须重新拉一次，否则卡片仍停留在旧状态。
    await loadDepartmentMutationWorkflowEntities()
    // 学院上报有新终态时，部门计划族的上报实体也会变，同步刷新
    departmentPlanFamilyLoadKey.value = ''
    await loadDepartmentPlanFamilyWorkflowEntities()

    // 额外刷新 planStore 的详情（与 strategicStore 不同步）
    const planId = currentPlan.value?.id
    if (planId !== undefined && planId !== null && planId !== '') {
      await planStore.loadPlanDetails(planId, { force: true, background: true })
    }

    // 强制关闭抽屉以避免旧数据残留
    taskApprovalVisible.value = false
    nextTick(() => {
      updateEditTime()
    })
  }

  // 下发弹窗状态
  const distributeDialogVisible = ref(false)
  const currentDistributeItem = ref<StrategicIndicator | null>(null)
  const currentDistributeGroup = ref<{ taskContent: string; rows: StrategicIndicator[] } | null>(
    null
  )
  const distributeTarget = ref<string[]>([])

  // ================== 进度审批相关 ==================
  // 旧的本地审批弹窗已停用，统一改为从真实工作流待办入口处理。

  // 查看详情
  const handleViewDetail = (row: StrategicIndicator) => {
    currentDetail.value = row
    detailDrawerVisible.value = true
  }

  // ================== 指标审核工作流方法 ==================

  // 判断是否为战略发展部
  const isStrategicDept = computed(() => {
    return authStore.userRole === 'strategic_dept' || props.selectedRole === 'strategic_dept'
  })

  // 审核通过指标定义
  const approveIndicatorReview = async (indicatorId: string) => {
    try {
      const indicator = indicators.value.find(i => i.id.toString() === indicatorId)
      if (!indicator) {
        ElMessage.error('找不到指标')
        return
      }

      ElMessageBox.confirm(
        `确认审核通过指标 "${indicator.name}"？\n\n审核通过后，指标将变为已下发状态。`,
        '审核通过',
        {
          confirmButtonText: '确认通过',
          cancelButtonText: '取消',
          type: 'success'
        }
      )
        .then(async () => {
          const loading = ElLoading.service({
            lock: true,
            text: '正在审核...',
            background: 'rgba(0, 0, 0, 0.7)'
          })

          try {
            await indicatorApi.approveIndicatorReview(indicatorId)
            ElMessage.success('审核通过')

            await refreshTaskPageAfterIndicatorMutation()
            updateEditTime()
          } catch (error) {
            logger.error('审核通过失败:', error)
            ElMessage.error('审核通过失败，请重试')
          } finally {
            loading.close()
          }
        })
        .catch(() => {
          // 用户取消操作
        })
    } catch (error) {
      logger.error('审核通过失败:', error)
      ElMessage.error('审核通过失败')
    }
  }

  // 驳回指标定义审核
  const rejectIndicatorReview = async (indicatorId: string) => {
    try {
      const indicator = indicators.value.find(i => i.id.toString() === indicatorId)
      if (!indicator) {
        ElMessage.error('找不到指标')
        return
      }

      // 使用 ElMessageBox.prompt 收集驳回原因
      ElMessageBox.prompt(`请输入驳回指标 "${indicator.name}" 的原因：`, '审核驳回', {
        confirmButtonText: '确认驳回',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputPlaceholder: '请输入驳回原因（必填）',
        inputValidator: value => {
          if (!value || !value.trim()) {
            return '驳回原因不能为空'
          }
          return true
        }
      })
        .then(async ({ value: reason }) => {
          const loading = ElLoading.service({
            lock: true,
            text: '正在驳回...',
            background: 'rgba(0, 0, 0, 0.7)'
          })

          try {
            await indicatorApi.rejectIndicatorReview(indicatorId, reason)
            ElMessage.info('已驳回审核')

            await refreshTaskPageAfterIndicatorMutation()
            updateEditTime()
          } catch (error) {
            logger.error('驳回审核失败:', error)
            ElMessage.error('驳回审核失败，请重试')
          } finally {
            loading.close()
          }
        })
        .catch(() => {
          // 用户取消操作
        })
    } catch (error) {
      logger.error('驳回审核失败:', error)
      ElMessage.error('驳回审核失败')
    }
  }

  // 打开下发弹窗
  const _openDistributeDialog = (row: StrategicIndicator) => {
    currentDistributeItem.value = row
    // 默认选中左侧当前选择的部门
    distributeTarget.value = selectedDepartment.value ? [selectedDepartment.value] : []
    distributeDialogVisible.value = true
  }

  const triggerApprovalForDistribution = async (indicator: StrategicIndicator) => {
    const indicatorId = Number(indicator.id)
    if (!Number.isFinite(indicatorId) || indicatorId <= 0) {
      return { skipped: true as const, reason: 'temporary_indicator' }
    }

    const requesterId = Number(getCurrentActorUserId() || 0)
    const rawOrgId = Number((authStore.user as { orgId?: number | string } | null)?.orgId || 0)
    const fallbackOrgId =
      departmentNameIdMap.value.get(
        authStore.effectiveDepartment || authStore.userDepartment || ''
      ) || 0
    const requesterOrgId = rawOrgId > 0 ? rawOrgId : Number(fallbackOrgId)
    const traceId = `dist-${indicatorId}-${Date.now()}`

    if (
      !Number.isFinite(requesterId) ||
      requesterId <= 0 ||
      !Number.isFinite(requesterOrgId) ||
      requesterOrgId <= 0
    ) {
      return { skipped: true as const, reason: 'missing_requester_context', traceId }
    }

    // Use new workflow API
    await startWorkflow({
      workflowCode: 'TASK_DISTRIBUTION',
      businessEntityId: indicatorId,
      businessEntityType: 'TASK'
    })
    const requestId = traceId

    logger.info('[StrategicTaskView] Distribution approval triggered', {
      traceId,
      requestId,
      indicatorId,
      requesterId,
      requesterOrgId
    })

    return { skipped: false as const, traceId, requestId, instanceId: undefined }
  }

  // 确认下发（支持单个和整体下发）
  const confirmDistribute = () => {
    if (!ensurePlanCanDistribute()) {
      return
    }

    if (distributeTarget.value.length === 0) {
      ElMessage.warning('请选择下发目标部门')
      return
    }

    const targetDepts = distributeTarget.value.join('、')

    // 整体下发模式
    if (currentDistributeGroup.value) {
      const pendingRows = currentDistributeGroup.value.rows.filter(r => r.canWithdraw)
      ElMessageBox.confirm(
        `确认将任务 "${currentDistributeGroup.value.taskContent}" 下的 ${pendingRows.length} 个指标下发到以下部门？\n\n${targetDepts}`,
        '整体下发确认',
        {
          confirmButtonText: '确认下发',
          cancelButtonText: '取消',
          type: 'info'
        }
      )
        .then(async () => {
          try {
            // 为每个目标部门创建指标副本
            for (const row of pendingRows) {
              const persistedIndicatorId = String(row.id)
              if (!/^\d+$/.test(persistedIndicatorId)) {
                throw new Error(`指标 ${persistedIndicatorId} 尚未持久化，无法执行下发`)
              }

              // 构建审计记录
              const newAuditEntry = {
                id: `audit-${row.id}-${Date.now()}`,
                operator: String(getCurrentActorUserId() || 'admin'),
                operatorName: authStore.user?.name || '管理员',
                operatorDept:
                  authStore.effectiveDepartment || authStore.userDepartment || '战略发展部',
                action: 'distribute' as const,
                comment: `下发到 ${distributeTarget.value.join('、')}`,
                timestamp: new Date()
              }

              for (const [index, dept] of distributeTarget.value.entries()) {
                const targetOrgId = departmentNameIdMap.value.get(dept)
                if (!Number.isFinite(targetOrgId)) {
                  throw new Error(`未找到部门 ${dept} 对应的组织ID`)
                }

                if (index === 0) {
                  await indicatorApi.distributeIndicator({
                    parentIndicatorId: persistedIndicatorId,
                    targetOrgId: String(targetOrgId),
                    actorUserId: String(getCurrentActorUserId() || '')
                  })
                } else {
                  await strategicStore.addIndicator({
                    ...(row as StrategicIndicator & { taskId?: string | number }),
                    id: `${Date.now()}-${index}-${row.id}`,
                    parentIndicatorId: persistedIndicatorId,
                    taskId: getIndicatorTaskId(row) ?? undefined,
                    responsibleDept: dept,
                    ownerDept: '战略发展部',
                    canWithdraw: false,
                    progress: 0,
                    statusAudit: [newAuditEntry]
                  })
                }
              }

              const approvalTriggerResult = await triggerApprovalForDistribution(row)
              if (!approvalTriggerResult.skipped) {
                ElMessage.info(
                  `审批流已触发（实例ID: ${approvalTriggerResult.instanceId || '待回填'}，requestId: ${approvalTriggerResult.requestId || approvalTriggerResult.traceId}）`
                )
              } else {
                ElMessage.warning(
                  `指标 ${row.id} 下发成功，但审批未触发（${approvalTriggerResult.reason}）`
                )
              }
            }
            ElMessage.success(
              `已成功下发 ${pendingRows.length} 个指标到 ${distributeTarget.value.length} 个部门`
            )
            closeDistributeDialog()
            await refreshTaskPageAfterIndicatorMutation()
            updateEditTime()
          } catch (error) {
            logger.error('Failed to distribute indicators:', error)
            ElMessage.error('下发失败，请稍后重试')
          }
        })
        .catch(() => {
          // 用户取消操作
        })
      return
    }

    // 单个下发模式
    if (!currentDistributeItem.value) {
      return
    }

    ElMessageBox.confirm(
      `确认将指标 "${currentDistributeItem.value.name}" 下发到以下部门？\n\n${targetDepts}`,
      '下发确认',
      {
        confirmButtonText: '确认下发',
        cancelButtonText: '取消',
        type: 'info'
      }
    )
      .then(async () => {
        try {
          const row = currentDistributeItem.value
          if (!row) {
            return
          }

          const persistedIndicatorId = String(row.id)
          if (!/^\d+$/.test(persistedIndicatorId)) {
            throw new Error(`指标 ${persistedIndicatorId} 尚未持久化，无法执行下发`)
          }

          // 构建审计记录
          const newAuditEntry = {
            id: `audit-${row.id}-${Date.now()}`,
            operator: String(getCurrentActorUserId() || 'admin'),
            operatorName: authStore.user?.name || '管理员',
            operatorDept: authStore.effectiveDepartment || authStore.userDepartment || '战略发展部',
            action: 'distribute' as const,
            comment: `下发到 ${distributeTarget.value.join('、')}`,
            timestamp: new Date()
          }

          // 为每个目标部门处理
          for (const [index, dept] of distributeTarget.value.entries()) {
            const targetOrgId = departmentNameIdMap.value.get(dept)
            if (!Number.isFinite(targetOrgId)) {
              throw new Error(`未找到部门 ${dept} 对应的组织ID`)
            }

            if (index === 0) {
              await indicatorApi.distributeIndicator({
                parentIndicatorId: persistedIndicatorId,
                targetOrgId: String(targetOrgId),
                actorUserId: String(getCurrentActorUserId() || '')
              })
            } else {
              await strategicStore.addIndicator({
                ...(row as StrategicIndicator & { taskId?: string | number }),
                id: `${Date.now()}-${index}-${row.id}`,
                parentIndicatorId: persistedIndicatorId,
                taskId: getIndicatorTaskId(row) ?? undefined,
                responsibleDept: dept,
                ownerDept: '战略发展部',
                canWithdraw: false,
                progress: 0,
                statusAudit: [newAuditEntry]
              })
            }
          }
          const approvalTriggerResult = await triggerApprovalForDistribution(row)
          ElMessage.success(`指标已成功下发到 ${distributeTarget.value.length} 个部门`)
          if (!approvalTriggerResult.skipped) {
            ElMessage.info(
              `审批流已触发（实例ID: ${approvalTriggerResult.instanceId || '待回填'}，requestId: ${approvalTriggerResult.requestId || approvalTriggerResult.traceId}）`
            )
          } else {
            ElMessage.warning(`下发成功，但审批未触发（${approvalTriggerResult.reason}）`)
          }
          closeDistributeDialog()
          await refreshTaskPageAfterIndicatorMutation()
          updateEditTime()
        } catch (error) {
          logger.error('Failed to distribute indicator:', error)
          ElMessage.error('下发失败，请稍后重试')
        }
      })
      .catch(() => {
        // 用户取消操作
      })
  }

  // 关闭下发弹窗
  const closeDistributeDialog = () => {
    distributeDialogVisible.value = false
    currentDistributeItem.value = null
    currentDistributeGroup.value = null
    distributeTarget.value = []
  }

  // 单个撤回
  const _handleWithdraw = async (row: StrategicIndicator) => {
    // 检查 Plan 状态：是否可以撤回
    if (!canWithdrawPlan.value) {
      if (currentPlanStatus.value === 'DISTRIBUTED') {
        ElMessage.warning('当前 Plan 已下发，无法撤回')
      } else if (currentPlanStatus.value === 'PENDING') {
        ElMessage.warning('当前审批进度不支持撤回')
      } else {
        ElMessage.warning('当前状态无法撤回')
      }
      return
    }

    ElMessageBox.confirm(
      `撤回后，该指标将重新变为可下发状态。确认撤回 "${row.name}"？`,
      '撤回操作',
      {
        confirmButtonText: '确认撤回',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
      .then(async () => {
        try {
          await strategicStore.withdrawIndicator(row.id.toString())
          await refreshTaskPageAfterIndicatorMutation()
          ElMessage.info('指标已撤回')
          updateEditTime()
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : '未知错误'
          ElMessage.error({
            message: `撤回失败: ${errorMsg}`,
            duration: 5000,
            showClose: true
          })
          logger.error('Withdraw failed:', err)
          await refreshTaskPageAfterIndicatorMutation()
        }
      })
      .catch(() => {
        // 用户取消操作
      })
  }

  // 全部下发（下发当前界面所有未下发的指标）
  const handleDistributeAll = async () => {
    if (!ensurePlanCanDistribute()) {
      return
    }

    // 检查是否有待审批的进度
    if (pendingApprovalCount.value > 0) {
      ElMessage.warning(
        `有 ${pendingApprovalCount.value} 个指标有待审批的进度，请先完成审批后再下发`
      )
      return
    }

    // 基于生命周期状态判断可下发的指标
    const pendingRows = indicators.value.filter(r => {
      if (!r.name) {
        return false
      } // 只下发有核心指标的记录
      // 草稿或待审核状态的指标可以下发（使用大写枚举值）
      return !r.status || r.status === IndicatorStatus.DRAFT || r.status === IndicatorStatus.PENDING
    })

    if (pendingRows.length === 0) {
      ElMessage.warning('当前没有待下发的指标')
      return
    }

    ElMessageBox.confirm(
      `确认下发当前部门的全部 ${pendingRows.length} 个待下发指标？`,
      '全部下发确认',
      {
        confirmButtonText: '确认下发',
        cancelButtonText: '取消',
        type: 'info'
      }
    )
      .then(async () => {
        // 显示加载状态
        const loading = ElMessage({
          message: '正在下发指标...',
          type: 'info',
          duration: 0
        })

        try {
          const approvalResults: Array<{
            skipped: boolean
            traceId?: string
            requestId?: string
            instanceId?: number
            reason?: string
          }> = []

          // 更新所有指标状态为已下发，并逐条触发审批流
          for (const row of pendingRows) {
            const indicatorId = String(row.id)
            const targetOrgId = departmentNameIdMap.value.get(row.responsibleDept)

            if (/^\d+$/.test(indicatorId) && Number.isFinite(targetOrgId)) {
              await indicatorApi.distributeIndicator({
                parentIndicatorId: indicatorId,
                targetOrgId: String(targetOrgId),
                actorUserId: String(getCurrentActorUserId() || '')
              })
            } else {
              throw new Error(`指标 ${indicatorId} 缺少持久化 ID 或目标部门映射，无法执行批量下发`)
            }

            const approvalTriggerResult = await triggerApprovalForDistribution(row)
            approvalResults.push(approvalTriggerResult)
          }

          // 重新从后端加载数据，确保前端状态与后端一致
          await refreshTaskPageAfterIndicatorMutation()

          loading.close()
          ElMessage.success({
            message: `已成功下发 ${pendingRows.length} 个指标`,
            duration: 5000,
            showClose: true
          })
          const triggered = approvalResults.filter(r => !r.skipped)
          if (triggered.length > 0) {
            const sample = triggered[0]
            ElMessage.info(
              `审批流已触发 ${triggered.length} 条（示例 实例ID: ${sample.instanceId || '待回填'}，requestId: ${sample.requestId || sample.traceId || 'N/A'}）`
            )
          } else {
            const firstSkipped = approvalResults[0]
            if (firstSkipped) {
              ElMessage.warning(
                `下发成功，但审批未触发（${firstSkipped.reason || 'unknown_reason'}）`
              )
            }
          }
          updateEditTime()
        } catch (err) {
          loading.close()
          const errorMsg = err instanceof Error ? err.message : '未知错误'
          ElMessage.error({
            message: `下发失败: ${errorMsg}`,
            duration: 5000,
            showClose: true
          })
          logger.error('Distribute all failed:', err)
          await refreshTaskPageAfterIndicatorMutation()
        }
      })
      .catch(() => {
        // 用户取消操作
      })
  }

  // 全部撤回（撤回当前界面所有已下发的指标）
  const handleWithdrawAll = async () => {
    // 检查 Plan 状态：是否可以撤回
    if (!canWithdrawPlan.value) {
      if (isPlanDistributed.value) {
        ElMessage.warning('当前 Plan 已下发，无法撤回')
      } else if (currentPlanStatus.value === 'PENDING') {
        ElMessage.warning('当前审批进度不支持撤回')
      } else {
        ElMessage.warning('当前状态无法撤回')
      }
      return
    }

    const planId = Number(currentPlan.value?.id ?? NaN)
    if (!Number.isFinite(planId) || planId <= 0) {
      ElMessage.warning('当前没有可撤回的计划')
      return
    }

    ElMessageBox.confirm(
      '确认撤回当前部门的下发申请？撤回后，当前 Plan 将恢复为草稿状态。',
      '全部撤回确认',
      {
        confirmButtonText: '确认撤回',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
      .then(async () => {
        // 显示加载状态
        const loading = ElMessage({
          message: '正在撤回 Plan...',
          type: 'info',
          duration: 0
        })

        try {
          await planStore.withdrawPlan(planId)
          if (currentPlan.value) {
            currentPlan.value = {
              ...currentPlan.value,
              status: 'DRAFT',
              workflowStatus: 'WITHDRAWN',
              canWithdraw: false,
              currentTaskId: undefined,
              currentStepName: undefined,
              currentApproverId: undefined,
              currentApproverName: undefined
            }
          }
          applyLocalPlanWorkflowUiPatch('withdrawn')
          await planStore.loadPlans({ force: true, background: true })
          loading.close()
          ElMessage.success('已成功撤回当前 Plan')

          try {
            await refreshTaskPageAfterIndicatorMutation()
            await refreshApprovalCenterLiveView()
            notifyApprovalStateRefresh({ source: 'strategic-task-plan-withdraw' })
          } catch (refreshError) {
            logger.warn('[StrategicTaskView] Plan 撤回成功，但刷新指标列表失败:', refreshError)
            ElMessage.warning('Plan 已撤回成功，但指标列表刷新失败，请手动刷新页面确认最新状态')
          }

          updateEditTime()
        } catch (err) {
          loading.close()
          const errorMsg = err instanceof Error ? err.message : '未知错误'
          ElMessage.error({
            message: `撤回失败: ${errorMsg}`,
            duration: 5000,
            showClose: true
          })
          logger.error('Withdraw failed:', err)
          await refreshTaskPageAfterIndicatorMutation()
        }
      })
      .catch(() => {
        // 用户取消操作
      })
  }

  // 按任务整体下发（复用下发弹窗）
  const _handleBatchDistributeByTask = (group: {
    taskContent: string
    rows: StrategicIndicator[]
  }) => {
    if (!ensurePlanCanDistribute()) {
      return
    }

    const pendingRows = group.rows.filter(r => r.canWithdraw)
    if (pendingRows.length === 0) {
      ElMessage.warning('该任务下所有指标已下发')
      return
    }

    currentDistributeGroup.value = group
    currentDistributeItem.value = null
    distributeTarget.value = selectedDepartment.value ? [selectedDepartment.value] : []
    distributeDialogVisible.value = true
  }

  // 按任务整体撤回
  const _handleBatchWithdrawByTask = async (group: {
    taskContent: string
    rows: StrategicIndicator[]
  }) => {
    const distributedRows = getPersistedWithdrawableRows(group.rows)
    if (distributedRows.length === 0) {
      ElMessage.warning('该任务下没有已下发的指标')
      return
    }

    ElMessageBox.confirm(
      `确认撤回任务 "${group.taskContent}" 下的 ${distributedRows.length} 个已下发指标？`,
      '批量撤回确认',
      {
        confirmButtonText: '确认撤回',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
      .then(async () => {
        // 显示加载状态
        const loading = ElMessage({
          message: '正在撤回指标...',
          type: 'info',
          duration: 0
        })

        try {
          // 1. 先调用后端 API 更新所有指标
          await Promise.all(
            distributedRows.map(row => strategicStore.withdrawIndicator(row.id.toString()))
          )

          await refreshTaskPageAfterIndicatorMutation()

          loading.close()
          ElMessage.success(`已成功撤回 ${distributedRows.length} 个指标`)
          updateEditTime()
        } catch (err) {
          loading.close()
          const errorMsg = err instanceof Error ? err.message : '未知错误'
          ElMessage.error({
            message: `撤回失败: ${errorMsg}`,
            duration: 5000,
            showClose: true
          })
          logger.error('Batch withdraw failed:', err)
          await refreshTaskPageAfterIndicatorMutation()
        }
      })
      .catch(() => {
        // 用户取消操作
      })
  }

  // 按任务整体删除
  const _handleBatchDeleteByTask = (group: { taskContent: string; rows: StrategicIndicator[] }) => {
    if (group.rows.length === 0) {
      ElMessage.warning('该任务下没有指标')
      return
    }

    ElMessageBox.confirm(
      `确定要删除任务 "${group.taskContent}" 下的全部 ${group.rows.length} 个指标吗？删除后无法恢复。`,
      '批量删除确认',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
      .then(async () => {
        const loading = ElLoading.service({
          lock: true,
          text: '正在批量删除并刷新数据...',
          background: 'rgba(0, 0, 0, 0.5)'
        })

        try {
          await Promise.all(
            group.rows.map(row => strategicStore.deleteIndicator(row.id.toString()))
          )
          await refreshTaskPageAfterIndicatorMutation()
          ElMessage.success(`已成功删除 ${group.rows.length} 个指标`)
          updateEditTime()
        } catch (error) {
          logger.error('[StrategicTaskView] 批量删除指标失败:', error)
          ElMessage.error('批量删除失败，请稍后重试')
        } finally {
          loading.close()
        }
      })
      .catch(() => {
        // 用户取消操作
      })
  }

  // 删除单个指标
  const handleDeleteIndicator = (row: StrategicIndicator) => {
    if (!canDeleteIndicator(row)) {
      ElMessage.warning(
        hasDistributedIndicators.value
          ? '该指标已有异动在审批中，不能重复发起'
          : '只有未下发的草稿计划才能直接删除指标'
      )
      return
    }

    const indicatorId = row?.id
    if (indicatorId === null || indicatorId === undefined || indicatorId === '') {
      ElMessage.warning('当前行不是可删除的指标数据')
      return
    }

    // 已下发计划：删除进异动草稿，随「发起异动」统一提交，审批通过后才生效
    if (hasDistributedIndicators.value) {
      applyDeleteMutationDraft(row)
      return
    }

    ElMessageBox.confirm(`确定要删除指标 "${row.name}" 吗？删除后无法恢复。`, '删除确认', {
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
      .then(async () => {
        const loading = ElLoading.service({
          lock: true,
          text: '正在删除指标并刷新数据...',
          background: 'rgba(0, 0, 0, 0.5)'
        })

        try {
          await strategicStore.deleteIndicator(indicatorId.toString())
          // 已删除的指标不能再留在待发起异动列表里，否则下次提交会带上一条已归档的实体
          pendingCreatedIndicatorIds.value = pendingCreatedIndicatorIds.value.filter(
            id => String(id) !== String(indicatorId)
          )
          await refreshTaskPageAfterIndicatorMutation()
          ElMessage.success('指标已删除')
          updateEditTime()
        } catch (error) {
          logger.error('[StrategicTaskView] 删除指标失败:', error)
          ElMessage.error('删除失败，请稍后重试')
        } finally {
          loading.close()
        }
      })
      .catch(() => {
        // 用户取消操作
      })
  }

  // ================== 审批流程相关 ==================

  /**
   * 获取待审批计划数量
   */
  const pendingPlanApprovalCount = ref(0)

  /**
   * 加载待审批计划数量
   */
  const loadPendingPlanApprovalCount = async () => {
    try {
      const userId = getCurrentActorUserId() || 1
      const response = await taskApprovalApi.countPendingApprovals(userId)
      if (response.success && response.data !== undefined) {
        pendingPlanApprovalCount.value = response.data
      }
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : error && typeof error === 'object' && 'message' in error
            ? String((error as { message: unknown }).message)
            : '未知错误'
      logger.error('[StrategicTaskView] 加载待审批计划数量失败:', msg)
    }
  }

  // 组件挂载时加载待审批计划数量
  onMounted(() => {
    loadPendingPlanApprovalCount()
  })

  // 任务类别颜色映射
  const getCategoryColor = (type2: string) => {
    if (type2 === '发展性') {
      return '#409EFF'
    }
    if (type2 === '基础性') {
      return '#67C23A'
    }
    return '#909399'
  }

  const getCategoryText = (type2?: string): string => {
    if (type2 === '发展性' || type2 === '基础性') {
      return type2
    }
    return '其他'
  }

  // 表格滚动状态
  const _tableScrollRef = ref<HTMLElement | null>(null)
  const isTableScrolling = ref(false)

  // 监听表格滚动，判断是否需要显示操作列的固定效果
  const _handleTableScroll = (e: Event) => {
    const target = e.target as HTMLElement
    const scrollLeft = target.scrollLeft
    const scrollWidth = target.scrollWidth
    const clientWidth = target.clientWidth
    // 当滚动到最右侧时（允许2px误差），隐藏固定效果
    isTableScrolling.value = scrollLeft < scrollWidth - clientWidth - 2
  }

  // 进度条颜色计算
  // 未下发：灰色 | 任务周期内未达标：黄色 | 超过任务周期未达标：红色 | 任务周期内已达标：绿色
  // 使用统一的进度条颜色规则 (Requirements: 10.2)
  const getProgressColor = (row: StrategicIndicator): string => {
    // 未下发的进度条为灰色
    if (row.canWithdraw) {
      return 'var(--text-placeholder)' // 使用CSS变量 #C0C4CC
    }

    const progress = row.progress || 0
    const targetValue = row.targetValue || 100
    const isAchieved = progress >= targetValue

    // 里程碑移除后无法依据里程碑截止日期判断是否超期，未达标统一显示黄色
    if (isAchieved) {
      return 'var(--color-success)' // 绿色：已达标
    } else {
      return 'var(--color-warning)' // 黄色：任务周期内未达标
    }
  }

  // 获取进度状态 - 使用统一的进度条颜色规则 (Requirements: 10.2)
  // 规则: progress >= 80: success, 50 <= progress < 80: warning, progress < 50: exception
  const getProgressStatus = (progress: number): 'success' | 'warning' | 'exception' => {
    if (progress >= 80) {
      return 'success'
    }
    if (progress >= 50) {
      return 'warning'
    }
    return 'exception'
  }

  const hasPendingProgressValue = (indicator: StrategicIndicator): boolean => {
    const pendingProgress = Number(indicator.pendingProgress)
    if (!Number.isFinite(pendingProgress)) {
      return false
    }

    const currentProgress = Number(indicator.progress || 0)
    return pendingProgress !== currentProgress
  }

  const getPendingProgressDelta = (indicator: StrategicIndicator): number => {
    const pendingProgress = Number(indicator.pendingProgress)
    if (!Number.isFinite(pendingProgress)) {
      return 0
    }

    return pendingProgress - Number(indicator.progress || 0)
  }

  const hasPendingProgressContent = (indicator: StrategicIndicator): boolean => {
    const pendingRemark = String(indicator.pendingRemark || '').trim()
    return hasPendingProgressValue(indicator) || Boolean(pendingRemark)
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

  const currentDetailId = computed(() => currentDetail.value?.id ?? null)

  return {
    PLAN_APPROVAL_HISTORY_WORKFLOW_CODES,
    PLAN_APPROVAL_SUBMIT_WORKFLOW_CODE,
    _addIndicatorToCategory,
    _currentDate,
    _currentTask,
    _deleteIndicator,
    _formatUpdateTime,
    _getProgressClass,
    _goToIndicator,
    _groupedBasicIndicators,
    _groupedDevelopmentIndicators,
    _handleBatchDeleteByTask,
    _handleBatchDistributeByTask,
    _handleBatchWithdrawByTask,
    _handleDoubleClick,
    _handleTableScroll,
    _handleWithdraw,
    _handleWithdrawTask,
    _hasPendingApprovalForDept,
    _openDistributeDialog,
    _saveEdit,
    _selectTask,
    _tableScrollRef,
    _toggleViewMode,
    addNewRow,
    addRowFormRef,
    approvalEntryButtonText,
    approvalFlowStatusMeta,
    approvalIndicators,
    approvalPreviewLoading,
    approvalSetupDialogVisible,
    approvalSubmitComment,
    approvalStatusPopoverLoading,
    approvalStore,
    approvalSubmitting,
    approvalWorkflowPreview,
    approvalWorkflowReportSummary,
    approveIndicatorReview,
    assignmentMethod,
    assignmentTarget,
    authStore,
    backendTaskTypeMap,
    basicIndicators,
    buildTaskIdSet,
    buildTaskTypeMap,
    canCurrentUserHandleCurrentIndicatorWorkflow,
    canCurrentUserSubmitCurrentPlan,
    canDeleteIndicator,
    canDeleteCollegeIndicator,
    canDistribute,
    canEdit,
    canEditIndicators,
    canWithdrawPlan,
    cancelAdd,
    cancelEdit,
    cancelIndicatorEdit,
    closeDistributeDialog,
    confirmAssignment,
    confirmDistribute,
    confirmPlanApprovalSubmission,
    currentApprovalApproverName,
    currentApprovalCandidateNames,
    currentApprovalFlowName,
    currentApprovalStepName,
    currentApprovalStepPreview,
    currentApprovalWorkflowStatus,
    isCurrentPlanUnderApproval,
    currentDepartmentOrgId,
    currentDetail,
    reportHistoryOpen,
    currentDetailId,
    currentDistributeGroup,
    currentDistributeItem,
    currentIndicator,
    currentIndicatorIndex,
    currentIndicatorWorkflow,
    currentIndicatorWorkflowLoading,
    currentPlan,
    currentPlanReportSummary,
    currentPlanScopeLoading,
    currentPlanStatus,
    currentPlanTaskIdSet,
    currentPlanTaskIdSetSignature,
    currentPlanTaskTypeMap,
    currentTaskIndex,
    currentUserId,
    currentUserOrgId,
    currentUserPermissionCodes,
    currentUserRoleCodes,
    departmentAliasNameMap,
    departmentIdNameMap,
    departmentNameIdMap,
    departmentTotalWeight,
    departmentViewLoadingRequestId,
    departmentViewRequestId,
    detailDrawerVisible,
    developmentIndicators,
    distributeButtonDisabled,
    distributeButtonDisabledReason,
    distributeButtonIcon,
    distributeButtonText,
    distributeButtonType,
    distributeDialogVisible,
    distributeTarget,
    editingField,
    editingIndicatorField,
    editingIndicatorId,
    editingIndicatorValue,
    editingValue,
    ensurePersistedTaskIdForIndicator,
    ensurePlanCanDistribute,
    existingTaskNames,
    querySearchTask,
    onTaskOptionSelect,
    onTaskInputBlur,
    findCurrentPlanByDepartment,
    findCurrentPlanByOrgId,
    findExistingTaskIdByName,
    formatDetailDate,
    functionalDepartments,
    collegeDepartments,
    selectedCollege,
    selectCollege,
    collegeTableIndicators,
    collegeDepartmentsScoped,
    indicatorById,
    collegeSpanMethod,
    collegeFillStatusScope,
    refreshCurrentPlanFillApprovalSummary,
    isReportApprovalInFlight,
    isMutationApprovalInFlight,
    getCategoryColor,
    getCategoryText,
    getCurrentActorUserId,
    getCurrentCycleId,
    getIndicatorCategoryLabel,
    getIndicatorMappedTaskType,
    getIndicatorTaskId,
    getIndicatorWorkflowStatusLabel,
    getIndicatorWorkflowTagType,
    getPersistedWithdrawableRows,
    getProgressColor,
    getProgressStatus,
    getDisplayedReportedProgress,
    getPendingProgressDelta,
    getRouteQueryText,
    getSpanMethod,
    getTaskCategoryLabel,
    getTaskGroup,
    getTaskStatus,
    getTaskTypeForPersistence,
    hasPendingProgressContent,
    hasPendingProgressValue,
    shouldShowReportedProgress,
    goToNextIndicator,
    goToPrevIndicator,
    groupIndicatorsByTask,
    handleAddIndicatorToTask,
    handleApprovalRefresh,
    departmentMutationWorkflowEntities,
    loadDepartmentMutationWorkflowEntities,
    departmentPlanFamilyWorkflowEntities,
    loadDepartmentPlanFamilyWorkflowEntities,
    handleApprovalStatusPopoverShow,
    handleApproveCurrentIndicatorWorkflow,
    handleCancelAssignment,
    handleCloseApprovalSetupDialog,
    handleDeleteIndicator,
    handleDistributeAll,
    handleDistributeOrWithdraw,
    handleGlobalClick,
    handleIndicatorDblClick,
    openMutationDialogForField,
    hasMutationDraft,
    mutationDrafts,
    taskNameDrafts,
    pendingCreatedIndicatorIds,
    submitMutationDraft,
    cancelMutationDraft,
    handleOpenApproval,
    handleRejectCurrentIndicatorWorkflow,
    handleSelectionChange,
    handleTaskSelect,
    handleTaskVisibleChange,
    handleViewDetail,
    handleWithdrawAll,
    hasApprovalPreview,
    hasApprovalStepCandidates,
    hasApprovalWorkflowReportBinding,
    hasDistributedIndicators,
    hasWorkflowBinding,
    hydrateCurrentPlanWorkflowState,
    hydratingPlanDetail,
    indicatorByIdMap,
    indicatorWorkflowCache,
    indicators,
    isDepartmentSwitching,
    isAddingOrEditing,
    isBasicIndicatorForCurrentRules,
    isBasicTaskType,
    isBootstrappingPage,
    isCurrentUserReporter,
    isDevelopmentTaskType,
    isIndicatorInCurrentPlanScope,
    isIndicatorInFlowStage,
    isInitialDataLoading,
    isPlanDistributed,
    isReadOnly,
    isSavingIndicatorCell,
    isSavingIndicatorEdit,
    isStrategicDept,
    isTableScrolling,
    lastEditTime,
    latestPlanReportSummary,
    loadBackendTaskTypeMap,
    loadCurrentPlanTaskScope,
    loadIndicatorWorkflowSnapshot,
    loadPendingPlanApprovalCount,
    newRow,
    collegeAddMode,
    collegeParentIndicatorOptions,
    normalizeDepartmentName,
    normalizeEditableText,
    normalizePreviewCandidateDisplayName,
    normalizeTaskId,
    normalizeWorkflowStepName,
    normalizedIndicators,
    openApprovalSetupDialog,
    openNewRowDialog,
    orgStore,
    overallStatus,
    pageTransitionLoading,
    pendingApprovalCount,
    pendingPlanApprovalCount,
    permissionUtil,
    persistTaskContentEdit,
    planStore,
    planUiPhase,
    preloadApprovalWorkflowDetail,
    preloadedPlanWorkflowDetail,
    preservePrefilledTaskBindingOnce,
    primaryApprovalWorkflowEntityId,
    primaryApprovalWorkflowEntityType,
    secondaryApprovalWorkflowEntityId,
    secondaryApprovalWorkflowEntityType,
    refreshApprovalWorkflowSummaries,
    refreshCurrentDepartmentView,
    refreshIndicatorWorkflowContext,
    refreshTaskPageAfterIndicatorMutation,
    registerTaskLocally,
    rejectIndicatorReview,
    resetApprovalSetupDialog,
    resetApprovalWorkflowStateCache,
    resetNewRow,
    resolveDepartmentIdByName,
    resolveExpectedApproverOrgIdForCurrentPlan,
    resolveExpectedApproverRoleCodesForCurrentPlan,
    resolvePlanYear,
    route,
    router,
    saveIndicatorEdit,
    saveNewRow,
    savingIndicatorField,
    savingIndicatorId,
    selectedDepartment,
    selectedIndicators,
    selectDepartment,
    showAssignmentDialog,
    syncCurrentPlanReportSummaries,
    syncSelectedDepartmentFromRoute,
    tableRef,
    taskApprovalVisible,
    taskList,
    taskSelectRef,
    taskSpanMetaMap,
    taskTypeMap,
    taskTypeMapLoading,
    timeContext,
    triggerApprovalForDistribution,
    updateEditTime,
    viewMode
  }
}
