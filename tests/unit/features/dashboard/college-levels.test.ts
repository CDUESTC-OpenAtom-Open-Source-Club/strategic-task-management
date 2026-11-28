/**
 * 数据看板学院等级统计单测（2026-11-17 新口径 + 2026-11-18 按月快照）
 *
 * 契约：
 * - GET /api/v1/dashboard/college-levels?year=&month=
 * - GET /api/v1/dashboard/college-levels-trend?year=
 * - GET /api/v1/dashboard/delayed-indicators?year=&month=
 * 口径：①未填报学院也返回（reported=false，前端灰柱「下发 n 项·未填报」督办）
 *      ②只算已提交/已审批月报（后端过滤，DRAFT 不计入）
 *      ③等级 appraisal_level 优先 self_rating 兜底三档（后端已聚合）
 *      ④手动预警等级（alert_event/manualAlertSeverity）退出看板统计
 *      ⑤完成率/排名分母 = 已下发指标数
 *      ⑥按月快照：行带 monthState（APPROVED/IN_REVIEW/NOT_REPORTED），
 *        只有 APPROVED 出鉴定值，非 APPROVED 前端一律置灰（行级 > 月级 > reported 兜底）
 *      ⑦切月等价（2026-11-27）：部门卡 / 学院卡 / 排名卡三条切月路径共用 watch(selectedMonth)，
 *        college-levels / appraisal-summary / delayed-indicators 各请求一次
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
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
import { dashboardApi } from '@/features/dashboard/api/dashboardApi'
import {
  aggregateCollegeLevels,
  toCollegeBarRows,
  toCollegeRankingRows,
  toCollegeTrendRows
} from '@/features/dashboard/lib/summaryMetrics'
import type {
  DashboardCollegeLevelStat,
  DashboardCollegeLevelsTrendResponse
} from '@/features/dashboard/api/dashboardApi'
import { useDashboardView } from '@/features/dashboard/model/useDashboardView'

const mockedGet = vi.mocked(apiClient.get)

/** 与后端契约逐字段一致的样本响应（57 已填报，58 未填报灰柱） */
const contractColleges: DashboardCollegeLevelStat[] = [
  {
    orgId: 57,
    orgName: '计算机学院',
    month: 10,
    ahead: 3,
    normal: 1,
    delayed: 0,
    total: 4,
    dispatchedCount: 5,
    undispatchedCount: 1,
    reported: true
  },
  {
    orgId: 58,
    orgName: '电子信息学院',
    month: 10,
    ahead: 0,
    normal: 0,
    delayed: 0,
    total: 0,
    dispatchedCount: 4,
    undispatchedCount: 2,
    reported: false
  }
]

/** 趋势样本：接口固定返回 1-12 月全量（测试只取一段验证映射） */
const contractTrend: DashboardCollegeLevelsTrendResponse = {
  year: 2026,
  months: [
    {
      month: 9,
      colleges: [
        {
          orgId: 57,
          orgName: '计算机学院',
          month: 9,
          ahead: 2,
          normal: 0,
          delayed: 1,
          total: 3,
          dispatchedCount: 4,
          undispatchedCount: 0,
          reported: true
        }
      ]
    },
    {
      month: 10,
      colleges: [
        {
          orgId: 57,
          orgName: '计算机学院',
          month: 10,
          ahead: 3,
          normal: 1,
          delayed: 0,
          total: 4,
          dispatchedCount: 5,
          undispatchedCount: 1,
          reported: true
        },
        {
          orgId: 58,
          orgName: '电子信息学院',
          month: 10,
          ahead: 0,
          normal: 0,
          delayed: 0,
          total: 0,
          dispatchedCount: 4,
          undispatchedCount: 2,
          reported: false
        }
      ]
    }
  ]
}

beforeEach(() => {
  mockedGet.mockReset()
})

describe('dashboardApi 学院等级/滞后清单契约（GET /dashboard/*）', () => {
  describe('getCollegeLevels', () => {
    it('按契约请求 /dashboard/college-levels 并透传 year/month', async () => {
      mockedGet.mockResolvedValue({ year: 2026, month: 10, colleges: contractColleges })

      const response = await dashboardApi.getCollegeLevels({ year: 2026, month: 10 })

      expect(mockedGet).toHaveBeenCalledWith('/dashboard/college-levels', {
        year: 2026,
        month: 10
      })
      expect(response.year).toBe(2026)
      expect(response.month).toBe(10)
      expect(response.colleges).toEqual(contractColleges)
    })

    it('兼容后端 ApiResponse 包裹形态并解包 data', async () => {
      mockedGet.mockResolvedValue({
        code: 0,
        message: 'ok',
        data: { year: 2026, month: 10, colleges: contractColleges }
      })

      const response = await dashboardApi.getCollegeLevels({ year: 2026, month: 10 })

      expect(response.colleges).toEqual(contractColleges)
    })

    it('colleges 缺失时抛错（不静默造数据）', async () => {
      mockedGet.mockResolvedValue({ year: 2026, month: 10 })

      await expect(dashboardApi.getCollegeLevels({ year: 2026, month: 10 })).rejects.toThrow(
        /格式异常/
      )
    })

    it('后端 400（非法参数）时向上抛出', async () => {
      mockedGet.mockRejectedValue({ code: 400, message: 'bad request' })

      await expect(dashboardApi.getCollegeLevels({ year: 2026, month: 13 })).rejects.toEqual({
        code: 400,
        message: 'bad request'
      })
    })
  })

  describe('getCollegeLevelsTrend', () => {
    it('按契约请求 /dashboard/college-levels-trend 并透传 year', async () => {
      mockedGet.mockResolvedValue(contractTrend)

      const response = await dashboardApi.getCollegeLevelsTrend({ year: 2026 })

      expect(mockedGet).toHaveBeenCalledWith('/dashboard/college-levels-trend', { year: 2026 })
      expect(response.months).toEqual(contractTrend.months)
    })

    it('兼容后端 ApiResponse 包裹形态并解包 data', async () => {
      mockedGet.mockResolvedValue({ code: 0, message: 'ok', data: contractTrend })

      const response = await dashboardApi.getCollegeLevelsTrend({ year: 2026 })

      expect(response.months).toHaveLength(2)
    })

    it('months 缺失时抛错（不静默造数据）', async () => {
      mockedGet.mockResolvedValue({ year: 2026 })

      await expect(dashboardApi.getCollegeLevelsTrend({ year: 2026 })).rejects.toThrow(/格式异常/)
    })
  })

  describe('getDelayedIndicators', () => {
    it('按契约请求 /dashboard/delayed-indicators 并透传 year/month，返回 items', async () => {
      const items = [
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
      mockedGet.mockResolvedValue({ year: 2026, month: 10, items })

      const response = await dashboardApi.getDelayedIndicators({ year: 2026, month: 10 })

      expect(mockedGet).toHaveBeenCalledWith('/dashboard/delayed-indicators', {
        year: 2026,
        month: 10
      })
      expect(response.items).toEqual(items)
    })

    it('兼容 ApiResponse 包裹形态；items 缺失时抛错', async () => {
      mockedGet.mockResolvedValue({
        code: 0,
        message: 'ok',
        data: { year: 2026, month: 10, items: [] }
      })
      const ok = await dashboardApi.getDelayedIndicators({ year: 2026, month: 10 })
      expect(ok.items).toEqual([])

      mockedGet.mockResolvedValue({ year: 2026, month: 10 })
      await expect(dashboardApi.getDelayedIndicators({ year: 2026, month: 10 })).rejects.toThrow(
        /格式异常/
      )
    })
  })
})

describe('summaryMetrics 学院等级映射（2026-11-17 新口径 + 2026-11-18 按月快照）', () => {
  it('toCollegeBarRows 逐字段映射契约数据（含灰柱字段与 monthState），不产生 warning 桶', () => {
    const rows = toCollegeBarRows(contractColleges)

    expect(rows).toEqual([
      {
        name: '计算机学院',
        fullName: '计算机学院',
        orgId: 57,
        ahead: 3,
        normal: 1,
        delayed: 0,
        total: 4,
        dispatchedCount: 5,
        undispatchedCount: 1,
        reported: true,
        monthState: 'APPROVED'
      },
      {
        name: '电子信息学院',
        fullName: '电子信息学院',
        orgId: 58,
        ahead: 0,
        normal: 0,
        delayed: 0,
        total: 0,
        dispatchedCount: 4,
        undispatchedCount: 2,
        reported: false,
        monthState: 'NOT_REPORTED'
      }
    ])
    expect(rows.some(row => 'warning' in row)).toBe(false)
  })

  it('toCollegeBarRows 契约行带 monthState 时优先于 reported 兜底（IN_REVIEW → 灰柱）', () => {
    const rows = toCollegeBarRows([
      {
        orgId: 60,
        orgName: '经济管理学院',
        ahead: 0,
        normal: 0,
        delayed: 0,
        total: 0,
        dispatchedCount: 3,
        undispatchedCount: 0,
        reported: false,
        monthState: 'IN_REVIEW'
      }
    ])

    expect(rows[0]?.monthState).toBe('IN_REVIEW')
    expect(rows[0]?.reported).toBe(false)
  })

  it('toCollegeBarRows 超长学院名截断为 8 字符 + 省略号', () => {
    const rows = toCollegeBarRows([
      {
        orgId: 1,
        orgName: '先进智能制造与装备学院',
        ahead: 0,
        normal: 0,
        delayed: 0,
        total: 0,
        dispatchedCount: 2,
        undispatchedCount: 0,
        reported: false
      }
    ])

    expect(rows[0]?.name).toBe('先进智能制造与装...')
    expect(rows[0]?.fullName).toBe('先进智能制造与装备学院')
  })

  it('toCollegeTrendRows 按月升序画接口返回的全部月份', () => {
    const rows = toCollegeTrendRows(contractTrend.months, '计算机学院')

    expect(rows.map(row => row.month)).toEqual([9, 10])
    expect(rows[0]).toMatchObject({
      month: 9,
      ahead: 2,
      normal: 0,
      delayed: 1,
      total: 3,
      reported: true,
      monthState: 'APPROVED'
    })
    expect(rows[1]).toMatchObject({
      month: 10,
      ahead: 3,
      normal: 1,
      delayed: 0,
      total: 4,
      reported: true,
      monthState: 'APPROVED'
    })
  })

  it('toCollegeTrendRows 某月未含该学院时按 0 值+未填报绘制（灰柱月）', () => {
    const rows = toCollegeTrendRows(contractTrend.months, '经济管理学院')

    expect(rows.map(row => row.month)).toEqual([9, 10])
    expect(rows.every(row => row.total === 0)).toBe(true)
    expect(rows.every(row => row.reported === false)).toBe(true)
    expect(rows.every(row => row.monthState === 'NOT_REPORTED')).toBe(true)
  })

  it('toCollegeTrendRows 月级 monthState 优先于行级 reported 兜底（IN_REVIEW 月 → 灰柱）', () => {
    const months = [
      {
        month: 11,
        monthState: 'IN_REVIEW' as const,
        colleges: [
          {
            orgId: 57,
            orgName: '计算机学院',
            month: 11,
            ahead: 1,
            normal: 1,
            delayed: 0,
            total: 2,
            dispatchedCount: 4,
            undispatchedCount: 0,
            reported: true
          }
        ]
      }
    ]

    const rows = toCollegeTrendRows(months, '计算机学院')
    expect(rows[0]?.monthState).toBe('IN_REVIEW')

    // 行级 monthState 比月级更优先
    const monthsWithRowState = [
      {
        month: 12,
        monthState: 'IN_REVIEW' as const,
        colleges: [
          {
            orgId: 57,
            orgName: '计算机学院',
            month: 12,
            ahead: 0,
            normal: 0,
            delayed: 0,
            total: 0,
            dispatchedCount: 4,
            undispatchedCount: 0,
            reported: false,
            monthState: 'NOT_REPORTED' as const
          }
        ]
      }
    ]
    const rowsWithRowState = toCollegeTrendRows(monthsWithRowState, '计算机学院')
    expect(rowsWithRowState[0]?.monthState).toBe('NOT_REPORTED')
  })

  it('toCollegeRankingRows 分数 = (超前+正常)/已下发数×100 并按分数降序', () => {
    const rows = toCollegeRankingRows(contractColleges)

    // 计算机学院 (3+1)/5 = 80；电子信息学院未填报 0/4 = 0 垫底
    expect(rows.map(row => row.fullName)).toEqual(['计算机学院', '电子信息学院'])
    expect(rows[0]?.value).toBe(80)
    expect(rows[0]?.total).toBe(5)
    expect(rows[1]?.value).toBe(0)
    expect(rows[1]?.reported).toBe(false)
  })

  it('toCollegeRankingRows 同分按完成数降序、已下发数为 0 时分数为 0', () => {
    const rows = toCollegeRankingRows([
      {
        orgId: 1,
        orgName: 'A学院',
        ahead: 1,
        normal: 1,
        delayed: 0,
        total: 4,
        dispatchedCount: 4,
        undispatchedCount: 0,
        reported: true
      },
      {
        orgId: 2,
        orgName: 'B学院',
        ahead: 2,
        normal: 0,
        delayed: 0,
        total: 4,
        dispatchedCount: 4,
        undispatchedCount: 0,
        reported: true
      },
      {
        orgId: 3,
        orgName: 'C学院',
        ahead: 0,
        normal: 0,
        delayed: 0,
        total: 0,
        dispatchedCount: 0,
        undispatchedCount: 3,
        reported: false
      }
    ])

    expect(rows.map(row => row.fullName)).toEqual(['A学院', 'B学院', 'C学院'])
    expect(rows[2]?.value).toBe(0)
  })

  it('aggregateCollegeLevels 汇总三档等级/已下发总数/未填报学院数', () => {
    const aggregate = aggregateCollegeLevels(contractColleges)

    expect(aggregate).toEqual({
      ahead: 3,
      normal: 1,
      delayed: 0,
      total: 4,
      dispatchedTotal: 9,
      undispatchedTotal: 3,
      unreportedColleges: 1
    })
    expect(aggregateCollegeLevels([])).toEqual({
      ahead: 0,
      normal: 0,
      delayed: 0,
      total: 0,
      dispatchedTotal: 0,
      undispatchedTotal: 0,
      unreportedColleges: 0
    })
  })
})

describe('useDashboardView 学院等级/滞后任务数据流（API 供数 + 切月/事件刷新）', () => {
  it('看板默认选中当前月（2026-11-24：原默认上月，启用初期上月无数据导致首屏全空）', () => {
    // 只冻结 Date（不动 setTimeout 等定时器），避免跨月边界运行时用例漂移
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      // 11 月：三个月份筛选（部门分布/学院看板/分院排名）默认值都落在当前月
      vi.setSystemTime(new Date(2026, 10, 15, 12, 0, 0))
      setActivePinia(createPinia())
      const view = useDashboardView({})
      expect(view.selectedMonth.value).toBe(11)
      expect(view.collegeSelectedMonth.value).toBe(11)
      expect(view.collegeRankingMonth.value).toBe(11)

      // 1 月边界：默认当月 = 1（不再有「1 月默认去年 12 月」的上月特判）
      vi.setSystemTime(new Date(2027, 0, 15, 12, 0, 0))
      setActivePinia(createPinia())
      const januaryView = useDashboardView({})
      expect(januaryView.selectedMonth.value).toBe(1)
      expect(januaryView.collegeSelectedMonth.value).toBe(1)
      expect(januaryView.collegeRankingMonth.value).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('collegeBarData 来自契约响应；切月触发重新请求；未填报学院灰柱行保留', async () => {
    setActivePinia(createPinia())
    mockedGet.mockResolvedValue({ year: 2026, month: 10, colleges: contractColleges })

    const view = useDashboardView({})
    // onMounted 在组件外不执行，这里显式触发初始加载（等价挂载后的首拉）
    await view.loadCollegeLevels()
    await flushPromises()

    expect(mockedGet).toHaveBeenCalledWith(
      '/dashboard/college-levels',
      expect.objectContaining({ month: view.collegeSelectedMonth.value })
    )
    expect(view.collegeBarData.value.map(row => row.fullName)).toEqual([
      '计算机学院',
      '电子信息学院'
    ])
    expect(view.collegeBarData.value[0]).toMatchObject({
      ahead: 3,
      normal: 1,
      delayed: 0,
      total: 4,
      reported: true
    })
    expect(view.collegeChartHasData.value).toBe(true)

    // 简报督办统计：完成率分母=已下发总数，未填报学院 1 个
    expect(view.collegeSupervision.value).toMatchObject({
      dispatchedTotal: 9,
      completionRate: 44, // (3+1)/9 = 44.4 → 44
      unreportedColleges: 1,
      unreportedNames: ['电子信息学院']
    })

    // 切月 → 重新请求该月数据；该月无数据 → 空数组（不造假柱）
    // 2026-11-27（切月等价）：数据重拉统一由 watch(selectedMonth) 发起，学院卡 handler 不再自己发请求；
    // 目标月不硬编码，只要求与当前选中月不同（同月不构成切月，不会触发重拉）
    const switchMonth = view.selectedMonth.value === 10 ? 11 : 10
    mockedGet.mockClear()
    mockedGet.mockResolvedValue({ year: 2026, month: switchMonth, items: [] })
    view.collegeSelectedMonth.value = switchMonth
    view.handleCollegeMonthChange()
    await flushPromises()

    expect(mockedGet).toHaveBeenCalledWith('/dashboard/college-levels', {
      year: view.timeContext.currentYear,
      month: switchMonth
    })
    // 新契约：一次切月三个接口各请求一次（原学院卡路径滞后清单会被 watch 与 handler 各打一次）
    expect(
      mockedGet.mock.calls.filter(call => call[0] === '/dashboard/college-levels')
    ).toHaveLength(1)
    expect(
      mockedGet.mock.calls.filter(call => call[0] === '/dashboard/appraisal-summary')
    ).toHaveLength(1)
    expect(
      mockedGet.mock.calls.filter(call => call[0] === '/dashboard/delayed-indicators')
    ).toHaveLength(1)
    expect(view.collegeBarData.value).toEqual([])
    expect(view.collegeChartHasData.value).toBe(false)
    expect(view.collegeChartEmptyText.value).toBe('该月暂无学院上报数据')
  })

  it('滞后任务卡吃 delayed-indicators 真实源：切月同步重拉、TOP5 截断', async () => {
    setActivePinia(createPinia())
    const items = Array.from({ length: 7 }, (_, index) => ({
      indicatorId: 100 + index,
      indicatorName: `滞后指标${index + 1}`,
      orgId: 57,
      orgName: '计算机学院',
      ownerOrgName: '战略发展部',
      selfRating: 'DELAYED',
      appraisalLevel: 'DELAYED'
    }))
    mockedGet.mockImplementation(async (url: string) => {
      if (url === '/dashboard/appraisal-summary') {
        return { year: 2026, month: 10, latestMonth: 0, departments: [], departmentMonths: [] }
      }
      if (url === '/dashboard/delayed-indicators') {
        return { year: 2026, month: 10, items }
      }
      return { year: 2026, month: 10, colleges: [] }
    })

    const view = useDashboardView({})
    await view.loadDelayedTasks()
    await flushPromises()

    // 2026-11-18：滞后清单与分布图同源，月份跟 selectedMonth（原跟学院卡 collegeSelectedMonth）
    expect(mockedGet).toHaveBeenCalledWith('/dashboard/delayed-indicators', {
      year: view.timeContext.currentYear,
      month: view.selectedMonth.value
    })
    expect(view.delayedTasks.value).toHaveLength(5)
    expect(view.delayedTasks.value[0]).toMatchObject({
      id: 100,
      name: '滞后指标1',
      dept: '计算机学院',
      levelText: '滞后'
    })

    // 切月：滞后清单与分布图同源重拉（selectedMonth 变化触发）
    // 目标月不硬编码：默认月已改为当前月，切换目标只要求"与当前默认月不同"即可触发 watch
    const switchMonth = view.selectedMonth.value === 11 ? 10 : 11
    mockedGet.mockClear()
    mockedGet.mockImplementation(async (url: string) => {
      if (url === '/dashboard/appraisal-summary') {
        return {
          year: 2026,
          month: switchMonth,
          latestMonth: 0,
          departments: [],
          departmentMonths: []
        }
      }
      if (url === '/dashboard/delayed-indicators') {
        return { year: 2026, month: switchMonth, items: [] }
      }
      return { year: 2026, month: switchMonth, colleges: [] }
    })
    view.selectedMonth.value = switchMonth
    await flushPromises()

    expect(mockedGet).toHaveBeenCalledWith('/dashboard/delayed-indicators', {
      year: 2026,
      month: switchMonth
    })
    expect(view.delayedTasks.value).toEqual([])
  })

  it('趋势与分院排名同源 college-levels-trend：x 轴画接口月份，排名按已下发完成率重排', async () => {
    setActivePinia(createPinia())
    mockedGet.mockImplementation(async (url: string) => {
      if (url === '/dashboard/college-levels-trend') {
        return contractTrend
      }
      return { year: 2026, month: 10, colleges: contractColleges }
    })

    const view = useDashboardView({})
    await view.loadCollegeLevelsTrend()
    await flushPromises()

    // 进入学院下钻（趋势视图）
    view.isCollegeDrillDown.value = true
    view.drilledCollege.value = '计算机学院'
    await nextTick()

    expect(view.collegeMonthlyStackedData.value.map(row => row.month)).toEqual([9, 10])
    expect(view.collegeMonthlyStackedData.value[0]).toMatchObject({
      name: '9月',
      ahead: 2,
      normal: 0,
      delayed: 1,
      total: 3
    })

    // 分院排名：选中排名月与趋势同源，分数 = (超前+正常)/已下发数
    // （排名月固定取趋势 fixture 里的月份，不再依赖看板默认月——默认月已改为当前月）
    view.collegeRankingMonth.value = 10
    await nextTick()
    const rankingSource = contractTrend.months.find(m => m.month === view.collegeRankingMonth.value)
    expect(view.getCollegeRankingData.value.map(row => row.fullName)).toEqual(
      (rankingSource?.colleges ?? []).map(college => college.orgName)
    )
    expect(view.getCollegeRankingData.value[0]?.value).toBeGreaterThan(0)
  })

  it('接口失败时清空数据走空态，不静默造假数据', async () => {
    setActivePinia(createPinia())
    mockedGet.mockRejectedValue({ code: 500, message: 'server error' })

    const view = useDashboardView({})
    await view.loadCollegeLevels()
    await view.loadDelayedTasks()
    await flushPromises()

    expect(view.collegeBarData.value).toEqual([])
    expect(view.delayedTasks.value).toEqual([])
    expect(view.collegeLevelsLoading.value).toBe(false)
    expect(view.delayedTasksLoading.value).toBe(false)
    expect(view.collegeChartHasData.value).toBe(false)
  })
})
