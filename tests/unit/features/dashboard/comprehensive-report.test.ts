/**
 * 综合报表「各部门/各学院进度」Sheet 等级口径单测（2026-11-17 用户拍板）
 *
 * 背景：等级制填报后 indicator.progress 恒 0，旧进度列是死数据。
 * 口径：COALESCE(appraisal_level, self_rating)——上级鉴定优先，没鉴定看自评，
 * 与看板滞后任务卡 / college-levels 同源；「延期」统一写「滞后」。
 */
import { describe, expect, it } from 'vitest'

import {
  APPRAISAL_LEVEL_LABEL,
  buildComprehensiveReport,
  resolveIndicatorAppraisalLevel
} from '@/features/dashboard/lib/comprehensiveReport'
import type { StrategicIndicator } from '@/shared/types'

/** 构造最小可用指标行（测试只关心等级与部门归属字段） */
const buildIndicator = (overrides: Record<string, unknown> = {}): StrategicIndicator =>
  ({
    id: 1,
    name: '指标A',
    progress: 0,
    responsibleDept: '教务处',
    manualAlertSeverity: null,
    ...overrides
  }) as unknown as StrategicIndicator

describe('resolveIndicatorAppraisalLevel（COALESCE(appraisal_level, self_rating)）', () => {
  it('三档等级码直通映射', () => {
    expect(resolveIndicatorAppraisalLevel(buildIndicator({ manualAlertSeverity: 'AHEAD' }))).toBe(
      'AHEAD'
    )
    expect(resolveIndicatorAppraisalLevel(buildIndicator({ manualAlertSeverity: 'NORMAL' }))).toBe(
      'NORMAL'
    )
    expect(resolveIndicatorAppraisalLevel(buildIndicator({ manualAlertSeverity: 'DELAYED' }))).toBe(
      'DELAYED'
    )
  })

  it('旧预警档 INFO/WARNING/CRITICAL 归并为滞后（与 strategic store 同一口径）', () => {
    expect(
      resolveIndicatorAppraisalLevel(buildIndicator({ manualAlertSeverity: 'CRITICAL' }))
    ).toBe('DELAYED')
    expect(resolveIndicatorAppraisalLevel(buildIndicator({ manualAlertSeverity: 'WARNING' }))).toBe(
      'DELAYED'
    )
    expect(resolveIndicatorAppraisalLevel(buildIndicator({ manualAlertSeverity: 'INFO' }))).toBe(
      'DELAYED'
    )
  })

  it('空值/未知码返回 null（→ 未评定）', () => {
    expect(resolveIndicatorAppraisalLevel(buildIndicator({ manualAlertSeverity: null }))).toBeNull()
    expect(
      resolveIndicatorAppraisalLevel(buildIndicator({ manualAlertSeverity: 'FOO' }))
    ).toBeNull()
    expect(resolveIndicatorAppraisalLevel(buildIndicator({}))).toBeNull()
  })

  it('COALESCE 兜底：没鉴定（manualAlertSeverity 空）时读自评 selfRating', () => {
    const row = buildIndicator({ manualAlertSeverity: null, selfRating: 'NORMAL' })
    expect(resolveIndicatorAppraisalLevel(row)).toBe('NORMAL')
  })

  it('COALESCE 优先：已有上级鉴定时忽略自评', () => {
    const row = buildIndicator({ manualAlertSeverity: 'AHEAD', selfRating: 'DELAYED' })
    expect(resolveIndicatorAppraisalLevel(row)).toBe('AHEAD')
  })

  it('appraisalLevel 命名优先于 manualAlertSeverity（兼容数据链改名）', () => {
    const row = buildIndicator({ manualAlertSeverity: 'NORMAL', appraisalLevel: 'DELAYED' })
    expect(resolveIndicatorAppraisalLevel(row)).toBe('DELAYED')
  })
})

describe('buildComprehensiveReport 单位 Sheet 等级分布（各部门/各学院进度）', () => {
  const indicators: StrategicIndicator[] = [
    // 教务处：超前 1 / 正常 1 / 滞后 1 / 未评定 1
    buildIndicator({ id: 1, responsibleDept: '教务处', manualAlertSeverity: 'AHEAD' }),
    buildIndicator({ id: 2, responsibleDept: '教务处', manualAlertSeverity: 'NORMAL' }),
    buildIndicator({ id: 3, responsibleDept: '教务处', manualAlertSeverity: 'CRITICAL' }),
    buildIndicator({ id: 4, responsibleDept: '教务处', manualAlertSeverity: null }),
    // 计财处：正常 1（自评兜底，无鉴定）
    buildIndicator({
      id: 5,
      responsibleDept: '计财处',
      manualAlertSeverity: null,
      selfRating: 'NORMAL'
    }),
    // 计算机学院：滞后 1（学院走 colleges Sheet）
    buildIndicator({ id: 6, responsibleDept: '计算机学院', manualAlertSeverity: 'DELAYED' }),
    // 电子信息学院：超前 1
    buildIndicator({ id: 7, responsibleDept: '电子信息学院', manualAlertSeverity: 'AHEAD' })
  ]

  const report = buildComprehensiveReport(indicators)

  it('部门/学院按后缀拆分到两个 Sheet（按滞后升序排名后输出）', () => {
    // 计财处滞后 0 排前，教务处滞后 1 排后
    expect(report.departments.map(row => row.单位)).toEqual(['计财处', '教务处'])
    expect(report.departments.map(row => row.排名)).toEqual([1, 2])
    // 电子信息学院滞后 0 排前，计算机学院滞后 1 排后
    expect(report.colleges.map(row => row.单位)).toEqual(['电子信息学院', '计算机学院'])
  })

  it('行内列值 = 鉴定等级分布（超前/正常/滞后/未评定），不含假进度列', () => {
    const jwc = report.departments.find(row => row.单位 === '教务处')

    expect(jwc).toMatchObject({
      指标总数: 4,
      超前完成: 1,
      正常: 1,
      滞后: 1,
      未评定: 1
    })
    expect(jwc?.类型).toBe('职能部门')

    // 旧假进度列全部退役
    const anyRow = report.departments[0] as unknown as Record<string, unknown>
    expect('平均进度' in anyRow).toBe(false)
    expect('综合得分' in anyRow).toBe(false)
    expect('完成率' in anyRow).toBe(false)
    expect('已完成' in anyRow).toBe(false)
    expect('进行中' in anyRow).toBe(false)
    expect('延期预警' in anyRow).toBe(false)
    expect('状态' in anyRow).toBe(false)
  })

  it('汇总口径与 college-levels 同源：等级优先于自评，未评定不冒充任何档', () => {
    const jfc = report.departments.find(row => row.单位 === '计财处')

    // 自评 NORMAL 生效（无鉴定）
    expect(jfc).toMatchObject({ 指标总数: 1, 正常: 1, 未评定: 0 })

    // 学院行类型标注
    expect(report.colleges[0]?.类型).toBe('二级学院')
  })

  it('排名：滞后少者在前，同滞后数时超前多者在前', () => {
    const rows = buildComprehensiveReport([
      buildIndicator({ id: 1, responsibleDept: 'A学院', manualAlertSeverity: 'DELAYED' }),
      buildIndicator({ id: 2, responsibleDept: 'A学院', manualAlertSeverity: 'DELAYED' }),
      buildIndicator({ id: 3, responsibleDept: 'B学院', manualAlertSeverity: 'DELAYED' }),
      buildIndicator({ id: 4, responsibleDept: 'B学院', manualAlertSeverity: 'AHEAD' }),
      buildIndicator({ id: 5, responsibleDept: 'C学院', manualAlertSeverity: 'NORMAL' }),
      buildIndicator({ id: 6, responsibleDept: 'D学院', manualAlertSeverity: 'DELAYED' }),
      buildIndicator({ id: 7, responsibleDept: 'D学院', manualAlertSeverity: 'NORMAL' })
    ]).colleges

    // 排序键 = 滞后升序 → 超前降序：C(滞后0) 第一；
    // B(滞后1/超前1) 与 D(滞后1/超前0) 同滞后数，B 超前多排前；A(滞后2) 最后
    expect(rows.map(row => row.单位)).toEqual(['C学院', 'B学院', 'D学院', 'A学院'])
    expect(rows.map(row => row.排名)).toEqual([1, 2, 3, 4])
  })

  it('空数据导出返回空 Sheet 而不抛错', () => {
    const empty = buildComprehensiveReport([])

    expect(empty.departments).toEqual([])
    expect(empty.colleges).toEqual([])
  })
})

describe('其余 Sheet 不受本次改动影响（回归护栏）', () => {
  it('滞后任务清单自评文案仍走 RATING_LABEL，总览行结构不变', () => {
    const report = buildComprehensiveReport([
      buildIndicator({
        id: 9,
        name: '实训基地建设',
        responsibleDept: '教务处',
        manualAlertSeverity: 'DELAYED',
        selfRating: 'DELAYED'
      })
    ])

    expect(report.lagging).toHaveLength(1)
    expect(report.lagging[0]).toMatchObject({
      指标内容: '实训基地建设',
      所属部门: '教务处',
      自评进度: '延期'
    })
    expect(report.overview).toHaveLength(1)
    expect(report.overview[0]?.指标总数).toBe(1)
  })

  it('等级文案常量与全局「滞后」口径一致', () => {
    expect(APPRAISAL_LEVEL_LABEL).toEqual({
      AHEAD: '超前完成',
      NORMAL: '正常',
      DELAYED: '滞后'
    })
  })
})
