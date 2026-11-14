import { describe, expect, it } from 'vitest'
import {
  resolveReportSubmitAllButtonVisible,
  resolveReportSubmitLockReason
} from '../reportSubmitGate'

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

// 2026-11-13 口径变更（学院上报按归口部门分批提交）：一键提交必须先选归属部门——
// 报告按 (月, 归口部门) 隔离、后端按报告归口派审批席位，未选部门无提交上下文
describe('reportSubmitGate 未选归属部门门禁（2026-11-13 口径变更）', () => {
  it('学院未选归属部门（functionalDeptSelected=false）→ 锁定并提示「请先选择归属部门」', () => {
    expect(resolveReportSubmitLockReason({ ...passInput, functionalDeptSelected: false })).toBe(
      '请先选择归属部门'
    )
  })

  it('缺省字段（undefined）视为已选——非学院链路调用方零改动，门禁不生效', () => {
    expect(resolveReportSubmitLockReason(passInput)).toBe('')
    expect(resolveReportSubmitLockReason({ ...passInput, functionalDeptSelected: true })).toBe('')
  })

  it('优先级：归属部门门在异动锁/自评缺口之前；空列表门最高（仅次于只读）', () => {
    expect(
      resolveReportSubmitLockReason({
        ...passInput,
        functionalDeptSelected: false,
        mutationInFlight: true,
        missingSelfRatingCount: 2
      })
    ).toBe('请先选择归属部门')

    expect(
      resolveReportSubmitLockReason({
        ...passInput,
        hasIndicators: false,
        functionalDeptSelected: false
      })
    ).toBe('没有可提交的指标')
  })
})

/** 按钮可见基线：批量操作区可见、报告未锁、PlanReport 流 draft 态 */
const visibleInput = {
  showBatchActions: true,
  isReportLocked: false,
  usePlanReportFlow: true,
  isPlanReportDraftState: true
}

// 2026-11-13 用户拍板（缺陷1）：一键提交的前提是已选归属部门——学院未选时按钮
// **不渲染**（不是置灰）；非学院链路无归属部门概念，渲染逻辑保持原样
describe('resolveReportSubmitAllButtonVisible（学院未选归属部门不渲染）', () => {
  it('学院上下文：未选归属部门 → 按钮不渲染（false）；选中 → 渲染（true）', () => {
    expect(
      resolveReportSubmitAllButtonVisible({ ...visibleInput, functionalDeptSelected: false })
    ).toBe(false)

    expect(
      resolveReportSubmitAllButtonVisible({ ...visibleInput, functionalDeptSelected: true })
    ).toBe(true)
  })

  it('非学院回归：functionalDeptSelected 缺省（undefined）恒渲染，不受新 v-if 影响', () => {
    expect(resolveReportSubmitAllButtonVisible(visibleInput)).toBe(true)

    // 传统职能部门链（usePlanReportFlow=false）同样只看既有条件
    expect(
      resolveReportSubmitAllButtonVisible({
        ...visibleInput,
        usePlanReportFlow: false,
        isPlanReportDraftState: false
      })
    ).toBe(true)
  })

  it('既有条件保持：批量操作区不可见 / 报告锁定 / 非 draft 态 → 不渲染', () => {
    expect(resolveReportSubmitAllButtonVisible({ ...visibleInput, showBatchActions: false })).toBe(
      false
    )
    expect(resolveReportSubmitAllButtonVisible({ ...visibleInput, isReportLocked: true })).toBe(
      false
    )
    expect(
      resolveReportSubmitAllButtonVisible({ ...visibleInput, isPlanReportDraftState: false })
    ).toBe(false)
  })

  it('学院未选部门时其它条件再满足也不渲染（未选是前置前提）', () => {
    expect(
      resolveReportSubmitAllButtonVisible({
        ...visibleInput,
        isReportLocked: false,
        isPlanReportDraftState: true,
        functionalDeptSelected: false
      })
    ).toBe(false)
  })

  // 2026-11-13 用户拍板（未来月放填报、拦提交）：提交目标月晚于当前真实月份时
  // 一键提交**不渲染**（填报存草稿不受影响；后端提交端点同口径校验兜底）。
  // 调用方折算 isFutureMonth 传入，undefined 恒通过（取不到月份的调用方零改动）。
  it('未来月（isFutureMonth=true）→ 其它条件再满足也不渲染', () => {
    expect(resolveReportSubmitAllButtonVisible({ ...visibleInput, isFutureMonth: true })).toBe(
      false
    )
  })

  it('当前月/历史月（isFutureMonth=false）→ 正常渲染', () => {
    expect(resolveReportSubmitAllButtonVisible({ ...visibleInput, isFutureMonth: false })).toBe(
      true
    )
  })

  it('缺省（undefined，取不到月份的调用方）→ 恒通过（旧行为）', () => {
    expect(resolveReportSubmitAllButtonVisible({ ...visibleInput })).toBe(true)
  })

  it('未来月 + 未选归属部门 → 同样不渲染（门禁叠加不冲突）', () => {
    expect(
      resolveReportSubmitAllButtonVisible({
        ...visibleInput,
        isFutureMonth: true,
        functionalDeptSelected: false
      })
    ).toBe(false)
  })
})
