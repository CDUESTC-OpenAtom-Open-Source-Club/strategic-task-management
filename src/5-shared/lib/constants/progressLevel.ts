/**
 * 审核进度的统一视觉口径（2026-10-28 用户定案）。
 *
 * 此前 AHEAD 与 NORMAL 都用 el-tag success（同一个绿色），无法区分；
 * 现在：正常 = 标准绿，超前 = 更深的绿，延期 = 橙，未评定 = 灰。
 */
export type ProgressLevel = 'AHEAD' | 'NORMAL' | 'DELAYED'

export interface ProgressLevelMeta {
  label: string
  color: string
  background: string
  border: string
  tagType: 'success' | 'info' | 'warning' | 'danger'
}

export const PROGRESS_LEVEL_META: Record<ProgressLevel, ProgressLevelMeta> = {
  AHEAD: {
    label: '超前完成',
    color: '#1A7F37',
    background: 'rgba(26, 127, 55, 0.12)',
    border: 'rgba(26, 127, 55, 0.35)',
    tagType: 'success'
  },
  NORMAL: {
    label: '正常',
    color: '#67C23A',
    background: 'rgba(103, 194, 58, 0.12)',
    border: 'rgba(103, 194, 58, 0.35)',
    tagType: 'success'
  },
  DELAYED: {
    label: '延期',
    color: '#E6A23C',
    background: 'rgba(230, 162, 60, 0.12)',
    border: 'rgba(230, 162, 60, 0.35)',
    tagType: 'warning'
  }
}

export const UNAPPRAISED_META: ProgressLevelMeta = {
  label: '未评定',
  color: '#909399',
  background: 'rgba(144, 147, 153, 0.12)',
  border: 'rgba(144, 147, 153, 0.35)',
  tagType: 'info'
}

export function normalizeProgressLevel(level?: string | null): ProgressLevel | null {
  const normalized = String(level ?? '')
    .trim()
    .toUpperCase()
  return normalized === 'AHEAD' || normalized === 'NORMAL' || normalized === 'DELAYED'
    ? normalized
    : null
}

export function getProgressLevelMeta(level?: string | null): ProgressLevelMeta {
  const normalized = normalizeProgressLevel(level)
  return normalized ? PROGRESS_LEVEL_META[normalized] : UNAPPRAISED_META
}

/** el-tag 自定义色（内联 CSS 变量，覆盖 success 的默认绿） */
export function getProgressLevelTagStyle(
  level?: string | null
): Record<string, string> | undefined {
  const normalized = normalizeProgressLevel(level)
  if (!normalized) {
    return undefined
  }
  const meta = PROGRESS_LEVEL_META[normalized]
  return {
    '--el-tag-bg-color': meta.background,
    '--el-tag-border-color': meta.border,
    '--el-tag-text-color': meta.color
  }
}
