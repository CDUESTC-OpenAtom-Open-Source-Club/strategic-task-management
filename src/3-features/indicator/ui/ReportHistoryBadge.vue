<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Attachment } from '@/shared/types'
import type { IndicatorFill } from '@/shared/types'
import { apiClient } from '@/shared/api/client'
import { useIndicatorFills } from '../model/useIndicatorFills'
import { logger } from '@/shared/lib/utils/logger'

// 2026-10-13 用户定案：上报历史小标——每次月度上报更新角标，
// 悬停展开历次上报（月份/状态/说明/附件），数据来自 plan_report_indicator（含历史），
// 纯上报归档展示，不走异动链。
const props = defineProps<{
  indicatorId?: number | string | null
}>()

const fills = ref<IndicatorFill[]>([])
const loaded = ref(false)
const downloadingAttachment = ref<string | null>(null)

const count = computed(() => fills.value.length)
const hasEntity = computed(() => Boolean(props.indicatorId))

const statusLabel = (status?: string) => {
  switch (status) {
    case 'approved':
      return '已通过'
    case 'rejected':
      return '已回退'
    case 'submitted':
      return '待审核'
    default:
      return '草稿'
  }
}

const statusType = (status?: string) => {
  switch (status) {
    case 'approved':
      return 'success'
    case 'rejected':
      return 'danger'
    case 'submitted':
      return 'warning'
    default:
      return 'info'
  }
}

const formatMonth = (dateStr?: string) => {
  if (!dateStr) {
    return ''
  }
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) {
    return dateStr
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function downloadAttachment(attachment: Attachment): Promise<void> {
  if (downloadingAttachment.value) {
    return
  }
  downloadingAttachment.value = String(attachment.id)
  try {
    await apiClient.download(`/attachments/${attachment.id}/download`, attachment.fileName)
  } catch (error) {
    logger.warn('[ReportHistoryBadge] 附件下载失败:', error)
  } finally {
    downloadingAttachment.value = null
  }
}

async function load(): Promise<void> {
  if (loaded.value || !props.indicatorId) {
    loaded.value = true
    return
  }
  fills.value = await useIndicatorFills(props.indicatorId)
  loaded.value = true
}

onMounted(load)
</script>

<template>
  <el-popover
    v-if="hasEntity && count > 0"
    placement="top"
    trigger="click"
    :width="340"
    :show-after="120"
    :hide-after="60"
    popper-class="report-history-popper"
  >
    <template #reference>
      <button
        type="button"
        class="report-badge__trigger"
        :aria-label="`已上报 ${count} 次`"
        :title="`已上报 ${count} 次`"
        @click.stop
      >
        {{ count }}
      </button>
    </template>
    <div class="report-history">
      <div class="report-history__title">上报历史（共 {{ count }} 次）</div>
      <div v-for="(fill, index) in fills" :key="fill.id" class="report-history__item">
        <div class="report-history__head">
          <span class="report-history__month">{{ formatMonth(fill.fill_date) }}</span>
          <el-tag :type="statusType(fill.status)" size="small">
            {{ statusLabel(fill.status) }}
          </el-tag>
          <span v-if="index === 0" class="report-history__latest">最新</span>
        </div>
        <div v-if="fill.content" class="report-history__content">{{ fill.content }}</div>
        <div v-if="fill.attachments?.length" class="report-history__files">
          <button
            v-for="attachment in fill.attachments"
            :key="attachment.id"
            type="button"
            class="report-history__file"
            :disabled="downloadingAttachment === String(attachment.id)"
            @click.stop="downloadAttachment(attachment)"
          >
            {{ downloadingAttachment === String(attachment.id) ? '下载中…' : attachment.fileName }}
          </button>
        </div>
      </div>
    </div>
  </el-popover>
</template>

<style scoped>
.report-badge__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 1px solid #a5d4fa;
  border-radius: 50%;
  background: #ecf5ff;
  color: #409eff;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  transition: all 0.15s ease;
}
.report-badge__trigger:hover {
  border-color: #409eff;
  background: #d9ecff;
}
</style>

<!-- 浮层被 teleport 到 body，需用非 scoped 样式配合 popper-class -->
<style>
.report-history-popper {
  max-width: 380px;
}
.report-history-popper .report-history {
  max-height: 280px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
}
.report-history-popper .report-history__title {
  font-weight: 600;
  margin-bottom: 6px;
  color: #303133;
}
.report-history-popper .report-history__item {
  border-top: 1px solid #f0f0f0;
  padding: 6px 0;
}
.report-history-popper .report-history__item:first-of-type {
  border-top: none;
}
.report-history-popper .report-history__head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.report-history-popper .report-history__month {
  color: #303133;
  font-weight: 600;
}
.report-history-popper .report-history__latest {
  color: #409eff;
  font-size: 11px;
}
.report-history-popper .report-history__content {
  color: #606266;
  margin-top: 2px;
  word-break: break-word;
}
.report-history-popper .report-history__files {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.report-history-popper .report-history__file {
  border: 1px solid #d9ecff;
  background: #f0f7ff;
  color: #409eff;
  border-radius: 4px;
  font-size: 11px;
  padding: 1px 6px;
  cursor: pointer;
}
.report-history-popper .report-history__file:hover {
  background: #d9ecff;
}
.report-history-popper .report-history__file:disabled {
  color: #a0cfff;
  cursor: default;
}
</style>
