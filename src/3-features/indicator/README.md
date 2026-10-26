> **[历史标注 2026-10-26]** 2026-05 架构重构期产物。文中引用的 .kiro 规格目录、sism-backend API 文档路径与 entities/shared 迁移说明均可能已失效；当前分层以 1-app/2-pages/3-features/4-entities/5-shared 为准。

# Strategic Indicator Feature

战略指标管理功能模块，基于 FSD (Feature-Sliced Design) 架构设计。

## 目录结构

```
strategic-indicator/
├── model/              # 业务模型层
│   ├── store.ts        # Pinia 状态管理
│   ├── types.ts        # 业务类型定义
│   ├── schema.ts       # Zod 验证模式
│   └── constants.ts    # 常量配置
├── lib/                # 业务逻辑层
│   ├── calculations.ts # 指标计算逻辑
│   └── validations.ts  # 业务验证规则
├── api/                # API 接口层
│   ├── query.ts        # 查询 API
│   ├── mutations.ts    # 变更 API
│   └── types.ts        # API 类型
├── ui/                 # UI 组件层
│   ├── IndicatorCard.vue
│   ├── IndicatorForm.vue
│   ├── IndicatorList.vue
│   └── IndicatorDistributionDialog.vue
├── index.ts            # 公共 API 导出
└── README.md           # 本文档
```

## 功能特性

### 1. 状态管理 (Store)

使用 Pinia 管理指标状态：

```typescript
import { useIndicatorStore } from '@/features/strategic-indicator'

const indicatorStore = useIndicatorStore()

// 获取指标列表
await indicatorStore.fetchIndicators({ status: 'DISTRIBUTED' })

// 创建指标
await indicatorStore.createIndicator(indicatorData)

// 下发指标
await indicatorStore.distributeIndicator(id, [orgId1, orgId2])
```

### 2. API 接口

#### 查询 API

```typescript
import { indicatorQuery } from '@/features/strategic-indicator'

// 查询指标列表
const result = await indicatorQuery.queryIndicators({ page: 0, size: 20 })

// 获取指标详情
const indicator = await indicatorQuery.getIndicatorById(1)

// 按任务查询
const indicators = await indicatorQuery.queryIndicatorsByTask(taskId)
```

#### 变更 API

```typescript
import { indicatorMutations } from '@/features/strategic-indicator'

// 创建指标
const newIndicator = await indicatorMutations.createIndicator(data)

// 更新指标
const updated = await indicatorMutations.updateIndicator(id, data)

// 下发指标
const result = await indicatorMutations.distributeIndicator(id, {
  targetOrgIds: [5, 6, 7],
  message: '请在月底前完成',
  deadline: '2024-01-31'
})

// 撤回指标
await indicatorMutations.withdrawIndicator(id, '需要调整')

// 提交审批
const approval = await indicatorMutations.submitIndicatorForApproval(id, '请审批')
```

### 3. 业务逻辑

#### 计算函数

```typescript
import {
  calculateCompletionRate,
  calculateWeightedCompletionRate,
  validateWeightSum,
  formatWeightAsPercentage
} from '@/features/strategic-indicator'

// 计算完成率
const rate = calculateCompletionRate(targetValue, actualValue)

// 计算加权完成率
const weightedRate = calculateWeightedCompletionRate(indicators)

// 验证权重总和
const isValid = validateWeightSum(indicators)

// 格式化权重
const formatted = formatWeightAsPercentage(0.25) // "25.0%"
```

#### 验证函数

```typescript
import {
  canEditIndicator,
  canDistributeIndicator,
  validateIndicatorCreate,
  getAvailableActions
} from '@/features/strategic-indicator'

// 检查是否可编辑
if (canEditIndicator(indicator)) {
  // 允许编辑
}

// 验证创建数据
const result = validateIndicatorCreate(data)
if (!result.valid) {
  console.error(result.errors)
}

// 获取可用操作
const actions = getAvailableActions(indicator)
// ['view', 'edit', 'delete', 'distribute']
```

### 4. UI 组件

#### IndicatorCard

卡片形式展示指标信息：

```vue
<template>
  <IndicatorCard
    :indicator="indicator"
    :show-actions="true"
    @view="handleView"
    @edit="handleEdit"
    @delete="handleDelete"
    @distribute="handleDistribute"
  />
</template>
```

#### IndicatorForm

指标创建/编辑表单：

```vue
<template>
  <IndicatorForm
    v-model="formData"
    :mode="'create'"
    :loading="loading"
    @submit="handleSubmit"
    @cancel="handleCancel"
  >
    <!-- 插槽：任务选项 -->
    <template #task-options>
      <el-option v-for="task in tasks" :key="task.id" :label="task.name" :value="task.id" />
    </template>

    <!-- 插槽：组织选项 -->
    <template #owner-org-options>
      <el-option v-for="org in organizations" :key="org.id" :label="org.name" :value="org.id" />
    </template>
  </IndicatorForm>
</template>
```

#### IndicatorList

表格形式展示指标列表：

```vue
<template>
  <IndicatorList
    :data="indicators"
    :loading="loading"
    :total="total"
    :current-page="currentPage"
    :page-size="pageSize"
    @view="handleView"
    @edit="handleEdit"
    @delete="handleDelete"
    @distribute="handleDistribute"
    @page-change="handlePageChange"
    @size-change="handleSizeChange"
  />
</template>
```

#### IndicatorDistributionDialog

指标下发对话框：

```vue
<template>
  <IndicatorDistributionDialog
    v-model="dialogVisible"
    :indicator="selectedIndicator"
    :loading="loading"
    @confirm="handleDistribute"
  >
    <!-- 插槽：组织选项 -->
    <template #org-options>
      <el-option
        v-for="org in targetOrganizations"
        :key="org.id"
        :label="org.name"
        :value="org.id"
      />
    </template>
  </IndicatorDistributionDialog>
</template>
```

## 数据验证

使用 Zod 进行运行时数据验证：

```typescript
import { indicatorCreateSchema } from '@/features/strategic-indicator'

const result = indicatorCreateSchema.safeParse(data)
if (result.success) {
  // 数据有效
  const validData = result.data
} else {
  // 数据无效
  console.error(result.error.errors)
}
```

## 常量配置

```typescript
import {
  STATUS_CONFIG,
  LEVEL_CONFIG,
  INDICATOR_TYPE_OPTIONS,
  DEFAULT_PAGE_SIZE
} from '@/features/strategic-indicator'

// 状态配置
const statusConfig = STATUS_CONFIG['DRAFT']
// { label: '草稿', type: 'info', color: '#909399' }

// 层级配置
const levelConfig = LEVEL_CONFIG['FIRST']
// { label: '一级指标', badge: '1' }

// 指标类型选项
// [{ label: '定量', value: 'QUANTITATIVE' }, { label: '定性', value: 'QUALITATIVE' }]
```

## API 端点映射

基于后端 API 文档 (`docs/API接口文档.md`)：

| 功能         | API 端点                               | 方法   |
| ------------ | -------------------------------------- | ------ |
| 查询指标列表 | `/api/indicators`                      | GET    |
| 获取指标详情 | `/api/indicators/{id}`                 | GET    |
| 创建指标     | `/api/indicators`                      | POST   |
| 更新指标     | `/api/indicators/{id}`                 | PUT    |
| 删除指标     | `/api/indicators/{id}`                 | DELETE |
| 下发指标     | `/api/indicators/{id}/distribute`      | POST   |
| 撤回指标     | `/api/indicators/{id}/withdraw`        | POST   |
| 提交审批     | `/api/indicators/{id}/submit-approval` | POST   |
| 按任务查询   | `/api/indicators/task/{taskId}`        | GET    |
| 按组织查询   | `/api/indicators/owner-org/{orgId}`    | GET    |

## 依赖关系

```
features/strategic-indicator/
├── 依赖 entities/indicator (领域模型)
├── 依赖 shared/lib/api (API 客户端)
└── 依赖 shared/ui (通用 UI 组件)
```

## 使用示例

### 完整的指标管理页面

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  useIndicatorStore,
  IndicatorList,
  IndicatorForm,
  IndicatorDistributionDialog
} from '@/features/strategic-indicator'
import type { Indicator } from '@/entities/indicator/model/types'

const indicatorStore = useIndicatorStore()

const showForm = ref(false)
const showDistribution = ref(false)
const selectedIndicator = ref<Indicator | null>(null)

onMounted(async () => {
  await indicatorStore.fetchIndicators()
})

async function handleCreate(data: Partial<Indicator>) {
  try {
    await indicatorStore.createIndicator(data)
    ElMessage.success('创建成功')
    showForm.value = false
  } catch (error) {
    ElMessage.error('创建失败')
  }
}

async function handleDistribute(data: any) {
  if (!selectedIndicator.value) return

  try {
    await indicatorStore.distributeIndicator(
      selectedIndicator.value.id,
      data.targetOrgIds,
      data.message,
      data.deadline
    )
    ElMessage.success('下发成功')
    showDistribution.value = false
  } catch (error) {
    ElMessage.error('下发失败')
  }
}

function openDistribution(indicator: Indicator) {
  selectedIndicator.value = indicator
  showDistribution.value = true
}
</script>

<template>
  <div class="indicator-page">
    <el-button type="primary" @click="showForm = true"> 创建指标 </el-button>

    <IndicatorList
      :data="indicatorStore.indicators"
      :loading="indicatorStore.loading"
      :total="indicatorStore.total"
      @distribute="openDistribution"
    />

    <el-dialog v-model="showForm" title="创建指标">
      <IndicatorForm :mode="'create'" @submit="handleCreate" @cancel="showForm = false" />
    </el-dialog>

    <IndicatorDistributionDialog
      v-model="showDistribution"
      :indicator="selectedIndicator"
      @confirm="handleDistribute"
    />
  </div>
</template>
```

## 注意事项

1. **数据库约束**: 本模块基于现有数据库结构，不修改数据库 schema
2. **API 兼容性**: 所有 API 调用基于 `docs/API接口文档.md` 中定义的端点
3. **权限控制**: 业务验证函数会检查操作权限，但最终权限由后端控制
4. **错误处理**: 所有 API 调用都应该使用 try-catch 处理错误
5. **类型安全**: 使用 TypeScript 和 Zod 确保类型安全

## 测试

```bash
# 运行单元测试
npm run test

# 运行特定测试文件
npm run test features/strategic-indicator
```

## 相关文档

- ~~API 接口文档~~（目标已不存在）
- ~~FSD 架构设计~~（目标已不存在）
- ~~实体层文档~~（目标已不存在）
- ~~共享层文档~~（目标已不存在）
