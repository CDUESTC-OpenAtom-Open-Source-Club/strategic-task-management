/**
 * Request Interceptors - 请求拦截器模块
 *
 * 职责:
 * - Mock 模式处理
 * - 性能监控
 * - 缓存验证头
 * - 请求 ID
 * - 认证 Token
 * - 请求签名
 * - 幂等性 Key
 *
 * @module api/interceptors
 */

import type { InternalAxiosRequestConfig } from 'axios'
import { generateSignature } from '@/shared/lib/utils/security'
import { logger } from '@/shared/lib/utils/logger'
import { adaptV1Path } from '@/shared/api/v1PathAdapter'
import { addRequestId } from '@/shared/api/errorHandler'
import { tokenManager } from '@/shared/lib/utils/tokenManager'
import {
  generateIdempotencyKey,
  shouldAddIdempotencyKey,
  DEFAULT_IDEMPOTENCY_CONFIG
} from '@/shared/lib/utils/idempotency'
import { generateCacheKey, shouldCache, getCacheValidationHeaders } from '@/shared/lib/utils/cache'
import { USE_MOCK } from '@/shared/config/api'

// 需要签名验证的敏感操作路径
const SENSITIVE_PATHS = ['/auth/password', '/indicators', '/tasks']
const PUBLIC_AUTH_PATHS = [
  '/auth/login',
  '/auth/refresh',
  '/auth/validate',
  '/auth/register',
  '/auth/password-reset/send',
  '/auth/password-reset/verify',
  '/auth/password-reset/confirm'
]

/**
 * 请求拦截器配置
 */
export interface RequestInterceptorConfig {
  useMock?: boolean
  sensitivePaths?: string[]
}

/**
 * 创建请求拦截器
 */
export function createRequestInterceptor(config: RequestInterceptorConfig = {}) {
  const { useMock = USE_MOCK, sensitivePaths = SENSITIVE_PATHS } = config

  return async (axiosConfig: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> => {
    const config = axiosConfig as InternalAxiosRequestConfig & {
      _mockMode?: boolean
      _startTime?: number
      _cacheKey?: string
      _useCache?: boolean
    }

    // ========================================================================
    // V1 PATH ADAPTER - rewrite legacy frontend paths to OpenAPI v1 contract
    // ========================================================================
    if (config.url) {
      const adapted = adaptV1Path(config.url)
      if (adapted.changed) {
        logger.debug(`[API PathAdapter] ${config.url} -> ${adapted.adaptedPath}`, {
          reason: adapted.reason
        })
      } else if (adapted.unsupported) {
        logger.warn(`[API PathAdapter] Unmapped contract path: ${config.url}`, {
          reason: adapted.reason
        })
      }
      config.url = adapted.adaptedPath
    }

    // ========================================================================
    // MOCK MODE - 拦截请求并返回模拟数据
    // ========================================================================
    if (useMock) {
      logger.debug('🎭 [Mock Mode] 拦截请求:', config.method?.toUpperCase(), config.url)
      config._mockMode = true
      return config
    }
    // ========================================================================

    // ========================================================================
    // PERFORMANCE MONITORING - Record request start time
    // ========================================================================
    config._startTime = Date.now()

    // ========================================================================
    // CACHE VALIDATION HEADERS
    // ========================================================================
    if (config.method?.toUpperCase() === 'GET' && shouldCache(config.method, config.url || '')) {
      const cacheKey = generateCacheKey(config.url || '', config.params)
      config._cacheKey = cacheKey
      config._useCache = true

      // Add cache validation headers
      const cacheHeaders = getCacheValidationHeaders(config.url || '', config.params)
      Object.entries(cacheHeaders).forEach(([key, value]) => {
        config.headers[key] = value
      })

      if (Object.keys(cacheHeaders).length > 0) {
        logger.debug('📦 [API Cache] Validation headers added:', cacheHeaders)
      }
    }

    // ========================================================================
    // REQUEST ID (for error tracking and log correlation)
    // ========================================================================
    addRequestId(config)

    // 调试日志：请求开始
    // ========================================================================
    // AUTH TOKEN
    // ========================================================================
    const token = tokenManager.getAccessToken()

    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    } else if (!PUBLIC_AUTH_PATHS.some(path => config.url?.includes(path))) {
      logger.warn('[RequestInterceptor] 无Token，未添加Authorization头:', config.url)
      logger.warn('⚠️ [API Auth] 无Token (tokenManager 为空)', {
        url: config.url
      })
    }

    // ========================================================================
    // REQUEST SIGNATURE (for sensitive operations)
    // ========================================================================
    const isSensitive = sensitivePaths.some(path => config.url?.includes(path))
    const isWriteOperation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(
      config.method?.toUpperCase() || ''
    )

    if (isSensitive && isWriteOperation) {
      const timestamp = Date.now()
      try {
        const signature = await generateSignature(config.data, timestamp)
        config.headers['X-Timestamp'] = timestamp.toString()
        config.headers['X-Signature'] = signature
        logger.debug('🔏 [API Security] 签名已添加')
      } catch (error) {
        logger.warn('⚠️ [API Security] 签名生成失败，降级为无签名请求继续发送', {
          url: config.url,
          error
        })
      }
    }

    // ========================================================================
    // IDEMPOTENCY KEY (for write operations on protected paths)
    // ========================================================================
    if (shouldAddIdempotencyKey(config.method, config.url || '', DEFAULT_IDEMPOTENCY_CONFIG)) {
      try {
        const idempotencyKey = await generateIdempotencyKey(
          config.method || 'POST',
          config.url || '',
          config.data
        )
        config.headers['X-Idempotency-Key'] = idempotencyKey
        logger.debug('🔑 [API Idempotency] Key已添加:', idempotencyKey.substring(0, 8) + '...')
      } catch (error) {
        logger.warn('⚠️ [API Idempotency] 生成Key失败:', error)
      }
    }

    return config
  }
}

/**
 * 创建请求错误拦截器
 */
export function createRequestErrorInterceptor() {
  return (error: unknown): Promise<never> => {
    logger.error('❌ [API Request Error]', error)
    return Promise.reject(error)
  }
}
