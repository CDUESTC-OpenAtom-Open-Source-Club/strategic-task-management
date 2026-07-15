/**
 * Canonical retry wrapper helpers for feature-layer API orchestration.
 */

import type { RetryConfig } from '@/shared/api/retry'
import { logger } from '@/shared/lib/utils/logger'

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const { maxRetries = 3, baseDelay = 1000, maxDelay = 10000 } = config

  let lastError: Error | null = null
  let attemptsMade = 0

  const toReadableError = (error: unknown): Error => {
    if (error instanceof Error) {
      return error
    }

    const messageCandidates = [
      (error as { details?: { message?: unknown } } | null)?.details?.message,
      (error as { response?: { data?: { message?: unknown } } } | null)?.response?.data?.message,
      (error as { message?: unknown } | null)?.message
    ]
    const message = messageCandidates.find(
      value => typeof value === 'string' && value.trim() && value.trim() !== '[object Object]'
    )

    return new Error(typeof message === 'string' ? message : String(error))
  }

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      attemptsMade = attempt
      lastError = toReadableError(error)

      logger.warn(`[Retry] Attempt ${attempt}/${maxRetries} failed:`, error)

      const explicitlyNonRetryable =
        typeof error === 'object' &&
        error !== null &&
        'retryable' in error &&
        (error as { retryable?: boolean }).retryable === false

      const status =
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        typeof (error as { status?: unknown }).status === 'number'
          ? (error as { status: number }).status
          : undefined

      const isClientError = status !== undefined && status >= 400 && status < 500

      if (explicitlyNonRetryable || isClientError) {
        logger.debug('[Retry] Error marked as non-retryable, aborting remaining attempts')
        break
      }

      if (attempt < maxRetries) {
        const delayMs = Math.min(baseDelay * attempt, maxDelay)
        logger.debug(`[Retry] Waiting ${delayMs}ms before next attempt`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }

  logger.error(
    `[Retry] ${attemptsMade}/${maxRetries} attempts failed`,
    lastError ?? new Error('Unknown error')
  )
  throw lastError ?? new Error('Unknown error')
}

export async function withExponentialRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const { maxRetries = 3, baseDelay = 1000, maxDelay = 10000 } = config

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      logger.warn(`[Retry] Attempt ${attempt}/${maxRetries} failed:`, error)

      if (attempt < maxRetries) {
        const delayMs = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay)
        logger.debug(`[Retry] Waiting ${delayMs}ms before next attempt`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }

  logger.error(`[Retry] All ${maxRetries} attempts failed`, lastError ?? new Error('Unknown error'))
  throw lastError ?? new Error('Unknown error')
}
