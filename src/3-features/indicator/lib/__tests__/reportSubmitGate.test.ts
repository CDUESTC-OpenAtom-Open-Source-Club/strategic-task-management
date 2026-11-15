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

/** 置灰门禁基线（2026-11-15 新契约）：PlanReport 流 draft 态、非未来月 */
const gateInput = {
  usePlanReportFlow: true,
  isPlanReportDraftState: true,
  isFutureMonth: false
}

// 2026-11-15 用户拍板（提交按钮隐藏改主动引导）：按钮**始终渲染**（不再 v-if），
// 原「非草稿态 / 未选归属部门 / 未来月」三显隐条件并入 resolveReportSubmitLockReason
// 原因链——不满足时原生 disabled + el-tooltip 说明缺什么，多条件同缺按
// 优先级取第一条：部门 > 未来月 > 草稿。
describe('reportSubmitGate 置灰门禁并入原因链（2026-11-15 契约：始终渲染 + tooltip 文案映射）', () => {
  it('未来月（isFutureMonth=true）→ 置灰并提示「未来周期暂不能提交」', () => {
    expect(resolveReportSubmitLockReason({ ...passInput, ...gateInput, isFutureMonth: true })).toBe(
      '未来周期暂不能提交'
    )
  })

  it('非草稿态（在审/已批等）→ 置灰并提示「暂无可提交的填报内容」', () => {
    expect(
      resolveReportSubmitLockReason({
        ...passInput,
        usePlanReportFlow: true,
        isPlanReportDraftState: false
      })
    ).toBe('暂无可提交的填报内容')
  })

  it('草稿态 / 缺省字段 → 无锁定原因（按钮可点；undefined 缺省向后兼容非学院链路）', () => {
    expect(resolveReportSubmitLockReason({ ...passInput, ...gateInput })).toBe('')
    expect(
      resolveReportSubmitLockReason({
        ...passInput,
        usePlanReportFlow: undefined,
        isPlanReportDraftState: undefined,
        isFutureMonth: undefined
      })
    ).toBe('')
  })

  it('传统链（usePlanReportFlow=false）：草稿态判定不适用（旧显隐函数同口径）', () => {
    expect(
      resolveReportSubmitLockReason({
        ...passInput,
        usePlanReportFlow: false,
        isPlanReportDraftState: false
      })
    ).toBe('')
  })

  it('文案优先级：未选归属部门 > 未来月 > 非草稿态（多条件同缺取第一条）', () => {
    // 部门 > 未来月
    expect(
      resolveReportSubmitLockReason({
        ...passInput,
        functionalDeptSelected: false,
        isFutureMonth: true
      })
    ).toBe('请先选择归属部门')

    // 未来月 > 草稿
    expect(
      resolveReportSubmitLockReason({
        ...passInput,
        isFutureMonth: true,
        isPlanReportDraftState: false
      })
    ).toBe('未来周期暂不能提交')

    // 三门同缺
    expect(
      resolveReportSubmitLockReason({
        ...passInput,
        functionalDeptSelected: false,
        isFutureMonth: true,
        isPlanReportDraftState: false
      })
    ).toBe('请先选择归属部门')
  })

  it('三门紧随既有状态门之后：只读/空列表仍最高；异动锁/自评缺口仍在新三门之后', () => {
    expect(
      resolveReportSubmitLockReason({
        ...passInput,
        isReadOnly: true,
        isFutureMonth: true,
        isPlanReportDraftState: false
      })
    ).toBe('历史快照为只读状态，暂不能提交上报')

    expect(
      resolveReportSubmitLockReason({
        ...passInput,
        hasIndicators: false,
        isFutureMonth: true,
        isPlanReportDraftState: false
      })
    ).toBe('没有可提交的指标')

    expect(
      resolveReportSubmitLockReason({
        ...passInput,
        isPlanReportDraftState: false,
        mutationInFlight: true,
        missingSelfRatingCount: 2
      })
    ).toBe('暂无可提交的填报内容')

    expect(
      resolveReportSubmitLockReason({
        ...passInput,
        mutationInFlight: true,
        missingSelfRatingCount: 2
      })
    ).toBe('当前部门存在进行中的异动审批，暂不能提交上报；请等异动审批结束或撤回后再操作')
  })
})
