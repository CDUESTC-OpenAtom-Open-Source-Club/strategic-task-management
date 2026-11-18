import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 2026-11-17（学院线粒度改造 · 规格书 4.9③ / 用户拍板「保持两段，只在详情里带归口」）：
 * 下发/上报审批卡片的**标题保持两段**（「下发审批 · 源 -> 目标」，routeTitle 两段口径）
 * **不变**；只在「审批流程详情」详情区增加一行「归口部门：XXX」。
 *
 * <p>取数链路（零新增接口调用）：生效计划的 functionalOrgId（后端 PlanResponse 自
 * V104 已暴露，planApi 映射驼峰；徽标/归口桶代码同源）→ departmentIdNameMap 反查
 * 名称 → 经 functionalOrgName prop 传入抽屉；解析不到归口 → 空串 → 该行不渲染
 * （规格书要求：找不到归口不显示该行，不放空值或「-」占位）。</p>
 *
 * <p>测试采用本仓既有的源码契约锁模式（8k+ 行抽屉/视图不宜整体实例化，
 * college-first-dispatch-gate 同款）。</p>
 */

const readSource = (relative: string): string =>
  readFileSync(resolve(process.cwd(), relative), 'utf8')

const drawerSource = readSource('src/3-features/approval/ui/DistributionApprovalProgressDrawer.vue')
const approvalTypesSource = readSource('src/3-features/approval/model/types.ts')
const approvalUtilsSource = readSource('src/3-features/approval/lib/approval-utils.ts')
const modelSource = readSource('src/3-features/task/model/useStrategicTaskView.ts')
const viewSource = readSource('src/3-features/task/ui/StrategicTaskView.vue')

describe('approval/ui/DistributionApprovalProgressDrawer · 详情区归口部门行（2026-11-17）', () => {
  it('props 增加 functionalOrgName（空串缺省 = 解析不到归口，行不渲染）', () => {
    expect(approvalTypesSource).toMatch(
      /DistributionApprovalProgressDrawerProps \{[\s\S]*functionalOrgName\?: string/
    )
    expect(drawerSource).toContain('functionalOrgName: \'\',')
  })

  it('详情区增加「归口部门：」行，v-if 守卫（找不到归口不放空值/「-」占位）', () => {
    expect(drawerSource).toContain(
      '<div v-if="functionalOrgName" class="detail-meta-row">'
    )
    expect(drawerSource).toContain('<span class="detail-label">归口部门：</span>')
    // 行内容直接绑定 prop，无「-」兜底
    expect(drawerSource).toContain('{{ functionalOrgName }}')
  })

  it('标题两段不变：detail-item-title 仍是 routeTitle||title，归口行不碰标题', () => {
    // 卡片标题（routeTitle「下发审批 · 源 -> 目标」两段）保持原样
    expect(drawerSource).toContain('{{ item.routeTitle || item.title }}')
    const rowStart = drawerSource.indexOf('<div v-if="functionalOrgName" class="detail-meta-row">')
    expect(rowStart).toBeGreaterThan(0)
    const rowBody = drawerSource.slice(rowStart, rowStart + 400)
    expect(rowBody).not.toContain('detail-item-title')
    expect(rowBody).not.toContain('routeTitle')
  })

  it('routeTitle 生成口径不变：仍是「{下发/上报/异动}审批 · 源 -> 目标」两段（approval-utils）', () => {
    expect(approvalUtilsSource).toContain('`下发审批 · ${sourceOrgName} -> ${targetOrgName}`')
    expect(approvalUtilsSource).toContain('`上报审批 · ${sourceOrgName} -> ${targetOrgName}`')
    expect(approvalUtilsSource).toContain('`异动审批 · ${sourceOrgName} -> ${targetOrgName}`')
  })
})

describe('task/model · 审批详情归口取数链路（2026-11-17）', () => {
  it('approvalDrawerFunctionalOrgName：生效计划 functionalOrgId → departmentIdNameMap 反查名称', () => {
    const start = modelSource.indexOf('const approvalDrawerFunctionalOrgName = computed')
    expect(start).toBeGreaterThan(0)
    const body = modelSource.slice(start, start + 1400)
    // 数据源 = effectivePlanContext.plan.functionalOrgId（PlanResponse 既有字段，零新增接口）
    expect(body).toContain('effectivePlanContext.value.plan')
    expect(body).toContain('functionalOrgId')
    // 名称反查走既有 orgStore id→name 映射
    expect(body).toContain('departmentIdNameMap.value.get(String(functionalOrgId))')
    // 解析不到归口 → 空串（抽屉按 v-if 不渲染该行）
    expect(body).toContain("return departmentIdNameMap.value.get(String(functionalOrgId)) || ''")
  })

  it('model 导出 + view 接线：抽屉收到 functional-org-name（学院/职能页签同源）', () => {
    expect(modelSource).toContain('approvalDrawerFunctionalOrgName,')
    expect(viewSource).toContain(':functional-org-name="approvalDrawerFunctionalOrgName"')
  })
})
