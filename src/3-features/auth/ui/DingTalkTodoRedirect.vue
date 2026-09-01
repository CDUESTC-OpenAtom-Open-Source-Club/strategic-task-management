<template>
  <div class="dingtalk-todo-redirect">
    <el-icon class="is-loading" :size="28"><Loading /></el-icon>
    <p>正在打开审批页面…</p>
  </div>
</template>

<script setup lang="ts">
/**
 * 钉钉待办卡片「查看详情」按钮落地页。
 *
 * 卡片类型的按钮 URL 是固定模板，只能回传 sourceId 占位符，
 * 因此 sourceId 编码了业务标识：sism-approval-{type}-{entityId}-{instanceId}[-{stepId}]，
 * 此处解析后跳转到审批深链（免登由路由守卫完成）。
 */
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Loading } from '@element-plus/icons-vue'
import { openLinkInWorkbench } from '@/features/auth/lib/dingtalk'

const route = useRoute()
const router = useRouter()

const parseSourceId = (raw: unknown): RegExpMatchArray | null => {
  if (typeof raw !== 'string' || !raw) return null
  return raw.match(/^sism-approval-([A-Z_]+)-(\d+)-(\d+)(?:-(\d+))?$/)
}

const buildTargetRoute = () => {
  const fullscreen = route.query.dd_full_screen === 'true'
  const match = parseSourceId(route.query.sourceId)
  const query: Record<string, string> = { tab: 'approval' }
  if (fullscreen) {
    query.dd_full_screen = 'true'
  }
  if (match) {
    const [, entityType, entityId, instanceId] = match
    Object.assign(query, {
      openApproval: '1',
      approvalEntityType: entityType,
      approvalEntityId: entityId,
      approvalInstanceId: instanceId
    })
  }
  return { path: '/strategic-tasks', query }
}

onMounted(async () => {
  // PC 钉钉优先用工作台模式打开（占满主窗口）；移动端或失败则路由跳转
  const target = buildTargetRoute()
  const absoluteUrl = `${window.location.origin}${router.resolve(target).href}`
  const openedInWorkbench = await openLinkInWorkbench(absoluteUrl)
  if (!openedInWorkbench) {
    router.replace(target)
  }
})
</script>

<style scoped>
.dingtalk-todo-redirect {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 100vh;
  color: var(--el-text-color-secondary);
}
</style>
