/**
 * Indicator Field Mapper - 指标字段映射器
 *
 * 职责:
 * - 定义前端与后端字段映射关系
 * - 提供字段转换工具函数
 * - 支持双向映射（前端 <-> 后端）
 *
 * @module utils/dataMappers
 */

import type { StrategicIndicator } from '@/shared/types'

/**
 * 前端字段名 -> 后端字段名 映射
 */
const FRONTEND_TO_BACKEND: Record<string, string> = {
  // 可撤回状态
  canWithdraw: 'canWithdraw',
  // 指标描述/名称
  name: 'indicatorDesc',
  indicatorDesc: 'indicatorDesc',
  // 权重
  weight: 'weightPercent',
  // 排序
  sortOrder: 'sortOrder',
  // 备注
  remark: 'remark',
  // 任务内容
  taskContent: 'taskContent',
  // 父指标ID
  parentIndicatorId: 'parentIndicatorId',
  // 层级
  level: 'level',
  // 所属部门ID
  ownerOrgId: 'ownerOrgId',
  // 目标部门ID
  targetOrgId: 'targetOrgId',
  // 年份
  year: 'year',
  // 状态
  status: 'status',
  // 进度
  progress: 'progress',
  // 填报进度（后端返回 reportProgress）
  reportProgress: 'reportProgress',
  // 当前月份是否有填报数据
  hasCurrentMonthFill: 'hasCurrentMonthFill',
  // 进度审批状态
  progressApprovalStatus: 'progressApprovalStatus',
  // 待审批进度
  pendingProgress: 'pendingProgress',
  // 待审批备注
  pendingRemark: 'pendingRemark',
  // 待审批附件
  pendingAttachments: 'pendingAttachments',
  // 目标值
  targetValue: 'targetValue',
  // 实际值
  actualValue: 'actualValue',
  // 单位
  unit: 'unit',
  // 负责人
  responsiblePerson: 'responsiblePerson',
  // 审计日志（同步到后端持久化）
  statusAudit: 'statusAudit'
}

/**
 * 后端字段名 -> 前端字段名 映射
 */
const BACKEND_TO_FRONTEND: Record<string, string> = {
  indicatorDesc: 'name',
  weightPercent: 'weight',
  // 其他字段保持一致
  canWithdraw: 'canWithdraw',
  sortOrder: 'sortOrder',
  remark: 'remark',
  taskContent: 'taskContent',
  parentIndicatorId: 'parentIndicatorId',
  level: 'level',
  ownerOrgId: 'ownerOrgId',
  targetOrgId: 'targetOrgId',
  year: 'year',
  status: 'status',
  progress: 'progress',
  reportProgress: 'pendingProgress',
  hasCurrentMonthFill: 'hasCurrentMonthFill',
  progressApprovalStatus: 'progressApprovalStatus',
  pendingProgress: 'pendingProgress',
  pendingRemark: 'pendingRemark',
  pendingAttachments: 'pendingAttachments',
  targetValue: 'targetValue',
  actualValue: 'actualValue',
  unit: 'unit',
  responsiblePerson: 'responsiblePerson',
  statusAudit: 'statusAudit'
}

/**
 * 需要同步到后端的字段列表（前端字段名）
 */
const BACKEND_FIELDS = [
  'canWithdraw',
  'name',
  'indicatorDesc',
  'weight',
  'weightPercent',
  'sortOrder',
  'remark',
  'parentIndicatorId',
  'level',
  'ownerOrgId',
  'targetOrgId',
  'year',
  'status',
  'progress',
  'progressApprovalStatus',
  'pendingProgress',
  'pendingRemark',
  'pendingAttachments',
  'targetValue',
  'actualValue',
  'unit',
  'responsiblePerson',
  'taskContent',
  'statusAudit'
]

/**
 * 将前端更新数据转换为后端格式
 */
export function convertToUpdateRequest(
  updates: Partial<StrategicIndicator>
): Record<string, unknown> {
  const request: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(updates)) {
    // 跳过 undefined，但允许 null（用于清空字段）
    if (value === undefined) {
      continue
    }

    const backendKey = FRONTEND_TO_BACKEND[key]

    if (backendKey) {
      // statusAudit 需要序列化为 JSON 字符串
      if (key === 'statusAudit' && Array.isArray(value)) {
        request[backendKey] = JSON.stringify(value)
      } else {
        request[backendKey] = value
      }
    }
  }

  return request
}

/**
 * 检查更新是否包含需要同步到后端的字段
 */
export function hasBackendUpdates(updates: Partial<StrategicIndicator>): boolean {
  return Object.keys(updates).some(key => BACKEND_FIELDS.includes(key))
}

/**
 * 将后端数据转换为前端格式
 */
export function convertFromBackend(data: Record<string, unknown>): Partial<StrategicIndicator> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data)) {
    const frontendKey = BACKEND_TO_FRONTEND[key] || key
    result[frontendKey] = value
  }

  return result as Partial<StrategicIndicator>
}

/**
 * 获取指定后端字段对应的前端字段名
 */
export function getFrontendFieldName(backendField: string): string {
  return BACKEND_TO_FRONTEND[backendField] || backendField
}

/**
 * 获取指定前端字段对应的后端字段名
 */
export function getBackendFieldName(frontendField: string): string {
  return FRONTEND_TO_BACKEND[frontendField] || frontendField
}
