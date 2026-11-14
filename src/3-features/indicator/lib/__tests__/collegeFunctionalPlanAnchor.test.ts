/**
 * /distribution「该学院计划」锚定口径单测（2026-11-13 归口锚定修正）。
 *
 * 锁住新口径四条规则（断言基准 = 真实库 2026-11-13 核实数据）：
 * ① 归口计划优先：functional_org_id=本部门的 FUNC_TO_COLLEGE 计划（如工学院×教务处
 *    705488，created_by=35）压倒 legacy 计划被锚定；
 * ② legacy 回退：created_by_org_id=本部门且有存活指标的计划仍可作为历史锚定；
 * ③ legacy 空壳（0 任务，如 404456 等 DRAFT 空计划）不参与状态展示——空壳不锚定；
 * ④ 同桶多份：已下发优先 → id 倒序（沿用旧排序）。
 *
 * 判定逻辑与被测视图（useIndicatorDistributeView）共用同一份纯函数实现。
 */
import { describe, expect, it } from 'vitest'
import {
  matchesCollegePlanAnchor,
  planHasLivingIndicators,
  selectCollegeFunctionalPlan,
  type AnchorPlanLike
} from '../collegeFunctionalPlanAnchor'

const normalizeDepartmentName = (value?: string | null): string => String(value ?? '').trim()

const context = (overrides: Record<string, unknown> = {}) => ({
  collegeOrgId: 56,
  collegeName: '工学院',
  ownerOrgId: 44,
  currentYear: 2026,
  resolvePlanYear: (plan: AnchorPlanLike) => Number(plan.year ?? 2026) || 2026,
  normalizeOrgName: normalizeDepartmentName,
  ...overrides
})

/** 真实库同构：705488 = 战略部直发、归口教务处、DISTRIBUTED、1 指标 */
const functionalDistributedPlan = (overrides: Record<string, unknown> = {}): AnchorPlanLike =>
  ({
    id: 705488,
    name: '2026年 工学院 计划',
    status: 'DISTRIBUTED',
    planLevel: 'FUNC_TO_COLLEGE',
    targetOrgId: 56,
    targetOrgName: '工学院',
    createdByOrgId: 35,
    functionalOrgId: 44,
    totalIndicators: 1,
    year: 2026,
    ...overrides
  }) as AnchorPlanLike

/** 真实库同构：404456 = 教务处 legacy 空壳计划（created_by=44、DRAFT、0 任务） */
const legacyEmptyShellPlan = (overrides: Record<string, unknown> = {}): AnchorPlanLike =>
  ({
    id: 404456,
    name: '2026年 工学院 计划（legacy）',
    status: 'DRAFT',
    planLevel: 'FUNC_TO_COLLEGE',
    targetOrgId: 56,
    targetOrgName: '工学院',
    createdByOrgId: 44,
    totalIndicators: 0,
    year: 2026,
    ...overrides
  }) as AnchorPlanLike

/** legacy 有存活指标的历史计划（职能部门改造前真实下发过） */
const legacyLivingPlan = (overrides: Record<string, unknown> = {}): AnchorPlanLike =>
  legacyEmptyShellPlan({
    id: 404000,
    status: 'DISTRIBUTED',
    totalIndicators: 3,
    ...overrides
  })

describe('planHasLivingIndicators', () => {
  it('totalIndicators>0 或 indicators 数组非空 → 存活；空壳（0/null + 无数组）→ false', () => {
    expect(planHasLivingIndicators({ totalIndicators: 1 } as AnchorPlanLike)).toBe(true)
    expect(planHasLivingIndicators({ indicators: [{ id: 1 }] } as AnchorPlanLike)).toBe(true)
    expect(planHasLivingIndicators({ totalIndicators: 0 } as AnchorPlanLike)).toBe(false)
    expect(planHasLivingIndicators({} as AnchorPlanLike)).toBe(false)
  })
})

describe('selectCollegeFunctionalPlan（归口锚定修正）', () => {
  it('① 归口计划优先：705488（functional_org_id=44）压倒 legacy 空壳 404456 被锚定', () => {
    const picked = selectCollegeFunctionalPlan(
      [legacyEmptyShellPlan(), functionalDistributedPlan()],
      context()
    )
    expect(Number(picked?.id)).toBe(705488)
    expect(String(picked?.status)).toBe('DISTRIBUTED')
  })

  it('② legacy 回退：归口计划缺失时，created_by=本部门且有存活指标的计划被锚定', () => {
    const picked = selectCollegeFunctionalPlan([legacyLivingPlan()], context())
    expect(Number(picked?.id)).toBe(404000)
  })

  it('③ legacy 空壳不参与状态展示：仅有 0 任务空计划 → 锚定 null（不串状态）', () => {
    const picked = selectCollegeFunctionalPlan([legacyEmptyShellPlan()], context())
    expect(picked).toBeNull()
  })

  it('③-补 functional_org_id 指向其它部门、created_by 指向本部门的空壳 → 不锚定', () => {
    const picked = selectCollegeFunctionalPlan(
      [legacyEmptyShellPlan({ functionalOrgId: 37, createdByOrgId: 44 })],
      context()
    )
    expect(picked).toBeNull()
  })

  it('④ 同桶多份：已下发优先于草稿；同级按 id 倒序', () => {
    const draft = functionalDistributedPlan({ id: 705500, status: 'DRAFT' })
    const distributed = functionalDistributedPlan({ id: 705488 })
    expect(Number(selectCollegeFunctionalPlan([draft, distributed], context())?.id)).toBe(705488)

    const newer = functionalDistributedPlan({ id: 705600 })
    const older = functionalDistributedPlan({ id: 705488 })
    expect(Number(selectCollegeFunctionalPlan([older, newer], context())?.id)).toBe(705600)
  })

  it('归口桶非空时忽略 legacy 计划（新口径是唯一真数据源）', () => {
    const picked = selectCollegeFunctionalPlan(
      [legacyLivingPlan(), functionalDistributedPlan({ status: 'DRAFT' })],
      context()
    )
    // 归口桶存在（哪怕草稿）→ 不回退 legacy 的已下发计划
    expect(Number(picked?.id)).not.toBe(404000)
    expect(Number(picked?.functionalOrgId)).toBe(44)
  })

  it('年份不匹配 / planLevel 非 FUNC_TO_COLLEGE / 目标学院不符 → 不锚定', () => {
    expect(
      selectCollegeFunctionalPlan([functionalDistributedPlan({ year: 2025 })], context())
    ).toBeNull()
    expect(
      selectCollegeFunctionalPlan(
        [functionalDistributedPlan({ planLevel: 'STRAT_TO_FUNC' })],
        context()
      )
    ).toBeNull()
    expect(
      selectCollegeFunctionalPlan(
        [functionalDistributedPlan({ targetOrgId: 57, targetOrgName: '商学院' })],
        context()
      )
    ).toBeNull()
  })

  it('锚定方 org id 解析不出（null/NaN）→ 保守返回 null（宁可空，不串数据）', () => {
    expect(
      selectCollegeFunctionalPlan([functionalDistributedPlan()], context({ ownerOrgId: null }))
    ).toBeNull()
  })
})

describe('matchesCollegePlanAnchor（详情上下文守卫，与锚定同口径）', () => {
  it('归口计划（705488）命中上下文 → 详情复用不重载', () => {
    expect(matchesCollegePlanAnchor(functionalDistributedPlan(), context())).toBe(true)
  })

  it('有存活指标的 legacy 计划命中；空壳不命中', () => {
    expect(matchesCollegePlanAnchor(legacyLivingPlan(), context())).toBe(true)
    expect(matchesCollegePlanAnchor(legacyEmptyShellPlan(), context())).toBe(false)
  })

  it('target 名称匹配走归一化函数（别名表注入）', () => {
    const plan = functionalDistributedPlan({ targetOrgId: undefined, targetOrgName: '工学院' })
    expect(matchesCollegePlanAnchor(plan, context({ collegeOrgId: null }))).toBe(true)
  })
})
