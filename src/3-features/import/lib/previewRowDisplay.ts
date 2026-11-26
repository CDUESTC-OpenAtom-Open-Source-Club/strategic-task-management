/**
 * 2026-11-25（预览跳过行显示修复）：导入预览行「指标 / 类型 / 权重」三列的取值**纯函数**。
 *
 * <p>用户口径：文件里有值就必须显示出来——「跳过」只是"不下发"，不是"不显示内容"。</p>
 *
 * <p>缺陷背景（用户实测截图，mode=all 全部导入）：已下发被跳过的组，行表「指标/类型/权重」
 * 三列显示 '-'/空，即使上传的 Excel 行里这些列填了值。取证结论（真机 curl + Playwright，
 * backend 88441ec + frontend develop）：渲染层此前只读 <code>row.normalized.*</code>；当解析链
 * 把行置为非 CREATE/UPDATE（典型：父级锚点行被判定为未使用预填行 → SKIP；权重列文本格式
 * 解析失败 parseWeight→null；或响应缺 normalized 字段时直接读属性还会抛渲染异常），
 * normalized 为空而 source（后端原样回显的文件单元格）仍有值，页面就只剩 '-'。</p>
 *
 * <p>修复口径：normalized 优先（后端归一化结果——CREATE/UPDATE 行显示行为不变），为空时
 * 回退 source 原始单元格（source 的键 = 文件表头文本，别名表与后端
 * ExcelBusinessImportParser 的 DISTRIBUTION_ALIASES 对齐）；仍无值才显示 '-'（权重）/空。
 * 只改显示，不动动作/跳过语义、执行清单计数与确认下发拦截逻辑。</p>
 *
 * <p>纯函数独立成文件 → 单测可直接 import，无需挂载 Vue 组件。</p>
 */

/** 预览行取值输入（ImportRowPreview 的结构子集，避免整包类型耦合） */
export interface PreviewRowDisplayInput {
  normalized?: {
    indicatorName?: number | string | null
    indicatorType?: number | string | null
    weight?: number | string | null
    parentIndicator?: number | string | null
  } | null
  source?: Record<string, string> | null
}

/** 后端 DISTRIBUTION_ALIASES（ExcelBusinessImportParser）对齐：子指标名称列的文件表头别名 */
const INDICATOR_NAME_SOURCE_KEYS = ['子指标名称', '指标名称', '学院指标'] as const

/** 后端 DISTRIBUTION_ALIASES 对齐：指标类型列的文件表头别名 */
const INDICATOR_TYPE_SOURCE_KEYS = ['指标类型', '计量方式'] as const

/** 后端 DISTRIBUTION_ALIASES 对齐：权重列的文件表头别名（半/全角括号与旧模板文案） */
const WEIGHT_SOURCE_KEYS = [
  '权重（纯数字）',
  '权重(纯数字)',
  '权重',
  '指标权重',
  '子指标权重',
  '权重（可填 10 / 10% / 0.1）',
  '权重(可填 10 / 10% / 0.1)'
] as const

/** 后端 DISTRIBUTION_ALIASES 对齐：父级核心指标列的文件表头别名 */
const PARENT_INDICATOR_SOURCE_KEYS = ['核心指标', '父级核心指标', '上级指标', '来源指标'] as const

const textOf = (value: unknown): string => {
  if (value === null || value === undefined) {
    return ''
  }
  return String(value).trim()
}

/**
 * 从 source 原始单元格回显里按表头别名取第一个非空值。
 *
 * <p>source 的键 = 后端读到的文件表头（normalizeHeader：去空白）。取值顺序：</p>
 * <ol>
 *   <li>别名全等匹配（与后端别名表一致）；</li>
 *   <li>包含式兜底：表头文案演进/手写文件（如「子指标名」「权重(数字)」）时后端归一化
 *       会失败，但原始列仍在 source 里——按包含核心词命中。excludes 用来排掉形近列：
 *       「核心指标类型」包含「指标类型」与「核心指标」，绝不能被当成指标类型/父级指标取值。</li>
 * </ol>
 */
const rawCellText = (
  source: Record<string, string> | null | undefined,
  keys: readonly string[],
  includes: readonly string[] = [],
  excludes: readonly string[] = []
): string => {
  if (!source) {
    return ''
  }
  for (const key of keys) {
    const exact = textOf(source[key])
    if (exact) {
      return exact
    }
  }
  if (includes.length) {
    for (const rawKey of Object.keys(source)) {
      const compactKey = rawKey.replace(/\s/g, '')
      if (!compactKey) {
        continue
      }
      if (excludes.some(token => compactKey.includes(token))) {
        continue
      }
      if (!includes.some(token => compactKey.includes(token))) {
        continue
      }
      const value = textOf(source[rawKey])
      if (value) {
        return value
      }
    }
  }
  return ''
}

/** 「指标」列显示值：归一化子指标名优先，空则回退文件「子指标名称」列原文 */
export const previewIndicatorNameText = (row: PreviewRowDisplayInput): string =>
  textOf(row?.normalized?.indicatorName) ||
  rawCellText(row?.source, INDICATOR_NAME_SOURCE_KEYS, ['子指标'])

/**
 * 「类型」列显示值：归一化指标类型优先，空则回退文件「指标类型」列原文。
 * 排除「核心指标类型 / 父级指标类型」（形近列，是父级只读锚点信息，不是本行子指标类型）。
 */
export const previewIndicatorTypeText = (row: PreviewRowDisplayInput): string =>
  textOf(row?.normalized?.indicatorType) ||
  rawCellText(row?.source, INDICATOR_TYPE_SOURCE_KEYS, ['指标类型', '计量方式'], ['核心', '父级'])

/** 「父级指标」列显示值：归一化父级核心指标优先，空则回退文件「核心指标」列原文 */
export const previewParentIndicatorText = (row: PreviewRowDisplayInput): string =>
  textOf(row?.normalized?.parentIndicator) ||
  rawCellText(row?.source, PARENT_INDICATOR_SOURCE_KEYS, ['父级核心指标'])

/**
 * 「权重」列显示值：归一化权重优先（数字 0 也是真值，显示 "0"——旧实现 `|| '-'` 会把
 * 0 吞成 '-'），空则回退文件权重列原文（如解析失败的原格式文本），仍无值才 '-'。
 */
export const previewWeightText = (row: PreviewRowDisplayInput): string => {
  const weight = row?.normalized?.weight
  if (typeof weight === 'number' && Number.isFinite(weight)) {
    return String(weight)
  }
  const weightText = textOf(weight)
  if (weightText) {
    return weightText
  }
  return rawCellText(row?.source, WEIGHT_SOURCE_KEYS, ['权重']) || '-'
}
