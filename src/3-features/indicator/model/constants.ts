/**
 * Strategic Indicator Feature - Constants
 *
 * Business constants and configuration for the strategic indicator feature.
 */

import { IndicatorStatus, IndicatorLevel, WorkflowStatus } from '@/entities/indicator/model/types'

/**
 * Status display configuration
 */
export const STATUS_CONFIG = {
  [IndicatorStatus.DRAFT]: {
    label: '草稿',
    type: 'info',
    color: '#909399'
  },
  [IndicatorStatus.PENDING_REVIEW]: {
    label: '待审核',
    type: 'warning',
    color: '#E6A23C'
  },
  [IndicatorStatus.DISTRIBUTED]: {
    label: '已下发',
    type: 'success',
    color: '#67C23A'
  },
  [IndicatorStatus.ARCHIVED]: {
    label: '已归档',
    type: 'info',
    color: '#C0C4CC'
  }
} as const

/**
 * Workflow status display configuration
 */
export const WORKFLOW_STATUS_CONFIG = {
  [WorkflowStatus.DRAFT]: {
    label: '草稿',
    type: 'info'
  },
  [WorkflowStatus.PENDING_DISTRIBUTION]: {
    label: '待确认接收',
    type: 'warning'
  },
  [WorkflowStatus.DISTRIBUTED]: {
    label: '已下发',
    type: 'success'
  },
  [WorkflowStatus.PENDING_APPROVAL]: {
    label: '审批中',
    type: 'warning'
  },
  [WorkflowStatus.REJECTED]: {
    label: '已回退',
    type: 'danger'
  },
  [WorkflowStatus.COMPLETED]: {
    label: '已完成',
    type: 'success'
  }
} as const

/**
 * Level display configuration
 */
export const LEVEL_CONFIG = {
  [IndicatorLevel.FIRST]: {
    label: '一级指标',
    badge: '1'
  },
  [IndicatorLevel.SECOND]: {
    label: '二级指标',
    badge: '2'
  }
} as const

/**
 * Indicator type options
 */
export const INDICATOR_TYPE_OPTIONS = [
  { label: '定量', value: 'QUANTITATIVE' },
  { label: '定性', value: 'QUALITATIVE' }
] as const

/**
 * Default pagination settings
 */
export const DEFAULT_PAGE_SIZE = 20
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

/**
 * Weight validation
 */
export const WEIGHT_MIN = 0
export const WEIGHT_MAX = 1
export const WEIGHT_PRECISION = 2

/**
 * Form validation rules
 */
export const VALIDATION_RULES = {
  NAME_MAX_LENGTH: 200,
  CODE_MAX_LENGTH: 50,
  DESCRIPTION_MAX_LENGTH: 1000,
  UNIT_MAX_LENGTH: 50,
  TARGET_VALUE_MAX_LENGTH: 100
} as const
