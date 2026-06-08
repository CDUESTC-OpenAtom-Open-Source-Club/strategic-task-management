<template>
  <div class="basic-info">
    <el-form ref="formRef" :model="form" :rules="rules" label-width="120px" class="basic-info-form">
      <div class="avatar-section">
        <div class="avatar-upload">
          <AppAvatar
            :size="100"
            :src="form.avatar"
            :name="form.name || form.username || '用户'"
            class="user-avatar"
          />
          <el-upload
            class="avatar-uploader"
            :show-file-list="false"
            :before-upload="beforeAvatarUpload"
            :http-request="uploadAvatar"
            accept="image/jpeg,image/png,image/gif,image/webp"
          >
            <el-button size="small" type="primary" :loading="uploading">
              {{ uploading ? '上传中...' : '更换头像' }}
            </el-button>
          </el-upload>
        </div>
      </div>

      <el-form-item label="用户名" prop="username">
        <el-input v-model="form.username" disabled placeholder="用户名不可修改" />
      </el-form-item>

      <el-form-item label="姓名" prop="name">
        <el-input v-model="form.name" placeholder="请输入姓名" />
      </el-form-item>

      <el-form-item label="部门" prop="department">
        <el-input v-model="form.department" disabled placeholder="部门信息不可修改" />
      </el-form-item>

      <el-form-item label="角色" prop="roleDisplay">
        <div class="role-tag-list">
          <el-tag
            v-for="role in roleDisplayList"
            :key="role"
            type="info"
            effect="plain"
            class="role-tag-item"
          >
            {{ role }}
          </el-tag>
        </div>
      </el-form-item>

      <el-form-item label="邮箱" prop="email">
        <el-input v-model="form.email" placeholder="请输入邮箱地址" />
      </el-form-item>

      <el-form-item label="手机号" prop="phone">
        <el-input v-model="form.phone" placeholder="请输入手机号" />
      </el-form-item>

      <el-form-item>
        <el-button type="primary" @click="handleSubmit"> 保存修改 </el-button>
        <el-button @click="handleReset"> 重置 </el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { ElMessage, type FormInstance, type UploadRequestOptions } from 'element-plus'
import { useAuthStore } from '@/features/auth/model/store'
import AppAvatar from '@/shared/ui/avatar/AppAvatar.vue'
import { validateEmail, validatePhone, getRoleLabel } from '@/shared/lib/utils'
import { profileApi, type ProfileResponse } from '@/features/profile/api'
import type { User as _User, UserRole } from '@/shared/types'

const formRef = ref<FormInstance>()
const authStore = useAuthStore()

const form = reactive({
  username: '',
  name: '',
  department: '',
  role: 'strategic_dept' as UserRole,
  roleDisplay: '',
  email: '',
  phone: '',
  avatar: ''
})

const uploading = ref(false)

const roleDisplayList = computed(() =>
  form.roleDisplay
    .split('\n')
    .map(role => role.trim())
    .filter(Boolean)
)

const BUSINESS_ROLE_LABELS: Record<string, string> = {
  ROLE_REPORTER: '填报人',
  ROLE_APPROVER: '部门负责人',
  ROLE_STRATEGY_DEPT_HEAD: '战略发展部负责人',
  ROLE_VICE_PRESIDENT: '分管校领导',
  ROLE_SYSTEM_ADMIN: '系统管理员'
}

const rules = {
  name: [
    { required: true, message: '请输入姓名', trigger: 'blur' },
    { min: 2, max: 20, message: '姓名长度应在2-20个字符之间', trigger: 'blur' }
  ],
  email: [
    {
      validator: (_rule: unknown, value: string, callback: (error?: Error) => void) => {
        if (value && !validateEmail(value)) {
          callback(new Error('请输入正确的邮箱地址'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ],
  phone: [
    {
      validator: (_rule: unknown, value: string, callback: (error?: Error) => void) => {
        if (value && !validatePhone(value)) {
          callback(new Error('请输入正确的手机号'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ]
}

const beforeAvatarUpload = (file: File) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  const isImage = allowedTypes.includes(file.type)
  const isLt2M = file.size / 1024 / 1024 < 2

  if (!isImage) {
    ElMessage.error('头像只能是 JPG/PNG/GIF/WebP 格式的图片!')
    return false
  }
  if (!isLt2M) {
    ElMessage.error('头像大小不能超过 2MB!')
    return false
  }
  return true
}

const uploadAvatar = async (options: UploadRequestOptions) => {
  const { file } = options
  const selectedFile = file as File
  const previousAvatar = form.avatar

  // 本地预览
  const reader = new FileReader()
  reader.onload = e => {
    form.avatar = e.target?.result as string
  }
  reader.readAsDataURL(selectedFile)

  // 上传到服务器
  try {
    uploading.value = true
    const response = await profileApi.uploadAvatar(selectedFile)

    // 更新本地状态
    form.avatar = response.avatarUrl
    authStore.updateUserAvatar(response.avatarUrl)
    options.onSuccess?.(response)

    ElMessage.success('头像上传成功')
  } catch (error) {
    form.avatar = previousAvatar
    options.onError?.(error as Error)
    ElMessage.error('头像上传失败，请重试')
  } finally {
    uploading.value = false
  }
}

const handleSubmit = async () => {
  if (!formRef.value) {
    return
  }

  try {
    await formRef.value.validate()
    await profileApi.updateProfile({
      realName: form.name
    })
    await profileApi.updateContact({
      email: form.email || null,
      phone: form.phone || null
    })
    authStore.updateCurrentUser({
      realName: form.name,
      name: form.name,
      email: form.email || null,
      phone: form.phone || null
    })
    ElMessage.success('个人信息更新成功')
  } catch (error) {
    ElMessage.error('个人信息更新失败')
  }
}

const handleReset = () => {
  if (!formRef.value) {
    return
  }
  formRef.value.resetFields()
  void loadUserInfo()
}

const normalizeBusinessRoleLabel = (role: unknown): string => {
  const raw = typeof role === 'string' ? role.trim() : ''
  if (!raw) {
    return ''
  }
  return BUSINESS_ROLE_LABELS[raw] || raw
}

const buildRoleDisplayText = (roles: unknown[]): string => {
  return roles.map(normalizeBusinessRoleLabel).filter(Boolean).join('\n')
}

const buildFallbackRoleDisplay = (): string => {
  const backendRoles = Array.isArray(authStore.user?.roles)
    ? authStore.user.roles.map(normalizeBusinessRoleLabel).filter(Boolean)
    : []

  if (backendRoles.length > 0) {
    return backendRoles.join('\n')
  }

  return authStore.user?.role ? getRoleLabel(authStore.user.role) : ''
}

const applyAuthStoreFallback = () => {
  if (authStore.user) {
    Object.assign(form, authStore.user)
    form.roleDisplay = buildFallbackRoleDisplay()
    form.avatar =
      (authStore.user as { avatar?: string; avatarUrl?: string }).avatar ||
      (authStore.user as { avatar?: string; avatarUrl?: string }).avatarUrl ||
      ''
  }
}

const applyProfileResponse = (profile: ProfileResponse) => {
  form.username = profile.username || authStore.user?.username || ''
  form.name = profile.realName || authStore.user?.name || ''
  form.department = profile.orgName || authStore.user?.department || authStore.user?.orgName || ''
  form.email = profile.email || ''
  form.phone = profile.phone || ''
  form.roleDisplay =
    Array.isArray(profile.roles) && profile.roles.length > 0
      ? buildRoleDisplayText(profile.roles)
      : buildFallbackRoleDisplay()
  form.avatar =
    profile.avatarUrl ||
    profile.avatar ||
    (authStore.user as { avatar?: string; avatarUrl?: string } | null)?.avatar ||
    (authStore.user as { avatar?: string; avatarUrl?: string } | null)?.avatarUrl ||
    ''
}

const loadUserInfo = async () => {
  applyAuthStoreFallback()

  try {
    const profile = await profileApi.getProfile()
    applyProfileResponse(profile)
  } catch (error) {
    console.warn('[BasicInfo] Failed to load profile details, falling back to auth store', error)
  }
}

onMounted(() => {
  void loadUserInfo()
})
</script>

<style scoped>
.basic-info {
  max-width: 600px;
  margin: 0 auto;
}

.avatar-section {
  display: flex;
  justify-content: center;
  margin-bottom: 32px;
}

.avatar-upload {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.user-avatar {
  border: 3px solid var(--color-primary);
}

.avatar-uploader {
  display: flex;
  justify-content: center;
}

.basic-info-form {
  background: var(--bg-white);
  padding: 24px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
}

.role-tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
  min-height: 32px;
  padding-top: 4px;
}

.role-tag-item {
  margin: 0;
}
</style>
