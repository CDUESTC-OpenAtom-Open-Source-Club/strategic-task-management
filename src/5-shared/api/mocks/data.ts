/**
 * Mock 数据文件 - 与后端完全对齐
 * 用于在没有后端服务的情况下提供模拟数据
 */

import type { ApiResponse, PageResponse } from '@/shared/types/entities'
import { mockUsers, mockAssessmentCycles, mockStrategicTasks, mockIndicators } from './fixtures'
import { mockDashboardData } from './fixtures/mockDashboardData'

// ===========================================
// Mock 系统公告数据
// ===========================================

export const mockAnnouncements = [
  {
    id: '1',
    title: '2025年度战略指标填报工作已启动',
    content: '请各部门于12月15日前完成数据提交',
    type: 'info',
    publishTime: '2025-12-01 10:00:00',
    publisher: '战略发展部'
  },
  {
    id: '2',
    title: '系统维护通知',
    content: '系统维护时间：每周日 02:00-06:00',
    type: 'warning',
    publishTime: '2025-12-01 09:00:00',
    publisher: '信息化建设办公室'
  },
  {
    id: '3',
    title: '第三季度进度填报截止',
    content: '请各部门于10月31日前完成第三季度进度填报',
    type: 'warning',
    publishTime: '2025-10-25 16:00:00',
    publisher: '战略发展部'
  }
]

// ===========================================
// 导出所有 Mock 数据
// ===========================================

export { mockUsers }
export { mockAssessmentCycles }
export { mockStrategicTasks }
export { mockIndicators }
export { mockDashboardData }

// ===========================================
// Mock API 响应生成器 - 与后端完全对齐
// ===========================================

/**
 * 创建成功响应
 * @param data 响应数据
 * @param message 响应消息
 * @returns 标准 API 响应格式
 */
export function createMockResponse<T>(data: T, message = '操作成功'): ApiResponse<T> {
  return {
    code: 200,
    success: true,
    data,
    message,
    timestamp: Date.now()
  }
}

/**
 * 创建分页响应
 * @param data 完整数据列表
 * @param page 页码（1-based）
 * @param pageSize 每页大小
 * @param message 响应消息
 * @returns 分页响应格式
 */
export function createMockPageResponse<T>(
  data: T[],
  page = 1,
  pageSize = 10,
  message = '获取数据成功'
): ApiResponse<PageResponse<T>> {
  const total = data.length
  const start = (page - 1) * pageSize
  const end = start + pageSize

  return {
    code: 200,
    success: true,
    data: {
      content: data.slice(start, end),
      pageNumber: page,
      pageSize: pageSize,
      totalElements: total,
      totalPages: Math.ceil(total / pageSize),
      hasNext: page * pageSize < total,
      hasPrevious: page > 1
    },
    message,
    timestamp: Date.now()
  }
}

/**
 * 创建错误响应
 * @param code 错误代码
 * @param message 错误消息
 * @returns 错误响应格式
 */
export function createMockError(code: string, message: string): ApiResponse<null> {
  return {
    code: 500,
    success: false,
    data: null,
    message,
    timestamp: Date.now()
  }
}
