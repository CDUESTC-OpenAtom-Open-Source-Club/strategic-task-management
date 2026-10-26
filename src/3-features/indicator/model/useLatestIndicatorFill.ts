import { ref, watch, type Ref } from 'vue'
import type { Attachment } from '@/shared/types'
import { useIndicatorFills } from './useIndicatorFills'

/**
 * 2026-10-26 用户反馈：指标详情抽屉缺「进度说明」「上报资料」两个展示字段——
 * 这两项随最新一轮上报走（fill.content / fill.attachments），未填报时为空展示「—」。
 * 三页共用的详情抽屉（战略任务/指标列表/指标分发）接同一个 composable，口径一致。
 */
export function useLatestIndicatorFill(indicatorId: Ref<string | number | null | undefined>) {
  const latestFillNote = ref('')
  const latestFillAttachments = ref<Attachment[]>([])

  watch(
    indicatorId,
    async id => {
      latestFillNote.value = ''
      latestFillAttachments.value = []
      if (id === null || id === undefined || id === '') {
        return
      }
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
    },
    { immediate: true }
  )

  return { latestFillNote, latestFillAttachments }
}
