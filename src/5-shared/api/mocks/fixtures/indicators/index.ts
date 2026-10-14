/**
 * 指标数据统一导出
 * 按年份分文件管理，便于维护和读取
 */

// 导出各年份数据
export { indicators2023 } from './indicators2023'
export { indicators2024 } from './indicators2024'
export { indicators2025 } from './indicators2025'
export { indicators2026 } from './indicators2026'

// 导出工具函数

// 导入用于合并
import { indicators2023 } from './indicators2023'
import { indicators2024 } from './indicators2024'
import { indicators2025 } from './indicators2025'
import { indicators2026 } from './indicators2026'

// 合并所有历史数据（不含当前工作年份2026）
export const allHistoricalIndicators = [...indicators2023, ...indicators2024, ...indicators2025]

// 合并所有数据
export const allIndicators = [
  ...indicators2023,
  ...indicators2024,
  ...indicators2025,
  ...indicators2026
]
