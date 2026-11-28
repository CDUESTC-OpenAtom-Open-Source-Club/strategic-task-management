/**
 * 回归测试：静默错误请求（silentErrorToast）不弹全局错误提示
 *
 * 背景（2026-11-27 生产缺陷：计算机学院填报人打开「数据看板」顶部弹红色
 * 「服务器内部错误，请稍后重试或联系管理员」）：
 * - 看板批量水合父指标归口时，单条 `GET /indicators/{id}` 失败属于「可降级」场景
 *   （调用方 logger.warn 兜底、归组键回退 ownerDept），却走了响应拦截器的 500
 *   兜底分支，把一次后台水合失败升级成用户可见的红色故障提示。
 * - 修复：请求级 `silentErrorToast` 标记。**只对显式标记的请求生效**——
 *   用户主动操作失败的真实 500 仍照常提示，不能一刀切关掉全局提示。
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

interface SilentConfig {
  silentErrorToast?: boolean
}

function createAxiosError(
  status: number,
  data: unknown,
  url: string,
  config: SilentConfig = {}
): AxiosError {
  return {
    isAxiosError: true,
    name: 'AxiosError',
    message: `Request failed with status code ${status}`,
    code: 'ERR_BAD_REQUEST',
    config: {
      url,
      method: 'get',
      headers: {},
      ...config
    },
    response: {
      status,
      data,
      headers: {},
      config: {
        url,
        method: 'get',
        headers: {},
        ...config
      }
    },
    toJSON: () => ({})
  } as unknown as AxiosError
}

function createNetworkError(url: string, config: SilentConfig = {}): AxiosError {
  return {
    isAxiosError: true,
    name: 'AxiosError',
    message: 'Network Error',
    code: 'ERR_NETWORK',
    config: {
      url,
      method: 'get',
      headers: {},
      ...config
    },
    request: {},
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

describe('响应错误拦截器 - 静默请求不弹全局错误提示', () => {
  beforeEach(() => {
    errorToast.mockClear()
    warningToast.mockClear()
  })

  it('标记了 silentErrorToast 的 500 请求不弹「服务器内部错误」', async () => {
    await runInterceptor(
      createAxiosError(500, { code: 500, message: '系统错误' }, '/api/v1/indicators/91', {
        silentErrorToast: true
      })
    )
    await flushFallbackToast()

    expect(errorToast).not.toHaveBeenCalled()
  })

  it('未标记的 500 请求仍照常弹「服务器内部错误」（不能一刀切关掉全局提示）', async () => {
    await runInterceptor(
      createAxiosError(500, { code: 500, message: '系统错误' }, '/api/v1/tasks/12')
    )
    await flushFallbackToast()

    expect(errorToast).toHaveBeenCalledTimes(1)
    expect(errorToast.mock.calls[0][0]).toMatchObject({
      message: '服务器内部错误，请稍后重试或联系管理员'
    })
  })

  it('标记了 silentErrorToast 的 4xx 请求不弹业务错误提示', async () => {
    await runInterceptor(
      createAxiosError(404, { message: '请求的内容不存在或已被删除' }, '/api/v1/indicators/91', {
        silentErrorToast: true
      })
    )
    await flushFallbackToast()

    expect(errorToast).not.toHaveBeenCalled()
  })

  it('标记了 silentErrorToast 的连接失败不弹「无法连接到后端服务」', async () => {
    await runInterceptor(createNetworkError('/api/v1/indicators/91', { silentErrorToast: true }))
    await flushFallbackToast()

    expect(errorToast).not.toHaveBeenCalled()
  })

  it('标记了 silentErrorToast 的超时请求不弹「请求超时」警告', async () => {
    const error = createAxiosError(0, undefined, '/api/v1/indicators/91', {
      silentErrorToast: true
    })
    error.code = 'ECONNABORTED'
    error.response = undefined as never

    await runInterceptor(error)
    await flushFallbackToast()

    expect(warningToast).not.toHaveBeenCalled()
    expect(errorToast).not.toHaveBeenCalled()
  })

  it('静默请求仍以统一错误对象 reject 给调用方（业务层照常能兜底）', async () => {
    const rejected = (await runInterceptor(
      createAxiosError(500, { code: 500, message: '系统错误' }, '/api/v1/indicators/91', {
        silentErrorToast: true
      })
    )) as { message?: string; status?: number; handled?: boolean }

    expect(rejected).toBeTruthy()
    expect(rejected.status).toBe(500)
    expect(rejected.message).toBe('系统错误')
  })
})
