<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Folder, Document, Warning, Connection } from '@element-plus/icons-vue'
// eslint-disable-next-line no-restricted-syntax -- Backend-aligned types use strategic_task terminology
import type { StrategicTask, StrategicIndicator } from '@/shared/types'
import { useStrategicStore } from '@/stores/strategic'

// 节点统计接口
interface NodeStats {
  total: number // 总指标数
  normal: number // 正常（进度等于预期）
  warning: number // 预警（进度低于预期）
  ahead: number // 超前（进度超过预期）
}

// 指标分类类型
type IndicatorCategory = 'normal' | 'warning' | 'ahead'

/**
 * 里程碑机制已移除：不再有里程碑预期进度。
 */
const getExpectedProgress = (_indicator: StrategicIndicator): number => {
  return 0
}

/**
 * 将指标分类为超前、正常或预警
 */
const categorizeIndicator = (indicator: StrategicIndicator): IndicatorCategory => {
  const expectedProgress = getExpectedProgress(indicator)
  const currentProgress = indicator.progress

  if (currentProgress > expectedProgress) {
    return 'ahead'
  } else if (currentProgress === expectedProgress) {
    return 'normal'
  } else {
    return 'warning'
  }
}

/**
 * 计算指标列表的统计数据
 */
const calculateIndicatorStats = (indicators: StrategicIndicator[]): NodeStats => {
  const stats: NodeStats = {
    total: indicators.length,
    normal: 0,
    warning: 0,
    ahead: 0
  }

  indicators.forEach(indicator => {
    const category = categorizeIndicator(indicator)
    stats[category]++
  })

  return stats
}

/* eslint-disable no-restricted-syntax -- Backend-aligned types in props */
const props = defineProps<{
  tasks?: StrategicTask[]
  indicators?: StrategicIndicator[]
  highlightIndicatorId?: string
}>()
/* eslint-enable no-restricted-syntax */

const emit = defineEmits<{
  'select-indicator': [id: string]
  'select-task': [id: string]
}>()

const strategicStore = useStrategicStore()

const selectedKey = ref<string>('')
const highlightedPath = ref<string[]>([])

// 监听高亮指标变化，计算路径
watch(
  () => props.highlightIndicatorId,
  newId => {
    if (newId) {
      highlightedPath.value = calculatePath(newId)
    } else {
      highlightedPath.value = []
    }
  },
  { immediate: true }
)

// 计算指标到根节点的路径
const calculatePath = (indicatorId: string): string[] => {
  const path: string[] = [`indicator_${indicatorId}`]

  // 查找指标所属的部门和任务
  const indicator = (props.indicators || strategicStore.indicators).find(i => i.id === indicatorId)
  if (!indicator) {
    return path
  }

  const dept = indicator.responsibleDept || '未分配'
  const tasks = props.tasks || strategicStore.tasks

  tasks.forEach(task => {
    path.unshift(`dept_${task.id}_${dept}`)
    path.unshift(`task_${task.id}`)
  })

  return path
}

// 构建树形数据
const treeData = computed(() => {
  const tasks = props.tasks || strategicStore.tasks
  const indicators = props.indicators || strategicStore.indicators

  // 按责任部门分组指标
  const deptMap = new Map<string, StrategicIndicator[]>()
  indicators.forEach(ind => {
    const dept = ind.responsibleDept || '未分配'
    if (!deptMap.has(dept)) {
      deptMap.set(dept, [])
    }
    deptMap.get(dept)!.push(ind)
  })

  // 构建树形结构
  return tasks.map(task => {
    // 构建部门节点，包含统计数据
    const departmentNodes = Array.from(deptMap.entries()).map(([dept, inds]) => ({
      id: `dept_${task.id}_${dept}`,
      label: dept,
      type: 'department' as const,
      status: getAggregatedStatus(inds),
      progress: getAggregatedProgress(inds),
      stats: calculateIndicatorStats(inds),
      children: inds.map(ind => ({
        id: `indicator_${ind.id}`,
        label: ind.name,
        type: 'indicator' as const,
        status: getIndicatorStatus(ind),
        progress: ind.progress,
        data: ind
      }))
    }))

    // 计算任务级别的统计数据（汇总所有部门）
    const taskStats = departmentNodes.reduce(
      (acc, dept) => {
        if (dept.stats) {
          acc.total += dept.stats.total
          acc.normal += dept.stats.normal
          acc.warning += dept.stats.warning
          acc.ahead += dept.stats.ahead
        }
        return acc
      },
      { total: 0, normal: 0, warning: 0, ahead: 0 } as NodeStats
    )

    return {
      id: `task_${task.id}`,
      label: task.title,
      type: 'task' as const,
      status: getTaskAggregatedStatus(task, indicators),
      progress: getTaskAggregatedProgress(task, indicators),
      stats: taskStats,
      children: departmentNodes
    }
  })
})

// 获取任务聚合状态
// eslint-disable-next-line no-restricted-syntax -- Backend-aligned types in function parameters
const getTaskAggregatedStatus = (task: StrategicTask, indicators: StrategicIndicator[]) => {
  if (indicators.length === 0) {
    return 'info'
  }
  const avgProgress = indicators.reduce((sum, i) => sum + i.progress, 0) / indicators.length
  if (avgProgress >= 80) {
    return 'success'
  }
  if (avgProgress >= 50) {
    return 'warning'
  }
  return 'danger'
}

// 获取任务聚合进度
// eslint-disable-next-line no-restricted-syntax -- Backend-aligned types in function parameters
const getTaskAggregatedProgress = (task: StrategicTask, indicators: StrategicIndicator[]) => {
  if (indicators.length === 0) {
    return 0
  }
  return Math.round(indicators.reduce((sum, i) => sum + i.progress, 0) / indicators.length)
}

// 获取指标状态
const getIndicatorStatus = (indicator: StrategicIndicator) => {
  if (indicator.progress >= 80) {
    return 'success'
  }
  if (indicator.progress >= 50) {
    return 'warning'
  }
  return 'danger'
}

// 获取聚合状态
const getAggregatedStatus = (indicators: StrategicIndicator[]) => {
  if (indicators.length === 0) {
    return 'info'
  }
  const avgProgress = indicators.reduce((sum, i) => sum + i.progress, 0) / indicators.length
  if (avgProgress >= 80) {
    return 'success'
  }
  if (avgProgress >= 50) {
    return 'warning'
  }
  return 'danger'
}

// 获取聚合进度
const getAggregatedProgress = (indicators: StrategicIndicator[]) => {
  if (indicators.length === 0) {
    return 0
  }
  return Math.round(indicators.reduce((sum, i) => sum + i.progress, 0) / indicators.length)
}

// 检查节点是否在高亮路径上
const isInHighlightPath = (nodeId: string) => {
  return highlightedPath.value.includes(nodeId)
}

// 获取节点图标
const getNodeIcon = (type: string) => {
  switch (type) {
    case 'task':
      return Folder
    case 'department':
      return Folder
    case 'indicator':
      return Document
    default:
      return Document
  }
}

// 获取状态颜色
const getStatusColor = (status: string) => {
  switch (status) {
    case 'success':
      return '#67C23A'
    case 'warning':
      return '#E6A23C'
    case 'danger':
      return '#F56C6C'
    default:
      return '#909399'
  }
}

// 处理节点点击
const handleNodeClick = (data: Record<string, unknown>) => {
  selectedKey.value = data.id

  if (data.type === 'indicator') {
    const indicatorId = data.id.replace('indicator_', '')
    emit('select-indicator', indicatorId)
  } else if (data.type === 'task') {
    const taskId = data.id.replace('task_', '')
    emit('select-task', taskId)
  }
}

// 默认展开的节点
const defaultExpandedKeys = computed(() => treeData.value.map(t => t.id))
</script>

<template>
  <div class="task-indicator-tree">
    <el-tree
      :data="treeData"
      :props="{ children: 'children', label: 'label' }"
      node-key="id"
      :default-expanded-keys="defaultExpandedKeys"
      :highlight-current="true"
      @node-click="handleNodeClick"
    >
      <template #default="{ node, data }">
        <div
          class="tree-node"
          :class="{
            'is-selected': selectedKey === data.id,
            'is-highlighted': isInHighlightPath(data.id)
          }"
        >
          <el-icon class="node-icon" :style="{ color: getStatusColor(data.status) }">
            <component :is="getNodeIcon(data.type)" />
          </el-icon>

          <!-- 任务/部门节点带统计 tooltip -->
          <el-tooltip
            v-if="(data.type === 'task' || data.type === 'department') && data.stats"
            placement="top"
            effect="light"
            :show-after="300"
          >
            <template #content>
              <div class="stats-tooltip">
                <div class="stats-row">
                  <span class="stats-label">总计:</span>
                  <span class="stats-value">{{ data.stats.total }}项</span>
                </div>
                <div class="stats-row normal">
                  <span class="stats-label">正常:</span>
                  <span class="stats-value">{{ data.stats.normal }}项</span>
                </div>
                <div class="stats-row warning">
                  <span class="stats-label">预警:</span>
                  <span class="stats-value">{{ data.stats.warning }}项</span>
                </div>
                <div class="stats-row ahead">
                  <span class="stats-label">超前:</span>
                  <span class="stats-value">{{ data.stats.ahead }}项</span>
                </div>
              </div>
            </template>
            <span class="node-label">{{ node.label }}</span>
          </el-tooltip>

          <!-- 指标节点无 tooltip -->
          <span v-else class="node-label">{{ node.label }}</span>

          <!-- 父级节点聚合进度 -->
          <template v-if="data.type === 'task' || data.type === 'department'">
            <el-progress
              :percentage="data.progress"
              :stroke-width="4"
              :show-text="false"
              class="node-progress"
              :status="
                data.status === 'success' ? 'success' : data.status === 'danger' ? 'exception' : ''
              "
            />
            <span class="node-percentage aggregated">{{ data.progress }}%</span>
          </template>

          <!-- 指标进度 -->
          <template v-if="data.type === 'indicator'">
            <el-progress
              :percentage="data.progress"
              :stroke-width="4"
              :show-text="false"
              class="node-progress"
              :status="
                data.status === 'success' ? 'success' : data.status === 'danger' ? 'exception' : ''
              "
            />
            <span class="node-percentage">{{ data.progress }}%</span>
          </template>

          <!-- 状态标识 -->
          <el-tag
            v-if="data.status === 'danger' && data.type !== 'indicator'"
            type="danger"
            size="small"
            effect="light"
            class="status-tag"
          >
            <el-icon><Warning /></el-icon>
          </el-tag>

          <!-- 路径高亮指示器 -->
          <el-icon v-if="isInHighlightPath(data.id)" class="path-indicator">
            <Connection />
          </el-icon>
        </div>
      </template>
    </el-tree>

    <el-empty v-if="treeData.length === 0" description="暂无任务数据" :image-size="80" />
  </div>
</template>

<style scoped>
.task-indicator-tree {
  padding: 8px 0;
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  flex: 1;
  transition: background 0.2s;
}

.tree-node:hover {
  background: var(--bg-hover);
}

.tree-node.is-selected {
  background: var(--color-primary-light);
}

.tree-node.is-highlighted {
  background: linear-gradient(90deg, rgba(64, 158, 255, 0.15) 0%, rgba(64, 158, 255, 0.05) 100%);
  border-left: 3px solid var(--color-primary);
  padding-left: 5px;
}

.tree-node.is-highlighted .node-label {
  color: var(--color-primary);
  font-weight: 500;
}

.node-icon {
  font-size: 16px;
}

.node-label {
  flex: 1;
  font-size: 14px;
  color: var(--text-main);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-progress {
  width: 60px;
}

.node-percentage {
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 36px;
  text-align: right;
}

.status-tag {
  padding: 0 4px;
}

.node-percentage.aggregated {
  color: var(--text-regular);
  font-weight: 500;
}

.path-indicator {
  color: var(--color-primary);
  font-size: 14px;
  margin-left: 4px;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

:deep(.el-tree-node__content) {
  height: auto;
  padding: 4px 0;
}

:deep(.el-tree-node__expand-icon) {
  padding: 4px;
}

/* 统计 tooltip 样式 */
.stats-tooltip {
  padding: 4px 0;
  font-size: 13px;
  line-height: 1.6;
  min-width: 100px;
}

.stats-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 2px 0;
}

.stats-label {
  color: var(--text-regular, #606266);
}

.stats-value {
  font-weight: 500;
  color: var(--text-main, #303133);
}

.stats-row.normal .stats-value {
  color: var(--color-success, #67c23a);
}

.stats-row.warning .stats-value {
  color: var(--color-warning, #e6a23c);
}

.stats-row.ahead .stats-value {
  color: var(--color-primary, #409eff);
}
</style>
