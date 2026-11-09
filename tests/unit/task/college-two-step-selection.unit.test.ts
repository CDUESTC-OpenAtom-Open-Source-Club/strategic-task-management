import { describe, expect, it, vi } from 'vitest'
import { shallowMount, type VueWrapper } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const noop = vi.fn()

/**
 * 2026-11-09（用户拍板：学院页签「两步显式选择」）用例口径：
 *
 * 1. 学院页签必须**显式两步**：先在左侧选学院，再在页签旁下拉选职能部门；
 *    没选职能部门时**不再自动兜底**「第一个有指标的部门」，表格不展示任何内容；
 * 2. 两选未齐：中央内容区给两级引导空态（未选学院 / 已选学院未选部门）、
 *    工具栏「新增行 / 发起审批 / 导入 / 导出 / 全部导出」置灰、
 *    顶部「计划状态 / 基础性权重合计」状态签隐藏；
 * 3. 职能部门页签行为零变化：默认页签下工具栏不置灰、状态签照常显示。
 */
const viewModelOverrides = vi.hoisted(() => ({
  strategicTask: {} as Record<string, unknown>
}))

function createViewModel(overrides: Record<string, unknown> = {}) {
  const base = {
    timeContext: { isReadOnly: false, currentYear: 2026, cycles: [{ year: 2026, cycleId: 7 }] },
    canWriteStrategicTask: true,
    isStrategicDeptLogin: true,
    isFunctionalDeptLogin: false,
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
    collegeTableIndicators: ref([] as unknown[]),
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

import StrategicTaskView from '@/features/task/ui/StrategicTaskView.vue'

const mountOptions = {
  global: {
    directives: {
      loading: noop,
      focus: noop
    },
    stubs: {
      teleport: true,
      // 可控的 el-tabs 桩：通过 update:modelValue 把页签切到 college，
      // 以覆盖学院页签专属的置灰 / 空态 / 状态签隐藏逻辑
      'el-tabs': {
        name: 'ElTabsStub',
        props: ['modelValue'],
        emits: ['update:modelValue'],
        template: '<div class="el-tabs-stub"><slot /></div>'
      },
      'el-progress': {
        props: ['percentage'],
        template: '<div class="el-progress"><slot :percentage="percentage ?? 0" /></div>'
      }
    }
  }
}

const mountView = (overrides: Record<string, unknown> = {}) => {
  viewModelOverrides.strategicTask = overrides
  return shallowMount(StrategicTaskView, {
    props: { selectedRole: 'strategic_dept' },
    ...mountOptions
  })
}

const switchToCollegeTab = async (wrapper: VueWrapper) => {
  wrapper.findComponent({ name: 'ElTabsStub' }).vm.$emit('update:modelValue', 'college')
  await nextTick()
}

const findButtonByText = (wrapper: VueWrapper, text: string) =>
  wrapper.findAll('button').find(button => button.text().includes(text))

describe('学院页签两步显式选择（2026-11-09 用户拍板）', () => {
  it('职能部门页签（默认）行为零变化：工具栏可用、状态签照常显示', () => {
    const wrapper = mountView({
      collegeFillStatusScope: ref(false),
      collegeDispatchDeptFilter: ref('')
    })

    expect(wrapper.text()).toContain('计划状态')
    expect(wrapper.text()).toContain('基础性权重合计')
    const exportAll = findButtonByText(wrapper, '全部导出')
    expect(exportAll?.attributes('disabled')).toBeUndefined()
    const exportOne = findButtonByText(wrapper, '导出')
    expect(exportOne?.attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('学院页签未选学院：第一级引导空态，两选未齐 → 工具栏置灰、状态签隐藏', async () => {
    const wrapper = mountView({
      collegeFillStatusScope: ref(false),
      collegeDispatchDeptFilter: ref(''),
      selectedCollege: ref(''),
      collegeDepartmentsScoped: ref(['经济管理学院'])
    })
    await switchToCollegeTab(wrapper)

    expect(wrapper.text()).toContain('请先在左侧选择对应学院')
    expect(wrapper.text()).not.toContain('请选择上方职能部门')
    expect(wrapper.text()).not.toContain('计划状态')
    expect(wrapper.text()).not.toContain('基础性权重合计')

    expect(findButtonByText(wrapper, '全部导出')?.attributes('disabled')).toBeDefined()
    expect(findButtonByText(wrapper, '导出')?.attributes('disabled')).toBeDefined()
    expect(findButtonByText(wrapper, '导入')?.attributes('disabled')).toBeDefined()
    expect(findButtonByText(wrapper, '新增行')?.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('学院页签已选学院但未选职能部门：第二级引导空态，无自动兜底内容', async () => {
    const wrapper = mountView({
      collegeFillStatusScope: ref(false),
      collegeDispatchDeptFilter: ref(''),
      selectedCollege: ref('经济管理学院'),
      collegeDepartmentsScoped: ref(['经济管理学院'])
    })
    await switchToCollegeTab(wrapper)

    expect(wrapper.text()).toContain('请选择上方职能部门')
    expect(wrapper.text()).toContain('选择职能部门后，这里将展示该学院收到的对应战略任务指标')
    expect(wrapper.text()).not.toContain('请先在左侧选择对应学院')

    // 「发起审批」按钮的 tooltip 必须落到「请先选择职能部门」分支
    const distribute = wrapper
      .findAll('button')
      .find(button => button.attributes('title') === '请先选择职能部门')
    expect(distribute).toBeDefined()
    expect(distribute?.attributes('disabled')).toBeDefined()

    expect(findButtonByText(wrapper, '全部导出')?.attributes('disabled')).toBeDefined()
    expect(findButtonByText(wrapper, '导入')?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).not.toContain('计划状态')
    expect(wrapper.text()).not.toContain('基础性权重合计')
    wrapper.unmount()
  })

  it('学院页签两选齐：引导消失、状态签回归、工具栏恢复可用', async () => {
    const wrapper = mountView({
      collegeFillStatusScope: ref(false),
      collegeDispatchDeptFilter: ref('教务处'),
      selectedCollege: ref('经济管理学院'),
      collegeDepartmentsScoped: ref(['经济管理学院'])
    })
    await switchToCollegeTab(wrapper)

    expect(wrapper.text()).not.toContain('请选择上方职能部门')
    expect(wrapper.text()).not.toContain('请先在左侧选择对应学院')
    expect(wrapper.text()).toContain('计划状态')
    expect(wrapper.text()).toContain('基础性权重合计')

    expect(findButtonByText(wrapper, '全部导出')?.attributes('disabled')).toBeUndefined()
    expect(findButtonByText(wrapper, '导出')?.attributes('disabled')).toBeUndefined()
    expect(findButtonByText(wrapper, '导入')?.attributes('disabled')).toBeUndefined()

    // 两选齐后「发起审批」不再有置灰原因（tooltip 为空、按钮可点）
    const distribute = wrapper
      .findAll('button')
      .find(button => button.attributes('title') === '请先选择职能部门')
    expect(distribute).toBeUndefined()
    wrapper.unmount()
  })

  it('学院页签的部门下拉在未选择时显示灰色占位「请选择职能部门」（模板契约）', () => {
    // 占位文案在 el-tab-pane 的 #label 具名插槽里，浅挂载桩不渲染具名插槽，
    // 用源码契约锁定结构（占位 class + 文案 + 灰色 #c0c4cc 样式）。
    const viewSource = readFileSync(
      resolve(process.cwd(), 'src/3-features/task/ui/StrategicTaskView.vue'),
      'utf8'
    )
    expect(viewSource).toContain('college-tab-current--placeholder')
    expect(viewSource).toMatch(
      /college-tab-current college-tab-current--placeholder">\s*请选择职能部门/
    )
    expect(viewSource).toMatch(/\.college-tab-current--placeholder\s*\{[^}]*#c0c4cc/)
    expect(viewSource).toMatch(/<el-icon class="college-empty-icon"><ArrowUpBold \/><\/el-icon>/)
  })
})
