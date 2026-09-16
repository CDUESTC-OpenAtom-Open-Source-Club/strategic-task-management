<script setup lang="ts">
import { ref, computed, watch as _watch } from 'vue'
import { Edit, Promotion, RefreshLeft, Document as _Document } from '@element-plus/icons-vue'
import type { StrategicIndicator, ApprovalHistoryItem, AuditLogItem } from '@/shared/types'
import { useStrategicStore } from '@/features/task/model/strategic'
import { useAuditLogStore } from '@/features/admin/model/auditLog'
import ApprovalHistory from '@/features/approval/ui/ApprovalHistory.vue'

const props = defineProps<{
  indicatorId: string
  visible: boolean
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  edit: [id: string]
  distribute: [id: string]
  withdraw: [id: string]
}>()

const strategicStore = useStrategicStore()
const auditLogStore = useAuditLogStore()

const activeTab = ref('basic')

const indicator = computed<StrategicIndicator | undefined>(() =>
  strategicStore.getIndicatorById(props.indicatorId)
)

// 模拟审批历史数据
const approvalHistory = computed<ApprovalHistoryItem[]>(() => {
  if (!indicator.value) {
    return []
  }
  return [
    {
      id: '1',
      action: 'submit',
      operator: 'user1',
      operatorName: '张老师',
      operateTime: new Date('2025-11-21'),
      comment: '提交指标审批'
    },
    {
      id: '2',
      action: 'approve',
      operator: 'admin',
      operatorName: '李主任',
      operateTime: new Date('2025-11-22'),
      comment: '审批通过，请按计划执行'
    }
  ]
})

// 获取操作日志
const auditLogs = computed<AuditLogItem[]>(() =>
  auditLogStore.logs
    .filter(log => log.entityType === 'indicator' && log.entityId === props.indicatorId)
    .map(log => ({
      id: log.id ?? `${log.entityType}-${log.entityId}-${log.timestamp}`,
      action: log.action,
      operatorName: log.operatorName ?? log.userName ?? '未知用户',
      operateTime: new Date(log.timestamp),
      changes: []
    }))
)

const dialogVisible = computed({
  get: () => props.visible,
  set: val => emit('update:visible', val)
})

const getTypeTagType = (type: string) => {
  return type === '定量' ? 'primary' : 'success'
}

const getType2TagType = (type: string) => {
  return type === '基础型' ? 'info' : 'warning'
}

const getProgressStatus = (progress: number) => {
  if (progress >= 80) {
    return 'success'
  }
  if (progress >= 50) {
    return ''
  }
  return 'exception'
}

const handleEdit = () => {
  emit('edit', props.indicatorId)
}

const handleDistribute = () => {
  emit('distribute', props.indicatorId)
}

const handleWithdraw = () => {
  emit('withdraw', props.indicatorId)
}

const formatDate = (dateStr: string) => {
  return dateStr
}

const formatLogTime = (date: Date) => {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const getActionLabel = (action: string) => {
  const labels: Record<string, string> = {
    create: '创建',
    update: '更新',
    delete: '删除',
    approve: '审批通过',
    reject: '审批驳回',
    withdraw: '撤回',
    submit: '提交'
  }
  return labels[action] || action
}
</script>

<template>
  <el-dialog
    v-model="dialogVisible"
    :title="indicator?.name || '指标详情'"
    width="720px"
    destroy-on-close
  >
    <template v-if="indicator">
      <el-tabs v-model="activeTab" class="detail-tabs">
        <!-- 基本信息 -->
        <el-tab-pane label="基本信息" name="basic">
          <div class="info-section">
            <el-descriptions :column="2" border>
              <el-descriptions-item label="指标名称" :span="2">
                {{ indicator.name }}
              </el-descriptions-item>
              <el-descriptions-item label="指标类型">
                <el-tag :type="getTypeTagType(indicator.type1)" size="small">
                  {{ indicator.type1 }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="指标性质">
                <el-tag :type="getType2TagType(indicator.type2)" size="small">
                  {{ indicator.type2 }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="目标值">
                {{ indicator.targetValue }} {{ indicator.unit }}
              </el-descriptions-item>
              <el-descriptions-item label="权重"> {{ indicator.weight }}% </el-descriptions-item>
              <el-descriptions-item label="责任部门">
                {{ indicator.responsibleDept }}
              </el-descriptions-item>
              <el-descriptions-item label="创建时间" :span="2">
                {{ formatDate(indicator.createTime) }}
              </el-descriptions-item>
              <el-descriptions-item label="备注" :span="2">
                {{ indicator.remark || '无' }}
              </el-descriptions-item>
            </el-descriptions>

            <div class="progress-section">
              <h4>当前进度</h4>
              <el-progress
                :percentage="indicator.progress"
                :status="getProgressStatus(indicator.progress)"
                :stroke-width="16"
                :text-inside="true"
              />
            </div>
          </div>
        </el-tab-pane>

        <!-- 审批历史 -->
        <el-tab-pane label="审批历史" name="approval">
          <ApprovalHistory :history="approvalHistory" />
        </el-tab-pane>

        <!-- 操作日志 -->
        <el-tab-pane label="操作日志" name="logs">
          <div class="logs-section">
            <el-table :data="auditLogs" stripe style="width: 100%">
              <el-table-column prop="operateTime" label="时间" width="160">
                <template #default="{ row }">
                  {{ formatLogTime(row.operateTime) }}
                </template>
              </el-table-column>
              <el-table-column prop="action" label="操作" width="100">
                <template #default="{ row }">
                  <el-tag size="small">{{ getActionLabel(row.action) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="operatorName" label="操作人" width="100" />
              <el-table-column label="变更内容">
                <template #default="{ row }">
                  <div v-if="row.changes && row.changes.length > 0">
                    <div v-for="change in row.changes" :key="change.field" class="change-item">
                      <span class="field-label">{{ change.fieldLabel }}:</span>
                      <span class="old-value">{{ change.oldValue }}</span>
                      <span class="arrow">→</span>
                      <span class="new-value">{{ change.newValue }}</span>
                    </div>
                  </div>
                  <span v-else class="no-changes">-</span>
                </template>
              </el-table-column>
            </el-table>
            <el-empty v-if="auditLogs.length === 0" description="暂无操作日志" :image-size="60" />
          </div>
        </el-tab-pane>
      </el-tabs>
    </template>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="dialogVisible = false">关闭</el-button>
        <el-button type="primary" :icon="Edit" @click="handleEdit">编辑</el-button>
        <el-button type="success" :icon="Promotion" @click="handleDistribute">下发</el-button>
        <el-button
          v-if="indicator?.canWithdraw"
          type="warning"
          :icon="RefreshLeft"
          @click="handleWithdraw"
        >
          撤回
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.detail-tabs {
  min-height: 400px;
}

.info-section {
  padding: 8px 0;
}

.progress-section {
  margin-top: 24px;
}

.progress-section h4 {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-main);
}

.logs-section {
  padding: 8px 0;
}

.change-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  margin-bottom: 4px;
}

.field-label {
  color: var(--text-secondary);
}

.old-value {
  color: var(--color-danger);
  text-decoration: line-through;
}

.arrow {
  color: var(--text-muted);
}

.new-value {
  color: var(--color-success);
}

.no-changes {
  color: var(--text-muted);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
