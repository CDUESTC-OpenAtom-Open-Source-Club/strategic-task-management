<template>
  <el-dialog
    v-model="dialogVisible"
    :title="dialogTitle"
    width="1000px"
    top="6vh"
    :close-on-click-modal="false"
    @closed="handleClosed"
  >
    <!-- 顶部摘要：对齐「指标填报导入」信息栏（当前学院 / 归口部门 / 当前周期） -->
    <div class="report-fill-summary">
      <div>
        <span class="summary-label">当前{{ variant === 'func' ? '部门' : '学院' }}</span>
        <strong>{{ responsibleOrgName || '未选择' }}</strong>
      </div>
      <div>
        <span class="summary-label">归口部门</span>
        <strong>{{ targetOrgLabel }}</strong>
      </div>
      <div>
        <span class="summary-label">当前周期</span>
        <strong>{{ cycleName || '-' }}</strong>
      </div>
    </div>

    <!-- 弹窗内嵌报错（与下发同口径：错误直接显示在导入窗口内，不另开通知） -->
    <el-alert
      v-if="actionError"
      class="mb-12"
      type="error"
      :closable="true"
      show-icon
      :title="actionError"
      @close="actionError = ''"
    />

    <el-steps :active="activeStep > 2 ? 3 : activeStep" simple finish-status="success">
      <el-step title="选择文件" />
      <el-step title="解析预览" />
      <el-step title="确认导入" />
    </el-steps>

    <!-- ============ 第 1 步：选择文件 ============ -->
    <div v-show="activeStep === 0" class="step-panel">
      <el-alert type="info" :closable="false" show-icon class="mb-12">
        <template #title>{{ modeTip }}</template>
      </el-alert>

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

      <!-- 左下角：对齐下发弹窗（解析预览按钮在上、流程提示在下） -->
      <div class="step-actions">
        <el-button
          type="primary"
          :loading="previewing"
          :disabled="!fileList.length"
          @click="handlePreview"
        >
          解析预览
        </el-button>
        <div class="next-action-tip">{{ stepTip }}</div>
      </div>
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
              <el-tag v-if="group.existingReportId && !overwriteExisting" type="info" size="small">
                本月已有填报（将跳过）
              </el-tag>
              <el-tag v-else-if="group.existingReportId" type="warning" size="small">
                将覆盖
              </el-tag>
              <el-tag v-else-if="group.willSubmit" type="success" size="small">将提交</el-tag>
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
                <el-tag
                  v-else-if="group.existingReportId && !overwriteExisting"
                  type="info"
                  size="small"
                >
                  将跳过
                </el-tag>
                <el-tag v-else-if="group.existingReportId" type="warning" size="small">
                  将覆盖
                </el-tag>
                <el-tag v-else type="success" size="small">将新增</el-tag>
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

    <!-- ============ 第 3 步：确认导入（最后检查） ============ -->
    <div v-show="activeStep === 2" class="step-panel">
      <el-alert type="warning" :closable="false" show-icon class="mb-12">
        <template #title>请最后检查以下内容，确认无误后点击「确认导入」。</template>
      </el-alert>

      <el-card
        v-for="(group, groupIndex) in effectiveSubmittableGroups"
        :key="`confirm-${groupIndex}`"
        class="mb-12"
        shadow="never"
      >
        <template #header>
          <div class="group-header">
            <span class="group-title">{{ group.targetOrgName }}</span>
            <el-tag v-if="group.existingReportId && overwriteExisting" type="warning" size="small">
              覆盖已有
            </el-tag>
            <el-tag v-else-if="group.existingReportId" type="info" size="small">
              本月已有填报（将跳过）
            </el-tag>
            <el-tag v-else type="success" size="small">新增导入</el-tag>
            <span class="group-count">共 {{ group.rowsCount }} 行</span>
          </div>
        </template>
        <el-table :data="group.rows" size="small" border max-height="320">
          <el-table-column prop="rowNo" label="行" width="52" align="center" />
          <el-table-column
            prop="indicatorName"
            label="子指标名称"
            min-width="220"
            show-overflow-tooltip
          />
          <el-table-column prop="selfRating" label="自评等级" width="90" align="center" />
          <el-table-column prop="remark" label="进度说明" min-width="200" show-overflow-tooltip />
        </el-table>
      </el-card>

      <el-empty v-if="!effectiveSubmittableGroups.length" description="没有可提交的上报线" />
    </div>

    <!-- ============ 第 4 步：导入结果 ============ -->
    <div v-show="activeStep === 3" class="step-panel">
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
        <!-- 对齐下发弹窗底部的冲突处理复选框：不勾 = 跳过已有，勾选 = 覆盖 -->
        <el-checkbox v-model="overwriteExisting" class="overwrite-checkbox">
          覆盖已有数据
        </el-checkbox>
        <div class="dialog-footer-actions">
          <el-button @click="handleCancel">{{ activeStep === 3 ? '关闭' : '取消' }}</el-button>
          <el-button v-if="activeStep === 1 || activeStep === 2" @click="handleBack">
            上一步
          </el-button>
          <el-button
            v-if="activeStep === 1"
            type="primary"
            :disabled="!preview || !effectiveSubmittableGroups.length"
            @click="activeStep = 2"
          >
            下一步
          </el-button>
          <el-button
            v-if="activeStep === 2"
            type="primary"
            :disabled="!preview || !effectiveSubmittableGroups.length"
            :loading="committing"
            @click="handleCommit"
          >
            确认导入
          </el-button>
        </div>
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
  type ReportFillDynamicTemplateRow,
  type ReportFillTemplateVariant
} from '@/features/import/lib/reportFillImportTemplate'
import { exportSheetsToExcel } from '@/shared/lib/export/excel'
import { markErrorHandled } from '@/shared/lib/utils/errorToast'

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
  /** 单归口入口选中的目标部门名称（顶部摘要显示；批量入口为空） */
  targetOrgName?: string
  /** 当前考核周期名称（顶部摘要显示） */
  cycleName?: string
  /**
   * 2026-11-26（模板动态行）：当前视角「真实已下发子指标」行——下载模板的数据行来源。
   *
   * <p>由父级按变体传（04=本部门指标 / 05=所选归口线子指标 / 06=全部归口线子指标），
   * 名称/权重系统预填只读，等级/说明留空给用户填。响应式绑定：单归口入口切换归属部门后
   * 重新打开/下载，模板行随所选归口重新生成。空数组/缺省 = 视角无已下发数据 →
   * 生成器回退静态示例行兜底。
   */
  templateRows?: ReportFillDynamicTemplateRow[]
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
/** 同月同线已有填报时是否覆盖（默认不勾 = 跳过，与后端 conflictMode 默认值一致） */
const overwriteExisting = ref(false)
/** 弹窗内嵌报错（预览/提交失败时显示后端原文，成功后清空） */
const actionError = ref('')

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

/** 顶部「归口部门」摘要：批量入口按文件拆分，单归口入口显示实际选中的部门，职能部门恒上报战略发展部 */
const targetOrgLabel = computed(() => {
  if (props.variant === 'func') {
    return '战略发展部'
  }
  return props.variant === 'college-all'
    ? '按文件内「目标部门」列拆分'
    : props.targetOrgName || '未选择'
})

/** 左下角流程提示（对齐下发弹窗的 nextActionTip，文案改为上报口径，不写具体月份） */
const stepTip = computed(() => {
  if (!fileList.value.length) {
    return '上传文件后先解析预览，归属月份自动同步本页填报月份。'
  }
  if (!preview.value) {
    return '文件已选择，请先点击「解析预览」。'
  }
  if (!effectiveSubmittableGroups.value.length) {
    return '预览未通过：请按下方错误提示修正文件后重新上传。'
  }
  return '预览已通过：确认后导入数据并进入审批流程。'
})

const totalValidRows = computed(() => {
  // 只统计「将提交」的线：把将跳过的行也算进去会让用户误以为那些行也会导入
  return effectiveSubmittableGroups.value.reduce(
    (sum, group) => sum + group.rows.filter(row => !row.errors?.length).length,
    0
  )
})

/**
 * 真正会提交的线：预览期合法，且不是「本月已有填报但未勾覆盖」。
 *
 * <p>覆盖复选框切换后实时重算——组头标签、汇总计数、第 3 步确认页、确认按钮可用性都以此为准，
 * 避免出现「组头说将提交、行结果说将跳过」的矛盾。
 */
const effectiveSubmittableGroups = computed(() =>
  (preview.value?.groups ?? []).filter(
    group => group.willSubmit && !(group.existingReportId && !overwriteExisting.value)
  )
)

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
  if (!effectiveSubmittableGroups.value.length) {
    return 'error'
  }
  return current.groups.length > effectiveSubmittableGroups.value.length ? 'warning' : 'success'
})

const previewSummaryTitle = computed(() => {
  const current = preview.value
  if (!current) {
    return '正在解析…'
  }
  const submittable = effectiveSubmittableGroups.value.length
  const skipped = current.groups.length - submittable
  if (!submittable) {
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
  return `导入完成：${parts.join('，')}。已导入的数据进入审批流程，审批通过后数据看板生效。`
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
      overwriteExisting.value = false
      actionError.value = ''
    }
  }
)

function handleClosed() {
  activeStep.value = 0
  preview.value = null
  commitResults.value = []
  fileList.value = []
  actionError.value = ''
}

function handleCancel() {
  dialogVisible.value = false
}

function handleBack() {
  activeStep.value = Math.max(0, activeStep.value - 1)
}

const handleFileChange: UploadProps['onChange'] = (_uploadFile, uploadFiles) => {
  fileList.value = uploadFiles.slice(-1)
  preview.value = null
  actionError.value = ''
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
    // 2026-11-26（模板动态行）：有真实行必须用真实行；空数组 = 视角无已下发数据 → 静态示例行兜底
    const dataSheet = buildReportFillTemplateSheet(
      props.variant,
      props.responsibleOrgName ?? '',
      props.templateRows?.length ? props.templateRows : undefined
    )
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
    actionError.value = '请先选择要导入的 Excel 文件'
    return
  }
  if (!props.cycleId) {
    actionError.value = '当前考核周期不可用，无法导入'
    return
  }
  if (!pickedMonth.value) {
    actionError.value = '当前填报月份不可用，请刷新页面后重试'
    return
  }
  // 单归口模式必须能拿到目标部门 id：拿不到就明确拦下，
  // 绝不能让后端把「mode=single 但没给 id」当成批量处理（会误提交多条线）。
  if (previewMode.value === 'single' && !props.targetOrgId) {
    actionError.value = '目标部门尚未加载完成，请刷新页面后重试'
    return
  }

  previewing.value = true
  actionError.value = ''
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
    // 与下发同口径：错误直接显示在导入窗口内（不另开通知/toast），
    // markErrorHandled 让响应拦截器跳过兜底提示，避免重复弹两条。
    markErrorHandled(error)
    actionError.value = resolveErrorMessage(error, '解析预览失败，请检查文件内容或稍后重试')
  } finally {
    previewing.value = false
  }
}

async function handleCommit() {
  if (!preview.value) {
    return
  }
  // 第 3 步「确认导入」本身就是最后检查页：用户检查后点「确认导入」才真正写库并提交审批。
  committing.value = true
  actionError.value = ''
  try {
    const response = await reportFillImportApi.commit(preview.value.batchId, {
      confirmToken: preview.value.confirmToken,
      comment: '',
      conflictMode: overwriteExisting.value ? 'OVERWRITE' : 'SKIP'
    })
    commitResults.value = response.results
    activeStep.value = 3
    emit('committed', response)
  } catch (error) {
    console.error('[ReportFillImportDialog] 确认导入失败:', error)
    markErrorHandled(error)
    actionError.value = resolveErrorMessage(error, '确认导入失败，请稍后重试')
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

.report-fill-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 28px;
  padding: 8px 0 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  margin-bottom: 12px;
  font-size: 13px;
}

.report-fill-summary .summary-label {
  color: var(--el-text-color-secondary);
  margin-right: 2px;
}

.report-fill-summary .summary-label::after {
  content: '：';
}

.report-fill-summary strong {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.step-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin-top: 16px;
}

.next-action-tip {
  width: 100%;
  padding: 8px 12px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 18px;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.overwrite-checkbox {
  margin-right: auto;
}

.dialog-footer-actions {
  display: flex;
  gap: 8px;
}
</style>
