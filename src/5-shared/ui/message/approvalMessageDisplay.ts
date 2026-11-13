import type { Message } from '@/shared/types'

type ApprovalMessageLike = Pick<
  Message,
  'content' | 'currentStepName' | 'detailContent' | 'entityType' | 'metadata' | 'senderDisplay'
>

const normalizeDisplayText = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''

const parseNestedMetadata = (message: ApprovalMessageLike): Record<string, unknown> => {
  const nestedMetadata = message.metadata?.metadataJson
  if (typeof nestedMetadata !== 'string' || !nestedMetadata.trim()) {
    return {}
  }

  try {
    const parsed = JSON.parse(nestedMetadata) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const getMetadataText = (message: ApprovalMessageLike, ...keys: string[]): string => {
  const nestedMetadata = parseNestedMetadata(message)
  for (const key of keys) {
    const directValue = normalizeDisplayText(message.metadata?.[key])
    if (directValue) {
      return directValue
    }

    const nestedValue = normalizeDisplayText(nestedMetadata[key])
    if (nestedValue) {
      return nestedValue
    }
  }

  return ''
}

const isGenericUserDisplay = (value: string): boolean => {
  const normalized = value.trim()
  return (
    /^用户(?:#?\d+)?$/i.test(normalized) ||
    /^user(?:#?\d+)?$/i.test(normalized) ||
    /^#?\d+$/.test(normalized)
  )
}

const sanitizeDepartmentName = (value: string): string => {
  const normalized = normalizeDisplayText(value)
  return normalized && !isGenericUserDisplay(normalized) ? normalized : ''
}

const extractCurrentStepFromContent = (message: ApprovalMessageLike): string => {
  const content = `${message.content || ''} ${message.detailContent || ''}`
  const match = content.match(/当前(?:待处理)?环节为[“"]([^”"]+)[”"]/)
  return sanitizeDepartmentName(match?.[1] || '')
}

export const getApprovalCurrentStepDisplay = (message: ApprovalMessageLike): string =>
  sanitizeDepartmentName(message.currentStepName || '') ||
  getMetadataText(message, 'currentStepName', 'stepName') ||
  extractCurrentStepFromContent(message)

export const getApprovalDepartmentDisplay = (message: ApprovalMessageLike): string => {
  const targetOrgName = sanitizeDepartmentName(
    getMetadataText(message, 'targetOrgName', 'approvalDepartmentName', 'departmentName')
  )
  const sourceOrgName = sanitizeDepartmentName(getMetadataText(message, 'sourceOrgName'))

  return targetOrgName || sourceOrgName
}

// 2026-11-12（D-3 统一口径）：后端 API 已按上报方向返回 source/target
// （source=提交方，target=审批方），上报链不再翻转为 target -> source——
// 此前按旧口径多翻一次导致审批消息流向显示反向。
// 上报/下发/异动统一直接 source -> target 展示。
export const getApprovalRouteDisplay = (message: ApprovalMessageLike): string => {
  const sourceOrgName = sanitizeDepartmentName(getMetadataText(message, 'sourceOrgName'))
  const targetOrgName = sanitizeDepartmentName(
    getMetadataText(message, 'targetOrgName', 'approvalDepartmentName', 'departmentName')
  )

  if (sourceOrgName && targetOrgName) {
    return `${sourceOrgName} -> ${targetOrgName}`
  }

  return sourceOrgName || targetOrgName
}
