/**
 * 回归测试：审批进度抽屉（useApprovalProgressDrawer）在 setup 阶段不得抛 TDZ。
 *
 * 背景（2026-10-29 生产缺陷）：
 * useApprovalProgressDrawer 里 `planApprovalTodoCards`（computed）读取
 * `showPlanPendingCard.value`，而 `showPlanPendingCard` 的 const 声明出现在
 * 文件更靠后的位置；同时 `reportTodoDetailMap` 上挂了一个
 * `watch(..., { immediate: true })`，immediate 会在 setup 期强制求值
 * `planApprovalTodoCards`，从而在 `showPlanPendingCard` 仍处于暂时性死区
 * (TDZ) 时读取它 → ReferenceError: Cannot access 'showPlanPendingCard'
 * before initialization。
 *
 * 该错误会让 8 个页面在挂载抽屉组件时直接报错（"点了没反应"的根因之一）。
 *
 * 本用例通过真实调用组合式函数（而非只测工具函数）复现 setup 阶段的崩溃。
 */
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const routerStub = {
  push: vi.fn(),
  replace: vi.fn(),
  currentRoute: { value: { path: '/', query: {}, params: {} } }
}

vi.mock('vue-router', () => ({
  useRouter: () => routerStub,
  useRoute: () => routerStub.currentRoute.value
}))

// 避免抽屉在 setup 期触发真实网络请求
vi.mock('@/shared/api', () => ({
  apiClient: {
    get: vi.fn(async () => ({ data: { success: true, data: null } })),
    post: vi.fn(async () => ({ data: { success: true, data: null } })),
    getAxiosInstance: () => ({ get: vi.fn(async () => ({ data: new Blob([]) })) })
  }
}))

vi.mock('@/features/workflow/api/queries', () => ({
  getMyPendingTasks: vi.fn(async () => ({ success: true, data: [] })),
  getWorkflowInstanceDetail: vi.fn(async () => null),
  getWorkflowInstanceDetailByBusiness: vi.fn(async () => null),
  getWorkflowInstanceHistoryByBusiness: vi.fn(async () => []),
  getWorkflowDefinitionPreviewByCode: vi.fn(async () => null)
}))

vi.mock('@/features/task/api/strategicApi', () => ({
  approvalApi: {
    getPendingApprovals: vi.fn(async () => ({ success: true, data: [] })),
    approvePlan: vi.fn(async () => ({ success: true })),
    rejectPlan: vi.fn(async () => ({ success: true }))
  }
}))

// 时间上下文 store 会在创建时拉年份列表，离线单测里直接打桩
vi.mock('@/shared/lib/timeContext', () => ({
  useTimeContextStore: () => ({
    currentYear: 2026,
    isReadOnly: false,
    cycles: []
  })
}))

import { useApprovalProgressDrawer } from '@/3-features/approval/model/useApprovalProgressDrawer'

interface DrawerApi {
  planApprovalTodoCards: { value: unknown[] }
  reportTodoDetailCards: { value: unknown[] }
}

const Harness = defineComponent({
  props: {
    modelValue: { type: Boolean, default: false },
    showPlanApprovals: { type: Boolean, default: false },
    workflowEntityId: { type: Number, default: undefined }
  },
  setup(props, { emit }) {
    const drawer = useApprovalProgressDrawer(props as never, emit as never)
    harnessApi = drawer as unknown as DrawerApi
    return () => h('div')
  }
})

let harnessApi: DrawerApi = {
  planApprovalTodoCards: { value: [] },
  reportTodoDetailCards: { value: [] }
}

describe('useApprovalProgressDrawer - setup 阶段无 TDZ', () => {
  it('挂载时不抛 ReferenceError（showPlanPendingCard 不得先于使用被读取）', () => {
    setActivePinia(createPinia())

    // setup 阶段若命中 TDZ，mount 会直接把 ReferenceError 抛出来
    const wrapper = mount(Harness, {
      props: { modelValue: false, showPlanApprovals: true }
    })

    expect(wrapper.exists()).toBe(true)
    // 相关计算属性可正常读取（TDZ 修复后求值不再报错）
    expect(() => harnessApi.planApprovalTodoCards.value).not.toThrow()
    expect(() => harnessApi.reportTodoDetailCards.value).not.toThrow()

    wrapper.unmount()
  })

  it('带实体上下文挂载时同样不抛错', () => {
    setActivePinia(createPinia())

    const wrapper = mount(Harness, {
      props: { modelValue: true, showPlanApprovals: true, workflowEntityId: 42 }
    })

    expect(wrapper.exists()).toBe(true)
    expect(() => harnessApi.planApprovalTodoCards.value).not.toThrow()

    wrapper.unmount()
  })
})
