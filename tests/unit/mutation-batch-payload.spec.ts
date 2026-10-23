import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiGet, apiPost } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn()
}))

vi.mock('@/shared/api/client', () => ({
  apiClient: {
    get: apiGet,
    post: apiPost
  }
}))

import { mutationApi } from '@/features/indicator/api/mutationApi'

/**
 * 2026-10-21：批量异动端点后端签名是 @RequestBody List<Map<String,Object>>，
 * 前端必须发裸数组；曾发 {items:[...]} 会直接 400。
 */
describe('mutationApi.initiateBatch', () => {
  beforeEach(() => {
    apiGet.mockReset()
    apiPost.mockReset()
    apiPost.mockResolvedValue({ success: true, data: ['501'] })
  })

  it('以裸数组提交，不再包一层 items', async () => {
    const items = [
      { id: 2001, indicator_desc: '新指标内容' },
      { id: 3001, entity_type: 'TASK' as const, name: '新任务名' }
    ]

    await mutationApi.initiateBatch(items)

    expect(apiPost).toHaveBeenCalledWith('/indicators/mutations/batch', items)
    const [, payload] = apiPost.mock.calls[0]
    expect(Array.isArray(payload)).toBe(true)
    expect(payload).toHaveLength(2)
  })

  it('任务改名条目保留 TASK 实体类型与新名称', async () => {
    await mutationApi.initiateBatch([{ id: 3001, entity_type: 'TASK', name: '改名后任务' }])

    const [, payload] = apiPost.mock.calls[0]
    expect(payload[0]).toMatchObject({
      id: 3001,
      entity_type: 'TASK',
      name: '改名后任务'
    })
  })
})
