/**
 * Auth Feature Store
 *
 * Migrated from stores/auth.ts
 * Authentication and authorization state management
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiClient as api } from '@/shared/api/client'
import type { User, UserRole } from '@/shared/types'
import { logger } from '@/shared/lib/utils/logger'
import { tokenManager, TokenRefreshError } from '@/shared/lib/utils/tokenManager'
import { parseLoginResponse, mapBackendUser, isKnownUserRole } from '@/shared/lib/utils/authHelpers'
import { useTimeContextStore } from '@/shared/lib/timeContext'
import { buildQueryKey, fetchWithCache, invalidateQueries } from '@/shared/lib/utils/cache'

export const useAuthStore = defineStore('auth', () => {
  // ============ State ============
  const user = ref<User | null>(null)
  const token = ref<string | null>(tokenManager.getAccessToken())
  const loading = ref(false)
  const sessionRestoring = ref(false)
  const authInitialized = ref(false)
  let initializePromise: Promise<void> | null = null

  // 视角切换状态（用于战略发展部查看其他部门视角）
  const viewingAsRole = ref<UserRole | null>(null)
  const viewingAsDepartment = ref<string | null>(null)

  const persistUser = (value: User | null) => {
    if (value) {
      localStorage.setItem('currentUser', JSON.stringify(value))
      localStorage.setItem('user', JSON.stringify(value))
      return
    }

    localStorage.removeItem('currentUser')
    localStorage.removeItem('user')
  }

  const clearLegacyAccessTokenStorage = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('auth_token')
    localStorage.removeItem('access_token')
    localStorage.removeItem('accessToken')
  }

  const normalizePermissionCodes = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
      return []
    }

    return [
      ...new Set(value.map(item => (typeof item === 'string' ? item.trim() : '')).filter(Boolean))
    ]
  }

  const normalizeLegacyUserData = (userData: Record<string, unknown>): Record<string, unknown> => {
    return {
      ...userData,
      permissions: normalizePermissionCodes(userData.permissions)
    }
  }

  const restorePersistedUser = (savedUser: string): User | null => {
    try {
      const parsedUser = JSON.parse(savedUser) as User & {
        permissions?: unknown
        role?: unknown
      }
      if (!parsedUser) {
        return null
      }

      if (!isKnownUserRole(parsedUser.role)) {
        logger.warn('[Auth] 本地缓存用户缺少有效角色，忽略缓存用户:', parsedUser.role)
        return null
      }

      parsedUser.permissions = normalizePermissionCodes(parsedUser.permissions)
      return parsedUser
    } catch (error) {
      logger.error('[Auth] 解析用户信息失败:', error)
      return null
    }
  }

  // ============ Getters ============
  const isAuthenticated = computed(() => !!token.value && !!user.value)

  const userRole = computed(() => {
    if (!user.value) {
      return null
    }
    return user.value.role || null
  })

  const userName = computed(() => {
    if (!user.value) {
      return ''
    }
    return user.value.name || (user.value as { realName?: string }).realName || ''
  })

  const userDepartment = computed(() => {
    if (!user.value) {
      return ''
    }
    return user.value.department || (user.value as { orgName?: string }).orgName || ''
  })

  // 当前有效角色（考虑视角切换?
  const effectiveRole = computed(() => viewingAsRole.value || user.value?.role || null)
  const effectiveDepartment = computed(
    () => viewingAsDepartment.value || user.value?.department || ''
  )

  const enrichUserWithOrganization = async (
    userData: Record<string, unknown>
  ): Promise<Record<string, unknown>> => {
    const orgId = userData.orgId

    if (!token.value || !tokenManager.hasValidToken()) {
      return userData
    }

    const hasOrgMetadata = Boolean(
      String(userData.orgName ?? userData.department ?? '').trim() &&
      String(userData.orgType ?? userData.role ?? '').trim()
    )

    if (hasOrgMetadata || !orgId) {
      return userData
    }

    try {
      const response = await api.get('/organizations')

      const organizations =
        response &&
        typeof response === 'object' &&
        'data' in response &&
        Array.isArray(response.data)
          ? (response.data as Array<Record<string, unknown>>)
          : []

      const matchedOrg = organizations.find(org => {
        const candidateId = org.id ?? org.orgId
        return String(candidateId) === String(orgId)
      })

      if (matchedOrg) {
        return {
          ...userData,
          orgType: (matchedOrg.orgType as string | undefined) || userData.orgType,
          orgName:
            (matchedOrg.orgName as string | undefined) ||
            (matchedOrg.name as string | undefined) ||
            userData.orgName
        }
      }

      const savedUser = localStorage.getItem('currentUser')
      if (savedUser) {
        const parsedUser = JSON.parse(savedUser) as {
          department?: string
          orgType?: string | null
          role?: string
          orgId?: string | number
        }

        if (
          String(parsedUser.orgId ?? '') === String(orgId) &&
          (parsedUser.department || parsedUser.role)
        ) {
          return {
            ...userData,
            orgName: parsedUser.department || userData.orgName,
            department: parsedUser.department || userData.department,
            orgType: parsedUser.orgType || userData.orgType,
            role: parsedUser.role || userData.role
          }
        }
      }
    } catch (error) {
      const status = Number(
        (error as { code?: number; response?: { status?: number } }).code ??
          (error as { response?: { status?: number } }).response?.status ??
          NaN
      )

      if (status === 401 || status === 403) {
        logger.debug('ℹ️ [Auth] 当前未取得组织接口访问权限，跳过组织信息补全')
        return userData
      }

      logger.debug('ℹ️ [Auth] 读取本地缓存组织信息失败，继续使用登录响应原始数据:', error)
    }

    return userData
  }

  // ============ Actions ============

  /**
   * 登录响应落地：解析 token/用户、补全组织信息、恢复持久化状态。
   * 账号密码登录与钉钉免登共用。
   */
  const applyLoginResponse = async (
    response: Record<string, unknown>
  ): Promise<{ success: boolean; error?: string }> => {
    const parseResult = parseLoginResponse(response)

    if (!parseResult.success || !parseResult.data) {
      return {
        success: false,
        error: parseResult.error || '登录失败：服务器响应格式错误'
      }
    }

    const { token: loginToken, user: userData, refreshToken } = parseResult.data

    token.value = loginToken
    tokenManager.setAccessToken(loginToken)
    clearLegacyAccessTokenStorage()
    if (refreshToken) {
      localStorage.setItem('refreshToken', refreshToken)
    }

    const enrichedUserData = await enrichUserWithOrganization(userData)
    const normalizedUserData = normalizeLegacyUserData(enrichedUserData)
    const mappedUser = mapBackendUser(normalizedUserData)
    if (!mappedUser) {
      logger.warn('[Auth] 登录响应未能解析出有效前端角色，终止登录流程')
      tokenManager.clearAccessToken()
      clearLegacyAccessTokenStorage()
      token.value = null
      localStorage.removeItem('refreshToken')
      persistUser(null)
      return {
        success: false,
        error: '登录失败：未识别的用户角色，请联系管理员确认账号权限'
      }
    }

    user.value = mappedUser
    persistUser(mappedUser)
    invalidateQueries(['auth.user'])
    authInitialized.value = true

    // 登录成功后，触发数据重新加载
    if (mappedUser.role === 'strategic_dept') {
      import('@/features/task/model/strategic')
        .then(({ useStrategicStore }) => {
          const strategicStore = useStrategicStore()
          const timeContext = useTimeContextStore()
          logger.debug('🔄 [Auth] 登录成功，重新加载指标数据..')
          strategicStore.loadIndicatorsByYear(timeContext.currentYear)
        })
        .catch(err => {
          logger.warn('⚠️ [Auth] 重新加载数据失败:', err)
        })
    }

    return { success: true }
  }

  const login = async (credentials: { account: string; password: string }) => {
    loading.value = true
    logger.debug('🔐 [Auth] 开始登录', credentials.account)

    try {
      const response = await api.post('/auth/login', credentials)
      logger.debug('📦 [Auth] 登录响应:', response)
      return await applyLoginResponse(response as Record<string, unknown>)
    } catch (error: unknown) {
      logger.error('❌[Auth] 登录异常:', error)
      const code = Number(
        (error as { code?: number }).code ??
          (error as { response?: { data?: { code?: number } } }).response?.data?.code ??
          NaN
      )
      const message =
        (error as { response?: { data?: { message?: string } } }).response?.data?.message ||
        (error as { message?: string }).message ||
        '登录失败：网络错误'
      const shouldCountAttempt =
        code === 2001 || message.includes('用户名或密码错误') || message.includes('账号或密码错误')
      const isLocked = code === 2003 || message.includes('登录失败次数过多')
      return {
        success: false,
        error: message,
        shouldCountAttempt,
        isLocked
      }
    } finally {
      loading.value = false
      logger.debug('🏁 [Auth] 登录流程结束')
    }
  }

  /**
   * 钉钉免登：免登码换取本系统登录态（账号绑定由后端按手机号自动完成）。
   */
  const loginWithDingTalk = async (
    authCode: string
  ): Promise<{ success: boolean; error?: string }> => {
    loading.value = true
    logger.debug('🔐 [Auth] 钉钉免登开始')

    try {
      const response = await api.post('/auth/dingtalk/login', { authCode })
      return await applyLoginResponse(response as Record<string, unknown>)
    } catch (error: unknown) {
      logger.warn('[Auth] 钉钉免登失败:', error)
      const message =
        (error as { response?: { data?: { message?: string } } }).response?.data?.message ||
        (error as { message?: string }).message ||
        '钉钉免登失败，请重新进入应用'
      return { success: false, error: message }
    } finally {
      loading.value = false
    }
  }

  const logout = (options: { redirect?: boolean } = {}) => {
    const shouldRedirect = options.redirect !== false
    user.value = null
    token.value = null
    tokenManager.clearAccessToken()
    persistUser(null)
    clearLegacyAccessTokenStorage()
    localStorage.removeItem('refreshToken')
    invalidateQueries(['auth.user'])
    authInitialized.value = true

    logger.debug('[Auth] 用户已登出，所有凭证已清除')

    if (shouldRedirect && !window.location.pathname.includes('/login')) {
      window.location.href = '/login'
    }
  }

  const fetchUser = async () => {
    if (!token.value) {
      return
    }

    try {
      const response = await fetchWithCache({
        key: buildQueryKey('auth', 'user'),
        policy: {
          ttlMs: 10 * 60 * 1000,
          scope: 'session',
          persist: true,
          dedupeWindowMs: 1000,
          tags: ['auth.user']
        },
        fetcher: () => api.get('/auth/me'),
        force: true
      })

      const authResponse = response as {
        success?: boolean
        data?: Record<string, unknown>
      }

      if (authResponse.success && authResponse.data) {
        const enrichedUserData = await enrichUserWithOrganization(authResponse.data)
        const normalizedUserData = normalizeLegacyUserData(enrichedUserData)
        const mappedUser = mapBackendUser(normalizedUserData)
        if (!mappedUser) {
          logger.warn('[Auth] 当前会话用户缺少有效角色，清除登录状态')
          logout({ redirect: false })
          return
        }
        user.value = mappedUser
        persistUser(mappedUser)
      } else {
        logout({ redirect: false })
      }
    } catch (error) {
      logger.error('Fetch user error:', error)
      logout({ redirect: false })
    }
  }

  const hasPermission = (resource: string, action: string) => {
    if (!user.value) {
      return false
    }

    const explicitPermissionCode = `${resource}:${action}`
    // Legacy compatibility shim:
    // runtime authorization now follows role/org/business rules, not backend permission codes.
    const permissions = {
      strategic_dept: [
        'strategic_tasks:create',
        'strategic_tasks:read',
        'strategic_tasks:update',
        'strategic_tasks:delete',
        'indicators:create',
        'indicators:read',
        'indicators:update',
        'indicators:delete'
      ],
      functional_dept: [
        'indicators:read',
        'indicators:update',
        'reports:create',
        'reports:read',
        'reports:update'
      ],
      secondary_college: ['reports:create', 'reports:read', 'reports:update']
    }

    const rolePermissions = permissions[user.value.role] || []
    return rolePermissions.includes(explicitPermissionCode)
  }

  const initializeAuth = async () => {
    if (authInitialized.value) {
      return
    }

    if (initializePromise) {
      await initializePromise
      return
    }

    initializePromise = (async () => {
      const savedUser = localStorage.getItem('currentUser')
      const memoryToken = tokenManager.getAccessToken()
      clearLegacyAccessTokenStorage()

      if (memoryToken && savedUser) {
        const parsedUser = restorePersistedUser(savedUser)
        if (parsedUser && tokenManager.hasValidToken()) {
          user.value = parsedUser
          token.value = memoryToken
          localStorage.setItem('user', JSON.stringify(parsedUser))
          logger.debug('[Auth] 从内存恢复会?', parsedUser.name, parsedUser.role)
          if (!String(parsedUser.orgType ?? '').trim()) {
            logger.debug('[Auth] 本地缓存缺少 orgType，主动刷新当前用户')
            await fetchUser()
          }
          authInitialized.value = true
          return
        }

        if (!parsedUser) {
          logger.warn('[Auth] 本地缓存用户角色无效，清除登录状态')
          logout({ redirect: false })
          authInitialized.value = true
          return
        }

        if (!tokenManager.hasValidToken()) {
          logger.warn('[Auth] 检测到过期 access token，改为走 refresh 恢复流程')
          tokenManager.clearAccessToken()
          token.value = null
        }
      }

      if (savedUser) {
        sessionRestoring.value = true
        logger.debug('[Auth] 尝试通过 Refresh Token 恢复会话...')

        try {
          const newToken = await tokenManager.refreshAccessToken()
          const parsedUser = restorePersistedUser(savedUser)
          if (parsedUser) {
            user.value = parsedUser
            token.value = newToken
            persistUser(parsedUser)
            logger.debug('[Auth] 会话恢复成功:', parsedUser.name)
            if (!String(parsedUser.orgType ?? '').trim()) {
              logger.debug('[Auth] 恢复会话后缺少 orgType，主动刷新当前用户')
              await fetchUser()
            }
          } else {
            logger.warn('[Auth] 用户信息缺少 role，清除登录状态')
            logout({ redirect: false })
          }
        } catch (error) {
          if (error instanceof TokenRefreshError) {
            logger.warn('[Auth] Refresh Token 无效，需要重新登录', error.message)
          } else {
            logger.error('[Auth] 会话恢复失败:', error)
          }
          logout({ redirect: false })
        } finally {
          sessionRestoring.value = false
        }
      }

      clearLegacyAccessTokenStorage()
      authInitialized.value = true
    })()

    try {
      await initializePromise
    } finally {
      initializePromise = null
    }
  }

  // 立即初始?
  void initializeAuth()

  // 切换视角
  const setViewingAs = (role: UserRole | null, department: string | null) => {
    viewingAsRole.value = role
    viewingAsDepartment.value = department
  }

  const resetViewingAs = () => {
    viewingAsRole.value = null
    viewingAsDepartment.value = null
  }

  /**
   * Update user avatar
   * 更新用户头像URL
   */
  const updateUserAvatar = (avatarUrl: string) => {
    if (user.value) {
      user.value = {
        ...user.value,
        avatar: avatarUrl,
        avatarUrl: avatarUrl
      }
      persistUser(user.value)
      logger.debug('[Auth] 用户头像已更新:', avatarUrl)
    }
  }

  const updateCurrentUser = (partial: Partial<User>) => {
    if (user.value) {
      user.value = {
        ...user.value,
        ...partial
      }
      persistUser(user.value)
      logger.debug('[Auth] 当前用户信息已更新:', partial)
    }
  }

  return {
    // State
    user,
    token,
    loading,
    sessionRestoring,
    authInitialized,
    viewingAsRole,
    viewingAsDepartment,

    // Getters
    isAuthenticated,
    userRole,
    userName,
    userDepartment,
    effectiveRole,
    effectiveDepartment,

    // Actions
    login,
    loginWithDingTalk,
    logout,
    fetchUser,
    initializeAuth,
    hasPermission,
    setViewingAs,
    resetViewingAs,
    updateUserAvatar,
    updateCurrentUser
  }
})
