<script setup lang="ts">
import { ref } from 'vue'
import { mutationApi, type MutationHistoryItem } from '@/features/indicator/api/mutationApi'

const props = defineProps<{
  indicatorId: number | string
}>()

const count = ref<number | null>(null)
const history = ref<MutationHistoryItem[]>([])
const expanded = ref(false)
const loading = ref(false)

function fieldName(key: string): string {
  const names: Record<string, string> = {
    indicator_desc: '指标内容',
    weight_percent: '权重',
    remark: '备注'
  }
  return names[key] || key
}

async function toggle(): Promise<void> {
  expanded.value = !expanded.value
  if (expanded.value && history.value.length === 0) {
    loading.value = true
    try {
      const response = await mutationApi.history(props.indicatorId)
      history.value = response.data ?? []
      count.value = history.value.length
    } finally {
      loading.value = false
    }
  }
}
</script>

<template>
  <div class="mutation-badge">
    <button
      type="button"
      class="mutation-badge__trigger"
      :title="'该指标已被异动修改过，点击查看历史版本'"
      @click.stop="toggle"
    >
      已更改 {{ count ?? history.length }} 次
    </button>
    <div v-if="expanded" class="mutation-badge__popover">
      <div class="mutation-badge__popover-title">异动历史版本</div>
      <div v-if="loading" class="mutation-badge__empty">加载中...</div>
      <div v-else-if="history.length === 0" class="mutation-badge__empty">暂无异动记录</div>
      <div v-for="item in history" :key="item.log_id" class="mutation-badge__item">
        <div class="mutation-badge__item-time">{{ item.created_at }}</div>
        <div
          v-for="(change, key) in item.changed_fields || {}"
          :key="key"
          class="mutation-badge__item-field"
        >
          {{ fieldName(String(key)) }}：{{ String(change?.before ?? '空') }} →
          {{ String(change?.after ?? '空') }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mutation-badge {
  position: relative;
  text-align: right;
}
.mutation-badge__trigger {
  border: none;
  background: transparent;
  color: #909399;
  font-size: 11px;
  cursor: pointer;
  padding: 0;
}
.mutation-badge__trigger:hover {
  color: #409eff;
  text-decoration: underline;
}
.mutation-badge__popover {
  position: absolute;
  right: 0;
  bottom: 100%;
  z-index: 20;
  min-width: 240px;
  max-height: 220px;
  overflow: auto;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
  padding: 8px;
  text-align: left;
}
.mutation-badge__popover-title {
  font-weight: 600;
  margin-bottom: 6px;
}
.mutation-badge__empty {
  color: #909399;
  font-size: 12px;
}
.mutation-badge__item {
  border-top: 1px solid #f0f0f0;
  padding: 6px 0;
  font-size: 12px;
}
.mutation-badge__item-time {
  color: #909399;
  margin-bottom: 2px;
}
.mutation-badge__item-field {
  line-height: 1.5;
}
</style>
