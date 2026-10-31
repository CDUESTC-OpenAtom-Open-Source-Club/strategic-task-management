/**
 * 评定门禁路径单测（2026-10-31 线上实测 P0 缺陷回归）。
 *
 * 线上症状：后端 context 返回 canAppraise=false + lockHint，但点击审核进度格子
 * 无任何弹层/toast。回归约束：门禁统一入口 openAppraisalGate 的任何路径
 * 都不允许「既不开选择器也不提示」。
 *
 * 覆盖：
 * - canAppraise=false + 后端 lockHint → ElMessage.info 原样透出 lockHint，不开选择器；
 * - context 缺条目（后端无该指标上报记录）→ 弹「非上报审批期间」兜底文案；
 * - reloadOne 网络失败且无缓存 → 仍弹兜底文案（不允许静默 return）；
 * - 行 id 非法（空 / 非数字）→ 弹数据异常提示，且不发起 context 请求；
 * - canAppraise=true → 打开等级选择器（ElMessageBox），用户取消则不保存、无成功 toast。
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
  ElMessageBox: mocks.elMessageBox,
  ElOption: { name: 'ElOption' },
  ElSelect: { name: 'ElSelect' }
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

describe('useIndicatorAppraisal.openAppraisalGate（评定门禁）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('canAppraise=false 时当场透出后端 lockHint，不打开等级选择器', async () => {
    getContextsMock.mockResolvedValue({
      success: true,
      data: [
        buildContext({
          indicatorId: 101,
          lockHint: '当前角色无评定权限，无法评定审核进度'
        })
      ]
    })

    const { openAppraisalGate } = useIndicatorAppraisal()
    await openAppraisalGate(101, { indicatorName: '教学运行质量' })

    expect(mocks.elMessage.info).toHaveBeenCalledTimes(1)
    expect(mocks.elMessage.info).toHaveBeenCalledWith('当前角色无评定权限，无法评定审核进度')
    // 门禁拦截后绝不进入选择/保存空转
    expect(mocks.elMessageBox).not.toHaveBeenCalled()
    expect(setLevelMock).not.toHaveBeenCalled()
  })

  it('context 缺条目（后端无该指标上报记录）时弹兜底文案，不静默', async () => {
    getContextsMock.mockResolvedValue({ success: true, data: [] })

    const { openAppraisalGate } = useIndicatorAppraisal()
    await openAppraisalGate(102)

    expect(mocks.elMessage.info).toHaveBeenCalledTimes(1)
    expect(mocks.elMessage.info).toHaveBeenCalledWith('非上报审批期间，无法评定审核进度')
    expect(mocks.elMessageBox).not.toHaveBeenCalled()
  })

  it('reloadOne 网络失败且无缓存时仍弹兜底文案（静默 return 缺陷回归位）', async () => {
    getContextsMock.mockRejectedValue(new Error('network down'))

    const { openAppraisalGate } = useIndicatorAppraisal()
    await openAppraisalGate(103)

    expect(mocks.elMessage.info).toHaveBeenCalledTimes(1)
    expect(mocks.elMessage.info).toHaveBeenCalledWith('非上报审批期间，无法评定审核进度')
    expect(mocks.elMessageBox).not.toHaveBeenCalled()
  })

  it('行 id 非法（非数字/空）时弹数据异常提示，且不发起 context 请求', async () => {
    const { openAppraisalGate } = useIndicatorAppraisal()

    await openAppraisalGate('abc')
    await openAppraisalGate(null)
    await openAppraisalGate(undefined)

    expect(mocks.elMessage.warning).toHaveBeenCalledTimes(3)
    expect(mocks.elMessage.warning).toHaveBeenCalledWith('未获取到有效指标，无法评定审核进度')
    expect(getContextsMock).not.toHaveBeenCalled()
    expect(mocks.elMessageBox).not.toHaveBeenCalled()
  })

  it('canAppraise=true 时打开等级选择器；用户取消则不保存', async () => {
    getContextsMock.mockResolvedValue({
      success: true,
      data: [buildContext({ indicatorId: 104, canAppraise: true, appraisalLevel: 'NORMAL' })]
    })
    // 模拟用户点击取消/关闭 → openAppraisalLevelPicker 的 catch 分支
    mocks.elMessageBox.mockRejectedValue('cancel')

    const { openAppraisalGate } = useIndicatorAppraisal()
    await openAppraisalGate(104)

    expect(mocks.elMessageBox).toHaveBeenCalledTimes(1)
    expect(setLevelMock).not.toHaveBeenCalled()
    expect(mocks.elMessage.success).not.toHaveBeenCalled()
    expect(mocks.elMessage.info).not.toHaveBeenCalled()
  })
})
