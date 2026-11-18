import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const readSrc = (relative: string): string => readFileSync(resolve(process.cwd(), relative), 'utf8')

const mainDrawerSource = readSrc('src/3-features/approval/model/useApprovalProgressDrawer.ts')
const distributionWorkflowSource = readSrc(
  'src/3-features/approval/model/useApprovalProgressWorkflow.ts'
)
const approvalDrawerViewSource = readSrc('src/3-features/approval/ui/ApprovalProgressDrawer.vue')
const distributionDrawerViewSource = readSrc(
  'src/3-features/approval/ui/DistributionApprovalProgressDrawer.vue'
)

/**
 * 2026-11-17 线上反馈（领导：流转图一点击就消失、找不到复原入口）。
 *
 * 根因：审批抽屉打开后，待办/实例详情等异步加载完成时会把 activeTab 强制切回
 * 「计划审批/审批历史」（共 5 处：useApprovalProgressDrawer 4 处 + useApprovalProgressWorkflow
 * 1 处）。用户刚点开「审批流程」页签看流转图就被切走，再点再被切，观感即"一点就消失"。
 *
 * 修复约定（源码契约锁，防止后人删掉守卫让缺陷回归）：
 * 1. 两个 composable 各持有一个手选闩 approvalTabSelectedManually；
 * 2. 所有 `activeTab.value = 'pending-plans'` 自动切换必须先查闩；
 * 3. 「优先页签」watcher 在闩立起时必须让位；
 * 4. 闩在抽屉打开（modelValue -> true）时复位，保证默认落点（2026-10-30 定案）仍生效；
 * 5. 两个抽屉模板的页签栏必须绑定 @tab-click 置闩（只在用户手动点击时触发）。
 */
describe('审批抽屉页签手选闩契约（流转图不再一点就消失）', () => {
  const findAutoSwitchAssignments = (source: string): number[] => {
    const positions: number[] = []
    const pattern = /activeTab\.value = 'pending-plans'/g
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source)) !== null) {
      positions.push(match.index)
    }
    return positions
  }

  const assertGuardedBefore = (source: string, label: string) => {
    const positions = findAutoSwitchAssignments(source)
    expect(positions.length, `${label} 应存在自动切换点`).toBeGreaterThan(0)
    for (const position of positions) {
      const window = source.slice(Math.max(0, position - 240), position)
      expect(
        window,
        `${label} 的自动切换 activeTab.value='pending-plans' 前必须检查手选闩`
      ).toContain('!approvalTabSelectedManually.value')
    }
  }

  it('主审批抽屉：所有 pending-plans 自动切换都检查手选闩', () => {
    assertGuardedBefore(mainDrawerSource, 'useApprovalProgressDrawer')
    // 4 处：loadPendingPlanApprovals、reportTodoItems watch、loadPlanWorkflowDetail 两条回退路径
    expect(findAutoSwitchAssignments(mainDrawerSource)).toHaveLength(4)
  })

  it('分发审批抽屉：relatedPlanReportSummary 自动切换检查手选闩', () => {
    assertGuardedBefore(distributionWorkflowSource, 'useApprovalProgressWorkflow')
    expect(findAutoSwitchAssignments(distributionWorkflowSource)).toHaveLength(1)
  })

  it('主审批抽屉：优先页签 watcher 在闩立起时让位（流转图页签不被弹走）', () => {
    // 该 watcher 专切 history/workflow -> preferred；闩立起时必须提前 return
    const watcher = mainDrawerSource.match(
      /const preferredTab = resolvePreferredActiveTab\(\)[\s\S]{0,320}/
    )
    expect(watcher).not.toBeNull()
    const before = mainDrawerSource.slice(
      Math.max(0, (watcher as RegExpMatchArray).index! - 320),
      (watcher as RegExpMatchArray).index
    )
    expect(before).toMatch(
      /if \(approvalTabSelectedManually\.value\) \{\s*return\s*\}/
    )
  })

  it('两个 composable：手选闩在抽屉打开时复位（默认落点每次打开重新生效）', () => {
    for (const [source, label] of [
      [mainDrawerSource, 'useApprovalProgressDrawer'],
      [distributionWorkflowSource, 'useApprovalProgressWorkflow']
    ] as const) {
      const openWatcher = source.match(
        /watch\(\s*\(\) => props\.modelValue,\s*(?:async )?val => \{\s*if \(val\) \{/
      )
      expect(openWatcher, `${label} 应有 modelValue 打开 watcher`).not.toBeNull()
      const afterOpen = source.slice(
        (openWatcher as RegExpMatchArray).index! + openWatcher![0].length,
        (openWatcher as RegExpMatchArray).index! + openWatcher![0].length + 400
      )
      expect(
        afterOpen,
        `${label} 打开分支内应复位手选闩`
      ).toContain('approvalTabSelectedManually.value = false')
    }
  })

  it('两个 composable：手选置闩函数存在并从返回值导出（供模板 tab-click 使用）', () => {
    for (const [source, label] of [
      [mainDrawerSource, 'useApprovalProgressDrawer'],
      [distributionWorkflowSource, 'useApprovalProgressWorkflow']
    ] as const) {
      expect(source, `${label} 应定义置闩函数`).toContain(
        'function markApprovalTabSelectedManually()'
      )
      expect(source, `${label} 应导出置闩函数`).toContain('markApprovalTabSelectedManually,')
    }
  })

  it('两个抽屉模板：页签栏绑定 @tab-click 置闩（只在用户手动点击时触发）', () => {
    expect(approvalDrawerViewSource).toMatch(
      /<ElTabs[\s\S]*?@tab-click="markApprovalTabSelectedManually"/
    )
    expect(distributionDrawerViewSource).toMatch(
      /<el-tabs[\s\S]*?@tab-click="markApprovalTabSelectedManually"/
    )
  })
})
