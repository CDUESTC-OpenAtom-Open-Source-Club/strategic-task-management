import type { BusinessImportType, ImportRowPreview } from '@/features/import/api/businessImport'

/**
 * 2026-11-01 缺陷修复（E2E 实测）：导入预览结果表与导入模板同款视觉——
 * 同组的「序号」与「父级指标」（学院模板）／「序号」与「战略任务」（职能部门模板）
 * 竖向合并：锚点行显示值 + rowSpan = 组行数，从属行不渲染该格（span-method 语义）。
 *
 * 分组键选择：解析器（ExcelBusinessImportParser）sticky 继承后，同组每一行的
 * normalized.seq / normalized.parentIndicator（学院）／normalized.strategicTask（职能部门）
 * 都已回填为组首行值。组号（rowNo=seq）在同一文件内唯一 → 复合键 = rowNo + 组值，
 * 既能稳定识别同组行，又能区分「组号缺失回退物理行号」「同名不同组」的边界情况。
 *
 * 只合并相邻行：键相同的连续行归为一组；非相邻的同名组不跨合并（各自成组）。
 * 返回逐行 rowSpan：锚点行 = 组行数（>1 时合并），从属行 = 0（不渲染），独立行 = 1。
 */
export function buildPreviewGroupSpans(
  rows: Pick<ImportRowPreview, 'rowNo' | 'normalized'>[],
  type: BusinessImportType
): number[] {
  const groupKeyOf = (row: Pick<ImportRowPreview, 'rowNo' | 'normalized'>): string => {
    // rowNo（组号）相同的行才可能同组；组号缺失时解析器回退物理行号（逐行递增），天然不会误合并
    const groupValue =
      type === 'strategic-task' ? row.normalized.strategicTask : row.normalized.parentIndicator
    return `${String(row.rowNo)}\u0000${(groupValue ?? '').trim()}`
  }

  const spans = new Array<number>(rows.length).fill(1)
  let index = 0
  while (index < rows.length) {
    const key = groupKeyOf(rows[index])
    let end = index + 1
    while (end < rows.length && groupKeyOf(rows[end]) === key) {
      end += 1
    }
    for (let offset = index; offset < end; offset += 1) {
      spans[offset] = offset === index ? end - index : 0
    }
    index = end
  }
  return spans
}
