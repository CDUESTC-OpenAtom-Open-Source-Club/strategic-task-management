import { describe, expect, it } from 'vitest'
import type { ImportNormalizedRow, ImportRowPreview } from '@/features/import/api/businessImport'
import { buildPreviewGroupSpans } from '@/features/import/lib/previewGroupSpan'

// 2026-11-01 缺陷修复（E2E 实测）：预览表同组「序号」「父级指标/战略任务」rowSpan 合并的分组纯函数。
// 行结构模拟后端解析器输出：sticky 继承后同组行共享组号（rowNo）与组值（父级指标/战略任务名）。

function row(
  rowNo: number,
  normalized: Partial<ImportNormalizedRow>
): Pick<ImportRowPreview, 'rowNo' | 'normalized'> {
  return { rowNo, normalized }
}

describe('import/lib/previewGroupSpan', () => {
  it('学院模板：相邻同组（组号+父级指标相同）合并为锚点 rowSpan=N、从属行 0', () => {
    const rows = [
      row(1, { parentIndicator: '完善课程建设与专业评估机制' }),
      row(1, { parentIndicator: '完善课程建设与专业评估机制' }),
      row(2, { parentIndicator: '提升实践教学水平' })
    ]

    expect(buildPreviewGroupSpans(rows, 'distribution')).toEqual([2, 0, 1])
  })

  it('学院模板：三行同组 → 锚点 3、两个从属行 0（模板同款视觉）', () => {
    const rows = [
      row(1, { parentIndicator: '建设智慧教学质量监测体系' }),
      row(1, { parentIndicator: '建设智慧教学质量监测体系' }),
      row(1, { parentIndicator: '建设智慧教学质量监测体系' })
    ]

    expect(buildPreviewGroupSpans(rows, 'distribution')).toEqual([3, 0, 0])
  })

  it('学院模板：非相邻同组不跨合并（同名父级被其他组隔开时各自成组）', () => {
    const rows = [
      row(1, { parentIndicator: '父级指标甲' }),
      row(2, { parentIndicator: '父级指标乙' }),
      row(3, { parentIndicator: '父级指标甲' })
    ]

    expect(buildPreviewGroupSpans(rows, 'distribution')).toEqual([1, 1, 1])
  })

  it('学院模板：同名父级但组号不同不合并（组号文件内唯一，区分同名不同组）', () => {
    const rows = [
      row(1, { parentIndicator: '同名父级指标' }),
      row(2, { parentIndicator: '同名父级指标' })
    ]

    expect(buildPreviewGroupSpans(rows, 'distribution')).toEqual([1, 1])
  })

  it('学院模板：组号缺失回退物理行号（逐行递增）→ 不误合并', () => {
    const rows = [
      row(2, { parentIndicator: '父级指标甲' }),
      row(3, { parentIndicator: '父级指标甲' })
    ]

    expect(buildPreviewGroupSpans(rows, 'distribution')).toEqual([1, 1])
  })

  it('职能部门模板：相邻同组（组号+战略任务相同）合并', () => {
    const rows = [
      row(1, { strategicTask: '推进本科教育教学改革' }),
      row(1, { strategicTask: '推进本科教育教学改革' }),
      row(1, { strategicTask: '推进本科教育教学改革' }),
      row(2, { strategicTask: '提升实践教学水平' })
    ]

    expect(buildPreviewGroupSpans(rows, 'strategic-task')).toEqual([3, 0, 0, 1])
  })

  it('职能部门模板：同名战略任务但组号不同不合并', () => {
    const rows = [row(1, { strategicTask: '同名任务' }), row(2, { strategicTask: '同名任务' })]

    expect(buildPreviewGroupSpans(rows, 'strategic-task')).toEqual([1, 1])
  })

  it('组值仅首尾空白差异视为同组（与解析器 groupKey 的宽松口径一致）', () => {
    const rows = [
      row(1, { parentIndicator: '父级指标甲' }),
      row(1, { parentIndicator: ' 父级指标甲 ' })
    ]

    expect(buildPreviewGroupSpans(rows, 'distribution')).toEqual([2, 0])
  })

  it('空行集返回空数组', () => {
    expect(buildPreviewGroupSpans([], 'distribution')).toEqual([])
    expect(buildPreviewGroupSpans([], 'strategic-task')).toEqual([])
  })

  it('单行组返回 1（正常单元格，不触发合并）', () => {
    const rows = [row(1, { parentIndicator: '父级指标甲' })]

    expect(buildPreviewGroupSpans(rows, 'distribution')).toEqual([1])
  })
})
