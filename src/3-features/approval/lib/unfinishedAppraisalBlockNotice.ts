/**
 * 「未完成审核」拦截专项通知的共享出口（2026-10-31 P-04 用户定案）。
 *
 * 此前带「去完成鉴定」按钮的拦截通知只接在 useApprovalProgressWorkflow
 * （分发页/填报页抽屉）；审批中心宿主 useApprovalProgressDrawer 的失败出口
 * 全是裸 ElMessage.error，命中 409「未完成审核」时用户拿不到跳转入口。
 * 这里把「判断命中 → 解析跳转路由 → 消息级去重 → 弹带按钮的 Notification」
 * 抽成与宿主无关的共享函数，两个抽屉共用同一套口径；
 * 文案判定 / 路由解析复用 model/unfinishedAppraisalNotice 现成实现
 * （resolveUnfinishedAppraisalJumpRoute：PLAN_REPORT + 职能部门落 /distribution，
 * 解析不出路由时返回 false，调用方回退普通 toast）。
 */
import { getActivePinia } from 'pinia'
import { useAuthStore } from '@/features/auth/model/store'
import {
  isUnfinishedAppraisalMessage,
  resolveUnfinishedAppraisalJumpRoute,
  showUnfinishedAppraisalNotice
} from '@/features/approval/model/unfinishedAppraisalNotice'
import { claimErrorToast } from '@/shared/lib/utils/errorToast'
import type { UserRole } from '@/shared/types'

/** 跳转路由解析所需的查看者上下文（字段口径与审批卡片 routeTarget 一致） */
export interface UnfinishedAppraisalBlockNoticeOptions {
  /** 后端错误原文（buildUserFacingErrorMessage 之后的文案，原样展示） */
  message: string
  /**
   * 被拒实例/待办卡条目上下文（上报待办卡、scopedPlanApprovals 条目、待办卡 item、
   * 或 planWorkflowDetail——字段兼容 entityType/businessEntityType 等）。
   * 注意：不能依赖 props.plan 兜底——纯上报卡场景下它为 null。
   */
  instance?: Record<string, unknown> | null
  /** 当前登录人角色（缺省时从登录态解析） */
  viewerRole?: UserRole | string | null
  /** 当前登录人部门名（缺省时从登录态解析） */
  currentDepartmentName?: string | null
  /** 实例上取不到组织名时的兜底部门名（如抽屉的 departmentName） */
  fallbackDepartmentName?: string | null
  /** 点击「去完成鉴定」的跳转（宿主注入：先收抽屉再 router.push） */
  onJump: (routeTarget: string) => void
}

function normalizeViewerRole(role: unknown): UserRole | null {
  const normalized = String(role || '')
    .trim()
    .toLowerCase()
  if (
    normalized === 'strategic_dept' ||
    normalized === 'functional_dept' ||
    normalized === 'secondary_college'
  ) {
    return normalized as UserRole
  }
  return null
}

/** 从登录态解析查看者上下文（store 不可用时静默降级为空） */
function resolveAuthViewerContext(): {
  viewerRole: UserRole | null
  currentDepartmentName: string | null
} {
  try {
    if (getActivePinia()) {
      const authStore = useAuthStore()
      return {
        viewerRole: normalizeViewerRole(authStore.effectiveRole || authStore.userRole),
        currentDepartmentName:
          String(authStore.effectiveDepartment || authStore.user?.department || '').trim() || null
      }
    }
  } catch {
    // ignore store lookup failures and fall back to route resolution defaults
  }
  return { viewerRole: null, currentDepartmentName: null }
}

/**
 * 命中「未完成审核」类拦截时弹带「去完成鉴定」按钮的专项通知。
 *
 * 返回 true 表示已按拦截通知处理（调用方不要再弹普通 toast）；
 * 返回 false 表示非该类拦截（或解析不出跳转路由），调用方走原样错误 toast。
 */
export function showUnfinishedAppraisalBlockNotice(
  options: UnfinishedAppraisalBlockNoticeOptions
): boolean {
  if (!isUnfinishedAppraisalMessage(options.message)) {
    return false
  }

  const authContext = resolveAuthViewerContext()
  const routeTarget = resolveUnfinishedAppraisalJumpRoute(options.instance ?? null, {
    viewerRole: options.viewerRole ?? authContext.viewerRole,
    currentDepartmentName: options.currentDepartmentName ?? authContext.currentDepartmentName,
    fallbackDepartmentName: options.fallbackDepartmentName ?? null
  })
  // 解析不出跳转路由（缺报告实体上下文）时退回普通 toast：文字保留，不承诺跳转
  if (!routeTarget) {
    return false
  }

  // 消息级去重：同一拦截不重复弹通知
  if (!claimErrorToast(options.message)) {
    return true
  }
  showUnfinishedAppraisalNotice({
    message: options.message,
    routeTarget,
    onJump: options.onJump
  })
  return true
}
