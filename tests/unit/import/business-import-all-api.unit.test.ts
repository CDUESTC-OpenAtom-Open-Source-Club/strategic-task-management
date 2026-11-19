import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 2026-11-19（学院全部导入 · 规划书 3.2③）：API 层新增两个调用。
 *
 * 契约：
 * · previewDistributionAll → POST /imports/distribution/all-preview（multipart）
 * · commitDistributionAll  → POST /imports/distribution/{batchId}/all-commit（JSON）
 *
 * 入参清洗沿用既有 compactUploadParams（null 会序列化成字符串 "null" 导致后端 400）。
 */

const uploadSpy = vi.hoisted(() => vi.fn(async () => ({ data: { batchId: 'b1' } })))
const postSpy = vi.hoisted(() => vi.fn(async () => ({ data: { results: [], summary: {} } })))

vi.mock('@/shared/api/client', () => ({
  apiClient: {
    upload: uploadSpy,
    post: postSpy
  }
}))

import { businessImportApi } from '@/features/import/api/businessImport'

const readSource = (relative: string): string =>
  readFileSync(resolve(process.cwd(), relative), 'utf8')

const makeFile = () => new File(['binary'], 'plan.xlsx', { type: 'application/octet-stream' })

beforeEach(() => {
  uploadSpy.mockClear()
  postSpy.mockClear()
})

describe('import/api/businessImport · 全部导入（all-preview / all-commit）', () => {
  it('previewDistributionAll 走 all-preview 端点并传 multipart 附加参数', async () => {
    await businessImportApi.previewDistributionAll(makeFile(), {
      cycleId: 7,
      targetCollegeOrgId: 56,
      sourceOrgId: 35
    })

    expect(uploadSpy).toHaveBeenCalledTimes(1)
    const [url, , params] = uploadSpy.mock.calls[0] as [string, File, Record<string, unknown>]
    expect(url).toBe('/imports/distribution/all-preview')
    expect(params.cycleId).toBe(7)
    expect(params.targetCollegeOrgId).toBe(56)
    expect(params.sourceOrgId).toBe(35)
  })

  it('全部导入预览**不传** functionalOrgId（归口由文件「职能部门」列解析）', async () => {
    await businessImportApi.previewDistributionAll(makeFile(), {
      cycleId: 7,
      targetCollegeOrgId: 56
    })

    const params = uploadSpy.mock.calls[0][2] as Record<string, unknown>
    expect('functionalOrgId' in params).toBe(false)
  })

  it('可选参数未指定（null / undefined）→ 整个键不进 FormData（null 序列化成 "null" 会让后端 400）', async () => {
    await businessImportApi.previewDistributionAll(makeFile(), {
      cycleId: 7,
      targetCollegeOrgId: 56,
      sourceOrgId: undefined
    })

    const params = uploadSpy.mock.calls[0][2] as Record<string, unknown>
    expect('sourceOrgId' in params).toBe(false)
  })

  it('commitDistributionAll 走 all-commit 端点并带 confirmToken / autoSubmitAndApprove', async () => {
    await businessImportApi.commitDistributionAll('batch-1', {
      confirmToken: 'token-xyz',
      autoSubmitAndApprove: true
    })

    expect(postSpy).toHaveBeenCalledTimes(1)
    const [url, body] = postSpy.mock.calls[0] as [string, Record<string, unknown>]
    expect(url).toBe('/imports/distribution/batch-1/all-commit')
    expect(body).toMatchObject({ confirmToken: 'token-xyz', autoSubmitAndApprove: true })
  })

  it('batchId 含特殊字符时 URL 编码（与既有 commit 口径一致）', async () => {
    await businessImportApi.commitDistributionAll('a/b c', { confirmToken: 't' })

    const [url] = postSpy.mock.calls[0] as [string]
    expect(url).toBe('/imports/distribution/a%2Fb%20c/all-commit')
  })
})

describe('import/api/businessImport · DTO 契约（源码锁，防止改名漂移）', () => {
  const source = readSource('src/3-features/import/api/businessImport.ts')

  it('全部导入 DTO 字段名固定（规划书第二节契约，前端不得改名）', () => {
    expect(source).toContain('functionalOrgId: number | null')
    expect(source).toContain('functionalOrgName: string | null')
    expect(source).toContain("status: 'SUCCESS' | 'SKIPPED' | 'FAILED'")
    expect(source).toContain('planId: number | null')
    expect(source).toContain('basicWeightTotal: number')
    expect(source).toContain('rowsCount: number')
    expect(source).toContain('groupError: string | null')
    expect(source).toContain('skipReason: string | null')
    expect(source).toContain('unassignedRows: ImportRowPreview[]')
    expect(source).toContain('blocking: boolean')
  })

  it('线状态枚举固定（NONE/DRAFT/PENDING/IN_REVIEW/DISTRIBUTED）', () => {
    expect(source).toContain(
      "export type ImportGroupLineStatus = 'NONE' | 'DRAFT' | 'PENDING' | 'IN_REVIEW' | 'DISTRIBUTED'"
    )
  })
})
