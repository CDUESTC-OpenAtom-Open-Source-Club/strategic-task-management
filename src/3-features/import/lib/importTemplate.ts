import type { BusinessImportType } from '@/features/import/api/businessImport'
import {
  buildExportFileName,
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

/**
 * 2026-11-26（下发侧导入模板 01/02/03 样式全面对齐）：与需求方定稿样例
 * `导入模板样例/SISM-导入模板-01/02/03-*.xlsx` 逐格对齐的样式常量。
 *
 * <p>样例口径（三份同构）：表头 `#1F3864` 深蓝底 + 微软雅黑 11 加粗白字 + center/center + wrap
 * + thin 边框 `#BBBBBB` + 行高 32；数据行 `#FFF2CC` 黄底 + 微软雅黑 **10** 常规
 * + center/center + wrap + thin 边框 `#BBBBBB` + 行高 42；冻结 A2；网格线可见；
 * 说明页白底无边框、标题在 A1（微软雅黑 11 加粗黑字）、第 2 行空行、条目行高 26、列宽 114、
 * 不冻结、垂直居中 wrap。</p>
 *
 * <p>说明：「任务类型」列样例为**左对齐**（其余数据列居中），故单独处理。</p>
 */
const TEMPLATE_STYLE = {
  /** 字体族（样例 styles.xml 的 `<name val="微软雅黑"/>`） */
  fontFamily: '微软雅黑',
  /** 表头底色 */
  headerBackground: '#1F3864',
  /** 表头文字色（白） */
  headerTextColor: '#ffffff',
  /** 统一细边框色（表头 + 数据行） */
  borderColor: '#BBBBBB',
  /** 数据行字号（样例为 10，比全局 11 小一号；表头沿用全局 11） */
  bodyFontSize: 10,
  /** 表头行高 */
  headerHeight: 32,
  /** 数据行行高 */
  bodyRowHeight: 42,
  /** 说明页列宽 */
  guideColumnWidth: 114,
  /** 说明页行高（标题行 / 空行 / 条目行一致） */
  guideRowHeight: 26,
  /** 样例中「任务类型」列为左对齐 */
  leftAlignedColumnKey: 'taskType'
} as const

export interface ImportTemplateGuideColumn {
  key: string
  label: string
  required?: boolean
  /** 列宽（Excel 字符宽度），不传默认 18 */
  width?: number
  /**
   * 2026-10-31 层级化定案（用户终版表头）：参与「按组竖向合并」的列——
   * 职能部门模板=战略任务+任务类型；学院模板=任务类型+核心指标+核心指标类型。
   * 组内 N 行合并成 1 格（锚点格携带 rowSpan，从属格传 null）。
   *
   * <p>2026-11-26（下发侧语义修正，对齐 01/02/03 样例）：「序号」在三类模板里均不再参与
   * 按组合并（序号 = 最末级指标行号，逐行递增）；判组依据由「序号列非空」改为**关键列非空**
   * （01 =「战略任务」列、02/03 =「核心指标」列），与后端解析器的归组口径一致。</p>
   */
  mergeGroup?: boolean
  /**
   * 2026-11-26（对齐 01/02/03 样例，取代原「整列合并 mergeAll」）：参与「按块竖向合并」的列。
   *
   * <p>块 = 模板顶级分组的连续块：职能部门模板 = 每个战略任务组一块；学院模板 =
   * 「归口职能部门」相同的连续父级核心指标组并成一块。每块 N 行合并成 1 格，
   * **每块锚点重复写值**（样例 01：`B2:B4` + B5 再写「教务处」；样例 03：`B2:B3` + B4 再写
   * 「文理学院」）。</p>
   *
   * <p>部门/学院列的重复写值必须与页面选定的部门/学院完全一致——后端「与页面选定不一致整单拒绝」。
   * 解析兼容：合并从属格读空=默认当前部门/学院（既有语义不变）。</p>
   */
  mergeBlock?: boolean
  /**
   * 2026-11-26（对齐样例）：写**数值型**单元格（样例「序号」「权重」为数字，非文本）。
   * 后端按字符串归一（DataFormatter），不影响解析。
   */
  numeric?: boolean
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
// - 组首行锚定 = **关键列非空**（2026-11-26 下发侧语义修正，对齐 01/02/03 样例）：
//   职能部门=「战略任务」列、学院=「核心指标」列；组内后续行关键列留空 = 延续上一组
//   （sticky 向下继承，与后端解析器归组口径一致——判组不再看「序号」列）。
//   模板按组竖向合并组列；用户不合并、纯留空也能导入（两种写法同等支持）。
// - 「序号」= 最末级指标行号（职能部门=核心指标、学院=子指标）：逐行递增 1..N、写数值型、
//   不参与合并（三类模板同口径；样例「序号」列合并区均为空）。
// - 2026-11-26（学院导入序号语义改造）：学院模板（02 单点/03 全部导入）序号预填逐行递增
//   （N=锚点行数）；留空时后端自动按物理行号补号；归属与校验全部锚定「核心指标」列，序号不参与归组。
// - 「部门/学院」列按块竖向合并 + 每块锚点重复写值（2026-11-26，取代原「整列合并」）：
//   块 = 模板顶级分组的连续块——职能部门模板每个战略任务组一块；学院模板「归口职能部门」
//   相同的连续父级核心指标组并成一块（样例 01：B2:B4 + B5 再写「教务处」；
//   样例 02：归口相同 → B2:B4 跨两个核心指标组；样例 03：B2:B3 + B4 再写「文理学院」）。
//   一份导入仍锁定一个部门/学院：重复写值必须与页面选定完全一致
//   （后端「与页面选定不一致整单拒绝」）；合并从属格读空=默认当前部门/学院（既有语义不变）。
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
    // 2026-11-26（下发侧语义修正，对齐 01 样例）：序号 = 核心指标行号——逐行递增 1..N、
    // 写数值型、**不再按组合并**（样例「序号」列 1/2/3/4 对应四个核心指标，合并区为空）。
    // 必填标记保留：后端 validate 对序号为空的行报错（组内延续行继承组首行序号）。
    { key: 'serial', label: '序号', required: true, numeric: true, width: 6 },
    // 2026-11-26（对齐 01 样例）：部门列按块合并（每个战略任务组一块）+ 每块锚点重复写值
    // （样例 B2:B4 + B5 再写「教务处」）；留空默认当前部门，如填写必须与当前选择的职能部门一致
    { key: 'department', label: '部门', mergeBlock: true, width: 12 },
    // 判组依据（2026-11-26）：「战略任务」列非空 = 组首行（不再看序号列）
    { key: 'strategicTask', label: '战略任务', required: true, mergeGroup: true, width: 44 },
    // 2026-10-31 终版表头：任务类型=战略任务的类型（基础性/发展性），任务级、随组合并、组内继承
    { key: 'taskType', label: '任务类型', required: true, mergeGroup: true, width: 10 },
    { key: 'indicatorName', label: '核心指标', required: true, width: 44 },
    { key: 'indicatorType', label: '指标类型', required: true, width: 10 },
    // 2026-11-11 用户拍板：权重只收纯数字（去掉 10 / 10% / 0.1 三格式混用），表头直接标口径
    // 2026-11-26（对齐样例）：写数值型
    { key: 'weight', label: WEIGHT_COLUMN_HEADER, numeric: true, width: 12 }
  ],
  rows: [
    // 2026-11-26（收口定稿）：示例 4 行**逐字**取自需求方定稿样例
    // `导入模板样例/SISM-导入模板-01-战略部下发职能部门-样例.xlsx` 数据页 A2:G5——
    // 组 1（基础性）3 行：战略任务/任务类型按组竖向合并（C2:C4/D2:D4）、部门列块合并（B2:B4）；
    // 组 2（发展性）单行：部门列 B5 锚点重复写「教务处」（样例版式）；
    // 序号 = 核心指标行号，逐行 1..4、写数值型（不参与合并）；权重 40/30/30/100 同为数值型。
    {
      serial: '1',
      department: '教务处',
      strategicTask:
        '深入推进教务处年度本科教育教学改革与人才培养质量提升工程，完善课程建设、专业评估与教学质量监测体系，健全教考分离与持续改进闭环机制',
      taskType: '基础性',
      indicatorName:
        '推进教务处教学质量提升专项工作落地见效，围绕课堂教学改革、课程思政建设、实践教学体系优化三大主线，建立教学质量监测数据平台，形成月度调度、学期评估、年度考核的持续改进闭环',
      indicatorType: '定量',
      weight: '40'
    },
    {
      serial: '2',
      department: '',
      strategicTask: '',
      taskType: '',
      indicatorName: '完善课程建设与专业评估机制',
      indicatorType: '定性',
      weight: '30'
    },
    {
      serial: '3',
      department: '',
      strategicTask: '',
      taskType: '',
      indicatorName: '开展通识教育课程体系改革',
      indicatorType: '定性',
      weight: '30'
    },
    {
      serial: '4',
      department: '教务处',
      strategicTask:
        '统筹协调教务处年度跨部门教学管理协同事项与突发教学运行保障工作，建立与学工、人事、财务等部门的联动会商机制，保障全校教学工作平稳有序运转',
      taskType: '发展性',
      indicatorName:
        '牵头组织全国大学生学科竞赛报名及指导工作，构建校赛、省赛、国赛三级培育体系，建立竞赛指导教师库与获奖激励办法，实现参赛队伍数量与国家级奖项数量双增长，形成以赛促学长效机制',
      indicatorType: '定量',
      weight: '100'
    }
  ],
  // 2026-11-26（收口定稿）：说明文案逐字取自定稿样例 01「填写说明」sheet A3:A9（7 条，
  // 序号前缀由 buildImportTemplateSheets 统一拼接）
  rules: [
    '使用者：战略发展部在「战略任务管理 → 职能部门页签」用「导入」按钮上传；一次导入 = 一个职能部门（本表示例为教务处）。',
    '列结构（7 列）：序号 / 部门 / 战略任务 / 任务类型 / 核心指标 / 指标类型 / 权重（纯数字）。',
    '🔴 部门校验：「部门」列为下发目标（教务处），解析时与页面选定部门比对——不一致整单拒绝。',
    '同名规则：核心指标名称与系统已有 = 挂接该核心指标（更新子指标）；新名称 = 新建。',
    '任务类型：基础性 / 发展性（随组竖向合并）；同组基础性权重合计应为 100。',
    '下发流程：导入成功 → 「发起下发审批」→ 战略部负责人 → 分管校领导 三环审批 → 通过后正式下发至职能部门。',
    '黄色底纹行为示例数据，正式使用前请替换。'
  ]
}

const distributionImportGuide: ImportTemplateGuide = {
  title: '学院子指标表示例',
  targetName: '学院',
  sheetName: '学院子指标导入模板',
  rulesTitle: '填写说明（02 · 战略部下发二级学院 · 单学院单归口导入）',
  columns: [
    // 2026-11-26（学院导入序号语义改造）：序号=子指标行号（纯展示、可选）——
    // 预填逐行递增 1..N、每行一号，不再按组竖向合并、不参与归组；留空时后端按物理行号自动补号
    // 2026-11-26（对齐 02 样例）：写数值型
    { key: 'serial', label: '序号', numeric: true, width: 6 },
    // 2026-11-26（对齐 02 样例，取代整列合并）：学院列按块合并（每块锚点重复写值）——
    // 块 = 「归口职能部门」相同的连续父级核心指标组（样例 02：归口相同 → B2:B4 跨两个核心指标组）；
    // 不参与分组判断，留空默认当前学院
    { key: 'college', label: '学院', mergeBlock: true, width: 12 },
    // 2026-11-25 用户定案（模板对齐 02 样例）：单归口模板也带「归口职能部门」列，
    // 由系统按当前选中归口预填，导入时只读校验（与页面选中归口不一致 → 阻断）
    // 2026-11-26（对齐 02/03 样例）：按「归口职能部门」连续块竖向合并——归口相同的相邻
    // 核心指标组共用一格（样例 02 的 C2:C4），归口断开即新块并重写值（样例 03 的 C2:C3 + C4）
    {
      key: 'functionalDept',
      label: FUNCTIONAL_DEPT_COLUMN_HEADER,
      required: true,
      mergeBlock: true,
      width: 16
    },
    // 2026-10-31 终版表头加列：任务类型=父级核心指标所属任务的类型（基础性/发展性），
    // 系统预填、随组合并、组内继承；锚点级只读校验（与系统不一致→阻断点名），不落库
    { key: 'taskType', label: '任务类型', required: true, mergeGroup: true, width: 10 },
    // 2026-10-31 终版表头：「核心指标」即父级核心指标；所属任务由系统按名称反查（无「父级战略任务」列）
    // 判组依据（2026-11-26）：本列非空 = 组首行（不再看序号列）
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
    // 2026-11-26（对齐样例）：写数值型
    { key: 'weight', label: WEIGHT_COLUMN_HEADER, numeric: true, width: 12 }
  ],
  rows: [
    // 示例演示「一个父级核心指标拆多个子指标」：父级 1 占三行（任务类型/核心指标/核心指标类型合并，
    // 按核心指标列非空判组）；两个父级组归口同为教务处 → 归口列与学院列并成一块（同 02 样例版式）。
    // 组内子指标 40+30+30=100（基础性）；父级 2 发展性组内 60+40=100。
    // 2026-11-26（学院导入序号语义改造）：序号=子指标行号，逐行递增预填（不再按组合并、不再留空）
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
      serial: '2',
      college: '',
      taskType: '',
      parentIndicator: '',
      parentIndicatorType: '',
      indicatorName: '完成评教数据接入',
      indicatorType: '定量',
      weight: '30'
    },
    {
      serial: '3',
      college: '',
      taskType: '',
      parentIndicator: '',
      parentIndicatorType: '',
      indicatorName: '建成教学质量看板',
      indicatorType: '定量',
      weight: '30'
    },
    {
      serial: '4',
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
      serial: '5',
      college: '',
      taskType: '',
      parentIndicator: '',
      parentIndicatorType: '',
      indicatorName: '完成专业评估支撑材料整理',
      indicatorType: '定性',
      weight: '40'
    }
  ],
  // 2026-11-26（收口定稿）：说明文案逐字取自定稿样例 02「填写说明」sheet A3:A9（7 条，
  // 序号前缀由 buildImportTemplateSheets 统一拼接）
  rules: [
    '使用者：战略发展部在「战略任务管理 → 二级学院页签」选中学院后用「导入」按钮上传；一次导入 = 一个学院 × 一个归口部门的一条线。',
    '列结构（9 列）：序号 / 学院 / 归口职能部门 / 任务类型 / 核心指标 / 核心指标类型 / 子指标名称 / 指标类型 / 权重（纯数字）。',
    '🔴 目标校验：「学院」+「归口职能部门」两列共同声明下发目标（文理学院 ← 预算部），解析时与页面选定学院/部门比对——不一致整单拒绝。',
    '核心指标列：系统按名称反查所属任务；同名 = 挂接既有核心指标，新名称 = 新建。',
    '权重：纯数字；同组基础性权重合计应为 100。',
    '下发流程：导入成功 → 自动发起下发审批（流程6 自动通过）→ 任务正式下发至学院。',
    '黄色底纹行为示例数据（文理学院真实指标），正式使用前请替换。'
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
 * <p>「职能部门」列**按归口连续块竖向合并**（2026-11-26 对齐 03 样例：归口相同的相邻父级组
 * 共用一格，归口断开即新块并重写值——样例 `C2:C3` + C4；学院列同块 `B2:B3` + B4 再写值）。
 * 延续行留空 = 同上，与既有 sticky 口径一致。用户若把同一锚点的行填成不同部门，
 * 后端会按行级错误点名「职能部门与核心指标归属不符」。</p>
 */
const distributionAllImportGuide: ImportTemplateGuide = {
  title: '学院子指标表（全部导入）示例',
  targetName: '学院',
  sheetName: '学院子指标全部导入模板',
  // 2026-11-26（收口定稿）：标题文案与样例 03「填写说明」A1 逐字一致
  rulesTitle: '填写说明（03 · 战略部下发二级学院 · 多归口全部导入）',
  columns: [
    // 2026-11-26（学院导入序号语义改造）：序号=子指标行号（纯展示、可选）——
    // 预填逐行递增 1..N、每行一号，不再按组竖向合并、不参与归组；留空时后端按物理行号自动补号
    // 2026-11-26（对齐 03 样例）：写数值型
    { key: 'serial', label: '序号', numeric: true, width: 6 },
    // 学院列按块合并（2026-11-26 对齐 03 样例：B2:B3 + B4 再写值；一份导入锁定一个学院）
    { key: 'college', label: '学院', mergeBlock: true, width: 12 },
    // 2026-11-19 新增：职能部门列（拆批依据 + 交叉校验依据）；
    // 2026-11-26：按归口连续块竖向合并（样例 C2:C3 + C4）
    {
      key: 'functionalDept',
      label: FUNCTIONAL_DEPT_COLUMN_HEADER,
      required: true,
      mergeBlock: true,
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
    // 2026-11-26（对齐样例）：写数值型
    { key: 'weight', label: WEIGHT_COLUMN_HEADER, numeric: true, width: 12 }
  ],
  rows: [
    // 示例演示「一份文件两个职能部门」：第 1-2 行教务处，第 3 行数字校园建设办公室。
    // 2026-11-26（学院导入序号语义改造）：序号=子指标行号，逐行递增预填（不再按组合并、不再留空）
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
      serial: '2',
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
      serial: '3',
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
  // 2026-11-26（收口定稿）：说明文案逐字取自定稿样例 03「填写说明」sheet A3:A10（8 条，
  // 序号前缀由 buildImportTemplateSheets 统一拼接）
  rules: [
    '使用者：战略发展部在「战略任务管理 → 二级学院页签」选中学院后用「全部导入」按钮上传。',
    '用途：一份表可含多个归口职能部门给同一学院的指标行，系统按「职能部门」列自动拆组、逐组独立下发（流程6 自动审批通过）。',
    '🔴 目标校验：「学院」+「归口职能部门」两列共同声明每条线的下发目标，解析时与页面选定学院/部门比对——不一致的组拒绝。',
    '列结构（9 列）：序号 / 学院 / 归口职能部门 / 任务类型 / 核心指标 / 核心指标类型 / 子指标名称 / 指标类型 / 权重（纯数字）。',
    '同名规则：核心指标同名 = 挂接既有；子指标同名 = 更新，新名 = 新增；权重按归口组独立合计 100。',
    '前置条件：子指标所挂核心指标须为该系统已下发的锚点（否则行级错误点名）。',
    '下发流程：解析预览（将下发/将跳过/错误组三类信息）→ 确认全部导入并下发 → 逐组建线自动审批通过。',
    '彩色底纹行为示例数据（绿=预算部组 / 黄=数字校园组），正式使用前请替换。'
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
   * <p>职能部门导入模板的示例行内容保持样例不变，只把「部门」列替换成真实目标部门
   * （2026-11-26 起部门列按块合并、每块锚点重复写该值），
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

/** 连续数据行区间 [start, end)——一个「组」或一个「块」占据的行范围 */
interface TemplateRowRange {
  start: number
  end: number
}

/** 行区间内某列的首个非空值（全空返回 null）——组首行留空时按 sticky 语义在组内向后取 */
function firstNonBlankValue(
  rows: Record<string, string>[],
  range: TemplateRowRange,
  key: string
): string | null {
  for (let index = range.start; index < range.end; index += 1) {
    const value = String(rows[index]?.[key] ?? '').trim()
    if (value) {
      return value
    }
  }
  return null
}

/**
 * 把若干连续行区间摊成「逐行跨度」：区间首行记行数（span），其余行记 0（被合并覆盖）。
 * 不在任何区间内的行不登记（取值时按单行 span=1 处理）。
 */
function spreadRowSpans(ranges: TemplateRowRange[]): Map<number, number> {
  const spanByIndex = new Map<number, number>()
  ranges.forEach(({ start, end }) => {
    spanByIndex.set(start, end - start)
    for (let index = start + 1; index < end; index += 1) {
      spanByIndex.set(index, 0)
    }
  })
  return spanByIndex
}

/**
 * 按跨度产出竖向合并单元格（write-excel-file 语义同导出表）：
 * span > 1 = 块/组锚点格（携带 rowSpan，竖向合并块/组内全部行）；
 * span = 0 = 被上方合并覆盖的从属格（write-excel-file 要求传 null）；
 * span = 1 = 单行块/组，退回纯文本（样例中单行块锚点直接写值，如 01 的 B5）。
 */
function buildSpanMergedCell(span: number, text: string) {
  if (span > 1) {
    return { value: text, rowSpan: span, alignVertical: 'center' as const }
  }
  if (span === 0) {
    return null
  }
  return text
}

/**
 * 2026-11-26（对齐 01/02/03 样例）：序号/权重写**数值型**——样例为数字单元格，非文本。
 * 仅当文本是普通十进制数时转数字；空串 / 非数字文本原样保留（不丢内容）。
 * 后端 DataFormatter 把数值格归一成字符串，解析不受影响。
 */
function toNumericCell(text: string): string | number {
  const trimmed = text.trim()
  return /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed) ? Number(trimmed) : text
}

/**
 * 2026-10-14 用户定案（P10）：下载模板时自动带出当前职能部门/学院已有的父级核心指标——
 * 每个已有父级指标预填一行（序号=行号、任务类型/核心指标/核心指标类型预填，2026-10-31 终版表头），
 * 用户在该行填第一个子指标，再向下加「关键列留空」的延续行拆多个子指标。
 * 不引入内部ID列：手工导入不要求填写系统主键。
 *
 * <p>2026-10-31 用户拍板修订：组列按组竖向合并——每个组只占一格
 * （锚点格 rowSpan=组行数，从属格传 null，write-excel-file 语义同导出表）。</p>
 *
 * <p>2026-11-26（下发侧语义修正，对齐 01/02/03 样例）：</p>
 * <ul>
 *   <li>序号 = 最末级指标行号：逐行递增、写数值型、不合并；</li>
 *   <li>判组依据 = 关键列非空（01「战略任务」/ 02·03「核心指标」），不再看序号列；</li>
 *   <li>部门/学院列按块合并 + 每块锚点重复写值（块：01 = 战略任务组；02/03 = 归口职能部门连续块）。</li>
 * </ul>
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
          // 2026-11-26（学院导入序号语义改造）：序号 = 子指标行号（逐行递增 1..N，N=锚点行数，
          // 纯展示；不再是「父级核心指标组号」语义——用户在锚点行间插入子指标行后请重排序号，
          // 留空时后端也会按物理行号自动补号，不影响归属）
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

  // ── 判组（2026-11-26 语义修正）：组首行 = 关键列非空 ──
  // 01「战略任务」列 / 02·03「核心指标」列非空 = 新组开始；组内延续行关键列留空
  // （合并单元格的非锚点格读出即空）= 同组。与后端解析器的归组口径一致——
  // 序号列已逐行预填，不再承担「组号」语义，不能再用它判组
  // （否则 02/03 每个锚点行都被判成组首行，归口/任务类型/核心指标/核心指标类型列一格都合不出来）。
  const groupKey = type === 'strategic-task' ? 'strategicTask' : 'parentIndicator'
  const groupRanges: TemplateRowRange[] = []
  rows.forEach((row, index) => {
    if (String(row[groupKey] ?? '').trim() || groupRanges.length === 0) {
      groupRanges.push({ start: index, end: index + 1 })
      return
    }
    const currentGroup = groupRanges[groupRanges.length - 1]
    if (currentGroup) {
      currentGroup.end = index + 1
    }
  })

  // ── 分块（2026-11-26）：部门/学院列与归口列的竖向合并单位 ──
  // 01：每个战略任务组自成一块（样例 B2:B4 + B5 再写「教务处」）。
  // 02/03：按「归口职能部门」把相邻的组并成块——归口相同的相邻组同块
  // （样例 02 的 B2:B4 / C2:C4 跨两个核心指标组），归口断开即新块
  // （样例 03 的 B2:B3 + B4 / C2:C3 + C4）；组内归口列全空 = 延续上一块（留空=同上）。
  const blockKey = type === 'strategic-task' ? '' : 'functionalDept'
  const blockRanges: TemplateRowRange[] = []
  let currentBlockValue: string | null = null
  groupRanges.forEach(range => {
    const value = blockKey ? (firstNonBlankValue(rows, range, blockKey) ?? currentBlockValue) : null
    if (!blockKey || blockRanges.length === 0 || value !== currentBlockValue) {
      currentBlockValue = value
      blockRanges.push({ ...range })
    } else {
      const currentBlock = blockRanges[blockRanges.length - 1]
      if (currentBlock) {
        currentBlock.end = range.end
      }
    }
  })

  // ── 部门/学院列：每块锚点重复写值 ──
  // 一份导入锁定一个部门/学院：取全表首个非空值（01 = 当前下发目标部门），写到每一块的锚点行。
  // 各锚点写的是同一个字符串，不会触发后端「与页面选定不一致整单拒绝」。
  const organizationKey = type === 'strategic-task' ? 'department' : 'college'
  const organizationName =
    rows.map(row => String(row[organizationKey] ?? '').trim()).find(Boolean) ?? ''
  const blockStarts = new Set(blockRanges.map(range => range.start))
  const sheetRows = rows.map((row, index) =>
    blockStarts.has(index) && organizationName
      ? { ...row, [organizationKey]: organizationName }
      : row
  )

  const groupSpanByIndex = spreadRowSpans(groupRanges)
  const blockSpanByIndex = spreadRowSpans(blockRanges)

  const exportColumns: ExcelExportColumn<Record<string, string>>[] = guide.columns.map(column => ({
    header: column.label,
    width: column.width ?? 22,
    // 2026-11-26（样式全面对齐）：与 01/02/03 样例逐格对齐的列级样式
    // —— 字体族微软雅黑、表头/数据行统一 #BBBBBB 细边框、数据行 10 号居中。
    fontFamily: TEMPLATE_STYLE.fontFamily,
    headerBorderColor: TEMPLATE_STYLE.borderColor,
    bodyBorderColor: TEMPLATE_STYLE.borderColor,
    bodyFontSize: TEMPLATE_STYLE.bodyFontSize,
    bodyAlignVertical: 'center',
    // 样例中「任务类型」列为左对齐，其余数据列居中
    bodyAlign: column.key === TEMPLATE_STYLE.leftAlignedColumnKey ? 'left' : 'center',
    getValue: (row, index) => {
      const text = row[column.key] || ''
      if (column.mergeBlock) {
        // 按块竖向合并：部门/学院列（01·02·03）+ 归口职能部门列（02·03）
        return buildSpanMergedCell(blockSpanByIndex.get(index) ?? 1, text)
      }
      if (column.mergeGroup) {
        // 按组竖向合并：01 战略任务+任务类型；02/03 任务类型+核心指标+核心指标类型
        return buildSpanMergedCell(groupSpanByIndex.get(index) ?? 1, text)
      }
      // 非合并列：序号/权重写数值型（样例为数字），其余原样文本
      return column.numeric ? toNumericCell(text) : text
    }
  }))

  return {
    // 2026-11-25 用户定案（模板对齐样例）：sheet 名与视觉（深蓝表头 + 黄色示例行 + 行高）随样例走
    sheetName: guide.sheetName,
    rows: sheetRows,
    columns: exportColumns,
    headerBackgroundColor: TEMPLATE_STYLE.headerBackground,
    headerTextColor: TEMPLATE_STYLE.headerTextColor,
    headerHeight: TEMPLATE_STYLE.headerHeight,
    bodyRowHeight: TEMPLATE_STYLE.bodyRowHeight,
    // 2026-11-26（样式全面对齐）：冻结 A2（表头 1 行）+ 网格线可见
    stickyRowsCount: 1,
    stickyColumnsCount: 0,
    showGridLines: true,
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
  // 2026-11-26（样式全面对齐）：说明页版式与 01/02/03 样例一致——
  // 标题在 A1（微软雅黑 11 加粗黑字）、第 2 行空行、条目从 A3 起（1./2./3… 前缀），
  // 白底无边框、条目行高 26、列宽 114、**不冻结**、垂直居中 + 自动换行。
  // 样例说明页**没有表头行**，故用 skipHeaderRow（否则表头行会带深蓝底白字）。
  const rulesSheet: ExcelExportSheet<Record<string, string>> = {
    sheetName: '填写说明',
    skipHeaderRow: true,
    rows: [
      { text: guide.rulesTitle },
      { text: '' },
      ...guide.rules.map((rule, index) => ({ text: `${index + 1}. ${rule}` }))
    ],
    columns: [
      {
        header: guide.rulesTitle,
        width: TEMPLATE_STYLE.guideColumnWidth,
        fontFamily: TEMPLATE_STYLE.fontFamily,
        // 第 1 行是标题（样例 A1 加粗），其余为条目
        getValue: (row, index) => ({
          value: row.text,
          // 水平对齐留空 = Excel 默认左对齐（与样例一致）
          align: undefined,
          alignVertical: 'center' as const,
          wrap: true,
          // 清掉通用 body 样式的细边框 → 说明页无边框
          borderColor: undefined,
          borderStyle: undefined,
          ...(index === 0 ? { fontWeight: 'bold' as const } : {})
        })
      }
    ],
    bodyRowHeight: TEMPLATE_STYLE.guideRowHeight,
    // 说明页不冻结
    stickyRowsCount: 0,
    stickyColumnsCount: 0,
    showGridLines: true
  }
  return [buildImportTemplateSheet(type, parentSeeds, mode), rulesSheet]
}
