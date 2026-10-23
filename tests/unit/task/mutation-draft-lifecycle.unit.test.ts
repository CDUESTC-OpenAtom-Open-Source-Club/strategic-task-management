import { describe, expect, it } from 'vitest'

/**
 * 异动三条路径（新增 / 修改 / 删除）的草稿与终态语义。
 *
 * 这些用例复刻 useStrategicTaskView 与后端 IndicatorMutationService /
 * StrategyWorkflowBusinessStatusAdapter 的关键判定，锁住以下口径：
 * 1. 取消异动必须真的撤销本次新增的指标（否则残留 DRAFT 指标污染权重合计）；
 * 2. 已下发计划上的删除走异动草稿，审批通过才生效；
 * 3. 删除条目的权重从闭合校验合计中剔除（删除审批通过前仍留在表里），
 *    但删除批次同样要跑校验——剔除后合计≠100 时拒绝并要求同批次调整补齐
 *    （2026-10-22 修复：只删不补曾把计划卡死在 60，后续连改名都被拦）；
 * 4. 驳回时只有 CREATE 类异动归档，MODIFY 保留改动供发起人继续修改；
 * 5. 「待提交新增」标记要能跨页面刷新回填（sessionStorage），避免刷新即变的孤儿指标。
 */

type Draft = {
  indicatorId: string | number
  changes: Record<string, unknown>
  labels: string[]
  deleteRequested?: boolean
}

function hasMutationDraft(drafts: Draft[], taskDrafts: unknown[], createdIds: unknown[]): boolean {
  return drafts.length > 0 || taskDrafts.length > 0 || createdIds.length > 0
}

/** 取消异动：三个集合全清，新增指标要真的删掉 */
function cancelDraft(createdIds: string[], deletedInBackend: string[]) {
  const toDelete = [...createdIds]
  const failed: string[] = []
  for (const id of toDelete) {
    if (deletedInBackend.includes(id)) {
      failed.push(id)
    }
  }
  return {
    remainingCreated: failed,
    drafts: [] as Draft[],
    taskDrafts: [] as unknown[]
  }
}

/** 提交载荷：删除条目只带 delete 标记，不带字段变更 */
function buildBatchItems(drafts: Draft[], createdIds: string[]) {
  return [
    ...createdIds.map(id => ({ id, create: true })),
    ...drafts.map(draft =>
      draft.deleteRequested
        ? { id: draft.indicatorId, delete: true }
        : { id: draft.indicatorId, ...draft.changes }
    )
  ]
}

/**
 * 2026-10-22：提交前必须剔除「无实际变更」的草稿条目。
 * 一条 changes 为空、又没标记删除的脏草稿会让后端整批拒绝
 * （400 异动内容为空：指标 X 未提供有效变更字段），
 * 用户看到的就是「点了确认发起却什么都没发生」（实测：指标 2051）。
 */
function selectEffectiveDrafts(drafts: Draft[]) {
  return drafts.filter(draft => draft.deleteRequested || Object.keys(draft.changes).length > 0)
}

/**
 * 权重校验入口：删除条目的权重先从合计里剔除，但删除同样触发校验；
 * 校验锚点 = 非删除的指标条目（含新增，新增也要参与「落地后合计=100」）。
 */
function weightValidationEntries(items: Array<Record<string, unknown>>) {
  return items
    .filter(item => item.delete !== true && item.entity_type !== 'TASK')
    .map(item => item.id)
}

/**
 * 删除批次的闭合判定（复刻后端 assertPlanBasicWeightStillClosed 的决策）：
 * excludedSum = 剔除待删指标后的合计；≠100 时拒绝，且带「同批补齐」指引。
 */
function deleteBatchClosure(
  excludedSum: number,
  hasDelete: boolean
): 'pass' | 'reject-with-guidance' | 'reject' {
  if (excludedSum === 100) {
    return 'pass'
  }
  return hasDelete ? 'reject-with-guidance' : 'reject'
}

/** 终态收尾：返回该指标最终是否被软删除 */
function resolveArchiveOnTerminal(mutationType: string, approved: boolean): boolean {
  if (mutationType === 'DELETE') {
    return approved
  }
  if (mutationType === 'CREATE') {
    return !approved
  }
  return false
}

describe('mutation draft lifecycle', () => {
  it('shows the action buttons while any draft exists', () => {
    expect(hasMutationDraft([], [], [])).toBe(false)
    expect(hasMutationDraft([{ indicatorId: 1, changes: {}, labels: ['指标内容'] }], [], [])).toBe(
      true
    )
    expect(hasMutationDraft([], [{ taskId: 1 }], [])).toBe(true)
    expect(hasMutationDraft([], [], [2053])).toBe(true)
  })

  it('clears every draft collection on cancel, including created indicators', () => {
    const result = cancelDraft(['2053', '2054'], [])
    expect(result.remainingCreated).toEqual([])
    expect(hasMutationDraft(result.drafts, result.taskDrafts, result.remainingCreated)).toBe(false)
  })

  it('keeps undeletable created indicators visible so the user can retry', () => {
    // 2054 删除失败（后端拒绝）时不能假装取消成功
    const result = cancelDraft(['2053', '2054'], ['2054'])
    expect(result.remainingCreated).toEqual(['2054'])
    expect(hasMutationDraft(result.drafts, result.taskDrafts, result.remainingCreated)).toBe(true)
  })
})

describe('delete mutation goes through approval', () => {
  it('marks a delete draft instead of removing the row immediately', () => {
    const draft: Draft = {
      indicatorId: 2051,
      changes: {},
      labels: ['删除'],
      deleteRequested: true
    }
    const items = buildBatchItems([draft], [])
    expect(items).toEqual([{ id: 2051, delete: true }])
  })

  it('does not send stale field changes for a delete draft', () => {
    const draft: Draft = {
      indicatorId: 2051,
      changes: { indicator_desc: '旧改动' },
      labels: ['删除'],
      deleteRequested: true
    }
    const items = buildBatchItems([draft], []) as Array<Record<string, unknown>>
    expect(items[0]).toEqual({ id: 2051, delete: true })
    expect(items[0].indicator_desc).toBeUndefined()
  })

  it('excludes delete entries from the weight validation entries but keeps creates', () => {
    const items = [
      { id: 2051, delete: true },
      { id: 2052, weight_percent: 60 },
      { id: 2053, create: true }
    ]
    // 删除条目剔除权重但仍触发校验；新增条目要参与「落地后合计=100」的校验
    expect(weightValidationEntries(items)).toEqual([2052, 2053])
  })

  it('requires delete batches to stay closed, with same-batch guidance on rejection', () => {
    expect(deleteBatchClosure(100, true)).toBe('pass')
    expect(deleteBatchClosure(60, true)).toBe('reject-with-guidance')
    // 只删不补（剔除后 60）不允许留存缺口；删+调平（剔除后 100）才通过
    expect(deleteBatchClosure(110, true)).toBe('reject-with-guidance')
    // 无删除的批次维持原报错口径
    expect(deleteBatchClosure(60, false)).toBe('reject')
    expect(deleteBatchClosure(100, false)).toBe('pass')
  })
})

describe('terminal handling per mutation type', () => {
  it('archives the indicator when a delete mutation is approved', () => {
    expect(resolveArchiveOnTerminal('DELETE', true)).toBe(true)
  })

  it('keeps the indicator when a delete mutation is rejected', () => {
    expect(resolveArchiveOnTerminal('DELETE', false)).toBe(false)
  })

  it('archives a rejected create mutation so it stops polluting the weight total', () => {
    expect(resolveArchiveOnTerminal('CREATE', false)).toBe(true)
  })

  it('keeps an approved create mutation', () => {
    expect(resolveArchiveOnTerminal('CREATE', true)).toBe(false)
  })

  it('never rewrites business data for modify mutations', () => {
    // 驳回语义是「退回上一节点重改」，改动保留，由发起人继续修改
    expect(resolveArchiveOnTerminal('MODIFY', false)).toBe(false)
    expect(resolveArchiveOnTerminal('MODIFY', true)).toBe(false)
  })
})

/**
 * 2026-10-22：异动期间「新增一条、又把这条删掉」必须只是撤销新增，
 * 不能变成 create + delete 两个条目指向同一 ID——后端会先给它打异动标记、
 * 再报「该指标已有异动在审批中」，整批提交直接失败。
 */
describe('deleting a just-created indicator', () => {
  function resolveDeleteAction(
    indicatorId: string,
    pendingCreatedIds: string[]
  ): 'revoke-create' | 'delete-mutation' {
    return pendingCreatedIds.includes(indicatorId) ? 'revoke-create' : 'delete-mutation'
  }

  it('revokes the pending create instead of emitting a delete entry', () => {
    expect(resolveDeleteAction('2053', ['2053'])).toBe('revoke-create')
  })

  it('emits a delete mutation for an indicator that predates this draft', () => {
    expect(resolveDeleteAction('2051', ['2053'])).toBe('delete-mutation')
  })

  it('never produces both create and delete for the same id', () => {
    const target = '2053'
    const action = resolveDeleteAction(target, [target])
    const createdAfter = action === 'revoke-create' ? [] : [target]
    const drafts: Draft[] =
      action === 'delete-mutation'
        ? [{ indicatorId: target, changes: {}, labels: ['删除'], deleteRequested: true }]
        : []
    const items = buildBatchItems(drafts, createdAfter) as Array<Record<string, unknown>>
    expect(items.filter(item => String(item.id) === target)).toEqual([])
  })
})

describe('submitting with a stale empty draft entry', () => {
  it('drops empty non-delete drafts so one dirty entry cannot block the whole batch', () => {
    const drafts: Draft[] = [
      { indicatorId: 2051, changes: {}, labels: [] }, // 脏条目：实测卡死了整批提交
      { indicatorId: 2052, changes: { remark: '新备注' }, labels: ['下发备注'] }
    ]
    const effective = selectEffectiveDrafts(drafts)
    const items = buildBatchItems(effective, [2064]) as Array<Record<string, unknown>>
    expect(items).toEqual([
      { id: 2064, create: true },
      { id: 2052, remark: '新备注' }
    ])
  })

  it('still keeps delete drafts even though their changes map is empty', () => {
    const drafts: Draft[] = [
      { indicatorId: 2051, changes: {}, labels: ['删除'], deleteRequested: true }
    ]
    const effective = selectEffectiveDrafts(drafts)
    const items = buildBatchItems(effective, []) as Array<Record<string, unknown>>
    expect(items).toEqual([{ id: 2051, delete: true }])
  })

  it('reports nothing submittable when every draft is empty', () => {
    const drafts: Draft[] = [{ indicatorId: 2051, changes: {}, labels: [] }]
    expect(selectEffectiveDrafts(drafts)).toEqual([])
  })
})

describe('withdraw permission for mutation cards', () => {
  function canWithdraw(currentUserName: string, submitterName: string, stepName: string): boolean {
    if (!currentUserName || !submitterName || currentUserName !== submitterName) {
      return false
    }
    return !stepName.includes('终审') && !stepName.includes('分管校领导')
  }

  it('allows the requester to withdraw before the final approval step', () => {
    expect(canWithdraw('战略部管理员', '战略部管理员', '战略发展部负责人审批')).toBe(true)
  })

  it('blocks withdraw once the flow reaches the vice president', () => {
    expect(canWithdraw('战略部管理员', '战略部管理员', '分管校领导审批')).toBe(false)
  })

  it("blocks other users from withdrawing someone else's mutation", () => {
    expect(canWithdraw('战略发展部负责人1', '战略部管理员', '战略发展部负责人审批')).toBe(false)
  })
})

/**
 * 2026-10-22 修复（刷新丢失「待提交新增」标记 → 孤儿指标）：
 * 标记用 sessionStorage 持久化，页面重载后按「指标仍存在且仍为草稿」回填。
 */
describe('pending create marker survives page refresh', () => {
  function restorePendingCreates(
    stored: Array<string | number> | null,
    rows: Array<{ id: string | number; status: string }>
  ): Array<string | number> {
    if (!stored || stored.length === 0) {
      return []
    }
    // 数据尚未加载成功时先原样保留，避免把标记误清
    if (rows.length === 0) {
      return stored
    }
    return stored.filter(id =>
      rows.some(row => String(row.id) === String(id) && row.status === 'DRAFT')
    )
  }

  it('restores the marker after refresh so 发起异动 stays available', () => {
    const stored = [2053]
    const rows = [
      { id: 2013, status: 'DISTRIBUTED' },
      { id: 2053, status: 'DRAFT' }
    ]
    expect(restorePendingCreates(stored, rows)).toEqual([2053])
  })

  it('drops stored ids that are no longer drafts (promoted or removed)', () => {
    const stored = [2053, 2054]
    const rows = [
      { id: 2053, status: 'DISTRIBUTED' }, // 已转正
      { id: 2014, status: 'DISTRIBUTED' }
    ]
    // 2053 转正后不再算待提交；2054 已不在列表
    expect(restorePendingCreates(stored, rows)).toEqual([])
  })

  it('keeps stored ids untouched when the indicator list failed to load', () => {
    expect(restorePendingCreates([2053], [])).toEqual([2053])
  })

  it('restores nothing when storage is empty', () => {
    expect(restorePendingCreates(null, [{ id: 2053, status: 'DRAFT' }])).toEqual([])
    expect(restorePendingCreates([], [{ id: 2053, status: 'DRAFT' }])).toEqual([])
  })
})
