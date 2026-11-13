import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { nextTick, ref } from 'vue'
import { shallowMount, type VueWrapper } from '@vue/test-utils'
import { flushPromises } from '../../setup'

import {
  hasCollegeMutationApprovalInFlight,
  isReportApprovalStatusInFlight,
  mergeReturnedMutationChains,
  resolveCollegeReturnedChainOwnerOrgId,
  resolveCollegeTabDistributeAction,
  resolveMutationGateWeightTotal,
  resolveWithdrawControlVisible
} from '@/features/task/lib/collegeTabDistribute'

/**
 * 2026-11-11（学院页签按钮体系修正）用例口径，锁定链路实测 5 项缺陷的修复：
 *
 * ① 学院页签按钮分流：子计划 DRAFT=发起审批 / 审批中=撤回（真撤回）/ 已下发=撤回(info) /
 *    异动在审可撤=撤回异动（优先于一切相位）；
 * ② 「撤回异动」点击弹正确确认（走异动撤回执行体，绝不弹「发起下发审批」）；
 * ③ 异动门禁权重取学院集合（学院上下文激活 → collegeBasicWeightTotal）；
 * ④ 上报互斥按学院子计划自身状态（collegeScope 专用摘要，不被 FUNC_DEPT 口径覆盖）；
 * ⑤ 导入入口与「新增行」同口径互斥守卫（异动在审 → 置灰 + tooltip + 点击兜底拦）。
 *
 * 纯逻辑用 task/lib/collegeTabDistribute 锁（实现与测试共用同一份函数）；
 * 组件接线用浅挂载 + mock view-model 锁（college-two-step-selection 同款模式）；
 * model 内部接线用源码契约锁（8k 行 composable 不宜整体实例化）。
 */

describe('task/lib/collegeTabDistribute · resolveCollegeTabDistributeAction（按钮分流 ①②）', () => {
  it('异动在审且当前用户可撤 → 「撤回异动」warning，优先于一切计划相位（高①）', () => {
    for (const status of ['DRAFT', 'PENDING', 'IN_REVIEW', 'DISTRIBUTED', null, undefined]) {
      expect(
        resolveCollegeTabDistributeAction({
          canWithdrawMutationInFlight: true,
          collegePlanStatus: status
        })
      ).toEqual({ action: 'withdraw-mutation', text: '撤回异动', buttonType: 'warning' })
    }
  })

  it('异动不可撤（false）时不走撤回异动分支', () => {
    const decision = resolveCollegeTabDistributeAction({
      canWithdrawMutationInFlight: false,
      collegePlanStatus: 'DRAFT'
    })
    expect(decision.action).not.toBe('withdraw-mutation')
  })

  it('学院子计划审批中（PENDING/IN_REVIEW/SUBMITTED/PENDING_REVIEW/PENDING_APPROVAL，含小写空白）→ 「撤回」warning 真撤回（高②）', () => {
    for (const status of [
      'PENDING',
      'IN_REVIEW',
      'SUBMITTED',
      'PENDING_REVIEW',
      'PENDING_APPROVAL',
      ' in_review '
    ]) {
      expect(
        resolveCollegeTabDistributeAction({
          canWithdrawMutationInFlight: false,
          collegePlanStatus: status
        })
      ).toEqual({ action: 'withdraw-dispatch', text: '撤回', buttonType: 'warning' })
    }
  })

  it('学院子计划已下发（DISTRIBUTED/APPROVED/PUBLISHED/ACTIVE）→ 「撤回」info，无可撤动作', () => {
    for (const status of ['DISTRIBUTED', 'APPROVED', 'PUBLISHED', 'ACTIVE']) {
      expect(
        resolveCollegeTabDistributeAction({
          canWithdrawMutationInFlight: false,
          collegePlanStatus: status
        })
      ).toEqual({ action: 'distributed-locked', text: '撤回', buttonType: 'info' })
    }
  })

  it('草稿 / 退回 / 未知 / 子计划未解析 → 「发起审批」success（既有发起流程）', () => {
    for (const status of [
      'DRAFT',
      'WITHDRAWN',
      'REJECTED',
      'RETURNED',
      '',
      'SOMETHING_NEW',
      null,
      undefined
    ]) {
      expect(
        resolveCollegeTabDistributeAction({
          canWithdrawMutationInFlight: false,
          collegePlanStatus: status
        })
      ).toEqual({ action: 'submit-dispatch', text: '发起审批', buttonType: 'success' })
    }
  })
})

/**
 * 2026-11-13（撤回入口席位显隐）显隐矩阵：工具栏「下发/撤回」多态合并按钮
 * 只允许「当前生效计划归属部门的填报人席位」显示；负责人/审核人/校领导与
 * 跨部门查看者一律 false（v-if 隐藏，不是置灰）。
 *
 * 场景锚定用户实测反例：zlb_final1（战略发展部负责人1，org 35，roles 无 ROLE_REPORTER）
 * 在二级学院页签看到「工学院子计划审批中」的亮橙撤回——工学院子计划 createdByOrgId=35
 * （战略部直发 FUNC_TO_COLLEGE），与 zlb_final1 同 org，所以席位判定必须先于 org 比对。
 */
describe('task/lib/collegeTabDistribute · resolveWithdrawControlVisible（撤回入口席位显隐）', () => {
  it('负责人席位×学院页签×子计划审批中（org 同为 35）→ false（zlb_final1 实测反例：席位判定先于 org 比对）', () => {
    expect(
      resolveWithdrawControlVisible({
        canWithdrawMutationInFlight: false,
        isCurrentUserReporter: false,
        currentUserOrgId: 35,
        effectivePlanCreatedByOrgId: 35
      })
    ).toBe(false)
  })

  it('负责人席位×职能页签 → false（自身计划同 org 也拦，显隐只认席位）', () => {
    expect(
      resolveWithdrawControlVisible({
        canWithdrawMutationInFlight: false,
        isCurrentUserReporter: false,
        currentUserOrgId: 35,
        effectivePlanCreatedByOrgId: 35
      })
    ).toBe(false)
  })

  it('校领导席位（无 ROLE_REPORTER）→ false', () => {
    expect(
      resolveWithdrawControlVisible({
        canWithdrawMutationInFlight: false,
        isCurrentUserReporter: false,
        currentUserOrgId: 35,
        effectivePlanCreatedByOrgId: 35
      })
    ).toBe(false)
  })

  it('填报人席位×本部门生效计划（org 一致）→ true（zlb_admin 正确形态，不能弄丢）', () => {
    expect(
      resolveWithdrawControlVisible({
        canWithdrawMutationInFlight: false,
        isCurrentUserReporter: true,
        currentUserOrgId: 35,
        effectivePlanCreatedByOrgId: 35
      })
    ).toBe(true)
  })

  it('填报人席位×跨部门生效计划 → false（org 不同即隐藏）', () => {
    expect(
      resolveWithdrawControlVisible({
        canWithdrawMutationInFlight: false,
        isCurrentUserReporter: true,
        currentUserOrgId: 36,
        effectivePlanCreatedByOrgId: 35
      })
    ).toBe(false)
  })

  it('异动发起人（model canWithdrawMutationInFlight 已含 submitter_name 比对与撤回窗口）→ true，席位/org 不再拦', () => {
    expect(
      resolveWithdrawControlVisible({
        canWithdrawMutationInFlight: true,
        isCurrentUserReporter: true,
        currentUserOrgId: 35,
        effectivePlanCreatedByOrgId: null
      })
    ).toBe(true)
    // 发起入口历史上只对填报人开放；若出现非填报人发起人，按「任一页签发起人可见」放行
    expect(
      resolveWithdrawControlVisible({
        canWithdrawMutationInFlight: true,
        isCurrentUserReporter: false,
        currentUserOrgId: null,
        effectivePlanCreatedByOrgId: 35
      })
    ).toBe(true)
  })

  it('未登录 / roles 缺失 / org 解析失败 → false（宁可隐藏，不误显示）', () => {
    expect(
      resolveWithdrawControlVisible({
        canWithdrawMutationInFlight: false,
        isCurrentUserReporter: false,
        currentUserOrgId: null,
        effectivePlanCreatedByOrgId: 35
      })
    ).toBe(false)
    expect(
      resolveWithdrawControlVisible({
        canWithdrawMutationInFlight: false,
        isCurrentUserReporter: true,
        currentUserOrgId: null,
        effectivePlanCreatedByOrgId: 35
      })
    ).toBe(false)
    expect(
      resolveWithdrawControlVisible({
        canWithdrawMutationInFlight: false,
        isCurrentUserReporter: true,
        currentUserOrgId: 0,
        effectivePlanCreatedByOrgId: 35
      })
    ).toBe(false)
  })

  it('生效计划缺失 / createdByOrgId 非法（null/0/负数/非数值串）→ false', () => {
    for (const planOrgId of [null, undefined, 0, -1, 'not-a-number']) {
      expect(
        resolveWithdrawControlVisible({
          canWithdrawMutationInFlight: false,
          isCurrentUserReporter: true,
          currentUserOrgId: 35,
          effectivePlanCreatedByOrgId: planOrgId
        })
      ).toBe(false)
    }
  })

  it('org id 数字字符串归一（后端 createdByOrgId 可能回字符串）→ true', () => {
    expect(
      resolveWithdrawControlVisible({
        canWithdrawMutationInFlight: false,
        isCurrentUserReporter: true,
        currentUserOrgId: 35,
        effectivePlanCreatedByOrgId: '35'
      })
    ).toBe(true)
  })
})

describe('task/lib/collegeTabDistribute · isReportApprovalStatusInFlight（互斥状态归一 ④）', () => {
  it('在途状态集：PENDING / IN_REVIEW / SUBMITTED / RETURNED → true（含小写/空白）', () => {
    for (const status of ['PENDING', 'IN_REVIEW', 'SUBMITTED', 'RETURNED', ' in_review ']) {
      expect(isReportApprovalStatusInFlight(status)).toBe(true)
    }
  })

  it('终态/空值：APPROVED / DRAFT / 空串 / null → false（自身上报已通过不得误锁，阻断 D-02）', () => {
    for (const status of ['APPROVED', 'DRAFT', 'REJECTED', 'CANCELLED', '', null, undefined]) {
      expect(isReportApprovalStatusInFlight(status)).toBe(false)
    }
  })
})

describe('task/lib/collegeTabDistribute · resolveMutationGateWeightTotal（异动门禁合计 ③）', () => {
  it('学院上下文激活 → 读学院子指标集合合计（阻断 D-01：不得误用职能部门 90 拦学院 100）', () => {
    expect(
      resolveMutationGateWeightTotal({
        collegeScopeActive: true,
        collegeBasicWeightTotal: 100,
        departmentTotalWeight: 90
      })
    ).toBe(100)
  })

  it('学院上下文未激活（职能页签）→ 读职能部门合计（零回归：原口径不变）', () => {
    expect(
      resolveMutationGateWeightTotal({
        collegeScopeActive: false,
        collegeBasicWeightTotal: 100,
        departmentTotalWeight: 90
      })
    ).toBe(90)
  })

  it('浮点合计原样透传（门禁侧用 1e-6 容差比较）', () => {
    expect(
      resolveMutationGateWeightTotal({
        collegeScopeActive: true,
        collegeBasicWeightTotal: 99.999999,
        departmentTotalWeight: 0
      })
    ).toBeCloseTo(99.999999)
  })
})

/**
 * 组件接线用例：浅挂载 + mock view-model（college-two-step-selection 同款模式）。
 * 锁「文案显示什么、点下去就做什么」与导入互斥守卫。
 */
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

// 2026-11-12（中⑤·A1 缺陷 C）：导入 commit 成功回调的 plan.list 缓存失效 spy
const invalidateQueriesMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/utils/cache', async () => {
  const actual = await vi.importActual<typeof import('@/shared/lib/utils/cache')>(
    '@/shared/lib/utils/cache'
  )
  return {
    ...actual,
    invalidateQueries: invalidateQueriesMock
  }
})

vi.mock('element-plus', async () => {
  const actual = await vi.importActual<typeof import('element-plus')>('element-plus')
  return {
    ...actual,
    ElMessage: Object.assign(vi.fn(), {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn()
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
    // 组件脚本以 .value 读取（isStrategicDeptLogin.value 等），必须是 ref 而非裸布尔
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
    // 学院页签按钮分流所需的 model 数据（未提供时组件按发起/不锁兜底）
    collegeFillStatusScope: ref(false),
    collegeDispatchDeptFilter: ref(''),
    collegeTabDistributeDisabledReason: ref(''),
    collegeTabTwoStepReady: ref(true),
    isReportApprovalInFlight: ref(false),
    isMutationApprovalInFlight: ref(false),
    // 2026-11-12（低⑩）：学院口径在审异动判定（新增行互斥）——基线不锁，
    // 用例按需覆写；缺省交给 Proxy 会变成真值函数，新增行恒灰干扰断言
    isCollegeMutationApprovalInFlight: ref(false),
    canEdit: ref(true),
    isCurrentPlanUnderApproval: ref(false),
    canWithdrawMutationInFlight: ref(false),
    effectivePlanContext: ref({ source: 'college', plan: null }),
    handleWithdrawMutationBatch: vi.fn(),
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
      // 透传原生按钮桩：@click.stop 需要原生事件（自动桩 emit 的 payload 是 undefined，
      // 会触发 stopPropagation TypeError 且监听器不执行）；disabled/title 经 attrs 透传
      'el-button': {
        template: '<button><slot /></button>'
      },
      'el-tabs': {
        name: 'ElTabsStub',
        props: ['modelValue'],
        emits: ['update:modelValue'],
        template: '<div class="el-tabs-stub"><slot /></div>'
      },
      // 2026-11-12（C3-D1 双按钮渲染断言）：发起异动/取消异动包在 el-tooltip 默认槽里，
      // 自动桩不渲染槽内容 → 透传桩让按钮可见（其余 tooltip 均在表格桩内部，不受影响）
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

/** 先落 overrides 再挂载：mock 工厂在 setup 时一次性读取 overrides。 */
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

/** 学院页签两选齐的基础 mock（战略部登录、可写、已选学院与职能部门） */
const collegeTabReady = (extra: Record<string, unknown> = {}) => ({
  collegeFillStatusScope: ref(true),
  collegeDispatchDeptFilter: ref('教务处'),
  selectedCollege: ref('航空学院'),
  collegeDepartmentsScoped: ref(['航空学院']),
  canWithdrawMutationInFlight: ref(false),
  isMutationApprovalInFlight: ref(false),
  // 2026-11-13（撤回入口席位显隐）：基础席位=战略部填报人（org 35，与既有「战略部登录、
  // 可写」意图一致）。缺省时 withdrawControlVisible（v-if）恒 false → 按钮整体隐藏，
  // 按钮分流类用例全挂；非填报人/跨部门场景按需覆写（见下方两枚接线锁用例）
  isCurrentUserReporter: ref(true),
  currentUserOrgId: ref(35),
  effectivePlanContext: ref({ source: 'college', plan: null }),
  selectedCollegeDispatchPlanId: ref(705493),
  refreshCurrentDepartmentView: vi.fn(),
  ...extra
})

describe('学院页签按钮分流与互斥守卫（2026-11-11 组件接线）', () => {
  beforeEach(() => {
    submitPlanForApproval.mockReset()
    withdrawPlan.mockReset()
    elMessageBoxConfirm.mockReset()
  })

  it('①高② 学院子计划审批中：按钮显示「撤回」，点击弹撤回确认并调 withdrawPlan，绝不弹发起下发审批', async () => {
    elMessageBoxConfirm.mockResolvedValue('confirm')
    withdrawPlan.mockResolvedValue({ code: 200, data: {}, message: 'ok' })
    const refreshCurrentDepartmentView = vi.fn()
    const wrapper = mountView(
      collegeTabReady({
        // createdByOrgId=35 与基础席位 currentUserOrgId=35 同部门 → 按钮可见（v-if 通过）
        effectivePlanContext: ref({
          source: 'college',
          plan: { status: 'PENDING', id: 705493, createdByOrgId: 35 }
        }),
        refreshCurrentDepartmentView
      })
    )
    await switchToCollegeTab(wrapper)

    const withdraw = findButtonByText(wrapper, '撤回')
    expect(withdraw).toBeDefined()
    expect(findButtonByText(wrapper, '发起审批')).toBeUndefined()

    await withdraw!.trigger('click')
    await flushPromises()

    expect(elMessageBoxConfirm).toHaveBeenCalledTimes(1)
    const [message, title] = elMessageBoxConfirm.mock.calls[0]
    expect(String(message)).toContain('航空学院')
    expect(String(message)).toContain('撤回')
    expect(String(title)).toBe('撤回下发审批')
    expect(withdrawPlan).toHaveBeenCalledWith(705493)
    expect(refreshCurrentDepartmentView).toHaveBeenCalledWith({ force: true })
    expect(submitPlanForApproval).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('①高② 「撤回异动」点击走异动撤回执行体，不弹「发起下发审批」确认（同框实锤 C1-20 回归锁）', async () => {
    const handleWithdrawMutationBatch = vi.fn()
    const wrapper = mountView(
      collegeTabReady({
        canWithdrawMutationInFlight: ref(true),
        isMutationApprovalInFlight: ref(true),
        effectivePlanContext: ref({ source: 'college', plan: { status: 'DRAFT' } }),
        handleWithdrawMutationBatch
      })
    )
    await switchToCollegeTab(wrapper)

    const mutationWithdraw = findButtonByText(wrapper, '撤回异动')
    expect(mutationWithdraw).toBeDefined()

    await mutationWithdraw!.trigger('click')
    await flushPromises()

    expect(handleWithdrawMutationBatch).toHaveBeenCalledTimes(1)
    expect(submitPlanForApproval).not.toHaveBeenCalled()
    expect(withdrawPlan).not.toHaveBeenCalled()
    expect(elMessageBoxConfirm).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('① 学院子计划草稿：按钮显示「发起审批」，点击沿用既有发起下发审批确认（发起链路不回归）', async () => {
    elMessageBoxConfirm.mockRejectedValue(new Error('cancelled'))
    const wrapper = mountView(
      collegeTabReady({
        // createdByOrgId=35 与基础席位 currentUserOrgId=35 同部门 → 按钮可见（v-if 通过）
        effectivePlanContext: ref({
          source: 'college',
          plan: { status: 'DRAFT', id: 705493, createdByOrgId: 35 }
        })
      })
    )
    await switchToCollegeTab(wrapper)

    const submit = findButtonByText(wrapper, '发起审批')
    expect(submit).toBeDefined()
    expect(findButtonByText(wrapper, '撤回异动')).toBeUndefined()

    await submit!.trigger('click')
    await flushPromises()

    expect(elMessageBoxConfirm).toHaveBeenCalledTimes(1)
    expect(String(elMessageBoxConfirm.mock.calls[0][1])).toBe('发起下发审批')
    expect(submitPlanForApproval).not.toHaveBeenCalled()
    expect(withdrawPlan).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  // 2026-11-13（撤回入口席位显隐）两枚组件级接线锁（f568bef 教训：lib 纯函数对了、
  // 模板没接线照样漏——必须直接锁 v-if 本体，断言按钮「不存在」而非「置灰」）：
  // 用户铁律：非「当前生效计划归属部门的填报人席位」按钮一律 v-if 隐藏；
  // 场景锚定 zlb_final1 实测反例（战略发展部负责人1，org 35，roles 无 ROLE_REPORTER，
  // 曾在学院页签看到工学院子计划审批中的亮橙撤回——计划 createdByOrgId 同为 35）。
  it('席位显隐接线锁：非填报人席位（负责人/审核人/校领导）×同 org 审批中 → 「下发/撤回」整颗隐藏', async () => {
    const wrapper = mountView(
      collegeTabReady({
        isCurrentUserReporter: ref(false),
        currentUserOrgId: ref(35),
        effectivePlanContext: ref({
          source: 'college',
          plan: { status: 'PENDING', id: 705493, createdByOrgId: 35 }
        })
      })
    )
    await switchToCollegeTab(wrapper)

    // 席位判定先于 org 比对：同 org 也拦（纯 org 比对拦不住 zlb_final1 反例）
    expect(findButtonByText(wrapper, '撤回')).toBeUndefined()
    expect(findButtonByText(wrapper, '发起审批')).toBeUndefined()
    wrapper.unmount()
  })

  it('席位显隐接线锁：填报人×跨部门生效计划（org 不一致）→ 「下发/撤回」整颗隐藏', async () => {
    const wrapper = mountView(
      collegeTabReady({
        isCurrentUserReporter: ref(true),
        currentUserOrgId: ref(36),
        effectivePlanContext: ref({
          source: 'college',
          plan: { status: 'PENDING', id: 705493, createdByOrgId: 35 }
        })
      })
    )
    await switchToCollegeTab(wrapper)

    // 席位过、org 不过：36 ≠ 35 → 隐藏（跨部门查看者不得见下发/撤回入口）
    expect(findButtonByText(wrapper, '撤回')).toBeUndefined()
    expect(findButtonByText(wrapper, '发起审批')).toBeUndefined()
    wrapper.unmount()
  })

  it('①（零回归）职能部门页签按钮三要素仍直读 model 的 distributeButton*（学院覆写不外溢）', async () => {
    const wrapper = mountView({
      collegeFillStatusScope: ref(false),
      collegeDispatchDeptFilter: ref('教务处'),
      selectedCollege: ref('航空学院'),
      distributeButtonText: '发起审批',
      distributeButtonType: 'success',
      distributeButtonDisabled: false,
      distributeButtonDisabledReason: '',
      // 学院侧覆写刻意夸张：职能页签不得读到
      canWithdrawMutationInFlight: ref(true),
      isMutationApprovalInFlight: ref(true),
      effectivePlanContext: ref({ source: 'college', plan: { status: 'PENDING' } }),
      selectedCollegeDispatchPlanId: ref(705493),
      handleWithdrawMutationBatch: vi.fn(),
      refreshCurrentDepartmentView: vi.fn()
    })

    const distribute = findButtonByText(wrapper, '发起审批')
    expect(distribute).toBeDefined()
    expect(findButtonByText(wrapper, '撤回异动')).toBeUndefined()

    await distribute!.trigger('click')
    await flushPromises()
    // 职能页签点击走 model 的 handleDistributeOrWithdraw（mock 吞掉），不触发学院撤回链
    expect(withdrawPlan).not.toHaveBeenCalled()
    expect(elMessageBoxConfirm).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('⑤ 异动在审时学院页签「导入」置灰 + tooltip；异动结束恢复可用', async () => {
    const wrapper = mountView(
      collegeTabReady({
        isMutationApprovalInFlight: ref(true)
      })
    )
    await switchToCollegeTab(wrapper)

    const importBtn = findButtonByText(wrapper, '导入')
    expect(importBtn).toBeDefined()
    expect(importBtn!.attributes('disabled')).toBeDefined()
    expect(importBtn!.attributes('title')).toBe(
      '异动审批进行中，暂不能导入：等审批结束或先撤回/取消本次异动'
    )
    wrapper.unmount()

    // 异动结束 → 恢复可用（无置灰、无 tooltip）
    const wrapper2 = mountView(collegeTabReady({}))
    await switchToCollegeTab(wrapper2)

    const importBtn2 = findButtonByText(wrapper2, '导入')
    expect(importBtn2).toBeDefined()
    expect(importBtn2!.attributes('disabled')).toBeUndefined()
    expect(importBtn2!.attributes('title')).toBe('')
    wrapper2.unmount()
  })

  it('⑤（零回归）职能部门页签「导入」不受异动互斥影响（守卫只挂学院页签分支）', async () => {
    const wrapper = mountView({
      collegeFillStatusScope: ref(false),
      collegeDispatchDeptFilter: ref('教务处'),
      selectedCollege: ref('航空学院'),
      isMutationApprovalInFlight: ref(true)
    })

    const importBtn = findButtonByText(wrapper, '导入')
    expect(importBtn).toBeDefined()
    expect(importBtn!.attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })
})

/**
 * model 内部接线源码契约：8k 行 composable 不整体实例化，
 * 用源码断言锁定 ③④ 的关键取数路径（实现漂移即红）。
 */
describe('useStrategicTaskView 学院口径接线契约（③④）', () => {
  const readModelSource = () =>
    readFileSync(
      resolve(process.cwd(), 'src/3-features/task/model/useStrategicTaskView.ts'),
      'utf8'
    )

  it('③ submitMutationDraft 门禁合计走 resolveMutationGateWeightTotal（学院上下文 → collegeBasicWeightTotal）', () => {
    const source = readModelSource()
    expect(source).toMatch(
      /import\s*\{[^}]*resolveMutationGateWeightTotal[^}]*\}\s*from\s*'@\/features\/task\/lib\/collegeTabDistribute'/
    )
    expect(source).toMatch(/resolveMutationGateWeightTotal\(\{/)
    expect(source).toMatch(/collegeScopeActive:\s*isCollegePlanContextActive\.value/)
    expect(source).toMatch(/collegeBasicWeightTotal:\s*collegeBasicWeightTotal\.value/)
  })

  it('④ isReportApprovalInFlight 按页签取摘要：学院上下文读 collegeScope 专用摘要，职能页签读共享摘要', () => {
    const source = readModelSource()
    // 学院专用摘要存储存在，且只由 collegeScope 查询写入
    expect(source).toContain('collegeScopePlanReportSummary')
    expect(source).toMatch(
      /const summary = isCollegePlanContextActive\.value\s*\?\s*collegeScopePlanReportSummary\.value\s*:\s*currentPlanReportSummary\.value/
    )
    // collegeScope 写入点：syncCurrentPlanReportSummaries 的 collegeScope 分支
    expect(source).toMatch(
      /if \(options\.collegeScope === true\) \{\s*collegeScopePlanReportSummary\.value = summaries\.currentReport\s*\}/
    )
    // 状态归一走共享纯函数（互斥状态集单一来源）
    expect(source).toMatch(
      /isReportApprovalStatusInFlight\(summary\?\.workflowStatus \|\| summary\?\.status\)/
    )
  })

  it('④ resetApprovalWorkflowStateCache 一并清空学院专用摘要（部门/年度切换不留陈旧锁）', () => {
    const source = readModelSource()
    expect(source).toMatch(
      /function resetApprovalWorkflowStateCache\(\): void \{[\s\S]*?collegeScopePlanReportSummary\.value = null[\s\S]*?\n\s{2}\}/
    )
  })

  it('② 学院页签撤回执行体接线契约（组件调用 withdrawPlan / 异动撤回执行体）', () => {
    const vueSource = readFileSync(
      resolve(process.cwd(), 'src/3-features/task/ui/StrategicTaskView.vue'),
      'utf8'
    )
    // 2026-11-13（撤回入口席位显隐）：该 import 已扩为多行双符号
    // （resolveCollegeTabDistributeAction + resolveWithdrawControlVisible），
    // 旧单行模式会撞车 → 改容忍多行，并把显隐新符号一并纳入契约锁
    expect(vueSource).toMatch(
      /import\s*\{[^}]*resolveCollegeTabDistributeAction[^}]*\}\s*from\s*'@\/features\/task\/lib\/collegeTabDistribute'/
    )
    expect(vueSource).toContain('resolveWithdrawControlVisible')
    expect(vueSource).toContain('handleWithdrawCollegeDispatch')
    expect(vueSource).toMatch(/planApi\.withdrawPlan\(planId\)/)
    expect(vueSource).toMatch(/await handleWithdrawMutationBatch\(\)/)
  })
})

/**
 * 2026-11-12（C3-D1 HIGH）：学院页签异动驳回后红横幅与重报双按钮可达。
 *
 * 缺陷口径（测试证据/2026-11-12-导入导出上报异动全链/C3-工学院异动全链-测试报告.md）：
 * returnedMutationChains 只由 selectedDepartment（职能侧边栏，org 36 起）驱动加载，
 * 战略部直发学院子指标（owner=35）的退回活链查询恒不命中 → 学院页签驳回后
 * 红横幅「已退回待重报」与「发起异动/取消异动」双按钮不可达（数据在、前端不拉）。
 *
 * 纯函数（owner 口径 / 合并去重）直接锁实现；组件渲染（红横幅 + 双按钮）走
 * 浅挂载 mock view-model；model 接线（selectCollege / 页签激活 / 部门过滤触发补拉）
 * 用源码契约锁。
 */
describe('task/lib/collegeTabDistribute · 学院口径退回链加载（C3-D1）', () => {
  describe('resolveCollegeReturnedChainOwnerOrgId（owner 参数正确）', () => {
    it('战略部登录 → owner 口径取战略发展部组织 id（org 35，学院子指标 owner 侧命中）', () => {
      expect(
        resolveCollegeReturnedChainOwnerOrgId({
          isStrategicDeptLogin: true,
          strategicDeptOrgId: 35,
          funcOrgId: 44
        })
      ).toBe(35)
    })

    it('战略部登录但战略部 org 解析失败 → 返回 null（宁可不拉，不误用职能部门口径）', () => {
      expect(
        resolveCollegeReturnedChainOwnerOrgId({
          isStrategicDeptLogin: true,
          strategicDeptOrgId: null,
          funcOrgId: 44
        })
      ).toBeNull()
    })

    it('职能部门登录 → owner 口径取当前选中职能部门（存量学院行与职能页签同口径）', () => {
      expect(
        resolveCollegeReturnedChainOwnerOrgId({
          isStrategicDeptLogin: false,
          strategicDeptOrgId: 35,
          funcOrgId: 44
        })
      ).toBe(44)
    })

    it('职能部门登录且职能部门未解析 → null；非法数值（0/负数/NaN）一律 null', () => {
      expect(
        resolveCollegeReturnedChainOwnerOrgId({
          isStrategicDeptLogin: false,
          strategicDeptOrgId: 35,
          funcOrgId: null
        })
      ).toBeNull()
      expect(
        resolveCollegeReturnedChainOwnerOrgId({
          isStrategicDeptLogin: true,
          strategicDeptOrgId: 0,
          funcOrgId: 44
        })
      ).toBeNull()
      expect(
        resolveCollegeReturnedChainOwnerOrgId({
          isStrategicDeptLogin: false,
          strategicDeptOrgId: 35,
          funcOrgId: Number.NaN
        })
      ).toBeNull()
    })
  })

  describe('mergeReturnedMutationChains（合并按 instance_id 去重）', () => {
    const chain = (instanceId: number, batchId = 'b-1') => ({
      instance_id: instanceId,
      batch_id: batchId,
      indicator_id: 2048,
      indicator_desc: '链路测试-工学院子指标A',
      status: 'WITHDRAWN',
      created_at: '2026-11-12T10:08:00'
    })

    it('学院口径补拉结果并入既有清单；同一实例（两口径都命中）不重复计入批次', () => {
      const existing = [chain(13)]
      const merged = mergeReturnedMutationChains(existing, [chain(13), chain(14, 'b-2')])
      expect(merged).toHaveLength(2)
      expect(merged.map(item => item.instance_id)).toEqual([13, 14])
    })

    it('无新增时返回原数组（不无谓触发响应式更新）；缺 instance_id 的脏数据跳过', () => {
      const existing = [chain(13)]
      expect(mergeReturnedMutationChains(existing, [])).toBe(existing)
      expect(mergeReturnedMutationChains(existing, [chain(13)])).toBe(existing)
      const dirty = { ...chain(99), instance_id: undefined as unknown as number }
      const merged = mergeReturnedMutationChains(existing, [dirty])
      expect(merged).toBe(existing)
    })
  })

  describe('hasCollegeMutationApprovalInFlight（学院口径在审异动，低⑩）', () => {
    const entry = (targetOrgId: number | null) => ({ targetOrgId, instanceId: 1 })

    it('所选学院链上存在在审异动（targetOrgId=学院 org）→ true（主清单与链下追回清单合并后判定）', () => {
      expect(hasCollegeMutationApprovalInFlight([entry(56), entry(44)], 56)).toBe(true)
    })

    it('其他学院的在审异动不串台（D-02 同方向：学院口径各自独立）', () => {
      expect(hasCollegeMutationApprovalInFlight([entry(57)], 56)).toBe(false)
    })

    it('学院未选 / org 解析失败 → 恒 false（不锁新增行）', () => {
      expect(hasCollegeMutationApprovalInFlight([entry(56)], null)).toBe(false)
      expect(hasCollegeMutationApprovalInFlight([entry(56)], Number.NaN)).toBe(false)
      expect(hasCollegeMutationApprovalInFlight([entry(56)], 0)).toBe(false)
    })

    it('targetOrgId 缺失的条目不参与判定（无法归属到学院链）', () => {
      expect(hasCollegeMutationApprovalInFlight([{ instanceId: 1 }], 56)).toBe(false)
    })
  })
})

describe('学院页签驳回闭环与在审互斥（2026-11-12 组件接线）', () => {
  beforeEach(() => {
    submitPlanForApproval.mockReset()
    withdrawPlan.mockReset()
    elMessageBoxConfirm.mockReset()
  })

  it('C3-D1 驳回态：有退回活链时红横幅（error）+「发起异动/取消异动」双按钮渲染', async () => {
    const wrapper = mountView({
      hasReturnedMutationChain: ref(true),
      returnedMutationChainCount: ref(1),
      isReturnedChainRequester: ref(true),
      hasMutationDraft: ref(false)
    })

    // el-alert 未在测试环境全局注册 → 渲染为原生标签回退（shallowMount 不桩未解析组件），
    // 用 DOM 属性断言（type="error" 即「已退回待重报」红横幅）
    const errorAlert = wrapper
      .findAll('el-alert')
      .find(alert => alert.attributes('type') === 'error')
    expect(errorAlert).toBeDefined()
    // 双按钮（发起异动 / 取消异动）在退回态下随横幅一并渲染
    expect(findButtonByText(wrapper, '发起异动')).toBeDefined()
    expect(findButtonByText(wrapper, '取消异动')).toBeDefined()
    wrapper.unmount()
  })

  it('C3-D1 零回归：无退回活链时红横幅与双按钮不渲染（维持 v-if 口径）', async () => {
    const wrapper = mountView({
      hasReturnedMutationChain: ref(false),
      returnedMutationChainCount: ref(0),
      isReturnedChainRequester: ref(false),
      hasMutationDraft: ref(false)
    })

    expect(
      wrapper.findAll('el-alert').find(alert => alert.attributes('type') === 'error')
    ).toBeUndefined()
    expect(findButtonByText(wrapper, '取消异动')).toBeUndefined()
    expect(findButtonByText(wrapper, '发起异动')).toBeUndefined()
    wrapper.unmount()
  })

  it('低⑧（A1 缺陷 E）部门清单未加载时点「全部导出」：同款提示挡在弹窗前，不再弹死对话框', async () => {
    const { ElMessage } = await import('element-plus')
    const wrapper = mountView({
      functionalDepartments: ref([] as string[])
    })

    const exportAll = findButtonByText(wrapper, '全部导出')
    expect(exportAll).toBeDefined()
    await exportAll!.trigger('click')
    await flushPromises()

    expect(ElMessage.warning).toHaveBeenCalledWith('请先选择要导出的部门')
    wrapper.unmount()
  })

  it('低⑧（A1 缺陷 E）导出对话框 0 部门选中点「导出」：warning 反馈而非静默', async () => {
    const { ElMessage } = await import('element-plus')
    // 正常部门清单 + 手动清空选中（复刻 A1 取消全选路径）
    const wrapper = mountView({
      functionalDepartments: ref(['教务处']),
      selectedStrategicExportDepartments: ref([] as string[])
    })

    const dialog = wrapper.findComponent({ name: 'ElDialog' })
    expect(dialog).toBeDefined()
    // 通过暴露的 confirm 入参直拍导出处理函数（对话框默认槽在 shallowMount 下不渲染）
    const vm = wrapper.vm as unknown as {
      handleExportSelectedStrategicDepartments?: () => Promise<void>
    }
    expect(typeof vm.handleExportSelectedStrategicDepartments).toBe('function')
    await vm.handleExportSelectedStrategicDepartments!()
    await flushPromises()

    expect(ElMessage.warning).toHaveBeenCalledWith('请先选择要导出的部门')
    wrapper.unmount()
  })

  it('低⑩（C3 O-3）学院口径异动在审：学院页签「新增行」置灰 + 同款互斥 tooltip', async () => {
    const wrapper = mountView(
      collegeTabReady({
        isCollegeMutationApprovalInFlight: ref(true)
      })
    )
    await switchToCollegeTab(wrapper)

    const addRow = findButtonByText(wrapper, '新增行')
    expect(addRow).toBeDefined()
    expect(addRow!.attributes('disabled')).toBeDefined()
    expect(addRow!.attributes('title')).toBe(
      '异动审批进行中，暂不能新增：等审批结束或先撤回/取消本次异动'
    )
    wrapper.unmount()
  })

  it('低⑩（零回归）学院口径在审只锁学院页签：职能页签「新增行」不受影响', async () => {
    const wrapper = mountView({
      collegeFillStatusScope: ref(false),
      isCollegeMutationApprovalInFlight: ref(true)
    })

    const addRow = findButtonByText(wrapper, '新增行')
    expect(addRow).toBeDefined()
    expect(addRow!.attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('低⑩（C2 O-1）计划/上报审批在审 tooltip 文案写准：上报与异动并提，不再只说「计划正在审批中」', async () => {
    const wrapper = mountView({
      isCurrentPlanUnderApproval: ref(true)
    })

    const addRow = findButtonByText(wrapper, '新增行')
    expect(addRow).toBeDefined()
    expect(addRow!.attributes('title')).toBe(
      '当前计划的上报/异动审批进行中，暂不能新增：请等审批结束或先撤回本次审批'
    )
    wrapper.unmount()
  })
})

/**
 * model 内部接线源码契约：8k 行 composable 不整体实例化，
 * 用源码断言锁定学院口径退回链的关键接线（实现漂移即红）。
 */
describe('useStrategicTaskView / StrategicTaskView 学院退回链接线契约（C3-D1）', () => {
  const readModelSource = () =>
    readFileSync(
      resolve(process.cwd(), 'src/3-features/task/model/useStrategicTaskView.ts'),
      'utf8'
    )
  const readViewSource = () =>
    readFileSync(resolve(process.cwd(), 'src/3-features/task/ui/StrategicTaskView.vue'), 'utf8')

  it('model：学院口径退回链补拉共用 collegeTabDistribute 纯函数（owner 口径与合并去重单一来源）', () => {
    const source = readModelSource()
    expect(source).toMatch(
      /import\s*\{[^}]*resolveCollegeReturnedChainOwnerOrgId[^}]*\}\s*from\s*'@\/features\/task\/lib\/collegeTabDistribute'/
    )
    expect(source).toMatch(
      /import\s*\{[^}]*mergeReturnedMutationChains[^}]*\}\s*from\s*'@\/features\/task\/lib\/collegeTabDistribute'/
    )
    expect(source).toMatch(
      /resolveCollegeReturnedChainOwnerOrgId\(\{\s*isStrategicDeptLogin:\s*isStrategicDeptLogin\.value/
    )
    expect(source).toMatch(
      /returnedMutationChains\.value = mergeReturnedMutationChains\(\s*returnedMutationChains\.value/
    )
  })

  it('model：主清单刷新后自动并入学院口径退回链（既有刷新链全覆盖，含提交/重发/取消）', () => {
    const source = readModelSource()
    // loadDepartmentMutationWorkflowEntities 的退回链加载段落后必须补拉学院口径
    expect(source).toMatch(
      /returnedMutationChains\.value = \[\][\s\S]{0,800}?await loadCollegeReturnedMutationChains\(\)/
    )
  })

  it('model：selectCollege 学院选择变化触发学院口径退回链补拉（C3-D1 根因：此前零触发）', () => {
    const source = readModelSource()
    expect(source).toMatch(
      /const selectCollege = \(college: string\) => \{[\s\S]*?void loadCollegeReturnedMutationChains\(\)[\s\S]*?\n {2}\}/
    )
  })

  it('view：学院页签激活与页签内部门过滤变化均触发补拉', () => {
    const source = readViewSource()
    expect(source).toMatch(
      /if \(tab === 'college'\) \{[\s\S]*?void loadCollegeReturnedMutationChains\(\)/
    )
    expect(source).toMatch(
      /collegeDispatchDeptFilter\.value = selection\.dept\s*(?:\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*)?void loadCollegeReturnedMutationChains\(\)/
    )
  })

  it('view：新增行互斥补上学院口径在审判定（仅挂学院页签分支）', () => {
    const source = readViewSource()
    expect(source).toMatch(
      /\(activeTaskTabName === 'college' && isCollegeMutationApprovalInFlight\)/
    )
  })
})

describe('导入 commit 成功后计划状态徽标刷新（2026-11-12 中⑤·A1 缺陷 C）', () => {
  beforeEach(() => {
    invalidateQueriesMock.mockClear()
    submitPlanForApproval.mockReset()
    withdrawPlan.mockReset()
    elMessageBoxConfirm.mockReset()
  })

  it('commit 成功回调：先失效 plan.list 查询缓存，再与表格同帧刷新部门视图', async () => {
    const refreshCurrentDepartmentView = vi.fn()
    const wrapper = mountView({
      refreshCurrentDepartmentView
    })

    const dialog = wrapper.findComponent({ name: 'BusinessImportDialog' })
    expect(dialog).toBeDefined()
    dialog.vm.$emit('committed', { status: 'COMMITTED', createdCount: 4 } as never)
    await flushPromises()

    // 差异根因：审批徽标走 resetApprovalWorkflowStateCache 显式失效（实时），
    // 计划状态徽标走 plan.list 15s 内存快照（loadPlans force 不穿透 fetchWithCache，
    // 心跳又不回源）→ 必须在回调里先显式失效，徽标才与表格同步拿到「已下发」
    expect(invalidateQueriesMock).toHaveBeenCalledWith(['plan.list'])
    expect(refreshCurrentDepartmentView).toHaveBeenCalledWith({
      showLoading: true,
      force: true,
      reloadIndicators: true
    })
    wrapper.unmount()
  })
})
