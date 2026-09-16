/**
 * API 路径一致性属性测试
 *
 * **Feature: production-deployment-integration, Property 1: API 路径一致性**
 * **Validates: Requirements 1.1**
 */
import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'

const BACKEND_ENDPOINTS = {
  indicators: {
    getAll: { method: 'GET', path: '/api/indicators' },
    getById: { method: 'GET', path: '/api/indicators/{id}' },
    getByTask: { method: 'GET', path: '/api/indicators/task/{taskId}' },
    getRootByTask: { method: 'GET', path: '/api/indicators/task/{taskId}/root' },
    getByOwnerOrg: { method: 'GET', path: '/api/indicators/owner/{ownerOrgId}' },
    getByTargetOrg: { method: 'GET', path: '/api/indicators/target/{targetOrgId}' },
    search: { method: 'GET', path: '/api/indicators/search' },
    checkDistributionEligibility: {
      method: 'GET',
      path: '/api/indicators/{id}/distribution-eligibility'
    },
    distribute: { method: 'POST', path: '/api/indicators/{id}/distribute' },
    batchDistribute: { method: 'POST', path: '/api/indicators/{id}/distribute/batch' },
    getDistributed: { method: 'GET', path: '/api/indicators/{id}/distributed' }
  }
} as const

const FRONTEND_API_PATHS = {
  indicators: {
    getAll: '/indicators',
    getById: '/indicators/{id}',
    getByTask: '/indicators/task/{taskId}',
    getRootByTask: '/indicators/task/{taskId}/root',
    getByOwnerOrg: '/indicators/owner/{ownerOrgId}',
    getByTargetOrg: '/indicators/target/{targetOrgId}',
    search: '/indicators/search',
    checkDistributionEligibility: '/indicators/{id}/distribution-eligibility',
    distribute: '/indicators/{id}/distribute',
    batchDistribute: '/indicators/{id}/distribute/batch',
    getDistributed: '/indicators/{id}/distributed'
  }
} as const

function toFullApiPath(frontendPath: string): string {
  return `/api${frontendPath}`
}

function normalizePath(path: string): string {
  const pathWithoutQuery = path.split('?')[0]
  return pathWithoutQuery.replace(/\{[^}]+\}/g, '{param}')
}

function pathsMatch(frontendPath: string, backendPath: string): boolean {
  return normalizePath(toFullApiPath(frontendPath)) === normalizePath(backendPath)
}

describe('API Path Consistency Property Tests', () => {
  describe('Property 1: API 路径一致性', () => {
    it('should have matching backend endpoints for all frontend indicator API paths', () => {
      fc.assert(
        fc.property(fc.constantFrom(...Object.keys(FRONTEND_API_PATHS.indicators)), apiKey => {
          const frontendPath =
            FRONTEND_API_PATHS.indicators[apiKey as keyof typeof FRONTEND_API_PATHS.indicators]
          const backendEndpoint =
            BACKEND_ENDPOINTS.indicators[apiKey as keyof typeof BACKEND_ENDPOINTS.indicators]
          expect(backendEndpoint).toBeDefined()
          expect(pathsMatch(frontendPath, backendEndpoint.path)).toBe(true)
        }),
        { numRuns: 100 }
      )
    })

    it('should have all backend endpoints follow /api prefix convention', () => {
      const allBackendEndpoints: { controller: string; endpoint: string; path: string }[] = []
      for (const [controller, endpoints] of Object.entries(BACKEND_ENDPOINTS)) {
        for (const [endpoint, config] of Object.entries(endpoints)) {
          allBackendEndpoints.push({ controller, endpoint, path: config.path })
        }
      }
      fc.assert(
        fc.property(fc.constantFrom(...allBackendEndpoints), endpointInfo => {
          expect(endpointInfo.path.startsWith('/api/')).toBe(true)
        }),
        { numRuns: 100 }
      )
    })
  })

  describe('Path format validation', () => {
    it('should have valid path format for all endpoints', () => {
      const allPaths: string[] = []
      for (const endpoints of Object.values(FRONTEND_API_PATHS)) {
        for (const path of Object.values(endpoints)) {
          allPaths.push(path)
        }
      }
      fc.assert(
        fc.property(fc.constantFrom(...allPaths), path => {
          expect(path.startsWith('/')).toBe(true)
          expect(path.includes('//')).toBe(false)
          const paramMatches = path.match(/\{[^}]+\}/g) || []
          for (const param of paramMatches) {
            const paramName = param.slice(1, -1)
            expect(/^[a-zA-Z][a-zA-Z0-9]*$/.test(paramName)).toBe(true)
          }
        }),
        { numRuns: 100 }
      )
    })
  })
})
