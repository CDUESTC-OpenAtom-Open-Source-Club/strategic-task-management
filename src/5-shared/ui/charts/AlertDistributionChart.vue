<script setup lang="ts">
import { computed } from 'vue'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { TooltipComponent, LegendComponent, GraphicComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

import { getGradientColor } from '@/shared/lib/utils/colors'

use([PieChart, TooltipComponent, LegendComponent, GraphicComponent, CanvasRenderer])

// 进度等级三档（2026-09-17 定案）：超前完成 / 正常 / 延期
const props = defineProps<{
  ahead: number
  normal: number
  delayed: number
}>()

const emit = defineEmits<{
  click: [level: 'severe' | 'moderate' | 'normal']
}>()

const total = computed(() => props.ahead + props.normal + props.delayed)

const chartOption = computed(() => ({
  tooltip: {
    trigger: 'item',
    formatter: (params: { name: string; value: number; percent: number }) => {
      return `${params.name}<br/>数量: ${params.value}个<br/>占比: ${params.percent}%`
    }
  },
  legend: {
    orient: 'vertical',
    right: 10,
    top: 'center',
    itemWidth: 10,
    itemHeight: 10,
    textStyle: { fontSize: 12 }
  },
  series: [
    {
      name: '进度等级分布',
      type: 'pie',
      radius: ['40%', '65%'],
      center: ['35%', '50%'],
      avoidLabelOverlap: false,
      itemStyle: {
        borderRadius: 8,
        borderColor: '#fff',
        borderWidth: 4,
        shadowBlur: 10,
        shadowColor: 'rgba(0, 0, 0, 0.05)'
      },
      label: { show: false },
      emphasis: {
        scale: true,
        scaleSize: 10,
        itemStyle: {
          shadowBlur: 20,
          shadowOffsetX: 0,
          shadowColor: 'rgba(0, 0, 0, 0.2)',
          borderRadius: 12
        }
      },
      labelLine: { show: false },
      data: [
        {
          value: props.ahead,
          name: '超前完成',
          itemStyle: {
            color: getGradientColor('#67C23A', '#67C23ACC')
          }
        },
        {
          value: props.normal,
          name: '正常',
          itemStyle: {
            color: getGradientColor('#409EFF', '#409EFFCC')
          }
        },
        {
          value: props.delayed,
          name: '延期',
          itemStyle: {
            color: getGradientColor('#F56C6C', '#F56C6CCC')
          }
        }
      ]
    }
  ],
  graphic: {
    type: 'group',
    left: '35%',
    top: '50%',
    bounding: 'raw',
    children: [
      {
        type: 'text',
        left: 'center',
        top: -20,
        style: {
          fill: '#909399',
          text: '总计',
          font: '14px "Microsoft YaHei", sans-serif'
        }
      },
      {
        type: 'text',
        left: 'center',
        top: 5,
        style: {
          fill: '#303133',
          text: total.value,
          font: 'bold 24px "DIN Alternate", "Helvetica Neue", sans-serif'
        }
      }
    ]
  }
}))

const handleChartClick = (params: { name: string }) => {
  // 点击扇区沿用原 alertLevel 筛选通道：延期→severe，超前完成/正常→normal
  const levelMap: Record<string, 'severe' | 'moderate' | 'normal'> = {
    延期: 'severe',
    超前完成: 'normal',
    正常: 'normal'
  }
  const level = levelMap[params.name]
  if (level) {
    emit('click', level)
  }
}
</script>

<template>
  <div class="alert-distribution-chart">
    <v-chart :option="chartOption" autoresize style="height: 200px" @click="handleChartClick" />
  </div>
</template>

<style scoped>
.alert-distribution-chart {
  width: 100%;
  position: relative;
}
</style>
