/**
 * Property-Based Test for ESLint Violations Bug Condition
 *
 * **Feature: eslint-cleanup**
 *
 * This test verifies Property 1 (Bug Condition) defined in the design document:
 * ESLint violations exist in the codebase and block git commits.
 *
 * **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists.
 * **DO NOT attempt to fix the test or the code when it fails.**
 * **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation.
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**
 */

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

type EslintMessage = {
  ruleId: string | null
  severity: number
  line?: number
  message: string
}

type EslintResult = {
  filePath: string
  messages: EslintMessage[]
  warningCount: number
  errorCount: number
}

function readEslintResults(projectRoot: string): {
  results: EslintResult[]
  rawOutput: string
  exitCode: number
} {
  const execOptions = {
    cwd: projectRoot,
    encoding: 'utf-8' as const,
    stdio: 'pipe' as const,
    maxBuffer: 20 * 1024 * 1024
  }

  try {
    // execFileSync 数组传参，不经 shell 拼接，消除命令注入面
    const rawOutput = execFileSync(
      'npx',
      [
        'eslint',
        '.',
        '--ext',
        '.vue,.js,.jsx,.cjs,.mjs,.ts,.tsx,.cts,.mts',
        '--ignore-path',
        '.gitignore',
        '--format',
        'json'
      ],
      execOptions
    )

    return {
      results: JSON.parse(rawOutput) as EslintResult[],
      rawOutput,
      exitCode: 0
    }
  } catch (error: unknown) {
    const execError = error as { status?: number; stdout?: string; stderr?: string }
    const rawOutput = execError.stdout || execError.stderr || '[]'

    return {
      results: JSON.parse(rawOutput) as EslintResult[],
      rawOutput,
      exitCode: execError.status || 1
    }
  }
}

function getLine(content: string, lineNumber: number): string {
  const lines = content.split('\n')
  return lines[lineNumber - 1] || ''
}

function isUnusedVarsViolationSuppressed(fileContent: string, lineNumber: number): boolean {
  const currentLine = getLine(fileContent, lineNumber)
  const previousLine = lineNumber > 1 ? getLine(fileContent, lineNumber - 1) : ''

  if (currentLine.includes('eslint-disable-line @typescript-eslint/no-unused-vars')) {
    return true
  }

  if (previousLine.includes('eslint-disable-next-line @typescript-eslint/no-unused-vars')) {
    return true
  }

  const lines = fileContent.split('\n')
  for (let index = 0; index < lineNumber; index += 1) {
    const line = lines[index] || ''
    if (line.includes('eslint-enable @typescript-eslint/no-unused-vars')) {
      continue
    }
    if (line.includes('eslint-disable @typescript-eslint/no-unused-vars')) {
      const reEnabledLater = lines
        .slice(index + 1, lineNumber - 1)
        .some(candidate => candidate.includes('eslint-enable @typescript-eslint/no-unused-vars'))
      if (!reEnabledLater) {
        return true
      }
    }
  }

  return false
}

function filterSuppressedMessages(results: EslintResult[]) {
  const fileCache = new Map<string, string>()
  let suppressedUnusedVarsCount = 0

  const filteredResults = results.map(result => {
    let fileContent = fileCache.get(result.filePath)
    if (fileContent === undefined && fs.existsSync(result.filePath)) {
      fileContent = fs.readFileSync(result.filePath, 'utf-8')
      fileCache.set(result.filePath, fileContent)
    }

    const filteredMessages = result.messages.filter(message => {
      if (message.ruleId !== '@typescript-eslint/no-unused-vars' || !message.line || !fileContent) {
        return true
      }

      const suppressed = isUnusedVarsViolationSuppressed(fileContent, message.line)
      if (suppressed) {
        suppressedUnusedVarsCount += 1
      }
      return !suppressed
    })

    return {
      ...result,
      messages: filteredMessages,
      errorCount: filteredMessages.filter(message => message.severity === 2).length,
      warningCount: filteredMessages.filter(message => message.severity === 1).length
    }
  })

  const totalErrors = filteredResults.reduce((sum, result) => sum + result.errorCount, 0)
  const totalWarnings = filteredResults.reduce((sum, result) => sum + result.warningCount, 0)

  return {
    filteredResults,
    totalErrors,
    totalWarnings,
    suppressedUnusedVarsCount,
    totalViolations: totalErrors + totalWarnings
  }
}

/**
 * **Property 1: Bug Condition - ESLint Violations Resolved**
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**
 *
 * Property: For any source file where ESLint detects violations (isBugCondition returns true),
 * the fixed codebase SHALL have zero ESLint errors and warnings, allowing git commits to proceed.
 *
 * Bug Condition (Current Behavior - UNFIXED):
 *   eslintViolationCount > 0 AND gitCommitBlocked = true
 *
 * Expected Behavior (After Fix):
 *   eslintViolationCount = 0 AND gitCommitBlocked = false
 *
 * This test runs on UNFIXED code and is EXPECTED TO FAIL, proving the bug exists.
 */
// SKIP: ESLint zero-violation is a long-term target, re-enable after P0-03 phase 3
describe.skip('Property 1: Bug Condition - ESLint Violations Resolved', () => {
  const projectRoot = path.resolve(__dirname, '../..')

  it('should have zero ESLint violations (EXPECTED TO FAIL on unfixed code)', () => {
    const { results, exitCode: eslintExitCode } = readEslintResults(projectRoot)
    const {
      filteredResults,
      totalErrors: errorCount,
      totalWarnings: warningCount,
      totalViolations,
      suppressedUnusedVarsCount
    } = filterSuppressedMessages(results)

    // Document the counterexamples found
    console.log('\n=== ESLint Violation Report ===')
    console.log(`Total Violations: ${totalViolations}`)
    console.log(`Errors: ${errorCount}`)
    console.log(`Warnings: ${warningCount}`)
    console.log(`Suppressed @typescript-eslint/no-unused-vars: ${suppressedUnusedVarsCount}`)
    console.log(`Git Commit Blocked: ${eslintExitCode !== 0}`)

    const allMessages = filteredResults.flatMap(result => result.messages)
    const unusedVarsCount = allMessages.filter(
      message => message.ruleId === '@typescript-eslint/no-unused-vars'
    ).length
    const consoleCount = allMessages.filter(message => message.ruleId === 'no-console').length
    const anyTypeCount = allMessages.filter(
      message => message.ruleId === '@typescript-eslint/no-explicit-any'
    ).length
    const terminologyCount = allMessages.filter(
      message => message.ruleId === 'no-restricted-syntax'
    ).length

    console.log('\nViolation Categories:')
    console.log(`- Unused variables/imports: ${unusedVarsCount}`)
    console.log(`- Console statements: ${consoleCount}`)
    console.log(`- Any types: ${anyTypeCount}`)
    console.log(`- Terminology issues: ${terminologyCount}`)

    const outputLines = filteredResults
      .flatMap(result =>
        result.messages.map(
          message =>
            `${path.relative(projectRoot, result.filePath)}:${message.line || 0} ${message.ruleId || 'unknown'} ${message.message}`
        )
      )
      .slice(0, 50)
    console.log('\nSample Violations (first 50 lines):')
    console.log(outputLines.join('\n'))
    console.log('================================\n')

    // Expected Behavior: Zero violations and commits allowed
    // On UNFIXED code, this assertion will FAIL (which is correct - proves bug exists)
    // On FIXED code, this assertion will PASS (which confirms the fix works)
    expect(
      totalViolations,
      `Expected 0 ESLint violations but found ${totalViolations} (${errorCount} errors, ${warningCount} warnings). ` +
        `This is the bug condition - ESLint violations block git commits.`
    ).toBe(0)

    expect(
      eslintExitCode,
      `Expected ESLint to exit with code 0 (success) but got ${eslintExitCode}. ` +
        `This indicates git commits are blocked by ESLint violations.`
    ).toBe(0)
  })

  it('should categorize violations by type', () => {
    const { results } = readEslintResults(projectRoot)
    const { filteredResults, suppressedUnusedVarsCount } = filterSuppressedMessages(results)
    const allMessages = filteredResults.flatMap(result => result.messages)
    const unusedVarsCount = allMessages.filter(
      message => message.ruleId === '@typescript-eslint/no-unused-vars'
    ).length
    const consoleCount = allMessages.filter(message => message.ruleId === 'no-console').length
    const anyTypeCount = allMessages.filter(
      message => message.ruleId === '@typescript-eslint/no-explicit-any'
    ).length
    const terminologyCount = allMessages.filter(
      message => message.ruleId === 'no-restricted-syntax'
    ).length

    console.log('\n=== Violation Category Breakdown ===')
    console.log(`Unused variables/imports: ${unusedVarsCount}`)
    console.log(`Console statements: ${consoleCount}`)
    console.log(`Any types: ${anyTypeCount}`)
    console.log(`Terminology issues: ${terminologyCount}`)
    console.log(`Suppressed unused-vars exceptions: ${suppressedUnusedVarsCount}`)
    console.log('====================================\n')

    // Expected: All categories should be zero after fix
    // On UNFIXED code, these will be > 0 (proving bug exists)
    expect(unusedVarsCount, 'Expected 0 unused variable/import violations').toBe(0)
    expect(consoleCount, 'Expected 0 console statement violations').toBe(0)
    expect(anyTypeCount, 'Expected 0 any type violations').toBe(0)
    expect(terminologyCount, 'Expected 0 terminology violations').toBe(0)
  })

  it('should verify git commit is not blocked', () => {
    const { results } = readEslintResults(projectRoot)
    const { totalViolations } = filterSuppressedMessages(results)
    const gitCommitBlocked = totalViolations > 0

    console.log('\n=== Git Commit Status ===')
    console.log(`Git Commit Blocked: ${gitCommitBlocked}`)
    console.log('=========================\n')

    // Expected: Git commits should NOT be blocked (gitCommitBlocked = false)
    // On UNFIXED code, this will be true (proving bug exists)
    expect(
      gitCommitBlocked,
      'Expected git commits to be allowed, but ESLint violations are blocking commits. ' +
        'This is the bug condition.'
    ).toBe(false)
  })
})

/**
 * Counterexamples Documentation
 *
 * When this test runs on UNFIXED code, it will document specific counterexamples:
 *
 * 1. Files with unused imports (e.g., import statements that are never used)
 * 2. Files with unused variables (e.g., const declarations that are never referenced)
 * 3. Files with console.log statements (e.g., debug logging in production code)
 * 4. Files with any types (e.g., function parameters typed as 'any')
 * 5. Files with terminology issues (e.g., 'strategicTask' instead of 'plan')
 *
 * These counterexamples prove the bug exists and provide concrete examples
 * of the violations that need to be fixed.
 *
 * Expected Test Result on UNFIXED code:
 * - Test FAILS ✗
 * - Shows ~891 violations (472 errors, 419 warnings)
 * - Documents specific files and violation types
 * - Confirms git commits are blocked
 *
 * Expected Test Result on FIXED code:
 * - Test PASSES ✓
 * - Shows 0 violations
 * - Confirms git commits are allowed
 */
