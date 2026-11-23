/**
 * 数据看板按月快照口径单测（2026-11-18）
 *
 * 契约（后端 fix/dashboard-month-snapshot 分支，联调前以本契约开发）：
 * - appraisal-summary / college-levels 响应携带 monthState（APPROVED/IN_REVIEW/NOT_REPORTED）
 *   与 reported 标记；只有 APPROVED 月份出鉴定值。
 * - 前端渲染：部门分布图非 APPROVED 月份柱形一律置灰（#C0C4CC 系）+ tooltip 状态说明；
 *   学院卡 2026-11-22 起改按线分段混色（灰段=已下发−三档合计，灰彩同柱并存），
 *   tooltip 为单行四段计数「已下发 X 项 ｜ 超前 a · 正常 b · 滞后 c · 未走完 d」（和=X），
 *   不提示未下发数；X=0 或无数据不出 tooltip。
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
  collegeGraySegmentCount,
  collegeTooltipCountsLine,
  isGrayMonth,
  monthStateDeptTooltip,
  monthStateGrayLabel,
  resolveMonthState
} from '@/features/dashboard/lib/summaryMetrics'
import type {
  DashboardAppraisalSummaryResponse,
  DashboardCollegeLevelsResponse,
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

  it('置灰文案：部门=该部门本月…，排名条短标签=未填报/审批中', () => {
    expect(monthStateDeptTooltip('NOT_REPORTED')).toBe('该部门本月未填报')
    expect(monthStateDeptTooltip('IN_REVIEW')).toBe('该部门本月上报审批中')
    expect(monthStateGrayLabel('NOT_REPORTED')).toBe('未填报')
    expect(monthStateGrayLabel('IN_REVIEW')).toBe('审批中')
  })

  // 2026-11-22 学院卡按线分段混色：灰段 = 已下发 − (超前+正常+滞后)，灰彩可同柱并存
  it('collegeGraySegmentCount 灰段数 = 已下发 − 三档合计（负数截 0、缺省按 0）', () => {
    // 部分线走完：1 彩 + 4 灰并存（文理学院场景）
    expect(collegeGraySegmentCount({ dispatchedCount: 5, ahead: 1, normal: 0, delayed: 0 })).toBe(4)
    // 全彩无灰：三档合计 = 已下发（计算机学院场景）
    expect(collegeGraySegmentCount({ dispatchedCount: 6, ahead: 2, normal: 3, delayed: 1 })).toBe(0)
    // 零走完全灰（航空学院场景）
    expect(collegeGraySegmentCount({ dispatchedCount: 4, ahead: 0, normal: 0, delayed: 0 })).toBe(4)
    // 绿红并存无灰（工学院场景）
    expect(collegeGraySegmentCount({ dispatchedCount: 5, ahead: 0, normal: 3, delayed: 2 })).toBe(0)
    // 数据异常（三档 > 已下发）防御性截 0，不出负灰段
    expect(collegeGraySegmentCount({ dispatchedCount: 2, ahead: 3, normal: 1, delayed: 0 })).toBe(0)
    // 缺省字段（旧响应兼容）按 0 处理
    expect(collegeGraySegmentCount({})).toBe(0)
    expect(collegeGraySegmentCount({ ahead: 2 })).toBe(0)
  })

  // 2026-11-22 tooltip 定稿：单行四段计数，和 = 已下发 = 柱高；不提示未下发；X=0 不出 tooltip
  it('collegeTooltipCountsLine 单行四段计数（和=已下发、不含未下发、X=0/缺省返回 null）', () => {
    // 四学院场景逐字断言（与截图渲染一致）
    expect(collegeTooltipCountsLine({ dispatchedCount: 6, ahead: 2, normal: 3, delayed: 1 })).toBe(
      '已下发 6 项 ｜ 超前 2 · 正常 3 · 滞后 1 · 未走完 0'
    )
    expect(collegeTooltipCountsLine({ dispatchedCount: 5, ahead: 1, normal: 0, delayed: 0 })).toBe(
      '已下发 5 项 ｜ 超前 1 · 正常 0 · 滞后 0 · 未走完 4'
    )
    expect(collegeTooltipCountsLine({ dispatchedCount: 4, ahead: 0, normal: 0, delayed: 0 })).toBe(
      '已下发 4 项 ｜ 超前 0 · 正常 0 · 滞后 0 · 未走完 4'
    )
    expect(collegeTooltipCountsLine({ dispatchedCount: 5, ahead: 0, normal: 3, delayed: 2 })).toBe(
      '已下发 5 项 ｜ 超前 0 · 正常 3 · 滞后 2 · 未走完 0'
    )

    // 四段计数之和 = 已下发（正好对应柱高彩段+灰段）
    const line = collegeTooltipCountsLine({ dispatchedCount: 5, ahead: 0, normal: 3, delayed: 2 })
    const nums = (line ?? '').match(/\d+/g)?.map(Number) ?? []
    expect(nums).toHaveLength(5)
    expect(nums[1] + nums[2] + nums[3] + nums[4]).toBe(nums[0])

    // 不再提示未下发数（口径：未下发不在柱子上，看板不重复提示）
    expect(line).not.toContain('未下发')

    // X=0 或无数据（缺省）→ null（调用方不出 tooltip）
    expect(
      collegeTooltipCountsLine({ dispatchedCount: 0, ahead: 0, normal: 0, delayed: 0 })
    ).toBeNull()
    expect(collegeTooltipCountsLine({})).toBeNull()
    expect(collegeTooltipCountsLine({ undispatchedCount: 3 })).toBeNull()
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

describe('useDashboardView 简报空态判定 briefMonthApproved（2026-11-18 折中方案）', () => {
  /** 构造 college-levels 响应 */
  const levelsResponse = (
    colleges: DashboardCollegeLevelsResponse['colleges']
  ): DashboardCollegeLevelsResponse => ({ year: 2026, month: 10, colleges })

  const loadLevels = async (colleges: DashboardCollegeLevelsResponse['colleges']) => {
    setActivePinia(createPinia())
    mockedGet.mockImplementation(async (url: string) => {
      if (url === '/dashboard/college-levels') {
        return levelsResponse(colleges)
      }
      return { year: 2026, month: 10, colleges: [] }
    })
    const view = useDashboardView({})
    await view.loadCollegeLevels()
    await flushPromises()
    return view
  }

  it('全部行非 APPROVED（未填报/审批中）→ 空态（briefMonthApproved=false）', async () => {
    const view = await loadLevels([
      {
        orgId: 1,
        orgName: '计算机学院',
        ahead: 0,
        normal: 0,
        delayed: 0,
        total: 0,
        reported: false
      },
      {
        orgId: 2,
        orgName: '电子信息学院',
        ahead: 0,
        normal: 0,
        delayed: 0,
        total: 0,
        reported: true,
        monthState: 'IN_REVIEW',
        dispatchedCount: 4
      }
    ])
    expect(view.briefMonthApproved.value).toBe(false)
  })

  it('colleges 为空（当月无数据）→ 空态', async () => {
    const view = await loadLevels([])
    expect(view.briefMonthApproved.value).toBe(false)
  })

  it('含 APPROVED 行且有鉴定值 → 完整简报（briefMonthApproved=true）', async () => {
    const view = await loadLevels([
      {
        orgId: 1,
        orgName: '计算机学院',
        ahead: 3,
        normal: 1,
        delayed: 0,
        total: 4,
        reported: true,
        monthState: 'APPROVED',
        dispatchedCount: 5
      },
      {
        orgId: 2,
        orgName: '电子信息学院',
        ahead: 0,
        normal: 0,
        delayed: 0,
        total: 0,
        reported: false,
        monthState: 'NOT_REPORTED',
        dispatchedCount: 4
      }
    ])
    expect(view.briefMonthApproved.value).toBe(true)
    // 未填报督办提示两条状态都保留（简报正文外独立渲染）
    expect(view.collegeSupervision.value.unreportedColleges).toBe(1)
    expect(view.collegeSupervision.value.dispatchedTotal).toBe(9)
  })

  it('旧响应兼容（无 monthState）：reported=true 但鉴定三档全 0 且无未填报 → 无审定内容，空态', async () => {
    const view = await loadLevels([
      { orgId: 1, orgName: '计算机学院', ahead: 0, normal: 0, delayed: 0, total: 0, reported: true }
    ])
    expect(view.briefMonthApproved.value).toBe(false)
  })

  it('旧行含鉴定值（无 monthState，兜底 APPROVED）→ 完整简报', async () => {
    const view = await loadLevels([
      { orgId: 1, orgName: '计算机学院', ahead: 2, normal: 1, delayed: 1, total: 4, reported: true }
    ])
    expect(view.briefMonthApproved.value).toBe(true)
  })
})
