import { readonly, ref } from 'vue'

export interface ApprovalCenterContext {
  workflowEntityType?: 'PLAN' | 'PLAN_REPORT' | 'INDICATOR'
  workflowEntityId?: number | string
  secondaryWorkflowEntityType?: 'PLAN' | 'PLAN_REPORT' | 'INDICATOR'
  secondaryWorkflowEntityId?: number | string
  approvalInstanceId?: number | string
  departmentName?: string
  planName?: string
  routeTarget?: string
}

const approvalCenterVisible = ref(false)
const approvalCenterContext = ref<ApprovalCenterContext | null>(null)

function normalizeApprovalCenterContext(
  context?: ApprovalCenterContext | null
): ApprovalCenterContext | null {
  if (!context) {
    return null
  }

  const normalized: ApprovalCenterContext = {}

  if (
    context.workflowEntityType === 'PLAN' ||
    context.workflowEntityType === 'PLAN_REPORT' ||
    context.workflowEntityType === 'INDICATOR'
  ) {
    normalized.workflowEntityType = context.workflowEntityType
  }

  if (
    context.secondaryWorkflowEntityType === 'PLAN' ||
    context.secondaryWorkflowEntityType === 'PLAN_REPORT' ||
    context.secondaryWorkflowEntityType === 'INDICATOR'
  ) {
    normalized.secondaryWorkflowEntityType = context.secondaryWorkflowEntityType
  }

  if (
    context.workflowEntityId !== undefined &&
    context.workflowEntityId !== null &&
    String(context.workflowEntityId).trim()
  ) {
    normalized.workflowEntityId = context.workflowEntityId
  }

  if (
    context.secondaryWorkflowEntityId !== undefined &&
    context.secondaryWorkflowEntityId !== null &&
    String(context.secondaryWorkflowEntityId).trim()
  ) {
    normalized.secondaryWorkflowEntityId = context.secondaryWorkflowEntityId
  }

  if (
    context.approvalInstanceId !== undefined &&
    context.approvalInstanceId !== null &&
    String(context.approvalInstanceId).trim()
  ) {
    normalized.approvalInstanceId = context.approvalInstanceId
  }

  const departmentName =
    typeof context.departmentName === 'string' ? context.departmentName.trim() : ''
  if (departmentName) {
    normalized.departmentName = departmentName
  }

  const planName = typeof context.planName === 'string' ? context.planName.trim() : ''
  if (planName) {
    normalized.planName = planName
  }

  const routeTarget = typeof context.routeTarget === 'string' ? context.routeTarget.trim() : ''
  if (routeTarget) {
    normalized.routeTarget = routeTarget
  }

  return Object.keys(normalized).length > 0 ? normalized : null
}

export function useApprovalCenter() {
  const openApprovalCenter = (context?: ApprovalCenterContext | null) => {
    approvalCenterContext.value = normalizeApprovalCenterContext(context)
    approvalCenterVisible.value = true
  }

  const closeApprovalCenter = () => {
    approvalCenterVisible.value = false
    approvalCenterContext.value = null
  }

  const toggleApprovalCenter = (context?: ApprovalCenterContext | null) => {
    if (approvalCenterVisible.value) {
      closeApprovalCenter()
      return
    }

    openApprovalCenter(context)
  }

  return {
    approvalCenterVisible: readonly(approvalCenterVisible),
    approvalCenterContext: readonly(approvalCenterContext),
    openApprovalCenter,
    closeApprovalCenter,
    toggleApprovalCenter
  }
}
