import { describe, expect, it, vi } from 'vitest'

vi.mock('@/5-shared/api/client', () => ({
  apiClient: {
    getAxiosInstance: () => ({ get: vi.fn() })
  }
}))

import { MAX_SEGMENT_BYTES, utf8ByteLength } from './fileName'
import { buildAttachmentRelativeDir, collectAttachmentGroups } from './zipExport'

describe('zip export attachment grouping', () => {
  it('collects attachments per indicator and skips rows without attachments', () => {
    const groups = collectAttachmentGroups([
      {
        seq: 1,
        indicatorName: '学科建设',
        attachments: [{ name: '进展.pdf', attachmentId: 11 }]
      },
      { seq: 2, indicatorName: '师资队伍', attachments: [] },
      {
        seq: 3,
        indicatorName: '科研平台',
        attachments: [{ fileName: '佐证.xlsx', id: 12 }]
      }
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({
      seq: 1,
      indicatorName: '学科建设',
      attachments: [{ name: '进展.pdf', attachmentId: 11 }]
    })
    expect(groups[1]).toMatchObject({
      seq: 3,
      attachments: [{ name: '佐证.xlsx', attachmentId: 12 }]
    })
  })

  it('deduplicates repeated attachments within one indicator only', () => {
    const shared = { name: '共享材料.pdf', attachmentId: 99 }
    const groups = collectAttachmentGroups([
      { seq: 1, indicatorName: '指标A', attachments: [shared, { ...shared }] },
      { seq: 2, indicatorName: '指标B', attachments: [shared] }
    ])

    expect(groups[0].attachments).toHaveLength(1)
    expect(groups[1].attachments).toHaveLength(1)
  })

  it('builds a byte-safe relative directory for long indicator names', () => {
    const dir = buildAttachmentRelativeDir({
      seq: 7,
      indicatorName: '超长指标名称'.repeat(40)
    })

    expect(dir.startsWith('附件/07_')).toBe(true)
    expect(utf8ByteLength(dir)).toBeLessThanOrEqual(MAX_SEGMENT_BYTES + utf8ByteLength('附件/'))
  })
})
