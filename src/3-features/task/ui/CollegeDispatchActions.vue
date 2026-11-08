<script setup lang="ts">
/**
 * 2026-11-05（issue #96 第一部分 · 1.3）：学院下发操作区。
 *
 * <p><b>为什么存在</b>：学院指标下发的操作入口从「指标下发与审批」页（/distribution）
 * 迁到「战略任务管理」页（/strategic-tasks）的「二级学院」页签 —— 战略发展部不再需要
 * 单独开一个下发工作台，操作路径变成：
 * 左侧选职能部门 → 切到「二级学院」页签 → 选学院 → 在该页签工具栏完成
 * 导入 / 下载模板 / 导出 / 发起下发审批。
 *
 * <p><b>作用域</b>：本组件只操作「当前所选职能部门 → 当前所选学院」这一段。
 * 导入的发起方固定为战略发展部（服务端硬校验来源组织必须是战略部），
 * 父级锚点限定为该职能部门已接收的核心指标。
 *
 * <p><b>不做什么</b>：不新增指标、不复制其它学院的指标 —— 这两类属于「指标编辑」，
 * 由指标列表页承担；本组件只承载「下发动作」。
 */
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Download, Upload, Promotion } from '@element-plus/icons-vue'
import BusinessImportDialog from '@/features/import/ui/BusinessImportDialog.vue'
import { planApi } from '@/features/plan/api/planApi'
import { exportRowsToExcel, buildExportFileName } from '@/5-shared/lib/export/excel'
import type { StrategicIndicator } from '@/shared/types'

interface Props {
  /** 当前考核周期 id（导入预览/提交需要） */
  cycleId: number | null
  /** 当前所选学院名称 */
  collegeName: string
  /** 当前所选学院 org id */
  collegeOrgId: number | null
  /** 下发方（战略发展部）org id —— 导入来源固定为它 */
  strategyOrgId: number | null
  /** 下发方（战略发展部）名称 */
  strategyOrgName: string
  /** 该职能部门的核心指标（导入模板预填 + 父级锚点） */
  parentIndicators: StrategicIndicator[]
  /** 当前部门 → 当前学院的指标行（导出用） */
  rows: StrategicIndicator[]
  /** 本次要发起的下发计划 id（发起下发审批用） */
  planId: number | null
  /** 不可用时的原因（置灰 + tooltip） */
  disabledReason?: string
  /** 由父级指标 id 解析名称（导出列用） */
  resolveParentName?: (parentIndicatorId?: string | number) => string
}

const props = defineProps<Props>()

const importDialogVisible = ref(false)
const exporting = ref(false)
const submitting = ref(false)

const canOperate = computed(() => !props.disabledReason)
const disableTooltip = computed(() => props.disabledReason || '')

/** 导出列：核心指标 / 子指标 / 类型 / 权重 / 状态 / 备注 —— 口径=当前部门→当前学院。 */
const exportColumns = computed(() => [
  {
    header: '核心指标',
    width: 32,
    getValue: (row: StrategicIndicator) =>
      props.resolveParentName?.(row.parentIndicatorId) ||
      (row.parentIndicatorId ? String(row.parentIndicatorId) : '-')
  },
  {
    header: '子指标名称',
    width: 36,
    getValue: (row: StrategicIndicator) => String(row.name || '')
  },
  {
    header: '指标类型',
    width: 12,
    getValue: (row: StrategicIndicator) => String(row.type1 || '定量')
  },
  {
    header: '权重',
    width: 10,
    // 字段名对齐 @/shared/types 的 StrategicIndicator（Zod 推导）：权重是 weight，不是 weightPercent
    getValue: (row: StrategicIndicator) => String(row.weight ?? '')
  },
  { header: '状态', width: 14, getValue: (row: StrategicIndicator) => String(row.status || '') },
  // 该共享类型没有 remark 字段；说明列改用 unit（单位），不为导出需求去改共享类型
  { header: '单位', width: 10, getValue: (row: StrategicIndicator) => String(row.unit || '') }
])

const handleExport = async () => {
  if (!canOperate.value) {
    ElMessage.warning(props.disabledReason)
    return
  }
  if (!props.collegeName) {
    ElMessage.warning('请先在左侧选择学院')
    return
  }
  if (!props.rows.length) {
    ElMessage.warning('当前部门与该学院范围内暂无可导出的指标')
    return
  }
  exporting.value = true
  try {
    await exportRowsToExcel(
      {
        sheetName: '指标下发与管理',
        rows: props.rows,
        columns: exportColumns.value,
        emptyMessage: '当前学院暂无可导出的子指标数据'
      },
      buildExportFileName('指标下发与管理', props.collegeName)
    )
    ElMessage.success('导出成功')
  } catch {
    ElMessage.error('导出失败，请稍后重试')
  } finally {
    exporting.value = false
  }
}

const openImportDialog = () => {
  if (!canOperate.value) {
    ElMessage.warning(props.disabledReason)
    return
  }
  if (!props.collegeName || !props.collegeOrgId) {
    ElMessage.warning('请先在左侧选择要下发的学院')
    return
  }
  if (!props.cycleId) {
    ElMessage.warning('当前周期信息不可用，暂不能导入')
    return
  }
  importDialogVisible.value = true
}

/**
 * 发起下发审批。
 *
 * <p>流程码固定为 PLAN_DISPATCH_STRATEGY（flow1：填报人提交 → 战略发展部负责人 → 分管校领导）。
 * 服务端会自行按计划级别判定流程码，前端传的值只作表达，不决定实际走向。
 */
const handleSubmitDispatchApproval = async () => {
  if (!canOperate.value) {
    ElMessage.warning(props.disabledReason)
    return
  }
  if (!props.planId) {
    ElMessage.warning('当前学院还没有可提交审批的下发计划')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认对「${props.collegeName}」发起下发审批？提交后进入：战略发展部负责人 → 分管校领导。`,
      '发起下发审批',
      { type: 'warning', confirmButtonText: '确认发起', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  submitting.value = true
  try {
    const response = await planApi.submitPlanForApproval(props.planId, {
      workflowCode: 'PLAN_DISPATCH_STRATEGY'
    } as Parameters<typeof planApi.submitPlanForApproval>[1])
    if (response.code === 200) {
      ElMessage.success('已发起下发审批')
    } else {
      ElMessage.error(response.message || '发起下发审批失败')
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '发起下发审批失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="college-dispatch-actions">
    <el-tooltip :content="disableTooltip" :disabled="canOperate" placement="top">
      <span>
        <el-button :loading="exporting" :disabled="!canOperate" @click="handleExport">
          <el-icon><Download /></el-icon>
          导出
        </el-button>
      </span>
    </el-tooltip>
    <el-tooltip :content="disableTooltip" :disabled="canOperate" placement="top">
      <span>
        <el-button :disabled="!canOperate" @click="openImportDialog">
          <el-icon><Upload /></el-icon>
          导入
        </el-button>
      </span>
    </el-tooltip>
    <el-tooltip :content="disableTooltip" :disabled="canOperate" placement="top">
      <span>
        <el-button
          type="primary"
          :loading="submitting"
          :disabled="!canOperate"
          @click="handleSubmitDispatchApproval"
        >
          <el-icon><Promotion /></el-icon>
          发起下发审批
        </el-button>
      </span>
    </el-tooltip>

    <BusinessImportDialog
      v-model:visible="importDialogVisible"
      type="distribution"
      :target-org-id="collegeOrgId"
      :target-org-name="collegeName"
      :source-org-id="strategyOrgId"
      :source-org-name="strategyOrgName"
      :cycle-id="cycleId"
      :parent-indicators="parentIndicators"
    />
  </div>
</template>

<style scoped>
.college-dispatch-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
