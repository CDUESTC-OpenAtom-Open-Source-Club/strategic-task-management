import type { Indicator, StrategicTask } from '@/shared/types/entities'
import { mockIndicators } from './mockIndicators'
import { mockStrategicTasks } from './mockStrategicTasks'

/**
 * 仪表板数据生成器
 * 基于真实的业务数据计算统计信息
 */

export interface DashboardStats {
  overview: {
    totalIndicators: number
    completedIndicators: number
    inProgressIndicators: number
    pendingIndicators: number
    averageProgress: number
    totalTasks: number
    completedTasks: number
  }
  departmentProgress: Array<{
    name: string
    progress: number
    indicators: number
    completed: number
    inProgress: number
  }>
  recentActivities: Array<{
    id: string
    type: 'indicator_update' | 'task_complete' | 'approval_pending'
    title: string
    user: string
    department: string
    time: string
  }>
  trend: {
    labels: string[]
    data: number[]
  }
  distribution: Array<{
    name: string
    value: number
    color: string
  }>
}

function calculateDepartmentStats(indicators: Indicator[]): DashboardStats['departmentProgress'] {
  const deptMap = new Map<
    string,
    { total: number; completed: number; inProgress: number; progressSum: number }
  >()

  indicators.forEach(indicator => {
    const dept = indicator.responsibleDept
    if (!deptMap.has(dept)) {
      deptMap.set(dept, { total: 0, completed: 0, inProgress: 0, progressSum: 0 })
    }
    const stats = deptMap.get(dept)
    if (stats) {
      stats.total++
      stats.progressSum += indicator.progress

      if (indicator.progress >= 100) {
        stats.completed++
      } else if (indicator.progress > 0) {
        stats.inProgress++
      }
    }

    if (indicator.progress >= 100) {
      stats.completed++
    } else if (indicator.progress > 0) {
      stats.inProgress++
    }
  })

  return Array.from(deptMap.entries()).map(([name, stats]) => ({
    name,
    progress: Math.round((stats.progressSum / stats.total) * 10) / 10,
    indicators: stats.total,
    completed: stats.completed,
    inProgress: stats.inProgress
  }))
}

function generateRecentActivities(indicators: Indicator[]): DashboardStats['recentActivities'] {
  const activities: DashboardStats['recentActivities'] = []

  // 从指标审计日志生成活动
  indicators.forEach(indicator => {
    if (indicator.statusAudit && indicator.statusAudit.length > 0) {
      const latestAudit = indicator.statusAudit[indicator.statusAudit.length - 1]
      activities.push({
        id: `ACT-IND-${indicator.indicatorId}`,
        type: 'indicator_update',
        title: `更新了"${indicator.indicatorName}"指标`,
        user: latestAudit.operatorName || latestAudit.operator,
        department: latestAudit.operatorDept || indicator.responsibleDept,
        time: latestAudit.timestamp
      })
    }
  })

  // 待审批的指标
  indicators
    .filter(indicator => indicator.progressApprovalStatus === 'PENDING')
    .forEach(indicator => {
      activities.push({
        id: `ACT-APP-${indicator.indicatorId}`,
        type: 'approval_pending',
        title: `"${indicator.indicatorName}"待审批`,
        user: indicator.responsiblePerson || '未知',
        department: indicator.responsibleDept,
        time: indicator.updatedAt
      })
    })

  // 按时间排序，取最近的 10 条
  return activities
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 10)
}

function calculateOverview(
  indicators: Indicator[],
  tasks: StrategicTask[]
): DashboardStats['overview'] {
  const completedIndicators = indicators.filter(i => i.progress >= 100).length
  const inProgressIndicators = indicators.filter(i => i.progress > 0 && i.progress < 100).length
  const pendingIndicators = indicators.filter(i => i.progress === 0).length
  const totalProgress = indicators.reduce((sum, i) => sum + i.progress, 0)
  const averageProgress =
    indicators.length > 0 ? Math.round((totalProgress / indicators.length) * 10) / 10 : 0

  return {
    totalIndicators: indicators.length,
    completedIndicators,
    inProgressIndicators,
    pendingIndicators,
    averageProgress,
    totalTasks: tasks.length,
    completedTasks: 0 // 简化处理
  }
}

function generateDistribution(indicators: Indicator[]): DashboardStats['distribution'] {
  const typeMap = new Map<string, number>()

  indicators.forEach(indicator => {
    const type = indicator.indicatorType1 || '其他'
    typeMap.set(type, (typeMap.get(type) || 0) + 1)
  })

  const colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272']

  return Array.from(typeMap.entries()).map(([name, value], index) => ({
    name,
    value,
    color: colors[index % colors.length]
  }))
}

function generateTrend(): DashboardStats['trend'] {
  return {
    labels: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
    data: [15, 25, 35, 42, 48, 55, 62, 68, 72, 76, 78, 82]
  }
}

export function generateMockDashboardData(): DashboardData {
  const dashboardStats = {
    overview: calculateOverview(mockIndicators, mockStrategicTasks),
    departmentProgress: calculateDepartmentStats(mockIndicators),
    recentActivities: generateRecentActivities(mockIndicators),
    trend: generateTrend(),
    distribution: generateDistribution(mockIndicators)
  }

  return {
    totalScore: Math.round(dashboardStats.overview.averageProgress * 10) / 10,
    basicScore: Math.round(dashboardStats.overview.averageProgress * 0.6 * 10) / 10,
    developmentScore: Math.round(dashboardStats.overview.averageProgress * 0.4 * 10) / 10,
    completionRate:
      Math.round(
        (dashboardStats.overview.completedIndicators / dashboardStats.overview.totalIndicators) *
          100
      ) || 0,
    warningCount:
      dashboardStats.overview.inProgressIndicators + dashboardStats.overview.pendingIndicators,
    totalIndicators: dashboardStats.overview.totalIndicators,
    completedIndicators: dashboardStats.overview.completedIndicators,
    alertIndicators: {
      severe: Math.floor(Math.random() * 3), // 随机生成0-2个严重预警
      moderate: Math.floor(Math.random() * 5) + 1, // 随机生成1-5个中等级预警
      normal: 0
    }
  }
}

export const mockDashboardData = generateMockDashboardData()
