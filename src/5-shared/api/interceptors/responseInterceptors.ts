/**
 * Response Interceptors - 响应拦截器模块
 *
 * 职责:
 * - Mock 模式响应处理
 * - 性能监控记录
 * - 缓存响应处理
 * - 响应格式统一化
 * - 错误处理和转换
 *
 * @module api/interceptors
 */

import axios from 'axios'
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import type { AxiosError } from 'axios'
import { logger } from '@/shared/lib/utils/logger'
import { recordApiLatency } from '@/shared/lib/utils/performance'
import { cacheManager } from '@/shared/lib/utils/cache'
import { transformError, toExtendedError, stringifyMessage } from '@/shared/api/errorHandler'
import { tokenManager } from '@/shared/lib/utils/tokenManager'
import { clearPersistedAuthState, redirectToLogin } from '@/shared/lib/utils/authSession'
import {
  buildUserFacingErrorMessage,
  claimErrorToast,
  clientErrorFallbackText,
  isErrorHandled
} from '@/shared/lib/utils/errorToast'
import type { ExtendedErrorInfo } from '@/shared/types/error'
import { API_TARGET, USE_MOCK } from '@/shared/config/api'

const backendDisplayTarget = API_TARGET || '当前配置的后端地址'

/**
 * 健康检查类请求：403 / 404 等状态码属于「预期结果」，不应给用户弹提示。
 * 覆盖 /actuator/health、/auth/health 以及带 X-Health-Check 标记的请求。
 */
function isHealthCheckRequest(error: AxiosError): boolean {
  const url = error.config?.url || ''
  if (url.includes('/actuator/health') || url.includes('/auth/health')) {
    return true
  }
  return error.config?.headers?.['X-Health-Check'] === 'true'
}

/**
 * 取出后端返回的业务错误原文（response.data.message）。
 * 后端返回原文时优先透出（例如 "You are not authorized to approve this task"），
 * 比前端通用文案更有信息量；没有原文时返回空串，由调用方决定兜底文案。
 */
function extractServerMessage(error: AxiosError): string {
  const payload = error.response?.data as { message?: unknown } | undefined
  if (!payload || payload.message === undefined || payload.message === null) {
    return ''
  }
  return stringifyMessage(payload.message)
}

/**
 * 兜底提示：把后端原文带给用户，但避免与业务层的提示重复。
 *
 * 2026-10-29（N-02）规则：
 * - 拦截器**不无条件弹**：先让出一个宏任务，等业务层的 catch 有机会先提示；
 * - 业务层 catch 里已提示（markErrorHandled）→ 拦截器不再弹；
 * - 业务层没处理 → 拦截器兜底弹一次；同一条消息在去重窗口内只弹一次，
 *   因此「拦截器 + 调用方」不会弹成两条一模一样的 toast。
 */
function scheduleFallbackErrorToast(target: unknown, message: string, duration: number): void {
  setTimeout(() => {
    if (isErrorHandled(target)) {
      return
    }
    if (!claimErrorToast(message)) {
      return
    }
    void import('element-plus').then(({ ElMessage }) => {
      ElMessage.error({
        message,
        duration,
        showClose: true
      })
    })
  }, 0)
}

async function loadMockResponse(config: InternalAxiosRequestConfig): Promise<unknown> {
  if (!import.meta.env.DEV) {
    // mock 数据只在开发/测试构建中打包，生产构建不包含 mocks chunk
    logger.warn('🎭 [Mock Mode] 生产构建不含 mock 数据，请求将由真实后端处理:', config.url)
    return undefined
  }
  const { MockApiHandler } = await import('@/shared/api/mocks/handler')
  return MockApiHandler.handleRequest(config)
}

/**
 * 响应拦截器配置
 */
export interface ResponseInterceptorConfig {
  useMock?: boolean
}

/**
 * 创建响应成功拦截器
 */
export function createResponseInterceptor(config: ResponseInterceptorConfig = {}) {
  const { useMock: _useMock = USE_MOCK } = config

  return async (response: AxiosResponse): Promise<AxiosResponse> => {
    const requestConfig = response.config as InternalAxiosRequestConfig & {
      _skipBusinessErrorThrow?: boolean
    }
    // ========================================================================
    // MOCK MODE - 返回模拟数据
    // ========================================================================
    if ((response.config as InternalAxiosRequestConfig & { _mockMode?: boolean })._mockMode) {
      logger.debug('🎭 [Mock Mode] 返回模拟响应')
      if (response.data !== undefined) {
        return response
      }

      const mockResponse = await loadMockResponse(response.config)

      return {
        ...response,
        status: 200,
        statusText: 'OK',
        data: mockResponse
      }
    }
    // ========================================================================

    // ========================================================================
    // PERFORMANCE MONITORING
    // ========================================================================
    const startTime = response.config._startTime
    if (startTime) {
      const duration = Date.now() - startTime
      recordApiLatency(
        response.config.url || '',
        response.config.method || 'GET',
        duration,
        response.status,
        true
      )
    }

    // ========================================================================
    // CACHE RESPONSE HANDLING
    // ========================================================================
    if (response.config._useCache && response.config._cacheKey) {
      const cacheKey = response.config._cacheKey

      // Handle 304 Not Modified
      if (response.status === 304) {
        const cached = cacheManager.get(cacheKey)
        if (cached) {
          logger.debug('📦 [API Cache] 304 Not Modified, using cached data:', cacheKey)
          return { ...response, data: cached.data }
        }
      }

      // Cache the new response
      const etag = response.headers['etag']
      const lastModified = response.headers['last-modified']

      cacheManager.set(cacheKey, response.data, {
        etag,
        lastModified
      })

      logger.debug('📦 [API Cache] Cached response:', {
        key: cacheKey,
        etag: etag || 'none',
        lastModified: lastModified || 'none'
      })
    }

    // ========================================================================
    // RESPONSE FORMAT NORMALIZATION
    // ========================================================================
    const data = response.data

    // 格式1: { success: true/false, code, data, message }
    if (data && typeof data === 'object' && 'success' in data) {
      if (data.success) {
        return {
          ...response,
          data: {
            success: true,
            code: data.code ?? response.status,
            data: data.data,
            message: data.message
          }
        }
      }

      if (requestConfig._skipBusinessErrorThrow) {
        logger.debug('🫥 [API Business Error] skipped by request config', {
          url: response.config.url,
          code: data.code,
          message: stringifyMessage(data.message)
        })
        return response
      }

      logger.error(
        '❌ [API Business Error] success=false code:',
        data.code,
        'message:',
        stringifyMessage(data.message)
      )
      throw new Error(stringifyMessage(data.message) || 'Request failed')
    }

    // 格式2: { code, data, message }
    if (data && typeof data === 'object' && 'code' in data) {
      const normalizedCode = typeof data.code === 'number' ? data.code : Number(data.code)
      const isBusinessSuccess =
        normalizedCode === 0 ||
        normalizedCode === 200 ||
        (Number.isFinite(normalizedCode) && normalizedCode >= 200 && normalizedCode < 300)

      if (isBusinessSuccess) {
        return {
          ...response,
          data: {
            success: true,
            code: normalizedCode,
            data: data.data,
            message: data.message
          }
        }
      }

      if (requestConfig._skipBusinessErrorThrow) {
        logger.debug('🫥 [API Business Error] skipped by request config', {
          url: response.config.url,
          code: data.code,
          message: stringifyMessage(data.message)
        })
        return response
      }

      logger.error(
        '❌ [API Business Error] code:',
        data.code,
        'message:',
        stringifyMessage(data.message)
      )
      throw new Error(stringifyMessage(data.message) || 'Request failed')
    }

    // 格式3: 直接返回数据
    return {
      ...response,
      data: {
        success: true,
        data: data
      }
    }
  }
}

/**
 * 创建响应错误拦截器
 */
export function createResponseErrorInterceptor(config: ResponseInterceptorConfig = {}) {
  const { useMock = USE_MOCK } = config

  return async (error: AxiosError): Promise<never> => {
    // ========================================================================
    // MOCK MODE - 拦截错误并返回模拟数据
    // ========================================================================
    if (useMock && error.config) {
      logger.debug(
        '🎭 [Mock Mode] 拦截错误请求:',
        error.config.method?.toUpperCase(),
        error.config.url
      )

      const mockResponse = await loadMockResponse(error.config)
      return {
        ...error,
        status: 200,
        statusText: 'OK',
        data: mockResponse
      } as unknown as never
    }
    // ========================================================================

    // ========================================================================
    // PERFORMANCE MONITORING
    // ========================================================================
    const startTime = error.config?._startTime
    if (startTime) {
      const duration = Date.now() - startTime
      recordApiLatency(
        error.config?.url || '',
        error.config?.method || 'GET',
        duration,
        error.response?.status,
        false
      )
    }

    // 调试日志：响应错误
    logger.error('❌ [API Response Error]', {
      method: error.config?.method?.toUpperCase(),
      url: error.config?.url,
      status: error.response?.status,
      message: error.message,
      code: error.code,
      requestId: error.config?.headers?.['X-Request-ID']
    })

    // ========================================================================
    // BACKEND CONNECTION ERROR HANDLING
    // ========================================================================
    // 检查是否为后端连接错误（无响应）
    if (!error.response && error.request) {
      logger.error('🔌 [Backend Connection] 无法连接到后端服务')
      logger.error('🔍 [Backend Connection] 请检查:')
      logger.error(`   1. 后端服务是否运行在 ${backendDisplayTarget}`)
      logger.error('   2. 数据库连接是否正常')
      logger.error('   3. 防火墙或代理设置是否阻止连接')

      // 显示用户友好的错误提示
      const { ElMessage } = await import('element-plus')
      ElMessage.error({
        message: '无法连接到后端服务，请确认后端服务已启动',
        duration: 5000,
        showClose: true
      })
    }

    // ========================================================================
    // NETWORK TIMEOUT ERROR HANDLING
    // ========================================================================
    // 检查是否为超时错误
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      logger.error('⏱️ [Network Timeout] 请求超时')

      const { ElMessage } = await import('element-plus')
      ElMessage.warning({
        message: '请求超时，请检查网络连接或稍后重试',
        duration: 4000,
        showClose: true
      })
    }

    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }
    const isLoginRequest = originalRequest?.url?.includes('/auth/login')
    const isRefreshRequest = originalRequest?.url?.includes('/auth/refresh')

    const tryRefreshAndRetry = async (): Promise<never> => {
      // 登录和刷新请求失败，直接返回错误（不尝试刷新）
      if (isLoginRequest || isRefreshRequest) {
        logger.debug('🔒 [API Auth] 登录/刷新请求失败，不尝试刷新')
        return Promise.reject(error)
      }

      // 防止重复刷新（如果已经尝试过刷新但仍然失败）
      if (originalRequest?._retry) {
        logger.warn('🔒 [API Auth] Token 刷新后仍然失败，跳转登录')
        tokenManager.clearAccessToken()
        clearPersistedAuthState()
        redirectToLogin()
        return Promise.reject(error)
      }

      if (!originalRequest) {
        return Promise.reject(error)
      }

      originalRequest._retry = true

      try {
        logger.debug('🔄 [API Auth] 尝试刷新 Token...')
        const newToken = await tokenManager.refreshAccessToken()
        logger.debug('✅ [API Auth] Token 刷新成功，重试原请求')
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        return axios.request(originalRequest)
      } catch (refreshError) {
        logger.error('❌ [API Auth] Token 刷新失败:', refreshError)
        tokenManager.clearAccessToken()
        clearPersistedAuthState()
        redirectToLogin()
        return Promise.reject(refreshError)
      }
    }

    // ========================================================================
    // 401 AUTH ERROR HANDLING WITH AUTO REFRESH
    // ========================================================================
    if (error.response?.status === 401) {
      logger.warn('🔒 [API Auth] 401 未授权')
      return tryRefreshAndRetry()
    }

    // ========================================================================
    // 兜底提示文案准备
    //
    // 2026-10-29（N-02）修复要点：
    // - 此前只有 403 / 500 有提示分支，400 / 409 / 422 等业务错误被整个吞掉——
    //   后端返回的业务原文既没提示、调用方也拿不到，用户只看到「点了没反应」。
    // - 现在这里只**准备**兜底文案，真正的弹窗延后到宏任务里由
    //   scheduleFallbackErrorToast 触发：业务层 catch 已提示过的错误不再重复弹，
    //   保证同一条错误只出现一次。
    // ========================================================================
    let fallbackToast: { message: string; duration: number } | null = null

    // ------------------------------------------------------------------
    // 403 FORBIDDEN
    // ------------------------------------------------------------------
    if (error.response?.status === 403) {
      logger.warn('🚫 [API Auth] 403 权限不足')

      // 不要为健康检查请求显示错误通知（403是预期的）
      const isHealthCheck = isHealthCheckRequest(error)

      // 某些受保护接口在 access token 过期时会返回 403。
      // 对于非登录/刷新、非健康检查请求，优先尝试刷新一次 token 后重放请求。
      if (!isHealthCheck && !isLoginRequest && !isRefreshRequest) {
        const currentToken = tokenManager.getAccessToken()
        if (currentToken && tokenManager.isTokenExpiring(0)) {
          logger.warn('🔄 [API Auth] 403 可能由 access token 过期引起，尝试刷新后重试')
          return tryRefreshAndRetry()
        }
      }

      // 登录/刷新请求由认证层自己提示（见 auth store / LoginView），此处不重复弹。
      if (!isHealthCheck && !isLoginRequest && !isRefreshRequest) {
        fallbackToast = {
          // 后端原文优先透出；原文是英文时用中文兜底 + 原文附注（不静默）
          message: buildUserFacingErrorMessage(
            extractServerMessage(error),
            '权限不足，无法执行此操作',
            403
          ),
          duration: 3000
        }
      }
    }

    // ------------------------------------------------------------------
    // 4XX CLIENT ERROR (400 / 404 / 409 / 422 ...)
    // ------------------------------------------------------------------
    const clientErrorStatus = error.response?.status
    if (
      !fallbackToast &&
      typeof clientErrorStatus === 'number' &&
      clientErrorStatus >= 400 &&
      clientErrorStatus < 500 &&
      clientErrorStatus !== 401 && // 401 走刷新重试逻辑，不在此提示
      clientErrorStatus !== 403 && // 403 已有专门分支，避免重复弹两次
      !isLoginRequest && // 登录/刷新请求由业务层自己提示，避免重复弹窗
      !isRefreshRequest &&
      !isHealthCheckRequest(error)
    ) {
      logger.warn(`⚠️ [Client Error] ${clientErrorStatus} ${error.config?.url || ''}`)

      fallbackToast = {
        message: buildUserFacingErrorMessage(
          // 后端原文优先（transformError → formatErrorMessage 同样以
          // response.data.message 为先）；后端没给原文时用状态码兜底文案
          extractServerMessage(error),
          clientErrorFallbackText(clientErrorStatus),
          clientErrorStatus
        ),
        duration: 3000
      }
    }

    // ------------------------------------------------------------------
    // 500 SERVER ERROR
    // ------------------------------------------------------------------
    if (error.response?.status === 500) {
      logger.error('💥 [Server Error] 服务器内部错误')

      if (!isHealthCheckRequest(error)) {
        fallbackToast = {
          message: '服务器内部错误，请稍后重试或联系管理员',
          duration: 5000
        }
      }
    }

    // ========================================================================
    // UNIFIED ERROR HANDLING
    // ========================================================================
    const apiError = transformError(error)
    const extendedError = {
      ...toExtendedError(apiError, error),
      // 业务层 catch 里提示过后会置为 true，拦截器的兜底提示据此跳过
      handled: false
    } as ExtendedErrorInfo & { handled?: boolean }

    logger.error('❌ [API Error] 统一错误格式:', {
      code: extendedError.code,
      message: extendedError.message,
      requestId: extendedError.requestId,
      severity: extendedError.severity,
      retryable: extendedError.retryable
    })

    if (fallbackToast) {
      scheduleFallbackErrorToast(extendedError, fallbackToast.message, fallbackToast.duration)
    }

    return Promise.reject(extendedError)
  }
}
