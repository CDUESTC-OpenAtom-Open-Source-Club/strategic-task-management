import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { canCurrentUserHandleTodoEntry } from '@/features/approval/lib/approverMatch'

/**
 * 2026-11-15（审批中心「审批通过/审批驳回」按钮候选人显隐）：
 *
 * <p>线上实测缺陷：学院上报五级链走到「分管职能部门校领导审批」时，学院/归口部门
 * 账号打开审批中心抽屉——操作位显示「审批流已锁定」（canCurrentUserHandlePlanApproval
 * = false，判定正确），但待办卡上的「审批通过/审批驳回」按钮仍然渲染，点击才吃
 * 后端 403「You are not authorized to approve this task」。</p>
 *
 * <p>根因：按钮显隐读的 canCurrentUserHandleReportTodo 是**全局标志**——名下有
 * 任意一条待办就整页点亮所有卡的按钮，且名下无待办时兜底放行
 * hasAnyPlanApprovalRole（持有 ROLE_APPROVER 等任一审批角色即显示）。</p>
 *
 * <p>修复契约：</p>
 * <ul>
 *   <li>逐卡判定：这张卡的当前节点审批人（assigneeId / currentApproverId）
 *       === 当前登录人 id 才显示按钮（后端每步解析唯一审批人——
 *       ApproverResolver.resolveByRoleId 对候选 findFirst，无或签多任务形态，
 *       assignee 相等即候选人判定，与后端 decision 授权同源）；</li>
 *   <li>非候选人：按钮**隐藏**（与撤回按钮铁律同口径：隐藏不置灰），
 *       后端 403 兜底不变；</li>
 *   <li>候选人：按钮正常显示。</li>
 * </ul>
 */

/** 条目工厂（形状与 my-tasks / my-pending 条目对齐） */
const todoEntry = (fields: {
  assigneeId?: number | string | null
  currentApproverId?: number | string | null
}) => ({ instanceId: 9001, entityType: 'PLAN_REPORT', ...fields })

describe('canCurrentUserHandleTodoEntry（待办卡按钮逐条候选人判定）', () => {
  it('当前节点审批人 = 当前登录人 → true（候选人按钮正常显示）', () => {
    expect(canCurrentUserHandleTodoEntry(todoEntry({ assigneeId: 201 }), 201)).toBe(true)
    expect(canCurrentUserHandleTodoEntry(todoEntry({ currentApproverId: 201 }), 201)).toBe(true)
  })

  it('当前节点审批人是别人 → false（非候选人按钮隐藏，不再吃 403）', () => {
    // 线上报场景：链在第 4 级（分管校领导 = 用户 301），学院账号 202 开抽屉
    expect(canCurrentUserHandleTodoEntry(todoEntry({ assigneeId: 301 }), 202)).toBe(false)
    expect(canCurrentUserHandleTodoEntry(todoEntry({ currentApproverId: 301 }), 202)).toBe(false)
  })

  it('currentApproverId（实例当前节点审批人）优先，缺失时回退 assigneeId；两者都缺 → false', () => {
    expect(canCurrentUserHandleTodoEntry(todoEntry({ currentApproverId: 77 }), 77)).toBe(true)
    expect(canCurrentUserHandleTodoEntry(todoEntry({ assigneeId: 77 }), 77)).toBe(true)
    // 两字段不一致（列表 assignee 是已办旧指派、详情是现任审批人）→ 以 currentApproverId 为准
    expect(canCurrentUserHandleTodoEntry({ assigneeId: 201, currentApproverId: 301 }, 301)).toBe(
      true
    )
    expect(canCurrentUserHandleTodoEntry({ assigneeId: 201, currentApproverId: 301 }, 201)).toBe(
      false
    )
    expect(canCurrentUserHandleTodoEntry(todoEntry({}), 77)).toBe(false)
    expect(canCurrentUserHandleTodoEntry(todoEntry({ assigneeId: null }), 77)).toBe(false)
  })

  it('字符串数字归一（后端序列化形状解耦）', () => {
    expect(canCurrentUserHandleTodoEntry(todoEntry({ assigneeId: '201' }), 201)).toBe(true)
    expect(canCurrentUserHandleTodoEntry(todoEntry({ assigneeId: 201 }), '201')).toBe(true)
  })

  it('登录 id 非法（0 / null / undefined / 负数）→ 一律 false', () => {
    const entry = todoEntry({ assigneeId: 201 })
    expect(canCurrentUserHandleTodoEntry(entry, 0)).toBe(false)
    expect(canCurrentUserHandleTodoEntry(entry, null)).toBe(false)
    expect(canCurrentUserHandleTodoEntry(entry, undefined)).toBe(false)
    expect(canCurrentUserHandleTodoEntry(entry, -5)).toBe(false)
  })

  it('同页多卡互不串台：他人在审的卡不影响本人卡的判定（逐条独立）', () => {
    const mine = todoEntry({ assigneeId: 201 })
    const theirs = todoEntry({ assigneeId: 301 })
    expect(canCurrentUserHandleTodoEntry(mine, 201)).toBe(true)
    expect(canCurrentUserHandleTodoEntry(theirs, 201)).toBe(false)
  })
})

describe('审批中心待办卡按钮显隐契约（模型接线，源码断言）', () => {
  const readSource = (relative: string): string =>
    readFileSync(resolve(process.cwd(), relative), 'utf8')

  const drawerModelSource = readSource('src/3-features/approval/model/useApprovalProgressDrawer.ts')
  const drawerTemplateSource = readSource('src/3-features/approval/ui/ApprovalProgressDrawer.vue')

  it('canCurrentUserHandleReportTodo 走逐条候选人判定（canCurrentUserHandleTodoEntry）', () => {
    expect(drawerModelSource).toContain('canCurrentUserHandleTodoEntry')
    const flagBody = drawerModelSource.slice(
      drawerModelSource.indexOf('const canCurrentUserHandleReportTodo = computed'),
      drawerModelSource.indexOf('const canCurrentUserHandleReportTodo = computed') + 700
    )
    expect(flagBody).toContain('canCurrentUserHandleTodoEntry(item, currentUserId.value)')
  })

  it('角色兜底已删除：名下无待办/非候选人时不再因持有审批角色点亮按钮', () => {
    const flagBody = drawerModelSource.slice(
      drawerModelSource.indexOf('const canCurrentUserHandleReportTodo = computed'),
      drawerModelSource.indexOf('const canCurrentUserHandleReportTodo = computed') + 700
    )
    expect(flagBody).not.toContain('hasAnyPlanApprovalRole')
    // 旧全局 some+assignee 判定也已被纯函数替代（避免整页点亮他人在审的卡）
    expect(flagBody).toContain('externalWorkflowTodoItems.value.some')
  })

  it('模板逐卡 v-if（canHandleReportTodoItem(item)），不再用全局标志', () => {
    expect(drawerTemplateSource).toContain('canHandleReportTodoItem(item)')
    expect(drawerTemplateSource).not.toContain('v-if="canCurrentUserHandleReportTodo"')
  })
})

describe('2026-11-15 场景口径更正（归口审核人已办结自己的节点）：live 详情覆盖与缓存失效', () => {
  const readSource = (relative: string): string =>
    readFileSync(resolve(process.cwd(), relative), 'utf8')

  const drawerModelSource = readSource('src/3-features/approval/model/useApprovalProgressDrawer.ts')

  it('reportTodoDetailCards 用实例详情的 currentApproverId 覆盖列表 assignee（旧任务指派不作数）', () => {
    // 归口审核人批完第 3 级后，未刷新清单条目的 assigneeId 还是自己（已办任务的指派），
    // 不能作为「轮到我」的证据——必须以详情的当前活动节点审批人为准（第 4 级分管校领导）
    const mergeBody = drawerModelSource.slice(
      drawerModelSource.indexOf('const reportTodoDetailCards = computed'),
      drawerModelSource.indexOf('const reportTodoDetailCards = computed') + 1400
    )
    expect(mergeBody).toContain('assigneeId: detail.currentApproverId ?? item.assigneeId')
    expect(mergeBody).toContain(
      'currentApproverId: detail.currentApproverId ?? item.currentApproverId'
    )
  })

  it('loadPendingPlanApprovals 清详情缓存并自增纪元（审批推进/退回后判定随活动节点翻转）', () => {
    const loadBody = drawerModelSource.slice(
      drawerModelSource.indexOf('async function loadPendingPlanApprovals'),
      drawerModelSource.indexOf('async function loadPendingPlanApprovals') + 1200
    )
    expect(loadBody).toContain('reportTodoDetailMap.value = {}')
    expect(loadBody).toContain('reportTodoDetailEpoch.value += 1')
  })

  it('详情 watch 源含纪元（卡集合不变也强制重拉）', () => {
    expect(drawerModelSource).toContain('`${reportTodoDetailEpoch.value}|')
  })

  it('合并后的条目走同一逐条判定：已办人不再点亮按钮、退回后当前审批人恢复', () => {
    // 模拟合并结果：审核人(202)已办第 3 级 → 详情覆盖后 approver=校领导(301)；
    // 驳回退回第 3 级 → 详情覆盖后 approver=审核人(202)
    const advanced = { assigneeId: 202, currentApproverId: 301 }
    expect(canCurrentUserHandleTodoEntry(advanced, 202)).toBe(false) // 已办人：按钮隐藏
    expect(canCurrentUserHandleTodoEntry(advanced, 301)).toBe(true) // 现任审批人：按钮正常
    const returned = { assigneeId: 202, currentApproverId: 202 }
    expect(canCurrentUserHandleTodoEntry(returned, 202)).toBe(true) // 退回重审：按钮恢复
  })
})
