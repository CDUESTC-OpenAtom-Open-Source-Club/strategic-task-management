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
 * 按父指标 ID 拉取并归一化核心指标信息（归口字段随父指标缓存）。
 * 与填报页 useIndicatorListView 原水合实现逐字段同口径；失败时抛错，
 * 由调用方决定日志标签与缓存合并策略。
 */
export async function fetchParentIndicatorCore(pid: string): Promise<ParentIndicatorCore | null> {
  const { indicatorApi } = await import('@/features/indicator/api')
  const response = await indicatorApi.getIndicatorById(pid)
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
