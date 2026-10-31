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

// 2026-10-30 用户拍板：审批流向与审批中心抽屉卡片标题同口径——后端 metadata 的
// source/target 存的是「下发方向」（下发方=source，见 ExecutionWorkflowBusinessContextAdapter），
// 上报链（PLAN_REPORT）真实流向相反，须翻转为 target -> source
// （同 DistributionApprovalProgressDrawer 月报卡「上报审批 · 接收方 -> 下发方」口径）；
// 下发/异动链维持 source -> target 不变。
export const getApprovalRouteDisplay = (message: ApprovalMessageLike): string => {
  const sourceOrgName = sanitizeDepartmentName(getMetadataText(message, 'sourceOrgName'))
  const targetOrgName = sanitizeDepartmentName(
    getMetadataText(message, 'targetOrgName', 'approvalDepartmentName', 'departmentName')
  )

  if (sourceOrgName && targetOrgName) {
    const isPlanReport =
      String(message.entityType || '')
        .trim()
        .toUpperCase() === 'PLAN_REPORT'
    return isPlanReport
      ? `${targetOrgName} -> ${sourceOrgName}`
      : `${sourceOrgName} -> ${targetOrgName}`
  }

  return sourceOrgName || targetOrgName
}
