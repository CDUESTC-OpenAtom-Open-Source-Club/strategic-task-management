/**
 * 导出包内文件名/目录名工具（2026-10-28 用户定案）。
 *
 * 背景：指标名可能上百字，直接做目录名会撞上文件系统硬约束：
 * ① macOS/Linux 单段文件名上限 255 字节（UTF-8 中文 3 字节/字）；
 * ② Windows 单段 255 字符，但全路径上限 260 字符，多层嵌套很容易爆；
 * ③ Windows 保留名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）无法创建；
 * ④ 尾部点/空格会被 Windows 静默去掉，导致目录名与 Excel 里写的不一致。
 *
 * 因此：目录名一律「序号 + 截断名」，截断按 UTF-8 字节而不是字符数，
 * 并且只在完整码点边界切，避免切出半个中文。
 */

/** 单个路径段的安全字节上限：远低于 255，给全路径留余量 */
export const MAX_SEGMENT_BYTES = 120

/** 指标目录名里的省略号（3 字节） */
const ELLIPSIS = '…'

/** Windows 保留设备名（大小写不敏感，带扩展名也算） */
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** 文件名/目录名非法字符（Windows 口径，覆盖 Linux/macOS） */
const ILLEGAL_PATH_CHARS = /[\\/:*?"<>|]/g

/** 去掉控制字符（避免 eslint no-control-regex，按码点过滤） */
function stripControlChars(value: string): string {
  let result = ''
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0
    if (codePoint >= 0x20 && codePoint !== 0x7f) {
      result += char
    }
  }
  return result
}

/** 计算 UTF-8 字节数（等价于 TextEncoder，但不依赖运行时全局） */
export function utf8ByteLength(text: string): number {
  let bytes = 0
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0
    if (codePoint <= 0x7f) {
      bytes += 1
    } else if (codePoint <= 0x7ff) {
      bytes += 2
    } else if (codePoint <= 0xffff) {
      bytes += 3
    } else {
      bytes += 4
    }
  }
  return bytes
}

/**
 * 按 UTF-8 字节安全截断，超出时追加省略号。
 * 按码点遍历，不会把代理对或中文切成半个字节。
 */
export function truncateByUtf8Bytes(
  text: string,
  maxBytes: number,
  ellipsis: string = ELLIPSIS
): string {
  if (maxBytes <= 0) {
    return ''
  }

  const value = String(text ?? '')
  if (utf8ByteLength(value) <= maxBytes) {
    return value
  }

  const ellipsisBytes = utf8ByteLength(ellipsis)
  // 预算连省略号都放不下时，退回不带省略号的硬截断
  if (ellipsisBytes >= maxBytes) {
    let plain = ''
    let plainBytes = 0
    for (const char of value) {
      const charBytes = utf8ByteLength(char)
      if (plainBytes + charBytes > maxBytes) {
        break
      }
      plain += char
      plainBytes += charBytes
    }
    return plain
  }

  const budget = maxBytes - ellipsisBytes
  let result = ''
  let used = 0
  for (const char of value) {
    const charBytes = utf8ByteLength(char)
    if (used + charBytes > budget) {
      break
    }
    result += char
    used += charBytes
  }
  return `${result}${ellipsis}`
}

/**
 * 把任意文本清洗成合法的单个路径段：
 * 去控制字符、替换非法字符、合并空白、去尾部点和空格、避开 Windows 保留名。
 */
export function sanitizePathSegment(value: unknown, maxBytes: number = MAX_SEGMENT_BYTES): string {
  let text = stripControlChars(String(value ?? ''))
    .replace(ILLEGAL_PATH_CHARS, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')

  if (!text) {
    return '未命名'
  }

  if (WINDOWS_RESERVED_NAME.test(text)) {
    text = `_${text}`
  }

  const truncated = truncateByUtf8Bytes(text, maxBytes).replace(/[. ]+$/g, '')
  return truncated || '未命名'
}

/** 指标目录名：`01_指标名前段…`（序号是稳定短主键，名称只作可读提示） */
export function buildIndicatorDirName(sequence: number, indicatorName: unknown): string {
  const prefix = `${String(sequence).padStart(2, '0')}_`
  const nameBudget = Math.max(1, MAX_SEGMENT_BYTES - utf8ByteLength(prefix))
  return `${prefix}${sanitizePathSegment(indicatorName, nameBudget)}`
}

/** 附件文件名：`R1_2026-09-30_原文件名.ext`（保留扩展名，只截断主名） */
export function buildAttachmentFileName(
  originalName: unknown,
  options: { round?: number; fillDate?: string } = {}
): string {
  const { round, fillDate } = options
  const rawName = String(originalName ?? '').trim() || '附件'

  // 拆扩展名：只认「点 + 1~12 位字母数字」的后缀，
  // 避免把「2026.10.28 汇报材料」这类含点的文件名误判成扩展名
  const extensionMatch = rawName.match(/(\.[A-Za-z0-9]{1,12})$/)
  const hasExtension = Boolean(extensionMatch) && rawName.length > (extensionMatch?.[1].length ?? 0)
  const baseName = hasExtension
    ? rawName.slice(0, rawName.length - (extensionMatch?.[1].length ?? 0))
    : rawName
  const extension = hasExtension ? (extensionMatch?.[1] ?? '') : ''

  const parts: string[] = []
  if (typeof round === 'number' && Number.isFinite(round) && round > 0) {
    parts.push(`R${round}`)
  }
  if (fillDate) {
    // 填报日期可能带时间（2026-09-30T10:00:00），冒号在 Windows 下非法，先清洗
    const safeDate = String(fillDate).replace(ILLEGAL_PATH_CHARS, '-').replace(/\s+/g, ' ').trim()
    if (safeDate) {
      parts.push(safeDate)
    }
  }

  const prefix = parts.length > 0 ? `${parts.join('_')}_` : ''
  const extensionBytes = utf8ByteLength(extension)
  const nameBudget = Math.max(1, MAX_SEGMENT_BYTES - utf8ByteLength(prefix) - extensionBytes)

  const safeBase = sanitizePathSegment(baseName, nameBudget)
  const safeExtension = extension.replace(ILLEGAL_PATH_CHARS, '').replace(/[. ]+$/g, '')

  return `${prefix}${safeBase}${safeExtension}`
}

/** 同名去重：`报告.pdf` → `报告_2.pdf`，与原有 zip 导出行为一致 */
export function ensureUniqueName(name: string, used: Set<string>): string {
  const safe = name || '未命名'
  if (!used.has(safe)) {
    used.add(safe)
    return safe
  }

  const dotIndex = safe.lastIndexOf('.')
  const base = dotIndex > 0 ? safe.slice(0, dotIndex) : safe
  const extension = dotIndex > 0 ? safe.slice(dotIndex) : ''

  let index = 2
  while (used.has(`${base}_${index}${extension}`)) {
    index += 1
  }

  const next = `${base}_${index}${extension}`
  used.add(next)
  return next
}
