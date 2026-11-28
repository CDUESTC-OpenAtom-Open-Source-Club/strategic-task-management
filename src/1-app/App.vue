<script setup lang="ts">
/**
 * Application Root
 *
 * 只负责渲染根路由。切换身份的过场中（authStore.identityShellSuspended），
 * 整棵应用壳层卸载、过场结束后重挂：页面局部状态随组件树复位，
 * 各视图在新身份下重新走一遍挂载加载。过场遮罩渲染在根 router-view 之外，
 * 所以壳层卸载时它仍然在场。
 */

import { useAuthStore } from '@/features/auth/model/store'
import IdentitySwitchOverlay from './layouts/IdentitySwitchOverlay.vue'

const authStore = useAuthStore()
</script>

<template>
  <router-view v-if="!authStore.identityShellSuspended" />
  <IdentitySwitchOverlay
    v-if="authStore.switching"
    :target="authStore.switchingTarget"
    :phase="authStore.switchingPhase"
  />
</template>
