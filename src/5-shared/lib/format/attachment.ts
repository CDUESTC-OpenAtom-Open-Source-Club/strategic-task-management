/**
 * Attachment Formatting Utilities
 *
 * 附件类型短标签：文件类型标签必须很短（用户 2026-10-30 定案），
 * 优先取文件名扩展名，其次按已知 MIME 映射，都取不到时返回空串
 * （调用方据此整体不渲染标签，绝不裸显后端原始 MIME 串）。
 */

/**
 * 扩展名合法性：字母数字、长度 1-10。
 * 防御文件名里的点号不是真正扩展名的情况（如「v2.备份」「.hidden」）。
 */
const EXTENSION_PATTERN = /^[a-z0-9]{1,10}$/i

/**
 * 已知 MIME → 短标签映射（子串匹配，输入统一转小写后比对）。
 * 覆盖 ALLOWED_FILE_TYPES 允许上传的类型及常见办公/图片/文本格式。
 */
const MIME_LABEL_RULES: ReadonlyArray<readonly [pattern: string, label: string]> = [
  ['wordprocessingml.document', 'DOCX'],
  ['spreadsheetml.sheet', 'XLSX'],
  ['presentationml.presentation', 'PPTX'],
  ['msword', 'DOC'],
  ['vnd.ms-excel', 'XLS'],
  ['vnd.ms-powerpoint', 'PPT'],
  ['application/pdf', 'PDF'],
  ['image/png', 'PNG'],
  ['image/jpeg', 'JPG'],
  ['image/gif', 'GIF'],
  ['image/webp', 'WEBP'],
  ['text/plain', 'TXT'],
  ['text/csv', 'CSV'],
  ['application/zip', 'ZIP'],
  ['x-zip', 'ZIP']
]

/**
 * 从文件名提取扩展名短标签（去点、大写），非合法扩展名返回空串
 */
function extensionLabel(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
    return ''
  }
  const extension = fileName.slice(dotIndex + 1).trim()
  if (!EXTENSION_PATTERN.test(extension)) {
    return ''
  }
  return extension.toUpperCase()
}

/**
 * 从 MIME 类型按已知规则匹配短标签，未知返回空串
 */
function mimeLabel(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase()
  if (!normalized) {
    return ''
  }
  for (const [pattern, label] of MIME_LABEL_RULES) {
    if (normalized.includes(pattern)) {
      return label
    }
  }
  return ''
}

/**
 * 附件类型短标签：扩展名优先，其次 MIME 映射，都取不到返回空串。
 *
 * @example
 * formatAttachmentTypeLabel('application/vnd.openxmlformats-officedocument.wordprocessingml.document', '报告.docx')
 * // → 'DOCX'
 * formatAttachmentTypeLabel('application/octet-stream', '无扩展名文件')
 * // → ''
 */
export function formatAttachmentTypeLabel(mimeType: string, fileName: string): string {
  return extensionLabel(String(fileName ?? '')) || mimeLabel(String(mimeType ?? ''))
}
