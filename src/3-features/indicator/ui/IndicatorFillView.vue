<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElButton, ElIcon as _ElIcon, ElCard, ElMessage } from 'element-plus'
import { ArrowLeft } from '@element-plus/icons-vue'
import type { Indicator } from '@/shared/types'
import { usePlanStore } from '@/features/plan/model/store'
import IndicatorFillForm from '@/features/plan/ui/IndicatorFillForm.vue'
import IndicatorFillHistory from '@/features/plan/ui/IndicatorFillHistory.vue'
import { indicatorApi } from '@/features/indicator/api'
import { logger } from '@/shared/lib/utils/logger'

/**
 * 指标填报页面
 *
 * 功能：
 * - 显示指标填报表单
 * - 显示填报历史记录
 * - 支持保存草稿和提交审核
 * ✅ FIXED: 现在使用真实 API 加载指标详情
 */

const router = useRouter()
const route = useRoute()
const _planStore = usePlanStore()

// 状态
const loading = ref(true)
const indicator = ref<Indicator | null>(null)
const currentFill = ref(null)
const showHistory = ref(false)

// 获取指标 ID
const indicatorId = computed(() => route.params.indicatorId as string)

// 操作方法
const handleBack = () => {
  router.back()
}

const handleSaved = (fill: unknown) => {
  currentFill.value = fill
  // 刷新历史记录
}

const handleSubmitted = (fill: unknown) => {
  currentFill.value = fill
  // 返回上一页或跳转到详情页
  router.back()
}

const handleCancel = () => {
  router.back()
}

const toggleHistory = () => {
  showHistory.value = !showHistory.value
}

const handleSelectHistory = (fill: unknown) => {
  currentFill.value = fill
  showHistory.value = false
}

const mapIndicatorDetailToFillIndicator = (payload: Record<string, any>): Indicator => {
  const rawId = payload.indicatorId ?? payload.id
  const rawName = payload.indicatorName ?? payload.name ?? payload.indicatorDesc ?? '未命名指标'
  const rawDefinition = payload.indicatorDesc ?? payload.definition ?? rawName

  return {
    id: String(rawId),
    task_id: payload.taskId ?? payload.task_id ?? '',
    name: rawName,
    definition: rawDefinition,
    latest_progress: Number.isFinite(rawProgress) ? rawProgress : 0,
    latest_fill_date: payload.updatedAt ?? payload.latestFillDate ?? '',
    createdAt: payload.createdAt ?? '',
    updatedAt: payload.updatedAt ?? ''
  } as Indicator
}

// 加载指标详情 - ✅ FIXED: 使用真实 API 调用
const loadIndicator = async () => {
  loading.value = true
  try {
    logger.info(`[IndicatorFillView] Loading indicator ${indicatorId.value} from API...`)

    const response = await indicatorApi.getIndicatorById(indicatorId.value)

    if (response.success && response.data) {
      indicator.value = mapIndicatorDetailToFillIndicator(response.data as Record<string, any>)
      logger.info(`[IndicatorFillView] Indicator loaded successfully`)
    } else {
      throw new Error(response.message || 'Failed to load indicator')
    }
  } catch (error) {
    logger.error('[IndicatorFillView] Failed to load indicator:', error)
    ElMessage.error('加载指标详情失败')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadIndicator()
})
</script>
<template>
  <div class="indicator-fill-view">
    <!-- 头部 -->
    <div class="page-header">
      <div class="header-left">
        <el-button :icon="ArrowLeft" circle @click="handleBack" />
        <h1 class="page-title">指标填报</h1>
      </div>
      <div class="header-actions">
        <el-button @click="toggleHistory"> {{ showHistory ? '隐藏' : '显示' }}历史记录 </el-button>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="loading-container">
      <el-skeleton :rows="5" animated />
    </div>

    <!-- 空状态 -->
    <div v-else-if="!indicator" class="empty-container">
      <el-card shadow="never">
        <p>指标不存在</p>
        <el-button type="primary" @click="handleBack">返回</el-button>
      </el-card>
    </div>

    <!-- 内容区域 -->
    <div v-else class="content-area">
      <!-- 填报表单 -->
      <el-card v-if="!showHistory" class="form-card" shadow="never">
        <indicator-fill-form
          :indicator="indicator"
          :fill="currentFill"
          @saved="handleSaved"
          @submitted="handleSubmitted"
          @cancel="handleCancel"
        />
      </el-card>

      <!-- 历史记录 -->
      <el-card v-if="showHistory" class="history-card" shadow="never">
        <template #header>
          <h3 class="card-title">填报历史</h3>
        </template>
        <indicator-fill-history
          :key="indicatorId"
          :indicator-id="indicatorId"
          @select="handleSelectHistory"
          @close="showHistory = false"
        />
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.indicator-fill-view {
  padding: 20px;
  max-width: 900px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.page-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 12px;
}

.loading-container {
  padding: 40px;
}

.empty-container {
  padding: 40px 20px;
  text-align: center;
}

.content-area {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-card,
.history-card {
  width: 100%;
}

.card-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
</style>
