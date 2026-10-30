import { reactive, ref } from 'vue'
import { mutationApi, type MutationHistoryItem } from '@/features/indicator/api/mutationApi'

/**
 * 异动历史共享缓存（2026-10-30 用户定案：徽标按被改字段落位）。
 *
 * 同一指标在表格里同时出现在「核心指标 / 权重 / 下发备注」三列，每列各挂一个
 * 徽标。若每个徽标各自请求历史，一行会发三次请求；这里按实体 id 缓存首次结果，
 * 后续徽标直接复用，跨组件共享同一份数据。
 */

/** 后端 audit_log.changed_fields 的键 → 展示名 */
export const MUTATION_FIELD_LABELS: Record<string, string> = {
  indicator_desc: '指标内容',
  weight_percent: '权重',
  name: '战略任务',
  desc: '任务描述',
  remark: '备注',
  __delete__: '删除'
}

/** 异动实体类别：指标 / 战略任务（任务改名同样计入「已更改 N 次」） */
export type MutationHistoryScope = 'indicator' | 'task'

/** 徽标要统计的字段：核心指标内容（含整条删除） */
export const MUTATION_FIELDS_INDICATOR_NAME = ['indicator_desc', '__delete__']
/** 徽标要统计的字段：权重 */
export const MUTATION_FIELDS_WEIGHT = ['weight_percent']
/** 徽标要统计的字段：下发备注 */
export const MUTATION_FIELDS_REMARK = ['remark']
/** 徽标要统计的字段：战略任务名 */
export const MUTATION_FIELDS_TASK_NAME = ['name']

const cache = reactive(new Map<string, MutationHistoryItem[]>())
const pending = new Map<string, Promise<void>>()

/**
 * 缓存修订号：每次失效自增，徽标监听它来重新拉取。
 * 徽标若持有历史快照而不监听它，发起异动后计数会停在旧值。
 */
export const mutationHistoryRevision = ref(0)

function cacheKey(scope: MutationHistoryScope, id: number | string): string {
  return `${scope}:${id}`
}

/**
 * 拉取异动历史并写入共享缓存。
 * 同一实体并发调用只会发一次请求（后到的复用先到的 promise）。
 */
export async function loadMutationHistory(
  scope: MutationHistoryScope,
  id: number | string
): Promise<void> {
  const key = cacheKey(scope, id)
  if (cache.has(key)) {
    return
  }
  const inflight = pending.get(key)
  if (inflight) {
    return inflight
  }

  const request = (async () => {
    try {
      const response =
        scope === 'task' ? await mutationApi.taskHistory(id) : await mutationApi.history(id)
      cache.set(key, response.data ?? [])
    } catch {
      cache.set(key, [])
    } finally {
      pending.delete(key)
    }
  })()

  pending.set(key, request)
  return request
}

/** 读缓存中的异动历史（未加载过时返回空数组） */
export function getMutationHistory(
  scope: MutationHistoryScope,
  id: number | string | null | undefined
): MutationHistoryItem[] {
  if (id === null || id === undefined || id === '') {
    return []
  }
  return cache.get(cacheKey(scope, id)) ?? []
}

/**
 * 让缓存失效，让徽标重新拉取。
 * 发起异动后调用——后端在发起时就写入快照，徽标计数需要跟着变。
 */
export function invalidateMutationHistory(
  scope?: MutationHistoryScope,
  id?: number | string | null
): void {
  if (!scope) {
    cache.clear()
    mutationHistoryRevision.value += 1
    return
  }
  if (id === null || id === undefined) {
    for (const key of [...cache.keys()]) {
      if (key.startsWith(`${scope}:`)) {
        cache.delete(key)
      }
    }
    mutationHistoryRevision.value += 1
    return
  }
  cache.delete(cacheKey(scope, id))
  mutationHistoryRevision.value += 1
}

/**
 * 按字段过滤异动记录：只保留改动了指定字段的条目。
 * `fields` 为空表示不过滤（统计全部异动）。
 */
export function filterMutationHistoryByFields(
  history: MutationHistoryItem[],
  fields?: string[] | null
): MutationHistoryItem[] {
  if (!fields || fields.length === 0) {
    return history
  }
  return history.filter(item => {
    const changed = item.changed_fields
    if (!changed) {
      return false
    }
    return fields.some(field => Object.prototype.hasOwnProperty.call(changed, field))
  })
}

/**
 * 按字段过滤+投影异动记录（2026-10-30 用户反馈：浮层显示了别的列的字段）。
 *
 * filterMutationHistoryByFields 只筛「行」——同一条记录同时改了权重和指标内容时，
 * 权重列圆点的浮层会把「指标内容」的变更一起渲染出来。这里在筛行的基础上再做
 * 「字段」投影：条目的 changed_fields 只保留与 `fields` 的交集。
 *
 * - 返回新对象，不改写入参（历史存在共享缓存里，各列徽标共用，投影不得污染缓存）。
 * - `fields` 为空表示不投影，原样返回（显示全部字段，既有行为）。
 * - `__delete__`（整条删除）等特殊键与普通字段同口径：在 `fields` 里就保留。
 */
export function projectMutationHistoryByFields(
  history: MutationHistoryItem[],
  fields?: string[] | null
): MutationHistoryItem[] {
  if (!fields || fields.length === 0) {
    return history
  }
  const tracked = new Set(fields)
  const projected: MutationHistoryItem[] = []
  for (const item of history) {
    const changed = item.changed_fields
    if (!changed) {
      continue
    }
    const picked: NonNullable<MutationHistoryItem['changed_fields']> = {}
    // 按 changed_fields 自身的键序遍历，保留后端给出的展示顺序
    for (const key of Object.keys(changed)) {
      if (tracked.has(key)) {
        picked[key] = changed[key]
      }
    }
    if (Object.keys(picked).length > 0) {
      projected.push({ ...item, changed_fields: picked })
    }
  }
  return projected
}

/**
 * 按字段统计异动次数（徽标上的数字）。
 * 按行计数（一条记录一次异动），与浮层投影后的条目数天然一致——
 * 投影只会从行里剔除字段、不会把行拆成多条，故两者共用同一实现兜底。
 */
export function countMutationHistoryByFields(
  history: MutationHistoryItem[],
  fields?: string[] | null
): number {
  return projectMutationHistoryByFields(history, fields).length
}
