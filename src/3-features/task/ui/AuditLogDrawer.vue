<template>
  <el-drawer
    v-model="visible"
    title="审计日志"
    direction="rtl"
    size="700px"
    :before-close="handleClose"
  >
    <div class="drawer-content">
      <!-- 筛选条件 -->
      <div class="filter-section">
        <el-form :inline="true" :model="queryParams" class="filter-form">
          <el-form-item label="操作类型">
            <el-select
              v-model="queryParams.action"
              placeholder="全部"
              clearable
              style="width: 150px"
              @change="handleQuery"
            >
              <el-option label="全部" value="" />
              <el-option label="创建" value="CREATE" />
              <el-option label="更新" value="UPDATE" />
              <el-option label="删除" value="DELETE" />
              <el-option label="审批" value="APPROVE" />
              <el-option label="驳回" value="REJECT" />
            </el-select>
          </el-form-item>

          <el-form-item label="状态">
            <el-select
              v-model="queryParams.status"
              placeholder="全部"
              clearable
              style="width: 120px"
              @change="handleQuery"
            >
              <el-option label="全部" value="" />
              <el-option label="成功" value="SUCCESS" />
              <el-option label="失败" value="FAILURE" />
            </el-select>
          </el-form-item>

          <el-form-item>
            <el-button type="primary" :loading="loading" @click="handleQuery"> 查询 </el-button>
          </el-form-item>

          <el-form-item>
            <el-button @click="handleReset">重置</el-button>
          </el-form-item>
        </el-form>
      </div>

      <!-- 日志列表 -->
      <el-timeline v-loading="loading" class="log-timeline">
        <el-timeline-item
          v-for="log in logs"
          :key="log.id"
          :timestamp="formatDateTime(log.timestamp)"
          placement="top"
          :type="log.status === 'SUCCESS' ? 'success' : 'danger'"
          :icon="log.status === 'SUCCESS' ? CircleCheck : CircleClose"
        >
          <el-card class="log-card" shadow="hover">
            <div class="log-header">
              <div class="log-action">
                <el-tag :type="getActionType(log.action)" size="small" effect="plain">
                  {{ getActionText(log.action) }}
                </el-tag>
                <span class="log-description">{{ log.description }}</span>
              </div>
              <el-tag
                :type="log.status === 'SUCCESS' ? 'success' : 'danger'"
                size="small"
                effect="light"
              >
                {{ log.status === 'SUCCESS' ? '成功' : '失败' }}
              </el-tag>
            </div>

            <div class="log-details">
              <div class="detail-item">
                <span class="label">操作人：</span>
                <span class="value">{{ log.userName }}</span>
              </div>
              <div v-if="log.resource" class="detail-item">
                <span class="label">资源：</span>
                <span class="value">{{ log.resource }}</span>
                <span v-if="log.resourceId" class="value">(#{{ log.resourceId }})</span>
              </div>
              <div class="detail-item">
                <span class="label">IP：</span>
                <span class="value mono">{{ log.ip }}</span>
              </div>
            </div>
          </el-card>
        </el-timeline-item>
      </el-timeline>

      <!-- 空状态 -->
      <el-empty v-if="!loading && logs.length === 0" description="暂无审计日志" />

      <!-- 分页 -->
      <div v-if="total > 0" class="pagination-wrapper">
        <el-pagination
          v-model:current-page="queryParams.page"
          v-model:page-size="queryParams.size"
          :page-sizes="[10, 20, 50, 100]"
          :total="total"
          layout="total, sizes, prev, pager, next, jumper"
          @size-change="handleSizeChange"
          @current-change="handlePageChange"
        />
      </div>
    </div>

    <template #footer>
      <div class="drawer-footer">
        <el-button :loading="exporting" @click="handleExport">
          <el-icon><Download /></el-icon>
          导出日志
        </el-button>
        <el-button type="primary" @click="handleClose">关闭</el-button>
      </div>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { CircleCheck, CircleClose, Download } from '@element-plus/icons-vue'
import { auditLogApi, type AuditLogItem } from '@/features/admin/api/auditLogApi'
import { logger } from '@/shared/lib/utils/logger'
import {
  buildExportFileName,
  exportRowsToExcel,
  type ExcelExportColumn
} from '@/shared/lib/export/excel'

// Props
const props = defineProps<{
  modelValue: boolean
  indicatorId?: string | number
  resourceId?: string | number
  resourceType?: string
}>()

// Emits
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
}>()

// 状态
const logs = ref<AuditLogItem[]>([])
const loading = ref(false)
const exporting = ref(false)
const total = ref(0)

const queryParams = reactive({
  page: 1,
  size: 20,
  action: '',
  status: '',
  keyword: '',
  resourceId: undefined as number | undefined,
  startTime: undefined as string | undefined,
  endTime: undefined as string | undefined
})

// 控制抽屉显示
const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value)
})

// 格式化日期时间
const formatDateTime = (dateStr: string) => {
  if (!dateStr) {
    return ''
  }
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60))
    if (hours === 0) {
      const minutes = Math.floor(diff / (1000 * 60))
      if (minutes === 0) {
        return '刚刚'
      }
      return `${minutes} 分钟前`
    }
    return `${hours} 小时前`
  } else if (days === 1) {
    return '昨天 ' + date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } else if (days < 7) {
    return `${days} 天前`
  } else {
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
}

// 获取操作类型标签类型
const getActionType = (action: string) => {
  const actionMap: Record<string, string> = {
    CREATE: 'success',
    UPDATE: 'warning',
    DELETE: 'danger',
    APPROVE: 'success',
    REJECT: 'danger'
  }
  return actionMap[action] || 'info'
}

// 获取操作文本
const getActionText = (action: string) => {
  const actionMap: Record<string, string> = {
    CREATE: '创建',
    UPDATE: '更新',
    DELETE: '删除',
    APPROVE: '审批',
    REJECT: '驳回',
    LOGIN: '登录',
    LOGOUT: '登出',
    EXPORT: '导出',
    IMPORT: '导入'
  }
  return actionMap[action] || action
}

// 加载审计日志
const loadLogs = async () => {
  loading.value = true
  try {
    const params = {
      ...queryParams,
      resourceId: props.resourceId
    }
    const response = await auditLogApi.list(params)
    logs.value = response.items
    total.value = response.total
  } catch (error) {
    logger.error('加载审计日志失败:', error)
    ElMessage.error('加载审计日志失败')
  } finally {
    loading.value = false
  }
}

// 查询
const handleQuery = () => {
  queryParams.page = 1
  loadLogs()
}

// 重置
const handleReset = () => {
  queryParams.page = 1
  queryParams.action = ''
  queryParams.status = ''
  loadLogs()
}

// 页码变化
const handlePageChange = () => {
  loadLogs()
}

// 每页数量变化
const handleSizeChange = () => {
  queryParams.page = 1
  loadLogs()
}

// 导出日志
// 2026-10-28：原先依赖 auditLogApi.export（后端无该接口，恒返回 null，按钮实际是坏的）。
// 改为导出当前已加载的日志列表，走统一导出层；后端补接口后再切换为全量导出。
const handleExport = async () => {
  if (logs.value.length === 0) {
    ElMessage.warning('暂无可导出的日志')
    return
  }

  exporting.value = true
  try {
    const columns: ExcelExportColumn<AuditLogItem>[] = [
      { header: '时间', width: 20, getValue: row => formatDateTime(row.timestamp) },
      { header: '操作类型', width: 12, getValue: row => getActionText(row.action) },
      { header: '状态', width: 10, getValue: row => (row.status === 'SUCCESS' ? '成功' : '失败') },
      { header: '操作人', width: 16, getValue: row => row.userName },
      { header: '资源', width: 20, getValue: row => row.resource || '-' },
      { header: '资源ID', width: 12, getValue: row => row.resourceId ?? '-' },
      { header: '描述', width: 40, getValue: row => row.description || '-' },
      { header: 'IP', width: 16, getValue: row => row.ip || '-' }
    ]

    await exportRowsToExcel(
      { sheetName: '审计日志', rows: logs.value, columns },
      buildExportFileName('审计日志')
    )
    ElMessage.success('导出成功')
  } catch (error) {
    logger.error('导出失败:', error)
    ElMessage.error('导出失败')
  } finally {
    exporting.value = false
  }
}

// 关闭抽屉
const handleClose = () => {
  emit('close')
}

// 监听抽屉打开
watch(
  () => props.modelValue,
  newVal => {
    if (newVal) {
      // 抽屉打开时加载日志
      loadLogs()
    } else {
      // 抽屉关闭时清空数据
      logs.value = []
      queryParams.page = 1
    }
  }
)
</script>

<style scoped lang="scss">
.drawer-content {
  padding: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.filter-section {
  padding: 16px 20px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);

  .filter-form {
    margin-bottom: 0;
  }
}

.log-timeline {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}

.log-card {
  margin-bottom: 8px;

  :deep(.el-card__body) {
    padding: 12px 16px;
  }
}

.log-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.log-action {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.log-description {
  font-size: 14px;
  color: var(--el-text-color-primary);
  font-weight: 500;
}

.log-details {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  font-size: 12px;
  color: var(--el-text-color-secondary);

  .detail-item {
    display: flex;
    align-items: center;
    gap: 4px;

    .label {
      color: var(--el-text-color-placeholder);
    }

    .value {
      color: var(--el-text-color-secondary);

      &.mono {
        font-family: 'Courier New', monospace;
      }
    }
  }
}

.pagination-wrapper {
  padding: 16px 20px;
  border-top: 1px solid var(--el-border-color-lighter);
  display: flex;
  justify-content: center;
}

.drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px;
  border-top: 1px solid var(--el-border-color-light);
}
</style>
