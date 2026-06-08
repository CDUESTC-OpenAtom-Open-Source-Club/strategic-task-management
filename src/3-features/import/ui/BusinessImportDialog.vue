<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { QuestionFilled, Upload, UploadFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { UploadFile, UploadFiles } from 'element-plus'
import {
  businessImportApi,
  type BusinessImportType,
  type ConflictMode,
  type ImportCommitResponse,
  type ImportPreviewResponse,
  type ImportRowPreview
} from '@/features/import/api/businessImport'

const props = defineProps<{
  visible: boolean
  type: BusinessImportType
  targetOrgId?: number | null
  targetOrgName?: string | null
  sourceOrgId?: number | null
  sourceOrgName?: string | null
  cycleId?: number | null
}>()

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void
  (event: 'committed', value: ImportCommitResponse): void
}>()

const dialogVisible = computed({
  get: () => props.visible,
  set: value => emit('update:visible', value)
})

const fileList = ref<UploadFile[]>([])
const selectedFile = ref<UploadFile | null>(null)
const previewResult = ref<ImportPreviewResponse | null>(null)
const previewing = ref(false)
const committing = ref(false)
const autoSubmitAndApprove = ref(false)
const overwriteExisting = ref(false)
const guidePopoverVisible = ref(false)
let guidePopoverCloseTimer: ReturnType<typeof window.setTimeout> | null = null

interface ImportGuideColumn {
  key: string
  label: string
  required?: boolean
}

interface ImportGuideContent {
  title: string
  targetName: string
  columns: ImportGuideColumn[]
  rows: Record<string, string>[]
  rules: string[]
}

const isStrategicImport = computed(() => props.type === 'strategic-task')
const dialogTitle = computed(() =>
  isStrategicImport.value ? '导入职能部门指标表' : '导入学院子指标表'
)
const targetLabel = computed(() => (isStrategicImport.value ? '当前职能部门' : '当前学院'))
const canPreview = computed(
  () => Boolean(selectedFile.value?.raw) && Boolean(props.targetOrgId) && Boolean(props.cycleId)
)

const visibleRows = computed(() => previewResult.value?.rows.slice(0, 20) ?? [])
const strategicImportGuide: ImportGuideContent = {
  title: '职能部门指标表示例',
  targetName: '职能部门',
  columns: [
    { key: 'department', label: '职能部门' },
    { key: 'taskType', label: '任务类型', required: true },
    { key: 'strategicTask', label: '战略任务', required: true },
    { key: 'indicatorName', label: '核心指标', required: true },
    { key: 'indicatorType', label: '指标类型', required: true },
    { key: 'weight', label: '权重' },
    { key: 'milestones', label: '里程碑明细' },
    { key: 'remark', label: '备注' }
  ],
  rows: [
    {
      department: '教务处',
      taskType: '发展性',
      strategicTask: '推进本科教育教学改革',
      indicatorName: '建设智慧教学质量监测体系',
      indicatorType: '定量',
      weight: '20%',
      milestones:
        '1. 完成方案设计（2026-03-31，30%）\n2. 完成平台试运行（2026-06-30，70%）\n3. 完成年度评估（2026-12-31，100%）',
      remark: '可填写说明'
    },
    {
      department: '教务处',
      taskType: '基础性',
      strategicTask: '完善专业建设质量保障机制',
      indicatorName: '完成重点专业年度质量报告',
      indicatorType: '定性',
      weight: '15',
      milestones: '质量报告初稿（2026-09-30，60%）\n正式提交（2026-12-31，100%）',
      remark: ''
    }
  ],
  rules: [
    '表头建议放在第一行，列顺序可以调整，系统会按列名识别。',
    '带 * 的列为必填；如果填写职能部门，必须和当前选择的职能部门一致。',
    '权重支持 10、10%、0.1 三种写法，系统会统一换算为百分制。',
    '里程碑可以放在一个单元格内多行填写，日期支持 2026-03-31 或 2026-03-31 00:00。'
  ]
}
const distributionImportGuide: ImportGuideContent = {
  title: '学院子指标表示例',
  targetName: '学院',
  columns: [
    { key: 'college', label: '学院' },
    { key: 'parentStrategicTask', label: '父级战略任务' },
    { key: 'parentIndicator', label: '父级核心指标', required: true },
    { key: 'indicatorName', label: '子指标名称', required: true },
    { key: 'indicatorType', label: '指标类型', required: true },
    { key: 'weight', label: '权重' },
    { key: 'milestones', label: '里程碑明细' },
    { key: 'remark', label: '备注' }
  ],
  rows: [
    {
      college: '计算机学院',
      parentStrategicTask: '推进本科教育教学改革',
      parentIndicator: '建设智慧教学质量监测体系',
      indicatorName: '完成学院课程质量数据接入',
      indicatorType: '定量',
      weight: '40%',
      milestones:
        '1. 完成课程清单梳理（2026-04-30，40%）\n2. 完成数据接入与核验（2026-09-30，80%）\n3. 完成年度归档（2026-12-31，100%）',
      remark: '按父级指标拆分'
    },
    {
      college: '计算机学院',
      parentStrategicTask: '完善专业建设质量保障机制',
      parentIndicator: '完成重点专业年度质量报告',
      indicatorName: '提交学院专业质量分析报告',
      indicatorType: '定性',
      weight: '60',
      milestones: '报告初稿（2026-10-31，70%）\n正式提交（2026-12-20，100%）',
      remark: ''
    }
  ],
  rules: [
    '表头建议放在第一行，列顺序可以调整，系统会按列名识别。',
    '带 * 的列为必填；如果填写学院，必须和当前选择的学院一致。',
    '父级核心指标必须能匹配当前职能部门已接收或可拆分的父级指标。',
    '权重按同一父级指标下的学院子指标合计检查，合计不是 100 会给出警告。'
  ]
}
const currentGuide = computed(() =>
  isStrategicImport.value ? strategicImportGuide : distributionImportGuide
)

const clearGuidePopoverCloseTimer = () => {
  if (guidePopoverCloseTimer) {
    window.clearTimeout(guidePopoverCloseTimer)
    guidePopoverCloseTimer = null
  }
}

const showGuidePopover = () => {
  clearGuidePopoverCloseTimer()
  guidePopoverVisible.value = true
}

const scheduleHideGuidePopover = () => {
  clearGuidePopoverCloseTimer()
  guidePopoverCloseTimer = window.setTimeout(() => {
    guidePopoverVisible.value = false
    guidePopoverCloseTimer = null
  }, 120)
}

const handleFileChange = (uploadFile: UploadFile, uploadFiles: UploadFiles) => {
  fileList.value = uploadFiles.slice(-1)
  selectedFile.value = fileList.value[0] ?? uploadFile
  previewResult.value = null
}

const handleFileRemove = (_uploadFile: UploadFile, uploadFiles: UploadFiles) => {
  fileList.value = uploadFiles
  selectedFile.value = uploadFiles[0] ?? null
  previewResult.value = null
}

const handlePreview = async () => {
  if (!selectedFile.value?.raw) {
    ElMessage.warning('请先选择 Excel 文件')
    return
  }
  if (!props.targetOrgId || !props.cycleId) {
    ElMessage.warning('当前页面缺少导入目标或周期信息')
    return
  }

  previewing.value = true
  try {
    previewResult.value = isStrategicImport.value
      ? await businessImportApi.previewStrategicTaskImport(selectedFile.value.raw, {
          cycleId: props.cycleId,
          targetOrgId: props.targetOrgId
        })
      : await businessImportApi.previewDistributionImport(selectedFile.value.raw, {
          cycleId: props.cycleId,
          sourceOrgId: props.sourceOrgId || undefined,
          targetCollegeOrgId: props.targetOrgId
        })
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入解析失败')
  } finally {
    previewing.value = false
  }
}

const handleCommit = async () => {
  if (!previewResult.value) {
    ElMessage.warning('请先解析预览')
    return
  }
  if (previewResult.value.blocking) {
    ElMessage.warning('当前导入存在错误，请修正后重新上传')
    return
  }

  committing.value = true
  try {
    const request = {
      confirmToken: previewResult.value.confirmToken,
      conflictMode: (overwriteExisting.value ? 'UPDATE' : 'APPEND') as ConflictMode,
      autoSubmitAndApprove: autoSubmitAndApprove.value,
      comment: autoSubmitAndApprove.value ? '导入后自动下发审批' : '确认导入'
    }
    const result = isStrategicImport.value
      ? await businessImportApi.commitStrategicTaskImport(previewResult.value.batchId, request)
      : await businessImportApi.commitDistributionImport(previewResult.value.batchId, request)

    const workflowMessage = result.workflow?.message ? `，${result.workflow.message}` : ''
    ElMessage.success(
      `导入成功：新增 ${result.createdCount} 条，更新 ${result.updatedCount} 条${workflowMessage}`
    )
    emit('committed', result)
    dialogVisible.value = false
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '确认导入失败')
  } finally {
    committing.value = false
  }
}

const actionTagType = (action: ImportRowPreview['action']) => {
  if (action === 'CREATE') return 'success'
  if (action === 'UPDATE') return 'warning'
  if (action === 'SKIP') return 'info'
  return 'danger'
}

const actionText = (action: ImportRowPreview['action']) => {
  if (action === 'CREATE') return '新增'
  if (action === 'UPDATE') return '更新'
  if (action === 'SKIP') return '跳过'
  return '错误'
}

watch(
  () => props.visible,
  value => {
    if (!value) {
      fileList.value = []
      selectedFile.value = null
      previewResult.value = null
      previewing.value = false
      committing.value = false
      autoSubmitAndApprove.value = false
      overwriteExisting.value = false
      guidePopoverVisible.value = false
      clearGuidePopoverCloseTimer()
    }
  }
)
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    width="min(860px, calc(100vw - 32px))"
    :close-on-click-modal="!previewing && !committing"
  >
    <template #header>
      <div class="business-import-header">
        <span class="business-import-title">{{ dialogTitle }}</span>
        <el-popover
          v-model:visible="guidePopoverVisible"
          trigger="manual"
          placement="bottom-end"
          width="min(960px, calc(100vw - 32px))"
        >
          <div
            class="business-import-guide"
            @mouseenter="showGuidePopover"
            @mouseleave="scheduleHideGuidePopover"
          >
            <div class="guide-title">{{ currentGuide.title }}</div>
            <div class="guide-context">
              <span>{{ currentGuide.targetName }}</span>
              <strong>{{ targetOrgName || '当前选择对象' }}</strong>
              <span>周期</span>
              <strong>{{ cycleId || '-' }}</strong>
            </div>

            <div class="guide-table-scroll" role="region" aria-label="导入示例表格">
              <table class="guide-table">
                <thead>
                  <tr>
                    <th v-for="column in currentGuide.columns" :key="column.key">
                      {{ column.label }}<span v-if="column.required" class="required-mark">*</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, rowIndex) in currentGuide.rows" :key="rowIndex">
                    <td v-for="column in currentGuide.columns" :key="column.key">
                      {{ row[column.key] || '-' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <ul class="guide-rules">
              <li v-for="rule in currentGuide.rules" :key="rule">{{ rule }}</li>
            </ul>
          </div>

          <template #reference>
            <el-button
              class="import-guide-button"
              :icon="QuestionFilled"
              text
              type="primary"
              @mouseenter="showGuidePopover"
              @mouseleave="scheduleHideGuidePopover"
            >
              详情？
            </el-button>
          </template>
        </el-popover>
      </div>
    </template>

    <div class="business-import-dialog">
      <div class="business-import-summary">
        <div>
          <span class="summary-label">{{ targetLabel }}</span>
          <strong>{{ targetOrgName || '未选择' }}</strong>
        </div>
        <div v-if="!isStrategicImport">
          <span class="summary-label">来源职能部门</span>
          <strong>{{ sourceOrgName || '当前账号部门' }}</strong>
        </div>
        <div>
          <span class="summary-label">当前周期</span>
          <strong>{{ cycleId || '-' }}</strong>
        </div>
      </div>

      <el-upload
        drag
        accept=".xlsx"
        :auto-upload="false"
        :limit="1"
        :file-list="fileList"
        :on-change="handleFileChange"
        :on-remove="handleFileRemove"
      >
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
        <div class="el-upload__text">拖拽 Excel 文件到这里，或点击选择</div>
        <template #tip>
          <div class="el-upload__tip">仅支持 .xlsx，一次只导入当前选中的部门或学院。</div>
        </template>
      </el-upload>

      <div class="business-import-actions">
        <el-button
          :icon="Upload"
          :loading="previewing"
          :disabled="!canPreview"
          @click="handlePreview"
        >
          解析预览
        </el-button>
      </div>

      <template v-if="previewResult">
        <el-divider />
        <div class="preview-stat-grid">
          <div class="preview-stat">
            <span>有效行</span>
            <strong>{{ previewResult.summary.validRows }}</strong>
          </div>
          <div class="preview-stat">
            <span>新增</span>
            <strong>{{ previewResult.summary.createRows }}</strong>
          </div>
          <div class="preview-stat">
            <span>更新</span>
            <strong>{{ previewResult.summary.updateRows }}</strong>
          </div>
          <div class="preview-stat" :class="{ danger: previewResult.summary.errorRows > 0 }">
            <span>错误</span>
            <strong>{{ previewResult.summary.errorRows }}</strong>
          </div>
          <div class="preview-stat" :class="{ warning: previewResult.summary.warningRows > 0 }">
            <span>警告</span>
            <strong>{{ previewResult.summary.warningRows }}</strong>
          </div>
        </div>

        <el-alert
          v-if="previewResult.blocking"
          type="error"
          :closable="false"
          show-icon
          title="当前文件存在阻断错误，不能确认导入"
        />
        <el-alert
          v-else
          type="success"
          :closable="false"
          show-icon
          title="预览通过，可以确认导入"
        />

        <el-table :data="visibleRows" max-height="320" class="preview-table">
          <el-table-column prop="rowNo" label="行号" width="70" />
          <el-table-column label="动作" width="80">
            <template #default="{ row }">
              <el-tag :type="actionTagType(row.action)" size="small">
                {{ actionText(row.action) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            v-if="isStrategicImport"
            label="战略任务"
            min-width="160"
            show-overflow-tooltip
          >
            <template #default="{ row }">{{ row.normalized.strategicTask }}</template>
          </el-table-column>
          <el-table-column v-else label="父级指标" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ row.normalized.parentIndicator }}</template>
          </el-table-column>
          <el-table-column label="指标" min-width="180" show-overflow-tooltip>
            <template #default="{ row }">{{ row.normalized.indicatorName }}</template>
          </el-table-column>
          <el-table-column label="类型" width="90">
            <template #default="{ row }">{{ row.normalized.indicatorType }}</template>
          </el-table-column>
          <el-table-column label="权重" width="90">
            <template #default="{ row }">{{ row.normalized.weight || '-' }}</template>
          </el-table-column>
          <el-table-column label="问题" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.errors?.length" class="preview-error">{{
                row.errors.join('；')
              }}</span>
              <span v-else-if="row.warnings?.length" class="preview-warning">
                {{ row.warnings.join('；') }}
              </span>
              <span v-else>-</span>
            </template>
          </el-table-column>
        </el-table>
      </template>

      <div class="commit-options">
        <el-checkbox v-model="overwriteExisting">覆盖已有数据</el-checkbox>
        <el-checkbox v-model="autoSubmitAndApprove">导入后自动发起并完成审批</el-checkbox>
      </div>
    </div>

    <template #footer>
      <div class="business-import-footer">
        <el-button :disabled="previewing || committing" @click="dialogVisible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="committing"
          :disabled="!previewResult || previewResult.blocking"
          @click="handleCommit"
        >
          确认导入
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.business-import-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-right: 32px;
}

.business-import-title {
  color: #111827;
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
}

.import-guide-button {
  min-height: 36px;
  padding-inline: 10px;
}

.business-import-dialog {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.business-import-summary {
  display: flex;
  gap: 24px;
  color: #374151;
}

.summary-label {
  margin-right: 8px;
  color: #6b7280;
}

.business-import-actions {
  display: flex;
  justify-content: flex-end;
}

.preview-stat-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.preview-stat {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 10px 12px;
  background: #f9fafb;
}

.preview-stat span {
  display: block;
  color: #6b7280;
  font-size: 12px;
}

.preview-stat strong {
  display: block;
  margin-top: 4px;
  font-size: 18px;
  color: #111827;
}

.preview-stat.danger strong {
  color: #dc2626;
}

.preview-stat.warning strong {
  color: #d97706;
}

.preview-table {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
}

.preview-error {
  color: #dc2626;
}

.preview-warning {
  color: #d97706;
}

.commit-options {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.business-import-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.business-import-footer :deep(.el-button + .el-button) {
  margin-left: 0;
}

.business-import-guide {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: min(70vh, 620px);
  overflow-y: auto;
}

.guide-title {
  color: #111827;
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
}

.guide-context {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  color: #6b7280;
  line-height: 24px;
}

.guide-context strong {
  color: #111827;
}

.guide-table-scroll {
  width: 100%;
  overflow-x: auto;
  border: 1px solid #d1d5db;
  border-radius: 6px;
}

.guide-table {
  width: 100%;
  min-width: 900px;
  border-collapse: collapse;
  background: #fff;
  table-layout: fixed;
}

.guide-table th,
.guide-table td {
  border-bottom: 1px solid #e5e7eb;
  border-right: 1px solid #e5e7eb;
  padding: 10px 12px;
  color: #374151;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  vertical-align: top;
  white-space: pre-line;
  word-break: break-word;
}

.guide-table th {
  background: #f3f4f6;
  color: #111827;
  font-weight: 600;
}

.guide-table th:last-child,
.guide-table td:last-child {
  border-right: 0;
}

.guide-table tbody tr:last-child td {
  border-bottom: 0;
}

.required-mark {
  margin-left: 2px;
  color: #dc2626;
}

.guide-rules {
  margin: 0;
  padding-left: 18px;
  color: #4b5563;
  font-size: 13px;
  line-height: 22px;
}

@media (max-width: 640px) {
  .business-import-header {
    align-items: flex-start;
    flex-direction: column;
    padding-right: 24px;
  }

  .import-guide-button {
    min-height: 44px;
  }

  .business-import-summary,
  .commit-options,
  .business-import-footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .business-import-footer :deep(.el-button) {
    width: 100%;
  }

  .preview-stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
