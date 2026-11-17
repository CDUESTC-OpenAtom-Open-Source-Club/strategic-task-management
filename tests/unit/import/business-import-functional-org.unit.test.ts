import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 2026-11-17（学院线粒度改造 · 规格书 4.9①④）：
 * ① 导入请求带归口部门——学院子指标表按「学院 × 归口部门」定位计划（线），导入
 *    请求必须把页面已选归口（functionalOrgId，字段名由规格书第六节契约固定）传给
 *    后端；未选归口前端先拦（不给后端误命中别的归口的线的机会）。
 * ④ 阻断文案优先展示后端原文——后端点名归口的真实原因（如「该学院 2026 年度的
 *    「教务处」这条线已下发…」）不得再被前端统一改写成
 *    「当前任务已下发，不能重复导入或下发。」（曹老师线上反馈的盖原因缺陷）；
 *    兜底文案主语按导入类型区分（学院导入说「学院计划」，不说「部门计划」）。
 */

const uploadSpy = vi.hoisted(() => vi.fn(async () => ({ data: { confirmToken: 't' } })))
const postSpy = vi.hoisted(() => vi.fn(async () => ({ data: { status: 'COMMITTED' } })))

vi.mock('@/shared/api/client', () => ({
  apiClient: {
    upload: uploadSpy,
    post: postSpy
  }
}))

import { businessImportApi } from '@/features/import/api/businessImport'
import {
  COLLEGE_IMPORT_FUNCTIONAL_ORG_REQUIRED,
  formatCommitBlockedMessage
} from '@/features/import/ui/BusinessImportDialog.vue'

const readSource = (relative: string): string =>
  readFileSync(resolve(process.cwd(), relative), 'utf8')

const makeFile = () => new File(['binary'], 'plan.xlsx', { type: 'application/octet-stream' })

beforeEach(() => {
  uploadSpy.mockClear()
  postSpy.mockClear()
})

describe('import/api/businessImport · 学院导入请求带归口部门（functionalOrgId）', () => {
  it('previewDistributionImport 把 functionalOrgId 传给后端（multipart 附加参数）', async () => {
    await businessImportApi.previewDistributionImport(makeFile(), {
      cycleId: 7,
      targetCollegeOrgId: 56,
      sourceOrgId: 35,
      functionalOrgId: 44
    })
    expect(uploadSpy).toHaveBeenCalledTimes(1)
    const params = uploadSpy.mock.calls[0][2] as Record<string, unknown>
    expect(params.functionalOrgId).toBe(44)
    expect(params.cycleId).toBe(7)
    expect(params.targetCollegeOrgId).toBe(56)
    expect(params.sourceOrgId).toBe(35)
  })

  it('可选参数未指定（null / undefined）→ 整个键不进 FormData（apiClient.upload 会把 null 序列化成 "null" 害后端 400）', async () => {
    await businessImportApi.previewDistributionImport(makeFile(), {
      cycleId: 7,
      targetCollegeOrgId: 56,
      sourceOrgId: undefined,
      functionalOrgId: null
    })
    const params = uploadSpy.mock.calls[0][2] as Record<string, unknown>
    expect('functionalOrgId' in params).toBe(false)
    expect('sourceOrgId' in params).toBe(false)
  })

  it('职能部门导入（strategic-task）不涉及归口维度：预览参数不含 functionalOrgId 键', async () => {
    await businessImportApi.previewStrategicTaskImport(makeFile(), {
      cycleId: 7,
      targetOrgId: 44
    })
    const params = uploadSpy.mock.calls[0][2] as Record<string, unknown>
    expect('functionalOrgId' in params).toBe(false)
  })

  it('契约锁：DTO 字段名固定 functionalOrgId（规格书第六节，前端不得改名）', () => {
    const source = readSource('src/3-features/import/api/businessImport.ts')
    expect(source).toContain('functionalOrgId?: number | null')
    expect(source).toMatch(/DistributionImportPreviewParams[\s\S]*?functionalOrgId/)
    expect(source).toMatch(/ImportCommitRequest[\s\S]*?functionalOrgId/)
  })
})

describe('import/ui/BusinessImportDialog · formatCommitBlockedMessage（后端原文优先）', () => {
  it('后端点名归口的「已下发」原因 → 原文照常展示，不再被改写成通用兜底', () => {
    // 旧实现把含「已下发」的 reason 统一改写成「当前任务已下发，不能重复导入或下发。」
    // —— 曹老师线上反馈的「看不到真实原因」根因，此处锁死不回归。
    const legacyRewrite = '当前任务已下发，不能重复导入或下发。'
    const backendReason = '该学院 2026 年度的「教务处」这条线已下发，不能重复导入'
    const message = formatCommitBlockedMessage(
      { workflow: { message: backendReason } },
      'distribution'
    )
    expect(message).toContain(backendReason)
    expect(message).not.toBe(legacyRewrite)
    expect(message.startsWith('本次导入未写入：')).toBe(true)
  })

  it('含「重复导入」的原因同样透传原文（旧实现同样会被盖掉）', () => {
    const backendReason = '同名子指标重复导入且该线已下发，请按归口部门分别导入'
    const message = formatCommitBlockedMessage(
      { workflow: { message: backendReason } },
      'distribution'
    )
    expect(message).toContain(backendReason)
  })

  it('后端没给可用 reason → 前端兜底；主语按导入类型区分（学院导入不说「部门计划」）', () => {
    const college = formatCommitBlockedMessage({ workflow: { message: '' } }, 'distribution')
    expect(college).toContain('本次导入未写入')
    expect(college).toContain('该学院计划')
    expect(college).not.toContain('该部门计划')

    const dept = formatCommitBlockedMessage({ workflow: null }, 'strategic-task')
    expect(dept).toContain('该部门计划')
    expect(dept).not.toContain('该学院计划')
  })

  it('权重拦截保留 2026-10-31 口径：前端补充说明在前、后端原文附后', () => {
    const backendReason = '基础性指标权重全计划合计须为 100，当前 90'
    const message = formatCommitBlockedMessage(
      { workflow: { message: backendReason } },
      'distribution'
    )
    expect(message).toContain('基础性指标权重全计划合计须为 100%')
    expect(message.endsWith(backendReason)).toBe(true)
  })

  it('未选归口的统一提示文案常量（实现与组件共用，防漂移）', () => {
    expect(COLLEGE_IMPORT_FUNCTIONAL_ORG_REQUIRED).toBe(
      '请先选择职能部门（归口部门）：学院子指标表按归口部门分别导入'
    )
  })
})

describe('import/ui/BusinessImportDialog · 归口入参接线（源码契约锁）', () => {
  const dialogSource = readSource('src/3-features/import/ui/BusinessImportDialog.vue')

  it('props 声明 functionalOrgId / functionalOrgName（学院子指标表导入专用）', () => {
    expect(dialogSource).toContain('functionalOrgId?: number | null')
    expect(dialogSource).toContain('functionalOrgName?: string | null')
  })

  it('未选归口 → 解析预览不启用（canPreview 对学院导入追加归口前提）', () => {
    expect(dialogSource).toContain('(isStrategicImport.value || hasFunctionalOrg.value)')
  })

  it('handlePreview 未选归口先拦并提示（不发起请求）', () => {
    expect(dialogSource).toContain(
      "if (!isStrategicImport.value && !hasFunctionalOrg.value) {\n    ElMessage.warning(COLLEGE_IMPORT_FUNCTIONAL_ORG_REQUIRED)"
    )
    expect(dialogSource).toContain('functionalOrgId: props.functionalOrgId ?? undefined')
  })

  it('commit 请求同样携带 functionalOrgId（仅学院导入；职能部门导入不传）', () => {
    expect(dialogSource).toContain(
      '...(isStrategicImport.value\n        ? {}\n        : { functionalOrgId: props.functionalOrgId ?? undefined })'
    )
  })

  it('弹窗摘要区回显「归口部门」（用户上传前可确认本次导入属于哪条线）', () => {
    expect(dialogSource).toContain('<span class="summary-label">归口部门</span>')
    expect(dialogSource).toContain('{{ functionalOrgName || \'未选择\' }}')
  })

  it('自动下发被拦的文案同样保留后端原文（不再整句替换）', () => {
    expect(dialogSource).toContain('不能重复下发。${reason}')
    expect(dialogSource).toContain('请检查导入目标和数据。${reason}')
    expect(dialogSource).toContain('再下发。${reason}')
  })
})

describe('task/ui/StrategicTaskView · 导入弹窗归口接线（源码契约锁）', () => {
  const viewSource = readSource('src/3-features/task/ui/StrategicTaskView.vue')
  const modelSource = readSource('src/3-features/task/model/useStrategicTaskView.ts')

  it('model：collegeDispatchDeptOrgId 取生效归口名解析组织 ID（与 collegeScope 查询同款解析）', () => {
    const start = modelSource.indexOf('const collegeDispatchDeptOrgId = computed')
    expect(start).toBeGreaterThan(0)
    expect(modelSource.slice(start, start + 400)).toContain(
      'resolveDepartmentIdByName(collegeDispatchDeptEffective.value)'
    )
  })

  it('view：学院页签给导入弹窗传所选归口（职能部门页签恒 undefined）', () => {
    expect(viewSource).toContain(
      ":functional-org-id=\"\n        activeTaskTabName === 'college' ? (collegeDispatchDeptOrgId ?? undefined) : undefined\n      \""
    )
    expect(viewSource).toContain(
      ":functional-org-name=\"\n        activeTaskTabName === 'college' ? collegeDispatchDeptEffective : undefined\n      \""
    )
  })
})
