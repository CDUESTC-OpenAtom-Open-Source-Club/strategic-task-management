/**
 * Zod Schema 验证单元测试
 *
 * 测试 src/types/schemas.ts 中的 Zod 验证功能
 */

import { describe, it, expect } from 'vitest'
import {
  UserRoleSchema,
  UserSchema,
  StrategicIndicatorSchema,
  LoginCredentialsSchema,
  validateUser,
  validateIndicator,
  validateLoginCredentials
} from '@/shared/types/schemas'
import { TEST_CREDENTIALS } from '../helpers/testCredentials'

describe('Zod Schemas', () => {
  describe('UserRoleSchema', () => {
    it('should accept valid user roles', () => {
      expect(UserRoleSchema.parse('strategic_dept')).toBe('strategic_dept')
      expect(UserRoleSchema.parse('functional_dept')).toBe('functional_dept')
      expect(UserRoleSchema.parse('secondary_college')).toBe('secondary_college')
    })

    it('should reject invalid user roles', () => {
      expect(() => UserRoleSchema.parse('admin')).toThrow()
      expect(() => UserRoleSchema.parse('user')).toThrow()
      expect(() => UserRoleSchema.parse('')).toThrow()
    })
  })

  describe('UserSchema', () => {
    const validUser = {
      id: 'user-001',
      username: 'testuser',
      name: 'Test User',
      role: 'strategic_dept' as const,
      department: '战略发展部',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    }

    it('should accept valid user data', () => {
      const result = UserSchema.parse(validUser)
      expect(result.id).toBe('user-001')
      expect(result.role).toBe('strategic_dept')
    })

    it('should accept user with avatar', () => {
      const userWithAvatar = {
        ...validUser,
        avatar: 'https://example.com/avatar.jpg'
      }
      const result = UserSchema.parse(userWithAvatar)
      expect(result.avatar).toBe('https://example.com/avatar.jpg')
    })

    it('should reject user with missing required fields', () => {
      const incompleteUser = { ...validUser, id: '' }
      expect(() => UserSchema.parse(incompleteUser)).toThrow()
    })

    it('should reject user with invalid URL', () => {
      const userWithInvalidAvatar = {
        ...validUser,
        avatar: 'not-a-url'
      }
      expect(() => UserSchema.parse(userWithInvalidAvatar)).toThrow()
    })
  })

  describe('StrategicIndicatorSchema', () => {
    const validIndicator = {
      id: 'indicator-001',
      name: '测试指标',
      isQualitative: false,
      type1: '定量' as const,
      type2: '基础性' as const,
      progress: 50,
      createTime: '2024-01-01T00:00:00Z',
      weight: 25,
      targetValue: 100,
      actualValue: 50,
      unit: '分',
      responsibleDept: '战略发展部',
      responsiblePerson: '张三',
      status: 'DRAFT' as const,
      isStrategic: true,
      year: 2024,
      statusAudit: []
    }

    it('should accept valid indicator data', () => {
      const result = StrategicIndicatorSchema.parse(validIndicator)
      expect(result.id).toBe('indicator-001')
      expect(result.weight).toBe(25)
    })

    it('should accept indicator with parent', () => {
      const indicatorWithParent = {
        ...validIndicator,
        parentIndicatorId: 'parent-001'
      }
      const result = StrategicIndicatorSchema.parse(indicatorWithParent)
      expect(result.parentIndicatorId).toBe('parent-001')
    })

    it('should reject indicator with invalid weight', () => {
      const invalidIndicator = { ...validIndicator, weight: 150 }
      expect(() => StrategicIndicatorSchema.parse(invalidIndicator)).toThrow()
    })
  })

  describe('LoginCredentialsSchema', () => {
    it('should accept valid credentials', () => {
      const credentials = {
        username: 'testuser',
        password: TEST_CREDENTIALS.STANDARD.password
      }
      const result = LoginCredentialsSchema.parse(credentials)
      expect(result.username).toBe('testuser')
    })

    it('should reject empty username', () => {
      const credentials = {
        username: '',
        password: TEST_CREDENTIALS.STANDARD.password
      }
      expect(() => LoginCredentialsSchema.parse(credentials)).toThrow()
    })

    it('should reject short password', () => {
      const credentials = {
        username: 'testuser',
        password: TEST_CREDENTIALS.WEAK.password
      }
      expect(() => LoginCredentialsSchema.parse(credentials)).toThrow()
    })
  })

  describe('Validation Functions', () => {
    describe('validateUser', () => {
      it('should return success for valid user', () => {
        const userData = {
          id: 'user-001',
          username: 'testuser',
          name: 'Test User',
          role: 'strategic_dept' as const,
          department: '战略发展部',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }

        const result = validateUser(userData)
        expect(result.success).toBe(true)
        expect(result.data).toBeDefined()
      })

      it('should return errors for invalid user', () => {
        const invalidData = { foo: 'bar' }

        const result = validateUser(invalidData)
        expect(result.success).toBe(false)
        expect(result.errors).toBeDefined()
        expect(result.errors?.length).toBeGreaterThan(0)
      })
    })

    describe('validateIndicator', () => {
      it('should return success for valid indicator', () => {
        const indicatorData = {
          id: 'indicator-001',
          name: '测试指标',
          isQualitative: false,
          type1: '定量' as const,
          type2: '基础性' as const,
          progress: 50,
          createTime: '2024-01-01T00:00:00Z',
          weight: 25,
          targetValue: 100,
          actualValue: 50,
          unit: '分',
          responsibleDept: '战略发展部',
          responsiblePerson: '张三',
          status: 'DRAFT' as const,
          isStrategic: true,
          year: 2024,
          statusAudit: []
        }

        const result = validateIndicator(indicatorData)
        expect(result.success).toBe(true)
        expect(result.data).toBeDefined()
      })

      it('should return errors for invalid indicator', () => {
        const invalidData = { name: 'test' }

        const result = validateIndicator(invalidData)
        expect(result.success).toBe(false)
        expect(result.errors).toBeDefined()
      })
    })

    describe('validateLoginCredentials', () => {
      it('should return success for valid credentials', () => {
        const credentials = {
          username: 'testuser',
          password: TEST_CREDENTIALS.STANDARD.password
        }

        const result = validateLoginCredentials(credentials)
        expect(result.success).toBe(true)
        expect(result.data).toBeDefined()
      })

      it('should return errors for invalid credentials', () => {
        const credentials = {
          username: '',
          password: TEST_CREDENTIALS.WEAK.password
        }

        const result = validateLoginCredentials(credentials)
        expect(result.success).toBe(false)
        expect(result.errors).toBeDefined()
      })
    })
  })
})
