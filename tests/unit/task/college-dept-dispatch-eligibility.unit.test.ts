import { describe, expect, it } from 'vitest'
import {
  COLLEGE_DEPT_INELIGIBLE_WARNING,
  buildCollegeDeptEligibleByDept,
  isCollegeDispatchDeptEligible,
  isDistributedCoreIndicator,
  resolveCollegeDeptFilterSelection
} from '@/features/task/lib/collegeDispatchEligibility'

/**
 * 2026-11-10（用户拍板）学院页签「职能部门」下拉**下发资格**用例口径：
 *
 * 1. 资格 = 该部门在该考核周期存在「已下发」（DISTRIBUTED；旧数据 ACTIVE 等价）
 *    状态的**核心指标**（无父指标）；子指标（有 parentIndicatorId）不构成资格；
 * 2. 下拉全部部门**可点击**：无资格部门点击 → 拦截（不落选）+ 提示
 *    「当前职能部门未有已下发的任务」；有资格部门点击 → 正常选中。
 */
describe('task/lib/collegeDispatchEligibility（学院页签部门下发资格判定）', () => {
  describe('isDistributedCoreIndicator', () => {
    it('核心指标 status=DISTRIBUTED → 是已下发核心指标', () => {
      expect(isDistributedCoreIndicator({ status: 'DISTRIBUTED' })).toBe(true)
    })

    it('核心指标 status=DISTRIBUTED（含小写/空白）→ 归一后同样成立', () => {
      expect(isDistributedCoreIndicator({ status: ' distributed ' })).toBe(true)
    })

    it('旧数据 status=ACTIVE → 与 DISTRIBUTED 等价，视为已下发', () => {
      expect(isDistributedCoreIndicator({ status: 'ACTIVE' })).toBe(true)
    })

    it('子指标（有 parentIndicatorId）即使已下发也不构成资格依据', () => {
      expect(
        isDistributedCoreIndicator({ status: 'DISTRIBUTED', parentIndicatorId: 12 })
      ).toBe(false)
      expect(
        isDistributedCoreIndicator({ status: 'DISTRIBUTED', parentIndicatorId: '12' })
      ).toBe(false)
    })

    it('parentIndicatorId 为 null / undefined / 空串 → 视为核心指标', () => {
      expect(
        isDistributedCoreIndicator({ status: 'DISTRIBUTED', parentIndicatorId: null })
      ).toBe(true)
      expect(isDistributedCoreIndicator({ status: 'DISTRIBUTED' })).toBe(true)
      expect(
        isDistributedCoreIndicator({ status: 'DISTRIBUTED', parentIndicatorId: '' })
      ).toBe(true)
    })

    it('草稿 / 审批中 / 归档 / 无状态 → 都不构成资格依据', () => {
      expect(isDistributedCoreIndicator({ status: 'DRAFT' })).toBe(false)
      expect(isDistributedCoreIndicator({ status: 'PENDING_REVIEW' })).toBe(false)
      expect(isDistributedCoreIndicator({ status: 'ARCHIVED' })).toBe(false)
      expect(isDistributedCoreIndicator({})).toBe(false)
      expect(isDistributedCoreIndicator({ status: null })).toBe(false)
    })
  })

  describe('isCollegeDispatchDeptEligible（部门级判定）', () => {
    it('存在至少一条已下发核心指标 → 有资格', () => {
      expect(
        isCollegeDispatchDeptEligible([
          { status: 'DRAFT' },
          { status: 'PENDING_REVIEW', parentIndicatorId: '' },
          { status: 'DISTRIBUTED', parentIndicatorId: '' }
        ])
      ).toBe(true)
    })

    it('只有子指标已下发 / 只有草稿 / 空列表 → 无资格', () => {
      expect(
        isCollegeDispatchDeptEligible([{ status: 'DISTRIBUTED', parentIndicatorId: 3 }])
      ).toBe(false)
      expect(isCollegeDispatchDeptEligible([{ status: 'DRAFT' }])).toBe(false)
      expect(isCollegeDispatchDeptEligible([])).toBe(false)
    })
  })

  describe('buildCollegeDeptEligibleByDept（全量资格聚合，2026-11-10 缺陷修复）', () => {
    // 模拟 normalizeDepartmentName：原样返回（纯函数层不依赖 model 的别名表）；
    // 字段链用 || —— 空串也兜底（与 model 侧注入的解析器同口径）
    const resolveDeptName = (indicator: { targetDepartment?: unknown; targetOrgName?: unknown; responsibleDept?: unknown }) =>
      String(indicator.targetDepartment || indicator.targetOrgName || indicator.responsibleDept || '')

    it('回归（纪委办场景）：核心指标 target=职能部门且 DISTRIBUTED、该学院零学院行 → 部门仍 eligible', () => {
      // 全量指标 = 3 条纪委办核心指标（owner=战略部、target=纪委办、parent 为空），
      // 没有任何「target=学院」的学院行 —— 旧实现按学院过滤后 byDept 为空、误判无资格
      const indicators = Array.from({ length: 3 }, (_, i) => ({
        id: i + 1,
        status: 'DISTRIBUTED',
        parentIndicatorId: null,
        targetDepartment: '纪委办公室 | 监察处'
      }))
      const result = buildCollegeDeptEligibleByDept(indicators, resolveDeptName)
      expect(result.get('纪委办公室 | 监察处')).toBe(true)
    })

    it('部门名按字段链 targetDepartment || targetOrgName || responsibleDept 取（空串也兜底；resolveDeptName 由调用方注入）', () => {
      const indicators = [
        { status: 'DISTRIBUTED', targetDepartment: '', targetOrgName: '纪委办公室 | 监察处' },
        { status: 'ACTIVE', responsibleDept: '审计处' }
      ]
      const result = buildCollegeDeptEligibleByDept(indicators, resolveDeptName)
      expect(result.get('纪委办公室 | 监察处')).toBe(true)
      expect(result.get('审计处')).toBe(true)
    })

    it('草稿 / 审批中 / 归档核心指标、已下发子指标 → 不标记资格', () => {
      const indicators = [
        { status: 'DRAFT', targetDepartment: '纪委办公室' },
        { status: 'PENDING_REVIEW', targetDepartment: '纪委办公室' },
        { status: 'ARCHIVED', targetDepartment: '纪委办公室' },
        { status: 'DISTRIBUTED', parentIndicatorId: 9, targetDepartment: '纪委办公室' }
      ]
      const result = buildCollegeDeptEligibleByDept(indicators, resolveDeptName)
      expect(result.size).toBe(0)
    })

    it('目标部门名为空（无任何部门字段）→ 跳过该行，不产生空键', () => {
      const indicators = [{ status: 'DISTRIBUTED', parentIndicatorId: null }]
      const result = buildCollegeDeptEligibleByDept(indicators, resolveDeptName)
      expect(result.size).toBe(0)
    })

    it('学院行（target=学院）的已下发核心指标 → 标记的是学院名（键不进职能部门下拉，无害兜底）', () => {
      const indicators = [
        { status: 'DISTRIBUTED', parentIndicatorId: null, targetDepartment: '计算机学院' }
      ]
      const result = buildCollegeDeptEligibleByDept(indicators, resolveDeptName)
      expect(result.get('计算机学院')).toBe(true)
      expect(result.has('纪委办公室')).toBe(false)
    })

    it('空列表 → 空 Map', () => {
      expect(buildCollegeDeptEligibleByDept([], resolveDeptName).size).toBe(0)
    })
  })

  describe('resolveCollegeDeptFilterSelection（下拉点击分流）', () => {
    const items = [
      { dept: '教务处', eligible: true },
      { dept: '科研处', eligible: false }
    ]

    it('有资格部门点击 → 放行并选中', () => {
      expect(resolveCollegeDeptFilterSelection(items, '教务处')).toEqual({
        accepted: true,
        dept: '教务处',
        intercepted: false
      })
    })

    it('无资格部门点击 → 拦截（不落选）', () => {
      expect(resolveCollegeDeptFilterSelection(items, '科研处')).toEqual({
        accepted: false,
        dept: '科研处',
        intercepted: true
      })
    })

    it('未知部门（防御）→ 同样拦截', () => {
      expect(resolveCollegeDeptFilterSelection(items, '不存在的部门').accepted).toBe(false)
      expect(resolveCollegeDeptFilterSelection(items, '').accepted).toBe(false)
      expect(resolveCollegeDeptFilterSelection(items, null).accepted).toBe(false)
    })
  })

  it('提示文案常量 = 用户拍板原文「当前职能部门未有已下发的任务」（实现与组件共用，防漂移）', () => {
    expect(COLLEGE_DEPT_INELIGIBLE_WARNING).toBe('当前职能部门未有已下发的任务')
  })
})
