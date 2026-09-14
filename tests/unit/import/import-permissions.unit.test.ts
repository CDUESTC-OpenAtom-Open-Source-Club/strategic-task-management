import { describe, expect, it } from 'vitest'
import { canAutoApproveImport } from '@/features/import/lib/importPermissions'

describe('canAutoApproveImport', () => {
  it('rejects reporter-only role list', () => {
    expect(canAutoApproveImport(['ROLE_REPORTER'])).toBe(false)
  })

  it('rejects department approver role (cannot bypass superiors)', () => {
    expect(canAutoApproveImport(['ROLE_APPROVER'])).toBe(false)
    expect(canAutoApproveImport(['ROLE_REPORTER', 'ROLE_APPROVER'])).toBe(false)
  })

  it('rejects empty or missing roles', () => {
    expect(canAutoApproveImport([])).toBe(false)
    expect(canAutoApproveImport(undefined)).toBe(false)
    expect(canAutoApproveImport(null)).toBe(false)
    expect(canAutoApproveImport('ROLE_REPORTER')).toBe(false)
  })

  it('allows each top-leader role', () => {
    expect(canAutoApproveImport(['ROLE_STRATEGY_DEPT_HEAD'])).toBe(true)
    expect(canAutoApproveImport(['ROLE_VICE_PRESIDENT'])).toBe(true)
    expect(canAutoApproveImport(['ROLE_SYSTEM_ADMIN'])).toBe(true)
  })

  it('allows combined reporter plus top-leader role', () => {
    expect(canAutoApproveImport(['ROLE_REPORTER', 'ROLE_VICE_PRESIDENT'])).toBe(true)
  })

  it('matches roles case-insensitively and tolerates whitespace', () => {
    expect(canAutoApproveImport([' role_vice_president '])).toBe(true)
    expect(canAutoApproveImport(['role_reporter'])).toBe(false)
  })
})
