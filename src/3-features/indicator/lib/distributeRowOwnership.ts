/**
 * 指标下发页（/distribution）学院子指标「归口部门」口径（2026-11-10 归口可见性修复）。
 *
 * 缺陷：战略部直发的学院子指标 ownerDept = 战略发展部，本页学院列表计数（学院卡片
 * 「N 个子指标」）与展开后的表格数据源此前仍按旧口径 `ownerDept === 当前视角部门` 过滤，
 * 归口职能部门（如纪委办）视角下不匹配 → 全被滤掉（学院卡片恒显「0 个子指标」、
 * 表格无数据行）。而上报审批环节 3「分管职能部门负责人审批」前的子指标审核进度鉴定
 * （评定门禁）入口就在本页展开的指标行上——入口不可达 → 上报链死锁。
 *
 * 修法：部门归属口径统一改用共享归属解析（strategyDispatchAccess.resolveRowOwningDeptCore，
 * 即战略任务页 resolveRowOwnerDept 的同一份核心逻辑）：战略部自有行的归属 =
 * 父级核心指标的目标部门（= 归口职能部门）；存量行 = ownerDept 原样；父级缺失退回 ownerDept。
 *
 * ⚠️ 与战略任务页的差异：本页归属解析**与登录角色无关**——归属是数据属性不是视角属性。
 * 战略任务页 resolveRowOwnerDept 按登录角色门控（职能部门登录原样返回 ownerDept）是
 * 那个页面下钻场景的历史定案；本页的目标恰恰是让归口职能部门登录能看到归口行，
 * 所以必须登录无关。可见性政策仍由 isDispatchOwnerVisible 统一裁决：
 * 战略部登录恒全量可见（不回归），职能部门按「归口部门 == 当前视角部门」收口。
 *
 * 权重/写路径（权重合计、发起下发审批的行集）沿用「下发方自有行」口径不变——
 * 战略部直发行挂在战略部自己的计划上，职能部门不可提交，也不计入其权重门禁。
 * 本模块只放宽「看得见」，不改变「算谁的权重」（零回归红线）。
 */
import type { StrategicIndicator } from '@/shared/types'
import {
  isDispatchOwnerVisible,
  resolveRowOwningDeptCore,
  type DispatchLoginRole
} from '@/5-shared/lib/permissions/strategyDispatchAccess'

/** 视图层部门归一化函数（部门别名表），由调用方注入，纯函数不绑定 store */
export type NormalizeDepartmentName = (value?: string | null) => string

/** 行上参与归属解析的字段（运行时真实字段，ownerDept 未声明在类型里） */
export interface DispatchRowLike {
  ownerDept?: unknown
  parentIndicatorId?: unknown
}

/** 读行的 ownerDept（与视图层 readIndicatorOwnerDept 语义一致：非字符串一律当 undefined） */
const readRowOwnerDept = (row: DispatchRowLike): string => {
  return typeof row?.ownerDept === 'string' ? row.ownerDept : ''
}

/**
 * 一行子指标的「归口部门」（本页计数/表格的统一归属口径）。
 *
 * - 存量行（owner = 职能部门）→ ownerDept 归一化后原样（职能部门存量可见性零变化）；
 * - 战略部自有行（owner = 战略发展部）→ 父级核心指标的目标部门
 *   （responsibleDept ?? targetDepartment ?? targetOrgName，与战略任务页同字段优先级）；
 * - 父级缺失 / 父级不在列表 / 目标部门解析不出（孤儿行）→ 退回 ownerDept 兜底。
 */
export function resolveDispatchRowOwningDept(params: {
  row: DispatchRowLike
  /** 全量指标列表（用于按 parentIndicatorId 找父级核心指标） */
  indicators: ReadonlyArray<StrategicIndicator>
  strategicDeptName: string
  normalizeDepartmentName: NormalizeDepartmentName
}): string {
  const owner = params.normalizeDepartmentName(readRowOwnerDept(params.row) || '')
  const parentId = Number(params.row?.parentIndicatorId ?? NaN)
  let parentTarget = ''
  if (Number.isFinite(parentId) && parentId > 0) {
    const parent = params.indicators.find(
      candidate => Number(candidate?.id ?? NaN) === parentId
    ) as
      | { responsibleDept?: unknown; targetDepartment?: unknown; targetOrgName?: unknown }
      | undefined
    parentTarget = params.normalizeDepartmentName(
      String(parent?.responsibleDept ?? parent?.targetDepartment ?? parent?.targetOrgName ?? '')
    )
  }
  return resolveRowOwningDeptCore({
    strategicDeptName: params.normalizeDepartmentName(params.strategicDeptName || ''),
    rowOwnerDept: owner,
    parentTargetDept: parentTarget
  })
}

/**
 * 按学院分组的子指标单一事实源（学院卡片「N 个子指标」计数 + 展开表格行共用）。
 *
 * 可见性判定：行的「归口部门」（resolveDispatchRowOwningDept）== 当前视角部门，
 * 最终仍由 isDispatchOwnerVisible 裁决——战略部登录恒全量可见（2026-11-05 放宽口径
 * 不回归），职能部门登录按归口口径收口（存量行逐字不变，新增可见归口战略行）。
 *
 * 分组规则与 2026-10-27 版本一致：按 responsibleDept（字符串或数组）逐项归一化后
 * 按学院归一化名分组。
 */
export function groupDispatchCollegeChildIndicators(params: {
  indicators: ReadonlyArray<StrategicIndicator>
  loginRole: DispatchLoginRole
  currentDept: string
  strategicDeptName: string
  normalizeDepartmentName: NormalizeDepartmentName
}): Map<string, StrategicIndicator[]> {
  const grouped = new Map<string, StrategicIndicator[]>()
  const normalizedCurrentDept = params.normalizeDepartmentName(params.currentDept || '')

  params.indicators.forEach(indicator => {
    if (indicator.isStrategic) {
      return
    }

    const rowOwningDept = resolveDispatchRowOwningDept({
      row: indicator,
      indicators: params.indicators,
      strategicDeptName: params.strategicDeptName,
      normalizeDepartmentName: params.normalizeDepartmentName
    })

    // 归口口径：与视图层 isSameDepartment 语义一致——两侧归一化、空串不匹配
    const ownerMatchesCurrentDept =
      Boolean(normalizedCurrentDept) && normalizedCurrentDept === rowOwningDept
    if (
      !isDispatchOwnerVisible({
        loginRole: params.loginRole,
        ownerMatchesCurrentDept
      })
    ) {
      return
    }

    // responsibleDept 运行时可能是字符串或字符串数组，逐项归一化后按学院分组
    const rawDept = indicator.responsibleDept as string | string[] | undefined
    const deptValues: string[] = Array.isArray(rawDept) ? rawDept : rawDept ? [rawDept] : []

    const collegeKeys = new Set<string>()
    deptValues.forEach(dept => {
      const normalized = params.normalizeDepartmentName(dept)
      if (normalized) {
        collegeKeys.add(normalized)
      }
    })

    collegeKeys.forEach(collegeKey => {
      const bucket = grouped.get(collegeKey)
      if (bucket) {
        bucket.push(indicator)
        return
      }
      grouped.set(collegeKey, [indicator])
    })
  })

  return grouped
}

/**
 * 「下发方自有行」过滤（权重合计 / 发起下发审批 / 复制的行集口径，写路径）。
 *
 * 与 2026-11-05 版本逐字等价（零回归）：
 * - 学院匹配：responsibleDept 原始值 includes/===（未归一化，保持原行为）；
 * - 可见性：isDispatchOwnerVisible（战略部恒可见、职能部门按 ownerDept === 视角部门）；
 * - 归属收窄：ownerDept === 下发方部门（战略部登录 → 只算战略部直发行；
 *   职能部门登录 → 只算本部门存量行；战略部直发行即使归口本部门也不计入职能部门的
 *   权重门禁——它挂在战略部自己的计划上）。
 *
 * 取不到 ownerDept（非字符串）时按不匹配处理（与 readIndicatorOwnerDept 原语义一致）。
 */
export function filterDispatchOwnedCollegeIndicators(params: {
  indicators: ReadonlyArray<StrategicIndicator>
  college: string
  loginRole: DispatchLoginRole
  currentDept: string
  dispatchOwnerDept: string
}): StrategicIndicator[] {
  const visible = params.indicators.filter(i => {
    if (i.isStrategic) {
      return false
    }
    if (
      !isDispatchOwnerVisible({
        loginRole: params.loginRole,
        ownerMatchesCurrentDept: i.ownerDept === params.currentDept
      })
    ) {
      return false
    }
    if (Array.isArray(i.responsibleDept)) {
      return i.responsibleDept.includes(params.college)
    }
    return i.responsibleDept === params.college
  })

  const dispatchOwner = params.dispatchOwnerDept
  return visible.filter(i => {
    const ownerDept = (i as { ownerDept?: unknown }).ownerDept
    return typeof ownerDept === 'string' && ownerDept === dispatchOwner
  })
}
