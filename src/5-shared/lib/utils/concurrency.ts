/**
 * 并发受限的批量执行原语（请求风暴治理）
 *
 * 2026-11-27（生产缺陷：看板首屏 500「服务器内部错误」）：
 * - 看板打开时会对「每个唯一父指标 id」各发一次 `GET /api/v1/indicators/{id}`。
 *   生产库迁移后指标从 94 条涨到 561 条（7 学院 × 多归口线），单个学院一次
 *   就要拉 50 个父指标详情；旧的 `Promise.all(ids.map(...))` 没有任何并发上限，
 *   几十个请求同时打向后端 → Hikari 连接池打满
 *   （total=20, active=20, idle=0, waiting=24）
 *   → `SQLTransientConnectionException` → 后端 500 → 前端弹全局错误提示。
 * - 本模块提供「分批 + 批间让出事件循环」的批量执行原语：任一时刻在途请求数
 *   ≤ batchSize，批次之间让出主线程（不饿死渲染/心跳），单条失败不影响其它条目。
 *
 * 语义约定：
 * - 结果按入参顺序返回，条目失败以 `rejected` 呈现，**不会**中断整批。
 * - 回调 `onFulfilled` / `onRejected` 在每条 settle 时立即触发（逐条渐进语义），
 *   调用方据此增量刷新缓存，不必等整批结束。
 */

/** 默认单批并发上限（远小于后端连接池容量，20~32） */
export const DEFAULT_BATCH_SIZE = 6

/**
 * 让出事件循环：把控制权交回主线程，下一轮宏任务再继续。
 * 用 setTimeout(0) 而非微任务——微任务不会让出事件循环，长批量会把渲染饿死。
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0)
  })
}

export interface RunInBatchesOptions<T, R> {
  /** 单批并发上限（默认 {@link DEFAULT_BATCH_SIZE}，至少为 1） */
  batchSize?: number
  /** 批与批之间是否让出事件循环（默认 true） */
  yieldBetweenBatches?: boolean
  /** 单条成功回调（逐条触发） */
  onFulfilled?: (item: T, value: R, index: number) => void
  /** 单条失败回调（逐条触发） */
  onRejected?: (item: T, reason: unknown, index: number) => void
}

/**
 * 分批执行异步任务：每批最多 batchSize 个并发，批与批之间让出事件循环。
 *
 * @param items 待处理条目
 * @param worker 单条处理函数（批内并发执行）
 * @param options 批大小 / 回调 / 是否让出事件循环
 * @returns 按入参顺序排列的 settle 结果（失败条目为 rejected，不中断整批）
 */
export async function runInBatches<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  options: RunInBatchesOptions<T, R> = {}
): Promise<PromiseSettledResult<R>[]> {
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? DEFAULT_BATCH_SIZE))
  const yieldBetweenBatches = options.yieldBetweenBatches !== false
  const results: PromiseSettledResult<R>[] = new Array(items.length)

  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize)
    const settled = await Promise.all(
      batch.map(async (item, offset) => {
        const index = start + offset
        try {
          const value = await worker(item, index)
          options.onFulfilled?.(item, value, index)
          return { status: 'fulfilled', value } as PromiseSettledResult<R>
        } catch (reason) {
          options.onRejected?.(item, reason, index)
          return { status: 'rejected', reason } as PromiseSettledResult<R>
        }
      })
    )
    settled.forEach((entry, offset) => {
      results[start + offset] = entry
    })

    // 批与批之间让出事件循环：避免长批量连续占满微任务队列，饿死渲染与心跳
    if (yieldBetweenBatches && start + batchSize < items.length) {
      await yieldToEventLoop()
    }
  }

  return results
}
