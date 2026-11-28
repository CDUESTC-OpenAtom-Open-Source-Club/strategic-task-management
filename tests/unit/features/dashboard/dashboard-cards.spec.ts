/**
 * 数据看板卡片渲染契约（2026-11-27）
 *
 * 外部测试按 document.body.textContent 抓页面文字，藏在 DOM 里的空态文案会被当成缺陷上报：
 * - 未选部门时「指标完成情况」卡不渲染进 DOM（原先是 v-show，只是 display:none，
 *   「· 0 项指标」「该部门暂无接收的指标」仍留在 DOM 里）；
 * - 选中部门后卡片渲染并列出指标；选了部门但确实 0 条时空态文案保留；
 * - 下钻后未选月份时，部门 / 学院的月份指标卡同样不渲染（原 v-show 会留下「该月份暂无指标数据」）；
 * - 指标异动汇总接上数据源：有异动时渲染清单（原模板取不到该绑定，恒为空态）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import type { VueWrapper } from '@vue/test-utils'

const noop = vi.fn()

type IndicatorRow = {
  id: string
  name: string
  type1: string
  progress: number
  status: string
}

type MutationItem = {
  id: number
  indicator_desc: string
  weight_percent: number
  mutation_started_at?: string
}

const holder = vi.hoisted(() => ({ model: null as null | Record<string, unknown> }))

vi.mock('@/features/dashboard/model/useDashboardView', () => ({
  useDashboardView: () => {
    if (!holder.model) {
      throw new Error('看板模型未初始化')
    }
    return holder.model
  },
  type: {}
}))

import DashboardView from '@/features/dashboard/ui/DashboardView.vue'

const indicatorRows: IndicatorRow[] = [
  { id: '1', name: '经费增长15%，总量达到1200万', type1: '定量', progress: 0, status: 'normal' },
  { id: '2', name: '获批省部级项目5项以上', type1: '定量', progress: 0, status: 'normal' }
]

/**
 * 看板模型桩：模板从 useDashboardView 解构绑定，可变状态用 ref 提供（解构后仍是响应式），
 * 其余键给固定值；未列出的 handle、get 等前缀的键按函数兜底（与既有看板 spec 同一做法）。
 */
const buildModel = () => {
  const state = {
    isDrillDown: ref(false),
    drilledDept: ref(''),
    showIndicatorCard: ref(false),
    selectedBenchmarkDept: ref<string | null>(null),
    selectedDeptIndicators: ref<IndicatorRow[]>([]),
    selectedDeptStats: ref({ ahead: 0, normal: 0, warning: 0, delayed: 0 }),
    filteredDeptIndicators: ref<IndicatorRow[]>([]),
    selectedStatusFilter: ref<string | null>(null),
    showMonthIndicatorCard: ref(false),
    selectedMonthInDrillDown: ref<number | null>(null),
    monthIndicators: ref<IndicatorRow[]>([]),
    filteredMonthIndicators: ref<IndicatorRow[]>([]),
    monthIndicatorStats: ref({ ahead: 0, normal: 0, warning: 0, delayed: 0 }),
    isCollegeDrillDown: ref(false),
    drilledCollege: ref(''),
    showCollegeMonthIndicatorCard: ref(false),
    selectedMonthInCollegeDrillDown: ref<number | null>(null),
    collegeMonthIndicators: ref<IndicatorRow[]>([]),
    filteredCollegeMonthIndicators: ref<IndicatorRow[]>([]),
    collegeMonthIndicatorStats: ref({ ahead: 0, normal: 0, warning: 0, delayed: 0 }),
    mutationSummary: ref<MutationItem[]>([])
  }
  const fixed = {
    timeContext: { currentYear: 2026 },
    dashboardStore: {
      breadcrumbs: [] as unknown[],
      currentOrgLevel: 'strategy',
      sankeyData: { nodes: [], links: [] }
    },
    helpTexts: {
      alertDistribution: '等级分布口径',
      completionRate: '完成率口径',
      delayedTasks: '滞后清单口径'
    },
    collegeSupervision: {
      ahead: 0,
      normal: 485,
      delayed: 76,
      dispatchedTotal: 561,
      appraisedTotal: 561,
      completionRate: 86,
      unreportedColleges: 0,
      unreportedNames: [] as string[]
    },
    dashboardData: {
      completionRate: 86,
      totalIndicators: 561,
      completedIndicators: 485,
      levelDistribution: { ahead: 0, normal: 485, delayed: 76 }
    },
    currentRole: 'strategic_dept',
    // 显式给 false：函数兜底会让 is* 前缀的键变成 truthy，误进骨架屏 / 空态 / 降级分支
    isDataLoading: false,
    isDataEmpty: false,
    isFallbackMode: false,
    selectedMonth: 11,
    collegeSelectedMonth: 11,
    collegeRankingMonth: 11,
    collegeLevelsLoading: false,
    collegeTrendLoading: false,
    delayedTasksLoading: false,
    delayedTasks: [] as unknown[],
    briefMonthApproved: true,
    selectedIndicatorDetail: null
  }
  const model = new Proxy(
    { ...fixed, ...state },
    {
      get(target, prop) {
        if (prop in target) {
          return target[prop as keyof typeof target]
        }
        if (typeof prop === 'string') {
          if (
            /^(handle|get|set|open|close|save|submit|load|refresh|apply|remove|add|cancel|select|trigger|normalize|resolve|persist|clear|sort|sync|restart|poll|wait|before|upload|write|read|can|is|has|format)/.test(
              prop
            )
          ) {
            return () => ''
          }
        }
        return undefined
      }
    }
  )
  return { model, state }
}

const mountOptions = {
  global: {
    directives: {
      loading: noop,
      focus: noop
    },
    stubs: {
      teleport: true,
      'el-card': {
        template: '<div class="el-card-stub"><slot name="header" /><slot /></div>'
      },
      'el-button': {
        template:
          '<button type="button" class="el-button" @click="$emit(\'click\')"><slot /></button>'
      },
      // 空态文案要真的渲染出来，才能断言它是否留在 DOM 里
      'el-empty': {
        props: ['description'],
        template: '<div class="el-empty-stub">{{ description }}</div>'
      },
      'el-popover': {
        template: '<div class="el-popover-stub"><slot name="reference" /></div>'
      },
      'el-progress': {
        props: ['percentage'],
        template: '<div class="el-progress"><slot :percentage="percentage ?? 0" /></div>'
      }
    }
  }
}

let current: ReturnType<typeof buildModel> | null = null

const mountDashboard = (): VueWrapper => {
  current = buildModel()
  holder.model = current.model
  return shallowMount(DashboardView, {
    props: { viewingRole: 'strategic_dept', viewingDept: '战略发展部' },
    ...mountOptions
  })
}

const stateOf = () => {
  if (!current) {
    throw new Error('未挂载')
  }
  return current.state
}

beforeEach(() => {
  holder.model = null
  current = null
})

describe('指标完成情况卡（STATUS）', () => {
  it('未选部门：卡片不渲染进 DOM，空态文案不出现在页面文字里', () => {
    const wrapper = mountDashboard()

    expect(wrapper.find('.benchmark-section .indicator-status-card').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('该部门暂无接收的指标')
    expect(wrapper.text()).not.toContain('0 项指标')
    // 展开 / 收起动画的载体（外层列与包装层）仍在，只是没有卡片内容
    expect(wrapper.find('.benchmark-section .indicator-col').exists()).toBe(true)
    expect(wrapper.find('.benchmark-section .indicator-card-wrapper').exists()).toBe(true)
    expect(wrapper.find('.benchmark-section .indicator-col').classes()).not.toContain('visible')
  })

  it('选中部门：卡片渲染并列出该部门的指标', async () => {
    const wrapper = mountDashboard()
    const state = stateOf()

    state.selectedBenchmarkDept.value = '教务处'
    state.showIndicatorCard.value = true
    state.selectedDeptIndicators.value = indicatorRows
    state.filteredDeptIndicators.value = indicatorRows
    state.selectedDeptStats.value = { ahead: 0, normal: 2, warning: 0, delayed: 0 }
    await nextTick()

    const card = wrapper.find('.benchmark-section .indicator-status-card')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('教务处 · 2 项指标')
    expect(card.findAll('.indicator-status-item')).toHaveLength(2)
    expect(card.text()).toContain('经费增长15%，总量达到1200万')
    expect(card.text()).toContain('获批省部级项目5项以上')
    expect(wrapper.find('.benchmark-section .indicator-col').classes()).toContain('visible')
  })

  it('选了部门但确实 0 条：标题与空态文案保留', async () => {
    const wrapper = mountDashboard()
    const state = stateOf()

    state.selectedBenchmarkDept.value = '教务处'
    state.showIndicatorCard.value = true
    await nextTick()

    const card = wrapper.find('.benchmark-section .indicator-status-card')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('教务处 · 0 项指标')
    expect(card.text()).toContain('该部门暂无接收的指标')
  })

  it('关闭：先收起（卡片仍在 DOM，留给退出动画），部门置空后才移出 DOM', async () => {
    const wrapper = mountDashboard()
    const state = stateOf()

    state.selectedBenchmarkDept.value = '教务处'
    state.showIndicatorCard.value = true
    state.selectedDeptIndicators.value = indicatorRows
    state.filteredDeptIndicators.value = indicatorRows
    await nextTick()

    state.showIndicatorCard.value = false
    await nextTick()
    expect(wrapper.find('.benchmark-section .indicator-status-card').exists()).toBe(true)
    expect(wrapper.find('.benchmark-section .indicator-col').classes()).not.toContain('visible')

    state.selectedBenchmarkDept.value = null
    await nextTick()
    expect(wrapper.find('.benchmark-section .indicator-status-card').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('0 项指标')
  })
})

describe('下钻后的月份指标卡', () => {
  it('部门下钻未选月份：卡片不渲染，「该月份暂无指标数据」不在 DOM', async () => {
    const wrapper = mountDashboard()
    const state = stateOf()

    state.isDrillDown.value = true
    state.drilledDept.value = '教务处'
    await nextTick()

    expect(wrapper.find('.benchmark-section .card-title').text()).toContain('教务处 - 月度趋势')
    expect(wrapper.find('.benchmark-section .indicator-status-card').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('该月份暂无指标数据')

    // 点了月份柱子：卡片渲染并列出该月指标
    state.selectedMonthInDrillDown.value = 11
    state.showMonthIndicatorCard.value = true
    state.monthIndicators.value = indicatorRows
    state.filteredMonthIndicators.value = indicatorRows
    state.monthIndicatorStats.value = { ahead: 0, normal: 2, warning: 0, delayed: 0 }
    await nextTick()

    const card = wrapper.find('.benchmark-section .indicator-status-card')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('教务处 - 11月指标')
    expect(card.findAll('.indicator-status-item')).toHaveLength(2)
  })

  it('学院下钻未选月份：卡片不渲染，「该月份暂无指标数据」不在 DOM', async () => {
    const wrapper = mountDashboard()
    const state = stateOf()

    state.isCollegeDrillDown.value = true
    state.drilledCollege.value = '计算机学院'
    await nextTick()

    expect(wrapper.find('.college-section .indicator-status-card').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('该月份暂无指标数据')

    state.selectedMonthInCollegeDrillDown.value = 11
    state.showCollegeMonthIndicatorCard.value = true
    state.collegeMonthIndicators.value = indicatorRows
    state.filteredCollegeMonthIndicators.value = indicatorRows
    await nextTick()

    const card = wrapper.find('.college-section .indicator-status-card')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('计算机学院 - 11月指标')
  })
})

describe('指标异动汇总', () => {
  it('无异动：显示空态', () => {
    const wrapper = mountDashboard()

    const card = wrapper.findAll('.el-card-stub').find(stub => stub.text().includes('指标异动汇总'))
    expect(card?.text()).toContain('当前无异动中的指标')
  })

  it('有异动：渲染异动指标清单', async () => {
    const wrapper = mountDashboard()
    const state = stateOf()

    state.mutationSummary.value = [
      {
        id: 9,
        indicator_desc: '科研经费总量达到 1200 万',
        weight_percent: 5,
        mutation_started_at: '2026-11-20T10:00:00'
      }
    ]
    await nextTick()

    const items = wrapper.findAll('.mutation-summary__item')
    expect(items).toHaveLength(1)
    expect(items[0]?.text()).toContain('科研经费总量达到 1200 万')
    expect(items[0]?.text()).toContain('2026-11-20 起')
    expect(wrapper.text()).not.toContain('当前无异动中的指标')
  })
})
