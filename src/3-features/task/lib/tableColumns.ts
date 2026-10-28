/**
 * 2026-10-28 迭代计划 M3：战略任务页「职能部门表 / 二级学院表」列宽统一常量。
 *
 * 此前两表同名字段列宽各自为政（上报资料 112/96、下发备注 130/106 等），
 * 同一份数据在两个页签间切换时视觉跳变。此常量为唯一定义处，两表必须引用同一值；
 * 调整列宽只改这里，不允许在模板里写魔法数字。
 */
export const TASK_TABLE_COLUMN_WIDTH = {
  /** 战略任务列（内容最长，吃剩余宽度，不设固定值） */
  weight: 96,
  selfRating: 112,
  appraisalLevel: 122,
  reportMaterials: 112,
  progressNoteMin: 130,
  remark: 130,
  actions: 116
} as const
