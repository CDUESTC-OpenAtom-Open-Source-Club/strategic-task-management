import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  isCollegeTabBasicWeightRow,
  sumCollegeTabBasicWeight,
  type CollegeTabWeightRowLike
} from '@/features/task/lib/collegeTabDistribute'

/**
 * 2026-11-18（学院页签「基础性权重合计」口径修复）用例口径：
 *
 * 服务端验收缺陷：二级学院页签头部「基础性权重合计」显示 200/100——学院线导入的
 * 4 行（基础性 2 行共 100 + 发展性 2 行共 100）全被计入。根因链：
 *   ① /tasks/by-cycle、/tasks/by-plan 被后端 filterTasksByPermission 按 org 过滤
 *     （学院链任务 createdByOrg=战略部 ≠ 学院填报人 org），任务类型映射对学院行恒空；
 *   ② /indicators 列表逐行富化的行级 taskType 此前被前端 mapper 丢弃；
 *   ③ 判定落到 type2 兜底，而后端库表已移除 type2，前端映射缺省『基础性』。
 * 后端权威口径 = BasicTaskWeightValidationService.sumCollegeBasicWeight：
 * 只累加 BASIC 任务的指标权重，发展性不计入。
 *
 * 纯逻辑锁 task/lib/collegeTabDistribute 的新增纯函数（实现与测试共用同一份）；
 * model 接线（collegeBasicWeightTotal / 草稿行继承 / 行级 taskType 优先）用源码契约锁
 * （college-tab-distribute 同款模式：8k 行 composable 不宜整体实例化）。
 */

/** 模拟「学院填报人视角」：任务类型映射被后端权限过滤为恒空（缺陷现场） */
const collegeReporterMappedResolver = (): string => ''

/** 模拟「职能部门/战略部视角」：任务映射命中（按 taskId → taskType 的映射表） */
const makeMappedResolver = (map: Record<string, string>) => (row: CollegeTabWeightRowLike) =>
  map[String(row.taskId ?? '')] ?? ''

describe('task/lib/collegeTabDistribute · isCollegeTabBasicWeightRow（行级基础性判定）', () => {
  it('优先级①：行级 taskType 权威——BASIC 计入、DEVELOPMENT 不计入（映射恒空也判定正确）', () => {
    expect(
      isCollegeTabBasicWeightRow(
        { taskType: 'BASIC', type2: '基础性' },
        collegeReporterMappedResolver
      )
    ).toBe(true)
    expect(
      isCollegeTabBasicWeightRow(
        { taskType: 'DEVELOPMENT', type2: '基础性' },
        collegeReporterMappedResolver
      )
    ).toBe(false)
  })

  it('行级 taskType 归一：小写 / 前后空白同样命中（后端枚举恒大写，防御性容错）', () => {
    expect(isCollegeTabBasicWeightRow({ taskType: ' basic ' }, collegeReporterMappedResolver)).toBe(
      true
    )
    expect(
      isCollegeTabBasicWeightRow({ taskType: 'Development' }, collegeReporterMappedResolver)
    ).toBe(false)
  })

  it('行级 taskType 与任务映射同源同字段，行级优先不改变职能部门视角结论', () => {
    const resolver = makeMappedResolver({ '9001': 'BASIC', '9002': 'DEVELOPMENT' })
    expect(isCollegeTabBasicWeightRow({ taskType: 'BASIC', taskId: 9001 }, resolver)).toBe(true)
    expect(isCollegeTabBasicWeightRow({ taskId: 9002 }, resolver)).toBe(false)
    // 行级缺失时映射兜底（两级读同一个 sys_task.task_type）
    expect(isCollegeTabBasicWeightRow({ taskId: 9001 }, resolver)).toBe(true)
  })

  it('优先级③：行级与映射都缺失（mock/存量无任务数据）→ type2 展示标签兜底，行为不变', () => {
    expect(isCollegeTabBasicWeightRow({ type2: '基础性' }, collegeReporterMappedResolver)).toBe(
      true
    )
    expect(isCollegeTabBasicWeightRow({ type2: '发展性' }, collegeReporterMappedResolver)).toBe(
      false
    )
    expect(isCollegeTabBasicWeightRow({}, collegeReporterMappedResolver)).toBe(false)
  })

  it('层级短路：行级 DEVELOPMENT 压过映射/标签的基础性误标（同字段权威）', () => {
    const resolver = makeMappedResolver({ '9003': 'BASIC' })
    expect(isCollegeTabBasicWeightRow({ taskType: 'DEVELOPMENT', taskId: 9003 }, resolver)).toBe(
      false
    )
    expect(
      isCollegeTabBasicWeightRow(
        { taskType: 'DEVELOPMENT', type2: '基础性', taskId: 9003 },
        resolver
      )
    ).toBe(false)
  })
})

describe('task/lib/collegeTabDistribute · sumCollegeTabBasicWeight（学院合计）', () => {
  /** 服务端验收缺陷现场：文理学院×数办线 4 行 = 基础性 2 行共 100 + 发展性 2 行共 100 */
  const mixedCollegeRows: CollegeTabWeightRowLike[] = [
    { name: '基础性行A', taskType: 'BASIC', weight: 50 },
    { name: '基础性行B', taskType: 'BASIC', weight: 50 },
    { name: '发展性子指标C', taskType: 'DEVELOPMENT', weight: 50 },
    { name: '发展性子指标D', taskType: 'DEVELOPMENT', weight: 50 }
  ]

  it('混合行集（学院填报人视角，映射恒空）→ 合计只算基础性：200 修复为 100', () => {
    const total = sumCollegeTabBasicWeight(mixedCollegeRows, row =>
      isCollegeTabBasicWeightRow(row, collegeReporterMappedResolver)
    )
    expect(total).toBe(100)
  })

  it('纯基础性行集 → 正常合计 100', () => {
    const rows: CollegeTabWeightRowLike[] = [
      { taskType: 'BASIC', weight: 60 },
      { taskType: 'BASIC', weight: 40 }
    ]
    expect(
      sumCollegeTabBasicWeight(rows, row =>
        isCollegeTabBasicWeightRow(row, collegeReporterMappedResolver)
      )
    ).toBe(100)
  })

  it('纯发展性行集 → 合计 0 / 100（不再被 type2 缺省『基础性』误计）', () => {
    const rows: CollegeTabWeightRowLike[] = [
      { taskType: 'DEVELOPMENT', type2: '基础性', weight: 50 },
      { taskType: 'DEVELOPMENT', type2: '基础性', weight: 50 }
    ]
    expect(
      sumCollegeTabBasicWeight(rows, row =>
        isCollegeTabBasicWeightRow(row, collegeReporterMappedResolver)
      )
    ).toBe(0)
  })

  it('草稿行（继承父级行级 taskType）与真实行同口径参与合计', () => {
    const rows: CollegeTabWeightRowLike[] = [
      { name: '库存基础行', taskType: 'BASIC', weight: 80 },
      { name: '新增行草稿（父级=基础性核心指标）', taskType: 'BASIC', weight: 20 },
      { name: '新增行草稿（父级=发展性核心指标）', taskType: 'DEVELOPMENT', weight: 30 }
    ]
    expect(
      sumCollegeTabBasicWeight(rows, row =>
        isCollegeTabBasicWeightRow(row, collegeReporterMappedResolver)
      )
    ).toBe(100)
  })

  it('权重字段安全：字符串权重可加总、空值按 0 处理', () => {
    const rows: CollegeTabWeightRowLike[] = [
      { taskType: 'BASIC', weight: '45' },
      { taskType: 'BASIC', weight: 55 },
      { taskType: 'BASIC' },
      { taskType: 'DEVELOPMENT', weight: 100 }
    ]
    expect(
      sumCollegeTabBasicWeight(rows, row =>
        isCollegeTabBasicWeightRow(row, collegeReporterMappedResolver)
      )
    ).toBe(100)
  })
})

describe('useStrategicTaskView 学院合计口径接线契约（2026-11-18 修复）', () => {
  const readModelSource = () =>
    readFileSync(
      resolve(process.cwd(), 'src/3-features/task/model/useStrategicTaskView.ts'),
      'utf8'
    )
  const readMapperSource = () =>
    readFileSync(resolve(process.cwd(), 'src/3-features/task/model/strategic.ts'), 'utf8')

  it('collegeBasicWeightTotal 走 lib 纯函数（isCollegeTabBasicWeightRow + sumCollegeTabBasicWeight）', () => {
    const source = readModelSource()
    expect(source).toMatch(
      /import\s*\{[^}]*isCollegeTabBasicWeightRow[^}]*\}\s*from\s*'@\/features\/task\/lib\/collegeTabDistribute'/
    )
    expect(source).toMatch(
      /import\s*\{[^}]*sumCollegeTabBasicWeight[^}]*\}\s*from\s*'@\/features\/task\/lib\/collegeTabDistribute'/
    )
    // prettier 可能把实参拆行，断言对换行鲁棒
    expect(source).toMatch(/sumCollegeTabBasicWeight\(\s*collegeTableIndicators\.value/)
    expect(source).toMatch(/isCollegeTabBasicWeightRow\(row,\s*mapped\s*=>/)
  })

  it('getIndicatorMappedTaskType 优先行级 taskType（学院行在任务映射恒空时不再落 type2 缺省）', () => {
    const source = readModelSource()
    expect(source).toMatch(
      /const getIndicatorMappedTaskType = \(indicator: StrategicIndicator\): string => \{[\s\S]*?\.taskType[\s\S]*?if \(rowTaskType\) \{\s*return rowTaskType\s*\}/
    )
  })

  it('mapper 捕获 /indicators 行级 taskType（学院链行的权威任务类型来源）', () => {
    const source = readMapperSource()
    expect(source).toMatch(/const rowTaskType = getString\(item, 'taskType'\)/)
    expect(source).toMatch(
      /if \(rowTaskType\) \{\s*;\(normalizedIndicator as StrategicIndicator & \{ taskType\?: string \}\)\.taskType = rowTaskType\s*\}/
    )
  })

  it('学院页签「新增行」草稿行继承父级行级 taskType', () => {
    const source = readModelSource()
    expect(source).toMatch(
      /type2: getIndicatorCategoryLabel\(parentRow as StrategicIndicator\),[\s\S]*?taskType: String\(\s*\(parentRow as \(StrategicIndicator & \{ taskType\?: string \}\) \| undefined\)\?\.taskType \|\| ''\s*\)\.trim\(\)/
    )
  })
})
