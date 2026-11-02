/**
 * 数据看板学院等级统计单测（2026-10-31 新口径）
 *
 * 契约：
 * - GET /api/v1/dashboard/college-levels?year=&month=
 * - GET /api/v1/dashboard/college-levels-trend?year=
 * 口径：①未填报学院整列不显示 ②只算已提交/已审批月报（后端过滤）
 *      ③等级只看上级鉴定（ahead/normal/delayed）④手动预警等级退出看板统计
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
  getIndicatorStatusAtMonth,
  toCollegeBarRows,
  toCollegeRankingRows,
  toCollegeTrendRows
} from '@/features/dashboard/lib/summaryMetrics'
import type {
  DashboardCollegeLevelStat,
  DashboardCollegeLevelsTrendResponse
} from '@/features/dashboard/api/dashboardApi'
import type { Indicator } from '@/shared/types'
import { useDashboardView } from '@/features/dashboard/model/useDashboardView'

const mockedGet = vi.mocked(apiClient.get)

/** 与后端契约逐字段一致的样本响应 */
const contractColleges: DashboardCollegeLevelStat[] = [
  { orgId: 57, orgName: '计算机学院', ahead: 3, normal: 1, delayed: 0, total: 4 },
  { orgId: 58, orgName: '电子信息学院', ahead: 1, normal: 1, delayed: 2, total: 4 }
]

const contractTrend: DashboardCollegeLevelsTrendResponse = {
  year: 2026,
  months: [
    { month: 10, colleges: [contractColleges[0]!] },
    {
      month: 9,
      colleges: [{ orgId: 57, orgName: '计算机学院', ahead: 2, normal: 0, delayed: 1, total: 3 }]
    }
  ]
}

/** 构造最小可用 Indicator（测试只关心 workflowStatus / manualAlertSeverity 字段） */
const buildIndicator = (overrides: Record<string, unknown> = {}): Indicator =>
  ({
    indicatorId: 1,
    workflowStatus: 'APPROVED',
    status: 'active',
    progress: 50,
    ...overrides
  }) as unknown as Indicator

beforeEach(() => {
  mockedGet.mockReset()
})

describe('dashboardApi 学院等级契约（GET /dashboard/college-levels*）', () => {
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
})

describe('summaryMetrics 学院等级映射（契约数据 → 看板图表行）', () => {
  it('toCollegeBarRows 逐字段映射契约数据，不产生 warning 桶', () => {
    const rows = toCollegeBarRows(contractColleges)

    expect(rows).toEqual([
      {
        name: '计算机学院',
        fullName: '计算机学院',
        orgId: 57,
        ahead: 3,
        normal: 1,
        delayed: 0,
        total: 4
      },
      {
        name: '电子信息学院',
        fullName: '电子信息学院',
        orgId: 58,
        ahead: 1,
        normal: 1,
        delayed: 2,
        total: 4
      }
    ])
    expect(rows.some(row => 'warning' in row)).toBe(false)
  })

  it('toCollegeBarRows 超长学院名截断为 8 字符 + 省略号', () => {
    const rows = toCollegeBarRows([
      { orgId: 1, orgName: '先进智能制造与装备学院', ahead: 0, normal: 0, delayed: 0, total: 0 }
    ])

    expect(rows[0]?.name).toBe('先进智能制造与装...')
    expect(rows[0]?.fullName).toBe('先进智能制造与装备学院')
  })

  it('toCollegeTrendRows 只画接口返回的月份并按月升序', () => {
    const rows = toCollegeTrendRows(contractTrend.months, '计算机学院')

    expect(rows.map(row => row.month)).toEqual([9, 10])
    expect(rows[0]).toMatchObject({ ahead: 2, normal: 0, delayed: 1, total: 3 })
    expect(rows[1]).toMatchObject({ ahead: 3, normal: 1, delayed: 0, total: 4 })
  })

  it('toCollegeTrendRows 某月未含该学院时按 0 值绘制（该月无上报数据）', () => {
    const rows = toCollegeTrendRows(contractTrend.months, '经济管理学院')

    expect(rows.map(row => row.month)).toEqual([9, 10])
    expect(rows.every(row => row.total === 0)).toBe(true)
  })

  it('toCollegeRankingRows 分数 = 完成率（(超前+正常)/总计×100）并按分数降序', () => {
    const rows = toCollegeRankingRows(contractColleges)

    // 计算机学院 (3+1)/4 = 100；电子信息学院 (1+1)/4 = 50
    expect(rows.map(row => row.fullName)).toEqual(['计算机学院', '电子信息学院'])
    expect(rows[0]?.value).toBe(100)
    expect(rows[1]?.value).toBe(50)
    expect(rows[0]?.completed).toBe(4)
  })

  it('toCollegeRankingRows 同分时按完成数降序、总计为 0 时分数为 0', () => {
    const rows = toCollegeRankingRows([
      { orgId: 1, orgName: 'A学院', ahead: 1, normal: 1, delayed: 0, total: 4 },
      { orgId: 2, orgName: 'B学院', ahead: 2, normal: 0, delayed: 0, total: 4 },
      { orgId: 3, orgName: 'C学院', ahead: 0, normal: 0, delayed: 0, total: 0 }
    ])

    expect(rows.map(row => row.fullName)).toEqual(['A学院', 'B学院', 'C学院'])
    expect(rows[2]?.value).toBe(0)
  })

  it('aggregateCollegeLevels 汇总全校三档等级与总数', () => {
    const aggregate = aggregateCollegeLevels(contractColleges)

    expect(aggregate).toEqual({ ahead: 4, normal: 2, delayed: 2, total: 8 })
    expect(aggregateCollegeLevels([])).toEqual({ ahead: 0, normal: 0, delayed: 0, total: 0 })
  })
})

describe('getIndicatorStatusAtMonth（口径④：手动预警等级退出看板统计）', () => {
  it('不再读取 manualAlertSeverity：已审批指标即使被鉴定为延期也按兜底口径返回 normal', () => {
    const indicator = buildIndicator({ manualAlertSeverity: 'CRITICAL' })

    expect(getIndicatorStatusAtMonth(indicator, 10, 2026)).toBe('normal')
  })

  it('未下发（DRAFT）/已驳回（REJECTED）不算完成，返回 warning', () => {
    expect(getIndicatorStatusAtMonth(buildIndicator({ workflowStatus: 'DRAFT' }), 10, 2026)).toBe(
      'warning'
    )
    expect(
      getIndicatorStatusAtMonth(buildIndicator({ workflowStatus: 'REJECTED' }), 10, 2026)
    ).toBe('warning')
  })
})

describe('useDashboardView 学院等级数据流（API 供数 + 切月重新请求）', () => {
  it('collegeBarData 来自契约响应；切月触发重新请求；当月无数据时空数组', async () => {
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
      total: 4
    })
    expect(view.collegeChartHasData.value).toBe(true)

    // 切月 → 重新请求该月数据；该月无数据 → 空数组（整列不画，不造假柱）
    mockedGet.mockClear()
    mockedGet.mockResolvedValue({ year: 2026, month: 11, colleges: [] })
    view.collegeSelectedMonth.value = 11
    view.handleCollegeMonthChange()
    await flushPromises()

    expect(mockedGet).toHaveBeenCalledWith('/dashboard/college-levels', {
      year: 2026,
      month: 11
    })
    expect(view.collegeBarData.value).toEqual([])
    expect(view.collegeChartHasData.value).toBe(false)
    expect(view.collegeChartEmptyText.value).toBe('该月暂无学院上报数据')
  })

  it('趋势与分院排名同源 college-levels-trend：x 轴只画接口返回月份，排名按完成率重排', async () => {
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

    // 分院排名：默认排名月与趋势同源，分数 = 完成率
    const rankingMonth = view.collegeRankingMonth.value
    const rankingSource = contractTrend.months.find(m => m.month === rankingMonth)
    expect(view.getCollegeRankingData.value.map(row => row.fullName)).toEqual(
      (rankingSource?.colleges ?? []).map(college => college.orgName)
    )
    expect(view.getCollegeRankingData.value[0]?.value).toBe(100)
  })

  it('接口失败时清空数据走空态，不静默造假数据', async () => {
    setActivePinia(createPinia())
    mockedGet.mockRejectedValue({ code: 500, message: 'server error' })

    const view = useDashboardView({})
    await view.loadCollegeLevels()
    await flushPromises()

    expect(view.collegeBarData.value).toEqual([])
    expect(view.collegeLevelsLoading.value).toBe(false)
    expect(view.collegeChartHasData.value).toBe(false)
  })
})
