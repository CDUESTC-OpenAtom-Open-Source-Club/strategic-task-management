/**
 * Attachment Formatting Tests
 *
 * Unit tests for attachment type label formatting utilities
 */

import { describe, it, expect } from 'vitest'
import { formatAttachmentTypeLabel } from '../attachment'

describe('Attachment Formatting', () => {
  describe('formatAttachmentTypeLabel', () => {
    describe('extension label (priority 1)', () => {
      it('should return DOCX from .docx extension', () => {
        expect(formatAttachmentTypeLabel('application/octet-stream', '报告.docx')).toBe('DOCX')
      })

      it('should return XLSX from .xlsx extension', () => {
        expect(formatAttachmentTypeLabel('application/octet-stream', '台账.xlsx')).toBe('XLSX')
      })

      it('should return PDF from .pdf extension', () => {
        expect(formatAttachmentTypeLabel('application/octet-stream', 'summary.pdf')).toBe('PDF')
      })

      it('should return PNG from .png extension', () => {
        expect(formatAttachmentTypeLabel('application/octet-stream', 'chart.png')).toBe('PNG')
      })

      it('should prefer extension over mime type', () => {
        expect(formatAttachmentTypeLabel('image/png', 'document.pdf')).toBe('PDF')
      })

      it('should handle uppercase extension in file name', () => {
        expect(formatAttachmentTypeLabel('application/octet-stream', '报告.DOCX')).toBe('DOCX')
      })

      it('should handle multiple dots in file name', () => {
        expect(formatAttachmentTypeLabel('application/octet-stream', 'v1.2.final.docx')).toBe(
          'DOCX'
        )
      })

      it('should handle Chinese file name with extension', () => {
        expect(
          formatAttachmentTypeLabel(
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '季度报告（最终版）.docx'
          )
        ).toBe('DOCX')
      })

      it('should treat pure-dot or trailing-dot file names as no extension', () => {
        expect(formatAttachmentTypeLabel('application/pdf', '.')).toBe('PDF')
        expect(formatAttachmentTypeLabel('application/octet-stream', 'file.')).toBe('')
      })
    })

    describe('mime type label (priority 2)', () => {
      it('should map wordprocessingml.document to DOCX', () => {
        expect(
          formatAttachmentTypeLabel(
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            ''
          )
        ).toBe('DOCX')
      })

      it('should map spreadsheetml.sheet to XLSX', () => {
        expect(
          formatAttachmentTypeLabel(
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            ''
          )
        ).toBe('XLSX')
      })

      it('should map presentationml.presentation to PPTX', () => {
        expect(
          formatAttachmentTypeLabel(
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            ''
          )
        ).toBe('PPTX')
      })

      it('should map application/pdf to PDF', () => {
        expect(formatAttachmentTypeLabel('application/pdf', '')).toBe('PDF')
      })

      it('should map image/png to PNG', () => {
        expect(formatAttachmentTypeLabel('image/png', '')).toBe('PNG')
      })

      it('should map image/jpeg to JPG', () => {
        expect(formatAttachmentTypeLabel('image/jpeg', '')).toBe('JPG')
      })

      it('should map text/plain to TXT', () => {
        expect(formatAttachmentTypeLabel('text/plain', '')).toBe('TXT')
      })

      it('should map application/zip to ZIP', () => {
        expect(formatAttachmentTypeLabel('application/zip', '')).toBe('ZIP')
      })

      it('should match mime case-insensitively', () => {
        expect(
          formatAttachmentTypeLabel(
            'APPLICATION/VND.OPENXMLFORMATS-OFFICEDOCUMENT.WORDPROCESSINGML.DOCUMENT',
            ''
          )
        ).toBe('DOCX')
      })

      it('should match legacy msword mime to DOC', () => {
        expect(formatAttachmentTypeLabel('application/msword', '')).toBe('DOC')
      })

      it('should match mime with parameters', () => {
        expect(formatAttachmentTypeLabel('text/plain; charset=utf-8', '')).toBe('TXT')
      })
    })

    describe('unknown / empty inputs (priority 3)', () => {
      it('should return empty string for unknown mime without extension', () => {
        expect(formatAttachmentTypeLabel('application/octet-stream', '无扩展名文件')).toBe('')
      })

      it('should return empty string for empty inputs', () => {
        expect(formatAttachmentTypeLabel('', '')).toBe('')
      })

      it('should return empty string for unknown mime with dotless Chinese file name', () => {
        expect(formatAttachmentTypeLabel('x-unknown/binary', '季度报告')).toBe('')
      })
    })
  })
})
