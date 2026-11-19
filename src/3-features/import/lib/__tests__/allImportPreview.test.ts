import { describe, expect, it } from 'vitest'
import type {
  ImportAllCommitResponse,
  ImportGroupPreview,
  ImportRowPreview
} from '@/features/import/api/businessImport'
import {
  buildImportExecutionPlan,
  formatImportExecutionPlanSummary,
  formatImportLineStatus,
  resolveImportGroupKind,
  summarizeImportAllResults,
  toImportGroupResultView,
  toImportGroupView,
  UNASSIGNED_GROUP_TITLE
} from '@/features/import/lib/allImportPreview'

/**
 * 2026-11-19（学院全部导入 · 规划书第二节）：分组预览三态 / blocking 置灰 /
 * 执行清单 / 逐组结果卡片 的纯函数契约单测。
 *
 * 三类信息（用户点名要有）：
 * · 将下发组 → 常规展示
 * · 将跳过组 → 黄色「已下发 · 本次将跳过」+ skipReason
 * · 错误组 → 红色组级错误 groupError（阻断整单）
 */

const buildRow = (overrides: Partial<ImportRowPreview> = {}): ImportRowPreview =>
  ({
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
  }) as ImportRowPreview

const buildGroup = (overrides: Partial<ImportGroupPreview> = {}): ImportGroupPreview => ({
  functionalOrgId: 44,
  functionalOrgName: '教务处',
  lineStatus: 'DRAFT',
  willDispatch: true,
  skipReason: null,
  groupError: null,
  basicWeightTotal: 100,
  rowsCount: 1,
  rows: [buildRow()],
  ...overrides
})

describe('allImportPreview · 分组归类（三类信息）', () => {
  it('常规组（无组级错误、无跳过原因）→ 将下发', () => {
    expect(resolveImportGroupKind(buildGroup())).toBe('dispatch')
    expect(toImportGroupView(buildGroup()).kind).toBe('dispatch')
  })

  it('有 skipReason 的组 → 将跳过（黄色），并保留跳过原因', () => {
    const group = buildGroup({
      willDispatch: false,
      lineStatus: 'DISTRIBUTED',
      skipReason: '该学院 2026 年度的「教务处」这条线已下发，不能重复导入'
    })
    const view = toImportGroupView(group)

    expect(view.kind).toBe('skip')
    expect(view.skipReason).toContain('已下发')
    expect(view.lineStatusLabel).toBe('已下发')
  })

  it('有 groupError 的组 → 错误组（红色），并保留组级错误文案', () => {
    const group = buildGroup({
      willDispatch: false,
      groupError: '教务处组基础性权重合计 85/100，不能下发；请修正该组权重或删除该组行后重新上传'
    })
    const view = toImportGroupView(group)

    expect(view.kind).toBe('error')
    expect(view.groupError).toContain('85/100')
  })

  it('组级错误优先于跳过原因（同时命中时归错误类 —— 错误会阻断整单，必须先修权重）', () => {
    const group = buildGroup({
      groupError: '权重合计 85/100',
      skipReason: '该线已下发'
    })
    expect(resolveImportGroupKind(group)).toBe('error')
  })

  it('无法识别归属部门的组 → 标题兜底为「无法识别归属部门」', () => {
    const view = toImportGroupView(
      buildGroup({ functionalOrgId: null, functionalOrgName: null, groupError: '无法识别归属部门' })
    )
    expect(view.title).toBe(UNASSIGNED_GROUP_TITLE)
  })

  it('组视图携带行数 / 基础性权重合计 / 线状态标签', () => {
    const view = toImportGroupView(
      buildGroup({ rowsCount: 3, basicWeightTotal: 100, lineStatus: 'IN_REVIEW' })
    )
    expect(view.rowsCount).toBe(3)
    expect(view.basicWeightTotal).toBe(100)
    expect(view.lineStatusLabel).toBe('审批中')
  })
})

describe('allImportPreview · 线状态文案', () => {
  it.each([
    ['DISTRIBUTED', '已下发'],
    ['IN_REVIEW', '审批中'],
    ['PENDING', '待下发'],
    ['DRAFT', '草稿'],
    ['NONE', '未建线']
  ] as const)('%s → %s', (status, label) => {
    expect(formatImportLineStatus(status)).toBe(label)
  })

  it('未知状态 → 未知状态（不崩、不空）', () => {
    expect(formatImportLineStatus(undefined)).toBe('未知状态')
  })
})

describe('allImportPreview · 执行清单（确认页内容）', () => {
  it('三类分组分别归入 dispatch / skip / error 三个清单', () => {
    const plan = buildImportExecutionPlan([
      buildGroup({ functionalOrgId: 1, functionalOrgName: '教务处' }),
      buildGroup({
        functionalOrgId: 2,
        functionalOrgName: '数字校园建设办公室',
        willDispatch: false,
        skipReason: '该线已下发'
      }),
      buildGroup({
        functionalOrgId: 3,
        functionalOrgName: '人事处',
        willDispatch: false,
        groupError: '人事处组基础性权重合计 60/100，不能下发'
      })
    ])

    expect(plan.dispatchGroups.map(group => group.title)).toEqual(['教务处'])
    expect(plan.skipGroups.map(group => group.title)).toEqual(['数字校园建设办公室'])
    expect(plan.errorGroups.map(group => group.title)).toEqual(['人事处'])
    expect(plan.totalGroups).toBe(3)
  })

  it('执行清单总述文案列明「将下发 N 组（部门名）/ 将跳过 M 组（部门名）」', () => {
    const plan = buildImportExecutionPlan([
      buildGroup({ functionalOrgId: 1, functionalOrgName: '教务处' }),
      buildGroup({
        functionalOrgId: 2,
        functionalOrgName: '数字校园建设办公室',
        willDispatch: false,
        skipReason: '该线已下发'
      })
    ])
    const summary = formatImportExecutionPlanSummary(plan)

    expect(summary).toContain('将下发 1 组（教务处）')
    expect(summary).toContain('将跳过 1 组（数字校园建设办公室）')
  })

  it('blocking=true（后端给）→ 整单阻断', () => {
    const plan = buildImportExecutionPlan([buildGroup()], { blocking: true })
    expect(plan.blocking).toBe(true)
  })

  it('存在错误组 → 即便后端 blocking=false 也阻断（前端守住）', () => {
    const plan = buildImportExecutionPlan(
      [
        buildGroup({
          functionalOrgId: 3,
          functionalOrgName: '人事处',
          groupError: '权重合计 60/100'
        })
      ],
      { blocking: false }
    )
    expect(plan.blocking).toBe(true)
    expect(plan.errorGroups).toHaveLength(1)
  })

  it('存在无法识别归属部门的行 → 阻断', () => {
    const plan = buildImportExecutionPlan([buildGroup()], {
      unassignedRows: [buildRow({ rowNo: 9 })]
    })
    expect(plan.blocking).toBe(true)
    expect(plan.unassignedRowsCount).toBe(1)
  })

  it('全部正常（无错误、无跳过、无未识别行）→ 不阻断，可确认提交', () => {
    const plan = buildImportExecutionPlan([buildGroup(), buildGroup({ functionalOrgId: 2 })], {
      blocking: false
    })
    expect(plan.blocking).toBe(false)
    expect(plan.dispatchGroups).toHaveLength(2)
  })
})

describe('allImportPreview · 逐组结果卡片', () => {
  it('SUCCESS → 绿 + 计划ID', () => {
    const view = toImportGroupResultView({
      functionalOrgId: 44,
      functionalOrgName: '教务处',
      status: 'SUCCESS',
      planId: 705489,
      rowsCount: 3,
      message: null
    })

    expect(view.status).toBe('SUCCESS')
    expect(view.tagType).toBe('success')
    expect(view.statusLabel).toBe('下发成功')
    expect(view.planId).toBe(705489)
    expect(view.title).toBe('教务处')
  })

  it('SKIPPED → 黄 + 原因', () => {
    const view = toImportGroupResultView({
      functionalOrgId: 45,
      functionalOrgName: '数字校园建设办公室',
      status: 'SKIPPED',
      planId: null,
      rowsCount: 1,
      message: '该线已下发，本次将跳过'
    })

    expect(view.tagType).toBe('warning')
    expect(view.statusLabel).toBe('已跳过')
    expect(view.message).toContain('已下发')
  })

  it('FAILED → 红 + 原因', () => {
    const view = toImportGroupResultView({
      functionalOrgId: 46,
      functionalOrgName: '人事处',
      status: 'FAILED',
      planId: null,
      rowsCount: 2,
      message: '基础性权重合计 85/100'
    })

    expect(view.tagType).toBe('danger')
    expect(view.statusLabel).toBe('下发失败')
    expect(view.message).toContain('85/100')
  })

  it('汇总行按后端 summary 统计；缺失时按 results 现算', () => {
    const response: ImportAllCommitResponse = {
      results: [
        {
          functionalOrgId: 1,
          functionalOrgName: '教务处',
          status: 'SUCCESS',
          planId: 1,
          rowsCount: 1,
          message: null
        },
        {
          functionalOrgId: 2,
          functionalOrgName: '数办',
          status: 'SKIPPED',
          planId: null,
          rowsCount: 1,
          message: '已下发'
        },
        {
          functionalOrgId: 3,
          functionalOrgName: '人事处',
          status: 'FAILED',
          planId: null,
          rowsCount: 1,
          message: '权重不足'
        }
      ],
      summary: { success: 1, skipped: 1, failed: 1 }
    }

    const summary = summarizeImportAllResults(response)
    expect(summary).toMatchObject({ success: 1, skipped: 1, failed: 1, total: 3 })
    expect(summary.allFailed).toBe(false)
  })

  it('全部组失败 → allFailed=true（整单失败）', () => {
    const summary = summarizeImportAllResults({
      results: [
        {
          functionalOrgId: 1,
          functionalOrgName: '教务处',
          status: 'FAILED',
          planId: null,
          rowsCount: 1,
          message: '失败'
        }
      ],
      summary: { success: 0, skipped: 0, failed: 1 }
    })
    expect(summary.allFailed).toBe(true)
  })

  it('空响应 → 汇总全 0，不崩', () => {
    const summary = summarizeImportAllResults(null)
    expect(summary).toMatchObject({ success: 0, skipped: 0, failed: 0, total: 0 })
    expect(summary.allFailed).toBe(false)
  })
})
