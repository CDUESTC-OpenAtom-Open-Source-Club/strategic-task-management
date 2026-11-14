import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 2026-11-14（P1）学院新增行「目标学院一致性」契约锁。
 *
 * <p>缺陷（真机实测）：学院页签「新增行」点「发起异动」时，create 条目**不带**
 * targetOrgId，后端只能按「父级下游 FUNC_TO_COLLEGE 计划」反推目标学院——
 * 实测「计算机学院(57) × 教务处」时，下游计划是「教务处 → 工学院(56)」，
 * 新行被落进工学院；权重恰好凑得上 100 就整批通过 → 静默污染别的学院。</p>
 *
 * <p>修法（防御层）：前端把 UI 所选学院作为**显式目标**随 create 条目提交，
 * 后端据此判定目标学院并做一致性校验（与父级现有子指标不一致 → 400 明确拒绝），
 * 把「静默落错」变成「明确拒绝」。</p>
 *
 * <p>本文件锁三件事：① create 条目带 targetOrgId；② 职能页签旧落库格式
 * （{id, create:true}）**不带** targetOrgId（后端旧格式没有该语义）；③ 父级候选
 * **不按学院过滤**（用户定案：同一归口的核心指标本来就同时下发给多个学院，
 * 同一个父级在多个学院的列表里重复出现是正确的）。</p>
 */

const readSource = (relative: string): string =>
  readFileSync(resolve(process.cwd(), relative), 'utf8')

const modelSource = readSource('src/3-features/task/model/useStrategicTaskView.ts')
const apiSource = readSource('src/3-features/indicator/api/mutationApi.ts')

const sliceOf = (source: string, startMarker: string, endMarker: string): string => {
  const start = source.indexOf(startMarker)
  expect(start).toBeGreaterThan(0)
  const end = source.indexOf(endMarker, start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

const submitBody = (): string =>
  sliceOf(modelSource, 'const submitMutationDraft = async', '// 指标双击编辑')

describe('P1 契约：学院新增行 create 条目必须带显式目标学院 targetOrgId', () => {
  it('create 条目带 targetOrgId（= UI 所选学院），键名与后端解析口径一致', () => {
    const body = submitBody()
    expect(body).toContain('create: true,')
    expect(body).toContain('indicatorDesc: draft.name,')
    expect(body).toContain('weightPercent: draft.weight,')
    expect(body).toContain('indicatorType: draft.type1,')
    expect(body).toContain('parentIndicatorId: draft.parentIndicatorId,')
    expect(body).toContain('taskId: draft.taskId,')
    // 核心断言：显式目标学院随 create 条目提交（后端据此校验一致性）
    expect(body).toContain('targetOrgId: draft.targetOrgId')
  })

  it('草稿行的 targetOrgId 来源 = UI 所选学院（保存时解析，落库前不丢）', () => {
    const saveBody = sliceOf(
      modelSource,
      'const saveCollegeChildIndicator',
      'const showAssignmentDialog'
    )
    // 目标学院取自左侧所选学院
    expect(saveBody).toContain(
      'const targetOrgId = resolveDepartmentIdByName(selectedCollege.value)'
    )
    // 草稿行整行携带该 orgId（发起异动时随 create 条目提交）
    expect(saveBody).toContain('targetOrgId,')
  })

  it('API 层 initiateBatch 的 item 类型声明 targetOrgId?: number', () => {
    expect(apiSource).toMatch(
      /async initiateBatch\([\s\S]*?targetOrgId\?: number[\s\S]*?\n {2}\): Promise<ApiResponse<string\[\]>>/
    )
  })

  it('职能页签旧落库格式（{id, create:true}）不带 targetOrgId（后端旧格式无该语义）', () => {
    const body = submitBody()
    expect(body).toContain('pendingCreates.map(id => ({ id, create: true as const }))')
    // 旧格式条目对象里只有 id + create
    const legacy = body.slice(
      body.indexOf('pendingCreates.map(id => ({ id, create: true as const }))')
    )
    expect(legacy.slice(0, 120)).not.toContain('targetOrgId')
  })
})

describe('P1 回归锁：父级候选不按学院过滤（同一父级可下发给多个学院）', () => {
  it('collegeParentIndicatorOptions 仍是锚点基座全量映射，没有学院过滤', () => {
    expect(modelSource).toMatch(
      /const collegeParentIndicatorOptions = computed\(\(\) =>\s*\n\s*collegeDispatchAnchorIndicators\.value\.map/
    )
    expect(modelSource).not.toContain('buildCollegeLegalParentIndicatorIds')
    expect(modelSource).not.toContain('collegeLegalParentIndicatorIds')
  })

  it('没有引入「按所选学院收口父级候选」的空态分支（该方案已被用户定案否决）', () => {
    expect(modelSource).not.toContain('collegeParentIndicatorEmptyHint')
    expect(modelSource).not.toContain('暂无关联核心指标，请先联系归口部门下发')
  })
})
