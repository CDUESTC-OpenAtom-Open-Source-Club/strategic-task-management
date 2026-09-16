/**
 * 数据验证组合式函数
 *
 * 提供统一的数据验证能力，用于验证指标、用户等实体数据的完整性和格式
 *
 * @requirements 2.4 - Indicator data validation with complete fields
 * @requirements 3.4 - statusAudit audit log field validation
 * @requirements 9.4 - Null value handling with default values
 */

import {
  indicatorValidationRules,
  userValidationRules,
  statusAuditEntryValidationRules,
  indicatorDefaultValues,
  userDefaultValues,
  statusAuditEntryDefaultValues,
  type ValidationRule,
  type EntityValidationRules,
  type StringValidationRule,
  type NumberValidationRule,
  type DateValidationRule,
  type ArrayValidationRule,
  type EnumValidationRule
} from '@/shared/config/validationRules'
import { logger } from '@/shared/lib/utils/logger'

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 验证错误信息
 */
export interface ValidationError {
  /** 字段名 */
  field: string
  /** 错误消息 */
  message: string
  /** 当前值 */
  value: unknown
}

/**
 * 验证警告信息
 */
export interface ValidationWarning {
  /** 字段名 */
  field: string
  /** 警告消息 */
  message: string
  /** 建议操作 */
  suggestion: string
}

/**
 * 验证结果
 */
export interface ValidationResult {
  /** 是否验证通过 */
  isValid: boolean
  /** 错误列表 */
  errors: ValidationError[]
  /** 警告列表 */
  warnings: ValidationWarning[]
}

/**
 * 数据验证器选项
 */
export interface DataValidatorOptions {
  /** 严格模式，空值视为错误 */
  strict?: boolean
  /** 是否记录错误日志 */
  logErrors?: boolean
  /** 默认值映射 */
  defaultValues?: Record<string, unknown>
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 检查值是否为 null 或 undefined
 */
function isNullOrUndefined(value: unknown): value is null | undefined {
  return value === null || value === undefined
}

/**
 * 检查值是否为空字符串
 */
function isEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === ''
}

/**
 * 检查值是否为空数组
 */
function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0
}

/**
 * 检查对象是否为普通对象
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// ============================================================================
// 核心验证函数
// ============================================================================

/**
 * 验证单个字段
 */
function validateField(
  fieldName: string,
  value: unknown,
  rule: ValidationRule,
  strict: boolean
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  // 检查必填字段
  if (rule.required) {
    if (isNullOrUndefined(value)) {
      errors.push({
        field: fieldName,
        message: `${rule.description || fieldName} 是必填字段`,
        value
      })
      return { errors, warnings }
    }
    if (isEmptyString(value)) {
      errors.push({
        field: fieldName,
        message: `${rule.description || fieldName} 不能为空`,
        value
      })
      return { errors, warnings }
    }
  } else if (isNullOrUndefined(value)) {
    // 非必填字段为空时，严格模式下添加警告
    if (strict) {
      warnings.push({
        field: fieldName,
        message: `${rule.description || fieldName} 为空`,
        suggestion: '建议提供该字段的值'
      })
    }
    return { errors, warnings }
  }

  // 根据类型进行验证
  switch (rule.type) {
    case 'string':
      validateStringField(fieldName, value, rule as StringValidationRule, errors)
      break
    case 'number':
      validateNumberField(fieldName, value, rule as NumberValidationRule, errors)
      break
    case 'date':
      validateDateField(fieldName, value, rule as DateValidationRule, errors)
      break
    case 'array':
      validateArrayField(fieldName, value, rule as ArrayValidationRule, errors, warnings)
      break
    case 'enum':
      validateEnumField(fieldName, value, rule as EnumValidationRule, errors)
      break
    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push({
          field: fieldName,
          message: `${rule.description || fieldName} 必须是布尔值`,
          value
        })
      }
      break
    case 'object':
      if (!isPlainObject(value)) {
        errors.push({
          field: fieldName,
          message: `${rule.description || fieldName} 必须是对象`,
          value
        })
      }
      break
  }

  return { errors, warnings }
}

/**
 * 验证字符串字段
 */
function validateStringField(
  fieldName: string,
  value: unknown,
  rule: StringValidationRule,
  errors: ValidationError[]
): void {
  if (typeof value !== 'string') {
    errors.push({
      field: fieldName,
      message: `${rule.description || fieldName} 必须是字符串`,
      value
    })
    return
  }

  if (rule.minLength !== undefined && value.length < rule.minLength) {
    errors.push({
      field: fieldName,
      message: `${rule.description || fieldName} 长度不能小于 ${rule.minLength}`,
      value
    })
  }

  if (rule.maxLength !== undefined && value.length > rule.maxLength) {
    errors.push({
      field: fieldName,
      message: `${rule.description || fieldName} 长度不能大于 ${rule.maxLength}`,
      value
    })
  }

  if (rule.pattern && !rule.pattern.test(value)) {
    errors.push({
      field: fieldName,
      message: `${rule.description || fieldName} 格式不正确`,
      value
    })
  }
}

/**
 * 验证数字字段
 */
function validateNumberField(
  fieldName: string,
  value: unknown,
  rule: NumberValidationRule,
  errors: ValidationError[]
): void {
  if (typeof value !== 'number' || isNaN(value)) {
    errors.push({
      field: fieldName,
      message: `${rule.description || fieldName} 必须是有效数字`,
      value
    })
    return
  }

  if (rule.min !== undefined && value < rule.min) {
    errors.push({
      field: fieldName,
      message: `${rule.description || fieldName} 不能小于 ${rule.min}`,
      value
    })
  }

  if (rule.max !== undefined && value > rule.max) {
    errors.push({
      field: fieldName,
      message: `${rule.description || fieldName} 不能大于 ${rule.max}`,
      value
    })
  }

  if (rule.integer && !Number.isInteger(value)) {
    errors.push({
      field: fieldName,
      message: `${rule.description || fieldName} 必须是整数`,
      value
    })
  }
}

/**
 * 验证日期字段
 */
function validateDateField(
  fieldName: string,
  value: unknown,
  rule: DateValidationRule,
  errors: ValidationError[]
): void {
  let dateValue: Date | null = null

  if (value instanceof Date) {
    dateValue = value
  } else if (typeof value === 'string') {
    dateValue = new Date(value)
  } else if (typeof value === 'number') {
    dateValue = new Date(value)
  }

  if (!dateValue || isNaN(dateValue.getTime())) {
    errors.push({
      field: fieldName,
      message: `${rule.description || fieldName} 必须是有效日期`,
      value
    })
    return
  }

  if (rule.minDate) {
    const minDate = typeof rule.minDate === 'string' ? new Date(rule.minDate) : rule.minDate
    if (dateValue < minDate) {
      errors.push({
        field: fieldName,
        message: `${rule.description || fieldName} 不能早于 ${minDate.toLocaleDateString()}`,
        value
      })
    }
  }

  if (rule.maxDate) {
    const maxDate = typeof rule.maxDate === 'string' ? new Date(rule.maxDate) : rule.maxDate
    if (dateValue > maxDate) {
      errors.push({
        field: fieldName,
        message: `${rule.description || fieldName} 不能晚于 ${maxDate.toLocaleDateString()}`,
        value
      })
    }
  }
}

/**
 * 验证数组字段
 */
function validateArrayField(
  fieldName: string,
  value: unknown,
  rule: ArrayValidationRule,
  errors: ValidationError[],
  warnings: ValidationWarning[]
): void {
  if (!Array.isArray(value)) {
    errors.push({
      field: fieldName,
      message: `${rule.description || fieldName} 必须是数组`,
      value
    })
    return
  }

  if (rule.minItems !== undefined && value.length < rule.minItems) {
    errors.push({
      field: fieldName,
      message: `${rule.description || fieldName} 至少需要 ${rule.minItems} 个元素`,
      value
    })
  }

  if (rule.maxItems !== undefined && value.length > rule.maxItems) {
    errors.push({
      field: fieldName,
      message: `${rule.description || fieldName} 最多只能有 ${rule.maxItems} 个元素`,
      value
    })
  }

  if (isEmptyArray(value)) {
    warnings.push({
      field: fieldName,
      message: `${rule.description || fieldName} 为空数组`,
      suggestion: '如果需要数据，请添加元素'
    })
  }
}

/**
 * 验证枚举字段
 */
function validateEnumField(
  fieldName: string,
  value: unknown,
  rule: EnumValidationRule,
  errors: ValidationError[]
): void {
  if (!rule.values.includes(value as string | number)) {
    errors.push({
      field: fieldName,
      message: `${rule.description || fieldName} 必须是以下值之一: ${rule.values.join(', ')}`,
      value
    })
  }
}

/**
 * 通用实体验证函数
 */
function validateEntity(
  data: unknown,
  rules: EntityValidationRules,
  strict: boolean
): ValidationResult {
  const errors: ValidationError[] = []
  const warnings: ValidationWarning[] = []

  if (!isPlainObject(data)) {
    errors.push({
      field: '_root',
      message: '数据必须是对象',
      value: data
    })
    return { isValid: false, errors, warnings }
  }

  for (const [fieldName, rule] of Object.entries(rules)) {
    const value = (data as Record<string, unknown>)[fieldName]
    const result = validateField(fieldName, value, rule, strict)
    errors.push(...result.errors)
    warnings.push(...result.warnings)
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

// ============================================================================
// 主组合式函数
// ============================================================================

/**
 * 数据验证组合式函数
 *
 * 提供统一的数据验证能力，用于验证指标、用户等实体数据
 *
 * @param options - 验证器选项
 * @returns 验证方法集合
 *
 * @example
 * ```typescript
 * const { validateIndicator, safeGet } = useDataValidator()
 *
 * const result = validateIndicator(indicatorData)
 * if (!result.isValid) {
 *   console.error('验证失败:', result.errors)
 * }
 *
 * const name = safeGet(data, 'user.name', '未知用户')
 * ```
 */
export function useDataValidator(options: DataValidatorOptions = {}) {
  const { strict = false, logErrors = false, defaultValues = {} } = options

  /**
   * 记录验证错误日志
   */
  function logValidationErrors(entityType: string, result: ValidationResult): void {
    if (logErrors && !result.isValid) {
      logger.warn(`[DataValidator] ${entityType} 验证失败:`, {
        errors: result.errors,
        warnings: result.warnings
      })
    }
  }

  /**
   * 验证指标数据完整性
   *
   * @param indicator - 待验证的指标数据
   * @returns 验证结果
   *
   */
  function validateIndicator(indicator: unknown): ValidationResult {
    const result = validateEntity(indicator, indicatorValidationRules, strict)
    logValidationErrors('Indicator', result)
    return result
  }

  /**
   * 验证用户数据
   *
   * @param user - 待验证的用户数据
   * @returns 验证结果
   *
   * @requirement 5.2 - User role enum validation
   */
  function validateUser(user: unknown): ValidationResult {
    const result = validateEntity(user, userValidationRules, strict)
    logValidationErrors('User', result)
    return result
  }

  /**
   * 验证状态审计日志条目
   *
   * @param entry - 待验证的审计日志条目
   * @returns 验证结果
   *
   * @requirement 3.4 - statusAudit audit log field validation
   */
  function validateStatusAuditEntry(entry: unknown): ValidationResult {
    const result = validateEntity(entry, statusAuditEntryValidationRules, strict)
    logValidationErrors('StatusAuditEntry', result)
    return result
  }

  /**
   * 验证日期格式
   *
   * @param date - 待验证的日期值
   * @returns 是否为有效日期
   *
   * @requirement 9.1 - Date format validation
   */
  function validateDateFormat(date: unknown): boolean {
    if (isNullOrUndefined(date)) {
      return false
    }

    let dateValue: Date | null = null

    if (date instanceof Date) {
      dateValue = date
    } else if (typeof date === 'string') {
      // 支持多种日期格式
      // YYYY-MM-DD, YYYY年MM月DD日, ISO 8601
      dateValue = new Date(date)
    } else if (typeof date === 'number') {
      dateValue = new Date(date)
    }

    return dateValue !== null && !isNaN(dateValue.getTime())
  }

  /**
   * 验证进度值范围
   *
   * @param progress - 待验证的进度值
   * @returns 是否在有效范围内 [0, 100]
   *
   * @requirement 9.2 - Progress value range validation (0-100)
   */
  function validateProgress(progress: unknown): boolean {
    if (typeof progress !== 'number' || isNaN(progress)) {
      return false
    }
    return progress >= 0 && progress <= 100
  }

  /**
   * 验证枚举值
   *
   * @param value - 待验证的值
   * @param validValues - 有效的枚举值列表
   * @returns 是否为有效枚举值
   *
   * @requirement 2.6 - progressApprovalStatus enum validation
   */
  function validateEnum<T>(value: unknown, validValues: readonly T[]): boolean {
    return validValues.includes(value as T as _T)
  }

  /**
   * 安全获取字段值，提供默认值
   *
   * 支持点号分隔的路径访问嵌套属性
   *
   * @param obj - 源对象
   * @param path - 属性路径（支持点号分隔，如 'user.name'）
   * @param defaultValue - 默认值
   * @returns 获取到的值或默认值
   *
   * @requirement 9.4 - Null value handling with default values
   *
   * @example
   * ```typescript
   * const name = safeGet(data, 'user.name', '未知用户')
   * const progress = safeGet(indicator, 'progress', 0)
   * ```
   */
  function safeGet<T>(obj: unknown, path: string, defaultValue: T): T {
    if (isNullOrUndefined(obj)) {
      return defaultValue
    }

    const keys = path.split('.')
    let current: unknown = obj

    for (const key of keys) {
      if (isNullOrUndefined(current) || !isPlainObject(current)) {
        return defaultValue
      }
      current = (current as Record<string, unknown>)[key]
    }

    if (isNullOrUndefined(current)) {
      return defaultValue
    }

    // 处理空字符串和空数组的情况
    if (typeof defaultValue === 'string' && isEmptyString(current)) {
      return defaultValue
    }

    if (Array.isArray(defaultValue) && isEmptyArray(current)) {
      return defaultValue
    }

    return current as T
  }

  /**
   * 批量验证数组数据
   *
   * @param items - 待验证的数据数组
   * @param validator - 单项验证函数
   * @returns 每个元素的验证结果数组
   *
   * @example
   * ```typescript
   * const results = validateArray(items, validateIndicator)
   * const allValid = results.every(r => r.isValid)
   * ```
   */
  function validateArray<_T>(
    items: unknown[],
    validator: (item: unknown) => ValidationResult
  ): ValidationResult[] {
    if (!Array.isArray(items)) {
      return [
        {
          isValid: false,
          errors: [
            {
              field: '_root',
              message: '输入必须是数组',
              value: items
            }
          ],
          warnings: []
        }
      ]
    }

    return items.map((item, index) => {
      const result = validator(item)
      // 为错误添加索引信息
      return {
        ...result,
        errors: result.errors.map(error => ({
          ...error,
          field: `[${index}].${error.field}`
        })),
        warnings: result.warnings.map(warning => ({
          ...warning,
          field: `[${index}].${warning.field}`
        }))
      }
    })
  }

  /**
   * 使用默认值填充对象的空字段
   *
   * @param obj - 源对象
   * @param entityType - 实体类型 ('indicator' | 'user' | 'statusAuditEntry')
   * @returns 填充后的对象
   *
   * @requirement 9.4 - Null value handling with default values
   */
  function fillDefaults<T extends Record<string, unknown>>(
    obj: T,
    entityType: 'indicator' | 'user' | 'statusAuditEntry'
  ): T {
    const entityDefaults: Record<string, Record<string, unknown>> = {
      indicator: indicatorDefaultValues,
      user: userDefaultValues,
      statusAuditEntry: statusAuditEntryDefaultValues
    }

    const defaults: Record<string, unknown> = {
      ...(entityDefaults[entityType] || {}),
      ...defaultValues
    }

    const result: Record<string, unknown> = { ...obj }

    for (const [key, defaultVal] of Object.entries(defaults)) {
      if (isNullOrUndefined(result[key])) {
        result[key] = defaultVal
      }
    }

    return result as T
  }

  /**
   * 创建空的验证结果
   */
  function createEmptyResult(): ValidationResult {
    return {
      isValid: true,
      errors: [],
      warnings: []
    }
  }

  /**
   * 合并多个验证结果
   */
  function mergeResults(...results: ValidationResult[]): ValidationResult {
    const merged: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    }

    for (const result of results) {
      if (!result.isValid) {
        merged.isValid = false
      }
      merged.errors.push(...result.errors)
      merged.warnings.push(...result.warnings)
    }

    return merged
  }

  return {
    // 实体验证方法
    validateIndicator,
    validateUser,
    validateStatusAuditEntry,

    // 字段验证方法
    validateDateFormat,
    validateProgress,
    validateEnum,

    // 安全取值方法
    safeGet,

    // 批量验证方法
    validateArray,

    // 辅助方法
    fillDefaults,
    createEmptyResult,
    mergeResults
  }
}

// ============================================================================
// 导出类型
// ============================================================================

export type {
  ValidationRule,
  EntityValidationRules,
  StringValidationRule,
  NumberValidationRule,
  DateValidationRule,
  ArrayValidationRule,
  EnumValidationRule
} from '@/shared/config/validationRules'
