/**
 * Unit Tests for DingTalk H5 auto-login
 *
 * Tests for features/auth/lib/dingtalk.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/shared/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn()
  }
}))

vi.mock('@/shared/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

// tryDingTalkAutoLogin 在页面会话内缓存结果，每个用例重置模块保证隔离
const loadFreshModule = async () => {
  vi.resetModules()
  return await import('@/features/auth/lib/dingtalk')
}

const mockUserAgent = (value: string) => {
  vi.stubGlobal('navigator', { userAgent: value })
}

describe('isDingTalkContainer', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('识别钉钉内置浏览器 UA', async () => {
    mockUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) DingTalk/7.0.0')
    const { isDingTalkContainer } = await loadFreshModule()
    expect(isDingTalkContainer()).toBe(true)
  })

  it('普通浏览器返回 false', async () => {
    mockUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0')
    const { isDingTalkContainer } = await loadFreshModule()
    expect(isDingTalkContainer()).toBe(false)
  })
})

describe('tryDingTalkAutoLogin', () => {
  it('非钉钉容器直接跳过且不请求状态接口', async () => {
    mockUserAgent('Mozilla/5.0 Chrome/120.0')
    const { tryDingTalkAutoLogin } = await loadFreshModule()
    const { apiClient } = await import('@/shared/api/client')

    const result = await tryDingTalkAutoLogin()

    expect(result).toEqual({ ok: false, skipped: true })
    expect(apiClient.get).not.toHaveBeenCalled()
  })

  it('钉钉集成未启用时跳过', async () => {
    mockUserAgent('Mozilla/5.0 DingTalk/7.0.0')
    const { apiClient } = await import('@/shared/api/client')
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { enabled: false, configured: false, corpId: '' }
    })

    const { tryDingTalkAutoLogin } = await loadFreshModule()
    const result = await tryDingTalkAutoLogin()

    expect(result.ok).toBe(false)
    expect(result.skipped).toBe(true)
    expect(apiClient.get).toHaveBeenCalledWith('/auth/dingtalk/status')
  })

  it('状态接口异常时跳过而不抛错', async () => {
    mockUserAgent('Mozilla/5.0 DingTalk/7.0.0')
    const { apiClient } = await import('@/shared/api/client')
    vi.mocked(apiClient.get).mockRejectedValue(new Error('network down'))

    const { tryDingTalkAutoLogin } = await loadFreshModule()
    const result = await tryDingTalkAutoLogin()

    expect(result.ok).toBe(false)
    expect(result.skipped).toBe(true)
  })

  it('启用但缺少 corpId 时跳过免登码申请', async () => {
    mockUserAgent('Mozilla/5.0 DingTalk/7.0.0')
    const { apiClient } = await import('@/shared/api/client')
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { enabled: true, configured: true, corpId: '  ' }
    })

    const { tryDingTalkAutoLogin } = await loadFreshModule()
    const result = await tryDingTalkAutoLogin()

    expect(result).toEqual({ ok: false, skipped: true })
    expect(apiClient.post).not.toHaveBeenCalled()
  })
})
