const AUTO_APPROVE_ROLES = [
  'ROLE_STRATEGY_DEPT_HEAD',
  'ROLE_VICE_PRESIDENT',
  'ROLE_SYSTEM_ADMIN'
] as const

/**
 * 仅部门最高领导人可勾选"导入后自动发起并完成审批"：
 * 分管校领导/学院院长席位（ROLE_VICE_PRESIDENT）、战略部负责人（ROLE_STRATEGY_DEPT_HEAD）、系统管理员。
 * 填报人（ROLE_REPORTER）与部门审核人（ROLE_APPROVER）均不可越级触发自动审批。
 * 与后端 BusinessImportApplicationService.ensureCanAutoApprove 的角色白名单保持一致。
 */
export function canAutoApproveImport(roles: unknown): boolean {
  if (!Array.isArray(roles)) {
    return false
  }
  const normalized = roles.map(role =>
    String(role ?? '')
      .trim()
      .toUpperCase()
  )
  return normalized.some(role => (AUTO_APPROVE_ROLES as readonly string[]).includes(role))
}
