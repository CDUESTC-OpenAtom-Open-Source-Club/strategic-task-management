/**
 * 数据看板切月等价 + 全校简报口径单测（2026-11-27）
 *
 * 契约：
 * - 部门卡 / 学院卡 / 排名卡三个月份下拉写的是同一个 selectedMonth；一次切月
 *   college-levels / appraisal-summary / delayed-indicators 各请求一次，
 *   简报 / 完成情况卡 / 进度等级分布 / 部门分布图 / 学院图 / 滞后清单同口径。
 * - auto-jump 跳月同样走 watch(selectedMonth)：目标月每个接口只请求一次。
 * - 过期响应保护按「年 + 月」口径：快速切月、切年不改月号时，旧口径响应一律丢弃。
 * - 全校视角（战略部 / 系统管理员）简报 = 职能部门自身 + 学院，
 *   与 appraisal-summary 的 annual 逐项相等；职能部门 / 学院视角口径不变；
 *   简报 / 完成情况卡 / 进度等级分布三处同源。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/shared/api/client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn()
  }
}))

vi.mock('@/shared/api/monitoringApi', () => ({
  alertApi: {
    getUnclosedAlerts: vi.fn(async () => [])
  }
}))

import { apiClient } from '@/shared/api/client'
import {
  aggregateDeptOwnLevels,
  aggregateCollegeLevels,
  emptyDeptOwnAggregate,
  mergeLevelAggregates
} from '@/features/dashboard/lib/summaryMetrics'
import type {
  DashboardCollegeLevelStat,
  DashboardDepartmentLevelStat
} from '@/features/dashboard/api/dashboardApi'
import { useDashboardView } from '@/features/dashboard/model/useDashboardView'
import { useOrgStore } from '@/features/organization/model/store'

const mockedGet = vi.mocked(apiClient.get)

const YEAR = 2026

/** 组织清单：一个职能部门 + 两个学院（部门分布图 x 轴 / 部门自身合计只认 functional_dept） */
const seedOrganizations = () => {
  const orgStore = useOrgStore()
  orgStore.departments = [
    { id: '3', name: '教务处', type: 'functional_dept' as const, sortOrder: 1 },
    { id: '57', name: '计算机学院', type: 'secondary_college' as const, sortOrder: 2 },
    { id: '58', name: '工学院', type: 'secondary_college' as const, sortOrder: 3 }
  ]
}

/** 已审定月份的学院行：合计 0 / 337 / 7，已下发 344（与本地 11 月学院线同形态） */
const collegeRowsAppraised: DashboardCollegeLevelStat[] = [
  {
    orgId: 57,
    orgName: '计算机学院',
    ahead: 0,
    normal: 100,
    delayed: 2,
    total: 102,
    dispatchedCount: 344,
    reported: true,
    monthState: 'APPROVED'
  },
  {
    orgId: 58,
    orgName: '工学院',
    ahead: 0,
    normal: 237,
    delayed: 5,
    total: 242,
    dispatchedCount: 0,
    reported: true,
    monthState: 'APPROVED'
  }
]

/** 未填报月份的学院行：等级全 0、reported=false，已下发数照常返回 */
const collegeRowsUnreported: DashboardCollegeLevelStat[] = [
  {
    orgId: 57,
    orgName: '计算机学院',
    ahead: 0,
    normal: 0,
    delayed: 0,
    total: 0,
    dispatchedCount: 344,
    reported: false,
    monthState: 'NOT_REPORTED'
  },
  {
    orgId: 58,
    orgName: '工学院',
    ahead: 0,
    normal: 0,
    delayed: 0,
    total: 0,
    dispatchedCount: 0,
    reported: false,
    monthState: 'NOT_REPORTED'
  }
]

/**
 * 已审定月份的部门行：教务处自身 0 / 148 / 69（已下发 217），
 * 外加一条学院置灰行——全量视角的 appraisal-summary.departments 里混着学院的未填报行
 */
const deptRowsAppraised: DashboardDepartmentLevelStat[] = [
  {
    orgId: 3,
    orgName: '教务处',
    ahead: 0,
    normal: 148,
    delayed: 69,
    total: 217,
    reported: true,
    monthState: 'APPROVED',
    dispatchedCount: 217
  },
  {
    orgId: 57,
    orgName: '计算机学院',
    ahead: 0,
    normal: 0,
    delayed: 0,
    total: 0,
    reported: false,
    monthState: 'NOT_REPORTED',
    dispatchedCount: 344
  }
]

/** 未填报月份的部门行：等级全 0，已下发数照常返回（灰柱高度） */
const deptRowsUnreported: DashboardDepartmentLevelStat[] = [
  {
    orgId: 3,
    orgName: '教务处',
    ahead: 0,
    normal: 0,
    delayed: 0,
    total: 0,
    reported: false,
    monthState: 'NOT_REPORTED',
    dispatchedCount: 217
  }
]

/** 已审定月份的学院图行（college-levels → 柱图行，断言学院等级数据已就位用） */
const APPRAISED_BAR_ROWS = [
  { fullName: '计算机学院', normal: 100, delayed: 2, monthState: 'APPROVED' },
  { fullName: '工学院', normal: 237, delayed: 5, monthState: 'APPROVED' }
]

const ANNUAL_APPRAISED = { ahead: 0, normal: 485, delayed: 76, total: 561, completionRate: 86 }
const ANNUAL_EMPTY = { ahead: 0, normal: 0, delayed: 0, total: 0, completionRate: 0 }

const delayedItemsAppraised = [
  {
    indicatorId: 101,
    indicatorName: '指标A',
    orgId: 57,
    orgName: '计算机学院',
    ownerOrgName: '战略发展部',
    selfRating: 'DELAYED',
    appraisalLevel: 'DELAYED'
  }
]
/** 滞后清单卡的行（TOP5 映射后的对外结构） */
const expectedDelayedTasks = delayedItemsAppraised.map(item =>
  expect.objectContaining({
    id: item.indicatorId,
    name: item.indicatorName,
    dept: item.orgName,
    levelText: '滞后'
  })
)
type ApiParams = { year: number; month?: number; orgId?: number }

/** 按月份返回契约形态的响应：APPRAISED_MONTH 有鉴定数据，其余月份全空 */
const APPRAISED_MONTH = 11
const defaultResponder = (url: string, params: ApiParams): unknown => {
  const year = params.year
  const month = params.month ?? 0
  const appraised = month === APPRAISED_MONTH
  if (url === '/dashboard/college-levels') {
    return { year, month, colleges: appraised ? collegeRowsAppraised : collegeRowsUnreported }
  }
  if (url === '/dashboard/college-levels-trend') {
    return { year, months: [] }
  }
  if (url === '/dashboard/appraisal-summary') {
    return {
      year,
      month,
      latestMonth: APPRAISED_MONTH,
      departments: appraised ? deptRowsAppraised : deptRowsUnreported,
      departmentMonths: [],
      annual: appraised ? ANNUAL_APPRAISED : ANNUAL_EMPTY
    }
  }
  if (url === '/dashboard/delayed-indicators') {
    return { year, month, items: appraised ? delayedItemsAppraised : [] }
  }
  throw new Error(`未预期的请求：${url}`)
}

const installApi = (responder: (url: string, params: ApiParams) => unknown = defaultResponder) => {
  mockedGet.mockReset()
  mockedGet.mockImplementation(async (url: string, params?: ApiParams) =>
    responder(url, params ?? { year: YEAR })
  )
}

/** 等价挂载后的首拉（onMounted 在组件外不执行） */
const loadInitial = async (view: ReturnType<typeof useDashboardView>) => {
  void view.loadCollegeLevels()
  void view.loadCollegeLevelsTrend()
  void view.loadDelayedTasks()
  void view.loadAppraisalSummary()
  await flushPromises()
}

/** 依赖月份的三个接口的请求清单（趋势接口只按年取，不计入切月请求） */
const MONTH_ENDPOINTS = [
  '/dashboard/appraisal-summary',
  '/dashboard/college-levels',
  '/dashboard/delayed-indicators'
]
const dashboardCalls = () =>
  mockedGet.mock.calls
    .filter(call => MONTH_ENDPOINTS.includes(String(call[0])))
    .map(call => {
      const params = (call[1] ?? {}) as ApiParams
      return `${String(call[0])}?year=${params.year}&month=${params.month ?? ''}`
    })
    .sort()

const EXPECTED_SWITCH_CALLS = (year: number, month: number) =>
  [
    `/dashboard/appraisal-summary?year=${year}&month=${month}`,
    `/dashboard/college-levels?year=${year}&month=${month}`,
    `/dashboard/delayed-indicators?year=${year}&month=${month}`
  ].sort()

beforeEach(() => {
  // 只冻结 Date：默认月固定为 2026-11，切月目标为 10 月（不依赖真实运行日期）
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(YEAR, 10, 15, 12, 0, 0))
  setActivePinia(createPinia())
  seedOrganizations()
  installApi()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDashboardView 切月等价（三条切月路径 / auto-jump / 过期响应）', () => {
  const switchPaths = [
    {
      name: '部门卡',
      to: (view: ReturnType<typeof useDashboardView>, month: number) => {
        view.selectedMonth.value = month
        view.handleMonthChange()
      }
    },
    {
      name: '排名卡',
      to: (view: ReturnType<typeof useDashboardView>, month: number) => {
        view.collegeRankingMonth.value = month
        view.handleCollegeRankingMonthChange()
      }
    },
    {
      name: '学院卡',
      to: (view: ReturnType<typeof useDashboardView>, month: number) => {
        view.collegeSelectedMonth.value = month
        view.handleCollegeMonthChange()
      }
    }
  ]

  it.each(switchPaths)(
    '$name 切到 10 月：三个接口各请求一次，简报 / 完成情况 / 等级分布 / 滞后清单同步归零',
    async path => {
      const view = useDashboardView({})
      await loadInitial(view)
      const novemberSupervision = { ...view.collegeSupervision.value }

      mockedGet.mockClear()
      path.to(view, 10)
      await flushPromises()

      // 每个接口只请求一次（原部门卡 / 排名卡路径不重拉学院等级，学院卡路径滞后清单请求两次）
      expect(dashboardCalls()).toEqual(EXPECTED_SWITCH_CALLS(YEAR, 10))
      // 简报 / 完成情况 / 等级分布同源：三档与完成率归零，已下发数保持
      expect(view.collegeSupervision.value).toMatchObject({
        ahead: 0,
        normal: 0,
        delayed: 0,
        completionRate: 0,
        dispatchedTotal: 561
      })
      expect(view.briefMonthApproved.value).toBe(false)
      expect(view.dashboardData.value).toMatchObject({
        completionRate: 0,
        completedIndicators: 0,
        totalIndicators: 561,
        levelDistribution: { ahead: 0, normal: 0, delayed: 0 }
      })
      // 部门分布图 / 滞后清单同屏切到 10 月口径
      expect(view.appraisalSummary.value?.month).toBe(10)
      expect(view.stackedBarData.value).toMatchObject([
        { fullName: '教务处', monthState: 'NOT_REPORTED' }
      ])
      expect(view.delayedTasks.value).toEqual([])

      // 切回 11 月：数字恢复，同样每个接口一次
      mockedGet.mockClear()
      path.to(view, 11)
      await flushPromises()

      expect(dashboardCalls()).toEqual(EXPECTED_SWITCH_CALLS(YEAR, 11))
      expect(view.collegeSupervision.value).toEqual(novemberSupervision)
      expect(view.briefMonthApproved.value).toBe(true)
      expect(view.delayedTasks.value).toEqual(expectedDelayedTasks)
    }
  )

  it('auto-jump：首屏月无鉴定数据时跳到最近有数据的月份，目标月每个接口只请求一次', async () => {
    vi.setSystemTime(new Date(YEAR, 11, 15, 12, 0, 0)) // 当前月 = 12 月，无数据
    installApi((url, params) => {
      if (params.month === 12 && url === '/dashboard/appraisal-summary') {
        return {
          year: params.year,
          month: 12,
          latestMonth: APPRAISED_MONTH,
          departments: [],
          departmentMonths: []
        }
      }
      return defaultResponder(url, params)
    })

    const view = useDashboardView({})
    expect(view.selectedMonth.value).toBe(12)
    await loadInitial(view)

    expect(view.selectedMonth.value).toBe(APPRAISED_MONTH)
    // 跳月前的 12 月请求各发过一次（无数据），跳月后 11 月每个接口只补一次，不再重复
    expect(dashboardCalls()).toEqual(
      [...EXPECTED_SWITCH_CALLS(YEAR, 12), ...EXPECTED_SWITCH_CALLS(YEAR, 11)].sort()
    )
    expect(view.collegeBarData.value).toMatchObject(APPRAISED_BAR_ROWS)
    expect(view.appraisalSummary.value?.month).toBe(APPRAISED_MONTH)
    expect(view.collegeSupervision.value).toMatchObject({ normal: 485, completionRate: 86 })
  })

  it('快速切月：先发出的旧月份滞后清单后返回，不覆盖新月份', async () => {
    let resolveNovember: (value: unknown) => void = () => {}
    installApi((url, params) => {
      if (url === '/dashboard/delayed-indicators' && params.month === APPRAISED_MONTH) {
        return new Promise(resolve => {
          resolveNovember = resolve
        })
      }
      return defaultResponder(url, params)
    })

    const view = useDashboardView({})
    const pendingNovember = view.loadDelayedTasks()
    view.selectedMonth.value = 10
    await flushPromises()
    expect(view.delayedTasks.value).toEqual([])

    resolveNovember({ year: YEAR, month: APPRAISED_MONTH, items: delayedItemsAppraised })
    await pendingNovember
    await flushPromises()

    // 旧月份的响应被丢弃：滞后清单仍是 10 月的空清单
    expect(view.delayedTasks.value).toEqual([])
    expect(view.delayedTasksLoading.value).toBe(false)
  })

  it('切年不改月号：上一年的响应后返回被丢弃，不覆盖新年份数据', async () => {
    let resolveOldYear: (value: unknown) => void = () => {}
    installApi((url, params) => {
      if (url === '/dashboard/college-levels' && params.year === YEAR) {
        return new Promise(resolve => {
          resolveOldYear = resolve
        })
      }
      return defaultResponder(url, params)
    })

    const view = useDashboardView({})
    const pendingOldYear = view.loadCollegeLevels()
    view.timeContext.currentYear = YEAR - 1
    await flushPromises()

    // 新年份 11 月的学院等级已就位
    expect(view.collegeBarData.value).toMatchObject(APPRAISED_BAR_ROWS)
    expect(mockedGet).toHaveBeenCalledWith('/dashboard/college-levels', {
      year: YEAR - 1,
      month: APPRAISED_MONTH
    })

    resolveOldYear({ year: YEAR, month: APPRAISED_MONTH, items: [] })
    await pendingOldYear
    await flushPromises()

    expect(view.collegeBarData.value).toMatchObject(APPRAISED_BAR_ROWS)
  })
})

describe('useDashboardView 全校简报口径（职能部门自身 + 学院）', () => {
  it('全校视角：简报 / 完成情况 / 等级分布三处同源，与 appraisal-summary 的 annual 逐项相等', async () => {
    const view = useDashboardView({ viewingRole: 'strategic_dept' })
    await loadInitial(view)

    const annual = view.appraisalSummary.value?.annual
    expect(annual).toEqual(ANNUAL_APPRAISED)
    expect(view.collegeSupervision.value).toMatchObject({
      ahead: annual?.ahead,
      normal: annual?.normal,
      delayed: annual?.delayed,
      completionRate: annual?.completionRate
    })
    // 学院置灰行不当作部门自身重复计入（否则已下发数 = 344 + 561）
    expect(view.collegeSupervision.value.dispatchedTotal).toBe(561)
    expect(view.collegeSupervision.value.dispatchedTotal).toBe(annual?.total)
    expect(view.dashboardData.value).toMatchObject({
      completionRate: annual?.completionRate,
      totalIndicators: annual?.total,
      completedIndicators: 485,
      levelDistribution: { ahead: 0, normal: 485, delayed: 76 }
    })
    // 部门自身合计只认职能部门行
    expect(view.overviewAggregate.value).toEqual({
      ahead: 0,
      normal: 485,
      delayed: 76,
      appraisedTotal: 561,
      dispatchedTotal: 561,
      completed: 485,
      completionRate: 86
    })
  })

  it('职能部门 / 学院视角口径不变：简报只合计学院行，不并入 appraisal-summary 的部门行', async () => {
    const cases = [
      { role: 'functional_dept', dept: '党委学工部' },
      { role: 'secondary_college', dept: '计算机学院' }
    ] as const

    for (const item of cases) {
      setActivePinia(createPinia())
      seedOrganizations()
      installApi()
      const view = useDashboardView({ viewingRole: item.role, viewingDept: item.dept })
      await loadInitial(view)

      // 仍为学院线 344 项 / 98%（部门行 217 项不并入）
      expect(view.collegeSupervision.value).toMatchObject({
        ahead: 0,
        normal: 337,
        delayed: 7,
        dispatchedTotal: 344,
        appraisedTotal: 344,
        completionRate: 98
      })
      expect(view.dashboardData.value).toMatchObject({
        completionRate: 98,
        totalIndicators: 344,
        completedIndicators: 337
      })
      expect(view.briefMonthApproved.value).toBe(true)
    }
  })

  it('部门线已鉴定、学院线整月未审定：简报按审定月展开，与完成情况卡对得上', async () => {
    installApi((url, params) => {
      if (url === '/dashboard/college-levels') {
        return { year: params.year, month: params.month, colleges: collegeRowsUnreported }
      }
      return defaultResponder(url, params)
    })

    const view = useDashboardView({ viewingRole: 'strategic_dept' })
    await loadInitial(view)

    expect(view.briefMonthApproved.value).toBe(true)
    expect(view.collegeSupervision.value).toMatchObject({
      normal: 148,
      delayed: 69,
      completionRate: 26, // 148 / 561
      dispatchedTotal: 561
    })
  })

  it('职能部门视角进入学院下钻：不发 indicator-levels（该角色查其他组织返回 403）', async () => {
    installApi()
    const orgStore = useOrgStore()
    orgStore.departments = [
      ...orgStore.departments,
      { id: '57', name: '计算机学院', type: 'secondary_college' as const, sortOrder: 2 }
    ] as typeof orgStore.departments

    const functionalView = useDashboardView({
      viewingRole: 'functional_dept',
      viewingDept: '党委学工部'
    })
    functionalView.isCollegeDrillDown.value = true
    functionalView.drilledCollege.value = '计算机学院'
    await flushPromises()
    expect(
      mockedGet.mock.calls.filter(call => call[0] === '/dashboard/indicator-levels')
    ).toHaveLength(0)

    const strategicView = useDashboardView({ viewingRole: 'strategic_dept' })
    strategicView.isCollegeDrillDown.value = true
    strategicView.drilledCollege.value = '计算机学院'
    await flushPromises()
    expect(mockedGet).toHaveBeenCalledWith('/dashboard/indicator-levels', {
      year: YEAR,
      orgId: 57
    })
  })
})

describe('summaryMetrics 总览合计（学院 + 职能部门自身）', () => {
  it('aggregateDeptOwnLevels 合计部门自身行的三档 / 已鉴定 / 已下发', () => {
    expect(aggregateDeptOwnLevels(deptRowsAppraised)).toEqual({
      ahead: 0,
      normal: 148,
      delayed: 69,
      total: 217,
      dispatchedTotal: 561 // 217 + 344：直接把整个 departments 数组加进来会把学院重复计一遍
    })
    expect(aggregateDeptOwnLevels([])).toEqual(emptyDeptOwnAggregate())
  })

  it('mergeLevelAggregates：学院 + 部门自身，完成率分母沿用已下发数', () => {
    const merged = mergeLevelAggregates(
      aggregateCollegeLevels(collegeRowsAppraised),
      aggregateDeptOwnLevels([deptRowsAppraised[0]!])
    )

    expect(merged).toEqual({
      ahead: 0,
      normal: 485,
      delayed: 76,
      appraisedTotal: 561,
      dispatchedTotal: 561,
      completed: 485,
      completionRate: 86
    })
  })

  it('mergeLevelAggregates：部门自身为空时与原学院口径逐项一致', () => {
    const college = aggregateCollegeLevels(collegeRowsAppraised)

    expect(mergeLevelAggregates(college, emptyDeptOwnAggregate())).toMatchObject({
      ahead: college.ahead,
      normal: college.normal,
      delayed: college.delayed,
      appraisedTotal: college.total,
      dispatchedTotal: 344,
      completionRate: 98
    })
  })
})
