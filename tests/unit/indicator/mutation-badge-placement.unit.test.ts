import { describe, it, expect, vi, beforeEach } from 'vitest'

const { historyMock, taskHistoryMock } = vi.hoisted(() => ({
  historyMock: vi.fn(),
  taskHistoryMock: vi.fn()
}))

vi.mock('@/features/indicator/api/mutationApi', () => ({
  mutationApi: {
    history: historyMock,
    taskHistory: taskHistoryMock
  }
}))

import {
  MUTATION_FIELDS_INDICATOR_NAME,
  MUTATION_FIELDS_REMARK,
  MUTATION_FIELDS_WEIGHT,
  countMutationHistoryByFields,
  filterMutationHistoryByFields,
  getMutationHistory,
  invalidateMutationHistory,
  loadMutationHistory
} from '@/features/indicator/model/mutationHistory'
import type { MutationHistoryItem } from '@/features/indicator/api/mutationApi'

function makeItem(
  logId: number,
  changedFields: Record<string, { before?: unknown; after?: unknown }> | null
): MutationHistoryItem {
  return {
    log_id: logId,
    action: 'UPDATE',
    before_json: null,
    after_json: null,
    changed_fields: changedFields,
    actor_user_id: 188,
    created_at: '2026-10-30 10:00:00'
  }
}

// 一次异动可能同时改多个字段，也可能只改一个
const HISTORY: MutationHistoryItem[] = [
  makeItem(1, { weight_percent: { before: '100.00', after: '60.00' } }),
  makeItem(2, { indicator_desc: { before: '旧内容', after: '新内容' } }),
  makeItem(3, {
    indicator_desc: { before: 'A', after: 'B' },
    weight_percent: { before: '40.00', after: '50.00' }
  }),
  makeItem(4, { remark: { before: '旧备注', after: '新备注' } })
]

describe('mutationHistory 字段分流', () => {
  it('权重徽标只数改了权重的记录，不含指标内容与备注', () => {
    const count = countMutationHistoryByFields(HISTORY, MUTATION_FIELDS_WEIGHT)
    // log 1（纯权重）+ log 3（内容+权重）
    expect(count).toBe(2)
  })

  it('核心指标徽标只数改了指标内容的记录，不含权重', () => {
    const count = countMutationHistoryByFields(HISTORY, MUTATION_FIELDS_INDICATOR_NAME)
    // log 2（纯内容）+ log 3（内容+权重）
    expect(count).toBe(2)
  })

  it('备注徽标只数改了备注的记录', () => {
    expect(countMutationHistoryByFields(HISTORY, MUTATION_FIELDS_REMARK)).toBe(1)
  })

  it('同一条记录改了多个字段时，各列徽标都各自计一次', () => {
    const item = makeItem(9, {
      indicator_desc: { before: 'A', after: 'B' },
      weight_percent: { before: '1', after: '2' }
    })
    expect(countMutationHistoryByFields([item], MUTATION_FIELDS_WEIGHT)).toBe(1)
    expect(countMutationHistoryByFields([item], MUTATION_FIELDS_INDICATOR_NAME)).toBe(1)
    expect(countMutationHistoryByFields([item], MUTATION_FIELDS_REMARK)).toBe(0)
  })

  it('不传字段时统计全部异动', () => {
    expect(countMutationHistoryByFields(HISTORY, null)).toBe(HISTORY.length)
    expect(countMutationHistoryByFields(HISTORY, [])).toBe(HISTORY.length)
  })

  it('changed_fields 为空的记录不计入任何字段徽标', () => {
    const item = makeItem(10, null)
    expect(countMutationHistoryByFields([item], MUTATION_FIELDS_WEIGHT)).toBe(0)
    expect(countMutationHistoryByFields([item], MUTATION_FIELDS_INDICATOR_NAME)).toBe(0)
  })

  it('过滤结果只保留目标字段的记录', () => {
    const filtered = filterMutationHistoryByFields(HISTORY, MUTATION_FIELDS_WEIGHT)
    expect(filtered.map(item => item.log_id)).toEqual([1, 3])
  })
})

describe('mutationHistory 共享缓存', () => {
  beforeEach(() => {
    historyMock.mockReset()
    taskHistoryMock.mockReset()
    historyMock.mockResolvedValue({ data: HISTORY })
    taskHistoryMock.mockResolvedValue({ data: [] })
    invalidateMutationHistory()
  })

  it('同一指标多次加载只发一次请求（多个列徽标共享）', async () => {
    await Promise.all([
      loadMutationHistory('indicator', 2042),
      loadMutationHistory('indicator', 2042),
      loadMutationHistory('indicator', 2042)
    ])
    expect(historyMock).toHaveBeenCalledTimes(1)
  })

  it('加载后徽标按列能取到同一份历史的分流结果', async () => {
    await loadMutationHistory('indicator', 2042)
    const cached = getMutationHistory('indicator', 2042)
    expect(cached).toHaveLength(HISTORY.length)
    expect(countMutationHistoryByFields(cached, MUTATION_FIELDS_WEIGHT)).toBe(2)
    expect(countMutationHistoryByFields(cached, MUTATION_FIELDS_INDICATOR_NAME)).toBe(2)
  })

  it('不同指标各自请求一次', async () => {
    await loadMutationHistory('indicator', 1)
    await loadMutationHistory('indicator', 2)
    expect(historyMock).toHaveBeenCalledTimes(2)
  })

  it('接口失败时缓存为空数组，不抛错', async () => {
    historyMock.mockRejectedValueOnce(new Error('boom'))
    await loadMutationHistory('indicator', 999)
    expect(getMutationHistory('indicator', 999)).toEqual([])
  })

  it('失效后重新拉取（发起异动后徽标计数要更新）', async () => {
    await loadMutationHistory('indicator', 2042)
    expect(historyMock).toHaveBeenCalledTimes(1)

    invalidateMutationHistory('indicator', 2042)
    await loadMutationHistory('indicator', 2042)
    expect(historyMock).toHaveBeenCalledTimes(2)
  })
})
