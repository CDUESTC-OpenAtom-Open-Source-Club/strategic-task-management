import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { nextTick, ref } from 'vue'
import { shallowMount, type VueWrapper } from '@vue/test-utils'
import { flushPromises } from '../../setup'

import {
  resolveCollegeTabImportGate,
  resolveWithdrawControlVisible
} from '@/features/task/lib/collegeTabDistribute'

/**
 * 2026-11-14（D1 阻断 · PR#115 回归 + D2/D3 低危）：学院下发「首次下发死锁」解锁契约。
 *
 * <p>D1 缺陷（真机实测）：任何**新的学院×部门组合**（尚无计划的）无法完成首次下发——
 * ① 导入入口被 B4 gating 置灰（collegeTabPlanNotDistributed 判定「计划未下发」），
 * 而导入本来就是「创建计划并下发」的入口（后端 findOrCreatePlan 建计划）；
 * ② 计划不存在 → effectivePlanContext.plan 为空 → withdrawControlVisible（v-if）恒 false
 * →「发起下发审批」整颗隐藏。两个入口同时不可达 = 首次下发死锁。存量已下发组合
 * （705489/705488）不受影响——只点现成组合的回归发现不了。</p>
 *
 * <p>修法口径（显隐矩阵，三类组合 × 三入口）：</p>
 * <table>
 *   <tr><td>组合 \ 入口</td><td>导入</td><td>新增行 / 发起异动</td><td>发起下发审批</td></tr>
 *   <tr><td>尚无计划</td><td>可点（创建并下发）</td><td>置灰（B4 保留）</td><td>可见可点（点击=引导先导入）</td></tr>
 *   <tr><td>DRAFT 存量（有行）</td><td>置灰（B4 保留）</td><td>置灰（B4 保留）</td><td>可见可点（发起链路）</td></tr>
 *   <tr><td>DISTRIBUTED</td><td>可点</td><td>可点</td><td>置灰（distributed-locked，既有）</td></tr>
 * </table>
 *
 * <p>D2/D3（同一根因）：学院子指标异动实例（source=战略发展部、target=学院）只落在
 * departmentChainMutationPendingApprovals（链下学院追回清单），主清单按职能部门
 * orgId 查不到。PR#115 已修 canWithdrawMutationInFlight / handleWithdrawMutationBatch /
 * isCollegeMutationApprovalInFlight 三个消费方，漏了两处：D2 = isEntityMutationInFlight
 * （异动角标在审态不亮）、D3 = 导入入口互斥守卫（只读主清单漏锁）。修法同款：并入
 * 链下清单（与 isCollegeMutationApprovalInFlight 合并口径一致）。</p>
 */

const readSource = (relative: string): string =>
  readFileSync(resolve(process.cwd(), relative), 'utf8')

const modelSource = readSource('src/3-features/task/model/useStrategicTaskView.ts')
const viewSource = readSource('src/3-features/task/ui/StrategicTaskView.vue')

// ==================== D1 · 导入入口计划相位纯函数矩阵 ====================

describe('task/lib/collegeTabDistribute · resolveCollegeTabImportGate（D1 导入入口矩阵）', () => {
  it('尚无计划（子计划未解析）→ 放行：导入就是创建计划的入口（findOrCreatePlan 链路）', () => {
    for (const status of [null, undefined, '', 'DRAFT']) {
      expect(
        resolveCollegeTabImportGate({
          collegeSubPlanResolved: false,
          collegePlanStatus: status,
          collegePlanHasRows: false
        })
      ).toBe('')
    }
  })

  it('已有 DISTRIBUTED 计划 → 放行（既有口径：已下发组合导入走异动审批链）', () => {
    for (const status of ['DISTRIBUTED', 'APPROVED', 'PUBLISHED', 'ACTIVE', ' distributed ']) {
      expect(
        resolveCollegeTabImportGate({
          collegeSubPlanResolved: true,
          collegePlanStatus: status,
          collegePlanHasRows: true
        })
      ).toBe('')
    }
  })

  it('空壳计划（存在但无任何指标行）→ 放行：导入 = 往空计划建行', () => {
    for (const status of ['DRAFT', 'WITHDRAWN', 'REJECTED', 'SOMETHING_NEW']) {
      expect(
        resolveCollegeTabImportGate({
          collegeSubPlanResolved: true,
          collegePlanStatus: status,
          collegePlanHasRows: false
        })
      ).toBe('')
    }
  })

  it('计划在审/审批中（PENDING/IN_REVIEW 等）→ 拦（互斥：审批中的计划不能加行）', () => {
    for (const status of [
      'PENDING',
      'IN_REVIEW',
      'SUBMITTED',
      'PENDING_REVIEW',
      'PENDING_APPROVAL'
    ]) {
      const reason = resolveCollegeTabImportGate({
        collegeSubPlanResolved: true,
        collegePlanStatus: status,
        // 有行无行都拦（审批互斥优先于空壳放行）
        collegePlanHasRows: false
      })
      expect(reason).toContain('计划审批进行中')
      expect(
        resolveCollegeTabImportGate({
          collegeSubPlanResolved: true,
          collegePlanStatus: status,
          collegePlanHasRows: true
        })
      ).toContain('计划审批进行中')
    }
  })

  it('DRAFT 存量且已有行（B4 原始缺陷口径保留）→ 拦 + 引导先发起下发审批', () => {
    for (const status of ['DRAFT', 'WITHDRAWN', 'REJECTED', 'RETURNED', 'SOMETHING_NEW']) {
      const reason = resolveCollegeTabImportGate({
        collegeSubPlanResolved: true,
        collegePlanStatus: status,
        collegePlanHasRows: true
      })
      expect(reason).toContain('未下发且已有指标行')
    }
  })
})

// ==================== D1 · 发起下发审批显隐（席位判定兜底单元） ====================

describe('task/lib/collegeTabDistribute · 尚无计划组合的发起下发入口（resolveWithdrawControlVisible 兜底取数）', () => {
  it('尚无计划组合：以「将会创建该计划的组织」（战略部 org 35）兜底 → 填报人席位可见（按钮不再整颗 v-if 藏死）', () => {
    // 组件侧把 effectivePlanCreatedByOrgId 兜底为 strategicDeptOrgId 后喂给纯函数
    expect(
      resolveWithdrawControlVisible({
        canWithdrawMutationInFlight: false,
        isCurrentUserReporter: true,
        currentUserOrgId: 35,
        effectivePlanCreatedByOrgId: 35
      })
    ).toBe(true)
  })

  it('兜底只影响取数：非填报人席位在尚无计划组合上仍然隐藏（席位铁律不松动）', () => {
    expect(
      resolveWithdrawControlVisible({
        canWithdrawMutationInFlight: false,
        isCurrentUserReporter: false,
        currentUserOrgId: 35,
        effectivePlanCreatedByOrgId: 35
      })
    ).toBe(false)
  })
})

// ==================== 组件接线（浅挂载 + mock view-model） ====================

const viewModelOverrides = vi.hoisted(() => ({
  strategicTask: {} as Record<string, unknown>
}))

const submitPlanForApproval = vi.hoisted(() => vi.fn())
const withdrawPlan = vi.hoisted(() => vi.fn())

vi.mock('@/features/plan/api/planApi', () => ({
  planApi: {
    submitPlanForApproval,
    withdrawPlan
  }
}))

const elMessageBoxConfirm = vi.hoisted(() => vi.fn())
const elMessageInfo = vi.hoisted(() => vi.fn())
const elMessageWarning = vi.hoisted(() => vi.fn())
const elMessageSuccess = vi.hoisted(() => vi.fn())
const elMessageError = vi.hoisted(() => vi.fn())

vi.mock('element-plus', async () => {
  const actual = await vi.importActual<typeof import('element-plus')>('element-plus')
  return {
    ...actual,
    ElMessage: Object.assign(vi.fn(), {
      success: elMessageSuccess,
      error: elMessageError,
      warning: elMessageWarning,
      info: elMessageInfo
    }),
    ElMessageBox: {
      confirm: elMessageBoxConfirm,
      close: vi.fn()
    }
  }
})

function createViewModel(overrides: Record<string, unknown> = {}) {
  const base = {
    timeContext: { isReadOnly: false, currentYear: 2026, cycles: [{ year: 2026, cycleId: 7 }] },
    canWriteStrategicTask: ref(true),
    isStrategicDeptLogin: ref(true),
    isReadOnly: ref(false),
    isFunctionalDeptLogin: false,
    authStore: {
      userRole: 'strategic_dept',
      effectiveRole: 'strategic_dept',
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
    selectedDepartment: '教务处',
    currentIndicator: null,
    selectedIndicators: [] as unknown[],
    currentDetail: null,
    currentDistributeItem: null,
    currentDistributeGroup: null,
    distributeTarget: [] as string[],
    filteredColleges: [] as string[],
    colleges: ref([] as string[]),
    selectedCollege: ref('航空学院'),
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
    newRow: { type1: '定性', type2: '基础性', weight: 0, name: '', remark: '', taskContent: '' },
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
    distributeButtonText: '发起审批',
    distributeButtonType: 'success',
    distributeButtonDisabled: false,
    distributeButtonDisabledReason: '',
    collegeFillStatusScope: ref(true),
    collegeDispatchDeptFilter: ref('教务处'),
    collegeTabTwoStepReady: ref(true),
    isReportApprovalInFlight: ref(false),
    isMutationApprovalInFlight: ref(false),
    isCollegeMutationApprovalInFlight: ref(false),
    canEdit: ref(true),
    isCurrentPlanUnderApproval: ref(false),
    canWithdrawMutationInFlight: ref(false),
    // 学院页签「尚无计划」识别与战略部 org 兜底（D1 消费方）
    collegeSubPlanUnresolved: ref(false),
    strategicDeptOrgId: ref(35),
    isCurrentUserReporter: ref(true),
    currentUserOrgId: ref(35),
    effectivePlanContext: ref({ source: 'college', plan: null }),
    selectedCollegeDispatchPlanId: ref(null as number | null),
    handleWithdrawMutationBatch: vi.fn(),
    refreshCurrentDepartmentView: vi.fn(),
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

const noop = vi.fn()

const mountOptions = {
  global: {
    directives: {
      loading: noop,
      focus: noop
    },
    stubs: {
      teleport: true,
      'el-button': {
        template: '<button><slot /></button>'
      },
      'el-tabs': {
        name: 'ElTabsStub',
        props: ['modelValue'],
        emits: ['update:modelValue'],
        template: '<div class="el-tabs-stub"><slot /></div>'
      },
      'el-tooltip': {
        template: '<span><slot /></span>'
      },
      'el-progress': {
        props: ['percentage'],
        template: '<div class="el-progress"><slot :percentage="percentage ?? 0" /></div>'
      }
    }
  }
}

const mountView = (overrides: Record<string, unknown> = {}): VueWrapper => {
  viewModelOverrides.strategicTask = overrides
  return shallowMount(StrategicTaskView, {
    props: { selectedRole: 'strategic_dept' },
    ...mountOptions
  })
}

const switchToCollegeTab = async (wrapper: VueWrapper) => {
  wrapper.findComponent({ name: 'ElTabsStub' }).vm.$emit('update:modelValue', 'college')
  await nextTick()
  await nextTick()
}

const findButtonByText = (wrapper: VueWrapper, text: string) =>
  wrapper.findAll('button').find(button => button.text().includes(text))

beforeEach(() => {
  elMessageWarning.mockClear()
  elMessageInfo.mockClear()
  elMessageSuccess.mockClear()
  elMessageError.mockClear()
  elMessageBoxConfirm.mockReset()
  submitPlanForApproval.mockReset()
  withdrawPlan.mockReset()
})

describe('D1 组件接线 · 尚无计划组合（首次下发死锁解锁）', () => {
  it('导入可点（无置灰无 tooltip）——创建计划并下发的入口不再被关死', async () => {
    const wrapper = mountView({
      // 尚无计划：子计划未解析 + 上下文 plan 为空
      collegeSubPlanUnresolved: ref(true),
      effectivePlanContext: ref({ source: 'college', plan: null })
    })
    await switchToCollegeTab(wrapper)

    const importBtn = findButtonByText(wrapper, '导入')
    expect(importBtn).toBeDefined()
    expect(importBtn!.attributes('disabled')).toBeUndefined()
    expect(importBtn!.attributes('title')).toBe('')
    wrapper.unmount()
  })

  it('「发起下发审批」可见可点（v-if 兜底战略部 org）——不再整颗 v-if 藏死', async () => {
    const wrapper = mountView({
      collegeSubPlanUnresolved: ref(true),
      effectivePlanContext: ref({ source: 'college', plan: null })
    })
    await switchToCollegeTab(wrapper)

    const submit = findButtonByText(wrapper, '发起审批')
    expect(submit).toBeDefined()
    expect(submit!.attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('「发起下发审批」点击（尚无计划）→ 引导 toast 指向「导入」入口，不静默、不报错', async () => {
    const wrapper = mountView({
      collegeSubPlanUnresolved: ref(true),
      effectivePlanContext: ref({ source: 'college', plan: null }),
      selectedCollegeDispatchPlanId: ref(null)
    })
    await switchToCollegeTab(wrapper)

    const submit = findButtonByText(wrapper, '发起审批')
    expect(submit).toBeDefined()
    await submit!.trigger('click')
    await flushPromises()

    expect(elMessageWarning).toHaveBeenCalledTimes(1)
    expect(String(elMessageWarning.mock.calls[0][0])).toContain('导入')
    expect(elMessageBoxConfirm).not.toHaveBeenCalled()
    expect(submitPlanForApproval).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('B4 不松动：尚无计划组合的「新增行」仍置灰（collegeTabPlanNotDistributed 接线保留）', async () => {
    const wrapper = mountView({
      collegeSubPlanUnresolved: ref(true),
      effectivePlanContext: ref({ source: 'college', plan: null }),
      collegeTabPlanNotDistributed: ref(true)
    })
    await switchToCollegeTab(wrapper)

    const addRow = findButtonByText(wrapper, '新增行')
    expect(addRow).toBeDefined()
    expect(addRow!.attributes('disabled')).toBeDefined()
    expect(addRow!.attributes('title')).toContain('该学院×部门的计划未下发')
    wrapper.unmount()
  })
})

describe('D1 组件接线 · DRAFT 存量计划组合（B4 口径保留 + 发起链路不回归）', () => {
  const draftPlanContext = {
    effectivePlanContext: ref({
      source: 'college',
      plan: { status: 'DRAFT', id: 705493, createdByOrgId: 35 }
    }),
    selectedCollegeDispatchPlanId: ref(705493),
    collegeTabPlanNotDistributed: ref(true)
  }

  it('DRAFT 且已有行 → 导入置灰 + tooltip 引导先发起下发审批（防绕过往未下发计划加行）', async () => {
    const wrapper = mountView({
      ...draftPlanContext,
      collegeTableIndicators: ref([{ id: 'i1', weight: 40 }])
    })
    await switchToCollegeTab(wrapper)

    const importBtn = findButtonByText(wrapper, '导入')
    expect(importBtn).toBeDefined()
    expect(importBtn!.attributes('disabled')).toBeDefined()
    expect(importBtn!.attributes('title')).toBe(
      '该学院×部门的计划未下发且已有指标行，暂不能导入：请先发起下发审批，下发后再调整'
    )
    wrapper.unmount()
  })

  it('DRAFT 空壳（无行）→ 导入放行（导入 = 往空计划建行，首次下发路径）', async () => {
    const wrapper = mountView({ ...draftPlanContext, collegeTableIndicators: ref([]) })
    await switchToCollegeTab(wrapper)

    const importBtn = findButtonByText(wrapper, '导入')
    expect(importBtn).toBeDefined()
    expect(importBtn!.attributes('disabled')).toBeUndefined()
    expect(importBtn!.attributes('title')).toBe('')
    wrapper.unmount()
  })

  it('DRAFT 且已有行 → 「新增行」仍置灰（B4 原始缺陷不回归）', async () => {
    const wrapper = mountView({
      ...draftPlanContext,
      collegeTableIndicators: ref([{ id: 'i1', weight: 40 }])
    })
    await switchToCollegeTab(wrapper)

    const addRow = findButtonByText(wrapper, '新增行')
    expect(addRow).toBeDefined()
    expect(addRow!.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('DRAFT → 「发起审批」可见可点（存量 DRAFT 的发起链路不回归）', async () => {
    const wrapper = mountView({
      ...draftPlanContext,
      collegeTableIndicators: ref([{ id: 'i1', weight: 40 }])
    })
    await switchToCollegeTab(wrapper)

    const submit = findButtonByText(wrapper, '发起审批')
    expect(submit).toBeDefined()
    expect(submit!.attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('D1 组件接线 · DISTRIBUTED 组合（放行 + 既有置灰相位零回归）', () => {
  const distributedContext = {
    effectivePlanContext: ref({
      source: 'college',
      plan: { status: 'DISTRIBUTED', id: 705489, createdByOrgId: 35 }
    }),
    selectedCollegeDispatchPlanId: ref(705489),
    collegeSubPlanUnresolved: ref(false)
  }

  it('DISTRIBUTED → 导入可点（既有口径：导入走异动审批链）', async () => {
    const wrapper = mountView(distributedContext)
    await switchToCollegeTab(wrapper)

    const importBtn = findButtonByText(wrapper, '导入')
    expect(importBtn).toBeDefined()
    expect(importBtn!.attributes('disabled')).toBeUndefined()
    expect(importBtn!.attributes('title')).toBe('')
    wrapper.unmount()
  })

  it('DISTRIBUTED → 「发起审批」按既有 distributed-locked 相位置灰（不动）', async () => {
    const wrapper = mountView(distributedContext)
    await switchToCollegeTab(wrapper)

    const locked = findButtonByText(wrapper, '撤回')
    expect(locked).toBeDefined()
    expect(locked!.attributes('disabled')).toBeDefined()
    expect(locked!.attributes('title')).toBe('当前状态不可操作')
    wrapper.unmount()
  })
})

describe('D1 组件接线 · 计划在审/审批中（互斥拦导入）', () => {
  it('子计划 PENDING（下发审批中）→ 导入置灰 + tooltip（审批互斥）', async () => {
    const wrapper = mountView({
      effectivePlanContext: ref({
        source: 'college',
        plan: { status: 'PENDING', id: 705493, createdByOrgId: 35 }
      }),
      selectedCollegeDispatchPlanId: ref(705493),
      collegeSubPlanUnresolved: ref(false)
    })
    await switchToCollegeTab(wrapper)

    const importBtn = findButtonByText(wrapper, '导入')
    expect(importBtn).toBeDefined()
    expect(importBtn!.attributes('disabled')).toBeDefined()
    expect(importBtn!.attributes('title')).toBe(
      '该学院×部门的计划审批进行中，暂不能导入：等下发审批结束或先撤回'
    )
    wrapper.unmount()
  })
})

describe('D3 组件接线 · 学院链下异动在审 → 导入置灰（互斥并集）', () => {
  it('isCollegeMutationApprovalInFlight=true（链下清单口径）→ 导入置灰 + 异动互斥 tooltip', async () => {
    const wrapper = mountView({
      collegeSubPlanUnresolved: ref(true),
      effectivePlanContext: ref({ source: 'college', plan: null }),
      isCollegeMutationApprovalInFlight: ref(true)
    })
    await switchToCollegeTab(wrapper)

    const importBtn = findButtonByText(wrapper, '导入')
    expect(importBtn).toBeDefined()
    expect(importBtn!.attributes('disabled')).toBeDefined()
    expect(importBtn!.attributes('title')).toBe(
      '异动审批进行中，暂不能导入：等审批结束或先撤回/取消本次异动'
    )
    wrapper.unmount()
  })

  it('主清单口径（isMutationApprovalInFlight）不回归：同样置灰（既有 E-1 守卫）', async () => {
    const wrapper = mountView({
      collegeSubPlanUnresolved: ref(true),
      effectivePlanContext: ref({ source: 'college', plan: null }),
      isMutationApprovalInFlight: ref(true)
    })
    await switchToCollegeTab(wrapper)

    const importBtn = findButtonByText(wrapper, '导入')
    expect(importBtn).toBeDefined()
    expect(importBtn!.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})

// ==================== 源码契约锁（接线防回归） ====================

describe('D1/D2/D3 源码契约锁', () => {
  it('D2：isEntityMutationInFlight 角标并入学院链下清单（主清单口径不变）', () => {
    const start = modelSource.indexOf('const isEntityMutationInFlight = (')
    expect(start).toBeGreaterThan(0)
    const body = modelSource.slice(start, start + 1600)
    // 主清单 + 链下清单并集（与 isCollegeMutationApprovalInFlight 合并口径同款）
    expect(body).toContain('departmentMutationPendingApprovals.value.some')
    expect(body).toContain('departmentChainMutationPendingApprovals.value.some')
    // 退回活链口径保留（链活着角标就亮）
    expect(body).toContain('returnedMutationChains.value.some')
  })

  it('D3：openStrategicImportDialog 点击兜底与按钮同口径（collegeTabImportDisabledReason 单一来源）', () => {
    const start = viewSource.indexOf('const openStrategicImportDialog = () =>')
    expect(start).toBeGreaterThan(0)
    const body = viewSource.slice(start, start + 2400)
    expect(body).toContain('collegeTabImportDisabledReason.value')
    expect(body).toContain('importBlockedReason')
    // 不再只读主清单（D3 根因消除）
    expect(body).not.toContain('isMutationApprovalInFlight?.value === true')
  })

  it('D1：发起下发审批 v-if 兜底接线（尚无计划 → strategicDeptOrgId）', () => {
    const start = viewSource.indexOf('const withdrawControlVisible = computed')
    expect(start).toBeGreaterThan(0)
    const body = viewSource.slice(start, start + 1400)
    expect(body).toContain('collegeSubPlanUnresolved?.value')
    expect(body).toContain('strategicDeptOrgId?.value ?? null')
    expect(body).toContain('planContext?.plan?.createdByOrgId')
  })

  it('D1：点击引导文案指向「导入」（尚无计划不再是无声死端）', () => {
    expect(viewSource).toContain('还没有可提交审批的下发计划：请先通过工具栏「导入」创建计划并下发')
  })

  it('B4 不松动：新增行与发起异动仍按 collegeTabPlanNotDistributed 全量拦', () => {
    // 新增行按钮 disabled 仍并入计划相位 gating
    const addRowStart = viewSource.indexOf('@click.stop="handleAddNewRow"')
    const addRowBefore = viewSource.slice(Math.max(0, addRowStart - 1400), addRowStart)
    expect(addRowBefore).toContain(
      "(activeTaskTabName === 'college' && collegeTabPlanNotDistributed)"
    )
    // 发起异动互斥合并判定仍含计划相位
    const blockedStart = modelSource.indexOf('const mutationSubmitBlocked = computed')
    const blocked = modelSource.slice(blockedStart, blockedStart + 400)
    expect(blocked).toContain('collegeTabPlanNotDistributed.value')
  })
})
