<template>
  <div class="appraisal-level-cell manual-alert-cell" :class="{ 'is-saving': saving }">
    <!--
      行内下拉（2026-11-19 用户定案：统一行内下拉，去掉弹窗层）：
      只有点击格子解锁后才渲染，未点击时页面上看不到任何下拉控件。
    -->
    <el-select
      v-if="editing"
      :key="selectKey"
      ref="selectRef"
      :model-value="currentLevel ?? ''"
      class="appraisal-level-cell__select"
      size="small"
      :disabled="saving"
      :loading="saving"
      placeholder="选择审核进度"
      @change="handleSelectChange"
    >
      <el-option
        v-for="option in APPRAISAL_LEVEL_OPTIONS"
        :key="option.value"
        :label="option.label"
        :value="option.value"
      />
    </el-select>

    <!--
      只读态：等级标签。
      canAppraise=false 时鼠标悬停说明「为什么不能改」（后端 lockHint 优先，缺失走共享兜底文案）。
    -->
    <el-tooltip v-else :content="lockReason" :disabled="!lockReason" placement="top">
      <el-tag
        :type="display.type"
        :style="tagStyle"
        size="small"
        class="appraisal-level-cell__tag"
        :class="canAppraise ? 'is-clickable' : 'is-locked'"
        @click="handleCellClick"
      >
        {{ display.label }}
      </el-tag>
    </el-tooltip>
  </div>
</template>

<script setup lang="ts">
/**
 * 审核进度行内下拉单元格（三视图共用，2026-11-19 用户定案）。
 *
 * 交互契约（战略任务管理页 / 指标填报页 / 指标分发页完全一致）：
 * ① 点击单元格才解锁下拉——未点击时只显示等级标签，页面上不渲染下拉控件；
 * ② 解锁前单条重查后端 context（canAppraise），无权评定时当场提示原因且不展开下拉；
 * ③ 不可评定的行显示只读值，鼠标悬停说明原因（审批中不可改 / 非当前环节评定人 / 无评定权限…）；
 * ④ 下拉只有 超前完成 / 正常 / 滞后 三档，「未评定」是初始空白显示态、不是选项（不产生空值）；
 * ⑤ 选完即存（无二次确认弹窗）：保存中下拉禁用，成功 success 提示、失败 error 提示并可改选；
 * ⑥ 保存成功后单元格回显新等级并退回只读态。
 */
import { computed, nextTick, ref, unref } from 'vue'
import { ElOption, ElSelect, ElTag, ElTooltip } from 'element-plus'
import {
  APPRAISAL_LEVEL_OPTIONS,
  getAppraisalGateMessage,
  getAppraisalLevelDisplay,
  type AppraisalGateContextLike
} from '@/features/indicator/lib/appraisalGate'
import { getProgressLevelTagStyle } from '@/shared/lib/constants/progressLevel'
import type {
  IndicatorAppraisalApi,
  IndicatorAppraisalLevelValue
} from '@/features/indicator/model/useIndicatorAppraisal'

const props = withDefaults(
  defineProps<{
    /** 指标 id（行内评定的定位键）；行数据异常时为空串，由模型层统一兜底提示 */
    indicatorId?: string | number
    /** 当前等级（context 优先，行数据兜底由调用方算出） */
    level?: string | null
    /** 后端下发的鉴定上下文（canAppraise + lockHint） */
    context?: AppraisalGateContextLike | null
    /** 共享模型层（unlockAppraisal / commitAppraisalLevel） */
    appraisal: IndicatorAppraisalApi
  }>(),
  {
    indicatorId: '',
    level: null,
    context: null
  }
)

const emit = defineEmits<{
  /** 保存成功后通知调用方同步行数据（如 strategicStore.patchIndicator） */
  (event: 'saved', level: IndicatorAppraisalLevelValue): void
}>()

/** 是否已解锁行内下拉 */
const editing = ref(false)
/** 保存中（下拉禁用 + loading） */
const saving = ref(false)
/** 失败回滚时重挂下拉，清掉 el-select 内部残留的临时选中文案 */
const selectKey = ref(0)
const selectRef = ref<InstanceType<typeof ElSelect> | null>(null)

const currentLevel = computed<IndicatorAppraisalLevelValue | null>(() => {
  const raw = String(props.level ?? '')
    .trim()
    .toUpperCase()
  if (raw === 'AHEAD' || raw === 'NORMAL' || raw === 'DELAYED') {
    return raw as IndicatorAppraisalLevelValue
  }
  return null
})

/** 只读展示态（空值 → 「未评定」） */
const display = computed(() => getAppraisalLevelDisplay(currentLevel.value))
/** 三档视觉口径（正常=标准绿、超前=深绿、滞后=橙） */
const tagStyle = computed(() => getProgressLevelTagStyle(currentLevel.value))
/** 是否当前节点可评定（后端 canAppraise 权威判定） */
const canAppraise = computed(() => props.context?.canAppraise === true)
/** 不可评定原因（悬停提示文案；后端 lockHint 优先，缺失走共享兜底） */
const lockReason = computed(() => {
  if (canAppraise.value) {
    return ''
  }
  // 上下文还没加载出来时先不给结论，避免误报「不可评定」
  if (!props.context && unref(props.appraisal.loading)) {
    return ''
  }
  return getAppraisalGateMessage(props.context ?? { canAppraise: false, lockHint: '' })
})

/** 点击单元格：解锁行内下拉（无权评定则当场提示原因，不展开） */
const handleCellClick = async () => {
  if (editing.value || saving.value) {
    return
  }
  const unlocked = await props.appraisal.unlockAppraisal(props.indicatorId)
  if (!unlocked) {
    return
  }
  editing.value = true
  await nextTick()
  openSelectMenu()
}

/** 解锁后直接展开选项面板（避免「解锁→再点一次」两步） */
const openSelectMenu = () => {
  const root = selectRef.value?.$el as HTMLElement | undefined
  if (!root) {
    return
  }
  const trigger = root.querySelector<HTMLElement>('.el-select__wrapper') ?? root
  trigger.click()
}

/** 选完即存：写库成功→回显并退回只读态；失败→保持展开并回滚到原值 */
const handleSelectChange = async (value: unknown) => {
  if (saving.value) {
    return
  }
  const raw = String(value ?? '')
    .trim()
    .toUpperCase()
  // 「未评定」不是选项：空值一律不写库（不产生空等级）
  if (raw !== 'AHEAD' && raw !== 'NORMAL' && raw !== 'DELAYED') {
    return
  }
  const level = raw as IndicatorAppraisalLevelValue
  if (level === currentLevel.value) {
    // 选中原值：不写库，直接退回只读态
    editing.value = false
    return
  }

  saving.value = true
  try {
    const result = await props.appraisal.commitAppraisalLevel(props.indicatorId, level)
    if (result.ok) {
      emit('saved', result.level)
      await nextTick()
      editing.value = false
    } else {
      // 保存失败：回滚下拉显示值（重挂一次），用户可直接改选其它档位
      selectKey.value += 1
    }
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.appraisal-level-cell {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
}

.appraisal-level-cell__select {
  width: 100%;
  min-width: 0;
}

/* 可评定：指针手势（点击才解锁下拉） */
.appraisal-level-cell__tag.is-clickable {
  cursor: pointer;
}

/* 不可评定：帮助手势（悬停说明原因） */
.appraisal-level-cell__tag.is-locked {
  cursor: help;
}
</style>
