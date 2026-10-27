<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Attachment } from '@/shared/types'
import type { IndicatorFill } from '@/shared/types'
import { apiClient } from '@/shared/api/client'
import { useIndicatorFills } from '../model/useIndicatorFills'
import { logger } from '@/shared/lib/utils/logger'

// 2026-10-13 用户定案：上报资料列显示「查看资料」按钮（与战略任务界面"查看"按钮同构），
// 点击弹出最新一次上报提交的资料列表（每行完整文件名，不截断），点击文件名下载；
// 历次资料经子指标名称右下角的上报历史小标查看。数据来自 plan_report_indicator（含历史）。
const props = defineProps<{
  indicatorId?: number | string | null
  /**
   * 行内附件（当前轮次，含草稿/待提交）。
   * 2026-10-26：上报资料列需展示「尚未提交」的填报附件——
   * useIndicatorFills 只返回已提交轮次，草稿附件需由行数据传入。
   */
  attachments?: Attachment[] | null
}>()

const fills = ref<IndicatorFill[]>([])
const loaded = ref(false)
const downloadingAttachment = ref<string | null>(null)

const latestAttachments = (): Attachment[] => {
  const inline = Array.isArray(props.attachments) ? props.attachments : []
  if (inline.length > 0) {
    return inline
  }
  return fills.value[0]?.attachments ?? []
}

async function downloadAttachment(attachment: Attachment): Promise<void> {
  if (downloadingAttachment.value) {
    return
  }
  downloadingAttachment.value = String(attachment.id)
  try {
    await apiClient.download(`/attachments/${attachment.id}/download`, attachment.fileName)
  } catch (error) {
    logger.warn('[ReportMaterialsCell] 附件下载失败:', error)
  } finally {
    downloadingAttachment.value = null
  }
}

onMounted(async () => {
  fills.value = await useIndicatorFills(props.indicatorId)
  loaded.value = true
})
</script>

<template>
  <span v-if="!loaded" class="report-materials__pending">…</span>
  <el-popover
    v-else-if="latestAttachments().length"
    placement="top"
    trigger="hover"
    :width="320"
    popper-class="report-materials-popper"
  >
    <template #reference>
      <el-button link type="primary" size="small">{{ latestAttachments().length }} 个</el-button>
    </template>
    <div class="report-materials">
      <div class="report-materials__title">最新上报资料（{{ latestAttachments().length }}）</div>
      <div
        v-for="(attachment, index) in latestAttachments()"
        :key="attachment.id"
        class="report-materials__row"
      >
        <button
          type="button"
          class="report-materials__file"
          :disabled="downloadingAttachment === String(attachment.id)"
          :title="`点击下载 ${attachment.fileName}`"
          @click.stop="downloadAttachment(attachment)"
        >
          <span class="report-materials__index">{{ index + 1 }}</span>
          <span class="report-materials__name">{{
            downloadingAttachment === String(attachment.id) ? '下载中…' : attachment.fileName
          }}</span>
          <span v-if="attachment.fileType" class="report-materials__type">{{
            attachment.fileType
          }}</span>
        </button>
      </div>
    </div>
  </el-popover>
  <span v-else class="report-materials__empty">—</span>
</template>

<style scoped>
.report-materials__empty {
  color: #909399;
}
.report-materials__pending {
  color: #c0c4cc;
}
</style>

<!-- 浮层被 teleport 到 body，需用非 scoped 样式配合 popper-class -->
<style>
.report-materials-popper .report-materials {
  font-size: 12px;
  line-height: 1.6;
}
.report-materials-popper .report-materials__title {
  font-weight: 600;
  color: #303133;
  margin-bottom: 6px;
}
.report-materials-popper .report-materials__row {
  padding: 2px 0;
}
.report-materials-popper .report-materials__file {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  border: 1px solid #d9ecff;
  background: #f0f7ff;
  color: #409eff;
  border-radius: 4px;
  font-size: 12px;
  padding: 4px 8px;
  cursor: pointer;
  word-break: break-all;
  white-space: normal;
}
.report-materials-popper .report-materials__index {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 3px;
  background: #409eff;
  color: #fff;
  font-size: 11px;
  line-height: 1;
}
.report-materials-popper .report-materials__name {
  flex: 1 1 auto;
  min-width: 0;
  word-break: break-all;
  white-space: normal;
}
.report-materials-popper .report-materials__type {
  flex: none;
  padding: 0 5px;
  border-radius: 3px;
  background: #e8f1ff;
  color: #6b8cb8;
  font-size: 11px;
  line-height: 16px;
  text-transform: uppercase;
}
.report-materials-popper .report-materials__file:hover {
  background: #d9ecff;
}
.report-materials-popper .report-materials__file:disabled {
  color: #a0cfff;
  cursor: default;
}
</style>
