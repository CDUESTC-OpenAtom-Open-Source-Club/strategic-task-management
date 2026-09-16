/**
 * 页面数据检查服务
 *
 * 用于系统性验证各页面数据是否正确从数据库获取
 *
 * Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 8.4
 */
import type { StrategicIndicator } from '@/shared/types'
import { useDataValidator } from '@/shared/lib/validation/dataValidator'

// ============================================================================
// 类型定义
// ============================================================================

export interface DataIssue {
  severity: 'error' | 'warning' | 'info'
  category: 'missing' | 'format' | 'empty' | 'inconsistent'
  field: string
  description: string
  currentValue: unknown
  expectedValue?: unknown
}

export interface PageCheckResult {
  pageName: string
  timestamp: Date
  dataSource: 'api' | 'fallback' | 'local' | 'unknown'
  issues: DataIssue[]
  suggestions: string[]
  isHealthy: boolean
}

export interface CheckReport {
  generatedAt: Date
  totalPages: number
  pagesChecked: number
  overallHealth: 'healthy' | 'warning' | 'critical'
  summary: {
    totalIssues: number
    errors: number
    warnings: number
    infos: number
  }
  pageResults: PageCheckResult[]
}

// ============================================================================
// PageDataChecker 类
// ============================================================================

export class PageDataChecker {
  private validator = useDataValidator({ logErrors: true })

  /**
   * 检查 Dashboard 页面数据
   */
  checkDashboardData(
    indicators: StrategicIndicator[],
    dataSource: 'api' | 'fallback' | 'local'
  ): PageCheckResult {
    const issues: DataIssue[] = []
    const suggestions: string[] = []

    // 检查数据来源
    if (dataSource === 'fallback') {
      issues.push({
        severity: 'warning',
        category: 'inconsistent',
        field: 'dataSource',
        description: '数据来源为降级数据，可能不是最新',
        currentValue: dataSource
      })
      suggestions.push('检查后端 API 是否正常运行')
    }

    // 检查指标数据是否为空
    if (indicators.length === 0) {
      issues.push({
        severity: 'warning',
        category: 'empty',
        field: 'indicators',
        description: '指标列表为空',
        currentValue: []
      })
    }

    // 验证每个指标
    indicators.forEach((indicator, index) => {
      const result = this.validator.validateIndicator(indicator)
      if (!result.isValid) {
        result.errors.forEach(err => {
          issues.push({
            severity: 'error',
            category: 'format',
            field: `indicators[${index}].${err.field}`,
            description: err.message,
            currentValue: err.value
          })
        })
      }
    })

    return {
      pageName: 'DashboardView',
      timestamp: new Date(),
      dataSource,
      issues,
      suggestions,
      isHealthy: issues.filter(i => i.severity === 'error').length === 0
    }
  }

  /**
   * 检查指标列表页面数据
   */
  checkIndicatorListData(
    indicators: StrategicIndicator[],
    dataSource: 'api' | 'fallback' | 'local'
  ): PageCheckResult {
    const issues: DataIssue[] = []
    const suggestions: string[] = []

    return {
      pageName: 'IndicatorListView',
      timestamp: new Date(),
      dataSource,
      issues,
      suggestions,
      isHealthy: issues.filter(i => i.severity === 'error').length === 0
    }
  }

  /**
   * 检查战略任务页面数据
   */
  checkPlanData(
    indicators: StrategicIndicator[],
    dataSource: 'api' | 'fallback' | 'local'
  ): PageCheckResult {
    const issues: DataIssue[] = []
    const suggestions: string[] = []

    // 检查战略指标
    const strategicIndicators = indicators.filter(i => i.isStrategic)
    if (strategicIndicators.length === 0) {
      issues.push({
        severity: 'info',
        category: 'empty',
        field: 'strategicIndicators',
        description: '没有战略指标数据',
        currentValue: []
      })
    }

    // 检查权重总和
    const deptWeights = new Map<string, number>()
    strategicIndicators.forEach(i => {
      const dept = i.responsibleDept
      if (!dept) {
        return
      } // Skip indicators without responsible department
      const current = deptWeights.get(dept) || 0
      deptWeights.set(dept, current + (i.weight || 0))
    })

    deptWeights.forEach((weight, dept) => {
      if (weight !== 100 && weight > 0) {
        issues.push({
          severity: 'warning',
          category: 'inconsistent',
          field: `departmentWeight.${dept}`,
          description: `部门 ${dept} 的权重总和为 ${weight}，不等于 100`,
          currentValue: weight,
          expectedValue: 100
        })
      }
    })

    return {
      pageName: 'PlanView',
      timestamp: new Date(),
      dataSource,
      issues,
      suggestions,
      isHealthy: issues.filter(i => i.severity === 'error').length === 0
    }
  }

  /**
   * 生成检查报告
   */
  generateReport(results: PageCheckResult[]): CheckReport {
    const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0)
    const errors = results.reduce(
      (sum, r) => sum + r.issues.filter(i => i.severity === 'error').length,
      0
    )
    const warnings = results.reduce(
      (sum, r) => sum + r.issues.filter(i => i.severity === 'warning').length,
      0
    )
    const infos = results.reduce(
      (sum, r) => sum + r.issues.filter(i => i.severity === 'info').length,
      0
    )

    let overallHealth: 'healthy' | 'warning' | 'critical' = 'healthy'
    if (errors > 0) {
      overallHealth = 'critical'
    } else if (warnings > 0) {
      overallHealth = 'warning'
    }

    return {
      generatedAt: new Date(),
      totalPages: results.length,
      pagesChecked: results.length,
      overallHealth,
      summary: { totalIssues, errors, warnings, infos },
      pageResults: results
    }
  }

  /**
   * 输出检查报告到控制台
   */
  printReport(report: CheckReport): void {
    if (import.meta.env.DEV) {
      /* eslint-disable no-console */
      console.group('📊 页面数据检查报告')
      console.log(`生成时间: ${report.generatedAt.toLocaleString()}`)
      console.log(`检查页面: ${report.pagesChecked}`)
      console.log(`整体健康: ${report.overallHealth}`)
      console.log(
        `问题统计: 错误=${report.summary.errors}, 警告=${report.summary.warnings}, 信息=${report.summary.infos}`
      )

      report.pageResults.forEach(result => {
        console.group(`📄 ${result.pageName}`)
        console.log(`数据来源: ${result.dataSource}`)
        console.log(`健康状态: ${result.isHealthy ? '✅' : '❌'}`)
        if (result.issues.length > 0) {
          console.table(result.issues)
        }
        console.groupEnd()
      })

      console.groupEnd()
      /* eslint-enable no-console */
    }
  }
}

// 导出单例
export const pageDataChecker = new PageDataChecker()
