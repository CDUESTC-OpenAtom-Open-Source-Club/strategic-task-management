import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiClientMock = vi.hoisted(() => ({
  getAxiosInstance: vi.fn()
}))

vi.mock('@/shared/api/client', () => ({
  apiClient: apiClientMock
}))

describe('monitoring api compatibility', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    sessionStorage.clear()
    apiClientMock.getAxiosInstance.mockReturnValue({
      get: vi.fn()
    })
  })

  it('returns empty alerts after both compatible remote endpoints return 404', async () => {
    const axiosGet = vi.fn().mockResolvedValue({
      status: 404,
      data: { success: false }
    })
    apiClientMock.getAxiosInstance.mockReturnValue({ get: axiosGet })
    const { alertApi } = await import('@/shared/api/monitoringApi')

    const result = await alertApi.getUnclosedAlerts()

    expect(result).toEqual([])
    expect(axiosGet).toHaveBeenCalledTimes(2)
  })

  it('returns empty stats after the remote stats endpoint returns 404', async () => {
    const axiosGet = vi.fn().mockResolvedValue({
      status: 404,
      data: { success: false }
    })
    apiClientMock.getAxiosInstance.mockReturnValue({ get: axiosGet })
    const { alertApi } = await import('@/shared/api/monitoringApi')

    const stats = await alertApi.getStats()

    expect(stats).toEqual({
      totalOpen: 0,
      countBySeverity: {
        CRITICAL: 0,
        WARNING: 0,
        INFO: 0
      }
    })
    expect(axiosGet).toHaveBeenCalledTimes(1)
  })

  it('keeps three-tier progress levels when normalizing manual alert levels (A1 回归)', async () => {
    // 回归背景：A1 缺陷中 getManualAlertLevels 只放行 INFO/WARNING/CRITICAL，
    // 三档 AHEAD/NORMAL/DELAYED 被吞成 null，导致任务页进度等级回显为空。
    apiClientMock.get = vi.fn().mockResolvedValue({
      data: {
        2039: 'DELAYED',
        2040: 'ahead',
        2041: 'NORMAL',
        2042: 'INFO',
        2043: 'not-a-level'
      }
    })
    const { alertApi } = await import('@/shared/api/monitoringApi')

    const levels = await alertApi.getManualAlertLevels([2039, 2040, 2041, 2042, 2043])

    expect(levels).toEqual({
      2039: 'DELAYED',
      2040: 'AHEAD',
      2041: 'NORMAL',
      2042: 'INFO',
      2043: null
    })
  })
})
