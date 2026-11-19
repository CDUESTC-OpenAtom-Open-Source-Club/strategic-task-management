/**
 * 2026-11-19（学院全部导入 · 规划书第一节）：全部导入模板的**父级锚点全集**构建。
 *
 * <p>单条导入的模板只预填「当前所选归口部门」已接收的核心指标；全部导入的模板必须
 * 预填**该学院全部归口部门**的核心指标全集——否则用户下载模板时看不到其它归口的
 * 锚点行，文件里就没法同时写多个职能部门。</p>
 *
 * <p>本模块是纯函数：输入「按归口分组的核心指标锚点」，输出模板 seeds。
 * 锚点的筛选口径（已下发核心指标 + owner=战略发展部 + 目标部门=该归口）由调用方
 * （task 域）用既有的 buildCollegeParentAnchorIndicators 完成，本模块只负责
 * 「分组 → 铺平 → 组装 seeds」与去重，避免跨 feature 依赖。</p>
 */

import type { ImportTemplateParentSeed } from './importTemplate'

/** 单个核心指标锚点的最小形状 */
export interface AllImportAnchorLike {
  /** 指标 id（去重用） */
  id?: number | string | null
  /** 核心指标名称（模板「核心指标」列预填） */
  name?: string
  /** 核心指标自身类型（定量/定性，模板「核心指标类型」列预填） */
  type1?: string
  /** 核心指标所属任务类型（基础性/发展性，模板「任务类型」列预填） */
  type2?: string
}

/** 一个归口部门的锚点集合 */
export interface AllImportDeptAnchors {
  /** 归口部门名称（模板「职能部门」列预填） */
  dept: string
  /** 该归口已接收的已下发核心指标 */
  anchors: readonly AllImportAnchorLike[]
}

/**
 * 全部导入模板 seeds = 该学院**全部归口**的核心指标全集。
 *
 * <p>规则：
 * <ul>
 *   <li>按归口部门分组铺平（组内保持锚点 id 升序 —— 后端锚点 ORDER BY i.id，
 *       乱序预填会触发导入的父级组顺序阻断）；</li>
 *   <li>同一指标 id 只出现一次（多归口误挂同一锚点时以先出现的归口为准）；</li>
 *   <li>同名锚点（不同 id）不去重——后端按名称精确关联，同名多条会被后端阻断点名，
 *       前端不去重是为了让用户看到冲突而不是悄悄丢行。</li>
 * </ul>
 */
export const buildAllImportParentSeeds = (
  deptAnchors: readonly AllImportDeptAnchors[] | null | undefined,
  collegeName?: string | null
): ImportTemplateParentSeed[] => {
  const college = String(collegeName ?? '').trim()
  const seeds: ImportTemplateParentSeed[] = []
  const seenIds = new Set<string>()

  for (const group of Array.isArray(deptAnchors) ? deptAnchors : []) {
    const dept = String(group?.dept ?? '').trim()
    if (!dept) {
      continue
    }
    const anchors = Array.isArray(group?.anchors) ? group.anchors : []
    for (const anchor of anchors) {
      const parentIndicator = String(anchor?.name ?? '').trim()
      if (!parentIndicator) {
        continue
      }
      const idKey = String(anchor?.id ?? '').trim()
      if (idKey && seenIds.has(idKey)) {
        continue
      }
      if (idKey) {
        seenIds.add(idKey)
      }
      seeds.push({
        parentIndicator,
        college,
        parentIndicatorType: String(anchor?.type1 ?? '').trim(),
        taskType: String(anchor?.type2 ?? '').trim(),
        functionalDept: dept
      })
    }
  }

  return seeds
}
