import { describe, expect, it } from 'vitest'
import {
  canCurrentUserHandleMutationEntry,
  normalizeWorkflowStepMatchKey
} from '@/features/task/lib/mutationApprovalHandleable'

/**
 * 2026-10-30「处理审批」按钮名单化判定用例。
 * 场景锚定用户真机反馈：填报人（战略部管理员，userId=901，组织 35）发起异动后，
 * 当前节点「战略发展部负责人审批」的可审批成员是三位负责人（负责人1/负责人2/负责人[演示]，
 * userId 101/102/103，均属组织 35）；填报人与负责人同属组织 35，旧组织级匹配误点亮。
 */
const HEAD_CANDIDATES = [
  { userId: 101, realName: '负责人1', username: 'fuzer1', orgId: 35 },
  { userId: 102, realName: '负责人2', username: 'fuzer2', orgId: 35 },
  { userId: 103, realName: '负责人[演示]', username: 'fuzer_demo', orgId: 35 }
]

const REPORTER = { userId: 901, userName: '战略部管理员', orgId: 35 }
const HEAD_TWO = { userId: 102, userName: '负责人2', orgId: 35 }

describe('task/lib/mutationApprovalHandleable', () => {
  describe('canCurrentUserHandleMutationEntry', () => {
    it('候选名单含我（按 userId 匹配）→ true', () => {
      const entry = {
        approverOrgId: 35,
        currentStepCandidates: HEAD_CANDIDATES,
        workflowDetail: null
      }
      expect(canCurrentUserHandleMutationEntry(entry, HEAD_TWO)).toBe(true)
    })

    it('候选名单含我（按姓名 realName 匹配）→ true', () => {
      const entry = {
        approverOrgId: '35',
        currentStepCandidates: HEAD_CANDIDATES,
        workflowDetail: null
      }
      expect(
        canCurrentUserHandleMutationEntry(entry, { userId: 0, userName: '负责人2', orgId: 35 })
      ).toBe(true)
    })

    it('候选名单含我（按 username 匹配、userId 为数字字符串）→ true', () => {
      const entry = {
        approverOrgId: 35,
        currentStepCandidates: HEAD_CANDIDATES,
        workflowDetail: null
      }
      expect(
        canCurrentUserHandleMutationEntry(entry, { userId: '101', userName: '无人', orgId: 35 })
      ).toBe(true)
      expect(
        canCurrentUserHandleMutationEntry(entry, { userId: 999, userName: 'fuzer_demo', orgId: 35 })
      ).toBe(true)
    })

    it('不含我（同组织不同角色：填报人 vs 三位负责人，用户缺陷场景）→ false', () => {
      const entry = {
        approverOrgId: 35,
        currentStepCandidates: HEAD_CANDIDATES,
        workflowDetail: {
          currentApproverId: 101,
          currentApproverName: '负责人1',
          tasks: [{ status: 'PENDING', assigneeId: 101, assigneeName: '负责人1' }]
        }
      }
      expect(canCurrentUserHandleMutationEntry(entry, REPORTER)).toBe(false)
    })

    it('名单存在且我不在其中时，同组织不再兜底（缺陷不复发）→ false', () => {
      const entry = {
        approverOrgId: 35,
        currentStepCandidates: HEAD_CANDIDATES
      }
      expect(canCurrentUserHandleMutationEntry(entry, REPORTER)).toBe(false)
    })

    it('无候选人数据（无预览名单、无 workflowDetail）→ 按组织兜底 true', () => {
      const entry = { approverOrgId: 35 }
      expect(canCurrentUserHandleMutationEntry(entry, REPORTER)).toBe(true)
    })

    it('workflowDetail 缺失（详情加载失败）且名单为空数组 → 按组织兜底 true', () => {
      const entry = { approverOrgId: '35', currentStepCandidates: [], workflowDetail: undefined }
      expect(canCurrentUserHandleMutationEntry(entry, REPORTER)).toBe(true)
    })

    it('名单缺失但详情已定审批人是我（userId）→ true', () => {
      const entry = {
        approverOrgId: 35,
        workflowDetail: {
          currentApproverId: 901,
          currentApproverName: '战略部管理员',
          tasks: []
        }
      }
      expect(canCurrentUserHandleMutationEntry(entry, REPORTER)).toBe(true)
    })

    it('名单缺失但详情在途任务（PENDING）指派人是别人、我同组织 → false（名单优先于组织）', () => {
      const entry = {
        approverOrgId: 35,
        workflowDetail: {
          tasks: [
            { status: 'COMPLETED', assigneeId: 101, assigneeName: '负责人1' },
            { status: 'PENDING', assigneeId: 102, assigneeName: '负责人2' }
          ]
        }
      }
      expect(canCurrentUserHandleMutationEntry(entry, REPORTER)).toBe(false)
      expect(canCurrentUserHandleMutationEntry(entry, HEAD_TWO)).toBe(true)
    })

    it('详情实例级审批人缺失时，取 PENDING 任务指派人姓名匹配 → true', () => {
      const entry = {
        approverOrgId: 35,
        workflowDetail: {
          tasks: [{ status: 'PENDING', assigneeName: '负责人2' }]
        }
      }
      expect(
        canCurrentUserHandleMutationEntry(entry, { userId: 0, userName: '负责人2', orgId: 35 })
      ).toBe(true)
    })

    it('预览名单组织与节点审批组织全部对不上（口径漂移防护）→ 弃用名单走兜底 true', () => {
      const entry = {
        approverOrgId: 35,
        currentStepCandidates: [
          { userId: 201, realName: '学院审核人', orgId: 12 },
          { userId: 202, realName: '学院审核人2', orgId: 12 }
        ],
        workflowDetail: null
      }
      expect(canCurrentUserHandleMutationEntry(entry, REPORTER)).toBe(true)
    })

    it('预览候选缺组织信息时信任名单本身 → 不在同组织但在名单内 true', () => {
      const entry = {
        approverOrgId: 35,
        currentStepCandidates: [{ userId: 102, realName: '负责人2' }]
      }
      expect(canCurrentUserHandleMutationEntry(entry, HEAD_TWO)).toBe(true)
      expect(canCurrentUserHandleMutationEntry(entry, REPORTER)).toBe(false)
    })

    it('无身份（无 userId 且无姓名）且名单存在 → false；名单缺失时仍按组织兜底', () => {
      const withList = { approverOrgId: 35, currentStepCandidates: HEAD_CANDIDATES }
      expect(canCurrentUserHandleMutationEntry(withList, { orgId: 35 })).toBe(false)

      const withoutList = { approverOrgId: 35 }
      expect(canCurrentUserHandleMutationEntry(withoutList, { orgId: 35 })).toBe(true)
    })

    it('条目或用户为空 → false', () => {
      expect(canCurrentUserHandleMutationEntry(null, REPORTER)).toBe(false)
      expect(canCurrentUserHandleMutationEntry(undefined, undefined)).toBe(false)
      expect(canCurrentUserHandleMutationEntry({ approverOrgId: 35 }, null)).toBe(false)
    })

    it('组织不一致且无名单 → false（既有口径不变）', () => {
      const entry = { approverOrgId: 12 }
      expect(canCurrentUserHandleMutationEntry(entry, REPORTER)).toBe(false)
    })
  })

  describe('normalizeWorkflowStepMatchKey', () => {
    it('去空白、去括号内容、统一大写', () => {
      expect(normalizeWorkflowStepMatchKey(' 战略发展部负责人审批 ')).toBe('战略发展部负责人审批')
      expect(normalizeWorkflowStepMatchKey('职能部门审批（学院）')).toBe('职能部门审批')
      expect(normalizeWorkflowStepMatchKey('Dept Head (College) Approval')).toBe('DEPTHEADAPPROVAL')
      expect(normalizeWorkflowStepMatchKey(null)).toBe('')
    })
  })
})
