/**
 * 应用版本号（构建期注入）
 *
 * 版本号由构建期自动推导，来源优先级（从高到低）：
 *   1. 显式注入的环境变量 VITE_APP_VERSION（CI / Docker build-arg 传入）
 *   2. CI 的 tag 引用（GITHUB_REF_TYPE=tag 时的 GITHUB_REF_NAME）
 *   3. 当前提交正好命中某个 git tag
 *   4. 仓库中最新的发布 tag
 *   5. 兜底 dev
 *
 * 具体解析逻辑见 scripts/resolve-app-version.mjs（vite.config.ts 与 CI 共用）。
 * 约定：**禁止**在 .env / .env.example 里手工维护 VITE_APP_VERSION，
 * 否则会与真实构建版本脱节。
 */

/** 构建版本号；未注入时回落为 dev */
export const APP_VERSION = import.meta.env['VITE_APP_VERSION'] || 'dev'

/** 构建提交号；未注入时回落为 unknown */
export const APP_COMMIT_HASH = import.meta.env['VITE_APP_COMMIT_HASH'] || 'unknown'

/**
 * 展示用版本文案
 *
 * 语义化版本带 v 前缀（v1.4.1），dev / unknown 等占位值保持原样（dev）。
 */
export const APP_VERSION_LABEL =
  APP_VERSION === 'dev' || APP_VERSION === 'unknown' ? APP_VERSION : `v${APP_VERSION}`
