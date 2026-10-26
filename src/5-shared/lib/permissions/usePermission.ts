/**
 * Canonical permissions entry for permission-aware composables.
 *
 * This module is the single source of truth for `usePermission`.
 * Legacy imports from `authorization` and `hooks/usePermission` should
 * re-export from here during the migration window.
 */

import { computed, type ComputedRef } from 'vue'
import { useAuthStore } from '@/features/auth/model/store'
import { PermissionCode } from '@/shared/types'
import type {
  UserRoleWithPermission as _UserRoleWithPermission,
  Plan,
  PlanFill,
  Indicator,
  IndicatorFill
} from '@/shared/types'

export interface PermissionCheckResult {
  hasPermission: boolean
  permissionCode: string
  reason?: string
}

export interface UsePermissionReturn {
  userRole: ComputedRef<string | undefined>
  userOrgId: ComputedRef<number | undefined>
  isStrategicDept: ComputedRef<boolean>
  isFunctionalDept: ComputedRef<boolean>
  isSecondaryCollege: ComputedRef<boolean>
  hasPermission: (permission: PermissionCode | PermissionCode[]) => boolean
  canAccessOrg: (orgId: number | string | null | undefined) => boolean
  canOperate: (
    resourceOrgId: number | string | null | undefined,
    permission: PermissionCode
  ) => boolean
  canViewPlan: (plan: Plan) => boolean
  canEditPlan: (plan: Plan) => boolean
  canDeletePlan: (plan: Plan) => boolean
  canSubmitPlan: (plan: Plan) => boolean
  getAccessiblePlans: (plans: Plan[]) => Plan[]
  canAuditPlanFill: (planFill: PlanFill) => boolean
  canViewPlanFill: (planFill: PlanFill) => boolean
  getAuditablePlanFills: (planFills: PlanFill[]) => PlanFill[]
  canFillIndicator: (indicator: Indicator) => boolean
  canViewIndicator: (indicator: Indicator) => boolean
  canEditIndicatorFill: (fill: IndicatorFill) => boolean
  canDeleteIndicatorFill: (fill: IndicatorFill) => boolean
}

export function usePermission(): UsePermissionReturn {
  const authStore = useAuthStore()

  const userRole = computed(() => authStore.user?.role)
  const userOrgId = computed(() => {
    const value = authStore.user?.orgId
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string') {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : undefined
    }
    return undefined
  })
  const isStrategicDept = computed(() => userRole.value === 'strategic_dept')
  const isFunctionalDept = computed(() => userRole.value === 'functional_dept')
  const isSecondaryCollege = computed(() => userRole.value === 'secondary_college')

  /**
   * 权限判断：只消费后端下发的 permissions（后端按「角色 + 组织作用域」计算）。
   * 2026-10-26 权限模型改造：删除按组织类别硬编码的 PERMISSION_ROLE_MAP，
   * 并移除「战略部直接全放行」的短路；按钮权限以权限码为准。
   */
  const hasPermission = (permission: PermissionCode | PermissionCode[]): boolean => {
    const rawPermissions = (authStore.user as { permissions?: unknown[] } | null)?.permissions
    const codes = Array.isArray(rawPermissions)
      ? rawPermissions.map(item => String(item)).filter(Boolean)
      : []
    if (codes.length === 0) {
      return false
    }
    const requested = Array.isArray(permission) ? permission : [permission]
    return requested.some(code => codes.includes(String(code)))
  }

  const canAccessOrg = (orgId: number | string | null | undefined): boolean => {
    if (isStrategicDept.value) {
      return true
    }

    if (userOrgId.value == null) {
      return false
    }

    const targetOrgId =
      typeof orgId === 'number' ? orgId : typeof orgId === 'string' ? Number(orgId) : NaN

    if (!Number.isFinite(targetOrgId)) {
      return false
    }

    return userOrgId.value === targetOrgId
  }

  const canOperate = (
    resourceOrgId: number | string | null | undefined,
    permission: PermissionCode
  ): boolean => {
    void permission
    return canAccessOrg(resourceOrgId)
  }

  const canAccessPlanOrg = (plan: Plan): boolean => {
    if (isStrategicDept.value) {
      return true
    }

    return plan.org_id === userOrgId.value
  }

  const canViewPlan = (plan: Plan): boolean => {
    return canAccessPlanOrg(plan)
  }

  const canEditPlan = (plan: Plan): boolean => {
    if (plan.status !== 'draft') {
      return false
    }

    if (isStrategicDept.value) {
      return true
    }

    if (isFunctionalDept.value && plan.org_id === userOrgId.value) {
      return true
    }

    return false
  }

  const canDeletePlan = (plan: Plan): boolean => {
    if (!isStrategicDept.value) {
      return false
    }

    return plan.status === 'draft'
  }

  const canSubmitPlan = (plan: Plan): boolean => {
    if (plan.status !== 'draft' && plan.status !== 'pending') {
      return false
    }

    if (!userRole.value) {
      return false
    }

    return canAccessPlanOrg(plan)
  }

  const getAccessiblePlans = (plans: Plan[]): Plan[] => {
    return plans.filter(canViewPlan)
  }

  const canAuditPlanFill = (planFill: PlanFill): boolean => {
    void planFill
    // 核心审批改由工作流待办、角色、组织范围和业务状态联合决定。
    return false
  }

  const canViewPlanFill = (planFill: PlanFill): boolean => {
    if (isStrategicDept.value) {
      return true
    }

    return canAccessOrg(planFill.org_id)
  }

  const getAuditablePlanFills = (planFills: PlanFill[]): PlanFill[] => {
    return planFills.filter(canAuditPlanFill)
  }

  const canFillIndicator = (indicator: Indicator): boolean => {
    if (!userRole.value) {
      return false
    }

    return canAccessOrg(indicator.target_org_id)
  }

  const canViewIndicator = (indicator: Indicator): boolean => {
    if (isStrategicDept.value) {
      return true
    }

    return canAccessOrg(indicator.target_org_id) || canAccessOrg(indicator.org_id)
  }

  const canEditIndicatorFill = (fill: IndicatorFill): boolean => {
    if (!userRole.value) {
      return false
    }

    return canAccessOrg(fill.org_id)
  }

  const canDeleteIndicatorFill = (fill: IndicatorFill): boolean => {
    return canEditIndicatorFill(fill)
  }

  return {
    userRole,
    userOrgId,
    isStrategicDept,
    isFunctionalDept,
    isSecondaryCollege,
    hasPermission,
    canAccessOrg,
    canOperate,
    canViewPlan,
    canEditPlan,
    canDeletePlan,
    canSubmitPlan,
    getAccessiblePlans,
    canAuditPlanFill,
    canViewPlanFill,
    getAuditablePlanFills,
    canFillIndicator,
    canViewIndicator,
    canEditIndicatorFill,
    canDeleteIndicatorFill
  }
}

export default usePermission
