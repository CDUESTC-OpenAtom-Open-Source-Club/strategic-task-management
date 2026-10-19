<script setup lang="ts">
import { computed, ref } from 'vue'

/**
 * 全文竖向看板：文本被截断时，在元素右侧弹出的完整内容面板。
 *
 * 2026-10-19 用户定案：与鼠标上方的属性提示（定性/定量、基础性/发展性）是两个
 * 独立显示框，互不干扰——属性提示仍由 el-tooltip 负责，本组件只负责右侧全文。
 * 不用嵌套 el-tooltip：Element Plus 的 ElOnlyChild 要求单元素根节点，嵌套会丢事件。
 */
const props = defineProps<{
  text: string
  /** 超过该字数才弹出，与列表里的 truncateText(text, maxChars) 保持一致 */
  maxChars?: number
}>()

const visible = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const panelStyle = ref<Record<string, string>>({})

const shouldShow = computed(() => {
  const limit = props.maxChars ?? 50
  return (props.text || '').length > limit
})

const PANEL_WIDTH = 320
const GAP = 10

function updatePosition() {
  const el = triggerRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const style: Record<string, string> = {
    position: 'fixed',
    'max-width': `${PANEL_WIDTH}px`,
    width: `${PANEL_WIDTH}px`,
    'max-height': '60vh',
    overflow: 'auto',
    'z-index': '3000'
  }

  // 右侧空间不足时翻到左侧，避免被视口裁掉
  if (rect.right + GAP + PANEL_WIDTH <= window.innerWidth) {
    style.left = `${rect.right + GAP}px`
  } else {
    style.left = `${Math.max(8, rect.left - GAP - PANEL_WIDTH)}px`
  }

  // 面板可能较长，顶部做上下夹取，保证首行可见
  style.top = `${Math.min(Math.max(8, rect.top), Math.max(8, window.innerHeight - 220))}px`
  panelStyle.value = style
}

function show() {
  if (!shouldShow.value) return
  updatePosition()
  visible.value = true
}

function hide() {
  visible.value = false
}
</script>

<template>
  <span ref="triggerRef" class="fulltext-panel-trigger" @mouseenter="show" @mouseleave="hide">
    <slot />
    <Teleport to="body">
      <div v-if="visible" class="fulltext-panel" :style="panelStyle">{{ text }}</div>
    </Teleport>
  </span>
</template>

<style>
.fulltext-panel-trigger {
  display: inline;
}

/* 传送到 body，不能用 scoped 样式 */
.fulltext-panel {
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid var(--el-border-color-light, #e4e7ed);
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.16);
  color: var(--el-text-color-regular, #606266);
  font-size: 13px;
  line-height: 1.65;
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
