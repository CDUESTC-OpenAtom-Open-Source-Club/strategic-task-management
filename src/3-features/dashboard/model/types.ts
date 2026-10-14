/**
 * Dashboard Feature - Types
 *
 * Type definitions for dashboard feature.
 */

import type {
  DashboardData,
  DepartmentProgress,
  DrillDownLevel,
  BreadcrumbItem,
  FilterState,
  AlertSummary,
  StrategicIndicator,
  ComparisonItem,
  SankeyData,
  SourcePieData
} from '@/shared/types'

// Re-export common types
export type {
  DashboardData,
  DepartmentProgress,
  DrillDownLevel,
  BreadcrumbItem,
  FilterState,
  AlertSummary,
  StrategicIndicator,
  ComparisonItem,
  SankeyData,
  SourcePieData
}

/**
 * Dashboard feature-specific types
 */

/**
 * Dashboard loading states
 */
export interface DashboardLoadingState {
  dashboard: boolean
  departments: boolean
  activities: boolean
  alerts: boolean
}

/**
 * Dashboard errors
 */
export interface DashboardErrors {
  dashboard: string | null
  departments: string | null
  activities: string | null
  alerts: string | null
}

/**
 * Organization level for drill-down
 */
export type OrgLevel = 'strategy' | 'functional' | 'college'

/**
 * Dashboard view state
 */
export interface DashboardViewState {
  currentLevel: DrillDownLevel
  currentOrgLevel: OrgLevel
  breadcrumbs: BreadcrumbItem[]
  selectedDepartment?: string
  selectedIndicator?: string
  selectedFunctionalDept?: string
  selectedCollege?: string
}

/**
 * Dashboard statistics
 */
export interface DashboardStatistics {
  completionRate: number
  // P4 A2: 删 totalScore(数据源 levelDistribution 已替代)
  warningCount: number
  alertStats: AlertSummary
  totalIndicators: number
  completedIndicators: number
}

/**
 * Dashboard data state
 */
export interface DashboardDataState {
  overview: DashboardData | null
  departments: DepartmentProgress[]
  activities: Array<Record<string, unknown>>
  alerts: AlertSummary | null
  unclosedAlerts: Array<any>
}
