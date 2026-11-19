/**
 * 2026-11-19（学院全部导入 · 规划书第二节）：「全部导入」分组预览的**纯函数**层。
 *
 * <p>后端把一份 Excel 按「职能部门」列拆成 N 组（每组 = 一个归口部门 = 一条
 * 「学院 × 归口」线）。前端只做三件事：①把每组归入三类（将下发 / 将跳过 / 错误）；
 * ②拼出确认页的「执行清单」；③把提交结果汇总成逐组卡片。**所有业务判定都以
 * 后端返回为准**，本模块不做任何本地推算（组级权重、线状态、错误文案一律后端给）。</p>
 *
 * <p>纯函数独立成文件 → 单测可直接 import，无需挂载 Vue 组件。</p>
 */

import type {
  ImportAllCommitResponse,
  ImportAllGroupResult,
  ImportGroupLineStatus,
  ImportGroupPreview,
  ImportRowPreview
} from '@/features/import/api/businessImport'

/** 分组三类形态（规划书第二节「解析阶段统一汇报三类信息」） */
export type ImportGroupKind = 'dispatch' | 'skip' | 'error'

/** 分组预览条目（归一化后的组视图，模板与单测共用） */
export interface ImportGroupView {
  kind: ImportGroupKind
  /** 组标题（职能部门名；无法识别时用兜底文案） */
  title: string
  /** 归口部门名称（null = 无法识别） */
  functionalOrgName: string | null
  /** 归口部门组织 ID */
  functionalOrgId: number | null
  /** 线状态标签 */
  lineStatusLabel: string
  /** 组级错误文案（错误组才有） */
  groupError: string | null
  /** 跳过原因（跳过组才有） */
  skipReason: string | null
  /** 组内行数 */
  rowsCount: number
  /** 组内基础性权重合计 */
  basicWeightTotal: number
  /** 组内行 */
  rows: ImportRowPreview[]
}

/** 无法识别归属部门时的组标题兜底文案 */
export const UNASSIGNED_GROUP_TITLE = '无法识别归属部门'

/** 线状态 → 中文标签 */
export const formatImportLineStatus = (status: ImportGroupLineStatus | null | undefined): string => {
  switch (status) {
    case 'DISTRIBUTED':
      return '已下发'
    case 'IN_REVIEW':
      return '审批中'
    case 'PENDING':
      return '待下发'
    case 'DRAFT':
      return '草稿'
    case 'NONE':
      return '未建线'
    default:
      return '未知状态'
  }
}

/**
 * 分组归类：先看组级错误，再看跳过原因，最后才是常规下发。
 *
 * <p>口径（规划书第二节 + 后端 2026-11-19 实证）：
 * <ul>
 *   <li>错误组：groupError 非空 → 红色，阻断整单提交。后端在三种情形置 groupError：
 *       ① 组内有行级错误；② 该组基础性权重合计 ≠ 100；③ 该线在审（PENDING/IN_REVIEW）；
 *       </li>
 *   <li>跳过组：skipReason 非空 → 黄色「已下发 · 本次将跳过」，不影响其他组
 *       （后端语义：线已 DISTRIBUTED）；</li>
 *   <li>将下发组：其余（willDispatch=true）→ 常规展示。</li>
 * </ul>
 *
 * <p><b>三态互斥</b>：一个组只会落进其中一类（error / skip / dispatch），
 * 所以「错误组」计数与「将跳过」计数**不会重复统计同一个组**——
 * 「错误 N 组 / 将跳过 M 组」两个数字加上「将下发 K 组」等于分组总数。</p>
 *
 * <p><b>2026-11-19 后端修正后的契约</b>：后端把「线已下发」判定提到组级权重/行级错误
 * <b>之前</b>——已下发的线一律只给 skipReason、<b>groupError 恒为 null</b>（跳过就是跳过，
 * 不该拦住别的组）。因此「已下发线 + 组内权重不足/行级错误」在前端稳定归为
 * <b>skip</b>（黄色、不阻断），而不是被算成 error 组把整单置灰。</p>
 *
 * <p>这里的「groupError 优先于 skipReason」是**防御性**顺序：若后端异常地同时给出两者
 * （数据异常），按 error 处理更安全（宁可拦住也不误放行）。</p>
 */
export const resolveImportGroupKind = (group: ImportGroupPreview): ImportGroupKind => {
  if (String(group?.groupError ?? '').trim()) {
    return 'error'
  }
  if (String(group?.skipReason ?? '').trim()) {
    return 'skip'
  }
  return 'dispatch'
}

/** 单组 → 组视图（归一化） */
export const toImportGroupView = (group: ImportGroupPreview): ImportGroupView => {
  const kind = resolveImportGroupKind(group)
  const functionalOrgName = group?.functionalOrgName ?? null
  return {
    kind,
    title: String(functionalOrgName ?? '').trim() || UNASSIGNED_GROUP_TITLE,
    functionalOrgName,
    functionalOrgId: group?.functionalOrgId ?? null,
    lineStatusLabel: formatImportLineStatus(group?.lineStatus),
    groupError: String(group?.groupError ?? '').trim() || null,
    skipReason: String(group?.skipReason ?? '').trim() || null,
    rowsCount: Number(group?.rowsCount ?? group?.rows?.length ?? 0),
    basicWeightTotal: Number(group?.basicWeightTotal ?? 0),
    rows: Array.isArray(group?.rows) ? group.rows : []
  }
}

/** 执行清单（确认页内容）：把分组预览拆成三类 + 汇总计数 */
export interface ImportExecutionPlan {
  /** 将下发的组 */
  dispatchGroups: ImportGroupView[]
  /** 将跳过的组（附原因） */
  skipGroups: ImportGroupView[]
  /** 错误组（附原因） */
  errorGroups: ImportGroupView[]
  /** 无法识别归属部门的行（数量） */
  unassignedRowsCount: number
  /** 是否阻断提交 */
  blocking: boolean
  /** 组总数 */
  totalGroups: number
}

/**
 * 由分组预览构建执行清单。
 *
 * <p>blocking 口径：后端给的 blocking 为准，**或**前端检出错误组 / 无法识别归属部门的行
 * （两处都阻断——后端漏给时前端仍守住「不能确认提交」）。</p>
 *
 * <p><b>三态互斥</b>：dispatch / skip / error 三个清单两两不相交，且三者之和 = 分组总数
 * （每个组由 {@link resolveImportGroupKind} 唯一归类）。所以「错误组」与「将跳过」
 * 两个计数不会重复统计同一个组。</p>
 */
export const buildImportExecutionPlan = (
  groups: readonly ImportGroupPreview[] | null | undefined,
  options: {
    unassignedRows?: readonly ImportRowPreview[] | null
    blocking?: boolean
  } = {}
): ImportExecutionPlan => {
  const views = (Array.isArray(groups) ? groups : []).map(toImportGroupView)
  const dispatchGroups = views.filter(view => view.kind === 'dispatch')
  const skipGroups = views.filter(view => view.kind === 'skip')
  const errorGroups = views.filter(view => view.kind === 'error')
  const unassignedRows = Array.isArray(options.unassignedRows) ? options.unassignedRows : []
  return {
    dispatchGroups,
    skipGroups,
    errorGroups,
    unassignedRowsCount: unassignedRows.length,
    blocking:
      options.blocking === true ||
      errorGroups.length > 0 ||
      unassignedRows.length > 0,
    totalGroups: views.length
  }
}

/** 执行清单文案（确认页「将下发 N 组 / 将跳过 M 组」的总述行） */
export const formatImportExecutionPlanSummary = (plan: ImportExecutionPlan): string => {
  const dispatchNames = plan.dispatchGroups.map(group => group.title).join('、')
  const skipNames = plan.skipGroups.map(group => group.title).join('、')
  const parts: string[] = []
  parts.push(
    plan.dispatchGroups.length > 0
      ? `将下发 ${plan.dispatchGroups.length} 组（${dispatchNames}）`
      : '将下发 0 组'
  )
  if (plan.skipGroups.length > 0) {
    parts.push(`将跳过 ${plan.skipGroups.length} 组（${skipNames}）`)
  } else {
    parts.push('将跳过 0 组')
  }
  if (plan.errorGroups.length > 0) {
    parts.push(`错误 ${plan.errorGroups.length} 组`)
  }
  if (plan.unassignedRowsCount > 0) {
    parts.push(`无法归组 ${plan.unassignedRowsCount} 行`)
  }
  return parts.join('；')
}

/** 单组提交结果 → 卡片视图 */
export interface ImportGroupResultView {
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED'
  title: string
  functionalOrgName: string | null
  planId: number | null
  rowsCount: number
  message: string | null
  /** 中文状态文案 */
  statusLabel: string
  /** Element Plus tag 类型（成功=绿 / 跳过=黄 / 失败=红） */
  tagType: 'success' | 'warning' | 'danger'
}

/** 单组提交结果 → 卡片视图 */
export const toImportGroupResultView = (result: ImportAllGroupResult): ImportGroupResultView => {
  const status = result?.status ?? 'FAILED'
  const functionalOrgName = result?.functionalOrgName ?? null
  return {
    status,
    title: String(functionalOrgName ?? '').trim() || UNASSIGNED_GROUP_TITLE,
    functionalOrgName,
    planId: result?.planId ?? null,
    rowsCount: Number(result?.rowsCount ?? 0),
    message: String(result?.message ?? '').trim() || null,
    statusLabel:
      status === 'SUCCESS' ? '下发成功' : status === 'SKIPPED' ? '已跳过' : '下发失败',
    tagType: status === 'SUCCESS' ? 'success' : status === 'SKIPPED' ? 'warning' : 'danger'
  }
}

/** 提交结果汇总（结果页顶部的汇总行） */
export interface ImportAllResultSummary {
  success: number
  skipped: number
  failed: number
  total: number
  /** 全部组失败 → 整单失败（规划书第二节第 5 条） */
  allFailed: boolean
}

/** 提交响应 → 汇总（后端 summary 为准，缺失时按 results 现算） */
export const summarizeImportAllResults = (
  response: ImportAllCommitResponse | null | undefined
): ImportAllResultSummary => {
  const results = Array.isArray(response?.results) ? response.results : []
  const success = Number(response?.summary?.success ?? results.filter(item => item.status === 'SUCCESS').length)
  const skipped = Number(response?.summary?.skipped ?? results.filter(item => item.status === 'SKIPPED').length)
  const failed = Number(response?.summary?.failed ?? results.filter(item => item.status === 'FAILED').length)
  const total = success + skipped + failed
  return {
    success,
    skipped,
    failed,
    total,
    allFailed: total > 0 && failed === total
  }
}
