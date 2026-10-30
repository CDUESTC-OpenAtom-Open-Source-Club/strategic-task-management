import { describe, expect, it } from 'vitest'
import type { MutationHistoryItem } from '@/features/indicator/api/mutationApi'
import {
  MUTATION_FIELDS_INDICATOR_NAME,
  MUTATION_FIELDS_WEIGHT,
  countMutationHistoryByFields,
  projectMutationHistoryByFields
} from '../mutationHistory'

function makeItem(changed: MutationHistoryItem['changed_fields']): MutationHistoryItem {
  return {
    log_id: 1,
    action: 'UPDATE',
    before_json: null,
    after_json: null,
    changed_fields: changed,
    actor_user_id: 7,
    created_at: '2026-10-30T10:00:00'
  }
}

describe('projectMutationHistoryByFields（异动角标浮层的字段投影）', () => {
  // 2026-10-30 用户反馈：同一行同时改了权重和指标内容，权重列圆点的浮层
  // 把「指标内容」的变更也显示了出来——投影后各列只看得到自己跟踪的字段
  const mixed = makeItem({
    weight_percent: { before: 30, after: 45 },
    indicator_desc: { before: '小微企业贷款余额', after: '普惠小微贷款余额' }
  })

  it('同一记录含权重+指标内容两个字段：权重圆点只见权重', () => {
    const projected = projectMutationHistoryByFields([mixed], MUTATION_FIELDS_WEIGHT)
    expect(projected).toHaveLength(1)
    expect(Object.keys(projected[0].changed_fields ?? {})).toEqual(['weight_percent'])
    expect(projected[0].changed_fields?.weight_percent).toEqual({ before: 30, after: 45 })
  })

  it('同一记录含权重+指标内容两个字段：指标内容圆点只见指标内容（不含权重）', () => {
    const projected = projectMutationHistoryByFields([mixed], MUTATION_FIELDS_INDICATOR_NAME)
    expect(projected).toHaveLength(1)
    expect(Object.keys(projected[0].changed_fields ?? {})).toEqual(['indicator_desc'])
    expect(projected[0].changed_fields?.indicator_desc?.after).toBe('普惠小微贷款余额')
  })

  it('投影返回新对象，不污染共享缓存里的原记录', () => {
    // 各列徽标共用同一份缓存历史，权重列投影不得把指标内容的字段从缓存里抹掉
    projectMutationHistoryByFields([mixed], MUTATION_FIELDS_WEIGHT)
    expect(Object.keys(mixed.changed_fields ?? {}).sort()).toEqual([
      'indicator_desc',
      'weight_percent'
    ])
  })

  it('__delete__ 行：指标内容列（fields 含 __delete__）保留并原样展示', () => {
    const deleted = makeItem({ __delete__: { before: '小微企业贷款余额', after: null } })
    const projected = projectMutationHistoryByFields([deleted], MUTATION_FIELDS_INDICATOR_NAME)
    expect(projected).toHaveLength(1)
    expect(projected[0].changed_fields?.__delete__).toEqual({
      before: '小微企业贷款余额',
      after: null
    })
  })

  it('__delete__ 行：权重列不跟踪该键，整行被剔除', () => {
    const deleted = makeItem({ __delete__: { before: '小微企业贷款余额', after: null } })
    expect(projectMutationHistoryByFields([deleted], MUTATION_FIELDS_WEIGHT)).toEqual([])
  })

  it('fields 为 null / 不传 / 空数组：不投影，原样返回全部字段', () => {
    const history = [mixed]
    // 原样返回（同一引用），字段一个不少
    expect(projectMutationHistoryByFields(history, null)).toBe(history)
    expect(projectMutationHistoryByFields(history, undefined)).toBe(history)
    expect(projectMutationHistoryByFields(history, [])).toBe(history)
    expect(Object.keys(history[0].changed_fields ?? {})).toEqual([
      'weight_percent',
      'indicator_desc'
    ])
  })

  it('行内没有任何跟踪字段时整行剔除；changed_fields 为 null 的行同样剔除', () => {
    const history = [
      mixed,
      makeItem({ remark: { before: '无', after: '四季度加压' } }),
      makeItem(null)
    ]
    expect(projectMutationHistoryByFields(history, MUTATION_FIELDS_WEIGHT)).toHaveLength(1)
  })

  it('中文字段值投影后原样保留', () => {
    const chinese = makeItem({
      indicator_desc: { before: '绿色信贷投放量（亿元）', after: '绿色信贷余额（亿元）' }
    })
    const projected = projectMutationHistoryByFields([chinese], MUTATION_FIELDS_INDICATOR_NAME)
    expect(projected[0].changed_fields?.indicator_desc).toEqual({
      before: '绿色信贷投放量（亿元）',
      after: '绿色信贷余额（亿元）'
    })
  })
})

describe('countMutationHistoryByFields（角标计数口径）', () => {
  it('按行计数：一条记录改了两个跟踪字段仍只计 1 次', () => {
    const mixed = makeItem({
      weight_percent: { before: 30, after: 45 },
      indicator_desc: { before: '旧', after: '新' }
    })
    expect(countMutationHistoryByFields([mixed], MUTATION_FIELDS_WEIGHT)).toBe(1)
    expect(countMutationHistoryByFields([mixed], MUTATION_FIELDS_INDICATOR_NAME)).toBe(1)
  })

  it('计数与浮层投影后的条目数一致（用户感知：数字=浮层条目数）', () => {
    const history = [
      makeItem({
        weight_percent: { before: 30, after: 45 },
        indicator_desc: { before: '旧', after: '新' }
      }),
      makeItem({ remark: { before: '无', after: '加压' } }),
      makeItem({ weight_percent: { before: 45, after: 50 } })
    ]
    const fields = MUTATION_FIELDS_WEIGHT
    expect(countMutationHistoryByFields(history, fields)).toBe(
      projectMutationHistoryByFields(history, fields).length
    )
  })

  it('fields 为 null 时计全部异动行', () => {
    const history = [makeItem({ remark: { before: 'a', after: 'b' } }), makeItem(null)]
    expect(countMutationHistoryByFields(history, null)).toBe(2)
  })
})
