<script lang="ts">
// 2026-11-12（低⑪·A2 缺陷 D2）：导入对话框「当前周期」此前直接渲染内部 cycle id
// （如「4」），用户看不出是哪个考核周期。这里抽纯函数从周期数据源取名：
// 优先 cycleName（如「2026年度考核周期」），无名称时回退「{year}年度」，
// 周期记录也缺失时才回退 id；id 本身无效（0/负数/非数值）显示「-」。
// 实现与单测共用（测试从本 SFC 模块导入）。
export interface CycleDisplaySource {
  cycleId?: number | string
  cycleName?: string
  year?: number | string
}

export const resolveCycleDisplayLabel = (
  cycleId: number | string | null | undefined,
  cycles: CycleDisplaySource[],
  fallbackYear?: number | string | null
): string => {
  const numericId = Number(cycleId)
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return '-'
  }
  const matched = cycles.find(item => Number(item?.cycleId) === numericId)
  const name = String(matched?.cycleName ?? '').trim()
  if (name) {
    return name
  }
  const year = Number(matched?.year ?? fallbackYear)
  if (Number.isFinite(year) && year > 0) {
    return `${year}年度`
  }
  return String(cycleId)
}

/**
 * 2026-11-17（学院线粒度改造 · 规格书 4.9④）：导入失败的**阻断文案**口径。
 *
 * <p>缺陷来源（线上测试反馈「导入未写入：当前任务已下发，不能重复导入或下发。」）：
 * 后端返回了真实原因（点名归口部门，例如「该学院 2026 年度的「教务处」这条线已下发…」），
 * 前端却把含「已下发 / 重复导入」的 reason **统一改写**成一句通用兜底，把真实原因盖掉了。
 * 新口径：</p>
 * <ul>
 *   <li>后端给了可用 reason → **优先展示后端原文**（前端的通用文案只能作为补充说明，
 *       不得替换原文）；</li>
 *   <li>后端没给可用 reason → 才用前端兜底文案；</li>
 *   <li>兜底文案的主语按导入类型区分：学院子指标表 = 「学院计划」，职能部门指标表 =
 *       「部门计划」——绝不把学院计划说成部门计划。</li>
 * </ul>
 */
export interface CommitBlockedMessageInput {
  workflow?: { message?: string | null } | null
}

/** 导入类型（与 businessImport.ts 的 BusinessImportType 对齐，此处不重复 import 以免同块重复声明） */
export type CommitBlockedImportType = 'strategic-task' | 'distribution'

/**
 * 2026-11-17（学院线粒度改造）：未选归口部门时发起学院子指标表导入的统一提示文案
 * （实现与单测共用同一常量，防漂移）。
 */
export const COLLEGE_IMPORT_FUNCTIONAL_ORG_REQUIRED =
  '请先选择职能部门（归口部门）：学院子指标表按归口部门分别导入'

export const formatCommitBlockedMessage = (
  result: CommitBlockedMessageInput,
  type: CommitBlockedImportType = 'strategic-task'
): string => {
  const reason = String(result?.workflow?.message ?? '').trim()
  const subject = type === 'distribution' ? '该学院计划' : '该部门计划'

  // 后端没给可用信息 → 前端兜底（学院导入说「学院计划」，不说「部门计划」）
  if (!reason) {
    return `本次导入未写入：${subject}导入未执行，后端未返回失败原因。`
  }

  // 2026-10-31 用户拍板：权重拦截文案改为计划级口径并点名父级核心指标，
  // 两种口径都识别——前端补充说明在前，后端原文照旧附在后面（原文不被替换）。
  if (reason.includes('权重合计必须为100') || reason.includes('基础性指标权重全计划合计须为 100')) {
    return `本次导入未写入：下发前权重校验未通过，基础性指标权重全计划合计须为 100%。${reason}`
  }

  // 其余情况：后端原文优先（不再把「已下发 / 重复导入」的原因统一改写成通用兜底）
  return `本次导入未写入：${reason}`
}

export default {
  name: 'BusinessImportDialog'
}
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Download, Upload, UploadFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, genFileId } from 'element-plus'
import type {
  UploadFile,
  UploadFiles,
  UploadInstance,
  UploadRawFile,
  UploadUserFile
} from 'element-plus'
import {
  businessImportApi,
  type BusinessImportType,
  type ConflictMode,
  type ImportAllCommitResponse,
  type ImportAllPreviewResponse,
  type ImportCommitResponse,
  type ImportPreviewResponse,
  type ImportRowPreview
} from '@/features/import/api/businessImport'
import {
  buildImportTemplateFileName,
  buildImportTemplateSheets,
  type ImportTemplateParentSeed
} from '@/features/import/lib/importTemplate'
import {
  buildImportExecutionPlan,
  formatImportExecutionPlanSummary,
  summarizeImportAllResults,
  toImportGroupResultView,
  toImportGroupView,
  type ImportGroupView
} from '@/features/import/lib/allImportPreview'
import { buildPreviewGroupSpans } from '@/features/import/lib/previewGroupSpan'
import { exportSheetsToExcel, type ExcelExportSheet } from '@/shared/lib/export/excel'
import { showCriticalErrorNotice } from '@/shared/lib/criticalErrorNotice'
import { markErrorHandled } from '@/shared/lib/utils/errorToast'
import { useAuthStore } from '@/features/auth/model/store'
import { useTimeContextStore } from '@/shared/lib/timeContext'

const props = defineProps<{
  visible: boolean
  type: BusinessImportType
  targetOrgId?: number | null
  targetOrgName?: string | null
  sourceOrgId?: number | null
  sourceOrgName?: string | null
  cycleId?: number | null
  /**
   * 2026-11-19（学院全部导入）：导入模式。
   *
   * <p>single（默认）= 既有单条导入：学院子指标表按「学院 × 归口部门」一条线导入，
   * 需先选归口（functionalOrgId 必填），模板 8 列。</p>
   *
   * <p>all = 全部导入：一份文件可含多个职能部门给同一学院的指标行，后端按文件内
   * 「职能部门」列拆批；**不要求先选归口**（归口由文件解析），模板 9 列（多「职能部门」列）。</p>
   */
  mode?: 'single' | 'all'
  /**
   * 2026-11-17（学院线粒度改造 · 规格书 4.9①）：归口部门组织 ID（学院子指标表导入用）。
   *
   * <p>学院子指标表按「学院 × 归口部门」定位计划（线）——同一学院在同一考核年度可以有
   * 多条归口部门各自的线，导入请求必须带上本次导入所属的归口部门，后端据此定位/新建
   * 该线并与文件父级反查做交叉校验（跨归口 → 阻断「请按归口部门分别导入」）。</p>
   *
   * <p>职能部门指标表导入（strategic-task）不适用该字段，保持 undefined。</p>
   */
  functionalOrgId?: number | null
  /** 归口部门名称（仅用于弹窗摘要区回显，让用户在导入前确认归口） */
  functionalOrgName?: string | null
  /** 2026-10-14 P10：当前职能部门已接收的父级核心指标，用于下载模板时自动带出预填行；
   *  2026-10-31 终版表头：type1（定量/定性）用于「核心指标类型」列预填，
   *  type2（基础性/发展性）用于「任务类型」列预填（锚点只读，改了阻断点名） */
  parentIndicators?: Array<{
    name?: string
    taskContent?: string
    type1?: string
    type2?: string
    /** 2026-11-19（全部导入）：该锚点所属的归口部门名（用于「职能部门」列预填） */
    functionalDeptName?: string
  }> | null
}>()

const emit = defineEmits<{
  (event: 'update:visible', value: boolean): void
  (event: 'committed', value: ImportCommitResponse): void
  /**
   * 2026-11-19（学院全部导入）：全部导入提交成功回调（逐组结果）。
   * 单条导入走既有的 committed 事件，两条链路互不影响。
   */
  (event: 'all-committed', value: ImportAllCommitResponse): void
}>()

const dialogVisible = computed({
  get: () => props.visible,
  set: value => emit('update:visible', value)
})

const fileList = ref<UploadFile[]>([])
const selectedFile = ref<UploadFile | null>(null)
const previewResult = ref<ImportPreviewResponse | null>(null)
/** 2026-11-19（学院全部导入）：分组预览结果（与单条 previewResult 互斥，互不影响） */
const allPreviewResult = ref<ImportAllPreviewResponse | null>(null)
/** 2026-11-19（学院全部导入）：逐组提交结果（结果页渲染） */
const allCommitResult = ref<ImportAllCommitResponse | null>(null)
const previewing = ref(false)
const committing = ref(false)
const uploadRef = ref<UploadInstance>()
// 2026-10-10 测试0927 第016条落地：凡导入的 Excel 视为已经过审批，
// 默认自动跑完下发审批链（后端 autoSubmitAndApprove 以系统管理员身份逐节点通过）
const autoSubmitAndApprove = ref(true)
const overwriteExisting = ref(false)
const templateDownloading = ref(false)

const isStrategicImport = computed(() => props.type === 'strategic-task')
/** 2026-11-19（学院全部导入）：是否全部导入模式 */
const isAllImport = computed(() => props.mode === 'all')
const dialogTitle = computed(() => {
  if (isAllImport.value) {
    return '全部导入学院子指标表'
  }
  return isStrategicImport.value ? '导入职能部门指标表' : '导入学院子指标表'
})
/** 2026-11-19（全部导入）：提示语——一次导入一个学院，自动按归口部门拆分 */
const importModeTip = computed(() =>
  isAllImport.value ? '一次导入一个学院，自动按归口部门拆分' : ''
)
const authStore = useAuthStore()
// 2026-11-12（低⑪）：周期展示名（优先 cycleName，回退「{year}年度」，最后回退 id）
const timeContextStore = useTimeContextStore()
const cycleDisplayLabel = computed(() =>
  resolveCycleDisplayLabel(
    props.cycleId,
    timeContextStore.cycles as CycleDisplaySource[],
    timeContextStore.currentYear
  )
)
const targetLabel = computed(() => (isStrategicImport.value ? '当前职能部门' : '当前学院'))
/**
 * 2026-11-17（学院线粒度改造）：归口部门（学院子指标表导入的必填上下文）。
 *
 * <p>未选归口 → 导入请求拿不到 functionalOrgId，后端无法定位「学院 × 归口」这条线，
 * 会按旧的「学院级」口径误命中别的归口的线（规格书第二节缺陷根因）。所以前端先拦一道：
 * 未选归口不启用「解析预览」，并在点击时给出明确提示。</p>
 *
 * <p>2026-11-19（全部导入）：全部导入**不需要**先选归口——归口由文件内「职能部门」列
 * 解析后分组，故该前提在 all 模式下一律跳过（归口不是前置条件）。</p>
 */
const hasFunctionalOrg = computed(() => {
  const numeric = Number(props.functionalOrgId)
  return Number.isFinite(numeric) && numeric > 0
})
/** 2026-11-19（全部导入）：分组预览结果是否存在 */
const hasAllPreview = computed(() => Boolean(allPreviewResult.value))
/** 2026-11-19（全部导入）：执行清单（确认页） */
const executionPlan = computed(() =>
  buildImportExecutionPlan(allPreviewResult.value?.groups, {
    unassignedRows: allPreviewResult.value?.unassignedRows,
    blocking: allPreviewResult.value?.blocking
  })
)
/** 2026-11-19（全部导入）：分组视图（模板渲染用） */
const groupViews = computed<ImportGroupView[]>(() =>
  (allPreviewResult.value?.groups ?? []).map(toImportGroupView)
)
/** 2026-11-19（全部导入）：执行清单总述文案 */
const executionPlanSummary = computed(() => formatImportExecutionPlanSummary(executionPlan.value))
/** 2026-11-19（全部导入）：逐组结果卡片 + 汇总 */
const allResultViews = computed(() =>
  (allCommitResult.value?.results ?? []).map(toImportGroupResultView)
)
const allResultSummary = computed(() => summarizeImportAllResults(allCommitResult.value))

const canPreview = computed(
  () =>
    Boolean(selectedFile.value?.raw) &&
    Boolean(props.targetOrgId) &&
    Boolean(props.cycleId) &&
    // 全部导入不要求先选归口（归口由文件「职能部门」列解析）
    (isStrategicImport.value || isAllImport.value || hasFunctionalOrg.value)
)
const importStepActive = computed(() => {
  if (isAllImport.value) {
    if (allCommitResult.value) {
      return 3
    }
    if (allPreviewResult.value) {
      return executionPlan.value.blocking ? 1 : 2
    }
    return selectedFile.value ? 1 : 0
  }
  if (previewResult.value) {
    return previewResult.value.blocking ? 1 : 2
  }
  return selectedFile.value ? 1 : 0
})
const nextActionTip = computed(() => {
  if (!selectedFile.value) {
    return ''
  }
  if (isAllImport.value) {
    if (!allPreviewResult.value) {
      return '文件已选择，请先点击“解析预览”。系统会按文件内「职能部门」列自动拆分分组。'
    }
    if (executionPlan.value.blocking) {
      return '分组预览发现阻断错误，请修正 Excel 后重新上传并解析。'
    }
    return autoSubmitAndApprove.value
      ? '分组预览已通过，点击“确认全部导入”后会按组下发并自动审批。'
      : '分组预览已通过，点击“确认全部导入”写入数据。'
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
  if (isAllImport.value) {
    if (!allPreviewResult.value) {
      return '先点“解析预览”，按归口部门分组后通过才能确认导入。'
    }
    if (executionPlan.value.blocking) {
      return '存在错误组或无法归组的行，暂不能确认导入。'
    }
    return '分组预览通过，可以确认导入。'
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

// 2026-11-17（学院线粒度改造 · 规格书 4.9④）：阻断文案改为「优先展示后端原文」——
// 纯函数实现与单测共用（普通 <script> 块导出），这里只做类型适配 + 导入类型分流。
const formatCommitBlockedMessageForType = (result: ImportCommitResponse): string =>
  formatCommitBlockedMessage(result, props.type)

const formatAutoDispatchBlockedMessage = (result: ImportCommitResponse) => {
  const importSummary = `导入成功：新增 ${result.createdCount} 条，更新 ${result.updatedCount} 条`
  const reason = String(result.workflow?.message ?? '').trim()

  // 2026-10-31 用户拍板：后端权重拦截文案改为计划级口径并点名父级核心指标，两种口径都识别
  if (reason.includes('权重合计必须为100') || reason.includes('基础性指标权重全计划合计须为 100')) {
    return `${importSummary}；下发已阻止：基础性指标权重全计划合计须为 100%。${reason}`
  }
  // 2026-11-17（学院线粒度改造）：「已下发 / 重复发起」不再统一改写成通用兜底——
  // 后端原文（点名归口部门）必须保留，前端只补一句说明。
  if (reason.includes('已下发') || reason.includes('重复发起')) {
    return `${importSummary}；下发已阻止：当前任务已处于已下发状态，不能重复下发。${reason}`
  }
  if (reason.includes('未产生可审批计划')) {
    return `${importSummary}；下发已阻止：本次导入没有生成可审批计划，请检查导入目标和数据。${reason}`
  }
  if (reason.includes('自动审批流程未启用')) {
    return `${importSummary}；下发已阻止：自动审批流程未启用，请联系管理员启用流程后再下发。${reason}`
  }

  return `${importSummary}；下发已阻止：${reason || '自动下发未完成'}`
}

const downloadTemplate = async () => {
  if (templateDownloading.value) {
    return
  }
  templateDownloading.value = true
  try {
    // 2026-10-14 用户定案（P10）：学院子指标模板自动带出"当前职能部门已接收的父级核心指标"行
    // （由父页面传入 availableParentIndicators，与导入校验的父级匹配口径完全一致）；
    // 2026-10-31 层级化定案：预填行带序号（=组号）与当前选中学院，用户在行内补写子指标，
    // 再向下加「序号/组列留空」延续行即可拆多个子指标。未传/为空时退回通用示例行，不阻断下载。
    // 2026-10-31 终版表头加列：type2 →「任务类型」列预填（父级所属任务类型，锚点只读）。
    // 2026-11-19（全部导入）：seeds 额外带 functionalDeptName →「职能部门」列预填
    // （该列是拆批依据 + 交叉校验依据）。
    const parentSeeds: ImportTemplateParentSeed[] | undefined = props.parentIndicators?.length
      ? props.parentIndicators.map(item => ({
          parentIndicator: String(item.name || '').trim(),
          college: String(props.targetOrgName || '').trim(),
          parentIndicatorType: String(item.type1 || '').trim(),
          taskType: String(item.type2 || '').trim(),
          // 2026-11-25 用户定案：单归口模板也带「归口职能部门」列 → 用当前选中归口预填
          functionalDept: String(
            (isAllImport.value ? item.functionalDeptName : props.functionalOrgName) || ''
          ).trim()
        }))
      : undefined

    // 2026-11-25 用户反馈（01 模板部门列恒为教务处）：职能部门模板的「部门」列要跟随当前下发目标，
    // 这里把目标部门名塞进 seeds（职能部门模板只用其中的 department 做预填，示例内容不受影响）。
    const templateSeeds: ImportTemplateParentSeed[] | undefined =
      props.type === 'strategic-task'
        ? [{ parentIndicator: '', department: String(props.targetOrgName || '').trim() }]
        : parentSeeds

    // 2026-11-25 用户定案（模板对齐样例）：数据 sheet + 填写说明 sheet 由 lib 统一构建
    const templateSheets = buildImportTemplateSheets(
      props.type,
      templateSeeds,
      isAllImport.value ? 'all' : 'single'
    )

    await exportSheetsToExcel(
      templateSheets as ExcelExportSheet<unknown>[],
      buildImportTemplateFileName(props.type, isAllImport.value ? 'all' : 'single')
    )
    if (props.type === 'strategic-task') {
      ElMessage.success(
        `模板下载成功：已按当前部门「${String(props.targetOrgName || '').trim() || '未选择'}」预填「部门」列，示例内容请替换后上传`
      )
      return
    }
    if (isAllImport.value) {
      ElMessage.success(
        parentSeeds?.length
          ? `模板下载成功：已自动带出 ${parentSeeds.length} 个父级核心指标（含「职能部门」列，系统将按该列自动拆分成多个归口分组），请在行内补写子指标名称、指标类型与权重`
          : '模板下载成功（全部导入）：请按模板填写并在「职能部门」列标明每行由哪个部门下发'
      )
      return
    }
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
  // 2026-11-19（全部导入）：同样重置分组预览与结果（避免沿用旧文件的分组确认新文件）
  allPreviewResult.value = null
  allCommitResult.value = null
}

// 2026-10-31 用户定案：limit=1 下未删除旧文件就再选新文件时，el-upload 触发的是 exceed 而非
// change——这里手动清掉旧文件并让新文件走 handleStart（内部会 emit change），从而复用
// handleFileChange 的「重选即重置预览态」逻辑，保证弹窗里预览结果永远对应最新选择的文件
const handleFileExceed = (files: File[], _uploadFiles: UploadUserFile[]) => {
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
  // 2026-11-19（全部导入）：同步重置分组预览与结果
  allPreviewResult.value = null
  allCommitResult.value = null
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
  // 2026-11-17（学院线粒度改造）：学院子指标表必须带归口部门——否则后端无法定位
  // 「学院 × 归口部门」这条线，会按旧的学院级口径误命中别的归口的线。前端先拦一道。
  // 2026-11-19（全部导入）：全部导入的归口由文件内「职能部门」列解析 → **不拦**。
  if (!isStrategicImport.value && !isAllImport.value && !hasFunctionalOrg.value) {
    ElMessage.warning(COLLEGE_IMPORT_FUNCTIONAL_ORG_REQUIRED)
    return
  }

  previewing.value = true
  try {
    // 2026-11-19（全部导入）：重置上一次的分组结果，避免旧分组残留
    allCommitResult.value = null
    if (isAllImport.value) {
      allPreviewResult.value = await businessImportApi.previewDistributionAll(
        selectedFile.value.raw,
        {
          cycleId: props.cycleId,
          sourceOrgId: props.sourceOrgId || undefined,
          targetCollegeOrgId: props.targetOrgId
        }
      )
      return
    }
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
          targetCollegeOrgId: props.targetOrgId,
          // 2026-11-17（学院线粒度改造）：带上归口部门，后端按「学院 × 归口部门」定位计划
          functionalOrgId: props.functionalOrgId ?? undefined
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

/**
 * 2026-11-19（学院全部导入）：执行清单确认框（规划书第二节第 4 条）。
 *
 * <p>确认框正文 = 完整执行清单：「将下发 N 组（列明职能部门）/ 将跳过 M 组（列明原因）」。
 * 用户确认无误才提交；提交后**严格按清单执行**（后端逐组处理）。</p>
 */
const confirmAllImportExecution = async (): Promise<boolean> => {
  const plan = executionPlan.value
  const dispatchLines = plan.dispatchGroups.map(group => `· ${group.title}：${group.rowsCount} 条`)
  const skipLines = plan.skipGroups.map(
    group =>
      `· ${group.title}：${group.rowsCount} 条（${group.skipReason || '线已下发，本次跳过'}）`
  )
  const errorLines = plan.errorGroups.map(
    group => `· ${group.title}：${group.groupError || '存在错误'}`
  )
  const body = [
    '本次「全部导入」执行清单：',
    '',
    `将下发 ${plan.dispatchGroups.length} 组：`,
    ...(dispatchLines.length ? dispatchLines : ['· 无']),
    '',
    `将跳过 ${plan.skipGroups.length} 组：`,
    ...(skipLines.length ? skipLines : ['· 无']),
    ...(errorLines.length ? ['', `错误 ${plan.errorGroups.length} 组：`, ...errorLines] : []),
    ...(plan.unassignedRowsCount > 0
      ? ['', `另有 ${plan.unassignedRowsCount} 行无法归组（已阻断提交）。`]
      : []),
    '',
    autoSubmitAndApprove.value
      ? '确认后将按组写入数据并自动发起审批流程；审批通过后任务将正式下发。是否继续？'
      : '确认后将按组写入数据。是否继续？'
  ].join('\n')

  try {
    await ElMessageBox.confirm(body, '确认全部导入', {
      confirmButtonText: '确认全部导入',
      cancelButtonText: '再想想',
      type: plan.errorGroups.length > 0 ? 'error' : 'warning',
      customClass: 'business-import-execution-plan'
    })
    return true
  } catch (error) {
    if (error === 'cancel' || error === 'close') {
      return false
    }
    console.error('[BusinessImportDialog] 全部导入确认框异常:', error)
    const msg = (error as { message?: string })?.message
    showCriticalErrorNotice({
      title: '确认导入失败',
      message: msg || '确认导入失败，请稍后重试',
      critical: true
    })
    return false
  }
}

/**
 * 2026-11-19（学院全部导入）：逐组提交 + 结果页。
 *
 * <p>提交严格按执行清单执行（后端按分组快照逐组处理，组间独立：一组失败不影响他组）。
 * 结果页逐组汇报：成功（附 planId）/ 跳过（原因）/ 失败（原因） + 汇总行。</p>
 */
const handleAllCommit = async () => {
  const preview = allPreviewResult.value
  if (!preview) {
    ElMessage.warning('请先解析预览')
    return
  }
  if (executionPlan.value.blocking) {
    ElMessage.warning('当前导入存在错误组，请修正后重新上传')
    return
  }
  if (!(await confirmAllImportExecution())) {
    return
  }

  committing.value = true
  try {
    const result = await businessImportApi.commitDistributionAll(preview.batchId, {
      confirmToken: preview.confirmToken ?? '',
      autoSubmitAndApprove: autoSubmitAndApprove.value
    })
    allCommitResult.value = result
    const summary = summarizeImportAllResults(result)
    if (summary.allFailed) {
      ElMessage.error('全部导入失败：所有分组均未下发，请查看逐组结果')
    } else if (summary.failed > 0) {
      ElMessage.warning(
        `全部导入部分完成：成功 ${summary.success} 组、跳过 ${summary.skipped} 组、失败 ${summary.failed} 组`
      )
    } else {
      ElMessage.success(
        `全部导入完成：成功 ${summary.success} 组、跳过 ${summary.skipped} 组、失败 ${summary.failed} 组`
      )
    }
    emit('all-committed', result)
  } catch (error) {
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

const handleCommit = async () => {
  // 2026-11-19（全部导入）：走独立的分组提交链路（逐组结果汇报）
  if (isAllImport.value) {
    await handleAllCommit()
    return
  }
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
      comment: autoSubmitAndApprove.value ? '导入后自动下发审批' : '确认导入',
      // 2026-11-17（学院线粒度改造）：学院子指标表按「学院 × 归口部门」定位计划，
      // commit 阶段同样带上归口部门（与 preview 同一入参口径）。
      // 职能部门指标表导入不适用该字段，一律不传。
      ...(isStrategicImport.value ? {} : { functionalOrgId: props.functionalOrgId ?? undefined })
    }
    const result = isStrategicImport.value
      ? await businessImportApi.commitStrategicTaskImport(previewResult.value.batchId, request)
      : await businessImportApi.commitDistributionImport(previewResult.value.batchId, request)

    if (result.status === 'COMMIT_BLOCKED') {
      // 2026-10-31：导入被阻断（「本次导入未写入」+ 后端原因）属关键报错，不自动消失
      showCriticalErrorNotice({
        title: '导入未写入',
        message: formatCommitBlockedMessageForType(result),
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
      // 2026-11-19（全部导入）：同步清空分组预览与逐组结果
      allPreviewResult.value = null
      allCommitResult.value = null
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
        <!-- 2026-11-17（学院线粒度改造）：归口部门回显——导入按「学院 × 归口部门」
             定位计划，用户必须在上传前就能确认本次导入属于哪条线。
             2026-11-19（全部导入）：归口由文件「职能部门」列解析 → 不显示本项，
             改为在解析预览里按组列出（每组一个职能部门）。 -->
        <div v-if="!isStrategicImport && !isAllImport">
          <span class="summary-label">归口部门</span>
          <strong>{{ functionalOrgName || '未选择' }}</strong>
        </div>
        <div>
          <span class="summary-label">当前周期</span>
          <strong :title="`周期ID: ${cycleId ?? '-'}`">{{ cycleDisplayLabel }}</strong>
        </div>
      </div>

      <!-- 2026-11-19（全部导入）：提示语——一次导入一个学院，自动按归口部门拆分 -->
      <el-alert
        v-if="isAllImport"
        class="all-import-mode-tip"
        type="info"
        :closable="false"
        show-icon
        :title="importModeTip"
      />

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
            <span class="el-upload__tip">{{
              isAllImport
                ? '仅支持 .xlsx，一次导入一个学院，文件内可含多个职能部门（按「职能部门」列自动拆分）。'
                : '仅支持 .xlsx，一次只导入当前选中的部门或学院。'
            }}</span>
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
          v-if="selectedFile || previewResult || hasAllPreview"
          class="next-action-tip"
          :type="
            isAllImport
              ? executionPlan.blocking
                ? 'error'
                : hasAllPreview
                  ? 'success'
                  : 'info'
              : previewResult?.blocking
                ? 'error'
                : previewResult
                  ? 'success'
                  : 'info'
          "
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
          {{ previewResult || hasAllPreview ? '重新解析预览' : '解析预览' }}
        </el-button>
      </div>

      <!-- ================================================================
           2026-11-19（学院全部导入）：分组预览 + 执行清单 + 逐组结果
           ================================================================ -->
      <template v-if="isAllImport">
        <!-- 第 2 步：分组预览（三类信息：将下发 / 将跳过 / 错误组） -->
        <template v-if="hasAllPreview && !allCommitResult">
          <el-divider />
          <div class="preview-stat-grid">
            <div class="preview-stat">
              <span>分组总数</span>
              <strong>{{ executionPlan.totalGroups }}</strong>
            </div>
            <div class="preview-stat">
              <span>将下发</span>
              <strong>{{ executionPlan.dispatchGroups.length }}</strong>
            </div>
            <div class="preview-stat" :class="{ warning: executionPlan.skipGroups.length > 0 }">
              <span>将跳过</span>
              <strong>{{ executionPlan.skipGroups.length }}</strong>
            </div>
            <div class="preview-stat" :class="{ danger: executionPlan.errorGroups.length > 0 }">
              <span>错误组</span>
              <strong>{{ executionPlan.errorGroups.length }}</strong>
            </div>
            <div class="preview-stat" :class="{ danger: executionPlan.unassignedRowsCount > 0 }">
              <span>无法归组行</span>
              <strong>{{ executionPlan.unassignedRowsCount }}</strong>
            </div>
          </div>

          <el-alert
            v-if="executionPlan.blocking"
            type="error"
            :closable="false"
            show-icon
            title="存在错误组或无法归组的行，不能确认导入"
          />
          <el-alert
            v-else
            type="success"
            :closable="false"
            show-icon
            title="分组预览通过，可以确认导入"
          />

          <!-- 执行清单（第 3 步内容预览，与确认框内容一致） -->
          <div class="execution-plan">
            <div class="execution-plan-title">执行清单</div>
            <div class="execution-plan-summary">{{ executionPlanSummary }}</div>
            <ul class="execution-plan-list">
              <li v-for="group in executionPlan.dispatchGroups" :key="`d-${group.title}`">
                <el-tag type="success" size="small">将下发</el-tag>
                {{ group.title }}（{{ group.rowsCount }} 条，线状态：{{ group.lineStatusLabel }}）
              </li>
              <li v-for="group in executionPlan.skipGroups" :key="`s-${group.title}`">
                <el-tag type="warning" size="small">将跳过</el-tag>
                {{ group.title }}：{{ group.rowsCount }} 条（{{
                  group.skipReason || '线已下发，本次跳过'
                }}）
              </li>
              <li v-for="group in executionPlan.errorGroups" :key="`e-${group.title}`">
                <el-tag type="danger" size="small">错误</el-tag>
                {{ group.title }}：{{ group.groupError || '存在错误' }}
              </li>
            </ul>
          </div>

          <!-- 分组明细：每组一张卡片（组标题 + 条数 + 线状态标记） -->
          <div class="group-list">
            <div
              v-for="group in groupViews"
              :key="`g-${group.functionalOrgId ?? 'na'}-${group.title}`"
              class="group-card"
              :class="`group-card--${group.kind}`"
            >
              <div class="group-card-header">
                <span class="group-card-title">{{ group.title }}</span>
                <el-tag v-if="group.kind === 'dispatch'" type="success" size="small">
                  将下发
                </el-tag>
                <el-tag v-else-if="group.kind === 'skip'" type="warning" size="small">
                  已下发 · 本次将跳过
                </el-tag>
                <el-tag v-else type="danger" size="small">错误组</el-tag>
                <span class="group-card-meta">
                  {{ group.rowsCount }} 条 · 线状态
                  {{ group.lineStatusLabel }}
                </span>
              </div>
              <el-alert
                v-if="group.kind === 'skip'"
                class="group-card-alert"
                type="warning"
                :closable="false"
                show-icon
                :title="group.skipReason || '该线已下发，本次将跳过'"
              />
              <el-alert
                v-if="group.kind === 'error'"
                class="group-card-alert"
                type="error"
                :closable="false"
                show-icon
                :title="group.groupError || '该组存在错误，请修正后重新上传'"
              />
              <el-table :data="group.rows" max-height="240" class="preview-table">
                <el-table-column prop="rowNo" label="序号" width="70" />
                <el-table-column label="动作" width="80">
                  <template #default="{ row }">
                    <el-tag :type="actionTagType(row.action)" size="small">
                      {{ actionText(row.action) }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="父级指标" min-width="180" show-overflow-tooltip>
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
            </div>
          </div>

          <!-- 无法归组的行（独立错误区，阻断整单）：
               后端语义 = 「职能部门与核心指标归属不符」+「无法识别归属部门」两类**无法归组**的行，
               不是"未分组"的普通行 → 红色独立区，绝不混进 groups。 -->
          <div v-if="executionPlan.unassignedRowsCount > 0" class="group-card group-card--error">
            <div class="group-card-header">
              <span class="group-card-title">无法归组的行</span>
              <el-tag type="danger" size="small">错误</el-tag>
              <span class="group-card-meta">{{ executionPlan.unassignedRowsCount }} 行</span>
            </div>
            <el-alert
              class="group-card-alert"
              type="error"
              :closable="false"
              show-icon
              title="这些行无法归组（「职能部门」列与核心指标归属不符，或无法识别归属部门），请修正后重新上传"
            />
            <el-table
              :data="allPreviewResult?.unassignedRows ?? []"
              max-height="200"
              class="preview-table"
            >
              <el-table-column prop="rowNo" label="序号" width="70" />
              <el-table-column label="父级指标" min-width="180" show-overflow-tooltip>
                <template #default="{ row }">{{ row.normalized.parentIndicator }}</template>
              </el-table-column>
              <el-table-column label="指标" min-width="180" show-overflow-tooltip>
                <template #default="{ row }">{{ row.normalized.indicatorName }}</template>
              </el-table-column>
              <el-table-column label="问题" min-width="220" show-overflow-tooltip>
                <template #default="{ row }">
                  <span v-if="row.errors?.length" class="preview-error">{{
                    row.errors.join('；')
                  }}</span>
                  <span v-else>-</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </template>

        <!-- 结果页：逐组卡片 + 汇总行 -->
        <template v-if="allCommitResult">
          <el-divider />
          <div class="preview-stat-grid">
            <div class="preview-stat">
              <span>成功</span>
              <strong class="result-success">{{ allResultSummary.success }}</strong>
            </div>
            <div class="preview-stat" :class="{ warning: allResultSummary.skipped > 0 }">
              <span>跳过</span>
              <strong>{{ allResultSummary.skipped }}</strong>
            </div>
            <div class="preview-stat" :class="{ danger: allResultSummary.failed > 0 }">
              <span>失败</span>
              <strong>{{ allResultSummary.failed }}</strong>
            </div>
          </div>
          <el-alert
            v-if="allResultSummary.allFailed"
            type="error"
            :closable="false"
            show-icon
            title="全部组均未下发，本次导入整体失败"
          />
          <div class="group-list">
            <div
              v-for="result in allResultViews"
              :key="`r-${result.functionalOrgName ?? 'na'}`"
              class="group-card"
              :class="`group-card--${result.status.toLowerCase()}`"
            >
              <div class="group-card-header">
                <span class="group-card-title">{{ result.title }}</span>
                <el-tag :type="result.tagType" size="small">{{ result.statusLabel }}</el-tag>
                <span class="group-card-meta">
                  {{ result.rowsCount }} 行
                  <template v-if="result.planId"> · 计划ID {{ result.planId }}</template>
                </span>
              </div>
              <el-alert
                v-if="result.message"
                class="group-card-alert"
                :type="
                  result.status === 'SUCCESS'
                    ? 'success'
                    : result.status === 'SKIPPED'
                      ? 'warning'
                      : 'error'
                "
                :closable="false"
                show-icon
                :title="result.message"
              />
            </div>
          </div>
        </template>
      </template>

      <!-- 单条导入既有预览（mode !== 'all' 时行为逐字不变） -->
      <template v-else-if="previewResult">
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
        <!-- 2026-11-19（全部导入）：覆盖已有数据不适用于分组提交（后端按组逐组 upsert） -->
        <el-tooltip
          v-if="!isAllImport"
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
            {{ isAllImport && allCommitResult ? '关闭' : '取消' }}
          </el-button>
          <!-- 2026-11-19（全部导入）：确认按钮置灰条件 = 无分组预览 / 有阻断项 / 已出结果 -->
          <el-button
            v-if="isAllImport"
            type="primary"
            :loading="committing"
            :disabled="!hasAllPreview || executionPlan.blocking || Boolean(allCommitResult)"
            @click="handleCommit"
          >
            {{ autoSubmitAndApprove ? '确认全部导入并下发' : '确认全部导入' }}
          </el-button>
          <el-button
            v-else
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

/* ============ 2026-11-19（学院全部导入）：分组预览 / 执行清单 / 逐组结果 ============ */

.all-import-mode-tip {
  margin: 0;
}

.execution-plan {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 12px 14px;
  background: #f9fafb;
}

.execution-plan-title {
  color: #111827;
  font-size: 14px;
  font-weight: 600;
  line-height: 22px;
}

.execution-plan-summary {
  margin-top: 4px;
  color: #374151;
  font-size: 13px;
  line-height: 20px;
}

.execution-plan-list {
  margin: 8px 0 0;
  padding-left: 20px;
  color: #4b5563;
  font-size: 13px;
  line-height: 22px;
}

.group-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.group-card {
  border: 1px solid #e5e7eb;
  border-left-width: 4px;
  border-radius: 6px;
  padding: 10px 12px;
  background: #ffffff;
}

.group-card--dispatch {
  border-left-color: #16a34a;
}

.group-card--skip {
  border-left-color: #d97706;
  background: #fffdf5;
}

.group-card--error {
  border-left-color: #dc2626;
  background: #fff7f6;
}

.group-card--success {
  border-left-color: #16a34a;
}

.group-card--skipped {
  border-left-color: #d97706;
  background: #fffdf5;
}

.group-card--failed {
  border-left-color: #dc2626;
  background: #fff7f6;
}

.group-card-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.group-card-title {
  color: #111827;
  font-size: 14px;
  font-weight: 600;
  line-height: 22px;
}

.group-card-meta {
  color: #6b7280;
  font-size: 12px;
  line-height: 20px;
}

.group-card-alert {
  margin: 8px 0;
}

.result-success {
  color: #16a34a;
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
