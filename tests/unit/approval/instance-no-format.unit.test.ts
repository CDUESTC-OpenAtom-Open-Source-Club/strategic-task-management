import { describe, expect, it } from 'vitest'
import { formatInstanceNo } from '@/features/approval/model/useApprovalProgressDrawer'

/**
 * 2026-10-21 用户定案：流程编号面向用户显示，不暴露后端实体类型前缀。
 * 后端 buildInstanceNo 格式为 {实体类型}-{实体ID}-{轮次}。
 */
describe('formatInstanceNo', () => {
  it('把实体类型前缀转为业务名称', () => {
    expect(formatInstanceNo('PLAN-4043-001')).toBe('计划 4043 · 第1轮')
    expect(formatInstanceNo('INDICATOR-2051-002')).toBe('指标异动 2051 · 第2轮')
    expect(formatInstanceNo('TASK-41026-001')).toBe('任务异动 41026 · 第1轮')
    expect(formatInstanceNo('PLAN_REPORT-88-003')).toBe('月报 88 · 第3轮')
  })

  it('无轮次段时省略轮次显示', () => {
    expect(formatInstanceNo('PLAN-4043')).toBe('计划 4043')
  })

  it('不符合编号格式的值原样返回，不误伤占位文案', () => {
    expect(formatInstanceNo('审批实例 1')).toBe('审批实例 1')
    expect(formatInstanceNo('待回填')).toBe('待回填')
    expect(formatInstanceNo('')).toBe('')
    expect(formatInstanceNo(null)).toBe('')
    expect(formatInstanceNo(undefined)).toBe('')
  })
})
