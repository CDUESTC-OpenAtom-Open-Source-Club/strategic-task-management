import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildCollegeExportColumns,
  COLLEGE_EXPORT_FUNCTIONAL_DEPT_HEADER,
  formatCollegeExportFunctionalDept,
  groupCollegeExportRows,
  resolveCollegeExportPackaging
} from '../collegeAllExport'

/**
 * 2026-11-19（用户拍板 · 学院页签「全部导出」改造）：学院全部导出契约单测。
 *
 * 改造点：
 * ① 一学院一张表（多学院 → 多文件/一学院一文件）
 * ② 导出表含「职能部门」列且行值正确
 * ③ 未选职能部门也能点全部导出并导出全部学院（无归口门槛）
 * ④ 职能部门页签导出行为不变
 */

const readSource = (relative: string): string =>
  readFileSync(resolve(process.cwd(), relative), 'utf8')

interface Row extends Record<string, unknown> {
  id: number
  name: string
  college: string
  dept: string
  type1: string
  weight: number
  status: string
}

const buildRow = (overrides: Partial<Row>): Row => ({
  id: 1,
  name: '课堂教学改革专项',
  college: '文理学院',
  dept: '教务处',
  type1: '定量',
  weight: 60,
  status: 'DISTRIBUTED',
  ...overrides
})

const getCollege = (row: Row) => row.college
const getDept = (row: Row) => row.dept

describe('collegeAllExport · 按学院分组（一学院一张表）', () => {
  it('两个学院 → 两组，组内行不串组', () => {
    const rows: Row[] = [
      buildRow({ id: 1, college: '文理学院', dept: '教务处' }),
      buildRow({ id: 2, college: '计算机学院', dept: '数字校园建设办公室' }),
      buildRow({ id: 3, college: '文理学院', dept: '数字校园建设办公室' })
    ]

    const groups = groupCollegeExportRows(rows, getCollege, getDept)

    expect(groups).toHaveLength(2)
    expect(groups[0].college).toBe('文理学院')
    expect(groups[0].rows.map(row => row.id)).toEqual([1, 3])
    expect(groups[1].college).toBe('计算机学院')
    expect(groups[1].rows.map(row => row.id)).toEqual([2])
  })

  it('同一学院的多个归口部门归到同一组（跨线合并）', () => {
    const rows: Row[] = [
      buildRow({ id: 1, college: '文理学院', dept: '教务处' }),
      buildRow({ id: 2, college: '文理学院', dept: '数字校园建设办公室' })
    ]

    const groups = groupCollegeExportRows(rows, getCollege, getDept)

    expect(groups).toHaveLength(1)
    expect(groups[0].functionalDepts).toEqual(['教务处', '数字校园建设办公室'])
    expect(groups[0].rows).toHaveLength(2)
  })

  it('解析不出学院的行被丢弃（不混进任何学院的表）', () => {
    const rows: Row[] = [buildRow({ id: 1, college: '文理学院' }), buildRow({ id: 2, college: '' })]

    const groups = groupCollegeExportRows(rows, getCollege, getDept)

    expect(groups).toHaveLength(1)
    expect(groups[0].rows.map(row => row.id)).toEqual([1])
  })

  it('空输入 → 空分组（不崩）', () => {
    expect(groupCollegeExportRows([], getCollege, getDept)).toEqual([])
    expect(groupCollegeExportRows(null, getCollege, getDept)).toEqual([])
  })
})

describe('collegeAllExport · 导出列（含「职能部门」列）', () => {
  const buildColumns = (rows: Row[]) =>
    buildCollegeExportColumns({
      rows,
      getFunctionalDept: getDept,
      getSelfRatingLabel: () => '正常',
      getAppraisalLabel: () => '已鉴定',
      getRemarkText: () => '—'
    })

  it('列定义含「职能部门」列，且在最前', () => {
    const columns = buildColumns([buildRow({})])
    expect(columns[0].header).toBe(COLLEGE_EXPORT_FUNCTIONAL_DEPT_HEADER)
    expect(columns.map(column => column.header)).toContain('职能部门')
  })

  it('「职能部门」列的行值 = 该行所属归口部门', () => {
    const rows = [
      buildRow({ id: 1, dept: '教务处' }),
      buildRow({ id: 2, dept: '数字校园建设办公室' })
    ]
    const columns = buildColumns(rows)
    const functionalDeptColumn = columns[0]

    expect(functionalDeptColumn.getValue(rows[0], 0)).toBe('教务处')
    expect(functionalDeptColumn.getValue(rows[1], 1)).toBe('数字校园建设办公室')
  })

  it('保留既有的自评进度 / 审核进度 / 进度说明等列', () => {
    const headers = buildColumns([buildRow({})]).map(column => column.header)
    expect(headers).toContain('自评进度')
    expect(headers).toContain('审核进度')
    expect(headers).toContain('进度说明')
    expect(headers).toContain('指标名称')
    expect(headers).toContain('权重')
    expect(headers).toContain('状态')
  })

  it('取不到归口部门 → 统一显示「—」（不留空）', () => {
    expect(formatCollegeExportFunctionalDept('')).toBe('—')
    expect(formatCollegeExportFunctionalDept(undefined)).toBe('—')
    expect(formatCollegeExportFunctionalDept('  ')).toBe('—')
    expect(formatCollegeExportFunctionalDept('教务处')).toBe('教务处')
  })
})

describe('collegeAllExport · 文件组织', () => {
  it('单学院 → 直接出 xlsx（不强制 zip）', () => {
    expect(resolveCollegeExportPackaging(1)).toEqual({ mode: 'single', forceZip: false })
  })

  it('多学院 → 打成 zip（一学院一个文件）', () => {
    expect(resolveCollegeExportPackaging(5)).toEqual({ mode: 'zip', forceZip: true })
  })

  it('零学院 → 单文件模式（调用方另有空数据守卫）', () => {
    expect(resolveCollegeExportPackaging(0)).toEqual({ mode: 'single', forceZip: false })
  })
})

describe('StrategicTaskView · 学院页签「全部导出」改造（源码契约锁）', () => {
  const viewSource = readSource('src/3-features/task/ui/StrategicTaskView.vue')
  const modelSource = readSource('src/3-features/task/model/useStrategicTaskView.ts')

  it('学院页签「全部导出」走新的 handleExportAllCollegeIndicators（不再复用单条导出）', () => {
    const handlerStart = viewSource.indexOf('const openStrategicBatchExportDialog')
    const handlerBlock = viewSource.slice(handlerStart, handlerStart + 700)
    expect(handlerBlock).toContain('handleExportAllCollegeIndicators()')
    expect(handlerBlock).not.toContain('handleExportCollegeIndicators()')
  })

  it('学院页签「全部导出」不再受「先选职能部门」两步门槛限制', () => {
    // 2026-11-28：断言对折行容错——prettier 会把超长属性折成多行（提交时 lint-staged 实证），
    // 契约本身只锁「表达式接线」不锁排版，故先把源码空白归一再断言。
    const normalizedSource = viewSource.replace(/\s+/g, ' ')
    expect(normalizedSource).toContain(
      ':disabled="activeTaskTabName === \'college\' ? !collegeAllExportReady : !collegeTabTwoStepReady"'
    )
    expect(normalizedSource).toContain('const collegeAllExportReady = computed')
    expect(normalizedSource).toContain('const collegeAllExportDisabledReason = computed')
  })

  it('单条「导出」按钮行为不变（仍复用 handleExportCollegeIndicators + 两步门槛）', () => {
    expect(viewSource).toContain('const handleExportCollegeIndicators = async () => {')
    // 单条导出仍要求先选职能部门
    const start = viewSource.indexOf('const handleExportCollegeIndicators = async () => {')
    const block = viewSource.slice(start, start + 900)
    expect(block).toContain('collegeDispatchDeptFilter?.value')
  })

  it('职能部门页签「全部导出」维持现状（部门多选框 → zip，不改）', () => {
    const start = viewSource.indexOf('const openStrategicBatchExportDialog')
    const block = viewSource.slice(start, start + 900)
    expect(block).toContain('selectedStrategicExportDepartments.value')
    expect(block).toContain('strategicBatchExportDialogVisible.value = true')
  })

  it('多学院时走 zip（沿用既有 exportDepartmentsAsZip，目录位=学院名）', () => {
    const start = viewSource.indexOf('const handleExportAllCollegeIndicators')
    const block = viewSource.slice(start, start + 2200)
    expect(block).toContain('exportDepartmentsAsZip')
    expect(block).toContain('department: group.college')
    expect(block).toContain('buildCollegeExportColumns')
  })

  it('导出数据源 = 该学院跨全部归口线的行集（模型侧 collegeAllCollegesExportGroups）', () => {
    expect(viewSource).toContain('collegeAllCollegesExportGroups')
    expect(viewSource).toContain('resolveCollegeRowFunctionalDeptName')
  })

  it('⚠️ 只收「真学院」：按学院清单白名单过滤（核心指标的 target 是职能部门，不得当成学院）', () => {
    const start = modelSource.indexOf('const collegeAllCollegesExportGroups = computed')
    const block = modelSource.slice(start, start + 2000)
    expect(block).toContain('collegeNames.has(target)')
    expect(block).toContain('collegeDepartments.value.map')
  })
})
