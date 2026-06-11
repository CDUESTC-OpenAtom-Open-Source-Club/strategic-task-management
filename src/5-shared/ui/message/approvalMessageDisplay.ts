import type { Message } from '@/shared/types'

type ApprovalMessageLike = Pick<
  Message,
  'content' | 'currentStepName' | 'detailContent' | 'metadata' | 'senderDisplay'
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
