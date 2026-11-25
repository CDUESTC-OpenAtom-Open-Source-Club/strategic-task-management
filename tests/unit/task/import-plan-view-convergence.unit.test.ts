import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isImportPlanViewConverged } from '@/features/task/lib/planStatus'

/**
 * 2026-11-25（P1 状态签自动刷新 · 收敛判据契约锁）。
 *
 * <p>缺陷（本地真机 Playwright 实证）：导入 commit 返回时响应已带 workflow APPROVED、
 * DB 已 DISTRIBUTED，但紧随的 GET /plans 列表还没有新建的 FUNC_TO_COLLEGE 线（后端
 * 列表可见性滞后 ≈4~5s）——committed 回调的一次性 force 回源全部撞在这个窗口里拿到
 * 旧快照，此后 store 层（plans.length>0 早退）与 fetchWithCache 15s 快照拦住一切回源，
 * 页头「计划状态」签停在「未下发」直到手动刷新页面。</p>
 *
 * <p>修法：committed 回调 fire-and-forget 启动收敛轮询（每轮失效 plan.list + force 回源），
 * 用本纯函数判定收敛即停——「全部导入」按逐组 SUCCESS 回执 planId 精确判定；单条导入
 * 响应无 planId，按页头「计划状态」签同源状态（学院页签=子计划状态 effectivePlanStatus、
 * 职能页签=自身计划状态 currentPlanStatus）判定。</p>
 */

const PLANS = [
  { id: 700062, status: 'published' }, // 旧线（教务处归口，列表已含）
  { id: 700071, status: 'published' } // 本次导入新建线（后端可见性滞后窗口结束后出现）
]

describe('isImportPlanViewConverged（导入后计划视图收敛判据）', () => {
  it('全部导入回执 planId 全部可见且已下发 → 收敛（autoDispatch）', () => {
    expect(
      isImportPlanViewConverged({
        plans: PLANS,
        expectedPlanIds: [700071],
        autoDispatch: true
      })
    ).toBe(true)
  })

  it('回执 planId 尚未出现在列表（可见性滞后窗口内）→ 不收敛，继续轮询', () => {
    expect(
      isImportPlanViewConverged({
        plans: [PLANS[0]],
        expectedPlanIds: [700071],
        autoDispatch: true
      })
    ).toBe(false)
  })

  it('回执 planId 可见但状态还是草稿（仅写入不下发场景）→ autoDispatch=false 收敛', () => {
    expect(
      isImportPlanViewConverged({
        plans: [{ id: 700071, status: 'draft' }],
        expectedPlanIds: [700071],
        autoDispatch: false
      })
    ).toBe(true)
    expect(
      isImportPlanViewConverged({
        plans: [{ id: 700071, status: 'draft' }],
        expectedPlanIds: [700071],
        autoDispatch: true
      })
    ).toBe(false)
  })

  it('多组全部导入：任一 SUCCESS 组未可见 → 不收敛', () => {
    expect(
      isImportPlanViewConverged({
        plans: PLANS,
        expectedPlanIds: [700071, 700999],
        autoDispatch: true
      })
    ).toBe(false)
  })

  it('单条导入（无 planId 回执）：学院页签子计划未解析（null）→ 不收敛', () => {
    expect(
      isImportPlanViewConverged({
        plans: PLANS,
        activePlanStatus: null,
        autoDispatch: true
      })
    ).toBe(false)
  })

  it('单条导入：状态词表大小写归一（planApi 存小写 published / 后端大写 DISTRIBUTED）', () => {
    expect(
      isImportPlanViewConverged({
        plans: PLANS,
        activePlanStatus: 'published',
        autoDispatch: true
      })
    ).toBe(true)
    expect(
      isImportPlanViewConverged({
        plans: PLANS,
        activePlanStatus: 'DISTRIBUTED',
        autoDispatch: true
      })
    ).toBe(true)
    expect(
      isImportPlanViewConverged({
        plans: PLANS,
        activePlanStatus: 'draft',
        autoDispatch: true
      })
    ).toBe(false)
  })

  it('仅写入不下发（autoDispatch=false）：计划已解析即收敛（状态停在草稿是预期）', () => {
    expect(
      isImportPlanViewConverged({
        plans: PLANS,
        activePlanStatus: 'draft',
        autoDispatch: false
      })
    ).toBe(true)
  })

  it('未知状态字符串（词表外）按未收敛处理，防误停轮询', () => {
    expect(
      isImportPlanViewConverged({
        plans: PLANS,
        activePlanStatus: 'SOME_UNKNOWN',
        autoDispatch: true
      })
    ).toBe(false)
  })

  it('契约锁：单条/全部导入 committed 回调都必须接线收敛轮询兜底', () => {
    const vueSource = readFileSync(
      resolve(process.cwd(), 'src/3-features/task/ui/StrategicTaskView.vue'),
      'utf8'
    )
    expect(vueSource).toContain('waitPlanViewConvergedAfterImport({')
    expect(vueSource).toMatch(
      /handleStrategicImportCommitted[\s\S]*?waitPlanViewConvergedAfterImport/
    )
    expect(vueSource).toMatch(
      /handleStrategicAllImportCommitted[\s\S]*?waitPlanViewConvergedAfterImport/
    )
    const modelSource = readFileSync(
      resolve(process.cwd(), 'src/3-features/task/model/useStrategicTaskView.ts'),
      'utf8'
    )
    // 收敛轮询每轮必须先失效 plan.list 再 force 回源（否则 15s 快照让轮询空转）
    expect(modelSource).toMatch(
      /waitPlanViewConvergedAfterImport[\s\S]*?invalidateQueries\(\['plan\.list'\]\)[\s\S]*?loadPlans\(\{ force: true/
    )
  })
})
