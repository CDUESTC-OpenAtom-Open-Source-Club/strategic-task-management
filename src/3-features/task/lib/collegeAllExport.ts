/**
 * 2026-11-19（用户拍板 · 学院页签「全部导出」改造）：学院**跨归口线**导出口径（纯函数）。
 *
 * <p>改造前的学院页签「全部导出」复用单条导出：只导「当前选中的学院 × 当前选中归口」
 * 一条线的指标，且导出表头没有「职能部门」列——用户拿到表看不出每行由哪个部门下发。</p>
 *
 * <p>改造后：</p>
 * <ul>
 *   <li>数据源 = 该学院**与其所有归口部门**之间的全部指标（跨线合并，
 *       不再受「先选职能部门」两步门槛限制）；</li>
 *   <li>导出表新增「职能部门」列（行级标明该行由哪个归口部门下发）；</li>
 *   <li>文件组织 = 一学院一个 Excel；多学院时按既有 zip 逻辑打成包。</li>
 * </ul>
 *
 * <p>本模块只做**纯口径**：按学院分组 + 导出列定义 + 文件名。多学院打包沿用既有
 * {@code exportDepartmentsAsZip}（把「部门」位换成「学院」）。</p>
 */

import type { ExcelExportColumn } from '@/5-shared/lib/export/excel'

/**
 * 2026-11-19：「职能部门」列头文案（学院全部导出专用）。
 *
 * <p>与导入模板的「职能部门」列同名同义——导出表可以直接被回导为「全部导入」文件
 * （列名一致，导入解析器按表头全等匹配）。</p>
 */
export const COLLEGE_EXPORT_FUNCTIONAL_DEPT_HEADER = '职能部门'

/** 学院导出行（最小形状，宽松兼容后端行） */
export interface CollegeExportRowLike {
  id?: number | string | null
  name?: string
  type1?: string
  weight?: number | string | null
  status?: string
  [key: string]: unknown
}

/** 一个学院的导出分组 */
export interface CollegeExportGroup<T extends CollegeExportRowLike> {
  /** 学院名称 */
  college: string
  /** 该学院的全部指标行（跨归口线合并） */
  rows: T[]
  /** 该学院涉及到的归口部门（去重、按行出现顺序） */
  functionalDepts: string[]
}

/**
 * 按学院分组（保持学院在入参里的出现顺序；组内保持行序）。
 *
 * <p>空学院名（解析不出所属学院）的行**丢弃**——它们不属于任何学院，
 * 混进某一所学院的表里会让「一学院一表」的口径失真。</p>
 */
export const groupCollegeExportRows = <T extends CollegeExportRowLike>(
  rows: readonly T[] | null | undefined,
  getCollege: (row: T) => string,
  getFunctionalDept: (row: T) => string
): Array<CollegeExportGroup<T>> => {
  const groups: Array<CollegeExportGroup<T>> = []
  const indexByCollege = new Map<string, CollegeExportGroup<T>>()

  for (const row of Array.isArray(rows) ? rows : []) {
    const college = String(getCollege(row) ?? '').trim()
    if (!college) {
      continue
    }
    let group = indexByCollege.get(college)
    if (!group) {
      group = { college, rows: [], functionalDepts: [] }
      indexByCollege.set(college, group)
      groups.push(group)
    }
    group.rows.push(row)
    const dept = String(getFunctionalDept(row) ?? '').trim()
    if (dept && !group.functionalDepts.includes(dept)) {
      group.functionalDepts.push(dept)
    }
  }

  return groups
}

/** 导出表里「职能部门」列的取值（取不到时统一显示「—」） */
export const formatCollegeExportFunctionalDept = (value: unknown): string =>
  String(value ?? '').trim() || '—'

/** 学院全部导出的列定义构造参数 */
export interface CollegeExportColumnsParams<T extends CollegeExportRowLike> {
  rows: readonly T[]
  /** 行级归口部门名（该行由哪个职能部门下发） */
  getFunctionalDept: (row: T) => string
  /** 自评进度文案（AHEAD/NORMAL/DELAYED → 中文） */
  getSelfRatingLabel: (row: T) => string
  /** 审核进度文案 */
  getAppraisalLabel: (row: T) => string
  /** 进度说明文案 */
  getRemarkText: (row: T) => string
}

/**
 * 学院全部导出的列定义（在既有学院导出列基础上**新增「职能部门」列**）。
 *
 * <p>列序：职能部门 → 指标名称 → 指标类型 → 权重 → 自评进度 → 审核进度 →
 * 进度说明 → 状态。「职能部门」放最前——用户一眼看到「谁下的这批指标」。</p>
 */
export const buildCollegeExportColumns = <T extends CollegeExportRowLike>(
  params: CollegeExportColumnsParams<T>
): Array<ExcelExportColumn<T>> => [
  {
    header: COLLEGE_EXPORT_FUNCTIONAL_DEPT_HEADER,
    width: 20,
    getValue: row => formatCollegeExportFunctionalDept(params.getFunctionalDept(row))
  },
  {
    header: '指标名称',
    width: 36,
    getValue: row => String(row.name || '')
  },
  {
    header: '指标类型',
    width: 12,
    align: 'center',
    getValue: row => String(row.type1 || '定量')
  },
  {
    header: '权重',
    width: 10,
    align: 'center',
    getValue: row => String(row.weight ?? '')
  },
  {
    header: '自评进度',
    width: 14,
    align: 'center',
    getValue: row => params.getSelfRatingLabel(row)
  },
  {
    header: '审核进度',
    width: 14,
    align: 'center',
    getValue: row => params.getAppraisalLabel(row)
  },
  {
    header: '进度说明',
    width: 40,
    getValue: row => params.getRemarkText(row)
  },
  {
    header: '状态',
    width: 14,
    align: 'center',
    getValue: row => String(row.status || '')
  }
]

/**
 * 导出范围决策：单学院直接出一个 Excel，多学院打成 zip。
 *
 * <p>与既有 zipExport 的规则一致：只有 1 个学院且无附件时直接给 xlsx，
 * 避免用户为了一个学院多解一次压。</p>
 */
export const resolveCollegeExportPackaging = (
  collegeCount: number
): { mode: 'single' | 'zip'; forceZip: boolean } => {
  if (collegeCount <= 1) {
    return { mode: 'single', forceZip: false }
  }
  return { mode: 'zip', forceZip: true }
}
