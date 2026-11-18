import { describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { ref } from 'vue'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** 源码契约锁：巨型 SFC/composable 不整体实例化，直接断言关键源码接线（仓库惯例） */
const readSource = (relative: string): string =>
  readFileSync(resolve(process.cwd(), relative), 'utf8')

/**
 * 学院视角矩阵契约锁定：
 *
 * ① 学院视角（isSecondaryCollege=true）：
 *    - 2026-11-17（领导二-1）：不再渲染学院专属「核心指标」列（父级核心指标=职能部门
 *      原指标的名称与定性/定量类型）；
 *    - 2026-11-18 用户拍板（外部反馈三问题·学院删列）：「战略任务」列也不显示——
 *      子指标纯平铺、无分组列，getSpanMethod 学院分支随之不合并（无列即无合并）；
 *    - 「子指标名称」列保留（学院视角 row.name 本就是子指标名）。
 * ② 职能部门/战略部视角（isSecondaryCollege=false）：列结构完全不变——
 *    「战略任务」+「核心指标」两列照旧（showStrategicTaskColumn 仅对学院收窄）。
 *
 * 模板里 resolveParentIndicator(row) 调用已全部移除（父指标名/类型不再进入学院模板），
 * 由 lead-report-batch-fe-contract 源码契约锁兜底断言。
 */

const viewModelOverrides = vi.hoisted(() => ({
  list: {} as Record<string, unknown>
}))

const noop = vi.fn()

function createViewModel(overrides: Record<string, unknown> = {}) {
  const base = {
    timeContext: { isReadOnly: false, currentYear: 2026, cycles: [] },
    isStrategicDept: false,
    isSecondaryCollege: true,
    isCurrentUserReporter: true,
    canViewReceivedPlanContent: true,
    currentUserPlanId: 1,
    indicators: [
      {
        id: '201',
        name: '子指标一（学院自己的下发指标）',
        taskContent: '战略任务甲',
        type1: '定量',
        type2: '基础性',
        weight: 5,
        parentIndicatorId: '101'
      }
    ] as unknown[],
    availableOwnerDepts: ref(['教务处'] as string[]),
    selectedCollegeExportDepartments: ref([] as string[]),
    collegeExportDialogVisible: false,
    collegeBatchExporting: false,
    filterOwnerDept: '',
    showPlanBatchActions: true,
    showWithdrawAllButton: false,
    submitAllButtonDisabledReason: '',
    submitAllDisabledTitle: '提交前会校验每条指标的自评进度与进度说明',
    withdrawTooltip: '',
    monthlySequenceStatusMeta: { type: 'info', month: '', label: '未填报' },
    currentApprovalStatusMeta: { type: 'info', label: '未发起', description: '' },
    currentApprovalFlowName: '',
    currentApprovalStepName: '',
    currentApprovalApproverName: '',
    currentApprovalCandidateNames: [] as string[],
    approvalBadgeCount: 0,
    strategicStore: { loading: false, loadingState: { indicators: false } },
    taskList: [] as unknown[],
    taskOptions: [] as unknown[],
    // —— 与 page-shell-smoke 同款兜底字段（模板对话框/表单分支在渲染期会触达）——
    overallStatus: { type: 'info', label: '草稿' },
    approvalFlowStatusMeta: { tagType: 'info', label: '未发起', description: '' },
    currentMonthlyReportStatusMeta: { type: 'info', label: '未填报' },
    functionalDepartments: ref([] as string[]),
    collegeDepartmentsScoped: ref([] as string[]),
    buildCollegeExportRowsByOwnerDept: vi.fn(() => []),
    hasMutationDraft: false,
    mutationDraftLabels: [] as string[],
    mutationApiLoading: false,
    selectedDepartment: '',
    currentIndicator: null,
    selectedIndicators: [] as unknown[],
    currentDetail: null,
    filteredColleges: [] as string[],
    colleges: ref([] as string[]),
    selectedCollege: '',
    currentDept: '计算机学院',
    currentPlan: ref(null),
    currentDepartmentPlan: ref(null),
    currentDepartmentOrgId: ref(null),
    currentDepartmentOrgIdFromTable: ref(null),
    currentSelectedCollegePlan: ref(null),
    currentSelectedCollegePlanDetails: ref(null),
    isDataLoading: false,
    isDataEmpty: false,
    isInitialLoading: false,
    showStrategicTaskColumn: true,
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

vi.mock('@/features/indicator/model/useIndicatorListView', () => ({
  useIndicatorListView: () => createViewModel(viewModelOverrides.list),
  type: {}
}))

import IndicatorListView from '@/features/indicator/ui/IndicatorListView.vue'

function mountList() {
  return shallowMount(IndicatorListView, {
    props: { viewingRole: 'secondary_college', viewingDept: '计算机学院' },
    global: {
      directives: { loading: noop, focus: noop },
      stubs: {
        teleport: true,
        'el-button': {
          props: ['disabled', 'type', 'size', 'link', 'loading'],
          emits: ['click'],
          template: '<button class="el-button" @click="$emit(\'click\')"><slot /></button>'
        },
        // 列结构断言的关键 stub：渲染列 label（含动态绑定 label）；
        // slot 提供空 row 作用域，让列内 scoped slot（#default="{ row }"）可安全求值
        'el-table': { template: '<div class="table-stub"><slot /></div>' },
        'el-table-column': {
          props: ['label', 'prop', 'width', 'minWidth', 'align', 'headerAlign'],
          template:
            '<div class="col-stub" :data-label="label || \'\'"><slot :row="{}" :index="0" /></div>'
        },
        'el-tooltip': {
          props: ['content', 'disabled', 'effect', 'placement'],
          template: '<span class="tooltip-stub" :data-content="content || \'\'"><slot /></span>'
        },
        'el-form': { template: '<form class="filter-form-stub"><slot /></form>' },
        'el-form-item': {
          props: ['label'],
          template: '<div class="form-item-stub"><slot /></div>'
        },
        'el-progress': {
          props: ['percentage'],
          template: '<div class="el-progress"><slot :percentage="percentage ?? 0" /></div>'
        }
      }
    }
  })
}

function mountedColumnLabels(wrapper: ReturnType<typeof mountList>): string[] {
  return wrapper.findAll('.col-stub').map(node => node.attributes('data-label') || '')
}

describe('学院视角不出现父指标内容（2026-11-17 领导二-1 + 2026-11-18 学院删列）', () => {
  it('学院视角：渲染「子指标名称」列，不渲染「战略任务」「核心指标」列（子指标纯平铺）', () => {
    viewModelOverrides.list = {
      isSecondaryCollege: true,
      showStrategicTaskColumn: false,
      resolveParentIndicator: () => ({ name: '职能部门原指标甲', type1: '定量' })
    }
    const wrapper = mountList()

    const labels = mountedColumnLabels(wrapper)
    expect(labels, '学院视角不得渲染「战略任务」列（2026-11-18 用户拍板删列）').not.toContain(
      '战略任务'
    )
    expect(labels, '学院视角应渲染「子指标名称」列').toContain('子指标名称')
    expect(labels, '学院视角不得渲染「核心指标」列（父指标=职能部门原指标）').not.toContain(
      '核心指标'
    )

    wrapper.unmount()
    viewModelOverrides.list = {}
  })

  it('职能部门视角：列结构不变——「战略任务」「核心指标」两列照旧渲染', () => {
    viewModelOverrides.list = {
      isSecondaryCollege: false,
      showStrategicTaskColumn: true,
      resolveParentIndicator: () => ({ name: '职能部门原指标甲', type1: '定量' })
    }
    const wrapper = mountList()

    const labels = mountedColumnLabels(wrapper)
    expect(labels, '职能部门视角保留「战略任务」列').toContain('战略任务')
    expect(labels, '职能部门视角保留「核心指标」列（视角不变铁律）').toContain('核心指标')
    expect(labels, '职能部门视角不存在「子指标名称」列名').not.toContain('子指标名称')

    wrapper.unmount()
    viewModelOverrides.list = {}
  })

  it('源码契约：showStrategicTaskColumn 仅对学院收窄，职能部门/战略部零变化', () => {
    const viewModelSource = readSource('src/3-features/indicator/model/useIndicatorListView.ts')
    expect(
      viewModelSource.includes(
        'const showStrategicTaskColumn = computed(() => !isSecondaryCollege.value)'
      ),
      'showStrategicTaskColumn 必须按视角收窄（学院 false / 职能部门与战略部 true）'
    ).toBe(true)
    expect(
      viewModelSource.includes('if (!showStrategicTaskColumn.value)'),
      'getSpanMethod 必须保留「无列即无合并」守卫（学院视角不合并）'
    ).toBe(true)
  })

  it('源码契约：导出「战略任务」列按视角门控（学院删列 → 导出列同步删除）', () => {
    const listViewSource = readSource('src/3-features/indicator/ui/IndicatorListView.vue')
    expect(
      listViewSource.includes('const showTaskColumn = !isSecondaryCollege.value'),
      '导出列必须与界面同口径：学院视角不出「战略任务」列（showTaskColumn 门控）'
    ).toBe(true)
    expect(
      listViewSource.includes("header: '战略任务'"),
      '职能部门/战略部视角导出保留「战略任务」列（视角不变铁律）'
    ).toBe(true)
    expect(
      listViewSource.includes('if (showTaskColumn)'),
      '跨行合并的 taskSpan 计算必须与任务列同门控（学院视角跳过）'
    ).toBe(true)
  })
})
