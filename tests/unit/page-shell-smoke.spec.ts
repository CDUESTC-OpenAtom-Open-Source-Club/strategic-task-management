import { describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { ref } from 'vue'

const noop = vi.fn()

/**
 * 各页面 view model 的按用例覆盖（2026-11-05 战略部直发学院指标）：
 * 分发页 / 战略任务页的「能不能操作」一律按**登录角色**判定，
 * 用例需要能分别模拟「战略部登录」与「职能部门登录」。
 */
const viewModelOverrides = vi.hoisted(() => ({
  distribute: {} as Record<string, unknown>,
  strategicTask: {} as Record<string, unknown>
}))

function createViewModel(overrides: Record<string, unknown> = {}) {
  const base = {
    timeContext: { isReadOnly: false, currentYear: 2026, cycles: [] },
    // 2026-11-05：默认按「战略部登录」渲染（真实登录角色）
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
    functionalDepartments: ref([] as string[]),
    collegeDepartmentsScoped: ref([] as string[]),
    // 2026-10-29 二级学院导出改造新增：来源部门清单与按部门装配行的函数
    availableOwnerDepts: ref([] as string[]),
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
    colleges: ref([] as string[]),
    selectedCollege: '',
    currentDept: '战略发展部',
    currentPlan: ref(null),
    currentDepartmentPlan: ref(null),
    currentDepartmentOrgId: ref(null),
    currentDepartmentOrgIdFromTable: ref(null),
    currentSelectedCollegePlan: ref(null),
    currentSelectedCollegePlanDetails: ref(null),
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
    dashboardStore: { departmentSummary: [] as unknown[], breadcrumbs: [] as unknown[] },
    currentRole: 'strategic_dept',
    delayedTasks: [] as unknown[],
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
    ...overrides
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

vi.mock('@/features/task/model/useStrategicTaskView', () => ({
  useStrategicTaskView: () => createViewModel(viewModelOverrides.strategicTask),
  type: {}
}))

vi.mock('@/features/indicator/model/useIndicatorDistributeView', () => ({
  useIndicatorDistributeView: () => createViewModel(viewModelOverrides.distribute),
  type: {}
}))

vi.mock('@/features/indicator/model/useIndicatorListView', () => ({
  useIndicatorListView: () => createViewModel(),
  type: {}
}))

vi.mock('@/features/dashboard/model/useDashboardView', () => ({
  useDashboardView: () => createViewModel(),
  type: {}
}))

import StrategicTaskView from '@/features/task/ui/StrategicTaskView.vue'
import IndicatorDistributeView from '@/features/indicator/ui/IndicatorDistributeView.vue'
import IndicatorListView from '@/features/indicator/ui/IndicatorListView.vue'
import DashboardView from '@/features/dashboard/ui/DashboardView.vue'

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
      }
    }
  }
}

describe('page shell smoke', () => {
  it('renders StrategicTaskView shell', () => {
    const wrapper = shallowMount(StrategicTaskView, {
      props: { selectedRole: 'strategic_dept' },
      ...mountOptions
    })

    expect(wrapper.find('.strategic-task-container').exists()).toBe(true)
  })

  it('exposes StrategicTaskView primary action shell', () => {
    const wrapper = shallowMount(StrategicTaskView, {
      props: { selectedRole: 'strategic_dept' },
      ...mountOptions
    })

    expect(wrapper.text()).toContain('新增行')
  })

  it('renders IndicatorDistributeView shell', () => {
    const wrapper = shallowMount(IndicatorDistributeView, {
      props: { viewingRole: 'strategic_dept', viewingDept: '战略发展部' },
      ...mountOptions
    })

    expect(wrapper.find('.distribution-view').exists()).toBe(true)
  })

  it('exposes IndicatorDistributeView distribution shell', () => {
    const wrapper = shallowMount(IndicatorDistributeView, {
      props: { viewingRole: 'strategic_dept', viewingDept: '战略发展部' },
      ...mountOptions
    })

    expect(wrapper.text()).toContain('学院列表')
  })

  it('keeps the distribution page writable for strategic department logins', () => {
    // 2026-11-05：分发页操作能力移交战略发展部 → 战略部登录不显示只读提示
    viewModelOverrides.distribute = {
      isStrategicDeptLogin: true,
      isFunctionalDeptLogin: false,
      canOperateDistribution: true,
      canWriteDistribution: true,
      canEditChild: true
    }
    const wrapper = shallowMount(IndicatorDistributeView, {
      props: { viewingRole: 'strategic_dept', viewingDept: '战略发展部' },
      ...mountOptions
    })

    expect(wrapper.text()).not.toContain('学院指标由战略发展部统一下发')
    viewModelOverrides.distribute = {}
  })

  it('shows the read-only notice and hides write actions for functional department logins', () => {
    // 2026-11-05：职能部门在分发页只读（导入/新增/编辑/下发禁用，撤回保留）
    viewModelOverrides.distribute = {
      isStrategicDeptLogin: false,
      isFunctionalDeptLogin: true,
      canOperateDistribution: true,
      canWriteDistribution: false,
      canWithdrawDistribution: true,
      canEditChild: false
    }
    const wrapper = shallowMount(IndicatorDistributeView, {
      props: { viewingRole: 'functional_dept', viewingDept: '教务处' },
      ...mountOptions
    })

    expect(wrapper.text()).toContain('学院指标由战略发展部统一下发；本部门负责归口指标的审核进度鉴定与上报审批，并可查看历史数据。')
    expect(wrapper.text()).not.toContain('新增指标')
    expect(wrapper.text()).not.toContain('发起下发审批')
    expect(wrapper.text()).not.toContain('复制其他学院指标')
    viewModelOverrides.distribute = {}
  })

  it('shows the read-only notice on the strategic task page for functional department logins', () => {
    // 2026-11-05：职能部门对战略任务页只读
    viewModelOverrides.strategicTask = { canWriteStrategicTask: false }
    const wrapper = shallowMount(StrategicTaskView, {
      props: { selectedRole: 'functional_dept' },
      ...mountOptions
    })

    expect(wrapper.text()).toContain('当前角色对战略任务管理页仅可查看')
    viewModelOverrides.strategicTask = {}
  })

  it('renders IndicatorListView shell', () => {
    const wrapper = shallowMount(IndicatorListView, {
      props: { viewingRole: 'strategic_dept', viewingDept: '战略发展部' },
      ...mountOptions
    })

    expect(wrapper.find('.indicator-list-container').exists()).toBe(true)
  })

  it('exposes IndicatorListView filter shell', () => {
    const wrapper = shallowMount(IndicatorListView, {
      props: { viewingRole: 'strategic_dept', viewingDept: '战略发展部' },
      ...mountOptions
    })

    expect(wrapper.text()).toContain('指标列表')
  })

  it('renders DashboardView shell', () => {
    const wrapper = shallowMount(DashboardView, {
      props: { viewingRole: 'strategic_dept', viewingDept: '战略发展部' },
      ...mountOptions
    })

    expect(wrapper.find('.dashboard-view').exists()).toBe(true)
  })

  it('exposes DashboardView toolbar shell', () => {
    const wrapper = shallowMount(DashboardView, {
      props: { viewingRole: 'strategic_dept', viewingDept: '战略发展部' },
      ...mountOptions
    })

    expect(wrapper.text()).toContain('导出综合报表')
  })
})
