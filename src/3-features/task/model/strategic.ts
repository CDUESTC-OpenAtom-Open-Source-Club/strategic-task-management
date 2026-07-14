/**
 * Strategic Store
 *
 * Manages strategic indicators and tasks.
 * Note: This store should eventually be migrated to features/task/model/store.ts
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { StrategicIndicator, StrategicTask } from '@/shared/types'
import { indicatorApi } from '@/features/indicator/api'
import { milestoneApi } from '@/entities/milestone/api/milestoneApi'
import { strategicApi } from '@/features/task/api/strategicApi'
import { alertApi, type ManualAlertSeverity } from '@/shared/api/monitoringApi'
import { logger } from '@/shared/lib/utils/logger'
import { useOrgStore } from '@/features/organization/model/store'
import { withExponentialRetry } from '@/shared/api/wrappers'
import type { Department } from '@/features/organization/api'
import { resolveIndicatorYear } from '@/shared/lib/utils/indicatorYear'
import { useDataValidator } from '@/shared/lib/validation/dataValidator'
import { USE_MOCK } from '@/shared/config/api'

type BackendIndicatorListPayload =
  | StrategicIndicator[]
  | {
      items?: Array<Record<string, unknown>>
      totalPages?: number
    }

type TaskTypeLookupItem = {
  taskType?: string
  taskName?: string
}

function getRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>
  }
  return {}
}

function isPlaceholderText(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized === 'null' || normalized === 'undefined'
}

function getString(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null) {
      const text = String(value).trim()
      if (text && !isPlaceholderText(text)) {
        return text
      }
    }
  }
  return ''
}

function getNumber(record: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = record[key]
    const num = Number(value)
    if (Number.isFinite(num)) {
      return num
    }
  }
  return 0
}

function getOptionalNumber(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    if (value === undefined || value === null || value === '') {
      continue
    }

    const num = Number(value)
    if (Number.isFinite(num)) {
      return num
    }
  }
  return null
}

function getPendingAttachments(record: Record<string, unknown>): string[] {
  const raw = record.pendingAttachments
  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .map(item => {
      if (typeof item === 'string') {
        return item.trim()
      }
      if (item && typeof item === 'object') {
        return getString(
          item as Record<string, unknown>,
          'url',
          'publicUrl',
          'public_url',
          'objectKey',
          'object_key',
          'name',
          'originalName'
        )
      }
      return ''
    })
    .filter(Boolean)
}

function getBoolean(record: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'boolean') {
      return value
    }
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') {
        return true
      }
      if (value.toLowerCase() === 'false') {
        return false
      }
    }
  }
  return undefined
}

function normalizeManualAlertSeverity(value: unknown): ManualAlertSeverity {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
  if (normalized === 'INFO' || normalized === 'WARNING' || normalized === 'CRITICAL') {
    return normalized
  }
  return null
}

function hasApiData<T>(response: { success?: boolean; code?: number; data?: T | null }) {
  return response.success === true || response.code === 200
}

async function buildIndicatorUpdatePayload(
  updates: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = { ...updates }

  if ('weight' in updates) {
    const numericWeight = Number(updates.weight)
    if (Number.isFinite(numericWeight)) {
      payload.weightPercent = numericWeight
    }
    delete payload.weight
  }

  if ('name' in updates) {
    const indicatorName = String(updates.name ?? '').trim()
    if (indicatorName) {
      payload.indicatorName = indicatorName
      payload.indicatorDesc = indicatorName
    }
    delete payload.name
  }

  if ('responsibleDept' in updates) {
    const orgStore = useOrgStore()
    if (!orgStore.loaded || orgStore.departments.length === 0) {
      await orgStore.loadDepartments()
    }

    const responsibleDept = String(updates.responsibleDept ?? '')
      .split(',')
      .map(item => item.trim())
      .find(Boolean)

    const targetOrgId = resolveDepartmentIdByName(orgStore.departments, responsibleDept)
    if (targetOrgId) {
      payload.targetOrgId = targetOrgId
    }
    delete payload.responsibleDept
  }

  if (
    'type1' in updates ||
    'type' in updates ||
    'indicatorType' in updates ||
    'isQualitative' in updates
  ) {
    payload.type =
      normalizeIndicatorType(
        updates.type1,
        updates.type,
        updates.indicatorType,
        updates.isQualitative === true ? '定性' : updates.isQualitative === false ? '定量' : ''
      ) === '定性'
        ? 'QUALITATIVE'
        : 'QUANTITATIVE'
    delete payload.type1
    delete payload.indicatorType
    delete payload.isQualitative
  }

  return payload
}

function toBackendIndicatorType(...values: unknown[]): '定性' | '定量' {
  return normalizeIndicatorType(...values)
}

function normalizeMilestoneStatus(status: unknown): 'pending' | 'completed' | 'overdue' {
  const normalized = String(status || '')
    .trim()
    .toUpperCase()
  if (normalized === 'COMPLETED') {
    return 'completed'
  }
  if (normalized === 'DELAYED' || normalized === 'CANCELED' || normalized === 'OVERDUE') {
    return 'overdue'
  }
  return 'pending'
}

function normalizeIndicatorType(...values: unknown[]): '定性' | '定量' {
  for (const value of values) {
    const normalized = String(value || '')
      .trim()
      .toUpperCase()
    if (!normalized) {
      continue
    }

    if (normalized === '定性' || normalized === 'QUALITATIVE') {
      return '定性'
    }

    if (normalized === '定量' || normalized === 'QUANTITATIVE') {
      return '定量'
    }
  }

  return '定量'
}

function normalizeMilestones(rawMilestones: unknown): StrategicIndicator['milestones'] {
  if (!Array.isArray(rawMilestones)) {
    return []
  }

  return rawMilestones.map((milestone, index) => {
    const item = getRecord(milestone)
    return {
      id: getString(item, 'id', 'milestoneId') || `milestone-${index}`,
      name: getString(item, 'name', 'milestoneName') || `里程碑${index + 1}`,
      targetProgress: getNumber(item, 'targetProgress', 'weightPercent'),
      deadline: getString(item, 'deadline', 'dueDate'),
      status: normalizeMilestoneStatus(item.status),
      isPaired: getBoolean(item, 'isPaired') ?? false,
      weightPercent: getNumber(item, 'weightPercent', 'targetProgress'),
      sortOrder: getNumber(item, 'sortOrder') || index
    }
  })
}

function normalizeType2FromTaskType(taskType: unknown): '发展性' | '基础性' {
  const normalized = String(taskType || '')
    .trim()
    .toUpperCase()
  if (normalized === 'DEVELOPMENT') {
    return '发展性'
  }
  return '基础性'
}

function normalizeStatusAudit(rawStatusAudit: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(rawStatusAudit)) {
    return rawStatusAudit.filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
    )
  }

  if (typeof rawStatusAudit === 'string') {
    const trimmed = rawStatusAudit.trim()
    if (!trimmed) {
      return []
    }

    try {
      const parsed = JSON.parse(trimmed)
      return Array.isArray(parsed)
        ? parsed.filter(
            (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object'
          )
        : []
    } catch {
      return []
    }
  }

  return []
}

export function toStrategicIndicator(raw: unknown): StrategicIndicator {
  const item = getRecord(raw)
  const id = getString(item, 'id', 'indicatorId')
  const taskId = getString(item, 'taskId', 'task_id', 'strategicTaskId')
  const taskContentRaw = getString(item, 'taskContent', 'taskName')
  const taskContent =
    taskContentRaw ||
    getString(item, 'indicatorName', 'name', 'indicatorDesc') ||
    (taskId ? `计划-${taskId}` : '')
  const createdAt = getString(item, 'createdAt', 'createTime') || new Date().toISOString()
  const parsedYear = Number(getString(item, 'year'))
  const year =
    Number.isFinite(parsedYear) && parsedYear > 0 ? parsedYear : new Date(createdAt).getFullYear()
  const level = getString(item, 'level')
  const status = getString(item, 'status').toUpperCase() || 'DRAFT'
  const isStrategic = getBoolean(item, 'isStrategic')
  const parentIndicatorId = getString(item, 'parentIndicatorId', 'parent_indicator_id', 'parentId')
  // 历史数据中 isStrategic 可能全部为 false，但 FIRST/STRAT_TO_FUNC 仍代表战略指标。
  // 为避免任务下发页被误过滤为空，这里以层级语义优先兜底。
  // 但只要存在 parentIndicatorId，就必须视为子指标，不能再被 FIRST 误判为父指标。
  const normalizedIsStrategic = parentIndicatorId
    ? false
    : isStrategic === true || level === 'FIRST' || level === 'STRAT_TO_FUNC'

  const normalizedIndicator: StrategicIndicator = {
    id: id || String(Date.now()),
    name: getString(item, 'name', 'indicatorName', 'indicatorDesc') || `指标${id || ''}`,
    isQualitative:
      getBoolean(item, 'isQualitative') ??
      normalizeIndicatorType(item.type1, item.indicatorType1, item.indicatorType, item.type) ===
        '定性',
    type1: normalizeIndicatorType(item.type1, item.indicatorType1, item.indicatorType, item.type),
    // type2 已从后端库表移除，前端仅做展示兼容，不再作为业务判断依据
    type2: (getString(item, 'type2', 'indicatorType2') || '基础性') as '发展性' | '基础性',
    progress: getNumber(item, 'progress'),
    manualAlertSeverity: normalizeManualAlertSeverity(item.manualAlertSeverity),
    createTime: createdAt,
    weight: getNumber(item, 'weight', 'weightPercent'),
    remark: getString(item, 'remark'),
    canWithdraw: getBoolean(item, 'canWithdraw') ?? status === 'DISTRIBUTED',
    taskContent: taskContent,
    milestones: normalizeMilestones(item.milestones),
    targetValue: getNumber(item, 'targetValue') || 100,
    actualValue: getNumber(item, 'actualValue', 'progress'),
    unit: getString(item, 'unit') || '%',
    responsibleDept: getString(
      item,
      'responsibleDept',
      'departmentName',
      'targetOrgName',
      'target_org_name',
      'targetOrgId',
      'target_org_id'
    ),
    responsiblePerson: getString(item, 'responsiblePerson'),
    status: status as StrategicIndicator['status'],
    isStrategic: normalizedIsStrategic,
    ownerDept: getString(
      item,
      'ownerDept',
      'ownerOrgName',
      'owner_org_name',
      'ownerOrgId',
      'owner_org_id'
    ),
    year,
    parentIndicatorId: parentIndicatorId || undefined,
    progressApprovalStatus: getString(item, 'progressApprovalStatus').toUpperCase() || 'NONE',
    pendingProgress: getOptionalNumber(item, 'pendingProgress'),
    pendingRemark: getString(item, 'pendingRemark') || null,
    pendingAttachments: getPendingAttachments(item),
    statusAudit: normalizeStatusAudit(item.statusAudit)
  }

  const rawReportProgress = item.reportProgress
  if (rawReportProgress !== undefined && rawReportProgress !== null && rawReportProgress !== '') {
    const reportProgress = Number(rawReportProgress)
    if (Number.isFinite(reportProgress)) {
      ;(
        normalizedIndicator as StrategicIndicator & { reportProgress?: number | null }
      ).reportProgress = reportProgress
    }
  }

  // 保留后端 taskId（运行时字段），供页面按唯一主键关联任务类型。
  if (taskId) {
    ;(normalizedIndicator as StrategicIndicator & { taskId?: string }).taskId = taskId
  }

  // 保留后端组织字段（运行时字段），供页面按稳定的部门 ID 做可见性/筛选判断。
  const runtimeIndicator = normalizedIndicator as StrategicIndicator & {
    targetOrgId?: number
    ownerOrgId?: number
    targetOrgName?: string
    ownerOrgName?: string
    planId?: number
  }

  const targetOrgId = getNumber(item, 'targetOrgId', 'target_org_id')
  if (Number.isFinite(targetOrgId) && targetOrgId > 0) {
    runtimeIndicator.targetOrgId = targetOrgId
  }

  const ownerOrgId = getNumber(item, 'ownerOrgId', 'owner_org_id')
  if (Number.isFinite(ownerOrgId) && ownerOrgId > 0) {
    runtimeIndicator.ownerOrgId = ownerOrgId
  }

  const targetOrgName = getString(item, 'targetOrgName', 'target_org_name')
  if (targetOrgName) {
    runtimeIndicator.targetOrgName = targetOrgName
  }

  const ownerOrgName = getString(item, 'ownerOrgName', 'owner_org_name')
  if (ownerOrgName) {
    runtimeIndicator.ownerOrgName = ownerOrgName
  }

  const planId = getNumber(item, 'planId')
  if (Number.isFinite(planId) && planId > 0) {
    runtimeIndicator.planId = planId
  }

  return normalizedIndicator
}

function buildTaskLookup(rawTasks: unknown): Map<string, TaskTypeLookupItem> {
  if (!Array.isArray(rawTasks)) {
    return new Map()
  }

  const lookup = new Map<string, TaskTypeLookupItem>()
  rawTasks.forEach(task => {
    const item = getRecord(task)
    const taskId = getString(item, 'taskId', 'id')
    if (!taskId) {
      return
    }

    lookup.set(taskId, {
      taskType: getString(item, 'taskType'),
      taskName: getString(item, 'taskName', 'name')
    })
  })
  return lookup
}

function applyTaskMetadata(
  list: StrategicIndicator[],
  taskLookup: Map<string, TaskTypeLookupItem>
): StrategicIndicator[] {
  if (taskLookup.size === 0) {
    return list
  }

  return list.map(indicator => {
    const taskId = String(
      (indicator as StrategicIndicator & { taskId?: string | number }).taskId || ''
    ).trim()
    if (!taskId) {
      return indicator
    }

    const taskInfo = taskLookup.get(taskId)
    if (!taskInfo) {
      return indicator
    }

    const normalizedType2 = normalizeType2FromTaskType(taskInfo.taskType)
    return {
      ...indicator,
      type2: normalizedType2,
      taskContent: taskInfo.taskName || indicator.taskContent
    }
  })
}

async function hydrateIndicatorMilestones(
  list: StrategicIndicator[]
): Promise<StrategicIndicator[]> {
  const indicatorsWithoutMilestones = list.filter(indicator => !indicator.milestones?.length)
  if (indicatorsWithoutMilestones.length === 0) {
    return list
  }

  // 批量查询：1 个请求替代 N 个请求，消除 N+1 问题
  const indicatorIds = indicatorsWithoutMilestones
    .map(i => Number(i.id))
    .filter(id => Number.isFinite(id))

  const milestoneMap = new Map<string, StrategicIndicator['milestones']>()

  if (indicatorIds.length > 0) {
    try {
      const response = await milestoneApi.getMilestonesByIndicatorIds(indicatorIds)
      if (response?.success && response.data) {
        // response.data 是 Record<number, Milestone[]>
        for (const [idStr, rawMilestones] of Object.entries(response.data)) {
          milestoneMap.set(idStr, normalizeMilestones(rawMilestones))
        }
      }
    } catch (err) {
      logger.warn('[Strategic Store] Batch milestones fetch failed, falling back to empty', err)
    }
  }

  return list.map(indicator => ({
    ...indicator,
    milestones: milestoneMap.get(String(indicator.id)) ?? indicator.milestones ?? []
  }))
}

function normalizeIndicators(
  payload: BackendIndicatorListPayload | null | undefined
): StrategicIndicator[] {
  if (!payload) {
    return []
  }

  if (Array.isArray(payload)) {
    return payload.map(item => toStrategicIndicator(item))
  }

  const rawItems = Array.isArray(payload.items) ? payload.items : []
  const normalized = rawItems.map(item => toStrategicIndicator(item))
  if (USE_MOCK) {
    return normalized
  }

  return normalized.filter(indicator => /^\d+$/.test(String(indicator.id || '').trim()))
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message
  }

  return '操作失败，请稍后重试'
}

function getRuntimeTaskId(
  indicator: (StrategicIndicator & { taskId?: string | number }) | null | undefined
): string {
  return String(indicator?.taskId ?? '').trim()
}

function isGenericTaskFallback(taskContent: string, taskId: string): boolean {
  return Boolean(taskId) && taskContent === `计划-${taskId}`
}

function mergePreferredTaskFields(
  baseIndicator: StrategicIndicator & { taskId?: string | number },
  fallbackIndicator: Partial<StrategicIndicator> & { taskId?: string | number }
): StrategicIndicator & { taskId?: string | number } {
  const nextIndicator = {
    ...baseIndicator
  }

  const fallbackTaskId = String(fallbackIndicator.taskId ?? '').trim()
  if (!getRuntimeTaskId(nextIndicator) && fallbackTaskId) {
    nextIndicator.taskId = fallbackTaskId
  }

  const currentTaskId = getRuntimeTaskId(nextIndicator)
  const currentTaskContent = String(nextIndicator.taskContent || '').trim()
  const fallbackTaskContent = String(fallbackIndicator.taskContent || '').trim()

  if (
    (!currentTaskContent || isGenericTaskFallback(currentTaskContent, currentTaskId)) &&
    fallbackTaskContent
  ) {
    nextIndicator.taskContent = fallbackTaskContent
  }

  return nextIndicator
}

function mergePreferredTaskCategory(
  baseIndicator: StrategicIndicator,
  fallbackIndicator: Partial<StrategicIndicator>
): StrategicIndicator {
  const nextIndicator = {
    ...baseIndicator
  }

  const currentType2 = String(nextIndicator.type2 || '').trim()
  const fallbackType2 = String(fallbackIndicator.type2 || '').trim()

  if (!currentType2 && fallbackType2) {
    nextIndicator.type2 = fallbackType2 as StrategicIndicator['type2']
  }

  return nextIndicator
}

function buildDepartmentResolver(departments: Department[]) {
  const idToName = new Map<string, string>()
  const aliasToCanonical = new Map<string, string>()

  departments.forEach(dept => {
    const canonical = String(dept.name || '').trim()
    const id = String(dept.id || '').trim()

    if (!canonical) {
      return
    }

    if (id) {
      idToName.set(id, canonical)
    }

    // 完整名称本身可被解析
    aliasToCanonical.set(canonical, canonical)

    // 兼容合并名称：例如 "党委办公室 | 党委统战部"
    canonical
      .split('|')
      .map(part => part.trim())
      .filter(Boolean)
      .forEach(part => {
        aliasToCanonical.set(part, canonical)
      })
  })

  return (value: string): string => {
    const raw = String(value || '').trim()
    if (!raw) {
      return ''
    }

    const mappedById = idToName.get(raw)
    if (mappedById) {
      return mappedById
    }

    const mappedByAlias = aliasToCanonical.get(raw)
    if (mappedByAlias) {
      return mappedByAlias
    }

    return raw
  }
}

function normalizeIndicatorDepartments(
  list: StrategicIndicator[],
  resolveDept: (value: string) => string
): StrategicIndicator[] {
  return list.map(item => ({
    ...item,
    ownerDept: resolveDept(item.ownerDept || ''),
    responsibleDept: resolveDept(item.responsibleDept || '')
  }))
}

async function hydrateManualAlertLevels(list: StrategicIndicator[]): Promise<StrategicIndicator[]> {
  const indicatorIds = list.map(item => Number(item.id)).filter(id => Number.isFinite(id) && id > 0)

  if (indicatorIds.length === 0) {
    return list
  }

  try {
    const levels = await alertApi.getManualAlertLevels(indicatorIds)
    return list.map(item => {
      const severity = levels[String(item.id)] ?? levels[Number(item.id)]
      return {
        ...item,
        manualAlertSeverity: normalizeManualAlertSeverity(severity)
      }
    })
  } catch (alertError) {
    logger.warn('[Strategic Store] 手动预警等级加载失败，跳过预警等级回显', alertError)
    return list
  }
}

function resolveDepartmentIdByName(
  departments: Department[],
  value: string | undefined | null
): number | null {
  const raw = String(value || '').trim()
  if (!raw) {
    return null
  }

  const directMatch = departments.find(dept => dept.name === raw || dept.id === raw)
  if (directMatch) {
    return Number(directMatch.id)
  }

  const aliasMatch = departments.find(dept =>
    dept.name
      .split('|')
      .map(part => part.trim())
      .filter(Boolean)
      .includes(raw)
  )
  if (aliasMatch) {
    return Number(aliasMatch.id)
  }

  return null
}

export const useStrategicStore = defineStore('strategic', () => {
  // ============ State ============

  const indicators = ref<StrategicIndicator[]>([])
  const loading = ref(false)
  const loadingState = ref({
    indicators: false,
    tasks: false,
    error: null as string | null
  })
  const error = ref<string | null>(null)
  const dataSource = ref<'api' | 'local'>('local')
  const validationState = ref({
    lastValidated: null as Date | null,
    isValid: true,
    issues: [] as string[]
  })
  const loadingYearPromise = ref<Promise<StrategicIndicator[]> | null>(null)
  const loadingYear = ref<number | null>(null)

  // ============ Getters ============

  const activeIndicators = computed(() => indicators.value.filter(i => i.status === 'active'))

  const strategicIndicators = computed(() => indicators.value.filter(i => i.isStrategic === true))

  // Legacy compatibility: several pages still expect a task collection on this store.
  const tasks = computed<StrategicTask[]>(() => {
    const taskMap = new Map<string, StrategicTask>()

    indicators.value.forEach(indicator => {
      const taskKey = indicator.taskContent || indicator.id || indicator.name
      const resolvedYear = resolveIndicatorYear(indicator, new Date().getFullYear())
      if (!taskMap.has(taskKey)) {
        taskMap.set(taskKey, {
          id: taskKey,
          title: indicator.taskContent || indicator.name || '未命名任务',
          desc: indicator.remark || '',
          createTime: indicator.createTime || new Date().toISOString(),
          cycle: `${resolvedYear}年度`,
          startDate: new Date(`${resolvedYear}-01-01`),
          endDate: new Date(`${resolvedYear}-12-31`),
          status: 'active',
          createdBy: indicator.ownerDept || 'system',
          indicators: [],
          year: resolvedYear,
          isRecurring: false
        })
      }

      const task = taskMap.get(taskKey)
      if (task) {
        task.indicators.push(indicator)
      }
    })

    return [...taskMap.values()]
  })

  // ============ Actions ============

  async function loadIndicatorsByYear(year: number, options: { force?: boolean } = {}) {
    if (loadingYearPromise.value && loadingYear.value === year) {
      return loadingYearPromise.value
    }

    loading.value = true
    loadingState.value.indicators = true
    loadingState.value.error = null
    error.value = null

    loadingYear.value = year
    const request = (async () => {
      try {
        logger.debug(`[Strategic Store] Loading indicators for year ${year}`)
        const [response, tasksResponse] = await withExponentialRetry(
          () =>
            Promise.all([
              indicatorApi.getAllIndicators(
                year,
                { page: 0, size: 1000 },
                { force: options.force }
              ),
              strategicApi.getTasksByYear(year)
            ]),
          {
            maxRetries: 3,
            baseDelay: 800,
            maxDelay: 2500
          }
        )

        if (response.success && response.data) {
          const normalized = normalizeIndicators(response.data as BackendIndicatorListPayload)
          const taskLookup = buildTaskLookup(tasksResponse.data)
          const aligned = applyTaskMetadata(normalized, taskLookup)
          const hydrated = await hydrateIndicatorMilestones(aligned)
          const alertHydrated = await hydrateManualAlertLevels(hydrated)

          // 统一部门字段：ID/别名 -> 标准部门名（含合并名称），避免跨页面筛选不命中
          const orgStore = useOrgStore()
          if (!orgStore.loaded || orgStore.departments.length === 0) {
            try {
              await orgStore.loadDepartments()
            } catch (orgError) {
              logger.warn('[Strategic Store] 组织数据加载失败，跳过部门归一化', orgError)
            }
          }
          const resolveDept = buildDepartmentResolver(orgStore.departments)
          indicators.value = normalizeIndicatorDepartments(alertHydrated, resolveDept)

          dataSource.value = 'api'
          logger.debug(`[Strategic Store] Loaded ${indicators.value.length} indicators`)
          return indicators.value
        }

        throw new Error(response.message || 'Failed to load indicators')
      } catch (err) {
        error.value = err instanceof Error ? err.message : 'Unknown error'
        loadingState.value.error = error.value
        indicators.value = []
        dataSource.value = 'local'
        logger.error('[Strategic Store] Failed to load indicators:', err)
        throw err
      } finally {
        loading.value = false
        loadingState.value.indicators = false
        loadingYearPromise.value = null
        loadingYear.value = null
      }
    })()

    loadingYearPromise.value = request
    return request
  }

  async function fetchIndicators(options: { force?: boolean } = {}) {
    return loadIndicatorsByYear(new Date().getFullYear(), options)
  }

  async function updateIndicator(id: string, data: Record<string, unknown>) {
    try {
      const isPersistedId = /^\d+$/.test(id)
      if (!isPersistedId) {
        throw new Error(`指标 ${id} 尚未持久化，无法更新后端数据`)
      }

      const index = indicators.value.findIndex(i => String(i.id) === String(id))
      const currentIndicator = index !== -1 ? indicators.value[index] : null
      const requestPayload = await buildIndicatorUpdatePayload({
        ...(currentIndicator &&
        !('type1' in data) &&
        !('type' in data) &&
        !('indicatorType' in data) &&
        !('isQualitative' in data)
          ? {
              type1: currentIndicator.type1,
              isQualitative: currentIndicator.isQualitative
            }
          : {}),
        ...data
      })
      const response = await indicatorApi.updateIndicator(id, requestPayload)

      if (hasApiData(response)) {
        if (index !== -1) {
          const normalized = response.data ? toStrategicIndicator(response.data) : null
          const mergedIndicator = {
            ...indicators.value[index],
            ...data,
            ...(normalized || {})
          }
          const preferredTaskFields = mergePreferredTaskFields(mergedIndicator, {
            taskId: getRuntimeTaskId(
              currentIndicator as StrategicIndicator & { taskId?: string | number }
            ),
            taskContent:
              currentIndicator?.taskContent ||
              (typeof data.taskContent === 'string' ? data.taskContent : '')
          })
          indicators.value[index] = mergePreferredTaskCategory(preferredTaskFields, {
            type2: typeof data.type2 === 'string' ? data.type2 : currentIndicator?.type2
          })
        }
      } else {
        throw new Error(response.message || 'Failed to update indicator')
      }

      return response
    } catch (err) {
      console.error('[Strategic Store] updateIndicator error:', err)
      console.error('[Strategic Store] Error stack:', err instanceof Error ? err.stack : 'N/A')
      logger.error('[Strategic Store] Failed to update indicator:', err)
      throw new Error(getErrorMessage(err))
    }
  }

  async function deleteIndicator(id: string) {
    try {
      logger.debug(`[Strategic Store] Deleting indicator ${id}`)

      const isPersistedId = /^\d+$/.test(id)
      if (!isPersistedId) {
        throw new Error(`指标 ${id} 尚未持久化，无法删除后端数据`)
      }

      const response = await indicatorApi.deleteIndicator(id)

      if (response.success) {
        // Remove from local state
        const index = indicators.value.findIndex(i => String(i.id) === id)
        if (index !== -1) {
          indicators.value.splice(index, 1)
        }
        logger.debug(`[Strategic Store] Indicator ${id} deleted successfully`)
      } else {
        const msg = String(response.message || '')
        // 后端已删除/不存在：前端视作删除成功，避免重复删除时阻断流程
        if (
          msg.includes('not found') ||
          msg.includes('already deleted') ||
          msg.includes('不存在')
        ) {
          const index = indicators.value.findIndex(i => String(i.id) === id)
          if (index !== -1) {
            indicators.value.splice(index, 1)
          }
          logger.warn(
            `[Strategic Store] Indicator ${id} was already removed in backend, treated as success`
          )
          return {
            ...response,
            success: true
          }
        }
        throw new Error(response.message || 'Failed to delete indicator')
      }

      return response
    } catch (err) {
      logger.error('[Strategic Store] Failed to delete indicator:', err)
      throw err
    }
  }

  async function updateManualAlertLevel(id: string, severity: ManualAlertSeverity) {
    try {
      if (!/^\d+$/.test(id)) {
        throw new Error(`指标 ${id} 尚未持久化，无法设置预警等级`)
      }

      await alertApi.setManualAlertLevel(id, severity)
      const index = indicators.value.findIndex(i => String(i.id) === String(id))
      if (index !== -1) {
        indicators.value[index] = {
          ...indicators.value[index],
          manualAlertSeverity: severity
        }
      }
    } catch (err) {
      logger.error('[Strategic Store] Failed to update manual alert level:', err)
      throw err
    }
  }

  async function addIndicator(
    indicator: StrategicIndicator & {
      taskId?: string | number
    }
  ) {
    try {
      logger.debug('[Strategic Store] Creating indicator', indicator)

      const orgStore = useOrgStore()
      if (!orgStore.loaded || orgStore.departments.length === 0) {
        await orgStore.loadDepartments()
      }

      const ownerOrgId =
        resolveDepartmentIdByName(orgStore.departments, indicator.ownerDept) ||
        resolveDepartmentIdByName(orgStore.departments, '战略发展部')
      const targetOrgId =
        resolveDepartmentIdByName(orgStore.departments, indicator.responsibleDept) || ownerOrgId

      if (!ownerOrgId || !targetOrgId) {
        throw new Error('缺少指标归属部门信息，无法创建指标')
      }

      const taskId =
        indicator.taskId !== undefined && indicator.taskId !== null && `${indicator.taskId}`.trim()
          ? Number(indicator.taskId)
          : undefined
      const parentIndicatorId =
        indicator.parentIndicatorId !== undefined &&
        indicator.parentIndicatorId !== null &&
        `${indicator.parentIndicatorId}`.trim()
          ? Number(indicator.parentIndicatorId)
          : undefined

      const response = await indicatorApi.createIndicator({
        indicatorDesc: indicator.name,
        type1: toBackendIndicatorType(
          indicator.type1,
          (indicator as StrategicIndicator & { type?: string }).type,
          (indicator as StrategicIndicator & { indicatorType?: string }).indicatorType,
          indicator.isQualitative === true
            ? '定性'
            : indicator.isQualitative === false
              ? '定量'
              : ''
        ),
        taskId: Number.isFinite(taskId) ? taskId : undefined,
        parentIndicatorId: Number.isFinite(parentIndicatorId) ? parentIndicatorId : undefined,
        ownerOrgId,
        targetOrgId,
        weightPercent: Number(indicator.weight) || 0,
        sortOrder: 0,
        remark: indicator.remark || undefined,
        progress: Number(indicator.progress) || 0
      })

      if (!response.success || !response.data) {
        throw new Error(response.message || 'Failed to create indicator')
      }

      const normalized = toStrategicIndicator(response.data)
      indicators.value.unshift(
        mergePreferredTaskFields(normalized as StrategicIndicator & { taskId?: string | number }, {
          taskId:
            indicator.taskId !== undefined && indicator.taskId !== null
              ? String(indicator.taskId)
              : '',
          taskContent: indicator.taskContent
        })
      )
      return response
    } catch (err) {
      logger.error('[Strategic Store] Failed to create indicator:', err)
      throw err
    }
  }

  async function withdrawIndicator(id: string, reason?: string) {
    try {
      logger.debug(`[Strategic Store] Withdrawing indicator ${id}`)

      if (!/^\d+$/.test(id)) {
        throw new Error(`指标 ${id} 尚未持久化，无法撤回`)
      }

      const response = await indicatorApi.withdrawIndicator(id)
      if (!response.success || !response.data) {
        throw new Error(response.message || 'Failed to withdraw indicator')
      }

      const index = indicators.value.findIndex(i => String(i.id) === String(id))
      if (index !== -1) {
        const normalized = toStrategicIndicator(response.data)
        indicators.value[index] = {
          ...indicators.value[index],
          ...normalized,
          remark: reason || normalized.remark || indicators.value[index].remark
        }
      }

      return response
    } catch (err) {
      logger.error('[Strategic Store] Failed to withdraw indicator:', err)
      throw err
    }
  }

  function addStatusAuditEntry(id: string, entry: Record<string, unknown>) {
    const index = indicators.value.findIndex(i => String(i.id) === String(id))
    if (index === -1) {
      return
    }

    const currentAudit = Array.isArray(indicators.value[index].statusAudit)
      ? indicators.value[index].statusAudit
      : []

    indicators.value[index] = {
      ...indicators.value[index],
      statusAudit: [
        ...currentAudit,
        {
          id: String(entry.id || `audit-${id}-${Date.now()}`),
          timestamp:
            entry.timestamp instanceof Date
              ? entry.timestamp.toISOString()
              : String(entry.timestamp || new Date().toISOString()),
          ...entry
        }
      ]
    }
  }

  function getIndicatorById(id: string) {
    return indicators.value.find(item => String(item.id) === String(id))
  }

  function addDraftIndicator(
    indicator: StrategicIndicator & {
      taskId?: string | number
    }
  ) {
    indicators.value.unshift({
      ...indicator,
      id: String(indicator.id)
    })
  }

  function replaceIndicatorId(
    oldId: string,
    newId: string,
    patch: Partial<StrategicIndicator> = {}
  ) {
    const index = indicators.value.findIndex(item => String(item.id) === String(oldId))
    if (index === -1) {
      return
    }

    indicators.value[index] = {
      ...indicators.value[index],
      ...patch,
      id: newId
    }
  }

  function patchIndicator(
    id: string,
    patch: Partial<StrategicIndicator> & { taskId?: string | number }
  ) {
    const index = indicators.value.findIndex(item => String(item.id) === String(id))
    if (index === -1) {
      return
    }

    indicators.value[index] = {
      ...indicators.value[index],
      ...patch
    }
  }

  function patchIndicatorsByTaskId(
    taskId: string | number,
    patch: Partial<StrategicIndicator> & { taskId?: string | number }
  ) {
    const normalizedTaskId = String(taskId).trim()
    if (!normalizedTaskId) {
      return
    }

    indicators.value = indicators.value.map(item => {
      const itemTaskId = String(
        (item as StrategicIndicator & { taskId?: string | number }).taskId ?? ''
      ).trim()
      if (itemTaskId !== normalizedTaskId) {
        return item
      }

      return {
        ...item,
        ...patch
      }
    })
  }

  function clearError() {
    error.value = null
    loadingState.value.error = null
  }

  function validateCurrentData() {
    const validator = useDataValidator()
    const issues: string[] = []

    indicators.value.forEach((indicator, index) => {
      const result = validator.validateIndicator(indicator)
      if (!result.isValid) {
        issues.push(
          ...result.errors.map(item => `indicator[${index}].${item.field}: ${item.message}`)
        )
      }
    })

    const isValid = issues.length === 0
    validationState.value = {
      lastValidated: new Date(),
      isValid,
      issues
    }

    return {
      isValid,
      errors: issues,
      warnings: []
    }
  }

  function getDataHealth() {
    const taskCount = tasks.value.length
    const indicatorCount = indicators.value.length
    const validationIssues = validationState.value.issues.length

    let status: 'healthy' | 'warning' | 'critical' = 'healthy'
    if (validationIssues > 0) {
      status = 'warning'
    }
    if (indicatorCount === 0 && dataSource.value !== 'api') {
      status = 'critical'
    }

    return {
      status,
      dataSource: dataSource.value,
      indicatorCount,
      taskCount,
      validationIssues,
      lastValidated: validationState.value.lastValidated
    }
  }

  return {
    indicators,
    tasks,
    loading,
    loadingState,
    error,
    dataSource,
    validationState,
    activeIndicators,
    strategicIndicators,
    fetchIndicators,
    loadIndicatorsByYear,
    getIndicatorById,
    addIndicator,
    addDraftIndicator,
    replaceIndicatorId,
    patchIndicator,
    patchIndicatorsByTaskId,
    updateIndicator,
    updateManualAlertLevel,
    deleteIndicator,
    withdrawIndicator,
    addStatusAuditEntry,
    clearError,
    validateCurrentData,
    getDataHealth
  }
})
