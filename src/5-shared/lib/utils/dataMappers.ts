/**
 * 数据映射工具
 * 用于前端数据结构和后端API之间的转换
 */

import type { StrategicIndicator } from '@/shared/types'

type BackendSyncField = keyof StrategicIndicator

const BACKEND_FIELDS: readonly BackendSyncField[] = [
  'name',
  'type1',
  'type2',
  'weight',
  'responsibleDept',
  'ownerDept',
  'taskId',
  'taskContent',
  'description',
  'progress',
  'status',
  'year',
  'statusAudit',
  'progressApprovalStatus',
  'pendingProgress',
  'pendingRemark',
  'pendingAttachments'
]

const DIRECT_FIELDS: readonly BackendSyncField[] = [
  'name',
  'type1',
  'type2',
  'weight',
  'responsibleDept',
  'ownerDept',
  'taskId',
  'taskContent',
  'description',
  'progress',
  'status',
  'year',
  'canWithdraw',
  'progressApprovalStatus',
  'pendingProgress',
  'pendingRemark',
  'pendingAttachments'
]

function parseOptionalNumericId(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isNaN(value) ? null : value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    return Number.isNaN(parsed) ? null : parsed
  }

  return null
}

/**
 * 检查更新对象中是否包含需要同步到后端的字段
 */
export function hasBackendUpdates(updates: Partial<StrategicIndicator>): boolean {
  return Object.keys(updates).some(key => BACKEND_FIELDS.includes(key as BackendSyncField))
}

/**
 * 将前端更新对象转换为后端API请求格式
 */
export function convertToUpdateRequest(
  updates: Partial<StrategicIndicator>
): Record<string, unknown> {
  const request: Record<string, unknown> = {}

  DIRECT_FIELDS.forEach(field => {
    if (field in updates) {
      request[field] = updates[field]
    }
  })

  if ('statusAudit' in updates && updates.statusAudit) {
    request.statusAudit = JSON.stringify(updates.statusAudit)
  }

  return request
}
