import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  FALLBACK_VERSION,
  isPlaceholderVersion,
  normalizeVersion,
  resolveAppVersion
} from '../../scripts/resolve-app-version.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..', '..')

describe('构建期版本号解析（resolve-app-version）', () => {
  it('显式注入的环境变量优先级最高', () => {
    const version = resolveAppVersion({
      env: { VITE_APP_VERSION: '2.5.1' },
      runGit: () => 'v9.9.9'
    })

    expect(version).toBe('2.5.1')
  })

  it('显式注入带 v 前缀时自动去掉前缀', () => {
    const version = resolveAppVersion({
      env: { VITE_APP_VERSION: 'v2.5.1' },
      runGit: () => null
    })

    expect(version).toBe('2.5.1')
  })

  it('dev / unknown 只是占位值，会继续向下回落而不是直接生效', () => {
    expect(
      resolveAppVersion({
        env: { VITE_APP_VERSION: 'dev' },
        runGit: () => null
      })
    ).toBe(FALLBACK_VERSION)

    expect(
      resolveAppVersion({
        env: { VITE_APP_VERSION: 'unknown' },
        runGit: () => null
      })
    ).toBe(FALLBACK_VERSION)

    expect(
      resolveAppVersion({
        env: { VITE_APP_VERSION: 'dev' },
        runGit: () => 'v3.0.0'
      })
    ).toBe('3.0.0')
  })

  it('CI 从 tag 引用构建时采用 GITHUB_REF_NAME', () => {
    const version = resolveAppVersion({
      env: { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.4.1' },
      runGit: () => null
    })

    expect(version).toBe('1.4.1')
  })

  it('CI 从分支构建时不把分支名当版本号', () => {
    const version = resolveAppVersion({
      env: { GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'develop' },
      runGit: () => null
    })

    expect(version).toBe(FALLBACK_VERSION)
  })

  it('当前提交正好命中 tag 时采用该 tag', () => {
    const version = resolveAppVersion({
      env: {},
      runGit: args => (args[0] === 'describe' ? 'v1.4.1' : null)
    })

    expect(version).toBe('1.4.1')
  })

  it('没有命中 tag 时采用仓库中最新的发布 tag', () => {
    const version = resolveAppVersion({
      env: {},
      runGit: args => {
        if (args[0] === 'describe') return null
        return 'v1.4.1\nv1.4.0\nv1.3.0\n'
      }
    })

    expect(version).toBe('1.4.1')
  })

  it('仓库里没有任何 tag 时回落为 dev', () => {
    const version = resolveAppVersion({
      env: {},
      runGit: () => null
    })

    expect(version).toBe(FALLBACK_VERSION)
  })

  it('normalizeVersion 去掉首尾空白与前导 v', () => {
    expect(normalizeVersion(' v1.4.1 ')).toBe('1.4.1')
    expect(normalizeVersion('V1.4.1')).toBe('1.4.1')
    expect(normalizeVersion('')).toBeNull()
    expect(normalizeVersion(undefined)).toBeNull()
  })

  it('isPlaceholderVersion 识别占位值', () => {
    expect(isPlaceholderVersion('dev')).toBe(true)
    expect(isPlaceholderVersion('DEV')).toBe(true)
    expect(isPlaceholderVersion('unknown')).toBe(true)
    expect(isPlaceholderVersion('')).toBe(true)
    expect(isPlaceholderVersion('1.4.1')).toBe(false)
  })
})

describe('版本号不再由 .env 手工维护', () => {
  it('.env.example 不再声明 VITE_APP_VERSION', () => {
    const envExample = readFileSync(join(projectRoot, '.env.example'), 'utf-8')

    expect(envExample).not.toMatch(/^\s*VITE_APP_VERSION\s*=/m)
  })

  it('源码里不再出现硬编码的版本号回落值', () => {
    const appVersionSource = readFileSync(
      join(projectRoot, 'src', '5-shared', 'config', 'app-version.ts'),
      'utf-8'
    )

    expect(appVersionSource).toContain("import.meta.env['VITE_APP_VERSION'] || 'dev'")
    expect(appVersionSource).not.toMatch(/VITE_APP_VERSION'\]\s*\|\|\s*'\d+\.\d+\.\d+'/)
  })

  it('登录页页脚使用统一注入的版本号', () => {
    const loginViewSource = readFileSync(
      join(projectRoot, 'src', '3-features', 'auth', 'ui', 'LoginView.vue'),
      'utf-8'
    )

    expect(loginViewSource).toContain('APP_VERSION_LABEL')
    expect(loginViewSource).not.toMatch(/v\{\{\s*APP_VERSION\s*\}\}/)
  })
})
