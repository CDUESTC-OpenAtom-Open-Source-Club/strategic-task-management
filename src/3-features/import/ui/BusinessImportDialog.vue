<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Download, Upload, UploadFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, genFileId } from 'element-plus'
import type { UploadFile, UploadFiles, UploadInstance, UploadRawFile } from 'element-plus'
import {
  businessImportApi,
  type BusinessImportType,
  type ConflictMode,
  type ImportCommitResponse,
  type ImportPreviewResponse,
  type ImportRowPreview
} from '@/features/import/api/businessImport'
import {
  buildImportTemplateFileName,
  buildImportTemplateSheet,
  getImportTemplateGuide,
  type ImportTemplateParentSeed
} from '@/features/import/lib/importTemplate'
import { buildPreviewGroupSpans } from '@/features/import/lib/previewGroupSpan'
import { exportSheetsToExcel, type ExcelExportSheet } from '@/shared/lib/export/excel'
import { showCriticalErrorNotice } from '@/shared/lib/criticalErrorNotice'
import { markErrorHandled } from '@/shared/lib/utils/errorToast'
import { useAuthStore } from '@/features/auth/model/store'

const props = defineProps<{
  visible: boolean
  type: BusinessImportType
  targetOrgId?: number | null
  targetOrgName?: string | null
  sourceOrgId?: number | null
  sourceOrgName?: string | null
  cycleId?: number | null
  /** 2026-10-14 P10：当前职能部门已接收的父级核心指标，用于下载模板时自动带出预填行；
   *  2026-10-31 终版表头：type1（定量/定性）用于「核心指标类型」列预填，
   *  type2（基础性/发展性）用于「任务类型」列预填（锚点只读，改了阻断点名） */
  parentIndicators?: Array<{
    name?: string
    taskContent?: string
    type1?: string
    type2?: string
  }> | null
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
const uploadRef = ref<UploadInstance>()
// 2026-10-10 测试0927 第016条落地：凡导入的 Excel 视为已经过审批，
// 默认自动跑完下发审批链（后端 autoSubmitAndApprove 以系统管理员身份逐节点通过）
const autoSubmitAndApprove = ref(true)
const overwriteExisting = ref(false)
const templateDownloading = ref(false)

const isStrategicImport = computed(() => props.type === 'strategic-task')
const dialogTitle = computed(() =>
  isStrategicImport.value ? '导入职能部门指标表' : '导入学院子指标表'
)
const authStore = useAuthStore()
const targetLabel = computed(() => (isStrategicImport.value ? '当前职能部门' : '当前学院'))
const canPreview = computed(
  () => Boolean(selectedFile.value?.raw) && Boolean(props.targetOrgId) && Boolean(props.cycleId)
)
const importStepActive = computed(() => {
  if (previewResult.value) {
    return previewResult.value.blocking ? 1 : 2
  }
  return selectedFile.value ? 1 : 0
})
const nextActionTip = computed(() => {
  if (!selectedFile.value) {
    return ''
  }
  if (!previewResult.value) {
    return '文件已选择，请先点击“解析预览”。预览通过后，确认按钮才会启用。'
  }
  if (previewResult.value.blocking) {
    return '预览发现阻断错误，请修正 Excel 后重新上传并解析。'
  }
  return autoSubmitAndApprove.value
    ? '预览已通过，点击“确认下发”后会按最终总权重校验并自动审批。'
    : '预览已通过，点击“确认导入”写入数据。'
})
const footerActionTip = computed(() => {
  if (!selectedFile.value) {
    return '上传文件后先解析预览。'
  }
  if (!previewResult.value) {
    return '先点“解析预览”，通过后才能确认导入或自动审批。'
  }
  if (previewResult.value.blocking) {
    return '文件有阻断错误，暂不能确认导入。'
  }
  return '预览通过，可以确认导入。'
})

const visibleRows = computed(() => previewResult.value?.rows.slice(0, 20) ?? [])

// 2026-11-01 缺陷修复（E2E 实测）：预览表与导入模板同款视觉——同组的「序号」与
// 「父级指标/战略任务」竖向合并（锚点行 rowSpan=组行数，从属行不渲染该格）。
// 只改展示：分组用解析器 sticky 继承后的组号+组值复合键，相邻同组合并、非相邻不跨合并。
const previewGroupSpans = computed(() => buildPreviewGroupSpans(visibleRows.value, props.type))

const previewSpanMethod = ({
  rowIndex,
  columnIndex
}: {
  rowIndex: number
  columnIndex: number
}) => {
  // 组列 = 序号（第 0 列）与父级指标/战略任务（第 2 列，两类模板各含其一）
  if (columnIndex !== 0 && columnIndex !== 2) {
    return { rowspan: 1, colspan: 1 }
  }
  const rowSpan = previewGroupSpans.value[rowIndex] ?? 1
  return { rowspan: rowSpan, colspan: rowSpan > 0 ? 1 : 0 }
}

const formatCommitBlockedMessage = (result: ImportCommitResponse) => {
  const reason = result.workflow?.message?.trim() || '本次导入未执行'

  if (reason.includes('已下发') || reason.includes('重复导入')) {
    return '当前任务已下发，不能重复导入或下发。'
  }
  // 2026-10-31 用户拍板：后端权重拦截文案改为计划级口径并点名父级核心指标，两种口径都识别
  if (reason.includes('权重合计必须为100') || reason.includes('基础性指标权重全计划合计须为 100')) {
    return `本次导入未写入：下发前权重校验未通过，基础性指标权重全计划合计须为 100%。${reason}`
  }
  if (reason.includes('未产生可审批计划')) {
    return '本次导入未写入：没有生成可审批计划，请检查导入目标和数据。'
  }

  return `本次导入未写入：${reason}`
}

const formatAutoDispatchBlockedMessage = (result: ImportCommitResponse) => {
  const importSummary = `导入成功：新增 ${result.createdCount} 条，更新 ${result.updatedCount} 条`
  const reason = result.workflow?.message?.trim() || '自动下发未完成'

  // 2026-10-31 用户拍板：后端权重拦截文案改为计划级口径并点名父级核心指标，两种口径都识别
  if (reason.includes('权重合计必须为100') || reason.includes('基础性指标权重全计划合计须为 100')) {
    return `${importSummary}；下发已阻止：基础性指标权重全计划合计须为 100%。${reason}`
  }
  if (reason.includes('已下发') || reason.includes('重复发起')) {
    return `${importSummary}；下发已阻止：当前任务已处于已下发状态，不能重复下发。`
  }
  if (reason.includes('未产生可审批计划')) {
    return `${importSummary}；下发已阻止：本次导入没有生成可审批计划，请检查导入目标和数据。`
  }
  if (reason.includes('自动审批流程未启用')) {
    return `${importSummary}；下发已阻止：自动审批流程未启用，请联系管理员启用流程后再下发。`
  }

  return `${importSummary}；下发已阻止：${reason}`
}

const downloadTemplate = async () => {
  if (templateDownloading.value) {
    return
  }
  templateDownloading.value = true
  try {
    const guide = getImportTemplateGuide(props.type)

    // 2026-10-14 用户定案（P10）：学院子指标模板自动带出"当前职能部门已接收的父级核心指标"行
    // （由父页面传入 availableParentIndicators，与导入校验的父级匹配口径完全一致）；
    // 2026-10-31 层级化定案：预填行带序号（=组号）与当前选中学院，用户在行内补写子指标，
    // 再向下加「序号/组列留空」延续行即可拆多个子指标。未传/为空时退回通用示例行，不阻断下载。
    // 2026-10-31 终版表头加列：type2 →「任务类型」列预填（父级所属任务类型，锚点只读）。
    const parentSeeds: ImportTemplateParentSeed[] | undefined = props.parentIndicators?.length
      ? props.parentIndicators.map(item => ({
          parentIndicator: String(item.name || '').trim(),
          college: String(props.targetOrgName || '').trim(),
          parentIndicatorType: String(item.type1 || '').trim(),
          taskType: String(item.type2 || '').trim()
        }))
      : undefined

    const rulesSheet: ExcelExportSheet<Record<string, string>> = {
      sheetName: '填写说明',
      rows: guide.rules.map(rule => ({ rule })),
      columns: [
        {
          header: '填写说明',
          width: 60,
          getValue: row => row.rule
        }
      ]
    }

    await exportSheetsToExcel(
      // 2026-10-19：两个 guide 的 rows 键集不同，联合类型经协变检查无法直接赋给 unknown，显式断言
      [
        buildImportTemplateSheet(props.type, parentSeeds) as ExcelExportSheet<unknown>,
        rulesSheet as ExcelExportSheet<unknown>
      ],
      buildImportTemplateFileName(props.type)
    )
    ElMessage.success(
      parentSeeds?.length
        ? `模板下载成功：已自动带出 ${parentSeeds.length} 个父级核心指标（序号=组号，任务类型/核心指标/核心指标类型已预填），在行内补写第一个子指标，拆多个子指标时向下加“序号与组列留空”的延续行`
        : '模板下载成功，请按模板填写后上传'
    )
  } catch {
    ElMessage.error('模板下载失败，请稍后重试')
  } finally {
    templateDownloading.value = false
  }
}

const handleFileChange = (uploadFile: UploadFile, uploadFiles: UploadFiles) => {
  // 2026-10-31 用户定案：重选新文件时重置上一份文件的预览态——previewResult 内含
  // 行数据、错误/警告计数与阻断标记，置空即整包重置，确认按钮随之禁用，防止沿用旧预览确认新文件
  fileList.value = uploadFiles.slice(-1)
  selectedFile.value = fileList.value[0] ?? uploadFile
  previewResult.value = null
}

// 2026-10-31 用户定案：limit=1 下未删除旧文件就再选新文件时，el-upload 触发的是 exceed 而非
// change——这里手动清掉旧文件并让新文件走 handleStart（内部会 emit change），从而复用
// handleFileChange 的「重选即重置预览态」逻辑，保证弹窗里预览结果永远对应最新选择的文件
const handleFileExceed = (files: File[], _uploadFiles: UploadFiles) => {
  const file = files[0] as UploadRawFile | undefined
  if (!file) {
    return
  }
  uploadRef.value?.clearFiles()
  file.uid = genFileId()
  uploadRef.value?.handleStart(file)
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
    // 2026-10-31 层级化定案：不再传序号→内部ID 映射，落库匹配键按名称
    // （职能部门=任务+核心指标名，学院=父级核心指标+子指标名），同名更新、新名新增。
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
    // 2026-10-31：解析预览失败（含文件类型/大小被拒等后端原文）属关键报错，
    // 不自动消失；markErrorHandled 让响应拦截器的 3 秒兜底 toast 跳过，只弹这一条。
    markErrorHandled(error)
    const msg = (error as { message?: string })?.message
    showCriticalErrorNotice({
      title: '导入解析失败',
      message: msg || '导入解析失败，请检查文件内容或稍后重试',
      critical: true
    })
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

  if (autoSubmitAndApprove.value) {
    try {
      await ElMessageBox.confirm(
        '确认后将写入本次导入数据，并自动发起审批流程；审批通过后任务将正式下发。是否继续？',
        '导入并自动下发审批',
        {
          confirmButtonText: '确认下发',
          cancelButtonText: '再想想',
          type: 'warning'
        }
      )
    } catch (error) {
      // 2026-10-31（P-01）：区分用户取消与真实异常——ElMessageBox.confirm 拒绝值为
      // 'cancel'/'close' 字符串属用户反悔（正常路径，静默返回）；其余异常透传既有错误提示并留痕。
      if (error === 'cancel' || error === 'close') {
        return
      }
      console.error('[BusinessImportDialog] 导入确认框异常:', error)
      // 2026-10-31：确认框异常属关键报错，不自动消失（取消分支仍保持静默）
      const msg = (error as { message?: string })?.message
      showCriticalErrorNotice({
        title: '确认导入失败',
        message: msg || '确认导入失败，请稍后重试',
        critical: true
      })
      return
    }
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

    if (result.status === 'COMMIT_BLOCKED') {
      // 2026-10-31：导入被阻断（「本次导入未写入」+ 后端原因）属关键报错，不自动消失
      showCriticalErrorNotice({
        title: '导入未写入',
        message: formatCommitBlockedMessage(result),
        type: 'warning',
        critical: true
      })
      return
    }

    if (result.status === 'COMMITTED_WITH_WORKFLOW_FAILED') {
      ElMessage.warning(formatAutoDispatchBlockedMessage(result))
    } else {
      const workflowMessage = result.workflow?.message ? `，${result.workflow.message}` : ''
      const deletedMessage =
        (result.deletedCount ?? 0) > 0 ? `，删除 ${result.deletedCount} 条` : ''
      ElMessage.success(
        `导入成功：新增 ${result.createdCount} 条，更新 ${result.updatedCount} 条${deletedMessage}${workflowMessage}`
      )
    }
    emit('committed', result)
    dialogVisible.value = false
  } catch (error) {
    // 2026-10-20：apiClient 抛的是 AppError 对象（非 Error 实例），
    // 后端业务拦截原因（如异动审批锁、权重不符）必须透传给用户
    // 2026-10-31：确认提交异常属关键报错，不自动消失；markErrorHandled
    // 让响应拦截器的兜底 toast 跳过，只弹这一条持久通知。
    markErrorHandled(error)
    const msg = (error as { message?: string })?.message
    showCriticalErrorNotice({
      title: '确认导入失败',
      message: msg || '确认导入失败，请稍后重试',
      critical: true
    })
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

const handleDialogBeforeClose = (done: () => void) => {
  if (previewing.value || committing.value) {
    ElMessage.info('正在处理中，请等待完成后再关闭')
    return
  }
  done()
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
      autoSubmitAndApprove.value = true
      overwriteExisting.value = false
      templateDownloading.value = false
    }
  }
)
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    width="min(860px, calc(100vw - 32px))"
    :close-on-click-modal="!previewing && !committing"
    :close-on-press-escape="!previewing && !committing"
    :before-close="handleDialogBeforeClose"
  >
    <template #header>
      <div class="business-import-header">
        <span class="business-import-title">{{ dialogTitle }}</span>
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

      <el-steps
        class="business-import-steps"
        :active="importStepActive"
        finish-status="success"
        simple
      >
        <el-step title="选择文件" />
        <el-step title="解析预览" />
        <el-step title="确认导入" />
      </el-steps>

      <el-upload
        ref="uploadRef"
        drag
        accept=".xlsx"
        :auto-upload="false"
        :limit="1"
        :file-list="fileList"
        :on-change="handleFileChange"
        :on-remove="handleFileRemove"
        :on-exceed="handleFileExceed"
      >
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
        <div class="el-upload__text">拖拽 Excel 文件到这里，或点击选择</div>
        <template #tip>
          <div class="upload-tip-row">
            <span class="el-upload__tip">仅支持 .xlsx，一次只导入当前选中的部门或学院。</span>
            <el-button
              class="download-template-button"
              type="primary"
              text
              :icon="Download"
              :loading="templateDownloading"
              @click="downloadTemplate"
            >
              下载模板
            </el-button>
          </div>
        </template>
      </el-upload>

      <div class="business-import-actions">
        <el-alert
          v-if="selectedFile || previewResult"
          class="next-action-tip"
          :type="previewResult?.blocking ? 'error' : previewResult ? 'success' : 'info'"
          :closable="false"
          show-icon
          :title="nextActionTip"
        />
        <el-button
          type="primary"
          :icon="Upload"
          :loading="previewing"
          :disabled="!canPreview"
          @click="handlePreview"
        >
          {{ previewResult ? '重新解析预览' : '解析预览' }}
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

        <!-- 2026-11-01 缺陷修复：同组「序号」「父级指标/战略任务」rowSpan 合并，与导入模板同款视觉 -->
        <el-table
          :data="visibleRows"
          max-height="320"
          class="preview-table"
          :span-method="previewSpanMethod"
        >
          <!-- 2026-10-19 用户定案：预览首列展示文件里的「序号」（1、2、3…），不再用 Excel 物理行号 -->
          <el-table-column prop="rowNo" label="序号" width="70" />
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
        <el-tooltip
          content="同名指标=更新、新名称=新增始终生效；勾选后，当前范围内未出现在文件中的既有指标会被删除（真覆盖）。"
          placement="top"
        >
          <el-checkbox v-model="overwriteExisting">覆盖已有数据</el-checkbox>
        </el-tooltip>
        <el-tooltip
          content="导入后自动跑完下发审批链并确认下发（测试期不设权限卡位，全部账号可用）"
          placement="top"
        >
          <el-checkbox v-model="autoSubmitAndApprove">导入后自动发起并完成审批</el-checkbox>
        </el-tooltip>
      </div>
    </div>

    <template #footer>
      <div class="business-import-footer">
        <div class="footer-action-tip">{{ footerActionTip }}</div>
        <div class="footer-actions">
          <el-button :disabled="previewing || committing" @click="dialogVisible = false">
            取消
          </el-button>
          <el-button
            type="primary"
            :loading="committing"
            :disabled="!previewResult || previewResult.blocking"
            @click="handleCommit"
          >
            {{ autoSubmitAndApprove ? '确认下发' : '确认导入' }}
          </el-button>
        </div>
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

.business-import-steps {
  border-radius: 6px;
}

.business-import-actions {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 12px;
}

.next-action-tip {
  flex: 1;
  min-width: 0;
}

.business-import-actions :deep(.el-button) {
  min-width: 136px;
  margin-left: 0;
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
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.footer-action-tip {
  max-width: min(520px, 100%);
  color: #4b5563;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
}

.footer-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.footer-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.upload-tip-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.download-template-button {
  flex-shrink: 0;
}

@media (max-width: 640px) {
  .business-import-header {
    align-items: flex-start;
    flex-direction: column;
    padding-right: 24px;
  }

  .upload-tip-row {
    flex-wrap: wrap;
  }

  .business-import-summary,
  .business-import-actions,
  .commit-options,
  .business-import-footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .business-import-actions :deep(.el-button) {
    width: 100%;
  }

  .footer-actions {
    width: 100%;
  }

  .footer-actions :deep(.el-button) {
    width: 100%;
  }

  .preview-stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
