import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 2026-11-19（学院全部导入 · 规划书第二节）：「全部导入」弹窗的渲染契约单测。
 *
 * 覆盖：
 * ① 分组预览渲染（三种状态：将下发 / 将跳过 / 错误组）
 * ② blocking=true → 确认按钮置灰
 * ③ 第 3 步 = 执行清单（列明将下发/将跳过的组）
 * ④ 结果页逐组卡片（SUCCESS=绿+planId / SKIPPED=黄+原因 / FAILED=红+原因）+ 汇总行
 * ⑤ 按钮可见性（学院有 / 职能无）
 */

const previewAllSpy = vi.hoisted(() => vi.fn())
const commitAllSpy = vi.hoisted(() => vi.fn())

// ElMessageBox.confirm 在 jsdom 下会挂一个真实弹窗、永不 resolve —— 全部导入的
// 「执行清单确认框」正是它，必须 mock 成「直接确认」才能测到提交后的结果页。
vi.mock('element-plus', async () => {
  const actual = await vi.importActual<typeof import('element-plus')>('element-plus')
  return {
    ...actual,
    ElMessageBox: {
      ...actual.ElMessageBox,
      confirm: vi.fn(async () => 'confirm'),
      alert: vi.fn(async () => 'confirm')
    }
  }
})

vi.mock('@/features/import/api/businessImport', async () => {
  const actual = await vi.importActual<typeof import('@/features/import/api/businessImport')>(
    '@/features/import/api/businessImport'
  )
  return {
    ...actual,
    businessImportApi: {
      ...actual.businessImportApi,
      previewDistributionAll: previewAllSpy,
      commitDistributionAll: commitAllSpy,
      previewDistributionImport: vi.fn(),
      commitDistributionImport: vi.fn(),
      previewStrategicTaskImport: vi.fn(),
      commitStrategicTaskImport: vi.fn()
    }
  }
})

import BusinessImportDialog from '@/features/import/ui/BusinessImportDialog.vue'

const readSource = (relative: string): string =>
  readFileSync(resolve(process.cwd(), relative), 'utf8')

const buildRow = (overrides: Record<string, unknown> = {}) => ({
  rowNo: 1,
  action: 'CREATE',
  businessKey: 'key-1',
  normalized: {
    parentIndicator: '推进课堂教学改革',
    indicatorName: '课堂教学改革专项',
    indicatorType: '定量',
    weight: 60
  },
  source: {},
  errors: [],
  warnings: [],
  ...overrides
})

const buildAllPreview = (overrides: Record<string, unknown> = {}) => ({
  batchId: 'batch-1',
  cycleId: 7,
  targetCollegeOrgId: 56,
  targetCollegeName: '文理学院',
  groups: [
    {
      functionalOrgId: 44,
      functionalOrgName: '教务处',
      lineStatus: 'DRAFT',
      willDispatch: true,
      skipReason: null,
      groupError: null,
      basicWeightTotal: 100,
      rowsCount: 1,
      rows: [buildRow()]
    },
    {
      functionalOrgId: 45,
      functionalOrgName: '数字校园建设办公室',
      lineStatus: 'DISTRIBUTED',
      willDispatch: false,
      skipReason: '该学院 2026 年度的「数字校园建设办公室」这条线已下发，不能重复导入',
      groupError: null,
      basicWeightTotal: 100,
      rowsCount: 1,
      rows: [buildRow({ rowNo: 2 })]
    },
    {
      functionalOrgId: 46,
      functionalOrgName: '人事处',
      lineStatus: 'NONE',
      willDispatch: false,
      skipReason: null,
      groupError: '人事处组基础性权重合计 85/100，不能下发；请修正该组权重后重新上传',
      basicWeightTotal: 85,
      rowsCount: 1,
      rows: [buildRow({ rowNo: 3 })]
    }
  ],
  unassignedRows: [],
  blocking: false,
  confirmToken: 'token-xyz',
  ...overrides
})

const mountAllDialog = async (preview = buildAllPreview()) => {
  previewAllSpy.mockResolvedValue(preview)
  const wrapper = mount(BusinessImportDialog, {
    props: {
      visible: true,
      mode: 'all' as const,
      type: 'distribution' as const,
      targetOrgId: 56,
      targetOrgName: '文理学院',
      sourceOrgId: 35,
      sourceOrgName: '战略发展部',
      cycleId: 7
    },
    global: {
      stubs: {
        'el-dialog': {
          template:
            '<div class="el-dialog-stub"><slot name="header" /><slot /><slot name="footer" /></div>'
        },
        'el-table': { template: '<div class="el-table-stub"><slot /></div>' },
        'el-table-column': true,
        'el-upload': { template: '<div class="el-upload-stub"><slot /><slot name="tip" /></div>' },
        'el-steps': true,
        'el-step': true,
        'el-alert': {
          props: ['title', 'type'],
          template:
            '<div class="el-alert-stub"><span class="el-alert-title">{{ title }}</span><slot /></div>'
        },
        'el-tag': { template: '<span class="el-tag-stub"><slot /></span>' },
        'el-button': {
          emits: ['click'],
          template: '<button class="el-button-stub" @click="$emit(\'click\')"><slot /></button>'
        },
        'el-icon': true,
        'el-checkbox': true,
        'el-tooltip': { template: '<div class="el-tooltip-stub"><slot /></div>' },
        'el-divider': true
      }
    }
  })
  await wrapper.vm.$nextTick()
  return wrapper
}

const selectFileAndPreview = async (wrapper: ReturnType<typeof mountAllDialog>) => {
  const file = new File(['x'], 'plan.xlsx')
  const upload = wrapper.findComponent({ name: 'ElUpload' })
  // 直接驱动组件内部的选中文件态（el-upload 在 stub 下不发 change）
  ;(wrapper.vm as unknown as { selectedFile: { raw: File } | null }).selectedFile = {
    raw: file,
    name: 'plan.xlsx'
  } as never
  await wrapper.vm.$nextTick()
  // 触发解析预览
  const buttons = wrapper.findAll('button')
  const previewButton = buttons.find(button => button.text().includes('解析预览'))
  await previewButton?.trigger('click')
  await new Promise(resolve => setTimeout(resolve, 0))
  await wrapper.vm.$nextTick()
  return upload
}

beforeEach(() => {
  setActivePinia(createPinia())
  previewAllSpy.mockReset()
  commitAllSpy.mockReset()
})

describe('BusinessImportDialog · mode=all 标题与提示语', () => {
  it('标题为「全部导入学院子指标表」，提示语为「一次导入一个学院，自动按归口部门拆分」', async () => {
    const wrapper = await mountAllDialog()
    await flushPromisesWrapper(wrapper)

    const text = wrapper.text()
    expect(text).toContain('全部导入学院子指标表')
    expect(text).toContain('一次导入一个学院，自动按归口部门拆分')
    wrapper.unmount()
  })

  it('mode=all 不显示「归口部门」必选回显（归口由文件解析）', async () => {
    const wrapper = await mountAllDialog()
    await flushPromisesWrapper(wrapper)

    const summary = wrapper.find('.business-import-summary').text()
    expect(summary).not.toContain('归口部门')
    wrapper.unmount()
  })

  it('单条导入（默认 mode）标题与归口回显保持不变（零回归）', async () => {
    const wrapper = mount(BusinessImportDialog, {
      props: {
        visible: true,
        type: 'distribution' as const,
        targetOrgId: 56,
        targetOrgName: '文理学院',
        functionalOrgId: 44,
        functionalOrgName: '教务处',
        cycleId: 7
      },
      global: {
        stubs: {
          'el-dialog': {
            template:
              '<div class="el-dialog-stub"><slot name="header" /><slot /><slot name="footer" /></div>'
          },
          'el-table': true,
          'el-table-column': true,
          'el-upload': true,
          'el-steps': true,
          'el-step': true,
          'el-alert': true,
          'el-tag': true,
          'el-button': { template: '<button><slot /></button>' },
          'el-icon': true,
          'el-checkbox': true,
          'el-tooltip': { template: '<div><slot /></div>' },
          'el-divider': true
        }
      }
    })
    await flushPromisesWrapper(wrapper)

    expect(wrapper.text()).toContain('导入学院子指标表')
    expect(wrapper.find('.business-import-summary').text()).toContain('归口部门')
    wrapper.unmount()
  })
})

describe('BusinessImportDialog · mode=all 分组预览（三类信息）', () => {
  it('渲染三组：将下发 / 已下发·本次将跳过 / 错误组', async () => {
    const wrapper = await mountAllDialog()
    await selectFileAndPreview(wrapper)
    await flushPromisesWrapper(wrapper)

    const text = wrapper.text()
    expect(text).toContain('教务处')
    expect(text).toContain('将下发')
    expect(text).toContain('已下发 · 本次将跳过')
    expect(text).toContain('错误组')
    // 组级错误文案原样展示（点名部门 + 权重）
    expect(text).toContain('人事处组基础性权重合计 85/100')
    // 跳过原因原样展示
    expect(text).toContain('不能重复导入')
    wrapper.unmount()
  })

  it('组标题带条数 / 线状态（权重合计不再展示，仅错误诊断保留）', async () => {
    const wrapper = await mountAllDialog()
    await selectFileAndPreview(wrapper)
    await flushPromisesWrapper(wrapper)

    const text = wrapper.text()
    expect(text).toContain('1 条 · 线状态')
    expect(text).not.toContain('本组基础性权重合计')
    expect(text).toContain('线状态')
    wrapper.unmount()
  })

  it('blocking=true（存在错误组）→ 确认按钮置灰', async () => {
    const wrapper = await mountAllDialog(buildAllPreview({ blocking: true }))
    await selectFileAndPreview(wrapper)
    await flushPromisesWrapper(wrapper)

    const confirmButton = wrapper
      .findAll('button')
      .find(button => button.text().includes('确认全部导入'))
    expect(confirmButton).toBeDefined()
    expect(confirmButton?.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('blocking=false 且无错误组 → 确认按钮可点', async () => {
    const preview = buildAllPreview({
      blocking: false,
      groups: [buildAllPreview().groups[0]]
    })
    const wrapper = await mountAllDialog(preview)
    await selectFileAndPreview(wrapper)
    await flushPromisesWrapper(wrapper)

    const confirmButton = wrapper
      .findAll('button')
      .find(button => button.text().includes('确认全部导入'))
    expect(confirmButton).toBeDefined()
    expect(confirmButton?.attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('BusinessImportDialog · mode=all 执行清单（第 3 步）', () => {
  it('渲染执行清单：列明将下发 N 组 / 将跳过 M 组及原因', async () => {
    const preview = buildAllPreview({
      groups: [buildAllPreview().groups[0], buildAllPreview().groups[1]]
    })
    const wrapper = await mountAllDialog(preview)
    await selectFileAndPreview(wrapper)
    await flushPromisesWrapper(wrapper)

    const plan = wrapper.find('.execution-plan')
    expect(plan.exists()).toBe(true)
    const planText = plan.text()
    expect(planText).toContain('执行清单')
    expect(planText).toContain('将下发 1 组（教务处）')
    expect(planText).toContain('将跳过 1 组（数字校园建设办公室）')
    wrapper.unmount()
  })
})

describe('BusinessImportDialog · mode=all 逐组结果页', () => {
  it('提交成功后逐组渲染结果卡片 + 汇总行', async () => {
    commitAllSpy.mockResolvedValue({
      results: [
        {
          functionalOrgId: 44,
          functionalOrgName: '教务处',
          status: 'SUCCESS',
          planId: 705489,
          rowsCount: 1,
          message: null
        },
        {
          functionalOrgId: 45,
          functionalOrgName: '数字校园建设办公室',
          status: 'SKIPPED',
          planId: null,
          rowsCount: 1,
          message: '该线已下发，本次将跳过'
        },
        {
          functionalOrgId: 46,
          functionalOrgName: '人事处',
          status: 'FAILED',
          planId: null,
          rowsCount: 1,
          message: '基础性权重合计 85/100'
        }
      ],
      summary: { success: 1, skipped: 1, failed: 1 }
    })

    const wrapper = await mountAllDialog(buildAllPreview({ groups: [buildAllPreview().groups[0]] }))
    await selectFileAndPreview(wrapper)
    await flushPromisesWrapper(wrapper)

    // 触发提交（跳过确认框：直接调组件内部方法）
    ;(wrapper.vm as unknown as { handleAllCommit: () => Promise<void> }).handleAllCommit()
    await flushPromisesWrapper(wrapper)

    const text = wrapper.text()
    expect(text).toContain('下发成功')
    expect(text).toContain('计划ID 705489')
    expect(text).toContain('已跳过')
    expect(text).toContain('下发失败')
    expect(text).toContain('85/100')
    wrapper.unmount()
  })
})

describe('StrategicTaskView · 「全部导入」按钮可见性（源码契约锁）', () => {
  const viewSource = readSource('src/3-features/task/ui/StrategicTaskView.vue')

  it('「全部导入」按钮仅学院页签显示（v-if 绑定学院页签判定）', () => {
    expect(viewSource).toContain('v-if="activeTaskTabName === \'college\'"')
    expect(viewSource).toContain('全部导入')
  })

  it('「全部导入」位于「全部导出」左侧（按钮顺序：全部导入 → 全部导出）', () => {
    const allImportIndex = viewSource.indexOf('@click="openStrategicAllImportDialog"')
    const allExportIndex = viewSource.indexOf('@click="openStrategicBatchExportDialog"')
    expect(allImportIndex).toBeGreaterThan(-1)
    expect(allExportIndex).toBeGreaterThan(-1)
    expect(allImportIndex).toBeLessThan(allExportIndex)
  })

  it('全部导入按钮置灰口径独立于单条导入（不要求先选职能部门）', () => {
    expect(viewSource).toContain('const collegeAllImportDisabledReason = computed')
    expect(viewSource).toContain('const collegeAllImportReady = computed')
    // 置灰口径里**不出现** collegeDispatchDeptFilter（不要求先选职能部门）
    const start = viewSource.indexOf('const collegeAllImportDisabledReason = computed')
    const block = viewSource.slice(start, start + 900)
    expect(block).not.toContain('collegeDispatchDeptFilter')
  })

  it('全部导入弹窗用独立实例（mode=all，不传 functional-org-id）', () => {
    expect(viewSource).toContain('v-model:visible="strategicAllImportDialogVisible"')
    expect(viewSource).toContain('mode="all"')
    expect(viewSource).toContain('@all-committed="handleStrategicAllImportCommitted"')
  })

  it('全部导入模板 seeds 传该学院全部归口锚点全集（带 functionalDeptName）', () => {
    expect(viewSource).toContain(':parent-indicators="collegeAllImportParentIndicators"')
  })
})

const flushPromisesWrapper = async (wrapper: { vm: unknown }) => {
  await new Promise(resolve => setTimeout(resolve, 0))
  await (wrapper.vm as { $nextTick: () => Promise<void> }).$nextTick()
}
