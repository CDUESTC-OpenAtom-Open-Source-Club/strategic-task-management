<template>
  <div class="profile-view">
    <el-card class="profile-card">
      <el-tabs v-model="activeTab" class="profile-tabs">
        <el-tab-pane label="基本信息" name="basic">
          <BasicInfo />
        </el-tab-pane>
        <el-tab-pane label="修改密码" name="password">
          <ChangePassword />
        </el-tab-pane>
        <el-tab-pane label="通知设置" name="notification">
          <NotificationSettings />
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BasicInfo from './BasicInfo.vue'
import ChangePassword from './ChangePassword.vue'
import NotificationSettings from './NotificationSettings.vue'

const route = useRoute()
const router = useRouter()
const validTabs = ['basic', 'password', 'notification'] as const
type ProfileTab = (typeof validTabs)[number]

const normalizeTab = (tab: unknown): ProfileTab => {
  if (typeof tab === 'string' && validTabs.includes(tab as ProfileTab)) {
    return tab as ProfileTab
  }
  return 'basic'
}

const activeTab = ref<ProfileTab>(normalizeTab(route.query.tab))

watch(
  () => route.query.tab,
  tab => {
    const normalizedTab = normalizeTab(tab)
    if (activeTab.value !== normalizedTab) {
      activeTab.value = normalizedTab
    }
  },
  { immediate: true }
)

watch(activeTab, tab => {
  if (route.query.tab === tab) {
    return
  }

  void router.replace({
    query: {
      ...route.query,
      tab
    }
  })
})
</script>

<style scoped>
.profile-view {
  padding: 20px;
  max-width: 800px;
  margin: 0 auto;
}

.profile-card {
  border-radius: 8px;
}

.profile-tabs {
  margin-top: 10px;
}

:deep(.el-tabs__content) {
  padding: 20px 0;
}
</style>
