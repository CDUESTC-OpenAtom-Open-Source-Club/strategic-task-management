#!/usr/bin/env node

/**
 * FSD Compliance Checker
 * Validates Feature-Sliced Design architecture rules
 */

const fs = require('fs')
const path = require('path')

const errors = []
const warnings = []

// Check feature structure
const featuresDir = path.join(__dirname, '../src/features')
const features = fs.readdirSync(featuresDir)

console.log('🔍 Checking FSD compliance...\n')

features.forEach(feature => {
  const featurePath = path.join(featuresDir, feature)
  if (!fs.statSync(featurePath).isDirectory()) {
    return
  }

  const hasApi = fs.existsSync(path.join(featurePath, 'api'))
  const hasModel = fs.existsSync(path.join(featurePath, 'model'))
  const hasUi = fs.existsSync(path.join(featurePath, 'ui'))

  if (!hasApi && !hasModel && !hasUi) {
    warnings.push(`Feature "${feature}" has no layers (api/model/ui)`)
  }
})

// Report results
console.log(`✅ Features checked: ${features.length}`)
console.log(`⚠️  Warnings: ${warnings.length}`)
console.log(`❌ Errors: ${errors.length}\n`)

if (warnings.length > 0) {
  console.log('Warnings:')
  warnings.forEach(w => console.log(`  - ${w}`))
}

if (errors.length > 0) {
  console.log('\nErrors:')
  errors.forEach(e => console.log(`  - ${e}`))
  process.exit(1)
}

console.log('\n✅ FSD compliance check passed!')
