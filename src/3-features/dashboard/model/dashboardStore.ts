import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type {
  DashboardData,
  DepartmentProgress,
  ApiResponse as _ApiResponse,
  DrillDownLevel,
  BreadcrumbItem,
  FilterState,
  AlertSummary,
  StrategicIndicator,
  ComparisonItem,
  SankeyData,
  SankeyLink,
  SankeyNode as _SankeyNode,
  SourcePieData,
  OrgLevel,
  UserRole as _UserRole
} from '@/shared/types'
import { useStrategicStore } from './strategic'
import { useAuthStore } from './auth'
import { useTimeContextStore } from './timeContext'
import { getProgressStatus, isSecondaryCollege } from '@/shared/lib/utils/colors'
import { useOrgStore } from './org'
import { logger } from '@/shared/lib/utils/logger'
import { alertApi, type AlertStats, type AlertEvent } from '@/shared/api/monitoringApi'
import { dashboardApi } from '@/features/dashboard/api/dashboardApi'
import { resolveIndicatorYear } from '@/shared/lib/utils/indicatorYear'

export const useDashboardStore = defineStore('dashboard', () => {
  // State
  const dashboardData = ref<DashboardData>({
    totalScore: 0,
    basicScore: 0,
    developmentScore: 0,
    completionRate: 0,
    warningCount: 0,
    totalIndicators: 0,
    completedIndicators: 0,
    alertIndicators: {
      severe: 0,
      moderate: 0,
      normal: 0
    }
  })
  const departmentProgress = ref<DepartmentProgress[]>([])
  const recentActivities = ref<Array<Record<string, unknown>>>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 预警告警状态
  const alertStatsData = ref<AlertStats | null>(null)
  const unclosedAlerts = ref<AlertEvent[]>([])
  const alertsLoading = ref(false)

  // 下钻和筛选状态
  const currentLevel = ref<DrillDownLevel>('organization')
  const breadcrumbs = ref<BreadcrumbItem[]>([{ level: 'organization', label: '组织总览' }])
  const filters = ref<FilterState>({})
  const selectedDepartment = ref<string | undefined>()
  const selectedIndicator = ref<string | undefined>()

  // 三级联动状态
  const currentOrgLevel = ref<OrgLevel>('strategy') // 当前组织层级
  const selectedFunctionalDept = ref<string | undefined>() // 选中的职能部门
  const selectedCollege = ref<string | undefined>() // 选中的二级学院

  // Getters
  const completionRate = computed(() => dashboardData.value?.completionRate || 0)
  const totalScore = computed(() => dashboardData.value?.totalScore || 0)
  const warningCount = computed(() => dashboardData.value?.warningCount || 0)
  const alertStats = computed(
    () => dashboardData.value?.alertIndicators || { severe: 0, moderate: 0, normal: 0 }
  )

  // 预警统计计算属性
  const totalAlerts = computed(() => alertStatsData.value?.totalOpen || 0)
  const criticalAlerts = computed(() => alertStatsData.value?.countBySeverity.CRITICAL || 0)
  const majorAlerts = computed(
    () =>
      (alertStatsData.value?.countBySeverity.WARNING || 0) +
      (alertStatsData.value?.countBySeverity.MAJOR || 0)
  )
  const minorAlerts = computed(
    () =>
      (alertStatsData.value?.countBySeverity.INFO || 0) +
      (alertStatsData.value?.countBySeverity.MINOR || 0)
  )

  // 筛选后的指标列表
  const filteredIndicators = computed<StrategicIndicator[]>(() => {
    const strategicStore = useStrategicStore()
    const timeContext = useTimeContextStore()
    let result = [...strategicStore.indicators]

    // 按当前年份过滤
    // 没有 year 字段的指标默认为当前真实年份（2025）
    const currentYear = timeContext.currentYear
    const realYear = timeContext.realCurrentYear
    result = result.filter(i => {
      const indicatorYear = resolveIndicatorYear(i, realYear)
      return indicatorYear === currentYear
    })

    // 按部门筛选
    if (filters.value.department) {
      result = result.filter(i => i.responsibleDept === filters.value.department)
    }

    // 按指标类型筛选
    if (filters.value.indicatorType) {
      result = result.filter(i => i.type1 === filters.value.indicatorType)
    }

    // 按预警级别筛选
    if (filters.value.alertLevel) {
      result = result.filter(i => {
        const level = getAlertLevel(i.progress)
        return level === filters.value.alertLevel
      })
    }

    // 按当前下钻层级筛选
    if (currentLevel.value === 'department' && selectedDepartment.value) {
      result = result.filter(i => i.responsibleDept === selectedDepartment.value)
    }

    return result
  })

  // 部门汇总数据（支持历史数据）
  const departmentSummary = computed<DepartmentProgress[]>(() => {
    const authStore = useAuthStore()
    const orgStore = useOrgStore()
    const role = authStore.effectiveRole // 使用有效角色（考虑视角切换）
    const userDept = authStore.effectiveDepartment // 使用有效部门（考虑视角切换）

    // 使用带历史数据支持的指标
    const indicators = visibleIndicatorsWithHistory.value

    // 根据下钻状态和角色确定要显示的部门和过滤的指标
    let targetIndicators = indicators
    const targetDepartments: Set<string> = new Set()
    let summaryGroupField: 'responsibleDept' | 'ownerDept' = 'responsibleDept'

    // 如果下钻到职能部门层级，只显示该部门下发任务的目标组织
    if (currentOrgLevel.value === 'functional' && selectedFunctionalDept.value) {
      // 筛选该职能部门下发的指标
      const deptIndicators = indicators.filter(i => i.ownerDept === selectedFunctionalDept.value)
      targetIndicators = deptIndicators
      // 只收集实际有任务下发的目标组织
      deptIndicators.forEach(i => {
        if (i.responsibleDept) {
          targetDepartments.add(i.responsibleDept)
        }
      })
    } else {
      // 根据角色获取应该显示的所有部门
      if (role === 'strategic_dept') {
        // 战略发展部只看职能部门（不包含学院）
        orgStore.functionalDepartments.forEach(d => targetDepartments.add(d.name))
      } else if (role === 'functional_dept') {
        // 职能部门只看它实际下发任务的目标部门（二级学院）
        // 筛选该职能部门下发的指标，获取实际的目标部门
        const deptIndicators = indicators.filter(i => i.ownerDept === userDept && !i.canWithdraw)
        deptIndicators.forEach(i => {
          if (i.responsibleDept && i.responsibleDept !== userDept) {
            targetDepartments.add(i.responsibleDept)
          }
        })
        targetIndicators = deptIndicators
      } else {
        // 二级学院：看“上级来源部门”给本学院下发了哪些任务（按 ownerDept 分组）
        if (userDept) {
          targetIndicators = indicators.filter(i => i.responsibleDept === userDept)
          summaryGroupField = 'ownerDept'
          targetIndicators.forEach(i => {
            targetDepartments.add(i.ownerDept || '其他')
          })
        }
      }
    }

    // 初始化部门数据
    const deptMap = new Map<
      string,
      { total: number; progress: number; count: number; alerts: number }
    >()
    targetDepartments.forEach(dept => {
      deptMap.set(dept, { total: 0, progress: 0, count: 0, alerts: 0 })
    })

    // 统计实际指标数据
    targetIndicators.forEach(indicator => {
      const dept =
        summaryGroupField === 'ownerDept'
          ? indicator.ownerDept || '其他'
          : indicator.responsibleDept
      if (!dept) {
        return
      } // Skip indicators without responsible department

      // 战略发展部：只统计职能部门的指标，跳过学院
      if (role === 'strategic_dept' && !targetDepartments.has(dept)) {
        return
      }

      if (!deptMap.has(dept)) {
        // 下钻模式下只统计目标部门，非下钻模式可以添加新部门
        if (currentOrgLevel.value !== 'functional') {
          deptMap.set(dept, { total: 0, progress: 0, count: 0, alerts: 0 })
        } else {
          return
        }
      }
      const data = deptMap.get(dept)
      if (!data) {
        return
      }
      data.total += indicator.weight
      data.progress += indicator.progress
      data.count += 1
      if (indicator.progress < 60) {
        data.alerts += 1
      }
    })

    // 生成结果列表
    const result: DepartmentProgress[] = []
    deptMap.forEach((data, dept) => {
      // 下钻模式下只显示有任务的部门
      if (currentOrgLevel.value === 'functional' && data.count === 0) {
        return
      }
      // 战略发展部：显示所有职能部门，即使没有指标
      // 职能部门和学院：只显示有指标的部门
      if (role !== 'strategic_dept' && data.count === 0) {
        return
      }
      const avgProgress = data.count > 0 ? Math.round(data.progress / data.count) : 0
      result.push({
        dept,
        progress: avgProgress,
        score: Math.round(avgProgress * 1.2),
        status: avgProgress >= 80 ? 'success' : avgProgress >= 50 ? 'warning' : 'exception',
        totalIndicators: data.count,
        completedIndicators: 0,
        alertCount: data.alerts
      })
    })

    // 按进度排序
    return result.sort((a, b) => b.progress - a.progress)
  })

  // 预警分布
  const alertDistribution = computed<AlertSummary>(() => {
    const strategicStore = useStrategicStore()
    const indicators =
      filteredIndicators.value.length > 0 ? filteredIndicators.value : strategicStore.indicators

    const severe = indicators.filter(i => i.progress < 30).length
    const moderate = indicators.filter(i => i.progress >= 30 && i.progress < 60).length
    const normal = indicators.filter(i => i.progress >= 60).length

    return { severe, moderate, normal, total: indicators.length }
  })

  // 辅助函数：获取预警级别
  const getAlertLevel = (progress: number): 'severe' | 'moderate' | 'normal' => {
    if (progress < 30) {
      return 'severe'
    }
    if (progress < 60) {
      return 'moderate'
    }
    return 'normal'
  }

  // 三级联动 Computed Getters

  // 根据角色和下钻层级动态过滤数据
  const visibleIndicators = computed<StrategicIndicator[]>(() => {
    const authStore = useAuthStore()
    const strategicStore = useStrategicStore()
    const timeContext = useTimeContextStore()
    const _orgStore = useOrgStore()
    // 使用有效角色（考虑视角切换）
    const role = authStore.effectiveRole
    const dept = authStore.effectiveDepartment
    let indicators = [...strategicStore.indicators]

    // 按当前年份过滤
    // 没有 year 字段的指标默认为当前真实年份（2025）
    const currentYear = timeContext.currentYear
    const realYear = timeContext.realCurrentYear
    indicators = indicators.filter(i => {
      const indicatorYear = resolveIndicatorYear(i, realYear)
      return indicatorYear === currentYear
    })

    // 角色过滤
    if (role === 'functional_dept') {
      // 职能部门看本部门发布的指标或本部门负责的指标
      indicators = indicators.filter(i => i.ownerDept === dept || i.responsibleDept === dept)
    } else if (role === 'secondary_college') {
      // 二级学院只看承接的指标
      indicators = indicators.filter(i => i.responsibleDept === dept)
    }

    // 下钻层级过滤
    if (currentOrgLevel.value === 'functional' && selectedFunctionalDept.value) {
      // 查看某个职能部门的详情：该部门下发的指标
      indicators = indicators.filter(
        i =>
          i.ownerDept === selectedFunctionalDept.value ||
          i.responsibleDept === selectedFunctionalDept.value
      )
    } else if (currentOrgLevel.value === 'college' && selectedCollege.value) {
      // 查看某个学院的详情：该学院承接的指标
      indicators = indicators.filter(i => i.responsibleDept === selectedCollege.value)
    }

    // 应用用户筛选
    if (filters.value.department) {
      indicators = indicators.filter(i => i.responsibleDept === filters.value.department)
    }

    if (filters.value.indicatorType) {
      indicators = indicators.filter(i => i.type1 === filters.value.indicatorType)
    }

    if (filters.value.alertLevel) {
      indicators = indicators.filter(i => {
        const level = getAlertLevel(i.progress)
        return level === filters.value.alertLevel
      })
    }

    if (filters.value.sourceOwner) {
      indicators = indicators.filter(i => i.ownerDept === filters.value.sourceOwner)
    }

    if (filters.value.collegeFilter) {
      indicators = indicators.filter(i => i.responsibleDept === filters.value.collegeFilter)
    }

    return indicators
  })

  // 辅助函数：获取指标在指定时间点的进度
  const getIndicatorProgressAtDate = (indicator: StrategicIndicator, targetDate: Date): number => {
    // 如果没有审批记录，返回当前进度
    if (!indicator.statusAudit || indicator.statusAudit.length === 0) {
      return indicator.progress
    }

    // 找到目标时间之前最近的一次审批记录
    const targetTime = targetDate.getTime()
    let latestProgress = 0 // 默认初始进度为0

    // 按时间排序审批记录
    const sortedAudits = [...indicator.statusAudit].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )

    // 找到目标时间之前的最后一次进度更新
    for (const audit of sortedAudits) {
      const auditTime = new Date(audit.timestamp).getTime()
      if (auditTime <= targetTime) {
        // 如果是审批通过，使用newProgress
        if (audit.action === 'approve' && audit.newProgress !== undefined) {
          latestProgress = audit.newProgress
        }
      } else {
        break // 已经超过目标时间，停止查找
      }
    }

    return latestProgress
  }

  // 带历史数据支持的可见指标（用于图表展示）
  const visibleIndicatorsWithHistory = computed<StrategicIndicator[]>(() => {
    const indicators = visibleIndicators.value
    const timeContext = useTimeContextStore()

    // 如果是当前年份，直接返回当前数据
    if (timeContext.isCurrentYear) {
      return indicators
    }

    // 如果是历史年份，获取该年份12月31日的历史数据
    const targetDate = new Date(timeContext.currentYear, 11, 31, 23, 59, 59) // 该年份的最后一刻

    // 返回带有历史进度的指标副本
    return indicators.map(indicator => ({
      ...indicator,
      progress: getIndicatorProgressAtDate(indicator, targetDate)
    }))
  })

  // 辅助函数：按部门聚合数据
  const aggregateByDepartment = (
    indicators: StrategicIndicator[],
    groupField: keyof StrategicIndicator = 'responsibleDept'
  ): ComparisonItem[] => {
    const deptMap = new Map<
      string,
      {
        totalProgress: number
        totalWeight: number
        count: number
        completed: number
        alerts: number
      }
    >()

    indicators.forEach(indicator => {
      const deptName = indicator[groupField] as string
      if (!deptName) {
        return
      } // Skip indicators without department
      if (!deptMap.has(deptName)) {
        deptMap.set(deptName, {
          totalProgress: 0,
          totalWeight: 0,
          count: 0,
          completed: 0,
          alerts: 0
        })
      }

      const data = deptMap.get(deptName)
      if (!data) {
        return
      }
      data.totalProgress += indicator.progress * indicator.weight
      data.totalWeight += indicator.weight
      data.count += 1
      if (indicator.progress >= 100) {
        data.completed += 1
      }
      if (indicator.progress < 60) {
        data.alerts += 1
      }
    })

    const result: ComparisonItem[] = []
    deptMap.forEach((data, deptName) => {
      const avgProgress =
        data.totalWeight > 0 ? Math.round(data.totalProgress / data.totalWeight) : 0
      const completionRate = data.count > 0 ? Math.round((data.completed / data.count) * 100) : 0

      result.push({
        dept: deptName,
        progress: avgProgress,
        score: Math.round(avgProgress * 1.2), // 满分120
        completionRate,
        totalIndicators: data.count,
        completedIndicators: data.completed,
        alertCount: data.alerts,
        status: getProgressStatus(avgProgress),
        rank: 0 // 待排序后填充
      })
    })

    // 按进度排序并添加排名
    result.sort((a, b) => b.progress - a.progress)
    result.forEach((item, index) => {
      item.rank = index + 1
    })

    return result
  }

  // 部门对比数据（用于 ComparisonChart）
  const departmentComparison = computed<ComparisonItem[]>(() => {
    const authStore = useAuthStore()
    const role = authStore.user?.role

    // 根据角色决定对比维度
    let indicators = visibleIndicators.value

    if (role === 'strategic_dept') {
      // 战略处看职能部门排行（排除学院）
      indicators = indicators.filter(i => !isSecondaryCollege(i.responsibleDept))
      return aggregateByDepartment(indicators, 'responsibleDept')
    } else if (role === 'functional_dept') {
      // 职能部门看二级学院排行
      const dept = authStore.user?.department
      indicators = indicators.filter(
        i => isSecondaryCollege(i.responsibleDept) && i.ownerDept === dept
      )
      return aggregateByDepartment(indicators, 'responsibleDept')
    } else {
      // 二级学院不显示对比
      return []
    }
  })

  // 辅助函数：生成桑基图数据
  const generateSankeyData = (indicators: StrategicIndicator[]): SankeyData => {
    const nodes = new Set<string>()
    const linkMap = new Map<string, number>()

    // 统计实际任务流转
    indicators.forEach(indicator => {
      const source = indicator.ownerDept || '战略发展部'
      const target = indicator.responsibleDept

      if (!source || !target || source === target) {
        return
      } // Skip incomplete or self-loop entries

      nodes.add(source)
      nodes.add(target)

      const key = `${source}->${target}`
      linkMap.set(key, (linkMap.get(key) || 0) + 1)
    })

    // 为节点分配明确的层级（depth），确保职能部门和学院分层显示
    const depthMap = new Map<string, number>()
    nodes.forEach(name => {
      if (name === '战略发展部') {
        depthMap.set(name, 0)
      } else if (isSecondaryCollege(name)) {
        depthMap.set(name, 2)
      } else {
        depthMap.set(name, 1)
      }
    })

    // 过滤链接：只保留从低层级流向高层级的链接（避免循环）
    const links: SankeyLink[] = []
    linkMap.forEach((count, key) => {
      const [source, target] = key.split('->')
      const sourceDepth = depthMap.get(source) ?? 1
      const targetDepth = depthMap.get(target) ?? 1
      if (sourceDepth < targetDepth) {
        links.push({ source, target, value: count })
      }
    })

    // 只保留在链接中出现的节点
    const usedNodes = new Set<string>()
    links.forEach(link => {
      usedNodes.add(link.source)
      usedNodes.add(link.target)
    })

    const nodeList = Array.from(usedNodes).map(name => ({
      name,
      depth: depthMap.get(name) ?? 1
    }))

    return {
      nodes: nodeList,
      links
    }
  }

  // 任务流转数据（用于 TaskSankeyChart）
  const sankeyData = computed<SankeyData>(() => {
    const authStore = useAuthStore()
    const role = authStore.user?.role

    if (role === 'strategic_dept' || role === 'functional_dept') {
      return generateSankeyData(visibleIndicators.value)
    }

    return { nodes: [], links: [] }
  })

  // 任务来源分布（用于 SourcePieChart，仅学院视角）
  const taskSourceDistribution = computed<SourcePieData[]>(() => {
    const authStore = useAuthStore()
    const role = authStore.user?.role

    if (role === 'secondary_college') {
      const dept = authStore.user?.department
      const indicators = visibleIndicators.value.filter(i => i.responsibleDept === dept)

      const sourceMap = new Map<string, number>()
      indicators.forEach(i => {
        const source = i.ownerDept || '其他'
        sourceMap.set(source, (sourceMap.get(source) || 0) + 1)
      })

      const result: SourcePieData[] = []
      sourceMap.forEach((value, name) => {
        result.push({
          name,
          value,
          percentage: indicators.length > 0 ? (value / indicators.length) * 100 : 0
        })
      })

      return result
    }

    return []
  })

  // Actions
  const fetchDashboardData = async () => {
    loading.value = true
    error.value = null

    try {
      logger.info('[Dashboard Store] Fetching dashboard data from API...')
      dashboardData.value = await dashboardApi.getDashboardData()
      logger.info('[Dashboard Store] Dashboard data loaded successfully')
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error occurred'
      logger.error('[Dashboard Store] Failed to fetch dashboard data:', err)
    } finally {
      loading.value = false
    }
  }

  const fetchDepartmentProgress = async () => {
    try {
      logger.info('[Dashboard Store] Fetching department progress from API...')
      departmentProgress.value = await dashboardApi.getDepartmentProgress()
      logger.info('[Dashboard Store] Department progress loaded successfully')
    } catch (err) {
      logger.error('[Dashboard Store] Failed to fetch department progress:', err)
    }
  }

  const fetchRecentActivities = async () => {
    try {
      logger.info('[Dashboard Store] Fetching recent activities from API...')
      recentActivities.value = await dashboardApi.getRecentActivities()
      logger.info('[Dashboard Store] Recent activities loaded successfully')
    } catch (err) {
      logger.error('[Dashboard Store] Failed to fetch recent activities:', err)
    }
  }

  const refreshDashboard = async () => {
    await Promise.all([
      fetchDashboardData(),
      fetchDepartmentProgress(),
      fetchRecentActivities(),
      fetchAlertStats(),
      fetchUnclosedAlerts()
    ])
  }

  const exportReport = async (format: 'excel' | 'pdf') => {
    void format
    throw new Error('当前 OpenAPI 未提供 dashboard 导出接口')
  }

  // 获取告警统计
  const fetchAlertStats = async () => {
    alertsLoading.value = true
    try {
      logger.info('[Dashboard Store] Fetching alert stats...')
      const stats = await alertApi.getStats()
      alertStatsData.value = stats
      logger.info('[Dashboard Store] Alert stats loaded:', stats)
    } catch (err) {
      logger.error('[Dashboard Store] Failed to fetch alert stats:', err)
      // 失败时不影响主流程，使用默认值
      alertStatsData.value = {
        totalOpen: 0,
        countBySeverity: {
          CRITICAL: 0,
          WARNING: 0,
          INFO: 0
        }
      }
    } finally {
      alertsLoading.value = false
    }
  }

  // 获取未关闭的告警事件
  const fetchUnclosedAlerts = async () => {
    try {
      logger.info('[Dashboard Store] Fetching unclosed alerts...')
      const alerts = await alertApi.getUnclosedAlerts()
      unclosedAlerts.value = alerts
      logger.info('[Dashboard Store] Unclosed alerts loaded:', alerts.length)
    } catch (err) {
      logger.error('[Dashboard Store] Failed to fetch unclosed alerts:', err)
      unclosedAlerts.value = []
    }
  }

  // 下钻操作
  const drillDown = (level: DrillDownLevel, value: string, label: string) => {
    currentLevel.value = level

    if (level === 'department') {
      selectedDepartment.value = value
      selectedIndicator.value = undefined
      breadcrumbs.value = [
        { level: 'organization', label: '组织总览' },
        { level: 'department', label, value }
      ]
    } else if (level === 'indicator') {
      selectedIndicator.value = value
      breadcrumbs.value = [
        { level: 'organization', label: '组织总览' },
        ...(selectedDepartment.value
          ? [
              {
                level: 'department' as DrillDownLevel,
                label: selectedDepartment.value,
                value: selectedDepartment.value
              }
            ]
          : []),
        { level: 'indicator', label, value }
      ]
    }
  }

  // 面包屑导航
  const navigateToBreadcrumb = (index: number) => {
    const target = breadcrumbs.value[index]
    if (!target) {
      return
    }

    currentLevel.value = target.level
    breadcrumbs.value = breadcrumbs.value.slice(0, index + 1)

    if (target.level === 'organization') {
      selectedDepartment.value = undefined
      selectedIndicator.value = undefined
    } else if (target.level === 'department') {
      selectedDepartment.value = target.value
      selectedIndicator.value = undefined
    }
  }

  // 应用筛选
  const applyFilter = (filter: Partial<FilterState>) => {
    filters.value = { ...filters.value, ...filter }
  }

  // 重置筛选和下钻状态
  const resetFilters = () => {
    filters.value = {}
    currentLevel.value = 'organization'
    selectedDepartment.value = undefined
    selectedIndicator.value = undefined
    breadcrumbs.value = [{ level: 'organization', label: '组织总览' }]
    // 重置三级联动状态
    currentOrgLevel.value = 'strategy'
    selectedFunctionalDept.value = undefined
    selectedCollege.value = undefined
  }

  // 三级联动 Actions

  // 联动下钻（带自动面包屑更新）
  const drillDownToDepartment = (deptName: string, deptType: 'functional' | 'college') => {
    if (deptType === 'functional') {
      selectedFunctionalDept.value = deptName
      currentOrgLevel.value = 'functional'
      currentLevel.value = 'department'
      breadcrumbs.value = [
        { level: 'organization', label: '组织总览' },
        { level: 'department', label: deptName, value: deptName }
      ]
    } else if (deptType === 'college') {
      selectedCollege.value = deptName
      currentOrgLevel.value = 'college'
      currentLevel.value = 'indicator'
      breadcrumbs.value = [
        { level: 'organization', label: '组织总览' },
        ...(selectedFunctionalDept.value
          ? [
              {
                level: 'department' as DrillDownLevel,
                label: selectedFunctionalDept.value,
                value: selectedFunctionalDept.value
              }
            ]
          : []),
        { level: 'indicator', label: deptName, value: deptName }
      ]
    }
  }

  // 图表点击联动
  const handleChartDrillDown = (chartType: string, data: Record<string, unknown>) => {
    switch (chartType) {
      case 'comparison':
        // 对比图点击
        if (data.dept) {
          const isCollege = isSecondaryCollege(data.dept)
          drillDownToDepartment(data.dept, isCollege ? 'college' : 'functional')
        }
        break
      case 'sankey':
        // 桑基图点击
        if (data.target) {
          const isCollege = isSecondaryCollege(data.target)
          drillDownToDepartment(data.target, isCollege ? 'college' : 'functional')
        }
        break
      case 'sourcePie':
        // 饼图点击可以高亮相关指标
        if (data.name) {
          applyFilter({ sourceOwner: data.name })
        }
        break
    }
  }

  // 增强面包屑导航（支持三级联动重置）
  const navigateToBreadcrumbEnhanced = (index: number) => {
    const target = breadcrumbs.value[index]
    if (!target) {
      return
    }

    currentLevel.value = target.level
    breadcrumbs.value = breadcrumbs.value.slice(0, index + 1)

    // 重置下钻状态
    if (target.level === 'organization') {
      selectedDepartment.value = undefined
      selectedIndicator.value = undefined
      selectedFunctionalDept.value = undefined
      selectedCollege.value = undefined
      currentOrgLevel.value = 'strategy'
      filters.value = {} // 清空筛选
    } else if (target.level === 'department') {
      selectedDepartment.value = target.value
      selectedFunctionalDept.value = target.value
      selectedIndicator.value = undefined
      selectedCollege.value = undefined
      currentOrgLevel.value = 'functional'
    } else if (target.level === 'indicator') {
      selectedIndicator.value = target.value
      selectedCollege.value = target.value
      currentOrgLevel.value = 'college'
    }
  }

  return {
    // State
    dashboardData,
    departmentProgress,
    recentActivities,
    loading,
    error,
    alertStatsData,
    unclosedAlerts,
    alertsLoading,
    currentLevel,
    breadcrumbs,
    filters,
    selectedDepartment,
    selectedIndicator,
    // 三级联动状态
    currentOrgLevel,
    selectedFunctionalDept,
    selectedCollege,

    // Getters
    completionRate,
    totalScore,
    warningCount,
    alertStats,
    totalAlerts,
    criticalAlerts,
    majorAlerts,
    minorAlerts,
    filteredIndicators,
    departmentSummary,
    alertDistribution,
    // 三级联动 Getters
    visibleIndicators,
    visibleIndicatorsWithHistory,
    departmentComparison,
    sankeyData,
    taskSourceDistribution,

    // Actions
    fetchDashboardData,
    fetchDepartmentProgress,
    fetchRecentActivities,
    fetchAlertStats,
    fetchUnclosedAlerts,
    refreshDashboard,
    exportReport,
    drillDown,
    navigateToBreadcrumb,
    applyFilter,
    resetFilters,
    // 三级联动 Actions
    drillDownToDepartment,
    handleChartDrillDown,
    navigateToBreadcrumbEnhanced
  }
})
