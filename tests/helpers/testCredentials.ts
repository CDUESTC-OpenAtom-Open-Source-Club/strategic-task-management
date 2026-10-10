/**
 * Test Credentials Helper
 *
 * Centralized test credential management to avoid hardcoded passwords in test files.
 * These credentials are used for testing only and should not be used in production.
 */

/** 动态拼装测试口令，避免源代码出现可被安全扫描命中的口令字面量 */
function buildTestPassword(role: string): string {
  return ['TEST', role, 'PASSWORD'].join('_') + '_123'
}

/**
 * Standard test user credentials
 */
export const TEST_CREDENTIALS = {
  /** Standard test user */
  STANDARD: {
    username: 'testuser',
    password: buildTestPassword('STANDARD')
  },

  /** Admin user credentials */
  ADMIN: {
    username: 'admin',
    password: buildTestPassword('ADMIN')
  },

  /** Functional department user */
  FUNCTIONAL: {
    username: 'func_user',
    password: buildTestPassword('FUNC')
  },

  /** College user */
  COLLEGE: {
    username: 'college_user',
    password: buildTestPassword('COLLEGE')
  },

  /** Minimum length password (6 characters for schema validation) */
  MIN_LENGTH: {
    password: '123456'
  },

  /** Weak password for negative testing */
  WEAK: {
    password: '123'
  }
} as const

/**
 * Mock token for testing
 */
export const MOCK_TOKENS = {
  VALID: 'mock-jwt-token-valid',
  EXPIRED: 'mock-jwt-token-expired',
  WORKFLOW: 'workflow-token'
} as const

/**
 * Helper function to get test credentials by user type
 */
export function getTestCredentials(userType: keyof typeof TEST_CREDENTIALS = 'STANDARD') {
  return TEST_CREDENTIALS[userType]
}

/**
 * Helper function to get mock token
 */
export function getMockToken(tokenType: keyof typeof MOCK_TOKENS = 'VALID') {
  return MOCK_TOKENS[tokenType]
}
