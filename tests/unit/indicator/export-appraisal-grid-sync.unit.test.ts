import { describe, expect, it, vi, beforeEach } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

/**
 * 2026-11-17（领导二-2「填报审核完成后导出的表没有填报的内容」）导出↔网格同源契约锁定：
 *
 * 根因：导出「审核进度」列此前只读 row.manualAlertSeverity（行内存字段，依赖一次异步
 * 回显且只认"最近一轮已上报通过"——审批中/回显失败时恒空），而网格显示用
 * getIndicatorAppraisalLevel(row.id, row.manualAlertSeverity)（实时等级 context 优先、
 * 行字段兜底）。两个数据源不一致 → 页面有值、导出为空。
 *
 * 修复后行为（本测试锁定）：
 * ① 实时等级 context 有值时，导出列跟随 context（与网格同源，含「滞后」文案映射）；
 * ② context 无值时导出回退行内存字段（与网格 fallback 一致）；
 * ③ 两者都无值时显示「未评定」（getAppraisalLevelDisplay 空值兜底）；
 * ④ 导出流程显式重查实时等级 context（load 以导出行集 ids 调用）。
 */

const viewModelOverrides = vi.hoisted(() => ({
  list: {} as Record<string, unknown>
}))

const appraisalState = vi.hoisted(() => ({
  /** indicatorId -> 实时等级 context 值（null=无 context，走行字段兜底） */
  levelByIndicatorId: {} as Record<string, string | null>
}))

const exportState = vi.hoisted(() => ({
  exportRowsToExcelCalls: [] as Array<{ sheet: Record<string, unknown> }>,
  loadCalls: [] as Array<string[]>
}))

const noop = vi.fn()

function createViewModel(overrides: Record<string, unknown> = {}) {
  const base = {
    timeContext: { isReadOnly: false, currentYear: 2026, cycles: [] },
    isStrategicDept: false,
    isSecondaryCollege: false,
    isCurrentUserReporter: true,
    canViewReceivedPlanContent: true,
    currentUserPlanId: 1,
    indicators: ref([] as unknown[]),
    availableOwnerDepts: ref([] as string[]),
    selectedCollegeExportDepartments: ref([] as string[]),
    collegeExportDialogVisible: false,
    collegeBatchExporting: false,
    filterOwnerDept: '',
    showPlanBatchActions: true,
    showWithdrawAllButton: false,
    submitAllButtonDisabledReason: '',
    submitAllDisabledTitle: '',
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
    currentDept: '教务处',
    currentPlan: ref(null),
    currentDepartmentPlan: ref(null),
    currentDepartmentOrgId: ref(null),
    currentDepartmentOrgIdFromTable: ref(null),
    currentSelectedCollegePlan: ref(null),
    currentSelectedCollegePlanDetails: ref(null),
    isDataLoading: false,
    isDataEmpty: false,
    isInitialLoading: false,
    showSkeleton: false,
    showStrategicTaskColumn: true,
    pageHasError: false,
    filterForm: {},
    effectiveViewingDept: ref('教务处'),
    authStore: { userDepartment: '教务处' },
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
    currentPlanIndicators: ref([
      {
        id: '201',
        name: '核心指标甲（子指标行）',
        taskContent: '战略任务甲',
        type1: '定量',
        type2: '基础性',
        weight: 5,
        manualAlertSeverity: 'NORMAL',
        pendingRemark: '本月按计划推进'
      }
    ] as unknown[]),
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

vi.mock('@/features/indicator/model/useIndicatorAppraisal', () => ({
  useIndicatorAppraisal: () => ({
    contexts: ref({}),
    loading: ref(false),
    savingId: ref(null),
    // 与真实实现同语义：实时等级 context 优先，fallback（行字段）兜底
    getLevel: (indicatorId: string | number | null | undefined, fallback: string | null) => {
      const key = String(indicatorId ?? '')
      const fromContext = appraisalState.levelByIndicatorId[key]
      if (fromContext === 'AHEAD' || fromContext === 'NORMAL' || fromContext === 'DELAYED') {
        return fromContext
      }
      if (fallback === 'AHEAD' || fallback === 'NORMAL' || fallback === 'DELAYED') {
        return fallback
      }
      return null
    },
    // 记录加载调用（导出流程应显式重查导出行集的 ids）
    load: async (ids: Array<string | number | null | undefined>) => {
      exportState.loadCalls.push(ids.map(id => String(id)))
    },
    getContext: () => null,
    reloadOne: async () => null,
    canAppraise: () => false,
    getLockHint: () => '',
    save: async () => null,
    openAppraisalGate: async () => {}
  })
}))

vi.mock('@/features/indicator/model/indicatorAttachmentSummary', () => ({
  loadIndicatorAttachmentSummaryMap: async () => null,
  getAttachmentSummary: () => null,
  resolveVisibleAttachments: () => []
}))

vi.mock('@/shared/lib/export/excel', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    exportRowsToExcel: async (sheet: Record<string, unknown>) => {
      exportState.exportRowsToExcelCalls.push({ sheet })
    },
    buildExportFileName: (...args: unknown[]) => args.join('_')
  }
})

vi.mock('@/shared/lib/export/zipExport', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    collectAttachmentGroups: () => [],
    exportDepartmentsAsZip: async () => {},
    countExportAttachments: () => 0,
    buildAttachmentRelativeDir: (...args: unknown[]) => args.join('_')
  }
})

import IndicatorListView from '@/features/indicator/ui/IndicatorListView.vue'

type ExportColumn = { header: string; getValue?: (row: unknown, index: number) => unknown }

function findAppraisalColumn(sheet: Record<string, unknown>): ExportColumn {
  const columns = (sheet.columns as ExportColumn[]) ?? []
  const column = columns.find(item => item.header === '审核进度')
  expect(column, '导出 sheet 应包含「审核进度」列').toBeTruthy()
  return column!
}

async function mountAndExportCurrentRange() {
  const wrapper = shallowMount(IndicatorListView, {
    props: { viewingRole: 'functional_dept', viewingDept: '教务处' },
    global: {
      directives: { loading: noop, focus: noop },
      stubs: { teleport: true }
    }
  })

  const exportButton = wrapper.findAll('button').find(node => node.text().trim() === '导出')
  expect(exportButton, '非学院视角应渲染「导出」按钮').toBeTruthy()
  await exportButton!.trigger('click')
  await flushPromises()
  await flushPromises()

  wrapper.unmount()
  return exportState.exportRowsToExcelCalls.at(-1)!.sheet
}

describe('导出「审核进度」列与网格同源（2026-11-17 领导二-2）', () => {
  beforeEach(() => {
    exportState.exportRowsToExcelCalls = []
    exportState.loadCalls = []
    appraisalState.levelByIndicatorId = {}
    viewModelOverrides.list = {}
  })

  it('实时等级 context 有值：导出跟随 context（DELAYED → 「滞后」，与网格显示一致）', async () => {
    appraisalState.levelByIndicatorId['201'] = 'DELAYED'
    const sheet = await mountAndExportCurrentRange()
    const column = findAppraisalColumn(sheet)
    const row = (sheet.rows as unknown[])[0]

    expect(column.getValue!(row, 0)).toBe('滞后')
  })

  it('实时等级 context 无值：导出回退行内存字段（NORMAL → 「正常」）', async () => {
    appraisalState.levelByIndicatorId['201'] = null
    const sheet = await mountAndExportCurrentRange()
    const column = findAppraisalColumn(sheet)
    const row = (sheet.rows as unknown[])[0]

    expect(column.getValue!(row, 0)).toBe('正常')
  })

  it('context 与行字段都无值：导出显示「未评定」（空值兜底，与网格空态同源）', async () => {
    appraisalState.levelByIndicatorId['201'] = null
    viewModelOverrides.list = {
      currentPlanIndicators: ref([
        {
          id: '202',
          name: '核心指标乙',
          taskContent: '战略任务乙',
          type1: '定量',
          type2: '发展性',
          weight: 5,
          manualAlertSeverity: null,
          pendingRemark: '-'
        }
      ] as unknown[])
    }
    const sheet = await mountAndExportCurrentRange()
    const column = findAppraisalColumn(sheet)
    const row = (sheet.rows as unknown[])[0]

    expect(column.getValue!(row, 0)).toBe('未评定')
  })

  it('导出流程显式重查实时等级 context（load 以导出行集 ids 调用）', async () => {
    await mountAndExportCurrentRange()

    expect(
      exportState.loadCalls.some(ids => ids.includes('201')),
      '导出前应调用 load(导出行 ids) 重查实时等级 context'
    ).toBe(true)
  })

  it('职能部门/战略部视角导出列结构不变：仍含「战略任务」列（2026-11-18 学院删列不影响非学院视角）', async () => {
    const sheet = await mountAndExportCurrentRange()
    const headers = ((sheet.columns as ExportColumn[]) ?? []).map(column => column.header)

    expect(headers, '非学院视角导出保留「战略任务」列').toContain('战略任务')
    expect(headers, '非学院视角导出保留「核心指标」列').toContain('核心指标')
  })
})
