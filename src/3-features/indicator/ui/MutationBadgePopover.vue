<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { mutationApi, type MutationHistoryItem } from '@/features/indicator/api/mutationApi'

const props = withDefaults(
  defineProps<{
    indicatorId?: number | string | null
    taskId?: number | string | null
  }>(),
  { indicatorId: null, taskId: null }
)

const FIELD_LABELS: Record<string, string> = {
  indicator_desc: '指标内容',
  weight_percent: '权重',
  name: '战略任务',
  desc: '任务描述',
  remark: '备注'
}

const count = ref(0)
const history = ref<MutationHistoryItem[]>([])
const loaded = ref(false)

const entityLabel = computed(() => (props.taskId ? '战略任务' : '核心指标'))
const hasEntity = computed(() => Boolean(props.taskId ?? props.indicatorId))

function fieldName(key: string): string {
  return FIELD_LABELS[key] || key
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

async function load(): Promise<void> {
  if (loaded.value) {
    return
  }
  const id = props.taskId ?? props.indicatorId
  if (!id) {
    loaded.value = true
    return
  }
  try {
    const response = props.taskId
      ? await mutationApi.taskHistory(id)
      : await mutationApi.history(id)
    history.value = response.data ?? []
  } catch {
    history.value = []
  } finally {
    count.value = history.value.length
    loaded.value = true
  }
}

onMounted(load)
</script>

<template>
  <!-- 无变更不渲染标注；有变更时鼠标悬停即展开历史（点击不再作为唯一入口） -->
  <el-popover
    v-if="hasEntity"
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
        :aria-label="`${entityLabel}已更改 ${count} 次`"
        :title="`已更改 ${count} 次`"
        @click.stop
      >
        {{ count }}
      </button>
    </template>
    <div class="mutation-history">
      <div class="mutation-history__title">{{ entityLabel }}异动历史</div>
      <div v-if="count === 0" class="mutation-history__empty">暂无异动记录</div>
      <div v-for="item in history" :key="item.log_id" class="mutation-history__item">
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
