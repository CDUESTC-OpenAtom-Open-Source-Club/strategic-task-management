<script setup lang="ts">
import { computed, ref } from 'vue'
import type { IndicatorFill } from '@/shared/types'
import type { Attachment } from '@/shared/types'
import { ElMessage } from 'element-plus'
import { apiClient } from '@/shared/api/client'
import { usePlanStore } from '@/features/plan/model/store'
import { logger } from '@/shared/lib/utils/logger'
import { formatLocalDateTag } from '@/shared/lib/utils/localDateTag'
import {
  buildAttachmentNameCell,
  buildExportFileName,
  exportRowsToExcel,
  type ExcelExportColumn,
  type ExcelExportSheet
} from '@/shared/lib/export/excel'
import {
  buildAttachmentRelativeDir,
  collectAttachmentGroups,
  exportDepartmentsAsZip
} from '@/shared/lib/export/zipExport'

const props = defineProps<{
  indicatorId: number | string
  /** 指标名称：用于导出文件名与包内目录名（父级详情页已有，直接传入） */
  indicatorName?: string
}>()

const emit = defineEmits<{
  (e: 'select', fill: IndicatorFill): void
  (e: 'close'): void
}>()

const downloadingAttachment = ref<string | null>(null)

// 会议定案「上报资料可下载」：填报明细自带附件（后端 plan_report_indicator_attachment），
// 通过带认证的 blob 下载，浏览器直接另存
const downloadAttachment = async (attachment: Attachment) => {
  if (downloadingAttachment.value) {
    return
  }
  downloadingAttachment.value = attachment.id
  try {
    await apiClient.download(`/attachments/${attachment.id}/download`, attachment.fileName)
  } catch (error) {
    logger.warn('[IndicatorFillHistory] 附件下载失败:', error)
  } finally {
    downloadingAttachment.value = null
  }
}

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
      return '已回退'
    case 'submitted':
      return '待审核'
    default:
      return '草稿'
  }
}

/**
 * 2026-10-24 用户定案：每次上报记录都要能看出这一轮的自评进度。
 * 等级制填报时进度百分比无意义（后端也会跳过递增校验），卡片上并列展示等级。
 */
const SELF_RATING_LABELS: Record<string, string> = {
  AHEAD: '超前完成',
  NORMAL: '正常',
  DELAYED: '延期'
}

const resolveSelfRatingLabel = (rating?: string | null): string => {
  const normalized = String(rating || '')
    .trim()
    .toUpperCase()
  if (!normalized) {
    return ''
  }
  return SELF_RATING_LABELS[normalized] || normalized
}

const resolveSelfRatingTone = (
  rating?: string | null
): 'ahead' | 'normal' | 'delayed' | 'unknown' => {
  const normalized = String(rating || '')
    .trim()
    .toUpperCase()
  if (normalized === 'AHEAD') {
    return 'ahead'
  }
  if (normalized === 'NORMAL') {
    return 'normal'
  }
  if (normalized === 'DELAYED') {
    return 'delayed'
  }
  return 'unknown'
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
    // 2026-10-24 用户定案：详情弹窗内聚在本组件——点卡片就地打开该次上报的完整内容，
    // 三个复用页面（战略任务/指标视图/下发管理）无需各自实现。emit 保留给需要联动的外层。
    activeFill.value = detailedFill || fill
    fillDetailVisible.value = true
    emit('select', activeFill.value)
  } catch {
    activeFill.value = fill
    fillDetailVisible.value = true
    emit('select', fill)
  } finally {
    detailLoading.value = null
  }
}

/** 2026-10-24：单次上报详情（组件内自包含弹窗） */
const fillDetailVisible = ref(false)
const activeFill = ref<IndicatorFill | null>(null)

const resolveStatusTagType = (status?: string) => getStatusType(status)

const resolveStatusLabel = (status?: string) => getStatusLabel(status)

const resolveSelfRatingText = (rating?: string | null): string => {
  const label = resolveSelfRatingLabel(rating)
  return label || '未填写'
}

/**
 * 2026-10-28 用户定案：填报记录也要能导出，且附件随包下载。
 * 每轮填报一行（按填报日期升序，序号即轮次），附件按轮次放进
 * `{指标}/附件/{序号}_{指标名}/R{轮次}_{填报日期}_{原文件名}`。
 *
 * 可见性口径：`fills.value` 就是页面渲染的那份数据——后端已按登录人过滤，
 * 填报人可见本人草稿，上级只可见已进入审批流程的轮次。
 */
const exporting = ref(false)

const indicatorDisplayName = computed(
  () => props.indicatorName?.trim() || `指标${props.indicatorId}`
)

const chronologicalFills = computed(() =>
  [...fills.value].sort(
    (left, right) =>
      new Date(left.fill_date || 0).getTime() - new Date(right.fill_date || 0).getTime()
  )
)

const buildFillExportColumns = (rows: IndicatorFill[]): ExcelExportColumn<IndicatorFill>[] => [
  { header: '序号', width: 8, align: 'center', getValue: (_row, index) => index + 1 },
  { header: '填报日期', width: 14, getValue: row => formatDate(row.fill_date) },
  { header: '填报人', width: 14, getValue: row => row.filled_by_name || '-' },
  { header: '审核状态', width: 10, align: 'center', getValue: row => getStatusLabel(row.status) },
  {
    header: '自评进度',
    width: 12,
    align: 'center',
    getValue: row => resolveSelfRatingText(row.selfRating)
  },
  { header: '填报说明', width: 36, getValue: row => row.content || '-' },
  { header: '审核意见', width: 28, getValue: row => row.audit_comment || '-' },
  {
    header: '附件目录（包内相对路径）',
    width: 30,
    getValue: (row, index) =>
      row.attachments?.length
        ? buildAttachmentRelativeDir({
            seq: index + 1,
            indicatorName: indicatorDisplayName.value
          })
        : '-'
  },
  { header: '上报资料', width: 36, getValue: row => buildAttachmentNameCell(row.attachments) }
]

const handleExportFills = async () => {
  const rows = chronologicalFills.value
  if (rows.length === 0) {
    ElMessage.warning('暂无可导出的填报记录')
    return
  }

  exporting.value = true
  try {
    const scopeName = indicatorDisplayName.value
    const sheet: ExcelExportSheet<IndicatorFill> = {
      sheetName: '填报记录',
      rows,
      columns: buildFillExportColumns(rows),
      emptyMessage: '该指标还没有填报记录'
    }

    const attachmentGroups = collectAttachmentGroups(
      rows.map((fill, index) => ({
        seq: index + 1,
        indicatorName: scopeName,
        round: index + 1,
        fillDate: fill.fill_date ? formatDate(fill.fill_date) : undefined,
        attachments: fill.attachments
      }))
    )

    if (attachmentGroups.length === 0) {
      await exportRowsToExcel(sheet, buildExportFileName('填报记录', scopeName))
      ElMessage.success('导出成功')
      return
    }

    const dateText = formatLocalDateTag()
    await exportDepartmentsAsZip(
      [
        {
          department: scopeName,
          sheets: [sheet as ExcelExportSheet<unknown>],
          attachmentGroups
        }
      ],
      `填报记录_${scopeName}_${dateText}.zip`,
      { onProgress: text => ElMessage({ message: text, duration: 1200, grouping: true }) }
    )
    ElMessage.success(`导出成功：${rows.length} 轮填报记录与附件已一并打包`)
  } catch (error) {
    logger.error('[IndicatorFillHistory] 导出填报记录失败:', error)
    ElMessage.error('导出失败，请稍后重试')
  } finally {
    exporting.value = false
  }
}

void loadHistory()
</script>

<template>
  <div class="indicator-fill-history">
    <!-- 2026-10-28：只要能看到填报记录，就提供导出（含附件打包） -->
    <div class="history-header">
      <span class="history-title">填报记录（{{ sortedFills.length }}）</span>
      <el-button
        size="small"
        type="primary"
        plain
        :loading="exporting"
        :disabled="sortedFills.length === 0"
        @click="handleExportFills"
      >
        导出填报记录
      </el-button>
    </div>

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
          <!-- 2026-10-24 用户定案：「进度百分比」概念已废弃，统一为审核进度体系——
               上报记录卡只展示本轮自评进度（超前完成/正常/延期），不再显示进度% -->
          <div class="progress-block">
            <span class="muted-label">自评进度</span>
            <span
              v-if="resolveSelfRatingLabel(fill.selfRating)"
              class="self-rating-tag"
              :data-tone="resolveSelfRatingTone(fill.selfRating)"
            >
              {{ resolveSelfRatingLabel(fill.selfRating) }}
            </span>
            <span v-else class="self-rating-value self-rating-empty">未填写</span>
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

        <div v-if="fill.attachments?.length" class="history-extra">
          <span class="muted-label">上报资料（{{ fill.attachments.length }}）</span>
          <ul class="attachment-list">
            <li v-for="attachment in fill.attachments" :key="attachment.id" class="attachment-item">
              <button
                type="button"
                class="attachment-download"
                :disabled="downloadingAttachment === attachment.id"
                :title="`下载 ${attachment.fileName}`"
                @click.stop="downloadAttachment(attachment)"
              >
                {{ downloadingAttachment === attachment.id ? '下载中...' : '下载' }}
              </button>
              <span class="attachment-name">{{ attachment.fileName }}</span>
            </li>
          </ul>
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

        <!-- 2026-10-24 用户定案：卡片可点开查看该次上报的完整详情（含附件） -->
        <div class="history-open-hint">
          {{ detailLoading === String(fill.id) ? '正在打开...' : '点开查看本次上报详情 ›' }}
        </div>
      </button>
    </div>

    <!-- 2026-10-24：单次上报详情弹窗（组件内自包含，三个复用页面共同生效） -->
    <el-dialog v-model="fillDetailVisible" title="上报详情" width="560px" append-to-body>
      <div v-if="activeFill" class="fill-detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="填报日期">
            {{ formatDate(activeFill.fill_date) }}
          </el-descriptions-item>
          <el-descriptions-item label="审核状态">
            <el-tag size="small" :type="resolveStatusTagType(activeFill.status)">
              {{ resolveStatusLabel(activeFill.status) }}
            </el-tag>
          </el-descriptions-item>
          <!-- 2026-10-24 用户定案：进度百分比已废弃，统一为审核进度体系 -->
          <el-descriptions-item label="自评进度">
            <el-tag
              v-if="resolveSelfRatingLabel(activeFill.selfRating)"
              size="small"
              :data-tone="resolveSelfRatingTone(activeFill.selfRating)"
              class="self-rating-tag"
            >
              {{ resolveSelfRatingText(activeFill.selfRating) }}
            </el-tag>
            <span v-else class="fill-detail-muted">未填写</span>
          </el-descriptions-item>
          <el-descriptions-item label="填报人">
            {{ activeFill.filled_by_name || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="更新时间" :span="2">
            {{ formatDateTime(activeFill.updated_at) }}
          </el-descriptions-item>
          <el-descriptions-item label="填报说明" :span="2">
            {{ activeFill.content || '—' }}
          </el-descriptions-item>
          <el-descriptions-item v-if="activeFill.audit_comment" label="审核意见" :span="2">
            {{ activeFill.audit_comment }}
          </el-descriptions-item>
          <el-descriptions-item label="上报资料" :span="2">
            <div
              v-if="activeFill.attachments && activeFill.attachments.length"
              class="fill-detail-attachments"
            >
              <div
                v-for="attachment in activeFill.attachments"
                :key="attachment.id"
                class="fill-detail-attachment"
              >
                <span class="attachment-name">{{ attachment.fileName }}</span>
                <button
                  type="button"
                  class="attachment-download"
                  :disabled="downloadingAttachment === attachment.id"
                  @click="downloadAttachment(attachment)"
                >
                  {{ downloadingAttachment === attachment.id ? '下载中...' : '下载' }}
                </button>
              </div>
            </div>
            <span v-else class="fill-detail-muted">本次上报没有附件</span>
          </el-descriptions-item>
        </el-descriptions>
      </div>
      <template #footer>
        <el-button @click="fillDetailVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.indicator-fill-history {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 8px 0;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.history-title {
  font-size: 14px;
  font-weight: 600;
  color: #374151;
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

/* 2026-10-24：自评进度为空时的占位文本 */
.self-rating-value {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.self-rating-empty {
  color: #9ca3af;
  font-weight: 400;
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

/* 2026-10-24：上报记录卡上的自评进度标签 */
.self-rating-tag {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
}

.self-rating-tag[data-tone='ahead'] {
  background: #dbeafe;
  color: #1e40af;
}

.self-rating-tag[data-tone='normal'] {
  background: #dcfce7;
  color: #166534;
}

.self-rating-tag[data-tone='delayed'] {
  background: #fee2e2;
  color: #991b1b;
}

.self-rating-tag[data-tone='unknown'] {
  background: #f3f4f6;
  color: #4b5563;
}

.history-open-hint {
  margin-top: 4px;
  color: #2563eb;
  font-size: 12px;
  text-align: right;
}

/* 2026-10-24：单次上报详情弹窗 */
.fill-detail {
  padding: 4px 2px;
}

.fill-detail-muted {
  color: #9ca3af;
}

.fill-detail-attachments {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fill-detail-attachment {
  display: flex;
  align-items: center;
  gap: 8px;
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

.attachment-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.attachment-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.attachment-download {
  flex-shrink: 0;
  padding: 2px 10px;
  border: 1px solid #409eff;
  border-radius: 6px;
  background: #ecf5ff;
  color: #409eff;
  font-size: 12px;
  cursor: pointer;
}

.attachment-download:hover:not(:disabled) {
  background: #409eff;
  color: #fff;
}

.attachment-download:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.attachment-name {
  color: #374151;
  font-size: 13px;
  word-break: break-all;
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
