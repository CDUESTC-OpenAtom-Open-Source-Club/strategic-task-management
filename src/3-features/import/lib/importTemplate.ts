import type { BusinessImportType } from '@/features/import/api/businessImport'
import {
  buildExportFileName,
  type ExcelExportColumn,
  type ExcelExportSheet
} from '@/shared/lib/export/excel'

export interface ImportTemplateGuideColumn {
  key: string
  label: string
  required?: boolean
}

export interface ImportTemplateGuide {
  title: string
  targetName: string
  columns: ImportTemplateGuideColumn[]
  rows: Record<string, string>[]
  rules: string[]
}

// 2026-10-18 用户定案（晚间修订）：导入模板为「白板」——只保留导入需要的列
// （序号/部门/战略任务/核心指标/指标类型/任务类别/备注/权重）；
// 不含「内部ID」（系统内部主键，导出与模板均不再出现）、
// 「鉴定进度等级」（等级由系统评定，白板导入时不存在）、
// 「附件」（附件产生于上报环节，导入时无可导入内容）。
// 系统按列名识别（别名兼容），导出表中的额外阅读列导入时自动忽略。
const strategicImportGuide: ImportTemplateGuide = {
  title: '职能部门指标表示例',
  targetName: '职能部门',
  columns: [
    { key: 'serial', label: '序号' },
    { key: 'department', label: '部门' },
    { key: 'strategicTask', label: '战略任务', required: true },
    { key: 'indicatorName', label: '核心指标', required: true },
    { key: 'indicatorType', label: '指标类型', required: true },
    { key: 'taskCategory', label: '任务类别', required: true },
    { key: 'remark', label: '备注' },
    { key: 'weight', label: '权重' }
  ],
  rows: [
    {
      serial: '1',
      department: '教务处',
      strategicTask: '推进本科教育教学改革',
      indicatorName: '建设智慧教学质量监测体系',
      indicatorType: '定量',
      taskCategory: '基础性',
      remark: '',
      weight: '20%'
    },
    {
      serial: '2',
      department: '教务处',
      strategicTask: '完善专业建设质量保障机制',
      indicatorName: '完成重点专业年度质量报告',
      indicatorType: '定性',
      taskCategory: '发展性',
      remark: '',
      weight: '15'
    }
  ],
  rules: [
    '系统按「战略任务+核心指标」名称匹配：匹配到已存在的指标则更新原指标，匹配不到自动新增。',
    '必填列：任务类别、战略任务、核心指标、指标类型；「部门」如填写必须与当前选择的职能部门一致（留空则默认导入当前部门）。',
    '权重支持 10、10%、0.1 三种写法，系统会统一换算为百分制；同一任务下基础性权重合计需为 100。',
    '「序号」仅用于阅读对齐；「鉴定进度等级」「上报资料」由系统评定/填报产生，导入时无需填写（从导出表回导时相关列自动忽略）。'
  ]
}

const distributionImportGuide: ImportTemplateGuide = {
  title: '学院子指标表示例',
  targetName: '学院',
  columns: [
    { key: 'college', label: '学院' },
    { key: 'parentStrategicTask', label: '父级战略任务' },
    { key: 'parentIndicator', label: '父级核心指标', required: true },
    { key: 'indicatorName', label: '子指标名称', required: true },
    { key: 'indicatorType', label: '指标类型', required: true },
    { key: 'weight', label: '权重' },
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
      remark: '按父级指标拆分'
    },
    {
      college: '计算机学院',
      parentStrategicTask: '完善专业建设质量保障机制',
      parentIndicator: '完成重点专业年度质量报告',
      indicatorName: '提交学院专业质量分析报告',
      indicatorType: '定性',
      weight: '60',
      remark: ''
    }
  ],
  rules: [
    '表头建议放在第一行，列顺序可以调整，系统会按列名识别。',
    '必填列：父级核心指标、子指标名称、指标类型；如果填写学院，必须和当前选择的学院一致。',
    '模板已自动带出当前职能部门的父级核心指标行；请勿修改「父级核心指标」列的名称（系统按名称精确关联已有父级指标），在其右侧补写子指标名称/类型/权重即可；一个父级指标要拆多个子指标时，复制该行后修改子指标列。',
    '「父级战略任务」用于标明子指标的来源任务，请填写本部门已接收的战略任务名称（可在战略任务管理页查看），便于定位父级指标。',
    '权重按同一父级指标下的学院子指标合计检查，合计不是 100 会给出警告。'
  ]
}

export function getImportTemplateGuide(type: BusinessImportType): ImportTemplateGuide {
  return type === 'strategic-task' ? strategicImportGuide : distributionImportGuide
}

export interface ImportTemplateParentSeed {
  /** 父级核心指标名称（用于「父级核心指标」列预填） */
  parentIndicator: string
  /** 父级战略任务名称（用于「父级战略任务」列预填） */
  parentStrategicTask?: string
}

/**
 * 2026-10-14 用户定案（P10）：下载模板时自动带出当前职能部门/学院已有的父级核心指标——
 * 每个已有父级指标预填一行（名称来自系统，精确匹配），用户在其右侧补写子指标行，
 * 或把一行拆成多行即可。不引入内部ID列：手工导入不要求填写系统主键。
 */
export function buildImportTemplateSheet(
  type: BusinessImportType,
  parentSeeds?: ImportTemplateParentSeed[]
): ExcelExportSheet<Record<string, string>> {
  const guide = getImportTemplateGuide(type)

  const seedRows: Record<string, string>[] =
    type !== 'strategic-task' && parentSeeds?.length
      ? parentSeeds.map(seed => ({
          college: '',
          parentStrategicTask: seed.parentStrategicTask ?? '',
          parentIndicator: seed.parentIndicator,
          indicatorName: '',
          indicatorType: '',
          weight: '',
          remark: ''
        }))
      : []

  const rows = seedRows.length ? seedRows : guide.rows

  const exportColumns: ExcelExportColumn<Record<string, string>>[] = guide.columns.map(column => ({
    header: column.label,
    width: 22,
    getValue: row => row[column.key] || ''
  }))

  return {
    sheetName: type === 'strategic-task' ? '职能部门指标模板' : '学院子指标模板',
    rows,
    columns: exportColumns
  }
}

export function buildImportTemplateFileName(type: BusinessImportType): string {
  return buildExportFileName(
    type === 'strategic-task' ? '职能部门指标导入模板' : '学院子指标导入模板'
  )
}
