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

/** 模板数据行（字段与列 key 一一对应）。 */
export interface ReportFillTemplateRow {
  serial: string
  /** 责任部门（来源）= 登录人所在组织 */
  responsibleDept: string
  /** 目标部门 / 上报目标 */
  targetDept: string
  indicatorName: string
  weight: string
  selfRating: string
  remark: string
  /** （枚举来源，勿动）——给 Excel 下拉当数据源，解析时忽略 */
  enumSource: string
}

/** 数据页列定义（8 列，按变体决定第 2/3 列措辞）。 */
function buildColumns(variant: ReportFillTemplateVariant): ReadonlyArray<{
  key: keyof ReportFillTemplateRow
  label: string
  width: number
}> {
  const isFunc = variant === 'func'
  const isAll = variant === 'college-all'
  return [
    { key: 'serial', label: '序号', width: 8 },
    {
      key: 'responsibleDept',
      label: isFunc ? '责任部门\n（来源·须与登录部门一致）' : '责任部门\n（来源·须与登录学院一致）',
      width: 24
    },
    {
      key: 'targetDept',
      label: isFunc ? '上报目标\n（战略发展部）' : '目标部门\n（归口职能部门）',
      width: 22
    },
    { key: 'indicatorName', label: '子指标名称', width: 34 },
    { key: 'weight', label: '权重\n（系统只读）', width: 14 },
    { key: 'selfRating', label: '自评等级\n（点选填写）', width: 18 },
    { key: 'remark', label: '进度说明\n（请填写）', width: 40 },
    { key: 'enumSource', label: '（枚举来源，勿动）', width: 18 }
    // 注：isAll 目前不影响列定义（三份结构完全相同），保留参数便于将来分化
  ].map(column => column) as ReadonlyArray<{
    key: keyof ReportFillTemplateRow
    label: string
    width: number
  }>
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
 */
const SAMPLE_ROWS: Record<
  ReportFillTemplateVariant,
  ReadonlyArray<Omit<ReportFillTemplateRow, 'responsibleDept'>>
> = {
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
      serial: '',
      targetDept: '',
      indicatorName: '',
      weight: '',
      selfRating: '',
      remark: '',
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
      serial: '',
      targetDept: '',
      indicatorName: '',
      weight: '',
      selfRating: '',
      remark: '',
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
      enumSource: ''
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
 * 生成数据页。
 *
 * <p>「责任部门」列写当前登录人所在组织的<b>权威名称</b>（由调用方传入，
 * 应与后端 {@code sys_org.name} 一致，否则上传会被整单拒绝）。
 */
export function buildReportFillTemplateSheet(
  variant: ReportFillTemplateVariant,
  responsibleDeptName: string
): ExcelExportSheet<ReportFillTemplateRow> {
  const rows: ReportFillTemplateRow[] = SAMPLE_ROWS[variant].map(row => ({
    ...row,
    responsibleDept: responsibleDeptName || SAMPLE_RESPONSIBLE_DEPT[variant]
  }))

  const columns: ExcelExportColumn<ReportFillTemplateRow>[] = buildColumns(variant).map(column => ({
    header: column.label,
    width: column.width,
    getValue: row => row[column.key] ?? ''
  }))

  return {
    sheetName: buildReportFillSheetName(variant),
    rows,
    columns
  }
}

/** 「填写说明」页（单列，标题 + 逐条）。 */
export function buildReportFillGuideSheet(
  variant: ReportFillTemplateVariant
): ExcelExportSheet<{ text: string }> {
  const rows = [
    { text: buildReportFillGuideTitle(variant) },
    ...buildReportFillTemplateRules(variant).map(text => ({ text }))
  ]
  return {
    sheetName: '填写说明',
    rows,
    columns: [{ header: '填写说明', width: 110, getValue: row => row.text }]
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
