<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  ElCard,
  ElTable,
  ElTableColumn,
  ElTag,
  ElButton,
  ElInput,
  ElSelect,
  ElOption,
  ElMessage,
  ElMessageBox,
  ElDialog,
  ElForm,
  ElFormItem,
  ElSwitch,
  ElIcon,
  ElTreeSelect,
  type FormInstance,
  type FormRules
} from 'element-plus'
import {
  Plus,
  Edit,
  Search,
  Refresh,
  Lock,
  Unlock,
  User,
  Key,
  WarningFilled,
  QuestionFilled
} from '@element-plus/icons-vue'
import type { UserManagementItem, UserForm, Organization } from '@/shared/types'
import { apiClient as api } from '@/shared/api/client'
import { useAuthStore } from '@/features/auth/model/store'
import { useAuditLogStore } from '@/features/admin/model/auditLog'
import { logger } from '@/shared/lib/utils/logger'
import orgApi from '@/features/organization/api/org'

const authStore = useAuthStore()
const auditLogStore = useAuditLogStore()

type AdminOrganization = Organization & { sortOrder?: number }

interface UserListPageData {
  content: Record<string, unknown>[]
  totalElements?: number
  totalPages?: number
  number?: number
  size?: number
}

interface UserListResponseShape {
  data?: Record<string, unknown>[] | UserListPageData | { data?: UserListPageData }
}

const getCurrentOperatorName = () => authStore.user?.name || ''

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message
  }

  const message = (error as { response?: { data?: { message?: string } }; message?: string })
    .response?.data?.message
  return message || (error as { message?: string }).message || fallback
}

const resolveUserListPageData = (response: UserListResponseShape): UserListPageData | null => {
  if (Array.isArray(response.data)) {
    return {
      content: response.data
    }
  }
  if (response.data && 'content' in response.data) {
    return response.data
  }
  if (response.data && 'data' in response.data && response.data.data?.content) {
    return response.data.data
  }
  return null
}

/**
 * 用户管理组件
 *
 * 功能：
 * - 用户列表展示（分角色、组织筛选）
 * - 创建新用户
 * - 编辑用户信息
 * - 启用/禁用用户
 * - 重置密码
 */

// ============ 状态管理 ============
const loading = ref(false)
const users = ref<UserManagementItem[]>([])
const currentPage = ref(1)
const pageSize = ref(100)

// 搜索筛选
const searchKeyword = ref('')
const filterRole = ref<string | 'all'>('all')
const filterStatus = ref<'all' | 'active' | 'disabled'>('all')
const filterDepartment = ref<string | 'all'>('all')

// 对话框状态
const showUserDialog = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const editingUserId = ref<string | number | null>(null)

// 表单引用
const userFormRef = ref<FormInstance>()

// 表单数据
const userForm = ref<UserForm>({
  username: '',
  password: '',
  realName: '',
  email: '',
  phone: '',
  orgId: '',
  roles: [],
  status: 'active'
})

// 组织树数据
const organizationTree = ref<AdminOrganization[]>([])
const organizationLoading = ref(false)

const getOrganizationNameById = (orgId: string | number | null | undefined) => {
  const normalizedOrgId = String(orgId ?? '')
  if (!normalizedOrgId) {
    return ''
  }

  return organizationTree.value.find(org => String(org.id) === normalizedOrgId)?.name ?? ''
}

const getOrganizationTypeById = (orgId: string | number | null | undefined) => {
  const normalizedOrgId = String(orgId ?? '')
  if (!normalizedOrgId) {
    return ''
  }

  return organizationTree.value.find(org => String(org.id) === normalizedOrgId)?.type ?? ''
}

const resolveOrganizationName = (user: Record<string, unknown>) => {
  const directName = [user.orgName, user.department, user.organizationName].find(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  )

  return directName ?? getOrganizationNameById(user.orgId as string | number | null | undefined)
}

const hydrateUserOrganizationNames = () => {
  users.value = users.value.map(user => ({
    ...user,
    orgName: user.orgName || getOrganizationNameById(user.orgId)
  }))
}

// 密码相关
const passwordForm = ref<{
  userId: string | number
  newPassword: string
  confirmPassword: string
}>({
  userId: '',
  newPassword: '',
  confirmPassword: ''
})
const showPasswordDialog = ref(false)
const passwordFormRef = ref<FormInstance>()

// ============ 计算属性 ============

// 过滤后的用户列表
const filteredUsers = computed(() => {
  let result = users.value

  // 关键词搜索
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase()
    result = result.filter(
      u =>
        u.username.toLowerCase().includes(keyword) ||
        u.realName.toLowerCase().includes(keyword) ||
        u.orgName.toLowerCase().includes(keyword) ||
        (u.email && u.email.toLowerCase().includes(keyword))
    )
  }

  // 角色筛选
  if (filterRole.value !== 'all') {
    result = result.filter(u => u.roles.includes(filterRole.value as UserRole))
  }

  // 状态筛选
  if (filterStatus.value !== 'all') {
    result = result.filter(u => u.status === filterStatus.value)
  }

  // 部门筛选
  if (filterDepartment.value !== 'all') {
    result = result.filter(u => (u.orgName || '').trim() === filterDepartment.value)
  }

  return result
})

const paginatedUsers = computed(() => {
  const page = Math.max(currentPage.value, 1)
  const size = Math.max(pageSize.value, 1)
  const start = (page - 1) * size
  return filteredUsers.value.slice(start, start + size)
})

const strategicUserCount = computed(
  () =>
    filteredUsers.value.filter(user => getOrganizationTypeById(user.orgId) === 'strategic_dept')
      .length
)

const functionalUserCount = computed(
  () =>
    filteredUsers.value.filter(user => getOrganizationTypeById(user.orgId) === 'functional_dept')
      .length
)

const secondaryCollegeUserCount = computed(
  () =>
    filteredUsers.value.filter(user => getOrganizationTypeById(user.orgId) === 'secondary_college')
      .length
)

interface RoleListItem {
  id: number
  roleCode: string
  roleName: string
}

interface RoleListResponseShape {
  data?: {
    items?: RoleListItem[]
    content?: RoleListItem[]
    data?: {
      items?: RoleListItem[]
      content?: RoleListItem[]
    }
  }
}

const backendRoles = ref<RoleListItem[]>([])

const roleOptions = computed(() => [
  { value: 'all', label: '全部角色' },
  ...backendRoles.value.map(role => ({
    value: role.roleCode,
    label: role.roleName
  }))
])

// 状态选项
const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '禁用' }
]

const departmentTypeRank: Record<string, number> = {
  strategic_dept: 1,
  functional_dept: 2,
  secondary_college: 3
}

const getDepartmentSortRank = (type?: string) => departmentTypeRank[type || ''] ?? 99
const getNumericSortValue = (value: string | number | undefined) => {
  const numericValue = Number(value ?? NaN)
  return Number.isFinite(numericValue) ? numericValue : Number.MAX_SAFE_INTEGER
}

const inferDepartmentSortRank = (name: string) => {
  if (name.includes('战略发展部')) {
    return departmentTypeRank.strategic_dept
  }
  if (name.endsWith('学院') || name.includes('学院')) {
    return departmentTypeRank.secondary_college
  }
  return departmentTypeRank.functional_dept
}

const departmentOptions = computed(() => {
  const orgsByName = new Map<string, AdminOrganization>()

  organizationTree.value.forEach(org => {
    const name = org.name?.trim()
    if (name && !orgsByName.has(name)) {
      orgsByName.set(name, org)
    }
  })

  const fallbackOrgsByName = new Map<string, { name: string; orgId?: string | number }>()
  users.value.forEach(user => {
    const name = user.orgName?.trim()
    if (name && !orgsByName.has(name)) {
      const existing = fallbackOrgsByName.get(name)
      const existingSortValue = getNumericSortValue(existing?.orgId)
      const nextSortValue = getNumericSortValue(user.orgId)
      if (!existing || nextSortValue < existingSortValue) {
        fallbackOrgsByName.set(name, { name, orgId: user.orgId })
      }
    }
  })

  return [
    { value: 'all', label: '全部部门' },
    ...Array.from(orgsByName.values())
      .sort((left, right) => {
        const typeCompare = getDepartmentSortRank(left.type) - getDepartmentSortRank(right.type)
        if (typeCompare !== 0) {
          return typeCompare
        }

        const sortCompare = (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
        if (sortCompare !== 0) {
          return sortCompare
        }

        const idCompare = getNumericSortValue(left.id) - getNumericSortValue(right.id)
        if (idCompare !== 0) {
          return idCompare
        }

        return left.name.localeCompare(right.name, 'zh-CN')
      })
      .map(org => ({ value: org.name, label: org.name })),
    ...Array.from(fallbackOrgsByName.values())
      .sort((left, right) => {
        const typeCompare = inferDepartmentSortRank(left.name) - inferDepartmentSortRank(right.name)
        if (typeCompare !== 0) {
          return typeCompare
        }

        const idCompare = getNumericSortValue(left.orgId) - getNumericSortValue(right.orgId)
        if (idCompare !== 0) {
          return idCompare
        }

        return left.name.localeCompare(right.name, 'zh-CN')
      })
      .map(org => ({ value: org.name, label: org.name }))
  ]
})

// 获取角色配置
const getRoleConfig = (role: string) => {
  const matchedRole = backendRoles.value.find(item => item.roleCode === role)
  if (matchedRole) {
    return {
      label: matchedRole.roleName,
      type: 'info'
    }
  }

  return { label: role, type: 'default' }
}

// 获取状态配置
const getStatusConfig = (status: 'active' | 'disabled' | 'locked') => {
  const configs: Record<
    string,
    { label: string; type: string; icon: typeof Unlock | typeof Lock | typeof User }
  > = {
    active: { label: '启用', type: 'success', icon: Unlock },
    disabled: { label: '禁用', type: 'danger', icon: Lock },
    locked: { label: '锁定', type: 'warning', icon: Lock }
  }
  return configs[status] || { label: status, type: 'info', icon: User }
}

// 对话框标题
const dialogTitle = computed(() => {
  return dialogMode.value === 'create' ? '创建用户' : '编辑用户'
})

// 表单验证规则
const userFormRules: FormRules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 3, max: 20, message: '用户名长度为3-20个字符', trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9_]+$/, message: '用户名只能包含字母、数字和下划线', trigger: 'blur' }
  ],
  password: [
    {
      validator: (rule, value, callback) => {
        if (dialogMode.value === 'create' && !value) {
          callback(new Error('请输入密码'))
        } else if (value && value.length < 8) {
          callback(new Error('密码至少8个字符'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ],
  realName: [
    { required: true, message: '请输入真实姓名', trigger: 'blur' },
    { min: 2, max: 20, message: '姓名长度为2-20个字符', trigger: 'blur' }
  ],
  email: [
    {
      validator: (rule, value, callback) => {
        if (!value) {
          callback()
        } else if (
          !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(
            value
          )
        ) {
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
      validator: (rule, value, callback) => {
        if (!value) {
          callback()
        } else if (!/^1[3-9]\d{9}$/.test(value)) {
          callback(new Error('请输入正确的手机号'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ],
  orgId: [{ required: true, message: '请选择所属组织', trigger: 'change' }],
  roles: [
    {
      validator: (rule, value, callback) => {
        if (!value || value.length === 0) {
          callback(new Error('请至少选择一个角色'))
        } else {
          callback()
        }
      },
      trigger: 'change'
    }
  ]
}

// 密码表单验证规则
const passwordFormRules: FormRules = {
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, message: '密码至少8个字符', trigger: 'blur' },
    {
      pattern: /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#&]/,
      message: '密码需包含字母和数字',
      trigger: 'blur'
    }
  ],
  confirmPassword: [
    { required: true, message: '请确认新密码', trigger: 'blur' },
    {
      validator: (rule, value, callback) => {
        if (value !== passwordForm.value.newPassword) {
          callback(new Error('两次输入的密码不一致'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ]
}

// ============ 操作方法 ============

// 加载用户列表
const loadUsers = async () => {
  loading.value = true
  try {
    const baseParams = {
      size: 100,
      sortBy: 'id',
      sortOrder: 'asc'
    }
    const firstResponse = (await api.get('/auth/users', {
      params: {
        page: 0,
        ...baseParams
      }
    })) as UserListResponseShape

    const firstPageData = resolveUserListPageData(firstResponse)
    if (!firstPageData || !firstPageData.content) {
      throw new Error('响应数据格式错误')
    }

    const totalPages = Math.max(Number(firstPageData.totalPages ?? 1), 1)
    const allContent = [...firstPageData.content]

    if (totalPages > 1) {
      const remainingResponses = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, index) =>
          api.get('/auth/users', {
            params: {
              page: index + 1,
              ...baseParams
            }
          })
        )
      )

      remainingResponses.forEach(response => {
        const pageData = resolveUserListPageData(response as UserListResponseShape)
        if (pageData?.content?.length) {
          allContent.push(...pageData.content)
        }
      })
    }

    users.value = allContent.map((user: Record<string, unknown>) => ({
      id:
        typeof user.userId === 'string' || typeof user.userId === 'number'
          ? user.userId
          : typeof user.id === 'string' || typeof user.id === 'number'
            ? user.id
            : '',
      username: String(user.username ?? ''),
      realName: String(user.realName ?? user.name ?? ''),
      email: String(user.email ?? ''),
      phone: String(user.phone ?? ''),
      orgId: String(user.orgId ?? ''),
      orgName: resolveOrganizationName(user),
      roles: Array.isArray(user.roles)
        ? user.roles.map((r: string | { roleCode?: string; role?: string }) =>
            typeof r === 'string' ? r : (r.roleCode ?? r.role ?? '')
          )
        : [],
      status: (user.status ?? 'active') as UserManagementItem['status'],
      createdAt: String(user.createdAt ?? ''),
      updatedAt: String(user.updatedAt ?? '')
    }))
  } catch (error) {
    logger.error('加载用户列表失败:', error)
    ElMessage.error(getErrorMessage(error, '加载用户列表失败'))
  } finally {
    loading.value = false
  }
}

// 加载组织数据
const loadOrganizations = async () => {
  organizationLoading.value = true
  try {
    const departments = await orgApi.getAllDepartments()
    organizationTree.value = departments.map(dept => ({
      id: dept.id,
      name: dept.name,
      type: dept.type,
      sortOrder: dept.sortOrder,
      children: []
    }))
    hydrateUserOrganizationNames()
  } catch (error) {
    ElMessage.error('加载组织结构失败')
  } finally {
    organizationLoading.value = false
  }
}

const loadRoles = async () => {
  try {
    const response = (await api.get('/roles', {
      page: 0,
      pageSize: 100
    })) as RoleListResponseShape

    const roleItems = Array.isArray(response.data?.items)
      ? response.data.items
      : Array.isArray(response.data?.content)
        ? response.data.content
        : Array.isArray(response.data?.data?.items)
          ? response.data.data.items
          : Array.isArray(response.data?.data?.content)
            ? response.data.data.content
            : []

    backendRoles.value = roleItems.map(role => ({
      id: Number(role.id),
      roleCode: String(role.roleCode),
      roleName: String(role.roleName)
    }))
  } catch (error) {
    logger.error('加载角色列表失败:', error)
    ElMessage.error(getErrorMessage(error, '加载角色列表失败'))
  }
}

// 打开创建用户对话框
const openCreateDialog = () => {
  dialogMode.value = 'create'
  editingUserId.value = null
  resetUserForm()
  showUserDialog.value = true
}

// 打开编辑用户对话框
const openEditDialog = (user: UserManagementItem) => {
  dialogMode.value = 'edit'
  editingUserId.value = user.id

  userForm.value = {
    id: user.id,
    username: user.username,
    realName: user.realName,
    email: user.email,
    phone: user.phone,
    orgId: user.orgId,
    roles: [...user.roles],
    status: user.status === 'locked' ? 'disabled' : user.status
  }

  showUserDialog.value = true
}

// 重置表单
const resetUserForm = () => {
  userForm.value = {
    username: '',
    password: '',
    realName: '',
    email: '',
    phone: '',
    orgId: '',
    roles: [],
    status: 'active'
  }
  userFormRef.value?.clearValidate()
}

// 保存用户
const handleSave = async () => {
  if (!userFormRef.value) {
    return
  }

  try {
    await userFormRef.value.validate()
  } catch {
    ElMessage.warning('请完善表单信息')
    return
  }

  loading.value = true

  try {
    // 准备请求数据
    const userData: Record<string, unknown> = {
      username: userForm.value.username,
      realName: userForm.value.realName,
      email: userForm.value.email?.trim() || null,
      phone: userForm.value.phone?.trim() || null,
      orgId: Number(userForm.value.orgId),
      roles: userForm.value.roles
    }

    let result: { data?: Record<string, unknown> } | undefined
    if (dialogMode.value === 'create') {
      userData.password = userForm.value.password
      result = await api.post('/auth/users', userData)
      ElMessage.success('用户创建成功')

      // 记录审计日志
      try {
        auditLogStore.logAction({
          entityType: 'user',
          entityId: String(result?.data?.userId ?? result?.data?.id ?? ''),
          entityName: userData.realName as string,
          action: 'create_user',
          operator: String(authStore.user?.userId ?? ''),
          operatorName: getCurrentOperatorName(),
          dataAfter: {
            username: userData.username,
            realName: userData.realName,
            email: userData.email,
            orgId: userData.orgId,
            roles: userData.roles
          }
        })
      } catch (logError) {
        logger.warn('记录审计日志失败:', logError)
      }
    } else {
      // 获取原始数据用于审计日志
      const originalUser = users.value.find(u => u.id === editingUserId.value)

      result = await api.put(`/auth/users/${editingUserId.value}`, userData)
      ElMessage.success('用户信息更新成功')

      // 记录审计日志
      try {
        auditLogStore.logAction({
          entityType: 'user',
          entityId: String(editingUserId.value),
          entityName: userData.realName as string,
          action: 'update_user',
          operator: String(authStore.user?.userId ?? ''),
          operatorName: getCurrentOperatorName(),
          dataBefore: originalUser,
          dataAfter: userData
        })
      } catch (logError) {
        logger.warn('记录审计日志失败:', logError)
      }
    }

    showUserDialog.value = false
    await loadUsers()
  } catch (error: unknown) {
    logger.error('保存失败:', error)
    ElMessage.error(getErrorMessage(error, '操作失败，请重试'))
  } finally {
    loading.value = false
  }
}

// 取消对话
const handleCancel = () => {
  showUserDialog.value = false
  resetUserForm()
}

// 切换用户状态
const toggleUserStatus = async (user: UserManagementItem) => {
  const newStatus = user.status === 'active' ? 'disabled' : 'active'
  const actionText = newStatus === 'active' ? '启用' : '禁用'

  try {
    await ElMessageBox.confirm(
      `确定${actionText}用户「${user.realName}」吗？`,
      `${actionText}确认`,
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    if (newStatus === 'active') {
      await api.post(`/auth/users/${user.id}/unlock`)
    } else {
      await api.post(`/auth/users/${user.id}/lock`)
    }

    ElMessage.success(`${actionText}成功`)

    // 记录审计日志
    try {
      auditLogStore.logAction({
        entityType: 'user',
        entityId: String(user.id),
        entityName: user.realName,
        action: 'toggle_user_status',
        operator: String(authStore.user?.userId ?? ''),
        operatorName: getCurrentOperatorName(),
        dataBefore: { status: user.status },
        dataAfter: { status: newStatus }
      })
    } catch (logError) {
      logger.warn('记录审计日志失败:', logError)
    }

    await loadUsers()
  } catch (error: unknown) {
    if (error !== 'cancel') {
      logger.error('状态更新失败:', error)
      ElMessage.error(getErrorMessage(error, '操作失败'))
    }
  }
}

// 打开重置密码对话
const openPasswordDialog = (user: UserManagementItem) => {
  passwordForm.value = {
    userId: user.id,
    newPassword: '',
    confirmPassword: ''
  }
  showPasswordDialog.value = true
}

// 重置密码
const handleResetPassword = async () => {
  if (!passwordFormRef.value) {
    return
  }

  try {
    await passwordFormRef.value.validate()
  } catch {
    ElMessage.warning('请完善密码信息')
    return
  }

  loading.value = true

  try {
    void passwordForm.value.newPassword
    ElMessage.warning('当前接口文档未提供管理员重置密码能力，已停止发送无效请求')
    showPasswordDialog.value = false
  } catch (error: unknown) {
    logger.error('重置密码失败:', error)
    ElMessage.error(getErrorMessage(error, '密码重置失败，请重试'))
  } finally {
    loading.value = false
  }
}

// 刷新列表
const handleRefresh = async () => {
  await loadUsers()
  ElMessage.success('刷新成功')
}

const handlePageChange = async (page: number) => {
  currentPage.value = page
}

const handlePageSizeChange = async (size: number) => {
  pageSize.value = size
  currentPage.value = 1
}

watch(
  () => filteredUsers.value.length,
  total => {
    const maxPage = Math.max(Math.ceil(total / Math.max(pageSize.value, 1)), 1)
    if (currentPage.value > maxPage) {
      currentPage.value = maxPage
    }
  }
)

// 重置筛选
const resetFilter = () => {
  searchKeyword.value = ''
  filterRole.value = 'all'
  filterStatus.value = 'all'
  filterDepartment.value = 'all'
}

// ============ 生命周期 ============
onMounted(() => {
  loadUsers()
  loadOrganizations()
  loadRoles()
})
</script>

<template>
  <div class="user-management">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1 class="page-title">
          <el-icon><User /></el-icon>
          用户管理
        </h1>
        <p class="page-desc">管理系统用户账号、角色分配及权限控制</p>
      </div>
      <div class="header-actions">
        <ElButton type="primary" :icon="Plus" @click="openCreateDialog"> 创建用户 </ElButton>
        <ElButton :icon="Refresh" @click="handleRefresh">刷新</ElButton>
      </div>
    </div>

    <!-- 筛选栏 -->
    <div class="filter-bar">
      <div class="filter-left">
        <ElInput
          v-model="searchKeyword"
          placeholder="搜索用户名、姓名、邮箱..."
          :prefix-icon="Search"
          clearable
          class="search-input"
        />
        <ElSelect v-model="filterRole" placeholder="角色筛选" class="filter-select">
          <ElOption
            v-for="option in roleOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </ElSelect>
        <ElSelect v-model="filterStatus" placeholder="状态筛选" class="filter-select">
          <ElOption
            v-for="option in statusOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </ElSelect>
        <ElSelect v-model="filterDepartment" placeholder="部门筛选" class="filter-select">
          <ElOption
            v-for="option in departmentOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </ElSelect>
      </div>
      <div class="filter-right">
        <ElButton
          v-if="
            searchKeyword ||
            filterRole !== 'all' ||
            filterStatus !== 'all' ||
            filterDepartment !== 'all'
          "
          link
          @click="resetFilter"
        >
          重置筛选
        </ElButton>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-row">
      <ElCard class="stat-card" shadow="hover">
        <div class="stat-content">
          <div class="stat-value">{{ filteredUsers.length }}</div>
          <div class="stat-label">总用户数</div>
        </div>
      </ElCard>
      <ElCard class="stat-card" shadow="hover">
        <div class="stat-content">
          <div class="stat-value warning">{{ strategicUserCount }}</div>
          <div class="stat-label">战略部门用户</div>
        </div>
      </ElCard>
      <ElCard class="stat-card" shadow="hover">
        <div class="stat-content">
          <div class="stat-value success">{{ functionalUserCount }}</div>
          <div class="stat-label">职能部门用户</div>
        </div>
      </ElCard>
      <ElCard class="stat-card" shadow="hover">
        <div class="stat-content">
          <div class="stat-value info">{{ secondaryCollegeUserCount }}</div>
          <div class="stat-label">二级学院用户</div>
        </div>
      </ElCard>
    </div>

    <!-- 用户列表表格 -->
    <ElCard class="table-card" shadow="never">
      <ElTable v-loading="loading" :data="paginatedUsers" stripe class="user-table">
        <ElTableColumn prop="username" label="用户名" width="160">
          <template #default="{ row }">
            <div class="username-cell">
              <el-icon class="user-icon"><User /></el-icon>
              <span class="username">{{ row.username }}</span>
            </div>
          </template>
        </ElTableColumn>

        <ElTableColumn prop="realName" label="真实姓名" width="120">
          <template #default="{ row }">
            <span class="real-name">{{ row.realName }}</span>
          </template>
        </ElTableColumn>

        <ElTableColumn prop="email" label="邮箱" min-width="200">
          <template #default="{ row }">
            <span v-if="row.email" class="email">{{ row.email }}</span>
            <span v-else class="no-data">-</span>
          </template>
        </ElTableColumn>

        <ElTableColumn prop="orgName" label="所属组织" min-width="170">
          <template #default="{ row }">
            <span v-if="row.orgName" class="org-name">{{ row.orgName }}</span>
            <span v-else class="no-data">-</span>
          </template>
        </ElTableColumn>

        <ElTableColumn label="角色" width="125">
          <template #default="{ row }">
            <div class="roles-tags">
              <ElTag
                v-for="role in row.roles"
                :key="role"
                :type="getRoleConfig(role).type as any"
                size="small"
                effect="light"
              >
                {{ getRoleConfig(role).label }}
              </ElTag>
            </div>
          </template>
        </ElTableColumn>

        <ElTableColumn label="状态" width="110" align="center">
          <template #default="{ row }">
            <ElTag :type="getStatusConfig(row.status).type as any" effect="light" size="small">
              {{ getStatusConfig(row.status).label }}
            </ElTag>
          </template>
        </ElTableColumn>

        <ElTableColumn label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <div class="action-buttons">
              <ElButton type="primary" link :icon="Edit" @click="openEditDialog(row)">
                编辑
              </ElButton>
              <ElButton type="warning" link :icon="Key" @click="openPasswordDialog(row)">
                重置密码
              </ElButton>
              <ElButton
                :type="row.status === 'active' ? 'warning' : 'success'"
                link
                @click="toggleUserStatus(row)"
              >
                {{ row.status === 'active' ? '禁用' : '启用' }}
              </ElButton>
            </div>
          </template>
        </ElTableColumn>
      </ElTable>

      <!-- 空状态 -->
      <div v-if="!loading && filteredUsers.length === 0" class="empty-state">
        <el-empty :image-size="120">
          <template #description>
            <p class="empty-text">
              {{
                searchKeyword ||
                filterRole !== 'all' ||
                filterStatus !== 'all' ||
                filterDepartment !== 'all'
                  ? '没有找到匹配的用户'
                  : '暂无用户数据'
              }}
            </p>
          </template>
          <ElButton
            v-if="
              !searchKeyword &&
              filterRole === 'all' &&
              filterStatus === 'all' &&
              filterDepartment === 'all'
            "
            type="primary"
            :icon="Plus"
            @click="openCreateDialog"
          >
            创建第一个用户
          </ElButton>
        </el-empty>
      </div>

      <div v-if="filteredUsers.length > 0" class="pagination-wrapper">
        <el-pagination
          :current-page="currentPage"
          :page-size="pageSize"
          :page-sizes="[50, 100, 200]"
          :total="filteredUsers.length"
          layout="total, sizes, prev, pager, next, jumper"
          @current-change="handlePageChange"
          @size-change="handlePageSizeChange"
        />
      </div>
    </ElCard>

    <!-- 创建/编辑用户对话框 -->
    <ElDialog
      v-model="showUserDialog"
      :title="dialogTitle"
      width="600px"
      :close-on-click-modal="false"
      @closed="resetUserForm"
    >
      <ElForm
        ref="userFormRef"
        :model="userForm"
        :rules="userFormRules"
        label-width="100px"
        class="user-form"
      >
        <!-- 基本信息区域标题 -->
        <div class="form-section-title">基本信息</div>

        <!-- 用户名 -->
        <ElFormItem label="用户名" prop="username">
          <ElInput
            v-model="userForm.username"
            placeholder="请输入用户名"
            :disabled="dialogMode === 'edit'"
            maxlength="20"
            show-word-limit
          >
            <template #prefix>
              <el-icon><User /></el-icon>
            </template>
            <template #suffix>
              <el-tooltip content="编辑保存完一次之后不可更改" placement="top">
                <el-icon class="help-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </template>
          </ElInput>
        </ElFormItem>

        <!-- 密码（仅创建时显示） -->
        <ElFormItem v-if="dialogMode === 'create'" label="密码" prop="password">
          <ElInput
            v-model="userForm.password"
            type="password"
            placeholder="请输入密码"
            maxlength="32"
            show-password
          />
        </ElFormItem>

        <!-- 真实姓名 -->
        <ElFormItem label="真实姓名" prop="realName">
          <ElInput v-model="userForm.realName" placeholder="请输入真实姓名" maxlength="20" />
        </ElFormItem>

        <!-- 邮箱 -->
        <ElFormItem label="邮箱" prop="email">
          <ElInput v-model="userForm.email" type="email" placeholder="请输入邮箱地址" />
        </ElFormItem>

        <!-- 手机号 -->
        <ElFormItem label="手机号" prop="phone">
          <ElInput v-model="userForm.phone" placeholder="请输入手机号" maxlength="11" />
        </ElFormItem>

        <!-- 权限配置区域标题 -->
        <div class="form-section-title">权限配置</div>

        <!-- 所属组织 -->
        <ElFormItem label="所属组织" prop="orgId" required>
          <ElTreeSelect
            v-model="userForm.orgId"
            :data="organizationTree"
            :props="{ label: 'name', children: 'children' }"
            value-key="id"
            placeholder="请选择所属组织"
            :loading="organizationLoading"
            check-strictly
            clearable
            class="org-select"
          />
          <div class="form-hint warning">
            <el-icon><WarningFilled /></el-icon>
            所属组织决定该账号的数据访问权限
          </div>
        </ElFormItem>

        <!-- 角色 -->
        <ElFormItem label="角色" prop="roles" required>
          <ElSelect v-model="userForm.roles" multiple placeholder="请选择角色" class="roles-select">
            <ElOption
              v-for="opt in roleOptions.slice(1)"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            >
              <div class="role-option">
                <ElTag :type="opt.type as any" size="small" effect="light">
                  {{ opt.label }}
                </ElTag>
              </div>
            </ElOption>
          </ElSelect>
          <div class="form-hint">可选择多个角色，用户将拥有所有角色的权限</div>
        </ElFormItem>

        <!-- 状态-->
        <ElFormItem label="状态" prop="status">
          <ElSwitch
            v-model="userForm.status"
            active-value="active"
            inactive-value="disabled"
            active-text="启用"
            inactive-text="禁用"
          />
        </ElFormItem>
      </ElForm>

      <template #footer>
        <ElButton @click="handleCancel">取消</ElButton>
        <ElButton type="primary" :loading="loading" @click="handleSave">
          {{ dialogMode === 'create' ? '创建' : '保存' }}
        </ElButton>
      </template>
    </ElDialog>

    <!-- 重置密码对话框 -->
    <ElDialog
      v-model="showPasswordDialog"
      title="重置密码"
      width="450px"
      :close-on-click-modal="false"
    >
      <ElForm
        ref="passwordFormRef"
        :model="passwordForm"
        :rules="passwordFormRules"
        label-width="100px"
        class="password-form"
      >
        <ElFormItem label="新密码" prop="newPassword">
          <ElInput
            v-model="passwordForm.newPassword"
            type="password"
            placeholder="请输入新密码（至少8位，包含字母和数字）"
            show-password
          />
        </ElFormItem>

        <ElFormItem label="确认密码" prop="confirmPassword">
          <ElInput
            v-model="passwordForm.confirmPassword"
            type="password"
            placeholder="请再次输入新密码"
            show-password
          />
        </ElFormItem>

        <div class="password-requirements">
          <p class="requirements-title">密码要求</p>
          <ul class="requirements-list">
            <li>至少8个字符</li>
            <li>包含字母和数字</li>
            <li>可包含特殊字符@$!%*#&</li>
          </ul>
        </div>
      </ElForm>

      <template #footer>
        <ElButton @click="showPasswordDialog = false">取消</ElButton>
        <ElButton type="primary" @click="handleResetPassword"> 确认重置 </ElButton>
      </template>
    </ElDialog>
  </div>
</template>

<script lang="ts"></script>

<style scoped>
.user-management {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

/* 页面头部 */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--el-border-color-light);
}

.header-left {
  flex: 1;
}

.page-title {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 8px;
  font-size: 24px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.page-desc {
  margin: 0;
  font-size: 14px;
  color: var(--el-text-color-secondary);
}

.header-actions {
  display: flex;
  gap: 12px;
}

/* 筛选栏 */
.filter-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding: 16px;
  background: var(--el-bg-color-page);
  border-radius: var(--radius-md);
}

.filter-left {
  display: flex;
  gap: 12px;
  flex: 1;
}

.search-input {
  width: 280px;
}

.filter-select {
  width: 140px;
}

/* 统计卡片 */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 20px;
}

.stat-card {
  --el-card-padding: 20px;
}

.stat-content {
  text-align: center;
}

.stat-value {
  font-size: 32px;
  font-weight: 600;
  color: var(--el-color-primary);
  margin-bottom: 8px;
}

.stat-value.success {
  color: var(--el-color-success);
}

.stat-value.warning {
  color: var(--el-color-warning);
}

.stat-value.info {
  color: var(--el-color-info);
}

.stat-label {
  font-size: 14px;
  color: var(--el-text-color-secondary);
}

/* 表格 */
.table-card {
  margin-bottom: 20px;
}

.username-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-icon {
  color: var(--el-text-color-secondary);
}

.username {
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.real-name {
  font-weight: 500;
  color: var(--el-text-color-regular);
}

.email {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.org-name {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.roles-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.status-icon {
  margin-right: 4px;
  font-size: 12px;
}

.last-login {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.no-data {
  color: var(--el-text-color-placeholder);
}

.action-buttons {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: nowrap;
  white-space: nowrap;
}

.empty-state {
  padding: 40px 20px;
}

.pagination-wrapper {
  display: flex;
  justify-content: flex-end;
  padding-top: 16px;
}

.empty-text {
  margin: 0 0 16px;
  color: var(--el-text-color-secondary);
}

/* 表单样式 */
.user-form {
  padding: 8px 0;
}

.form-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 16px 0 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.form-section-title:first-child {
  margin-top: 0;
}

.form-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.form-hint.warning {
  color: var(--el-color-warning);
}

.org-select {
  width: 100%;
}

.roles-select {
  width: 100%;
}

.help-icon {
  cursor: help;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}

.help-icon:hover {
  color: var(--el-color-primary);
}

.role-option {
  display: flex;
  align-items: center;
}

.password-form {
  padding: 8px 0;
}

.password-requirements {
  padding: 12px;
  background: var(--el-fill-color-light);
  border-radius: var(--radius-sm);
  margin-top: 8px;
}

.requirements-title {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.requirements-list {
  margin: 0;
  padding-left: 20px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.requirements-list li {
  margin-bottom: 4px;
}
</style>
