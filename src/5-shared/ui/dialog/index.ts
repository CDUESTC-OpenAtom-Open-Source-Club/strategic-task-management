/**
 * Shared Dialog Components
 *
 * Reusable dialog components extracted from feature views
 * to reduce code duplication and improve maintainability.
 */

export { default as ApprovalSetupDialog } from './ApprovalSetupDialog.vue'
export { default as AssignmentDialog } from './AssignmentDialog.vue'

export type {
  ApprovalStepCandidate,
  ApprovalStepPreview,
  ApprovalSetupDialogProps
} from './ApprovalSetupDialog.vue'

export type { AssignmentItem, AssignmentDialogProps } from './AssignmentDialog.vue'
