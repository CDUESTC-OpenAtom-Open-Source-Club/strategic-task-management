/**
 * 历史年份指标数据 - 兼容性导出
 *
 * ⚠️ 已废弃：现在所有数据都从后端真实数据库获取
 * 数据库：PostgreSQL @ 175.24.139.148:8386/strategic
 *
 * @deprecated 此文件已废弃，请使用后端API获取真实数据
 * @see src/api/fallback.ts 降级机制已禁用
 */

// 从原位置重新导出（保持向后兼容）
export {
  indicators2023,
  indicators2024,
  indicators2025,
  indicators2026,
  allHistoricalIndicators,
  allIndicators
} from './indicators'

// 从新的统一模拟数据文件导出
export {
  allMockIndicators,
  mockIndicators2026,
  mockIndicators2025,
  mockDashboardData,
  mockDepartmentProgress,
  mockOrgTree,
  getMockIndicatorsByYear,
  getCurrentYearMockIndicators
} from './mockIndicators'
