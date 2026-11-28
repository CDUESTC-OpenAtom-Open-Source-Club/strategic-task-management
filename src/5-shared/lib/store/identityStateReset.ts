/**
 * 身份级状态重置（Pinia 插件）
 *
 * 切换身份 = 换 token 到另一个系统账号，页面数据必须整体按新账号重新加载。
 * 但各 store 普遍带「已加载就不再请求」的短路（planStore.plans.length、
 * strategicStore.indicators、orgStore.loaded……），只清查询缓存不够：
 * 上个账号的数据会留在 store 里，被新身份直接渲染出来。
 *
 * 做法：store 创建时记下每个状态字段初始值的「等价新实例」构造方式，
 * resetIdentityScopedStores() 时把状态还原。对 setup store 逐字段处理，
 * 各 store 不需要各自再写 reset。
 *
 * 为什么不用现成手段：
 * - Pinia 的 $reset 对 setup store 不可用（会直接抛错）；
 * - $dispose 后重建会从 pinia.state 把旧状态水合回新实例，等于没重置。
 *
 * 插件必须在任何 store 创建之前注册（见 1-app/app-main.ts）。
 * 注册之前已创建的 store 不会进入登记表，也就不会被重置。
 */

import { isRef, isReactive, toRaw } from 'vue'
import type { PiniaPlugin } from 'pinia'

type Recreater = () => unknown

/** storeId → 还原该 store 全部状态字段的方法 */
const storeResetters = new Map<string, () => void>()

function isPlainRecord(value: unknown): boolean {
  return Object.prototype.toString.call(value) === '[object Object]'
}

/**
 * 为初始值生成「等价新实例」的构造器。
 * 数组 / 普通对象 / Set / Map / Date 复制成新实例；其余（原始值、Promise、函数、类实例）按原值返回。
 */
function createRecreater(value: unknown): Recreater {
  const raw = toRaw(value)

  if (Array.isArray(raw)) {
    const itemRecreaters = raw.map(createRecreater)
    return () => itemRecreaters.map(recreate => recreate())
  }

  if (raw instanceof Set) {
    const itemRecreaters = [...raw].map(createRecreater)
    return () => new Set(itemRecreaters.map(recreate => recreate()))
  }

  if (raw instanceof Map) {
    const entryRecreaters = [...raw].map(
      ([mapKey, mapValue]) => [createRecreater(mapKey), createRecreater(mapValue)] as const
    )
    return () =>
      new Map(
        entryRecreaters.map(([recreateKey, recreateValue]) => [recreateKey(), recreateValue()])
      )
  }

  if (raw instanceof Date) {
    const time = raw.getTime()
    return () => new Date(time)
  }

  if (isPlainRecord(raw)) {
    const source = raw as Record<string, unknown>
    const entryRecreaters = Object.keys(source).map(
      key => [key, createRecreater(source[key])] as const
    )
    return () =>
      Object.fromEntries(entryRecreaters.map(([key, recreate]) => [key, recreate()])) as Record<
        string,
        unknown
      >
  }

  return () => raw
}

function createStoreResetter(stateKeys: string[], piniaState: Record<string, unknown>): () => void {
  const rawState = toRaw(piniaState) as Record<string, unknown>

  const fieldResetters = stateKeys.map(key => {
    const rawContainer = rawState[key]

    if (isRef(rawContainer)) {
      const recreate = createRecreater(rawContainer.value)
      return () => {
        rawContainer.value = recreate()
      }
    }

    // reactive 字段：pinia 存进 state 前会把响应式对象 toRaw，直接看 rawState 认不出
    // reactive，需要读一遍 state 代理（嵌套对象在这里才会以 reactive proxy 形态出现）。
    // reactive 对象不能整体替换：store 内部闭包持有的是同一个对象，只能就地清空再回填；
    // 且必须通过代理删除 / 回填，绕过代理直接改 raw 不会触发依赖更新。
    const reactiveContainer = isReactive(rawContainer) ? rawContainer : piniaState[key]
    if (isReactive(reactiveContainer)) {
      const source = toRaw(reactiveContainer) as Record<string, unknown>
      const entryRecreaters = Object.keys(source).map(
        name => [name, createRecreater(source[name])] as const
      )
      return () => {
        Object.keys(source).forEach(name => {
          delete (reactiveContainer as Record<string, unknown>)[name]
        })
        entryRecreaters.forEach(([name, recreate]) => {
          ;(reactiveContainer as Record<string, unknown>)[name] = recreate()
        })
      }
    }

    const recreate = createRecreater(rawContainer)
    return () => {
      piniaState[key] = recreate()
    }
  })

  return () => {
    fieldResetters.forEach(reset => reset())
  }
}

/**
 * 记录各 store 的初始状态，供 resetIdentityScopedStores 还原。
 */
export const identityStateResetPlugin: PiniaPlugin = context => {
  const { pinia, store } = context
  const storeState = pinia.state.value[store.$id]
  if (!storeState) {
    return
  }

  storeResetters.set(store.$id, createStoreResetter(Object.keys(store.$state), storeState))
}

/**
 * 把已登记的 store 状态还原到初始值，返回被重置的 store id。
 *
 * @param options.keep 不参与重置的 store（如认证状态本身、跨身份通用的用户偏好）
 */
export function resetIdentityScopedStores(options: { keep?: readonly string[] } = {}): string[] {
  const keep = new Set(options.keep ?? [])
  const resetStoreIds: string[] = []

  storeResetters.forEach((reset, storeId) => {
    if (keep.has(storeId)) {
      return
    }
    reset()
    resetStoreIds.push(storeId)
  })

  return resetStoreIds
}

/** 仅供测试：清空登记表，避免用例之间串状态 */
export function resetIdentityStateResetRegistryForTests(): void {
  storeResetters.clear()
}
