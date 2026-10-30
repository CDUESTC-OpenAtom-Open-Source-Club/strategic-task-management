<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import type { MutationHistoryItem } from '@/features/indicator/api/mutationApi'
import {
  MUTATION_FIELD_LABELS,
  countMutationHistoryByFields,
  getMutationHistory,
  loadMutationHistory,
  mutationHistoryRevision,
  projectMutationHistoryByFields
} from '@/features/indicator/model/mutationHistory'

const props = withDefaults(
  defineProps<{
    indicatorId?: number | string | null
    taskId?: number | string | null
    /**
     * 只统计改动了这些字段的异动（后端 changed_fields 键）。
     * 不传 = 统计该实体的全部异动。徽标落在哪一列，就传哪一列对应的字段。
     */
    fields?: string[] | null
    /**
     * 2026-10-30 用户定案：该实体是否处于在途异动（审批中）。
     * 由宿主按审批实例数据判定后传入；为 true 时浮层顶部打「在异动当中」状态、角标变警示色。
     */
    mutationInFlight?: boolean
  }>(),
  { indicatorId: null, taskId: null, fields: null, mutationInFlight: false }
)

const scope = computed(() => (props.taskId ? ('task' as const) : ('indicator' as const)))
const entityId = computed(() => props.taskId ?? props.indicatorId)

const entityLabel = computed(() => (props.taskId ? '战略任务' : '核心指标'))
const hasEntity = computed(() => Boolean(entityId.value))

/** 共享缓存里的原始历史（响应式：缓存失效/更新后自动重算） */
const history = computed<MutationHistoryItem[]>(() =>
  getMutationHistory(scope.value, entityId.value)
)

/**
 * 徽标只展示自己那一列涉及的字段。2026-10-30 用户反馈：原行级过滤下，
 * 同一条记录里「指标内容」的变更会跟着出现在权重列圆点的浮层里——
 * 这里改为行级过滤+字段级投影，浮层只渲染本列跟踪字段的交集。
 */
const visibleHistory = computed(() => projectMutationHistoryByFields(history.value, props.fields))
const count = computed(() => countMutationHistoryByFields(history.value, props.fields))

function fieldName(key: string): string {
  return MUTATION_FIELD_LABELS[key] || key
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '空'
  }
  return String(value)
}

function formatTime(value: string | null | undefined): string {
  if (!value) {
    return ''
  }
  return String(value).replace('T', ' ').slice(0, 16)
}

function reload(): void {
  const id = entityId.value
  if (!id) {
    return
  }
  void loadMutationHistory(scope.value, id)
}

onMounted(reload)

// 实体或统计字段变了 → 重新拉取
watch(() => [props.indicatorId, props.taskId, ...(props.fields ?? [])], reload)

// 发起异动后缓存失效 → 重新拉取，徽标计数跟着变
watch(mutationHistoryRevision, reload)
</script>

<template>
  <!-- 2026-10-07 用户反馈：没有检测到异动则不展示角标；有异动时悬停展开历史 -->
  <el-popover
    v-if="hasEntity && count > 0"
    placement="top"
    trigger="hover"
    :width="320"
    :show-after="120"
    :hide-after="60"
    popper-class="mutation-history-popper"
  >
    <template #reference>
      <button
        type="button"
        class="mutation-badge__trigger"
        :class="{ 'mutation-badge__trigger--in-flight': mutationInFlight }"
        :aria-label="`${entityLabel}已更改 ${count} 次`"
        :title="mutationInFlight ? `在异动当中，已更改 ${count} 次` : `已更改 ${count} 次`"
        @click.stop
        @dblclick.stop
        @mousedown.stop
      >
        {{ count }}
      </button>
    </template>
    <div class="mutation-history">
      <div class="mutation-history__title">{{ entityLabel }}异动历史</div>
      <!-- 2026-10-30 用户定案：异动在途时打「在异动当中」状态——发起后审批进展一目了然 -->
      <div v-if="mutationInFlight" class="mutation-history__in-flight">
        <el-tag type="warning" size="small" effect="light">在异动当中</el-tag>
        <span class="mutation-history__in-flight-text">正在异动审批中，通过后生效</span>
      </div>
      <div v-if="visibleHistory.length === 0" class="mutation-history__empty">暂无异动记录</div>
      <div v-for="item in visibleHistory" :key="item.log_id" class="mutation-history__item">
        <div class="mutation-history__time">{{ formatTime(item.created_at) }}</div>
        <div
          v-for="(change, key) in item.changed_fields || {}"
          :key="key"
          class="mutation-history__field"
        >
          <span class="mutation-history__field-name">{{ fieldName(String(key)) }}</span>
          <span class="mutation-history__field-value">{{ formatValue(change?.before) }}</span>
          <span class="mutation-history__arrow">→</span>
          <span class="mutation-history__field-value">{{ formatValue(change?.after) }}</span>
        </div>
      </div>
    </div>
  </el-popover>
</template>

<style scoped>
.mutation-badge__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 1px solid #cbd5e1;
  border-radius: 50%;
  background: #f8fafc;
  color: #64748b;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  transition: all 0.15s ease;
}
.mutation-badge__trigger:hover {
  border-color: #409eff;
  background: #ecf5ff;
  color: #409eff;
}
/* 2026-10-30：在途异动时角标变警示色，与浮层「在异动当中」状态呼应 */
.mutation-badge__trigger--in-flight {
  border-color: #f3d19e;
  background: #fdf6ec;
  color: #e6a23c;
}
.mutation-badge__trigger--in-flight:hover {
  border-color: #e6a23c;
  background: #fdf6ec;
  color: #b88230;
}
</style>

<!-- 浮层被 teleport 到 body，需用非 scoped 样式配合 popper-class -->
<style>
.mutation-history-popper {
  max-width: 360px;
}
.mutation-history-popper .mutation-history {
  max-height: 260px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
}
.mutation-history-popper .mutation-history__title {
  font-weight: 600;
  margin-bottom: 6px;
  color: #303133;
}
.mutation-history-popper .mutation-history__empty {
  color: #909399;
}
.mutation-history-popper .mutation-history__in-flight {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.mutation-history-popper .mutation-history__in-flight-text {
  color: var(--el-color-warning);
}
.mutation-history-popper .mutation-history__item {
  border-top: 1px solid #f0f0f0;
  padding: 6px 0;
}
.mutation-history-popper .mutation-history__item:first-of-type {
  border-top: none;
}
.mutation-history-popper .mutation-history__time {
  color: #909399;
  margin-bottom: 2px;
}
.mutation-history-popper .mutation-history__field-name {
  color: #909399;
  margin-right: 4px;
}
.mutation-history-popper .mutation-history__field-value {
  color: #303133;
  word-break: break-word;
}
.mutation-history-popper .mutation-history__arrow {
  margin: 0 4px;
  color: #c0c4cc;
}
</style>
