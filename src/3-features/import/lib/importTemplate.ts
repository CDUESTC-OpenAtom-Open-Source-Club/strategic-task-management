import type { BusinessImportType } from '@/features/import/api/businessImport'
import {
  buildExportFileName,
  buildWholeColumnMergedCell,
  type ExcelExportColumn,
  type ExcelExportSheet
} from '@/shared/lib/export/excel'

/**
 * 2026-11-12 权重列头唯一文案源（模板/导出/测试统一引用）：
 * 后端 ExcelBusinessImportParser 按表头全等匹配，文案漂移会导致权重整列不映射
 * （weight=null 按默认 100 处理）——改文案必须同步后端别名表，单点改这里。
 */
export const WEIGHT_COLUMN_HEADER = '权重（纯数字）'

export interface ImportTemplateGuideColumn {
  key: string
  label: string
  required?: boolean
  /**
   * 2026-10-31 层级化定案（用户终版表头）：参与「按组竖向合并」的列——
   * 职能部门模板=序号+战略任务+任务类型；学院模板=序号+任务类型+核心指标+核心指标类型。
   * 组内 N 行合并成 1 格（锚点格携带 rowSpan，从属格传 null）。
   */
  mergeGroup?: boolean
  /**
   * 2026-10-31 用户拍板（部门/学院列整列合并）：一份导入锁定一个部门/学院（用户裁定重复冗余），
   * 该列从组内合并改为跨全部数据行整列合并（首行 rowSpan=数据行数，从属格传 null）。
   * 解析兼容：合并从属格读空=默认当前部门/学院（既有语义不变）。
   */
  mergeAll?: boolean
}

export interface ImportTemplateGuide {
  title: string
  targetName: string
  columns: ImportTemplateGuideColumn[]
  rows: Record<string, string>[]
  rules: string[]
}

// 2026-10-31 用户拍板（导入模板层级化改造，终版表头）：
// - 职能部门模板 7 列：序号|部门|战略任务|任务类型|核心指标|指标类型|权重
//   （2026-11-11 用户拍板：「下发备注」列全端隐藏，模板不再带该列）。
//   「任务类型」= 战略任务的类型（基础性/发展性，即数据模型 taskCategory），升为任务级：
//   随组竖向合并、组内所有指标继承该值落库到各自 taskCategory；表头「任务类型」「任务类别」都识别。
// - 学院模板 8 列（2026-10-31 终版表头加「任务类型」列）：序号|学院|任务类型|核心指标|核心指标类型|
//   子指标名称|指标类型|权重。「核心指标」即父级核心指标（系统按名称反查所属任务，
//   「父级战略任务」列已删除）；「任务类型」= 父级核心指标所属任务的类型（基础性/发展性），系统预填、
//   随组合并、锚点级只读校验（与系统父级所属任务类型不一致→阻断点名，后端
//   BusinessImportApplicationService.applyDistributionAnchor 同步扩展）；不新增落库字段。
//   「核心指标类型」= 父指标自身类型（定量/定性），系统预填、解析时只读校验
//   （与系统父指标实际类型不一致→警告不阻断），不作为用户输入落库。
// - 「序号」= 组号（职能部门按战略任务、学院按父级核心指标）；组内后续行组列留空 = 延续上一组
//   （sticky 向下继承）。模板按组竖向合并组列；用户不合并、纯留空也能导入（两种写法同等支持）。
// - 「部门/学院」列整列合并（2026-10-31 用户拍板：一份导入锁定一个部门/学院，重复冗余）；
//   解析兼容：合并从属格读空=默认当前部门/学院（既有语义不变）。
// - 更新语义按名称：同组内核心指标/子指标同名 = 更新（内容列以新值为准），新名称 = 新增；
//   改名不支持（提示走界面修改）。落库匹配键 =（任务, 核心指标名）/（父级核心指标, 子指标名）。
// - 权重口径（2026-10-31 用户拍板改为计划级）：基础性任务及其指标的权重全计划合计须为 100，
//   不再按「组内合计=100」表述；解析链的组级权重提示仅作填写参考警告，下发以计划级合计校验为准。
const strategicImportGuide: ImportTemplateGuide = {
  title: '职能部门指标表示例',
  targetName: '职能部门',
  columns: [
    // 2026-10-31 层级化：序号 = 战略任务组号（1、2、3…按任务出现顺序），组首行必填；模板内按组合并
    { key: 'serial', label: '序号', required: true, mergeGroup: true },
    // 2026-10-31 用户拍板：部门列整列合并（一份导入锁定一个部门，不逐行重复）；
    // 留空默认当前部门，如填写必须与当前选择的职能部门一致
    { key: 'department', label: '部门', mergeAll: true },
    { key: 'strategicTask', label: '战略任务', required: true, mergeGroup: true },
    // 2026-10-31 终版表头：任务类型=战略任务的类型（基础性/发展性），任务级、随组合并、组内继承
    { key: 'taskType', label: '任务类型', required: true, mergeGroup: true },
    { key: 'indicatorName', label: '核心指标', required: true },
    { key: 'indicatorType', label: '指标类型', required: true },
    // 2026-11-11 用户拍板：权重只收纯数字（去掉 10 / 10% / 0.1 三格式混用），表头直接标口径
    { key: 'weight', label: WEIGHT_COLUMN_HEADER }
  ],
  rows: [
    // 示例演示层级化版式（组列=序号/战略任务/任务类型按组竖向合并，部门列整列合并）：
    // 任务 1 占三行：组首行填组号/任务/任务类型，其余行组列留空（合并单元格的非锚点格）= 同上；
    // 任务 1 基础性 20+30+50=100；任务 2 基础性 40+35+25=100；任务 3 发展性单行 100
    {
      serial: '1',
      department: '教务处',
      strategicTask: '推进本科教育教学改革',
      taskType: '基础性',
      indicatorName: '建设智慧教学质量监测体系',
      indicatorType: '定量',
      weight: '20'
    },
    {
      serial: '',
      department: '',
      strategicTask: '',
      taskType: '',
      indicatorName: '建成教学质量数据平台',
      indicatorType: '定量',
      weight: '30'
    },
    {
      serial: '',
      department: '',
      strategicTask: '',
      taskType: '',
      indicatorName: '开展课堂教学改革试点',
      indicatorType: '定性',
      weight: '50'
    },
    {
      serial: '2',
      department: '',
      strategicTask: '完善专业建设质量保障机制',
      taskType: '基础性',
      indicatorName: '完成重点专业年度质量报告',
      indicatorType: '定性',
      weight: '40'
    },
    {
      serial: '',
      department: '',
      strategicTask: '',
      taskType: '',
      indicatorName: '建立专业动态调整机制',
      indicatorType: '定性',
      weight: '35'
    },
    {
      serial: '',
      department: '',
      strategicTask: '',
      taskType: '',
      indicatorName: '组织专业评估与认证',
      indicatorType: '定性',
      weight: '25'
    },
    {
      serial: '3',
      department: '',
      strategicTask: '提升实践教学水平',
      taskType: '发展性',
      indicatorName: '建设虚拟仿真实验中心',
      indicatorType: '定量',
      weight: '100'
    }
  ],
  rules: [
    // 2026-10-31 层级化定案：序号=组号，组内留空向下继承；不再按序号做行身份精确更新
    '「序号」为战略任务组号：按 1、2、3… 顺序给每个战略任务编号；组首行必填序号、战略任务与任务类型，组内后续行组列留空即延续上一行所属任务（留空=同上）。',
    '模板已按组竖向合并「序号」「战略任务」「任务类型」单元格（组内多行共用一格），「部门」列整列合并（一份导入锁定一个部门，不逐行重复）；也可以不合并单元格、把延续行的组列直接留空（留空=同上），两种写法都能导入。',
    // 任务类型=任务级（终版口径）；页面仍叫「任务类别」，仅模板表头用「任务类型」
    '「任务类型」是战略任务的整体类型（基础性/发展性），按组填写一次、组内所有指标按该值落库；「部门」如填写必须与当前选择的职能部门一致（留空则默认导入当前部门）。',
    '必填列：组首行的序号、战略任务、任务类型，以及每行的核心指标与指标类型。',
    // 2026-10-31：更新语义按名称——同组同名=更新、新名称=新增；改名不支持
    '同一任务组内核心指标同名 = 更新该指标（内容列以本次填写为准），新名称 = 新增指标；不支持通过导入修改指标名称，改名请在界面修改。',
    // 2026-10-31 用户拍板：权重口径改为计划级——基础性任务及其指标的权重全计划合计须为 100；
    // 2026-11-11 用户拍板：权重只填纯数字（去掉 10% / 0.1 百分比与小数写法）
    '权重填写纯数字（如 40，不要带 % 或小数）；基础性任务及其指标的权重，全计划合计须为 100（基础性任务下的指标同为基础性，多个基础性任务组的权重一并计入合计），否则自动下发会被拦截。',
    '「审核进度」「上报资料」由系统评定/填报产生，导入时无需填写（从导出表回导时相关列自动忽略）。'
  ]
}

const distributionImportGuide: ImportTemplateGuide = {
  title: '学院子指标表示例',
  targetName: '学院',
  columns: [
    // 2026-10-31 层级化：序号 = 父级核心指标组号（1、2、3…按父级指标出现顺序），组首行必填；模板内按组合并
    { key: 'serial', label: '序号', required: true, mergeGroup: true },
    // 2026-10-31 用户拍板：学院列整列合并（一份导入锁定一个学院，不逐行重复）；
    // 不参与分组判断，留空默认当前学院
    { key: 'college', label: '学院', mergeAll: true },
    // 2026-10-31 终版表头加列：任务类型=父级核心指标所属任务的类型（基础性/发展性），
    // 系统预填、随组合并、组内继承；锚点级只读校验（与系统不一致→阻断点名），不落库
    { key: 'taskType', label: '任务类型', required: true, mergeGroup: true },
    // 2026-10-31 终版表头：「核心指标」即父级核心指标；所属任务由系统按名称反查（无「父级战略任务」列）
    { key: 'parentIndicator', label: '核心指标', required: true, mergeGroup: true },
    // 2026-10-31 终版表头：核心指标类型=父指标自身类型（定量/定性），系统预填、只读校验、不落库
    { key: 'parentIndicatorType', label: '核心指标类型', required: true, mergeGroup: true },
    { key: 'indicatorName', label: '子指标名称', required: true },
    { key: 'indicatorType', label: '指标类型', required: true },
    // 2026-11-11 用户拍板：权重只收纯数字（去掉 10 / 10% / 0.1 三格式混用），表头直接标口径
    { key: 'weight', label: WEIGHT_COLUMN_HEADER }
  ],
  rows: [
    // 示例演示「一个父级核心指标拆多个子指标」：父级 1 占三行（序号/任务类型/核心指标/核心指标类型合并，
    // 学院列整列合并）；组内子指标 40+30+30=100（基础性）；父级 2 发展性组内 60+40=100
    {
      serial: '1',
      college: '计算机学院',
      taskType: '基础性',
      parentIndicator: '建设智慧教学质量监测体系',
      parentIndicatorType: '定量',
      indicatorName: '完成课程质量数据接入',
      indicatorType: '定量',
      weight: '40'
    },
    {
      serial: '',
      college: '',
      taskType: '',
      parentIndicator: '',
      parentIndicatorType: '',
      indicatorName: '完成评教数据接入',
      indicatorType: '定量',
      weight: '30'
    },
    {
      serial: '',
      college: '',
      taskType: '',
      parentIndicator: '',
      parentIndicatorType: '',
      indicatorName: '建成教学质量看板',
      indicatorType: '定量',
      weight: '30'
    },
    {
      serial: '2',
      college: '',
      taskType: '发展性',
      parentIndicator: '完成重点专业年度质量报告',
      parentIndicatorType: '定性',
      indicatorName: '提交学院专业质量分析报告',
      indicatorType: '定性',
      weight: '60'
    },
    {
      serial: '',
      college: '',
      taskType: '',
      parentIndicator: '',
      parentIndicatorType: '',
      indicatorName: '完成专业评估支撑材料整理',
      indicatorType: '定性',
      weight: '40'
    }
  ],
  rules: [
    '「序号」为父级核心指标（即「核心指标」列）组号：按 1、2、3… 顺序给每个父级核心指标编号；序号或组列留空 = 延续上一组父级指标（留空=同上），一个父级指标可拆多个子指标（多行延续）。',
    '模板已按组竖向合并「序号」「任务类型」「核心指标」「核心指标类型」单元格（组内多行共用一格），「学院」列整列合并（一份导入锁定一个学院，不逐行重复）；也可以不合并单元格、把延续行的组列直接留空（留空=同上），两种写法都能导入。',
    '模板不包含「父级战略任务」列：父级核心指标所属任务由系统按名称自动反查（父级指标为已下发系统数据），无需填写。',
    // 2026-11-13（方案甲恢复）：学院页签下载模板恢复预填真实父级行（父级锚点 seeds），
    // 三条说明随之改回「已预填、只读校验」口径；锚点校验语义保持后端真实行为——
    // 任务类型/核心指标类型与系统不一致=阻断点名（2026-10-31 已从警告升级为阻断，
    // 不回退旧文案的「警告不阻断」表述），名称不一致/未下发/同名多条=阻断。
    '「任务类型」为父级核心指标所属战略任务的类型（基础性/发展性），模板已按系统数据预填，只读校验——与系统不一致会阻断导入并点名对应行，请勿修改；子指标的“任务类别”由所属任务决定，无需填写。',
    '「核心指标」「核心指标类型」两列模板已按系统已下发数据预填（父级核心指标名称与其自身类型，定量/定性），只读校验、请勿修改：名称或类型与系统下发内容不一致（含尚未下发/同名多条）会阻断导入并点名对应行，核心指标按名称精确关联、请勿改名。',
    '必填列：每行的子指标名称与指标类型、以及权重；「序号 / 任务类型 / 核心指标 / 核心指标类型 / 学院」均由模板按当前所选部门与学院预填（整列或按组合并，不参与分组判断的学院列如填写必须与当前选择的学院一致，留空则默认导入当前学院），用户只需在父级行下填写子指标名称、指标类型与权重（可加「组列留空」延续行拆多个子指标）。',
    '同一父级组内子指标同名 = 更新该子指标（内容列以本次填写为准），新名称 = 新增；不支持通过导入修改子指标名称，改名请在界面修改。',
    // 2026-10-31 用户拍板：权重口径改为计划级（与职能部门模板同口径），不再按父级组内合计表述；
    // 2026-11-11 用户拍板：权重只填纯数字（去掉 10% / 0.1 百分比与小数写法）
    '权重填写纯数字（如 40，不要带 % 或小数）；基础性任务及其指标的权重，全计划合计须为 100（基础性任务下的指标同为基础性，多个基础性任务组的权重一并计入合计；自动下发时仍会按最终权重校验拦截）。'
  ]
}

export function getImportTemplateGuide(type: BusinessImportType): ImportTemplateGuide {
  return type === 'strategic-task' ? strategicImportGuide : distributionImportGuide
}

export interface ImportTemplateParentSeed {
  /** 父级核心指标名称（用于「核心指标」列预填） */
  parentIndicator: string
  /** 当前选中学院名称（用于「学院」列预填，2026-10-31 层级化定案：模板自带预填） */
  college?: string
  /** 父级指标自身类型（定量/定性，用于「核心指标类型」列预填，2026-10-31 终版表头） */
  parentIndicatorType?: string
  /** 父级核心指标所属任务的类型（基础性/发展性，用于「任务类型」列预填，2026-10-31 终版表头加列） */
  taskType?: string
}

/**
 * 2026-10-14 用户定案（P10）：下载模板时自动带出当前职能部门/学院已有的父级核心指标——
 * 每个已有父级指标预填一行（序号=组号、任务类型/核心指标/核心指标类型预填，2026-10-31 终版表头），
 * 用户在该行填第一个子指标，再向下加「组列留空」的延续行拆多个子指标。
 * 不引入内部ID列：手工导入不要求填写系统主键。
 *
 * 2026-10-31 用户拍板修订：组列按组竖向合并——每个组只占一格
 * （锚点格 rowSpan=组行数，从属格传 null，write-excel-file 语义同导出表）；
 * 「学院」列整列合并（跨全部数据行共用一格）。
 */
export function buildImportTemplateSheet(
  type: BusinessImportType,
  parentSeeds?: ImportTemplateParentSeed[]
): ExcelExportSheet<Record<string, string>> {
  const guide = getImportTemplateGuide(type)

  const seedRows: Record<string, string>[] =
    type !== 'strategic-task' && parentSeeds?.length
      ? parentSeeds.map((seed, index) => ({
          // 序号 = 父级核心指标组号（1、2、3…）
          serial: String(index + 1),
          college: seed.college ?? '',
          taskType: seed.taskType ?? '',
          parentIndicator: seed.parentIndicator,
          parentIndicatorType: seed.parentIndicatorType ?? '',
          indicatorName: '',
          indicatorType: '',
          weight: ''
        }))
      : []

  const rows = seedRows.length ? seedRows : guide.rows

  // 按组计算合并行数：serial 非空 = 组首行；serial 留空 = 延续上一组（与解析器 sticky 口径一致）。
  // 组首行记 rowSpan（>1 时锚点格携带），延续行记 0（从属格传 null）。
  const groupSpanByIndex = new Map<number, number>()
  let groupStart = -1
  rows.forEach((row, index) => {
    if (String(row.serial ?? '').trim() || groupStart < 0) {
      groupStart = index
      groupSpanByIndex.set(index, 1)
      return
    }
    groupSpanByIndex.set(index, 0)
    groupSpanByIndex.set(groupStart, (groupSpanByIndex.get(groupStart) ?? 1) + 1)
  })

  const exportColumns: ExcelExportColumn<Record<string, string>>[] = guide.columns.map(column => ({
    header: column.label,
    width: 22,
    getValue: (row, index) => {
      if (column.mergeAll) {
        // 2026-10-31 用户拍板：部门/学院列整列合并——首行锚点 rowSpan=全部数据行，从属格传 null
        return buildWholeColumnMergedCell(index, rows.length, row[column.key] || '')
      }
      if (column.mergeGroup) {
        const span = groupSpanByIndex.get(index) ?? 1
        const text = row[column.key] || ''
        if (span > 1) {
          // 组锚点格：竖向合并组内全部行
          return { value: text, rowSpan: span, alignVertical: 'center' }
        }
        if (span === 0) {
          // 被上方合并覆盖的从属格：write-excel-file 要求传 null
          return null
        }
      }
      return row[column.key] || ''
    }
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
