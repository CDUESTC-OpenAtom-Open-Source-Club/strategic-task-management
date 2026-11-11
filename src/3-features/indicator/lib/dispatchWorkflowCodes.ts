/**
 * 计划下发审批流程码口径（纯函数，无副作用、无 store 依赖）。
 *
 * ⚠️ 后端契约（2026-11-10 起）：
 * - 学院指标下发（FUNC_TO_COLLEGE，created_by=战略发展部 org35）改用专用流程
 *   **PLAN_DISPATCH_COLLEGE**「Plan下发审批（二级学院）」——三步：
 *   填报人提交 → 战略发展部负责人审批 → 分管校领导审批终审，席位全部在战略部。
 *   后端提交校验**只认新码**（旧码会被 400 拒绝）。
 * - 职能部门下发（STRAT_TO_FUNC）继续走 PLAN_DISPATCH_STRATEGY，前端提交路径不变。
 * - PLAN_DISPATCH_FUNCDEPT 已于 V101 停用，仅用于识别职能部门的历史在审/历史实例
 *   （只读与撤回场景），不再作为提交码。
 *
 * 两条登录角色口径与 5-shared/lib/permissions/strategyDispatchAccess 同源：
 * - 「能不能提交」只看**登录角色**（战略部）；
 * - 「识别哪些历史实例」按登录角色给出各自的期望码集合。
 */
import { STRATEGIC_DEPT_ROLE, type DispatchLoginRole } from '@/5-shared/lib/permissions/strategyDispatchAccess'

/** 学院下发专用审批流程码（2026-11-10 起后端提交校验只认此码） */
export const PLAN_DISPATCH_COLLEGE_WORKFLOW_CODE = 'PLAN_DISPATCH_COLLEGE'

/** 职能部门下发流程码（STRAT_TO_FUNC 链路，保持不变）；亦为存量学院下发的借道码 */
export const PLAN_DISPATCH_STRATEGY_WORKFLOW_CODE = 'PLAN_DISPATCH_STRATEGY'

/** 职能部门→学院下发流程码（V101 已停用，仅用于识别历史实例，不作为提交码） */
export const PLAN_DISPATCH_FUNCDEPT_WORKFLOW_CODE = 'PLAN_DISPATCH_FUNCDEPT'

/**
 * 指标下发页（/distribution）发起下发审批的流程码（按登录角色分流）。
 *
 * - 战略部登录 → 学院下发专用新码（后端只认新码，旧码提交必 400）。
 * - 其余登录角色 → FUNCDEPT：仅用于识别其历史在审实例（只读/撤回场景），
 *   职能部门在本页已无下发提交入口（页面只读），该值不再落提交请求。
 */
export function resolveDispatchSubmitWorkflowCode(loginRole: DispatchLoginRole): string {
  if (loginRole === STRATEGIC_DEPT_ROLE) {
    return PLAN_DISPATCH_COLLEGE_WORKFLOW_CODE
  }
  return PLAN_DISPATCH_FUNCDEPT_WORKFLOW_CODE
}

/**
 * 学院下发链在审实例的期望流程码（审批抽屉 my-tasks 过滤 / 流程详情白名单）。
 *
 * - 战略部登录：新码 + 存量借道码。2026-11-05~2026-11-10 期间学院下发统一借道
 *   PLAN_DISPATCH_STRATEGY，切换上线时其在审实例仍以旧码存在——白名单若不含旧码，
 *   迁移窗口内在审旧实例会被误滤（抽屉空白、审批/撤回不可达）。
 * - 职能部门登录：维持 FUNCDEPT 单码（零变化——其历史实例识别口径不变）。
 */
export function collegeDispatchExpectedWorkflowCodes(loginRole: DispatchLoginRole): string[] {
  if (loginRole === STRATEGIC_DEPT_ROLE) {
    return [PLAN_DISPATCH_COLLEGE_WORKFLOW_CODE, PLAN_DISPATCH_STRATEGY_WORKFLOW_CODE]
  }
  return [PLAN_DISPATCH_FUNCDEPT_WORKFLOW_CODE]
}
