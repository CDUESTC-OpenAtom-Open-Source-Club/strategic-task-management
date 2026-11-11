import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { nextTick, ref } from 'vue'
import { shallowMount, type VueWrapper } from '@vue/test-utils'
import { flushPromises } from '../../setup'

import {
  isReportApprovalStatusInFlight,
  resolveCollegeTabDistributeAction,
  resolveMutationGateWeightTotal
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
        effectivePlanContext: ref({ source: 'college', plan: { status: 'PENDING', id: 705493 } }),
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
        effectivePlanContext: ref({ source: 'college', plan: { status: 'DRAFT', id: 705493 } })
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
    readFileSync(resolve(process.cwd(), 'src/3-features/task/model/useStrategicTaskView.ts'), 'utf8')

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
    expect(vueSource).toMatch(
      /import\s*\{\s*resolveCollegeTabDistributeAction\s*\}\s*from\s*'@\/features\/task\/lib\/collegeTabDistribute'/
    )
    expect(vueSource).toContain('handleWithdrawCollegeDispatch')
    expect(vueSource).toMatch(/planApi\.withdrawPlan\(planId\)/)
    expect(vueSource).toMatch(/await handleWithdrawMutationBatch\(\)/)
  })
})
