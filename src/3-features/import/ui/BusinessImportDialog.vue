<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Upload, UploadFilled } from '@element-plus/icons-vue'
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
const conflictMode = ref<ConflictMode>('UPDATE')
const autoSubmitAndApprove = ref(false)

const isStrategicImport = computed(() => props.type === 'strategic-task')
const dialogTitle = computed(() =>
  isStrategicImport.value ? '导入职能部门指标表' : '导入学院子指标表'
)
const targetLabel = computed(() => (isStrategicImport.value ? '当前职能部门' : '当前学院'))
const canPreview = computed(
  () => Boolean(selectedFile.value?.raw) && Boolean(props.targetOrgId) && Boolean(props.cycleId)
)

const visibleRows = computed(() => previewResult.value?.rows.slice(0, 20) ?? [])

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
      conflictMode: conflictMode.value,
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
      conflictMode.value = 'UPDATE'
      autoSubmitAndApprove.value = false
    }
  }
)
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    :title="dialogTitle"
    width="860px"
    :close-on-click-modal="!previewing && !committing"
  >
    <div class="business-import-dialog">
      <div class="business-import-summary">
        <div>
          <span class="summary-label">{{ targetLabel }}</span>
          <strong>{{ targetOrgName || '未选择' }}</strong>
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

        <div class="commit-options">
          <el-radio-group v-model="conflictMode">
            <el-radio-button label="UPDATE">更新已有</el-radio-button>
            <el-radio-button label="APPEND">追加新增</el-radio-button>
          </el-radio-group>
          <el-checkbox v-model="autoSubmitAndApprove">导入后自动发起并完成下发审批</el-checkbox>
        </div>
      </template>
    </div>

    <template #footer>
      <el-button :disabled="previewing || committing" @click="dialogVisible = false"
        >取消</el-button
      >
      <el-button
        type="primary"
        :loading="committing"
        :disabled="!previewResult || previewResult.blocking"
        @click="handleCommit"
      >
        确认导入
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
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
</style>
