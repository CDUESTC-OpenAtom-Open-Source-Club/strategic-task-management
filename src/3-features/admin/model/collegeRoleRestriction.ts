/**
 * 2026-10-25 用户定案（角色创建限制）
 *
 * 战略发展部人员均具备创建账号权限，但二级学院不设「分管校领导」——
 * 学院的领导是院长/学院领导，不是分管校领导；分管校领导席位只归属
 * 战略发展部与职能部门。因此当创建/编辑账号时，若所属组织为二级学院
 * 且勾选了「分管校领导」角色，系统必须拒绝该组合并给出错误提示。
 *
 * 约束：数据种子中预置的角色名称保持不变、数据库结构不变，仅前端拦截。
 */

/** 分管校领导角色的 roleCode（与后端 sys_role 预置一致） */
export const VICE_PRESIDENT_ROLE_CODE = 'ROLE_VICE_PRESIDENT'

/**
 * 判定为「二级学院」的组织类型取值。
 * 后端 sys_org.org_type 预置为 'academic'，前端映射层同时可能给出
 * 'secondary_college'（见 mapOrgTypeToFrontend），两套都按学院处理。
 */
export const COLLEGE_ORG_TYPES: ReadonlySet<string> = new Set([
  'secondary_college',
  'academic',
  'college'
])

/** 组织类型是否属于二级学院 */
export function isCollegeOrgType(orgType: string | null | undefined): boolean {
  return COLLEGE_ORG_TYPES.has(String(orgType ?? '').trim())
}

/**
 * 过滤掉学院场景下不允许的「分管校领导」角色。
 *
 * @returns 过滤后的角色数组；若因学院限制移除了分管校领导则返回 removed=true
 */
export function filterRolesForOrg(
  roles: readonly string[],
  orgType: string | null | undefined
): { roles: string[]; removed: boolean } {
  if (!isCollegeOrgType(orgType)) {
    return { roles: [...roles], removed: false }
  }

  const filtered = roles.filter(role => String(role) !== VICE_PRESIDENT_ROLE_CODE)
  return { roles: filtered, removed: filtered.length !== roles.length }
}

/** 组织类型 + 角色组合是否被允许（用于表单校验与提交前硬拦截） */
export function isRoleAssignmentAllowed(
  roles: readonly string[],
  orgType: string | null | undefined
): boolean {
  return !filterRolesForOrg(roles, orgType).removed
}

/** 统一的错误提示文案 */
export const COLLEGE_VICE_PRESIDENT_ERROR_MESSAGE =
  '二级学院不设「分管校领导」角色，请选择「审核人」等其他角色'
