/**
 * 全校任务流转图（桑基图）下钻可见性回归（2026-11-17 领导催办修复）
 *
 * 修复前：DashboardView 模板 v-if 带 `currentOrgLevel === 'strategy'`，点击桑基节点
 *         下钻（drillDownToDepartment → currentOrgLevel 变 functional/college）后整卡
 *         确定性消失，唯一复原入口是左上角面包屑「组织总览」。
 * 修复后：卡片对战略发展部角色常驻；下钻后卡头出现「返回全校视图」按钮，一键复位。
 *
 * 组件级契约：
 * 1. strategy 层级：流转图卡可见、无返回按钮
 * 2. 节点点击下钻（currentOrgLevel 变 functional/college）：卡仍可见 + 返回按钮出现
 * 3. 点返回按钮：复位到 strategy 层级，按钮消失
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'

const noop = vi.fn()

/** 模拟 store 的三级联动状态（DashboardView 模板只消费这 5 个 store 绑定） */
const dashboardStoreState = reactive({
  currentOrgLevel: 'strategy',
  sankeyData: {
    nodes: [
      { name: '战略发展部', depth: 0 },
      { name: '教务处', depth: 1 },
      { name: '计算机学院', depth: 2 }
    ],
    links: [
      { source: '战略发展部', target: '教务处', value: 2 },
      { source: '教务处', target: '计算机学院', value: 3 }
    ]
  },
  breadcrumbs: [] as unknown[],
  departmentSummary: [] as unknown[]
})

function createDashboardViewModel() {
  // 与 tests/unit/page-shell-smoke.spec.ts 同一基座（保证模板全量绑定可渲染），
  // 差异点：dashboardStore 用 reactive 三级联动状态 + 桑基图/面包屑可控行为
  const base = {
    timeContext: { isReadOnly: false, currentYear: 2026, cycles: [] },
    canWriteStrategicTask: true,
    isStrategicDeptLogin: true,
    isFunctionalDeptLogin: false,
    canOperateDistribution: true,
    canWriteDistribution: true,
    canWithdrawDistribution: true,
    canEditChild: true,
    authStore: {
      userRole: 'strategic_dept',
      effectiveRole: 'strategic_dept',
      effectiveDepartment: '战略发展部',
      userDepartment: '战略发展部',
      user: { permissions: [], roles: [], name: 'Tester', userId: 1 }
    },
    overallStatus: { type: 'info', label: '草稿' },
    approvalFlowStatusMeta: { tagType: 'info', label: '未发起', description: '' },
    currentApprovalStatusMeta: { tagType: 'info', label: '未发起', description: '' },
    currentMonthlyReportStatusMeta: { type: 'info', label: '未填报' },
    monthlySequenceStatusMeta: { type: 'info', label: '10月未上报' },
    currentApprovalCandidateNames: [] as string[],
    currentApprovalFlowName: '',
    currentApprovalStepName: '',
    currentApprovalWorkflowStatus: '',
    indicators: [] as unknown[],
    functionalDepartments: [] as string[],
    collegeDepartmentsScoped: [] as string[],
    availableOwnerDepts: [] as string[],
    buildCollegeExportRowsByOwnerDept: vi.fn(() => []),
    hasMutationDraft: false,
    mutationDraftLabels: [] as string[],
    mutationApiLoading: false,
    selectedDepartment: '',
    currentIndicator: null,
    selectedIndicators: [] as unknown[],
    currentDetail: null,
    currentDistributeItem: null,
    currentDistributeGroup: null,
    distributeTarget: [] as string[],
    filteredColleges: [] as string[],
    colleges: [] as string[],
    selectedCollege: '',
    currentDept: '战略发展部',
    currentPlan: null,
    currentDepartmentPlan: null,
    currentDepartmentOrgId: null,
    currentDepartmentOrgIdFromTable: null,
    currentSelectedCollegePlan: null,
    currentSelectedCollegePlanDetails: null,
    dashboardData: {
      totalScore: 0,
      basicScore: 0,
      developmentScore: 0,
      completionRate: 0,
      warningCount: 0,
      totalIndicators: 0,
      completedIndicators: 0,
      alertIndicators: { severe: 0, moderate: 0, normal: 0 }
    },
    collegeSupervision: {
      ahead: 0,
      normal: 0,
      delayed: 0,
      dispatchedTotal: 0,
      appraisedTotal: 0,
      completionRate: 0,
      unreportedColleges: 0,
      unreportedNames: [] as string[]
    },
    dashboardStore: dashboardStoreState,
    currentRole: 'strategic_dept',
    currentDepartment: '战略发展部',
    // 显式给 null：proxy 兜底会把 selected* 前缀键变成函数（truthy），导致行详情卡误渲染
    selectedIndicatorDetail: null,
    delayedTasks: [] as unknown[],
    delayedTasksLoading: false,
    helpTexts: {
      delayedTasks: '滞后任务',
      warningCount: '滞后任务数',
      totalScore: '总分',
      basicScore: '基础分',
      developmentScore: '发展分',
      scoreComposition: '得分构成',
      alertDistribution: '等级分布',
      completionRate: '完成率',
      departmentProgress: '部门进度',
      benchmark: '基准对比',
      radar: '雷达',
      aiBriefing: '简报'
    },
    _kpiCards: [] as unknown[],
    benchmarkData: [] as unknown[],
    collegeBarData: [] as unknown[],
    monthIndicators: [] as unknown[],
    filteredMonthIndicators: [] as unknown[],
    filteredDeptIndicators: [] as unknown[],
    collegeMonthIndicators: [] as unknown[],
    filteredCollegeMonthIndicators: [] as unknown[],
    availableFunctionalDepts: [] as string[],
    showStrategicTaskColumn: true,
    showResponsibleDeptColumn: true,
    showPlanBatchActions: false,
    showSubmitAllButton: false,
    showWithdrawAllButton: false,
    currentPlanStatusMeta: { type: 'info', label: '草稿', text: '草稿' },
    currentPlanStatus: 'DRAFT',
    canViewReceivedPlanContent: true,
    isDataLoading: false,
    isDataEmpty: false,
    canViewAllDepartments: true,
    showSkeleton: false,
    pageHasError: false,
    filterForm: {},
    newRow: {
      type1: '定性',
      type2: '基础性',
      weight: 0,
      name: '',
      remark: '',
      taskContent: ''
    },
    newIndicatorForm: {
      type1: '定性',
      type2: '基础性',
      weight: 0,
      name: '',
      remark: '',
      taskContent: ''
    },
    reportForm: { attachments: [] },
    reportUploadFiles: [] as unknown[],
    collegeTableData: [] as unknown[],
    currentPlanIndicators: [] as unknown[],
    plansWithIndicators: [] as unknown[],
    taskList: [] as unknown[],
    taskOptions: [] as unknown[],
    // 节点点击下钻：与真实 drillDownToDepartment 同效果（currentOrgLevel 切换）
    handleSankeyNodeClick: (nodeName: string) => {
      dashboardStoreState.currentOrgLevel = nodeName.includes('学院') ? 'college' : 'functional'
    },
    handleSankeyLinkClick: (_source: string, target: string) => {
      dashboardStoreState.currentOrgLevel = target.includes('学院') ? 'college' : 'functional'
    },
    // 面包屑导航：index 0 = 组织总览 → 复位 strategy（与 navigateToBreadcrumbEnhanced 同效果）
    handleBreadcrumbNavigate: (index: number) => {
      if (index === 0) {
        dashboardStoreState.currentOrgLevel = 'strategy'
      }
    }
  }

  return new Proxy(base, {
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
  })
}

vi.mock('@/features/dashboard/model/useDashboardView', () => ({
  useDashboardView: () => createDashboardViewModel(),
  type: {}
}))

import DashboardView from '@/features/dashboard/ui/DashboardView.vue'
import TaskSankeyChart from '@/5-shared/ui/charts/TaskSankeyChart.vue'

const mountOptions = {
  global: {
    directives: {
      loading: noop,
      focus: noop
    },
    stubs: {
      teleport: true,
      'el-progress': {
        props: ['percentage'],
        template: '<div class="el-progress"><slot :percentage="percentage ?? 0" /></div>'
      },
      // el-card 默认 stub 不渲染插槽，卡头（桑基图标题/返回按钮）需要真实可见
      'el-card': {
        template: '<div class="el-card-stub"><slot name="header" /><slot /></div>'
      },
      'el-button': {
        template: '<button type="button" @click="$emit(\'click\')"><slot /></button>'
      }
    }
  }
}

beforeEach(() => {
  dashboardStoreState.currentOrgLevel = 'strategy'
})

describe('全校任务流转图（桑基图）下钻可见性', () => {
  it('strategy 层级：流转图卡可见且无「返回全校视图」按钮', () => {
    const wrapper = shallowMount(DashboardView, {
      props: { viewingRole: 'strategic_dept', viewingDept: '战略发展部' },
      ...mountOptions
    })

    expect(wrapper.findComponent(TaskSankeyChart).exists()).toBe(true)
    expect(wrapper.text()).toContain('全校任务流转图')
    expect(wrapper.text()).not.toContain('返回全校视图')
  })

  it('点击节点下钻（currentOrgLevel→functional）：流转图卡不消失，「返回全校视图」按钮出现', async () => {
    const wrapper = shallowMount(DashboardView, {
      props: { viewingRole: 'strategic_dept', viewingDept: '战略发展部' },
      ...mountOptions
    })

    // 通过 TaskSankeyChart 存根发出 nodeClick，等价真实图上点击「教务处」节点
    const sankey = wrapper.findComponent(TaskSankeyChart)
    expect(sankey.exists()).toBe(true)
    sankey.vm.$emit('nodeClick', '教务处')
    await nextTick()

    expect(dashboardStoreState.currentOrgLevel).toBe('functional')
    // 修复点：卡片不再被 v-if 隐藏
    expect(wrapper.text()).toContain('全校任务流转图')
    expect(wrapper.text()).toContain('返回全校视图')
  })

  it('下钻到学院层级同样保持可见（college 层级回归）', async () => {
    const wrapper = shallowMount(DashboardView, {
      props: { viewingRole: 'strategic_dept', viewingDept: '战略发展部' },
      ...mountOptions
    })

    const sankey = wrapper.findComponent(TaskSankeyChart)
    sankey.vm.$emit('nodeClick', '计算机学院')
    await nextTick()

    expect(dashboardStoreState.currentOrgLevel).toBe('college')
    expect(wrapper.text()).toContain('全校任务流转图')
    expect(wrapper.text()).toContain('返回全校视图')
  })

  it('点击「返回全校视图」复位 strategy 层级，按钮消失', async () => {
    const wrapper = shallowMount(DashboardView, {
      props: { viewingRole: 'strategic_dept', viewingDept: '战略发展部' },
      ...mountOptions
    })

    dashboardStoreState.currentOrgLevel = 'functional'
    await nextTick()
    expect(wrapper.text()).toContain('返回全校视图')

    const backButton = wrapper.findAll('button').find(button => button.text().includes('返回全校视图'))
    expect(backButton).toBeTruthy()
    await backButton!.trigger('click')
    await nextTick()

    expect(dashboardStoreState.currentOrgLevel).toBe('strategy')
    expect(wrapper.text()).not.toContain('返回全校视图')
    expect(wrapper.text()).toContain('全校任务流转图')
  })
})
