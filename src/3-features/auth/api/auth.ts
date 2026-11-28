import { apiClient as api } from '@/shared/api/client'
import type { LoginCredentials, LoginResponse } from '@/entities/user/model/types'
import type { User } from '@/shared/types'
import type {
  ApiResponse,
  LoginRequest,
  SwitchIdentityRequest,
  SwitchIdentityResponse
} from './types'

export interface UpdateContactInfoRequest {
  email?: string | null
  phone?: string | null
}

export interface PasswordResetSendRequest {
  email: string
}

export interface PasswordResetVerifyRequest {
  email: string
  code: string
}

export interface PasswordResetConfirmRequest {
  email: string
  code: string
  newPassword: string
}

/**
 * Authentication API endpoints
 */
export const authApi = {
  /**
   * User login
   * POST /api/auth/login
   *
   * @param credentials - Username and password
   * @returns Login response with token and user info
   */
  async login(credentials: LoginCredentials | LoginRequest): Promise<ApiResponse<LoginResponse>> {
    return api.post('/auth/login', credentials)
  },

  /**
   * User logout
   * POST /api/auth/logout
   *
   * Invalidates the current access token
   */
  async logout(): Promise<ApiResponse<void>> {
    return api.post('/auth/logout')
  },

  /**
   * Refresh access token
   * POST /api/v1/auth/refresh
   *
   * @param refreshToken - Refresh token
   * @returns New access token
   */
  async refreshToken(
    refreshToken: string
  ): Promise<
    ApiResponse<{ accessToken: string; refreshToken: string; expiresIn: number; tokenType: string }>
  > {
    return api.post('/auth/refresh', { refreshToken })
  },

  /**
   * 切换身份：换到同一钉钉账号绑定的另一个部门席位
   * POST /api/v1/auth/dingtalk/switch
   *
   * 响应与登录响应同构，含目标身份的新 token 和 identities。
   * 失败：目标身份不属于当前钉钉账号 → IDENTITY_NOT_ALLOWED；目标账号停用 → 拒绝。
   *
   * @param payload 当前钉钉用户 ID + 目标系统账号 ID
   */
  async switchIdentity(
    payload: SwitchIdentityRequest
  ): Promise<ApiResponse<SwitchIdentityResponse>> {
    return api.post('/auth/dingtalk/switch', payload satisfies SwitchIdentityRequest)
  },

  /**
   * Get current user info
   * GET /api/v1/auth/me
   *
   * @returns Current user information
   */
  async getCurrentUser(): Promise<ApiResponse<User>> {
    return api.get('/auth/me')
  },

  /**
   * User registration
   * POST /api/auth/register
   *
   * @param userData - User registration data
   * @returns Registration response
   */
  async register(userData: {
    username: string
    password: string
    realName: string
    email: string
    phone?: string
    orgId: number
  }): Promise<ApiResponse<{ userId: number; status: string }>> {
    return api.post('/auth/register', userData)
  },

  async updateContactInfo(data: UpdateContactInfoRequest): Promise<ApiResponse<User>> {
    return api.put('/auth/users/me/contact', data)
  },

  async sendResetCode(email: string): Promise<ApiResponse<{ message: string; expiresIn: number }>> {
    return api.post('/auth/password-reset/send', { email } satisfies PasswordResetSendRequest)
  },

  async verifyResetCode(
    email: string,
    code: string
  ): Promise<ApiResponse<{ valid: boolean; message: string }>> {
    return api.post('/auth/password-reset/verify', {
      email,
      code
    } satisfies PasswordResetVerifyRequest)
  },

  async confirmResetPassword(
    email: string,
    code: string,
    newPassword: string
  ): Promise<ApiResponse<{ message: string }>> {
    return api.post('/auth/password-reset/confirm', {
      email,
      code,
      newPassword
    } satisfies PasswordResetConfirmRequest)
  }
}

export default authApi
