import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import type { DashboardData, UserRole, Indicator } from '@/shared/types'
import { useStrategicStore } from '@/features/task/model/strategic'
import { dashboardApi } from '@/features/dashboard/api/dashboardApi'
import { useDashboardStore } from '@/features/dashboard/model/store'
import { useAuthStore } from '@/features/auth/model/store'
import { useMessageStore } from '@/features/messages/model/message'
import { useTimeContextStore } from '@/shared/lib/timeContext'
import { ElMessage } from 'element-plus'
import { isSecondaryCollege } from '@/shared/lib/utils/colors'
import { useOrgStore } from '@/features/organization/model/store'
// 加载状态管理 - Requirements 1.5, 1.6
import { useLoadingState } from '@/shared/lib/loading/useLoadingState'
import { logger } from '@/shared/lib/utils/logger'
import { buildDashboardSummary, getIndicatorStatusAtMonth } from '@/features/dashboard/lib'
import { resolveIndicatorYear } from '@/shared/lib/utils/indicatorYear'
import {
  GLOBAL_DATA_REFRESH_REQUEST_EVENT,
  type GlobalDataRefreshDetail
} from '@/5-shared/lib/dataFreshness'

export interface DashboardViewProps {
  viewingRole?: UserRole
  viewingDept?: string
}

export function useDashboardView(props: DashboardViewProps) {
  // 动态导入 echarts，避免初始加载时打包
  let echarts: typeof import('echarts') | null = null
  const loadEcharts = async () => {
    if (!echarts) {
      echarts = await import('echarts')
    }
    return echarts
  }

  // 动态导入 Excel 导出库，只在导出时加载
  let excelWriter: typeof import('write-excel-file/browser') | null = null
  const loadExcelWriter = async () => {
    if (!excelWriter) {
      excelWriter = await import('write-excel-file/browser')
    }
    return excelWriter
  }

  // 帮助提示内容
  const helpTexts = {
    totalScore:
      '总得分 = 基础性指标得分 + 发展性指标得分，满分120分。基础性指标满分100分，发展性指标满分20分。',
    basicScore: '基础性指标是必须完成的核心指标，根据各指标完成进度加权计算得分，满分100分。',
    developmentScore: '发展性指标是鼓励性指标，完成后可获得额外加分，满分20分。',
    warningCount:
      '预警任务按所选月份的里程碑状态计算：延期视为严重预警，未逾期但未达标视为中度预警。',
    scoreComposition: '展示基础性指标和发展性指标的得分占比，帮助了解整体得分构成。',
    alertDistribution:
      '按所选月份统计指标状态：严重预警表示该月底前应完成的里程碑未达标，中度预警表示当月目标未达标但尚未逾期。',
    completionRate: '完成率 = 所选月份状态为正常或超前完成的指标数 / 总指标数 × 100%。',
    departmentProgress:
      '展示各部门的指标完成进度，进度条颜色表示状态：绿色（≥80%）、黄色（50%-80%）、红色（<50%）。',
    benchmark: '展示各部门执行进度与基准线对比，红色表示低于基准线，蓝色表示达标。',
    radar: '多维度分析各项核心指标的完成情况，帮助识别短板领域。',
    delayedTasks: '展示当前进度滞后、且需优先处理的任务清单，支持一键发送催办提醒。',
    aiBriefing: '基于大模型分析，实时提炼全校及部门战略执行的核心动态与风险提示。'
  }

  // 雷达图实例
  let radarChartInstance: echarts.ECharts | null = null
  let benchmarkChartInstance: echarts.ECharts | null = null
  const radarChartRef = ref<HTMLElement | null>(null)
  const benchmarkChartRef = ref<HTMLElement | null>(null)
  const benchmarkSectionRef = ref<HTMLElement | null>(null)

  // 学院看板图表实例
  let collegeChartInstance: echarts.ECharts | null = null
  const collegeChartRef = ref<HTMLElement | null>(null)

  // 分院排名图表实例
  let collegeRankingChartInstance: echarts.ECharts | null = null
  const collegeRankingChartRef = ref<HTMLElement | null>(null)
  let globalDataRefreshPromise: Promise<void> | null = null

  // 选中的部门（用于右侧指标完成情况卡片）
  const selectedBenchmarkDept = ref<string | null>(null)
  // 用于控制卡片内容显示（延迟隐藏，确保退出动画播放）
  const showIndicatorCard = ref(false)
  // 指标状态筛选
  const selectedStatusFilter = ref<IndicatorStatus | null>(null)

  // 指标状态类型
  type IndicatorStatus = 'normal' | 'ahead' | 'warning' | 'delayed'

  // 月份筛选和下钻状态（用于堆叠柱状图）
  const selectedMonth = ref(new Date().getMonth() + 1) // 默认当前月
  const isDrillDown = ref(false) // 是否处于下钻状态
  const drilledDept = ref('') // 下钻选中的部门

  // 下钻后的月份指标卡片状态
  const selectedMonthInDrillDown = ref<number | null>(null) // 下钻后选中的月份
  const showMonthIndicatorCard = ref(false) // 控制月份指标卡片显示

  // ============ 学院看板状态（职能部门视角）============
  const collegeSelectedMonth = ref(new Date().getMonth() + 1) // 学院看板选中月份
  const isCollegeDrillDown = ref(false) // 学院看板下钻状态
  const drilledCollege = ref('') // 下钻选中的学院
  const selectedMonthInCollegeDrillDown = ref<number | null>(null) // 学院下钻后选中的月份
  const showCollegeMonthIndicatorCard = ref(false) // 学院月份指标卡片显示

  // ============ 分院排名看板状态 ============
  const collegeRankingMonth = ref(new Date().getMonth() + 1) // 分院排名选中月份
  const selectedOwnerDeptFilter = ref<string>('all') // 职能部门筛选（战略发展部用）

  // 状态颜色配置
  const statusColors = {
    ahead: '#67C23A', // 绿色 - 超前完成
    normal: '#409EFF', // 蓝色 - 正常
    warning: '#E6A23C', // 黄色 - 预警
    delayed: '#F56C6C' // 红色 - 延期
  }

  // 计算指标状态的函数
  const getIndicatorStatus = (indicator: Indicator): IndicatorStatus => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const milestones = indicator.milestones || []
    if (milestones.length === 0) {
      return 'normal'
    }

    const currentProgress = indicator.progress || 0

    // 按 dueDate 排序里程碑
    const sortedMilestones = [...milestones].sort(
      (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    )

    // 检查是否有已过期但未达标的里程碑（延期）
    for (const milestone of sortedMilestones) {
      const deadlineDate = new Date(milestone.dueDate)
      deadlineDate.setHours(23, 59, 59, 999)

      if (deadlineDate < today && currentProgress < milestone.targetProgress) {
        return 'delayed'
      }
    }

    // 找到离今天最近的未来里程碑（dueDate > 今天）
    const nextMilestone = sortedMilestones.find(m => {
      const deadlineDate = new Date(m.dueDate)
      deadlineDate.setHours(23, 59, 59, 999)
      return deadlineDate >= today
    })

    if (!nextMilestone) {
      // 没有未来的里程碑，检查最后一个里程碑是否完成
      const lastMilestone = sortedMilestones[sortedMilestones.length - 1]
      if (lastMilestone && currentProgress >= lastMilestone.targetProgress) {
        return 'ahead' // 全部完成
      }
      return 'normal'
    }

    // 检查是否超前完成
    if (currentProgress >= nextMilestone.targetProgress) {
      return 'ahead'
    }

    // 检查是否预警（距离 dueDate ≤ 3 天且未达标）
    const nextDeadline = new Date(nextMilestone.dueDate)
    nextDeadline.setHours(23, 59, 59, 999)
    const daysUntilDeadline = Math.ceil(
      (nextDeadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    )

    if (daysUntilDeadline <= 3 && currentProgress < nextMilestone.targetProgress) {
      return 'warning'
    }

    return 'normal'
  }

  // 获取状态显示文本
  const getStatusText = (status: IndicatorStatus): string => {
    const statusMap: Record<IndicatorStatus, string> = {
      normal: '正常',
      ahead: '超前完成',
      warning: '预警',
      delayed: '延期'
    }
    return statusMap[status]
  }

  // 获取状态对应的颜色类
  const getStatusClass = (status: IndicatorStatus): string => {
    const classMap: Record<IndicatorStatus, string> = {
      normal: 'status-normal',
      ahead: 'status-ahead',
      warning: 'status-warning',
      delayed: 'status-delayed'
    }
    return classMap[status]
  }

  // 获取当月目标进度（离今天最近的里程碑的目标进度）
  const getCurrentTargetProgress = (indicator: Indicator): number | null => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const milestones = indicator.milestones || []
    if (milestones.length === 0) {
      return null
    }

    // 按 dueDate 排序里程碑
    const sortedMilestones = [...milestones].sort(
      (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    )

    // 找到离今天最近的里程碑（dueDate >= 今天）
    const nextMilestone = sortedMilestones.find(m => {
      const deadlineDate = new Date(m.dueDate)
      deadlineDate.setHours(23, 59, 59, 999)
      return deadlineDate >= today
    })

    if (nextMilestone) {
      return nextMilestone.targetProgress
    }

    // 如果没有未来的里程碑，返回最后一个里程碑的目标
    const lastMilestone = sortedMilestones[sortedMilestones.length - 1]
    return lastMilestone ? lastMilestone.targetProgress : null
  }

  // 获取当前里程碑序号信息（如 "2/5" 表示第2个里程碑，共5个）
  const getCurrentMilestoneIndex = (indicator: Indicator): string | null => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const milestones = indicator.milestones || []
    if (milestones.length === 0) {
      return null
    }

    const total = milestones.length

    // 按 dueDate 排序里程碑
    const sortedMilestones = [...milestones].sort(
      (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    )

    // 找到离今天最近的里程碑（dueDate >= 今天）
    const nextMilestoneIndex = sortedMilestones.findIndex(m => {
      const deadlineDate = new Date(m.dueDate)
      deadlineDate.setHours(23, 59, 59, 999)
      return deadlineDate >= today
    })

    if (nextMilestoneIndex !== -1) {
      return `${nextMilestoneIndex + 1}/${total}`
    }

    // 如果没有未来的里程碑，返回最后一个
    return `${total}/${total}`
  }

  // 选中部门的指标列表
  const selectedDeptIndicators = computed(() => {
    if (!selectedBenchmarkDept.value) {
      return []
    }

    const strategicStore = useStrategicStore()
    const timeContext = useTimeContextStore()
    const currentYear = timeContext.currentYear
    const realYear = timeContext.realCurrentYear

    // 筛选该部门接收的指标（responsibleDept === 选中的部门）
    return strategicStore.indicators
      .filter(i => {
        const indicatorYear = resolveIndicatorYear(i, realYear)
        return indicatorYear === currentYear && i.responsibleDept === selectedBenchmarkDept.value
      })
      .map(i => ({
        ...i,
        status: getIndicatorStatus(i),
        targetProgress: getCurrentTargetProgress(i),
        milestoneIndex: getCurrentMilestoneIndex(i)
      }))
  })

  // 筛选后的指标列表（根据状态筛选）
  const filteredDeptIndicators = computed(() => {
    if (!selectedStatusFilter.value) {
      return selectedDeptIndicators.value
    }
    return selectedDeptIndicators.value.filter(i => i.status === selectedStatusFilter.value)
  })

  // 点击状态筛选
  const handleStatusFilterClick = (status: IndicatorStatus) => {
    if (selectedStatusFilter.value === status) {
      // 再次点击同一状态，取消筛选
      selectedStatusFilter.value = null
    } else {
      selectedStatusFilter.value = status
    }
  }

  // 选中部门的指标状态统计
  const selectedDeptStats = computed(() => {
    const indicators = selectedDeptIndicators.value
    return {
      ahead: indicators.filter(i => i.status === 'ahead').length,
      warning: indicators.filter(i => i.status === 'warning').length,
      delayed: indicators.filter(i => i.status === 'delayed').length,
      normal: indicators.filter(i => i.status === 'normal').length
    }
  })

  // 获取任意部门的指标状态统计（用于tooltip显示）
  const _getDeptStats = (deptName: string) => {
    const strategicStore = useStrategicStore()
    const timeContext = useTimeContextStore()
    const currentYear = timeContext.currentYear
    const realYear = timeContext.realCurrentYear

    const indicators = strategicStore.indicators
      .filter(i => {
        const indicatorYear = resolveIndicatorYear(i, realYear)
        return indicatorYear === currentYear && i.responsibleDept === deptName
      })
      .map(i => ({
        ...i,
        status: getIndicatorStatus(i)
      }))

    return {
      ahead: indicators.filter(i => i.status === 'ahead').length,
      warning: indicators.filter(i => i.status === 'warning').length,
      delayed: indicators.filter(i => i.status === 'delayed').length,
      normal: indicators.filter(i => i.status === 'normal').length,
      total: indicators.length
    }
  }

  // 获取部门在指定月份的指标状态统计
  const getDeptStatsAtMonth = (deptName: string, month: number, year: number) => {
    const strategicStore = useStrategicStore()
    const timeContext = useTimeContextStore()
    const currentYear = timeContext.currentYear
    const realYear = timeContext.realCurrentYear

    const indicators = strategicStore.indicators
      .filter(i => {
        const indicatorYear = resolveIndicatorYear(i, realYear)
        return indicatorYear === currentYear && i.responsibleDept === deptName
      })
      .map(i => ({
        ...i,
        status: getIndicatorStatusAtMonth(i, month, year)
      }))

    return {
      ahead: indicators.filter(i => i.status === 'ahead').length,
      warning: indicators.filter(i => i.status === 'warning').length,
      delayed: indicators.filter(i => i.status === 'delayed').length,
      normal: indicators.filter(i => i.status === 'normal').length,
      total: indicators.length
    }
  }

  // 计算堆叠柱状图数据（部门视图 - 第一层）
  const stackedBarData = computed(() => {
    if (isDrillDown.value) {
      return []
    }

    const functionalDepts = orgStore.functionalDepartments.map(item => item.name).filter(Boolean)
    if (functionalDepts.length === 0) {
      return []
    }

    return functionalDepts.map(dept => {
      const stats = getDeptStatsAtMonth(dept, selectedMonth.value, timeContext.currentYear)
      return {
        name: dept.length > 8 ? dept.slice(0, 8) + '...' : dept,
        fullName: dept,
        ...stats
      }
    })
  })

  // 计算下钻后的月度堆叠数据（部门月度视图 - 第二层）
  const monthlyStackedData = computed(() => {
    if (!isDrillDown.value || !drilledDept.value) {
      return []
    }

    // 显示1月到选中的月份
    const months = []
    for (let m = 1; m <= selectedMonth.value; m++) {
      months.push(m)
    }

    return months.map(month => {
      const stats = getDeptStatsAtMonth(drilledDept.value, month, timeContext.currentYear)
      return {
        name: `${month}月`,
        month,
        ...stats
      }
    })
  })

  // 下钻后选中月份的指标列表
  const monthIndicators = computed(() => {
    if (!isDrillDown.value || !drilledDept.value || selectedMonthInDrillDown.value === null) {
      return []
    }

    const strategicStore = useStrategicStore()
    const timeContext = useTimeContextStore()
    const currentYear = timeContext.currentYear
    const realYear = timeContext.realCurrentYear
    const month = selectedMonthInDrillDown.value

    return strategicStore.indicators
      .filter(i => {
        const indicatorYear = resolveIndicatorYear(i, realYear)
        return indicatorYear === currentYear && i.responsibleDept === drilledDept.value
      })
      .map(i => ({
        ...i,
        status: getIndicatorStatusAtMonth(i, month, currentYear),
        targetProgress: getCurrentTargetProgress(i),
        milestoneIndex: getCurrentMilestoneIndex(i)
      }))
  })

  // 月份指标筛选后的列表
  const filteredMonthIndicators = computed(() => {
    if (!selectedStatusFilter.value) {
      return monthIndicators.value
    }
    return monthIndicators.value.filter(i => i.status === selectedStatusFilter.value)
  })

  // 月份指标状态统计
  const monthIndicatorStats = computed(() => {
    const indicators = monthIndicators.value
    return {
      ahead: indicators.filter(i => i.status === 'ahead').length,
      warning: indicators.filter(i => i.status === 'warning').length,
      delayed: indicators.filter(i => i.status === 'delayed').length,
      normal: indicators.filter(i => i.status === 'normal').length,
      total: indicators.length
    }
  })

  // 处理月份指标卡片关闭
  const handleCloseMonthIndicatorCard = () => {
    showMonthIndicatorCard.value = false
    setTimeout(() => {
      selectedMonthInDrillDown.value = null
      selectedStatusFilter.value = null
    }, 400)
  }

  // ============ 学院看板数据计算（职能部门视角）============

  // 获取某职能部门下发给各学院的指标统计
  const getCollegeStatsForFunctionalDept = (ownerDept: string, month: number, year: number) => {
    const strategicStore = useStrategicStore()
    const timeContext = useTimeContextStore()
    const currentYear = timeContext.currentYear
    const realYear = timeContext.realCurrentYear

    // 筛选：ownerDept === 职能部门 && responsibleDept 是二级学院
    const indicators = strategicStore.indicators
      .filter(i => {
        const indicatorYear = resolveIndicatorYear(i, realYear)
        return (
          indicatorYear === currentYear &&
          i.ownerDept === ownerDept &&
          isSecondaryCollege(i.responsibleDept)
        )
      })
      .map(i => ({
        ...i,
        status: getIndicatorStatusAtMonth(i, month, year)
      }))

    // 按学院分组统计
    const collegeMap = new Map<string, any>()
    indicators.forEach(i => {
      const college = i.responsibleDept
      if (!collegeMap.has(college)) {
        collegeMap.set(college, {
          ahead: 0,
          normal: 0,
          warning: 0,
          delayed: 0,
          total: 0
        })
      }
      const stats = collegeMap.get(college)
      if (!stats) {
        return
      }
      stats[i.status]++
      stats.total++
    })

    return Array.from(collegeMap.entries()).map(([college, stats]) => ({
      name: college.length > 8 ? college.slice(0, 8) + '...' : college,
      fullName: college,
      ...stats
    }))
  }

  // 学院看板堆叠数据（第一层：学院视图）
  const collegeBarData = computed(() => {
    if (isCollegeDrillDown.value) {
      return []
    }
    if (currentRole.value === 'secondary_college') {
      return []
    }

    const strategicStore = useStrategicStore()
    const timeContext = useTimeContextStore()
    const currentYear = timeContext.currentYear

    const ownerDept = currentDepartment.value

    // 战略发展部视角：显示所有职能部门下发给学院的指标汇总
    if (currentRole.value === 'strategic_dept') {
      const realYear = timeContext.realCurrentYear

      // 筛选：responsibleDept 是二级学院
      const indicators = strategicStore.indicators
        .filter(i => {
          const indicatorYear = resolveIndicatorYear(i, realYear)
          return indicatorYear === currentYear && isSecondaryCollege(i.responsibleDept)
        })
        .map(i => ({
          ...i,
          status: getIndicatorStatusAtMonth(i, collegeSelectedMonth.value, currentYear)
        }))

      // 按学院分组统计（所有来源部门）
      const collegeMap = new Map<string, any>()
      indicators.forEach(i => {
        const college = i.responsibleDept
        if (!collegeMap.has(college)) {
          collegeMap.set(college, {
            ahead: 0,
            normal: 0,
            warning: 0,
            delayed: 0,
            total: 0
          })
        }
        const stats = collegeMap.get(college)
        if (!stats) {
          return
        }
        stats[i.status]++
        stats.total++
      })

      return Array.from(collegeMap.entries()).map(([college, stats]) => ({
        name: college.length > 8 ? college.slice(0, 8) + '...' : college,
        fullName: college,
        ...stats
      }))
    }

    // 职能部门视角：只看自己下发的
    if (!ownerDept) {
      logger.warn('[collegeBarData] 职能部门视角但 currentDepartment 为空,返回空数组')
      return []
    }

    return getCollegeStatsForFunctionalDept(ownerDept, collegeSelectedMonth.value, currentYear)
  })

  // 学院看板月度趋势数据（第二层：学院月度视图）
  const collegeMonthlyStackedData = computed(() => {
    if (!isCollegeDrillDown.value || !drilledCollege.value) {
      return []
    }

    const months = []
    for (let m = 1; m <= collegeSelectedMonth.value; m++) {
      months.push(m)
    }

    return months.map(month => {
      const strategicStore = useStrategicStore()
      const timeContext = useTimeContextStore()
      const currentYear = timeContext.currentYear
      const realYear = timeContext.realCurrentYear

      let indicators = strategicStore.indicators
        .filter(i => {
          const indicatorYear = resolveIndicatorYear(i, realYear)
          return indicatorYear === currentYear && i.responsibleDept === drilledCollege.value
        })
        .map(i => ({
          ...i,
          status: getIndicatorStatusAtMonth(i, month, currentYear)
        }))

      // 职能部门视角：只看自己下发的
      if (currentRole.value === 'functional_dept') {
        const ownerDept = currentDepartment.value
        indicators = indicators.filter(i => i.ownerDept === ownerDept)
      }

      return {
        name: `${month}月`,
        month,
        ahead: indicators.filter(i => i.status === 'ahead').length,
        normal: indicators.filter(i => i.status === 'normal').length,
        warning: indicators.filter(i => i.status === 'warning').length,
        delayed: indicators.filter(i => i.status === 'delayed').length,
        total: indicators.length
      }
    })
  })

  // 学院下钻后的月份指标列表
  const collegeMonthIndicators = computed(() => {
    if (
      !isCollegeDrillDown.value ||
      !drilledCollege.value ||
      selectedMonthInCollegeDrillDown.value === null
    ) {
      return []
    }

    const strategicStore = useStrategicStore()
    const timeContext = useTimeContextStore()
    const currentYear = timeContext.currentYear
    const realYear = timeContext.realCurrentYear
    const month = selectedMonthInCollegeDrillDown.value

    let indicators = strategicStore.indicators
      .filter(i => {
        const indicatorYear = resolveIndicatorYear(i, realYear)
        return indicatorYear === currentYear && i.responsibleDept === drilledCollege.value
      })
      .map(i => ({
        ...i,
        status: getIndicatorStatusAtMonth(i, month, currentYear),
        targetProgress: getCurrentTargetProgress(i),
        milestoneIndex: getCurrentMilestoneIndex(i)
      }))

    // 职能部门视角：只看自己下发的
    if (currentRole.value === 'functional_dept') {
      const ownerDept = currentDepartment.value
      indicators = indicators.filter(i => i.ownerDept === ownerDept)
    }

    return indicators
  })

  // 学院月份指标筛选后的列表
  const filteredCollegeMonthIndicators = computed(() => {
    if (!selectedStatusFilter.value) {
      return collegeMonthIndicators.value
    }
    return collegeMonthIndicators.value.filter(i => i.status === selectedStatusFilter.value)
  })

  // 学院月份指标状态统计
  const collegeMonthIndicatorStats = computed(() => {
    const indicators = collegeMonthIndicators.value
    return {
      ahead: indicators.filter(i => i.status === 'ahead').length,
      warning: indicators.filter(i => i.status === 'warning').length,
      delayed: indicators.filter(i => i.status === 'delayed').length,
      normal: indicators.filter(i => i.status === 'normal').length,
      total: indicators.length
    }
  })

  // 处理学院月份指标卡片关闭
  const handleCloseCollegeMonthIndicatorCard = () => {
    showCollegeMonthIndicatorCard.value = false
    setTimeout(() => {
      selectedMonthInCollegeDrillDown.value = null
      selectedStatusFilter.value = null
    }, 400)
  }

  // ============ 分院排名看板数据计算 ============

  // 计算二级学院的分数（权重 × 进度）
  const getCollegeRankingData = computed(() => {
    if (currentRole.value === 'secondary_college') {
      return []
    }

    const strategicStore = useStrategicStore()
    const timeContext = useTimeContextStore()
    const currentYear = timeContext.currentYear
    const realYear = timeContext.realCurrentYear
    const month = collegeRankingMonth.value

    // 筛选指标：responsibleDept 是二级学院
    let indicators = strategicStore.indicators
      .filter(i => {
        const indicatorYear = resolveIndicatorYear(i, realYear)
        return indicatorYear === currentYear && isSecondaryCollege(i.responsibleDept)
      })
      .map(i => ({
        ...i,
        status: getIndicatorStatusAtMonth(i, month, currentYear)
      }))

    // 根据角色应用部门筛选
    if (currentRole.value === 'functional_dept') {
      // 职能部门：只看自己下发的
      const ownerDept = currentDepartment.value
      indicators = indicators.filter(i => i.ownerDept === ownerDept)
    } else if (currentRole.value === 'strategic_dept' && selectedOwnerDeptFilter.value !== 'all') {
      // 战略发展部：按选定的职能部门筛选
      indicators = indicators.filter(i => i.ownerDept === selectedOwnerDeptFilter.value)
    }

    // 按学院分组计算分数
    const collegeMap = new Map<
      string,
      {
        score: number
        totalIndicators: number
        completedIndicators: number
        ahead: number
        normal: number
        warning: number
        delayed: number
      }
    >()

    indicators.forEach(i => {
      const college = i.responsibleDept
      if (!collegeMap.has(college)) {
        collegeMap.set(college, {
          score: 0,
          totalIndicators: 0,
          completedIndicators: 0,
          ahead: 0,
          normal: 0,
          warning: 0,
          delayed: 0
        })
      }
      const stats = collegeMap.get(college)
      if (!stats) {
        return
      }
      // 分数 = 权重 × 进度
      const weight = parseFloat(i.weight) || 1
      const progress = i.progress || 0
      stats.score += (weight * progress) / 100
      stats.totalIndicators++
      if (progress >= 100) {
        stats.completedIndicators++
      }
      stats[i.status]++
    })

    // 转换为数组并排序
    return Array.from(collegeMap.entries())
      .map(([college, stats]) => ({
        name: college.length > 8 ? college.slice(0, 8) + '...' : college,
        fullName: college,
        value: Math.round(stats.score * 10) / 10, // 保留一位小数
        total: stats.totalIndicators,
        completed: stats.completedIndicators,
        ahead: stats.ahead,
        normal: stats.normal,
        warning: stats.warning,
        delayed: stats.delayed
      }))
      .sort((a, b) => b.value - a.value)
  })

  // 获取可用的职能部门列表（用于分院排名筛选）
  const availableFunctionalDepts = computed(() => {
    const strategicStore = useStrategicStore()
    const depts = new Set<string>()

    strategicStore.indicators.forEach(i => {
      if (i.ownerDept && isSecondaryCollege(i.responsibleDept)) {
        depts.add(i.ownerDept)
      }
    })

    return Array.from(depts).sort()
  })

  // 处理排名图表点击事件
  const _handleBenchmarkClick = (deptName: string) => {
    if (selectedBenchmarkDept.value === deptName) {
      // 再次点击同一部门，取消选中
      handleCloseIndicatorCard()
    } else {
      selectedBenchmarkDept.value = deptName
      // 重置状态筛选
      selectedStatusFilter.value = null
      // 立即显示卡片内容
      showIndicatorCard.value = true
    }
  }

  // 关闭指标卡片（带退出动画）
  const handleCloseIndicatorCard = () => {
    // 先触发退出动画
    showIndicatorCard.value = false
    // 延迟清空数据，等动画完成
    setTimeout(() => {
      selectedBenchmarkDept.value = null
      selectedStatusFilter.value = null
    }, 400)
  }

  // 接收父组件传递的视角角色和部门

  const strategicStore = useStrategicStore()
  const dashboardStore = useDashboardStore()
  const authStore = useAuthStore()
  const timeContext = useTimeContextStore()
  const orgStore = useOrgStore()
  const messageStore = useMessageStore()

  // ============================================================================
  // 加载状态管理 - Requirements 1.5, 1.6
  // ============================================================================

  /**
   * 使用 useLoadingState 组合式函数管理数据加载状态
   * - 显示骨架屏：数据加载中时显示骨架屏
   * - 空状态处理：数据为空时显示空状态提示
   */
  const {
    isLoading: _pageLoading,
    hasError: pageHasError,
    errorMessage: pageErrorMessage,
    showSkeleton,
    startLoading,
    endLoading,
    setError,
    clearError
  } = useLoadingState({
    timeout: 30000,
    retryCount: 3,
    showSkeleton: true
  })

  // 从 strategicStore 获取加载状态
  const isDataLoading = computed(() => {
    return (
      strategicStore.loadingState.indicators ||
      strategicStore.loadingState.tasks ||
      dashboardStore.loading
    )
  })

  // 判断数据是否为空
  const isDataEmpty = computed(() => {
    return !isDataLoading.value && dashboardStore.visibleIndicators.length === 0
  })

  // 监听 store 加载状态，同步到本地加载状态
  watch(
    isDataLoading,
    loading => {
      if (loading) {
        startLoading()
      } else {
        endLoading()
      }
    },
    { immediate: true }
  )

  // 监听 store 错误状态
  watch(
    () => strategicStore.loadingState.error,
    error => {
      if (error) {
        setError(error)
      } else {
        clearError()
      }
    },
    { immediate: true }
  )

  // 重新加载数据函数
  const reloadData = async () => {
    try {
      startLoading()
      clearError()
      await strategicStore.loadIndicatorsByYear(timeContext.currentYear)
    } catch (err) {
      setError(err instanceof Error ? err.message : '重新加载失败')
      logger.error('[Dashboard] Failed to reload data:', err)
    } finally {
      endLoading()
    }
  }

  type ReminderStatusItem = {
    indicatorId: number
    canRemind: boolean
    lastRemindedAt?: string | null
    remindCount: number
    cooldownUntil?: string | null
  }

  const reminderStatuses = ref<Record<number, ReminderStatusItem>>({})
  const remindingMap = ref<Record<number, boolean>>({})

  // ============================================================================
  // 降级模式检测 - Requirements 1.4, 10.5
  // ============================================================================

  /**
   * 检测是否处于降级模式
   * 当 API 不可用时，系统会使用降级数据，此时应显示提示
   * @requirement 1.4 - 当 API 不可用时，应显示降级模式提示
   * @requirement 10.5 - 降级模式下应显示明确的提示标识
   */
  const isFallbackMode = computed(() => {
    return false
  })

  // 当前视角角色（优先使用父组件传递的，否则使用有效角色）
  const currentRole = computed<UserRole>(
    () => (props.viewingRole as UserRole) || authStore.effectiveRole || 'strategic_dept'
  )
  const currentDepartment = computed(() => props.viewingDept || authStore.effectiveDepartment || '')

  // 是否显示筛选功能（二级学院不显示）
  const _showFilterFeature = computed(() => currentRole.value !== 'secondary_college')

  // 是否可以查看所有部门（只有战略发展部可以）
  const canViewAllDepartments = computed(() => currentRole.value === 'strategic_dept')

  // 部门完成情况卡片标题（根据下钻状态动态显示）
  const _getDepartmentCardTitle = computed(() => {
    if (dashboardStore.currentOrgLevel === 'functional' && dashboardStore.selectedFunctionalDept) {
      return `${dashboardStore.selectedFunctionalDept} 任务下发情况`
    }
    return canViewAllDepartments.value ? '各部门完成情况' : '下属单位完成情况'
  })

  // 排名看板标题（根据角色动态显示）
  const _getBenchmarkTitle = computed(() => {
    if (currentRole.value === 'strategic_dept') {
      return '职能部门执行排名'
    } else if (currentRole.value === 'functional_dept') {
      return '学院执行排名'
    } else {
      return '学院执行排名'
    }
  })

  // 筛选面板
  const showFilterPanel = ref(false)
  const filterForm = ref({
    department: '',
    indicatorType: '' as '' | '定性' | '定量',
    alertLevel: '' as '' | 'severe' | 'moderate' | 'normal'
  })

  // 部门选项（使用完整配置，根据角色权限过滤）
  const _departmentOptions = computed(() => {
    // 战略发展部可以看所有部门
    if (currentRole.value === 'strategic_dept') {
      return orgStore.getAllDepartmentNames()
    }

    // 职能部门能看自己和所有二级学院
    if (currentRole.value === 'functional_dept') {
      return [currentDepartment.value, ...orgStore.getAllCollegeNames()]
    }

    // 二级学院只能看自己
    return [currentDepartment.value]
  })

  // 从 store 计算仪表盘数据
  const dashboardData = computed<DashboardData>(() => {
    const indicators = dashboardStore.visibleIndicators
    return buildDashboardSummary(indicators, selectedMonth.value, timeContext.currentYear)
  })

  // 应用筛选
  const applyFilters = () => {
    const filter: Record<string, string | undefined> = {}
    if (filterForm.value.department) {
      filter.department = filterForm.value.department
    }
    if (filterForm.value.indicatorType) {
      filter.indicatorType = filterForm.value.indicatorType
    }
    if (filterForm.value.alertLevel) {
      filter.alertLevel = filterForm.value.alertLevel
    }
    dashboardStore.applyFilter(filter)
    showFilterPanel.value = false
  }

  // 重置筛选
  const _resetFilters = () => {
    filterForm.value = { department: '', indicatorType: '', alertLevel: '' }
    dashboardStore.resetFilters()
    showFilterPanel.value = false
  }

  // 预警级别点击
  const handleAlertClick = (level: 'severe' | 'moderate' | 'normal') => {
    filterForm.value.alertLevel = level
    applyFilters()
  }

  const handleSummaryDrillClick = () => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'smooth'
    })
  }

  // 面包屑导航
  const handleBreadcrumbNavigate = (index: number) => {
    dashboardStore.navigateToBreadcrumbEnhanced(index)
  }

  // 判断是否有活跃筛选
  const _hasActiveFilters = computed(() => {
    return (
      dashboardStore.filters.department ||
      dashboardStore.filters.indicatorType ||
      dashboardStore.filters.alertLevel
    )
  })

  // 导出功能 - 根据角色差异化导出
  const handleExport = async () => {
    try {
      const role = authStore.user?.role
      let exportData: Record<string, string | number>[]
      let fileName: string
      let sheetName: string

      if (role === 'strategic_dept') {
        // 战略发展部：导出职能部门对比报表
        const comparison = dashboardStore.departmentComparison

        if (comparison.length === 0) {
          ElMessage.warning('没有可导出的数据')
          return
        }

        exportData = comparison.map(item => ({
          排名: item.rank,
          部门: item.dept,
          平均进度: `${item.progress}%`,
          得分: item.score,
          完成率: `${item.completionRate}%`,
          指标总数: item.totalIndicators,
          已完成: item.completedIndicators,
          进行中: item.totalIndicators - item.completedIndicators,
          预警数: item.alertCount,
          状态: item.status === 'success' ? '优秀' : item.status === 'warning' ? '良好' : '需改进'
        }))

        fileName = `职能部门进度对比报表_${new Date().toLocaleDateString()}.xlsx`
        sheetName = '部门对比'
      } else if (role === 'functional_dept') {
        // 职能部门：导出学院任务分配表
        const indicators =
          dashboardStore.filteredIndicators.length > 0
            ? dashboardStore.filteredIndicators
            : strategicStore.indicators

        const collegeIndicators = indicators.filter(i => isSecondaryCollege(i.responsibleDept))

        if (collegeIndicators.length === 0) {
          ElMessage.warning('没有可导出的数据')
          return
        }

        exportData = collegeIndicators.map((item, index) => ({
          序号: index + 1,
          学院: item.responsibleDept,
          核心指标: item.indicator,
          指标类型: item.type,
          权重: item.weight,
          完成进度: `${item.progress}%`,
          里程碑进度: item.milestoneProgress,
          审批状态:
            item.approvalStatus === 'approved'
              ? '已通过'
              : item.approvalStatus === 'pending'
                ? '待审批'
                : item.approvalStatus === 'rejected'
                  ? '已驳回'
                  : '草稿',
          备注: item.description || ''
        }))

        fileName = `学院任务分配表_${authStore.user?.department}_${new Date().toLocaleDateString()}.xlsx`
        sheetName = '学院任务'
      } else {
        // 二级学院：导出承接任务汇总
        const indicators =
          dashboardStore.filteredIndicators.length > 0
            ? dashboardStore.filteredIndicators
            : strategicStore.indicators

        if (indicators.length === 0) {
          ElMessage.warning('没有可导出的数据')
          return
        }

        exportData = indicators.map((item, index) => ({
          序号: index + 1,
          任务来源: item.ownerDept || '战略发展部',
          战略任务: item.task,
          核心指标: item.indicator,
          指标类型: item.type,
          指标类别: item.type2,
          权重: item.weight,
          完成进度: `${item.progress}%`,
          里程碑进度: item.milestoneProgress,
          审批状态:
            item.approvalStatus === 'approved'
              ? '已通过'
              : item.approvalStatus === 'pending'
                ? '待审批'
                : item.approvalStatus === 'rejected'
                  ? '已驳回'
                  : '草稿',
          备注: item.description || ''
        }))

        fileName = `承接任务汇总_${authStore.user?.department}_${new Date().toLocaleDateString()}.xlsx`
        sheetName = '承接任务'
      }

      const { default: writeXlsxFile } = await loadExcelWriter()
      const columns = Object.keys(exportData[0] || {}).map(key => {
        const values = exportData.map(row => row[key])
        return {
          header: key,
          cell: (row: Record<string, string | number>) => row[key],
          width: Math.max(key.length + 2, ...values.map(value => String(value || '').length))
        }
      })

      await writeXlsxFile(exportData, {
        columns,
        sheet: sheetName
      }).toFile(fileName)

      ElMessage.success('导出成功')
    } catch (error) {
      logger.error('导出失败:', error)
      ElMessage.error('导出失败，请重试')
    }
  }

  // 三级联动交互处理函数

  // 桑基图节点点击
  const handleSankeyNodeClick = (nodeName: string) => {
    const authStore = useAuthStore()
    const userRole = authStore.user?.role

    // 职能部门不能点击上级部门（战略发展部）
    if (userRole === 'functional_dept' && nodeName === '战略发展部') {
      return
    }

    // 二级学院不能点击上级部门（战略发展部和职能部门）
    if (userRole === 'secondary_college') {
      const functionalDepts = orgStore.getAllFunctionalDepartmentNames()
      if (nodeName === '战略发展部' || functionalDepts.includes(nodeName)) {
        return
      }
    }

    const isCollege = isSecondaryCollege(nodeName)
    dashboardStore.drillDownToDepartment(nodeName, isCollege ? 'college' : 'functional')
  }

  // 桑基图链接点击
  const handleSankeyLinkClick = (source: string, target: string) => {
    const isCollege = isSecondaryCollege(target)
    dashboardStore.drillDownToDepartment(target, isCollege ? 'college' : 'functional')
  }

  // 任务来源点击筛选
  const handleSourceClick = (source: string) => {
    dashboardStore.applyFilter({ sourceOwner: source })
    ElMessage.info(`已筛选来源：${source}`)
  }

  // 应用筛选（集成新筛选组件）
  const _handleFilterApply = () => {
    ElMessage.success('筛选已应用')
  }

  // KPI 卡片数据（带趋势）
  const _kpiCards = computed(() => {
    const data = dashboardData.value
    const _indicators = dashboardStore.visibleIndicators

    // 计算上期数据（模拟趋势）
    const lastMonthScore = Math.max(0, data.totalScore - Math.floor(Math.random() * 10) + 5)
    const scoreTrend = data.totalScore - lastMonthScore

    return [
      {
        label: '战略执行总分',
        helpText: helpTexts.totalScore,
        value: data.totalScore,
        unit: '分',
        trend: Math.abs(scoreTrend),
        isUp: scoreTrend >= 0,
        predict: Math.min(120, data.totalScore + 8),
        desc: '年度目标: 120分',
        percent: Math.round((data.totalScore / 120) * 100),
        icon: 'Aim',
        gradient: 'primary'
      },
      {
        label: '核心指标完成率',
        helpText: helpTexts.completionRate,
        value: data.completionRate,
        unit: '%',
        trend: 3.2,
        isUp: true,
        predict: Math.min(100, data.completionRate + 12),
        desc: `已完成 ${data.completedIndicators}/${data.totalIndicators} 项`,
        percent: data.completionRate,
        icon: 'DataAnalysis',
        gradient: 'success'
      },
      {
        label: '严重预警任务',
        helpText: helpTexts.warningCount,
        value: data.alertIndicators.severe,
        unit: '项',
        trend: 2,
        isUp: false,
        predict: Math.max(0, data.alertIndicators.severe - 3),
        desc: '需重点关注推进',
        percent: Math.max(
          0,
          100 - (data.alertIndicators.severe / Math.max(1, data.totalIndicators)) * 100
        ),
        icon: 'Warning',
        gradient: 'danger'
      },
      {
        label: '发展性指标得分',
        helpText: helpTexts.developmentScore,
        value: data.developmentScore,
        unit: '分',
        trend: 1.5,
        isUp: true,
        predict: Math.min(20, data.developmentScore + 3),
        desc: '满分20分',
        percent: (data.developmentScore / 20) * 100,
        icon: 'TrendCharts',
        gradient: 'purple'
      }
    ]
  })

  const baseDelayedTasks = computed(() => {
    const indicators = dashboardStore.visibleIndicators
    return indicators
      .filter(i => (i.progress ?? 0) < 50)
      .sort((a, b) => (a.progress ?? 0) - (b.progress ?? 0))
      .slice(0, 5)
      .map(i => ({
        id: i.id,
        name: i.name || i.indicator || '未命名任务',
        dept: i.responsibleDept,
        progress: i.progress ?? 0,
        days: Math.floor((50 - (i.progress ?? 0)) / 5) + 1
      }))
  })

  const loadReminderStatuses = async () => {
    const indicatorIds = baseDelayedTasks.value.map(task => Number(task.id)).filter(Number.isFinite)
    if (indicatorIds.length === 0) {
      reminderStatuses.value = {}
      return
    }

    try {
      const statuses = await dashboardApi.getReminderStatuses(indicatorIds)
      reminderStatuses.value = Object.fromEntries(
        statuses.map((status: ReminderStatusItem) => [status.indicatorId, status])
      )
    } catch (error) {
      logger.warn('[Dashboard] Failed to load reminder statuses:', error)
    }
  }

  watch(
    () => baseDelayedTasks.value.map(task => task.id).join(','),
    () => {
      void loadReminderStatuses()
    },
    { immediate: true }
  )

  // 滞后任务列表
  const delayedTasks = computed(() => {
    return baseDelayedTasks.value.map(task => {
      const status = reminderStatuses.value[task.id]
      const reminded = Boolean(status?.lastRemindedAt) && !(status?.canRemind ?? true)

      return {
        ...task,
        reminded,
        canRemind: status?.canRemind ?? true,
        reminding: Boolean(remindingMap.value[task.id]),
        lastRemindedAt: status?.lastRemindedAt ?? null,
        remindCount: status?.remindCount ?? 0,
        cooldownUntil: status?.cooldownUntil ?? null
      }
    })
  })

  // 催办任务
  const handleUrge = async (task: {
    id: number
    dept: string
    progress: number
    reminded: boolean
    canRemind: boolean
    reminding: boolean
  }) => {
    if (task.reminded || !task.canRemind || task.reminding) {
      return
    }

    remindingMap.value = {
      ...remindingMap.value,
      [task.id]: true
    }

    try {
      await dashboardApi.sendReminder(task.id)
      await Promise.all([loadReminderStatuses(), messageStore.refreshMessageCenter()])
      ElMessage.success(`已向 ${task.dept} 发送催办通知`)
    } catch (error: any) {
      const message =
        error?.response?.data?.message || error?.message || `向 ${task.dept} 发送催办通知失败`
      ElMessage.error(message)
    } finally {
      remindingMap.value = {
        ...remindingMap.value,
        [task.id]: false
      }
    }
  }

  // 雷达图数据（支持历史数据）
  const radarData = computed(() => {
    const indicators = dashboardStore.visibleIndicatorsWithHistory

    // 按类型分组计算平均进度
    const typeGroups: Record<string, number[]> = {}
    indicators.forEach(i => {
      const type = i.type || '其他'
      if (!typeGroups[type]) {
        typeGroups[type] = []
      }
      typeGroups[type].push(i.progress)
    })

    const dimensions = Object.entries(typeGroups)
      .slice(0, 5)
      .map(([name, values]) => ({
        name,
        value: Math.round(values.reduce((a, b) => a + b, 0) / values.length)
      }))

    // 确保至少有5个维度
    const defaultDimensions = ['教学质量', '科研产出', '人才培养', '社会服务', '资源建设']
    while (dimensions.length < 5) {
      dimensions.push({
        name: defaultDimensions[dimensions.length],
        value: 60 + Math.floor(Math.random() * 30)
      })
    }

    return dimensions
  })

  // 部门排名数据 - 使用 departmentSummary 数据
  const benchmarkData = computed(() => {
    const summary = dashboardStore.departmentSummary
    if (!summary || summary.length === 0) {
      return []
    }
    // 按进度排序，显示所有部门
    return [...summary]
      .sort((a, b) => b.progress - a.progress)
      .map(item => ({
        name: item.dept.length > 8 ? item.dept.slice(0, 8) + '...' : item.dept,
        fullName: item.dept,
        value: item.progress,
        total: item.totalIndicators,
        completed: item.completedIndicators
      }))
  })

  // 雷达图统计数据
  const _radarStats = computed(() => {
    const data = radarData.value
    if (!data || data.length === 0) {
      return { avgMatch: 0, volatility: 0 }
    }
    const avg = data.reduce((a, b) => a + b.value, 0) / data.length
    // 计算波动离散度（标准差的简化版）
    const variance = data.reduce((sum, d) => sum + Math.pow(d.value - avg, 2), 0) / data.length
    const volatility = Math.sqrt(variance) / 100
    return {
      avgMatch: avg.toFixed(1),
      volatility: volatility.toFixed(2)
    }
  })

  const isChartContainerReady = (element: HTMLElement | null): element is HTMLElement => {
    return (
      !!element && element.isConnected && document.body.contains(element) && element.clientWidth > 0
    )
  }

  const createChartInstance = async (
    element: HTMLElement | null,
    existing: echarts.ECharts | null
  ): Promise<echarts.ECharts | null> => {
    if (!isChartContainerReady(element)) {
      existing?.dispose()
      return null
    }

    const ec = await loadEcharts()
    existing?.dispose()
    ec.getInstanceByDom(element)?.dispose()
    return ec.init(element)
  }

  // 初始化雷达图
  const initRadarChart = async () => {
    if (!isChartContainerReady(radarChartRef.value)) {
      radarChartInstance?.dispose()
      radarChartInstance = null
      return
    }

    const data = radarData.value
    if (!data || data.length === 0) {
      logger.warn('No radar data available')
      return
    }

    radarChartInstance = await createChartInstance(radarChartRef.value, radarChartInstance)
    if (!radarChartInstance) {
      return
    }

    radarChartInstance.setOption({
      backgroundColor: 'transparent',
      radar: {
        indicator: data.map(d => ({ name: d.name, max: 100 })),
        splitArea: { show: false },
        splitLine: { lineStyle: { color: 'rgba(64, 158, 255, 0.15)', width: 1 } },
        axisLine: { lineStyle: { color: 'rgba(64, 158, 255, 0.2)' } },
        name: { textStyle: { color: '#909399', fontWeight: 700, fontSize: 11 } },
        shape: 'circle',
        radius: '65%'
      },
      series: [
        {
          type: 'radar',
          data: [
            {
              value: data.map(() => 80),
              name: '全校平均',
              lineStyle: { color: '#409eff', width: 1, type: 'dashed' },
              areaStyle: { color: 'rgba(64, 158, 255, 0.05)' },
              symbol: 'none'
            },
            {
              value: data.map(d => d.value),
              name: '当前部门',
              lineStyle: { color: '#f56c6c', width: 2 },
              areaStyle: { color: 'rgba(245, 108, 108, 0.25)' },
              symbol: 'circle',
              symbolSize: 4,
              itemStyle: { color: '#f56c6c' }
            }
          ]
        }
      ],
      tooltip: {
        trigger: 'item'
      }
    })
  }

  // Benchmark 图表视图模式
  const _benchmarkViewMode = ref<'completion' | 'benchmark'>('completion')

  // 动态计算图表高度（每个部门30px，最小400px）
  const _benchmarkChartHeight = computed(() => {
    const dataLength = benchmarkData.value.length
    return Math.max(400, dataLength * 30)
  })

  // 初始化排名对标图 - 改为堆叠柱状图
  const initBenchmarkChart = async () => {
    if (!benchmarkChartRef.value) {
      return
    }

    // 根据下钻状态选择数据源
    const data = isDrillDown.value ? monthlyStackedData.value : stackedBarData.value
    const _xAxisLabel = isDrillDown.value ? `${drilledDept.value} - 月度趋势` : '职能部门'

    if (!data || data.length === 0) {
      // 数据为空时，清空图表
      if (benchmarkChartInstance) {
        benchmarkChartInstance.dispose()
        benchmarkChartInstance = null
      }
      return
    }

    // 控制首屏占用，避免刷新后第一张图过高把后续模块全部挤到下方。
    benchmarkChartRef.value.style.height = `280px`

    benchmarkChartInstance = await createChartInstance(
      benchmarkChartRef.value,
      benchmarkChartInstance
    )
    if (!benchmarkChartInstance) {
      return
    }

    benchmarkChartInstance.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: Array<{ dataIndex: number; name: string }>) => {
          if (!Array.isArray(params) || params.length === 0) {
            return ''
          }
          const dataIndex = params[0].dataIndex
          const dataItem = data[dataIndex]
          const name = dataItem?.fullName || dataItem?.name || params[0].name

          let tooltip = `<strong>${name}</strong><br/>`

          if (isDrillDown.value) {
            // 月度视图显示该月的统计
            tooltip += `${params[0].name}<br/>`
            tooltip += `<span style="color: ${statusColors.ahead}">●</span> 超前: ${dataItem?.ahead || 0}<br/>`
            tooltip += `<span style="color: ${statusColors.normal}">●</span> 正常: ${dataItem?.normal || 0}<br/>`
            tooltip += `<span style="color: ${statusColors.warning}">●</span> 预警: ${dataItem?.warning || 0}<br/>`
            tooltip += `<span style="color: ${statusColors.delayed}">●</span> 延期: ${dataItem?.delayed || 0}<br/>`
            tooltip += `总计: ${dataItem?.total || 0}`
          } else {
            // 部门视图显示统计
            tooltip += `${selectedMonth.value}月完成情况<br/>`
            tooltip += `<span style="color: ${statusColors.ahead}">■</span> 超前: ${dataItem?.ahead || 0}<br/>`
            tooltip += `<span style="color: ${statusColors.normal}">■</span> 正常: ${dataItem?.normal || 0}<br/>`
            tooltip += `<span style="color: ${statusColors.warning}">■</span> 预警: ${dataItem?.warning || 0}<br/>`
            tooltip += `<span style="color: ${statusColors.delayed}">■</span> 延期: ${dataItem?.delayed || 0}<br/>`
            tooltip += `总计: ${dataItem?.total || 0}<br/>`
            tooltip += `<span style="color: #409eff; font-size: 11px;">点击查看月度趋势</span>`
          }
          return tooltip
        }
      },
      legend: {
        data: ['超前完成', '正常', '预警', '延期'],
        bottom: 0,
        left: 'center',
        itemWidth: 12,
        itemHeight: 12,
        textStyle: {
          fontSize: 11,
          color: '#606266'
        }
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '15%',
        top: '10%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        data: data.map(d => d.name),
        axisLabel: {
          color: '#606266',
          fontSize: 11,
          interval: 0,
          rotate: isDrillDown.value ? 0 : 30
        },
        axisLine: {
          lineStyle: { color: '#e4e7ed' }
        }
      },
      yAxis: {
        type: 'value',
        name: isDrillDown.value ? '指标数量' : '指标数量',
        axisLabel: {
          color: '#909399',
          fontSize: 11
        },
        splitLine: {
          lineStyle: {
            color: '#f2f3f5',
            type: 'dashed'
          }
        }
      },
      series: [
        {
          name: '超前完成',
          type: 'bar',
          stack: 'total',
          barWidth: isDrillDown.value ? 40 : 30,
          itemStyle: {
            color: statusColors.ahead,
            borderRadius: isDrillDown.value ? [0, 0, 0, 0] : [4, 0, 0, 4]
          },
          data: data.map(d => d.ahead || 0)
        },
        {
          name: '正常',
          type: 'bar',
          stack: 'total',
          barWidth: isDrillDown.value ? 40 : 30,
          itemStyle: {
            color: statusColors.normal
          },
          data: data.map(d => d.normal || 0)
        },
        {
          name: '预警',
          type: 'bar',
          stack: 'total',
          barWidth: isDrillDown.value ? 40 : 30,
          itemStyle: {
            color: statusColors.warning
          },
          data: data.map(d => d.warning || 0)
        },
        {
          name: '延期',
          type: 'bar',
          stack: 'total',
          barWidth: isDrillDown.value ? 40 : 30,
          itemStyle: {
            color: statusColors.delayed,
            borderRadius: isDrillDown.value ? [0, 0, 0, 0] : [0, 4, 4, 0]
          },
          data: data.map(d => d.delayed || 0)
        }
      ]
    })

    // 添加点击事件
    benchmarkChartInstance.off('click')
    benchmarkChartInstance.on('click', (params: { componentType: string; dataIndex: number }) => {
      if (params.componentType === 'series') {
        const dataItem = data[params.dataIndex]

        if (isDrillDown.value) {
          // 下钻状态：点击月份显示该月的指标详情
          if (dataItem?.month !== undefined) {
            // 如果点击的是同一月份，关闭卡片
            if (selectedMonthInDrillDown.value === dataItem.month) {
              handleCloseMonthIndicatorCard()
            } else {
              // 选中新月份
              selectedMonthInDrillDown.value = dataItem.month
              selectedStatusFilter.value = null
              showMonthIndicatorCard.value = true
            }
          }
        } else {
          // 部门视图：点击部门进入下钻
          if (dataItem?.fullName) {
            drilledDept.value = dataItem.fullName
            isDrillDown.value = true
            // 下钻后默认不显示月份卡片，需要点击月份
            selectedMonthInDrillDown.value = null
            showMonthIndicatorCard.value = false
            nextTick(() => {
              initBenchmarkChart()
            })
          }
        }
      }
    })
  }

  // 处理月份变化
  const handleMonthChange = () => {
    // 关闭月份指标卡片
    showMonthIndicatorCard.value = false
    selectedMonthInDrillDown.value = null

    if (isDrillDown.value) {
      // 如果在下钻状态，返回部门视图
      isDrillDown.value = false
      drilledDept.value = ''
    }
    nextTick(() => {
      initBenchmarkChart()
    })
  }

  // 返回部门视图
  const handleBackToDepts = () => {
    // 关闭月份指标卡片
    showMonthIndicatorCard.value = false
    selectedMonthInDrillDown.value = null

    isDrillDown.value = false
    drilledDept.value = ''
    nextTick(() => {
      initBenchmarkChart()
    })
  }

  // 监听下钻状态和月份变化，重新渲染图表
  watch([isDrillDown, selectedMonth], () => {
    nextTick(() => {
      initBenchmarkChart()
    })
  })

  // 监听年份变化，重新渲染所有图表
  watch(
    () => timeContext.currentYear,
    () => {
      nextTick(() => {
        initBenchmarkChart()
        initCollegeChart()
        initCollegeRankingChart()
      })
    }
  )

  // 监听指标数据变化，重新渲染学院相关图表
  // 解决异步加载数据后图表不更新的问题
  watch(
    () => strategicStore.indicators.length,
    (newLength, _oldLength) => {
      if (newLength > 0) {
        nextTick(() => {
          initCollegeChart()
          initCollegeRankingChart()
        })
      }
    },
    { immediate: true }
  )

  // 监听部门汇总数据变化，重新渲染职能部门堆叠柱状图
  // 解决 departmentSummary 依赖多个 store 数据异步加载的问题
  watch(
    () => dashboardStore.departmentSummary.length,
    newLength => {
      if (newLength > 0) {
        nextTick(() => {
          initBenchmarkChart()
        })
      }
    },
    { immediate: true }
  )

  watch(
    () => orgStore.functionalDepartments.length,
    newLength => {
      if (currentRole.value === 'strategic_dept' && newLength > 0) {
        nextTick(() => {
          initBenchmarkChart()
        })
      }
    },
    { immediate: true }
  )

  // 监听加载状态变化，当加载完成时重新渲染图表
  watch(
    () => strategicStore.loading,
    (isLoading, wasLoading) => {
      // 当从加载中变为加载完成时，重新渲染图表
      if (wasLoading && !isLoading && strategicStore.indicators.length > 0) {
        nextTick(() => {
          initCollegeChart()
          initCollegeRankingChart()
        })
      }
    }
  )

  // 监听部门/角色切换，重新渲染所有图表
  // 直接监听 authStore 的 effectiveRole 和 effectiveDepartment，确保响应性
  watch(
    [() => authStore.effectiveRole, () => authStore.effectiveDepartment, () => props.viewingRole],
    () => {
      nextTick(() => {
        initBenchmarkChart()
        initCollegeChart()
        initCollegeRankingChart()
        initRadarChart()
      })
    }
  )

  // 监听学院看板月份和下钻状态变化
  watch([collegeSelectedMonth, isCollegeDrillDown], () => {
    nextTick(() => {
      initCollegeChart()
    })
  })

  // 监听分院排名月份和部门筛选变化
  watch([collegeRankingMonth, selectedOwnerDeptFilter], () => {
    nextTick(() => {
      initCollegeRankingChart()
    })
  })

  // 窗口大小变化时重绘图表
  const handleResize = () => {
    radarChartInstance?.resize()
    benchmarkChartInstance?.resize()
    collegeChartInstance?.resize()
    collegeRankingChartInstance?.resize()
  }

  // ============ 学院看板图表配置（职能部门视角）============

  // 初始化学院看板堆叠柱状图
  const initCollegeChart = async () => {
    if (!collegeChartRef.value) {
      return
    }
    if (currentRole.value === 'secondary_college') {
      // 二级学院不显示此图表，清空已有实例
      if (collegeChartInstance) {
        collegeChartInstance.dispose()
        collegeChartInstance = null
      }
      return
    }

    const data = isCollegeDrillDown.value ? collegeMonthlyStackedData.value : collegeBarData.value

    if (!data || data.length === 0) {
      // 数据为空时，清空图表并显示空状态
      if (collegeChartInstance) {
        collegeChartInstance.dispose()
        collegeChartInstance = null
      }
      return
    }

    collegeChartRef.value.style.height = `350px`

    collegeChartInstance = await createChartInstance(collegeChartRef.value, collegeChartInstance)
    if (!collegeChartInstance) {
      return
    }

    collegeChartInstance.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: Array<{ dataIndex: number; name: string }>) => {
          if (!Array.isArray(params) || params.length === 0) {
            return ''
          }
          const dataIndex = params[0].dataIndex
          const dataItem = data[dataIndex]
          const name = dataItem?.fullName || dataItem?.name || params[0].name

          let tooltip = `<strong>${name}</strong><br/>`

          if (isCollegeDrillDown.value) {
            tooltip += `${params[0].name}<br/>`
            tooltip += `<span style="color: ${statusColors.ahead}">●</span> 超前: ${dataItem?.ahead || 0}<br/>`
            tooltip += `<span style="color: ${statusColors.normal}">●</span> 正常: ${dataItem?.normal || 0}<br/>`
            tooltip += `<span style="color: ${statusColors.warning}">●</span> 预警: ${dataItem?.warning || 0}<br/>`
            tooltip += `<span style="color: ${statusColors.delayed}">●</span> 延期: ${dataItem?.delayed || 0}<br/>`
            tooltip += `总计: ${dataItem?.total || 0}`
          } else {
            tooltip += `${collegeSelectedMonth.value}月完成情况<br/>`
            tooltip += `<span style="color: ${statusColors.ahead}">■</span> 超前: ${dataItem?.ahead || 0}<br/>`
            tooltip += `<span style="color: ${statusColors.normal}">■</span> 正常: ${dataItem?.normal || 0}<br/>`
            tooltip += `<span style="color: ${statusColors.warning}">■</span> 预警: ${dataItem?.warning || 0}<br/>`
            tooltip += `<span style="color: ${statusColors.delayed}">■</span> 延期: ${dataItem?.delayed || 0}<br/>`
            tooltip += `总计: ${dataItem?.total || 0}<br/>`
            tooltip += `<span style="color: #409eff; font-size: 11px;">点击查看月度趋势</span>`
          }
          return tooltip
        }
      },
      legend: {
        data: ['超前完成', '正常', '预警', '延期'],
        bottom: 0,
        left: 'center',
        itemWidth: 12,
        itemHeight: 12,
        textStyle: {
          fontSize: 11,
          color: '#606266'
        }
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '15%',
        top: '10%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        data: data.map(d => d.name),
        axisLabel: {
          color: '#606266',
          fontSize: 11,
          interval: 0,
          rotate: isCollegeDrillDown.value ? 0 : 30
        },
        axisLine: {
          lineStyle: { color: '#e4e7ed' }
        }
      },
      yAxis: {
        type: 'value',
        name: '指标数量',
        axisLabel: {
          color: '#909399',
          fontSize: 11
        },
        splitLine: {
          lineStyle: {
            color: '#f2f3f5',
            type: 'dashed'
          }
        }
      },
      series: [
        {
          name: '超前完成',
          type: 'bar',
          stack: 'total',
          barWidth: isCollegeDrillDown.value ? 40 : 30,
          itemStyle: {
            color: statusColors.ahead,
            borderRadius: isCollegeDrillDown.value ? [0, 0, 0, 0] : [4, 0, 0, 4]
          },
          data: data.map(d => d.ahead || 0)
        },
        {
          name: '正常',
          type: 'bar',
          stack: 'total',
          barWidth: isCollegeDrillDown.value ? 40 : 30,
          itemStyle: {
            color: statusColors.normal
          },
          data: data.map(d => d.normal || 0)
        },
        {
          name: '预警',
          type: 'bar',
          stack: 'total',
          barWidth: isCollegeDrillDown.value ? 40 : 30,
          itemStyle: {
            color: statusColors.warning
          },
          data: data.map(d => d.warning || 0)
        },
        {
          name: '延期',
          type: 'bar',
          stack: 'total',
          barWidth: isCollegeDrillDown.value ? 40 : 30,
          itemStyle: {
            color: statusColors.delayed,
            borderRadius: isCollegeDrillDown.value ? [0, 0, 0, 0] : [0, 4, 4, 0]
          },
          data: data.map(d => d.delayed || 0)
        }
      ]
    })

    // 点击事件
    collegeChartInstance.off('click')
    collegeChartInstance.on('click', (params: { componentType: string; dataIndex: number }) => {
      if (params.componentType === 'series') {
        const dataItem = data[params.dataIndex]

        if (isCollegeDrillDown.value) {
          // 下钻状态：点击月份显示该月的指标详情
          if (dataItem?.month !== undefined) {
            if (selectedMonthInCollegeDrillDown.value === dataItem.month) {
              handleCloseCollegeMonthIndicatorCard()
            } else {
              selectedMonthInCollegeDrillDown.value = dataItem.month
              selectedStatusFilter.value = null
              showCollegeMonthIndicatorCard.value = true
            }
          }
        } else {
          // 学院视图：点击学院进入下钻
          if (dataItem?.fullName) {
            drilledCollege.value = dataItem.fullName
            isCollegeDrillDown.value = true
            selectedMonthInCollegeDrillDown.value = null
            showCollegeMonthIndicatorCard.value = false
            nextTick(() => {
              initCollegeChart()
            })
          }
        }
      }
    })
  }

  // 处理学院看板月份变化
  const handleCollegeMonthChange = () => {
    showCollegeMonthIndicatorCard.value = false
    selectedMonthInCollegeDrillDown.value = null
    if (isCollegeDrillDown.value) {
      isCollegeDrillDown.value = false
      drilledCollege.value = ''
    }
    nextTick(() => {
      initCollegeChart()
    })
  }

  // 返回学院视图
  const handleBackToColleges = () => {
    showCollegeMonthIndicatorCard.value = false
    selectedMonthInCollegeDrillDown.value = null
    isCollegeDrillDown.value = false
    drilledCollege.value = ''
    nextTick(() => {
      initCollegeChart()
    })
  }

  // ============ 分院排名看板图表配置 ============

  // 初始化分院排名条形图
  const initCollegeRankingChart = async () => {
    if (!collegeRankingChartRef.value) {
      return
    }
    if (currentRole.value === 'secondary_college') {
      // 二级学院不显示此图表，清空已有实例
      if (collegeRankingChartInstance) {
        collegeRankingChartInstance.dispose()
        collegeRankingChartInstance = null
      }
      return
    }

    const data = getCollegeRankingData.value
    if (!data || data.length === 0) {
      // 数据为空时，清空图表
      if (collegeRankingChartInstance) {
        collegeRankingChartInstance.dispose()
        collegeRankingChartInstance = null
      }
      return
    }

    const chartHeight = Math.max(350, data.length * 35)
    collegeRankingChartRef.value.style.height = `${chartHeight}px`

    collegeRankingChartInstance = await createChartInstance(
      collegeRankingChartRef.value,
      collegeRankingChartInstance
    )
    if (!collegeRankingChartInstance) {
      return
    }

    collegeRankingChartInstance.setOption({
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: Array<{ dataIndex: number; value: number; name: string }>) => {
          const item = params[0]
          const dataItem = data[item.dataIndex]
          const fullName = dataItem?.fullName || item.name
          return `<strong>${fullName}</strong><br/>
                分数: ${item.value}<br/>
                完成: ${dataItem?.completed || 0}/${dataItem?.total || 0} 项<br/>
                <div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed #e4e7ed;">
                  <span style="color: #67c23a; margin-right: 8px;">超前 ${dataItem?.ahead || 0}</span>
                  <span style="color: #409eff; margin-right: 8px;">正常 ${dataItem?.normal || 0}</span>
                  <span style="color: #e6a23c; margin-right: 8px;">预警 ${dataItem?.warning || 0}</span>
                  <span style="color: #f56c6c;">延期 ${dataItem?.delayed || 0}</span>
                </div>`
        }
      },
      grid: {
        left: '3%',
        right: '10%',
        bottom: '10%',
        top: '10%',
        containLabel: true
      },
      xAxis: {
        type: 'value',
        max: (_value: number) => {
          const max = Math.max(...data.map(d => d.value))
          return Math.ceil(max * 1.2)
        },
        splitLine: { show: false },
        axisLabel: {
          color: '#909399',
          fontSize: 11
        },
        axisLine: { show: false },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'category',
        data: data.map(d => d.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 12,
          color: '#606266'
        },
        inverse: true
      },
      series: [
        {
          name: '分数',
          type: 'bar',
          barWidth: 20,
          barGap: '30%',
          itemStyle: {
            borderRadius: [0, 4, 4, 0],
            color: (params: { value: number }) => {
              const value = params.value as number
              if (value >= 80) {
                return '#67c23a'
              }
              if (value >= 60) {
                return '#409eff'
              }
              if (value >= 40) {
                return '#e6a23c'
              }
              return '#f56c6c'
            }
          },
          label: {
            show: true,
            position: 'right',
            formatter: '{c}',
            fontSize: 12,
            color: '#606266'
          },
          data: data.map(d => d.value)
        }
      ]
    })
  }

  // 处理分院排名月份变化
  const handleCollegeRankingMonthChange = () => {
    nextTick(() => {
      initCollegeRankingChart()
    })
  }

  // 处理分院排名部门筛选变化
  const handleOwnerDeptFilterChange = () => {
    nextTick(() => {
      initCollegeRankingChart()
    })
  }

  // 监听数据变化，重新渲染图表
  watch([benchmarkData, radarData], () => {
    nextTick(() => {
      initBenchmarkChart()
      initRadarChart()
    })
  })

  // 监听选中部门变化，重新调整图表大小
  watch(showIndicatorCard, () => {
    // 在动画过程中持续调整图表大小
    const resizeChart = () => {
      benchmarkChartInstance?.resize()
    }

    // 动画开始时立即调整
    resizeChart()

    // 动画过程中多次调整，确保平滑
    setTimeout(resizeChart, 100)
    setTimeout(resizeChart, 200)
    setTimeout(resizeChart, 300)
    setTimeout(() => {
      resizeChart()
      // 动画结束后重新初始化图表
      initBenchmarkChart()
    }, 400)
  })

  // 监听下钻后月份指标卡片变化，重新调整图表大小
  watch(showMonthIndicatorCard, () => {
    const resizeChart = () => {
      benchmarkChartInstance?.resize()
    }

    resizeChart()
    setTimeout(resizeChart, 100)
    setTimeout(resizeChart, 200)
    setTimeout(resizeChart, 300)
    setTimeout(() => {
      resizeChart()
      initBenchmarkChart()
    }, 400)
  })

  // 监听学院看板月份指标卡片变化，重新调整图表大小
  watch(showCollegeMonthIndicatorCard, () => {
    const resizeChart = () => {
      collegeChartInstance?.resize()
    }

    resizeChart()
    setTimeout(resizeChart, 100)
    setTimeout(resizeChart, 200)
    setTimeout(resizeChart, 300)
    setTimeout(() => {
      resizeChart()
      initCollegeChart()
    }, 400)
  })

  // 生命周期
  onMounted(async () => {
    try {
      if (!orgStore.loaded || orgStore.departments.length === 0) {
        await orgStore.loadDepartments()
      }

      if (strategicStore.dataSource !== 'api' || strategicStore.indicators.length === 0) {
        await strategicStore.loadIndicatorsByYear(timeContext.currentYear, { force: true })
      }
    } catch (err) {
      logger.error('[Dashboard] Initial load failed:', err)
    }

    await nextTick()
    await initRadarChart()
    await initBenchmarkChart()
    await initCollegeChart()
    await initCollegeRankingChart()
    window.addEventListener('resize', handleResize)
    window.addEventListener(
      GLOBAL_DATA_REFRESH_REQUEST_EVENT,
      handleGlobalDataRefreshRequest as EventListener
    )
  })

  onUnmounted(() => {
    window.removeEventListener('resize', handleResize)
    window.removeEventListener(
      GLOBAL_DATA_REFRESH_REQUEST_EVENT,
      handleGlobalDataRefreshRequest as EventListener
    )
    radarChartInstance?.dispose()
    benchmarkChartInstance?.dispose()
    collegeChartInstance?.dispose()
    collegeRankingChartInstance?.dispose()
  })

  const handleGlobalDataRefreshRequest = (event: Event) => {
    if (globalDataRefreshPromise) {
      return
    }

    const detail = (event as CustomEvent<GlobalDataRefreshDetail>).detail
    globalDataRefreshPromise = (async () => {
      logger.info('[DashboardView] handling global data refresh request', detail)
      await reloadData()
    })().finally(() => {
      globalDataRefreshPromise = null
    })
  }

  return {
    _benchmarkChartHeight,
    _benchmarkViewMode,
    _departmentOptions,
    _getBenchmarkTitle,
    _getDepartmentCardTitle,
    _getDeptStats,
    _handleBenchmarkClick,
    _handleFilterApply,
    _hasActiveFilters,
    _kpiCards,
    _radarStats,
    _resetFilters,
    _showFilterFeature,
    applyFilters,
    authStore,
    availableFunctionalDepts,
    baseDelayedTasks,
    benchmarkChartRef,
    benchmarkSectionRef,
    benchmarkData,
    canViewAllDepartments,
    collegeBarData,
    collegeChartRef,
    collegeMonthIndicatorStats,
    collegeMonthIndicators,
    collegeMonthlyStackedData,
    collegeRankingChartRef,
    collegeRankingMonth,
    collegeSelectedMonth,
    createChartInstance,
    currentDepartment,
    currentRole,
    dashboardData,
    dashboardStore,
    delayedTasks,
    drilledCollege,
    drilledDept,
    filterForm,
    filteredCollegeMonthIndicators,
    filteredDeptIndicators,
    filteredMonthIndicators,
    getCollegeRankingData,
    getCollegeStatsForFunctionalDept,
    getCurrentMilestoneIndex,
    getCurrentTargetProgress,
    getDeptStatsAtMonth,
    getIndicatorStatus,
    getStatusClass,
    getStatusText,
    handleAlertClick,
    handleSummaryDrillClick,
    handleBackToColleges,
    handleBackToDepts,
    handleBreadcrumbNavigate,
    handleCloseCollegeMonthIndicatorCard,
    handleCloseIndicatorCard,
    handleCloseMonthIndicatorCard,
    handleCollegeMonthChange,
    handleCollegeRankingMonthChange,
    handleExport,
    handleMonthChange,
    handleOwnerDeptFilterChange,
    handleResize,
    handleSankeyLinkClick,
    handleSankeyNodeClick,
    handleSourceClick,
    handleStatusFilterClick,
    handleUrge,
    helpTexts,
    initBenchmarkChart,
    initCollegeChart,
    initCollegeRankingChart,
    initRadarChart,
    isChartContainerReady,
    isCollegeDrillDown,
    isDataEmpty,
    isDataLoading,
    isDrillDown,
    isFallbackMode,
    loadEcharts,
    loadReminderStatuses,
    messageStore,
    monthIndicatorStats,
    monthIndicators,
    monthlyStackedData,
    orgStore,
    radarChartRef,
    radarData,
    reloadData,
    reminderStatuses,
    remindingMap,
    selectedBenchmarkDept,
    selectedDeptIndicators,
    selectedDeptStats,
    selectedMonth,
    selectedMonthInCollegeDrillDown,
    selectedMonthInDrillDown,
    selectedOwnerDeptFilter,
    selectedStatusFilter,
    pageHasError,
    showSkeleton,
    showCollegeMonthIndicatorCard,
    showFilterPanel,
    showIndicatorCard,
    showMonthIndicatorCard,
    stackedBarData,
    statusColors,
    strategicStore,
    timeContext
  }
}
