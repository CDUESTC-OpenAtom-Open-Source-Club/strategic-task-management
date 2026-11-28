/**
 * Auth Feature Store
 *
 * Migrated from stores/auth.ts
 * Authentication and authorization state management
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiClient as api } from '@/shared/api/client'
import { formatErrorMessage } from '@/shared/api/errorHandler'
import type { User, UserRole } from '@/shared/types'
import { logger } from '@/shared/lib/utils/logger'
import { tokenManager, TokenRefreshError } from '@/shared/lib/utils/tokenManager'
import { parseLoginResponse, mapBackendUser, isKnownUserRole } from '@/shared/lib/utils/authHelpers'
import { useTimeContextStore } from '@/shared/lib/timeContext'
import { buildQueryKey, fetchWithCache, invalidateQueries } from '@/shared/lib/utils/cache'
import { authApi } from '../api/auth'
import type { IdentityDTO } from '../api/types'
import {
  extractIdentityContext,
  resolveCurrentIdentity,
  sortIdentities,
  type IdentityContext
} from '../lib/identity'
import { resetIdentityRuntimeState } from '../lib/identityReset'

/** 切换身份后统一落地数据看板（已拍板：不同角色首页不一致，不保留当前页） */
const IDENTITY_SWITCH_LANDING_ROUTE = '/dashboard'

/**
 * 过场节奏（毫秒，自过场开始的绝对时刻）：四个步骤逐步点亮，每步「展示满对应时刻」
 * 且「该步实际工作完成」才推进下一步。接口慢时所在步自动延长，接口快时也不快进，
 * 两种耗时不叠加。总时长约 3s，保证步骤动画有过程感（演示场景本地接口秒回，不加会连跳）。
 */
const SWITCH_STEP_REQUEST_END_MS = 800
const SWITCH_STEP_APPLY_END_MS = 1700
const SWITCH_STEP_RESET_END_MS = 2400
const SWITCH_STEP_NAVIGATE_END_MS = 3000
/** 失败收尾：过场至少停到该时刻，让失败提示与回滚过程可见，不闪退 */
const SWITCH_FAILURE_HOLD_MS = 1000

/** 补足到 startedAt + targetMs 的剩余等待；已超过则立即返回，等待不叠加 */
const sleepUntil = (startedAt: number, targetMs: number): Promise<void> =>
  new Promise(resolve => {
    const remaining = startedAt + targetMs - Date.now()
    if (remaining <= 0) {
      resolve()
      return
    }
    setTimeout(resolve, remaining)
  })

/** 身份列表与钉钉用户 ID 的本地持久化 key（与 currentUser 同生命周期） */
const IDENTITY_CONTEXT_STORAGE_KEY = 'identityContext'

const EMPTY_IDENTITY_CONTEXT: IdentityContext = { identities: [], dingTalkUserId: null }

/** 切换身份过场的阶段；reset / navigate 两步期间应用壳层整体卸载，完成后在数据看板重挂 */
export type IdentitySwitchPhase = 'idle' | 'request' | 'apply' | 'reset' | 'navigate'

export interface SwitchIdentityResult {
  success: boolean
  error?: string
  /** 失败时的原始错误对象，供调用方标记已提示（避免响应拦截器重复弹兜底提示） */
  cause?: unknown
}

/** 切换接口返回的响应不是登录态结构（没有 token / 用户），不落地 */
export const SWITCH_ERROR_BAD_RESPONSE = '切换身份失败：服务器响应格式错误，请稍后重试'

interface IdentitySnapshot {
  token: string | null
  user: User | null
  identities: IdentityDTO[]
  dingTalkUserId: string | null
  refreshToken: string | null
}

const readRefreshToken = (): string | null => {
  return typeof localStorage !== 'undefined' ? localStorage.getItem('refreshToken') : null
}

const writeRefreshToken = (refreshToken: string | null): void => {
  if (refreshToken) {
    localStorage.setItem('refreshToken', refreshToken)
  } else {
    localStorage.removeItem('refreshToken')
  }
}

const resolveSwitchErrorMessage = (error: unknown): string => {
  const record = error as { message?: unknown; response?: { data?: { message?: unknown } } } | null
  // 优先后端返回的业务原文
  const serverMessage = record?.response?.data?.message
  if (typeof serverMessage === 'string' && serverMessage.trim()) {
    return serverMessage.trim()
  }
  const rawMessage = typeof record?.message === 'string' ? record.message.trim() : ''
  // axios 原始错误只有「Request failed with status code 401」这类英文，换成按状态码的中文文案
  if (rawMessage && !/^Request failed with status code \d+$/.test(rawMessage)) {
    return rawMessage
  }
  const formattedMessage = formatErrorMessage(error)
  return formattedMessage && formattedMessage !== '未知错误' ? formattedMessage : '请稍后重试'
}

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

  // 多身份：同一钉钉账号绑定的全部部门席位。钉钉登录 / 切换身份的响应填充，
  // 账号密码登录与旧版后端不下发，保持为空（单身份用户不展示多身份 UI）。
  const identities = ref<IdentityDTO[]>([])
  const dingTalkUserId = ref<string | null>(null)

  // 切换身份过场：switching 期间界面全屏遮罩、禁止重复点击
  const switching = ref(false)
  const switchingPhase = ref<IdentitySwitchPhase>('idle')
  const switchingTarget = ref<IdentityDTO | null>(null)

  const persistIdentityContext = () => {
    try {
      if (identities.value.length === 0 && !dingTalkUserId.value) {
        localStorage.removeItem(IDENTITY_CONTEXT_STORAGE_KEY)
        return
      }
      localStorage.setItem(
        IDENTITY_CONTEXT_STORAGE_KEY,
        JSON.stringify({ identities: identities.value, dingTalkUserId: dingTalkUserId.value })
      )
    } catch (error) {
      logger.warn('[Auth] 身份列表持久化失败:', error)
    }
  }

  const applyIdentityContext = (context: IdentityContext) => {
    identities.value = sortIdentities(context.identities)
    dingTalkUserId.value = context.dingTalkUserId
    persistIdentityContext()
  }

  /**
   * 会话恢复时从本地取回身份列表。
   * 当前账号不在列表里（本地缓存串了别的会话）时视为单身份，避免展示切换不过去的身份。
   */
  const restoreIdentityContextFor = (restoredUser: User | null): IdentityContext => {
    let context = EMPTY_IDENTITY_CONTEXT
    try {
      const raw = localStorage.getItem(IDENTITY_CONTEXT_STORAGE_KEY)
      context = raw ? extractIdentityContext(JSON.parse(raw)) : EMPTY_IDENTITY_CONTEXT
    } catch (error) {
      logger.warn('[Auth] 解析本地身份列表失败:', error)
    }
    if (!resolveCurrentIdentity(context.identities, restoredUser)) {
      context = EMPTY_IDENTITY_CONTEXT
    }
    applyIdentityContext(context)
    return context
  }

  const clearIdentityContext = () => {
    identities.value = []
    dingTalkUserId.value = null
    switching.value = false
    switchingPhase.value = 'idle'
    switchingTarget.value = null
    localStorage.removeItem(IDENTITY_CONTEXT_STORAGE_KEY)
  }

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

  /**
   * 缓存用户是否携带后端角色编码（ROLE_*）。
   * 审批按钮可见性依赖 roles 做角色匹配；旧缓存可能只有 role 没有 roles，
   * 缺失时必须在会话恢复后主动 fetchUser() 自愈，否则审批人永远看不到通过/驳回按钮。
   */
  const hasRoleCodes = (candidate: User): boolean => {
    return (
      Array.isArray(candidate.roles) && candidate.roles.some(code => String(code).trim() !== '')
    )
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

  // 多身份：绑定 2 个及以上席位才展示角标 / 身份列表 / 上下文条
  const hasMultipleIdentities = computed(() => identities.value.length > 1)
  const currentIdentity = computed(() => resolveCurrentIdentity(identities.value, user.value))
  /**
   * 切换过场进入「清状态 / 跳转」两步后，应用壳层整体卸载（App.vue 据此 v-if 掉根 router-view）：
   * 带旧身份状态的组件不再渲染，完成后再在新身份下重新挂载。
   */
  const identityShellSuspended = computed(
    () => switchingPhase.value === 'reset' || switchingPhase.value === 'navigate'
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
   * 账号密码登录、钉钉免登、切换身份共用。
   *
   * @param options.reloadStrategicData 登录后是否顺带重载指标数据；切换身份时关闭
   *   （过场结束应用壳层重挂，各视图自行重新加载）。
   */
  const applyLoginResponse = async (
    response: Record<string, unknown>,
    options: { reloadStrategicData?: boolean } = {}
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
    // 多身份：钉钉登录 / 切换身份的响应带 identities 与 dingTalkUserId（可选字段，缺失即为单身份）
    applyIdentityContext(extractIdentityContext(response))
    invalidateQueries(['auth.user'])
    authInitialized.value = true

    // 登录成功后，触发数据重新加载
    if (options.reloadStrategicData !== false && mappedUser.role === 'strategic_dept') {
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

  /**
   * 切换身份：换到同一钉钉账号绑定的另一个部门席位。
   *
   * 等价于「退出旧账号 + 登录新账号」，但不调用 logout()、不跳 /login、不重新免登——
   * 否则路由守卫会静默免登并取回默认身份，造成回弹。
   *
   * 流程：校验入参 → 调切换接口 → 纯解析校验（不改登录态）→ 壳层挂起（旧页面卸载）
   * 后落地登录响应并清上一身份的前端状态 → router.push('/dashboard')。
   * 接口失败与解析失败时不改动任何登录状态；落地失败时（壳层已挂起）回滚到
   * 切换前的登录状态，收尾后重挂旧身份页面。
   *
   * 过场按「顺序节奏器」推进：每步展示满 SWITCH_STEP_*_END_MS 且该步实际工作完成
   * 才点亮下一步，全部完成后才跳转；失败时停在当前失败步、足展后再收尾，不闪退。
   */
  const switchIdentity = async (targetSysUserId: number): Promise<SwitchIdentityResult> => {
    if (switching.value) {
      return { success: false, error: '身份切换进行中，请稍候' }
    }

    const target = identities.value.find(identity => identity.sysUserId === targetSysUserId)
    if (!target) {
      return { success: false, error: '目标身份不在当前账号的可切换身份列表内' }
    }
    if (currentIdentity.value?.sysUserId === target.sysUserId) {
      return { success: true }
    }
    const currentDingTalkUserId = dingTalkUserId.value
    // 过场计时起点：上面 early return 的路径（进行中 / 目标不存在 / 目标=当前）不显示过场
    // （switching 未置 true），不参与计时、不做等待
    const startedAt = Date.now()

    const finish = () => {
      switching.value = false
      switchingPhase.value = 'idle'
      switchingTarget.value = null
    }

    switching.value = true
    switchingPhase.value = 'request'
    switchingTarget.value = target

    // 第 1 步「校验目标身份归属」：接口立即发起，与步骤展示并行；
    // 接口慢时该步自动延长（Promise.all 等两边都完成），接口快时也不快进
    let response: Record<string, unknown>
    try {
      const [, switchResponse] = await Promise.all([
        sleepUntil(startedAt, SWITCH_STEP_REQUEST_END_MS),
        // 后端以令牌里的当前账号为准；dingTalkUserId 仅作一致性核对，可选携带
        authApi.switchIdentity({
          ...(currentDingTalkUserId ? { dingTalkUserId: currentDingTalkUserId } : {}),
          targetSysUserId: target.sysUserId
        })
      ])
      response = switchResponse as unknown as Record<string, unknown>
    } catch (error) {
      logger.warn('[Auth] 切换身份失败:', error)
      // 过场停在第 1 步，停留满 1s 再收尾，让失败过程可见
      await sleepUntil(startedAt, SWITCH_FAILURE_HOLD_MS)
      finish()
      return {
        success: false,
        error: `切换身份失败：${resolveSwitchErrorMessage(error)}`,
        cause: error
      }
    }

    if (!response || typeof response !== 'object') {
      logger.warn('[Auth] 切换身份响应格式异常:', response)
      // 仍是第 1 步的失败，同样足展后收尾
      await sleepUntil(startedAt, SWITCH_FAILURE_HOLD_MS)
      finish()
      return { success: false, error: SWITCH_ERROR_BAD_RESPONSE }
    }

    switchingPhase.value = 'apply'
    // 快照备份旧登录态，供落地失败时回滚；此刻尚未改动任何登录态
    const snapshot: IdentitySnapshot = {
      token: token.value,
      user: user.value,
      identities: identities.value.map(identity => ({ ...identity, roles: [...identity.roles] })),
      dingTalkUserId: currentDingTalkUserId,
      refreshToken: readRefreshToken()
    }

    /** 回滚到切换前的登录态（内存 + 持久化同步还原） */
    const rollbackToSnapshot = () => {
      token.value = snapshot.token
      if (snapshot.token) {
        tokenManager.setAccessToken(snapshot.token)
      } else {
        tokenManager.clearAccessToken()
      }
      user.value = snapshot.user
      identities.value = snapshot.identities
      dingTalkUserId.value = snapshot.dingTalkUserId
      persistUser(snapshot.user)
      persistIdentityContext()
      writeRefreshToken(snapshot.refreshToken)
    }

    // 第 2 步「签发新身份登录凭证」：只做纯解析校验（凭证已在接口响应里），
    // 不落地、不改任何 store 登录态——真正落地推迟到第 3 步壳层挂起之后，
    // 保证旧页面在第 2 步期间仍以旧身份渲染，不在遮罩下提前变成新身份
    let parseError: string | null = null
    try {
      const parseResult = parseLoginResponse(response)
      if (!parseResult.success || !parseResult.data) {
        parseError = parseResult.error || '登录失败：服务器响应格式错误'
      }
    } catch (error) {
      logger.error('[Auth] 切换身份响应解析异常:', error)
      parseError = ''
    }
    // 第 2 步足展到 apply 时刻（解析快时不快进，保持步骤节奏）
    await sleepUntil(startedAt, SWITCH_STEP_APPLY_END_MS)

    if (parseError !== null) {
      // 解析未过：登录态从未改动，仍按快照收尾（壳层未挂起，正常关闭过场）
      rollbackToSnapshot()
      // 解析失败的文案带「登录失败：」前缀，这里换成切换语境
      const applyError = parseError.replace(/^登录失败：/, '')
      logger.warn('[Auth] 切换身份响应解析失败，已回滚到原身份:', parseError)
      finish()
      return {
        success: false,
        error: applyError ? `切换身份失败：${applyError}` : SWITCH_ERROR_BAD_RESPONSE
      }
    }

    // 第 3 步「落地新身份并清除上一身份的页面数据」：先置阶段——壳层此刻挂起
    // （App.vue 卸载 router-view，旧页面不再渲染），登录态落地、清缓存、清 store
    // 全部在遮罩下进行。置位与落地之间无需等一帧：v-if 卸载与 store 写入同批
    // 渲染，最终 DOM 一致。
    switchingPhase.value = 'reset'

    // ---- 以下开始改动登录状态，失败需回滚 ----
    let applied: { success: boolean; error?: string }
    try {
      applied = await applyLoginResponse(response, { reloadStrategicData: false })
    } catch (error) {
      logger.error('[Auth] 切换身份响应落地异常:', error)
      applied = { success: false }
    }

    if (!applied.success) {
      // 壳层已挂起：回滚快照后收尾，App.vue 随 phase='idle' 重挂旧身份页面。
      // 此时查询缓存与各 store 尚未清理（resetIdentityRuntimeState 在落地成功
      // 后才执行），旧页面带着原有数据完整恢复。
      rollbackToSnapshot()
      // applyLoginResponse 的错误文案带「登录失败：」前缀，这里换成切换语境
      const applyError = (applied.error || '').replace(/^登录失败：/, '')
      logger.warn('[Auth] 切换身份响应落地失败，已回滚到原身份:', applied.error)
      finish()
      return {
        success: false,
        error: applyError ? `切换身份失败：${applyError}` : SWITCH_ERROR_BAD_RESPONSE
      }
    }

    // 响应未带 identities / dingTalkUserId 时沿用切换前的（同一钉钉账号，绑定关系不变）
    if (identities.value.length === 0) {
      identities.value = snapshot.identities
    }
    if (!dingTalkUserId.value) {
      dingTalkUserId.value = snapshot.dingTalkUserId
    }
    persistIdentityContext()

    // 部门视角是上一身份的查看状态，新身份从自己的默认视角开始
    resetViewingAs()

    // 清掉上一身份的查询缓存、各 store 数据与通知列表（旧组件树已卸载）
    resetIdentityRuntimeState()
    await sleepUntil(startedAt, SWITCH_STEP_RESET_END_MS)

    // 第 4 步「进入数据看板」：点亮后停留到 navigate 时刻再跳转，跳转完成才收过场
    switchingPhase.value = 'navigate'
    await sleepUntil(startedAt, SWITCH_STEP_NAVIGATE_END_MS)
    try {
      const { default: router } = await import('@/app/providers/router')
      await router.push(IDENTITY_SWITCH_LANDING_ROUTE)
      if (typeof window !== 'undefined') {
        window.scrollTo(0, 0)
      }
    } catch (error) {
      logger.error('[Auth] 切换身份后跳转数据看板失败:', error)
    } finally {
      finish()
    }
    return { success: true }
  }

  const logout = (options: { redirect?: boolean } = {}) => {
    const shouldRedirect = options.redirect !== false
    user.value = null
    token.value = null
    tokenManager.clearAccessToken()
    persistUser(null)
    clearLegacyAccessTokenStorage()
    localStorage.removeItem('refreshToken')
    clearIdentityContext()
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

  /**
   * 权限判断：只消费后端下发的 permissions。
   * 2026-10-26 权限模型改造：删除按组织类别硬编码的映射表；
   * 有效权限 = 角色 + 组织作用域，由后端计算后随登录/me 下发。
   */
  const hasPermission = (permissionCode: string) => {
    if (!user.value) {
      return false
    }
    const codes = Array.isArray(user.value.permissions) ? user.value.permissions : []
    return codes.includes(permissionCode)
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
          restoreIdentityContextFor(parsedUser)
          logger.debug('[Auth] 从内存恢复会?', parsedUser.name, parsedUser.role)
          if (!String(parsedUser.orgType ?? '').trim() || !hasRoleCodes(parsedUser)) {
            logger.debug('[Auth] 本地缓存缺少 orgType 或 roles，主动刷新当前用户')
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
            restoreIdentityContextFor(parsedUser)
            logger.debug('[Auth] 会话恢复成功:', parsedUser.name)
            if (!String(parsedUser.orgType ?? '').trim() || !hasRoleCodes(parsedUser)) {
              logger.debug('[Auth] 恢复会话后缺少 orgType 或 roles，主动刷新当前用户')
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
    identities,
    dingTalkUserId,
    switching,
    switchingPhase,
    switchingTarget,

    // Getters
    isAuthenticated,
    userRole,
    userName,
    userDepartment,
    effectiveRole,
    effectiveDepartment,
    hasMultipleIdentities,
    currentIdentity,
    identityShellSuspended,

    // Actions
    login,
    loginWithDingTalk,
    switchIdentity,
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
