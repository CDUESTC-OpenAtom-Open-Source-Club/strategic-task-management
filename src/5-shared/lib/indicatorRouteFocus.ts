import { nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/**
 * 指标定位深链（2026-11-20 消息中心催办/告警跳转修复）：
 * 催办/告警通知跳转统一落工作台并携带 `?indicatorId=&indicatorName=` 定位参数
 * （消息中心跳转矩阵 buildIndicatorFocusTarget、铃铛 useNotificationCenter 同口径），
 * 本 composable 在常驻壳层 AppLayout 监听该参数，在工作台表格里定位对应指标行：
 * 滚动到视口中央 + 临时高亮，消费完即 router.replace 清参数防重复触发
 * （与 useApprovalRouteAutopen 的深链消费模式一致）。
 *
 * 实现说明：工作台/指标列表的 el-table 未暴露行级 data 属性（3-features/task、
 * 3-features/indicator 由并行任务占用禁止改动），故按行文本匹配 indicatorName
 * 定位，best-effort：定位失败（指标不在当前筛选视图、名称已变更等）静默放弃，
 * 只清参数，不影响落地页正常使用。
 */
const FOCUS_QUERY_KEYS = ['indicatorId', 'indicatorName'] as const

// 两个页面都承载指标行：职能部门/学院工作台 + 指标列表页
const FOCUS_ROUTE_PATHS = new Set(['/strategic-tasks', '/indicators'])

const HIGHLIGHT_CLASS = 'sism-indicator-row-focus'
const HIGHLIGHT_DURATION_MS = 6000
// 工作台首屏数据加载 + 渲染需要时间（实测首帧可达 10s+）：轮询定位最多约 20 秒
const LOCATE_POLL_INTERVAL_MS = 500
const LOCATE_MAX_POLLS = 40

let locateTimer: number | null = null

const cancelPendingLocate = () => {
  if (locateTimer !== null) {
    window.clearTimeout(locateTimer)
    locateTimer = null
  }
}

const normalizeQueryValue = (value: unknown): string => {
  const candidate = Array.isArray(value) ? value[0] : value
  return String(candidate ?? '').trim()
}

export function useIndicatorRouteFocus(): void {
  const route = useRoute()
  const router = useRouter()

  const clearFocusQuery = () => {
    const nextQuery = { ...route.query }
    for (const key of FOCUS_QUERY_KEYS) {
      delete nextQuery[key]
    }
    void router.replace({ query: nextQuery }).catch(() => {})
  }

  const highlightRow = (row: Element) => {
    document
      .querySelectorAll(`.${HIGHLIGHT_CLASS}`)
      .forEach(element => element.classList.remove(HIGHLIGHT_CLASS))
    row.classList.add(HIGHLIGHT_CLASS)
    row.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => row.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_DURATION_MS)
  }

  const locateIndicatorRow = (indicatorName: string, attempt = 0): void => {
    const rows = Array.from(document.querySelectorAll('.el-table__row'))
    const targetRow = indicatorName
      ? rows.find(row => (row.textContent || '').includes(indicatorName))
      : undefined

    if (targetRow) {
      highlightRow(targetRow)
      clearFocusQuery()
      return
    }

    if (attempt >= LOCATE_MAX_POLLS) {
      clearFocusQuery()
      return
    }

    locateTimer = window.setTimeout(() => {
      locateIndicatorRow(indicatorName, attempt + 1)
    }, LOCATE_POLL_INTERVAL_MS)
  }

  watch(
    () => [route.path, route.query.indicatorId, route.query.indicatorName] as const,
    ([path, rawIndicatorId, rawIndicatorName]) => {
      const indicatorId = normalizeQueryValue(rawIndicatorId)
      if (!FOCUS_ROUTE_PATHS.has(path) || !indicatorId) {
        return
      }

      cancelPendingLocate()
      const indicatorName = normalizeQueryValue(rawIndicatorName)
      void nextTick(() => {
        locateIndicatorRow(indicatorName)
      })
    },
    // immediate：整页直开/刷新带定位参数的深链（如钉钉 applink、F5）时
    // query 不会发生变化，没有 immediate 就永远不会触发定位
    { immediate: true }
  )
}
