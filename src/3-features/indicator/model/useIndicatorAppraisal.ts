import { defineComponent, h, ref } from 'vue'
import { ElMessage, ElMessageBox, ElOption, ElSelect } from 'element-plus'
import { indicatorFillApi, type IndicatorAppraisalContextVO } from '@/features/plan/api/planApi'
import { logger } from '@/shared/lib/utils/logger'
import {
  APPRAISAL_LEVEL_OPTIONS,
  getAppraisalGateMessage,
  type AppraisalGateContextLike
} from '@/features/indicator/lib/appraisalGate'

/**
 * 审批链上的审核进度（2026-10-28 用户定案；2026-10-31 评定门禁定稿）。
 *
 * 规则：
 * ① 三条件全满足才可评定：上报审批期间 + 有评定权限的角色 + 是当前审批节点的评定人；
 *    点击格子先单条重查 context，canAppraise=false 当场弹原因，绝不进入「选择→保存失败」空转；
 * ② 上级覆盖下级：改了就覆盖当前报告轮次的 appraisal_level，不改则沿用；
 * ③ 后端同时把等级同步到 Alert，列表/看板展示保持一致。
 */
export type IndicatorAppraisalLevel = 'AHEAD' | 'NORMAL' | 'DELAYED' | null

export interface AppraisalLevelPickerResult {
  /** true=用户点了「确认调整」；false=取消/关闭 */
  confirmed: boolean
  level: IndicatorAppraisalLevel
}

/**
 * 轻量等级选择器（2026-10-31 定稿）：替代三视图各自的行内 dropdown——
 * 点击格子 → 门禁通过后统一弹出本选择器（三视图同构）。
 * 只有三档等级可选；「未评定」是初始空白显示态，不是选项。
 */
export async function openAppraisalLevelPicker(options: {
  indicatorName?: string | null
  currentLevel?: IndicatorAppraisalLevel
}): Promise<AppraisalLevelPickerResult> {
  const initialLevel = options.currentLevel ?? null
  const indicatorName = String(options.indicatorName || '').trim() || '该指标'

  // 选中值放在组件外的 ref 上：defineComponent 的渲染函数读取它，
  // ElMessageBox 挂载的内容保持响应式（h(ElSelect, { modelValue: ref.value }) 捕获值的方式不更新）。
  const selected = ref<IndicatorAppraisalLevel>(initialLevel)

  const AppraisalLevelPickerContent = defineComponent({
    name: 'AppraisalLevelPickerContent',
    setup() {
      return () =>
        h('div', { class: 'appraisal-level-picker' }, [
          h(
            'p',
            { style: 'margin: 0 0 12px; line-height: 1.6; color: #606266;' },
            `请选择「${indicatorName}」的审核进度等级（调整后立即生效并同步看板）：`
          ),
          h(
            ElSelect,
            {
              modelValue: selected.value,
              'onUpdate:modelValue': (value: unknown) => {
                selected.value =
                  typeof value === 'string' && value !== ''
                    ? (value as Exclude<IndicatorAppraisalLevel, null>)
                    : null
              },
              placeholder: '请选择审核进度等级',
              style: 'width: 100%'
            },
            () =>
              APPRAISAL_LEVEL_OPTIONS.map(option =>
                h(ElOption, {
                  key: option.value,
                  value: option.value,
                  label: option.label
                })
              )
          )
        ])
    }
  })

  try {
    await ElMessageBox({
      title: '调整审核进度',
      message: h(AppraisalLevelPickerContent),
      confirmButtonText: '确认调整',
      cancelButtonText: '取消',
      showCancelButton: true,
      type: 'warning',
      beforeClose: (action, _instance, done) => {
        // 未选择等级时不允许空确认——「未评定」不是选项，不允许借空值绕过
        if (action === 'confirm' && !selected.value) {
          ElMessage.warning('请先选择审核进度等级')
          return
        }
        done()
      }
    })
    return { confirmed: true, level: selected.value }
  } catch {
    return { confirmed: false, level: initialLevel }
  }
}

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
   * 统一评定入口（2026-10-31 定稿，三视图同构）：
   * 点击审核进度格子 → ①单条重查该行 context → ②canAppraise=false 当场弹原因
   * （优先后端 lockHint，空缺时按 ①非上报期间/②无角色权限/③非当前环节评定人 兜底）→
   * ③canAppraise=true 才弹轻量等级选择器 → ④确认后保存（写入端 409/403 兜底保留）。
   */
  const openAppraisalGate = async (
    indicatorId: string | number | null | undefined,
    options: {
      indicatorName?: string | null
      /** 保存成功后的视图侧同步（如 strategicStore.patchIndicator） */
      onSaved?: (level: Exclude<IndicatorAppraisalLevel, null>) => void
    } = {}
  ): Promise<void> => {
    const key = String(indicatorId ?? '').trim()
    if (!/^\d+$/.test(key)) {
      return
    }

    // ① 先重查该行 context——批量加载的缓存会陈旧
    const context = await reloadOne(key)

    // ② 门禁：不满足条件当场弹原因，绝不进入选择/保存空转
    const gateContext: AppraisalGateContextLike = context ?? { canAppraise: false, lockHint: '' }
    if (!context?.canAppraise) {
      ElMessage.info(getAppraisalGateMessage(gateContext))
      return
    }

    // ③ 轻量等级选择（替代直接开 dropdown）
    const currentLevel = getLevel(key)
    const picked = await openAppraisalLevelPicker({
      indicatorName: options.indicatorName,
      currentLevel
    })
    if (!picked.confirmed || picked.level === null) {
      return
    }
    if (picked.level === currentLevel) {
      return
    }

    // ④ 保存：写入端点保留在途 409 / 权限 403 兜底
    try {
      await save(key, picked.level)
      options.onSaved?.(picked.level)
      ElMessage.success('审核进度已调整')
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : '调整审核进度失败')
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
    openAppraisalGate
  }
}
