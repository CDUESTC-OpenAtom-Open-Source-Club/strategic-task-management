/**
 * Unit Tests for Auth Store
 *
 * Tests for features/auth/model/store.ts
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/features/auth/model/store'
import type { User } from '@/shared/types'
import { getTestCredentials } from '../../../../helpers/testCredentials'

// Mock dependencies
vi.mock('@/shared/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn()
  }
}))

vi.mock('@/shared/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
}))

vi.mock('@/shared/lib/utils/tokenManager', () => ({
  tokenManager: {
    getAccessToken: vi.fn(() => null),
    setAccessToken: vi.fn(),
    clearAccessToken: vi.fn(),
    refreshAccessToken: vi.fn(),
    hasValidToken: vi.fn(() => true)
  },
  TokenRefreshError: class TokenRefreshError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'TokenRefreshError'
    }
  }
}))

vi.mock('@/shared/lib/utils/authHelpers', () => ({
  parseLoginResponse: vi.fn(),
  mapBackendUser: vi.fn(),
  isKnownUserRole: vi.fn(() => true)
}))

vi.mock('@/features/auth/api/query', () => ({
  getUserPermissions: vi.fn(async () => ({ success: true, data: [] }))
}))

vi.mock('@/shared/lib/utils/cache', () => ({
  buildQueryKey: vi.fn(() => ['auth.user']),
  fetchWithCache: vi.fn(async ({ fetcher }: { fetcher: () => Promise<unknown> }) => fetcher()),
  invalidateQueries: vi.fn()
}))

vi.mock('@/shared/lib/timeContext', () => ({
  useTimeContextStore: vi.fn(() => ({
    currentYear: 2026
  }))
}))

describe('Auth Store', () => {
  let authStore: ReturnType<typeof useAuthStore>

  const mockUser: User = {
    id: 1,
    name: 'Test User',
    username: 'testuser',
    role: 'strategic_dept',
    department: 'Strategic Development',
    email: 'test@example.com'
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    authStore = useAuthStore()

    // Clear localStorage
    localStorage.clear()

    // Reset all mocks
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      expect(authStore.user).toBe(null)
      expect(authStore.loading).toBe(false)
      expect(authStore.sessionRestoring).toBe(false)
      expect(authStore.viewingAsRole).toBe(null)
      expect(authStore.viewingAsDepartment).toBe(null)
    })

    it('should have correct computed properties for unauthenticated state', () => {
      expect(authStore.isAuthenticated).toBe(false)
      expect(authStore.userRole).toBe(null)
      expect(authStore.userName).toBe('')
      expect(authStore.userDepartment).toBe('')
      expect(authStore.effectiveRole).toBe(null)
      expect(authStore.effectiveDepartment).toBe('')
    })
  })

  describe('Computed Properties', () => {
    beforeEach(() => {
      authStore.user = mockUser
      authStore.token = 'mock-token'
    })

    it('should compute isAuthenticated correctly', () => {
      expect(authStore.isAuthenticated).toBe(true)

      authStore.token = null
      expect(authStore.isAuthenticated).toBe(false)
    })

    it('should compute user properties correctly', () => {
      expect(authStore.userRole).toBe('strategic_dept')
      expect(authStore.userName).toBe('Test User')
      expect(authStore.userDepartment).toBe('Strategic Development')
    })

    it('should handle user with realName property', () => {
      authStore.user = { ...mockUser, name: '', realName: 'Real Name' } as any
      expect(authStore.userName).toBe('Real Name')
    })

    it('should handle user with orgName property', () => {
      authStore.user = { ...mockUser, department: '', orgName: 'Org Name' } as any
      expect(authStore.userDepartment).toBe('Org Name')
    })

    it('should compute effective role and department with viewing as', () => {
      authStore.setViewingAs('functional_dept', 'Finance Department')

      expect(authStore.effectiveRole).toBe('functional_dept')
      expect(authStore.effectiveDepartment).toBe('Finance Department')
    })
  })

  describe('Login Action', () => {
    const mockCredentials = getTestCredentials('STANDARD')

    it('should handle successful login', async () => {
      const mockApi = await import('@/shared/api/client')
      const mockAuthHelpers = await import('@/shared/lib/utils/authHelpers')

      // Mock successful API response
      mockApi.apiClient.post.mockResolvedValue({
        code: 0,
        data: { token: 'mock-token', user: mockUser }
      })

      mockAuthHelpers.parseLoginResponse.mockReturnValue({
        success: true,
        data: { token: 'mock-token', user: mockUser }
      })

      mockAuthHelpers.mapBackendUser.mockReturnValue(mockUser)

      const result = await authStore.login(mockCredentials)

      expect(result.success).toBe(true)
      expect(authStore.user).toEqual(mockUser)
      expect(authStore.token).toBe('mock-token')
      expect(authStore.loading).toBe(false)
    })

    it('should handle login failure', async () => {
      const mockApi = await import('@/shared/api/client')

      mockApi.apiClient.post.mockRejectedValue(new Error('Network error'))

      const result = await authStore.login(mockCredentials)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Network error')
      expect(authStore.user).toBe(null)
      expect(authStore.token).toBe(null)
      expect(authStore.loading).toBe(false)
    })

    it('should handle parse error', async () => {
      const mockApi = await import('@/shared/api/client')
      const mockAuthHelpers = await import('@/shared/lib/utils/authHelpers')

      mockApi.apiClient.post.mockResolvedValue({ code: 0 })
      mockAuthHelpers.parseLoginResponse.mockReturnValue({
        success: false,
        error: 'Parse error'
      })

      const result = await authStore.login(mockCredentials)

      expect(result.success).toBe(false)
      expect(result.error).toBe('Parse error')
    })

    it('should clear auth state when backend role cannot be mapped', async () => {
      const mockApi = await import('@/shared/api/client')
      const mockAuthHelpers = await import('@/shared/lib/utils/authHelpers')
      const mockTokenManager = await import('@/shared/lib/utils/tokenManager')

      mockApi.apiClient.post.mockResolvedValue({
        code: 0,
        data: { token: 'broken-role-token', user: mockUser }
      })
      mockAuthHelpers.parseLoginResponse.mockReturnValue({
        success: true,
        data: { token: 'broken-role-token', user: mockUser }
      })
      mockAuthHelpers.mapBackendUser.mockReturnValue(null)

      const result = await authStore.login(mockCredentials)

      expect(result.success).toBe(false)
      expect(result.error).toContain('未识别的用户角色')
      expect(authStore.user).toBe(null)
      expect(authStore.token).toBe(null)
      expect(mockTokenManager.tokenManager.clearAccessToken).toHaveBeenCalled()
    })
  })

  describe('Logout Action', () => {
    beforeEach(() => {
      authStore.user = mockUser
      authStore.token = 'mock-token'
      localStorage.setItem('currentUser', JSON.stringify(mockUser))
      localStorage.setItem('token', 'mock-token')
    })

    it('should clear all auth data', async () => {
      const mockTokenManager = vi.mocked(await import('@/shared/lib/utils/tokenManager'))

      authStore.logout()

      expect(authStore.user).toBe(null)
      expect(authStore.token).toBe(null)
      expect(mockTokenManager.tokenManager.clearAccessToken).toHaveBeenCalled()
      expect(localStorage.getItem('currentUser')).toBe(null)
      expect(localStorage.getItem('token')).toBe(null)
    })
  })

  describe('Permission System', () => {
    // 2026-10-27 权限模型改造：hasPermission 只消费后端下发的权限码
    const backendPermissions = [
      'PAGE_STRATEGY_TASK',
      'BTN_STRATEGY_TASK_DISPATCH_APPROVE',
      'PAGE_INDICATOR_DISPATCH'
    ]

    beforeEach(() => {
      authStore.user = { ...mockUser, permissions: backendPermissions } as unknown as User
    })

    it('should check permissions from backend-provided codes', () => {
      expect(authStore.hasPermission('PAGE_STRATEGY_TASK')).toBe(true)
      expect(authStore.hasPermission('BTN_STRATEGY_TASK_DISPATCH_APPROVE')).toBe(true)
      expect(authStore.hasPermission('BTN_SYSTEM_ADMIN_CONSOLE')).toBe(false)
    })

    it('should deny permissions for unauthenticated user', () => {
      authStore.user = null
      expect(authStore.hasPermission('PAGE_STRATEGY_TASK')).toBe(false)
    })

    it('should deny permissions when backend returns no permission codes', () => {
      authStore.user = { ...mockUser, permissions: [] } as unknown as User
      expect(authStore.hasPermission('PAGE_STRATEGY_TASK')).toBe(false)
    })

    it('should only match exact permission codes', () => {
      // 旧 resource:action 语义已移除，不再按组织类别推断
      expect(authStore.hasPermission('strategic_tasks')).toBe(false)
      expect(authStore.hasPermission('indicators')).toBe(false)
    })
  })

  describe('View Switching', () => {
    beforeEach(() => {
      authStore.user = mockUser
    })

    it('should set viewing as role and department', () => {
      authStore.setViewingAs('functional_dept', 'Finance Department')

      expect(authStore.viewingAsRole).toBe('functional_dept')
      expect(authStore.viewingAsDepartment).toBe('Finance Department')
      expect(authStore.effectiveRole).toBe('functional_dept')
      expect(authStore.effectiveDepartment).toBe('Finance Department')
    })

    it('should reset viewing as', () => {
      authStore.setViewingAs('functional_dept', 'Finance Department')
      authStore.resetViewingAs()

      expect(authStore.viewingAsRole).toBe(null)
      expect(authStore.viewingAsDepartment).toBe(null)
      expect(authStore.effectiveRole).toBe('strategic_dept')
      expect(authStore.effectiveDepartment).toBe('Strategic Development')
    })
  })

  describe('Fetch User', () => {
    it('should fetch user data when token exists', async () => {
      const mockApi = await import('@/shared/api/client')
      const mockAuthHelpers = await import('@/shared/lib/utils/authHelpers')
      authStore.token = 'mock-token'

      mockApi.apiClient.get.mockResolvedValue({
        success: true,
        data: mockUser
      })
      mockAuthHelpers.mapBackendUser.mockReturnValue(mockUser)

      await authStore.fetchUser()

      expect(mockApi.apiClient.get).toHaveBeenCalledWith('/auth/me')
      expect(authStore.user).toEqual(mockUser)
    })

    it('should logout on fetch user failure', async () => {
      const mockApi = await import('@/shared/api/client')
      authStore.token = 'mock-token'

      mockApi.apiClient.get.mockRejectedValue(new Error('Unauthorized'))

      await authStore.fetchUser()

      expect(authStore.user).toBe(null)
      expect(authStore.token).toBe(null)
    })

    it('should not fetch user when no token', async () => {
      const mockApi = await import('@/shared/api/client')
      authStore.token = null

      await authStore.fetchUser()

      expect(mockApi.apiClient.get).not.toHaveBeenCalled()
    })
  })
})
