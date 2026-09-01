/**
 * DingTalk H5 容器免登 (钉钉微应用内自动登录)
 *
 * 职责:
 * - 检测当前页面是否运行在钉钉内置浏览器中
 * - 通过官方 dingtalk-jsapi SDK 申请免登码
 * - 编排"免登码 → 后端换 SISM 登录态"的静默登录流程
 *
 * 设计约束:
 * - SDK 通过 npm 打包进应用（dingtalk-jsapi），不依赖 CDN 脚本加载
 * - 只在钉钉容器内且后端启用钉钉集成时才工作，其余环境一律跳过
 * - 每次页面加载只尝试一次，结果在会话内缓存，避免路由守卫反复触发
 */

import { ref } from 'vue'
import dd from 'dingtalk-jsapi'
import { apiClient as api } from '@/shared/api/client'
import { logger } from '@/shared/lib/utils/logger'

const AUTH_CODE_TIMEOUT_MS = 10000

export interface DingTalkAutoLoginResult {
  ok: boolean
  /** 未进入免登流程（非钉钉容器/集成未启用），不算错误 */
  skipped?: boolean
  error?: string
}

/** 最近一次免登失败的原因，供登录页展示（钉钉用户没有本系统密码，无法走账号登录） */
export const dingTalkLoginError = ref<string | null>(null)

export const isDingTalkContainer = (): boolean => {
  if (typeof navigator === 'undefined') {
    return false
  }
  return /DingTalk/i.test(navigator.userAgent)
}

/** PC 桌面端钉钉（工作台容器存在，才需要 workbench 打开方式） */
export const isPcDingTalk = (): boolean => {
  if (typeof navigator === 'undefined') {
    return false
  }
  return (
    /DingTalk/i.test(navigator.userAgent) &&
    !/Mobile|Android|iPhone|iPad/i.test(navigator.userAgent)
  )
}

interface DingTalkStatus {
  enabled: boolean
  configured: boolean
  corpId: string
}

const fetchDingTalkStatus = async (): Promise<DingTalkStatus | null> => {
  try {
    const response = (await api.get('/auth/dingtalk/status')) as Record<string, unknown>
    const data = (
      response && typeof response === 'object' && 'data' in response ? response.data : response
    ) as Record<string, unknown> | null
    if (!data || typeof data !== 'object') {
      return null
    }
    return {
      enabled: data.enabled === true,
      configured: data.configured === true,
      corpId: typeof data.corpId === 'string' ? data.corpId.trim() : ''
    }
  } catch (error) {
    logger.warn('[DingTalk] 无法获取钉钉集成状态:', error)
    return null
  }
}

/** 钉钉容器就绪（dd.ready），requestAuthCode 必须在 ready 回调后调用 */
const whenDingTalkReady = (): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('钉钉容器就绪超时'))
    }, AUTH_CODE_TIMEOUT_MS)
    dd.ready(() => {
      window.clearTimeout(timer)
      resolve()
    })
    dd.error((err: unknown) => {
      window.clearTimeout(timer)
      reject(new Error(`钉钉容器异常: ${JSON.stringify(err)}`))
    })
  })
}

const requestDingTalkAuthCode = async (corpId: string): Promise<string> => {
  await whenDingTalkReady()
  return new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('获取钉钉免登码超时'))
    }, AUTH_CODE_TIMEOUT_MS)

    dd.runtime.permission.requestAuthCode({
      corpId,
      onSuccess: result => {
        window.clearTimeout(timer)
        resolve(result.code)
      },
      onFail: err => {
        window.clearTimeout(timer)
        reject(new Error(`获取钉钉免登码失败: ${JSON.stringify(err)}`))
      }
    })
  })
}

/**
 * PC 钉钉内以工作台模式打开链接（占满主窗口，非侧边栏半屏）。
 * 返回 false 表示不在 PC 钉钉或 JSAPI 不可用，调用方应回退到普通路由跳转。
 */
export const openLinkInWorkbench = async (url: string): Promise<boolean> => {
  if (!isPcDingTalk()) {
    return false
  }
  try {
    return await new Promise<boolean>(resolve => {
      let settled = false
      const finish = (ok: boolean) => {
        if (!settled) {
          settled = true
          resolve(ok)
        }
      }
      dd.biz.util.openLink({
        url,
        targetDesktop: 'workbench',
        onSuccess: () => finish(true),
        onFail: () => finish(false)
      })
      window.setTimeout(() => finish(false), 3000)
    })
  } catch {
    return false
  }
}

let autoLoginPromise: Promise<DingTalkAutoLoginResult> | null = null

const performAutoLogin = async (): Promise<DingTalkAutoLoginResult> => {
  if (!isDingTalkContainer()) {
    return { ok: false, skipped: true }
  }

  const status = await fetchDingTalkStatus()
  if (!status || !status.enabled || !status.corpId) {
    logger.debug('[DingTalk] 钉钉集成未启用，跳过免登')
    return { ok: false, skipped: true }
  }

  const authCode = await requestDingTalkAuthCode(status.corpId)
  const { useAuthStore } = await import('@/features/auth/model/store')
  const authStore = useAuthStore()
  const result = await authStore.loginWithDingTalk(authCode)
  if (result.success) {
    logger.debug('[DingTalk] 免登成功:', authStore.userRole)
    return { ok: true }
  }
  return { ok: false, error: result.error }
}

/**
 * 钉钉容器内静默免登。结果在整个页面会话内缓存：
 * 免登失败（如账号未绑定）在同一会话内不会反复请求。
 */
export const tryDingTalkAutoLogin = (): Promise<DingTalkAutoLoginResult> => {
  if (!autoLoginPromise) {
    autoLoginPromise = performAutoLogin().catch(error => {
      const message = (error as { message?: string }).message || '钉钉免登失败，请重新进入应用'
      logger.warn('[DingTalk] 免登流程异常:', message)
      return { ok: false, error: message }
    })

    autoLoginPromise.then(result => {
      if (result.ok) {
        dingTalkLoginError.value = null
      } else if (result.error) {
        dingTalkLoginError.value = result.error
      }
    })
  }
  return autoLoginPromise
}
