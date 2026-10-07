/* eslint-disable no-console */
/**
 * Unit Test Runner Script
 *
 * Runs all unit tests for the frontend architecture refactoring
 */

import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const testSuites = [
  // Shared lib tests
  'tests/unit/shared/lib/format/date.test.ts',
  'tests/unit/shared/lib/format/number.test.ts',
  'tests/unit/shared/lib/validation/validators.test.ts',

  // Feature store tests
  'tests/unit/features/auth/model/store.test.ts',
  'tests/unit/features/strategic-indicator/model/store.test.ts',

  // Feature lib tests
  'tests/unit/features/strategic-indicator/lib/calculations.test.ts',
  'tests/unit/features/strategic-indicator/lib/validations.test.ts'
]

console.log('🧪 Running Frontend Architecture Unit Tests...\n')

let totalPassed = 0
let totalFailed = 0
const failedSuites = []

for (const testSuite of testSuites) {
  console.log(`📋 Running: ${testSuite}`)

  try {
    // execFileSync 数组传参，不经 shell 拼接，消除命令注入面
    const result = execFileSync('npm', ['test', '--', testSuite], {
      encoding: 'utf8',
      cwd: join(__dirname, '../..')
    })

    // Parse results from vitest output
    const passedMatch = result.match(/(\d+) passed/)
    const failedMatch = result.match(/(\d+) failed/)

    const passed = passedMatch ? parseInt(passedMatch[1]) : 0
    const failed = failedMatch ? parseInt(failedMatch[1]) : 0

    totalPassed += passed
    totalFailed += failed

    if (failed > 0) {
      failedSuites.push(testSuite)
      console.log(`❌ ${testSuite}: ${passed} passed, ${failed} failed`)
    } else {
      console.log(`✅ ${testSuite}: ${passed} passed`)
    }
  } catch (error) {
    console.log(`❌ ${testSuite}: Error running tests`)
    failedSuites.push(testSuite)
    totalFailed += 1
  }

  console.log('')
}

console.log('📊 Test Summary:')
console.log(`✅ Total Passed: ${totalPassed}`)
console.log(`❌ Total Failed: ${totalFailed}`)

if (failedSuites.length > 0) {
  console.log('\n🚨 Failed Test Suites:')
  failedSuites.forEach(suite => console.log(`  - ${suite}`))
  process.exit(1)
} else {
  console.log('\n🎉 All tests passed!')
  process.exit(0)
}
