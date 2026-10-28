import { describe, expect, it } from 'vitest'
import {
  MAX_SEGMENT_BYTES,
  buildAttachmentFileName,
  buildIndicatorDirName,
  ensureUniqueName,
  sanitizePathSegment,
  truncateByUtf8Bytes,
  utf8ByteLength
} from './fileName'

const REPLACEMENT_CHAR = '�'

describe('export fileName helpers', () => {
  it('counts UTF-8 bytes for ascii, chinese and emoji', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('指标')).toBe(6)
    expect(utf8ByteLength('📊')).toBe(4)
  })

  it('truncates long chinese names by bytes without splitting characters', () => {
    const name = '关于加快推进学校高质量内涵式发展的核心指标'.repeat(6)
    const result = truncateByUtf8Bytes(name, 120)

    expect(utf8ByteLength(result)).toBeLessThanOrEqual(120)
    expect(result.endsWith('…')).toBe(true)
    expect(result).not.toContain(REPLACEMENT_CHAR)
  })

  it('falls back to a plain cut when the byte budget cannot fit the ellipsis', () => {
    expect(truncateByUtf8Bytes('指标名称', 2)).toBe('')
    expect(truncateByUtf8Bytes('ab', 1)).toBe('a')
  })

  it('keeps text that already fits untouched', () => {
    expect(truncateByUtf8Bytes('学科建设', 120)).toBe('学科建设')
  })

  it('sanitizes illegal characters, reserved names and trailing dots', () => {
    expect(sanitizePathSegment('党委/办公室:统战部*2026')).toBe('党委-办公室-统战部-2026')
    expect(sanitizePathSegment('CON')).toBe('_CON')
    expect(sanitizePathSegment('lpt1')).toBe('_lpt1')
    expect(sanitizePathSegment('报告. ')).toBe('报告')
    expect(sanitizePathSegment('   ')).toBe('未命名')
    expect(sanitizePathSegment('a\u0000b')).toBe('ab')
  })

  it('builds a stable indicator directory from sequence and truncated name', () => {
    const longName = '超长指标名称'.repeat(40)
    const dir = buildIndicatorDirName(3, longName)

    expect(dir.startsWith('03_')).toBe(true)
    expect(utf8ByteLength(dir)).toBeLessThanOrEqual(MAX_SEGMENT_BYTES)
    expect(dir.endsWith('…')).toBe(true)
    expect(buildIndicatorDirName(12, '学科建设')).toBe('12_学科建设')
  })

  it('builds attachment file names with round/date prefix and keeps the extension', () => {
    expect(buildAttachmentFileName('进展报告.pdf', { round: 1, fillDate: '2026-09-30' })).toBe(
      'R1_2026-09-30_进展报告.pdf'
    )

    const longName = `${'超长附件名'.repeat(40)}.xlsx`
    const result = buildAttachmentFileName(longName, { round: 2, fillDate: '2026-10-25' })

    expect(result.endsWith('.xlsx')).toBe(true)
    expect(utf8ByteLength(result)).toBeLessThanOrEqual(MAX_SEGMENT_BYTES)
    expect(result.startsWith('R2_2026-10-25_')).toBe(true)
  })

  it('treats dotted dates as part of the base name rather than an extension', () => {
    expect(buildAttachmentFileName('2026.10.28 汇报材料')).toBe('2026.10.28 汇报材料')
  })

  it('strips illegal characters from a date-time fill date', () => {
    expect(buildAttachmentFileName('报告.pdf', { round: 1, fillDate: '2026-09-30T10:00:00' })).toBe(
      'R1_2026-09-30T10-00-00_报告.pdf'
    )
  })

  it('de-duplicates repeated file names with a numeric suffix', () => {
    const used = new Set<string>()
    expect(ensureUniqueName('报告.pdf', used)).toBe('报告.pdf')
    expect(ensureUniqueName('报告.pdf', used)).toBe('报告_2.pdf')
    expect(ensureUniqueName('报告.pdf', used)).toBe('报告_3.pdf')
  })
})
