import { beforeEach, describe, expect, it, vi } from 'vitest'

const getLatestVisibleIndicatorAttachments = vi.fn()

vi.mock('@/features/plan/api/planApi', () => ({
  indicatorFillApi: {
    getLatestVisibleIndicatorAttachments: (...args: unknown[]) =>
      getLatestVisibleIndicatorAttachments(...args)
  }
}))

import {
  getAttachmentSummary,
  loadIndicatorAttachmentSummaryMap,
  resolveVisibleAttachments
} from '../indicatorAttachmentSummary'

describe('indicatorAttachmentSummary', () => {
  beforeEach(() => {
    getLatestVisibleIndicatorAttachments.mockReset()
  })

  it('maps visible attachments by indicator id', async () => {
    getLatestVisibleIndicatorAttachments.mockResolvedValue({
      code: 200,
      data: [
        {
          indicatorId: 11,
          reportId: 91,
          round: 2,
          fillDate: '2026-09-30',
          attachments: [{ id: 501, fileName: '进展报告.pdf' }]
        }
      ],
      message: 'ok',
      timestamp: ''
    })

    const map = await loadIndicatorAttachmentSummaryMap([11, '11', 12])

    expect(getLatestVisibleIndicatorAttachments).toHaveBeenCalledWith(['11', '12'])
    expect(map?.get('11')).toMatchObject({
      indicatorId: '11',
      round: 2,
      fillDate: '2026-09-30',
      attachments: [{ name: '进展报告.pdf', attachmentId: 501 }]
    })
    expect(map?.has('12')).toBe(false)
  })

  it('returns null on request failure so callers can fall back to row data', async () => {
    getLatestVisibleIndicatorAttachments.mockRejectedValue(new Error('network'))

    const map = await loadIndicatorAttachmentSummaryMap([11])

    expect(map).toBeNull()
  })

  it('treats an empty visible result as authoritative, not a fallback', async () => {
    getLatestVisibleIndicatorAttachments.mockResolvedValue({
      code: 200,
      data: [],
      message: 'ok',
      timestamp: ''
    })

    const map = await loadIndicatorAttachmentSummaryMap([11])

    expect(map).not.toBeNull()
    expect(resolveVisibleAttachments(map, 11, () => [{ name: '行内草稿.pdf' }])).toEqual([])
  })

  it('falls back to row-level attachments only when the request failed', () => {
    expect(
      resolveVisibleAttachments(null, 11, () => [{ name: '行内草稿.pdf', attachmentId: 9 }])
    ).toEqual([{ name: '行内草稿.pdf', attachmentId: 9 }])
  })

  it('reads a summary by string or numeric id', () => {
    const map = new Map([['11', { indicatorId: '11', attachments: [{ name: 'a.pdf' }] }]])

    expect(getAttachmentSummary(map, 11)?.indicatorId).toBe('11')
    expect(getAttachmentSummary(map, '11')?.indicatorId).toBe('11')
    expect(getAttachmentSummary(null, 11)).toBeUndefined()
  })
})
