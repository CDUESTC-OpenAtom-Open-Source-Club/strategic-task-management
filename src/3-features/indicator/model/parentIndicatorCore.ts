/**
 * 父级核心指标归口信息（targetOrg）水合 + 任务来源归组键——指标填报页与数据看板共用。
 *
 * 2026-11-25（看板来源归属修复）：学院线任务由战略发展部代发（ownerDept 只是代发
 * 通道，恒为战略发展部），业务口径上学院承接任务的「来源部门」= 归口职能部门 =
 * 父级核心指标（parentIndicatorId）的 targetOrg。此口径与学院上报侧（归属部门筛选）
 * 2026-11-13 迁移时的实现完全同源；看板的「任务来源分布 / 承接任务汇总 / 导出列 /
 * 饼图点击筛选」此前漏迁，仍在用已退役的 ownerDept，导致来源被算到战略发展部头上。
 *
 * 字段口径：targetOrgId/targetOrgName 为后端 IndicatorResponse 权威字段；
 * responsibleDept/targetDepartment 仅作旧数据兜底（与填报页原实现逐字段一致）。
 */

import { runInBatches } from '@/shared/lib/utils/concurrency'

/** 父级核心指标水合快照（getIndicatorById 归一化结果） */
export interface ParentIndicatorCore {
  name: string
  type1?: string
  sortOrder?: number
  /** 父级核心指标的归口职能部门 ID（后端权威字段） */
  targetOrgId?: number
  /** 父级核心指标的归口职能部门名称（后端权威字段；任务来源归组键取它） */
  targetOrgName?: string
}

/**
 * 父指标水合的默认单批并发上限。
 *
 * 2026-11-27（生产看板 500）：旧实现对每个唯一父指标 id 无上限并发拉详情，
 * 生产指标数 94 → 561 后单学院一次要拉 50 个父指标详情，几十个并发请求打满
 * Hikari 连接池（total=20, active=20, idle=0, waiting=24）→ 后端 500。
 * 限流后任意时刻在途请求 ≤ 6，远小于连接池容量（20~32）。
 */
export const PARENT_INDICATOR_FETCH_CONCURRENCY = 6

/**
 * 指标 API 桶的懒加载句柄（模块级记忆化）。
 *
 * 动态 import 保留「按需加载」语义（看板首屏不必把整个指标 API 桶打进主包），
 * 但必须记忆化：批量水合会并发调几十次，重复 import 既浪费又会踩到并发
 * 动态 import 的加载竞态（并发调用只有首个拿到稳定句柄）。
 */
let indicatorApiModulePromise: Promise<typeof import('@/features/indicator/api')> | null = null

function loadIndicatorApi(): Promise<typeof import('@/features/indicator/api')> {
  if (!indicatorApiModulePromise) {
    indicatorApiModulePromise = import('@/features/indicator/api')
  }
  return indicatorApiModulePromise
}

/**
 * 按父指标 ID 拉取并归一化核心指标信息（归口字段随父指标缓存）。
 * 与填报页 useIndicatorListView 原水合实现逐字段同口径；失败时抛错，
 * 由调用方决定日志标签与缓存合并策略。
 *
 * @param pid 父指标 ID
 * @param options.silentErrorToast 默认 true——父指标归口只影响「任务来源」归组，
 *   取不到时可降级（调用方有 logger.warn 兜底），不应触发全局错误提示；
 *   用户主动操作的真实 500 仍照常提示（见 responseInterceptors 的静默标记）。
 */
export async function fetchParentIndicatorCore(
  pid: string,
  options: { silentErrorToast?: boolean } = {}
): Promise<ParentIndicatorCore | null> {
  const { indicatorApi } = await loadIndicatorApi()
  const response = await indicatorApi.getIndicatorById(pid, {
    silentErrorToast: options.silentErrorToast !== false
  })
  const vo = (response?.data ?? null) as Record<string, unknown> | null
  if (!vo) {
    return null
  }
  const sortOrder = Number(vo.sortOrder ?? NaN)
  // 2026-11-13：归口字段随父指标一并缓存（targetOrgId/targetOrgName 为后端
  // IndicatorResponse 权威字段；responsibleDept/targetDepartment 仅作旧数据兜底）
  const functionalOrgIdRaw = Number(vo.targetOrgId ?? NaN)
  const targetOrgName =
    String(vo.targetOrgName ?? vo.responsibleDept ?? vo.targetDepartment ?? '').trim() || undefined
  return {
    name: String(vo.indicatorName ?? vo.name ?? ''),
    type1: String(vo.indicatorType ?? vo.type1 ?? '') || undefined,
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : undefined,
    targetOrgId:
      Number.isFinite(functionalOrgIdRaw) && functionalOrgIdRaw > 0
        ? functionalOrgIdRaw
        : undefined,
    targetOrgName
  }
}

/**
 * 任务来源归组键（纯函数）：学院指标 → 归口职能部门名称。
 * 取父级核心指标 targetOrgName；父缺失 / 未下发 / 解析不出 → 回退 `ownerDept || '其他'`
 * （保持旧行为兜底，不让老数据消失）。看板饼图、承接任务汇总、导出列、点击筛选同键。
 */
export function resolveTaskSourceDept(
  item: { ownerDept?: string | null; parentIndicatorId?: string | number | null } | null,
  parentIndicatorMap: Record<string, ParentIndicatorCore | undefined>
): string {
  const pid = String(item?.parentIndicatorId ?? '').trim()
  if (pid) {
    const orgName = String(parentIndicatorMap[pid]?.targetOrgName ?? '').trim()
    if (orgName) {
      return orgName
    }
  }
  return item?.ownerDept || '其他'
}

export interface FetchParentIndicatorCoresOptions {
  /** 单批并发上限（默认 {@link PARENT_INDICATOR_FETCH_CONCURRENCY}） */
  concurrency?: number
  /**
   * 单条解析成功回调（逐条触发）。
   * 调用方据此**渐进**并入自己的缓存——与旧实现的逐条合并语义一致，
   * 不必等整批结束才刷新界面。
   */
  onResolved?: (pid: string, core: ParentIndicatorCore) => void
  /**
   * 单条失败回调（逐条触发）。默认静默降级：记 warn 后跳过该条，
   * 不影响其它父指标，也不触发全局错误提示。
   */
  onError?: (pid: string, error: unknown) => void
}

/**
 * 批量拉取父级核心指标归口信息（看板 / 指标填报页共用）。
 *
 * 2026-11-27（生产看板 500 根治）：旧实现是 `Promise.all(ids.map(fetch))`——
 * 无并发上限，一次看板首屏就会同时打出几十个 `GET /indicators/{id}`，
 * 打满 Hikari 连接池 → 后端 500 → 前端弹「服务器内部错误」。
 * 现改为「分批 + 批间让出事件循环」，任一时刻在途请求数 ≤ concurrency。
 *
 * 业务语义不变：全部结果都要拿到；单条失败只跳过该条（由 onError 记日志）。
 *
 * @param pids 父指标 ID 列表（内部去重、去空）
 * @param options 并发上限与逐条回调
 * @returns 解析成功的父指标（pid → 归口信息）
 */
export async function fetchParentIndicatorCores(
  pids: readonly string[],
  options: FetchParentIndicatorCoresOptions = {}
): Promise<Map<string, ParentIndicatorCore>> {
  const resolved = new Map<string, ParentIndicatorCore>()
  const uniquePids = [...new Set(pids.map(pid => String(pid ?? '').trim()).filter(Boolean))]
  if (uniquePids.length === 0) {
    return resolved
  }

  await runInBatches(uniquePids, (pid: string) => fetchParentIndicatorCore(pid), {
    batchSize: options.concurrency ?? PARENT_INDICATOR_FETCH_CONCURRENCY,
    onFulfilled: (pid, core) => {
      // 后端返回空体（VO 缺失）时视为「该父指标解析不出」，不并入缓存
      if (!core) {
        return
      }
      resolved.set(pid, core)
      options.onResolved?.(pid, core)
    },
    onRejected: (pid, reason) => {
      options.onError?.(pid, reason)
    }
  })

  return resolved
}
