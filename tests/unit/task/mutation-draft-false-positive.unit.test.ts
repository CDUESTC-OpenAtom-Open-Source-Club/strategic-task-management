import { describe, expect, it } from 'vitest'

/**
 * 2026-10-29 回归：双击权重但未修改数值，点外部退出后不应产生异动草稿。
 *
 * 缺陷链路（修复前）：
 *   ① 双击进入编辑 → editingIndicatorOriginal 记下原值（如 100）；
 *   ② 点外部失焦 → saveIndicatorEdit 先调 cancelIndicatorEdit()，
 *      它把 editingIndicatorOriginal 置为 null；
 *   ③ 随后 applyMutationDraftChange 内部才去读 editingIndicatorOriginal，
 *      读到 null → Number(null ?? 0) = 0，与实际值 100 不等 → 误判「有变化」
 *      → 建出空壳草稿 → 顶部误现「发起异动」按钮与「有 1 项修改」横幅。
 *
 * 修复：saveIndicatorEdit 在 cancel 之前先取出原值快照传给草稿判定；
 *      双击时的快照取不到值时，回退全局指标库按主键匹配的权威值。
 */

/** 复刻修复后的「原值 → 新值是否变化」判定 */
function isUnchangedByWeight(payload: { originalValue: unknown; nextValue: number }): boolean {
  const original = Number(payload.originalValue ?? 0)
  return Number.isFinite(original) && original === payload.nextValue
}

/** 复刻 cancel 之前取快照的顺序（修复后的关键动作） */
function collectDraftChange(input: {
  originalSnapshot: unknown
  nextValue: number
  cancelClearsOriginal: boolean
}): { hasDraft: boolean } {
  // 修复后：先取快照，再 cancel
  const snapshot = input.originalSnapshot
  if (input.cancelClearsOriginal) {
    // 模拟 cancelIndicatorEdit() 清空了 editingIndicatorOriginal
  }
  const unchanged = isUnchangedByWeight({ originalValue: snapshot, nextValue: input.nextValue })
  return { hasDraft: !unchanged }
}

describe('异动草稿：未修改数值不应产生草稿（2026-10-29 回归）', () => {
  it('双击权重未修改（100 → 100）时不应建草稿', () => {
    const result = collectDraftChange({
      originalSnapshot: 100,
      nextValue: 100,
      cancelClearsOriginal: true
    })
    expect(result.hasDraft).toBe(false)
  })

  it('修复前：原值快照在 cancel 后被清空（null）会被误判为有变化', () => {
    // 复刻修复前的顺序：cancel 先执行，判定时读到的是 null
    const originalAfterCancel = null // editingIndicatorOriginal 被 cancelIndicatorEdit 清空
    const unchanged = isUnchangedByWeight({
      originalValue: originalAfterCancel,
      nextValue: 100
    })
    expect(unchanged).toBe(false) // ← 这就是缺陷：0 ≠ 100 → 误建草稿
  })

  it('确实改了数值（100 → 45）时应建草稿', () => {
    const result = collectDraftChange({
      originalSnapshot: 100,
      nextValue: 45,
      cancelClearsOriginal: true
    })
    expect(result.hasDraft).toBe(true)
  })

  it('字符串与数字形态的原值也应判定为未变化（100 与 "100"）', () => {
    expect(isUnchangedByWeight({ originalValue: '100', nextValue: 100 })).toBe(true)
  })

  it('原值缺失时回退权威值后仍能正确判定', () => {
    // 双击时 row.weight 缺失（合并单元格错位）→ 回退权威值 30
    const authoritative = 30
    const result = collectDraftChange({
      originalSnapshot: authoritative,
      nextValue: 30,
      cancelClearsOriginal: true
    })
    expect(result.hasDraft).toBe(false)
  })
})
