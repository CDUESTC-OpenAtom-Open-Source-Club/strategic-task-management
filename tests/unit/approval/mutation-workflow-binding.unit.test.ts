import { describe, expect, it } from 'vitest'

/**
 * 「审批流程」页签在计划流程归档后接管异动流程，数据源的选择口径：
 * 抽屉里可能同时有多条异动实例，优先跟随用户正在查看的那张卡（selectedHistoryInstanceId），
 * 未选中时回落到后端返回的第一条（按 created_at DESC，即最新一条）。
 *
 * 这里复刻 useApprovalProgressState 中 activeMutationWorkflowDetail 的选择逻辑，
 * 防止后续重构又把「永远取第一条」写回去——那会导致流程页签显示的不是用户点开的那条异动。
 */
function pickActiveMutationDetail<T extends { instanceId?: unknown; workflowDetail?: unknown }>(
  candidates: T[] | undefined,
  selectedInstanceId: string | null | undefined
): T | undefined {
  const list = candidates ?? []
  const selectedId = String(selectedInstanceId || '').trim()
  const matched = selectedId
    ? list.find(item => String(item.instanceId || '') === selectedId)
    : undefined
  return matched ?? list[0]
}

const makeItem = (instanceId: string, tasks: number) => ({
  instanceId,
  workflowDetail: {
    tasks: Array.from({ length: tasks }, (_, index) => ({ taskId: `${instanceId}-${index}` }))
  }
})

describe('mutation workflow binding in approval flow tab', () => {
  it('falls back to the first pending mutation when nothing is selected', () => {
    const items = [makeItem('13', 3), makeItem('10', 4)]
    const picked = pickActiveMutationDetail(items, null)
    expect(picked?.instanceId).toBe('13')
    expect((picked?.workflowDetail as { tasks: unknown[] }).tasks).toHaveLength(3)
  })

  it('follows the card the user is currently viewing', () => {
    const items = [makeItem('13', 3), makeItem('10', 4)]
    const picked = pickActiveMutationDetail(items, '10')
    expect(picked?.instanceId).toBe('10')
    expect((picked?.workflowDetail as { tasks: unknown[] }).tasks).toHaveLength(4)
  })

  it('keeps the first pending mutation when the selected id is not a mutation instance', () => {
    // 计划下发实例的 instanceId 也在 selectedHistoryInstanceId 里，此时不应丢掉异动流程
    const items = [makeItem('13', 3)]
    const picked = pickActiveMutationDetail(items, '7')
    expect(picked?.instanceId).toBe('13')
  })

  it('returns undefined when there is no pending mutation at all', () => {
    expect(pickActiveMutationDetail([], '13')).toBeUndefined()
    expect(pickActiveMutationDetail(undefined, null)).toBeUndefined()
  })

  it('only exposes newly generated steps, matching the backend step-by-step expansion', () => {
    // 后端只在上一节点通过后才创建下一节点：初始 2 个节点，负责人通过后变 3 个
    const justStarted = makeItem('13', 2)
    const afterHeadApproved = makeItem('13', 3)
    expect(justStarted.workflowDetail.tasks as unknown[]).toHaveLength(2)
    expect(afterHeadApproved.workflowDetail.tasks as unknown[]).toHaveLength(3)
  })
})

/**
 * 2026-10-22 修复（驳回没有退回）：一次「发起异动」会为每个实体各建一个审批实例，
 * 它们共享 batchId、在审批中心聚合成一张卡。卡片原先只保留第一条实例的 instanceId，
 * 点一次驳回只退回 1 个，其余实例永远停在「审批中」。
 *
 * 这里复刻 useApprovalProgressState 的聚合与 useApprovalProgressWorkflow 的实例解析，
 * 锁住「卡片必须携带整批实例 ID」「审批/驳回/撤回都作用于整批」。
 */
type MutationRow = { instanceId: number; batchId?: string | null; entityId?: number }

function groupMutationRows(
  rows: MutationRow[]
): Array<{ batchId: string | null; mutationInstanceIds: number[] }> {
  const groups = new Map<string, MutationRow[]>()
  for (const row of rows) {
    const key = String(row.batchId || '').trim() || `instance-${row.instanceId}`
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }
  return Array.from(groups.values()).map(items => ({
    batchId: items[0].batchId ?? null,
    mutationInstanceIds: items
      .map(item => Number(item.instanceId))
      .filter(id => Number.isFinite(id) && id > 0)
  }))
}

function resolveMutationInstanceIds(item: {
  instanceId?: unknown
  mutationInstanceIds?: number[]
}): number[] {
  const ids = Array.isArray(item.mutationInstanceIds) ? item.mutationInstanceIds : []
  const normalized = ids.map(id => Number(id)).filter(id => Number.isFinite(id) && id > 0)
  if (normalized.length > 0) {
    return [...new Set(normalized)]
  }
  const fallback = Number(item.instanceId)
  return Number.isFinite(fallback) && fallback > 0 ? [fallback] : []
}

describe('batch mutation approval covers every instance', () => {
  it('groups same-batch instances into one card carrying all instance ids', () => {
    const rows: MutationRow[] = [
      { instanceId: 3, batchId: 'b-1', entityId: 2046 },
      { instanceId: 4, batchId: 'b-1', entityId: 2047 },
      { instanceId: 5, batchId: 'b-1', entityId: 2014 },
      { instanceId: 6, batchId: 'b-1', entityId: 2013 },
      { instanceId: 7, batchId: 'b-1', entityId: 41008 }
    ]
    const cards = groupMutationRows(rows)
    expect(cards).toHaveLength(1)
    expect(cards[0].mutationInstanceIds).toEqual([3, 4, 5, 6, 7])
  })

  it('keeps instances without a batch id as separate cards', () => {
    const rows: MutationRow[] = [
      { instanceId: 10, batchId: null },
      { instanceId: 11, batchId: null }
    ]
    const cards = groupMutationRows(rows)
    expect(cards).toHaveLength(2)
    expect(cards.map(c => c.mutationInstanceIds)).toEqual([[10], [11]])
  })

  it('rejecting a batch card resolves every instance, not just the first', () => {
    const card = { instanceId: 3, mutationInstanceIds: [3, 4, 5, 6, 7] }
    expect(resolveMutationInstanceIds(card)).toEqual([3, 4, 5, 6, 7])
  })

  it('falls back to the single instance for legacy cards without the batch list', () => {
    expect(resolveMutationInstanceIds({ instanceId: 13 })).toEqual([13])
  })

  it('deduplicates and drops invalid ids', () => {
    expect(
      resolveMutationInstanceIds({ instanceId: 3, mutationInstanceIds: [3, 3, 0, -1, 4] })
    ).toEqual([3, 4])
  })

  it('returns an empty list when the card has no usable instance', () => {
    expect(resolveMutationInstanceIds({ instanceId: 0 })).toEqual([])
    expect(resolveMutationInstanceIds({})).toEqual([])
  })
})
