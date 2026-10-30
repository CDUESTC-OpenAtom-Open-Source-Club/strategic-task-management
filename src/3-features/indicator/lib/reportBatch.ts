/**
 * 上报批量保存的纯计算逻辑（2026-10-28）
 *
 * 背景（Issue #91 P0-2 / P1-1）：填报人保存时，前端提交的是「全量明细」，
 * 后端按全量 upsert 保存（空附件列表会 DELETE 该条全部附件关联），但此前
 *  - 附件 id 只给当前正在编辑的那一条赋值，其余传空 → 先前保存的附件关联被清空
 *    （实测：给指标 A 存附件后再保存指标 B，A 的附件关联消失）；
 *  - 自评进度把当前表单的值套给所有指标 → 实填「超前/延期」落库全为「正常」。
 *
 * 这里把两处判定抽成纯函数，便于单测覆盖。
 */

/** 取出某条指标已关联的附件 id（兼容 attachmentId / id 两种字段名）。 */
export function collectExistingAttachmentIds(item: unknown): number[] {
  const details = (item as { pendingAttachmentDetails?: unknown } | null)?.pendingAttachmentDetails
  if (!Array.isArray(details)) {
    return []
  }
  return details
    .map((entry: unknown) => {
      const record = entry as { attachmentId?: unknown; id?: unknown } | null
      return Number(record?.attachmentId ?? record?.id)
    })
    .filter((id: number) => Number.isFinite(id) && id > 0)
}

/**
 * 计算某条指标在本次批量提交中应写入的自评进度。
 * 只有当前正在编辑的指标用表单里的值，其余沿用各自已保存的值。
 */
export function resolveBatchSelfRating(params: {
  isCurrentIndicator: boolean
  formSelfRating?: string | null
  itemSelfRating?: string | null
}): string | undefined {
  const { isCurrentIndicator, formSelfRating, itemSelfRating } = params
  if (isCurrentIndicator) {
    return formSelfRating || undefined
  }
  return itemSelfRating || undefined
}

/**
 * 取某条指标「已保存的自评进度等级」。
 *
 * 2026-10-30 修复（等级制批量保存必失败 + 已存自评进度被清空）：
 * 后端按全量 upsert 保存（`self_rating = EXCLUDED.self_rating`），
 * 非当前条目若不回填已存等级，就会把该条已存的等级覆盖成空；
 * 且等级为空时后端会落回百分比「进度必须递增」校验，
 * 等级制下进度恒为 0 → `0 <= 0` 恒成立 → 整次保存回滚、报「保存指标填报失败」。
 *
 * 等级来源优先级：未提交草稿明细（overlay）→ 列表行自身字段。
 * 列表接口（/plans/{id}/details）不返回 selfRating，故实际靠 overlay 提供。
 */
export function resolveSavedSelfRating(
  item: unknown,
  isCurrentIndicator: boolean,
  overlayDetail?: { selfRating?: string | null } | null
): string | undefined {
  if (isCurrentIndicator) {
    // 当前条目用表单值，由 resolveBatchSelfRating 决定，此处不参与
    return undefined
  }
  const overlayRating = overlayDetail?.selfRating
  if (typeof overlayRating === 'string' && overlayRating.trim()) {
    return overlayRating.trim().toUpperCase()
  }
  const rowRating = (item as { selfRating?: string | null } | null)?.selfRating
  if (typeof rowRating === 'string' && rowRating.trim()) {
    return rowRating.trim().toUpperCase()
  }
  return undefined
}
