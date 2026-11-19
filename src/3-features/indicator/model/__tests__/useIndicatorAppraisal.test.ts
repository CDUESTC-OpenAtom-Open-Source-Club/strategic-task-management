/**
 * 评定门禁 + 行内下拉写库路径单测（2026-11-19 用户定案：统一行内下拉、去掉弹窗层）。
 *
 * 背景：线上症状——后端 context 返回 canAppraise=false + lockHint，但点击审核进度格子
 * 无任何弹层/toast。回归约束：门禁统一入口 unlockAppraisal 的任何路径
 * 都不允许「既不解锁也不提示」。
 *
 * 覆盖：
 * - canAppraise=false + 后端 lockHint → ElMessage.info 原样透出 lockHint，不解锁；
 * - context 缺条目（后端无该指标上报记录）→ 提示「非上报审批期间」兜底文案；
 * - 后端 NO_REPORT_RECORD 权威 hint（尚未发起上报）→ 原样透出（2026-11-14 三视图提示语统一）；
 * - reloadOne 网络失败且无缓存 → 仍提示兜底文案（不允许静默 return）；
 * - 行 id 非法（空 / 非数字）→ 提示数据异常，且不发起 context 请求；
 * - canAppraise=true → 解锁成功（行内下拉可展开），不弹任何弹窗；
 * - 行内下拉选完即存：成功 → success 提示 + ok=true；失败 → error 提示 + ok=false。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  elMessage: {
    info: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn()
  },
  elMessageBox: vi.fn()
}))

vi.mock('element-plus', () => ({
  ElMessage: mocks.elMessage,
  ElMessageBox: mocks.elMessageBox
}))

const getContextsMock = vi.hoisted(() => vi.fn())
const setLevelMock = vi.hoisted(() => vi.fn())

vi.mock('@/features/plan/api/planApi', () => ({
  indicatorFillApi: {
    getIndicatorAppraisalContexts: getContextsMock,
    setIndicatorAppraisalLevel: setLevelMock
  }
}))

import { useIndicatorAppraisal } from '../useIndicatorAppraisal'

/** 组一个 IndicatorAppraisalContextVO 形状的最小 context */
const buildContext = (overrides: Record<string, unknown>) => ({
  indicatorId: 101,
  canAppraise: false,
  appraisalLevel: null,
  lockHint: '',
  ...overrides
})

describe('useIndicatorAppraisal.unlockAppraisal（行内下拉解锁门禁）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('canAppraise=false 时当场透出后端 lockHint，不解锁行内下拉', async () => {
    getContextsMock.mockResolvedValue({
      success: true,
      data: [
        buildContext({
          indicatorId: 101,
          lockHint: '当前角色无评定权限，无法评定审核进度'
        })
      ]
    })

    const { unlockAppraisal } = useIndicatorAppraisal()
    const unlocked = await unlockAppraisal(101)

    expect(unlocked).toBe(false)
    expect(mocks.elMessage.info).toHaveBeenCalledTimes(1)
    expect(mocks.elMessage.info).toHaveBeenCalledWith('当前角色无评定权限，无法评定审核进度')
    // 门禁拦截后绝不进入选择/保存空转
    expect(setLevelMock).not.toHaveBeenCalled()
    expect(mocks.elMessageBox).not.toHaveBeenCalled()
  })

  it('context 缺条目（后端无该指标上报记录）时提示兜底文案，不静默', async () => {
    getContextsMock.mockResolvedValue({ success: true, data: [] })

    const { unlockAppraisal } = useIndicatorAppraisal()
    const unlocked = await unlockAppraisal(102)

    expect(unlocked).toBe(false)
    expect(mocks.elMessage.info).toHaveBeenCalledTimes(1)
    expect(mocks.elMessage.info).toHaveBeenCalledWith('非上报审批期间，无法评定审核进度')
  })

  it('后端 NO_REPORT_RECORD 权威 hint（尚未发起上报）原样透出，三视图同文案', async () => {
    // 2026-11-14 提示语统一：后端对无上报记录的指标返回 canAppraise=false + lockHint，
    // 前端优先透出后端原文（不再落到「非上报审批期间」兜底句）
    getContextsMock.mockResolvedValue({
      success: true,
      data: [
        buildContext({
          indicatorId: 105,
          lockHint: '该指标尚未发起上报，暂不能评定审核进度'
        })
      ]
    })

    const { unlockAppraisal } = useIndicatorAppraisal()
    const unlocked = await unlockAppraisal(105)

    expect(unlocked).toBe(false)
    expect(mocks.elMessage.info).toHaveBeenCalledTimes(1)
    expect(mocks.elMessage.info).toHaveBeenCalledWith('该指标尚未发起上报，暂不能评定审核进度')
  })

  it('reloadOne 网络失败且无缓存时仍提示兜底文案（静默 return 缺陷回归位）', async () => {
    getContextsMock.mockRejectedValue(new Error('network down'))

    const { unlockAppraisal } = useIndicatorAppraisal()
    const unlocked = await unlockAppraisal(103)

    expect(unlocked).toBe(false)
    expect(mocks.elMessage.info).toHaveBeenCalledTimes(1)
    expect(mocks.elMessage.info).toHaveBeenCalledWith('非上报审批期间，无法评定审核进度')
  })

  it('行 id 非法（非数字/空）时提示数据异常，且不发起 context 请求', async () => {
    const { unlockAppraisal } = useIndicatorAppraisal()

    expect(await unlockAppraisal('abc')).toBe(false)
    expect(await unlockAppraisal(null)).toBe(false)
    expect(await unlockAppraisal(undefined)).toBe(false)

    expect(mocks.elMessage.warning).toHaveBeenCalledTimes(3)
    expect(mocks.elMessage.warning).toHaveBeenCalledWith('未获取到有效指标，无法评定审核进度')
    expect(getContextsMock).not.toHaveBeenCalled()
  })

  it('canAppraise=true 时解锁成功（行内下拉可展开），全程不弹任何弹窗', async () => {
    getContextsMock.mockResolvedValue({
      success: true,
      data: [buildContext({ indicatorId: 104, canAppraise: true, appraisalLevel: 'NORMAL' })]
    })

    const { unlockAppraisal } = useIndicatorAppraisal()
    const unlocked = await unlockAppraisal(104)

    expect(unlocked).toBe(true)
    expect(mocks.elMessage.info).not.toHaveBeenCalled()
    expect(mocks.elMessageBox).not.toHaveBeenCalled()
    expect(setLevelMock).not.toHaveBeenCalled()
  })
})

describe('useIndicatorAppraisal.commitAppraisalLevel（行内下拉选完即存）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('写库成功 → ok=true + success 提示，且不弹确认弹窗', async () => {
    setLevelMock.mockResolvedValue({
      success: true,
      data: buildContext({ indicatorId: 201, canAppraise: true, appraisalLevel: 'NORMAL' })
    })

    const { commitAppraisalLevel } = useIndicatorAppraisal()
    const result = await commitAppraisalLevel(201, 'NORMAL')

    expect(result.ok).toBe(true)
    expect(result.level).toBe('NORMAL')
    expect(setLevelMock).toHaveBeenCalledWith(201, 'NORMAL')
    expect(mocks.elMessage.success).toHaveBeenCalledWith('审核进度已调整')
    expect(mocks.elMessageBox).not.toHaveBeenCalled()
  })

  it('写库失败（409/403 等）→ ok=false + error 提示带出原因，不弹确认弹窗', async () => {
    setLevelMock.mockResolvedValue({ success: false, message: '该指标当前不可评定' })

    const { commitAppraisalLevel } = useIndicatorAppraisal()
    const result = await commitAppraisalLevel(202, 'AHEAD')

    expect(result.ok).toBe(false)
    expect(result.error).toBe('该指标当前不可评定')
    expect(mocks.elMessage.error).toHaveBeenCalledWith('该指标当前不可评定')
    expect(mocks.elMessage.success).not.toHaveBeenCalled()
    expect(mocks.elMessageBox).not.toHaveBeenCalled()
  })
})
