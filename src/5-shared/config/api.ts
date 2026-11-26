/**
 * API Configuration
 * 
 * API endpoints and configuration
 */

function readStringEnv(key: keyof ImportMetaEnv): string | undefined {
  const value = import.meta.env[key]
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmedValue = value.trim()
  return trimmedValue ? trimmedValue : undefined
}

/**
 * API base URL
 */
export const API_BASE_URL = readStringEnv('VITE_API_BASE_URL') || '/api/v1'

/**
 * Mock mode flag
 */
export const USE_MOCK = readStringEnv('VITE_USE_MOCK') === 'true'

/**
 * WebSocket notifications flag
 * Disabled by default until the production notification channel is fully ready.
 */
export const ENABLE_WEBSOCKET_NOTIFICATIONS =
  readStringEnv('VITE_ENABLE_WEBSOCKET_NOTIFICATIONS') === 'true'

function deriveApiTarget(): string {
  const explicitApiTarget = readStringEnv('VITE_API_TARGET')
  if (explicitApiTarget) {
    return explicitApiTarget.replace(/\/$/, '')
  }

  if (typeof window !== 'undefined') {
    return window.location.origin
  }

  return ''
}

/**
 * Backend target URL for diagnostics and proxy-aware config
 */
export const API_TARGET = deriveApiTarget()

function deriveWebSocketBaseUrl(): string {
  const explicitWsBaseUrl = readStringEnv('VITE_WS_BASE_URL')
  if (explicitWsBaseUrl) {
    return explicitWsBaseUrl.replace(/\/$/, '')
  }

  if (API_TARGET) {
    return API_TARGET
      .replace(/^http:/, 'ws:')
      .replace(/^https:/, 'wss:')
      .replace(/\/$/, '')
  }

  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}`
  }

  return ''
}

/**
 * WebSocket base URL
 */
export const WS_BASE_URL = deriveWebSocketBaseUrl()

/**
 * API timeout (ms)
 */
export const API_TIMEOUT = Number(readStringEnv('VITE_REQUEST_TIMEOUT') || 30000)

/**
 * API endpoints
 */
export const API_ENDPOINTS = {
  // Authentication
  auth: {
    login: '/auth/login',
    logout: '/auth/logout',
    userInfo: '/auth/me',
    validate: '/auth/validate',
    register: '/auth/register',
    refresh: '/auth/refresh',
    forgotPasswordSend: '/auth/password-reset/send',
    forgotPasswordVerify: '/auth/password-reset/verify',
    forgotPasswordConfirm: '/auth/password-reset/confirm',
    updateContact: '/auth/users/me/contact'
  },

  // Users
  users: {
    list: '/auth/users',
    detail: (id: string) => `/auth/users/${id}`,
    create: '/auth/users',
    update: (id: string) => `/auth/users/${id}`,
    delete: (id: string) => `/auth/users/${id}`,
    byUsername: (username: string) => `/auth/users/username/${username}`,
    byOrg: (orgId: string) => `/auth/users/org/${orgId}`
  },

  // Organizations
  organizations: {
    list: '/organizations',
    tree: '/organizations/tree',
    detail: (id: string) => `/organizations/${id}`
  },

  // Indicators
  indicators: {
    list: '/indicators',
    detail: (id: string) => `/indicators/${id}`,
    create: '/indicators',
    distribute: (id: string) => `/indicators/${id}/distribute`,
    breakdown: (id: string) => `/indicators/${id}/breakdown`,
    submit: (id: string) => `/indicators/${id}/submit`,
    approve: (id: string) => `/indicators/${id}/approve`,
    reject: (id: string) => `/indicators/${id}/reject`,
    withdraw: (id: string) => `/indicators/${id}/withdraw`,
    terminate: (id: string) => `/indicators/${id}/terminate`,
    search: '/indicators/search',
    byTask: (taskId: string) => `/indicators/task/${taskId}`
  },

  // Plans
  plans: {
    list: '/plans',
    detail: (id: string) => `/plans/${id}`,
    details: (id: string) => `/plans/${id}/details`,
    create: '/plans',
    update: (id: string) => `/plans/${id}`,
    delete: (id: string) => `/plans/${id}`,
    archive: (id: string) => `/plans/${id}/archive`,
    byCycle: (cycleId: string) => `/plans/cycle/${cycleId}`
  },

  // Tasks
  tasks: {
    list: '/tasks',
    detail: (id: string) => `/tasks/${id}`,
    create: '/tasks',
    update: (id: string) => `/tasks/${id}`,
    delete: (id: string) => `/tasks/${id}`
  },

  // Reports
  reports: {
    list: '/reports',
    detail: (id: string) => `/reports/${id}`,
    create: '/reports',
    submit: (id: string) => `/reports/${id}/submit`
  },

  // Approval - Workflow Engine
  approval: {
    // Flow definitions
    flows: '/approval/flows',
    flowDetail: (id: string) => `/approval/flows/${id}`,
    flowByCode: (code: string) => `/approval/flows/code/${code}`,
    flowByEntityType: (entityType: string) => `/approval/flows/entity-type/${entityType}`,
    flowStatus: (id: string) => `/approval/flows/${id}/status`,

    // Instances
    instances: '/approval/instances',
    instanceDetail: (id: string) => `/approval/instances/${id}`,
    myPending: '/approval/instances/my-pending',
    approve: (id: string) => `/approval/instances/${id}/approve`,
    reject: (id: string) => `/approval/instances/${id}/reject`,
    cancel: (id: string) => `/approval/instances/${id}/cancel`
  },

  // Analytics
  analytics: {
    dashboard: '/analytics/dashboard'
  },

  notifications: {
    list: '/notifications',
    detail: (id: string) => `/notifications/${id}`,
    status: (id: string, newStatus: string) =>
      `/notifications/${id}/status?newStatus=${encodeURIComponent(newStatus)}`,
    handle: (id: string, handledByUserId: string | number, handledNote?: string) =>
      `/notifications/${id}/handle?handledByUserId=${encodeURIComponent(String(handledByUserId))}${
        handledNote ? `&handledNote=${encodeURIComponent(handledNote)}` : ''
      }`
  }
} as const
