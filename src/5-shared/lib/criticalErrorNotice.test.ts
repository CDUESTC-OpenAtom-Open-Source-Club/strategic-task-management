/**
 * 关键报错持久化通知单测（2026-10-31 用户拍板：关键错误不自动消失，手动关）。
 *
 * 覆盖：
 * - critical:true → 持久通知（duration 0 + showClose true，右上角）；
 * - critical 缺省/false → 3 秒自动消失（普通提示维持现状）；
 * - type 缺省 error、可覆盖（warning）；
 * - 返回 ElNotification 句柄；
 * - 通知组件异常时静默降级（返回 null、不抛错、不阻断调用方）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  elNotification: vi.fn(() => ({ close: vi.fn() }))
}))

vi.mock('element-plus', () => ({
  ElNotification: mocks.elNotification
}))

import { showCriticalErrorNotice } from './criticalErrorNotice'

describe('showCriticalErrorNotice', () => {
  beforeEach(() => {
    mocks.elNotification.mockClear()
  })

  it('critical=true 弹持久通知：duration 0 + 可手动关 + 右上角', () => {
    showCriticalErrorNotice({
      title: '审批失败',
      message: '资源冲突：存在未评定的审核进度',
      critical: true
    })

    expect(mocks.elNotification).toHaveBeenCalledTimes(1)
    const options = mocks.elNotification.mock.calls[0][0] as {
      title: string
      message: string
      type: string
      duration: number
      showClose: boolean
      position: string
    }
    expect(options.title).toBe('审批失败')
    expect(options.message).toBe('资源冲突：存在未评定的审核进度')
    expect(options.duration).toBe(0)
    expect(options.showClose).toBe(true)
    expect(options.position).toBe('top-right')
  })

  it('critical=true 时 type 缺省为 error，可显式覆盖为 warning', () => {
    showCriticalErrorNotice({ title: '导入未写入', message: '权重校验未通过', critical: true })
    expect((mocks.elNotification.mock.calls[0][0] as { type: string }).type).toBe('error')

    showCriticalErrorNotice({
      title: '导入未写入',
      message: '权重校验未通过',
      type: 'warning',
      critical: true
    })
    expect((mocks.elNotification.mock.calls[1][0] as { type: string }).type).toBe('warning')
  })

  it('critical 缺省或 false 时维持 3 秒自动消失（普通提示不升级）', () => {
    showCriticalErrorNotice({ title: '提示', message: '普通提示' })
    const defaultOptions = mocks.elNotification.mock.calls[0][0] as {
      duration: number
      showClose: boolean
    }
    expect(defaultOptions.duration).toBe(3000)
    expect(defaultOptions.showClose).toBe(false)

    showCriticalErrorNotice({ title: '提示', message: '普通提示', critical: false })
    const explicitOptions = mocks.elNotification.mock.calls[1][0] as {
      duration: number
      showClose: boolean
    }
    expect(explicitOptions.duration).toBe(3000)
    expect(explicitOptions.showClose).toBe(false)
  })

  it('返回 ElNotification 的句柄供调用方关闭', () => {
    const handle = { close: vi.fn() }
    mocks.elNotification.mockReturnValueOnce(handle)

    const result = showCriticalErrorNotice({ title: '审批失败', message: 'x', critical: true })

    expect(result).toBe(handle)
  })

  it('通知组件异常时静默降级：返回 null、不向调用方抛错', () => {
    mocks.elNotification.mockImplementationOnce(() => {
      throw new Error('notification component unavailable')
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let result: unknown
    expect(() => {
      result = showCriticalErrorNotice({ title: '审批失败', message: 'x', critical: true })
    }).not.toThrow()
    expect(result).toBeNull()

    errorSpy.mockRestore()
  })
})
