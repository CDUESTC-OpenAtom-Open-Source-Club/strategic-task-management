import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 2026-11-14（B4 用户实测）：未下发计划上下文的写入口露出缺陷契约锁。
 *
 * <p>缺陷：学院页签「计算机学院 × 教务处」语境（该组合的 FUNC_TO_COLLEGE 计划均为
 * DRAFT/无 DISTRIBUTED，页头「计划状态」签显示「未下发」）里，「新增行」可点、
 * 表单可保存、「发起异动」按钮亮起，点击后被后端 400 兜底拦下——用户在界面上
 * 看到「没下发的计划也能新增/发起」。异动的前提是计划已下发（DISTRIBUTED），
 * 前端入口必须按学院子计划相位 gating。</p>
 *
 * <p>修法（最小）：model 新增 collegeTabPlanNotDistributed（数据源与页头「计划状态」
 * 签同源：effectivePlanStatus ← effectivePlanContext ← resolveSelectedCollegeReportScope，
 * gate 与显示永不打架）；视图「新增行 / 导入」disabled 条件并入该值，「发起异动」
 * 并入 mutationSubmitBlocked 合并判定。职能页签不 gating（零回归）。</p>
 */

const readSource = (relative: string): string =>
  readFileSync(resolve(process.cwd(), relative), 'utf8')

const modelSource = readSource('src/3-features/task/model/useStrategicTaskView.ts')
const viewSource = readSource('src/3-features/task/ui/StrategicTaskView.vue')

const slice = (source: string, startMarker: string, length: number): string => {
  const start = source.indexOf(startMarker)
  expect(start).toBeGreaterThan(0)
  return source.slice(start, start + length)
}

describe('B4 契约：未下发计划上下文的学院页签写入口按计划相位 gating', () => {
  it('model：collegeTabPlanNotDistributed 与页头状态签同源（effectivePlanStatus），职能页签不 gating', () => {
    const body = slice(modelSource, 'const collegeTabPlanNotDistributed = computed', 600)
    // 学院上下文才 gating
    expect(body).toContain('if (!isCollegePlanContextActive.value)')
    // 判定数据源 = effectivePlanStatus（页头「计划状态」签同源）
    expect(body).toContain("effectivePlanStatus.value !== 'DISTRIBUTED'")
  })

  it('model：发起异动互斥合并学院计划相位（mutationSubmitBlocked + reason）', () => {
    const blocked = slice(modelSource, 'const mutationSubmitBlocked = computed', 400)
    expect(blocked).toContain('isReportApprovalInFlight.value')
    expect(blocked).toContain('isMutationApprovalInFlight.value')
    expect(blocked).toContain('collegeTabPlanNotDistributed.value')
    const reason = slice(modelSource, 'const mutationSubmitBlockedReason = computed', 600)
    expect(reason).toContain('该学院×部门的计划未下发')
  })

  it('视图：新增行按钮 disabled 并入计划相位 gating（仅学院页签）', () => {
    const start = viewSource.indexOf('@click.stop="handleAddNewRow"')
    const before = viewSource.slice(Math.max(0, start - 1400), start)
    expect(before).toContain("(activeTaskTabName === 'college' && collegeTabPlanNotDistributed)")
    expect(before).toContain('该学院×部门的计划未下发，暂不能新增')
  })

  it('视图：导入按钮同样并入计划相位 gating（防绕过新增行置灰往未下发计划加行）', () => {
    const start = viewSource.indexOf('@click="openStrategicImportDialog"')
    const before = viewSource.slice(Math.max(0, start - 1200), start)
    expect(before).toContain("(activeTaskTabName === 'college' && collegeTabPlanNotDistributed)")
    expect(before).toContain('该学院×部门的计划未下发，暂不能导入')
  })

  it('视图：发起异动按钮经 mutationSubmitBlocked 置灰（tooltip 内容来自 reason）', () => {
    expect(viewSource).toContain(':disabled="mutationSubmitBlocked"')
    expect(viewSource).toContain(':content="mutationSubmitBlockedReason"')
  })
})
