import { ref, type Ref } from 'vue'
import { ElMessage } from 'element-plus'
import { indicatorFillApi, type IndicatorAppraisalContextVO } from '@/features/plan/api/planApi'
import { logger } from '@/shared/lib/utils/logger'
import { getAppraisalGateMessage } from '@/features/indicator/lib/appraisalGate'

/**
 * 审批链上的审核进度（2026-10-28 用户定案；2026-10-31 评定门禁定稿；
 * 2026-11-19 用户定案：统一为**行内下拉**，去掉弹窗层）。
 *
 * 规则：
 * ① 三条件全满足才可评定：上报审批期间 + 有评定权限的角色 + 是当前审批节点的评定人；
 *    点击格子先单条重查 context，canAppraise=false 当场提示原因，绝不进入「选择→保存失败」空转；
 * ② 上级覆盖下级：改了就覆盖当前报告轮次的 appraisal_level，不改则沿用；
 * ③ 后端同时把等级同步到 Alert，列表/看板展示保持一致；
 * ④ 交互统一走共享组件 AppraisalLevelCell（行内下拉）：点击解锁 → 选三档 → 选完即存。
 */
export type IndicatorAppraisalLevel = 'AHEAD' | 'NORMAL' | 'DELAYED' | null

/** 非空等级值（「未评定」不是值，只是初始空白显示态） */
export type IndicatorAppraisalLevelValue = Exclude<IndicatorAppraisalLevel, null>

/** 行内下拉保存结果 */
export interface IndicatorAppraisalCommitResult {
  /** true=写库成功；false=失败（error 带失败原因） */
  ok: boolean
  level: IndicatorAppraisalLevelValue
  error?: string
}

/**
 * 共享模型层对外契约（2026-11-19）：三视图（战略任务管理页 / 指标填报页 / 指标分发页）
 * 共用同一套模型 + 同一个行内下拉组件 AppraisalLevelCell，交互完全同构。
 */
export interface IndicatorAppraisalApi {
  contexts: Ref<Record<string, IndicatorAppraisalContextVO>>
  loading: Ref<boolean>
  savingId: Ref<string | null>
  load: (indicatorIds: Array<string | number | null | undefined>) => Promise<void>
  getContext: (
    indicatorId: string | number | null | undefined
  ) => IndicatorAppraisalContextVO | null
  reloadOne: (
    indicatorId: string | number | null | undefined
  ) => Promise<IndicatorAppraisalContextVO | null>
  canAppraise: (indicatorId: string | number | null | undefined) => boolean
  getLevel: (
    indicatorId: string | number | null | undefined,
    fallback?: string | null
  ) => IndicatorAppraisalLevel
  getLockHint: (indicatorId: string | number | null | undefined) => string
  save: (
    indicatorId: string | number,
    level: IndicatorAppraisalLevel
  ) => Promise<IndicatorAppraisalContextVO | null>
  /** 点击格子 → 单条重查 context → 有权评定返回 true（行内下拉解锁）；否则当场提示原因 */
  unlockAppraisal: (indicatorId: string | number | null | undefined) => Promise<boolean>
  /** 行内下拉选完即存：成功 success 提示、失败 error 提示 */
  commitAppraisalLevel: (
    indicatorId: string | number,
    level: IndicatorAppraisalLevelValue
  ) => Promise<IndicatorAppraisalCommitResult>
}

export function useIndicatorAppraisal(): IndicatorAppraisalApi {
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

  /**
   * 单条重查（2026-10-31 定稿）：点击格子时按 id 拉最新 context 并刷新缓存条目。
   * 页面加载时的批量缓存会陈旧（审批推进后 canAppraise 已变化），
   * 点击瞬间的权威判定一律以本次重查结果为准。
   */
  const reloadOne = async (
    indicatorId: string | number | null | undefined
  ): Promise<IndicatorAppraisalContextVO | null> => {
    const key = String(indicatorId ?? '').trim()
    if (!/^\d+$/.test(key)) {
      return null
    }
    try {
      const response = await indicatorFillApi.getIndicatorAppraisalContexts([key])
      const list = Array.isArray(response?.data) ? response.data : []
      const fresh = list.find(item => String(item.indicatorId) === key) ?? null
      if (fresh) {
        contexts.value = { ...contexts.value, [key]: fresh }
      } else {
        // 后端没有该指标的上报记录：清掉缓存条目，避免陈旧 canAppraise 误放行
        const next = { ...contexts.value }
        delete next[key]
        contexts.value = next
      }
      return fresh
    } catch (error) {
      logger.warn('[useIndicatorAppraisal] 重查鉴定上下文失败:', error)
      // 网络失败退回缓存（可能是旧值，但好于完全不可用；写入端仍有 409/403 兜底）
      return contexts.value[key] ?? null
    }
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

  /**
   * 行内解锁（2026-11-19 用户定案：统一行内下拉，去掉弹窗层）：
   * 点击审核进度格子 → ①单条重查该行 context（批量缓存会陈旧）→ ②canAppraise=true 返回 true
   * （行内下拉解锁，由共享组件 AppraisalLevelCell 渲染）→ ③canAppraise=false 当场提示原因
   * （优先后端 lockHint，空缺时按 ①非上报期间/②无角色权限/③非当前环节评定人 兜底）。
   * 「点击后既不下拉也不提示」的路径一律消灭。
   */
  const unlockAppraisal = async (
    indicatorId: string | number | null | undefined
  ): Promise<boolean> => {
    const key = String(indicatorId ?? '').trim()
    if (!/^\d+$/.test(key)) {
      // 2026-10-31 线上 P0 回归：行数据异常（缺 id / 非数字 id）也不允许静默 return——
      // 「点击格子后既不开选择器也不提示」的路径全部消灭，统一给兜底提示。
      ElMessage.warning('未获取到有效指标，无法评定审核进度')
      return false
    }

    // ① 先重查该行 context——批量加载的缓存会陈旧
    const context = await reloadOne(key)

    // ② 门禁：不满足条件当场提示原因，绝不进入选择/保存空转
    if (!context?.canAppraise) {
      ElMessage.info(getAppraisalGateMessage(context ?? { canAppraise: false, lockHint: '' }))
      return false
    }

    return true
  }

  /**
   * 选完即存（2026-11-19 用户定案：行内下拉，无「确认调整」二次确认）：
   * 写入端点保留在途 409 / 权限 403 兜底；成功 success 提示、失败 error 提示并带出原因，
   * 失败时行内下拉保持展开，用户可直接改选其它档位。
   */
  const commitAppraisalLevel = async (
    indicatorId: string | number,
    level: IndicatorAppraisalLevelValue
  ): Promise<IndicatorAppraisalCommitResult> => {
    try {
      await save(indicatorId, level)
      ElMessage.success('审核进度已调整')
      return { ok: true, level }
    } catch (error) {
      const message = error instanceof Error ? error.message : '调整审核进度失败'
      ElMessage.error(message)
      return { ok: false, level, error: message }
    }
  }

  return {
    contexts,
    loading,
    savingId,
    load,
    getContext,
    reloadOne,
    canAppraise,
    getLevel,
    getLockHint,
    save,
    unlockAppraisal,
    commitAppraisalLevel
  }
}
