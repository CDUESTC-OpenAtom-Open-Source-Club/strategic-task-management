import { describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { ref } from 'vue'

/**
 * 2026-11-15（用户拍板「提交按钮隐藏改主动引导」）组件级契约锁定：
 *
 * ① 一键提交按钮在批量操作区内**始终渲染**——原三条件（草稿态/归属部门/未来月）
 *    从 v-if 不渲染改为 native disabled + el-tooltip 说明缺什么（与一键撤回同款结构）；
 *    tooltip 文案 = submitAllButtonDisabledReason（单一事实源，优先级
 *    部门 > 未来月 > 草稿 的映射由 lib/__tests__/reportSubmitGate.test.ts 锁定，
 *    这里锁模板接线：文案透传 + disabled 切换）。
 * ② 归属部门选择器未选时挂 owner-dept-guide 高亮 class（琥珀描边，样式在
 *    IndicatorListView.css），placeholder 引导文案点明「提交上报前必选」；
 *    选中后 class 移除恢复默认。
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
    indicators: [] as unknown[],
    availableOwnerDepts: ref(['教务处', '学生工作处'] as string[]),
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
    props: { viewingRole: 'functional_dept', viewingDept: '计算机学院' },
    global: {
      directives: { loading: noop, focus: noop },
      stubs: {
        teleport: true,
        // 渲染 disabled 原生属性，便于断言置灰态
        'el-button': {
          props: ['disabled', 'type', 'size', 'link', 'loading'],
          emits: ['click'],
          template:
            '<button class="el-button" :disabled="disabled === true ? true : undefined" @click="$emit(\'click\')"><slot /></button>'
        },
        // 捕获 tooltip 文案与激活态（content / disabled 透传为 data 属性）
        'el-tooltip': {
          props: ['content', 'disabled', 'effect', 'placement'],
          template:
            '<span class="tooltip-stub" :data-content="content || \'\'" :data-tooltip-disabled="String(disabled === true)"><slot /></span>'
        },
        // 渲染 slot 内容链，保证 el-select 挂到 DOM（全局 el-form stub 不渲染 slot）
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

/** 定位「一键提交」按钮外层的 tooltip stub（页面可能存在多个 tooltip） */
function findSubmitTooltip(wrapper: ReturnType<typeof mountList>) {
  const hit = wrapper.findAll('.tooltip-stub').find(node => node.text().includes('一键提交'))
  expect(hit, '一键提交按钮应始终渲染（外层 tooltip wrapper 存在）').toBeTruthy()
  return hit!
}

function findSubmitButton(wrapper: ReturnType<typeof mountList>) {
  const btn = wrapper.findAll('button.el-button').find(node => node.text().includes('一键提交'))
  expect(btn, '一键提交按钮应始终渲染').toBeTruthy()
  return btn!
}

describe('填报页一键提交引导改造（2026-11-15 契约）', () => {
  it('未选归属部门：按钮仍渲染（不隐藏）、置灰，tooltip 说明「请先选择归属部门」', () => {
    viewModelOverrides.list = {
      submitAllButtonDisabledReason: '请先选择归属部门',
      submitAllDisabledTitle: '请先选择归属部门'
    }
    const wrapper = mountList()

    const btn = findSubmitButton(wrapper)
    expect(btn.attributes('disabled')).toBeDefined()

    const tooltip = findSubmitTooltip(wrapper)
    expect(tooltip.attributes('data-content')).toBe('请先选择归属部门')
    expect(tooltip.attributes('data-tooltip-disabled')).toBe('false')

    wrapper.unmount()
    viewModelOverrides.list = {}
  })

  it('条件全满足：按钮渲染且可点（无 disabled），tooltip 不激活', () => {
    viewModelOverrides.list = {
      submitAllButtonDisabledReason: '',
      submitAllDisabledTitle: '提交前会校验每条指标的自评进度与进度说明'
    }
    const wrapper = mountList()

    const btn = findSubmitButton(wrapper)
    expect(btn.attributes('disabled')).toBeUndefined()

    const tooltip = findSubmitTooltip(wrapper)
    expect(tooltip.attributes('data-tooltip-disabled')).toBe('true')

    wrapper.unmount()
    viewModelOverrides.list = {}
  })

  it('未来月：tooltip 文案透传「未来周期暂不能提交」且按钮置灰', () => {
    viewModelOverrides.list = {
      submitAllButtonDisabledReason: '未来周期暂不能提交',
      submitAllDisabledTitle: '未来周期暂不能提交'
    }
    const wrapper = mountList()

    expect(findSubmitButton(wrapper).attributes('disabled')).toBeDefined()
    expect(findSubmitTooltip(wrapper).attributes('data-content')).toBe('未来周期暂不能提交')

    wrapper.unmount()
    viewModelOverrides.list = {}
  })

  it('非草稿态（在审/已批）：tooltip 文案透传「暂无可提交的填报内容」且按钮置灰', () => {
    viewModelOverrides.list = {
      submitAllButtonDisabledReason: '暂无可提交的填报内容',
      submitAllDisabledTitle: '暂无可提交的填报内容'
    }
    const wrapper = mountList()

    expect(findSubmitButton(wrapper).attributes('disabled')).toBeDefined()
    expect(findSubmitTooltip(wrapper).attributes('data-content')).toBe('暂无可提交的填报内容')

    wrapper.unmount()
    viewModelOverrides.list = {}
  })

  it('归属部门选择器：未选 → owner-dept-guide 高亮 class + 引导 placeholder', () => {
    viewModelOverrides.list = { filterOwnerDept: '' }
    const wrapper = mountList()

    const select = wrapper.find('el-select.owner-dept-guide')
    expect(select.exists()).toBe(true)
    expect(select.attributes('placeholder')).toBe('请先选择归属部门（提交上报前必选）')

    wrapper.unmount()
    viewModelOverrides.list = {}
  })

  it('归属部门选择器：选中 → 高亮 class 移除（恢复默认边框）', () => {
    viewModelOverrides.list = { filterOwnerDept: '教务处' }
    const wrapper = mountList()

    expect(wrapper.find('el-select.owner-dept-guide').exists()).toBe(false)
    expect(wrapper.find('el-select').exists()).toBe(true)

    wrapper.unmount()
    viewModelOverrides.list = {}
  })
})
