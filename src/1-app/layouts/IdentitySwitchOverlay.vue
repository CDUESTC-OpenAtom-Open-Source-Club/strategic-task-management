<script setup lang="ts">
/**
 * 切换身份过场遮罩
 *
 * 切换期间全屏遮罩，显示目标身份与当前步骤，拦截一切操作。
 * 渲染在根 router-view 之外（App.vue）：应用壳层在过场中卸载重挂，遮罩始终在场。
 */

import { computed } from 'vue'
import { Check, Loading } from '@element-plus/icons-vue'
import { formatIdentityLabel } from '@/features/auth/lib/identity'
import type { IdentitySwitchPhase } from '@/features/auth/model/store'
import type { IdentityDTO } from '@/features/auth/api/types'

const props = defineProps<{
  /** 目标身份 */
  target: IdentityDTO | null
  /** 当前进行到的阶段 */
  phase: IdentitySwitchPhase
}>()

/** 过场步骤，与 authStore.switchIdentity 的阶段一一对应 */
const STEPS: ReadonlyArray<{ phase: IdentitySwitchPhase; label: string }> = [
  { phase: 'request', label: '校验目标身份归属' },
  { phase: 'apply', label: '签发新身份登录凭证' },
  { phase: 'reset', label: '清除上一身份的页面数据' },
  { phase: 'navigate', label: '即将进入数据看板' }
]

const activeIndex = computed(() => STEPS.findIndex(step => step.phase === props.phase))

const isDone = (index: number) => index < activeIndex.value
const isActive = (index: number) => index === activeIndex.value
</script>

<template>
  <div
    class="identity-switch-overlay"
    role="alertdialog"
    aria-modal="true"
    aria-label="正在切换身份"
    aria-busy="true"
  >
    <div class="identity-switch-card">
      <div class="identity-switch-card__head">
        <div class="identity-switch-card__title">正在切换身份</div>
        <div class="identity-switch-card__target">
          {{ target ? formatIdentityLabel(target) : '' }}
        </div>
      </div>

      <ol class="identity-switch-steps">
        <li
          v-for="(step, index) in STEPS"
          :key="step.phase"
          class="identity-switch-step"
          :class="{ 'is-active': isActive(index), 'is-done': isDone(index) }"
          :aria-current="isActive(index) ? 'step' : undefined"
        >
          <span class="identity-switch-step__icon" aria-hidden="true">
            <el-icon v-if="isActive(index)" class="is-loading"><Loading /></el-icon>
            <el-icon v-else-if="isDone(index)"><Check /></el-icon>
          </span>
          <span>{{ step.label }}</span>
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
.identity-switch-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-overlay-color-lighter);
}

.identity-switch-card {
  width: 400px;
  overflow: hidden;
  background: var(--bg-white);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}

.identity-switch-card__head {
  padding: var(--spacing-lg) var(--spacing-xl);
  color: var(--bg-white);
  background: linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-primary) 100%);
}

.identity-switch-card__title {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
}

.identity-switch-card__target {
  margin-top: var(--spacing-xs);
  font-size: 13px;
  opacity: 0.9;
}

.identity-switch-steps {
  margin: 0;
  padding: var(--spacing-lg) var(--spacing-xl);
  list-style: none;
}

.identity-switch-step {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-sm) 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.identity-switch-step__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex: none;
  font-size: 14px;
  border: 2px solid var(--border-input);
  border-radius: 50%;
  color: var(--bg-white);
  transition: border-color var(--transition-fast);
}

.identity-switch-step.is-active {
  color: var(--text-main);
  font-weight: 600;
}

.identity-switch-step.is-active .identity-switch-step__icon {
  border-color: var(--color-primary);
  border-top-color: transparent;
}

.identity-switch-step.is-done {
  color: var(--text-regular);
}

.identity-switch-step.is-done .identity-switch-step__icon {
  background: var(--color-success);
  border-color: var(--color-success);
}
</style>
