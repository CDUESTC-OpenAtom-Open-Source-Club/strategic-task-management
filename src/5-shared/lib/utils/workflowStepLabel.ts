/**
 * 审批节点「待审批」标签文案。
 *
 * 后端步骤名本身可能已含「审批」后缀（如「战略发展部负责人审批」「学院院长审批」），
 * 拼接「待${stepName}审批」会出现「审批审批」重复字。
 * 这里统一处理：步骤名已以「审批」结尾时直接前置「待」，否则才追加「审批」。
 */
export function formatPendingApprovalLabel(stepName?: string | null): string {
  const normalized = String(stepName || '').trim()
  if (!normalized) {
    return '审批中'
  }
  return normalized.endsWith('审批') ? `待${normalized}` : `待${normalized}审批`
}
