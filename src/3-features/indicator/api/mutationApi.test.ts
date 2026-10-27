import { beforeEach, describe, expect, it, vi } from 'vitest'

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }))
vi.mock('@/shared/api/client', () => ({
  apiClient: { post: postMock, get: vi.fn() }
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
