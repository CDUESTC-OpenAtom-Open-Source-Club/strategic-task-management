/**
 * 审核进度「行内下拉统一」契约锁定（2026-11-19 用户定案）。
 *
 * 背景：审核进度曾有三套交互——2026-10-28 的行内 dropdown、2026-10-31 的
 * ElMessageBox 弹窗（三视图同构但与战略任务管理页原始设计不一致）。
 * 用户 2026-11-19 拍板：统一为**行内下拉**、去掉弹窗这一层。
 *
 * 本测试用 grep 断言把「弹窗路径已彻底下线」锁死：
 * ① 源码里不再有 openAppraisalGate / openAppraisalLevelPicker / AppraisalLevelPickerResult；
 * ② 评级模型层不再 import ElMessageBox（弹窗通道物理删除）；
 * ③ 三个视图（战略任务管理页 / 指标填报页 / 指标分发页）统一引用共享行内下拉组件；
 * ④ 共享行内下拉组件只提供三档选项（「未评定」不是选项）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const projectRoot = join(__dirname, '..', '..', '..')
const srcRoot = join(projectRoot, 'src')

/** 递归收集源码文件（.ts/.vue） */
const collectSourceFiles = (dir: string): string[] => {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectSourceFiles(fullPath))
      continue
    }
    if (/\.(ts|vue)$/.test(entry)) {
      files.push(fullPath)
    }
  }
  return files
}

const sourceFiles = collectSourceFiles(srcRoot)

const readSource = (relativePath: string) =>
  readFileSync(join(srcRoot, relativePath), 'utf8')

describe('审核进度行内下拉统一（2026-11-19）', () => {
  it('评级弹窗路径已彻底下线（无 openAppraisalGate / openAppraisalLevelPicker 残留）', () => {
    const offenders: string[] = []
    for (const file of sourceFiles) {
      const content = readFileSync(file, 'utf8')
      if (
        content.includes('openAppraisalGate') ||
        content.includes('openAppraisalLevelPicker') ||
        content.includes('AppraisalLevelPickerResult')
      ) {
        offenders.push(file.replace(projectRoot, ''))
      }
    }
    expect(offenders).toEqual([])
  })

  it('评级模型层不再 import ElMessageBox（弹窗通道物理删除）', () => {
    const model = readSource('3-features/indicator/model/useIndicatorAppraisal.ts')
    expect(model).not.toContain('ElMessageBox')
    expect(model).toContain('unlockAppraisal')
    expect(model).toContain('commitAppraisalLevel')
  })

  it('三个视图统一引用共享行内下拉组件 AppraisalLevelCell', () => {
    const views = [
      '3-features/task/ui/StrategicTaskView.vue',
      '3-features/indicator/ui/IndicatorListView.vue',
      '3-features/indicator/ui/IndicatorDistributeView.vue'
    ]
    for (const view of views) {
      const content = readSource(view)
      expect(content).toContain('AppraisalLevelCell')
      expect(content).toContain('<AppraisalLevelCell')
    }
  })

  it('共享行内下拉组件只提供三档选项（「未评定」不是选项、不产生空值）', () => {
    const cell = readSource('3-features/indicator/ui/AppraisalLevelCell.vue')
    expect(cell).toContain('APPRAISAL_LEVEL_OPTIONS')
    // 组件内不得自造带空值的选项（「未评定」/value: '' 之类）
    expect(cell).not.toMatch(/value:\s*''/)
    expect(cell).not.toContain('"未评定"')
  })
})
