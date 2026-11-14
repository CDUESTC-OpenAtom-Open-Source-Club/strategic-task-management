import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 2026-11-14（P1 配套缺口）：学院子指标异动的「撤回异动」入口契约。
 *
 * <p>缺陷（真机实测）：学院新增行发起的异动（source=战略发展部、target=学院）
 * 只落在链下学院追回清单（departmentChainMutationPendingApprovals）——主清单
 * （按职能部门 orgId 查询）查不到这类实例。旧口径的
 * canWithdrawMutationInFlight / handleWithdrawMutationBatch 只读主清单 →
 * 工具栏「撤回异动」按钮对这类批次恒置灰（title「当前状态不可操作」），
 * 发起人没有任何 UI 入口可撤回；审批中心抽屉的异动卡也没有撤回动作。</p>
 *
 * <p>修法（最小）：撤回判定与批次归组都改为主清单 + 追回清单**合并**
 * （与 isCollegeMutationApprovalInFlight 的既有合并口径同款；两份清单条目形状一致）。
 * 职能页签既有批次（主清单）判定不变；every() 的发起人比对与撤回窗口（不含
 * 终审/分管校领导）逐条不变。</p>
 */

const readSource = (relative: string): string =>
  readFileSync(resolve(process.cwd(), relative), 'utf8')

const modelSource = readSource('src/3-features/task/model/useStrategicTaskView.ts')

describe('P1 配套：学院子指标异动的撤回入口合并判定', () => {
  it('canWithdrawMutationInFlight 读主清单 + 追回清单的合并集合（非空才判定）', () => {
    const body = modelSource.slice(
      modelSource.indexOf('const canWithdrawMutationInFlight = computed'),
      modelSource.indexOf('const canWithdrawMutationInFlight = computed') + 2400
    )
    expect(body).toContain('...departmentMutationPendingApprovals.value')
    expect(body).toContain('...departmentChainMutationPendingApprovals.value')
    expect(body).toContain('if (pendingApprovals.length === 0)')
    // 发起人比对与撤回窗口逐条不变
    expect(body).toContain('submitterName !== currentUserName')
    expect(body).toContain("!stepName.includes('终审') && !stepName.includes('分管校领导')")
  })

  it('不再只以职能页签主清单作为撤回判定的前置开关', () => {
    const body = modelSource.slice(
      modelSource.indexOf('const canWithdrawMutationInFlight = computed'),
      modelSource.indexOf('const canWithdrawMutationInFlight = computed') + 2400
    )
    expect(body).not.toContain('if (!isMutationApprovalInFlight.value)')
  })

  it('handleWithdrawMutationBatch 的批次归组覆盖两份清单（学院批次能成组）', () => {
    const body = modelSource.slice(
      modelSource.indexOf('const handleWithdrawMutationBatch = async'),
      modelSource.indexOf('const handleWithdrawMutationBatch = async') + 1600
    )
    expect(body).toContain('...departmentMutationPendingApprovals.value')
    expect(body).toContain('...departmentChainMutationPendingApprovals.value')
    expect(body).toContain('batchGroups')
  })

  it('既有主清单引用未被移除（职能页签口径不回归）', () => {
    expect(modelSource).toContain('departmentMutationPendingApprovals.value.length > 0')
    expect(modelSource).toContain(
      'const isMutationApprovalInFlight = computed(\n    () => departmentMutationPendingApprovals.value.length > 0\n  )'
    )
  })
})
