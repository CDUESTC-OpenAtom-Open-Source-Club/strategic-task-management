import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { shallowMount } from '@vue/test-utils'
import { flushPromises } from '../../setup'

import BusinessImportDialog, {
  resolveCycleDisplayLabel
} from '@/features/import/ui/BusinessImportDialog.vue'
import { useTimeContextStore } from '@/shared/lib/timeContext'

/**
 * 2026-11-12（低⑪·A2 缺陷 D2）：导入对话框「当前周期」显示内部 id「4」而非周期名。
 * 修复后优先显示周期数据源的 cycleName（如「2026年度考核周期」），
 * 无名称回退「{year}年度」，数据缺失才回退 id；id 无效显示「-」。
 */

const mountDialog = (cycleId: number | null) =>
  shallowMount(BusinessImportDialog, {
    props: {
      visible: true,
      type: 'strategic-task' as const,
      targetOrgId: 44,
      targetOrgName: '教务处',
      cycleId
    },
    global: {
      stubs: {
        // 摘要区在 el-dialog 默认槽里：透传槽才能断言渲染出的周期名
        'el-dialog': { template: '<div class="el-dialog-stub"><slot /></div>' }
      }
    }
  })

describe('import/ui/BusinessImportDialog · resolveCycleDisplayLabel（低⑪ 当前周期名称）', () => {
  const cycles = [
    { cycleId: 4, cycleName: '2026年度考核周期', year: 2026 },
    { cycleId: 3, year: 2025 }, // 无名称，靠 year 兜底
    { cycleId: 2 } // 名称与年份都缺，回退 id
  ]

  it('周期数据源有 cycleName → 优先显示名称', () => {
    expect(resolveCycleDisplayLabel(4, cycles, 2026)).toBe('2026年度考核周期')
  })

  it('命中周期但无 cycleName → 回退「{year}年度」', () => {
    expect(resolveCycleDisplayLabel(3, cycles, 2026)).toBe('2025年度')
  })

  it('名称与周期年份都缺 → 用全局兜底年份；再缺才回退 id', () => {
    expect(resolveCycleDisplayLabel(9, cycles, 2026)).toBe('2026年度')
    expect(resolveCycleDisplayLabel(2, cycles, null)).toBe('2')
  })

  it('cycleId 无效（null/0/负数/非数值）→ 显示「-」；字符串数字照常解析', () => {
    expect(resolveCycleDisplayLabel(null, cycles, 2026)).toBe('-')
    expect(resolveCycleDisplayLabel(0, cycles, 2026)).toBe('-')
    expect(resolveCycleDisplayLabel(-1, cycles, 2026)).toBe('-')
    expect(resolveCycleDisplayLabel('abc', cycles, 2026)).toBe('-')
    expect(resolveCycleDisplayLabel('4', cycles, 2026)).toBe('2026年度考核周期')
  })

  it('挂载渲染：对话框「当前周期」显示周期名而非内部 id', async () => {
    setActivePinia(createPinia())
    const timeContext = useTimeContextStore()
    timeContext.cycles = [{ cycleId: 4, cycleName: '2026年度考核周期', year: 2026 }] as never

    const wrapper = mountDialog(4)
    await flushPromises()

    const summaryText = wrapper.find('.business-import-summary').text()
    expect(summaryText).toContain('当前周期')
    expect(summaryText).toContain('2026年度考核周期')
    expect(summaryText).not.toMatch(/当前周期\s*4/)
    wrapper.unmount()
  })

  it('挂载渲染（零回归）：周期数据缺失时回退 id，不显示空白', async () => {
    setActivePinia(createPinia())
    const wrapper = mountDialog(4)
    await flushPromises()

    // 默认 store 无周期数据 → 回退「{currentYear}年度」，仍不是裸 id
    const summaryText = wrapper.find('.business-import-summary').text()
    expect(summaryText).toContain('当前周期')
    expect(summaryText).not.toMatch(/当前周期\s*4/)
    wrapper.unmount()
  })
})
