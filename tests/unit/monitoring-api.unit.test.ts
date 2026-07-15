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
})
