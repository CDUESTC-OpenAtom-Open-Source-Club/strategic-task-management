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
import {
  aggregateCollegeLevels,
  aggregateDeptOwnLevels,
  collegeGraySegmentCount,
  collegeTooltipCountsLine,
  emptyDeptOwnAggregate,
  isGrayMonth,
  mergeLevelAggregates,
  monthStateDeptTooltip,
  monthStateGrayLabel,
  resolveMonthState,
  toCollegeBarRows,
  toCollegeRankingRows,
  toCollegeTrendRows
} from '@/features/dashboard/lib'
import type { DashboardOverviewAggregate, DeptOwnLevelAggregate } from '@/features/dashboard/lib'
import type {
  DashboardAppraisalSummaryResponse,
  DashboardCollegeLevelStat,
  DashboardCollegeLevelsMonth,
  DashboardDelayedIndicatorItem,
  DashboardDepartmentLevelStat,
  DashboardIndicatorLevelItem,
  DashboardMonthState
} from '@/features/dashboard/api/dashboardApi'
import { resolveIndicatorYear } from '@/shared/lib/utils/indicatorYear'
// 2026-11-25（看板来源归属修复）：导出「任务来源」列按归口职能部门归组键（父级核心指标 targetOrg）
import { resolveTaskSourceDept } from '@/features/indicator/model/parentIndicatorCore'
import { formatLocalDateTag } from '@/shared/lib/utils/localDateTag'
import {
  buildExcelBlob,
  buildExportFileName,
  exportRowsToExcel,
  saveBlobAsFile,
  sanitizeFileName,
  type ExcelExportColumn,
  type ExcelExportSheet
} from '@/shared/lib/export/excel'
import { buildComprehensiveReport } from '@/features/dashboard/lib/comprehensiveReport'
import {
  GLOBAL_DATA_REFRESH_REQUEST_EVENT,
  shouldRefreshForDomains,
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

  // 帮助提示内容
  const helpTexts = {
    totalScore:
      '总得分 = 基础性指标得分 + 发展性指标得分，满分120分。基础性指标满分100分，发展性指标满分20分。',
    basicScore: '基础性指标是必须完成的核心指标，根据各指标完成进度加权计算得分，满分100分。',
    developmentScore: '发展性指标是鼓励性指标，完成后可获得额外加分，满分20分。',
    warningCount:
      '滞后任务按所选月份状态统计：滞后表示该指标进度等级被上级鉴定为滞后，需上级关注。',
    scoreComposition: '展示基础性指标和发展性指标的得分占比，帮助了解整体得分构成。',
    alertDistribution: '按所选月份统计指标进度等级分布：超前完成、正常、滞后。',
    completionRate:
      '完成率 = 所选月份状态为正常或超前的指标数 / 总指标数 × 100%。未下发或滞后指标不计入完成。',
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
  // 默认展示「当前月」（1-based，年份由 timeContext 承载）：系统启用初期上月往往没有数据，
  // 默认当月保证首屏就有数据（2026-11-24：原「默认上月」在启用首月导致打开看板全空）
  const currentMonthNumber = new Date().getMonth() + 1

  // P5 看板异动汇总：异动审批中的指标清单
  const mutationSummary = ref<
    Array<{
      id: number
      indicator_desc: string
      weight_percent: number
      mutation_started_at: string
    }>
  >([])
  const loadMutationSummary = async () => {
    try {
      const { mutationApi } = await import('@/features/indicator/api/mutationApi')
      const response = await mutationApi.inMutation()
      mutationSummary.value = (response.data ?? []) as typeof mutationSummary.value
    } catch {
      mutationSummary.value = []
    }
  }

  const selectedMonth = ref(currentMonthNumber) // 默认当前月（启用初期上月无数据，保证首屏有数据）
  const isDrillDown = ref(false) // 是否处于下钻状态
  const drilledDept = ref('') // 下钻选中的部门

  // 下钻后的月份指标卡片状态
  const selectedMonthInDrillDown = ref<number | null>(null) // 下钻后选中的月份
  const showMonthIndicatorCard = ref(false) // 控制月份指标卡片显示

  // ============ 学院看板状态（职能部门视角）============
  // 2026-11-25 月份事实源对齐：学院卡 / 分院排名 / 总览统计（完成率·等级分布·状态卡）
  // 原先与分布图各用各的月份变量——默认值虽已统一为「当前月」，但仍是三个独立 ref，
  // 改任一张卡的月份不影响另两张，同屏仍会出现两个月份口径（分布图 11 月、学院卡 10 月）。
  // 现在三者同源于 selectedMonth（可写 computed，v-model 仍可用），
  // 月份永远一致，且不再各自维护、不会再次走偏。
  const collegeSelectedMonth = computed({
    get: () => selectedMonth.value,
    set: (value: number) => {
      selectedMonth.value = value
    }
  })
  const isCollegeDrillDown = ref(false) // 学院看板下钻状态
  const drilledCollege = ref('') // 下钻选中的学院
  const selectedMonthInCollegeDrillDown = ref<number | null>(null) // 学院下钻后选中的月份
  const showCollegeMonthIndicatorCard = ref(false) // 学院月份指标卡片显示

  // ============ 学院等级统计（2026-10-31 新口径：后端唯一数据源）============
  // 口径：①未填报学院整列不显示（接口不返回就不画）②只算已提交/已审批月报（后端过滤）
  // ③等级只看上级鉴定（ahead/normal/delayed）④手动预警等级退出看板统计
  const collegeLevels = ref<DashboardCollegeLevelStat[]>([]) // 当月（collegeSelectedMonth）学院等级
  const collegeLevelsLoading = ref(false)
  const collegeTrendMonths = ref<DashboardCollegeLevelsMonth[]>([]) // 年度趋势（只到最晚有数据月份）
  const collegeTrendLoading = ref(false)

  // ============ 部门审核鉴定分布（2026-11-18：部门分布图唯一数据源）============
  // 口径：每个指标取不晚于选中月份的最近一次 appraisal_level（后端按业务口径折叠），
  // 替代原前端启发式 getDeptStatsAtMonth——它忽略 month、也不读 appraisal_level，
  // 导致各月份图形完全一样、与战略任务表的审核进度对不上（用户反馈 2026-11-18）
  const appraisalSummary = ref<DashboardAppraisalSummaryResponse | null>(null)
  const appraisalSummaryLoading = ref(false)
  // 选中月份无任何鉴定数据时，只在首轮自动跳到年度最近有数据的月份一次，
  // 避免用户手动切到空月份又被弹回去
  const appraisalMonthAutoJumped = ref(false)

  // ============ 分院排名看板状态 ============
  // 2026-11-25：与学院卡同源（排名数据取自 college-levels-trend 的同月数据），
  // 同样从 selectedMonth 派生，避免排名卡与学院卡/总览统计显示不同月份。
  const collegeRankingMonth = computed({
    get: () => selectedMonth.value,
    set: (value: number) => {
      selectedMonth.value = value
    }
  })
  // 2026-10-31 新口径：分院排名改吃 college-levels 接口（无来源部门维度），
  // 原 selectedOwnerDeptFilter 来源部门筛选随之移除

  // 状态颜色配置（2026-10-28：超前与正常都用绿，但超前更深，便于区分）
  const statusColors = {
    ahead: '#1A7F37', // 深绿 - 超前完成
    normal: '#67C23A', // 绿色 - 正常
    warning: '#E6A23C', // 黄色 - 预警
    delayed: '#F56C6C' // 红色 - 滞后
  }

  // 2026-11-18 按月快照口径：非 APPROVED 月份的置灰柱颜色（与学院图灰柱同色系）
  const MONTH_GRAY_COLOR = '#C0C4CC'

  // 计算指标状态的函数
  // 2026-11-18（PR #127 评审意见 A 收尾）：原 getIndicatorStatusAtMonth 启发式
  // （DRAFT/REJECTED→滞后、其余一律正常——既不看月份也不读鉴定）已从 summaryMetrics 删除。
  // 指标明细卡片目前没有逐指标的月度鉴定快照数据源（appraisal-summary 只有部门聚合，
  // 逐指标源待后端 month-snapshot 口径合入后接入），状态仅保留数据库预警覆盖，
  // 不再产出与鉴定无关的「正常/滞后」判定。
  const getIndicatorStatus = (indicator: Indicator): IndicatorStatus => {
    return getDatabaseAlertStatus(indicator) ?? 'normal'
  }

  // 获取状态显示文本（三档口径：原「预警」状态并入「滞后」展示）
  const getStatusText = (status: IndicatorStatus): string => {
    const statusMap: Record<IndicatorStatus, string> = {
      normal: '正常',
      ahead: '超前完成',
      warning: '滞后',
      delayed: '滞后'
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

  // 里程碑机制已移除：不再有里程碑目标进度。
  const getCurrentTargetProgress = (_indicator: Indicator): number | null => {
    return null
  }

  const getIndicatorIdentity = (indicator: {
    indicatorId?: number | string
    id?: number | string
  }): number | null => {
    const rawId = indicator.indicatorId ?? indicator.id
    const id = Number(rawId)
    return Number.isFinite(id) && id > 0 ? id : null
  }

  const databaseAlertSeverityByIndicatorId = computed(() => {
    const severityRank: Record<string, number> = {
      INFO: 1,
      MINOR: 1,
      WARNING: 2,
      MAJOR: 2,
      CRITICAL: 3
    }
    const severityByIndicatorId = new Map<number, string>()

    dashboardStore.unclosedAlerts.forEach(alert => {
      const status = String(alert.status || '').toUpperCase()
      if (status === 'CLOSED' || status === 'RESOLVED') {
        return
      }

      const indicatorId = getIndicatorIdentity({
        indicatorId: alert.indicatorId,
        id: alert.entityId
      })
      if (!indicatorId) {
        return
      }

      const severity = String(alert.severity || '').toUpperCase()
      const currentSeverity = severityByIndicatorId.get(indicatorId)
      if (
        !currentSeverity ||
        (severityRank[severity] || 0) > (severityRank[currentSeverity] || 0)
      ) {
        severityByIndicatorId.set(indicatorId, severity)
      }
    })

    return severityByIndicatorId
  })

  const getDatabaseAlertStatus = (indicator: {
    indicatorId?: number | string
    id?: number | string
  }): IndicatorStatus | null => {
    const indicatorId = getIndicatorIdentity(indicator)
    if (!indicatorId) {
      return null
    }

    const severity = databaseAlertSeverityByIndicatorId.value.get(indicatorId)
    if (severity === 'CRITICAL') {
      return 'delayed'
    }
    if (severity === 'WARNING' || severity === 'MAJOR') {
      return 'warning'
    }
    return null
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
        targetProgress: getCurrentTargetProgress(i)
      }))
  })

  // 筛选后的指标列表（根据状态筛选；三档口径：选「滞后」时包含原预警状态）
  const filteredDeptIndicators = computed(() => {
    if (!selectedStatusFilter.value) {
      return selectedDeptIndicators.value
    }
    return selectedDeptIndicators.value.filter(i =>
      selectedStatusFilter.value === 'delayed'
        ? i.status === 'delayed' || i.status === 'warning'
        : i.status === selectedStatusFilter.value
    )
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

  // ============ 部门审核鉴定分布（2026-11-18 用户反馈修复）============
  // 数据源统一为 GET /dashboard/appraisal-summary（后端已合入），前端不再自行推算等级。
  // 2026-11-18 按月快照口径：行带 monthState（APPROVED/IN_REVIEW/NOT_REPORTED），
  // 只有 APPROVED 月份出鉴定值，其余月份柱形置灰（#C0C4CC）+ tooltip 状态说明。
  type DeptLevelStats = {
    ahead: number
    normal: number
    delayed: number
    warning: number
    total: number
    /** 该部门该月快照状态（缺省 APPROVED） */
    monthState: DashboardMonthState
    /** 该部门当年已下发指标数（非 APPROVED 灰柱高度；缺省 0=灰柱不出高度） */
    dispatchedCount: number
  }

  const emptyDeptStats = (): DeptLevelStats => ({
    ahead: 0,
    normal: 0,
    delayed: 0,
    warning: 0,
    total: 0,
    monthState: 'APPROVED',
    dispatchedCount: 0
  })

  /** 建「部门名 / 部门ID」双索引：后端 orgId 是 number，Department.id 是 string */
  const indexDeptStats = (
    departments: DashboardDepartmentLevelStat[],
    monthEnvelope?: { monthState?: DashboardMonthState } | null
  ) => {
    const byName = new Map<string, DeptLevelStats>()
    const byId = new Map<string, DeptLevelStats>()
    departments.forEach(dept => {
      const stats: DeptLevelStats = {
        ahead: dept.ahead,
        normal: dept.normal,
        delayed: dept.delayed,
        // warning 恒 0：三档口径落地后「预警」并为「滞后」，仅为对齐旧数据结构保留
        warning: 0,
        total: dept.total,
        monthState: resolveMonthState(dept, monthEnvelope, appraisalSummary.value),
        dispatchedCount: dept.dispatchedCount ?? 0
      }
      if (dept.orgName) {
        byName.set(dept.orgName, stats)
      }
      byId.set(String(dept.orgId), stats)
    })
    return { byName, byId }
  }

  /** 先按部门名查、再按组织 ID 查（重名/改名都能兜住），未命中返回全 0 */
  const lookupDeptStats = (
    index: ReturnType<typeof indexDeptStats>,
    deptId: string | undefined,
    deptName: string
  ): DeptLevelStats => {
    const byName = index.byName.get(deptName)
    if (byName) {
      return byName
    }
    if (deptId) {
      return index.byId.get(String(deptId)) ?? emptyDeptStats()
    }
    return emptyDeptStats()
  }

  const currentDeptStatsIndex = computed(() =>
    indexDeptStats(appraisalSummary.value?.departments ?? [], appraisalSummary.value)
  )

  const deptStatsIndexByMonth = computed(() => {
    const indexByMonth = new Map<number, ReturnType<typeof indexDeptStats>>()
    ;(appraisalSummary.value?.departmentMonths ?? []).forEach(entry => {
      indexByMonth.set(entry.month, indexDeptStats(entry.departments, entry))
    })
    return indexByMonth
  })

  /**
   * 月份口径请求的过期保护（2026-11-27 切月等价）：记下发起时的口径（年 + 月），
   * 响应回来后返回口径是否仍然一致；不一致就丢弃。
   * 快速切月、切年不改月号、auto-jump 跳月时，旧口径的响应都不会覆盖当前口径的数据。
   */
  const captureMonthScope = () => {
    const scopeKey = `${timeContext.currentYear}-${selectedMonth.value}`
    return () => scopeKey === `${timeContext.currentYear}-${selectedMonth.value}`
  }

  const loadAppraisalSummary = async () => {
    const isCurrentScope = captureMonthScope()
    appraisalSummaryLoading.value = true
    try {
      const summary = await dashboardApi.getAppraisalSummary({
        year: timeContext.currentYear,
        month: selectedMonth.value
      })
      // 2026-11-25：与学院等级同源的过期响应保护——月份已变则丢弃，
      // 否则旧月份的鉴定汇总会覆盖当前月份（分布图与总览统计口径不一致）。
      if (!isCurrentScope()) {
        return
      }
      appraisalSummary.value = summary

      // 首屏默认「当前月」：若该月尚无任何鉴定数据，自动跳到年度最近有数据的月份，
      // 保证一进看板就能看到真实分布（只跳一次，用户手动切月后不再干预）
      if (
        !appraisalMonthAutoJumped.value &&
        summary.departments.length === 0 &&
        summary.latestMonth > 0 &&
        summary.latestMonth !== selectedMonth.value
      ) {
        appraisalMonthAutoJumped.value = true
        selectedMonth.value = summary.latestMonth
        // 2026-11-27（切月等价）：跳月后的数据重拉统一由 watch(selectedMonth) 发起
        // （学院等级 / 鉴定汇总 / 滞后清单各一次），这里不再单独补拉学院等级。
        return
      }
      appraisalMonthAutoJumped.value = true
    } catch (error) {
      // 口径已变：失败的是旧月份的请求，数据与提示交给新月份的请求，不覆盖也不重复报错
      if (!isCurrentScope()) {
        return
      }
      // 接口失败：置空走空态，不回退前端启发式（否则又会画出于鉴定无关的结果）
      appraisalSummary.value = null
      logger.error('[Dashboard] Failed to load appraisal summary:', error)
      ElMessage.error('审核鉴定分布加载失败，请稍后重试')
    } finally {
      // 口径已变说明新月份的请求在途，loading 交给它收尾
      if (isCurrentScope()) {
        appraisalSummaryLoading.value = false
      }
    }
  }

  // ============ 行级鉴定明细（2026-11-27 下钻明细面板/下钻趋势的唯一等级数据源）============
  // 口径与聚合一致：只有 APPROVED 月报计入，鉴定优先自评（appraisal_level > self_rating）。
  // 进入部门下钻时按年一次取回本院/本部门明细（月度切片由前端完成，避免逐月 N+1 请求），
  // 行主体 = 指标 target 组织（责任单位），即「部门自身」口径（不含归口学院线）。
  const drillIndicatorLevels = ref<DashboardIndicatorLevelItem[]>([])
  const drillIndicatorLevelsLoading = ref(false)

  /** 行级鉴定明细的三档映射（与聚合同口径；无等级不造「正常」以外的判定） */
  const levelToIndicatorStatus = (level: string | null): IndicatorStatus => {
    if (level === 'AHEAD') {
      return 'ahead'
    }
    if (level === 'DELAYED') {
      return 'delayed'
    }
    return 'normal'
  }

  const loadDrillIndicatorLevels = async () => {
    if (!isDrillDown.value || !drilledDept.value) {
      return
    }
    const deptId = Number(
      orgStore.functionalDepartments.find(item => item.name === drilledDept.value)?.id
    )
    if (!Number.isFinite(deptId) || deptId <= 0) {
      drillIndicatorLevels.value = []
      return
    }
    drillIndicatorLevelsLoading.value = true
    try {
      const response = await dashboardApi.getIndicatorLevels({
        year: timeContext.currentYear,
        orgId: deptId
      })
      drillIndicatorLevels.value = response.items
    } catch (error) {
      // 接口失败置空走空态：明细面板与下钻趋势宁缺不造假数据
      drillIndicatorLevels.value = []
      logger.error('[Dashboard] Failed to load drill indicator levels:', error)
    } finally {
      drillIndicatorLevelsLoading.value = false
    }
  }

  /** 某月份的行级鉴定明细（indicatorId 升序，与接口排序一致） */
  const drillLevelsOfMonth = (month: number): DashboardIndicatorLevelItem[] =>
    drillIndicatorLevels.value
      .filter(item => item.month === month)
      .sort((a, b) => a.indicatorId - b.indicatorId)

  // ============ 学院下钻的行级鉴定明细（2026-11-27 学院下钻明细面板数据源）============
  // 与部门下钻 drillIndicatorLevels 同款：进入学院下钻时按年一次取回该学院明细
  // （月度切片由前端完成），行主体 = 指标 target 组织（学院视角正好匹配本院）。
  const collegeDrillIndicatorLevels = ref<DashboardIndicatorLevelItem[]>([])
  const collegeDrillIndicatorLevelsLoading = ref(false)

  const loadCollegeDrillIndicatorLevels = async () => {
    // 职能部门视角不发这个请求：indicator-levels 对职能角色查其他组织返回 403，
    // 明细面板走本地「只看自己下发」的口径（见 collegeMonthIndicators）
    if (
      !isCollegeDrillDown.value ||
      !drilledCollege.value ||
      currentRole.value === 'functional_dept'
    ) {
      return
    }
    const collegeId = Number(
      orgStore.colleges.find(college => college.name === drilledCollege.value)?.id
    )
    if (!Number.isFinite(collegeId) || collegeId <= 0) {
      collegeDrillIndicatorLevels.value = []
      return
    }
    collegeDrillIndicatorLevelsLoading.value = true
    try {
      const response = await dashboardApi.getIndicatorLevels({
        year: timeContext.currentYear,
        orgId: collegeId
      })
      collegeDrillIndicatorLevels.value = response.items
    } catch (error) {
      // 接口失败置空走空态：明细面板宁缺不造假数据
      collegeDrillIndicatorLevels.value = []
      logger.error('[Dashboard] Failed to load college drill indicator levels:', error)
    } finally {
      collegeDrillIndicatorLevelsLoading.value = false
    }
  }

  /** 某月份的学院下钻行级鉴定明细（indicatorId 升序，与接口排序一致） */
  const collegeDrillLevelsOfMonth = (month: number): DashboardIndicatorLevelItem[] =>
    collegeDrillIndicatorLevels.value
      .filter(item => item.month === month)
      .sort((a, b) => a.indicatorId - b.indicatorId)

  // 计算堆叠柱状图数据（部门视图 - 第一层）
  // 2026-11-18（PR #127 评审意见 A）：删除 getDeptStatsAtMonth 启发式回退——
  // 接口失败（appraisalSummary=null）一律空态 + 错误提示，不再画与鉴定无关的柱。
  const stackedBarData = computed(() => {
    if (isDrillDown.value) {
      return []
    }

    const summary = appraisalSummary.value
    if (summary === null) {
      return []
    }

    const functionalDepts = orgStore.functionalDepartments.filter(item => Boolean(item.name))
    if (functionalDepts.length === 0) {
      return []
    }

    const statsIndex = currentDeptStatsIndex.value

    return functionalDepts.map(item => {
      const deptName = item.name
      const stats = lookupDeptStats(statsIndex, item.id, deptName)
      return {
        name: deptName.length > 8 ? deptName.slice(0, 8) + '...' : deptName,
        fullName: deptName,
        ...stats
      }
    })
  })

  // 计算下钻后的月度堆叠数据（部门月度视图 - 第二层）
  // 2026-11-27（#14 口径统一）：下钻趋势与明细面板同源——等级计数改由行级鉴定明细
  // （indicator-levels，部门自身口径）聚合（当时 appraisal-summary 部门行含归口到本部门的
  // 学院线指标，与本部门明细对不上；该部门行同日已改为部门自身口径，与一级图同屏一致）；
  // monthState/dispatchedCount 仍取自 appraisal-summary（非 APPROVED 月份置灰、灰柱高度）。
  const monthlyStackedData = computed(() => {
    if (!isDrillDown.value || !drilledDept.value) {
      return []
    }

    // 显示1月到选中的月份
    const months: number[] = []
    for (let m = 1; m <= selectedMonth.value; m++) {
      months.push(m)
    }

    const indexByMonth = deptStatsIndexByMonth.value
    const drilledDeptId = orgStore.functionalDepartments.find(
      item => item.name === drilledDept.value
    )?.id

    return months.map(month => {
      const stats = lookupDeptStats(
        indexByMonth.get(month) ?? indexDeptStats([], null),
        drilledDeptId,
        drilledDept.value
      )
      // 行级鉴定明细聚合（部门自身口径）：同指标多轮上报后端已去重
      const levels = drillLevelsOfMonth(month)
      const ahead = levels.filter(i => i.level === 'AHEAD').length
      const normal = levels.filter(i => i.level === 'NORMAL').length
      const delayed = levels.filter(i => i.level === 'DELAYED').length
      return {
        name: `${month}月`,
        month,
        ahead,
        normal,
        delayed,
        warning: 0,
        total: ahead + normal + delayed,
        monthState: stats.monthState,
        dispatchedCount: stats.dispatchedCount
      }
    })
  })

  // 下钻后选中月份的指标列表（2026-11-27 鉴定口径：行状态 = 行级鉴定明细的
  // COALESCE(appraisal_level, self_rating)，与同页趋势/聚合同源；
  // 数据库预警快照降级为辅助标记 alertHint，不再决定行状态）
  const monthIndicators = computed(() => {
    if (!isDrillDown.value || !drilledDept.value || selectedMonthInDrillDown.value === null) {
      return []
    }

    const strategicStore = useStrategicStore()
    const timeContext = useTimeContextStore()
    const currentYear = timeContext.currentYear
    const realYear = timeContext.realCurrentYear

    const indicatorByIndicatorId = new Map<string, Indicator>()
    strategicStore.indicators.forEach(i => {
      const id = getIndicatorIdentity(i)
      if (id !== null) {
        indicatorByIndicatorId.set(String(id), i)
      }
    })

    return drillLevelsOfMonth(selectedMonthInDrillDown.value).map(item => {
      const indicatorId = String(item.indicatorId)
      const base = indicatorByIndicatorId.get(indicatorId)
      const indicatorYear = base ? resolveIndicatorYear(base, realYear) : currentYear
      const matched = base && indicatorYear === currentYear ? base : undefined
      return {
        ...(matched ?? ({} as Indicator)),
        id: matched?.id ?? indicatorId,
        name: matched?.name ?? item.indicatorName ?? `指标 #${indicatorId}`,
        status: levelToIndicatorStatus(item.level),
        targetProgress: null,
        // 辅助标记：数据库仍有未关闭预警时在状态 tag 旁提示（不改变鉴定口径）
        alertHint: getDatabaseAlertStatus(matched ?? { indicatorId })
      }
    })
  })

  // 月份指标筛选后的列表（三档口径：选「滞后」时包含原预警状态）
  const filteredMonthIndicators = computed(() => {
    if (!selectedStatusFilter.value) {
      return monthIndicators.value
    }
    return monthIndicators.value.filter(i =>
      selectedStatusFilter.value === 'delayed'
        ? i.status === 'delayed' || i.status === 'warning'
        : i.status === selectedStatusFilter.value
    )
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

  // 学院看板堆叠数据（第一层：学院视图）
  // 2026-10-31 新口径：数据来自 college-levels 接口（未填报学院接口不返回 → 整列不画）
  const collegeBarData = computed(() => {
    if (isCollegeDrillDown.value) {
      return []
    }
    if (currentRole.value === 'secondary_college') {
      return []
    }
    return toCollegeBarRows(collegeLevels.value)
  })

  // 学院看板月度趋势数据（第二层：学院月度视图）
  // 2026-10-31 新口径：数据来自 college-levels-trend 接口，x 轴只画接口返回的月份
  const collegeMonthlyStackedData = computed(() => {
    if (!isCollegeDrillDown.value || !drilledCollege.value) {
      return []
    }
    return toCollegeTrendRows(collegeTrendMonths.value, drilledCollege.value)
  })

  // 学院下钻后的月份指标列表（2026-11-27 鉴定口径：行状态 = 行级鉴定明细的
  // COALESCE(appraisal_level, self_rating) 三档映射，与部门下钻面板同源同款；
  // 数据库预警快照降级为辅助标记 alertHint，不再决定行状态。
  // 职能部门视角保留既有「只看自己下发」的本地口径——indicator-levels 端点对
  // 职能角色查他组织返回 403，不发该请求）
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

    // 职能部门视角：本地过滤当年本部门下发、责任单位=被下钻学院的指标
    if (currentRole.value === 'functional_dept') {
      const ownerDept = currentDepartment.value
      return strategicStore.indicators
        .filter(i => {
          const indicatorYear = resolveIndicatorYear(i, realYear)
          return (
            indicatorYear === currentYear &&
            i.responsibleDept === drilledCollege.value &&
            i.ownerDept === ownerDept
          )
        })
        .map(i => ({
          ...i,
          status: getIndicatorStatus(i),
          targetProgress: getCurrentTargetProgress(i)
        }))
    }

    const indicatorByIndicatorId = new Map<string, Indicator>()
    strategicStore.indicators.forEach(i => {
      const id = getIndicatorIdentity(i)
      if (id !== null) {
        indicatorByIndicatorId.set(String(id), i)
      }
    })

    return collegeDrillLevelsOfMonth(selectedMonthInCollegeDrillDown.value).map(item => {
      const indicatorId = String(item.indicatorId)
      const base = indicatorByIndicatorId.get(indicatorId)
      const indicatorYear = base ? resolveIndicatorYear(base, realYear) : currentYear
      const matched = base && indicatorYear === currentYear ? base : undefined
      return {
        ...(matched ?? ({} as Indicator)),
        id: matched?.id ?? indicatorId,
        name: matched?.name ?? item.indicatorName ?? `指标 #${indicatorId}`,
        status: levelToIndicatorStatus(item.level),
        targetProgress: null,
        // 辅助标记：数据库仍有未关闭预警时在状态 tag 旁提示（不改变鉴定口径）
        alertHint: getDatabaseAlertStatus(matched ?? { indicatorId })
      }
    })
  })

  // 学院月份指标筛选后的列表
  const filteredCollegeMonthIndicators = computed(() => {
    if (!selectedStatusFilter.value) {
      return collegeMonthIndicators.value
    }
    // 三档口径：选「滞后」时包含原预警状态
    return collegeMonthIndicators.value.filter(i =>
      selectedStatusFilter.value === 'delayed'
        ? i.status === 'delayed' || i.status === 'warning'
        : i.status === selectedStatusFilter.value
    )
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

  // 排名月份对应的学院等级（来自 college-levels-trend 的同源数据，切月无需重新请求）
  const collegeRankingLevels = computed<DashboardCollegeLevelStat[]>(() => {
    const match = collegeTrendMonths.value.find(m => m.month === collegeRankingMonth.value)
    return match ? match.colleges : []
  })

  // 分院排名（2026-10-31 新口径：基于上级鉴定等级重排）
  // 分数 = 完成率 = (超前 + 正常) / 总计 × 100；接口无来源部门维度，不再按 ownerDept 过滤
  const getCollegeRankingData = computed(() => {
    if (currentRole.value === 'secondary_college') {
      return []
    }
    return toCollegeRankingRows(collegeRankingLevels.value)
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
  // 学院等级数据加载（2026-10-31 新口径：college-levels 系列接口，失败不造假数据）
  // ============================================================================

  /** 加载当前选中月份的学院等级（月份切换 / 挂载 / 切年时触发重新请求） */
  const loadCollegeLevels = async () => {
    const isCurrentScope = captureMonthScope()
    collegeLevelsLoading.value = true
    try {
      const response = await dashboardApi.getCollegeLevels({
        year: timeContext.currentYear,
        month: selectedMonth.value
      })
      // 2026-11-25：请求返回前月份可能已变（auto-jump / 快速切月），
      // 过期响应直接丢弃，避免旧月份数据覆盖当前月份、造成统计口径错位。
      if (!isCurrentScope()) {
        return
      }
      collegeLevels.value = response.colleges
    } catch (error) {
      // 口径已变：失败的是旧月份的请求，数据与提示交给新月份的请求
      if (!isCurrentScope()) {
        return
      }
      // 接口失败：清空数据走空态 + 既有错误提示，不静默回退本地计算
      collegeLevels.value = []
      logger.error('[Dashboard] Failed to load college levels:', error)
      ElMessage.error(
        error instanceof Error && error.message
          ? `学院等级数据加载失败：${error.message}`
          : '学院等级数据加载失败，请稍后重试'
      )
    } finally {
      // 口径已变说明新月份的请求在途，loading 交给它收尾
      if (isCurrentScope()) {
        collegeLevelsLoading.value = false
      }
    }
  }

  /** 加载年度学院等级趋势（挂载 / 切年时请求；趋势与分院排名共用同源数据） */
  const loadCollegeLevelsTrend = async () => {
    collegeTrendLoading.value = true
    try {
      const response = await dashboardApi.getCollegeLevelsTrend({ year: timeContext.currentYear })
      collegeTrendMonths.value = response.months
    } catch (error) {
      collegeTrendMonths.value = []
      logger.error('[Dashboard] Failed to load college levels trend:', error)
      ElMessage.error(
        error instanceof Error && error.message
          ? `学院等级趋势加载失败：${error.message}`
          : '学院等级趋势加载失败，请稍后重试'
      )
    } finally {
      collegeTrendLoading.value = false
    }
  }

  // 学院图表空态（当月无数据 / 趋势无数据时展示占位文案，不造假柱）
  const collegeChartHasData = computed(() => {
    const data = isCollegeDrillDown.value ? collegeMonthlyStackedData.value : collegeBarData.value
    return data.length > 0
  })
  const collegeChartEmptyText = computed(() =>
    isCollegeDrillDown.value ? '该学院暂无月度趋势数据' : '该月暂无学院上报数据'
  )
  const collegeRankingHasData = computed(() => getCollegeRankingData.value.length > 0)

  // 部门分布图空态（2026-11-18 PR #127 评审意见 A）：鉴定汇总接口失败/无数据时
  // 展示占位文案（配合 loadAppraisalSummary 的错误提示），不再画启发式柱
  const benchmarkChartHasData = computed(() =>
    isDrillDown.value ? monthlyStackedData.value.length > 0 : stackedBarData.value.length > 0
  )
  const benchmarkChartEmptyText = computed(() =>
    isDrillDown.value ? '该部门暂无月度趋势数据' : '该月暂无部门鉴定数据（接口不可用或后端无数据）'
  )

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
  // silent=true（2026-10-07 异步局部刷新）：事件驱动/定时兜底刷新走后台静默，
  // 强制绕过缓存取新数据，但不翻转页面加载状态——看板不再整页铺骨架屏。
  const reloadData = async (options: { silent?: boolean } = {}) => {
    const silent = options.silent === true
    if (!silent) {
      startLoading()
    }
    clearError()
    try {
      await Promise.all([
        silent
          ? strategicStore.loadIndicatorsByYear(timeContext.currentYear, {
              force: true,
              background: true
            })
          : strategicStore.loadIndicatorsByYear(timeContext.currentYear),
        dashboardStore.fetchAlertStats(),
        dashboardStore.fetchUnclosedAlerts()
      ])
    } catch (err) {
      logger.error('[Dashboard] Failed to reload data:', err)
      if (!silent) {
        setError(err instanceof Error ? err.message : '重新加载失败')
      }
    } finally {
      if (!silent) {
        endLoading()
      }
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

  // 职能部门自身口径合计（2026-11-27 简报口径）：只算部门分布图实际画出的职能部门行
  // （orgStore.functionalDepartments 逐个查鉴定汇总），与分布图同一份数据、同一套查找。
  // 仅全校视角（战略部 / 系统管理员）并入总览；其他视角恒为空合计，口径不变。
  const functionalDeptOwnAggregate = computed<DeptOwnLevelAggregate>(() => {
    if (currentRole.value !== 'strategic_dept') {
      return emptyDeptOwnAggregate()
    }
    const statsIndex = currentDeptStatsIndex.value
    return aggregateDeptOwnLevels(
      orgStore.functionalDepartments
        .filter(item => Boolean(item.name))
        .map(item => lookupDeptStats(statsIndex, item.id, item.name))
    )
  })

  // 总览合计（2026-11-27 简报口径）：学院等级 + 职能部门自身。
  // 全校视角原只合计 7 个学院（344 项），漏掉 21 个职能部门自身的 217 项；
  // 简报 / 完成情况卡 / 进度等级分布三处都从这里取数，不会一处变了两处没变。
  // 完成率分母仍是已下发指标总数（2026-11-17 口径：未填报的计入分母、不计入完成）。
  const overviewAggregate = computed<DashboardOverviewAggregate>(() =>
    mergeLevelAggregates(
      aggregateCollegeLevels(collegeLevels.value),
      functionalDeptOwnAggregate.value
    )
  )

  // 总览统计（2026-11-17 新口径）：等级分布 / 完成率改由 college-levels 接口供数
  // （只算已提交/已审批月报 + 鉴定三档；alert_event/manualAlertSeverity 退出统计；
  // 完成率分母改为已下发指标总数——未填报学院不再把分母悄悄变小虚高完成率）
  const dashboardData = computed<DashboardData>(() => {
    const overview = overviewAggregate.value

    return {
      totalScore: 0,
      basicScore: 0,
      developmentScore: 0,
      levelDistribution: {
        ahead: overview.ahead,
        normal: overview.normal,
        delayed: overview.delayed
      },
      completionRate: overview.completionRate,
      warningCount: overview.delayed,
      totalIndicators: overview.dispatchedTotal,
      completedIndicators: overview.completed,
      alertIndicators: {
        severe: overview.delayed,
        moderate: 0,
        normal: overview.completed
      }
    }
  })

  // 督办统计（2026-11-17 新口径）：任务完成简报 / 未填报学院提示供数
  // （2026-11-27：三档 / 已下发 / 完成率改取 overviewAggregate，与完成情况卡、等级分布同源；
  // 未填报学院提示仍只看学院行）
  const collegeSupervision = computed(() => {
    const overview = overviewAggregate.value
    return {
      ahead: overview.ahead,
      normal: overview.normal,
      delayed: overview.delayed,
      dispatchedTotal: overview.dispatchedTotal,
      appraisedTotal: overview.appraisedTotal,
      completionRate: overview.completionRate,
      unreportedColleges: aggregateCollegeLevels(collegeLevels.value).unreportedColleges,
      unreportedNames: collegeLevels.value
        .filter(college => college.reported === false)
        .map(college => college.orgName)
    }
  })

  // 学院视角「指标承接汇总」行数据（2026-11-27 用户拍板改造）：
  // 数据源 = 任务 1 的本院 appraisal-summary（学院角色后端已分流：departments 只含本院归口部门），
  // 行展示 =「N 项指标 + 等级占比（正常×26 滞后×1 格式）」；职能部门/战略部视角卡片保留现状
  const collegeIndicatorSummary = computed(() => appraisalSummary.value?.departments ?? [])

  // 任务完成简报空态判定（2026-11-18 折中方案，PR #131 采纳内核）：
  // 选中月快照无 APPROVED 鉴定内容时，简报正文替换为「当月简报尚未审定」空态文案
  // （2026-11-18 措辞微调：原「本月尚未审定」与未填报督办句连排两个「本月」开头重复），
  // 只保留「已下发 n」（永远真实）与未填报督办提示。
  // 判定口径（按数据结构取最稳）：
  // ① collegeLevels 为空（当月无任何学院数据）→ 空态；
  // ② 所有行 resolveMonthState != APPROVED（整月未填报/审批中）→ 空态；
  // ③ 兼容旧响应（无 monthState 字段）：鉴定三档全 0 且无未填报督办 → 无审定内容，空态。
  const briefMonthApproved = computed(() => {
    const rows = collegeLevels.value
    // 2026-11-27（简报口径）：全校视角下职能部门自身已出鉴定同样算审定月——
    // 学院线整月未审定、部门线已鉴定时，简报若仍判「尚未审定」就会和完成情况卡对不上
    if (functionalDeptOwnAggregate.value.total > 0) {
      return true
    }
    if (rows.length === 0) {
      return false
    }
    if (!rows.some(row => resolveMonthState(row) === 'APPROVED')) {
      return false
    }
    const aggregate = aggregateCollegeLevels(rows)
    return (
      aggregate.ahead + aggregate.normal + aggregate.delayed > 0 || aggregate.unreportedColleges > 0
    )
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

  // 2026-11-27（#3d）：「进度等级分布」卡改纯展示，点击筛选交互（handleAlertClick）移除

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

  // 综合报表导出（2026-10-29 用户定案）：一个 Excel、五个 Sheet——
  // 总览 / 各部门进度 / 各学院进度 / 滞后任务清单 / 附件索引。
  // 数据全部来自看板既有 store，不新增后端接口。
  const exporting = ref(false)
  const exportComprehensiveReport = async () => {
    const indicators =
      dashboardStore.visibleIndicators.length > 0
        ? dashboardStore.visibleIndicators
        : strategicStore.indicators
    if (indicators.length === 0) {
      ElMessage.warning('没有可导出的数据')
      return
    }
    exporting.value = true
    try {
      // 2026-11-17 新口径：滞后清单接月报鉴定真实源（progress 恒 0，旧判定已死）
      const report = buildComprehensiveReport(indicators, delayedTaskItems.value)
      const dateTag = formatLocalDateTag()
      // 列定义统一走 getValue（ExcelExportSheet 的规范），值取行对象的同名字段
      const col = <T extends Record<string, unknown>>(
        header: string,
        width: number,
        align: 'left' | 'center' | 'right' = 'left'
      ) => ({
        header,
        width,
        align,
        getValue: (row: T) => ({ value: row[header] ?? '-' })
      })

      const sheets: ExcelExportSheet<Record<string, unknown>>[] = [
        {
          sheetName: '总览',
          rows: report.overview as unknown as Array<Record<string, unknown>>,
          columns: [
            col('指标总数', 12, 'center'),
            col('已完成', 12, 'center'),
            col('进行中', 12, 'center'),
            col('滞后预警', 12, 'center'),
            col('平均进度', 12, 'center'),
            col('附件覆盖率', 14, 'center')
          ],
          emptyMessage: '暂无数据'
        },
        {
          // 2026-11-17 用户拍板：等级制填报后 indicator.progress 恒 0，进度列是死数据——
          // 两个单位 Sheet 改出鉴定等级分布（COALESCE(appraisal_level, self_rating)，
          // 见 comprehensiveReport.ts），列名/口径与全局「滞后」文案统一。
          // Sheet 名保守沿用原名（改动最小），列头已是等级语义。
          sheetName: '各部门进度',
          rows: report.departments as unknown as Array<Record<string, unknown>>,
          columns: [
            col('排名', 8, 'center'),
            col('单位', 22),
            col('类型', 12, 'center'),
            col('指标总数', 10, 'center'),
            // 冲突融合说明：HEAD 侧四列（已完成/进行中/滞后预警/状态）是被本次
            // 等级重写退役的旧进度列（对方分支仅做了延期预警→滞后预警改名），
            // 取等级重写侧；滞后清单 Sheet 的真实源列（上方）为对方新增，保留。
            col('超前完成', 10, 'center'),
            col('正常', 10, 'center'),
            col('滞后', 10, 'center'),
            col('未评定', 10, 'center')
          ],
          emptyMessage: '暂无部门数据'
        },
        {
          sheetName: '各学院进度',
          rows: report.colleges as unknown as Array<Record<string, unknown>>,
          columns: [
            col('排名', 8, 'center'),
            col('单位', 22),
            col('类型', 12, 'center'),
            col('指标总数', 10, 'center'),
            // 同上：等级分布列（等级重写），旧进度列退役
            col('超前完成', 10, 'center'),
            col('正常', 10, 'center'),
            col('滞后', 10, 'center'),
            col('未评定', 10, 'center')
          ],
          emptyMessage: '暂无学院数据'
        },
        {
          sheetName: '滞后任务清单',
          rows: report.lagging as unknown as Array<Record<string, unknown>>,
          columns: [
            col('序号', 8, 'center'),
            col('指标内容', 40),
            col('所属学院', 20),
            col('来源部门', 20),
            col('自评等级', 12, 'center'),
            col('鉴定等级', 12, 'center')
          ],
          emptyMessage: '没有滞后任务'
        },
        {
          sheetName: '附件索引',
          rows: report.attachments as unknown as Array<Record<string, unknown>>,
          columns: [
            col('序号', 8, 'center'),
            col('指标内容', 40),
            col('所属单位', 20),
            col('文件名', 40)
          ],
          emptyMessage: '暂无附件'
        }
      ]
      const blob = await buildExcelBlob(sheets)
      saveBlobAsFile(blob, sanitizeFileName(`SISM综合报表_${dateTag}.xlsx`))
      ElMessage.success('综合报表已导出（含总览/部门/学院/滞后/附件 5 个页签）')
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : '综合报表导出失败')
    } finally {
      exporting.value = false
    }
  }

  // 导出功能 - 根据角色差异化导出
  const handleExport = async () => {
    try {
      const role = authStore.user?.role
      let exportData: Record<string, string | number>[]
      let pageName: string
      let scopeName: string | undefined
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
          滞后数: item.alertCount,
          状态: item.status === 'success' ? '优秀' : item.status === 'warning' ? '良好' : '需改进'
        }))

        pageName = '职能部门进度对比报表'
        scopeName = undefined
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
          审批状态:
            item.approvalStatus === 'approved'
              ? '已通过'
              : item.approvalStatus === 'pending'
                ? '待审批'
                : item.approvalStatus === 'rejected'
                  ? '已回退'
                  : '草稿',
          备注: item.description || ''
        }))

        pageName = '学院任务分配表'
        scopeName = authStore.user?.department
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
          // 2026-11-25（看板来源归属修复）：任务来源按归口职能部门（父级核心指标
          // targetOrg），ownerDept（战略部代发）仅作兜底——与「任务来源分布」饼图同键
          任务来源: resolveTaskSourceDept(item, dashboardStore.parentIndicatorMap),
          战略任务: item.task,
          核心指标: item.indicator,
          指标类型: item.type,
          指标类别: item.type2,
          权重: item.weight,
          完成进度: `${item.progress}%`,
          审批状态:
            item.approvalStatus === 'approved'
              ? '已通过'
              : item.approvalStatus === 'pending'
                ? '待审批'
                : item.approvalStatus === 'rejected'
                  ? '已回退'
                  : '草稿',
          备注: item.description || ''
        }))

        pageName = '承接任务汇总'
        scopeName = authStore.user?.department
        sheetName = '承接任务'
      }

      // 2026-10-28：仪表盘导出统一走共享导出层——样式、文件名规则与其他页面一致
      const columns: ExcelExportColumn<Record<string, string | number>>[] = Object.keys(
        exportData[0] || {}
      ).map(key => ({
        header: key,
        width: Math.max(key.length + 2, ...exportData.map(row => String(row[key] ?? '').length)),
        getValue: row => row[key]
      }))

      await exportRowsToExcel(
        { sheetName, rows: exportData, columns },
        buildExportFileName(pageName, scopeName)
      )

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

  // A5 点行下钻：选中部门视图中的指标行，弹出完整详情卡（复用 popover 数据，不新增接口）
  const selectedIndicatorDetail = ref<{
    dashboard: (typeof filteredDeptIndicators.value)[number]
  } | null>(null)

  const handleIndicatorRowClick = (indicator: {
    id?: string | number
    name?: string
    responsibleDept?: string
  }) => {
    const pool = [
      ...filteredDeptIndicators.value,
      ...filteredMonthIndicators.value,
      ...filteredCollegeMonthIndicators.value
    ]
    const match = pool.find(item => String(item.id) === String(indicator.id)) as
      | (typeof filteredDeptIndicators.value)[number]
      | undefined
    if (!match) {
      return
    }

    // P4 点行下钻：行所属部门与当前下钻部门不同且属于可下钻层级时，驱动层级切换
    const rowDept = String(
      (match as { responsibleDept?: string }).responsibleDept ??
        (match as { department?: string }).department ??
        ''
    )
    const currentDrilled = String(drilledDept.value || '')
    if (rowDept && rowDept !== currentDrilled && rowDept !== props.departmentName) {
      const isCollege =
        String((match as { targetOrgType?: string }).targetOrgType ?? '').toLowerCase() ===
          'academic' || rowDept.includes('学院')
      try {
        dashboardStore.drillDownToDepartment(rowDept, isCollege ? 'college' : 'functional')
        return
      } catch {
        // 下钻失败则退回详情抽屉
      }
    }

    selectedIndicatorDetail.value = { dashboard: match }
  }

  const handleCloseIndicatorDetail = () => {
    selectedIndicatorDetail.value = null
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
        label: '滞后任务',
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

  // ============ 滞后任务响应清单（2026-11-17 新口径：月报鉴定 DELAYED 真实源）============
  // 旧判定 progress<50 已死：等级制填报后 indicator.progress 恒 0，所有指标都会被误判滞后。
  // 现由后端 /dashboard/delayed-indicators 供数（只算已提交/已审批月报、
  // appraisal_level 优先 self_rating 兜底、按指标 ID 去重），催办链路复用原接口。
  const delayedTasksLoading = ref(false)
  const delayedTaskItems = ref<DashboardDelayedIndicatorItem[]>([])
  const DELAYED_TASKS_LIMIT = 5

  const loadDelayedTasks = async () => {
    const isCurrentScope = captureMonthScope()
    delayedTasksLoading.value = true
    try {
      const response = await dashboardApi.getDelayedIndicators({
        year: timeContext.currentYear,
        // 2026-11-18 修复：与分布图同源（selectedMonth），原取学院卡月份 collegeSelectedMonth，
        // 两处月份不一致导致「分布图已切到 11 月、滞后清单却按 10 月查询而显示 No Data」
        month: selectedMonth.value
      })
      // 2026-11-27（切月等价）：补上与学院等级 / 鉴定汇总同款的过期响应保护——
      // 快速切月时先发出的旧月份请求若后返回，会把新月份的滞后清单覆盖掉。
      if (!isCurrentScope()) {
        return
      }
      delayedTaskItems.value = response.items
    } catch (error) {
      // 口径已变：失败的是旧月份的请求，数据交给新月份的请求
      if (!isCurrentScope()) {
        return
      }
      // 接口失败：清空走空态，不打断看板（学院等级加载失败已有独立提示）
      delayedTaskItems.value = []
      logger.error('[Dashboard] Failed to load delayed indicators:', error)
    } finally {
      // 口径已变说明新月份的请求在途，loading 交给它收尾
      if (isCurrentScope()) {
        delayedTasksLoading.value = false
      }
    }
  }

  const loadReminderStatuses = async () => {
    const indicatorIds = delayedTaskItems.value
      .slice(0, DELAYED_TASKS_LIMIT)
      .map(item => Number(item.indicatorId))
      .filter(Number.isFinite)
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
    () =>
      delayedTaskItems.value
        .slice(0, DELAYED_TASKS_LIMIT)
        .map(item => item.indicatorId)
        .join(','),
    () => {
      void loadReminderStatuses()
    },
    { immediate: true }
  )

  // 滞后任务列表（TOP N，催办所需字段与旧结构对齐）
  const delayedTasks = computed(() => {
    return delayedTaskItems.value.slice(0, DELAYED_TASKS_LIMIT).map(item => {
      const status = reminderStatuses.value[item.indicatorId]
      const reminded = Boolean(status?.lastRemindedAt) && !(status?.canRemind ?? true)

      return {
        id: item.indicatorId,
        name: item.indicatorName || `指标#${item.indicatorId}`,
        dept: item.orgName,
        ownerDept: item.ownerOrgName || '',
        levelText: '滞后',
        selfRating: item.selfRating,
        appraisalLevel: item.appraisalLevel,
        reminded,
        canRemind: status?.canRemind ?? true,
        reminding: Boolean(remindingMap.value[item.indicatorId]),
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

          // 2026-11-18 按月快照口径：非 APPROVED 月份只出置灰说明，不出鉴定数
          if (dataItem && isGrayMonth(dataItem.monthState)) {
            tooltip += `<span style="color: #909399; font-weight: bold;">■ ${monthStateDeptTooltip(dataItem.monthState)}</span><br/>`
            if ((dataItem.dispatchedCount || 0) > 0) {
              tooltip += `已下发: ${dataItem.dispatchedCount} 项<br/>`
            }
            if (!isDrillDown.value) {
              tooltip += `<span style="color: #409eff; font-size: 11px;">点击查看月度趋势</span>`
            }
            return tooltip
          }

          if (isDrillDown.value) {
            // 月度视图显示该月的统计（#15 修复：月份名已在标题行，不再重复一行）
            tooltip += `<span style="color: ${statusColors.ahead}">●</span> 超前: ${dataItem?.ahead || 0}<br/>`
            tooltip += `<span style="color: ${statusColors.normal}">●</span> 正常: ${dataItem?.normal || 0}<br/>`
            tooltip += `<span style="color: ${statusColors.delayed}">●</span> 滞后: ${(dataItem?.warning || 0) + (dataItem?.delayed || 0)}<br/>`
            tooltip += `总计: ${dataItem?.total || 0}`
          } else {
            // 部门视图显示统计（月份已在卡片副标题渲染，tooltip 不重复）
            tooltip += `<span style="color: ${statusColors.ahead}">■</span> 超前: ${dataItem?.ahead || 0}<br/>`
            tooltip += `<span style="color: ${statusColors.normal}">■</span> 正常: ${dataItem?.normal || 0}<br/>`
            tooltip += `<span style="color: ${statusColors.delayed}">■</span> 滞后: ${(dataItem?.warning || 0) + (dataItem?.delayed || 0)}<br/>`
            tooltip += `总计: ${dataItem?.total || 0}<br/>`
            tooltip += `<span style="color: #409eff; font-size: 11px;">点击查看月度趋势</span>`
          }
          return tooltip
        }
      },
      legend: {
        data: ['超前完成', '正常', '滞后', '未出鉴定'],
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
          // 按月快照口径：只有 APPROVED 月份出鉴定值
          data: data.map(d => (isGrayMonth(d.monthState) ? 0 : d.ahead || 0))
        },
        {
          name: '正常',
          type: 'bar',
          stack: 'total',
          barWidth: isDrillDown.value ? 40 : 30,
          itemStyle: {
            color: statusColors.normal
          },
          data: data.map(d => (isGrayMonth(d.monthState) ? 0 : d.normal || 0))
        },
        {
          // 三档口径：原「预警」桶并入「滞后」展示
          name: '滞后',
          type: 'bar',
          stack: 'total',
          barWidth: isDrillDown.value ? 40 : 30,
          itemStyle: {
            color: statusColors.delayed,
            borderRadius: isDrillDown.value ? [0, 0, 0, 0] : [0, 4, 4, 0]
          },
          data: data.map(d => (isGrayMonth(d.monthState) ? 0 : (d.warning || 0) + (d.delayed || 0)))
        },
        {
          // 2026-11-18 按月快照口径：非 APPROVED 月份置灰柱（#C0C4CC，与学院图同色系），
          // 柱高=已下发数（后端未给 dispatchedCount 时不出高度，tooltip 仍说明状态）
          name: '未出鉴定',
          type: 'bar',
          stack: 'total',
          barWidth: isDrillDown.value ? 40 : 30,
          itemStyle: {
            color: MONTH_GRAY_COLOR,
            borderRadius: isDrillDown.value ? [0, 0, 0, 0] : [0, 4, 4, 0]
          },
          data: data.map(d => (isGrayMonth(d.monthState) ? d.dispatchedCount || 0 : 0))
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
    // 下钻进入部门时拉取该部门全年行级鉴定明细（明细面板与下钻趋势的等级数据源）
    if (isDrillDown.value) {
      void loadDrillIndicatorLevels()
    }
  })

  // 行级鉴定明细到达后重绘下钻趋势（首屏图表与数据并行加载）
  watch(drillIndicatorLevels, () => {
    if (isDrillDown.value) {
      nextTick(() => {
        initBenchmarkChart()
      })
    }
  })

  // 2026-11-18：分布图与滞后清单同源跟随 selectedMonth 重新取数
  // （原滞后清单跟的是 collegeSelectedMonth，两处月份不同步）
  // 2026-11-27（切月等价）：部门卡 / 学院卡 / 排名卡三个月份下拉写的是同一个 selectedMonth，
  // 切月后的数据重拉统一收敛到这里，三个接口各请求一次：
  //   学院等级 = 简报 / 完成情况卡 / 进度等级分布 / 学院图 / 排名图的同一数据源；
  //   鉴定汇总 = 部门分布图与下钻趋势；滞后清单 = TOP 滞后任务卡。
  // 原先只有学院卡的 change handler 重拉学院等级，从部门卡 / 排名卡切月后
  // 简报、完成情况、等级分布仍停在上个月；学院卡路径的滞后清单还被重复请求两次。
  // 现在 change handler 只收起下钻与重绘，不再发请求。
  watch(selectedMonth, () => {
    void loadCollegeLevels()
    void loadAppraisalSummary()
    void loadDelayedTasks()
  })

  // 鉴定汇总（异步）到达后重绘分布图：首屏图与数据是并行加载的，
  // 图可能先渲染出全 0，等数据回来必须再画一次
  watch(appraisalSummary, () => {
    nextTick(() => {
      initBenchmarkChart()
    })
  })

  // 监听年份变化：学院等级/滞后任务数据重新请求 + 重新渲染所有图表
  watch(
    () => timeContext.currentYear,
    () => {
      void loadCollegeLevels()
      void loadCollegeLevelsTrend()
      void loadDelayedTasks()
      void loadAppraisalSummary()
      void loadDrillIndicatorLevels()
      void loadCollegeDrillIndicatorLevels()
      nextTick(() => {
        initBenchmarkChart()
        initCollegeChart()
        initCollegeRankingChart()
      })
    }
  )

  // 监听学院等级数据到达，重新渲染学院图与分院排名图
  watch([collegeLevels, collegeTrendMonths], () => {
    nextTick(() => {
      initCollegeChart()
      initCollegeRankingChart()
    })
  })

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
    // 下钻进入学院时拉取该学院全年行级鉴定明细（明细面板的等级数据源）
    if (isCollegeDrillDown.value) {
      void loadCollegeDrillIndicatorLevels()
    }
  })

  // 监听分院排名月份变化（排名与趋势同源，切月无需重新请求）
  watch(collegeRankingMonth, () => {
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
          if (!dataItem) {
            return ''
          }
          const name = dataItem.fullName || dataItem.name || params[0].name

          // 2026-11-22 按线分段混色口径：单行四段计数（和 = 已下发数 = 柱高彩段+灰段），
          // 不提示未下发数；X=0 或无数据不出 tooltip（collegeTooltipCountsLine 返回 null）
          const countsLine = collegeTooltipCountsLine(dataItem)
          if (!countsLine) {
            return ''
          }

          let tooltip = `<strong>${name}</strong><br/>`
          // 2026-11-27：下钻态不再重复渲染「N月」行——悬浮的柱本身就是该月，卡片标题已含月份
          tooltip += countsLine
          if (!isCollegeDrillDown.value) {
            tooltip += `<br/><span style="color: #409eff; font-size: 11px;">点击查看月度趋势</span>`
          }
          return tooltip
        }
      },
      legend: {
        data: ['超前完成', '正常', '滞后', '未走完'],
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
          // 2026-11-22 按线分段混色：三档计数即「走完审批」的线数，直接出彩段，
          // 不再按 monthState 整柱置灰（一条线走完亮一段，其余保持灰）
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
          // 三档口径：滞后直接来自接口 delayed（月报鉴定，appraisal 优先 self 兜底）
          name: '滞后',
          type: 'bar',
          stack: 'total',
          barWidth: isCollegeDrillDown.value ? 40 : 30,
          itemStyle: {
            color: statusColors.delayed
          },
          // 按线分段混色：滞后上方可能叠灰段（灰彩并存），只有灰段为 0（全彩柱顶）才做右侧圆角
          data: data.map(d =>
            isCollegeDrillDown.value || collegeGraySegmentCount(d) > 0
              ? d.delayed || 0
              : {
                  value: d.delayed || 0,
                  itemStyle: { borderRadius: [0, 4, 4, 0] as [number, number, number, number] }
                }
          )
        },
        {
          // 2026-11-22 按线分段混色：灰段 = 已下发数 − (超前+正常+滞后) 合计，
          // 与彩段同柱并存；柱子总高 = 已下发指标总数
          name: '未走完',
          type: 'bar',
          stack: 'total',
          barWidth: isCollegeDrillDown.value ? 40 : 30,
          itemStyle: {
            color: MONTH_GRAY_COLOR,
            borderRadius: isCollegeDrillDown.value ? [0, 0, 0, 0] : [0, 4, 4, 0]
          },
          data: data.map(d => collegeGraySegmentCount(d))
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

  // 处理学院看板月份变化：只收起学院下钻 / 月份指标卡并重绘学院图。
  // 2026-11-27（切月等价）：切月后的数据重拉统一由 watch(selectedMonth) 发起（每个接口一次），
  // 本 handler 不再发请求——原先这里的学院等级 / 滞后清单与 watch 重复（滞后清单请求两次），
  // 而部门卡、排名卡路径又完全不重拉学院等级。
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
          // 2026-11-18 按月快照口径：非 APPROVED（未填报/审批中）灰条督办，
          // 既有 reported=false 逻辑并入 monthState 统一处理
          if (dataItem && isGrayMonth(dataItem.monthState)) {
            const reasonText =
              dataItem.monthState === 'IN_REVIEW'
                ? `本月上报审批中（灰条督办）<br/>已下发 ${dataItem.total || 0} 项，鉴定待审批通过后计入`
                : `未填报（灰条督办）<br/>已下发 ${dataItem.total || 0} 项，本月未提交月报`
            return `<strong>${fullName}</strong><br/>
                <span style="color: #909399; font-weight: bold;">${reasonText}</span><br/>
                <span style="color: #909399; font-size: 11px;">完成率按 0 分计，请督办</span>`
          }
          return `<strong>${fullName}</strong><br/>
                分数: ${item.value}<br/>
                完成: ${dataItem?.completed || 0}/${dataItem?.total || 0} 项<br/>
                <div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed #e4e7ed;">
                  <span style="color: #67c23a; margin-right: 8px;">超前 ${dataItem?.ahead || 0}</span>
                  <span style="color: #409eff; margin-right: 8px;">正常 ${dataItem?.normal || 0}</span>
                  <span style="color: #f56c6c;">滞后 ${dataItem?.delayed || 0}</span>
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
            color: (params: { dataIndex: number; value: number }) => {
              // 2026-11-18 按月快照口径：非 APPROVED 灰条督办，不参与分档配色
              const dataItem = data[params.dataIndex]
              if (dataItem && isGrayMonth(dataItem.monthState)) {
                return MONTH_GRAY_COLOR
              }
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
            formatter: (params: { dataIndex: number; value: number }) => {
              const dataItem = data[params.dataIndex]
              return dataItem && isGrayMonth(dataItem.monthState)
                ? monthStateGrayLabel(dataItem.monthState)
                : `${params.value}`
            },
            fontSize: 12,
            color: '#606266'
          },
          data: data.map(d => d.value)
        }
      ]
    })
  }

  // 处理分院排名月份变化（排名与趋势同源，切月仅重绘；数据重拉统一见 watch(selectedMonth)）
  const handleCollegeRankingMonthChange = () => {
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
      await Promise.all([dashboardStore.fetchAlertStats(), dashboardStore.fetchUnclosedAlerts()])
    } catch (err) {
      logger.error('[Dashboard] Initial load failed:', err)
    }

    // 学院等级/滞后任务数据（新口径）：与指标加载并行，不阻塞首屏图表
    void loadCollegeLevels()
    void loadCollegeLevelsTrend()
    void loadDelayedTasks()
    void loadAppraisalSummary()
    // 2026-11-27：指标异动汇总首屏就取数（原只在 5 分钟兜底刷新里取，首屏 5 分钟内恒为空）
    void loadMutationSummary()

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
    stopDashboardAutoRefresh()
  })

  // 5 分钟定时兜底（2026-09-19 用户拍板恢复）：PR #65 改为 WS 事件驱动后，
  // 若 WS 断开/漏推，数据将停留在旧状态——本定时器作为断连场景的兜底刷新，
  // 页面不可见时跳过，卸载时清理。
  const DASHBOARD_AUTO_REFRESH_INTERVAL = 5 * 60 * 1000
  let dashboardAutoRefreshTimer: number | null = null

  const startDashboardAutoRefresh = () => {
    stopDashboardAutoRefresh()
    dashboardAutoRefreshTimer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return
      }
      void reloadData({ silent: true })
      // 2026-11-17 新口径：学院等级/趋势/滞后清单与指标同拍兜底刷新，
      // 否则审批终态后看板分布与简报会停在旧数据（领导②③根因之一）
      void loadCollegeLevels()
      void loadCollegeLevelsTrend()
      void loadDelayedTasks()
      void loadAppraisalSummary()
      void loadMutationSummary()
      // 2026-11-27：下钻态的行级鉴定明细同拍兜底刷新（下钻趋势与明细面板的等级数据源，
      // 不在下钻态时各自直接返回），否则审批终态后下钻趋势与明细仍停在旧数据
      void loadDrillIndicatorLevels()
      void loadCollegeDrillIndicatorLevels()
    }, DASHBOARD_AUTO_REFRESH_INTERVAL)
  }

  const stopDashboardAutoRefresh = () => {
    if (dashboardAutoRefreshTimer !== null) {
      window.clearInterval(dashboardAutoRefreshTimer)
      dashboardAutoRefreshTimer = null
    }
  }

  onMounted(() => {
    startDashboardAutoRefresh()
  })

  const handleGlobalDataRefreshRequest = (event: Event) => {
    if (globalDataRefreshPromise) {
      return
    }

    const detail = (event as CustomEvent<GlobalDataRefreshDetail>).detail
    // 2026-09-27 细粒度异步刷新：看板仅响应 dashboard 域（审批终态/指标变更），
    // 流程中间环节的通知不再触发看板全量重载；窗口聚焦/可见性兜底不受影响
    if (!shouldRefreshForDomains(detail, ['dashboard'])) {
      return
    }
    globalDataRefreshPromise = (async () => {
      logger.info('[DashboardView] handling global data refresh request', detail)
      // 事件驱动刷新一律后台静默：数据就地更新，不打断当前浏览（2026-10-07）
      await reloadData({ silent: true })
      // 2026-11-17 新口径：审批终态（dashboard 域事件）后学院等级/趋势/滞后清单必须重拉，
      // 否则看板学院分布图、月度趋势、任务完成简报全部停在审核前旧数据（领导催办①③根因）
      await Promise.allSettled([
        loadCollegeLevels(),
        loadCollegeLevelsTrend(),
        loadDelayedTasks(),
        loadAppraisalSummary(),
        // 2026-11-27：下钻态的行级鉴定明细随审批终态一起重拉（不在下钻态时各自直接返回）
        loadDrillIndicatorLevels(),
        loadCollegeDrillIndicatorLevels()
      ])
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
    appraisalSummary,
    appraisalSummaryLoading,
    collegeIndicatorSummary,
    authStore,
    benchmarkChartRef,
    benchmarkSectionRef,
    benchmarkData,
    benchmarkChartHasData,
    benchmarkChartEmptyText,
    briefMonthApproved,
    canViewAllDepartments,
    collegeBarData,
    collegeChartHasData,
    collegeChartEmptyText,
    collegeChartRef,
    collegeLevelsLoading,
    collegeTrendLoading,
    collegeMonthIndicatorStats,
    collegeMonthIndicators,
    collegeMonthlyStackedData,
    collegeRankingChartRef,
    collegeRankingHasData,
    collegeRankingMonth,
    collegeSelectedMonth,
    collegeSupervision,
    createChartInstance,
    currentDepartment,
    currentRole,
    dashboardData,
    dashboardStore,
    delayedTasks,
    delayedTasksLoading,
    drilledCollege,
    drilledDept,
    filterForm,
    filteredCollegeMonthIndicators,
    filteredDeptIndicators,
    filteredMonthIndicators,
    getCollegeRankingData,
    getCurrentTargetProgress,
    loadAppraisalSummary,
    loadCollegeLevels,
    loadCollegeLevelsTrend,
    loadDelayedTasks,
    getIndicatorStatus,
    getStatusClass,
    getStatusText,
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
    exportComprehensiveReport,
    handleMonthChange,
    handleResize,
    handleSankeyLinkClick,
    handleSankeyNodeClick,
    handleIndicatorRowClick,
    handleCloseIndicatorDetail,
    selectedIndicatorDetail,
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
    overviewAggregate,
    radarChartRef,
    radarData,
    reloadData,
    reminderStatuses,
    remindingMap,
    selectedBenchmarkDept,
    selectedDeptIndicators,
    selectedDeptStats,
    selectedMonth,
    mutationSummary,
    loadMutationSummary,
    selectedMonthInCollegeDrillDown,
    selectedMonthInDrillDown,
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
