/**
 * 「未完成审核」拦截的带跳转提示（2026-10-30 用户定案：光有文字不够，要能一键跳转）。
 *
 * 后端在上报链（PLAN_APPROVAL_*）可评级节点通过前校验「全部指标审核进度已鉴定」，
 * 未完成时以 BusinessConflictException 原样透传 HTTP 409 文案（见后端
 * BusinessWorkflowApplicationService.buildUnappraisedAuditMessage）：
 * 「未完成审核：还有 N 项指标的审核进度未鉴定（『指标名』…）。请到 {部门} 的指标填报页
 * 完成全部指标的审核进度鉴定，再回到审批中心通过。」
 *
 * 本模块把这类拦截从普通 toast 升级为 ElNotification（不阻塞、可操作）：
 * - title「未完成审核」，message 展示后端原文（原样，不改写）；
 * - 附「去完成鉴定」按钮，点击落到**该报告填报部门的指标填报页**。
 *
 * 跳转路由复用审批卡片 routeTarget 的同一套口径——useApprovalProgressState 的
 * pendingPlanApprovalPreviewItems → resolveApprovalRoute（上报审批卡跳填报页带部门参数：
 * openApproval / approvalEntityType / approvalEntityId / approvalInstanceId /
 * approvalDepartment / approvalSourceOrg / approvalTargetOrg），不另造参数格式；
 * 部门与实例参数从被拒实例/卡片上下文（PLAN_REPORT 实例记录）提取。
 */
import { h } from 'vue'
import { ElButton } from 'element-plus'
import type { NotificationHandle } from 'element-plus'
import { showCriticalErrorNotice } from '@/shared/lib/criticalErrorNotice'
import { resolveApprovalRoute } from '@/features/approval/lib/approvalNotifications'
import { toPositiveNumber } from '@/features/approval/lib/approval-utils'
import { normalizeApprovalEntityType } from '@/features/approval/model/approvalEntityTypes'
import type { UserRole } from '@/shared/types'

/** 后端拦截文案的固定前缀（buildUnappraisedAuditMessage 的返回值以它开头） */
const UNFINISHED_APPRAISAL_MESSAGE_KEY = '未完成审核'

/**
 * 是否为「未完成审核」类拦截文案。
 * 批量失败汇总（「有 N 项审批未成功：未完成审核：…」）同样命中——只有这类才带跳转按钮。
 */
export function isUnfinishedAppraisalMessage(message: unknown): boolean {
  return String(message || '').includes(UNFINISHED_APPRAISAL_MESSAGE_KEY)
}

/** 跳转路由解析所需的查看者上下文（字段口径与审批卡片 routeTarget 一致） */
export interface UnfinishedAppraisalViewerContext {
  /** 当前登录人角色（resolveApprovalRoute 内部归一化，并兜底取当前登录态） */
  viewerRole?: UserRole | string | null
  /** 当前登录人部门名（resolveApprovalRoute 据此判定上报方向） */
  currentDepartmentName?: string | null
  /** 实例上取不到组织名时的兜底部门名（如抽屉的 departmentName） */
  fallbackDepartmentName?: string | null
}

/**
 * 解析「未完成审核」拦截的跳转路由（复用审批卡片 resolveApprovalRoute 同一套口径）。
 *
 * 仅 PLAN_REPORT（上报审批的报告实例）可解析——审核进度鉴定只发生在上报链；
 * 其余实体（计划/异动）返回 null，调用方回退为普通 toast（文字保留，不带跳转）。
 *
 * @param instance 被拒实例/卡片上下文（上报待办卡原样记录、scopedPlanApprovals 条目、
 *                 或 planWorkflowDetail——字段名兼容 entityType/businessEntityType 等）
 * @param viewer   当前登录人上下文
 */
export function resolveUnfinishedAppraisalJumpRoute(
  instance: Record<string, unknown> | null | undefined,
  viewer: UnfinishedAppraisalViewerContext = {}
): string | null {
  if (!instance || typeof instance !== 'object') {
    return null
  }

  const entityType = normalizeApprovalEntityType(instance.entityType ?? instance.businessEntityType)
  if (entityType !== 'PLAN_REPORT') {
    return null
  }

  const entityId = toPositiveNumber(instance.entityId ?? instance.businessEntityId)
  if (!entityId) {
    return null
  }

  const sourceOrgName = String(instance.sourceOrgName ?? '').trim()
  const targetOrgName = String(instance.targetOrgName ?? '').trim()
  const actionUrl = typeof instance.actionUrl === 'string' ? instance.actionUrl.trim() : ''

  // 与 useApprovalProgressState.pendingPlanApprovalPreviewItems 的 payload 同一口径：
  // PLAN_REPORT 部门名兜底顺序 sourceOrgName → targetOrgName → 抽屉 departmentName，
  // 方向修正（上报反方向、提交方=targetOrg）由 resolveApprovalRoute 内部完成。
  return resolveApprovalRoute({
    actionUrl: actionUrl || null,
    entityType,
    entityId,
    approvalInstanceId:
      toPositiveNumber(instance.instanceId ?? instance.approvalInstanceId) ?? undefined,
    viewerRole: (viewer.viewerRole || null) as UserRole | null,
    departmentName: sourceOrgName || targetOrgName || viewer.fallbackDepartmentName || null,
    sourceOrgName: sourceOrgName || null,
    targetOrgName: targetOrgName || null,
    currentDepartmentName: viewer.currentDepartmentName || null
  })
}

/**
 * 「未完成审核」拦截的操作指引文案（2026-11-18 用户定案：指引必须指对页面）。
 *
 * 背景（实测结论）：后端 buildUnappraisedAuditMessage 的原文写「请到 XX 的**指标填报页**
 * 完成全部指标的审核进度鉴定」——但「指标填报页」（/indicators）对**职能部门审批人**
 * 并不显示待鉴定的学院子指标行（该页只列本部门指标；实测归口部门账号在 /indicators
 * 只有本部门 5 行、看不到上报学院的 2 行），按原文指引会走到**无法完成鉴定的页面**。
 * 职能部门审批人的评级入口实际在「**指标审批**」页（/distribution，选学院后逐行点
 * 「审核进度」）；战略发展部审批人的评级入口在「战略任务管理 → 二级学院战略任务管理」
 * 页签（逐行点「审核进度」）；学院侧在「指标填报」页。
 *
 * 因此这里按查看者角色给出一行**明确的操作指引**（含页签与点击位置），
 * 后端原文仍原样展示在上方（不改写后端文案，审计口径不变）。
 *
 * @param viewerRole 当前查看者角色（登录角色优先，与审批卡片跳转落点同口径）
 */
export function buildAppraisalGuidanceText(viewerRole?: UserRole | string | null): string {
  const normalized = String(viewerRole || '')
    .trim()
    .toLowerCase()

  if (normalized === 'strategic_dept') {
    return (
      '操作指引：请到「战略任务管理 → 二级学院战略任务管理」页签，选中对应学院后，' +
      '逐行点击「审核进度」选定等级（超前完成 / 正常 / 滞后），再回到审批中心通过。'
    )
  }

  if (normalized === 'secondary_college') {
    return (
      '操作指引：请到「指标填报」页签，选中对应指标后，逐行点击「审核进度」选定等级' +
      '（超前完成 / 正常 / 滞后），再回到审批中心通过。'
    )
  }

  // 职能部门审批人（上报链第 3/4 环评级节点）——默认口径
  return (
    '操作指引：请到顶部「指标审批」页签，在左侧学院列表选中该学院后，' +
    '逐行点击「审核进度」选定等级（超前完成 / 正常 / 滞后），再回到审批中心通过。'
  )
}

/**
 * 弹「未完成审核」拦截通知：后端原文 + 操作指引 + 「去完成鉴定」按钮。
 *
 * 2026-10-31 统一走共享 criticalErrorNotice（critical=true → duration 0 常驻、
 * 右上角可手动关闭，与三族关键报错同一形态）；点击按钮先关通知再执行 onJump
 * （由调用方注入路由跳转，模块本身不依赖 router 实例）。
 */
export function showUnfinishedAppraisalNotice(options: {
  /** 后端原文（原样展示，不改写） */
  message: string
  /** 操作指引（后端原文指路含糊时补一行明确指引，见 buildAppraisalGuidanceText） */
  guidance?: string
  /** 点击「去完成鉴定」要跳的路由（resolveUnfinishedAppraisalJumpRoute 的结果） */
  routeTarget: string
  /** 执行跳转（如 router.push） */
  onJump: (routeTarget: string) => void
}): NotificationHandle | null {
  let notification: NotificationHandle | null = null
  const jumpToIndicatorFillPage = () => {
    notification?.close()
    options.onJump(options.routeTarget)
  }

  notification = showCriticalErrorNotice({
    title: '未完成审核',
    type: 'warning',
    critical: true,
    message: h('div', [
      h(
        'p',
        { style: 'margin: 0 0 10px; line-height: 1.7; white-space: normal;' },
        options.message
      ),
      options.guidance
        ? h(
            'p',
            {
              style: 'margin: 0 0 10px; line-height: 1.7; white-space: normal; color: #606266;'
            },
            options.guidance
          )
        : null,
      h(
        ElButton,
        { type: 'primary', size: 'small', onClick: jumpToIndicatorFillPage },
        { default: () => '去完成鉴定' }
      )
    ])
  })
  return notification
}
