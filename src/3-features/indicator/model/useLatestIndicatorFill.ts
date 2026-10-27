import { ref, watch, type Ref } from 'vue'
import type { Attachment } from '@/shared/types'
import { useIndicatorFills } from './useIndicatorFills'

/**
 * 2026-10-26 用户反馈：指标详情抽屉缺「进度说明」「上报资料」两个展示字段，
 * 且部分界面显示「—」未对接真实数据。
 *
 * 根因：useIndicatorFills 只返回**已提交**轮次（filter(fill => Boolean(fill.status))），
 * 尚未提交审批的草稿轮次不在其中 → 详情抽屉读不到实时填报内容。
 *
 * 修复：实时值优先——
 *   进度说明：行内 pendingRemark（当前轮次草稿/待提交内容）→ 已提交轮次 content
 *   上报资料：行内 pendingAttachmentDetails → 已提交轮次 attachments
 * 三页共用的详情抽屉（战略任务/指标列表/指标分发）接同一个 composable，口径一致。
 */
export function useLatestIndicatorFill(
  indicatorId: Ref<string | number | null | undefined>,
  /**
   * 行内实时数据取数器（按指标 id 返回**当前最新**的行对象）。
   * 必须按 id 实时取，而不是传入打开抽屉那一刻的 row 引用——
   * 行对象在异步加载后会被替换成新对象，旧引用里的 pendingRemark 会停在空值，
   * 导致详情抽屉「进度说明」显示「—」。
   */
  resolveLive?: (id: string | number) =>
    | {
        pendingRemark?: string | null
        pendingAttachmentDetails?: Attachment[] | null
      }
    | null
    | undefined
) {
  const latestFillNote = ref('')
  const latestFillAttachments = ref<Attachment[]>([])

  const applyLive = (id: string | number): boolean => {
    const source = resolveLive?.(id)
    if (!source) {
      return false
    }
    const note = String(source.pendingRemark ?? '').trim()
    const attachments = Array.isArray(source.pendingAttachmentDetails)
      ? source.pendingAttachmentDetails
      : []
    if (!note && attachments.length === 0) {
      return false
    }
    latestFillNote.value = note
    latestFillAttachments.value = attachments
    return true
  }

  const load = async (id: string | number) => {
    latestFillNote.value = ''
    latestFillAttachments.value = []
    // 1) 行内实时值优先（草稿/待提交也可见）
    if (applyLive(id)) {
      return
    }
    // 2) 回退：已提交轮次
    try {
      const fills = await useIndicatorFills(id)
      const latest = fills?.[0]
      if (latest) {
        latestFillNote.value = latest.content || ''
        latestFillAttachments.value = latest.attachments || []
      }
    } catch {
      // 辅助数据拉取失败不阻塞详情抽屉：留空展示「—」
    }
  }

  // 依赖：指标 id + 该指标的实时内容签名（说明文本 + 附件数）+ 行数据就绪标记。
  // id 变化（打开/切换详情）与实时内容变化（用户保存填报）都要重新加载；
  // 行数据异步加载完成后（此前 resolveLive 返回 undefined）也要重试一次，
  // 否则详情抽屉会一直显示「—」（useIndicatorFills 只含已提交轮次，取不到草稿内容）。
  const liveReady = ref(false)
  watch(
    () => {
      const id = indicatorId.value
      if (id === null || id === undefined || id === '') {
        return ''
      }
      const source = resolveLive?.(id)
      if (!source) {
        // 行数据尚未就绪：标记为未就绪，watch 会在数据到达后再触发
        return `${id}::pending`
      }
      liveReady.value = true
      return `${id}::${String(source.pendingRemark ?? '')}|${(source.pendingAttachmentDetails ?? []).length}`
    },
    async () => {
      const id = indicatorId.value
      if (id === null || id === undefined || id === '') {
        latestFillNote.value = ''
        latestFillAttachments.value = []
        return
      }
      await load(id)
    },
    { immediate: true }
  )

  return { latestFillNote, latestFillAttachments }
}
