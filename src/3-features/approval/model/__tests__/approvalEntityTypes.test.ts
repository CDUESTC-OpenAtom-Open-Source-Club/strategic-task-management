import { describe, expect, it } from 'vitest'
import {
  isMutationEntityType,
  normalizeApprovalEntityType,
  resolveExternalTodoCard
} from '../approvalEntityTypes'

describe('approvalEntityTypes', () => {
  it('实体类型归一化（大小写不敏感）', () => {
    expect(normalizeApprovalEntityType('plan')).toBe('PLAN')
    expect(normalizeApprovalEntityType('PLAN_REPORT')).toBe('PLAN_REPORT')
    expect(normalizeApprovalEntityType(' indicator ')).toBe('INDICATOR')
    expect(normalizeApprovalEntityType('task')).toBe('TASK')
    expect(normalizeApprovalEntityType('unknown')).toBe('')
    expect(normalizeApprovalEntityType(null)).toBe('')
  })

  it('异动实体识别：指标异动与任务异动同口径', () => {
    expect(isMutationEntityType('INDICATOR')).toBe(true)
    expect(isMutationEntityType('TASK')).toBe(true)
    expect(isMutationEntityType('PLAN_REPORT')).toBe(false)
    expect(isMutationEntityType('PLAN')).toBe(false)
  })

  // 2026-10-27 用户反馈：异动实例标题缺失时退化成「上报审批」占位文案
  it('异动实例标题归一为「指标异动审批 · 源 -> 目标」', () => {
    const card = resolveExternalTodoCard({
      instance: {
        entityType: 'INDICATOR',
        entityId: 2041,
        planName: '开展通识教育课程体系改革',
        sourceOrgName: '战略发展部',
        targetOrgName: '教务处'
      }
    })
    expect(card.routeTitle).toBe('指标异动审批 · 战略发展部 -> 教务处')
    expect(card.title).toBe('开展通识教育课程体系改革')
  })

  it('任务异动标题归一为「任务异动审批 · 源 -> 目标」', () => {
    const card = resolveExternalTodoCard({
      instance: {
        entityType: 'TASK',
        entityId: 41003,
        sourceOrgName: '战略发展部',
        targetOrgName: '教务处'
      }
    })
    expect(card.routeTitle).toBe('任务异动审批 · 战略发展部 -> 教务处')
    // 无实体名时标题退回 routeTitle，不留空
    expect(card.title).toBe('任务异动审批 · 战略发展部 -> 教务处')
  })

  it('当前抽屉正在看的那个异动实体不重复出简卡', () => {
    const card = resolveExternalTodoCard({
      instance: { entityType: 'INDICATOR', entityId: 2041 },
      contextEntityType: 'INDICATOR',
      contextEntityId: 2041
    })
    expect(card.__suppressTodoCard).toBe(true)
  })

  it('非异动实体（上报/计划）保持原样', () => {
    const instance = { entityType: 'PLAN_REPORT', entityId: 9, planName: '202601 月报' }
    const card = resolveExternalTodoCard({ instance })
    expect(card).toBe(instance)
    expect(card.__suppressTodoCard).toBeUndefined()
  })

  it('流向信息缺失时不编造目标，退回纯异动标签', () => {
    const card = resolveExternalTodoCard({
      instance: { entityType: 'INDICATOR', entityId: 2041, planName: '某指标' }
    })
    expect(card.routeTitle).toBe('指标异动审批')
  })
})
