/**
 * Shared auth session cleanup helpers.
 *
 * These utilities intentionally avoid feature-store imports so that shared
 * infrastructure such as API interceptors can use them safely.
 */

export function clearPersistedAuthState(): void {
  if (typeof localStorage === 'undefined') {
    return
  }

  localStorage.removeItem('currentUser')
  localStorage.removeItem('user')
  localStorage.removeItem('token')
  localStorage.removeItem('auth_token')
  localStorage.removeItem('access_token')
  localStorage.removeItem('accessToken')
  localStorage.removeItem('refreshToken')
  // 多身份列表与登录态同生命周期，会话清掉后不能留着别的会话的身份
  localStorage.removeItem('identityContext')
}

export function redirectToLogin(): void {
  if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
    window.location.href = '/login'
  }
}
