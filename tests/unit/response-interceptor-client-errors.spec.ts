/**
 * 回归测试：响应错误拦截器必须把 4xx 业务错误透出给用户，且同一条错误只弹一次。
 *
 * 背景（2026-10-29 生产缺陷 N-02）：
 * - 拦截器此前只有 403 与 500 分支会弹 ElMessage，400 / 409 / 422 等业务错误
 *   被整个吞掉——后端返回的业务原文既没有提示、调用方也拿不到，
 *   用户点「审批通过」后界面毫无反应。
 * - 修复后如果拦截器与调用方各弹一次，同一条 409 会弹两条一模一样的 toast。
 *
 * 期望行为：
 * - 400 / 409 / 422 等 4xx → 兜底提示透出后端原文（中文原文直接透出）
 * - 403 → 中文兜底 + 英文原文附注（用户看得到提示，也不丢原文）
 * - 业务层已提示过（markErrorHandled）→ 拦截器不再重复弹
 * - 同一条消息在去重窗口内只弹一次
 * - 登录 / 刷新请求、健康检查请求、401 → 不弹提示
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AxiosError } from 'axios'

const { errorToast, warningToast } = vi.hoisted(() => ({
  errorToast: vi.fn(),
  warningToast: vi.fn()
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    error: errorToast,
    warning: warningToast,
    success: vi.fn(),
    info: vi.fn()
  }
}))

vi.mock('@/shared/lib/utils/tokenManager', () => ({
  tokenManager: {
    getAccessToken: () => null,
    isTokenExpiring: () => false,
    refreshAccessToken: vi.fn(async () => {
      throw new Error('refresh failed')
    }),
    clearAccessToken: vi.fn()
  }
}))

vi.mock('@/shared/lib/utils/authSession', () => ({
  clearPersistedAuthState: vi.fn(),
  redirectToLogin: vi.fn()
}))

import { createResponseErrorInterceptor } from '@/shared/api/interceptors/responseInterceptors'
import {
  buildUserFacingErrorMessage,
  claimErrorToast,
  markErrorHandled
} from '@/shared/lib/utils/errorToast'

function createAxiosError(status: number, data: unknown, url: string): AxiosError {
  return {
    isAxiosError: true,
    name: 'AxiosError',
    message: `Request failed with status code ${status}`,
    code: 'ERR_BAD_REQUEST',
    config: {
      url,
      method: 'post',
      headers: {}
    },
    response: {
      status,
      data,
      headers: {},
      config: {
        url,
        method: 'post',
        headers: {}
      }
    },
    toJSON: () => ({})
  } as unknown as AxiosError
}

/** 拦截器的兜底提示是延后一个宏任务弹的，测试里要等它跑完 */
async function flushFallbackToast(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
  await new Promise(resolve => setTimeout(resolve, 0))
}

async function runInterceptor(error: AxiosError): Promise<unknown> {
  const interceptor = createResponseErrorInterceptor({ useMock: false })
  try {
    await interceptor(error)
  } catch (rejected) {
    return rejected
  }
  return undefined
}

describe('响应错误拦截器 - 4xx 业务错误不再被吞掉', () => {
  beforeEach(() => {
    errorToast.mockClear()
    warningToast.mockClear()
  })

  it('409 冲突：弹出后端返回的业务原文', async () => {
    const error = createAxiosError(
      409,
      {
        code: 4091,
        message: '资源冲突：存在未评定的鉴定进度等级（指标 2046、2047），请先完成鉴定'
      },
      '/api/v1/workflows/tasks/12/approve'
    )

    await runInterceptor(error)
    await flushFallbackToast()

    expect(errorToast).toHaveBeenCalledTimes(1)
    expect(errorToast.mock.calls[0][0]).toMatchObject({
      message: '资源冲突：存在未评定的鉴定进度等级（指标 2046、2047），请先完成鉴定',
      duration: 3000,
      showClose: true
    })
  })

  it('400 参数错误：弹出后端返回的业务原文', async () => {
    const error = createAxiosError(400, { message: '审批意见不能为空' }, '/api/v1/approvals')

    await runInterceptor(error)
    await flushFallbackToast()

    expect(errorToast).toHaveBeenCalledTimes(1)
    expect(errorToast.mock.calls[0][0]).toMatchObject({ message: '审批意见不能为空' })
  })

  it('422 校验失败：后端没给原文时用状态码兜底文案，仍然有提示', async () => {
    const error = createAxiosError(422, {}, '/api/v1/approvals')

    await runInterceptor(error)
    await flushFallbackToast()

    expect(errorToast).toHaveBeenCalledTimes(1)
    expect(String(errorToast.mock.calls[0][0].message)).toContain('校验')
  })

  it('403：英文原文时给中文兜底 + 原文附注（不静默、也不丢原文）', async () => {
    const error = createAxiosError(
      403,
      { message: 'You are not authorized to approve this task' },
      '/api/v1/workflows/tasks/12/approve'
    )

    await runInterceptor(error)
    await flushFallbackToast()

    expect(errorToast).toHaveBeenCalledTimes(1)
    const message = String(errorToast.mock.calls[0][0].message)
    expect(message).toContain('权限不足')
    expect(message).toContain('You are not authorized to approve this task')
  })

  it('业务层已提示过（markErrorHandled）时，拦截器不再重复弹', async () => {
    const error = createAxiosError(
      409,
      { message: '资源冲突：存在未评定的鉴定进度等级' },
      '/api/v1/workflows/tasks/12/approve'
    )

    const rejected = (await runInterceptor(error)) as unknown
    // 模拟业务层 catch：自己提示并登记「已处理」
    markErrorHandled(rejected)
    await flushFallbackToast()

    expect(errorToast).not.toHaveBeenCalled()
  })

  it('同一条错误只弹一次（拦截器重复触发也只提示一次）', async () => {
    const error = createAxiosError(
      409,
      { message: '资源冲突：存在未评定的鉴定进度等级' },
      '/api/v1/workflows/tasks/12/approve'
    )

    await runInterceptor(error)
    await flushFallbackToast()
    // 第二个相同错误（例如批量审批里两个实例报同样的错）
    await runInterceptor(
      createAxiosError(409, error.response?.data, '/api/v1/workflows/tasks/13/approve')
    )
    await flushFallbackToast()

    expect(errorToast).toHaveBeenCalledTimes(1)
  })

  it('登录 / 刷新请求不弹提示（认证层自己提示）', async () => {
    await runInterceptor(createAxiosError(400, { message: '账号或密码错误' }, '/api/v1/auth/login'))
    await runInterceptor(
      createAxiosError(400, { message: 'refresh invalid' }, '/api/v1/auth/refresh')
    )
    await flushFallbackToast()

    expect(errorToast).not.toHaveBeenCalled()
  })

  it('健康检查请求不弹提示', async () => {
    await runInterceptor(createAxiosError(400, { message: 'boom' }, '/api/v1/actuator/health'))
    await runInterceptor(createAxiosError(400, { message: 'boom' }, '/api/v1/auth/health'))
    await flushFallbackToast()

    expect(errorToast).not.toHaveBeenCalled()
  })

  it('401 不在此处弹提示（走刷新重试链路）', async () => {
    await runInterceptor(createAxiosError(401, { message: 'unauthorized' }, '/api/v1/approvals'))
    await flushFallbackToast()

    expect(errorToast).not.toHaveBeenCalled()
  })

  it('拦截器 + 调用方同时处理同一条 409：最终只弹一条提示', async () => {
    const error = createAxiosError(
      409,
      { message: '资源冲突：存在未评定的鉴定进度等级（指标 2046、2047）' },
      '/api/v1/workflows/tasks/12/approve'
    )

    const rejected = (await runInterceptor(error)) as { message?: string; status?: number }

    // 模拟业务层 catch（与 useApprovalProgressWorkflow / useApprovalProgressDrawer 一致）：
    // 登记「已处理」→ 用原文提示一次
    markErrorHandled(rejected)
    const message = buildUserFacingErrorMessage(rejected.message ?? '', '审批失败', rejected.status)
    if (claimErrorToast(message)) {
      errorToast({ message, duration: 3000, showClose: true })
    }

    await flushFallbackToast()

    expect(errorToast).toHaveBeenCalledTimes(1)
    expect(errorToast.mock.calls[0][0]).toMatchObject({
      message: '资源冲突：存在未评定的鉴定进度等级（指标 2046、2047）'
    })
  })

  it('错误仍以统一错误对象 reject 给调用方（含后端原文）', async () => {
    const error = createAxiosError(
      409,
      { code: 4091, message: '资源冲突：存在未评定的鉴定进度等级' },
      '/api/v1/workflows/tasks/12/approve'
    )

    const rejected = (await runInterceptor(error)) as { message?: string; status?: number }

    expect(rejected).toBeTruthy()
    expect(rejected.message).toBe('资源冲突：存在未评定的鉴定进度等级')
    expect(rejected.status).toBe(409)
  })
})
