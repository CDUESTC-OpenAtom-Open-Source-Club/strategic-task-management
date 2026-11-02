/**
 * 指标下发导出的父级分组工具（2026-10-31 定案）
 *
 * 背景：学院子指标导入模板已定「序号 = 父级核心指标组号」（组内多行共用、模板内竖向合并，
 * 解析器 sticky 口径：组列留空 = 延续上一组）。为让「导出 → 修改 → 回导」闭环时序号天然对齐，
 * 导出表的「序号」列改为同一语义；同一父级核心指标的合并跨度（父级核心指标格 / 序号格）
 * 也由本函数一并给出。
 */

export interface DistributionExportRowGrouping {
  /** 每行所属组号（1、2、3…，按父级核心指标首次出现的顺序递增） */
  groupNumberByIndex: number[]
  /**
   * 每行合并跨度（按相邻同组行计算，供 write-excel-file rowSpan 使用）：
   * 组首行 = 组内相邻行数（>1 时锚点格携带 rowSpan）；被上方合并覆盖的从属行 = 0（格传 null）；
   * 独占一行 = 1。
   */
  spanByIndex: number[]
}

/**
 * 按父级身份键计算导出行分组。
 *
 * - 组号按「身份键首次出现顺序」全局递增：同一父级核心指标的多行共用一个组号，
 *   即使同一父级的行在表内不相邻（此时不合并单元格，但组号仍一致）。
 * - 合并跨度只认相邻同键行：与既有「父级核心指标」列的合并口径一致，
 *   不同父级（不同身份键）绝不串组——即便它们属于同一个战略任务。
 *
 * @param parentKeys 每行的父级身份键（调用方用父指标 id，缺失时回退父指标名）
 */
export function buildDistributionExportRowGrouping(
  parentKeys: string[]
): DistributionExportRowGrouping {
  const groupNumberByIndex: number[] = []
  const spanByIndex: number[] = []
  const groupNumberByKey = new Map<string, number>()

  parentKeys.forEach((key, index) => {
    let groupNumber = groupNumberByKey.get(key)
    if (groupNumber === undefined) {
      groupNumber = groupNumberByKey.size + 1
      groupNumberByKey.set(key, groupNumber)
    }
    groupNumberByIndex.push(groupNumber)

    const isSameAsPrev = index > 0 && parentKeys[index - 1] === key
    if (isSameAsPrev) {
      spanByIndex.push(0)
      return
    }

    let end = index + 1
    while (end < parentKeys.length && parentKeys[end] === key) {
      end += 1
    }
    spanByIndex.push(end - index)
  })

  return { groupNumberByIndex, spanByIndex }
}
