> **[历史标注 2026-10-26]** 2026-05 架构重构期产物。文中 .kiro 引用已失效。

# Shared UI Components

共享 UI 组件库，遵循 FSD (Feature-Sliced Design) 架构规范。

## 目录结构

```
shared/ui/
├── form/           # 表单组件
├── table/          # 表格组件
│   └── DataTable.vue
├── feedback/       # 反馈组件
│   └── ConfirmDialog.vue
├── display/        # 展示组件
│   └── StatusBadge.vue
├── layout/         # 布局组件
│   └── PageHeader.vue
└── index.ts        # 统一导出
```

## 已迁移组件

### 1. DataTable (表格组件)

**位置**: `shared/ui/table/DataTable.vue`

**功能**:

- 统一的表格样式
- 支持分页、排序、筛选
- 支持加载状态和空状态
- 支持自定义列和插槽

**使用示例**:

```vue
<script setup lang="ts">
import { DataTable } from '@/shared/ui'
import type { TableColumn } from '@/shared/ui'

const columns: TableColumn[] = [
  { prop: 'name', label: '名称', sortable: true },
  { prop: 'status', label: '状态', slot: 'status' }
]

const data = ref([])
</script>

<template>
  <DataTable
    :data="data"
    :columns="columns"
    :loading="loading"
    :pagination="{ page: 1, pageSize: 10, total: 100 }"
  >
    <template #status="{ row }">
      <StatusBadge :text="row.status" type="success" />
    </template>
  </DataTable>
</template>
```

### 2. StatusBadge (状态徽章)

**位置**: `shared/ui/display/StatusBadge.vue`

**功能**:

- 显示状态标签
- 支持多种状态类型 (success, info, warning, danger, primary, default)
- 支持不同尺寸 (small, default, large)
- 支持自定义颜色
- 支持圆点样式

**使用示例**:

```vue
<script setup lang="ts">
import { StatusBadge } from '@/shared/ui'
</script>

<template>
  <!-- 基础用法 -->
  <StatusBadge text="已完成" type="success" />

  <!-- 带圆点 -->
  <StatusBadge text="进行中" type="primary" dot />

  <!-- 自定义颜色 -->
  <StatusBadge text="自定义" color="#ff6b6b" />

  <!-- 不同尺寸 -->
  <StatusBadge text="小号" size="small" />
  <StatusBadge text="默认" size="default" />
  <StatusBadge text="大号" size="large" />
</template>
```

### 3. ConfirmDialog (确认对话框)

**位置**: `shared/ui/feedback/ConfirmDialog.vue`

**功能**:

- 统一的确认对话框
- 支持异步操作
- 提供预设的删除、提交、审批确认
- 支持输入验证

**使用示例**:

```vue
<script setup lang="ts">
import { showConfirm, showDeleteConfirm, useConfirmDialog } from '@/shared/ui'

// 方式1: 直接使用函数
async function handleDelete() {
  try {
    await showDeleteConfirm('指标A')
    // 执行删除操作
    await deleteIndicator()
  } catch {
    // 用户取消
  }
}

// 方式2: 使用组合式函数
const { confirmDelete, confirmSubmit } = useConfirmDialog()

async function handleSubmit() {
  try {
    await confirmSubmit('确定要提交此表单吗？')
    // 执行提交操作
  } catch {
    // 用户取消
  }
}

// 自定义确认对话框
async function handleCustom() {
  try {
    await showConfirm({
      title: '确认操作',
      message: '这是一个自定义的确认对话框',
      type: 'warning',
      confirmButtonText: '确定',
      confirmButtonType: 'danger'
    })
  } catch {
    // 用户取消
  }
}
</script>
```

### 4. PageHeader (页面头部)

**位置**: `shared/ui/layout/PageHeader.vue`

**功能**:

- 显示页面标题和描述
- 提供面包屑导航
- 提供操作按钮区域
- 支持返回按钮

**使用示例**:

```vue
<script setup lang="ts">
import { PageHeader } from '@/shared/ui'
import type { BreadcrumbItem } from '@/shared/ui'

const breadcrumb: BreadcrumbItem[] = [
  { title: '首页', path: '/' },
  { title: '指标管理', path: '/indicators' },
  { title: '指标详情', disabled: true }
]
</script>

<template>
  <PageHeader title="指标详情" description="查看和编辑指标信息" :breadcrumb="breadcrumb" show-back>
    <!-- 标题旁的额外内容 -->
    <template #extra>
      <StatusBadge text="已发布" type="success" />
    </template>

    <!-- 操作按钮 -->
    <template #actions>
      <el-button type="primary">编辑</el-button>
      <el-button>删除</el-button>
    </template>

    <!-- 底部扩展区域 -->
    <template #footer>
      <el-tabs v-model="activeTab">
        <el-tab-pane label="基本信息" name="basic" />
        <el-tab-pane label="进度记录" name="progress" />
      </el-tabs>
    </template>
  </PageHeader>
</template>
```

## 导入方式

### 推荐方式 (从 shared/ui 导入)

```typescript
// 导入组件
import { DataTable, StatusBadge, PageHeader } from '@/shared/ui'

// 导入类型
import type { TableColumn, StatusType, BreadcrumbItem } from '@/shared/ui'

// 导入函数
import { showConfirm, showDeleteConfirm, useConfirmDialog } from '@/shared/ui'
```

### 向后兼容 (从 components/common 导入)

```typescript
// 仍然支持，但已标记为 @deprecated
import { DataTable } from '@/components/common'
```

## 迁移指南

如果你的代码中使用了旧的导入路径，建议按以下步骤迁移：

1. **查找旧的导入**:

   ```typescript
   // 旧的导入方式
   import { DataTable } from '@/components/common/DataTable.vue'
   ```

2. **替换为新的导入**:

   ```typescript
   // 新的导入方式
   import { DataTable } from '@/shared/ui'
   ```

3. **更新类型导入**:

   ```typescript
   // 旧的类型导入
   import type { TableColumn } from '@/components/common/DataTable.vue'

   // 新的类型导入
   import type { TableColumn } from '@/shared/ui'
   ```

## 设计原则

1. **可复用性**: 组件应该是通用的，不包含业务逻辑
2. **可组合性**: 组件应该易于组合使用
3. **类型安全**: 所有组件都有完整的 TypeScript 类型定义
4. **一致性**: 遵循 Element Plus 的设计规范
5. **可访问性**: 支持键盘导航和屏幕阅读器

## 开发规范

### 组件命名

- 使用 PascalCase 命名组件文件
- 组件名应该清晰描述其功能
- 避免使用缩写

### Props 定义

```typescript
export interface ComponentProps {
  /** 必填属性 */
  required: string
  /** 可选属性 */
  optional?: number
  /** 带默认值的属性 */
  withDefault?: boolean
}

const props = withDefaults(defineProps<ComponentProps>(), {
  withDefault: true
})
```

### 事件定义

```typescript
const emit = defineEmits<{
  /** 点击事件 */
  click: [event: MouseEvent]
  /** 值变化事件 */
  change: [value: string]
}>()
```

### 样式规范

- 使用 scoped 样式避免污染
- 使用 CSS 变量保持一致性
- 遵循 BEM 命名规范

```vue
<style scoped>
.component-name {
  /* 组件根元素 */
}

.component-name__element {
  /* 组件内部元素 */
}

.component-name--modifier {
  /* 组件修饰符 */
}
</style>
```

## 测试

每个组件都应该有对应的单元测试：

```typescript
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { StatusBadge } from '@/shared/ui'

describe('StatusBadge', () => {
  it('renders text correctly', () => {
    const wrapper = mount(StatusBadge, {
      props: { text: 'Success', type: 'success' }
    })
    expect(wrapper.text()).toBe('Success')
  })
})
```

## 贡献指南

1. 在添加新组件前，确保它是真正可复用的
2. 提供完整的 TypeScript 类型定义
3. 编写清晰的文档和使用示例
4. 添加单元测试
5. 遵循现有的代码风格

## 相关文档

- ~~FSD 架构文档~~（目标已不存在）
- ~~前端开发规范~~（目标已不存在）
- [Element Plus 文档](https://element-plus.org/)
