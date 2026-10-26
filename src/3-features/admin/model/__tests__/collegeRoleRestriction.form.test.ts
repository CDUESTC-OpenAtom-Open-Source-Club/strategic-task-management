import { describe, expect, it } from 'vitest'
import { computed, nextTick, ref, watch } from 'vue'
import {
  COLLEGE_VICE_PRESIDENT_ERROR_MESSAGE,
  VICE_PRESIDENT_ROLE_CODE,
  filterRolesForOrg
} from '../collegeRoleRestriction'

/**
 * 组件级行为验证：复刻 UserManagement.vue 中的表单联动逻辑——
 * 组织类型或角色变化时，若为学院且含分管校领导则自动移除并报错。
 * 目的：不依赖 Element Plus 渲染层，纯验证联动语义与组件实现一致。
 */
function createUserFormLike(orgTypeOf: (orgId: string) => string) {
  const errors: string[] = []
  const userForm = ref<{ orgId: string; roles: string[] }>({ orgId: '', roles: [] })

  const applyRestriction = (): boolean => {
    const result = filterRolesForOrg(userForm.value.roles, orgTypeOf(userForm.value.orgId))
    if (!result.removed) {
      return false
    }
    userForm.value.roles = result.roles
    errors.push(COLLEGE_VICE_PRESIDENT_ERROR_MESSAGE)
    return true
  }

  watch(
    () => [userForm.value.orgId, [...userForm.value.roles].join(',')],
    () => {
      applyRestriction()
    }
  )

  return { userForm, errors, applyRestriction }
}

describe('用户表单的学院/分管校领导联动', () => {
  it('学院下选择分管校领导会被自动移除并报错', async () => {
    const orgTypeOf = (orgId: string) => (orgId === '59' ? 'secondary_college' : 'strategic_dept')
    const { userForm, errors } = createUserFormLike(orgTypeOf)

    userForm.value.orgId = '59'
    await nextTick()
    userForm.value.roles = [VICE_PRESIDENT_ROLE_CODE]
    await nextTick()

    expect(userForm.value.roles).toEqual([])
    expect(errors).toContain(COLLEGE_VICE_PRESIDENT_ERROR_MESSAGE)
  })

  it('先选角色再选学院同样被拦截', async () => {
    const orgTypeOf = (orgId: string) => (orgId === '59' ? 'secondary_college' : 'strategic_dept')
    const { userForm, errors } = createUserFormLike(orgTypeOf)

    userForm.value.roles = [VICE_PRESIDENT_ROLE_CODE]
    await nextTick()
    expect(userForm.value.roles).toEqual([VICE_PRESIDENT_ROLE_CODE])

    userForm.value.orgId = '59'
    await nextTick()
    expect(userForm.value.roles).toEqual([])
    expect(errors.length).toBeGreaterThan(0)
  })

  it('战略发展部选分管校领导不受影响', async () => {
    const orgTypeOf = () => 'strategic_dept'
    const { userForm, errors } = createUserFormLike(orgTypeOf)

    userForm.value.orgId = '35'
    await nextTick()
    userForm.value.roles = [VICE_PRESIDENT_ROLE_CODE]
    await nextTick()

    expect(userForm.value.roles).toEqual([VICE_PRESIDENT_ROLE_CODE])
    expect(errors).toHaveLength(0)
  })

  it('学院下其他角色正常保留', async () => {
    const orgTypeOf = (orgId: string) => (orgId === '59' ? 'secondary_college' : 'strategic_dept')
    const { userForm, errors } = createUserFormLike(orgTypeOf)

    userForm.value.orgId = '59'
    await nextTick()
    userForm.value.roles = ['ROLE_REPORTER', 'ROLE_APPROVER']
    await nextTick()

    expect(userForm.value.roles).toEqual(['ROLE_REPORTER', 'ROLE_APPROVER'])
    expect(errors).toHaveLength(0)
  })
})
