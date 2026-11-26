import { describe, expect, it } from 'vitest'
import {
  previewIndicatorNameText,
  previewIndicatorTypeText,
  previewParentIndicatorText,
  previewWeightText,
  type PreviewRowDisplayInput
} from '@/features/import/lib/previewRowDisplay'

/**
 * 2026-11-25（预览跳过行显示修复）：预览行「指标/类型/权重/父级指标」四列取值纯函数单测。
 *
 * 用户口径：文件里有值就必须显示出来——「跳过」只是不下发，不是"不显示内容"。
 * 契约：
 * · normalized 有值（CREATE/UPDATE 行）→ 显示归一化值（与旧行为一致，零变化）；
 * · normalized 空（跳过行/解析失败的行）→ 回退 source 原始单元格（表头别名与后端
 *   ExcelBusinessImportParser DISTRIBUTION_ALIASES 对齐）；
 * · 两处都没有 → 指标/类型显示空串、权重显示 '-'（无值行的既有口径不变）；
 * · normalized.weight=0 是真值，显示 "0"（旧实现 `|| '-'` 会吞成 '-'）。
 */

const buildRow = (overrides: Partial<PreviewRowDisplayInput> = {}): PreviewRowDisplayInput => ({
  normalized: {},
  source: {},
  ...overrides
})

describe('previewRowDisplay 预览行取值（2026-11-25 跳过行显示修复）', () => {
  it('normalized 有值时优先显示归一化结果（CREATE/UPDATE 行为不变）', () => {
    const row = buildRow({
      normalized: {
        indicatorName: '月度预算执行监测台账',
        indicatorType: '定量',
        weight: 40,
        parentIndicator: '完成全面预算管理年度目标'
      }
    })
    expect(previewIndicatorNameText(row)).toBe('月度预算执行监测台账')
    expect(previewIndicatorTypeText(row)).toBe('定量')
    expect(previewWeightText(row)).toBe('40')
    expect(previewParentIndicatorText(row)).toBe('完成全面预算管理年度目标')
  })

  it('跳过行 normalized 空时回退 source 原始单元格（文件有值就显示）', () => {
    const row = buildRow({
      normalized: {},
      source: {
        序号: '4',
        归口职能部门: '教务处',
        核心指标: '推进教务处教学质量提升专项工作落地见效',
        核心指标类型: '定量',
        子指标名称: '月度预算执行监测台账',
        指标类型: '定量',
        '权重（纯数字）': '40'
      }
    })
    expect(previewIndicatorNameText(row)).toBe('月度预算执行监测台账')
    expect(previewIndicatorTypeText(row)).toBe('定量')
    expect(previewWeightText(row)).toBe('40')
    expect(previewParentIndicatorText(row)).toBe('推进教务处教学质量提升专项工作落地见效')
  })

  it('权重列非数字格式（归一化失败）时回退文件原文，不吞成 -', () => {
    const row = buildRow({
      normalized: {},
      source: { '权重（纯数字）': '40分' }
    })
    expect(previewWeightText(row)).toBe('40分')
  })

  it('权重表头演进（半角括号/旧文案）时仍能从 source 回退取值', () => {
    expect(previewWeightText(buildRow({ source: { '权重(纯数字)': '30' } }))).toBe('30')
    expect(previewWeightText(buildRow({ source: { 权重: '30' } }))).toBe('30')
    expect(previewWeightText(buildRow({ source: { 子指标权重: '30' } }))).toBe('30')
  })

  it('类型列包含式兜底排除形近列「核心指标类型」（是父级锚点信息不是本行类型）', () => {
    const row = buildRow({
      normalized: {},
      source: { 核心指标类型: '定量' }
    })
    expect(previewIndicatorTypeText(row)).toBe('')
  })

  it('指标名表头演进（如「子指标名」）时按包含「子指标」兜底', () => {
    const row = buildRow({
      normalized: {},
      source: { 子指标名: '预算执行差异分析' }
    })
    expect(previewIndicatorNameText(row)).toBe('预算执行差异分析')
  })

  it('normalized 与 source 都无值：指标/类型显示空、权重显示 -（无值父级行口径不变）', () => {
    const row = buildRow({ normalized: {}, source: { 核心指标: '完善课程建设与专业评估机制' } })
    expect(previewIndicatorNameText(row)).toBe('')
    expect(previewIndicatorTypeText(row)).toBe('')
    expect(previewWeightText(row)).toBe('-')
    expect(previewParentIndicatorText(row)).toBe('完善课程建设与专业评估机制')
  })

  it('normalized.weight 数字 0 是真值，显示 "0"（旧实现被 || 吞成 -）', () => {
    expect(previewWeightText(buildRow({ normalized: { weight: 0 } }))).toBe('0')
  })

  it('normalized.weight 字符串数字原样显示', () => {
    expect(previewWeightText(buildRow({ normalized: { weight: '30.00' } }))).toBe('30.00')
  })

  it('normalized/source 缺字段（响应缺省）不抛异常，按无值口径显示', () => {
    expect(previewIndicatorNameText({})).toBe('')
    expect(previewIndicatorTypeText({})).toBe('')
    expect(previewWeightText({})).toBe('-')
    expect(previewParentIndicatorText({})).toBe('')
    expect(previewIndicatorNameText({ normalized: null, source: null })).toBe('')
    expect(previewWeightText({ normalized: null, source: null })).toBe('-')
  })

  it('normalized 值为纯空白时视为无值并回退 source', () => {
    const row = buildRow({
      normalized: { indicatorName: '   ' },
      source: { 子指标名称: '专项资金绩效跟踪台账' }
    })
    expect(previewIndicatorNameText(row)).toBe('专项资金绩效跟踪台账')
  })
})
