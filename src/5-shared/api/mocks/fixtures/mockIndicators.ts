/**
 * 统一的模拟指标数据 - 与后端实体类型对齐
 * 使用当前系统类型，基于 src/mock/fixtures/ 中的旧数据结构重新生成
 */
import type { Indicator, DashboardData, DepartmentProgress } from '@/shared/types/entities'
import {
  indicators2023,
  indicators2024,
  indicators2025,
  indicators2026,
  allIndicators,
  allHistoricalIndicators
} from './indicators'

// ============ 导出所有年份数据 ============

/**
 * 2026年指标数据（当前工作年份）
 */
export const mockIndicators2026: Indicator[] = indicators2026

/**
 * 默认指标数据（使用2026年数据）
 */
export const mockIndicators: Indicator[] = indicators2026

/**
 * 2025年指标数据（历史归档）
 */
export const mockIndicators2025: Indicator[] = indicators2025

/**
 * 所有模拟指标数据
 */
export const allMockIndicators: Indicator[] = allIndicators

/**
 * 所有历史指标数据（不含2026年）
 */
export const allHistoricalMockIndicators: Indicator[] = allHistoricalIndicators

/**
 * 按年份获取指标
 */
export function getMockIndicatorsByYear(year: number): Indicator[] {
  switch (year) {
    case 2023:
      return indicators2023
    case 2024:
      return indicators2024
    case 2025:
      return indicators2025
    case 2026:
      return indicators2026
    default:
      return []
  }
}

/**
 * 获取当前年份指标（2026）
 */
export function getCurrentYearMockIndicators(): Indicator[] {
  return mockIndicators2026
}

/**
 * 获取指定年份和ID的指标
 */
export function getMockIndicatorById(
  id: number | string,
  year: number = 2026
): Indicator | undefined {
  const indicators = getMockIndicatorsByYear(year)
  return indicators.find(ind =>
    typeof id === 'number' ? ind.indicatorId === id : ind.indicatorId === parseInt(id)
  )
}

// ============ 模拟仪表盘数据 ============

export const mockDashboardData: DashboardData = {
  // P4 A2：取消分数字段,改为等级分布
  levelDistribution: {
    ahead: allMockIndicators.filter(i => i.progress >= 100).length,
    normal: allMockIndicators.filter(i => i.progress >= 50 && i.progress < 100).length,
    delayed: allMockIndicators.filter(i => i.progress < 50).length
  },
  completionRate: 75.2,
  warningCount: 3,
  totalIndicators: allMockIndicators.length,
  completedIndicators: allMockIndicators.filter(i => i.progress >= 100).length,
  alertIndicators: {
    severe: 1,
    moderate: 2,
    normal: allMockIndicators.length - 3
  }
}

// ============ 模拟部门进度数据 ============

export const mockDepartmentProgress: DepartmentProgress[] = [
  {
    dept: '教务处',
    progress: 85,
    score: 89.5,
    status: 'success',
    totalIndicators: 5,
    completedIndicators: 4,
    alertCount: 0
  },
  {
    dept: '科技处',
    progress: 72,
    score: 78.3,
    status: 'warning',
    totalIndicators: 4,
    completedIndicators: 2,
    alertCount: 1
  },
  {
    dept: '就业创业指导中心',
    progress: 65,
    score: 71.2,
    status: 'warning',
    totalIndicators: 6,
    completedIndicators: 3,
    alertCount: 1
  },
  {
    dept: '人力资源部',
    progress: 90,
    score: 94.1,
    status: 'success',
    totalIndicators: 3,
    completedIndicators: 3,
    alertCount: 0
  },
  {
    dept: '计算机学院',
    progress: 55,
    score: 62.8,
    status: 'exception',
    totalIndicators: 8,
    completedIndicators: 3,
    alertCount: 2
  },
  {
    dept: '商学院',
    progress: 68,
    score: 72.5,
    status: 'warning',
    totalIndicators: 6,
    completedIndicators: 3,
    alertCount: 1
  },
  {
    dept: '工学院',
    progress: 75,
    score: 80.2,
    status: 'success',
    totalIndicators: 5,
    completedIndicators: 4,
    alertCount: 0
  }
]

// ============ 模拟组织树数据 ============

export const mockOrgTree = {
  id: 'root',
  name: '学校',
  children: [
    {
      id: 'strategic',
      name: '战略发展部',
      type: 'strategic_dept'
    },
    {
      id: 'functional',
      name: '职能部门',
      children: [
        { id: 'jiaowu', name: '教务处', type: 'functional_dept' },
        { id: 'keji', name: '科技处', type: 'functional_dept' },
        { id: 'jiuye', name: '就业创业指导中心', type: 'functional_dept' },
        { id: 'renli', name: '人力资源部', type: 'functional_dept' },
        { id: 'caiwu', name: '财务部', type: 'functional_dept' }
      ]
    },
    {
      id: 'colleges',
      name: '二级学院',
      children: [
        { id: 'jisuanji', name: '计算机学院', type: 'secondary_college' },
        { id: 'shangxue', name: '商学院', type: 'secondary_college' },
        { id: 'gongxue', name: '工学院', type: 'secondary_college' },
        { id: 'wenli', name: '文理学院', type: 'secondary_college' },
        { id: 'yishu', name: '艺术与科技学院', type: 'secondary_college' },
        { id: 'hangkong', name: '航空学院', type: 'secondary_college' },
        { id: 'guoji', name: '国际教育学院', type: 'secondary_college' },
        { id: 'makesi', name: '马克思主义学院', type: 'secondary_college' }
      ]
    }
  ]
}
