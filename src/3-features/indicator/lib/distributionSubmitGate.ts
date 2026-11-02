/**
 * 「发起下发审批」按钮锁定原因（2026-10-31 用户定案「灰而可点」）。
 *
 * 锁本身的作用域与判定逻辑不变（异动期间锁下发是正确设计），只是把
 * 「点了没反应」升级为「点击当场弹第一条命中原因」：
 * - 本模块是纯函数，同时供三处使用：按钮置灰判定、悬停 title、点击 gate toast——
 *   单一事实源，条件优先级只有一份；
 * - 文案口径（说人话、无内部 ID、最少化）：异动锁报「学院名 · 当前环节名」，
 *   锁信号缺名字/环节名时降级为不带括号的短句，绝不出现 Plan N / 实例 ID。
 */

export interface DistributionSubmitGateInput {
  /** 历史快照模式只读 */
  isReadOnly: boolean
  /** 当前部门在组织表中匹配到有效组织 */
  hasDepartmentOrg: boolean
  /** 当前登录人是本部门组织下的填报人 */
  canCurrentUserSubmit: boolean
  /** 本部门指标异动在审（target_org=本部门） */
  functionalDeptMutationInFlight: boolean
  /** 任意学院子计划异动在审（级联全锁，target_org_type=academic） */
  collegeMutationInFlight: boolean
  /** 学院级联锁命中的异动学院名（锁信号缺失时为空 → 文案降级） */
  collegeMutationLockCollegeName?: string | null
  /** 学院级联锁命中的异动当前环节名（锁信号缺失时为空 → 文案降级） */
  collegeMutationLockStepName?: string | null
  /** 本部门异动锁命中的当前环节名（锁信号缺失时为空 → 文案降级） */
  functionalMutationLockStepName?: string | null
  /** 选中学院已有子指标 */
  hasChildIndicators: boolean
  /** 选中学院基础性任务子指标权重合计 */
  collegeTotalWeight: number
  /** 下发请求在途 */
  isBatchDistributing: boolean
}

/** 括号补充段：「学院名 · 环节名」，两者皆缺时返回空串（整段降级） */
const buildMutationLockDetail = (orgName?: string | null, stepName?: string | null): string => {
  return [String(orgName || '').trim(), String(stepName || '').trim()].filter(Boolean).join(' · ')
}

/**
 * 按条件优先级取第一条命中的锁定原因；全部通过返回空串。
 * 优先级与后端守卫口径一致：状态门 → 异动锁 → 内容门 → 在途请求。
 */
export function resolveDistributionSubmitLockReason(input: DistributionSubmitGateInput): string {
  if (input.isReadOnly) {
    return '历史快照为只读状态，暂不能发起下发审批'
  }

  if (!input.hasDepartmentOrg) {
    return '当前部门未在组织表中匹配到有效组织，暂不能发起下发审批'
  }

  if (!input.canCurrentUserSubmit) {
    return '只有当前部门组织下的填报人才可以发起下发审批'
  }

  // 本部门指标异动在审：报环节名（有则带括号），说清是谁在卡
  if (input.functionalDeptMutationInFlight) {
    const detail = buildMutationLockDetail(null, input.functionalMutationLockStepName)
    return detail
      ? `有本部门指标异动正在审批（${detail}），期间暂不能发起下发审批`
      : '有本部门指标异动正在审批，期间暂不能发起下发审批'
  }

  // 学院级联全锁：报「学院名 · 环节名」，缺则降级为短句（绝不出现实例 ID）
  if (input.collegeMutationInFlight) {
    const detail = buildMutationLockDetail(
      input.collegeMutationLockCollegeName,
      input.collegeMutationLockStepName
    )
    return detail
      ? `有学院指标异动正在审批（${detail}），期间暂不能发起学院下发审批`
      : '有学院指标异动正在审批，期间暂不能发起学院下发审批'
  }

  if (!input.hasChildIndicators) {
    return '请先为该学院添加子指标'
  }

  // 跟随页面既有口径：同时覆盖「未满 100」与「超 100」两种情况
  if (input.collegeTotalWeight !== 100) {
    return '仅当基础性任务下子指标权重合计恰好为 100 时，才可以下发'
  }

  if (input.isBatchDistributing) {
    return '正在下发中，请稍候'
  }

  return ''
}
