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

/**
 * 2026-11-18（用户拍板·学院删列第 2 批）学院页签「任务类型」列结构契约锁定：
 *
 * 背景：后端库表已移除 type2，学院链行的任务类型映射在填报人视角恒缺省
 * （strategic.ts mapper 兜底『基础性』）——学院页签导出的「任务类型」列整列
 * 显示缺省值，对学院侧读者是误导信息。用户拍板学院视角不显示该列：
 * ① 学院页签导出（handleExportCollegeIndicators）不再输出「任务类型」列；
 * ② 学院页签页面表格本就无此列（子指标名称/权重/自评进度/审核进度/上报资料/
 *    进度说明/操作），界面无同步改动、无 spanMethod 牵连（合并只在职能页签
 *    getSpanMethod 的战略任务列）；
 * ③ 职能部门页签导出（buildStrategicExportColumns）的「任务类型」列保持不动
 *    ——职能/战略部视角零变化（视角不变铁律，2026-11-18 学院删列第 1 批
 *    「战略任务」列同款契约模式）。
 */
describe('学院页签删「任务类型」列（2026-11-18 学院删列第 2 批）', () => {
  const collegeExportStart = viewSource.indexOf('const handleExportCollegeIndicators')
  const collegeExportEnd = viewSource.indexOf('const handleExportCurrentStrategicDepartment')

  it('学院页签导出：不再输出「任务类型」列', () => {
    expect(collegeExportStart).toBeGreaterThan(0)
    expect(collegeExportEnd).toBeGreaterThan(collegeExportStart)
    const collegeExportSource = viewSource.slice(collegeExportStart, collegeExportEnd)

    expect(
      collegeExportSource,
      '学院页签导出列定义不得再出现「任务类型」列（填报人视角整列缺省『基础性』，误导）'
    ).not.toMatch(/header:\s*'任务类型'/)
    // 周边列保持完整（删列不误伤）
    expect(collegeExportSource).toMatch(/header:\s*'指标名称'/)
    expect(collegeExportSource).toMatch(/header:\s*'指标类型'/)
    expect(collegeExportSource).toMatch(/header:\s*'权重'/)
    expect(collegeExportSource).toMatch(/header:\s*'状态'/)
  })

  it('学院页签页面表格：本就无「任务类型」列头（删列后界面与导出同口径）', () => {
    const collegePaneStart = viewSource.indexOf('<el-tab-pane name="college">')
    expect(collegePaneStart).toBeGreaterThan(0)
    const collegePane = viewSource.slice(collegePaneStart)
    const paneEnd = collegePane.indexOf('</el-tab-pane>')
    const collegeTabSource = collegePane.slice(0, paneEnd)

    expect(
      collegeTabSource,
      '学院页签表格列头不得出现「任务类型」（页面表格向来无此列，锁定防回归）'
    ).not.toMatch(/label="任务类型"/)
  })

  it('职能部门页签导出：「任务类型」列保留不动（职能/战略部视角零变化）', () => {
    const functionalExportStart = viewSource.indexOf('const buildStrategicExportColumns')
    expect(functionalExportStart).toBeGreaterThan(0)
    const functionalExportSource = viewSource.slice(
      functionalExportStart,
      viewSource.indexOf('const buildStrategicExportSheet')
    )

    expect(
      functionalExportSource,
      '职能部门/战略部视角导出保留「任务类型」列（视角不变铁律）'
    ).toMatch(/header:\s*'任务类型'/)
  })
})
