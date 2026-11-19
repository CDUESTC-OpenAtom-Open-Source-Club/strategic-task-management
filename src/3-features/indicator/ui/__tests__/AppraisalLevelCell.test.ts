/**
 * 审核进度行内下拉单元格交互契约单测（2026-11-19 用户定案）。
 *
 * 契约：
 * ① 点击单元格才解锁下拉——未点击时页面不渲染任何下拉控件；
 * ② 无权评定时不解锁（保持只读），解锁入口以提示告知原因；
 * ③ 不可评定的行显示只读值 + 悬停说明原因（后端 lockHint 优先）；
 * ④ 下拉只有 超前完成 / 正常 / 滞后 三档，「未评定」不是选项（不产生空值）；
 * ⑤ 选完即存（无二次确认弹窗），成功后回显新等级并退回只读态；
 * ⑥ 保存失败保持展开可改选，并回滚到原值。
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ElSelect, ElTooltip } from 'element-plus'
import AppraisalLevelCell from '../AppraisalLevelCell.vue'
import type { IndicatorAppraisalApi } from '@/features/indicator/model/useIndicatorAppraisal'

const flush = async () => {
  await new Promise(resolve => setTimeout(resolve, 0))
}

const buildApi = (overrides: Partial<IndicatorAppraisalApi> = {}) => {
  const api = {
    contexts: { value: {} },
    loading: { value: false },
    savingId: { value: null },
    load: vi.fn(async () => {}),
    getContext: vi.fn(() => null),
    reloadOne: vi.fn(async () => null),
    canAppraise: vi.fn(() => false),
    getLevel: vi.fn(() => null),
    getLockHint: vi.fn(() => ''),
    save: vi.fn(async () => null),
    unlockAppraisal: vi.fn(async () => true),
    commitAppraisalLevel: vi.fn(async (_id: string | number, level: string) => ({
      ok: true,
      level
    })),
    ...overrides
  }
  return api as unknown as IndicatorAppraisalApi & {
    unlockAppraisal: ReturnType<typeof vi.fn>
    commitAppraisalLevel: ReturnType<typeof vi.fn>
  }
}

const mountCell = (props: Record<string, unknown>) =>
  mount(AppraisalLevelCell, {
    props: props as never
  })

describe('AppraisalLevelCell（审核进度行内下拉）', () => {
  it('未点击时不渲染下拉，只显示等级标签', () => {
    const api = buildApi()
    const wrapper = mountCell({
      indicatorId: 101,
      level: 'NORMAL',
      context: { canAppraise: true, lockHint: '' },
      appraisal: api
    })

    expect(wrapper.findComponent(ElSelect).exists()).toBe(false)
    expect(wrapper.text()).toContain('正常')
  })

  it('点击单元格才解锁行内下拉（且下拉只有三档、无「未评定」选项）', async () => {
    const api = buildApi()
    const wrapper = mountCell({
      indicatorId: 101,
      level: 'NORMAL',
      context: { canAppraise: true, lockHint: '' },
      appraisal: api
    })

    await wrapper.find('.appraisal-level-cell__tag').trigger('click')
    await flush()

    expect(api.unlockAppraisal).toHaveBeenCalledWith(101)
    const select = wrapper.findComponent(ElSelect)
    expect(select.exists()).toBe(true)
    const labels = select.findAllComponents({ name: 'ElOption' }).map(option => option.props('label'))
    expect(labels).toEqual(['超前完成', '正常', '滞后'])
    expect(labels).not.toContain('未评定')
  })

  it('无权评定时不解锁下拉（保持只读）', async () => {
    const api = buildApi({ unlockAppraisal: vi.fn(async () => false) })
    const wrapper = mountCell({
      indicatorId: 102,
      level: 'NORMAL',
      context: { canAppraise: false, lockHint: '您不是当前审批环节的评定人，无法评定' },
      appraisal: api
    })

    await wrapper.find('.appraisal-level-cell__tag').trigger('click')
    await flush()

    expect(api.unlockAppraisal).toHaveBeenCalledWith(102)
    expect(wrapper.findComponent(ElSelect).exists()).toBe(false)
  })

  it('不可评定时显示只读值 + 悬停说明原因（后端 lockHint 优先）', () => {
    const api = buildApi()
    const wrapper = mountCell({
      indicatorId: 103,
      level: 'AHEAD',
      context: { canAppraise: false, lockHint: '您不是当前审批环节（分管职能部门负责人审批）的评定人，无法评定' },
      appraisal: api
    })

    expect(wrapper.text()).toContain('超前完成')
    const tooltip = wrapper.findComponent(ElTooltip)
    expect(tooltip.exists()).toBe(true)
    expect(tooltip.props('content')).toBe(
      '您不是当前审批环节（分管职能部门负责人审批）的评定人，无法评定'
    )
    expect(tooltip.props('disabled')).toBe(false)
  })

  it('有权评定时不挂悬停原因提示', () => {
    const api = buildApi()
    const wrapper = mountCell({
      indicatorId: 104,
      level: 'NORMAL',
      context: { canAppraise: true, lockHint: '' },
      appraisal: api
    })

    const tooltip = wrapper.findComponent(ElTooltip)
    expect(tooltip.props('disabled')).toBe(true)
  })

  it('选完即存：写入成功后回显新等级并退回只读态', async () => {
    const api = buildApi({
      commitAppraisalLevel: vi.fn(async () => ({ ok: true, level: 'NORMAL' as const }))
    })
    const wrapper = mountCell({
      indicatorId: 105,
      level: 'AHEAD',
      context: { canAppraise: true, lockHint: '' },
      appraisal: api
    })

    await wrapper.find('.appraisal-level-cell__tag').trigger('click')
    await flush()
    expect(wrapper.findComponent(ElSelect).exists()).toBe(true)

    await wrapper.findComponent(ElSelect).vm.$emit('change', 'NORMAL')
    await flush()

    expect(api.commitAppraisalLevel).toHaveBeenCalledWith(105, 'NORMAL')
    expect(wrapper.emitted('saved')).toBeTruthy()
    expect(wrapper.emitted('saved')?.[0]).toEqual(['NORMAL'])
    // 保存成功后收起下拉，回到只读标签
    expect(wrapper.findComponent(ElSelect).exists()).toBe(false)
  })

  it('保存失败时保持下拉展开（可改选），并回滚到原值', async () => {
    const api = buildApi({
      commitAppraisalLevel: vi.fn(async () => ({
        ok: false,
        level: 'NORMAL' as const,
        error: '该指标当前不可评定'
      }))
    })
    const wrapper = mountCell({
      indicatorId: 106,
      level: 'AHEAD',
      context: { canAppraise: true, lockHint: '' },
      appraisal: api
    })

    await wrapper.find('.appraisal-level-cell__tag').trigger('click')
    await flush()

    await wrapper.findComponent(ElSelect).vm.$emit('change', 'NORMAL')
    await flush()

    expect(api.commitAppraisalLevel).toHaveBeenCalledWith(106, 'NORMAL')
    expect(wrapper.emitted('saved')).toBeFalsy()
    expect(wrapper.findComponent(ElSelect).exists()).toBe(true)
  })

  it('空值不会写库（不产生空等级）', async () => {
    const api = buildApi()
    const wrapper = mountCell({
      indicatorId: 107,
      level: null,
      context: { canAppraise: true, lockHint: '' },
      appraisal: api
    })

    await wrapper.find('.appraisal-level-cell__tag').trigger('click')
    await flush()

    await wrapper.findComponent(ElSelect).vm.$emit('change', '')
    await flush()

    expect(api.commitAppraisalLevel).not.toHaveBeenCalled()
  })

  it('未评定（空值）显示为「未评定」只读态', () => {
    const api = buildApi()
    const wrapper = mountCell({
      indicatorId: 108,
      level: null,
      context: { canAppraise: false, lockHint: '该指标尚未发起上报，暂不能评定审核进度' },
      appraisal: api
    })

    expect(wrapper.text()).toContain('未评定')
  })
})
