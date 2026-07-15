import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const repoRoot = join(__dirname, '..', '..')
const frontendRoot = join(repoRoot, 'src')
const openApiPath = join(repoRoot, '..', 'sism-backend', 'openapi.json')

const compatibilityWhitelist = [
  { method: 'post', path: '/api/v1/auth/refresh' },
  { method: 'get', path: '/api/v1/actuator/health' },
  { method: 'post', path: '/api/v1/critical-endpoint' },
  { method: 'get', path: '/api/v1/milestones/{id}/pairing-status' },
  { method: 'post', path: '/api/v1/tasks/{id}/activate' },
  { method: 'post', path: '/api/v1/tasks/{id}/cancel' },
  { method: 'post', path: '/api/v1/indicators/distribute' },
  { method: 'post', path: '/api/v1/indicators/distribute/batch' },
  { method: 'get', path: '/api/v1/auth/permissions' },
  { method: 'get', path: '/api/v1/workflows/instances/entity/{id}/{id}/list' },
  { method: 'post', path: '/api/v1/indicators/{id}/reminders' },
  { method: 'post', path: '/api/v1/indicators/reminders/statuses' },
  { method: 'put', path: '/api/v1/auth/users/me/contact' },
  { method: 'post', path: '/api/v1/auth/password-reset/send' },
  { method: 'post', path: '/api/v1/auth/password-reset/verify' },
  { method: 'post', path: '/api/v1/auth/password-reset/confirm' },
  { method: 'put', path: '/api/v1/alerts/indicator/{id}/manual-level' }
] as const

function normalizePathLiteral(rawPath: string): string | null {
  if (!rawPath.startsWith('/')) {
    return null
  }

  const templatedPath = rawPath.replace(/\$\{[^}]+\}/g, '{id}')
  const pathWithoutQuery = templatedPath.replace(/\?.*$/, '')
  const withApiPrefix = pathWithoutQuery.startsWith('/api/v1')
    ? pathWithoutQuery
    : `/api/v1${pathWithoutQuery}`

  return withApiPrefix
}

function splitPathSegments(path: string): string[] {
  return path.split('/').filter(Boolean)
}

function matchesOpenApiPath(actualPath: string, specPath: string): boolean {
  const actualSegments = splitPathSegments(actualPath)
  const specSegments = splitPathSegments(specPath)

  if (actualSegments.length !== specSegments.length) {
    return false
  }

  return specSegments.every((segment, index) => {
    if (/^\{[^}]+\}$/.test(segment)) {
      return true
    }
    return segment === actualSegments[index]
  })
}

function isWhitelisted(method: string, path: string): boolean {
  return compatibilityWhitelist.some(
    item => item.method === method && matchesOpenApiPath(path, item.path)
  )
}

describe('OpenAPI alignment guard', () => {
  it('frontend config should use /api/v1 as base URL', () => {
    const configSource = readFileSync(join(frontendRoot, '5-shared', 'config', 'api.ts'), 'utf8')
    expect(configSource).toContain("'/api/v1'")
  })

  it('runtime source request paths should match OpenAPI or explicit compatibility whitelist', () => {
    const files = execSync(
      "rg --files src -g '!**/*.md' -g '!**/*.test.*' -g '!**/*.spec.*' -g '!**/back.back'",
      { cwd: repoRoot }
    )
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)

    const requestPattern =
      /\b(apiClient|api|axios|healthApi)\.(get|post|put|patch|delete)\s*(?:<[^>\n]+>)?\s*\(\s*([`'"])(.*?)\3/gs
    const spec = JSON.parse(readFileSync(openApiPath, 'utf8')) as {
      paths?: Record<string, Record<string, unknown>>
    }
    const pathEntries = Object.entries(spec.paths ?? {})
    const violations: string[] = []

    for (const file of files) {
      const source = readFileSync(join(repoRoot, file), 'utf8')
      for (const match of source.matchAll(requestPattern)) {
        const method = match[2].toLowerCase()
        const rawPath = match[4]
        const normalizedPath = normalizePathLiteral(rawPath)

        if (!normalizedPath || isWhitelisted(method, normalizedPath)) {
          continue
        }

        const matched = pathEntries.some(
          ([specPath, methods]) => matchesOpenApiPath(normalizedPath, specPath) && method in methods
        )

        if (!matched) {
          violations.push(`${file}: ${method.toUpperCase()} ${normalizedPath}`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('OpenAPI baseline should expose core aligned paths', () => {
    const spec = JSON.parse(readFileSync(openApiPath, 'utf8')) as {
      paths?: Record<string, unknown>
    }
    const paths = spec.paths ?? {}

    expect(paths['/api/v1/auth/users']).toBeDefined()
    expect(paths['/api/v1/profile/password']).toBeDefined()
    expect(paths['/api/v1/plans/{id}/publish']).toBeDefined()
    expect(paths['/api/v1/plans/{id}/archive']).toBeDefined()
  })
})
