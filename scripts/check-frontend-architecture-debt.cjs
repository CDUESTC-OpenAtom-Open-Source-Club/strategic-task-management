const fs = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const sourceRoot = path.join(projectRoot, 'src')
const baselinePath = path.join(__dirname, 'architecture-debt-baseline.json')

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue'])
const OLD_ENTRYPOINT_DIRECTORIES = [
  'src/api',
  'src/utils',
  'src/types',
  'src/composables',
  'src/router'
]
const PERMISSION_ENTRYPOINTS = [
  'src/5-shared/lib/authorization/usePermission.ts',
  'src/5-shared/lib/hooks/usePermission.ts',
  'src/5-shared/lib/permissions/usePermission.ts',
  'src/5-shared/lib/permissions/usePermission 2.ts'
]
const RESTRICTED_IMPORT_PATTERNS = [
  { id: 'legacy-api-alias', label: '@/api', regex: /['"]@\/api(?:\/|['"])/g },
  { id: 'legacy-utils-alias', label: '@/utils', regex: /['"]@\/utils(?:\/|['"])/g },
  { id: 'legacy-types-alias', label: '@/types', regex: /['"]@\/types(?:\/|['"])/g },
  {
    id: 'legacy-composables-alias',
    label: '@/composables',
    regex: /['"]@\/composables(?:\/|['"])/g
  },
  { id: 'legacy-router-alias', label: '@/router', regex: /['"]@\/router(?:\/|['"])/g },
  {
    id: 'shared-lib-api',
    label: '@/5-shared/lib/api',
    regex: /['"]@\/5-shared\/lib\/api(?:\/|['"])/g
  },
  {
    id: 'shared-lib-authorization',
    label: '@/5-shared/lib/authorization',
    regex: /['"]@\/5-shared\/lib\/authorization(?:\/|['"])/g
  },
  {
    id: 'shared-hooks-use-permission',
    label: '@/5-shared/lib/hooks/usePermission',
    regex: /['"]@\/5-shared\/lib\/hooks\/usePermission(?:\/|['"])/g
  },
  {
    id: 'legacy-indicator',
    label: '@/3-features/legacy-indicator',
    regex: /['"]@\/3-features\/legacy-indicator(?:\/|['"])/g
  }
]
const LARGE_VUE_FILE_THRESHOLD = 2500
const LARGE_TYPESCRIPT_FILE_THRESHOLD = 2500
const REPORT_LIMIT = 20
const APPROVED_DIRECT_NETWORK_FILES = new Set([
  'src/5-shared/api/client.ts',
  'src/5-shared/api/interceptors/responseInterceptors.ts',
  'src/5-shared/lib/utils/apiHealth.ts',
  'src/5-shared/lib/utils/tokenManager.ts',
  'src/5-shared/lib/utils/performance.ts'
])

function toPosix(filePath) {
  return filePath.split(path.sep).join('/')
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function walkFiles(dirPath, result = []) {
  if (!fs.existsSync(dirPath)) {
    return result
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    const relativePath = toPosix(path.relative(projectRoot, fullPath))

    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'coverage', '.git'].includes(entry.name)) {
        continue
      }
      walkFiles(fullPath, result)
      continue
    }

    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      continue
    }

    result.push({
      absolutePath: fullPath,
      relativePath
    })
  }

  return result
}

function getSourceFiles() {
  return walkFiles(sourceRoot).filter(file => !file.relativePath.endsWith('.d.ts'))
}

function scanTsNoCheck(files) {
  return files
    .filter(file => !file.relativePath.includes('/_deprecated/'))
    .filter(file => fs.readFileSync(file.absolutePath, 'utf8').includes('@ts-nocheck'))
    .map(file => file.relativePath)
    .sort()
}

function scanOldImports(files) {
  const violations = []

  for (const file of files) {
    const content = fs.readFileSync(file.absolutePath, 'utf8')
    for (const pattern of RESTRICTED_IMPORT_PATTERNS) {
      pattern.regex.lastIndex = 0
      const matches = content.match(pattern.regex)
      if (!matches) {
        continue
      }

      violations.push({
        file: file.relativePath,
        patternId: pattern.id,
        label: pattern.label,
        count: matches.length
      })
    }
  }

  return violations.sort((left, right) => {
    if (left.file === right.file) {
      return left.patternId.localeCompare(right.patternId)
    }
    return left.file.localeCompare(right.file)
  })
}

function scanLargeVueFiles(files) {
  return files
    .filter(file => file.relativePath.endsWith('.vue'))
    .map(file => {
      const lineCount = fs.readFileSync(file.absolutePath, 'utf8').split('\n').length
      return {
        file: file.relativePath,
        lineCount
      }
    })
    .sort((left, right) => right.lineCount - left.lineCount)
}

function scanLargeTypeScriptFiles(files) {
  return files
    .filter(file => file.relativePath.endsWith('.ts') || file.relativePath.endsWith('.tsx'))
    .map(file => {
      const lineCount = fs.readFileSync(file.absolutePath, 'utf8').split('\n').length
      return {
        file: file.relativePath,
        lineCount
      }
    })
    .sort((left, right) => right.lineCount - left.lineCount)
}

function countDirectoryFiles(relativeDirPath) {
  const absoluteDirPath = path.join(projectRoot, relativeDirPath)
  if (!fs.existsSync(absoluteDirPath)) {
    return 0
  }

  let total = 0
  for (const entry of fs.readdirSync(absoluteDirPath, { withFileTypes: true })) {
    const fullPath = path.join(absoluteDirPath, entry.name)
    if (entry.isDirectory()) {
      total += walkFiles(fullPath).length
      continue
    }
    total += 1
  }

  return total
}

function scanPermissionEntrypoints() {
  return PERMISSION_ENTRYPOINTS.filter(filePath => fs.existsSync(path.join(projectRoot, filePath)))
}

function scanDirectAxiosUsage(files) {
  const violations = []

  for (const file of files) {
    if (
      APPROVED_DIRECT_NETWORK_FILES.has(file.relativePath) ||
      file.relativePath.includes('/__tests__/')
    ) {
      continue
    }

    const content = fs.readFileSync(file.absolutePath, 'utf8')
    const importsAxiosRuntime =
      /import\s+axios(?:\s|,|\{)/.test(content) ||
      /import\s+\{[^}]*axios[^}]*\}\s+from\s+['"]axios['"]/.test(content)
    const usesAxiosRuntime = /\baxios\./.test(content) || /\baxios\s*\(/.test(content)
    const callsFetch = /\bfetch\s*\(/.test(content)

    if ((importsAxiosRuntime && usesAxiosRuntime) || callsFetch) {
      violations.push({
        file: file.relativePath,
        kind: importsAxiosRuntime && usesAxiosRuntime ? 'axios' : 'fetch'
      })
    }
  }

  return violations.sort((left, right) => left.file.localeCompare(right.file))
}

function printList(title, items, formatter = value => value) {
  console.log(`\n${title}`)
  if (items.length === 0) {
    console.log('  none')
    return
  }

  for (const item of items) {
    console.log(`  - ${formatter(item)}`)
  }
}

function serializeBaseline(tsNoCheckFiles, oldImportViolations, oversizedTypeScriptFiles) {
  return {
    generatedAt: new Date().toISOString(),
    tsNoCheckFiles,
    oldImportViolations: oldImportViolations.map(item => `${item.patternId}::${item.file}`),
    oversizedTypeScriptFiles: oversizedTypeScriptFiles.map(item => item.file)
  }
}

function main() {
  const shouldUpdateBaseline = process.argv.includes('--update-baseline')
  const sourceFiles = getSourceFiles()
  const tsNoCheckFiles = scanTsNoCheck(sourceFiles)
  const oldImportViolations = scanOldImports(sourceFiles)
  const largeVueFiles = scanLargeVueFiles(sourceFiles)
  const oversizedVueFiles = largeVueFiles.filter(file => file.lineCount > LARGE_VUE_FILE_THRESHOLD)
  const largeTypeScriptFiles = scanLargeTypeScriptFiles(sourceFiles)
  const oversizedTypeScriptFiles = largeTypeScriptFiles.filter(
    file => file.lineCount > LARGE_TYPESCRIPT_FILE_THRESHOLD
  )
  const topLevelEntrypointCounts = OLD_ENTRYPOINT_DIRECTORIES.map(dirPath => ({
    directory: dirPath,
    fileCount: countDirectoryFiles(dirPath)
  }))
  const permissionEntrypoints = scanPermissionEntrypoints()
  const directAxiosViolations = scanDirectAxiosUsage(sourceFiles)

  const baseline = fs.existsSync(baselinePath)
    ? readJson(baselinePath)
    : { tsNoCheckFiles: [], oldImportViolations: [], oversizedTypeScriptFiles: [] }

  const baselineTsNoCheckSet = new Set(baseline.tsNoCheckFiles || [])
  const baselineOldImportSet = new Set(baseline.oldImportViolations || [])
  const baselineOversizedTypeScriptSet = new Set(baseline.oversizedTypeScriptFiles || [])

  const newTsNoCheckFiles = tsNoCheckFiles.filter(file => !baselineTsNoCheckSet.has(file))
  const newOldImportViolations = oldImportViolations.filter(
    item => !baselineOldImportSet.has(`${item.patternId}::${item.file}`)
  )
  const newOversizedTypeScriptFiles = oversizedTypeScriptFiles.filter(
    item => !baselineOversizedTypeScriptSet.has(item.file)
  )

  console.log('Frontend architecture debt report')
  console.log(`Source files scanned: ${sourceFiles.length}`)
  console.log(`@ts-nocheck files: ${tsNoCheckFiles.length}`)
  console.log(`Old import violations: ${oldImportViolations.length}`)
  console.log(
    `Oversized Vue files (>${LARGE_VUE_FILE_THRESHOLD} lines): ${oversizedVueFiles.length}`
  )
  console.log(
    `Oversized TypeScript files (>${LARGE_TYPESCRIPT_FILE_THRESHOLD} lines): ${oversizedTypeScriptFiles.length}`
  )

  printList(
    'Largest Vue files',
    largeVueFiles.slice(0, REPORT_LIMIT),
    item => `${item.file} (${item.lineCount} lines)`
  )
  printList(
    'Largest TypeScript files',
    largeTypeScriptFiles.slice(0, REPORT_LIMIT),
    item => `${item.file} (${item.lineCount} lines)`
  )
  printList(
    'Top-level legacy entrypoint directories',
    topLevelEntrypointCounts,
    item => `${item.directory} (${item.fileCount} files)`
  )
  printList('Permission hook entrypoints', permissionEntrypoints)
  printList(
    'Direct network-call bypasses',
    directAxiosViolations,
    item => `${item.file} (${item.kind})`
  )
  printList('New @ts-nocheck files vs baseline', newTsNoCheckFiles)
  printList(
    'New old-import violations vs baseline',
    newOldImportViolations,
    item => `${item.file} -> ${item.label} (${item.count} matches)`
  )
  printList(
    'New oversized TypeScript files vs baseline',
    newOversizedTypeScriptFiles,
    item => `${item.file} (${item.lineCount} lines)`
  )

  if (shouldUpdateBaseline) {
    const updatedBaseline = serializeBaseline(
      tsNoCheckFiles,
      oldImportViolations,
      oversizedTypeScriptFiles
    )
    fs.writeFileSync(baselinePath, `${JSON.stringify(updatedBaseline, null, 2)}\n`)
    console.log(`\nBaseline updated: ${toPosix(path.relative(projectRoot, baselinePath))}`)
    process.exit(0)
  }

  if (
    newTsNoCheckFiles.length > 0 ||
    newOldImportViolations.length > 0 ||
    newOversizedTypeScriptFiles.length > 0
  ) {
    console.error('\nArchitecture debt baseline check failed.')
    console.error(
      'Remove the new debt or run the baseline update command after an approved review.'
    )
    process.exit(1)
  }

  console.log('\nArchitecture debt baseline check passed.')
}

main()
