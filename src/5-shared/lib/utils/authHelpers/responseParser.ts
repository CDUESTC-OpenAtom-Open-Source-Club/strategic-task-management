/**
 * Auth Response Parser - 认证响应解析器
 *
 * 职责:
 * - 解析多种后端响应格式
 * - 统一返回标准化的登录数据
 * - 支持格式兼容性处理
 *
 * @module utils/authHelpers
 */

import type { User, UserRole } from '@/shared/types'
import { logger } from '@/shared/lib/utils/logger'
import { isStrategicOrgId } from '@/shared/lib/permissions/strategicOrgAccess'

const KNOWN_USER_ROLES: UserRole[] = ['strategic_dept', 'functional_dept', 'secondary_college']

type UnknownRecord = Record<string, unknown>

interface LoginPayload extends UnknownRecord {
  token?: unknown
  accessToken?: unknown
  refreshToken?: unknown
  user?: unknown
  userInfo?: unknown
  data?: unknown
}

/** 登录响应数据接口 */
export interface LoginResponseData {
  token: string
  refreshToken?: string
  user: Record<string, unknown>
}

/** 解析结果接口 */
export interface ParseResult {
  success: boolean
  data?: LoginResponseData
  error?: string
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function asLoginPayload(value: unknown): LoginPayload | null {
  return isRecord(value) ? (value as LoginPayload) : null
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function getTokenValue(payload: LoginPayload | null): string | undefined {
  if (!payload) {
    return undefined
  }

  return toOptionalString(payload.token) ?? toOptionalString(payload.accessToken)
}

function getNestedPayload(payload: LoginPayload | null): LoginPayload | null {
  return asLoginPayload(payload?.data)
}

function createLoginResponseData(
  payload: LoginPayload,
  fallbackUser: unknown = {}
): LoginResponseData | null {
  const token = getTokenValue(payload)
  if (!token) {
    return null
  }

  const user = isRecord(payload.user) ? payload.user : isRecord(fallbackUser) ? fallbackUser : {}

  return {
    token,
    refreshToken: toOptionalString(payload.refreshToken),
    user
  }
}

export function isKnownUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && KNOWN_USER_ROLES.includes(value as UserRole)
}

/**
 * 映射后端 OrgType 到前端 UserRole
 *
 * 与 mapOrgTypeToFrontend 保持一致的映射规则
 * - admin / ADMIN → strategic_dept
 * - FUNCTIONAL_DEPT, FUNCTION_DEPT, functional, FUNCTIONAL → functional_dept
 * - COLLEGE, SECONDARY_COLLEGE, DIVISION, OTHER, academic, ACADEMIC → secondary_college
 */
export function mapOrgTypeToRole(orgType: string, orgName?: string): UserRole | null {
  const normalizedType = String(orgType || '').trim()

  if (normalizedType === 'admin' || normalizedType === 'ADMIN') {
    return 'strategic_dept'
  }

  const mapping: Record<string, UserRole> = {
    // 战略发展部
    STRATEGY_DEPT: 'strategic_dept',
    strategic_dept: 'strategic_dept',
    SCHOOL: 'strategic_dept',

    // 职能部门
    FUNCTIONAL_DEPT: 'functional_dept',
    functional_dept: 'functional_dept',
    FUNCTION_DEPT: 'functional_dept',
    function_dept: 'functional_dept',
    functional: 'functional_dept',
    FUNCTIONAL: 'functional_dept',

    // 二级学院
    COLLEGE: 'secondary_college',
    college: 'secondary_college',
    SECONDARY_COLLEGE: 'secondary_college',
    secondary_college: 'secondary_college',
    DIVISION: 'secondary_college',
    OTHER: 'secondary_college',
    academic: 'secondary_college',
    ACADEMIC: 'secondary_college'
  }
  return mapping[normalizedType] || null
}

function resolveUserRole(userData: Record<string, unknown>): UserRole | null {
  const explicitRoleCandidates = [userData.role, userData.userRole, userData.frontendRole]

  for (const candidate of explicitRoleCandidates) {
    if (isKnownUserRole(candidate)) {
      return candidate
    }
  }

  const mappedByOrgType = mapOrgTypeToRole(
    String(userData.orgType || userData.role || '').trim(),
    String(userData.orgName || userData.department || '').trim()
  )
  if (mappedByOrgType) {
    return mappedByOrgType
  }

  // 2026-11-24（v1.5.4 登录回归修复）：组织维度兜底——战略发展部组织（orgId=35）的
  // 账号只挂业务角色码（如 ROLE_REPORTER）且载荷缺失 orgType 时，角色码无法映射
  // 前端角色，此前会因解析失败被登出弹回登录页。按「战略发展部组织的账号」口径
  // 兜底判定为 strategic_dept（见 strategicOrgAccess.ts）。
  if (isStrategicOrgId(userData.orgId)) {
    return 'strategic_dept'
  }

  return null
}

/**
 * 映射后端用户数据到前端 User 类型
 */
export function mapBackendUser(userData: Record<string, unknown>): User | null {
  const resolvedRole = resolveUserRole(userData)
  if (!resolvedRole) {
    logger.error('❌ [Auth] 无法从响应中解析有效前端角色:', userData)
    return null
  }

  const roles = Array.isArray(userData.roles)
    ? userData.roles.map(item => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
    : []
  const permissions = Array.isArray(userData.permissions)
    ? userData.permissions.filter((item): item is string => typeof item === 'string')
    : []

  return {
    id: String(userData.userId ?? userData.id ?? ''),
    username: String(userData.username ?? ''),
    name: String(userData.realName ?? userData.name ?? userData.username ?? ''),
    role: resolvedRole,
    department: String(userData.orgName ?? userData.department ?? ''),
    orgName: String(userData.orgName ?? userData.department ?? ''),
    orgType: typeof userData.orgType === 'string' ? userData.orgType : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userId: Number(userData.userId || userData.id || 0),
    orgId: Number(userData.orgId || 0),
    realName: String(userData.realName ?? userData.name ?? userData.username ?? ''),
    email: typeof userData.email === 'string' ? userData.email : null,
    phone: typeof userData.phone === 'string' ? userData.phone : null,
    isActive: typeof userData.isActive === 'boolean' ? userData.isActive : true,
    roles,
    permissions
  }
}

/**
 * 解析登录响应
 * 支持多种后端响应格式:
 * - 格式1: { success: true, data: { token, user } }
 * - 格式2: { code: 0, data: { token, user } }
 * - 格式3: { token, user }
 * - 格式4: { data: { token, user } }
 * - 格式5: 直接在 response.data 中
 */
export function parseLoginResponse(response: Record<string, unknown>): ParseResult {
  let loginData: LoginResponseData | null = null
  const rootPayload = asLoginPayload(response)
  const firstLevelPayload = getNestedPayload(rootPayload)
  const secondLevelPayload = getNestedPayload(firstLevelPayload)

  // API拦截器返回 response.data，所以：
  // 后端返回 { code: 0, data: { token, user } }
  // 拦截器返回 { code: 0, data: { token, user } }

  // 格式1: { success: true, data: { token, user } } (经过拦截器转换)
  if (response.success === true && firstLevelPayload && getTokenValue(firstLevelPayload)) {
    logger.debug('✅ [Auth] 响应格式1: { success: true, data: { token, user } }')
    loginData = createLoginResponseData(firstLevelPayload)
  }
  // 格式2: { code: 0, data: { token, user } } (原始后端格式)
  else if (response.code === 0 && firstLevelPayload && getTokenValue(firstLevelPayload)) {
    logger.debug('✅ [Auth] 响应格式2: { code: 0, data: {...} }')
    loginData = createLoginResponseData(firstLevelPayload)
  }
  // 格式3: { token, user } (直接返回)
  else if (rootPayload && getTokenValue(rootPayload) && rootPayload.user) {
    logger.debug('✅ [Auth] 响应格式3: { token, user }')
    loginData = createLoginResponseData(rootPayload)
  }
  // 格式4: 嵌套的data.data (兼容某些特殊情况)
  else if (secondLevelPayload && getTokenValue(secondLevelPayload)) {
    logger.debug('✅ [Auth] 响应格式4: { data: { token, user } }')
    loginData = createLoginResponseData(secondLevelPayload)
  }
  // 格式5: 尝试直接提取
  else if (rootPayload) {
    logger.debug('⚠️ [Auth] 尝试解析未知格式:', response)
    if (getTokenValue(rootPayload)) {
      loginData = createLoginResponseData(rootPayload, rootPayload.userInfo)
    }
  }

  if (loginData && loginData.token) {
    return { success: true, data: loginData }
  }

  logger.error('❌ [Auth] 响应中未找到token或user数据')
  logger.error('❌ [Auth] 完整响应:', JSON.stringify(rootPayload?.data ?? response, null, 2))

  const firstLevelMessage = toOptionalString(firstLevelPayload?.message)
  const rootMessage = toOptionalString(rootPayload?.message)

  return {
    success: false,
    error: firstLevelMessage || rootMessage || '登录失败：服务器响应格式错误'
  }
}
