/**
 * Auth Feature - API Types
 *
 * API request/response types specific to authentication endpoints.
 */

import type { User } from '@/entities/user/model/types'

/**
 * API response wrapper
 */
export interface ApiResponse<T> {
  code: number
  message?: string
  data: T
  success?: boolean
  timestamp?: string
}

/**
 * Login request
 */
export interface LoginRequest {
  account: string
  password: string
  captcha?: string
  captchaKey?: string
}

/**
 * Login response data
 */
export interface LoginResponseData {
  accessToken: string
  refreshToken?: string
  expiresIn: number
  user: User
}

/**
 * 多身份：同一钉钉账号绑定的一个部门席位。
 *
 * 一个人对应多个系统账号（每个账号有自己的 orgId + 角色），切换身份 = 换 token 到另一个账号。
 * 字段与后端 LoginResponse.IdentityDTO 对齐。
 */
export interface IdentityDTO {
  /** 系统账号 ID（sys_user.id），也是切换接口的 targetSysUserId */
  sysUserId: number
  orgId: number
  orgName: string
  /** 组织类型原值（admin / functional / academic） */
  orgType: string
  /** 后端角色码列表（如 ROLE_REPORTER） */
  roles: string[]
  /** 席位槽位：1 = 一号（默认），2 = 二号 */
  slot: number
  /** 该席位账号的姓名；身份菜单的头像字与姓名行按它显示（旧版后端不下发，此时回退当前登录用户） */
  realName?: string
}

/**
 * 切换身份请求
 * POST /api/v1/auth/dingtalk/switch
 */
export interface SwitchIdentityRequest {
  /** 当前钉钉账号的用户 ID；可空——后端以令牌里的当前账号为准，传了才做一致性核对 */
  dingTalkUserId?: string
  /** 目标身份的系统账号 ID */
  targetSysUserId: number
}

/**
 * 切换身份响应：与登录响应同构（含目标身份的新 token 与 identities）。
 *
 * 后端 LoginResponse 不下发 dingTalkUserId 时，前端沿用切换前记录的值（同一钉钉账号，绑定关系不变）。
 */
export interface SwitchIdentityResponse {
  token?: string
  accessToken?: string
  refreshToken?: string
  expiresIn?: number
  user: Record<string, unknown>
  identities?: IdentityDTO[]
  dingTalkUserId?: string
}

/**
 * Refresh token request
 */
export interface RefreshTokenRequest {
  refreshToken: string
}

/**
 * Refresh token response
 */
export interface RefreshTokenResponse {
  accessToken: string
  refreshToken: string
  expiresIn: number
  tokenType: string
}

/**
 * Token verification response
 */
export interface TokenVerificationResponse {
  valid: boolean
  expiresAt?: string
  user?: User
}

/**
 * User info response
 */
export type UserInfoResponse = ApiResponse<User>

/**
 * Logout response
 */
export type LogoutResponse = ApiResponse<void>
