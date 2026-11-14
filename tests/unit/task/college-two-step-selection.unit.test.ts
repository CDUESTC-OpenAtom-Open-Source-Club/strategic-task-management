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

/**
 * 2026-11-10（用户拍板：下发资格口径）源码契约：
 * 下拉不再 disabled 灰锁 —— 全部部门可点击；无「已下发」核心指标的部门灰色 + 「未下发」
 * 标记，点击在 handleCollegeDeptFilterChange 里弹「当前职能部门未有已下发的任务」且不落选。
 * 分流/资格判定的纯逻辑单测见 college-dept-dispatch-eligibility.unit.test.ts
 * （实现与测试共用 task/lib/collegeDispatchEligibility 同一份逻辑）。
 */
describe('学院页签部门下拉下发资格（2026-11-10 用户拍板）', () => {
  const readSource = (relativePath: string) =>
    readFileSync(resolve(process.cwd(), relativePath), 'utf8')

  it('下拉项不再按 count=0 disabled：全部部门可点击（模板契约）', () => {
    const viewSource = readSource('src/3-features/task/ui/StrategicTaskView.vue')
    expect(viewSource).not.toContain(':disabled="item.count === 0"')
    expect(viewSource).toMatch(/@command="handleCollegeDeptFilterChange"/)
  })

  it('部门下拉单一状态徽标：无条件单 el-tag（phaseBadge 恒非空），不再有并存上报 tag（2026-11-13 模板契约）', () => {
    const viewSource = readSource('src/3-features/task/ui/StrategicTaskView.vue')
    // 灰色口径换成 eligible（存在「已下发」核心指标），不再是 count
    expect(viewSource).toMatch(/!item\.eligible\s*\?\s*'(#c0c4cc)'/)
    // 2026-11-13（用户拍板「只能显示一个状态」）：下发 + 上报双 tag 合并为单一
    // phaseBadge（业务流转当前阶段：草稿/审批中/已下发/已上报/已回退，lib
    // resolveCollegeDeptPhaseBadge 判定）；无计划 → lib COLLEGE_DEPT_NOT_DISPATCHED_
    // BADGE（「未下发」warning）兜底，徽标恒非空。用户口径：不允许空白、不允许双 tag。
    // 注意：模板闭合标签写作 `</el-tag` + 换行 + `>`，所以用 <\/el-tag\s*>
    expect(viewSource).toMatch(
      /<el-tag\s+:type="item\.phaseBadge\.tagType"\s+size="small"\s+class="college-dept-filter-tag"\s+:disable-transitions="true"\s*>\{\{ item\.phaseBadge\.label \}\}<\/el-tag\s*>/
    )
    // 双 tag 缺陷契约（工学院×纪委办实测「已上报+未下发」并存）：禁止改回
    // 「v-if 徽标 + v-else 兜底」分支写法——菜单隐藏期间换分支时 el-tag 内置
    // el-zoom-in-center 过渡的 leave 动画收不到 transitionend，新旧双 tag 滞留 DOM。
    // 徽标区域必须是**无条件单一 el-tag**（组件实例永不卸载）。
    expect(viewSource).not.toMatch(/v-if="item\.phaseBadge"/)
    expect(viewSource).not.toMatch(
      /v-else[\s\S]{0,120}type="warning"[\s\S]{0,120}>未下发<\/el-tag\s*>/
    )
    // 无计划兜底收口在 lib 词表常量（模型消费），模板不再写死兜底文案
    const libSource = readSource('src/3-features/task/lib/collegeDispatchEligibility.ts')
    expect(libSource).toMatch(
      /COLLEGE_DEPT_NOT_DISPATCHED_BADGE[^}]*label: '未下发'[^}]*tagType: 'warning'/s
    )
    const modelSource = readSource('src/3-features/task/model/useStrategicTaskView.ts')
    expect(modelSource).toMatch(/\?\?\s*COLLEGE_DEPT_NOT_DISPATCHED_BADGE/)
    // 旧「计划状态 + 上报维度」双 tag 并存结构不得回归
    expect(viewSource).not.toMatch(/item\.planStatusBadge/)
    expect(viewSource).not.toMatch(/item\.reportStatus === 'report(ing|ed)'/)
    expect(viewSource).not.toContain('>上报中</el-tag')
    expect(viewSource).not.toContain('>已上报</el-tag')
    // 行内着色与 phaseBadge 同源：绿（success=已下发/已上报）/橙（warning=审批中）
    expect(viewSource).toMatch(/item\.phaseBadge\?\.tagType === 'success'\s*\?\s*'(#67c23a)'/)
    expect(viewSource).toMatch(/item\.phaseBadge\?\.tagType === 'warning'\s*\?\s*'(#e6a23c)'/)
  })

  it('无资格部门点击被拦截并提示用户拍板文案；有资格部门正常落选（接线契约）', () => {
    const viewSource = readSource('src/3-features/task/ui/StrategicTaskView.vue')
    // 分流走与单测同一份纯函数（实现与测试共用同一逻辑）
    expect(viewSource).toMatch(
      /import\s*\{[^}]*COLLEGE_DEPT_INELIGIBLE_WARNING[^}]*resolveCollegeDeptFilterSelection[^}]*\}\s*from\s*'@\/features\/task\/lib\/collegeDispatchEligibility'/
    )
    // 拦截分支：warning 提示 + return（不设置 collegeDispatchDeptFilter）
    expect(viewSource).toMatch(
      /resolveCollegeDeptFilterSelection\(collegeDeptDropdownItems\.value, command\)/
    )
    expect(viewSource).toMatch(/ElMessage\.warning\(COLLEGE_DEPT_INELIGIBLE_WARNING\)/)
    // 提示文案 = 用户拍板原文（常量在纯函数模块锁定）
    const libSource = readSource('src/3-features/task/lib/collegeDispatchEligibility.ts')
    expect(libSource).toContain("COLLEGE_DEPT_INELIGIBLE_WARNING = '当前职能部门未有已下发的任务'")
    // 放行分支：只有 accepted 才写入选中值
    expect(viewSource).toMatch(/collegeDispatchDeptFilter\.value = selection\.dept/)
  })

  it('资格口径在 model 里按「已下发核心指标」聚合（实现契约）', () => {
    const modelSource = readSource('src/3-features/task/model/useStrategicTaskView.ts')
    expect(modelSource).toMatch(
      /import\s*\{[^}]*buildCollegeDeptEligibleByDept[^}]*isDistributedCoreIndicator[^}]*\}\s*from\s*'@\/features\/task\/lib\/collegeDispatchEligibility'/
    )
    // 聚合处调用纯函数判定（不是内联复制口径）
    expect(modelSource).toMatch(/isDistributedCoreIndicator\(item as/)
    // 两个下拉数据源都带 eligible 字段
    expect(modelSource).toMatch(/eligible: entry\.eligible/)
    expect(modelSource).toMatch(/eligible: hit\?\.eligible/)
  })

  /**
   * 2026-11-10 缺陷修复回归契约：collegeDeptDispatchOptions 遍历**先按学院过滤**
   * （target 匹配所选学院），而「已下发核心指标」行（owner=战略部、target=职能部门）
   * 永远不匹配学院名、在进 eligible 判定前就被 continue 跳过 —— 纪委办名下 3 条
   * DISTRIBUTED 核心指标、学院名下无学院行时被误判无资格。修复 = 全量资格聚合
   * （collegeDeptEligibleByDept，不按学院过滤）与学院行聚合做 OR。
   */
  it('全量资格聚合不被学院过滤截断：eligible = 学院行聚合 OR 全量聚合（缺陷修复契约）', () => {
    const modelSource = readSource('src/3-features/task/model/useStrategicTaskView.ts')
    // 全量资格 computed：消费 buildCollegeDeptEligibleByDept（纯函数，与单测共用）
    expect(modelSource).toMatch(
      /const collegeDeptEligibleByDept = computed\(\(\)\s*=>\s*buildCollegeDeptEligibleByDept\(normalizedIndicators\.value/
    )
    // 纯函数内不按学院过滤：lib 聚合处不得出现「学院名匹配才计入」的守卫
    const libSource = readSource('src/3-features/task/lib/collegeDispatchEligibility.ts')
    expect(libSource).toMatch(/buildCollegeDeptEligibleByDept/)
    expect(libSource).not.toMatch(/selectedCollege|collegeTarget|deptName\.includes\(target\)/)
    // options 最终 eligible = 学院行聚合 OR 全量资格聚合（两者任一为 true）
    expect(modelSource).toMatch(
      /eligible: entry\.eligible \|\| collegeDeptEligibleByDept\.value\.get\(dept\) === true/
    )
  })

  it('零学院行的部门不因 hit 缺失被兜底判无资格：dropdownItems 兜底查全量聚合（缺陷修复契约）', () => {
    const modelSource = readSource('src/3-features/task/model/useStrategicTaskView.ts')
    // 旧的 `hit?.eligible ?? false` 会把「零学院行但有已下发核心指标」的部门拦在门外
    expect(modelSource).not.toMatch(/eligible: hit\?\.eligible \?\? false/)
    expect(modelSource).toMatch(
      /eligible: hit\?\.eligible \?\? collegeDeptEligibleByDept\.value\.get\(name\) === true/
    )
  })
})
