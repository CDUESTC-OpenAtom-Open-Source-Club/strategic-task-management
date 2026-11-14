import { describe, expect, it } from 'vitest'
import {
  PLAN_DISPATCH_COLLEGE_WORKFLOW_CODE,
  PLAN_DISPATCH_FUNCDEPT_WORKFLOW_CODE,
  PLAN_DISPATCH_STRATEGY_WORKFLOW_CODE,
  collegeDispatchExpectedWorkflowCodes,
  resolveDispatchSubmitWorkflowCode
} from '../dispatchWorkflowCodes'

/**
 * 学院下发专用审批流程 PLAN_DISPATCH_COLLEGE（2026-11-10）契约用例。
 *
 * 后端契约：学院指标下发（FUNC_TO_COLLEGE，created_by=战略发展部 org35）提交
 * 只认新码 PLAN_DISPATCH_COLLEGE（旧码 400 拒绝）；职能部门下发
 * （STRAT_TO_FUNC）继续走 PLAN_DISPATCH_STRATEGY，前端零变化。
 */
describe('dispatchWorkflowCodes', () => {
  it('流程码字面量与后端流程定义严格一致（提交校验只认新码，拼错即 400）', () => {
    expect(PLAN_DISPATCH_COLLEGE_WORKFLOW_CODE).toBe('PLAN_DISPATCH_COLLEGE')
    expect(PLAN_DISPATCH_STRATEGY_WORKFLOW_CODE).toBe('PLAN_DISPATCH_STRATEGY')
    expect(PLAN_DISPATCH_FUNCDEPT_WORKFLOW_CODE).toBe('PLAN_DISPATCH_FUNCDEPT')
  })

  it('提交码按登录角色分流：战略部 → 学院下发新码', () => {
    expect(resolveDispatchSubmitWorkflowCode('strategic_dept')).toBe('PLAN_DISPATCH_COLLEGE')
  })

  it('提交码按登录角色分流：非战略部仍取 FUNCDEPT（仅识别历史实例，不落提交）', () => {
    // 职能部门登录口径零变化（V101 起该码只用于历史在审实例识别）
    expect(resolveDispatchSubmitWorkflowCode('functional_dept')).toBe('PLAN_DISPATCH_FUNCDEPT')
    // 视角角色不参与判定：战略部切到职能部门视角仍是登录角色口径
    expect(resolveDispatchSubmitWorkflowCode('secondary_college')).toBe('PLAN_DISPATCH_FUNCDEPT')
    expect(resolveDispatchSubmitWorkflowCode(null)).toBe('PLAN_DISPATCH_FUNCDEPT')
    expect(resolveDispatchSubmitWorkflowCode(undefined)).toBe('PLAN_DISPATCH_FUNCDEPT')
  })

  it('战略部期望码 = 学院下发新码 + 存量借道码（迁移窗口内在审旧实例不被误滤）', () => {
    expect(collegeDispatchExpectedWorkflowCodes('strategic_dept')).toEqual([
      'PLAN_DISPATCH_COLLEGE',
      'PLAN_DISPATCH_STRATEGY'
    ])
  })

  it('职能部门期望码维持 FUNCDEPT 单码（零变化）', () => {
    expect(collegeDispatchExpectedWorkflowCodes('functional_dept')).toEqual([
      'PLAN_DISPATCH_FUNCDEPT'
    ])
    expect(collegeDispatchExpectedWorkflowCodes(null)).toEqual(['PLAN_DISPATCH_FUNCDEPT'])
  })
})
