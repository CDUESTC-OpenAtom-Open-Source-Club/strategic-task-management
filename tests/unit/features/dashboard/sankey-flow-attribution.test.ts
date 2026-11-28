/**
 * 全校任务流转图归属单测（2026-11-27 拍板口径）
 *
 * 业务口径：战略发展部 → 职能部门 → 二级学院；战略发展部只代发给学院，
 * 学院线指标的来源（归口）是父级核心指标的 targetOrg，与「任务来源分布」饼图同键。
 *
 * 锁定四条：
 * ① 有归口线时学院线挂到归口部门（不是战略发展部）
 * ② 职能部门自身指标从战略发展部流入该部门，value = 自身数 + 归口下发数
 * ③ 「战略发展·部」（org 66，名称只差一个中点）不被当成总部，落中间列
 * ④ 归口解析失败不产生「战略发展部 → 学院」直连边
 * 另锁：职能部门视角只画本部门相关节点；store 侧接线用归口线而非 visibleIndicators。
 */
import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const { getIndicatorById } = vi.hoisted(() => ({
  getIndicatorById: vi.fn()
}))

vi.mock('@/features/indicator/api', () => ({
  indicatorApi: { getIndicatorById }
}))

import {
  generateSankeyData,
  type GenerateSankeyOptions,
  type SankeyOrganization
} from '@/features/dashboard/lib/helpers'
import type { StrategicIndicator } from '@/shared/types'
import { useAuthStore } from '@/features/auth/model/store'
import { useDashboardStore } from '@/features/dashboard/model/store'
import { useOrgStore } from '@/features/organization/model/store'
import { useStrategicStore } from '@/features/task/model/strategic'
import { useTimeContextStore } from '@/shared/lib/timeContext'

/** 与本地 2026 库同源的组织切片（含两个易误判名称：战略发展·部、国际教育学院） */
const ORGS: SankeyOrganization[] = [
  { id: '35', name: '战略发展部', type: 'strategic_dept' },
  { id: '41', name: '党委学工部 | 学生工作处', type: 'functional_dept' },
  { id: '44', name: '教务处', type: 'functional_dept' },
  { id: '62', name: '国际教育学院', type: 'functional_dept' },
  { id: '66', name: '战略发展·部', type: 'functional_dept' },
  { id: '57', name: '计算机学院', type: 'secondary_college' },
  { id: '58', name: '商学院', type: 'secondary_college' }
]

/** 构造最小可用指标行（测试只关心责任单位 / owner / 父指标） */
const makeIndicator = (overrides: Record<string, unknown> = {}): StrategicIndicator =>
  ({
    id: '1',
    name: '指标A',
    responsibleDept: '教务处',
    ownerDept: '战略发展部',
    progress: 0,
    ...overrides
  }) as unknown as StrategicIndicator

const strategicOptions = (
  parentIndicatorMap: GenerateSankeyOptions['parentIndicatorMap'] = {}
): GenerateSankeyOptions => ({
  organizations: ORGS,
  parentIndicatorMap,
  role: 'strategic_dept'
})

describe('generateSankeyData 战略发展部 → 职能部门 → 学院', () => {
  it('学院线指标挂到归口部门，职能部门自身指标从战略发展部流入（value 合并）', () => {
    const indicators = [
      makeIndicator({ id: '1', responsibleDept: '教务处' }),
      makeIndicator({ id: '2', responsibleDept: '教务处' }),
      ...Array.from({ length: 3 }, (_, index) =>
        makeIndicator({
          id: String(10 + index),
          responsibleDept: '计算机学院',
          parentIndicatorId: 'p1'
        })
      )
    ]

    const data = generateSankeyData(indicators, {
      ...strategicOptions({
        p1: { name: '父指标', targetOrgId: 44, targetOrgName: '教务处' }
      })
    })

    expect(data.links).toEqual([
      { source: '战略发展部', target: '教务处', value: 5 },
      { source: '教务处', target: '计算机学院', value: 3 }
    ])
    expect(data.nodes.find(node => node.name === '战略发展部')?.depth).toBe(0)
    expect(data.nodes.find(node => node.name === '教务处')?.depth).toBe(1)
    expect(data.nodes.find(node => node.name === '计算机学院')?.depth).toBe(2)
    expect(
      data.links.some(link => link.target === '计算机学院' && link.source === '战略发展部')
    ).toBe(false)
  })

  it('「战略发展·部」(org 66) 不被当成总部，按组织类型落中间列', () => {
    const data = generateSankeyData(
      [
        makeIndicator({ id: '1', responsibleDept: '战略发展部' }),
        makeIndicator({ id: '2', responsibleDept: '战略发展·部' }),
        makeIndicator({ id: '3', responsibleDept: '战略发展·部' })
      ],
      strategicOptions()
    )

    expect(data.nodes.find(node => node.name === '战略发展部')?.depth).toBe(0)
    expect(data.nodes.find(node => node.name === '战略发展·部')?.depth).toBe(1)
    expect(data.links).toEqual([{ source: '战略发展部', target: '战略发展·部', value: 2 }])
  })

  it('名称含「学院」的职能部门（国际教育学院）按组织类型落中间列', () => {
    const data = generateSankeyData(
      [makeIndicator({ id: '1', responsibleDept: '国际教育学院' })],
      strategicOptions()
    )

    expect(data.nodes).toEqual([
      { name: '战略发展部', depth: 0 },
      { name: '国际教育学院', depth: 1 }
    ])
  })

  it('归口解析失败（父指标缺失/ownerDept 兜底）不产生战略发展部到学院的直连边', () => {
    const indicators = [
      makeIndicator({
        id: '1',
        responsibleDept: '计算机学院',
        parentIndicatorId: 'p-missing',
        ownerDept: '战略发展部'
      }),
      makeIndicator({
        id: '2',
        responsibleDept: '商学院',
        parentIndicatorId: undefined,
        ownerDept: null
      })
    ]

    const data = generateSankeyData(indicators, strategicOptions())
    expect(data).toEqual({ nodes: [], links: [] })
  })

  it('职能部门视角只画本部门与有归口关联的学院，不出现别的职能部门/学院', () => {
    const indicators = [
      makeIndicator({ id: '1', responsibleDept: '教务处' }),
      makeIndicator({ id: '2', responsibleDept: '教务处' }),
      makeIndicator({ id: '3', responsibleDept: '计算机学院', parentIndicatorId: 'p1' }),
      makeIndicator({ id: '4', responsibleDept: '计算机学院', parentIndicatorId: 'p1' }),
      makeIndicator({ id: '5', responsibleDept: '党委学工部 | 学生工作处' }),
      makeIndicator({ id: '6', responsibleDept: '商学院', parentIndicatorId: 'p2' })
    ]

    const data = generateSankeyData(indicators, {
      organizations: ORGS,
      parentIndicatorMap: {
        p1: { name: '父指标1', targetOrgName: '教务处' },
        p2: { name: '父指标2', targetOrgName: '党委学工部 | 学生工作处' }
      },
      role: 'functional_dept',
      department: '教务处'
    })

    expect(data.nodes.map(node => node.name)).toEqual(['战略发展部', '教务处', '计算机学院'])
    expect(data.links).toEqual([
      { source: '战略发展部', target: '教务处', value: 4 },
      { source: '教务处', target: '计算机学院', value: 2 }
    ])
  })

  it('组织清单没就绪时不按名称猜层级，返回空图', () => {
    const data = generateSankeyData([makeIndicator({ id: '1' })], {
      ...strategicOptions(),
      organizations: []
    })
    expect(data).toEqual({ nodes: [], links: [] })
  })
})

describe('DashboardStore.sankeyData 接线', () => {
  it('职能部门视角的图数据含归口学院线（visibleIndicators 的角色过滤不含这批指标）', () => {
    setActivePinia(createPinia())
    getIndicatorById.mockResolvedValue({ success: true, data: null })
    const dept = '党委学工部 | 学生工作处'

    const authStore = useAuthStore()
    authStore.user = {
      id: '2',
      username: 'xuegong_report',
      name: '学工填报人',
      role: 'functional_dept',
      department: dept,
      createdAt: new Date(),
      updatedAt: new Date()
    }
    const orgStore = useOrgStore()
    orgStore.departments = [...ORGS]
    const timeContext = useTimeContextStore()
    timeContext.currentYear = new Date().getFullYear()

    const strategicStore = useStrategicStore()
    strategicStore.indicators = [
      makeIndicator({ id: '1', responsibleDept: dept }),
      makeIndicator({ id: '2', responsibleDept: dept }),
      makeIndicator({ id: '3', responsibleDept: '计算机学院', parentIndicatorId: 'p1' })
    ]

    const dashboardStore = useDashboardStore()
    dashboardStore.parentIndicatorMap = {
      p1: { name: '父指标', targetOrgName: dept }
    }

    // 角色过滤（ownerDept === 本部门）把学院线指标排除在 visibleIndicators 之外
    expect(dashboardStore.visibleIndicators.some(i => i.responsibleDept === '计算机学院')).toBe(
      false
    )
    expect(dashboardStore.sankeyData.links).toEqual([
      { source: '战略发展部', target: dept, value: 3 },
      { source: dept, target: '计算机学院', value: 1 }
    ])
  })
})
