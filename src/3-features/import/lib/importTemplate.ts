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

/**
 * 2026-11-19（学院全部导入）：「职能部门」列头文案（模板/后端别名表统一引用）。
 *
 * <p>该列是「全部导入」的**拆批依据**——后端按此列 groupBy 分组；也是交叉校验
 * 依据（该列填的部门 ≠ 父级核心指标 target_org → 行级错误「职能部门与核心指标
 * 归属不符」）。文案漂移会导致整列不映射 → 全部行落进「无法识别归属部门」组。</p>
 */
export const FUNCTIONAL_DEPT_COLUMN_HEADER = '归口职能部门'

export interface ImportTemplateGuideColumn {
  key: string
  label: string
  required?: boolean
  /** 列宽（Excel 字符宽度），不传默认 18 */
  width?: number
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
  /** 工作表名（用户下载后看到的 sheet 名） */
  sheetName: string
  /** 「填写说明」sheet 的标题行文案 */
  rulesTitle: string
  columns: ImportTemplateGuideColumn[]
  rows: Record<string, string>[]
  rules: string[]
}

/**
 * 2026-11-19（学院全部导入）：导入模式。
 *
 * <p>single = 既有单条导入（学院子指标表按「学院 × 归口」一条线导入，8 列，无职能部门列）；
 * all = 全部导入（一份文件含多个职能部门给同一学院的指标行，9 列，多「职能部门」列）。</p>
 */
export type ImportTemplateMode = 'single' | 'all'

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
  sheetName: '职能部门指标导入模板',
  rulesTitle: '填写说明（01 · 战略部下发职能部门 · 单部门导入）',
  columns: [
    // 2026-10-31 层级化：序号 = 战略任务组号（1、2、3…按任务出现顺序），组首行必填；模板内按组合并
    { key: 'serial', label: '序号', required: true, mergeGroup: true, width: 6 },
    // 2026-10-31 用户拍板：部门列整列合并（一份导入锁定一个部门，不逐行重复）；
    // 留空默认当前部门，如填写必须与当前选择的职能部门一致
    { key: 'department', label: '部门', mergeAll: true, width: 12 },
    { key: 'strategicTask', label: '战略任务', required: true, mergeGroup: true, width: 44 },
    // 2026-10-31 终版表头：任务类型=战略任务的类型（基础性/发展性），任务级、随组合并、组内继承
    { key: 'taskType', label: '任务类型', required: true, mergeGroup: true, width: 10 },
    { key: 'indicatorName', label: '核心指标', required: true, width: 44 },
    { key: 'indicatorType', label: '指标类型', required: true, width: 10 },
    // 2026-11-11 用户拍板：权重只收纯数字（去掉 10 / 10% / 0.1 三格式混用），表头直接标口径
    { key: 'weight', label: WEIGHT_COLUMN_HEADER, width: 12 }
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
    '「任务类型」是战略任务的整体类型（基础性/发展性），按组填写一次、组内所有指标按该值落库；「部门」列已按当前下发的职能部门预填，如填写必须与当前选择的职能部门一致（留空则默认导入当前部门）。',
    '必填列：组首行的序号、战略任务、任务类型，以及每行的核心指标与指标类型。',
    '同一任务组内核心指标同名 = 更新该指标（内容列以本次填写为准），新名称 = 新增指标；不支持通过导入修改指标名称，改名请在界面修改。',
    '权重填写纯数字（如 40，不要带 % 或小数）；基础性任务及其指标的权重，全计划合计须为 100（基础性任务下的指标同为基础性，多个基础性任务组的权重一并计入合计），否则自动下发会被拦截。',
    '「审核进度」「上报资料」由系统评定/填报产生，导入时无需填写（从导出表回导时相关列自动忽略）。'
  ]
}

const distributionImportGuide: ImportTemplateGuide = {
  title: '学院子指标表示例',
  targetName: '学院',
  sheetName: '学院子指标导入模板',
  rulesTitle: '填写说明（02 · 战略部下发二级学院 · 单学院单归口导入）',
  columns: [
    // 2026-10-31 层级化：序号 = 父级核心指标组号（1、2、3…按父级指标出现顺序），组首行必填；模板内按组合并
    { key: 'serial', label: '序号', required: true, mergeGroup: true, width: 6 },
    // 2026-10-31 用户拍板：学院列整列合并（一份导入锁定一个学院，不逐行重复）；
    // 不参与分组判断，留空默认当前学院
    { key: 'college', label: '学院', mergeAll: true, width: 12 },
    // 2026-11-25 用户定案（模板对齐 02 样例）：单归口模板也带「归口职能部门」列，
    // 由系统按当前选中归口预填、随组竖向合并，导入时只读校验（与页面选中归口不一致 → 阻断）
    {
      key: 'functionalDept',
      label: FUNCTIONAL_DEPT_COLUMN_HEADER,
      required: true,
      mergeGroup: true,
      width: 16
    },
    // 2026-10-31 终版表头加列：任务类型=父级核心指标所属任务的类型（基础性/发展性），
    // 系统预填、随组合并、组内继承；锚点级只读校验（与系统不一致→阻断点名），不落库
    { key: 'taskType', label: '任务类型', required: true, mergeGroup: true, width: 10 },
    // 2026-10-31 终版表头：「核心指标」即父级核心指标；所属任务由系统按名称反查（无「父级战略任务」列）
    { key: 'parentIndicator', label: '核心指标', required: true, mergeGroup: true, width: 42 },
    // 2026-10-31 终版表头：核心指标类型=父指标自身类型（定量/定性），系统预填、只读校验、不落库
    {
      key: 'parentIndicatorType',
      label: '核心指标类型',
      required: true,
      mergeGroup: true,
      width: 12
    },
    { key: 'indicatorName', label: '子指标名称', required: true, width: 42 },
    { key: 'indicatorType', label: '指标类型', required: true, width: 10 },
    // 2026-11-11 用户拍板：权重只收纯数字（去掉 10 / 10% / 0.1 三格式混用），表头直接标口径
    { key: 'weight', label: WEIGHT_COLUMN_HEADER, width: 12 }
  ],
  rows: [
    // 示例演示「一个父级核心指标拆多个子指标」：父级 1 占三行（序号/任务类型/核心指标/核心指标类型合并，
    // 学院列整列合并）；组内子指标 40+30+30=100（基础性）；父级 2 发展性组内 60+40=100
    {
      serial: '1',
      college: '计算机学院',
      functionalDept: '教务处',
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
      functionalDept: '教务处',
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
    '模板已按组竖向合并「序号」「归口职能部门」「任务类型」「核心指标」「核心指标类型」单元格（组内多行共用一格），「学院」列整列合并（一份导入锁定一个学院，不逐行重复）；也可以不合并单元格、把延续行的组列直接留空（留空=同上），两种写法都能导入。',
    '模板不包含「父级战略任务」列：父级核心指标所属任务由系统按名称自动反查（父级指标为已下发系统数据），无需填写。',
    '「任务类型」为父级核心指标所属战略任务的类型（基础性/发展性），模板已按系统数据预填，只读校验——与系统不一致会阻断导入并点名对应行，请勿修改；子指标的“任务类别”由所属任务决定，无需填写。',
    '「核心指标」「核心指标类型」两列模板已按系统已下发数据预填（父级核心指标名称与其自身类型，定量/定性），只读校验、请勿修改：名称或类型与系统下发内容不一致（含尚未下发/同名多条）会阻断导入并点名对应行，核心指标按名称精确关联、请勿改名。',
    '必填列：每行的子指标名称与指标类型、以及权重；「序号 / 归口职能部门 / 任务类型 / 核心指标 / 核心指标类型 / 学院」均由模板按当前所选学院与归口部门预填（整列或按组合并，不参与分组判断的学院列如填写必须与当前选择的学院一致，留空则默认导入当前学院；「归口职能部门」留空则默认导入当前选中的归口部门），用户只需在父级行下填写子指标名称、指标类型与权重（可加「组列留空」延续行拆多个子指标）。',
    '同一父级组内子指标同名 = 更新该子指标（内容列以本次填写为准），新名称 = 新增；不支持通过导入修改子指标名称，改名请在界面修改。',
    '权重填写纯数字（如 40，不要带 % 或小数）；基础性任务及其指标的权重，全计划合计须为 100（基础性任务下的指标同为基础性，多个基础性任务组的权重一并计入合计；自动下发时仍会按最终权重校验拦截）。'
  ]
}

/**
 * 2026-11-19（学院全部导入 · 规划书第一节）：全部导入模板 —— **9 列**。
 *
 * <p>与单条学院模板（8 列）同骨架 + 新增「职能部门」列（插在「学院」列之后）：
 * 序号|学院|**职能部门**|任务类型|核心指标|核心指标类型|子指标名称|指标类型|权重</p>
 *
 * <p>「职能部门」列的三重作用（规划书第一节）：
 * ① 拆批依据（显式 groupBy）——不再隐式靠父级反查推导；
 * ② 交叉校验（防呆）——该列填的部门 ≠ 父级核心指标 target_org → 行级错误；
 * ③ 用户可读——Excel 里一眼看到每行由哪个部门下发。</p>
 *
 * <p>「职能部门」列**随组竖向合并**（一个父级锚点 = 一个归口部门，组内一致；
 * 延续行留空 = 同上，与既有 sticky 口径一致）。用户若把同一锚点的行填成不同部门，
 * 后端会按行级错误点名「职能部门与核心指标归属不符」。</p>
 */
const distributionAllImportGuide: ImportTemplateGuide = {
  title: '学院子指标表（全部导入）示例',
  targetName: '学院',
  sheetName: '学院子指标全部导入模板',
  rulesTitle: '填写说明（03 · 战略部下发二级学院 · 全部导入）',
  columns: [
    { key: 'serial', label: '序号', required: true, mergeGroup: true, width: 6 },
    // 学院列整列合并（一份导入锁定一个学院）
    { key: 'college', label: '学院', mergeAll: true, width: 12 },
    // 2026-11-19 新增：职能部门列（拆批依据 + 交叉校验依据），随组竖向合并
    {
      key: 'functionalDept',
      label: FUNCTIONAL_DEPT_COLUMN_HEADER,
      required: true,
      mergeGroup: true,
      width: 16
    },
    { key: 'taskType', label: '任务类型', required: true, mergeGroup: true, width: 10 },
    { key: 'parentIndicator', label: '核心指标', required: true, mergeGroup: true, width: 42 },
    {
      key: 'parentIndicatorType',
      label: '核心指标类型',
      required: true,
      mergeGroup: true,
      width: 12
    },
    { key: 'indicatorName', label: '子指标名称', required: true, width: 42 },
    { key: 'indicatorType', label: '指标类型', required: true, width: 10 },
    { key: 'weight', label: WEIGHT_COLUMN_HEADER, width: 12 }
  ],
  rows: [
    // 示例演示「一份文件两个职能部门」：第 1-2 行教务处，第 3 行数字校园建设办公室
    {
      serial: '1',
      college: '文理学院',
      functionalDept: '教务处',
      taskType: '基础性',
      parentIndicator: '推进课堂教学改革与课程思政建设',
      parentIndicatorType: '定量',
      indicatorName: '课堂教学改革专项',
      indicatorType: '定量',
      weight: '60'
    },
    {
      serial: '',
      college: '',
      functionalDept: '',
      taskType: '',
      parentIndicator: '',
      parentIndicatorType: '',
      indicatorName: '课程思政示范课建设',
      indicatorType: '定性',
      weight: '40'
    },
    {
      serial: '2',
      college: '',
      functionalDept: '数字校园建设办公室',
      taskType: '发展性',
      parentIndicator: '建设数字化校园管理平台',
      parentIndicatorType: '定量',
      indicatorName: '数据治理平台建设',
      indicatorType: '定量',
      weight: '100'
    }
  ],
  rules: [
    '使用者：战略发展部在「战略任务管理 → 二级学院页签」用「全部导入」按钮上传；一份文件可含多个归口部门给同一学院的指标行。',
    '列结构（9 列）：序号 / 学院 / 归口职能部门 / 任务类型 / 核心指标 / 核心指标类型 / 子指标名称 / 指标类型 / 权重（纯数字）。',
    '🔴 拆分依据：「归口职能部门」列决定每一行归到哪个归口小组，系统按该列把文件拆成若干条「学院 × 归口部门」的线并分别落库；该列与核心指标的实际归属不一致会阻断并点名对应行。',
    '每组（每个归口部门）各自独立做权重校验：基础性任务及其指标的权重，该组合计须为 100；某组不达标只影响该组，但会阻断本次整单提交。',
    '任务类型 / 核心指标 / 核心指标类型由模板按系统数据预填，只读校验，请勿修改。',
    '同一父级组内子指标同名 = 更新该子指标，新名称 = 新增；不支持通过导入修改子指标名称。',
    '黄色底纹行为示例数据，正式使用前请替换。'
  ]
}

/**
 * 取得导入模板的列定义与规则说明。
 *
 * @param type 导入类型（职能部门指标表 / 学院子指标表）
 * @param mode 导入模式（single = 单条导入默认；all = 全部导入，9 列带职能部门列）
 */
export function getImportTemplateGuide(
  type: BusinessImportType,
  mode: ImportTemplateMode = 'single'
): ImportTemplateGuide {
  if (mode === 'all') {
    return type === 'strategic-task' ? strategicImportGuide : distributionAllImportGuide
  }
  return type === 'strategic-task' ? strategicImportGuide : distributionImportGuide
}

export interface ImportTemplateParentSeed {
  /** 父级核心指标名称（用于「核心指标」列预填） */
  parentIndicator: string
  /** 当前选中学院名称（用于「学院」列预填，2026-10-31 层级化定案：模板自带预填） */
  college?: string
  /**
   * 2026-11-25 用户定案（01 模板部门列）：当前下发的**职能部门**名称。
   *
   * <p>职能部门导入模板的示例行内容保持样例不变，只把「部门」列（整列合并）替换成真实目标部门，
   * 避免不同部门下载到的模板都写着示例里的「教务处」。</p>
   */
  department?: string
  /** 父级指标自身类型（定量/定性，用于「核心指标类型」列预填，2026-10-31 终版表头） */
  parentIndicatorType?: string
  /** 父级核心指标所属任务的类型（基础性/发展性，用于「任务类型」列预填，2026-10-31 终版表头加列） */
  taskType?: string
  /**
   * 2026-11-19（学院全部导入）：该父级核心指标所属的**归口部门名称**（职能部门列预填）。
   *
   * <p>全部导入模式必填（该列是拆批依据）；单条导入模式忽略（单条已选归口，冗余）。</p>
   */
  functionalDept?: string
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
  parentSeeds?: ImportTemplateParentSeed[],
  mode: ImportTemplateMode = 'single'
): ExcelExportSheet<Record<string, string>> {
  const guide = getImportTemplateGuide(type, mode)

  const seedRows: Record<string, string>[] =
    type !== 'strategic-task' && parentSeeds?.length
      ? parentSeeds.map((seed, index) => ({
          // 序号 = 父级核心指标组号（1、2、3…）
          serial: String(index + 1),
          college: seed.college ?? '',
          // 2026-11-19（全部导入）/ 2026-11-25（单归口）：归口职能部门列预填——
          // 全部导入按父级指标归属预填（拆批依据），单归口由调用方传入当前选中归口
          functionalDept: seed.functionalDept ?? '',
          taskType: seed.taskType ?? '',
          parentIndicator: seed.parentIndicator,
          parentIndicatorType: seed.parentIndicatorType ?? '',
          indicatorName: '',
          indicatorType: '',
          weight: ''
        }))
      : []

  // 2026-11-25 用户反馈：「战略部给不同职能部门下发的模板，部门列都是教务处」——
  // 职能部门模板的「部门」列改为跟随当前下发目标部门（示例内容仍保留样例，便于参考版式）。
  const strategicDepartment =
    type === 'strategic-task' ? String(parentSeeds?.[0]?.department ?? '').trim() : ''
  const guideRows =
    strategicDepartment && guide.rows.length
      ? guide.rows.map((row, index) =>
          index === 0 ? { ...row, department: strategicDepartment } : row
        )
      : guide.rows

  const rows = seedRows.length ? seedRows : guideRows

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
    width: column.width ?? 22,
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
    // 2026-11-25 用户定案（模板对齐样例）：sheet 名与视觉（深蓝表头 + 黄色示例行 + 行高）随样例走
    sheetName: guide.sheetName,
    rows,
    columns: exportColumns,
    headerBackgroundColor: '#1f3864',
    headerHeight: 32,
    bodyRowHeight: 42,
    getRowTone: () => 'template' as const
  }
}

export function buildImportTemplateFileName(
  type: BusinessImportType,
  mode: ImportTemplateMode = 'single'
): string {
  const base = type === 'strategic-task' ? '职能部门指标导入模板' : '学院子指标导入模板'
  return buildExportFileName(mode === 'all' ? `${base}（全部导入）` : base)
}

/**
 * 2026-11-25（模板对齐样例）：整份模板 = 「数据 sheet + 填写说明 sheet」。
 * 抽成纯函数，便于单测直接产出文件核对版式（弹窗只负责下载）。
 */
export function buildImportTemplateSheets(
  type: BusinessImportType,
  parentSeeds: ImportTemplateParentSeed[] | undefined,
  mode: ImportTemplateMode = 'single'
): ExcelExportSheet<Record<string, string>>[] {
  const guide = getImportTemplateGuide(type, mode)
  // 填写说明版式：标题行 + 一个空行 + 1./2./3… 条目，列宽 114（与样例一致）
  const rulesSheet: ExcelExportSheet<Record<string, string>> = {
    sheetName: '填写说明',
    rows: [{ text: '' }, ...guide.rules.map((rule, index) => ({ text: `${index + 1}. ${rule}` }))],
    columns: [
      {
        header: guide.rulesTitle,
        width: 114,
        getValue: row => row.text
      }
    ],
    headerBackgroundColor: '#ffffff',
    headerTextColor: '#1f3864',
    headerHeight: 26,
    bodyRowHeight: 26
  }
  return [buildImportTemplateSheet(type, parentSeeds, mode), rulesSheet]
}
