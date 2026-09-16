<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import {
  ElCard,
  ElButton,
  ElInput,
  ElTag,
  ElIcon,
  ElTimeline as _ElTimeline,
  ElTimelineItem as _ElTimelineItem,
  ElMessage,
  ElMessageBox,
  ElProgress
} from 'element-plus'
import {
  Check,
  Close,
  Clock,
  Document,
  User,
  Calendar,
  Warning as _Warning,
  CircleCheck as _CircleCheck
} from '@element-plus/icons-vue'
import type { PlanFill, PlanFillStatus, IndicatorFill as _IndicatorFill } from '@/shared/types'
import { usePlanStore } from '@/features/plan/model/store'
import { useAuthStore } from '@/features/auth/model/store'
import { logger } from '@/shared/lib/utils/logger'

/**
 * Plan 审核面板组件
 *
 * 功能：
 * - 展示待审核的 PlanFill 列表
 * - 查看填报详情
 * - 通过/驳回审核
 * - 添加审核意见
 */

const props = defineProps<{
  planFillId?: number | string | null
  autoLoad?: boolean
}>()

const emit = defineEmits<{
  (e: 'approved', fill: PlanFill): void
  (e: 'rejected', fill: PlanFill): void
  (e: 'close'): void
}>()

const planStore = usePlanStore()
const _authStore = useAuthStore()

// 状态
const loading = ref(false)
const currentFill = ref<PlanFill | null>(null)
const auditComment = ref('')

// 审核中状态
const approving = ref(false)
const rejecting = ref(false)

// ============ 计算属性 ============

// 获取状态配置
const getStatusConfig = (status: PlanFillStatus) => {
  const configs: Record<PlanFillStatus, { label: string; type: string; icon: unknown }> = {
    submitted: { label: '待审核', type: 'warning', icon: Clock },
    approved: { label: '已通过', type: 'success', icon: Check },
    rejected: { label: '已驳回', type: 'danger', icon: Close }
  }
  return configs[status]
}

// 提交的指标填报列表
const submittedFills = computed(() => {
  return currentFill.value?.fills || []
})

// 计算整体完成进度
const overallProgress = computed(() => {
  if (!currentFill.value || submittedFills.value.length === 0) {
    return 0
  }
  const total = submittedFills.value.reduce((sum, f) => sum + f.progress, 0)
  return Math.round(total / submittedFills.value.length)
})

// 已完成的指标数
const completedCount = computed(() => {
  return submittedFills.value.filter(f => f.progress >= 100).length
})

// ============ 方法 ============

// 加载 PlanFill 详情
const loadPlanFill = async (fillId: number | string) => {
  loading.value = true

  try {
    logger.info(`[PlanAuditPanel] Loading plan fill ${fillId}...`)

    // 从 planFills 中查找
    const fill = planStore.planFills.find(pf => pf.id === fillId)

    if (fill) {
      currentFill.value = fill
    } else {
      // 如果找不到，尝试加载
      await planStore.loadPendingFills()
      const reloadedFill = planStore.planFills.find(pf => pf.id === fillId)
      currentFill.value = reloadedFill || null
    }
  } catch (err) {
    logger.error('[PlanAuditPanel] Failed to load plan fill:', err)
    ElMessage.error('加载失败')
  } finally {
    loading.value = false
  }
}

// 审核通过
const handleApprove = async () => {
  if (!currentFill.value) {
    return
  }

  try {
    await ElMessageBox.confirm('确认通过该提交的审核？', '审核确认', {
      confirmButtonText: '确认通过',
      cancelButtonText: '取消',
      type: 'success'
    })

    approving.value = true

    const result = await planStore.auditPlanFill(currentFill.value.id, {
      fill_id: currentFill.value.id,
      action: 'approve',
      comment: auditComment.value
    })

    if (result) {
      ElMessage.success('审核通过')
      emit('approved', result)
    }
  } catch {
    // 用户取消或错误
  } finally {
    approving.value = false
  }
}

// 驳回
const handleReject = async () => {
  if (!currentFill.value) {
    return
  }

  if (!auditComment.value.trim()) {
    ElMessage.warning('请填写驳回原因')
    return
  }

  try {
    await ElMessageBox.confirm('确认驳回该提交？', '驳回确认', {
      confirmButtonText: '确认驳回',
      cancelButtonText: '取消',
      type: 'warning'
    })

    rejecting.value = true

    const result = await planStore.auditPlanFill(currentFill.value.id, {
      fill_id: currentFill.value.id,
      action: 'reject',
      comment: auditComment.value
    })

    if (result) {
      ElMessage.success('已驳回')
      emit('rejected', result)
    }
  } catch {
    // 用户取消或错误
  } finally {
    rejecting.value = false
  }
}

// 格式化日期
const formatDate = (dateStr: string) => {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 格式化时间
const formatDateTime = (dateStr: string) => {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ============ 监听 props 变化 ============
watch(
  () => props.planFillId,
  newId => {
    if (newId) {
      loadPlanFill(newId)
    }
  },
  { immediate: true }
)

// ============ 生命周期 ============
onMounted(() => {
  if (props.autoLoad && props.planFillId) {
    loadPlanFill(props.planFillId)
  }
})

// 暴露方法给父组件
defineExpose({
  loadPlanFill,
  refresh: () => currentFill.value && loadPlanFill(currentFill.value.id)
})
</script>

<template>
  <div class="plan-audit-panel">
    <!-- 加载状态 -->
    <div v-if="loading" class="loading-container">
      <el-skeleton :rows="5" animated />
    </div>

    <!-- 空状态 -->
    <div v-else-if="!currentFill" class="empty-state">
      <el-empty description="未选择审核项" :image-size="80" />
    </div>

    <!-- 审核内容 -->
    <div v-else class="audit-content">
      <!-- 头部信息 -->
      <ElCard class="header-card" shadow="never">
        <div class="fill-header">
          <div class="header-left">
            <h3 class="fill-title">计划提交审核</h3>
            <div class="fill-meta">
              <span class="meta-item">
                <el-icon><User /></el-icon>
                提交人: {{ currentFill.submitted_by_name }}
              </span>
              <span class="meta-item">
                <el-icon><Calendar /></el-icon>
                提交时间: {{ formatDateTime(currentFill.submit_date) }}
              </span>
            </div>
          </div>
          <div class="header-right">
            <ElTag
              :type="getStatusConfig(currentFill.status).type as any"
              size="large"
              effect="light"
            >
              <el-icon class="tag-icon">
                <component :is="getStatusConfig(currentFill.status).icon" />
              </el-icon>
              {{ getStatusConfig(currentFill.status).label }}
            </ElTag>
          </div>
        </div>

        <!-- 进度概览 -->
        <div class="progress-overview">
          <div class="progress-item">
            <span class="progress-label">整体进度</span>
            <div class="progress-bar">
              <ElProgress :percentage="overallProgress" :stroke-width="12" />
            </div>
          </div>
          <div class="progress-stats">
            <span class="stat-item">
              <span class="stat-value">{{ submittedFills.length }}</span>
              <span class="stat-label">指标数</span>
            </span>
            <span class="stat-item">
              <span class="stat-value">{{ completedCount }}</span>
              <span class="stat-label">已完成</span>
            </span>
          </div>
        </div>
      </ElCard>

      <!-- 指标填报列表 -->
      <ElCard class="fills-card" shadow="never">
        <template #header>
          <div class="card-header">
            <span class="card-title">指标填报详情</span>
            <ElTag size="small" type="info">{{ submittedFills.length }} 项指标</ElTag>
          </div>
        </template>

        <div class="fills-list">
          <div v-for="fill in submittedFills" :key="fill.id" class="fill-item">
            <div class="fill-item-header">
              <div class="fill-indicator">
                <el-icon><Document /></el-icon>
                <span class="indicator-name">指标 #{{ fill.indicator_id }}</span>
              </div>
              <div class="fill-progress">
                <span class="progress-value">{{ fill.progress }}%</span>
              </div>
            </div>

            <div v-if="fill.content" class="fill-item-content">
              <p class="content-text">{{ fill.content }}</p>
            </div>

            <!-- 附件 -->
            <div v-if="fill.attachments && fill.attachments.length > 0" class="fill-attachments">
              <span class="attachments-label">附件: </span>
              <span class="attachments-count">{{ fill.attachments.length }} 个文件</span>
            </div>

            <div class="fill-item-footer">
              <span class="fill-author">{{ fill.filled_by_name }}</span>
              <span class="fill-date">{{ formatDate(fill.fill_date) }}</span>
            </div>
          </div>
        </div>
      </ElCard>

      <!-- 审核操作 -->
      <ElCard class="audit-card" shadow="never">
        <div class="audit-form">
          <div class="form-label">
            <el-icon><Document /></el-icon>
            审核意见
          </div>
          <ElInput
            v-model="auditComment"
            type="textarea"
            :rows="3"
            placeholder="请输入审核意见（驳回时必填）"
            maxlength="500"
            show-word-limit
          />
          <div class="audit-actions">
            <ElButton type="success" :icon="Check" :loading="approving" @click="handleApprove">
              审核通过
            </ElButton>
            <ElButton type="danger" :icon="Close" :loading="rejecting" @click="handleReject">
              驳回
            </ElButton>
          </div>
        </div>
      </ElCard>
    </div>
  </div>
</template>

<style scoped>
.plan-audit-panel {
  min-height: 400px;
}

.loading-container {
  padding: 20px;
}

.empty-state {
  padding: 60px 20px;
  text-align: center;
}

.audit-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.header-card {
  margin-bottom: 0;
}

.fill-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.header-left {
  flex: 1;
}

.fill-title {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.fill-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.header-right {
  flex-shrink: 0;
}

.tag-icon {
  margin-right: 4px;
}

.progress-overview {
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-light);
}

.progress-item {
  margin-bottom: 16px;
}

.progress-label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.progress-bar {
  max-width: 400px;
}

.progress-stats {
  display: flex;
  gap: 32px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: var(--el-color-primary);
}

.stat-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.fills-card {
  margin-bottom: 0;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.fills-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.fill-item {
  padding: 12px 16px;
  background: var(--el-fill-color-light);
  border-radius: 8px;
  border-left: 3px solid var(--el-color-primary);
}

.fill-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.fill-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
}

.indicator-name {
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.fill-progress {
  text-align: right;
}

.progress-value {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-color-primary);
}

.fill-item-content {
  margin-bottom: 8px;
  padding: 8px 12px;
  background: var(--el-bg-color);
  border-radius: 6px;
}

.content-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
}

.fill-attachments {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.attachments-count {
  font-weight: 500;
}

.fill-item-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.audit-card {
  margin-bottom: 0;
}

.audit-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  color: var(--el-text-color-regular);
}

.audit-actions {
  display: flex;
  gap: 12px;
  padding-top: 8px;
}
</style>
