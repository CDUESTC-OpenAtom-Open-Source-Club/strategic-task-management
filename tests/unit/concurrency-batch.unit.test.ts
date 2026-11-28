/**
 * 回归测试：分批限流原语（runInBatches）
 *
 * 背景（2026-11-27 生产看板 500）：
 * 看板首屏对每个唯一父指标 id 发一次 `GET /indicators/{id}`，旧实现是
 * `Promise.all(ids.map(...))` 无并发上限 → 几十个并发请求打满 Hikari 连接池
 * （total=20, active=20, idle=0, waiting=24）→ 后端 500。
 * 本原语是根治手段：任一时刻在途请求数必须 ≤ batchSize。
 */
import { describe, it, expect, vi } from 'vitest'
import { runInBatches, yieldToEventLoop, DEFAULT_BATCH_SIZE } from '@/shared/lib/utils/concurrency'

/** 记录每条任务的开始/结束时刻，用于统计并发峰值 */
function createConcurrencyTracker() {
  let inFlight = 0
  let peak = 0
  const started: number[] = []
  return {
    get peak() {
      return peak
    },
    started,
    async run<T>(value: T, delayMs = 1): Promise<T> {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      started.push(inFlight)
      await new Promise(resolve => setTimeout(resolve, delayMs))
      inFlight -= 1
      return value
    }
  }
}

describe('runInBatches - 分批限流', () => {
  it('任一时刻在途任务数不超过 batchSize', async () => {
    const tracker = createConcurrencyTracker()
    const items = Array.from({ length: 50 }, (_, index) => index)

    await runInBatches(items, item => tracker.run(item, 1), { batchSize: 6 })

    expect(tracker.peak).toBeLessThanOrEqual(6)
    expect(tracker.peak).toBeGreaterThan(1)
  })

  it('默认 batchSize 为 6（远小于后端连接池容量 20~32）', async () => {
    expect(DEFAULT_BATCH_SIZE).toBe(6)

    const tracker = createConcurrencyTracker()
    await runInBatches(
      Array.from({ length: 30 }, (_, i) => i),
      item => tracker.run(item, 1)
    )
    expect(tracker.peak).toBeLessThanOrEqual(DEFAULT_BATCH_SIZE)
  })

  it('批与批之间让出事件循环（setTimeout 宏任务）', async () => {
    const order: string[] = []
    vi.useFakeTimers()
    try {
      const promise = runInBatches(
        [1, 2, 3, 4],
        async item => {
          order.push(`worker-${item}`)
          return item
        },
        { batchSize: 2, yieldBetweenBatches: true }
      )

      // 第一批立即执行
      await Promise.resolve()
      expect(order).toEqual(['worker-1', 'worker-2'])

      // 批间让出：需要推进定时器才会跑第二批
      await vi.advanceTimersByTimeAsync(0)
      expect(order).toEqual(['worker-1', 'worker-2', 'worker-3', 'worker-4'])

      await promise
    } finally {
      vi.useRealTimers()
    }
  })

  it('单条失败不影响其它条目，失败以 rejected 呈现', async () => {
    const failures: unknown[] = []
    const results = await runInBatches(
      ['a', 'b', 'c'],
      async item => {
        if (item === 'b') {
          throw new Error('boom')
        }
        return item.toUpperCase()
      },
      { batchSize: 2, onRejected: (_item, reason) => failures.push(reason) }
    )

    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: 'A' })
    expect(results[2]).toMatchObject({ status: 'fulfilled', value: 'C' })
    expect(failures).toHaveLength(1)
    expect((failures[0] as Error).message).toBe('boom')
  })

  it('onFulfilled / onRejected 逐条触发（调用方可渐进刷新，不必等整批结束）', async () => {
    const resolved: string[] = []
    const rejected: string[] = []

    await runInBatches(
      ['a', 'b', 'c'],
      async item => {
        if (item === 'c') {
          throw new Error('nope')
        }
        return item
      },
      {
        batchSize: 1,
        onFulfilled: item => resolved.push(item),
        onRejected: item => rejected.push(item)
      }
    )

    expect(resolved).toEqual(['a', 'b'])
    expect(rejected).toEqual(['c'])
  })

  it('结果按入参顺序返回', async () => {
    const results = await runInBatches(
      [30, 10, 20],
      async delay => {
        await new Promise(resolve => setTimeout(resolve, delay))
        return delay
      },
      { batchSize: 3 }
    )

    expect(results.map(r => (r.status === 'fulfilled' ? r.value : null))).toEqual([30, 10, 20])
  })

  it('空数组直接返回空结果', async () => {
    const results = await runInBatches([], async () => 1)
    expect(results).toEqual([])
  })

  it('batchSize 小于 1 时按 1 处理（不并发、不越界）', async () => {
    const tracker = createConcurrencyTracker()
    await runInBatches([1, 2, 3], item => tracker.run(item, 1), { batchSize: 0 })
    expect(tracker.peak).toBe(1)
  })
})

describe('yieldToEventLoop', () => {
  it('返回一个在宏任务里 resolve 的 promise', async () => {
    let resolved = false
    const promise = yieldToEventLoop().then(() => {
      resolved = true
    })
    expect(resolved).toBe(false)
    await promise
    expect(resolved).toBe(true)
  })
})
