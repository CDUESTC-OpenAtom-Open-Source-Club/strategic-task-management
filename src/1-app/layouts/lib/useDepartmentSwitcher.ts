import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/features/auth/model/store'
import { useOrgStore } from '@/features/organization/model/store'
import { resolveEffectiveLoginRole } from '@/shared/lib/permissions/strategicOrgAccess'
import type { UserRole } from '@/shared/types'

export interface DepartmentOption {
  value: string
  label: string
  role: UserRole
}

export function useDepartmentSwitcher() {
  const _router = useRouter()
  const authStore = useAuthStore()
  const orgStore = useOrgStore()

  const viewingDept = ref<string>('')
  const strategicDeptName = computed(() => orgStore.getStrategicDeptName())

  const deptOptions = computed<DepartmentOption[]>(() => {
    const options: DepartmentOption[] = []

    if (orgStore.strategicDept) {
      options.push({
        value: orgStore.strategicDept.name,
        label: orgStore.strategicDept.name,
        role: 'strategic_dept'
      })
    }

    orgStore.functionalDepartments.forEach(dept => {
      options.push({
        value: dept.name,
        label: dept.name,
        role: 'functional_dept'
      })
    })

    orgStore.colleges.forEach(college => {
      options.push({
        value: college.name,
        label: college.name,
        role: 'secondary_college'
      })
    })

    return options
  })

  const viewingRole = computed<UserRole>(() => {
    // 2026-11-24（返修·身份两层模型）：「登录身份是否战略部」按导航层归一口径
    // （resolveEffectiveLoginRole）判定——战略部组织账号（如只挂 ROLE_REPORTER 的
    // zlb_admin）同样获得切换器视角跟随；角色码原样保留给 API 数据层，不经此归一。
    if (resolveEffectiveLoginRole(authStore.user, authStore.userRole) !== 'strategic_dept') {
      return authStore.userRole || 'secondary_college'
    }

    const dept = deptOptions.value.find(item => item.value === viewingDept.value)
    return dept?.role || 'strategic_dept'
  })

  const viewingDeptName = computed(() => {
    const dept = deptOptions.value.find(item => item.value === viewingDept.value)
    return dept?.label || strategicDeptName.value
  })

  watch(
    [() => authStore.user, () => orgStore.loaded],
    ([user, loaded]) => {
      if (user && loaded && !viewingDept.value) {
        viewingDept.value =
          authStore.userRole === 'strategic_dept'
            ? strategicDeptName.value
            : user.department || strategicDeptName.value
      }
    },
    { immediate: true }
  )

  watch(viewingDept, newDept => {
    if (!newDept) {
      return
    }

    if (newDept === strategicDeptName.value) {
      authStore.resetViewingAs()
      return
    }

    const dept = deptOptions.value.find(item => item.value === newDept)
    if (dept) {
      authStore.setViewingAs(dept.role, newDept)
    }
  })

  return {
    viewingDept,
    viewingRole,
    viewingDeptName,
    deptOptions,
    strategicDeptName
  }
}
