<!--
  ReportCycleTag - 当前填报周期标签

  职责:
  - 统一「当前填报周期：YYYY年M月」文案与样式（2026-10-30 用户定案）
  - 站内任务管理 / 指标下发与管理 / 指标填报三个页面的卡片头部共用
  - 间距由宿主布局（flex gap / 内联样式）控制，组件自身不写死 margin
-->
<script setup lang="ts">
import { computed } from 'vue'

export type ReportCycleTagType = 'primary' | 'success' | 'warning' | 'info' | 'danger'

const props = defineProps<{
  /** 填报周期 YYYYMM（如 202610）；为空或格式非法时不渲染 */
  month?: string | null
  /** 标签类型；填报页用 success 表示「已跟进到当前月」，默认 info */
  type?: ReportCycleTagType
}>()

const label = computed(() => {
  const raw = String(props.month ?? '').trim()
  return /^\d{6}$/.test(raw) ? `${raw.slice(0, 4)}年${Number(raw.slice(4, 6))}月` : ''
})
</script>

<template>
  <el-tag v-if="label" :type="type ?? 'info'" size="small" class="report-cycle-tag">
    当前填报周期：{{ label }}
  </el-tag>
</template>

<style scoped>
.report-cycle-tag {
  white-space: nowrap;
}
</style>
