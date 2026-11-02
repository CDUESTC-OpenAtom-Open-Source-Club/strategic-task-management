import { describe, expect, it } from 'vitest'
import { resolveDistributionSubmitLockReason } from '../distributionSubmitGate'

/** 全部通过基线：仅缺权重合计（默认 100），其余条件逐条翻转验证 */
const passInput = {
  isReadOnly: false,
  hasDepartmentOrg: true,
  canCurrentUserSubmit: true,
  functionalDeptMutationInFlight: false,
  collegeMutationInFlight: false,
  hasChildIndicators: true,
  collegeTotalWeight: 100,
  isBatchDistributing: false
}

describe('distributionSubmitGate (2026-10-31「灰而可点」定案)', () => {
  it('条件全满足时无锁定原因（按钮可点、走原下发流程）', () => {
    expect(resolveDistributionSubmitLockReason(passInput)).toBe('')
  })

  it('状态门优先级最高：只读 / 组织未匹配 / 非本部门填报人', () => {
    expect(resolveDistributionSubmitLockReason({ ...passInput, isReadOnly: true })).toBe(
      '历史快照为只读状态，暂不能发起下发审批'
    )

    expect(resolveDistributionSubmitLockReason({ ...passInput, hasDepartmentOrg: false })).toBe(
      '当前部门未在组织表中匹配到有效组织，暂不能发起下发审批'
    )

    expect(resolveDistributionSubmitLockReason({ ...passInput, canCurrentUserSubmit: false })).toBe(
      '只有当前部门组织下的填报人才可以发起下发审批'
    )
  })

  it('本部门异动锁：带环节名；环节名缺失时降级为短句', () => {
    expect(
      resolveDistributionSubmitLockReason({
        ...passInput,
        functionalDeptMutationInFlight: true,
        functionalMutationLockStepName: '职能部门审批人审批'
      })
    ).toBe('有本部门指标异动正在审批（职能部门审批人审批），期间暂不能发起下发审批')

    expect(
      resolveDistributionSubmitLockReason({
        ...passInput,
        functionalDeptMutationInFlight: true,
        functionalMutationLockStepName: ''
      })
    ).toBe('有本部门指标异动正在审批，期间暂不能发起下发审批')
  })

  it('学院级联锁：报「学院名 · 当前环节名」；缺学院名/环节名时降级为不带括号短句', () => {
    expect(
      resolveDistributionSubmitLockReason({
        ...passInput,
        collegeMutationInFlight: true,
        collegeMutationLockCollegeName: '计算机学院',
        collegeMutationLockStepName: '职能部门审批人审批'
      })
    ).toBe('有学院指标异动正在审批（计算机学院 · 职能部门审批人审批），期间暂不能发起学院下发审批')

    // 只有学院名：只带学院名
    expect(
      resolveDistributionSubmitLockReason({
        ...passInput,
        collegeMutationInFlight: true,
        collegeMutationLockCollegeName: '计算机学院',
        collegeMutationLockStepName: null
      })
    ).toBe('有学院指标异动正在审批（计算机学院），期间暂不能发起学院下发审批')

    // 学院名/环节名都没有（锁信号缺字段）：整体降级，绝不出现内部 ID
    expect(
      resolveDistributionSubmitLockReason({
        ...passInput,
        collegeMutationInFlight: true,
        collegeMutationLockCollegeName: null,
        collegeMutationLockStepName: null
      })
    ).toBe('有学院指标异动正在审批，期间暂不能发起学院下发审批')

    // 空白字符等同缺失
    expect(
      resolveDistributionSubmitLockReason({
        ...passInput,
        collegeMutationInFlight: true,
        collegeMutationLockCollegeName: '   ',
        collegeMutationLockStepName: undefined
      })
    ).toBe('有学院指标异动正在审批，期间暂不能发起学院下发审批')
  })

  it('异动锁优先于内容门：锁在审时不报权重/子指标问题，且只报第一条', () => {
    const reason = resolveDistributionSubmitLockReason({
      ...passInput,
      functionalDeptMutationInFlight: true,
      collegeMutationInFlight: true,
      collegeMutationLockCollegeName: '商学院',
      collegeMutationLockStepName: '分管校领导审批',
      hasChildIndicators: false,
      collegeTotalWeight: 0
    })
    // 本部门锁优先级高于学院级联锁：只弹第一条命中
    expect(reason).toBe('有本部门指标异动正在审批，期间暂不能发起下发审批')
    expect(reason).not.toContain('商学院')
  })

  it('无子指标：提示先添加子指标（优先于权重合计）', () => {
    expect(resolveDistributionSubmitLockReason({ ...passInput, hasChildIndicators: false })).toBe(
      '请先为该学院添加子指标'
    )

    // 无子指标时权重合计必然为 0：应报「先添加」而不是「权重」
    expect(
      resolveDistributionSubmitLockReason({
        ...passInput,
        hasChildIndicators: false,
        collegeTotalWeight: 0
      })
    ).toBe('请先为该学院添加子指标')
  })

  it('权重合计不满足：沿用页面既有口径（同时覆盖未满 100 与超 100）', () => {
    expect(resolveDistributionSubmitLockReason({ ...passInput, collegeTotalWeight: 90 })).toBe(
      '仅当基础性任务下子指标权重合计恰好为 100 时，才可以下发'
    )

    expect(resolveDistributionSubmitLockReason({ ...passInput, collegeTotalWeight: 110 })).toBe(
      '仅当基础性任务下子指标权重合计恰好为 100 时，才可以下发'
    )
  })

  it('下发请求在途：提示稍候', () => {
    expect(resolveDistributionSubmitLockReason({ ...passInput, isBatchDistributing: true })).toBe(
      '正在下发中，请稍候'
    )
  })
})
