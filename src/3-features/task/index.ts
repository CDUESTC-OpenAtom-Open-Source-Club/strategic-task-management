/**
 * Task Feature
 *
 * Strategic task management feature
 */

// Model exports
export * from './model/types'
export * from './model/constants'
export { useTaskStore } from './model/store'

// API exports
export { strategicApi } from './api/strategicApi'
export type { StrategicTaskVO, IndicatorVO, AssessmentCycleVO } from './api/strategicApi'

// Lib exports
export * from './lib/utils'

// UI exports
export { default as TaskCard } from './ui/TaskCard.vue'
export { default as StrategicTaskView } from './ui/StrategicTaskView.vue'
