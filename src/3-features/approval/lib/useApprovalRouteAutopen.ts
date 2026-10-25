import { computed, nextTick, onMounted, ref, watch, type ComputedRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const APPROVAL_ROUTE_QUERY_KEYS = [
  'openApproval',
  'approvalEntityType',
  'approvalEntityId',
  'approvalInstanceId',
  'approvalDepartment',
  // 2026-10-24（铃铛跳转修复）：上报方向判定需要下发方向的 source/target
  'approvalSourceOrg',
  'approvalTargetOrg'
] as const

type ApprovalRouteAutopenOptions<T extends string> = {
  supportedEntityTypes: readonly T[]
  onAutoOpen: () => Promise<void> | void
  onClearFailure?: (error: unknown) => void
}

type ApprovalRouteAutopenResult<T extends string> = {
  routeApprovalEntityType: ComputedRef<T | undefined>
  routeApprovalEntityId: ComputedRef<string | undefined>
  routeApprovalDepartment: ComputedRef<string | undefined>
  routeApprovalSourceOrg: ComputedRef<string | undefined>
  routeApprovalTargetOrg: ComputedRef<string | undefined>
  shouldAutoOpenApprovalFromRoute: ComputedRef<boolean>
}

const normalizeApprovalRouteQueryValue = (value: unknown): string | undefined => {
  const candidate = Array.isArray(value) ? value[0] : value
  const normalized = String(candidate ?? '').trim()
  return normalized || undefined
}

export function useApprovalRouteAutopen<T extends string>(
  options: ApprovalRouteAutopenOptions<T>
): ApprovalRouteAutopenResult<T> {
  const route = useRoute()
  const router = useRouter()
  const supportedEntityTypes = new Set(
    options.supportedEntityTypes.map(entityType => entityType.toUpperCase())
  )

  const routeApprovalEntityType = computed<T | undefined>(() => {
    const raw = normalizeApprovalRouteQueryValue(route.query.approvalEntityType)?.toUpperCase()
    if (!raw || !supportedEntityTypes.has(raw)) {
      return undefined
    }
    return raw as T
  })

  const routeApprovalEntityId = computed<string | undefined>(() =>
    normalizeApprovalRouteQueryValue(route.query.approvalEntityId)
  )

  const routeApprovalDepartment = computed<string | undefined>(() =>
    normalizeApprovalRouteQueryValue(route.query.approvalDepartment)
  )

  const routeApprovalSourceOrg = computed<string | undefined>(() =>
    normalizeApprovalRouteQueryValue(route.query.approvalSourceOrg)
  )

  const routeApprovalTargetOrg = computed<string | undefined>(() =>
    normalizeApprovalRouteQueryValue(route.query.approvalTargetOrg)
  )

  const shouldAutoOpenApprovalFromRoute = computed(() => {
    if (!routeApprovalEntityType.value || !routeApprovalEntityId.value) {
      return false
    }

    const raw = normalizeApprovalRouteQueryValue(route.query.openApproval)?.toLowerCase()
    return raw === '1' || raw === 'true' || raw === 'yes'
  })

  const approvalRouteAutopenConsumed = ref(false)

  const clearApprovalRouteQuery = async () => {
    const nextQuery = { ...route.query }

    for (const key of APPROVAL_ROUTE_QUERY_KEYS) {
      delete nextQuery[key]
    }

    try {
      await router.replace({ query: nextQuery })
    } catch (error) {
      options.onClearFailure?.(error)
    }
  }

  const maybeAutoOpenApprovalFromRoute = async () => {
    if (!shouldAutoOpenApprovalFromRoute.value || approvalRouteAutopenConsumed.value) {
      return
    }

    approvalRouteAutopenConsumed.value = true

    try {
      await options.onAutoOpen()
    } finally {
      await nextTick()
      await clearApprovalRouteQuery()
    }
  }

  watch(
    () => [
      shouldAutoOpenApprovalFromRoute.value,
      routeApprovalEntityType.value,
      routeApprovalEntityId.value
    ],
    () => {
      if (shouldAutoOpenApprovalFromRoute.value) {
        void maybeAutoOpenApprovalFromRoute()
        return
      }

      approvalRouteAutopenConsumed.value = false
    }
  )

  onMounted(() => {
    if (shouldAutoOpenApprovalFromRoute.value) {
      void maybeAutoOpenApprovalFromRoute()
    }
  })

  return {
    routeApprovalEntityType,
    routeApprovalEntityId,
    routeApprovalDepartment,
    routeApprovalSourceOrg,
    routeApprovalTargetOrg,
    shouldAutoOpenApprovalFromRoute
  }
}
