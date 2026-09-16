/**
 * Shared Module
 *
 * 导出所有共享的工具、组件和API
 * Following FSD (Feature-Sliced Design) architecture
 *
 * **Validates: Requirements 3.3**
 */

// API Client (existing)
export { ApiClient, apiClient } from './api/client'
export type { ApiClientConfig, AppError } from './api/client'

// Legacy components export (deprecated - use @/shared/ui instead)
// Kept for backward compatibility during migration
export { default as BreadcrumbNav } from './ui/layout/BreadcrumbNav.vue'
export { default as DataTable } from './ui/table/DataTable.vue'
export { default as EmptyState } from './ui/feedback/EmptyState.vue'
export { default as HelpTooltip } from './ui/display/HelpTooltip.vue'
export { default as SkeletonLoader } from './ui/feedback/SkeletonLoader.vue'
export { default as TransitionWrapper } from './ui/layout/TransitionWrapper.vue'
export { default as YearSelector } from './ui/form/YearSelector.vue'

// FSD Architecture - New Structure
// UI Components (organized by category)
export * from './ui'

// Shared Libraries
export * from './lib'

// Type Definitions
export * from './types'

// Configuration
export * from './config'
