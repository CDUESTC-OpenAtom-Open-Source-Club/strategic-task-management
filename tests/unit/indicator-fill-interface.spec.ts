import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '../setup'

const getIndicatorFillHistory = vi.fn()
const saveFill = vi.fn()
const submitFill = vi.fn()

vi.mock('@/features/plan/api/planApi', () => ({
  indicatorFillApi: {
    getIndicatorFillHistory,
    saveFill,
    submitFill
  }
}))

vi.mock('element-plus', async () => {
  const actual = await vi.importActual<typeof import('element-plus')>('element-plus')
  return {
    ...actual,
    ElMessage: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn()
    }
  }
})

import { usePlanStore } from '@/features/plan/model/store'
import IndicatorFillHistory from '@/features/plan/ui/IndicatorFillHistory.vue'

const passthroughStub = (name: string, tag = 'div') =>
  defineComponent({
    name,
    setup(_, { slots }) {
      return () => h(tag, slots.default?.())
    }
  })

const historyStubs = {
  ElTimeline: passthroughStub('ElTimeline'),
  ElTimelineItem: passthroughStub('ElTimelineItem'),
  ElTag: passthroughStub('ElTag'),
  ElEmpty: passthroughStub('ElEmpty'),
  ElCard: passthroughStub('ElCard'),
  ElButton: passthroughStub('ElButton', 'button'),
  ElIcon: passthroughStub('ElIcon', 'span'),
  Check: passthroughStub('Check', 'span'),
  Close: passthroughStub('Close', 'span'),
  Clock: passthroughStub('Clock', 'span'),
  Document: passthroughStub('Document', 'span'),
  Picture: passthroughStub('Picture', 'span'),
  Download: passthroughStub('Download', 'span'),
  ElSkeleton: passthroughStub('ElSkeleton')
}

describe('Indicator fill interface flow', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    getIndicatorFillHistory.mockReset()
    saveFill.mockReset()
    submitFill.mockReset()
  })

  it('saves and submits fills through indicatorFillApi', async () => {
    saveFill.mockResolvedValue({
      code: 200,
      data: {
        id: 321,
        indicator_id: 1,
        progress: 80,
        content: '这是一次有效的填报说明内容'
      }
    })
    submitFill.mockResolvedValue({
      code: 200,
      data: {
        id: 321,
        indicator_id: 1,
        progress: 80,
        content: '这是一次有效的填报说明内容',
        status: 'submitted'
      }
    })

    const planStore = usePlanStore()
    const saved = await planStore.saveIndicatorFill({
      indicator_id: 1,
      progress: 80,
      content: '这是一次有效的填报说明内容'
    })
    const submitted = await planStore.submitIndicatorFill(saved.id)

    expect(saveFill).toHaveBeenCalledWith({
      indicator_id: 1,
      progress: 80,
      content: '这是一次有效的填报说明内容'
    })
    expect(submitFill).toHaveBeenCalledWith(321)
    expect(submitted.status).toBe('submitted')
  })

  it('loads history on mount and again after the history panel is remounted for another indicator', async () => {
    getIndicatorFillHistory.mockResolvedValue({
      code: 200,
      data: [
        {
          id: 1,
          indicator_id: 1,
          progress: 50,
          content: '第一次填报记录',
          fill_date: '2026-03-01',
          created_at: '2026-03-01T00:00:00.000Z',
          updated_at: '2026-03-01T00:00:00.000Z'
        }
      ]
    })

    const wrapper = mount(IndicatorFillHistory, {
      props: {
        indicatorId: 1
      },
      global: {
        stubs: historyStubs
      }
    })

    await nextTick()
    await flushPromises()
    expect(getIndicatorFillHistory).toHaveBeenCalledWith(1)

    wrapper.unmount()

    mount(IndicatorFillHistory, {
      props: {
        indicatorId: 2
      },
      global: {
        stubs: historyStubs
      }
    })

    await nextTick()
    await flushPromises()

    expect(getIndicatorFillHistory).toHaveBeenNthCalledWith(2, 2)
  })
})
