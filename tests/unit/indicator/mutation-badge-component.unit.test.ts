import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '../../setup'

const { historyMock, taskHistoryMock } = vi.hoisted(() => ({
  historyMock: vi.fn(),
  taskHistoryMock: vi.fn()
}))

vi.mock('@/features/indicator/api/mutationApi', () => ({
  mutationApi: {
    history: historyMock,
    taskHistory: taskHistoryMock
  }
}))

import MutationBadgePopover from '@/features/indicator/ui/MutationBadgePopover.vue'
import {
  MUTATION_FIELDS_INDICATOR_NAME,
  MUTATION_FIELDS_REMARK,
  MUTATION_FIELDS_WEIGHT,
  invalidateMutationHistory
} from '@/features/indicator/model/mutationHistory'

// ElPopover 只渲染 reference 插槽（徽标按钮），浮层内容不参与断言
const ElPopoverStub = defineComponent({
  name: 'ElPopover',
  props: { visible: { type: Boolean, default: false } },
  setup(_, { slots }) {
    return () => h('div', { class: 'el-popover-stub' }, slots.reference?.())
  }
})

const historyStub = { ElPopover: ElPopoverStub }

const HISTORY = [
  {
    log_id: 1,
    action: 'UPDATE',
    before_json: null,
    after_json: null,
    changed_fields: { weight_percent: { before: '100.00', after: '60.00' } },
    actor_user_id: 188,
    created_at: '2026-10-30 10:00:00'
  },
  {
    log_id: 2,
    action: 'UPDATE',
    before_json: null,
    after_json: null,
    changed_fields: { indicator_desc: { before: '旧内容', after: '新内容' } },
    actor_user_id: 188,
    created_at: '2026-10-29 10:00:00'
  },
  {
    log_id: 3,
    action: 'UPDATE',
    before_json: null,
    after_json: null,
    changed_fields: { remark: { before: '旧备注', after: '新备注' } },
    actor_user_id: 188,
    created_at: '2026-10-28 10:00:00'
  }
]

describe('MutationBadgePopover 徽标落位与计数', () => {
  beforeEach(() => {
    historyMock.mockReset()
    taskHistoryMock.mockReset()
    historyMock.mockResolvedValue({ data: HISTORY })
    taskHistoryMock.mockResolvedValue({ data: [] })
    invalidateMutationHistory()
  })

  it('权重徽标只显示权重异动次数', async () => {
    const wrapper = mount(MutationBadgePopover, {
      props: { indicatorId: 2042, fields: MUTATION_FIELDS_WEIGHT },
      global: { stubs: historyStub }
    })
    await nextTick()
    await flushPromises()

    const badge = wrapper.find('.mutation-badge__trigger')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('1')
    wrapper.unmount()
  })

  it('核心指标徽标只显示指标内容异动次数', async () => {
    const wrapper = mount(MutationBadgePopover, {
      props: { indicatorId: 2042, fields: MUTATION_FIELDS_INDICATOR_NAME },
      global: { stubs: historyStub }
    })
    await nextTick()
    await flushPromises()

    expect(wrapper.find('.mutation-badge__trigger').text()).toBe('1')
    wrapper.unmount()
  })

  it('备注徽标只显示备注异动次数', async () => {
    const wrapper = mount(MutationBadgePopover, {
      props: { indicatorId: 2042, fields: MUTATION_FIELDS_REMARK },
      global: { stubs: historyStub }
    })
    await nextTick()
    await flushPromises()

    expect(wrapper.find('.mutation-badge__trigger').text()).toBe('1')
    wrapper.unmount()
  })

  it('不传字段时显示全部异动次数', async () => {
    const wrapper = mount(MutationBadgePopover, {
      props: { indicatorId: 2042 },
      global: { stubs: historyStub }
    })
    await nextTick()
    await flushPromises()

    expect(wrapper.find('.mutation-badge__trigger').text()).toBe('3')
    wrapper.unmount()
  })

  it('该字段没有异动时不渲染徽标', async () => {
    historyMock.mockResolvedValue({
      data: [
        {
          log_id: 1,
          action: 'UPDATE',
          before_json: null,
          after_json: null,
          changed_fields: { indicator_desc: { before: 'A', after: 'B' } },
          actor_user_id: 188,
          created_at: '2026-10-30 10:00:00'
        }
      ]
    })
    const wrapper = mount(MutationBadgePopover, {
      props: { indicatorId: 2042, fields: MUTATION_FIELDS_WEIGHT },
      global: { stubs: historyStub }
    })
    await nextTick()
    await flushPromises()

    expect(wrapper.find('.mutation-badge__trigger').exists()).toBe(false)
    wrapper.unmount()
  })

  // 2026-10-30 用户反馈：双击异动徽标会误触发单元格的行内编辑。
  // 徽标落在权重列后，若不拦截双击，双击徽标就会弹出权重编辑框。
  it('双击徽标不向外冒泡（不会触发单元格 dblclick 编辑）', async () => {
    const wrapper = mount(MutationBadgePopover, {
      props: { indicatorId: 2042, fields: MUTATION_FIELDS_WEIGHT },
      global: { stubs: historyStub }
    })
    await nextTick()
    await flushPromises()

    const outerDblClick = vi.fn()
    const host = document.createElement('div')
    host.addEventListener('dblclick', outerDblClick)
    host.appendChild(wrapper.element)
    document.body.appendChild(host)

    await wrapper.find('.mutation-badge__trigger').trigger('dblclick')
    await flushPromises()

    expect(outerDblClick).not.toHaveBeenCalled()

    document.body.removeChild(host)
    wrapper.unmount()
  })

  it('同一指标的多个徽标共享一次历史请求', async () => {
    const first = mount(MutationBadgePopover, {
      props: { indicatorId: 2042, fields: MUTATION_FIELDS_WEIGHT },
      global: { stubs: historyStub }
    })
    const second = mount(MutationBadgePopover, {
      props: { indicatorId: 2042, fields: MUTATION_FIELDS_INDICATOR_NAME },
      global: { stubs: historyStub }
    })
    await nextTick()
    await flushPromises()

    expect(historyMock).toHaveBeenCalledTimes(1)
    first.unmount()
    second.unmount()
  })
})
