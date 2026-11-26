import type { ExcelExportColumn, ExcelExportSheet } from '@/shared/lib/export/excel'
import { buildExportFileName } from '@/shared/lib/export/excel'

/**
 * 2026-11-25（指标填报导入式上报）：填报导入模板的列定义与生成。
 *
 * <p><b>标准模板以需求方「SISM-导入模板-04/05/06」为准</b>（2026-11-25 定稿）。
 * 三份上报模板共用同一套 <b>8 列</b>结构，只有第 2/3 列的措辞随流向不同：
 * <pre>
 * 序号 ｜ 责任部门（来源·须与登录学院/部门一致） ｜ 目标部门（归口职能部门）/ 上报目标（战略发展部）
 *      ｜ 子指标名称 ｜ 权重（系统只读）｜ 自评等级（点选填写）｜ 进度说明（请填写）｜（枚举来源，勿动）
 * </pre>
 *
 * <p>第 8 列「（枚举来源，勿动）」是给 Excel 下拉当数据源的辅助列，后端解析时<b>完全忽略</b>
 * （该表头整体在括号内，归一化后为空串，自然不参与字段映射）。
 *
 * <p>2026-11-26（样例行口径修正）：示例行子指标名一律使用系统<b>真实下发的指标全名</b>——
 * 截断名/虚构名在后端按名称精确定位时会 0 命中被点名（用户直接导入下载的模板不放示例行也会挂）。
 * 示例行锚定本地系统已下发数据：教务处核心指标 2005 全名、计算机学院教务处线（导入下发验证-基础A/B）
 * 与数字校园建设办公室线（数字校园协同验证-统一认证与上云子项/数据治理子项）。
 *
 * <p>2026-11-26（样式逐格对齐样例）：数据页/说明页的<b>列宽、列级样式、行高、冻结、隐藏列、
 * 下拉校验、工作表保护</b>全部按需求方样例文件逐项对齐（口径见 {@link TEMPLATE_STYLE}）。
 *
 * <p>2026-11-26（模板动态行）：数据行从「写死的静态示例行」升级为「按所选学院×归口线的
 * <b>真实已下发子指标</b>动态生成」——子指标名称/权重系统预填只读，用户只填自评等级 +
 * 进度说明。调用方把当前视角行集映射成 {@link ReportFillDynamicTemplateRow} 传入；
 * <b>有真实行时必须用真实行</b>，仅当视角无任何已下发数据（空数组/缺参）才回退静态
 * SAMPLE_ROWS 兜底（此时数据行仍是示例，需删除后填写）。
 */

/** 上报类型：职能部门上报（04） / 学院上报（05 单点、06 批量）。 */
export type ReportFillFlow = 'func' | 'college'

/** 导入模式：single = 只提交所选目标部门那条线；all = 文件内出现的线全部提交。 */
export type ReportFillImportMode = 'single' | 'all'

/** 模板变体：04 / 05 / 06。 */
export type ReportFillTemplateVariant = 'func' | 'college-single' | 'college-all'

/** 自评等级三档（与模板第 8 列枚举、后端白名单一致）。 */
export const REPORT_FILL_LEVEL_OPTIONS = [
  { label: '超前完成', value: 'AHEAD' },
  { label: '正常', value: 'NORMAL' },
  { label: '滞后', value: 'DELAYED' }
] as const

/** 自评等级中文文案 → 后端等级码。 */
export const REPORT_FILL_LEVEL_BY_LABEL: Record<string, string> = {
  超前完成: 'AHEAD',
  正常: 'NORMAL',
  滞后: 'DELAYED'
}

/** 自评等级白名单的中文文案（错误提示用）。 */
export const REPORT_FILL_LEVEL_LABELS = REPORT_FILL_LEVEL_OPTIONS.map(option => option.label).join(
  ' / '
)

/**
 * 中文文案 → 等级码；非白名单值返回 null。
 *
 * <p>刻意不兼容「超前」等其它写法：后端对无法识别的值会静默返回 null，
 * 让非法等级拖到提交时才炸，故前端先按严格白名单拦。
 */
export function resolveReportFillLevel(label: unknown): string | null {
  const key = String(label ?? '')
    .replace(/\u3000/g, ' ')
    .trim()
  if (!key) {
    return null
  }
  return REPORT_FILL_LEVEL_BY_LABEL[key] ?? null
}

/**
 * 模板样式常量（2026-11-26 与需求方样例逐格对齐）。
 *
 * <p>口径全部来自 `导入模板样例/SISM-导入模板-04/05/06-*.xlsx`：
 * A-E 灰底、F-G 金底（可填写两列）、统一 `#BBBBBB` 细边框、微软雅黑（表头 11 加粗白字，
 * 数据 10 常规黑字），表头行高 34、数据行高 36、冻结 C2、第 8 列隐藏且无样式。
 */
export const TEMPLATE_STYLE = {
  /** 字体族（样例 styles.xml 的 `<name val="微软雅黑"/>`） */
  fontFamily: '微软雅黑',
  /** 表头底色（A-E 列） */
  headerBackground: '#595959',
  /** 表头底色（F-G 可填写两列） */
  headerBackgroundFillable: '#BF8F00',
  /** 数据行底色（A-E 列） */
  bodyBackground: '#EDEDED',
  /** 数据行底色（F-G 可填写两列） */
  bodyBackgroundFillable: '#FFE699',
  /** 统一细边框色 */
  borderColor: '#BBBBBB',
  /** 表头文字色（白） */
  headerTextColor: '#ffffff',
  /** 表头字号 */
  headerFontSize: 11,
  /** 数据行字号 */
  bodyFontSize: 10,
  /** 表头行高 */
  headerHeight: 34,
  /** 数据行行高 */
  bodyRowHeight: 36,
  /** 说明页列宽 */
  guideColumnWidth: 114,
  /** 说明页行高 */
  guideRowHeight: 26,
  /** 冻结位置：表头 1 行 + 左侧 2 列 → C2 */
  stickyRowsCount: 1,
  stickyColumnsCount: 2
} as const

/** 模板数据行（字段与列 key 一一对应；`null` = 该格不落格，等价于样例里的「空格」）。 */
export interface ReportFillTemplateRow {
  serial: string | null
  /** 责任部门（来源）= 登录人所在组织 */
  responsibleDept: string | null
  /** 目标部门 / 上报目标 */
  targetDept: string | null
  indicatorName: string | null
  weight: string | null
  selfRating: string | null
  remark: string | null
  /** （枚举来源，勿动）——给 Excel 下拉当数据源，解析时忽略 */
  enumSource: string | null
}

/**
 * 动态真实行（2026-11-26 模板动态行）：调用方从当前视角行集映射而来的「真实已下发子指标」。
 *
 * <p>字段口径与页面表格显示一致（以页面为准）：名称取 {@code indicator.name}（「子指标名称」列）、
 * 权重取 {@code indicator.weight}（「权重」列显示的数值）。两列系统预填只读；
 * 自评等级/进度说明留空由用户填写。
 */
export interface ReportFillDynamicTemplateRow {
  /** 目标部门（05=所选归口职能部门名；06=该行所属归口；04 可空，生成器补「战略发展部」） */
  targetDept: string | null
  /** 子指标名称（系统预填只读） */
  name: string
  /** 权重（系统预填只读；页面显示数值，允许数值或数值字符串，空 = 该格不落格） */
  weight: string | number | null
}

/** 数据页列定义（8 列，按变体决定第 2/3 列措辞）。 */
interface ReportFillColumnSpec {
  key: keyof ReportFillTemplateRow
  label: string
  width: number
  /** 可填写列（F 自评等级 / G 进度说明）→ 金色底纹 */
  fillable: boolean
  /** 第 8 列：枚举来源——隐藏且不套任何样式 */
  plain: boolean
}

function buildColumns(variant: ReportFillTemplateVariant): ReportFillColumnSpec[] {
  const isFunc = variant === 'func'
  // 注：isAll 目前不影响列定义（三份结构完全相同），保留参数便于将来分化
  return [
    { key: 'serial', label: '序号', width: 6, fillable: false, plain: false },
    {
      key: 'responsibleDept',
      label: isFunc ? '责任部门\n（来源·须与登录部门一致）' : '责任部门\n（来源·须与登录学院一致）',
      width: 16,
      fillable: false,
      plain: false
    },
    {
      key: 'targetDept',
      label: isFunc ? '上报目标\n（战略发展部）' : '目标部门\n（归口职能部门）',
      width: 16,
      fillable: false,
      plain: false
    },
    { key: 'indicatorName', label: '子指标名称', width: 44, fillable: false, plain: false },
    { key: 'weight', label: '权重\n（系统只读）', width: 13, fillable: false, plain: false },
    { key: 'selfRating', label: '自评等级\n（点选填写）', width: 14, fillable: true, plain: false },
    { key: 'remark', label: '进度说明\n（请填写）', width: 36, fillable: true, plain: false },
    { key: 'enumSource', label: '（枚举来源，勿动）', width: 13, fillable: false, plain: true }
  ]
}

/** 共用文案（三份模板措辞一致的两条 🔴 + 填报字段 + 权重列）。 */
const SHARED_RULES = {
  responsibleDept:
    '🔴 责任部门（来源）：即「当前填报人所在部门/学院」——必须填写登录账号对应的部门，解析时与登录身份比对，不一致整单拒绝导入（防止代他部门/学院填报）。',
  targetDept:
    '🔴 目标部门（上报到哪）：本模板已显式标出上报目标——解析时校验责任部门与目标部门的流转方向是否正确（如学院→归口部门、职能部门→战略发展部）。',
  fillFields:
    '填报字段（黄色两列，与填报页可编辑字段一致）：① 自评等级——点击单元格下拉选择「超前完成 / 正常 / 滞后」（三选一，手输其他内容会被拒绝）；② 进度说明——当月推进情况文字说明。',
  weightColumn: '权重列：系统只读参考，请勿修改（该列已锁定）。'
}

/**
 * 「填写说明」页文案（逐条照抄需求方 04/05/06 三份文件）。
 *
 * <p>三份的条目分组与编号各不相同（04/05 是 1、2、🔴、🔴、填报字段、权重列、3、4、5、6；
 * 06 是 1、2、3拆线、🔴、🔴、填报字段、权重列、4、5、6、7），因此各自写死。
 */
export function buildReportFillTemplateRules(variant: ReportFillTemplateVariant): string[] {
  if (variant === 'func') {
    return [
      '1. 使用者：职能部门填报人登录自己账号，在「指标填报」页用「导入填报」按钮上传（需求第二步新功能）。',
      '2. 流转方向：责任部门（当前职能部门，如教务处）→ 上报目标（战略发展部）——两列都会解析校验，方向不符整单拒绝。',
      SHARED_RULES.responsibleDept,
      SHARED_RULES.targetDept,
      SHARED_RULES.fillFields,
      SHARED_RULES.weightColumn,
      '3. 归属月份：本表不设月份列——归属月份在导入界面上选择。',
      '4. 定位规则：按「责任部门 + 子指标名称」匹配该部门已下发的子指标行；无匹配 = 该行失败点名。',
      '5. 导入流程：选择文件 → 解析预览（责任部门/目标校验 + 定位 + 数值校验）→ 确认导入 → 自动进入上报审批（审批通过后数据看板生效）。',
      '6. 黄色底纹行为示例数据，正式导入前请删除。'
    ]
  }
  if (variant === 'college-single') {
    return [
      '1. 使用者：二级学院填报人登录自己账号，在「指标填报」页用「导入填报」按钮上传。',
      '2. 流转方向：责任部门（当前学院，如计算机学院）→ 目标部门（归口职能部门，如什邡管委会）——两列都会解析校验，方向不符整单拒绝。',
      SHARED_RULES.responsibleDept,
      SHARED_RULES.targetDept,
      SHARED_RULES.fillFields,
      SHARED_RULES.weightColumn,
      '3. 归属月份：本表不设月份列——归属月份在导入界面上选择。',
      '4. 定位规则：按「责任部门 + 目标部门 + 子指标名称」匹配该学院该归口线已下发的子指标行；无匹配 = 该行失败点名。',
      '5. 导入流程：选择文件 → 解析预览（责任部门/目标校验 + 定位 + 数值校验）→ 确认导入 → 进入该归口线的上报审批（审批通过后数据看板生效）。',
      '6. 黄色底纹行为示例数据，正式导入前请删除。'
    ]
  }
  return [
    '1. 使用者：二级学院填报人登录自己账号使用；一张表批量导入本学院对所有归口部门的月度填报数据。',
    '2. 流转方向：责任部门（当前学院，如计算机学院）→ 目标部门（每行指定的归口职能部门）——两列都会解析校验，方向不符整单拒绝。',
    '3. 拆线规则：按「目标部门」列自动拆分——每条归口线独立校验、独立提交、独立进入该线的上报审批流程（一条线失败不影响其他线）。',
    SHARED_RULES.responsibleDept,
    SHARED_RULES.targetDept,
    SHARED_RULES.fillFields,
    SHARED_RULES.weightColumn,
    '4. 归属月份：本表不设月份列——归属月份在导入界面上选择。',
    '5. 定位规则：按「责任部门 + 目标部门 + 子指标名称」匹配已下发子指标行；无匹配 = 该行失败点名。',
    '6. 导入流程：选择文件 → 解析预览（责任部门/目标校验 + 按目标部门分组展示将提交/将跳过/错误组）→ 确认批量导入 → 逐线自动提交进审批（通过后数据看板生效）。',
    '7. 彩色底纹行为示例数据（绿=教务处线 / 黄=数字校园建设办公室线），正式导入前请删除。'
  ]
}

/** 数据页 sheet 名（与需求方文件一致）。 */
export function buildReportFillSheetName(variant: ReportFillTemplateVariant): string {
  return variant === 'college-all' ? '月报填报批量导入模板' : '月报填报导入模板'
}

/** 说明页标题行。 */
export function buildReportFillGuideTitle(variant: ReportFillTemplateVariant): string {
  if (variant === 'func') {
    return '填写说明（04 · 职能部门上报战略发展部 · 单点导入）'
  }
  if (variant === 'college-single') {
    return '填写说明（05 · 二级学院上报归口部门 · 单点导入）'
  }
  return '填写说明（06 · 二级学院上报多归口部门 · 批量导入）'
}

/**
 * 样例行（2026-11-26 口径修正：子指标名一律用系统真实下发全名，修复截断名/虚构名 0 命中）。
 *
 * <p>锚定本地系统已下发数据：教务处核心指标 2005 全名（85 字）、计算机学院教务处线
 * 「导入下发验证-基础A/B」、数字校园建设办公室线「数字校园协同验证-统一认证与上云子项/数据治理子项」。
 * 06 第 2 行「超前」按既定裁定同步为「超前完成」。
 *
 * <p><b>仅枚举行</b>（04/05 的最后一行）：整行只有第 8 列有值（枚举第三档），
 * 其余列一律不落格（null）、不填责任部门、不设行高——与需求方样例逐格一致。
 */
interface ReportFillSampleRow extends Omit<ReportFillTemplateRow, 'responsibleDept'> {
  /** 仅枚举行：整行只有第 8 列有值，其余列不落格 */
  enumOnly?: boolean
}

const SAMPLE_ROWS: Record<ReportFillTemplateVariant, ReadonlyArray<ReportFillSampleRow>> = {
  func: [
    {
      serial: '1',
      targetDept: '战略发展部',
      indicatorName:
        '推进教务处教学质量提升专项工作落地见效，围绕课堂教学改革、课程思政建设、实践教学体系优化三大主线，建立教学质量监测数据平台，形成月度调度、学期评估、年度考核的持续改进闭环',
      weight: '40',
      selfRating: '正常',
      remark: '教学质量监测平台月度数据已汇总',
      enumSource: '超前完成'
    },
    {
      serial: '2',
      targetDept: '战略发展部',
      indicatorName: '完善课程建设与专业评估机制',
      weight: '60',
      selfRating: '正常',
      remark: '完成本学期专业评估指标修订',
      enumSource: '正常'
    },
    {
      // 仅枚举行：只落 H 列（枚举第三档），其余列不落格 → 该行不设行高
      enumOnly: true,
      serial: null,
      targetDept: null,
      indicatorName: null,
      weight: null,
      selfRating: null,
      remark: null,
      enumSource: '滞后'
    }
  ],
  'college-single': [
    {
      serial: '1',
      targetDept: '数字校园建设办公室',
      indicatorName: '数字校园协同验证-统一认证与上云子项',
      weight: '55',
      selfRating: '滞后',
      remark: '受资源到位滞后影响，部分节点未按期完成',
      enumSource: '超前完成'
    },
    {
      serial: '2',
      targetDept: '数字校园建设办公室',
      indicatorName: '数字校园协同验证-数据治理子项',
      weight: '45',
      selfRating: '正常',
      remark: '数据治理专项月度节点按期完成',
      enumSource: '正常'
    },
    {
      // 仅枚举行：只落 H 列（枚举第三档），其余列不落格 → 该行不设行高
      enumOnly: true,
      serial: null,
      targetDept: null,
      indicatorName: null,
      weight: null,
      selfRating: null,
      remark: null,
      enumSource: '滞后'
    }
  ],
  'college-all': [
    {
      serial: '1',
      targetDept: '教务处',
      indicatorName: '导入下发验证-基础A',
      weight: '40',
      selfRating: '正常',
      remark: '本月阶段任务按计划完成',
      enumSource: '超前完成'
    },
    {
      serial: '2',
      targetDept: '教务处',
      indicatorName: '导入下发验证-基础B',
      weight: '30',
      // 需求方样例写「超前」→ 按 2026-11-25 裁定强制同步为「超前完成」
      selfRating: '超前完成',
      remark: '关键节点提前完成，进入下一阶段',
      enumSource: '正常'
    },
    {
      serial: '3',
      targetDept: '数字校园建设办公室',
      indicatorName: '数字校园协同验证-统一认证与上云子项',
      weight: '55',
      selfRating: '正常',
      remark: '联调完成，试运行推进正常',
      enumSource: '滞后'
    },
    {
      serial: '4',
      targetDept: '数字校园建设办公室',
      indicatorName: '数字校园协同验证-数据治理子项',
      weight: '45',
      selfRating: '滞后',
      remark: '受资源到位滞后影响，部分节点未按期完成',
      enumSource: null
    }
  ]
}

/** 示例行的责任部门（需求方文件里的示例组织名）。 */
const SAMPLE_RESPONSIBLE_DEPT: Record<ReportFillTemplateVariant, string> = {
  func: '教务处',
  'college-single': '计算机学院',
  'college-all': '计算机学院'
}

/**
 * 单元格取值：
 * - 空值（null/空串）→ 返回 null，**该格不落格**（与样例的「空格」一致）；
 * - 序号/权重 → 写成数字（样例里就是数字；写成文本会让 Excel 打「数字存为文本」绿三角）。
 */
function buildCellValue(
  key: keyof ReportFillTemplateRow,
  value: string | null
): string | number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  if (key === 'serial' || key === 'weight') {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      return numeric
    }
  }
  return value
}

/**
 * H 列枚举三档的落格顺序（2026-11-26 动态行口径）。
 *
 * <p>F 列下拉公式固定引用 {@code =$H$2:$H$4}，因此前三个数据行的第 8 列必须依次
 * 补齐三档枚举（与静态样例「第 1/2 行 + 仅枚举行」的 H2/H3/H4 布局一致）；
 * 真实行不足 3 行时补「仅枚举行」凑齐，第 4 行起不落格。
 */
const DYNAMIC_ENUM_FILL: readonly [string, string, string] = ['超前完成', '正常', '滞后']

/** 构造「仅枚举行」：整行只有第 8 列有值，其余列不落格、不填责任部门、不设行高。 */
function buildEnumOnlyRow(enumSource: string): ReportFillTemplateRow {
  return {
    serial: null,
    responsibleDept: null,
    targetDept: null,
    indicatorName: null,
    weight: null,
    selfRating: null,
    remark: null,
    enumSource
  }
}

/**
 * 是否「仅枚举行」（2026-11-26 终验对齐定稿样例口径）：整行只有第 8 列有值——
 * 判据 = 序号/子指标名/责任部门均空且第 8 列有枚举值（真实行与静态示例行的序号、
 * 子指标名、责任部门必非空）。仅枚举行的其余列维持 null 不落格
 * （不产生带样式的空格，与样例「该行不设行高」版式一致）。
 */
function isEnumOnlyRow(row: ReportFillTemplateRow): boolean {
  return (
    row.serial === null &&
    row.indicatorName === null &&
    row.responsibleDept === null &&
    row.enumSource !== null
  )
}

/**
 * 数据行来源解析（2026-11-26 模板动态行）：
 *
 * <ul>
 *   <li>{@code dynamicRows} 非空 → 逐行映射真实已下发子指标（名称/权重预填只读，
 *       等级/说明留空），序号逐行递增；前三个数据行第 8 列补齐三档枚举
 *       （不足 3 行补「仅枚举行」凑齐 H2:H4）。</li>
 *   <li>缺参/空数组 → 回退静态 SAMPLE_ROWS（2026-11-26 口径：有真实行必须用真实行，
 *       静态行仅作「视角无任何已下发数据」时的兜底）。</li>
 * </ul>
 */
function resolveTemplateRows(
  variant: ReportFillTemplateVariant,
  deptName: string,
  dynamicRows?: ReadonlyArray<ReportFillDynamicTemplateRow>
): ReportFillTemplateRow[] {
  if (!dynamicRows || dynamicRows.length === 0) {
    return SAMPLE_ROWS[variant].map(({ enumOnly, ...sample }) => ({
      ...sample,
      // 仅枚举行不填责任部门（整行只落第 8 列）
      responsibleDept: enumOnly ? null : deptName
    }))
  }

  const rows: ReportFillTemplateRow[] = dynamicRows.map((dynamic, index) => ({
    serial: String(index + 1),
    responsibleDept: deptName,
    // 04 的上报目标恒为战略发展部（调用方可不填，生成器补齐）；05/06 透传调用方给的归口名
    targetDept: dynamic.targetDept ?? (variant === 'func' ? '战略发展部' : null),
    indicatorName: String(dynamic.name ?? '').trim(),
    weight: dynamic.weight === null || dynamic.weight === undefined ? null : String(dynamic.weight),
    // 等级/进度说明是用户要填的两列：动态行一律留空（落带黄底样式的空格，见 getValue）
    selfRating: null,
    remark: null,
    // 第 8 列只承担「H2:H4 枚举源」职责：前三个数据行依次补三档，之后不落格
    enumSource: index < DYNAMIC_ENUM_FILL.length ? (DYNAMIC_ENUM_FILL[index] ?? null) : null
  }))

  // 真实行不足 3 行：补「仅枚举行」把 H2:H4 凑齐（否则 F 列下拉无完整枚举源）
  while (rows.length < DYNAMIC_ENUM_FILL.length) {
    rows.push(buildEnumOnlyRow(DYNAMIC_ENUM_FILL[rows.length] ?? ''))
  }
  return rows
}

/**
 * 生成数据页。
 *
 * <p>「责任部门」列写当前登录人所在组织的<b>权威名称</b>（由调用方传入，
 * 应与后端 {@code sys_org.name} 一致，否则上传会被整单拒绝）。
 *
 * <p>2026-11-26（模板动态行）：{@code dynamicRows} 传当前视角的真实已下发子指标行
 * （04=本部门核心指标 / 05=所选归口线子指标 / 06=全部归口线子指标，按归口分组）；
 * 非空时数据行完全由它生成，静态示例行仅作空数据兜底。
 */
export function buildReportFillTemplateSheet(
  variant: ReportFillTemplateVariant,
  responsibleDeptName: string,
  dynamicRows?: ReadonlyArray<ReportFillDynamicTemplateRow>
): ExcelExportSheet<ReportFillTemplateRow> {
  const deptName = responsibleDeptName || SAMPLE_RESPONSIBLE_DEPT[variant]
  const rows: ReportFillTemplateRow[] = resolveTemplateRows(variant, deptName, dynamicRows)

  const columns: ExcelExportColumn<ReportFillTemplateRow>[] = buildColumns(variant).map(spec => ({
    header: spec.label,
    width: spec.width,
    ...(spec.plain
      ? {
          // 第 8 列：隐藏 + 裸值（表头与数据格都不套样式）
          plain: true,
          hidden: true
        }
      : {
          fontFamily: TEMPLATE_STYLE.fontFamily,
          headerBackgroundColor: spec.fillable
            ? TEMPLATE_STYLE.headerBackgroundFillable
            : TEMPLATE_STYLE.headerBackground,
          headerTextColor: TEMPLATE_STYLE.headerTextColor,
          headerFontSize: TEMPLATE_STYLE.headerFontSize,
          headerBorderColor: TEMPLATE_STYLE.borderColor,
          bodyBackgroundColor: spec.fillable
            ? TEMPLATE_STYLE.bodyBackgroundFillable
            : TEMPLATE_STYLE.bodyBackground,
          bodyFontSize: TEMPLATE_STYLE.bodyFontSize,
          bodyBorderColor: TEMPLATE_STYLE.borderColor,
          bodyAlign: 'center',
          bodyAlignVertical: 'center'
        }),
    getValue: row => {
      const value = buildCellValue(spec.key, row[spec.key])
      // 2026-11-26（终验对齐定稿样例）：可填写两列（F 自评等级 / G 进度说明）空值也要落格——
      // 产出带黄底 + 细边框样式的空格（write-excel-file 对空串且带样式仍写 <c s=...>），
      // 否则真实行模板的「黄色两列」没有样式载体，与样例视觉不符。
      // 仅枚举行例外：整行只落第 8 列，其余列维持 null 不落格（不设行高版式）。
      if (value === null && spec.fillable && !isEnumOnlyRow(row)) {
        return ''
      }
      return value
    }
  }))

  return {
    sheetName: buildReportFillSheetName(variant),
    rows,
    columns,
    headerHeight: TEMPLATE_STYLE.headerHeight,
    bodyRowHeight: TEMPLATE_STYLE.bodyRowHeight,
    // 冻结 C2（表头 1 行 + 左侧 2 列）
    stickyRowsCount: TEMPLATE_STYLE.stickyRowsCount,
    stickyColumnsCount: TEMPLATE_STYLE.stickyColumnsCount,
    showGridLines: true,
    // 第 8 列（枚举来源）：隐藏且不套样式
    hiddenColumns: [8],
    plainColumns: [8],
    // F 列下拉：源为隐藏的 H2:H4
    dataValidations: [
      {
        sqref: 'F2:F1000',
        formula1: '=$H$2:$H$4',
        errorTitle: '自评等级填写错误',
        error: '自评等级只能从下拉中选择：超前完成 / 正常 / 滞后（三选一）',
        promptTitle: '自评等级',
        prompt: '点击单元格右侧箭头，从下拉中选择：超前完成 / 正常 / 滞后',
        allowBlank: false
      }
    ],
    // 整表保护（无密码）
    sheetProtection: {}
  }
}

/** 说明页行（标题 + 空行 + 逐条说明）。 */
interface ReportFillGuideRow {
  text: string
  /** 标题行加粗（样例 A1 为 bold） */
  bold?: boolean
}

/**
 * 「填写说明」页（单列：标题在 A1、第 2 行空、逐条说明从 A3 起）。
 *
 * <p>样例口径：白底无边框、标题 11 号加粗黑字、条目垂直居中 + 自动换行、行高 26、列宽 114、
 * 不冻结、网格线可见。页面<b>没有表头行</b>（`skipHeaderRow`）——否则表头行会带深蓝底白字。
 */
export function buildReportFillGuideSheet(
  variant: ReportFillTemplateVariant
): ExcelExportSheet<ReportFillGuideRow> {
  const rows: ReportFillGuideRow[] = [
    { text: buildReportFillGuideTitle(variant), bold: true },
    { text: '' },
    ...buildReportFillTemplateRules(variant).map(text => ({ text }))
  ]
  return {
    sheetName: '填写说明',
    skipHeaderRow: true,
    rows,
    columns: [
      {
        header: '填写说明',
        width: TEMPLATE_STYLE.guideColumnWidth,
        fontFamily: TEMPLATE_STYLE.fontFamily,
        getValue: row => ({
          value: row.text,
          // 水平对齐留空 = Excel 默认左对齐（与样例一致）
          align: undefined,
          alignVertical: 'center' as const,
          wrap: true,
          // 清掉通用 body 样式的细边框 → 说明页无边框
          borderColor: undefined,
          borderStyle: undefined,
          ...(row.bold ? { fontWeight: 'bold' as const } : {})
        })
      }
    ],
    bodyRowHeight: TEMPLATE_STYLE.guideRowHeight,
    // 说明页不冻结
    stickyRowsCount: 0,
    showGridLines: true
  }
}

/** 下载文件名。 */
export function buildReportFillTemplateFileName(variant: ReportFillTemplateVariant): string {
  if (variant === 'func') {
    return buildExportFileName('职能部门上报导入模板')
  }
  if (variant === 'college-single') {
    return buildExportFileName('学院上报单归口导入模板')
  }
  return buildExportFileName('学院上报多归口批量导入模板')
}
