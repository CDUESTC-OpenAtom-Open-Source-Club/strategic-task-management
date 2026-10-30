import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const readSrc = (relative: string): string => readFileSync(resolve(process.cwd(), relative), 'utf8')

const viewSource = readSrc('src/3-features/task/ui/StrategicTaskView.vue')
const cssSource = readSrc('src/3-features/task/ui/StrategicTaskView.css')
const badgeSource = readSrc('src/3-features/indicator/ui/MutationBadgePopover.vue')

/**
 * 2026-10-30 用户定案（晚间修订）：异动角标必须落在「它所属的那一格」的右上角。
 *
 * 关键在于定位基准是整格（td），而不是单元格内的内容容器——
 * 按内容容器定位，角标会悬在文字/数字旁边，不是真正的格子右上角。
 * 这里用源码契约锁定，避免后人改成容器定位或移回右下角。
 */
describe('异动角标落位契约', () => {
  it('权重列带 class-name，供 CSS 以整格为定位基准', () => {
    // 两张表各一个权重列
    const weightColumnBlocks = viewSource.match(
      /<el-table-column\s+prop="weight"[\s\S]*?class-name="weight-col-cell"/g
    )
    expect(weightColumnBlocks).toHaveLength(2)
  })

  it('核心指标列与下发备注列同样带 class-name', () => {
    expect(viewSource).toContain('class-name="indicator-name-col-cell"')
    expect(viewSource).toMatch(/label="下发备注"[\s\S]*?class-name="remark-col-cell"/)
  })

  it('权重列角标挂在权重单元格内（不是核心指标格里）', () => {
    // 权重列模板里必须带 MUTATION_FIELDS_WEIGHT
    const weightColumn = viewSource.slice(
      viewSource.indexOf('prop="weight"'),
      viewSource.indexOf('prop="weight"') + 2000
    )
    expect(weightColumn).toContain('MUTATION_FIELDS_WEIGHT')
    expect(weightColumn).not.toContain('MUTATION_FIELDS_INDICATOR_NAME')
  })

  it('核心指标列角标只统计指标内容异动，权重列只统计权重异动', () => {
    expect(viewSource).toContain(':fields="MUTATION_FIELDS_INDICATOR_NAME"')
    expect(viewSource).toContain(':fields="MUTATION_FIELDS_WEIGHT"')
    expect(viewSource).toContain(':fields="MUTATION_FIELDS_REMARK"')
    expect(viewSource).toContain(':fields="MUTATION_FIELDS_TASK_NAME"')
  })

  it('CSS 把这几类格子设为定位基准，角标绝对定位到格子右上角', () => {
    expect(cssSource).toMatch(/\.weight-col-cell,\s*\.indicator-name-col-cell,\s*\.remark-col-cell/)
    expect(cssSource).toMatch(/\.weight-col-cell,[\s\S]*?position:\s*relative/)

    // 角标绝对定位 + 贴右上角
    const weightBadgeRule = cssSource.match(/\.weight-cell \.weight-cell__badge\s*\{[^}]*\}/)
    expect(weightBadgeRule?.[0]).toContain('position: absolute')
    expect(weightBadgeRule?.[0]).toContain('right: 4px')
    expect(weightBadgeRule?.[0]).toContain('top: 2px')

    const cornerRule = cssSource.match(/\.indicator-cell-footer--corner\s*\{[^}]*\}/)
    expect(cornerRule?.[0]).toContain('position: absolute')
    expect(cornerRule?.[0]).toContain('right: 4px')
    expect(cornerRule?.[0]).toContain('top: 2px')
  })

  it('角标不再用流式布局（那会把行撑高并贴在文字下方）', () => {
    // 2026-10-30 晚间修订：footer 与 --corner 变体统一为整格右上角绝对定位
    const footerRule = cssSource.match(/\.indicator-cell-footer\s*\{[^}]*\}/)
    expect(footerRule?.[0]).toContain('position: absolute')
    expect(footerRule?.[0]).toContain('right: 4px')
    expect(footerRule?.[0]).toContain('top: 2px')
    expect(cssSource).toMatch(/\.indicator-cell-footer--corner\s*\{[^}]*position:\s*absolute/)
  })

  it('徽标组件拦截 dblclick/mousedown，双击角标不会误入行内编辑', () => {
    expect(badgeSource).toContain('@dblclick.stop')
    expect(badgeSource).toContain('@mousedown.stop')
    expect(badgeSource).toContain('@click.stop')
  })
})
