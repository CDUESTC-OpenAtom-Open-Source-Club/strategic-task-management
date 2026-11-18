/**
 * 数据看板按月快照口径单测（2026-11-18）
 *
 * 契约（后端 fix/dashboard-month-snapshot 分支，联调前以本契约开发）：
 * - appraisal-summary / college-levels 响应携带 monthState（APPROVED/IN_REVIEW/NOT_REPORTED）
 *   与 reported 标记；只有 APPROVED 月份出鉴定值。
 * - 前端渲染：非 APPROVED 月份柱形一律置灰（#C0C4CC 系）+ tooltip 状态说明；
 *   monthState 兜底优先级 = 行级 > 月级 > 响应级 > reported=false → NOT_REPORTED > APPROVED。
 * - PR #127 评审意见 A：appraisal-summary 接口失败一律空态 + 错误提示，
 *   不再回退前端启发式（getDeptStatsAtMonth 已删除）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  isGrayMonth,
  monthStateCollegeTooltip,
  monthStateDeptTooltip,
  monthStateGrayLabel,
  resolveMonthState
} from '@/features/dashboard/lib/summaryMetrics'
import type {
  DashboardAppraisalSummaryResponse,
  DashboardMonthState
} from '@/features/dashboard/api/dashboardApi'
import { useDashboardView } from '@/features/dashboard/model/useDashboardView'
import { useOrgStore } from '@/features/organization/model/store'

const mockedGet = vi.mocked(apiClient.get)

/** 职能部门组织（orgStore 种子，type=functional_dept 才会进部门分布图 x 轴） */
const seedFunctionalDepts = [
  { id: '1', name: '党委办公室', type: 'functional_dept' as const, sortOrder: 1 },
  { id: '2', name: '人力资源部', type: 'functional_dept' as const, sortOrder: 2 },
  { id: '3', name: '保卫处', type: 'functional_dept' as const, sortOrder: 3 }
]

/** appraisal-summary 契约样本：三个部门分别覆盖 APPROVED / 兜底 NOT_REPORTED / IN_REVIEW */
const summaryApproved: DashboardAppraisalSummaryResponse = {
  year: 2026,
  month: 10,
  latestMonth: 10,
  monthState: 'APPROVED',
  departments: [
    {
      orgId: 1,
      orgName: '党委办公室',
      ahead: 2,
      normal: 1,
      delayed: 0,
      total: 3,
      reported: true,
      monthState: 'APPROVED'
    },
    {
      orgId: 2,
      orgName: '人力资源部',
      ahead: 0,
      normal: 0,
      delayed: 0,
      total: 0,
      reported: false
    },
    {
      orgId: 3,
      orgName: '保卫处',
      ahead: 1,
      normal: 0,
      delayed: 1,
      total: 2,
      reported: false,
      monthState: 'IN_REVIEW',
      dispatchedCount: 5
    }
  ],
  departmentMonths: []
}

beforeEach(() => {
  mockedGet.mockReset()
})

describe('月份快照状态解析（resolveMonthState / isGrayMonth / 文案）', () => {
  it('兜底优先级：行级 monthState > 行级 reported=false > 月级 > 响应级 > APPROVED', () => {
    expect(resolveMonthState({ monthState: 'IN_REVIEW' })).toBe('IN_REVIEW')
    // 行内明确 reported=false 优先于整月 APPROVED 包裹（个别部门不因整月状态解除置灰）
    expect(resolveMonthState({ reported: false }, { monthState: 'APPROVED' })).toBe('NOT_REPORTED')
    expect(resolveMonthState({ monthState: 'NOT_REPORTED' }, { monthState: 'APPROVED' })).toBe(
      'NOT_REPORTED'
    )
    expect(resolveMonthState(undefined, undefined, { monthState: 'NOT_REPORTED' })).toBe(
      'NOT_REPORTED'
    )
    expect(resolveMonthState(undefined, { monthState: 'IN_REVIEW' })).toBe('IN_REVIEW')
    expect(resolveMonthState({ reported: false })).toBe('NOT_REPORTED')
    expect(resolveMonthState({ reported: true })).toBe('APPROVED')
    expect(resolveMonthState(undefined)).toBe('APPROVED')
  })

  it('非 APPROVED 一律置灰：IN_REVIEW/NOT_REPORTED 是灰、APPROVED 不是灰', () => {
    expect(isGrayMonth('APPROVED')).toBe(false)
    expect(isGrayMonth('IN_REVIEW')).toBe(true)
    expect(isGrayMonth('NOT_REPORTED')).toBe(true)
  })

  it('置灰文案：部门=该部门本月…，学院=本月…，排名条短标签=未填报/审批中', () => {
    expect(monthStateDeptTooltip('NOT_REPORTED')).toBe('该部门本月未填报')
    expect(monthStateDeptTooltip('IN_REVIEW')).toBe('该部门本月上报审批中')
    expect(monthStateCollegeTooltip('NOT_REPORTED')).toBe('本月未填报（灰柱督办）')
    expect(monthStateCollegeTooltip('IN_REVIEW')).toBe('本月上报审批中（灰柱督办）')
    expect(monthStateGrayLabel('NOT_REPORTED')).toBe('未填报')
    expect(monthStateGrayLabel('IN_REVIEW')).toBe('审批中')
  })
})

describe('useDashboardView 部门分布图按月快照置灰（API 供数 + 失败空态）', () => {
  it('stackedBarData 逐部门带 monthState（行级/兜底），非 APPROVED 部门可被置灰', async () => {
    setActivePinia(createPinia())
    const orgStore = useOrgStore()
    orgStore.departments = [...seedFunctionalDepts]
    mockedGet.mockImplementation(async (url: string) => {
      if (url === '/dashboard/appraisal-summary') {
        return summaryApproved
      }
      return { year: 2026, month: 10, colleges: [] }
    })

    const view = useDashboardView({})
    await view.loadAppraisalSummary()
    await flushPromises()

    const rows = view.stackedBarData.value
    expect(rows.map(row => row.fullName)).toEqual(['党委办公室', '人力资源部', '保卫处'])
    expect(rows[0]).toMatchObject({
      ahead: 2,
      normal: 1,
      delayed: 0,
      total: 3,
      monthState: 'APPROVED'
    })
    // 行无 monthState、reported=false → 兜底 NOT_REPORTED（置灰）
    expect(rows[1]).toMatchObject({ monthState: 'NOT_REPORTED' })
    // IN_REVIEW：置灰 + 灰柱高度数据源（已下发数）
    expect(rows[2]).toMatchObject({ monthState: 'IN_REVIEW', dispatchedCount: 5 })
    expect(view.benchmarkChartHasData.value).toBe(true)
  })

  it('appraisal-summary 接口失败 → 空态（不回退启发式，PR #127 评审意见 A）', async () => {
    setActivePinia(createPinia())
    const orgStore = useOrgStore()
    orgStore.departments = [...seedFunctionalDepts]
    mockedGet.mockRejectedValue({ code: 500, message: 'server error' })

    const view = useDashboardView({})
    await view.loadAppraisalSummary()
    await flushPromises()

    expect(view.stackedBarData.value).toEqual([])
    expect(view.monthlyStackedData.value).toEqual([])
    expect(view.benchmarkChartHasData.value).toBe(false)
    expect(view.benchmarkChartEmptyText.value).toBe(
      '该月暂无部门鉴定数据（接口不可用或后端无数据）'
    )
  })

  it('下钻月度趋势：月级 monthState 注入该月全部部门行，缺失月份按 APPROVED 全 0', async () => {
    setActivePinia(createPinia())
    const orgStore = useOrgStore()
    orgStore.departments = [...seedFunctionalDepts]
    const snapshot: DashboardAppraisalSummaryResponse = {
      year: 2026,
      month: 10,
      latestMonth: 10,
      departments: summaryApproved.departments,
      departmentMonths: [
        {
          month: 9,
          monthState: 'IN_REVIEW',
          departments: [
            {
              orgId: 3,
              orgName: '保卫处',
              ahead: 0,
              normal: 0,
              delayed: 0,
              total: 0,
              reported: true,
              dispatchedCount: 4
            }
          ]
        },
        {
          month: 10,
          departments: [
            {
              orgId: 3,
              orgName: '保卫处',
              ahead: 0,
              normal: 0,
              delayed: 0,
              total: 0,
              reported: false
            }
          ]
        }
      ]
    }
    mockedGet.mockImplementation(async (url: string) => {
      if (url === '/dashboard/appraisal-summary') {
        return snapshot
      }
      return { year: 2026, month: 10, colleges: [] }
    })

    const view = useDashboardView({})
    await view.loadAppraisalSummary()
    await flushPromises()

    view.isDrillDown.value = true
    view.drilledDept.value = '保卫处'
    await flushPromises()

    const rows = view.monthlyStackedData.value
    expect(rows).toHaveLength(view.selectedMonth.value)
    const byMonth = new Map(rows.map(row => [row.month, row]))
    // 9 月：月级 monthState=IN_REVIEW → 置灰（行未给 monthState）
    expect(byMonth.get(9)?.monthState).toBe('IN_REVIEW')
    expect(byMonth.get(9)?.dispatchedCount).toBe(4)
    // 10 月：行级 reported=false → 兜底 NOT_REPORTED（置灰）
    expect(byMonth.get(10)?.monthState).toBe('NOT_REPORTED')
    // 8 月：快照未含该月 → APPROVED 全 0（不乱置灰）
    expect(byMonth.get(8)).toMatchObject({ monthState: 'APPROVED', ahead: 0, total: 0 })
  })

  it('响应级 monthState 兜底：行/月都缺省时整月按响应级状态置灰', async () => {
    setActivePinia(createPinia())
    const orgStore = useOrgStore()
    orgStore.departments = [...seedFunctionalDepts]
    const snapshot: DashboardAppraisalSummaryResponse = {
      year: 2026,
      month: 10,
      latestMonth: 10,
      monthState: 'NOT_REPORTED',
      departments: [
        {
          orgId: 1,
          orgName: '党委办公室',
          ahead: 0,
          normal: 0,
          delayed: 0,
          total: 0
        }
      ],
      departmentMonths: []
    }
    mockedGet.mockImplementation(async (url: string) => {
      if (url === '/dashboard/appraisal-summary') {
        return snapshot
      }
      return { year: 2026, month: 10, colleges: [] }
    })

    const view = useDashboardView({})
    await view.loadAppraisalSummary()
    await flushPromises()

    const row = view.stackedBarData.value.find(item => item.fullName === '党委办公室')
    expect(row?.monthState).toBe<DashboardMonthState>('NOT_REPORTED')
  })
})
