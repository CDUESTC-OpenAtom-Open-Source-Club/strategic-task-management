/**
 * 数据验证规则配置文件
 *
 * 定义指标、里程碑、用户等实体的验证规则
 * 用于 DataValidator Composable 进行数据完整性和格式校验
 *
 * @requirements 2.4, 2.6, 5.2, 9.1, 9.2, 9.3
 */

// ============================================================================
// 验证规则类型定义
// ============================================================================

/**
 * 字段验证规则类型
 */
export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object' | 'enum'

/**
 * 基础验证规则接口
 */
export interface BaseValidationRule {
  /** 是否必填 */
  required: boolean
  /** 字段类型 */
  type: FieldType
  /** 字段描述（用于错误提示） */
  description?: string
}

/**
 * 字符串类型验证规则
 */
export interface StringValidationRule extends BaseValidationRule {
  type: 'string'
  /** 最小长度 */
  minLength?: number
  /** 最大长度 */
  maxLength?: number
  /** 正则表达式模式 */
  pattern?: RegExp
}

/**
 * 数字类型验证规则
 */
export interface NumberValidationRule extends BaseValidationRule {
  type: 'number'
  /** 最小值 */
  min?: number
  /** 最大值 */
  max?: number
  /** 是否必须为整数 */
  integer?: boolean
}

/**
 * 日期类型验证规则
 */
export interface DateValidationRule extends BaseValidationRule {
  type: 'date'
  /** 最小日期 */
  minDate?: Date | string
  /** 最大日期 */
  maxDate?: Date | string
  /** 日期格式（用于字符串日期验证） */
  format?: string
}

/**
 * 数组类型验证规则
 */
export interface ArrayValidationRule extends BaseValidationRule {
  type: 'array'
  /** 最小元素数量 */
  minItems?: number
  /** 最大元素数量 */
  maxItems?: number
  /** 数组元素的验证规则 */
  itemRules?: ValidationRule
}

/**
 * 枚举类型验证规则
 */
export interface EnumValidationRule extends BaseValidationRule {
  type: 'enum'
  /** 有效的枚举值列表 */
  values: readonly (string | number)[]
}

/**
 * 对象类型验证规则
 */
export interface ObjectValidationRule extends BaseValidationRule {
  type: 'object'
  /** 嵌套属性的验证规则 */
  properties?: Record<string, ValidationRule>
}

/**
 * 布尔类型验证规则
 */
export interface BooleanValidationRule extends BaseValidationRule {
  type: 'boolean'
}

/**
 * 联合验证规则类型
 */
export type ValidationRule =
  | StringValidationRule
  | NumberValidationRule
  | DateValidationRule
  | ArrayValidationRule
  | EnumValidationRule
  | ObjectValidationRule
  | BooleanValidationRule

/**
 * 实体验证规则集合类型
 */
export type EntityValidationRules = Record<string, ValidationRule>

// ============================================================================
// 枚举值常量定义
// ============================================================================

/**
 * 进度审批状态枚举值
 * @requirement 2.6 - progressApprovalStatus enum validation
 * 注意：必须使用大写，与数据库约束一致
 */
export const PROGRESS_APPROVAL_STATUS_VALUES = [
  'NONE',
  'DRAFT',
  'PENDING',
  'APPROVED',
  'REJECTED'
] as const

/**
 * 用户角色枚举值
 * @requirement 5.2 - User role enum validation
 */
export const USER_ROLE_VALUES = ['strategic_dept', 'functional_dept', 'secondary_college'] as const

/**
 * 指标状态枚举值
 */
export const INDICATOR_STATUS_VALUES = [
  'draft',
  'active',
  'archived',
  'distributed',
  'pending',
  'approved'
] as const

/**
 * 指标类型1枚举值
 */
export const INDICATOR_TYPE1_VALUES = ['定性', '定量'] as const

/**
 * 指标类型2枚举值
 */
export const INDICATOR_TYPE2_VALUES = ['发展性', '基础性'] as const

/**
 * 审计操作类型枚举值
 */
export const AUDIT_ACTION_VALUES = [
  'submit',
  'approve',
  'reject',
  'revoke',
  'update',
  'distribute',
  'withdraw'
] as const

// ============================================================================
// 指标验证规则
// ============================================================================

/**
 * 指标数据验证规则
 *
 * @requirement 9.2 - Progress value range validation (0-100)
 * @requirement 9.3 - Weight value validation (non-negative number)
 */
export const indicatorValidationRules: EntityValidationRules = {
  id: {
    required: true,
    type: 'string',
    minLength: 1,
    description: '指标ID'
  } as StringValidationRule,

  name: {
    required: true,
    type: 'string',
    minLength: 1,
    maxLength: 200,
    description: '指标名称'
  } as StringValidationRule,

  progress: {
    required: true,
    type: 'number',
    min: 0,
    max: 100,
    description: '进度百分比'
  } as NumberValidationRule,

  weight: {
    required: true,
    type: 'number',
    min: 0,
    description: '权重值'
  } as NumberValidationRule,

  responsibleDept: {
    required: true,
    type: 'string',
    minLength: 1,
    description: '责任部门'
  } as StringValidationRule,

  year: {
    required: true,
    type: 'number',
    min: 2020,
    max: 2030,
    integer: true,
    description: '年份'
  } as NumberValidationRule,

  progressApprovalStatus: {
    required: false,
    type: 'enum',
    values: PROGRESS_APPROVAL_STATUS_VALUES,
    description: '进度审批状态'
  } as EnumValidationRule,

  isQualitative: {
    required: false,
    type: 'boolean',
    description: '是否为定性指标'
  } as BooleanValidationRule,

  type1: {
    required: false,
    type: 'enum',
    values: INDICATOR_TYPE1_VALUES,
    description: '指标类型1（定性/定量）'
  } as EnumValidationRule,

  type2: {
    required: false,
    type: 'enum',
    values: INDICATOR_TYPE2_VALUES,
    description: '指标类型2（发展性/基础性）'
  } as EnumValidationRule,

  status: {
    required: false,
    type: 'enum',
    values: INDICATOR_STATUS_VALUES,
    description: '指标状态'
  } as EnumValidationRule,

  targetValue: {
    required: false,
    type: 'number',
    min: 0,
    description: '目标值'
  } as NumberValidationRule,

  actualValue: {
    required: false,
    type: 'number',
    min: 0,
    description: '实际值'
  } as NumberValidationRule,

  unit: {
    required: false,
    type: 'string',
    description: '单位'
  } as StringValidationRule,

  responsiblePerson: {
    required: false,
    type: 'string',
    description: '责任人'
  } as StringValidationRule,

  isStrategic: {
    required: false,
    type: 'boolean',
    description: '是否为战略指标'
  } as BooleanValidationRule,

  ownerDept: {
    required: false,
    type: 'string',
    description: '发布方部门'
  } as StringValidationRule,

  parentIndicatorId: {
    required: false,
    type: 'string',
    description: '父指标ID'
  } as StringValidationRule,

  createTime: {
    required: false,
    type: 'string',
    description: '创建时间'
  } as StringValidationRule,

  remark: {
    required: false,
    type: 'string',
    description: '备注'
  } as StringValidationRule,

  taskContent: {
    required: false,
    type: 'string',
    description: '关联的战略任务内容'
  } as StringValidationRule,

  pendingProgress: {
    required: false,
    type: 'number',
    min: 0,
    max: 100,
    description: '待审批的进度值'
  } as NumberValidationRule,

  pendingRemark: {
    required: false,
    type: 'string',
    description: '待审批的说明'
  } as StringValidationRule,

  statusAudit: {
    required: false,
    type: 'array',
    description: '审批/操作历史'
  } as ArrayValidationRule
}

// ============================================================================
// 里程碑验证规则
// ============================================================================

// ============================================================================
// 用户验证规则
// ============================================================================

/**
 * 用户数据验证规则
 *
 * @requirement 5.2 - User role enum validation
 */
export const userValidationRules: EntityValidationRules = {
  id: {
    required: true,
    type: 'string',
    minLength: 1,
    description: '用户ID'
  } as StringValidationRule,

  name: {
    required: true,
    type: 'string',
    minLength: 1,
    maxLength: 50,
    description: '用户姓名'
  } as StringValidationRule,

  username: {
    required: false,
    type: 'string',
    minLength: 1,
    maxLength: 50,
    description: '用户名'
  } as StringValidationRule,

  role: {
    required: true,
    type: 'enum',
    values: USER_ROLE_VALUES,
    description: '用户角色'
  } as EnumValidationRule,

  department: {
    required: true,
    type: 'string',
    minLength: 1,
    description: '所属部门'
  } as StringValidationRule,

  avatar: {
    required: false,
    type: 'string',
    description: '头像URL'
  } as StringValidationRule,

  createdAt: {
    required: false,
    type: 'date',
    description: '创建时间'
  } as DateValidationRule,

  updatedAt: {
    required: false,
    type: 'date',
    description: '更新时间'
  } as DateValidationRule
}

// ============================================================================
// 状态审计日志验证规则
// ============================================================================

/**
 * 状态审计日志条目验证规则
 *
 * @requirement 3.4 - statusAudit audit log field validation
 */
export const statusAuditEntryValidationRules: EntityValidationRules = {
  id: {
    required: true,
    type: 'string',
    minLength: 1,
    description: '审计日志ID'
  } as StringValidationRule,

  timestamp: {
    required: true,
    type: 'date',
    description: '操作时间'
  } as DateValidationRule,

  operator: {
    required: true,
    type: 'string',
    minLength: 1,
    description: '操作人用户名'
  } as StringValidationRule,

  operatorName: {
    required: false,
    type: 'string',
    description: '操作人姓名'
  } as StringValidationRule,

  operatorDept: {
    required: false,
    type: 'string',
    description: '操作人部门'
  } as StringValidationRule,

  action: {
    required: true,
    type: 'enum',
    values: AUDIT_ACTION_VALUES,
    description: '操作类型'
  } as EnumValidationRule,

  comment: {
    required: false,
    type: 'string',
    description: '操作备注'
  } as StringValidationRule,

  previousStatus: {
    required: false,
    type: 'string',
    description: '变更前状态'
  } as StringValidationRule,

  newStatus: {
    required: false,
    type: 'string',
    description: '变更后状态'
  } as StringValidationRule,

  previousProgress: {
    required: false,
    type: 'number',
    min: 0,
    max: 100,
    description: '变更前进度'
  } as NumberValidationRule,

  newProgress: {
    required: false,
    type: 'number',
    min: 0,
    max: 100,
    description: '变更后进度'
  } as NumberValidationRule
}

// ============================================================================
// 默认值配置
// ============================================================================

/**
 * 指标字段默认值
 */
export const indicatorDefaultValues: Record<string, unknown> = {
  progress: 0,
  weight: 0,
  progressApprovalStatus: 'NONE',
  isQualitative: false,
  isStrategic: false,
  targetValue: 0,
  actualValue: 0,
  unit: '',
  remark: '',
  statusAudit: [],
  year: new Date().getFullYear()
}

/**
 * 用户字段默认值
 */
export const userDefaultValues: Record<string, unknown> = {
  name: '未知用户',
  role: 'secondary_college',
  department: '未知部门',
  avatar: ''
}

/**
 * 状态审计日志默认值
 */
export const statusAuditEntryDefaultValues: Record<string, unknown> = {
  operatorName: '',
  operatorDept: '',
  comment: '',
  previousStatus: '',
  newStatus: ''
}

// ============================================================================
// 验证规则导出汇总
// ============================================================================

/**
 * 所有实体验证规则集合
 */
export const allValidationRules = {
  indicator: indicatorValidationRules,
  user: userValidationRules,
  statusAuditEntry: statusAuditEntryValidationRules
} as const

/**
 * 所有默认值集合
 */
export const allDefaultValues = {
  indicator: indicatorDefaultValues,
  user: userDefaultValues,
  statusAuditEntry: statusAuditEntryDefaultValues
} as const

// ============================================================================
// 类型导出
// ============================================================================

export type ProgressApprovalStatusValue = (typeof PROGRESS_APPROVAL_STATUS_VALUES)[number]
export type UserRoleValue = (typeof USER_ROLE_VALUES)[number]
export type IndicatorStatusValue = (typeof INDICATOR_STATUS_VALUES)[number]
export type IndicatorType1Value = (typeof INDICATOR_TYPE1_VALUES)[number]
export type IndicatorType2Value = (typeof INDICATOR_TYPE2_VALUES)[number]
export type AuditActionValue = (typeof AUDIT_ACTION_VALUES)[number]
