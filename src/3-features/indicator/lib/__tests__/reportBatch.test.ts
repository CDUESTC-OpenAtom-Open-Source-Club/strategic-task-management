import { describe, expect, it } from 'vitest'
import { collectExistingAttachmentIds, resolveBatchSelfRating } from '../reportBatch'

describe('collectExistingAttachmentIds（附件关联回填）', () => {
  // 2026-10-28：保存任一条指标时，非当前指标必须保留其已关联的附件 id，
  // 否则后端全量覆盖会把先前保存的关联清空（Issue #91 P0-2）
  it('取回已关联的附件 id', () => {
    const item = { pendingAttachmentDetails: [{ id: '11' }, { id: '12' }] }
    expect(collectExistingAttachmentIds(item)).toEqual([11, 12])
  })

  it('兼容 attachmentId 字段名（后端上报快照返回该字段）', () => {
    const item = { pendingAttachmentDetails: [{ attachmentId: 21 }, { attachmentId: 22 }] }
    expect(collectExistingAttachmentIds(item)).toEqual([21, 22])
  })

  it('attachmentId 优先于 id', () => {
    const item = { pendingAttachmentDetails: [{ id: '9', attachmentId: 31 }] }
    expect(collectExistingAttachmentIds(item)).toEqual([31])
  })

  it('没有附件明细时返回空数组', () => {
    expect(collectExistingAttachmentIds({})).toEqual([])
    expect(collectExistingAttachmentIds({ pendingAttachmentDetails: null })).toEqual([])
    expect(collectExistingAttachmentIds(null)).toEqual([])
    expect(collectExistingAttachmentIds(undefined)).toEqual([])
  })

  it('过滤非法 id', () => {
    const item = {
      pendingAttachmentDetails: [{ id: 'abc' }, { id: '0' }, { id: '-3' }, { id: '7' }]
    }
    expect(collectExistingAttachmentIds(item)).toEqual([7])
  })
})

describe('resolveBatchSelfRating（自评进度不被当前值覆盖）', () => {
  // 2026-10-28：此前整批都用当前表单的自评进度，实填「超前/延期」落库全为「正常」（Issue #91 P1-1）
  it('当前指标用表单里的等级', () => {
    expect(
      resolveBatchSelfRating({
        isCurrentIndicator: true,
        formSelfRating: 'AHEAD',
        itemSelfRating: 'NORMAL'
      })
    ).toBe('AHEAD')
  })

  it('非当前指标沿用各自已保存的等级，不被当前值覆盖', () => {
    expect(
      resolveBatchSelfRating({
        isCurrentIndicator: false,
        formSelfRating: 'AHEAD',
        itemSelfRating: 'DELAYED'
      })
    ).toBe('DELAYED')
  })

  it('非当前指标没有历史等级时不写入等级（留空而非塞默认值）', () => {
    expect(
      resolveBatchSelfRating({
        isCurrentIndicator: false,
        formSelfRating: 'AHEAD',
        itemSelfRating: ''
      })
    ).toBeUndefined()
  })

  it('当前指标未选择等级时同样留空', () => {
    expect(resolveBatchSelfRating({ isCurrentIndicator: true, formSelfRating: '' })).toBeUndefined()
  })
})
