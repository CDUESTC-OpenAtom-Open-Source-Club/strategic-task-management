/**
 * 战略部直发学院指标改造 —— 前端权限口径单一事实源（纯函数，无副作用、无 store 依赖）。
 *
 * ⚠️ 两套角色必须分清（本文件所有入参都只接受「真实登录角色」）：
 * - 登录角色（authStore.userRole）：恒等于账号的真实角色。判断「能不能操作」只用它。
 * - 视角角色（viewingRole / props.viewingRole）：战略发展部用部门切换器切到职能部门视角时
 *   会变成 'functional_dept'。判断「数据属于哪个部门」才用它。
 *
 * 历史上把「视角角色 = 战略部」当成了只读开关，导致战略部一切换到职能部门视角就被误锁成
 * 只读，直接违反「职能部门能力补充给战略部」。本模块把两类判定彻底拆开：
 * - 能不能操作 → 登录角色；
 * - 数据归属哪个部门 → 视角部门。
 */

/** 战略发展部（登录角色） */
export const STRATEGIC_DEPT_ROLE = 'strategic_dept'
/** 职能部门（登录角色） */
export const FUNCTIONAL_DEPT_ROLE = 'functional_dept'

/** 登录角色类型（只关心两类，其余角色无下发能力） */
export type DispatchLoginRole = string | null | undefined

/**
 * 「指标下发」页（/distribution）的可参与者。
 *
 * 战略部：操作能力整体承接（新增/编辑/删除/导入/复制/发起下发审批）。
 * 职能部门：保留进入本页的资格，但页面内只读（历史在审计划仍可撤回）。
 */
export function canOperateDistributionPage(loginRole: DispatchLoginRole): boolean {
  return loginRole === STRATEGIC_DEPT_ROLE || loginRole === FUNCTIONAL_DEPT_ROLE
}

/**
 * 「指标下发」页的写操作权限（新增/编辑/删除子指标、导入、复制其它学院指标、发起下发审批）。
 *
 * 改造后下发现由战略发展部统一发起 → 只有战略部有写权限；职能部门在本页只读。
 */
export function canWriteDistributionPage(loginRole: DispatchLoginRole): boolean {
  return loginRole === STRATEGIC_DEPT_ROLE
}

/**
 * 「指标下发」页的撤回权限。
 *
 * 职能部门历史上发起的在审计划仍需要能撤回（否则会卡死在审批中），
 * 因此撤回是本页唯一对职能部门开放的写操作。
 */
export function canWithdrawDistributionPlan(loginRole: DispatchLoginRole): boolean {
  return loginRole === STRATEGIC_DEPT_ROLE || loginRole === FUNCTIONAL_DEPT_ROLE
}

/**
 * 「指标下发」页的只读判定。
 *
 * - 历史快照模式（切换到过往年份）恒为只读；
 * - 登录角色既不是战略部也不是职能部门（理论上进不来）时保守只读。
 *
 * 注意：这里**不**看视角角色——战略部切到职能部门视角时依然可操作。
 */
export function isDistributionPageReadOnly(params: {
  loginRole: DispatchLoginRole
  timeReadOnly: boolean
}): boolean {
  if (params.timeReadOnly) {
    return true
  }
  return !canOperateDistributionPage(params.loginRole)
}

/**
 * 「战略任务管理」页（/strategic-tasks）的写操作权限。
 *
 * 改造后职能部门在该页只读（新增行/双击编辑/发起异动/发起下发/撤回全部禁用）；
 * 战略部保持原有全部能力。
 */
export function canOperateStrategicTaskPage(loginRole: DispatchLoginRole): boolean {
  return loginRole === STRATEGIC_DEPT_ROLE
}

/**
 * 子指标「归属部门」可见性判定（分发页 + 战略任务页共用的同一口径）。
 *
 * - 战略部登录 → 全部可见：口径是「本下发方（战略发展部）+ 存量兼容（职能部门存量）」，
 *   两者并集即全部非战略子指标；否则战略部进入分发页会一条历史子指标都看不到。
 * - 职能部门登录 → 完全沿用改造前的「是否等于当前视角部门」判定（零变化）。
 *
 * @param loginRole 真实登录角色
 * @param ownerMatchesCurrentDept 调用方按本页面既有口径算出的「归属部门 == 当前视角部门」
 */
export function isDispatchOwnerVisible(params: {
  loginRole: DispatchLoginRole
  ownerMatchesCurrentDept: boolean
}): boolean {
  if (params.loginRole === STRATEGIC_DEPT_ROLE) {
    return true
  }
  return params.ownerMatchesCurrentDept
}

/**
 * 「来源部门」筛选是否应当生效（学院指标列表页）。
 *
 * 改造后来源部门可能是「战略发展部」（新量）或「职能部门」（存量）。筛选值一旦与
 * 可见数据完全对不上（例如计划口径算出来只有战略发展部、行上的 ownerDept 仍是存量职能部门），
 * 再按它硬过滤会把学院指标全部滤空——此时不过滤（宁可多显示，不可显示为空）。
 */
export function shouldApplyOwnerDeptFilter(params: {
  filterOwnerDept: string
  matchedCount: number
}): boolean {
  const filter = String(params.filterOwnerDept || '').trim()
  if (!filter) {
    return false
  }
  // 过滤值与任何一行都对不上 → 不过滤（避免把整页滤空）
  return params.matchedCount > 0
}
