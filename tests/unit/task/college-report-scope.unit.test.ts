import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  resolveCollegeReportPlanScope,
  type CollegeReportScopeContext,
  type CollegeReportScopeIndicatorLike,
  type CollegeReportScopePlanLike
} from '@/features/task/lib/collegeReportScope'

/**
 * 2026-11-13（学院页签状态签归口收口）用例口径 —— 用户实测缺陷：
 *
 * 场景：战略部（zlb_admin）→ 「战略任务管理」→ 二级学院页签 → 选「计算机学院」→
 * 右侧部门下拉选「教务处」→ 表格 No Data、审批状况「未填报」、基础性权重合计 0/100，
 * 但右上角「计划状态」却显示「已下发」（错）；切到「纪委办公室 | 监察处」时「已下发」是对的。
 *
 * 根因：学院页签解析 FUNC_TO_COLLEGE 子计划时只看「学院 + 创建方=战略部(35)」，
 * 不看归口部门 → 命中了归口=纪委办的计划。
 *
 * 本文件覆盖三层断言：
 * ① 纯函数层：按所选部门解析出对应计划（不串）、legacy 空壳不参与、解析失败返回 null；
 * ② 接线层：模型确实按「归口部门」收口（战略部登录）/ 职能部门登录零变化；
 * ③ 状态签层：解析失败 → 「未下发」（与表格 No Data 一致，不得显示「已下发」）。
 */

/** 组织 ID（与本地库 sism_pr95 一致） */
const ORG_STRATEGIC = 35 // 战略发展部
const ORG_COMPUTER = 57 // 计算机学院
const ORG_JIJIAN = 37 // 纪委办公室 | 监察处
const ORG_JIAOWU = 44 // 教务处
const COLLEGE_NAME = '计算机学院'
const DEPT_JIJIAN_NAME = '纪委办公室 | 监察处'
const DEPT_JIAOWU_NAME = '教务处'

const resolvePlanYear = (plan: CollegeReportScopePlanLike): number | null =>
  plan.year === undefined || plan.year === null ? null : Number(plan.year)

const normalize = (value?: string | null): string => String(value ?? '').trim()

/** 战略部登录 + 学院页签解析上下文（归口收口开启） */
const strategicContext = (
  overrides: Partial<CollegeReportScopeContext> = {}
): CollegeReportScopeContext => ({
  collegeOrgId: ORG_COMPUTER,
  collegeName: COLLEGE_NAME,
  creatorOrgId: ORG_STRATEGIC,
  scopeByFunctionalOrg: true,
  selectedDeptOrgId: ORG_JIJIAN,
  selectedDeptName: DEPT_JIJIAN_NAME,
  currentYear: 2026,
  resolvePlanYear,
  normalize,
  ...overrides
})

describe('task/lib/collegeReportScope（学院页签 FUNC_TO_COLLEGE 子计划解析）', () => {
  describe('归口部门收口（战略部登录）', () => {
    it('同学院下两个归口部门各有计划：按所选部门解析出**对应**那个（不串台）', () => {
      const plans: CollegeReportScopePlanLike[] = [
        {
          id: 705489,
          status: 'DISTRIBUTED',
          planLevel: 'FUNC_TO_COLLEGE',
          targetOrgId: ORG_COMPUTER,
          createdByOrgId: ORG_STRATEGIC,
          functionalOrgId: ORG_JIJIAN,
          totalIndicators: 5,
          year: 2026
        },
        {
          id: 705490,
          status: 'DRAFT',
          planLevel: 'FUNC_TO_COLLEGE',
          targetOrgId: ORG_COMPUTER,
          createdByOrgId: ORG_STRATEGIC,
          functionalOrgId: ORG_JIAOWU,
          totalIndicators: 0,
          year: 2026
        }
      ]

      const jijianScope = resolveCollegeReportPlanScope(
        plans,
        [],
        strategicContext({
          selectedDeptOrgId: ORG_JIJIAN,
          selectedDeptName: DEPT_JIJIAN_NAME
        })
      )
      expect(jijianScope).toEqual({ planId: 705489, orgId: ORG_COMPUTER })

      const jiaowuScope = resolveCollegeReportPlanScope(
        plans,
        [],
        strategicContext({
          selectedDeptOrgId: ORG_JIAOWU,
          selectedDeptName: DEPT_JIAOWU_NAME
        })
      )
      expect(jiaowuScope).toEqual({ planId: 705490, orgId: ORG_COMPUTER })
    })

    it('真实缺陷复现：计算机学院只有归口=纪委办的计划时，选「教务处」解析失败（返回 null）', () => {
      // 705489 = 计算机学院 × 纪委办（DISTRIBUTED、归口 37、5 指标）
      const plans: CollegeReportScopePlanLike[] = [
        {
          id: 705489,
          status: 'DISTRIBUTED',
          planLevel: 'FUNC_TO_COLLEGE',
          targetOrgId: ORG_COMPUTER,
          createdByOrgId: ORG_STRATEGIC,
          functionalOrgId: ORG_JIJIAN,
          totalIndicators: 5,
          year: 2026
        }
      ]

      const scope = resolveCollegeReportPlanScope(
        plans,
        [],
        strategicContext({
          selectedDeptOrgId: ORG_JIAOWU,
          selectedDeptName: DEPT_JIAOWU_NAME
        })
      )
      expect(scope).toBeNull()
    })

    it('归口字段有值但不等于所选部门 → 不匹配（不回落 legacy 桶，不串台）', () => {
      const plans: CollegeReportScopePlanLike[] = [
        {
          id: 705489,
          status: 'DISTRIBUTED',
          planLevel: 'FUNC_TO_COLLEGE',
          targetOrgId: ORG_COMPUTER,
          createdByOrgId: ORG_STRATEGIC,
          functionalOrgId: ORG_JIJIAN,
          totalIndicators: 5,
          year: 2026
        }
      ]
      expect(
        resolveCollegeReportPlanScope(
          plans,
          [],
          strategicContext({
            selectedDeptOrgId: ORG_JIAOWU,
            selectedDeptName: DEPT_JIAOWU_NAME
          })
        )
      ).toBeNull()
    })

    it('legacy 空壳计划（functional_org_id=null、0 指标）不参与匹配', () => {
      // 404457 = 计算机学院 × 教务处 legacy 空壳（DRAFT、created_by=44、归口 null、0 指标）
      const plans: CollegeReportScopePlanLike[] = [
        {
          id: 404457,
          status: 'DRAFT',
          planLevel: 'FUNC_TO_COLLEGE',
          targetOrgId: ORG_COMPUTER,
          createdByOrgId: ORG_JIAOWU,
          functionalOrgId: null,
          totalIndicators: 0,
          year: 2026
        },
        {
          id: 404257,
          status: 'DRAFT',
          planLevel: 'FUNC_TO_COLLEGE',
          targetOrgId: ORG_COMPUTER,
          createdByOrgId: 42,
          functionalOrgId: null,
          totalIndicators: 0,
          year: 2026
        }
      ]

      // 创建方口径（战略部 35）先排除 legacy 计划；即便创建方相同，0 指标空壳也不参与
      const scope = resolveCollegeReportPlanScope(
        plans.map(plan => ({ ...plan, createdByOrgId: ORG_STRATEGIC })),
        [],
        strategicContext({
          selectedDeptOrgId: ORG_JIAOWU,
          selectedDeptName: DEPT_JIAOWU_NAME
        })
      )
      expect(scope).toBeNull()
    })

    it('legacy 兜底：归口字段为空但确有存活指标 + 指标父级反查归口命中 → 可匹配', () => {
      const plans: CollegeReportScopePlanLike[] = [
        {
          id: 404457,
          status: 'DISTRIBUTED',
          planLevel: 'FUNC_TO_COLLEGE',
          targetOrgId: ORG_COMPUTER,
          createdByOrgId: ORG_STRATEGIC,
          functionalOrgId: null,
          totalIndicators: 5,
          year: 2026
        }
      ]
      // 父级核心指标 2048（target=纪委办）+ 学院子指标 2052（parent=2048、target=计算机学院）
      const indicators: CollegeReportScopeIndicatorLike[] = [
        {
          id: 2048,
          parentIndicatorId: null,
          targetOrgId: ORG_JIJIAN,
          responsibleDept: DEPT_JIJIAN_NAME
        },
        {
          id: 2052,
          parentIndicatorId: 2048,
          targetOrgId: ORG_COMPUTER,
          responsibleDept: COLLEGE_NAME
        }
      ]

      const scope = resolveCollegeReportPlanScope(
        plans,
        indicators,
        strategicContext({
          selectedDeptOrgId: ORG_JIJIAN,
          selectedDeptName: DEPT_JIJIAN_NAME
        })
      )
      expect(scope).toEqual({ planId: 404457, orgId: ORG_COMPUTER })
    })

    it('legacy 兜底：指标父级反查归口不命中（父级归口是别的部门）→ 不匹配', () => {
      const plans: CollegeReportScopePlanLike[] = [
        {
          id: 404457,
          status: 'DISTRIBUTED',
          planLevel: 'FUNC_TO_COLLEGE',
          targetOrgId: ORG_COMPUTER,
          createdByOrgId: ORG_STRATEGIC,
          functionalOrgId: null,
          totalIndicators: 5,
          year: 2026
        }
      ]
      const indicators: CollegeReportScopeIndicatorLike[] = [
        {
          id: 2048,
          parentIndicatorId: null,
          targetOrgId: ORG_JIJIAN,
          responsibleDept: DEPT_JIJIAN_NAME
        },
        {
          id: 2052,
          parentIndicatorId: 2048,
          targetOrgId: ORG_COMPUTER,
          responsibleDept: COLLEGE_NAME
        }
      ]

      expect(
        resolveCollegeReportPlanScope(
          plans,
          indicators,
          strategicContext({
            selectedDeptOrgId: ORG_JIAOWU,
            selectedDeptName: DEPT_JIAOWU_NAME
          })
        )
      ).toBeNull()
    })

    it('两选未齐（学院页签未选归属部门）→ 保守返回 null（状态签「未下发」）', () => {
      const plans: CollegeReportScopePlanLike[] = [
        {
          id: 705489,
          status: 'DISTRIBUTED',
          planLevel: 'FUNC_TO_COLLEGE',
          targetOrgId: ORG_COMPUTER,
          createdByOrgId: ORG_STRATEGIC,
          functionalOrgId: ORG_JIJIAN,
          totalIndicators: 5,
          year: 2026
        }
      ]
      expect(
        resolveCollegeReportPlanScope(
          plans,
          [],
          strategicContext({ selectedDeptOrgId: null, selectedDeptName: '' })
        )
      ).toBeNull()
    })
  })

  describe('职能部门登录（零变化红线）', () => {
    it('创建方 = 当前选中职能部门：命中本部门历史计划（不启用归口收口）', () => {
      const plans: CollegeReportScopePlanLike[] = [
        {
          id: 404457,
          status: 'DRAFT',
          planLevel: 'FUNC_TO_COLLEGE',
          targetOrgId: ORG_COMPUTER,
          createdByOrgId: ORG_JIAOWU,
          functionalOrgId: null,
          totalIndicators: 0,
          year: 2026
        },
        {
          id: 705489,
          status: 'DISTRIBUTED',
          planLevel: 'FUNC_TO_COLLEGE',
          targetOrgId: ORG_COMPUTER,
          createdByOrgId: ORG_STRATEGIC,
          functionalOrgId: ORG_JIJIAN,
          totalIndicators: 5,
          year: 2026
        }
      ]

      const scope = resolveCollegeReportPlanScope(
        plans,
        [],
        strategicContext({
          creatorOrgId: ORG_JIAOWU,
          scopeByFunctionalOrg: false,
          selectedDeptOrgId: null,
          selectedDeptName: ''
        })
      )
      expect(scope).toEqual({ planId: 404457, orgId: ORG_COMPUTER })
    })
  })

  describe('年度与基础匹配', () => {
    it('跨年度同组合计划并存：优先命中年份精确等于当年度的', () => {
      const plans: CollegeReportScopePlanLike[] = [
        {
          id: 703757,
          status: 'DRAFT',
          planLevel: 'FUNC_TO_COLLEGE',
          targetOrgId: ORG_COMPUTER,
          createdByOrgId: ORG_STRATEGIC,
          functionalOrgId: ORG_JIJIAN,
          totalIndicators: 0,
          year: 2025
        },
        {
          id: 705489,
          status: 'DISTRIBUTED',
          planLevel: 'FUNC_TO_COLLEGE',
          targetOrgId: ORG_COMPUTER,
          createdByOrgId: ORG_STRATEGIC,
          functionalOrgId: ORG_JIJIAN,
          totalIndicators: 5,
          year: 2026
        }
      ]
      const scope = resolveCollegeReportPlanScope(plans, [], strategicContext())
      expect(scope).toEqual({ planId: 705489, orgId: ORG_COMPUTER })
    })

    it('非 FUNC_TO_COLLEGE 层级 / 目标学院不符 / 创建方不符 → 一律不匹配', () => {
      const plans: CollegeReportScopePlanLike[] = [
        {
          id: 1,
          planLevel: 'STRAT_TO_FUNC',
          targetOrgId: ORG_COMPUTER,
          createdByOrgId: ORG_STRATEGIC,
          functionalOrgId: ORG_JIJIAN,
          year: 2026
        },
        {
          id: 2,
          planLevel: 'FUNC_TO_COLLEGE',
          targetOrgId: 56,
          createdByOrgId: ORG_STRATEGIC,
          functionalOrgId: ORG_JIJIAN,
          year: 2026
        },
        {
          id: 3,
          planLevel: 'FUNC_TO_COLLEGE',
          targetOrgId: ORG_COMPUTER,
          createdByOrgId: 42,
          functionalOrgId: ORG_JIJIAN,
          year: 2026
        }
      ]
      expect(resolveCollegeReportPlanScope(plans, [], strategicContext())).toBeNull()
    })
  })
})

/**
 * 接线契约：模型必须走新解析（归口收口），且解析失败时状态签显示「未下发」。
 */
describe('学院页签状态签接线（2026-11-13 归口收口）', () => {
  const readSource = (relativePath: string) =>
    readFileSync(resolve(process.cwd(), relativePath), 'utf8')

  it('模型改走 resolveCollegeReportPlanScope，并按登录角色分流归口收口', () => {
    const modelSource = readSource('src/3-features/task/model/useStrategicTaskView.ts')
    expect(modelSource).toContain('resolveCollegeReportPlanScope')
    // 战略部登录启用归口收口；职能部门登录零变化（不启用）
    expect(modelSource).toMatch(/scopeByFunctionalOrg:\s*isStrategicDeptLogin\.value/)
    // 归口部门取学院页签右侧下拉所选部门
    expect(modelSource).toMatch(/selectedDeptOrgId:\s*isStrategicDeptLogin\.value/)
    // 旧的「只看学院 + 创建方」匹配口径不得回归
    expect(modelSource).not.toMatch(
      /Number\(planAny\.createdByOrgId \?\? planAny\.created_by_org_id \?\? NaN\) === creatorOrgId/
    )
  })

  it('解析失败 → 状态签「未下发」（不得显示「已下发」）', () => {
    const modelSource = readSource('src/3-features/task/model/useStrategicTaskView.ts')
    // overallStatus：学院页签下 effectivePlanStatus 为空（子计划未解析）→「未下发」
    expect(modelSource).toMatch(
      /if \(isCollegePlanContextActive\.value\) \{\s*const collegeStatus = effectivePlanStatus\.value\s*if \(!collegeStatus\) \{\s*return \{ label: '未下发', type: 'info' \}/
    )
  })
})
