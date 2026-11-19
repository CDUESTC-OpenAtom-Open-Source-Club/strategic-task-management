/**
 * 「未完成审核」拦截提示单测（2026-10-30 用户定案：拦截要能一键跳转）。
 *
 * 覆盖：
 * - 后端拦截文案（含批量汇总包装）的识别；
 * - 跳转路由复用审批卡片 resolveApprovalRoute 同一套口径（与
 *   lib/__tests__/approvalNotifications.test.ts 的期望格式同源）；
 * - 非 PLAN_REPORT 实例 / 缺实体 ID 时不解析跳转（回退普通 toast 的前置条件）；
 * - Notification 形态（title「未完成审核」、常驻、message 为 VNode）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VNode } from 'vue'

const mocks = vi.hoisted(() => ({
  elNotification: vi.fn(() => ({ close: vi.fn() }))
}))

vi.mock('element-plus', () => ({
  ElNotification: mocks.elNotification,
  ElButton: { name: 'ElButton' }
}))

import {
  buildAppraisalGuidanceText,
  isUnfinishedAppraisalMessage,
  resolveUnfinishedAppraisalJumpRoute,
  showUnfinishedAppraisalNotice
} from '../unfinishedAppraisalNotice'

/** 后端 buildUnappraisedAuditMessage 的原文样例（BusinessConflictException 透传） */
const BACKEND_BLOCK_MESSAGE =
  '未完成审核：还有 2 项指标的审核进度未鉴定（『教学运行质量』『科研产出增长率』）。' +
  '请到 计算机学院 的指标填报页完成全部指标的审核进度鉴定，再回到审批中心通过。'

describe('isUnfinishedAppraisalMessage', () => {
  it('matches the backend interception message', () => {
    expect(isUnfinishedAppraisalMessage(BACKEND_BLOCK_MESSAGE)).toBe(true)
  })

  it('matches the batch summary wrapper around the backend message', () => {
    expect(isUnfinishedAppraisalMessage(`有 1 项审批未成功：${BACKEND_BLOCK_MESSAGE}`)).toBe(true)
  })

  it('does not match ordinary approval errors', () => {
    expect(isUnfinishedAppraisalMessage('资源冲突：实例状态已变更，请刷新后重试')).toBe(false)
    expect(isUnfinishedAppraisalMessage('审批失败')).toBe(false)
    expect(isUnfinishedAppraisalMessage('')).toBe(false)
    expect(isUnfinishedAppraisalMessage(null)).toBe(false)
  })
})

describe('resolveUnfinishedAppraisalJumpRoute', () => {
  beforeEach(() => {
    mocks.elNotification.mockClear()
  })

  it('reuses the approval-card route resolution for report todo cards (college -> functional dept)', () => {
    // 上报待办卡原样记录：source/target 是「下发方向」，提交方（填报部门）= targetOrg
    // 2026-11-05：学院上报链未停用，其「分管职能部门」席位 scope 取自 plan.createdByOrgId，
    // 存量计划 createdBy=职能部门 → 待办仍会派给职能部门；且只有 /distribution 的审批抽屉
    // 能加载该流程实例、撤回也在该页 → 职能部门仍落 /distribution（与审批卡片同口径）。
    const route = resolveUnfinishedAppraisalJumpRoute(
      {
        entityType: 'PLAN_REPORT',
        entityId: 321,
        instanceId: 654,
        sourceOrgName: '继续教育部',
        targetOrgName: '计算机学院'
      },
      {
        viewerRole: 'functional_dept',
        currentDepartmentName: '继续教育部',
        fallbackDepartmentName: '教务处'
      }
    )

    expect(route).toBe(
      '/distribution?openApproval=1&approvalEntityType=PLAN_REPORT&approvalEntityId=321&approvalInstanceId=654&approvalDepartment=%E8%AE%A1%E7%AE%97%E6%9C%BA%E5%AD%A6%E9%99%A2&approvalSourceOrg=%E7%BB%A7%E7%BB%AD%E6%95%99%E8%82%B2%E9%83%A8&approvalTargetOrg=%E8%AE%A1%E7%AE%97%E6%9C%BA%E5%AD%A6%E9%99%A2'
    )
  })

  it('routes secondary college viewers to the indicators fill page', () => {
    const route = resolveUnfinishedAppraisalJumpRoute(
      {
        entityType: 'PLAN_REPORT',
        entityId: 88,
        targetOrgName: '计算机学院'
      },
      { viewerRole: 'secondary_college' }
    )

    expect(route).toBe(
      '/indicators?openApproval=1&approvalEntityType=PLAN_REPORT&approvalEntityId=88&approvalDepartment=%E8%AE%A1%E7%AE%97%E6%9C%BA%E5%AD%A6%E9%99%A2&approvalTargetOrg=%E8%AE%A1%E7%AE%97%E6%9C%BA%E5%AD%A6%E9%99%A2'
    )
  })

  it('accepts workflow-detail field aliases (businessEntityType/businessEntityId)', () => {
    const route = resolveUnfinishedAppraisalJumpRoute(
      {
        businessEntityType: 'plan_report',
        businessEntityId: '77',
        instanceId: '901'
      },
      { viewerRole: 'secondary_college' }
    )

    expect(route).toBe(
      '/indicators?openApproval=1&approvalEntityType=PLAN_REPORT&approvalEntityId=77&approvalInstanceId=901'
    )
  })

  it('returns null for non-PLAN_REPORT contexts (no jump promised)', () => {
    expect(
      resolveUnfinishedAppraisalJumpRoute(
        { entityType: 'PLAN', entityId: 5 },
        { viewerRole: 'functional_dept' }
      )
    ).toBeNull()
    expect(
      resolveUnfinishedAppraisalJumpRoute(
        { entityType: 'INDICATOR', entityId: 5 },
        { viewerRole: 'functional_dept' }
      )
    ).toBeNull()
  })

  it('returns null when the entity id is missing or the instance is absent', () => {
    expect(
      resolveUnfinishedAppraisalJumpRoute(
        { entityType: 'PLAN_REPORT' },
        { viewerRole: 'functional_dept' }
      )
    ).toBeNull()
    expect(resolveUnfinishedAppraisalJumpRoute(null)).toBeNull()
    expect(resolveUnfinishedAppraisalJumpRoute(undefined)).toBeNull()
  })
})

describe('showUnfinishedAppraisalNotice', () => {
  beforeEach(() => {
    mocks.elNotification.mockClear()
  })

  it('shows a sticky notification titled 未完成审核 with the raw backend message', () => {
    const onJump = vi.fn()
    showUnfinishedAppraisalNotice({
      message: BACKEND_BLOCK_MESSAGE,
      routeTarget: '/indicators?openApproval=1',
      onJump
    })

    expect(mocks.elNotification).toHaveBeenCalledTimes(1)
    const options = mocks.elNotification.mock.calls[0][0] as {
      title: string
      type: string
      duration: number
      showClose: boolean
      message: VNode
    }
    expect(options.title).toBe('未完成审核')
    expect(options.type).toBe('warning')
    expect(options.duration).toBe(0)
    expect(options.showClose).toBe(true)
    // message 是 VNode（原文 + 「去完成鉴定」按钮），且原文原样保留在其中
    expect(typeof options.message).toBe('object')
    expect(JSON.stringify(options.message)).toContain('未完成审核')
  })

  it('renders the extra operation guidance when provided', () => {
    const onJump = vi.fn()
    showUnfinishedAppraisalNotice({
      message: BACKEND_BLOCK_MESSAGE,
      guidance: '操作指引：请到顶部「指标审批」页签……',
      routeTarget: '/distribution?openApproval=1',
      onJump
    })

    const options = mocks.elNotification.mock.calls[0][0] as { message: VNode }
    expect(JSON.stringify(options.message)).toContain('指标审批')
  })
})

/**
 * 2026-11-18（用户定案：指引必须指对页面）——操作指引文案锁定。
 *
 * 背景（实测）：后端 buildUnappraisedAuditMessage 的原文写「请到 XX 的**指标填报页**
 * 完成全部指标的审核进度鉴定」，但「指标填报页」（/indicators）对职能部门审批人
 * **不显示**待鉴定的学院子指标行（实测：归口部门账号在 /indicators 只有本部门 5 行，
 * 看不到上报学院的 2 行），按原文指引会走到无法完成鉴定的页面。
 * 各角色真实的评级入口：
 * ① 职能部门审批人 → 顶部「指标审批」页签（/distribution），选学院后逐行点「审核进度」；
 * ② 战略发展部审批人 → 「战略任务管理 → 二级学院战略任务管理」页签，逐行点「审核进度」；
 * ③ 二级学院 → 「指标填报」页签。
 */
describe('buildAppraisalGuidanceText', () => {
  it('职能部门审批人：指向「指标审批」页签（不是「指标填报页」）', () => {
    const text = buildAppraisalGuidanceText('functional_dept')
    expect(text).toContain('指标审批')
    expect(text).toContain('审核进度')
    expect(text).not.toContain('指标填报')
  })

  it('战略发展部：指向「战略任务管理 → 二级学院战略任务管理」页签', () => {
    const text = buildAppraisalGuidanceText('strategic_dept')
    expect(text).toContain('战略任务管理')
    expect(text).toContain('二级学院战略任务管理')
    expect(text).toContain('审核进度')
  })

  it('二级学院：指向「指标填报」页签', () => {
    const text = buildAppraisalGuidanceText('secondary_college')
    expect(text).toContain('指标填报')
    expect(text).toContain('审核进度')
  })

  it('角色缺失/未知时回退到职能部门口径（上报链最常见的评级节点）', () => {
    expect(buildAppraisalGuidanceText(null)).toContain('指标审批')
    expect(buildAppraisalGuidanceText(undefined)).toContain('指标审批')
    expect(buildAppraisalGuidanceText('unknown_role')).toContain('指标审批')
  })
})
