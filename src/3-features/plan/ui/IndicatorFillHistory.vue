<script setup lang="ts">
import { computed, ref } from 'vue'
import type { IndicatorFill } from '@/shared/types'
import { usePlanStore } from '@/features/plan/model/store'
import { logger } from '@/shared/lib/utils/logger'

const props = defineProps<{
  indicatorId: number | string
}>()

const emit = defineEmits<{
  (e: 'select', fill: IndicatorFill): void
  (e: 'close'): void
}>()

const planStore = usePlanStore()
const loading = ref(false)
const detailLoading = ref<string | null>(null)
const fills = ref<IndicatorFill[]>([])

const sortedFills = computed(() =>
  [...fills.value].sort((a, b) => new Date(b.fill_date).getTime() - new Date(a.fill_date).getTime())
)

const loadHistory = async () => {
  loading.value = true

  try {
    logger.info(`[IndicatorFillHistory] Loading history for indicator ${props.indicatorId}`)
    const history = await planStore.loadIndicatorFillHistory(props.indicatorId)
    fills.value = Array.isArray(history) ? history.filter(Boolean) : []
  } catch (error) {
    fills.value = []
    logger.error('[IndicatorFillHistory] Failed to load history:', error)
  } finally {
    loading.value = false
  }
}

const getStatusType = (status?: string) => {
  switch (status) {
    case 'approved':
      return 'success'
    case 'rejected':
      return 'danger'
    case 'submitted':
      return 'warning'
    default:
      return 'draft'
  }
}

const getStatusLabel = (status?: string) => {
  switch (status) {
    case 'approved':
      return '已通过'
    case 'rejected':
      return '已驳回'
    case 'submitted':
      return '待审核'
    default:
      return '草稿'
  }
}

const formatDate = (dateStr?: string) => {
  if (!dateStr) {
    return '-'
  }

  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) {
    return dateStr
  }

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
}

const formatDateTime = (dateStr?: string) => {
  if (!dateStr) {
    return '-'
  }

  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) {
    return dateStr
  }

  return `${formatDate(dateStr)} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`
}

const selectFill = async (fill: IndicatorFill) => {
  detailLoading.value = String(fill.id)
  try {
    const detailedFill = await planStore.loadIndicatorFillById(fill.id, props.indicatorId)
    emit('select', detailedFill || fill)
  } catch {
    emit('select', fill)
  } finally {
    detailLoading.value = null
  }
}

void loadHistory()
</script>

<template>
  <div class="indicator-fill-history">
    <div v-if="loading" class="state-card">
      <p class="state-text">正在加载填报历史...</p>
    </div>

    <div v-else-if="sortedFills.length === 0" class="state-card">
      <p class="state-text">该指标还没有填报记录</p>
    </div>

    <div v-else class="history-list">
      <button
        v-for="fill in sortedFills"
        :key="fill.id"
        type="button"
        class="history-card"
        :disabled="detailLoading === String(fill.id)"
        @click="selectFill(fill)"
      >
        <div class="history-top">
          <div class="progress-block">
            <span class="muted-label">进度</span>
            <span class="progress-value">{{ fill.progress }}%</span>
          </div>
          <span class="status-tag" :data-status="getStatusType(fill.status)">
            {{ getStatusLabel(fill.status) }}
          </span>
        </div>

        <div class="history-meta">
          <span>{{ formatDateTime(fill.created_at) }}</span>
          <span>填报人: {{ fill.filled_by_name || '-' }}</span>
        </div>

        <p v-if="fill.content" class="history-content">{{ fill.content }}</p>

        <div v-if="fill.audit_comment" class="history-extra">
          <span class="muted-label">审核意见</span>
          <p class="history-comment">{{ fill.audit_comment }}</p>
        </div>

        <div class="history-footer">
          <span>填报日期 {{ formatDate(fill.fill_date) }}</span>
          <span>
            {{
              detailLoading === String(fill.id)
                ? '正在加载详情...'
                : `更新于 ${formatDateTime(fill.updated_at)}`
            }}
          </span>
        </div>
      </button>
    </div>
  </div>
</template>

<style scoped>
.indicator-fill-history {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 8px 0;
}

.state-card {
  padding: 24px;
  border: 1px dashed #d0d7de;
  border-radius: 12px;
  background: #fafbfc;
  text-align: center;
}

.state-text {
  margin: 0;
  color: #6b7280;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.history-card {
  width: 100%;
  padding: 16px;
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  background: #fff;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;
}

.history-card:hover {
  border-color: #93c5fd;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
  transform: translateY(-1px);
}

.history-top,
.history-meta,
.history-footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.progress-block {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.muted-label {
  color: #6b7280;
}

.progress-value {
  font-size: 20px;
  font-weight: 700;
  color: #111827;
}

.status-tag {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}

.status-tag[data-status='success'] {
  background: #dcfce7;
  color: #166534;
}

.status-tag[data-status='danger'] {
  background: #fee2e2;
  color: #991b1b;
}

.status-tag[data-status='warning'] {
  background: #fef3c7;
  color: #92400e;
}

.status-tag[data-status='draft'] {
  background: #e5e7eb;
  color: #374151;
}

.history-content,
.history-comment {
  margin: 0;
  line-height: 1.6;
  color: #374151;
}

.history-extra {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pill {
  display: inline-flex;
  width: fit-content;
  padding: 4px 10px;
  border-radius: 999px;
  background: #eff6ff;
  color: #1d4ed8;
  font-size: 12px;
}
</style>
