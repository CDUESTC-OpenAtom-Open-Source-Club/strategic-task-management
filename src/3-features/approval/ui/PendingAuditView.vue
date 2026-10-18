<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElCard, ElTable, ElTableColumn, ElTag, ElButton, ElEmpty, ElInput } from 'element-plus'
import { View, Search, Refresh } from '@element-plus/icons-vue'
import type { PlanFill } from '@/shared/types'
import { usePlanStore } from '@/features/plan/model/store'

/**
 * 待审核列表视图
 *
 * 功能：
 * - 显示所有待审核的 Plan 提交记录
 * - 支持搜索和筛选
 * - 点击进入审核详情页
 */

const router = useRouter()
const planStore = usePlanStore()

// 状态
const loading = ref(false)
const searchKeyword = ref('')

// 计算属性
const pendingFills = computed(() => {
  return planStore.visiblePendingFills
})

const filteredFills = computed(() => {
  let result = pendingFills.value

  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase()
    result = result.filter(
      fill =>
        fill.submitted_by_name.toLowerCase().includes(keyword) ||
        fill.plan_id.toString().includes(keyword)
    )
  }

  return result
})

// 获取状态配置
const getStatusConfig = (status?: string) => {
  const configs: Record<string, { label: string; type: string }> = {
    submitted: { label: '待审核', type: 'warning' },
    approved: { label: '已通过', type: 'success' },
    rejected: { label: '已回退', type: 'danger' }
  }
  return configs[status || ''] || { label: status || '', type: 'info' }
}

// 操作方法
const handleRefresh = async () => {
  await planStore.loadPendingFills()
}

const handleView = (fill: PlanFill) => {
  router.push({
    name: 'plan-audit',
    params: { fillId: fill.id }
  })
}

// 初始化
onMounted(() => {
  handleRefresh()
})
</script>

<template>
  <div class="pending-audit-view">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">待审核列表</h1>
        <p class="page-subtitle">查看并处理待审核的计划提交</p>
      </div>
      <div class="header-actions">
        <el-button :icon="Refresh" @click="handleRefresh">刷新</el-button>
      </div>
    </div>

    <!-- 搜索栏 -->
    <div class="search-bar">
      <el-input
        v-model="searchKeyword"
        placeholder="搜索提交人或计划ID..."
        :prefix-icon="Search"
        clearable
        class="search-input"
      />
    </div>

    <!-- 统计卡片 -->
    <div class="stats-row">
      <el-card class="stat-card" shadow="hover">
        <div class="stat-content">
          <div class="stat-value">{{ pendingFills.length }}</div>
          <div class="stat-label">待审核</div>
        </div>
      </el-card>
    </div>

    <!-- 表格 -->
    <el-card class="table-card" shadow="never">
      <el-table v-loading="loading" :data="filteredFills" stripe class="audit-table">
        <el-table-column prop="plan_id" label="计划ID" width="100" />

        <el-table-column prop="submitted_by_name" label="提交人" width="150">
          <template #default="{ row }">
            <span>{{ row.submitted_by_name }}</span>
          </template>
        </el-table-column>

        <el-table-column prop="submit_date" label="提交时间" width="120">
          <template #default="{ row }">
            <span>{{ row.submit_date }}</span>
          </template>
        </el-table-column>

        <el-table-column label="完成进度" width="180">
          <template #default="{ row }">
            <div class="progress-cell">
              <el-progress
                :percentage="
                  row.total_indicators > 0
                    ? Math.round((row.completed_indicators / row.total_indicators) * 100)
                    : 0
                "
                :stroke-width="8"
                :show-text="false"
              />
              <span class="progress-text">
                {{ row.completed_indicators }}/{{ row.total_indicators }}
              </span>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="getStatusConfig(row.status).type as any" effect="light">
              {{ getStatusConfig(row.status).label }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link :icon="View" @click="handleView(row)"> 审核 </el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 空状态 -->
      <div v-if="!loading && filteredFills.length === 0" class="empty-state">
        <el-empty :description="searchKeyword ? '没有找到匹配的记录' : '暂无待审核记录'">
          <el-button v-if="!searchKeyword" type="primary" :icon="Refresh" @click="handleRefresh">
            刷新
          </el-button>
        </el-empty>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.pending-audit-view {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
}

.header-left {
  flex: 1;
}

.page-title {
  margin: 0 0 8px;
  font-size: 24px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.page-subtitle {
  margin: 0;
  font-size: 14px;
  color: var(--el-text-color-secondary);
}

.header-actions {
  display: flex;
  gap: 12px;
}

.search-bar {
  margin-bottom: 20px;
}

.search-input {
  width: 300px;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}

.stat-card {
  --el-card-padding: 20px;
}

.stat-content {
  text-align: center;
}

.stat-value {
  font-size: 32px;
  font-weight: 600;
  color: var(--el-color-warning);
  margin-bottom: 8px;
}

.stat-label {
  font-size: 14px;
  color: var(--el-text-color-secondary);
}

.table-card {
  margin-bottom: 20px;
}

.audit-table {
  width: 100%;
}

.progress-cell {
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress-text {
  min-width: 50px;
  text-align: right;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.empty-state {
  padding: 40px 20px;
}
</style>
