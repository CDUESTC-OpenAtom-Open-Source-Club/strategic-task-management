<template>
  <el-dialog
    v-model="dialogVisible"
    :title="dialogTitle"
    width="980px"
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
          v-for="group in preview.groups"
          :key="group.functionalOrgName"
          class="mb-12"
          shadow="never"
        >
          <template #header>
            <div class="group-header">
              <span class="group-title">{{
                group.functionalOrgName || '（未填写归口职能部门）'
              }}</span>
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

          <el-table :data="group.rows" size="small" border max-height="260">
            <el-table-column prop="rowNo" label="行" width="52" align="center" />
            <el-table-column
              prop="indicatorName"
              label="子指标名称"
              min-width="200"
              show-overflow-tooltip
            />
            <el-table-column
              prop="functionalDept"
              label="归口职能部门"
              width="140"
              show-overflow-tooltip
            />
            <el-table-column prop="selfRating" label="自评等级" width="90" align="center" />
            <el-table-column prop="remark" label="进度说明" min-width="180" show-overflow-tooltip />
            <el-table-column label="结果" width="120" align="center">
              <template #default="{ row }">
                <el-tag v-if="row.errors?.length" type="danger" size="small">失败</el-tag>
                <el-tag v-else type="success" size="small">将更新</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="提示" min-width="220">
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
        <el-table-column
          prop="functionalOrgName"
          label="归口职能部门"
          width="160"
          show-overflow-tooltip
        />
        <el-table-column label="结果" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'SUCCESS'" type="success" size="small">成功</el-tag>
            <el-tag v-else-if="row.status === 'SKIPPED'" type="info" size="small">跳过</el-tag>
            <el-tag v-else type="danger" size="small">失败</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="rowsCount" label="行数" width="80" align="center" />
        <el-table-column prop="message" label="说明" min-width="260" show-overflow-tooltip />
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
          {{ mode === 'all' ? '确认批量导入' : '确认导入' }}
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
  type ReportFillImportMode
} from '@/features/import/lib/reportFillImportTemplate'
import { exportSheetsToExcel } from '@/shared/lib/export/excel'

/**
 * 2026-11-25（指标填报导入式上报 · 学院侧）：导入弹窗。
 *
 * <p>UI 形态对齐既有「导入下发」弹窗（下载模板 → 解析预览 → 确认导入），
 * 但提交链路完全独立——本弹窗写的是**填报内容**（月报明细），不是下发指标。
 */
const props = defineProps<{
  visible: boolean
  /** 导入模式：single = 单归口线；all = 本学院全部归口线（文件内按归口部门列拆线） */
  mode: ReportFillImportMode
  /** 考核周期 id（定位已下发计划线）；缺省时导入入口不可用 */
  cycleId?: number | null
  /** 默认归属月份（yyyyMM） */
  defaultReportMonth?: string
  /** 当前登录人所在学院名称（写入「学院」列 + 校验提示） */
  collegeName?: string
  /**
   * 单归口入口选中的归口部门 id。
   *
   * <p>传了 → 后端只提交该归口的线，文件内其它归口线标记为「将跳过」；
   * 不传（批量入口）→ 文件内出现的归口线全部提交。
   */
  functionalOrgId?: number | null
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

const dialogTitle = computed(() =>
  props.mode === 'all' ? '批量导入 · 指标填报' : '导入 · 指标填报'
)

const modeTip = computed(() =>
  props.mode === 'all'
    ? '一次导入本学院全部归口线的月度填报数据：文件内按「归口职能部门」列自动拆线，各线独立提交、独立进入上报审批。'
    : '一次导入一条归口线的月度填报数据（本学院从某一个归口职能部门收到的指标）。'
)

const totalValidRows = computed(() => {
  if (!preview.value) {
    return 0
  }
  // 只统计「将提交」的组：把将跳过的行也算进去会让用户误以为那些行也会导入
  return preview.value.groups
    .filter(group => group.willSubmit)
    .reduce((sum, group) => sum + group.rows.filter(row => !row.errors?.length).length, 0)
})

/**
 * 从错误里取后端原文。
 *
 * <p>响应拦截器 reject 的是统一错误对象（对象字面量，**不是 Error 实例**），
 * 用 `instanceof Error` 判会永远走兜底文案，把后端原文（「整单拒绝导入：第 3 行…」、
 * 「自评等级…无效」）吞掉。这里按 message 字段取，兼容 Error 与统一错误对象。
 */
function resolveErrorMessage(error: unknown, fallback: string): string {
  const candidate = (error as { message?: unknown } | null | undefined)?.message
  const text = typeof candidate === 'string' ? candidate.trim() : ''
  return text || fallback
}

/**
 * 预览总览的类型/文案。
 *
 * <p>阻断下沉到组级（对齐模板「一条线失败不影响其他线」）：
 * 只有「一条可提交的线都没有」才是 error，部分线有错是 warning，全通才是 success。
 */
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
    return '没有可提交的归口线：请按下方提示修正后重新上传'
  }
  if (skipped > 0) {
    return `解析完成：${submittable} 条归口线将提交、${skipped} 条将跳过（${totalValidRows.value} 行可导入）`
  }
  return `解析完成：${current.groups.length} 条归口线、${totalValidRows.value} 行可导入`
})

const commitSummaryTitle = computed(() => {
  if (!commitResults.value.length) {
    return '导入结果'
  }
  const success = commitResults.value.filter(item => item.status === 'SUCCESS').length
  const failed = commitResults.value.filter(item => item.status === 'FAILED').length
  const skipped = commitResults.value.filter(item => item.status === 'SKIPPED').length
  const parts = [`成功 ${success} 条归口线`]
  if (skipped) {
    parts.push(`跳过 ${skipped} 条`)
  }
  if (failed) {
    parts.push(`失败 ${failed} 条`)
  }
  return `导入完成：${parts.join('，')}。已提交的归口线进入上报审批流程，审批通过后数据看板生效。`
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

const handleFileChange: UploadProps['onChange'] = (uploadFile, uploadFiles) => {
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
    const dataSheet = buildReportFillTemplateSheet(props.mode, props.collegeName ?? '当前学院')
    const guideSheet = buildReportFillGuideSheet(props.mode)
    await exportSheetsToExcel(
      [dataSheet as never, guideSheet as never],
      buildReportFillTemplateFileName(props.mode)
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
  // 单归口模式必须能拿到归口部门 id：拿不到就明确拦下，
  // 绝不能让后端把「mode=single 但没给 orgId」当成批量处理（会误提交多条线）。
  if (props.mode === 'single' && !props.functionalOrgId) {
    ElMessage.warning('归属部门尚未加载完成，请刷新页面后重试')
    return
  }
  if (!pickedMonth.value) {
    ElMessage.warning('请选择归属月份')
    return
  }

  previewing.value = true
  try {
    preview.value = await reportFillImportApi.preview(raw, {
      cycleId: props.cycleId,
      reportMonth: pickedMonth.value,
      // 显式模式：single = 只提交选中的这条线；all = 文件内全部提交
      mode: props.mode,
      functionalOrgId: props.functionalOrgId ?? null
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
