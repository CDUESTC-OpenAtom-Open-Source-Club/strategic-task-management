/**
 * 回归测试：看板/填报页父指标归口批量水合
 *
 * 背景（2026-11-27 生产缺陷：计算机学院填报人打开「数据看板」顶部弹红色
 * 「服务器内部错误，请稍后重试或联系管理员」）：
 * - 看板对「每个唯一父指标 id」各发一次 `GET /api/v1/indicators/{id}`，
 *   旧实现 `Promise.all(ids.map(...))` 无并发上限；生产指标 94 → 561 后，
 *   单个学院一次要拉 50 个父指标详情 → 几十个并发 SQL 打满 Hikari 连接池
 *   （total=20, active=20, idle=0, waiting=24）→ 后端 500 → 前端全局拦截器弹错误。
 * - 本测试锁定三条行为：
 *   ① 批量水合的并发请求数受上限约束；
 *   ② 单条失败只降级跳过，不影响其它父指标（业务语义不变）；
 *   ③ 单条详情请求标记为静默——失败不触发全局错误提示（真实 500 仍照常提示）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getIndicatorById } = vi.hoisted(() => ({
  getIndicatorById: vi.fn()
}))

vi.mock('@/features/indicator/api', () => ({
  indicatorApi: { getIndicatorById }
}))

import {
  fetchParentIndicatorCores,
  fetchParentIndicatorCore,
  PARENT_INDICATOR_FETCH_CONCURRENCY
} from '@/features/indicator/model/parentIndicatorCore'

function makeResponse(indicatorName: string, targetOrgName: string) {
  return {
    success: true,
    code: 200,
    message: 'ok',
    data: {
      indicatorName,
      indicatorType: '定量',
      sortOrder: 1,
      targetOrgId: 12,
      targetOrgName
    }
  }
}

describe('父指标归口批量水合 - 并发限流（生产看板 500 根治）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('并发上限默认 6（远小于后端连接池容量 20~32）', () => {
    expect(PARENT_INDICATOR_FETCH_CONCURRENCY).toBe(6)
  })

  it('批量拉取时任一时刻在途请求数不超过上限', async () => {
    let inFlight = 0
    let peak = 0

    getIndicatorById.mockImplementation(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setTimeout(resolve, 1))
      inFlight -= 1
      return makeResponse('父指标', '财务处')
    })

    const pids = Array.from({ length: 50 }, (_, index) => String(index + 1))
    const resolved = await fetchParentIndicatorCores(pids)

    expect(peak).toBeLessThanOrEqual(PARENT_INDICATOR_FETCH_CONCURRENCY)
    expect(peak).toBeGreaterThan(1)
    expect(resolved.size).toBe(50)
    expect(getIndicatorById).toHaveBeenCalledTimes(50)
  })

  it('并发上限可通过参数收紧', async () => {
    let inFlight = 0
    let peak = 0

    getIndicatorById.mockImplementation(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setTimeout(resolve, 1))
      inFlight -= 1
      return makeResponse('父指标', '财务处')
    })

    await fetchParentIndicatorCores(
      Array.from({ length: 20 }, (_, i) => String(i + 1)),
      {
        concurrency: 2
      }
    )

    expect(peak).toBeLessThanOrEqual(2)
  })

  it('单条失败只降级跳过，其它父指标照常拿全（业务语义不变）', async () => {
    getIndicatorById.mockImplementation(async (pid: string) => {
      if (pid === '2') {
        throw new Error('SQLTransientConnectionException: Connection is not available')
      }
      return makeResponse(`父指标-${pid}`, '财务处')
    })

    const errors: Array<{ pid: string; error: unknown }> = []
    const resolved = await fetchParentIndicatorCores(['1', '2', '3'], {
      onError: (pid, error) => errors.push({ pid, error })
    })

    expect(resolved.size).toBe(2)
    expect(resolved.has('1')).toBe(true)
    expect(resolved.has('2')).toBe(false)
    expect(resolved.has('3')).toBe(true)
    expect(errors).toHaveLength(1)
    expect(errors[0].pid).toBe('2')
  })

  it('后端返回空体时视为解析不出，不并入缓存也不报错', async () => {
    getIndicatorById.mockResolvedValue({ success: true, code: 200, message: 'ok', data: null })

    const onResolved = vi.fn()
    const onError = vi.fn()
    const resolved = await fetchParentIndicatorCores(['1'], { onResolved, onError })

    expect(resolved.size).toBe(0)
    expect(onResolved).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('重复 id 只请求一次', async () => {
    getIndicatorById.mockResolvedValue(makeResponse('父指标', '财务处'))

    const resolved = await fetchParentIndicatorCores(['7', '7', ' 7 ', '', '8'])

    expect(getIndicatorById).toHaveBeenCalledTimes(2)
    expect(resolved.size).toBe(2)
  })

  it('逐条回调：成功即合并（保持与旧实现一致的渐进刷新语义）', async () => {
    getIndicatorById.mockImplementation(async (pid: string) =>
      makeResponse(`父指标-${pid}`, '财务处')
    )

    const merged: Array<[string, string | undefined]> = []
    await fetchParentIndicatorCores(['1', '2'], {
      onResolved: (pid, core) => merged.push([pid, core.targetOrgName])
    })

    expect(merged).toEqual([
      ['1', '财务处'],
      ['2', '财务处']
    ])
  })

  it('父指标详情请求标记为静默：失败不触发全局错误提示', async () => {
    getIndicatorById.mockResolvedValue(makeResponse('父指标', '财务处'))

    await fetchParentIndicatorCore('9')

    expect(getIndicatorById).toHaveBeenCalledWith('9', { silentErrorToast: true })
  })

  it('显式关闭静默时透传 false（用于确实需要用户可见提示的调用方）', async () => {
    getIndicatorById.mockResolvedValue(makeResponse('父指标', '财务处'))

    await fetchParentIndicatorCore('9', { silentErrorToast: false })

    expect(getIndicatorById).toHaveBeenCalledWith('9', { silentErrorToast: false })
  })
})
