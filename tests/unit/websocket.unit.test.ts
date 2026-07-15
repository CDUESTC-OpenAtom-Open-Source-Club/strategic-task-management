import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loggerWarnMock = vi.fn()
const loggerErrorMock = vi.fn()
const getAccessTokenMock = vi.fn()

vi.mock('@/shared/config/api', () => ({
  WS_BASE_URL: 'ws://localhost:8080'
}))

vi.mock('@/shared/lib/utils/logger', () => ({
  logger: {
    warn: loggerWarnMock,
    error: loggerErrorMock
  }
}))

vi.mock('@/shared/lib/utils/tokenManager', () => ({
  tokenManager: {
    getAccessToken: getAccessTokenMock
  }
}))

class MockWebSocket {
  static OPEN = 1
  static instances: MockWebSocket[] = []

  url: string
  readyState = 0
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  close(): void {
    this.readyState = 3
  }
}

describe('websocket notifications', () => {
  beforeEach(() => {
    vi.resetModules()
    loggerWarnMock.mockReset()
    loggerErrorMock.mockReset()
    getAccessTokenMock.mockReset()
    getAccessTokenMock.mockReturnValue('test-token')
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    localStorage.clear()
  })

  afterEach(async () => {
    const websocketModule = await import('@/shared/api/websocket')
    websocketModule.disconnectWebSocket()
    vi.unstubAllGlobals()
  })

  it('does not connect when user id is unavailable', async () => {
    const websocketModule = await import('@/shared/api/websocket')

    websocketModule.connectWebSocket()

    expect(MockWebSocket.instances).toHaveLength(0)
    expect(loggerWarnMock).toHaveBeenCalledWith('[WebSocket] No user ID, skipping connection')
  })

  it('connects to the notifications endpoint for the current user', async () => {
    localStorage.setItem('user', JSON.stringify({ id: 124 }))
    const websocketModule = await import('@/shared/api/websocket')

    websocketModule.connectWebSocket()

    expect(MockWebSocket.instances).toHaveLength(1)
    expect(MockWebSocket.instances[0].url).toBe(
      'ws://localhost:8080/ws/notifications?userId=124&token=test-token'
    )

    const state = websocketModule.useWebSocketNotifications()
    expect(state.connectionState.value).toBe('connecting')
  })
})
