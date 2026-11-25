import type { ExcelExportColumn, ExcelExportSheet } from '@/shared/lib/export/excel'
import { buildExportFileName } from '@/shared/lib/export/excel'

/**
 * 2026-11-25（指标填报导入式上报 · 学院侧）：填报导入模板的列定义与生成。
 *
 * <p><b>标准模板以需求方提供的两份样例为准</b>（指标填报导入模板 · 导入式上报 · 单归口 /
 * 指标填报批量导入模板 · 多归口），本模块逐项对齐其结构：
 * <ul>
 *   <li>数据页表头：序号 ｜ 学院（须与登录学院一致）｜ 归口职能部门 ｜ 子指标名称 ｜
 *       权重（系统只读）｜ 自评等级（点选填写）｜ 进度说明（请填写）——括号说明是给人看的，
 *       后端解析时先归一化再匹配；</li>
 *   <li>「填写说明」页文案<b>逐条照抄</b>；</li>
 *   <li>示例数据照抄，但<b>自评等级「超前」强制同步为「超前完成」</b>
 *       （2026-11-25 用户定案，与系统既有文案一致），且「学院」列填当前登录人所在学院
 *       ——学院列会被后端与登录账号比对，照抄他院名字会让模板直接被整单拒绝。</li>
 * </ul>
 *
 * <p><b>与既有的导入下发模板（{@code features/import/lib/importTemplate.ts}）刻意分开</b>：
 * 下发模板产出「要下发的指标」，本模板产出「本月要填的填报内容」；列名相近但语义不同
 * （尤其「归口职能部门」列在本模板里是<b>拆线依据</b>），混用会让填报文件被误认成下发文件。
 */

/** 导入模式：单归口（一次导入一条归口线） / 多归口（一次导入本学院全部归口线）。 */
export type ReportFillImportMode = 'single' | 'all'

/** 自评等级三档（2026-11-25 用户定案：强制统一为「超前完成 / 正常 / 滞后」）。 */
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
 * <p>刻意<b>不</b>兼容「超前」等其它写法：后端 {@code ProgressLevel.normalize} 对无法识别的值
 * 会静默返回 null（不报错），会让非法等级拖到提交时才炸，故前端先按严格白名单拦。
 */
export function resolveReportFillLevel(label: unknown): string | null {
  const key = String(label ?? '').trim()
  if (!key) {
    return null
  }
  return REPORT_FILL_LEVEL_BY_LABEL[key] ?? null
}

/** 模板数据行（字段与列 key 一一对应）。 */
export interface ReportFillTemplateRow {
  serial: string
  college: string
  functionalDept: string
  indicatorName: string
  weight: string
  selfRating: string
  remark: string
}

/**
 * 模板预填种子（可选）：一条 = 一个待填报的子指标。
 *
 * <p><b>默认不启用</b>——标准模板以需求方给的样例为准（示例数据 + 说明）。
 * 若将来要做「下载时带出本学院真实指标」，从这里传入即可。
 */
export interface ReportFillTemplateSeed {
  functionalDept: string
  indicatorName: string
  weight: string
}

/**
 * 数据页列定义。
 *
 * <p>表头文案<b>以需求方给的模板为准</b>（含括号说明）。括号里的提示是给人看的，
 * 后端解析时会被归一化剥离。
 */
export const REPORT_FILL_TEMPLATE_COLUMNS: ReadonlyArray<{
  key: keyof ReportFillTemplateRow
  label: string
  width: number
}> = [
  { key: 'serial', label: '序号', width: 8 },
  { key: 'college', label: '学院\n（须与登录学院一致）', width: 22 },
  { key: 'functionalDept', label: '归口职能部门', width: 20 },
  { key: 'indicatorName', label: '子指标名称', width: 34 },
  { key: 'weight', label: '权重\n（系统只读）', width: 14 },
  { key: 'selfRating', label: '自评等级\n（点选填写）', width: 18 },
  { key: 'remark', label: '进度说明\n（请填写）', width: 40 }
]

/** 样例数据里出现的两个归口部门（与需求方样例一致）。 */
const SAMPLE_COLLEGE = '计算机学院'
const SAMPLE_DEPT_A = '什邡管委会'
const SAMPLE_DEPT_B = '预算部'

/**
 * 单归口版的示例数据（照抄需求方样例，仅把等级「超前」同步为「超前完成」——
 * 本样例本就没有「超前」，保持原样）。
 */
const SAMPLE_ROWS_SINGLE: ReadonlyArray<Omit<ReportFillTemplateRow, 'college'>> = [
  {
    serial: '1',
    functionalDept: SAMPLE_DEPT_A,
    indicatorName: '计算机学院-园区智慧化服务技术支撑',
    weight: '40',
    selfRating: '滞后',
    remark: '受资源到位滞后影响，部分节点未按期完成'
  },
  {
    serial: '2',
    functionalDept: SAMPLE_DEPT_A,
    indicatorName: '计算机学院-信息化运维绩效管理',
    weight: '60',
    selfRating: '正常',
    remark: '运维工单响应时效达标率 96%'
  }
]

/**
 * 多归口版的示例数据（照抄需求方样例）。
 *
 * <p>⚠️ 样例第 2 行的自评等级在需求方文件里写的是「超前」——按 2026-11-25 用户定案
 * **强制同步为「超前完成」**（与系统既有文案一致）。
 */
const SAMPLE_ROWS_ALL: ReadonlyArray<Omit<ReportFillTemplateRow, 'college'>> = [
  {
    serial: '1',
    functionalDept: SAMPLE_DEPT_B,
    indicatorName: '计算机学院-产业学院订单式人才培养项目',
    weight: '30',
    selfRating: '正常',
    remark: '订单班已开班，课程体系按企业需求调整完毕'
  },
  {
    serial: '2',
    functionalDept: SAMPLE_DEPT_B,
    indicatorName: '计算机学院-园区数字孪生联合实验室共建',
    weight: '70',
    // 需求方样例写「超前」→ 强制同步为「超前完成」
    selfRating: '超前完成',
    remark: '联合实验室设备安装调试完成，进入试运行'
  },
  {
    serial: '3',
    functionalDept: SAMPLE_DEPT_A,
    indicatorName: '计算机学院-信息化运维绩效管理',
    weight: '60',
    selfRating: '正常',
    remark: '运维工单响应时效达标率 96%'
  },
  {
    serial: '4',
    functionalDept: SAMPLE_DEPT_A,
    indicatorName: '计算机学院-园区智慧化服务技术支撑',
    weight: '40',
    selfRating: '滞后',
    remark: '受资源到位滞后影响，部分节点未按期完成'
  }
]

/**
 * 「填写说明」页文案（逐条照抄需求方样例）。
 *
 * <p>两套文案<b>各自独立写死</b>——两版的条目编号不同（多归口版多一条「拆线规则」，
 * 其后各条顺延），共用片段极易串号，故不抽公共数组。
 */
export function buildReportFillTemplateRules(mode: ReportFillImportMode): string[] {
  if (mode === 'all') {
    return [
      '1. 使用者：学院填报人登录自己账号使用。导入的填报数据归属 = 登录人所在学院（不可代其他学院填报）。',
      '2. 用途：一次导入本学院全部归口线的月度填报数据（示例：计算机学院同时收到「预算部」与「什邡管委会」两条线的指标，一张表一次报完）。',
      '3. 🔴 学院校验（安全规则）：「学院」列必须填写登录人所在学院，解析时与登录账号比对——不一致将整单拒绝导入，防止误报其他学院。',
      '4. 拆线规则：按「归口职能部门」列自动拆分——每个归口线的行独立校验、独立提交、独立进入该线的上报审批流程（一条线失败不影响其他线）。',
      '5. 归属月份：本表不设月份列——归属月份在导入界面上选择。',
      '6. 定位规则：按「学院 + 归口职能部门 + 子指标名称」匹配本学院已下发的子指标行；名称完全一致 = 更新该行填报；无匹配 = 该行失败点名。',
      '7. 填报字段（黄色两列，与填报页可编辑字段一致）：① 自评等级——点击单元格下拉选择「超前完成 / 正常 / 滞后」（三选一，手输其他内容会被拒绝）；② 进度说明——当月推进情况文字说明。',
      '8. 权重列：系统只读参考，请勿修改（该列已锁定）。',
      '9. 导入流程：选择文件 → 解析预览（学院校验 + 按归口线分组展示将提交 / 将跳过 / 错误组）→ 确认批量导入 → 逐线自动提交并进入审批（通过后数据看板生效）。',
      '10. 彩色底纹行为示例数据（黄=预算部线 / 绿=什邡管委会线），正式导入前请删除。'
    ]
  }
  return [
    '1. 使用者：学院填报人登录自己账号使用。导入的填报数据归属 = 登录人所在学院（不可代其他学院填报）。',
    '2. 用途：一次导入一条归口线的月度填报数据（本学院从某一个归口职能部门收到的指标）。',
    '3. 🔴 学院校验（安全规则）：「学院」列必须填写登录人所在学院，解析时与登录账号比对——不一致将整单拒绝导入，防止误报其他学院。',
    '4. 归属月份：本表不设月份列——归属月份在导入界面上选择。',
    '5. 定位规则：按「学院 + 归口职能部门 + 子指标名称」匹配本学院已下发的子指标行；名称完全一致 = 更新该行填报；无匹配 = 该行失败点名。',
    '6. 填报字段（黄色两列，与填报页可编辑字段一致）：① 自评等级——点击单元格下拉选择「超前完成 / 正常 / 滞后」（三选一，手输其他内容会被拒绝）；② 进度说明——当月推进情况文字说明。',
    '7. 权重列：系统只读参考，请勿修改（该列已锁定）。',
    '8. 导入流程：选择文件 → 解析预览（学院校验 + 定位 + 数值校验）→ 确认导入 → 进入该归口线的正常上报审批流程（审批通过后数据看板生效）。',
    '9. 黄色底纹行为示例数据，正式导入前请删除。'
  ]
}

/** 数据页 sheet 名。 */
export function buildReportFillSheetName(mode: ReportFillImportMode): string {
  return mode === 'all' ? '月报填报批量导入模板' : '月报填报导入模板'
}

/**
 * 生成数据页。
 *
 * @param mode        导入模式
 * @param seeds       可选的预填种子（默认不传 → 用需求方样例数据）
 * @param collegeName 当前登录人所在学院名称（写入「学院」列）
 */
export function buildReportFillTemplateSheet(
  mode: ReportFillImportMode,
  collegeName: string,
  seeds?: ReadonlyArray<ReportFillTemplateSeed>
): ExcelExportSheet<ReportFillTemplateRow> {
  const rows: ReportFillTemplateRow[] = seeds?.length
    ? seeds.map((seed, index) => ({
        serial: String(index + 1),
        college: collegeName,
        functionalDept: seed.functionalDept,
        indicatorName: seed.indicatorName,
        weight: seed.weight,
        selfRating: '',
        remark: ''
      }))
    : (mode === 'all' ? SAMPLE_ROWS_ALL : SAMPLE_ROWS_SINGLE).map(row => ({
        ...row,
        college: collegeName
      }))

  const columns: ExcelExportColumn<ReportFillTemplateRow>[] = REPORT_FILL_TEMPLATE_COLUMNS.map(
    column => ({
      header: column.label,
      width: column.width,
      getValue: row => row[column.key] ?? ''
    })
  )

  return {
    sheetName: buildReportFillSheetName(mode),
    rows,
    columns
  }
}

/** 「填写说明」页（单列，每条一行）。 */
export function buildReportFillGuideSheet(
  mode: ReportFillImportMode
): ExcelExportSheet<{ text: string }> {
  const title =
    mode === 'all'
      ? '填写说明（指标填报批量导入 · 导入式上报 · 多归口版）'
      : '填写说明（指标填报导入 · 导入式上报 · 单归口版）'
  const rows = [{ text: title }, ...buildReportFillTemplateRules(mode).map(text => ({ text }))]
  return {
    sheetName: '填写说明',
    rows,
    columns: [{ header: '填写说明', width: 110, getValue: row => row.text }]
  }
}

/** 下载文件名。 */
export function buildReportFillTemplateFileName(mode: ReportFillImportMode): string {
  const base = mode === 'all' ? '指标填报批量导入模板' : '指标填报导入模板'
  return buildExportFileName(base)
}
