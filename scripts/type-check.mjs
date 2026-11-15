#!/usr/bin/env node
/**
 * 类型检查闸门（type-check）
 *
 * 背景：旧的 `npm run type-check` 用的是 `vue-tsc --noEmit`，而根 tsconfig.json 是
 * solution-style（"files": [] + project references），这条命令对全仓零覆盖——
 * 写入类型错误仍然 exit 0，CI 的类型检查等于没有。
 *
 * 本脚本改用真正有效的 `vue-tsc -b --force`（覆盖 tsconfig.app.json + tsconfig.node.json），
 * 但仓库当前存在一批**存量类型错误**（见 scripts/typecheck-baseline.json），
 * 直接把 CI 判红会阻塞所有后续开发。因此这里按「不新增错误」的口径落地：
 *
 *   - 基线里没有的文件出现错误，或某个文件的错误数变多 → 判定为回归，exit 1；
 *   - 错误数不增（含修掉了一批） → exit 0，并把当前错误数作为可见指标输出；
 *   - 存量错误被修掉后，可用 `npm run type-check:baseline` 刷新基线。
 *
 * 用法：
 *   node scripts/type-check.mjs                  # 比对基线（CI / 本地默认）
 *   node scripts/type-check.mjs --update-baseline  # 刷新基线
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { dirname, join } from 'node:path'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = join(projectRoot, 'scripts', 'typecheck-baseline.json')
const vueTscBin = join(projectRoot, 'node_modules', 'vue-tsc', 'bin', 'vue-tsc.js')

/** 形如 `src/foo.ts(12,34): error TS2322: ...` 的错误行 */
const ERROR_LINE_RE = /^(.+?)\((\d+),(\d+)\): error (TS\d+):/

/**
 * 解析 vue-tsc 输出，统计每个文件的错误条数
 *
 * @param {string} output
 * @returns {Map<string, number>}
 */
export function parseErrorCounts(output) {
  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const line of String(output).split(/\r?\n/)) {
    const matched = ERROR_LINE_RE.exec(line)
    if (!matched) continue
    const file = matched[1]
    counts.set(file, (counts.get(file) ?? 0) + 1)
  }
  return counts
}

/**
 * 找出比基线更差的文件（新增文件或错误数变多）
 *
 * @param {Record<string, number>} baselineCounts
 * @param {Map<string, number>} currentCounts
 * @returns {{ file: string, baseline: number, current: number }[]}
 */
export function findRegressions(baselineCounts, currentCounts) {
  const regressions = []
  for (const [file, current] of currentCounts) {
    const baseline = baselineCounts[file] ?? 0
    if (current > baseline) {
      regressions.push({ file, baseline, current })
    }
  }
  return regressions.sort((a, b) => b.current - b.current || a.file.localeCompare(b.file))
}

/**
 * 找出比基线更好的文件（错误数变少），用于提示可以刷新基线
 *
 * @param {Record<string, number>} baselineCounts
 * @param {Map<string, number>} currentCounts
 * @returns {{ file: string, baseline: number, current: number }[]}
 */
export function findImprovements(baselineCounts, currentCounts) {
  const improvements = []
  for (const [file, baseline] of Object.entries(baselineCounts)) {
    const current = currentCounts.get(file) ?? 0
    if (current < baseline) {
      improvements.push({ file, baseline, current })
    }
  }
  return improvements.sort((a, b) => a.current - b.current || a.file.localeCompare(b.file))
}

/**
 * 执行真实的类型检查
 *
 * @returns {{ output: string, status: number }}
 */
function runTypeCheck() {
  if (!existsSync(vueTscBin)) {
    console.error('[type-check] 找不到 vue-tsc，请先执行 npm ci')
    process.exit(1)
  }
  const result = spawnSync(process.execPath, [vueTscBin, '-b', '--force'], {
    cwd: projectRoot,
    encoding: 'utf8'
  })
  return {
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    status: result.status ?? 1
  }
}

/**
 * 读取基线
 *
 * @returns {{ generatedAt: string, command: string, totalErrors: number, errorsByFile: Record<string, number> }}
 */
function readBaseline() {
  if (!existsSync(baselinePath)) {
    console.error(`[type-check] 缺少基线文件 ${baselinePath}，请执行 npm run type-check:baseline`)
    process.exit(1)
  }
  return JSON.parse(readFileSync(baselinePath, 'utf8'))
}

/**
 * 把统计结果写进 GitHub Actions 的步骤摘要，让错误数成为可见指标
 *
 * @param {string} content
 */
function appendStepSummary(content) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) return
  try {
    writeFileSync(summaryPath, `${content}\n`, { flag: 'a' })
  } catch {
    // 摘要写不进去不影响闸门结果
  }
}

function main() {
  const updateBaseline = process.argv.includes('--update-baseline')
  console.log('[type-check] 运行 vue-tsc -b --force ...')
  const { output } = runTypeCheck()
  const currentCounts = parseErrorCounts(output)
  const totalErrors = [...currentCounts.values()].reduce((sum, value) => sum + value, 0)

  if (updateBaseline) {
    /** @type {Record<string, number>} */
    const errorsByFile = {}
    for (const file of [...currentCounts.keys()].sort()) {
      errorsByFile[file] = currentCounts.get(file)
    }
    const baseline = {
      generatedAt: new Date().toISOString(),
      command: 'vue-tsc -b --force',
      totalErrors,
      errorsByFile
    }
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8')
    console.log(
      `[type-check] 基线已更新：${totalErrors} 个存量错误，${Object.keys(errorsByFile).length} 个文件`
    )
    appendStepSummary(
      `### 类型检查基线已刷新\n\n存量错误：**${totalErrors}** 个（${Object.keys(errorsByFile).length} 个文件）`
    )
    return 0
  }

  const baseline = readBaseline()
  const regressions = findRegressions(baseline.errorsByFile, currentCounts)
  const improvements = findImprovements(baseline.errorsByFile, currentCounts)

  console.log(
    `[type-check] 存量错误基线：${baseline.totalErrors}；本次检查：${totalErrors}` +
      `（${currentCounts.size} 个文件）`
  )
  appendStepSummary(
    `### 类型检查\n\n` +
      `- 存量错误基线（scripts/typecheck-baseline.json）：**${baseline.totalErrors}**\n` +
      `- 本次检查：**${totalErrors}**\n` +
      `- 相对基线新增：**${regressions.length}** 个文件\n` +
      `- 相对基线减少：**${improvements.length}** 个文件\n`
  )

  if (regressions.length > 0) {
    console.error('[type-check] 出现新的类型错误（相对基线）：')
    for (const item of regressions) {
      console.error(`  - ${item.file}: ${item.baseline} -> ${item.current}`)
    }
    console.error('[type-check] 如确认是基线过期，请执行 npm run type-check:baseline 刷新基线')
    return 1
  }

  if (improvements.length > 0) {
    console.log('[type-check] 以下文件的错误数少于基线（可刷新基线）：')
    for (const item of improvements) {
      console.log(`  - ${item.file}: ${item.baseline} -> ${item.current}`)
    }
    console.log('[type-check] 执行 npm run type-check:baseline 可以把基线收紧到当前水平')
  }

  console.log('[type-check] 通过：没有新增类型错误')
  return 0
}

if (process.argv[1] && process.argv[1].endsWith('type-check.mjs')) {
  process.exit(main())
}
