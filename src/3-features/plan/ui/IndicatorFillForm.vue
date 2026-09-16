<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  ElForm,
  ElFormItem,
  ElInput,
  ElInputNumber,
  ElSlider,
  ElButton,
  ElUpload,
  ElMessage,
  ElTag,
  ElIcon,
  type UploadUserFile,
  type UploadFile as _UploadFile,
  type UploadProps
} from 'element-plus'
import { Delete as _Delete, UploadFilled } from '@element-plus/icons-vue'
import type { Indicator, IndicatorFill, IndicatorFillForm } from '@/shared/types'
import { usePlanStore } from '@/features/plan/model/store'
import { logger } from '@/shared/lib/utils/logger'

const props = defineProps<{
  indicator: Indicator
  fill?: IndicatorFill | null
  readonly?: boolean
}>()

const emit = defineEmits<{
  (e: 'saved', fill: IndicatorFill): void
  (e: 'submitted', fill: IndicatorFill): void
  (e: 'cancel'): void
}>()

const planStore = usePlanStore()

const formData = ref<IndicatorFillForm>({
  indicator_id: props.indicator.id,
  progress: 0,
  content: ''
})

const fileList = ref<UploadUserFile[]>([])
const saving = ref(false)
const submitting = ref(false)
const formRef = ref<InstanceType<typeof ElForm>>()

const rules = {
  progress: [
    { required: true, message: '请输入进度值', trigger: 'blur' },
    { type: 'number', min: 0, max: 100, message: '进度值范围为0-100', trigger: 'blur' }
  ],
  content: [
    { required: true, message: '请填写填报说明', trigger: 'blur' },
    { min: 10, message: '填报说明至少10个字符', trigger: 'blur' }
  ]
}

const initFormData = () => {
  if (props.fill) {
    formData.value = {
      indicator_id: props.fill.indicator_id,
      progress: props.fill.progress,
      content: props.fill.content
    }

    if (props.fill.attachments && props.fill.attachments.length > 0) {
      fileList.value = props.fill.attachments.map((att, idx) => ({
        name: att.name,
        url: att.url,
        uid: Date.now() + idx,
        status: 'success'
      }))
    }
  } else {
    formData.value = {
      indicator_id: props.indicator.id,
      progress: props.indicator.latest_progress || 0,
      content: ''
    }
  }
}

const handleSave = async () => {
  if (!formRef.value) {
    return
  }

  try {
    await formRef.value.validate()
  } catch {
    ElMessage.warning('请完善必填信息')
    return
  }

  saving.value = true

  try {
    logger.info('[IndicatorFillForm] Saving fill...', formData.value)
    const response = await planStore.saveIndicatorFill(formData.value)

    if (response) {
      ElMessage.success('保存成功')
      emit('saved', response)
    }
  } catch (err) {
    logger.error('[IndicatorFillForm] Failed to save fill:', err)
    if (!(err instanceof Error) || !err.message) {
      ElMessage.error('保存失败，请重试')
    }
  } finally {
    saving.value = false
  }
}

const handleSubmit = async () => {
  if (!formRef.value) {
    return
  }

  try {
    await formRef.value.validate()
  } catch {
    ElMessage.warning('请完善必填信息')
    return
  }

  submitting.value = true

  try {
    logger.info('[IndicatorFillForm] Submitting fill...', formData.value)
    const savedFill = await planStore.saveIndicatorFill(formData.value)

    if (savedFill?.id != null) {
      const response = await planStore.submitIndicatorFill(savedFill.id)
      ElMessage.success('提交成功')
      emit('submitted', response)
    }
  } catch (err) {
    logger.error('[IndicatorFillForm] Failed to submit fill:', err)
    if (!(err instanceof Error) || !err.message) {
      ElMessage.error('提交失败，请重试')
    }
  } finally {
    submitting.value = false
  }
}

const handleCancel = () => {
  emit('cancel')
}

const handleFileChange: UploadProps['onChange'] = (_uploadFile, uploadFiles) => {
  fileList.value = uploadFiles
}

const handleFileRemove: UploadProps['onRemove'] = () => {}

const beforeUpload: UploadProps['beforeUpload'] = file => {
  const isLt10M = file.size / 1024 / 1024 < 10
  if (!isLt10M) {
    ElMessage.error('附件大小不能超过 10MB')
  }
  return isLt10M
}

const progressFormat = (val: number) => {
  return `${val}%`
}

watch(
  () => props.fill,
  () => {
    initFormData()
  },
  { immediate: true }
)
</script>

<template>
  <div class="indicator-fill-form">
    <div class="form-header">
      <div class="indicator-info">
        <h3 class="indicator-name">{{ indicator.name }}</h3>
        <p class="indicator-definition">{{ indicator.definition }}</p>
      </div>
    </div>

    <ElForm ref="formRef" :model="formData" :rules="rules" label-position="top" class="fill-form">
      <ElFormItem label="当前进度" prop="progress">
        <div class="progress-input">
          <ElInputNumber
            v-model="formData.progress"
            :min="0"
            :max="100"
            :disabled="readonly"
            :precision="0"
            class="progress-number"
          />
          <ElSlider
            v-model="formData.progress"
            :min="0"
            :max="100"
            :disabled="readonly"
            :format-tooltip="progressFormat"
            class="progress-slider"
          />
        </div>
      </ElFormItem>

      <ElFormItem label="填报说明" prop="content">
        <ElInput
          v-model="formData.content"
          type="textarea"
          :rows="5"
          maxlength="500"
          show-word-limit
          placeholder="请填写本次填报说明、完成情况、存在问题等"
          :disabled="readonly"
        />
      </ElFormItem>

      <ElFormItem label="附件">
        <ElUpload
          v-model:file-list="fileList"
          action="#"
          list-type="text"
          :auto-upload="false"
          :before-upload="beforeUpload"
          :on-change="handleFileChange"
          :on-remove="handleFileRemove"
          :disabled="readonly"
        >
          <ElButton :icon="UploadFilled" :disabled="readonly">选择附件</ElButton>
          <template #tip>
            <div class="upload-tip">支持上传文档、图片、压缩包等，单个文件不超过 10MB。</div>
          </template>
        </ElUpload>
      </ElFormItem>

      <div class="form-actions">
        <ElButton @click="handleCancel">取消</ElButton>
        <ElButton type="info" :loading="saving" :disabled="readonly" @click="handleSave">
          保存草稿
        </ElButton>
        <ElButton type="primary" :loading="submitting" :disabled="readonly" @click="handleSubmit">
          提交审核
        </ElButton>
      </div>
    </ElForm>
  </div>
</template>

<style scoped>
.indicator-fill-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.indicator-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.indicator-name {
  margin: 0;
  font-size: 18px;
}

.indicator-definition {
  margin: 0;
  color: #6b7280;
}

.progress-input {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 16px;
  align-items: center;
}

.progress-number,
.progress-slider {
  width: 100%;
}

.upload-tip {
  color: #6b7280;
  font-size: 12px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
