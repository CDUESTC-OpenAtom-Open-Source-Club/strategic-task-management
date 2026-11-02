/**
 * 关键报错持久化通知（2026-10-31 用户拍板：关键错误不自动消失，手动关）。
 *
 * 背景：附件上传被拒、导入失败/阻断、审批通过/驳回失败这类「结果必须被看到」的
 * 错误，此前用 ElMessage.error 3 秒自动消失，长文案（后端原文/批量汇总）看不完。
 *
 * 约定：
 * - `critical: true`（三处接入点显式传）→ ElNotification 常驻右上角：
 *   duration: 0 + showClose: true，仅可手动关闭；
 * - `critical: false`（默认）→ 3 秒自动消失，与普通提示现状一致；
 *   成功提示与表单即时校验类警告不要走本工具的 critical 档。
 * - 统一 ElNotification（title + 错误原文，右上角），与项目既有 Notification
 *   用法同风格；通知展示失败时静默降级（logger 留痕），绝不打断业务流程。
 */
import type { VNode } from 'vue'
import { ElNotification } from 'element-plus'
import type { NotificationHandle } from 'element-plus'
import { logger } from '@/shared/lib/utils/logger'

/** 普通提示的自动消失时长（维持现状 3 秒） */
const NON_CRITICAL_DURATION_MS = 3000

export interface CriticalErrorNoticeOptions {
  /** 通知标题（短句，如「审批失败」「导入解析失败」） */
  title: string
  /** 错误原文（后端原文优先原样透出），也接受 VNode（如带操作按钮的长提示） */
  message: string | VNode
  /** 通知类型，默认 error */
  type?: 'error' | 'warning' | 'info' | 'success'
  /**
   * 是否关键报错：
   * - true → 持久常驻（duration 0 + 手动关闭），接入点显式传 true；
   * - false（默认）→ 3 秒自动消失。
   */
  critical?: boolean
}

/**
 * 弹一条错误/提示通知；critical=true 时持久化（不自动消失、可手动关）。
 *
 * @returns NotificationHandle（通知展示失败时返回 null，调用方需容忍空值）
 */
export function showCriticalErrorNotice(
  options: CriticalErrorNoticeOptions
): NotificationHandle | null {
  const critical = options.critical === true

  try {
    return ElNotification({
      title: options.title,
      message: options.message,
      type: options.type ?? 'error',
      position: 'top-right',
      duration: critical ? 0 : NON_CRITICAL_DURATION_MS,
      showClose: critical
    })
  } catch (error) {
    // 隐私插件/极端环境下通知组件异常时静默降级，不影响业务主流程
    logger.error('[criticalErrorNotice] 通知展示失败:', error)
    return null
  }
}
