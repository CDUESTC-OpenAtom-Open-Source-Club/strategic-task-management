<template>
  <el-dialog
    v-model="dialogVisible"
    :title="dialogTitle"
    width="1000px"
    top="6vh"
    :close-on-click-modal="false"
    @closed="handleClosed"
  >
    <el-steps :active="activeStep" simple finish-status="success">
      <el-step title="选择文件" />
      <el-step title="解析预览" />
      <el-step title="确认导入" />
    </el-steps>

    <!-- ============ 第 1 步：选择文件 ============ -->
    <div v-show="activeStep === 0" class="step-panel">
      <el-alert type="info" :closable="false" show-icon class="mb-12">
        <template #title>{{ modeTip }}</template>
      </el-alert>

      <el-form label-width="96px" class="mb-12">
        <el-form-item label="归属月份">
          <el-date-picker
            v-model="pickedMonth"
            type="month"
            placeholder="选择本次导入归属的月份"
            :clearable="false"
            value-format="YYYYMM"
          />
        </el-form-item>
      </el-form>

      <el-upload
        ref="uploadRef"
        drag
        :auto-upload="false"
        :limit="1"
        accept=".xlsx,.xls"
        :file-list="fileList"
        :on-change="handleFileChange"
        :on-remove="handleFileRemove"
        :on-exceed="handleFileExceed"
      >
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
        <div class="el-upload__text">将文件拖到此处，或<em>点击选择</em></div>
        <template #tip>
          <div class="el-upload__tip">
            仅支持 .xlsx / .xls；请使用
            <el-button link type="primary" @click="handleDownloadTemplate">下载模板</el-button>
            填写，示例行请在正式导入前删除。
          </div>
        </template>
      </el-upload>
    </div>

    <!-- ============ 第 2 步：解析预览 ============ -->
    <div v-show="activeStep === 1" class="step-panel">
      <el-alert :type="previewSummaryType" :closable="false" show-icon class="mb-12">
        <template #title>{{ previewSummaryTitle }}</template>
      </el-alert>

      <div v-if="preview" class="group-list">
        <el-card
          v-for="(group, groupIndex) in preview.groups"
          :key="groupIndex"
          class="mb-12"
          shadow="never"
        >
          <template #header>
            <div class="group-header">
              <span class="group-title">{{ group.targetOrgName || '（未填写目标部门）' }}</span>
              <el-tag v-if="group.willSubmit" type="success" size="small">将提交</el-tag>
              <el-tag v-else-if="group.groupError" type="danger" size="small">错误组</el-tag>
              <el-tag v-else type="info" size="small">将跳过</el-tag>
              <span class="group-count">共 {{ group.rowsCount }} 行</span>
            </div>
          </template>

          <el-alert v-if="group.groupError" type="error" :closable="false" class="mb-8">
            {{ group.groupError }}
          </el-alert>
          <el-alert v-else-if="group.skipReason" type="info" :closable="false" class="mb-8">
            {{ group.skipReason }}
          </el-alert>

          <el-table :data="group.rows" size="small" border max-height="280">
            <el-table-column prop="rowNo" label="行" width="52" align="center" />
            <el-table-column
              prop="indicatorName"
              label="子指标名称"
              min-width="200"
              show-overflow-tooltip
            />
            <el-table-column prop="selfRating" label="自评等级" width="90" align="center" />
            <el-table-column prop="remark" label="进度说明" min-width="160" show-overflow-tooltip />
            <el-table-column label="结果" width="96" align="center">
              <template #default="{ row }">
                <el-tag v-if="row.errors?.length" type="danger" size="small">失败</el-tag>
                <el-tag v-else-if="!group.willSubmit" type="info" size="small">不导入</el-tag>
                <el-tag v-else type="success" size="small">将更新</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="提示" min-width="240">
              <template #default="{ row }">
                <div v-for="(error, index) in row.errors" :key="`e-${index}`" class="row-error">
                  {{ error }}
                </div>
                <div
                  v-for="(warning, index) in row.warnings"
                  :key="`w-${index}`"
                  class="row-warning"
                >
                  {{ warning }}
                </div>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </div>
    </div>

    <!-- ============ 第 3 步：确认导入 ============ -->
    <div v-show="activeStep === 2" class="step-panel">
      <el-alert :type="commitSummaryType" :closable="false" show-icon class="mb-12">
        <template #title>{{ commitSummaryTitle }}</template>
      </el-alert>

      <el-table :data="commitResults" size="small" border>
        <el-table-column prop="targetOrgName" label="目标部门" width="180" show-overflow-tooltip />
        <el-table-column label="结果" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'SUCCESS'" type="success" size="small">成功</el-tag>
            <el-tag v-else-if="row.status === 'SKIPPED'" type="info" size="small">跳过</el-tag>
            <el-tag v-else type="danger" size="small">失败</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="rowsCount" label="行数" width="80" align="center" />
        <el-table-column prop="message" label="说明" min-width="280" show-overflow-tooltip />
      </el-table>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleCancel">{{ activeStep === 2 ? '关闭' : '取消' }}</el-button>
        <el-button
          v-if="activeStep === 0"
          type="primary"
          :loading="previewing"
          @click="handlePreview"
        >
          解析预览
        </el-button>
        <el-button
          v-if="activeStep === 1"
          type="primary"
          :disabled="!preview || !preview.hasSubmittableGroup"
          :loading="committing"
          @click="handleCommit"
        >
          {{ variant === 'college-all' ? '确认批量导入' : '确认导入' }}
        </el-button>
        <el-button v-if="activeStep === 1" @click="handleBack">上一步</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { UploadFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { UploadFile, UploadInstance, UploadProps, UploadRawFile } from 'element-plus'
import {
  reportFillImportApi,
  type ReportFillCommitResponse,
  type ReportFillGroupResult,
  type ReportFillPreviewResponse
} from '@/features/import/api/reportFillImport'
import {
  buildReportFillGuideSheet,
  buildReportFillTemplateFileName,
  buildReportFillTemplateSheet,
  type ReportFillTemplateVariant
} from '@/features/import/lib/reportFillImportTemplate'
import { exportSheetsToExcel } from '@/shared/lib/export/excel'

/**
 * 2026-11-25（指标填报导入式上报）：导入弹窗。
 *
 * <p>UI 形态对齐既有「导入下发」弹窗（下载模板 → 解析预览 → 确认导入），
 * 但提交链路完全独立——本弹窗写的是**填报内容**（月报明细），不是下发指标。
 *
 * <p>三种变体对应标准模板 04/05/06：
 * <ul>
 *   <li>{@code func} = 04 职能部门上报（单点，目标恒为战略发展部）</li>
 *   <li>{@code college-single} = 05 学院上报单归口（只提交所选目标部门那条线）</li>
 *   <li>{@code college-all} = 06 学院上报多归口批量</li>
 * </ul>
 */
const props = defineProps<{
  visible: boolean
  /** 模板变体（决定表头措辞、说明页文案、提交模式） */
  variant: ReportFillTemplateVariant
  /** 考核周期 id；缺省时导入入口不可用 */
  cycleId?: number | null
  /** 默认归属月份（yyyyMM） */
  defaultReportMonth?: string
  /** 责任部门权威名称（写入模板「责任部门」列；应等于后端 sys_org.name） */
  responsibleOrgName?: string
  /** 单归口（college-single）时必须给：选中的目标部门（归口职能部门）id */
  targetOrgId?: number | null
}>()

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void
  (event: 'committed', value: ReportFillCommitResponse): void
}>()

const dialogVisible = computed({
  get: () => props.visible,
  set: value => emit('update:visible', value)
})

const activeStep = ref(0)
const uploadRef = ref<UploadInstance>()
const fileList = ref<UploadFile[]>([])
const previewing = ref(false)
const committing = ref(false)
const preview = ref<ReportFillPreviewResponse | null>(null)
const commitResults = ref<ReportFillGroupResult[]>([])
const pickedMonth = ref(props.defaultReportMonth ?? '')

/** 单归口入口必须显式传 single，否则后端会把文件里全部线一起提交 */
const previewMode = computed<'single' | 'all'>(() =>
  props.variant === 'college-single' ? 'single' : 'all'
)

const dialogTitle = computed(() => {
  if (props.variant === 'func') {
    return '导入填报 · 职能部门上报战略发展部'
  }
  if (props.variant === 'college-single') {
    return '导入填报 · 二级学院上报归口部门'
  }
  return '批量导入填报 · 二级学院上报多归口'
})

const modeTip = computed(() => {
  if (props.variant === 'func') {
    return '职能部门填报人上传本部门的月度填报表：责任部门 = 本部门，上报目标 = 战略发展部。'
  }
  if (props.variant === 'college-single') {
    return '一次导入一条归口线的月度填报数据：只提交当前选中的目标部门那条线，文件内其它线将跳过。'
  }
  return '一次导入本学院全部归口线的月度填报数据：按「目标部门」列自动拆线，各线独立提交、独立进入上报审批。'
})

const totalValidRows = computed(() => {
  if (!preview.value) {
    return 0
  }
  // 只统计「将提交」的线：把将跳过的行也算进去会让用户误以为那些行也会导入
  return preview.value.groups
    .filter(group => group.willSubmit)
    .reduce((sum, group) => sum + group.rows.filter(row => !row.errors?.length).length, 0)
})

/**
 * 从错误里取后端原文。
 *
 * <p>响应拦截器 reject 的是统一错误对象（对象字面量，**不是 Error 实例**），
 * 用 `instanceof Error` 判会永远走兜底文案，把后端原文（整单拒绝 + 行号点名）吞掉。
 */
function resolveErrorMessage(error: unknown, fallback: string): string {
  const candidate = (error as { message?: unknown } | null | undefined)?.message
  const text = typeof candidate === 'string' ? candidate.trim() : ''
  return text || fallback
}

const previewSummaryType = computed<'success' | 'warning' | 'error'>(() => {
  const current = preview.value
  if (!current) {
    return 'success'
  }
  if (!current.hasSubmittableGroup) {
    return 'error'
  }
  return current.groups.some(group => !group.willSubmit) ? 'warning' : 'success'
})

const previewSummaryTitle = computed(() => {
  const current = preview.value
  if (!current) {
    return '正在解析…'
  }
  const submittable = current.groups.filter(group => group.willSubmit).length
  const skipped = current.groups.filter(group => !group.willSubmit).length
  if (!current.hasSubmittableGroup) {
    return '没有可提交的上报线：请按下方提示修正后重新上传'
  }
  if (skipped > 0) {
    return `解析完成：${submittable} 条上报线将提交、${skipped} 条将跳过（${totalValidRows.value} 行可导入）`
  }
  return `解析完成：${current.groups.length} 条上报线、${totalValidRows.value} 行可导入`
})

const commitSummaryTitle = computed(() => {
  if (!commitResults.value.length) {
    return '导入结果'
  }
  const success = commitResults.value.filter(item => item.status === 'SUCCESS').length
  const failed = commitResults.value.filter(item => item.status === 'FAILED').length
  const skipped = commitResults.value.filter(item => item.status === 'SKIPPED').length
  const parts = [`成功 ${success} 条上报线`]
  if (skipped) {
    parts.push(`跳过 ${skipped} 条`)
  }
  if (failed) {
    parts.push(`失败 ${failed} 条`)
  }
  return `导入完成：${parts.join('，')}。已提交的上报线进入审批流程，审批通过后数据看板生效。`
})

const commitSummaryType = computed<'success' | 'warning' | 'error'>(() => {
  if (commitResults.value.some(item => item.status === 'FAILED')) {
    return 'error'
  }
  if (commitResults.value.some(item => item.status === 'SKIPPED')) {
    return 'warning'
  }
  return 'success'
})

watch(
  () => props.visible,
  visible => {
    if (visible) {
      activeStep.value = 0
      preview.value = null
      commitResults.value = []
      fileList.value = []
      pickedMonth.value = props.defaultReportMonth ?? ''
    }
  }
)

function handleClosed() {
  activeStep.value = 0
  preview.value = null
  commitResults.value = []
  fileList.value = []
}

function handleCancel() {
  dialogVisible.value = false
}

function handleBack() {
  activeStep.value = 0
}

const handleFileChange: UploadProps['onChange'] = (_uploadFile, uploadFiles) => {
  fileList.value = uploadFiles.slice(-1)
  preview.value = null
}

const handleFileRemove = () => {
  fileList.value = []
  preview.value = null
}

const handleFileExceed: UploadProps['onExceed'] = files => {
  uploadRef.value?.clearFiles()
  const file = files[0] as UploadRawFile
  uploadRef.value?.handleStart(file)
}

async function handleDownloadTemplate() {
  try {
    const dataSheet = buildReportFillTemplateSheet(props.variant, props.responsibleOrgName ?? '')
    const guideSheet = buildReportFillGuideSheet(props.variant)
    await exportSheetsToExcel(
      [dataSheet as unknown as never, guideSheet as unknown as never],
      buildReportFillTemplateFileName(props.variant)
    )
    ElMessage.success('模板下载成功')
  } catch (error) {
    console.error('[ReportFillImportDialog] 模板下载失败:', error)
    ElMessage.error('模板下载失败，请稍后重试')
  }
}

async function handlePreview() {
  const raw = fileList.value[0]?.raw
  if (!raw) {
    ElMessage.warning('请先选择要导入的 Excel 文件')
    return
  }
  if (!props.cycleId) {
    ElMessage.warning('当前考核周期不可用，无法导入')
    return
  }
  if (!pickedMonth.value) {
    ElMessage.warning('请选择归属月份')
    return
  }
  // 单归口模式必须能拿到目标部门 id：拿不到就明确拦下，
  // 绝不能让后端把「mode=single 但没给 id」当成批量处理（会误提交多条线）。
  if (previewMode.value === 'single' && !props.targetOrgId) {
    ElMessage.warning('目标部门尚未加载完成，请刷新页面后重试')
    return
  }

  previewing.value = true
  try {
    preview.value = await reportFillImportApi.preview(raw, {
      cycleId: props.cycleId,
      reportMonth: pickedMonth.value,
      mode: previewMode.value,
      targetOrgId: props.targetOrgId ?? null
    })
    activeStep.value = 1
  } catch (error) {
    console.error('[ReportFillImportDialog] 解析预览失败:', error)
    ElMessage.error(resolveErrorMessage(error, '解析预览失败，请稍后重试'))
  } finally {
    previewing.value = false
  }
}

async function handleCommit() {
  if (!preview.value) {
    return
  }
  committing.value = true
  try {
    const response = await reportFillImportApi.commit(preview.value.batchId, {
      confirmToken: preview.value.confirmToken,
      comment: ''
    })
    commitResults.value = response.results
    activeStep.value = 2
    emit('committed', response)
  } catch (error) {
    console.error('[ReportFillImportDialog] 确认导入失败:', error)
    ElMessage.error(resolveErrorMessage(error, '确认导入失败，请稍后重试'))
  } finally {
    committing.value = false
  }
}
</script>

<style scoped>
.step-panel {
  margin-top: 16px;
  min-height: 320px;
}

.mb-8 {
  margin-bottom: 8px;
}

.mb-12 {
  margin-bottom: 12px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.group-title {
  font-weight: 600;
}

.group-count {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.row-error {
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 18px;
}

.row-warning {
  color: var(--el-color-warning);
  font-size: 12px;
  line-height: 18px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
