/**
 * Dashboard Feature - Helper Functions
 *
 * Internal helper functions for dashboard feature.
 */

import type { ComparisonItem, SankeyData, SankeyLink, StrategicIndicator } from '@/shared/types'
import { getProgressStatus } from '@/shared/lib/utils/colors'
import { ALERT_THRESHOLDS, COLLEGE_SUFFIXES } from '../model/constants'
import {
  resolveTaskSourceDept,
  type ParentIndicatorCore
} from '@/features/indicator/model/parentIndicatorCore'

/**
 * Get alert level based on progress
 */
export function getAlertLevel(progress: number): 'severe' | 'moderate' | 'normal' {
  if (progress < ALERT_THRESHOLDS.SEVERE) {
    return 'severe'
  }
  if (progress < ALERT_THRESHOLDS.MODERATE) {
    return 'moderate'
  }
  return 'normal'
}

/**
 * Check if department name is a secondary college
 */
export function isSecondaryCollege(deptName?: string): boolean {
  if (!deptName) {
    return false
  }
  return COLLEGE_SUFFIXES.some(suffix => deptName.endsWith(suffix))
}

/**
 * Get indicator progress at specific date
 */
export function getIndicatorProgressAtDate(
  indicator: StrategicIndicator,
  targetDate: Date
): number {
  // If no audit records, return current progress
  if (!indicator.statusAudit || indicator.statusAudit.length === 0) {
    return indicator.progress
  }

  // Find the most recent audit record before target date
  const targetTime = targetDate.getTime()
  let latestProgress = 0 // Default to 0

  // Sort audit records by time
  const sortedAudits = [...indicator.statusAudit].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )

  // Find the last progress update before target time
  for (const audit of sortedAudits) {
    const auditTime = new Date(audit.timestamp).getTime()
    if (auditTime <= targetTime) {
      // If approval passed, use newProgress
      if (audit.action === 'approve' && audit.newProgress !== undefined) {
        latestProgress = audit.newProgress
      }
    } else {
      break // Already passed target time, stop searching
    }
  }

  return latestProgress
}

/**
 * Aggregate indicators by department
 */
export function aggregateByDepartment(
  indicators: StrategicIndicator[],
  groupField: keyof StrategicIndicator = 'responsibleDept'
): ComparisonItem[] {
  const deptMap = new Map<
    string,
    {
      totalProgress: number
      totalWeight: number
      count: number
      completed: number
      alerts: number
    }
  >()

  indicators.forEach(indicator => {
    const deptName = indicator[groupField] as string
    if (!deptName) {
      return
    } // Skip indicators without department

    if (!deptMap.has(deptName)) {
      deptMap.set(deptName, {
        totalProgress: 0,
        totalWeight: 0,
        count: 0,
        completed: 0,
        alerts: 0
      })
    }

    const data = deptMap.get(deptName)
    if (!data) {
      return
    }
    data.totalProgress += indicator.progress * indicator.weight
    data.totalWeight += indicator.weight
    data.count += 1
    if (indicator.progress >= 100) {
      data.completed += 1
    }
    if (indicator.progress < 60) {
      data.alerts += 1
    }
  })

  const result: ComparisonItem[] = []
  deptMap.forEach((data, deptName) => {
    const avgProgress = data.totalWeight > 0 ? Math.round(data.totalProgress / data.totalWeight) : 0
    const completionRate = data.count > 0 ? Math.round((data.completed / data.count) * 100) : 0

    result.push({
      dept: deptName,
      progress: avgProgress,
      score: Math.round(avgProgress * 1.2),
      completionRate,
      totalIndicators: data.count,
      completedIndicators: data.completed,
      alertCount: data.alerts,
      status: getProgressStatus(avgProgress),
      rank: 0 // To be filled after sorting
    })
  })

  // Sort by progress and add ranking
  result.sort((a, b) => b.progress - a.progress)
  result.forEach((item, index) => {
    item.rank = index + 1
  })

  return result
}

/**
 * Calculate alert distribution
 */
export function calculateAlertDistribution(indicators: StrategicIndicator[]) {
  const severe = indicators.filter(i => i.progress < 30).length
  const moderate = indicators.filter(i => i.progress >= 30 && i.progress < 60).length
  const normal = indicators.filter(i => i.progress >= 60).length

  return {
    severe,
    moderate,
    normal,
    total: indicators.length
  }
}

/**
 * 总部（战略发展部）的组织 ID。
 *
 * 流转图的层级按组织 id / 组织类型判定，不按名称字符串：系统里另有一个职能部门
 * 「战略发展·部」（org 66），名字只差一个中点，必须落在中间列。
 */
export const STRATEGIC_DEPT_ORG_ID = '35'

/** 流转图层级判定用的组织记录（与组织 store 的 departments 同构） */
export interface SankeyOrganization {
  id: string
  name: string
  type: 'strategic_dept' | 'functional_dept' | 'secondary_college'
}

/** generateSankeyData 的上下文 */
export interface GenerateSankeyOptions {
  /** 组织清单（取组织 store 的 departments） */
  organizations: readonly SankeyOrganization[]
  /** 父级核心指标归口缓存，与 resolveTaskSourceDept 同口径 */
  parentIndicatorMap: Record<string, ParentIndicatorCore | undefined>
  /** 视角：strategic_dept = 全校图；functional_dept = 只画本部门 */
  role: 'strategic_dept' | 'functional_dept'
  /** 职能部门视角的本部门名称 */
  department?: string
}

/**
 * 按组织记录判定流转图层级：战略发展部（org 35）= 0，职能部门 = 1，二级学院 = 2。
 * 组织清单里查不到的名称返回 null（不进图）。
 */
function resolveSankeyDepth(org: SankeyOrganization | undefined): 0 | 1 | 2 | null {
  if (!org) {
    return null
  }
  if (org.id === STRATEGIC_DEPT_ORG_ID || org.type === 'strategic_dept') {
    return 0
  }
  if (org.type === 'secondary_college') {
    return 2
  }
  if (org.type === 'functional_dept') {
    return 1
  }
  return null
}

/**
 * 生成任务流转图（桑基图）数据：战略发展部 → 职能部门 → 二级学院。
 *
 * 2026-11-27（流转图归属修复）：流转关系按业务口径是「战略发展部 → 职能部门 → 学院」——
 * 战略发展部不直接向学院下发，学院线指标由它代发，源头是归口职能部门。
 * 旧实现拿 ownerDept 当起点，而学院线指标的 ownerDept 恒为代发方「战略发展部」，
 * 于是画成了「战略发展部 → 学院」直连，职能部门与学院之间没有连线。
 *
 * 现行规则（每条指标按责任单位的组织类型归位）：
 * - 责任单位是职能部门：该部门自身指标，边 = 战略发展部 → 该职能部门
 * - 责任单位是二级学院：学院线指标，归口部门 = resolveTaskSourceDept（父级核心指标的
 *   targetOrg，与「任务来源分布」饼图同键），边 = 战略发展部 → 归口职能部门、
 *   归口职能部门 → 该学院。所以「战略发展部 → 职能部门」每条边的 value 是该部门
 *   自身指标数 + 它归口下发给学院的指标数，中间列节点进出可以不相等。
 * - 归口没解析出来（父指标缺失，回退成 ownerDept「战略发展部」）的学院线指标不画：
 *   绝不连成「战略发展部 → 学院」。出现这种指标说明父指标归口水合没拿到数据，要查原因。
 *
 * 节点层级按组织 id / 类型判定（见 resolveSankeyDepth），不按名称猜：名称像学院的
 * 职能部门（如「国际教育学院」）落在中间列，「战略发展·部」不会被当成总部。
 *
 * @param indicators 进图的指标
 * @param options 组织清单、归口缓存、视角
 */
export function generateSankeyData(
  indicators: StrategicIndicator[],
  options: GenerateSankeyOptions
): SankeyData {
  const { organizations, parentIndicatorMap, role, department } = options
  const orgByName = new Map<string, SankeyOrganization>()
  organizations.forEach(org => {
    if (!orgByName.has(org.name)) {
      orgByName.set(org.name, org)
    }
  })
  const depthOf = (name: string): 0 | 1 | 2 | null => resolveSankeyDepth(orgByName.get(name))

  const headquarters = organizations.find(org => resolveSankeyDepth(org) === 0)
  // 组织清单没就绪（或没有总部记录）时层级无从判定，宁可不画也不按名称猜
  if (!headquarters || (role === 'functional_dept' && !department)) {
    return { nodes: [], links: [] }
  }

  const linkMap = new Map<string, SankeyLink>()
  const addLink = (source: string, target: string) => {
    const key = `${source}->${target}`
    const link = linkMap.get(key)
    if (link) {
      link.value += 1
    } else {
      linkMap.set(key, { source, target, value: 1 })
    }
  }
  // 职能部门视角只画与本部门有关的部分
  const isOwnDept = (dept: string): boolean => role !== 'functional_dept' || dept === department

  indicators.forEach(indicator => {
    const target = indicator.responsibleDept
    const targetDepth = target ? depthOf(target) : null
    // 没有责任单位、责任单位是总部自身、或组织清单里查不到：没有可画的流转
    if (!target || targetDepth === null || targetDepth === 0) {
      return
    }

    if (targetDepth === 1) {
      // 职能部门自身指标：战略发展部 → 该职能部门
      if (isOwnDept(target)) {
        addLink(headquarters.name, target)
      }
      return
    }

    // 学院线指标：归口职能部门 → 该学院；代发方战略发展部只作为归口线的上游
    const owner = resolveTaskSourceDept(indicator, parentIndicatorMap)
    if (depthOf(owner) !== 1 || !isOwnDept(owner)) {
      return
    }
    addLink(headquarters.name, owner)
    addLink(owner, target)
  })

  // 只保留在链接中出现的节点，顺序沿用组织清单
  const usedNodes = new Set<string>()
  linkMap.forEach(link => {
    usedNodes.add(link.source)
    usedNodes.add(link.target)
  })

  const nodeList = Array.from(orgByName.values())
    .filter(org => usedNodes.has(org.name))
    .map(org => ({ name: org.name, depth: resolveSankeyDepth(org) ?? 1 }))

  const nodeOrder = new Map(nodeList.map((node, index) => [node.name, index]))
  const links = Array.from(linkMap.values()).sort(
    (a, b) =>
      (nodeOrder.get(a.source) ?? 0) - (nodeOrder.get(b.source) ?? 0) ||
      (nodeOrder.get(a.target) ?? 0) - (nodeOrder.get(b.target) ?? 0)
  )

  return {
    nodes: nodeList,
    links
  }
}

/**
 * Calculate task source distribution (for college view)
 */
export function calculateTaskSourceDistribution(
  indicators: StrategicIndicator[],
  userDepartment: string
): Array<{ name: string; value: number; percentage: number }> {
  const deptIndicators = indicators.filter(i => i.responsibleDept === userDepartment)

  if (deptIndicators.length === 0) {
    return []
  }

  const sourceMap = new Map<string, number>()
  deptIndicators.forEach(i => {
    const source = i.ownerDept || '其他'
    sourceMap.set(source, (sourceMap.get(source) || 0) + 1)
  })

  return Array.from(sourceMap.entries()).map(([name, value]) => ({
    name,
    value,
    percentage: (value / deptIndicators.length) * 100
  }))
}
