#!/usr/bin/env node
/**
 * 构建期应用版本号解析（Node 侧，供 vite.config.ts / CI / Docker 构建复用）
 *
 * 背景：登录页页脚展示的版本号过去来自 .env 里手工维护的 VITE_APP_VERSION，
 * 每次发版都要手改一次 env，导致「标签（git tag）与实际发布版本脱节」。
 * 本模块把版本号改为构建期自动推导，.env 不再需要维护版本号。
 *
 * 解析优先级（从高到低）：
 *   1. 显式注入的环境变量 VITE_APP_VERSION（CI / Docker build-arg 传入）
 *   2. CI 的 tag 引用（GITHUB_REF_TYPE=tag 时的 GITHUB_REF_NAME）
 *   3. 当前提交正好命中某个 tag（git describe --tags --exact-match）
 *   4. 仓库中最新的发布 tag（git tag --list 'v*' --sort=-v:refname）
 *   5. 任意最近的 tag（git describe --tags --abbrev=0）
 *   6. 兜底 dev
 *
 * 说明：dev / unknown 被视为「未显式指定」，会继续向下回落，
 * 避免 Dockerfile 里 ARG VITE_APP_VERSION=dev 的默认值把真实版本盖掉。
 *
 * 用法：
 *   node scripts/resolve-app-version.mjs      # 打印解析出的版本号
 *   import { resolveAppVersion } from './scripts/resolve-app-version.mjs'
 */

import { execFileSync } from 'node:child_process'

/** 兜底版本号：没有任何 tag / 显式注入时使用 */
export const FALLBACK_VERSION = 'dev'

/** 被视作「未显式指定」的占位值 */
const PLACEHOLDER_VERSIONS = new Set(['', 'dev', 'unknown'])

/**
 * 去掉版本号前导的 v / V，并去掉首尾空白
 *
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function normalizeVersion(raw) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withoutPrefix = trimmed.replace(/^v/i, '')
  return withoutPrefix || null
}

/**
 * 判断某个值是否只是占位（dev / unknown / 空）
 *
 * @param {string | null | undefined} value
 * @returns {boolean}
 */
export function isPlaceholderVersion(value) {
  if (typeof value !== 'string') return true
  return PLACEHOLDER_VERSIONS.has(value.trim().toLowerCase())
}

/**
 * 默认的 git 调用实现：失败一律返回 null（不抛异常）
 *
 * @param {string[]} args
 * @returns {string | null}
 */
function defaultRunGit(args) {
  try {
    const stdout = execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      cwd: process.cwd()
    })
    const trimmed = stdout.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

/**
 * 解析构建版本号
 *
 * @param {{ env?: Record<string, string | undefined>, runGit?: (args: string[]) => string | null }} [options]
 * @returns {string}
 */
export function resolveAppVersion(options = {}) {
  const env = options.env || process.env
  const runGit = options.runGit || defaultRunGit

  // 1. 显式注入（CI / Docker build-arg）
  const explicit = normalizeVersion(env.VITE_APP_VERSION)
  if (explicit && !isPlaceholderVersion(explicit)) {
    return explicit
  }

  // 2. CI tag 引用
  if (env.GITHUB_REF_TYPE === 'tag') {
    const fromRef = normalizeVersion(env.GITHUB_REF_NAME)
    if (fromRef && !isPlaceholderVersion(fromRef)) {
      return fromRef
    }
  }

  // 3. 当前提交正好命中 tag
  const exact = normalizeVersion(runGit(['describe', '--tags', '--exact-match']))
  if (exact && !isPlaceholderVersion(exact)) {
    return exact
  }

  // 4. 仓库中最新的发布 tag
  const tagList = runGit(['tag', '--list', 'v*', '--sort=-v:refname'])
  if (tagList) {
    const latest = tagList
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)[0]
    const fromTags = normalizeVersion(latest)
    if (fromTags && !isPlaceholderVersion(fromTags)) {
      return fromTags
    }
  }

  // 5. 任意最近的 tag
  const nearest = normalizeVersion(runGit(['describe', '--tags', '--abbrev=0']))
  if (nearest && !isPlaceholderVersion(nearest)) {
    return nearest
  }

  // 6. 兜底
  return FALLBACK_VERSION
}

/**
 * 是否作为脚本被直接执行（用于打印结果）
 *
 * @returns {boolean}
 */
function isRunningAsScript() {
  const entry = process.argv[1]
  if (!entry) return false
  return entry.replace(/\\/g, '/').endsWith('resolve-app-version.mjs')
}

if (isRunningAsScript()) {
  process.stdout.write(`${resolveAppVersion()}\n`)
}
