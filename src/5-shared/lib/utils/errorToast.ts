/**
 * 错误提示协调（N-02「点了没反应」修复，2026-10-29）
 *
 * 背景：
 * - 同一个后端错误常常被多层代码各自捕获并弹一次提示（响应拦截器 / 业务 catch /
 *   store 兜底），用户会看到多条一模一样的 toast（实测 409 场景弹了两条）。
 * - 响应拦截器若「无条件弹」，业务层再弹一次就会变成三条。
 *
 * 约定：
 * 1. `claimErrorToast(message)` —— 登记一条提示。同一条消息在去重窗口内只允许弹一次，
 *    第二次调用返回 false（调用方据此跳过弹窗）。
 * 2. `markErrorHandled(error)` / `isErrorHandled(error)` —— 业务层 catch 里已经提示过
 *    该错误时，在错误对象上打标记；响应拦截器的兜底提示据此跳过，
 *    保证「同一条错误只出现一次」。
 * 3. `buildUserFacingErrorMessage(...)` —— 把后端原文转成用户看得懂的文案：
 *    后端给的是中文原文就直接透出（用户知道该做什么）；给的是英文原文时
 *    用中文兜底 + 原文附注（避免对普通用户不友好，也避免静默无提示）。
 */

/** 去重窗口：同一条消息在该窗口内只弹一次 */
const DEDUP_WINDOW_MS = 3000

/** 最近弹过的消息 → 弹出的时间戳 */
const recentMessages = new Map<string, number>()

/** 中日韩统一表意文字（用于判断后端原文是否是用户看得懂的中文） */
const CHINESE_TEXT_PATTERN = /[\u4e00-\u9fa5]/

/**
 * 登记一条错误提示；返回 false 表示同一条消息刚刚已经弹过，应跳过。
 */
export function claimErrorToast(message: string): boolean {
  const key = String(message || '').trim()
  if (!key) {
    return true
  }

  const now = Date.now()

  // 清理过期记录，避免 Map 无限增长
  recentMessages.forEach((shownAt, shownKey) => {
    if (now - shownAt > DEDUP_WINDOW_MS) {
      recentMessages.delete(shownKey)
    }
  })

  const lastShownAt = recentMessages.get(key)
  if (lastShownAt !== undefined && now - lastShownAt < DEDUP_WINDOW_MS) {
    return false
  }

  recentMessages.set(key, now)
  return true
}

/**
 * 标记「该错误已经由业务层提示过」，响应拦截器的兜底提示会跳过。
 */
export function markErrorHandled(error: unknown): void {
  if (error && typeof error === 'object') {
    ;(error as { handled?: boolean }).handled = true
  }
}

/**
 * 该错误是否已经由业务层提示过。
 */
export function isErrorHandled(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { handled?: boolean }).handled)
}

/**
 * 文案里是否包含中文。
 */
export function containsChineseText(text: string): boolean {
  return CHINESE_TEXT_PATTERN.test(String(text || ''))
}

/**
 * 把后端返回的业务原文转成用户看得懂的提示文案。
 *
 * - 后端给了中文原文 → 直接透出（内容本身可执行，例如「资源冲突：存在未评定的
 *   鉴定进度等级（指标 2046、2047），请先在指标列表中完成全部指标的鉴定后再通过」）
 * - 后端给了英文原文 → 中文兜底 + 原文附注（不静默，也不丢原文）
 * - 后端没给原文 → 用状态码兜底文案
 */
export function buildUserFacingErrorMessage(
  rawMessage: string,
  fallbackText: string,
  status?: number
): string {
  const raw = String(rawMessage || '').trim()
  if (!raw) {
    return fallbackText
  }

  if (containsChineseText(raw)) {
    return raw
  }

  const base = status === 403 ? '权限不足，无法执行此操作' : fallbackText
  return `${base}（${raw}）`
}

/**
 * 4xx 状态码的兜底文案（后端没给原文时使用）。
 */
export function clientErrorFallbackText(status: number): string {
  switch (status) {
    case 400:
      return '请求参数有误，请检查后重试'
    case 404:
      return '请求的内容不存在或已被删除'
    case 409:
      return '操作与当前状态冲突，请刷新后重试'
    case 422:
      return '提交的内容未通过校验，请检查后重试'
    case 429:
      return '操作过于频繁，请稍后重试'
    default:
      return `请求失败（${status}）`
  }
}
