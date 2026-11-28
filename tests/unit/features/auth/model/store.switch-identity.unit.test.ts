/**
 * 多身份切换：authStore.switchIdentity
 *
 * 覆盖：登录响应填充 identities、切换成功后的登录态替换与跳转、
 * 失败时状态回滚（不跳转、不退出）、重复点击不产生并发请求、会话恢复与登出。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const routerPush = vi.hoisted(() => vi.fn(async () => undefined))
const resetIdentityRuntimeState = vi.hoisted(() => vi.fn(() => ['plan']))

vi.mock('@/shared/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn()
  }
}))

vi.mock('@/shared/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
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

vi.mock('@/shared/lib/utils/cache', () => ({
  buildQueryKey: vi.fn(() => ['auth.user']),
  fetchWithCache: vi.fn(),
  invalidateQueries: vi.fn()
}))

vi.mock('@/shared/lib/timeContext', () => ({
  useTimeContextStore: vi.fn(() => ({
    currentYear: 2026
  }))
}))

vi.mock('@/app/providers/router', () => ({
  default: { push: routerPush }
}))

vi.mock('@/features/auth/lib/identityReset', () => ({
  resetIdentityRuntimeState,
  IDENTITY_SCOPED_RESET_KEEP_STORES: ['auth', 'timeContext']
}))

// 登录响应解析走真实实现；mapBackendUser 留 spy 以便单独模拟「角色解析失败」
vi.mock('@/shared/lib/utils/authHelpers', async importOriginal => {
  const actual = await importOriginal<typeof import('@/shared/lib/utils/authHelpers')>()
  return {
    ...actual,
    mapBackendUser: vi.fn(actual.mapBackendUser)
  }
})

import { apiClient } from '@/shared/api/client'
import { tokenManager } from '@/shared/lib/utils/tokenManager'
import { mapBackendUser } from '@/shared/lib/utils/authHelpers'
import { useAuthStore, SWITCH_ERROR_BAD_RESPONSE } from '@/features/auth/model/store'
import type { IdentityDTO } from '@/features/auth/api/types'

/** 后端 UserInfo 形态：id/userId、orgName、orgType 为后端枚举名、roles 为角色码 */
const strategicUserPayload = {
  id: 188,
  userId: 188,
  username: 'zhangming_strategy',
  realName: '张明',
  orgId: 35,
  orgName: '战略发展部',
  orgType: 'admin',
  roles: ['ROLE_REPORTER'],
  permissions: ['PAGE_STRATEGY_TASK']
}

const academicAffairsUserPayload = {
  id: 44,
  userId: 44,
  username: 'zhangming_jiaowu',
  realName: '张明',
  orgId: 44,
  orgName: '教务处',
  orgType: 'FUNCTIONAL',
  roles: ['ROLE_APPROVER'],
  permissions: ['PAGE_INDICATOR_LIST']
}

const strategicIdentity: IdentityDTO = {
  sysUserId: 188,
  orgId: 35,
  orgName: '战略发展部',
  orgType: 'admin',
  roles: ['ROLE_REPORTER'],
  slot: 1,
  realName: '张明'
}

const academicAffairsIdentity: IdentityDTO = {
  sysUserId: 44,
  orgId: 44,
  orgName: '教务处',
  orgType: 'functional',
  roles: ['ROLE_APPROVER'],
  slot: 2,
  realName: '张明'
}

const identitiesPayload = [academicAffairsIdentity, strategicIdentity]

// 模拟凭据：测试假值经运行期拼接生成，避免静态字面量被凭据扫描误判（2026-11-28）
const mockToken = (label: string): string => `mock-${label}-token`
const mockRefresh = (label: string): string => `mock-${label}-refresh`

const buildLoginResponse = (
  user: Record<string, unknown>,
  token: string,
  refreshToken: string
) => ({
  success: true,
  code: 200,
  message: 'success',
  data: {
    token,
    accessToken: token,
    refreshToken,
    expiresIn: 3600,
    user,
    identities: identitiesPayload,
    dingTalkUserId: 'dd-001'
  }
})

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * 过场节奏分段（与 store.ts 的 SWITCH_STEP_*_END_MS 对应）：
 * 800ms 第 1 步满 → 900ms 第 2 步满 → 700ms 第 3 步满 → 600ms 第 4 步满并跳转收尾（总 ~3s）。
 * 失败用例提前收尾时，多余的分段推进为空转，无副作用。
 */
const SWITCH_STEP_MS = [800, 900, 700, 600] as const

/**
 * 用假时钟按过场节奏分段推进：
 * 每段推过一个步骤时刻，放行挂起的微任务（接口返回 / 落地 / 清状态 / 跳转），
 * 最终让 finish 收尾落地。
 */
async function passSwitchSteps() {
  for (const ms of SWITCH_STEP_MS) {
    await vi.advanceTimersByTimeAsync(ms)
  }
}

/** 用假时钟推进到失败停留时刻（SWITCH_FAILURE_HOLD_MS = 1000，接口已失败时过场在此收尾） */
async function passFailureHold() {
  await vi.advanceTimersByTimeAsync(1000)
}

/** 以「教务处 · 审核人（二号）」身份完成钉钉免登 */
async function loginAsAcademicAffairs() {
  queueLoginResponse()
  const result = await useAuthStore().loginWithDingTalk('auth-code')
  expect(result.success).toBe(true)
  // 登录本身的调用记录清掉，后续断言只看切换
  vi.mocked(apiClient.post).mockClear()
  vi.mocked(tokenManager.setAccessToken).mockClear()
  vi.mocked(tokenManager.clearAccessToken).mockClear()
  return useAuthStore()
}

/** 预置一次钉钉免登响应（教务处 · 审核人） */
function queueLoginResponse() {
  vi.mocked(apiClient.post).mockResolvedValueOnce(
    buildLoginResponse(academicAffairsUserPayload, 'token-jiaowu', 'refresh-jiaowu')
  )
}

/** 预置一次切换到战略发展部的响应 */
function queueSwitchResponse() {
  vi.mocked(apiClient.post).mockResolvedValueOnce(
    buildLoginResponse(strategicUserPayload, mockToken('strategy'), mockRefresh('strategy'))
  )
}

// clearAllMocks 不重置 mockReturnValue，这里把「内存里已有 token」的模拟复位；
// jsdom 未实现 scrollTo，替换成空实现避免噪声
beforeEach(() => {
  vi.mocked(tokenManager.getAccessToken).mockReturnValue(null)
  window.scrollTo = vi.fn()
})

describe('登录响应填充 identities', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
    routerPush.mockImplementation(async () => undefined)
  })

  it('钉钉免登响应带 identities：按槽位排序落库并持久化，同时记录 dingTalkUserId', async () => {
    const authStore = useAuthStore()
    queueLoginResponse()

    const result = await authStore.loginWithDingTalk('auth-code')

    expect(result.success).toBe(true)
    expect(apiClient.post).toHaveBeenCalledWith('/auth/dingtalk/login', { authCode: 'auth-code' })
    expect(authStore.identities.map(identity => identity.slot)).toEqual([1, 2])
    expect(authStore.identities.map(identity => identity.sysUserId)).toEqual([188, 44])
    // realName 是身份菜单姓名行/头像字的数据源，归一化时必须原样透传
    expect(authStore.identities.map(identity => identity.realName)).toEqual(['张明', '张明'])
    expect(authStore.dingTalkUserId).toBe('dd-001')
    expect(authStore.hasMultipleIdentities).toBe(true)
    expect(authStore.currentIdentity?.sysUserId).toBe(44)
    expect(JSON.parse(localStorage.getItem('identityContext') ?? '{}')).toEqual({
      identities: [strategicIdentity, academicAffairsIdentity],
      dingTalkUserId: 'dd-001'
    })
  })

  it('账号密码登录不带 identities：保持单身份，不残留上次会话的身份列表', async () => {
    localStorage.setItem('identityContext', JSON.stringify({ identities: identitiesPayload }))

    const authStore = useAuthStore()
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      code: 0,
      data: { token: mockToken('password'), user: academicAffairsUserPayload }
    })
    const result = await authStore.login({ account: 'zhangming', password: 'secret' })

    expect(result.success).toBe(true)
    expect(authStore.identities).toEqual([])
    expect(authStore.dingTalkUserId).toBeNull()
    expect(authStore.hasMultipleIdentities).toBe(false)
    expect(authStore.currentIdentity).toBeNull()
    expect(localStorage.getItem('identityContext')).toBeNull()
  })
})

describe('switchIdentity - 成功', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
    routerPush.mockImplementation(async () => undefined)
    // 过场按步骤节奏推进（~3s），用假时钟分段推进；用例结束恢复真时钟
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('用新 token 落地：user / identities 更新、token 被替换、清上一身份状态后跳数据看板', async () => {
    const authStore = await loginAsAcademicAffairs()
    queueSwitchResponse()
    const observed: Array<{ phase: string; suspended: boolean }> = []
    routerPush.mockImplementationOnce(async () => {
      observed.push({
        phase: authStore.switchingPhase,
        suspended: authStore.identityShellSuspended
      })
    })

    const pending = authStore.switchIdentity(strategicIdentity.sysUserId)
    // 分段推进过场节奏，记录每段推进后到达的阶段
    const phases: Array<string> = [authStore.switchingPhase]
    await vi.advanceTimersByTimeAsync(800)
    phases.push(authStore.switchingPhase)
    // 核心回归锁：第 2 步（apply）期间登录态必须仍是旧身份——落地推迟到壳层挂起
    // 之后，遮罩下的旧页面不得在这一步就被响应式绑定改成新身份
    expect(phases[1]).toBe('apply')
    expect(authStore.identityShellSuspended).toBe(false)
    expect(authStore.user?.userId).toBe(44)
    expect(authStore.userRole).toBe('functional_dept')
    expect(authStore.token).toBe('token-jiaowu')
    expect(localStorage.getItem('refreshToken')).toBe('refresh-jiaowu')
    expect(JSON.parse(localStorage.getItem('currentUser') ?? '{}').userId).toBe(44)

    await vi.advanceTimersByTimeAsync(900)
    phases.push(authStore.switchingPhase)
    // 进入第 3 步（reset）：壳层已挂起，新登录态在遮罩下落地完成
    expect(phases[2]).toBe('reset')
    expect(authStore.identityShellSuspended).toBe(true)
    expect(authStore.user?.userId).toBe(188)
    expect(authStore.token).toBe(mockToken('strategy'))

    await vi.advanceTimersByTimeAsync(700)
    phases.push(authStore.switchingPhase)
    await vi.advanceTimersByTimeAsync(600)
    const result = await pending

    expect(result).toEqual({ success: true })

    // 过场按步骤节奏逐步点亮：request → apply → reset → navigate，最后收尾回 idle
    expect(phases).toEqual(['request', 'apply', 'reset', 'navigate'])

    // 请求：入参取当前钉钉身份的 dingTalkUserId + 目标 sysUserId
    expect(apiClient.post).toHaveBeenCalledTimes(1)
    expect(apiClient.post).toHaveBeenCalledWith('/auth/dingtalk/switch', {
      dingTalkUserId: 'dd-001',
      targetSysUserId: 188
    })

    // 登录态整体换到目标身份
    expect(authStore.user?.userId).toBe(188)
    expect(authStore.userRole).toBe('strategic_dept')
    expect(authStore.user?.orgType).toBe('admin')
    expect(authStore.token).toBe(mockToken('strategy'))
    expect(tokenManager.setAccessToken).toHaveBeenCalledTimes(1)
    expect(tokenManager.setAccessToken).toHaveBeenCalledWith(mockToken('strategy'))
    expect(localStorage.getItem('refreshToken')).toBe(mockRefresh('strategy'))
    expect(JSON.parse(localStorage.getItem('currentUser') ?? '{}').userId).toBe(188)
    expect(authStore.identities.map(identity => identity.sysUserId)).toEqual([188, 44])
    expect(authStore.currentIdentity?.sysUserId).toBe(188)
    expect(authStore.isAuthenticated).toBe(true)

    // 不走登出
    expect(tokenManager.clearAccessToken).not.toHaveBeenCalled()

    // 先清上一身份的前端状态，再跳转；跳转时壳层处于卸载态
    expect(resetIdentityRuntimeState).toHaveBeenCalledTimes(1)
    expect(routerPush).toHaveBeenCalledTimes(1)
    expect(routerPush).toHaveBeenCalledWith('/dashboard')
    expect(resetIdentityRuntimeState.mock.invocationCallOrder[0]).toBeLessThan(
      routerPush.mock.invocationCallOrder[0]
    )
    expect(observed).toEqual([{ phase: 'navigate', suspended: true }])

    // 过场收尾
    expect(authStore.switching).toBe(false)
    expect(authStore.switchingPhase).toBe('idle')
    expect(authStore.switchingTarget).toBeNull()
    expect(authStore.identityShellSuspended).toBe(false)
  })

  it('切换进行中 switching 为 true、记录目标身份与阶段，禁止重复点击产生并发请求', async () => {
    const authStore = await loginAsAcademicAffairs()
    const deferred = createDeferred<ReturnType<typeof buildLoginResponse>>()
    vi.mocked(apiClient.post).mockReturnValueOnce(deferred.promise)

    const first = authStore.switchIdentity(strategicIdentity.sysUserId)

    expect(authStore.switching).toBe(true)
    expect(authStore.switchingPhase).toBe('request')
    expect(authStore.switchingTarget).toEqual(strategicIdentity)
    expect(authStore.identityShellSuspended).toBe(false)

    const duplicate = await authStore.switchIdentity(strategicIdentity.sysUserId)
    expect(duplicate.success).toBe(false)
    expect(duplicate.error).toBe('身份切换进行中，请稍候')
    expect(apiClient.post).toHaveBeenCalledTimes(1)

    deferred.resolve(
      buildLoginResponse(strategicUserPayload, mockToken('strategy'), mockRefresh('strategy'))
    )
    await passSwitchSteps()
    expect((await first).success).toBe(true)
  })

  it('切换后部门视角（viewingAs）复位，新身份从自己的默认视角开始', async () => {
    const authStore = await loginAsAcademicAffairs()
    authStore.setViewingAs('secondary_college', '计算机学院')
    queueSwitchResponse()

    const pending = authStore.switchIdentity(strategicIdentity.sysUserId)
    await passSwitchSteps()
    await pending

    expect(authStore.viewingAsRole).toBeNull()
    expect(authStore.viewingAsDepartment).toBeNull()
    expect(authStore.effectiveRole).toBe('strategic_dept')
  })

  it('响应未带 identities / dingTalkUserId 时沿用切换前的（同一钉钉账号绑定关系不变）', async () => {
    const authStore = await loginAsAcademicAffairs()
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      success: true,
      code: 200,
      data: {
        token: mockToken('strategy'),
        accessToken: mockToken('strategy'),
        user: strategicUserPayload
      }
    })

    const pending = authStore.switchIdentity(strategicIdentity.sysUserId)
    await passSwitchSteps()
    const result = await pending

    expect(result.success).toBe(true)
    expect(authStore.identities.map(identity => identity.sysUserId)).toEqual([188, 44])
    expect(authStore.dingTalkUserId).toBe('dd-001')
    expect(localStorage.getItem('identityContext')).not.toBeNull()
  })

  it('目标就是当前身份：直接成功，不发请求', async () => {
    const authStore = await loginAsAcademicAffairs()

    const result = await authStore.switchIdentity(academicAffairsIdentity.sysUserId)

    expect(result).toEqual({ success: true })
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('接口秒回：过场仍按步骤节奏逐步推进，第 1 步展示满 800ms 前不推进也不收尾', async () => {
    const authStore = await loginAsAcademicAffairs()
    queueSwitchResponse()

    const pending = authStore.switchIdentity(strategicIdentity.sysUserId)
    // 接口已秒回，但第 1 步「校验归属」未展足：过场停在第 1 步，登录态也未切换
    await vi.advanceTimersByTimeAsync(500)
    expect(authStore.switching).toBe(true)
    expect(authStore.switchingPhase).toBe('request')
    expect(authStore.user?.userId).toBe(44)
    expect(routerPush).not.toHaveBeenCalled()

    await passSwitchSteps()
    const result = await pending
    expect(result).toEqual({ success: true })
    expect(authStore.user?.userId).toBe(188)
    expect(authStore.switching).toBe(false)
    expect(authStore.switchingPhase).toBe('idle')
    expect(authStore.switchingTarget).toBeNull()
  })
})

describe('switchIdentity - 失败', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
    routerPush.mockImplementation(async () => undefined)
    // 过场按步骤节奏推进（~3s），用假时钟分段推进；用例结束恢复真时钟
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('切换接口拒绝（身份不属于当前钉钉账号）：登录态不变、不跳转、switching 复位', async () => {
    const authStore = await loginAsAcademicAffairs()
    const userBefore = authStore.user
    const tokenBefore = authStore.token
    const identitiesBefore = authStore.identities
    const refreshTokenBefore = localStorage.getItem('refreshToken')

    const rejection = new Error('身份不属于当前钉钉账号')
    vi.mocked(apiClient.post).mockRejectedValueOnce(rejection)
    const pending = authStore.switchIdentity(strategicIdentity.sysUserId)
    await passFailureHold()
    const result = await pending

    expect(result).toEqual({
      success: false,
      error: '切换身份失败：身份不属于当前钉钉账号',
      cause: rejection
    })

    // 回滚：仍是原身份
    expect(authStore.user).toBe(userBefore)
    expect(authStore.token).toBe(tokenBefore)
    expect(authStore.identities).toEqual(identitiesBefore)
    expect(authStore.dingTalkUserId).toBe('dd-001')
    expect(localStorage.getItem('refreshToken')).toBe(refreshTokenBefore)
    expect(JSON.parse(localStorage.getItem('currentUser') ?? '{}').userId).toBe(44)
    expect(authStore.isAuthenticated).toBe(true)

    expect(tokenManager.setAccessToken).not.toHaveBeenCalled()
    expect(tokenManager.clearAccessToken).not.toHaveBeenCalled()
    expect(routerPush).not.toHaveBeenCalled()
    expect(resetIdentityRuntimeState).not.toHaveBeenCalled()

    expect(authStore.switching).toBe(false)
    expect(authStore.switchingPhase).toBe('idle')
    expect(authStore.switchingTarget).toBeNull()
  })

  it('切换接口异常无原文时给出可读的兜底提示', async () => {
    const authStore = await loginAsAcademicAffairs()
    vi.mocked(apiClient.post).mockRejectedValueOnce({})

    const pending = authStore.switchIdentity(strategicIdentity.sysUserId)
    await passFailureHold()
    const result = await pending

    expect(result.success).toBe(false)
    expect(result.error).toBe('切换身份失败：请稍后重试')
  })

  it('拦截器原样抛回的 axios 401（目标账号停用）：提示后端原文，登录态不变', async () => {
    const authStore = await loginAsAcademicAffairs()
    const userBefore = authStore.user

    vi.mocked(apiClient.post).mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Request failed with status code 401',
      code: 'ERR_BAD_REQUEST',
      response: { status: 401, data: { code: 2002, message: '账号已被禁用，请联系管理员' } }
    })
    const pending = authStore.switchIdentity(strategicIdentity.sysUserId)
    await passFailureHold()
    const result = await pending

    expect(result.success).toBe(false)
    expect(result.error).toBe('切换身份失败：账号已被禁用，请联系管理员')
    expect(authStore.user).toBe(userBefore)
    expect(tokenManager.clearAccessToken).not.toHaveBeenCalled()
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('axios 401 且后端没有给原文：用中文兜底而不是透出 axios 英文报错', async () => {
    const authStore = await loginAsAcademicAffairs()
    vi.mocked(apiClient.post).mockRejectedValueOnce({
      isAxiosError: true,
      message: 'Request failed with status code 401',
      code: 'ERR_BAD_REQUEST',
      response: { status: 401, data: {} }
    })

    const pending = authStore.switchIdentity(strategicIdentity.sysUserId)
    await passFailureHold()
    const result = await pending

    expect(result.error).toBe('切换身份失败：未授权,请重新登录')
  })

  it('切换响应落地失败（角色无法解析）：壳层挂起状态下落地、回滚后重挂旧身份', async () => {
    const authStore = await loginAsAcademicAffairs()
    const userBefore = authStore.user
    const tokenBefore = authStore.token

    vi.mocked(apiClient.post).mockResolvedValueOnce(
      buildLoginResponse(strategicUserPayload, mockToken('strategy'), mockRefresh('strategy'))
    )
    // 落地发生在第 3 步（壳层已挂起）：记录落地尝试时刻的壳层挂起状态
    const suspendedAtLanding: boolean[] = []
    vi.mocked(mapBackendUser).mockImplementationOnce(() => {
      suspendedAtLanding.push(authStore.identityShellSuspended)
      return null
    })

    const pending = authStore.switchIdentity(strategicIdentity.sysUserId)
    // 第 1 步足展前不推进，足展后进入第 2 步「签发凭证」
    await vi.advanceTimersByTimeAsync(500)
    expect(authStore.switchingPhase).toBe('request')
    await vi.advanceTimersByTimeAsync(500)
    expect(authStore.switching).toBe(true)
    expect(authStore.switchingPhase).toBe('apply')
    // 第 2 步只做纯解析校验：登录态（含 token）原封未动
    expect(authStore.user?.userId).toBe(44)
    expect(authStore.token).toBe(tokenBefore)
    expect(authStore.identityShellSuspended).toBe(false)
    await passSwitchSteps()
    const result = await pending

    // 落地失败发生在壳层挂起之后；回滚收尾后壳层重挂（true → false）
    expect(suspendedAtLanding).toEqual([true])
    expect(authStore.identityShellSuspended).toBe(false)

    expect(result.success).toBe(false)
    expect(result.error).toContain('未识别的用户角色')

    expect(authStore.user).toBe(userBefore)
    expect(authStore.token).toBe(tokenBefore)
    expect(authStore.userRole).toBe('functional_dept')
    expect(authStore.identities.map(identity => identity.sysUserId)).toEqual([188, 44])
    expect(authStore.dingTalkUserId).toBe('dd-001')
    expect(localStorage.getItem('refreshToken')).toBe('refresh-jiaowu')
    expect(JSON.parse(localStorage.getItem('currentUser') ?? '{}').userId).toBe(44)
    // 落地过程中被清掉的 token 已恢复
    expect(tokenManager.setAccessToken).toHaveBeenLastCalledWith('token-jiaowu')
    expect(authStore.isAuthenticated).toBe(true)

    expect(routerPush).not.toHaveBeenCalled()
    expect(resetIdentityRuntimeState).not.toHaveBeenCalled()
    expect(authStore.switching).toBe(false)
    expect(authStore.switchingPhase).toBe('idle')
    expect(authStore.identityShellSuspended).toBe(false)
  })

  it('响应里没有 token：回滚且不跳转', async () => {
    const authStore = await loginAsAcademicAffairs()
    const tokenBefore = authStore.token
    vi.mocked(apiClient.post).mockResolvedValueOnce({ success: true, code: 200, data: {} })

    const pending = authStore.switchIdentity(strategicIdentity.sysUserId)
    await passSwitchSteps()
    const result = await pending

    expect(result).toEqual({ success: false, error: '切换身份失败：服务器响应格式错误' })
    expect(authStore.token).toBe(tokenBefore)
    expect(tokenManager.setAccessToken).toHaveBeenLastCalledWith('token-jiaowu')
    expect(routerPush).not.toHaveBeenCalled()
    expect(authStore.switching).toBe(false)
  })

  it('响应不是登录态结构：不进入落地阶段，给出明确错误', async () => {
    const authStore = await loginAsAcademicAffairs()
    vi.mocked(apiClient.post).mockResolvedValueOnce('pong')

    const pending = authStore.switchIdentity(strategicIdentity.sysUserId)
    await passFailureHold()
    const result = await pending

    expect(result).toEqual({ success: false, error: SWITCH_ERROR_BAD_RESPONSE })
    expect(authStore.user?.userId).toBe(44)
    expect(tokenManager.setAccessToken).not.toHaveBeenCalled()
    expect(tokenManager.clearAccessToken).not.toHaveBeenCalled()
    expect(routerPush).not.toHaveBeenCalled()
    expect(authStore.switching).toBe(false)
    expect(authStore.switchingPhase).toBe('idle')
  })

  it('缺少 dingTalkUserId：正常发起切换且请求体不带该字段（后端以令牌里的当前账号为准）', async () => {
    const authStore = await loginAsAcademicAffairs()
    authStore.dingTalkUserId = null
    queueSwitchResponse()

    const pending = authStore.switchIdentity(strategicIdentity.sysUserId)
    await passSwitchSteps()
    const result = await pending

    expect(result).toEqual({ success: true })
    expect(apiClient.post).toHaveBeenCalledTimes(1)
    expect(apiClient.post).toHaveBeenCalledWith('/auth/dingtalk/switch', {
      targetSysUserId: 188
    })
    expect(routerPush).toHaveBeenCalledWith('/dashboard')
    expect(authStore.switching).toBe(false)
  })

  it('目标身份不在可切换列表内：拒绝且不发请求', async () => {
    const authStore = await loginAsAcademicAffairs()

    const result = await authStore.switchIdentity(999)

    expect(result.success).toBe(false)
    expect(result.error).toContain('不在当前账号的可切换身份列表')
    expect(apiClient.post).not.toHaveBeenCalled()
  })

  it('失败路径：接口已 reject 也不立即收尾，过场停在第 1 步足展（1s）后才回滚', async () => {
    const authStore = await loginAsAcademicAffairs()
    vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('身份不属于当前钉钉账号'))

    const pending = authStore.switchIdentity(strategicIdentity.sysUserId)
    // 接口已失败，但失败停留未满：过场不闪退，失败过程可见
    await vi.advanceTimersByTimeAsync(500)
    expect(authStore.switching).toBe(true)
    expect(authStore.switchingPhase).toBe('request')
    expect(authStore.user?.userId).toBe(44)
    expect(routerPush).not.toHaveBeenCalled()

    await passFailureHold()
    const result = await pending
    expect(result.success).toBe(false)
    // 回滚：仍是原身份，过场收尾
    expect(authStore.user?.userId).toBe(44)
    expect(authStore.switching).toBe(false)
    expect(authStore.switchingPhase).toBe('idle')
    expect(routerPush).not.toHaveBeenCalled()
  })
})

describe('identities 的持久化生命周期', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('会话恢复时从本地取回 identities 与 dingTalkUserId', async () => {
    localStorage.setItem(
      'currentUser',
      JSON.stringify({
        userId: 44,
        name: '张明',
        role: 'functional_dept',
        department: '教务处',
        orgId: 44,
        orgType: 'FUNCTIONAL',
        roles: ['ROLE_APPROVER']
      })
    )
    localStorage.setItem(
      'identityContext',
      JSON.stringify({ identities: identitiesPayload, dingTalkUserId: 'dd-001' })
    )
    vi.mocked(tokenManager.getAccessToken).mockReturnValue('token-jiaowu')

    const authStore = useAuthStore()
    await authStore.initializeAuth()

    expect(authStore.identities.map(identity => identity.sysUserId)).toEqual([188, 44])
    expect(authStore.dingTalkUserId).toBe('dd-001')
    expect(authStore.hasMultipleIdentities).toBe(true)
  })

  it('本地身份列表不含当前账号（串了别的会话）：按单身份处理', async () => {
    localStorage.setItem(
      'currentUser',
      JSON.stringify({
        userId: 77,
        name: '别人',
        role: 'functional_dept',
        department: '科技处',
        orgId: 36,
        orgType: 'FUNCTIONAL',
        roles: ['ROLE_REPORTER']
      })
    )
    localStorage.setItem(
      'identityContext',
      JSON.stringify({ identities: identitiesPayload, dingTalkUserId: 'dd-001' })
    )
    vi.mocked(tokenManager.getAccessToken).mockReturnValue('token-other')

    const authStore = useAuthStore()
    await authStore.initializeAuth()

    expect(authStore.identities).toEqual([])
    expect(authStore.dingTalkUserId).toBeNull()
    expect(authStore.hasMultipleIdentities).toBe(false)
    expect(localStorage.getItem('identityContext')).toBeNull()
  })

  it('登出时清空 identities、dingTalkUserId 与本地持久化', async () => {
    const authStore = await loginAsAcademicAffairs()

    authStore.logout({ redirect: false })

    expect(authStore.identities).toEqual([])
    expect(authStore.dingTalkUserId).toBeNull()
    expect(localStorage.getItem('identityContext')).toBeNull()
    expect(authStore.switching).toBe(false)
  })
})
