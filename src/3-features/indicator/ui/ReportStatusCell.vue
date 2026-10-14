<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { IndicatorFill } from '@/shared/types'
import { useIndicatorFills } from '../model/useIndicatorFills'

// 2026-10-13 用户隔离测试发现：上报状态列此前误用后端 hasCurrentMonthFill
// （该字段语义是"本月是否还有可编辑的填报轮次"，APPROVED/REJECTED 被故意排除），
// 导致审批通过后反而显示"未填报"。改为取最新一次非草稿上报的真实审批状态。
const props = defineProps<{
  indicatorId?: number | string | null
}>()

const latest = ref<IndicatorFill | null>(null)
const loaded = ref(false)

const label = () => {
  switch (latest.value?.status) {
    case 'approved':
      return '已上报'
    case 'submitted':
      return '审批中'
    case 'rejected':
      return '已驳回'
    default:
      return '未填报'
  }
}

const tagType = () => {
  switch (latest.value?.status) {
    case 'approved':
      return 'success'
    case 'submitted':
      return 'warning'
    case 'rejected':
      return 'danger'
    default:
      return 'info'
  }
}

onMounted(async () => {
  const fills = await useIndicatorFills(props.indicatorId)
  latest.value = fills[0] ?? null
  loaded.value = true
})
</script>

<template>
  <template v-if="loaded">
    <el-tag v-if="latest" :type="tagType()" size="small">{{ label() }}</el-tag>
    <span v-else style="color: #909399">未填报</span>
  </template>
</template>
