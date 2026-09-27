/**
 * Auth Feature - Business Types
 *
 * Business-specific types for the authentication feature.
 * These extend the entity types with feature-specific concerns.
 */

import type { User, UserRole, LoginCredentials, LoginResponse } from '@/entities/user/model/types'

/**
 * Auth state
 */
export interface AuthState {
  user: User | null
  token: string | null
  loading: boolean
  sessionRestoring: boolean
  error: string | null
}

/**
 * Login form state
 */
export interface LoginFormState {
  account: string
  password: string
  rememberMe: boolean
  captcha?: string
  captchaKey?: string
}

/**
 * Login result
 */
export interface LoginResult {
  success: boolean
  error?: string
  shouldCountAttempt?: boolean
  isLocked?: boolean
  user?: User
  token?: string
}

/**
 * View-as state (for strategic dept viewing other departments)
 */
export interface ViewAsState {
  viewingAsRole: UserRole | null
  viewingAsDepartment: string | null
}

/**
 * Password change form state
 */
export interface PasswordChangeFormState {
  oldPassword: string
  newPassword: string
  confirmPassword: string
}

/**
 * User profile form state
 */
export interface UserProfileFormState {
  realName: string
  email: string
  phone: string
  loading: boolean
  errors: Record<string, string>
}

/**
 * Re-export entity types for convenience
 */
export type { User, UserRole, LoginCredentials, LoginResponse }
