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

    <el-form-item prop="termsAccepted" class="terms-form-item">
      <el-checkbox
        v-model="formData.termsAccepted"
        class="terms-checkbox"
        :disabled="loading"
        @change="formRef?.validateField('termsAccepted')"
      >
        <span class="terms-label">
          我已阅读并同意
          <el-button
            type="primary"
            link
            class="terms-link"
            :disabled="loading"
            @click.prevent.stop="termsDialogVisible = true"
          >
            《服务条款与数据使用告知》
          </el-button>
        </span>
      </el-checkbox>
    </el-form-item>

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

    <el-dialog
      v-model="termsDialogVisible"
      title="服务条款与数据使用告知"
      width="min(92vw, 640px)"
      class="terms-dialog"
      append-to-body
    >
      <div class="terms-content">
        <section class="terms-section">
          <h3>一、服务范围与适用对象</h3>
          <p>
            本系统面向学校及授权部门提供战略指标、任务填报、审批流转、监控预警、统计分析等业务支撑服务。
          </p>
          <p>
            用户仅可在岗位职责、授权范围和业务目的内使用系统，不得将系统账号、数据或功能用于无关事务、个人用途或未授权场景。
          </p>
        </section>

        <section class="terms-section">
          <h3>二、账号、权限与操作责任</h3>
          <p>
            系统按角色和组织边界分配权限，遵循最小必要原则，仅开放完成业务所需的功能和数据范围。
          </p>
          <p>
            用户应妥善保管账号、密码及身份凭据，不得出借、转让、共享账号，因账号使用产生的业务操作、审批意见、数据变更和导出行为均可被记录并用于审计追溯。
          </p>
        </section>

        <section class="terms-section">
          <h3>三、系统日志与安全审计</h3>
          <p>
            系统将按学校统一日志服务器要求，通过标准 syslog
            协议实时转发运行日志、业务操作事件、软硬件异常及 Linux 系统底层接口日志。
          </p>
          <p>
            日志覆盖应用程序运行、业务操作、异常告警、登录访问、权限变更、数据导入导出等关键事件，用于故障定位、风险监控、安全审计和操作溯源。
          </p>
          <p>
            日志留存时长不少于 6
            个月；涉及安全事件、审计调查、争议处理或法规要求的，可按学校制度延长留存期限。
          </p>
        </section>

        <section class="terms-section">
          <h3>四、数据使用与个人信息保护</h3>
          <p>权限分配和数据调取遵循最小必要原则，仅处理履行业务所需的数据和权限。</p>
          <p>
            涉密、涉敏数据及用户个人信息按照采集、使用、存储、传输、共享、导出、销毁全生命周期管控，不得超范围收集、滥用、私自留存、私自转发或用于未授权分析。
          </p>
          <p>
            因业务需要导出、下载、共享数据时，应确认接收方、用途、范围和保存期限，并遵守《个人信息保护法》、教育行业数据安全及涉密信息管理要求。
          </p>
        </section>

        <section class="terms-section">
          <h3>五、数据备份、恢复与容灾</h3>
          <p>
            系统按业务恢复要求执行自动备份，备份范围包括业务数据、配置数据、附件、审计日志及恢复所需的关键运行数据。
          </p>
          <p>
            备份方案适配学校两地三中心容灾架构，并遵循行业通用 3-2-1 原则：至少 3 份数据副本、2
            种不同存储介质、1 份异地保存。
          </p>
          <p>
            本地备份数据保留期限不少于 30
            天；备份周期、备份范围、技术方式和恢复流程按合同及学校运维制度落地执行。
          </p>
        </section>

        <section class="terms-section">
          <h3>六、保密与数据导出约束</h3>
          <p>
            用户对在系统中接触到的组织数据、业务数据、审批意见、统计结果、人员信息及其他非公开信息负有保密义务。
          </p>
          <p>
            未经授权，不得通过截图、下载、复制、接口调用、外部工具同步等方式将系统数据提供给无关人员、外部机构或非授权系统。
          </p>
        </section>

        <section class="terms-section">
          <h3>七、禁止行为</h3>
          <p>
            禁止绕过权限控制、冒用他人身份、批量抓取无关数据、篡改业务记录、上传恶意文件、攻击扫描系统、干扰日志记录或破坏备份恢复机制。
          </p>
          <p>
            发现账号异常、数据泄露、误操作、病毒勒索、系统故障或疑似安全事件时，应及时向管理员或学校指定运维渠道报告。
          </p>
        </section>

        <section class="terms-section">
          <h3>八、运维维护与服务连续性</h3>
          <p>
            为保障安全、稳定和合规运行，系统可进行例行维护、版本升级、配置调整、漏洞修复和应急处置。
          </p>
          <p>
            遇到安全风险、异常访问、数据风险或主管部门要求时，系统可按学校制度采取限制访问、冻结账号、暂停导出、保全日志等必要措施。
          </p>
        </section>

        <section class="terms-section">
          <h3>九、条款更新与用户确认</h3>
          <p>本条款可根据法律法规、学校制度、网络安全要求、等保测评要求和业务管理需要进行更新。</p>
          <p>
            继续登录表示你已阅读、理解并同意以上条款，承诺按授权范围使用系统和数据，并知悉所有操作可被记录、留存和用于合规审计。
          </p>
        </section>
      </div>

      <template #footer>
        <el-button @click="termsDialogVisible = false">关闭</el-button>
        <el-button type="primary" @click="acceptTerms">同意并继续</el-button>
      </template>
    </el-dialog>
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
const termsDialogVisible = ref(false)

// Form data
const formData = reactive<LoginFormState>({
  account: '',
  password: '',
  rememberMe: false,
  termsAccepted: false
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
  ],
  termsAccepted: [
    {
      validator: (_rule: unknown, value: boolean, callback: (error?: Error) => void) => {
        if (value) {
          callback()
          return
        }
        callback(new Error('请先阅读并同意服务条款'))
      },
      trigger: 'change'
    }
  ]
}

// Methods
const resetError = () => {
  // Error count is managed by parent component
}

const acceptTerms = () => {
  formData.termsAccepted = true
  termsDialogVisible.value = false
  formRef.value?.validateField('termsAccepted')
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

.terms-form-item {
  margin-bottom: var(--spacing-xl) !important;
}

.terms-checkbox {
  width: 100%;
  min-height: 44px;
  align-items: flex-start;
  white-space: normal;
}

.terms-checkbox :deep(.el-checkbox__input) {
  padding-top: 2px;
}

.terms-checkbox :deep(.el-checkbox__label) {
  display: block;
  white-space: normal;
  line-height: 1.5;
  color: var(--text-regular);
  font-size: 13px;
}

.terms-label {
  display: inline;
}

.terms-link {
  min-height: 24px;
  padding: 0;
  vertical-align: baseline;
  font-size: 13px;
  font-weight: 600;
}

.terms-content {
  max-height: min(60vh, 520px);
  overflow-y: auto;
  padding-right: var(--spacing-sm);
}

.terms-section + .terms-section {
  margin-top: var(--spacing-xl);
}

.terms-section h3 {
  margin: 0 0 var(--spacing-sm);
  color: var(--color-primary-dark);
  font-size: 15px;
  line-height: 1.4;
}

.terms-section p {
  margin: var(--spacing-xs) 0 0;
  color: var(--text-regular);
  font-size: 14px;
  line-height: 1.7;
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

@media (max-width: 480px) {
  .form-options {
    gap: var(--spacing-md);
  }

  .terms-content {
    max-height: 58vh;
  }
}
</style>
