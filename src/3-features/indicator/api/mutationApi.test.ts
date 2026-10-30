import { beforeEach, describe, expect, it, vi } from 'vitest'

const { postMock, getMock } = vi.hoisted(() => ({ postMock: vi.fn(), getMock: vi.fn() }))
vi.mock('@/shared/api/client', () => ({
  apiClient: { post: postMock, get: getMock }
}))

import { mutationApi } from './mutationApi'

describe('mutationApi.initiateBatch', () => {
  beforeEach(() => {
    postMock.mockReset()
    postMock.mockResolvedValue({ code: 200, data: ['I-1'], message: 'ok' })
  })

  // 后端 List<Map> 契约：请求体必须是裸数组；包成 {items} 会被 400 拒绝
  it('发送裸数组请求体，而非 {items} 包装', async () => {
    const items = [{ id: 101, weight_percent: 30 }]
    await mutationApi.initiateBatch(items)
    expect(postMock).toHaveBeenCalledTimes(1)
    const [, body] = postMock.mock.calls[0]
    expect(Array.isArray(body)).toBe(true)
    expect(body).toEqual(items)
    expect(body).not.toHaveProperty('items')
    expect(postMock.mock.calls[0][0]).toBe('/indicators/mutations/batch')
  })

  // 任务改名条目：entity_type=TASK + name；与指标字段变更条目可混排在同一批次
  it('任务改名条目携带 entity_type=TASK 与 name，可与指标条目同批提交', async () => {
    const items = [
      { id: 101, indicator_desc: '新指标内容', weight_percent: 40 },
      { id: 3001, entity_type: 'TASK' as const, name: '新任务名' }
    ]
    await mutationApi.initiateBatch(items)
    const [, body] = postMock.mock.calls[0]
    expect(body).toHaveLength(2)
    expect(body[1].entity_type).toBe('TASK')
    expect(body[1].name).toBe('新任务名')
    expect(body[0].entity_type).toBeUndefined()
  })
})

// 2026-10-30 用户定案（异动驳回后重报/取消闭环）
describe('mutationApi.cancelReturned / returnedChains', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
    getMock.mockResolvedValue({ code: 200, data: [], message: 'ok' })
    postMock.mockResolvedValue({ code: 200, data: [88, 89], message: '已取消异动' })
  })

  it('returnedChains 按组织查询退回待重报异动链', async () => {
    await mutationApi.returnedChains(35)
    expect(getMock).toHaveBeenCalledTimes(1)
    expect(getMock.mock.calls[0][0]).toBe('/indicators/mutations/returned')
    expect(getMock.mock.calls[0][1]).toEqual({ params: { orgId: 35 } })
  })

  it('cancelReturned 命中整链终结端点（POST cancel-returned）', async () => {
    const response = await mutationApi.cancelReturned(88)
    expect(postMock).toHaveBeenCalledTimes(1)
    expect(postMock.mock.calls[0][0]).toBe('/indicators/mutations/88/cancel-returned')
    expect(response.data).toEqual([88, 89])
  })

  // 2026-10-30 定案修订（异动撤回=退回填报人活链）：撤回改走异动专属端点，
  // 不再打 /workflows/{id}/cancel（旧端点把 completed_at 置为 now，链被终结）
  it('withdraw 命中退回填报人端点（POST mutations/{id}/withdraw）', async () => {
    postMock.mockResolvedValue({ code: 200, data: [88, 89], message: '已撤回异动' })
    const response = await mutationApi.withdraw(88)
    expect(postMock).toHaveBeenCalledTimes(1)
    expect(postMock.mock.calls[0][0]).toBe('/indicators/mutations/88/withdraw')
    expect(response.data).toEqual([88, 89])
  })
})
