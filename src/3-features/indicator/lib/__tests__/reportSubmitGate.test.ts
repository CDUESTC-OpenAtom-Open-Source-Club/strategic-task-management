import { describe, expect, it } from 'vitest'
import { resolveReportSubmitLockReason } from '../reportSubmitGate'

/** 全部通过基线：有指标、无异动锁、自评齐全 */
const passInput = {
  isReadOnly: false,
  hasIndicators: true,
  mutationInFlight: false,
  missingSelfRatingCount: 0
}

describe('reportSubmitGate (2026-10-31「灰而可点」定案：异动锁并入置灰判定)', () => {
  it('条件全满足时无锁定原因（按钮可点、走原提交流程）', () => {
    expect(resolveReportSubmitLockReason(passInput)).toBe('')
  })

  it('状态门优先级最高：只读 / 空列表', () => {
    expect(resolveReportSubmitLockReason({ ...passInput, isReadOnly: true })).toBe(
      '历史快照为只读状态，暂不能提交上报'
    )

    expect(resolveReportSubmitLockReason({ ...passInput, hasIndicators: false })).toBe(
      '没有可提交的指标'
    )
  })

  it('异动锁：文案与既有 handleSubmitAll 点击守卫 toast 完全同口径', () => {
    expect(resolveReportSubmitLockReason({ ...passInput, mutationInFlight: true })).toBe(
      '当前部门存在进行中的异动审批，暂不能提交上报；请等异动审批结束或撤回后再操作'
    )
  })

  it('自评缺口：文案与既有悬停 title 完全同口径；缺 1 行与缺多行同文案（不报内部 ID）', () => {
    expect(resolveReportSubmitLockReason({ ...passInput, missingSelfRatingCount: 1 })).toBe(
      '存在未填写自评进度的指标，请先完成全部指标的自评进度评定，再提交上报'
    )

    expect(resolveReportSubmitLockReason({ ...passInput, missingSelfRatingCount: 7 })).toBe(
      '存在未填写自评进度的指标，请先完成全部指标的自评进度评定，再提交上报'
    )
  })

  it('只报第一条命中：异动锁优先于自评缺口；空列表优先于异动锁', () => {
    expect(
      resolveReportSubmitLockReason({
        ...passInput,
        mutationInFlight: true,
        missingSelfRatingCount: 3
      })
    ).toBe('当前部门存在进行中的异动审批，暂不能提交上报；请等异动审批结束或撤回后再操作')

    expect(
      resolveReportSubmitLockReason({
        ...passInput,
        hasIndicators: false,
        mutationInFlight: true
      })
    ).toBe('没有可提交的指标')

    expect(
      resolveReportSubmitLockReason({
        ...passInput,
        isReadOnly: true,
        mutationInFlight: true,
        missingSelfRatingCount: 3
      })
    ).toBe('历史快照为只读状态，暂不能提交上报')
  })
})
