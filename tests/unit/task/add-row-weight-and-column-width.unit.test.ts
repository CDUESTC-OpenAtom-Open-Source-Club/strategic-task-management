import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const readSource = (relative: string): string =>
  readFileSync(resolve(process.cwd(), relative), 'utf8')

const viewSource = readSource('src/3-features/task/ui/StrategicTaskView.vue')
const modelSource = readSource('src/3-features/task/model/useStrategicTaskView.ts')

const functionalFormStart = viewSource.search(
  /isAddingOrEditing && activeTaskTabName === 'functional'/
)
const collegeFormStart = viewSource.search(/isAddingOrEditing && activeTaskTabName === 'college'/)

/**
 * 2026-11-13（用户拍板）新增行表单两处视觉/交互口径修正：
 *
 * 1. 指标类型 / 权重列 span 4→8（两处表单同步）——span=4 时 1280 宽窗口下
 *    select 被挤到「定..」截断；8 列 + label-width 80px 后「定量/定性」完整显示
 *    （与下发页 IndicatorDistributeView 的 8/8 布局对齐）；
 * 2. 权重默认值 0 → 空——0 会被误读成「已填的合法权重」直接保存，留空强制
 *    显式输入；「请填写大于 0 的权重」保存校验保持不变（空值 Number(undefined)=NaN
 *    同样被拦）。
 *
 * 组件/模型接线用源码契约锁（college-two-step-selection 同款模式）。
 */
describe('新增行表单列宽与权重默认值（2026-11-13）', () => {
  it('职能页签表单：指标类型/权重列为 span 8，1280 宽窗口不再截断「定量/定性」', () => {
    expect(functionalFormStart).toBeGreaterThan(0)
    const paneEnd = viewSource.indexOf('</el-tab-pane>', functionalFormStart)
    const functionalForm = viewSource.slice(functionalFormStart, paneEnd)

    expect(functionalForm).toMatch(/<el-col :span="8">[\s\S]{0,400}\*<\/span>指标类型/)
    expect(functionalForm).toMatch(/<el-col :span="8">[\s\S]{0,400}\*<\/span>权重/)
    // 旧取值（截断根因）不得回归
    expect(functionalForm).not.toMatch(/<el-col :span="4">[\s\S]{0,400}\*<\/span>指标类型/)
    expect(functionalForm).not.toMatch(/<el-col :span="4">[\s\S]{0,400}\*<\/span>权重/)
  })

  it('学院页签表单：指标类型/权重列同为 span 8（与职能页签同构）', () => {
    expect(collegeFormStart).toBeGreaterThan(0)
    const paneEnd = viewSource.indexOf('</el-tab-pane>', collegeFormStart)
    const collegeForm = viewSource.slice(collegeFormStart, paneEnd)

    expect(collegeForm).toMatch(/<el-col :span="8">[\s\S]{0,400}\*<\/span>指标类型/)
    expect(collegeForm).toMatch(/<el-col :span="8">[\s\S]{0,400}\*<\/span>权重/)
    expect(collegeForm).not.toMatch(/<el-col :span="4">[\s\S]{0,400}\*<\/span>指标类型/)
    expect(collegeForm).not.toMatch(/<el-col :span="4">[\s\S]{0,400}\*<\/span>权重/)
  })

  it('权重默认值为空（非 0）：newRow 初始值与 resetNewRow 复位同口径', () => {
    expect(modelSource).toMatch(/weight: undefined as number \| undefined/)
    // resetNewRow 复位同样不预置 0
    expect(modelSource).toMatch(/weight: undefined,\s*\n\s*remark: ''/)
    expect(modelSource).not.toContain('weight: 0,')
  })

  it('「请填写大于 0 的权重」保存校验保留：空值（NaN）与 0 同样被拦', () => {
    // 学院分支 + 职能分支各一处
    const warnings = modelSource.match(/ElMessage\.warning\('请填写大于 0 的权重'\)/g) ?? []
    expect(warnings.length).toBeGreaterThanOrEqual(2)
    expect(modelSource).toMatch(/Number\(newRow\.value\.weight\)/)
  })
})
