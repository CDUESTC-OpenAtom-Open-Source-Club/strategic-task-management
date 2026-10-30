import { ref } from 'vue'
import { indicatorFillApi, type IndicatorAppraisalContextVO } from '@/features/plan/api/planApi'
import { logger } from '@/shared/lib/utils/logger'

/**
 * 审批链上的审核进度（2026-10-28 用户定案）。
 *
 * 规则：
 * ① 只有「当前审批节点的负责人」可改（由后端 canAppraise 判定）；
 * ② 上级覆盖下级：改了就覆盖当前报告轮次的 appraisal_level，不改则沿用；
 * ③ 后端同时把等级同步到 Alert，列表/看板展示保持一致。
 */
export type IndicatorAppraisalLevel = 'AHEAD' | 'NORMAL' | 'DELAYED' | null

export function useIndicatorAppraisal() {
  const contexts = ref<Record<string, IndicatorAppraisalContextVO>>({})
  const loading = ref(false)
  const savingId = ref<string | null>(null)

  /** 批量加载上下文；ids 变化时重新加载 */
  const load = async (indicatorIds: Array<string | number | null | undefined>) => {
    const ids = Array.from(
      new Set(
        indicatorIds
          .map(id => (id === null || id === undefined ? '' : String(id).trim()))
          .filter(id => /^\d+$/.test(id))
      )
    )
    if (ids.length === 0) {
      contexts.value = {}
      return
    }

    loading.value = true
    try {
      // 后端单次上限 2000：分片请求后合并
      const chunkSize = 2000
      const chunks: string[][] = []
      for (let index = 0; index < ids.length; index += chunkSize) {
        chunks.push(ids.slice(index, index + chunkSize))
      }
      const responses = await Promise.all(
        chunks.map(chunk => indicatorFillApi.getIndicatorAppraisalContexts(chunk))
      )
      const next: Record<string, IndicatorAppraisalContextVO> = {}
      responses.forEach(response => {
        const list = Array.isArray(response?.data) ? response.data : []
        list.forEach(item => {
          next[String(item.indicatorId)] = item
        })
      })
      contexts.value = next
    } catch (error) {
      logger.warn('[useIndicatorAppraisal] 加载鉴定上下文失败:', error)
      contexts.value = {}
    } finally {
      loading.value = false
    }
  }

  const getContext = (
    indicatorId: string | number | null | undefined
  ): IndicatorAppraisalContextVO | null => {
    if (indicatorId === null || indicatorId === undefined) {
      return null
    }
    return contexts.value[String(indicatorId)] ?? null
  }

  const canAppraise = (indicatorId: string | number | null | undefined): boolean =>
    getContext(indicatorId)?.canAppraise === true

  const getLevel = (
    indicatorId: string | number | null | undefined,
    fallback: string | null = null
  ): IndicatorAppraisalLevel => {
    const level = getContext(indicatorId)?.appraisalLevel
    if (level === 'AHEAD' || level === 'NORMAL' || level === 'DELAYED') {
      return level
    }
    const normalizedFallback = String(fallback ?? '')
      .trim()
      .toUpperCase()
    if (
      normalizedFallback === 'AHEAD' ||
      normalizedFallback === 'NORMAL' ||
      normalizedFallback === 'DELAYED'
    ) {
      return normalizedFallback
    }
    return null
  }

  const getLockHint = (indicatorId: string | number | null | undefined): string =>
    getContext(indicatorId)?.lockHint || ''

  /** 保存等级；成功后就地更新上下文 */
  const save = async (
    indicatorId: string | number,
    level: IndicatorAppraisalLevel
  ): Promise<IndicatorAppraisalContextVO | null> => {
    savingId.value = String(indicatorId)
    try {
      const response = await indicatorFillApi.setIndicatorAppraisalLevel(indicatorId, level)
      if (!response?.success) {
        throw new Error(response?.message || '审核进度调整失败')
      }
      const updated = response.data ?? null
      if (updated) {
        contexts.value = {
          ...contexts.value,
          [String(indicatorId)]: updated
        }
      }
      return updated
    } finally {
      savingId.value = null
    }
  }

  return {
    contexts,
    loading,
    savingId,
    load,
    getContext,
    canAppraise,
    getLevel,
    getLockHint,
    save
  }
}
