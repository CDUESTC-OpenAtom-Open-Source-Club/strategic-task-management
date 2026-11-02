/**
 * 年份选择持久化单测（2026-10-31 用户拍板：跨刷新记忆）。
 *
 * 覆盖：
 * - 用户主动选择年份（setYear / switchYear）写入 localStorage（key sism.selectedYear）；
 * - 初始化时读取持久化年份；无记录回退当前年；
 * - 非法存储值（非整数、越界、类型不符、脏数据）一律忽略回退当前年；
 * - resetToCurrentYear 同步清掉存储（语义一致：回当前年即放弃历史选择）；
 * - localStorage 不可用（隐私模式等）静默降级，不影响 store 初始化与切换。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const STORAGE_KEY = 'sism.selectedYear'

async function createStore() {
  const { useTimeContextStore } = await import('@/shared/lib/timeContext')
  setActivePinia(createPinia())
  return useTimeContextStore()
}

describe('timeContext 年份持久化', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('setYear 把用户选择的年份写入 localStorage', async () => {
    const timeContext = await createStore()

    timeContext.setYear(2024)

    expect(timeContext.currentYear).toBe(2024)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('2024')
  })

  it('switchYear（年份选择器入口）同样持久化', async () => {
    const timeContext = await createStore()

    await timeContext.switchYear(2023)

    expect(timeContext.currentYear).toBe(2023)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('2023')
  })

  it('初始化时读取上次选择的年份（跨刷新记忆）', async () => {
    localStorage.setItem(STORAGE_KEY, '2022')

    const timeContext = await createStore()

    expect(timeContext.currentYear).toBe(2022)
  })

  it('无持久化记录时回退当前年', async () => {
    const timeContext = await createStore()

    expect(timeContext.currentYear).toBe(new Date().getFullYear())
  })

  describe('非法存储值回退当前年', () => {
    it.each([
      ['年份越下界', '1999'],
      ['年份越上界', '2101'],
      ['非整数年份', '2024.5'],
      ['类型不符（字符串数字）', '"2030"'],
      ['类型不符（对象）', '{"year":2030}'],
      ['类型不符（布尔）', 'true']
    ])('%s（%s）忽略并回退当前年', async (_name, stored) => {
      localStorage.setItem(STORAGE_KEY, stored)

      const timeContext = await createStore()

      expect(timeContext.currentYear).toBe(new Date().getFullYear())
      expect(timeContext.currentYear).not.toBe(NaN)
    })

    it('脏数据（非法 JSON）忽略并回退当前年', async () => {
      localStorage.setItem(STORAGE_KEY, 'not-json')

      const timeContext = await createStore()

      expect(timeContext.currentYear).toBe(new Date().getFullYear())
    })
  })

  it('resetToCurrentYear 回当前年并清掉持久化记录', async () => {
    localStorage.setItem(STORAGE_KEY, '2021')
    const timeContext = await createStore()
    expect(timeContext.currentYear).toBe(2021)

    timeContext.resetToCurrentYear()

    expect(timeContext.currentYear).toBe(new Date().getFullYear())
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('isReadOnly 随持久化年份自然推导（历史年份 → 只读）', async () => {
    localStorage.setItem(STORAGE_KEY, '2020')

    const timeContext = await createStore()

    expect(timeContext.isReadOnly).toBe(true)
    expect(timeContext.isHistoricalMode).toBe(true)
  })

  describe('localStorage 不可用时静默降级', () => {
    it('读取抛错不阻断初始化，回退当前年', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError: storage disabled')
      })

      const timeContext = await createStore()

      expect(timeContext.currentYear).toBe(new Date().getFullYear())
    })

    it('写入抛错不阻断切换年份', async () => {
      const timeContext = await createStore()
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

      expect(() => timeContext.setYear(2025)).not.toThrow()
      expect(timeContext.currentYear).toBe(2025)
    })
  })
})
