import { describe, expect, it } from 'vitest'
import {
  buildAttachmentCell,
  formatMilestones,
  formatProgress,
  normalizeExportAttachments,
  normalizeSheetName
} from './excel'

describe('excel export helpers', () => {
  it('merges current and reported progress into one display field', () => {
    expect(formatProgress(60, 80)).toBe('当前进度：60%（填报进度：80%）')
    expect(formatProgress(60, null)).toBe('当前进度：60%')
  })

  it('keeps attachment names and accessible links', () => {
    const cell = buildAttachmentCell([
      { name: '佐证材料.pdf', url: '/api/v1/attachments/1/download' }
    ])

    expect(cell).toMatchObject({
      type: 'Formula'
    })
    expect(String(cell && typeof cell === 'object' && 'value' in cell ? cell.value : '')).toContain(
      '/api/v1/attachments/1/download'
    )
    expect(String(cell && typeof cell === 'object' && 'value' in cell ? cell.value : '')).toContain(
      '佐证材料.pdf'
    )

    expect(
      buildAttachmentCell([
        { name: '材料一.pdf', url: 'https://example.test/a.pdf' },
        { name: '材料二.docx', url: 'https://example.test/b.docx' }
      ])
    ).toBe('材料一.pdf：https://example.test/a.pdf\n材料二.docx：https://example.test/b.docx')
  })

  it('normalizes attachment objects and sheet names', () => {
    expect(
      normalizeExportAttachments([
        { fileName: '申请表.xlsx', id: 12 },
        { originalName: '说明.docx', publicUrl: 'https://example.test/doc' }
      ])
    ).toEqual([
      {
        name: '申请表.xlsx',
        url: 'http://localhost:3000/api/v1/attachments/12/download',
        attachmentId: 12
      },
      {
        name: '说明.docx',
        url: 'https://example.test/doc',
        attachmentId: undefined
      }
    ])

    expect(normalizeSheetName('党委/办公室:统战部*2026')).toBe('党委 办公室 统战部 2026')
  })

  it('formats milestone details for wrapped cells', () => {
    expect(
      formatMilestones([
        { name: '阶段一', deadline: '2026-03-31', targetProgress: 30 },
        { milestoneName: '阶段二', expectedDate: '2026-06-30T00:00:00', progress: 60 }
      ])
    ).toBe('1. 阶段一（2026-03-31，30%）\n2. 阶段二（2026-06-30 00:00，60%）')
  })
})
