/**
 * Strategic Indicator Feature - Public API
 *
 * Exports all public components, composables, and utilities from the feature.
 */

// Store
export { useIndicatorStore } from './model/store'

// Types
export type {
  IndicatorListState,
  IndicatorFormState,
  DistributionState,
  IndicatorStatistics,
  IndicatorFilterState,
  SavedFilter
} from './model/types'

// Constants
export {
  STATUS_CONFIG,
  WORKFLOW_STATUS_CONFIG,
  LEVEL_CONFIG,
  INDICATOR_TYPE_OPTIONS,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  VALIDATION_RULES
} from './model/constants'

// Schemas
export {
  indicatorCreateSchema,
  indicatorUpdateSchema,
  distributeRequestSchema,
  progressSubmitSchema
} from './model/schema'

export type {
  IndicatorCreateInput,
  IndicatorUpdateInput,
  DistributeRequestInput,
  ProgressSubmitInput
} from './model/schema'

// API
export * as indicatorQuery from './api/query'
export * as indicatorMutations from './api/mutations'

export type {
  PaginatedResponse,
  ApiResponse,
  IndicatorListResponse,
  IndicatorDetailResponse,
  DistributionResult,
  DistributionResponse,
  ApprovalSubmissionResult,
  ApprovalSubmissionResponse,
  IndicatorQueryParams
} from './api/types'

// Business Logic
export {
  calculateCompletionRate,
  calculateWeightedCompletionRate,
  validateWeightSum,
  calculateRemainingWeight,
  normalizeWeights,
  calculateProgress,
  formatWeightAsPercentage,
  calculateAggregateStatistics
} from './lib/calculations'

export {
  canEditIndicator,
  canDeleteIndicator,
  canDistributeIndicator,
  canWithdrawIndicator,
  canSubmitForApproval,
  validateIndicatorCreate,
  validateIndicatorUpdate,
  validateIndicatorDistribution,
  validateIndicatorWeights,
  validateProgressSubmission,
  getAvailableActions
} from './lib/validations'

export type { ValidationResult } from './lib/validations'

// UI Components
export { default as IndicatorCard } from './ui/IndicatorCard.vue'
export { default as IndicatorForm } from './ui/IndicatorForm.vue'
export { default as IndicatorList } from './ui/IndicatorList.vue'
export { default as IndicatorDistributionDialog } from './ui/IndicatorDistributionDialog.vue'
export { default as IndicatorDetailDialog } from './ui/IndicatorDetailDialog.vue'
export { default as IndicatorFillView } from './ui/IndicatorFillView.vue'

// View Components (Full-page views)
export { default as IndicatorListView } from './ui/IndicatorListView.vue'
export { default as IndicatorDetailView } from './ui/IndicatorDetailView.vue'
export { default as IndicatorEditView } from './ui/IndicatorEditView.vue'
export { default as IndicatorDistributeView } from './ui/IndicatorDistributeView.vue'

// Re-export plan-driven fill components
export { IndicatorFillForm, IndicatorFillHistory } from '@/features/plan/ui'
