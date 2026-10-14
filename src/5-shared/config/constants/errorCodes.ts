/**
 * 错误码常量定义
 *
 * 定义系统中所有错误码及其描述和解决方案
 *
 * **Validates: Requirements 3.1.4**
 */

import { ErrorCodePrefix, ErrorSeverity } from '@/shared/types/error'

/**
 * 错误码定义接口
 */
export interface ErrorCodeDefinition {
  /** 错误码 */
  code: string
  /** 错误消息 */
  message: string
  /** 错误描述 */
  description: string
  /** 解决方案 */
  solution: string
  /** 严重级别 */
  severity: ErrorSeverity
  /** 是否可重试 */
  retryable: boolean
}

/**
 * 认证授权错误码
 */
export const AUTH_ERRORS: Record<string, ErrorCodeDefinition> = {
  TOKEN_EXPIRED: {
    code: `${ErrorCodePrefix.AUTH}_001`,
    message: '登录已过期',
    description: 'Access Token 已过期',
    solution: '请重新登录或刷新页面',
    severity: ErrorSeverity.WARNING,
    retryable: true
  },
  TOKEN_INVALID: {
    code: `${ErrorCodePrefix.AUTH}_002`,
    message: '登录凭证无效',
    description: 'Token 格式错误或已被篡改',
    solution: '请重新登录',
    severity: ErrorSeverity.ERROR,
    retryable: false
  },
  UNAUTHORIZED: {
    code: `${ErrorCodePrefix.AUTH}_003`,
    message: '未授权访问',
    description: '用户未登录或登录状态已失效',
    solution: '请先登录后再进行操作',
    severity: ErrorSeverity.WARNING,
    retryable: false
  },
  FORBIDDEN: {
    code: `${ErrorCodePrefix.AUTH}_004`,
    message: '权限不足',
    description: '当前用户没有执行此操作的权限',
    solution: '请联系管理员获取相应权限',
    severity: ErrorSeverity.ERROR,
    retryable: false
  },
  LOGIN_FAILED: {
    code: `${ErrorCodePrefix.AUTH}_005`,
    message: '登录失败',
    description: '用户名或密码错误',
    solution: '请检查用户名和密码是否正确',
    severity: ErrorSeverity.WARNING,
    retryable: true
  },
  REFRESH_TOKEN_EXPIRED: {
    code: `${ErrorCodePrefix.AUTH}_006`,
    message: '会话已过期',
    description: 'Refresh Token 已过期',
    solution: '请重新登录',
    severity: ErrorSeverity.WARNING,
    retryable: false
  }
}

/**
 * 数据验证错误码
 */
export const VALIDATION_ERRORS: Record<string, ErrorCodeDefinition> = {
  REQUIRED_FIELD: {
    code: `${ErrorCodePrefix.VAL}_001`,
    message: '必填字段缺失',
    description: '请求中缺少必要的字段',
    solution: '请检查并填写所有必填字段',
    severity: ErrorSeverity.WARNING,
    retryable: true
  },
  INVALID_FORMAT: {
    code: `${ErrorCodePrefix.VAL}_002`,
    message: '数据格式错误',
    description: '字段值的格式不符合要求',
    solution: '请检查数据格式是否正确',
    severity: ErrorSeverity.WARNING,
    retryable: true
  },
  VALUE_OUT_OF_RANGE: {
    code: `${ErrorCodePrefix.VAL}_003`,
    message: '数值超出范围',
    description: '字段值超出允许的范围',
    solution: '请输入有效范围内的值',
    severity: ErrorSeverity.WARNING,
    retryable: true
  },
  INVALID_DATE: {
    code: `${ErrorCodePrefix.VAL}_004`,
    message: '日期格式错误',
    description: '日期字段的格式不正确',
    solution: '请使用正确的日期格式',
    severity: ErrorSeverity.WARNING,
    retryable: true
  }
}

/**
 * 业务逻辑错误码
 */
export const BUSINESS_ERRORS: Record<string, ErrorCodeDefinition> = {
  RESOURCE_EXISTS: {
    code: `${ErrorCodePrefix.BIZ}_001`,
    message: '资源已存在',
    description: '尝试创建的资源已经存在',
    solution: '请检查是否重复创建，或修改资源名称',
    severity: ErrorSeverity.WARNING,
    retryable: false
  },
  RESOURCE_NOT_FOUND: {
    code: `${ErrorCodePrefix.BIZ}_002`,
    message: '资源不存在',
    description: '请求的资源未找到',
    solution: '请检查资源 ID 是否正确',
    severity: ErrorSeverity.WARNING,
    retryable: false
  },
  OPERATION_NOT_ALLOWED: {
    code: `${ErrorCodePrefix.BIZ}_003`,
    message: '操作不允许',
    description: '当前状态下不允许执行此操作',
    solution: '请检查资源状态是否满足操作条件',
    severity: ErrorSeverity.WARNING,
    retryable: false
  },
  INDICATOR_ALREADY_DISTRIBUTED: {
    code: `${ErrorCodePrefix.BIZ}_004`,
    message: '指标已下发',
    description: '该指标已经下发给目标部门',
    solution: '请勿重复下发指标',
    severity: ErrorSeverity.WARNING,
    retryable: false
  },
  APPROVAL_PENDING: {
    code: `${ErrorCodePrefix.BIZ}_005`,
    message: '存在待审批项',
    description: '当前有待审批的进度报告',
    solution: '请等待审批完成后再提交新的报告',
    severity: ErrorSeverity.WARNING,
    retryable: false
  },
  DATABASE_ERROR: {
    code: `${ErrorCodePrefix.SYS}_002`,
    message: '数据库错误',
    description: '数据库操作失败',
    solution: '请稍后重试，如问题持续请联系管理员',
    severity: ErrorSeverity.CRITICAL,
    retryable: true
  },
  SERVICE_UNAVAILABLE: {
    code: `${ErrorCodePrefix.SYS}_003`,
    message: '服务暂不可用',
    description: '服务器正在维护或过载',
    solution: '请稍后重试',
    severity: ErrorSeverity.ERROR,
    retryable: true
  },
  CONFIGURATION_ERROR: {
    code: `${ErrorCodePrefix.SYS}_004`,
    message: '配置错误',
    description: '系统配置不正确',
    solution: '请联系管理员检查系统配置',
    severity: ErrorSeverity.CRITICAL,
    retryable: false
  }
}

/**
 * 网络错误码
 */
export const NETWORK_ERRORS: Record<string, ErrorCodeDefinition> = {
  NETWORK_ERROR: {
    code: `${ErrorCodePrefix.NET}_001`,
    message: '网络连接失败',
    description: '无法连接到服务器',
    solution: '请检查网络连接后重试',
    severity: ErrorSeverity.ERROR,
    retryable: true
  },
  TIMEOUT: {
    code: `${ErrorCodePrefix.NET}_002`,
    message: '请求超时',
    description: '服务器响应超时',
    solution: '请稍后重试',
    severity: ErrorSeverity.WARNING,
    retryable: true
  },
  REQUEST_CANCELLED: {
    code: `${ErrorCodePrefix.NET}_003`,
    message: '请求已取消',
    description: '请求被用户或系统取消',
    solution: '如需继续操作请重新发起请求',
    severity: ErrorSeverity.INFO,
    retryable: true
  }
}

/**
 * 频率限制错误码
 */
export const RATE_LIMIT_ERRORS: Record<string, ErrorCodeDefinition> = {
  TOO_MANY_REQUESTS: {
    code: `${ErrorCodePrefix.RATE}_001`,
    message: '请求过于频繁',
    description: '超出 API 调用频率限制',
    solution: '请稍后再试',
    severity: ErrorSeverity.WARNING,
    retryable: true
  },
  LOGIN_RATE_LIMITED: {
    code: `${ErrorCodePrefix.RATE}_002`,
    message: '登录尝试过于频繁',
    description: '登录失败次数过多',
    solution: '请等待一分钟后再试',
    severity: ErrorSeverity.WARNING,
    retryable: true
  }
}

/**
 * 所有错误码的集合
 */
export const ALL_ERROR_CODES: Record<string, ErrorCodeDefinition> = {
  ...AUTH_ERRORS,
  ...VALIDATION_ERRORS,
  ...BUSINESS_ERRORS,
  ...SYSTEM_ERRORS,
  ...NETWORK_ERRORS,
  ...RATE_LIMIT_ERRORS
}

/**
 * 根据错误码获取错误定义
 * @param code 错误码
 * @returns 错误定义，如果未找到则返回默认错误
 */
export function getErrorDefinition(code: string): ErrorCodeDefinition {
  // 在所有错误码中查找
  for (const key in ALL_ERROR_CODES) {
    if (ALL_ERROR_CODES[key].code === code) {
      return ALL_ERROR_CODES[key]
    }
  }

  // 返回默认错误
  return {
    code,
    message: '未知错误',
    description: '发生了未知错误',
    solution: '请稍后重试，如问题持续请联系管理员',
    severity: ErrorSeverity.ERROR,
    retryable: true
  }
}

/**
 * 根据 HTTP 状态码获取默认错误码
 * @param status HTTP 状态码
 * @returns 对应的错误码
 */
export function getErrorCodeByStatus(status: number): string {
  switch (status) {
    case 400:
      return VALIDATION_ERRORS.INVALID_FORMAT.code
    case 401:
      return AUTH_ERRORS.UNAUTHORIZED.code
    case 403:
      return AUTH_ERRORS.FORBIDDEN.code
    case 404:
      return BUSINESS_ERRORS.RESOURCE_NOT_FOUND.code
    case 409:
      return BUSINESS_ERRORS.RESOURCE_EXISTS.code
    case 429:
      return RATE_LIMIT_ERRORS.TOO_MANY_REQUESTS.code
    case 500:
      return SYSTEM_ERRORS.INTERNAL_ERROR.code
    case 502:
    case 503:
    case 504:
      return SYSTEM_ERRORS.SERVICE_UNAVAILABLE.code
    default:
      return SYSTEM_ERRORS.INTERNAL_ERROR.code
  }
}
