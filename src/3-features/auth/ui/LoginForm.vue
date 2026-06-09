<template>
  <el-form
    ref="formRef"
    :model="formData"
    :rules="rules"
    class="login-form"
    @submit.prevent="handleSubmit"
    @keydown.enter.prevent="handleSubmit"
  >
    <el-form-item prop="account">
      <div class="input-wrapper">
        <label class="input-label" for="login-account">账号</label>
        <el-input
          id="login-account"
          v-model="formData.account"
          aria-label="账号"
          placeholder="用户名 / 邮箱 / 手机号"
          size="large"
          :disabled="loading"
          @input="resetError"
          @keydown.enter.prevent.stop="handleSubmit"
        >
          <template #prefix>
            <el-icon><User /></el-icon>
          </template>
        </el-input>
      </div>
    </el-form-item>

    <el-form-item prop="password">
      <div class="input-wrapper">
        <label class="input-label" for="login-password">密码</label>
        <el-input
          id="login-password"
          v-model="formData.password"
          type="password"
          aria-label="密码"
          placeholder="请输入密码"
          size="large"
          show-password
          :disabled="loading"
          @keydown.enter.prevent.stop="handleSubmit"
        >
          <template #prefix>
            <el-icon><Lock /></el-icon>
          </template>
        </el-input>
      </div>
    </el-form-item>

    <div class="form-options">
      <el-checkbox v-model="formData.rememberMe" :disabled="loading"> 记住账号 </el-checkbox>
      <el-button type="primary" link :disabled="loading" @click="$emit('forgot-password')">
        忘记密码？
      </el-button>
    </div>

    <el-form-item>
      <el-button
        type="primary"
        size="large"
        :loading="loading"
        :disabled="isLocked"
        class="login-btn"
        native-type="button"
        @click.prevent="handleSubmit"
      >
        {{ buttonText }}
      </el-button>
    </el-form-item>

    <transition name="login-feedback">
      <div v-if="feedbackState.visible" class="feedback-panel">
        <el-alert
          :title="feedbackState.title"
          :type="feedbackState.type"
          :closable="false"
          show-icon
        >
          <template v-if="feedbackState.detail" #default>
            <p>{{ feedbackState.detail }}</p>
          </template>
        </el-alert>
      </div>
    </transition>
  </el-form>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { User, Lock } from '@element-plus/icons-vue'
import type { LoginFormState } from '../model/types'
import { VALIDATION_RULES, SESSION_CONFIG, TOKEN_KEYS } from '../model/constants'
import { logger } from '@/shared/lib/utils/logger'

// Props
interface Props {
  loading?: boolean
  errorMessage?: string
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  errorMessage: ''
})

// Emits
interface Emits {
  (e: 'submit', credentials: { account: string; password: string }): void
  (e: 'forgot-password'): void
}

const emit = defineEmits<Emits>()

// Form ref
const formRef = ref<FormInstance>()

// Form data
const formData = reactive<LoginFormState>({
  account: '',
  password: '',
  rememberMe: false
})

// Error tracking
const errorCount = ref(0)
const isLocked = ref(false)
let lockTimer: ReturnType<typeof setTimeout> | null = null

// Computed
const remainingAttempts = computed(() => SESSION_CONFIG.MAX_LOGIN_ATTEMPTS - errorCount.value)

const feedbackState = computed(() => {
  if (isLocked.value) {
    return {
      visible: true,
      type: 'warning' as const,
      title: '登录失败次数过多，请5分钟后再试。',
      detail: '如仍无法登录，请联系管理员处理。'
    }
  }

  if (props.errorMessage && errorCount.value > 0) {
    return {
      visible: true,
      type: 'error' as const,
      title: `${props.errorMessage} 还可再试 ${remainingAttempts.value} 次。`,
      detail: ''
    }
  }

  if (props.errorMessage) {
    return {
      visible: true,
      type: 'error' as const,
      title: props.errorMessage,
      detail: ''
    }
  }

  return {
    visible: false,
    type: 'info' as const,
    title: '',
    detail: ''
  }
})

const buttonText = computed(() => {
  if (props.loading) {
    return '登录中...'
  }
  if (isLocked.value) {
    return '账户已锁定'
  }
  return '登 录'
})

// Validation rules
const rules: FormRules = {
  account: [
    { required: true, message: '请输入账号', trigger: 'blur' },
    { max: 100, message: '账号长度不能超过100个字符', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    {
      min: VALIDATION_RULES.PASSWORD_MIN_LENGTH,
      max: VALIDATION_RULES.PASSWORD_MAX_LENGTH,
      message: `密码长度应在 ${VALIDATION_RULES.PASSWORD_MIN_LENGTH}-${VALIDATION_RULES.PASSWORD_MAX_LENGTH} 个字符之间`,
      trigger: 'blur'
    }
  ]
}

// Methods
const resetError = () => {
  // Error count is managed by parent component
}

const handleSubmit = async () => {
  if (isLocked.value) {
    ElMessage.error('登录失败次数过多，请稍后再试')
    return
  }

  if (!formRef.value) {
    ElMessage.warning('表单未初始化')
    return
  }

  try {
    await formRef.value.validate()

    // Emit submit event
    emit('submit', {
      account: formData.account,
      password: formData.password
    })

    // Handle remember me
    if (formData.rememberMe) {
      localStorage.setItem(TOKEN_KEYS.REMEMBERED_USERNAME, formData.account)
    } else {
      localStorage.removeItem(TOKEN_KEYS.REMEMBERED_USERNAME)
    }
  } catch (error) {
    logger.debug('Login form validation blocked submit', error)
  }
}

const incrementErrorCount = () => {
  errorCount.value++

  if (errorCount.value >= SESSION_CONFIG.MAX_LOGIN_ATTEMPTS) {
    isLocked.value = true
    startAutoUnlock()
  }
}

const resetErrorCount = () => {
  errorCount.value = 0
  isLocked.value = false
  if (lockTimer) {
    clearTimeout(lockTimer)
    lockTimer = null
  }
}

const startAutoUnlock = () => {
  if (lockTimer) {
    clearTimeout(lockTimer)
  }

  lockTimer = setTimeout(() => {
    resetErrorCount()
    ElMessage.success('账户已解锁，请重新登录')
  }, SESSION_CONFIG.LOCK_DURATION)
}

// Initialize remembered username
const initRememberedUsername = () => {
  const remembered = localStorage.getItem(TOKEN_KEYS.REMEMBERED_USERNAME)
  if (remembered) {
    formData.account = remembered
    formData.rememberMe = true
  }
}

// Expose methods for parent component
defineExpose({
  incrementErrorCount,
  resetErrorCount,
  resetForm: () => formRef.value?.resetFields()
})

// Initialize on mount
initRememberedUsername()
</script>

<style scoped>
.login-form {
  width: 100%;
}

.input-wrapper {
  width: 100%;
}

.input-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-main);
  margin-bottom: var(--spacing-sm);
}

.login-form :deep(.el-input__wrapper) {
  background: var(--bg-light);
  border: 1px solid var(--border-input);
  border-radius: var(--radius-sm);
  box-shadow: none !important;
  padding: var(--spacing-xs) var(--spacing-md);
  transition: all var(--transition-fast);
}

.login-form :deep(.el-input__wrapper:hover) {
  border-color: var(--border-color);
}

.login-form :deep(.el-input__wrapper.is-focus) {
  background: var(--bg-white);
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px rgba(64, 158, 255, 0.15) !important;
}

.login-form :deep(.el-form-item) {
  margin-bottom: var(--spacing-2xl);
}

.form-options {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--spacing-2xl);
}

.form-options :deep(.el-checkbox__label) {
  font-size: 13px;
  color: var(--text-regular);
}

.login-btn {
  width: 100%;
  height: 48px;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 8px;
  border-radius: var(--radius-sm);
  background: linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%);
  border: none;
  transition: all var(--transition-normal);
}

.login-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
  transform: translateY(-1px);
  box-shadow: var(--shadow-hover);
}

.login-btn:active:not(:disabled) {
  transform: translateY(0);
}

.login-btn:disabled {
  background: var(--border-color);
  cursor: not-allowed;
}

.feedback-panel {
  margin-top: var(--spacing-lg);
}

.feedback-panel :deep(.el-alert) {
  border-radius: var(--radius-md);
}

.feedback-panel :deep(.el-alert p) {
  margin: var(--spacing-xs) 0;
  font-size: 12px;
}

.login-feedback-enter-active,
.login-feedback-leave-active {
  transition:
    opacity 220ms ease,
    transform 260ms ease;
}

.login-feedback-enter-from,
.login-feedback-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

.login-feedback-enter-to,
.login-feedback-leave-from {
  opacity: 1;
  transform: translateY(0);
}
</style>
