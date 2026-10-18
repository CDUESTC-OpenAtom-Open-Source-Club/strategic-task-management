/**
 * 指标生命周期状态（仅此三种，与进度审批状态完全独立）
 */
export type IndicatorLifecycleStatus = 'DRAFT' | 'PENDING_REVIEW' | 'DISTRIBUTED'

/**
 * 生命周期状态文本映射
 */
export const LIFECYCLE_STATUS_TEXT_MAP: Record<IndicatorLifecycleStatus, string> = {
  DRAFT: '草稿',
  PENDING_REVIEW: '待审核',
  DISTRIBUTED: '已下发'
}

/**
 * 生命周期状态类型映射（Element Plus Tag 类型）
 */
export const LIFECYCLE_STATUS_TYPE_MAP: Record<
  IndicatorLifecycleStatus,
  'info' | 'warning' | 'success'
> = {
  DRAFT: 'info',
  PENDING_REVIEW: 'warning',
  DISTRIBUTED: 'success'
}

/**
 * 生命周期状态图标映射
 */
export const LIFECYCLE_STATUS_ICON_MAP: Record<IndicatorLifecycleStatus, string> = {
  DRAFT: '📝',
  PENDING_REVIEW: '⏳',
  DISTRIBUTED: '✅'
}

/**
 * 进度审批状态（独立系统）
 */
export type ProgressApprovalStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED'

/**
 * 进度审批状态文本映射
 */
export const APPROVAL_STATUS_TEXT_MAP: Record<ProgressApprovalStatus, string> = {
  NONE: '无',
  PENDING: '审批中',
  APPROVED: '已批准',
  REJECTED: '已回退'
}

/**
 * 获取指标生命周期状态（仅返回生命周期状态，不考虑审批状态）
 *
 * 兼容性说明：
 * - PENDING（遗留状态）映射为 PENDING_REVIEW
 * - ACTIVE（遗留状态）映射为 DISTRIBUTED
 * - ARCHIVED（遗留状态）映射为 DRAFT
 */
export function getIndicatorStatus(indicator: { status?: string }): IndicatorLifecycleStatus {
  const status = indicator.status?.toUpperCase()
  if (status === 'PENDING_REVIEW' || status === 'PENDING') {
    return 'PENDING_REVIEW'
  }
  if (status === 'DISTRIBUTED' || status === 'ACTIVE') {
    return 'DISTRIBUTED'
  }
  if (status === 'ARCHIVED') {
    return 'DRAFT'
  }
  return 'DRAFT'
}

/**
 * 获取生命周期状态显示文本
 */
export function getStatusText(status?: IndicatorLifecycleStatus): string {
  if (!status) {
    return '未知'
  }
  return LIFECYCLE_STATUS_TEXT_MAP[status] || status
}

/**
 * 获取生命周期状态类型（用于 el-tag）
 */
export function getStatusType(status?: IndicatorLifecycleStatus): 'info' | 'warning' | 'success' {
  if (!status) {
    return 'info'
  }
  return LIFECYCLE_STATUS_TYPE_MAP[status] || 'info'
}

/**
 * 获取生命周期状态图标
 */
export function getStatusIcon(status?: IndicatorLifecycleStatus): string {
  if (!status) {
    return ''
  }
  return LIFECYCLE_STATUS_ICON_MAP[status] || ''
}

/**
 * 获取完整的生命周期状态显示文本（包含图标）
 */
export function getFullStatusText(status?: IndicatorLifecycleStatus): string {
  if (!status) {
    return '未知'
  }
  return `${getStatusIcon(status)} ${getStatusText(status)}`
}

/**
 * 获取进度审批徽章信息（用于徽章显示）
 */
export function getApprovalBadgeInfo(indicator: { progressApprovalStatus?: string }): {
  show: boolean
  count: number
  status: ProgressApprovalStatus
} {
  const approvalStatus = indicator.progressApprovalStatus?.toUpperCase()
  if (approvalStatus === 'PENDING') {
    return { show: true, count: 1, status: 'PENDING' }
  }
  return { show: false, count: 0, status: 'NONE' }
}
