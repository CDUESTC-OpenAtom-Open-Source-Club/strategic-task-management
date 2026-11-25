<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, type UploadFile, type UploadInstance } from 'element-plus'
import { Document, UploadFilled } from '@element-plus/icons-vue'
import {
  reportFillImportApi,
  type ReportFillCommitResponse,
  type ReportFillPreviewResponse,
  type ReportFillPreviewRow
} from '../api/reportFillImport'
import {
  downloadReportFillTemplate,
  type ReportFillTemplateMode,
  type ReportFillTemplateRow
} from '../lib/reportFillImportTemplate'
import { formatLocalDateTag } from '@/shared/lib/utils/localDateTag'

/**
 * 2026-11-25（二级学院填报导入）：填报页「导入 / 批量导入」弹窗。
 *
 * 三步与「导入学院子指标表」一致（选择文件 → 解析预览 → 确认导入），
 * 但**没有**「导入后自动发起并完成审批」——导入只落草稿，是否上报由「一键提交」决定。
 * 学院取自登录身份，模板里的「学院」列必须与之一致（后端二次校验）。
 */
const props = defineProps<{
  modelValue: boolean
  mode: ReportFillTemplateMode
  cycleId: number | null
  cycleName: string
  reportMonth: string
  collegeName: string
  sourceDeptName: string
  functionalDeptText: string
  templateRows: ReportFillTemplateRow[]
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'imported'): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

const uploadRef = ref<UploadInstance>()
const step = ref(0)
const selectedFile = ref<File | null>(null)
const selectedFileName = ref('')
const parsing = ref(false)
const committing = ref(false)
const downloading = ref(false)
const preview = ref<ReportFillPreviewResponse | null>(null)
const commitResult = ref<ReportFillCommitResponse | null>(null)

const scopeText = computed(() =>
  props.mode === 'batch' ? '批量导入（多归口）' : '导入（当前归口）'
)
const cycleText = computed(() => props.cycleName || '—')
const monthText = computed(() => {
  if (!props.reportMonth || props.reportMonth.length !== 6) {
    return '—'
  }
  return `${props.reportMonth.slice(0, 4)} 年 ${Number(props.reportMonth.slice(4))} 月`
})

const summary = computed(() => preview.value?.summary ?? null)
const canCommit = computed(() => Boolean(summary.value && summary.value.validRows > 0))
const actionTagType: Record<string, 'primary' | 'info' | 'danger'> = {
  UPDATE: 'primary',
  SKIP: 'info',
  ERROR: 'danger'
}
const actionLabel: Record<string, string> = {
  UPDATE: '待写入',
  SKIP: '无变化',
  ERROR: '有错误'
}
/** 计划状态英文枚举 → 中文，避免预览里出现 DISTRIBUTED 这类内部值。 */
const planStatusLabel: Record<string, string> = {
  DRAFT: '草稿',
  PENDING: '待审批',
  IN_REVIEW: '审批中',
  DISTRIBUTED: '已下发',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  RETURNED: '已退回',
  WITHDRAWN: '已撤回'
}

function planStatusText(status?: string | null) {
  if (!status) {
    return '未下发'
  }
  return planStatusLabel[status] ?? status
}

watch(
  () => props.modelValue,
  value => {
    if (value) {
      reset()
    }
  }
)

function reset() {
  step.value = 0
  selectedFile.value = null
  selectedFileName.value = ''
  preview.value = null
  commitResult.value = null
  parsing.value = false
  committing.value = false
  uploadRef.value?.clearFiles()
}

function close() {
  visible.value = false
}

async function handleTemplateDownload() {
  if (!props.collegeName) {
    ElMessage.warning('未识别到登录学院，暂不能下载模板')
    return
  }
  if (props.templateRows.length === 0) {
    ElMessage.warning('当前没有可预填的已下发指标，请等待职能部门下发后再下载模板')
    return
  }
  downloading.value = true
  try {
    await downloadReportFillTemplate(
      props.mode,
      props.templateRows,
      props.collegeName,
      formatLocalDateTag(new Date())
    )
  } catch (error) {
    console.error('[ReportFillImportDialog] 模板下载失败', error)
    ElMessage.error('模板下载失败，请稍后重试')
  } finally {
    downloading.value = false
  }
}

async function handleFileChange(uploadFile: UploadFile) {
  const raw = uploadFile.raw
  if (!raw) {
    return
  }
  if (!raw.name.toLowerCase().endsWith('.xlsx')) {
    ElMessage.warning('仅支持 .xlsx 格式的 Excel 文件')
    uploadRef.value?.clearFiles()
    return
  }
  if (!props.cycleId) {
    ElMessage.warning('未识别到当前考核周期，请刷新页面后重试')
    return
  }
  selectedFile.value = raw
  selectedFileName.value = raw.name
}

/** 显式「解析预览」：与「导入学院子指标表」一致，选完文件后再点按钮进入第二步。 */
async function handleParsePreview() {
  if (!selectedFile.value) {
    ElMessage.warning('请先选择要导入的 Excel 文件')
    return
  }
  await runPreview(selectedFile.value)
}

async function runPreview(file: File) {
  parsing.value = true
  preview.value = null
  try {
    preview.value = await reportFillImportApi.preview(file, {
      cycleId: Number(props.cycleId),
      reportMonth: props.reportMonth
    })
    step.value = 1
    if (preview.value.summary.validRows === 0) {
      ElMessage.warning('没有可写入的行，请按错误提示修改模板后重新上传')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '解析失败，请稍后重试'
    ElMessage.error(message)
    uploadRef.value?.clearFiles()
    selectedFile.value = null
  } finally {
    parsing.value = false
  }
}

async function handleCommit() {
  const current = preview.value
  if (!current) {
    return
  }
  committing.value = true
  try {
    const result = await reportFillImportApi.commit(current.batchId, {
      confirmToken: current.confirmToken,
      comment: '填报导入'
    })
    commitResult.value = result
    step.value = 2
    if (result.totalSaved > 0) {
      ElMessage.success(`导入完成：写入 ${result.totalSaved} 条填报草稿`)
      emit('imported')
    } else {
      ElMessage.error('导入未写入，请查看失败原因')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '导入失败，请稍后重试'
    ElMessage.error(message)
  } finally {
    committing.value = false
  }
}

function handleReselect() {
  step.value = 0
  preview.value = null
  uploadRef.value?.clearFiles()
}

function rowDescription(row: ReportFillPreviewRow) {
  return row.description || '—'
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="`指标填报${mode === 'batch' ? '批量导入' : '导入'}`"
    width="820px"
    :close-on-click-modal="false"
    class="report-fill-import-dialog"
  >
    <div class="import-meta">
      <span
        >当前学院：<strong>{{ collegeName || '—' }}</strong></span
      >
      <span
        >来源职能部门：<strong>{{ sourceDeptName || '—' }}</strong></span
      >
      <span
        >归口部门：<strong>{{ functionalDeptText || '—' }}</strong></span
      >
      <span
        >当前周期：<strong>{{ cycleText }}</strong></span
      >
      <span
        >填报月份：<strong>{{ monthText }}</strong></span
      >
    </div>

    <el-steps :active="step" align-center finish-status="success" class="import-steps">
      <el-step title="选择文件" />
      <el-step title="解析预览" />
      <el-step title="确认导入" />
    </el-steps>

    <!-- 第一步：选择文件 -->
    <div v-if="step === 0" class="step-body">
      <el-upload
        ref="uploadRef"
        drag
        :auto-upload="false"
        :show-file-list="true"
        :limit="1"
        accept=".xlsx"
        :disabled="parsing"
        :on-change="handleFileChange"
      >
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
        <div class="el-upload__text">拖拽 Excel 文件到这里，或点击选择</div>
        <template #tip>
          <div class="el-upload__tip">
            仅支持 .xlsx，单次最多 500 行（{{ scopeText }}）。自评等级三选一（超前 / 正常 /
            滞后），进度说明必填。
          </div>
        </template>
      </el-upload>

      <div class="template-bar">
        <span class="template-tip">
          模板里的「学院」已按登录身份固定；只有自评等级与进度说明需要填写。
        </span>
        <el-button link type="primary" :loading="downloading" @click="handleTemplateDownload">
          <el-icon><Document /></el-icon>
          下载{{ mode === 'batch' ? '批量' : '' }}模板
        </el-button>
      </div>

      <div class="step-actions">
        <el-button
          type="primary"
          :loading="parsing"
          :disabled="!selectedFile || parsing"
          @click="handleParsePreview"
        >
          解析预览
        </el-button>
        <span class="step-actions-tip">
          {{
            selectedFileName ? `已选择：${selectedFileName}` : '上传文件后先解析预览，再确认导入。'
          }}
        </span>
      </div>

      <div v-if="parsing" class="parsing-tip">正在解析文件，请稍候…</div>
    </div>

    <!-- 第二步：预览 -->
    <div v-else-if="step === 1" class="step-body">
      <div class="preview-summary">
        <span>{{ selectedFileName }}</span>
        <span v-if="summary">
          共 {{ summary.totalRows }} 行 · 可写入 <strong>{{ summary.validRows }}</strong> 行 ·
          无变化 {{ summary.skipRows }} 行 · 错误
          <strong class="is-error">{{ summary.errorRows }}</strong> 行
        </span>
      </div>

      <div
        v-for="group in preview?.groups ?? []"
        :key="group.functionalOrgName"
        class="group-block"
      >
        <div class="group-title">
          <span>{{ group.functionalOrgName }}</span>
          <span class="group-sub">
            计划 {{ group.planId ?? '—' }} · {{ planStatusText(group.planStatus) }}
            <template v-if="group.reportStatus">
              · 本批写入{{
                group.reportStatus === 'DRAFT' ? '草稿' : '已有报告 ' + group.reportStatus
              }}
            </template>
          </span>
        </div>
        <div v-if="group.errors.length > 0" class="group-errors">
          <p v-for="error in group.errors" :key="error">{{ error }}</p>
        </div>
        <el-table :data="group.rows" size="small" border max-height="220">
          <el-table-column prop="rowNo" label="行" width="60" />
          <el-table-column
            prop="indicatorName"
            label="子指标名称"
            min-width="180"
            show-overflow-tooltip
          />
          <el-table-column label="权重" width="70" align="center">
            <template #default="{ row }">{{ row.weight || '—' }}</template>
          </el-table-column>
          <el-table-column label="自评等级" width="100" align="center">
            <template #default="{ row }">{{ row.selfRatingLabel || '—' }}</template>
          </el-table-column>
          <el-table-column label="进度说明" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">{{ rowDescription(row) }}</template>
          </el-table-column>
          <el-table-column label="校验" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="actionTagType[row.action] ?? 'info'" size="small">
                {{ actionLabel[row.action] ?? row.action }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="提示" min-width="240" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="row.errors.length > 0" class="is-error">{{ row.errors.join('；') }}</span>
              <span v-else-if="row.warnings.length > 0" class="is-warning">
                {{ row.warnings.join('；') }}
              </span>
              <span v-else>—</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <p class="commit-note">
        确认导入只写入草稿，不会自动发起审批；如需上报，请在列表页点「一键提交」。
      </p>
    </div>

    <!-- 第三步：结果 -->
    <div v-else class="step-body">
      <el-result
        :icon="commitResult && commitResult.totalSaved > 0 ? 'success' : 'warning'"
        :title="commitResult && commitResult.totalSaved > 0 ? '导入完成' : '导入未写入'"
        :sub-title="
          commitResult
            ? `写入 ${commitResult.totalSaved} 条，失败分组 ${commitResult.blockedGroups} 个`
            : ''
        "
      />
      <el-table v-if="commitResult" :data="commitResult.groups" size="small" border>
        <el-table-column prop="functionalOrgName" label="归口职能部门" min-width="180" />
        <el-table-column prop="planId" label="计划线" width="100" align="center" />
        <el-table-column prop="savedRows" label="写入行数" width="100" align="center" />
        <el-table-column prop="message" label="结果" min-width="240" show-overflow-tooltip />
      </el-table>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button v-if="step === 1" :disabled="committing" @click="handleReselect">
          重新选择文件
        </el-button>
        <el-button v-if="step !== 2" :disabled="committing" @click="close">取消</el-button>
        <el-button
          v-if="step === 1"
          type="primary"
          :loading="committing"
          :disabled="!canCommit"
          @click="handleCommit"
        >
          确认导入
        </el-button>
        <el-button v-if="step === 2" type="primary" @click="close">完成</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.import-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  padding: 8px 4px 16px;
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.import-steps {
  margin-bottom: 18px;
}

.step-body {
  min-height: 220px;
}

.template-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 12px;
}

.template-tip {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.parsing-tip {
  margin-top: 12px;
  color: var(--el-color-primary);
  font-size: 13px;
}

.step-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

.step-actions-tip {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.preview-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 12px;
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.group-block {
  margin-bottom: 16px;
}

.group-title {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 6px;
  font-weight: 600;
}

.group-sub {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  font-weight: 400;
}

.group-errors {
  margin-bottom: 8px;
  color: var(--el-color-danger);
  font-size: 12px;
}

.group-errors p {
  margin: 2px 0;
}

.is-error {
  color: var(--el-color-danger);
}

.is-warning {
  color: var(--el-color-warning);
}

.commit-note {
  margin-top: 12px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
