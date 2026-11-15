import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import ts from 'typescript'

import { findRegressions, parseErrorCounts } from '../../scripts/type-check.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..', '..')
const vueTscBin = join(projectRoot, 'node_modules', 'vue-tsc', 'bin', 'vue-tsc.js')

/**
 * 读取 tsconfig（允许 JSONC 注释）
 */
function readJsonConfig(configPath: string): Record<string, unknown> {
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
  if (configFile.error) {
    throw new Error(`无法解析 ${configPath}: ${configFile.error.messageText}`)
  }
  return configFile.config as Record<string, unknown>
}

describe('类型检查命令覆盖范围', () => {
  it('根 tsconfig 是 solution-style，说明旧的 vue-tsc --noEmit 零覆盖', () => {
    const rootTsconfig = readJsonConfig(join(projectRoot, 'tsconfig.json'))

    expect(rootTsconfig.files ?? []).toEqual([])
    expect(Array.isArray(rootTsconfig.references)).toBe(true)
    expect(rootTsconfig.references.length).toBeGreaterThan(0)
  })

  it('tsconfig.app.json 覆盖 src 下的 ts 与 vue 源码', () => {
    const appTsconfig = readJsonConfig(join(projectRoot, 'tsconfig.app.json'))

    expect(appTsconfig.include).toContain('src/**/*.ts')
    expect(appTsconfig.include).toContain('src/**/*.vue')
  })

  it('type-check 脚本不再使用零覆盖的 vue-tsc --noEmit', () => {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'))

    expect(pkg.scripts['type-check']).not.toBe('vue-tsc --noEmit')
    expect(pkg.scripts['type-check']).toContain('scripts/type-check.mjs')
    expect(pkg.scripts['type-check:strict']).toContain('vue-tsc -b')
    expect(pkg.scripts['type-check:baseline']).toContain('--update-baseline')
  })

  it('vue-tsc -b 能检出写进去的类型错误（探针契约）', () => {
    expect(existsSync(vueTscBin), 'vue-tsc 未安装，请先执行 npm ci').toBe(true)

    const fixtureDir = mkdtempSync(join(tmpdir(), 'type-check-probe-'))
    try {
      writeFileSync(
        join(fixtureDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            moduleResolution: 'bundler',
            noEmit: true,
            strict: true,
            skipLibCheck: true
          },
          include: ['probe.ts']
        }),
        'utf-8'
      )
      writeFileSync(
        join(fixtureDir, 'probe.ts'),
        "export const probe: number = 'not-a-number'\n",
        'utf-8'
      )

      const result = spawnSync(
        process.execPath,
        [vueTscBin, '-b', join(fixtureDir, 'tsconfig.json')],
        { encoding: 'utf8' }
      )
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`

      expect(result.status).not.toBe(0)
      expect(output).toContain('probe.ts')
      expect(output).toMatch(/error TS\d+/)
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true })
    }
  })
})

describe('类型检查基线比对', () => {
  it('解析 vue-tsc 输出并按文件统计错误数', () => {
    const output = [
      "src/a.ts(1,2): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/a.ts(3,4): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/b.vue(5,6): error TS2339: Property 'x' does not exist on type 'Y'.",
      'Found 3 errors in 2 files.'
    ].join('\n')

    const counts = parseErrorCounts(output)

    expect(counts.get('src/a.ts')).toBe(2)
    expect(counts.get('src/b.vue')).toBe(1)
    expect(counts.size).toBe(2)
  })

  it('新增文件或错误数变多都判定为回归', () => {
    const baseline = { 'src/a.ts': 2, 'src/b.ts': 1 }
    const current = parseErrorCounts(
      [
        'src/a.ts(1,2): error TS2322: x',
        'src/a.ts(3,4): error TS2322: x',
        'src/a.ts(9,9): error TS2322: x',
        'src/b.ts(1,1): error TS2322: x',
        'src/c.ts(1,1): error TS2322: x'
      ].join('\n')
    )

    const regressions = findRegressions(baseline, current)

    expect(regressions.map(item => item.file)).toEqual(['src/a.ts', 'src/c.ts'])
    expect(regressions[0]).toEqual({ file: 'src/a.ts', baseline: 2, current: 3 })
    expect(regressions[1]).toEqual({ file: 'src/c.ts', baseline: 0, current: 1 })
  })

  it('错误数减少不算回归', () => {
    const baseline = { 'src/a.ts': 3, 'src/b.ts': 1 }
    const current = parseErrorCounts('src/a.ts(1,2): error TS2322: x\n')

    expect(findRegressions(baseline, current)).toEqual([])
  })

  it('基线文件存在且记录了存量错误总数', () => {
    const baseline = JSON.parse(
      readFileSync(join(projectRoot, 'scripts', 'typecheck-baseline.json'), 'utf-8')
    )

    expect(baseline.command).toBe('vue-tsc -b --force')
    expect(baseline.totalErrors).toBeGreaterThan(0)
    expect(Object.keys(baseline.errorsByFile).length).toBeGreaterThan(0)
  })
})

describe('type-check 脚本可执行', () => {
  it('脚本文件存在且导出了比对用的纯函数', () => {
    const scriptPath = join(projectRoot, 'scripts', 'type-check.mjs')
    expect(existsSync(scriptPath)).toBe(true)

    const source = readFileSync(scriptPath, 'utf-8')
    expect(source).toContain('export function parseErrorCounts')
    expect(source).toContain('export function findRegressions')
  })
})
