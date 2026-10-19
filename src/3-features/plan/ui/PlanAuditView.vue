<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  ElCard,
  ElButton,
  ElIcon as _ElIcon,
  ElEmpty,
  ElSkeleton,
  ElTag,
  ElProgress
} from 'element-plus'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Check, Close } from '@element-plus/icons-vue'
import type { PlanFill } from '@/shared/types'
import { usePlanStore } from '@/features/plan/model/store'
import { logger } from '@/shared/lib/utils/logger'
import { getWorkflowInstanceDetail } from '@/features/workflow/api'

/**
 * Plan 审核页面
 *
 * 功能：
 * - 显示待审核的 Plan 详情
 * - 支持通过/驳回操作
 * - 查看历史记录
 */

const router = useRouter()
const route = useRoute()
const planStore = usePlanStore()

// 状态
const loading = ref(true)
const planFill = ref<PlanFill | null>(null)
const auditComment = ref('')
const submitting = ref(false)

// 获取提交记录 ID
const fillId = computed(() => route.params.fillId as string)

// 计算属性
const getStatusConfig = (status?: string) => {
  const configs: Record<string, { label: string; type: string }> = {
    submitted: { label: '待审核', type: 'warning' },
    approved: { label: '已通过', type: 'success' },
    rejected: { label: '已回退', type: 'danger' }
  }
  return configs[status || ''] || { label: status || '', type: 'info' }
}

// 操作方法
const handleBack = () => {
  router.push({ name: 'pending-audit' })
}

const handleApprove = async () => {
  if (!fillId.value) {
    return
  }

  submitting.value = true
  try {
    await planStore.auditPlanFill(fillId.value, {
      action: 'approve',
      comment: auditComment.value
    })
    router.push({ name: 'pending-audit' })
  } catch (error) {
    // Error handled in store
  } finally {
    submitting.value = false
  }
}

const handleReject = async () => {
  if (!fillId.value) {
    return
  }

  if (!auditComment.value.trim()) {
    ElMessage.warning('请输入驳回原因')
    return
  }

  submitting.value = true
  try {
    await planStore.auditPlanFill(fillId.value, {
      action: 'reject',
      comment: auditComment.value
    })
    router.push({ name: 'pending-audit' })
  } catch (error) {
    // Error handled in store
  } finally {
    submitting.value = false
  }
}

// 加载提交记录详情
const loadPlanFill = async () => {
  loading.value = true
  try {
    const response = await getWorkflowInstanceDetail(String(fillId.value))
    if (response.success && response.data) {
      const detail = response.data as unknown as {
        instanceId: string
        status: string
        starterId?: number
        starterName?: string
        startTime?: string
      }
      planFill.value = {
        id: detail.instanceId,
        plan_id: '',
        submit_date: detail.startTime || '',
        status:
          detail.status === 'APPROVED'
            ? 'approved'
            : detail.status === 'REJECTED'
              ? 'rejected'
              : 'submitted',
        submitted_by: String(detail.starterId || ''),
        submitted_by_name: detail.starterName || 'Unknown',
        fills: [],
        audit_logs: [],
        created_at: detail.startTime || '',
        updated_at: '',
        total_indicators: 0,
        completed_indicators: 0
      }
    } else {
      planFill.value = null
    }
  } catch (error) {
    logger.error('Failed to load plan fill:', error)
    ElMessage.error('加载审核详情失败')
    planFill.value = null
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadPlanFill()
})
</script>

<template>
  <div class="plan-audit-view">
    <!-- 头部 -->
    <div class="page-header">
      <div class="header-left">
        <el-button :icon="ArrowLeft" circle @click="handleBack" />
        <h1 class="page-title">计划审核</h1>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="loading-container">
      <el-skeleton :rows="5" animated />
    </div>

    <!-- 空状态 -->
    <div v-else-if="!planFill" class="empty-container">
      <el-empty description="提交记录不存在">
        <el-button type="primary" @click="handleBack">返回</el-button>
      </el-empty>
    </div>

    <!-- 内容区域 -->
    <div v-else class="content-area">
      <!-- 提交信息卡片 -->
      <el-card class="info-card" shadow="never">
        <template #header>
          <div class="card-header">
            <h3 class="card-title">提交信息</h3>
            <el-tag :type="getStatusConfig(planFill.status).type as any">
              {{ getStatusConfig(planFill.status).label }}
            </el-tag>
          </div>
        </template>

        <div class="submit-info">
          <div class="info-row">
            <span class="label">提交人：</span>
            <span class="value">{{ planFill.submitted_by_name }}</span>
          </div>
          <div class="info-row">
            <span class="label">提交时间：</span>
            <span class="value">{{ planFill.submit_date }}</span>
          </div>
          <div class="info-row">
            <span class="label">完成进度：</span>
            <div class="progress-value">
              <el-progress
                :percentage="
                  planFill.total_indicators > 0
                    ? Math.round((planFill.completed_indicators / planFill.total_indicators) * 100)
                    : 0
                "
                :stroke-width="8"
              />
              <span class="progress-text">
                {{ planFill.completed_indicators }}/{{ planFill.total_indicators }}
              </span>
            </div>
          </div>
        </div>
      </el-card>

      <!-- 指标填报列表 -->
      <el-card class="fills-card" shadow="never">
        <template #header>
          <h3 class="card-title">指标填报明细</h3>
        </template>

        <div v-if="!planFill.fills || planFill.fills.length === 0" class="empty-fills">
          <el-empty description="暂无填报数据" />
        </div>

        <div v-else class="fills-list">
          <div v-for="fill in planFill.fills" :key="fill.id" class="fill-item">
            <div class="fill-header">
              <span class="fill-indicator">指标 ID: {{ fill.indicator_id }}</span>
              <el-tag size="small" type="info">{{ fill.progress }}%</el-tag>
            </div>
            <div class="fill-content">{{ fill.content }}</div>
            <div class="fill-meta">
              <span>填报时间: {{ fill.fill_date }}</span>
              <span>填报人: {{ fill.filled_by_name }}</span>
            </div>
          </div>
        </div>
      </el-card>

      <!-- 审核操作卡片 -->
      <el-card v-if="planFill.status === 'submitted'" class="audit-card" shadow="never">
        <template #header>
          <h3 class="card-title">审核操作</h3>
        </template>

        <div class="audit-form">
          <label class="form-label">审核意见</label>
          <textarea
            v-model="auditComment"
            class="comment-input"
            placeholder="请输入审核意见（驳回时必填）"
            rows="4"
          />

          <div class="audit-actions">
            <el-button type="success" :icon="Check" :loading="submitting" @click="handleApprove">
              审核通过
            </el-button>
            <el-button type="danger" :icon="Close" :loading="submitting" @click="handleReject">
              驳回
            </el-button>
          </div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.plan-audit-view {
  padding: 20px;
  max-width: 900px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}

.page-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.loading-container {
  padding: 40px;
}

.empty-container {
  padding: 60px 20px;
}

.content-area {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.info-card,
.fills-card,
.audit-card {
  width: 100%;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.submit-info {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.label {
  font-weight: 500;
  color: var(--el-text-color-secondary);
  min-width: 80px;
}

.value {
  color: var(--el-text-color-primary);
}

.progress-value {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress-text {
  font-size: 14px;
  color: var(--el-text-color-secondary);
  min-width: 50px;
}

.empty-fills {
  padding: 40px 20px;
}

.fills-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.fill-item {
  padding: 16px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
}

.fill-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.fill-indicator {
  font-weight: 500;
}

.fill-content {
  margin-bottom: 8px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.fill-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.audit-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-label {
  font-weight: 500;
  color: var(--el-text-color-regular);
}

.comment-input {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  font-family: inherit;
  font-size: 14px;
  resize: vertical;
}

.comment-input:focus {
  outline: none;
  border-color: var(--el-color-primary);
}

.audit-actions {
  display: flex;
  gap: 12px;
}
</style>
