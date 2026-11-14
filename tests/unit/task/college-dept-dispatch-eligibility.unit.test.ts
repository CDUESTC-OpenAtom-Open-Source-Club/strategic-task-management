import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  COLLEGE_DEPT_INELIGIBLE_WARNING,
  COLLEGE_DEPT_NOT_DISPATCHED_BADGE,
  buildCollegeDeptEligibleByDept,
  buildCollegeDeptPlanStatusByDept,
  buildCollegeDeptPlanWinnerByDept,
  buildCollegeDeptReportStatusByDept,
  isCollegeDispatchDeptEligible,
  isDistributedCoreIndicator,
  resolveCollegeDeptCurrent,
  resolveCollegeDeptFilterSelection,
  resolveCollegeDeptPhaseBadge,
  type CollegeDeptPlanReportLike
} from '@/features/task/lib/collegeDispatchEligibility'

/**
 * 2026-11-10（用户拍板）学院页签「职能部门」下拉**下发资格**用例口径：
 *
 * 1. 资格 = 该部门在该考核周期存在「已下发」（DISTRIBUTED；旧数据 ACTIVE 等价）
 *    状态的**核心指标**（无父指标）；子指标（有 parentIndicatorId）不构成资格；
 * 2. 下拉全部部门**可点击**：无资格部门点击 → 拦截（不落选）+ 提示
 *    「当前职能部门未有已下发的任务」；有资格部门点击 → 正常选中。
 */
describe('task/lib/collegeDispatchEligibility（学院页签部门下发资格判定）', () => {
  describe('isDistributedCoreIndicator', () => {
    it('核心指标 status=DISTRIBUTED → 是已下发核心指标', () => {
      expect(isDistributedCoreIndicator({ status: 'DISTRIBUTED' })).toBe(true)
    })

    it('核心指标 status=DISTRIBUTED（含小写/空白）→ 归一后同样成立', () => {
      expect(isDistributedCoreIndicator({ status: ' distributed ' })).toBe(true)
    })

    it('旧数据 status=ACTIVE → 与 DISTRIBUTED 等价，视为已下发', () => {
      expect(isDistributedCoreIndicator({ status: 'ACTIVE' })).toBe(true)
    })

    it('子指标（有 parentIndicatorId）即使已下发也不构成资格依据', () => {
      expect(isDistributedCoreIndicator({ status: 'DISTRIBUTED', parentIndicatorId: 12 })).toBe(
        false
      )
      expect(isDistributedCoreIndicator({ status: 'DISTRIBUTED', parentIndicatorId: '12' })).toBe(
        false
      )
    })

    it('parentIndicatorId 为 null / undefined / 空串 → 视为核心指标', () => {
      expect(isDistributedCoreIndicator({ status: 'DISTRIBUTED', parentIndicatorId: null })).toBe(
        true
      )
      expect(isDistributedCoreIndicator({ status: 'DISTRIBUTED' })).toBe(true)
      expect(isDistributedCoreIndicator({ status: 'DISTRIBUTED', parentIndicatorId: '' })).toBe(
        true
      )
    })

    it('草稿 / 审批中 / 归档 / 无状态 → 都不构成资格依据', () => {
      expect(isDistributedCoreIndicator({ status: 'DRAFT' })).toBe(false)
      expect(isDistributedCoreIndicator({ status: 'PENDING_REVIEW' })).toBe(false)
      expect(isDistributedCoreIndicator({ status: 'ARCHIVED' })).toBe(false)
      expect(isDistributedCoreIndicator({})).toBe(false)
      expect(isDistributedCoreIndicator({ status: null })).toBe(false)
    })
  })

  describe('isCollegeDispatchDeptEligible（部门级判定）', () => {
    it('存在至少一条已下发核心指标 → 有资格', () => {
      expect(
        isCollegeDispatchDeptEligible([
          { status: 'DRAFT' },
          { status: 'PENDING_REVIEW', parentIndicatorId: '' },
          { status: 'DISTRIBUTED', parentIndicatorId: '' }
        ])
      ).toBe(true)
    })

    it('只有子指标已下发 / 只有草稿 / 空列表 → 无资格', () => {
      expect(isCollegeDispatchDeptEligible([{ status: 'DISTRIBUTED', parentIndicatorId: 3 }])).toBe(
        false
      )
      expect(isCollegeDispatchDeptEligible([{ status: 'DRAFT' }])).toBe(false)
      expect(isCollegeDispatchDeptEligible([])).toBe(false)
    })
  })

  describe('buildCollegeDeptEligibleByDept（全量资格聚合，2026-11-10 缺陷修复）', () => {
    // 模拟 normalizeDepartmentName：原样返回（纯函数层不依赖 model 的别名表）；
    // 字段链用 || —— 空串也兜底（与 model 侧注入的解析器同口径）
    const resolveDeptName = (indicator: {
      targetDepartment?: unknown
      targetOrgName?: unknown
      responsibleDept?: unknown
    }) =>
      String(
        indicator.targetDepartment || indicator.targetOrgName || indicator.responsibleDept || ''
      )

    it('回归（纪委办场景）：核心指标 target=职能部门且 DISTRIBUTED、该学院零学院行 → 部门仍 eligible', () => {
      // 全量指标 = 3 条纪委办核心指标（owner=战略部、target=纪委办、parent 为空），
      // 没有任何「target=学院」的学院行 —— 旧实现按学院过滤后 byDept 为空、误判无资格
      const indicators = Array.from({ length: 3 }, (_, i) => ({
        id: i + 1,
        status: 'DISTRIBUTED',
        parentIndicatorId: null,
        targetDepartment: '纪委办公室 | 监察处'
      }))
      const result = buildCollegeDeptEligibleByDept(indicators, resolveDeptName)
      expect(result.get('纪委办公室 | 监察处')).toBe(true)
    })

    it('部门名按字段链 targetDepartment || targetOrgName || responsibleDept 取（空串也兜底；resolveDeptName 由调用方注入）', () => {
      const indicators = [
        { status: 'DISTRIBUTED', targetDepartment: '', targetOrgName: '纪委办公室 | 监察处' },
        { status: 'ACTIVE', responsibleDept: '审计处' }
      ]
      const result = buildCollegeDeptEligibleByDept(indicators, resolveDeptName)
      expect(result.get('纪委办公室 | 监察处')).toBe(true)
      expect(result.get('审计处')).toBe(true)
    })

    it('草稿 / 审批中 / 归档核心指标、已下发子指标 → 不标记资格', () => {
      const indicators = [
        { status: 'DRAFT', targetDepartment: '纪委办公室' },
        { status: 'PENDING_REVIEW', targetDepartment: '纪委办公室' },
        { status: 'ARCHIVED', targetDepartment: '纪委办公室' },
        { status: 'DISTRIBUTED', parentIndicatorId: 9, targetDepartment: '纪委办公室' }
      ]
      const result = buildCollegeDeptEligibleByDept(indicators, resolveDeptName)
      expect(result.size).toBe(0)
    })

    it('目标部门名为空（无任何部门字段）→ 跳过该行，不产生空键', () => {
      const indicators = [{ status: 'DISTRIBUTED', parentIndicatorId: null }]
      const result = buildCollegeDeptEligibleByDept(indicators, resolveDeptName)
      expect(result.size).toBe(0)
    })

    it('学院行（target=学院）的已下发核心指标 → 标记的是学院名（键不进职能部门下拉，无害兜底）', () => {
      const indicators = [
        { status: 'DISTRIBUTED', parentIndicatorId: null, targetDepartment: '计算机学院' }
      ]
      const result = buildCollegeDeptEligibleByDept(indicators, resolveDeptName)
      expect(result.get('计算机学院')).toBe(true)
      expect(result.has('纪委办公室')).toBe(false)
    })

    it('空列表 → 空 Map', () => {
      expect(buildCollegeDeptEligibleByDept([], resolveDeptName).size).toBe(0)
    })
  })

  describe('resolveCollegeDeptFilterSelection（下拉点击分流）', () => {
    const items = [
      { dept: '教务处', eligible: true },
      { dept: '科研处', eligible: false }
    ]

    it('有资格部门点击 → 放行并选中', () => {
      expect(resolveCollegeDeptFilterSelection(items, '教务处')).toEqual({
        accepted: true,
        dept: '教务处',
        intercepted: false
      })
    })

    it('无资格部门点击 → 拦截（不落选）', () => {
      expect(resolveCollegeDeptFilterSelection(items, '科研处')).toEqual({
        accepted: false,
        dept: '科研处',
        intercepted: true
      })
    })

    it('未知部门（防御）→ 同样拦截', () => {
      expect(resolveCollegeDeptFilterSelection(items, '不存在的部门').accepted).toBe(false)
      expect(resolveCollegeDeptFilterSelection(items, '').accepted).toBe(false)
      expect(resolveCollegeDeptFilterSelection(items, null).accepted).toBe(false)
    })
  })

  it('提示文案常量 = 用户拍板原文「当前职能部门未有已下发的任务」（实现与组件共用，防漂移）', () => {
    expect(COLLEGE_DEPT_INELIGIBLE_WARNING).toBe('当前职能部门未有已下发的任务')
  })

  // ============ 2026-11-13 回显缺陷修复：选完部门后按钮仍显示占位「请选择职能部门」 ============
  // 复现 dump（zlb_admin → 工学院 → 选「纪委办公室 | 监察处」）：
  // filter="纪委办公室 | 监察处"、effective=同值、dispatchOptions=[]（该学院名下零学院行）
  // → 旧实现只在 dispatchOptions 里 find → 不命中 → current=null → 占位文案。
  // 根因：资格来自「已下发核心指标」（target=职能部门），dispatchOptions 只聚合
  // 「target=所选学院」的学院行——有资格但零学院行的部门不在其中。
  describe('resolveCollegeDeptCurrent（所选部门回显，2026-11-13）', () => {
    const dropdownItems = [
      {
        dept: '党委办公室 | 党委统战部',
        count: 0,
        eligible: false,
        dispatchStatus: 'none',
        reportStatus: 'none'
      },
      {
        dept: '纪委办公室 | 监察处',
        count: 0,
        eligible: true,
        dispatchStatus: 'none',
        reportStatus: 'none'
      },
      { dept: '教务处', count: 0, eligible: false, dispatchStatus: 'none', reportStatus: 'none' }
    ]
    const identity = (value?: string | null): string => String(value ?? '').trim()

    it('缺陷主场景：dispatchOptions 为空、dropdownItems 命中 → 回显部门全名（不再占位）', () => {
      const current = resolveCollegeDeptCurrent({
        effectiveDept: '纪委办公室 | 监察处',
        dispatchOptions: [],
        dropdownItems,
        normalize: identity
      })
      expect(current?.dept).toBe('纪委办公室 | 监察处')
      expect(current?.eligible).toBe(true)
    })

    it('filter 为别名/简名时按 normalize 归一后命中，回显下拉项的全名', () => {
      const current = resolveCollegeDeptCurrent({
        effectiveDept: '纪委办公室',
        dispatchOptions: [],
        dropdownItems,
        // 模拟 departmentAliasNameMap：别名 → 标准全名
        normalize: value =>
          String(value) === '纪委办公室' ? '纪委办公室 | 监察处' : String(value ?? '').trim()
      })
      expect(current?.dept).toBe('纪委办公室 | 监察处')
    })

    it('dispatchOptions 与 dropdownItems 都命中时优先 dispatchOptions（保留计数/状态明细）', () => {
      const dispatchOptions = [
        {
          dept: '纪委办公室 | 监察处',
          count: 3,
          eligible: true,
          dispatchStatus: 'dispatched' as const,
          reportStatus: 'reported' as const
        }
      ]
      const current = resolveCollegeDeptCurrent({
        effectiveDept: '纪委办公室 | 监察处',
        dispatchOptions,
        dropdownItems,
        normalize: identity
      })
      expect(current).toBe(dispatchOptions[0])
    })

    it('未选部门（effective 为空）→ null（占位态保持）', () => {
      expect(
        resolveCollegeDeptCurrent({
          effectiveDept: '',
          dispatchOptions: [],
          dropdownItems,
          normalize: identity
        })
      ).toBeNull()
    })

    it('两份列表都未命中（数据刷新间隙）→ 按 filter 归一值兜底，选中态不丢', () => {
      const current = resolveCollegeDeptCurrent({
        effectiveDept: '计划财务处',
        dispatchOptions: [],
        dropdownItems,
        normalize: identity
      })
      expect(current?.dept).toBe('计划财务处')
    })

    it('model 接线契约：collegeDeptCurrent 走 lib 纯函数（dispatchOptions → dropdownItems → 兜底）', () => {
      const modelSource = readFileSync(
        resolve(process.cwd(), 'src/3-features/task/model/useStrategicTaskView.ts'),
        'utf8'
      )
      expect(modelSource).toMatch(
        /const collegeDeptCurrent = computed\(\(\) =>\s*\n\s*resolveCollegeDeptCurrent\(\{/
      )
      expect(modelSource).toMatch(/effectiveDept: collegeDispatchDeptEffective\.value/)
      expect(modelSource).toMatch(/dropdownItems: collegeDeptDropdownItems\.value/)
      // 旧实现（只在 dispatchOptions 里全等 find）不得回归
      expect(modelSource).not.toMatch(
        /collegeDeptDispatchOptions\.value\.find\(\s*\n?\s*item => item\.dept === collegeDispatchDeptEffective/
      )
    })

    describe('buildCollegeDeptPlanStatusByDept（2026-11-13 状态徽标修正：下拉按 FUNC_TO_COLLEGE 计划状态判定）', () => {
      const makeContext = (overrides: Record<string, unknown> = {}) => ({
        collegeOrgId: 56,
        collegeName: '工学院',
        currentYear: 2026,
        resolvePlanYear: (plan: { year?: unknown }) => Number(plan.year ?? 2026) || 2026,
        resolveDeptOrgId: (deptName: string) =>
          (({ 教务处: 44, 纪委办: 37, 宣传部: 45 }) as Record<string, number>)[deptName] ?? null,
        normalize: (value?: string | null) => String(value ?? '').trim(),
        ...overrides
      })

      const plan = (overrides: Record<string, unknown> = {}) => ({
        id: 705488,
        status: 'DISTRIBUTED',
        planLevel: 'FUNC_TO_COLLEGE',
        targetOrgId: 56,
        targetOrgName: '工学院',
        createdByOrgId: 35,
        functionalOrgId: 44,
        totalIndicators: 1,
        year: 2026,
        ...overrides
      })

      it('工学院×教务处有 DISTRIBUTED 归口计划（705488）→ 教务处=DISTRIBUTED（已下发）', () => {
        const result = buildCollegeDeptPlanStatusByDept(
          [plan()],
          ['教务处', '宣传部'],
          makeContext()
        )
        expect(result.get('教务处')).toBe('DISTRIBUTED')
        // 无计划部门不在表内 → 模板回退「未下发」
        expect(result.has('宣传部')).toBe(false)
      })

      it('legacy 空壳（created_by=44、DRAFT、0 任务）不参与：不再把「未下发」误判成「草稿」', () => {
        const shell = plan({
          id: 404456,
          status: 'DRAFT',
          createdByOrgId: 44,
          functionalOrgId: undefined,
          totalIndicators: 0
        })
        const result = buildCollegeDeptPlanStatusByDept([shell], ['教务处'], makeContext())
        expect(result.has('教务处')).toBe(false)
      })

      it('legacy 有存活指标（created_by=44、DISTRIBUTED）→ 回退锚定，参与状态展示', () => {
        const legacy = plan({
          id: 404000,
          status: 'DISTRIBUTED',
          createdByOrgId: 44,
          functionalOrgId: undefined,
          totalIndicators: 3
        })
        const result = buildCollegeDeptPlanStatusByDept([legacy], ['教务处'], makeContext())
        expect(result.get('教务处')).toBe('DISTRIBUTED')
      })

      it('归口计划与 legacy 并存 → 归口计划获胜（新口径唯一真数据源）', () => {
        const shell = plan({
          id: 404456,
          status: 'DRAFT',
          createdByOrgId: 44,
          functionalOrgId: undefined,
          totalIndicators: 0
        })
        const real = plan()
        const result = buildCollegeDeptPlanStatusByDept([shell, real], ['教务处'], makeContext())
        expect(result.get('教务处')).toBe('DISTRIBUTED')
      })

      it('PENDING 归口计划 → 审批中基准（PENDING 原样返回，映射走 planStatus 词表）', () => {
        const result = buildCollegeDeptPlanStatusByDept(
          [plan({ status: 'PENDING' })],
          ['教务处'],
          makeContext()
        )
        expect(result.get('教务处')).toBe('PENDING')
      })

      it('computer学院×纪委办：functional_org_id=37 归口命中 → 纪委办已下发、教务处未下发', () => {
        const plan705489 = plan({
          id: 705489,
          targetOrgId: 58,
          targetOrgName: '计算机学院',
          functionalOrgId: 37
        })
        const result = buildCollegeDeptPlanStatusByDept(
          [plan705489],
          ['教务处', '纪委办'],
          makeContext({ collegeOrgId: 58, collegeName: '计算机学院' })
        )
        expect(result.get('纪委办')).toBe('DISTRIBUTED')
        expect(result.has('教务处')).toBe(false)
      })

      it('同部门多份计划：已下发优先于草稿；年份不符 / planLevel 不符不参与', () => {
        const draft = plan({ id: 705600, status: 'DRAFT' })
        const distributed = plan({ id: 705488 })
        const result = buildCollegeDeptPlanStatusByDept(
          [draft, distributed],
          ['教务处'],
          makeContext()
        )
        expect(result.get('教务处')).toBe('DISTRIBUTED')

        const wrongYear = plan({ year: 2025 })
        expect(
          buildCollegeDeptPlanStatusByDept([wrongYear], ['教务处'], makeContext()).has('教务处')
        ).toBe(false)
        expect(
          buildCollegeDeptPlanStatusByDept(
            [plan({ planLevel: 'STRAT_TO_FUNC' })],
            ['教务处'],
            makeContext()
          ).has('教务处')
        ).toBe(false)
      })

      it('部门名解析不出 orgId → 不进状态表（模板回退「未下发」）', () => {
        const result = buildCollegeDeptPlanStatusByDept(
          [plan({ targetOrgId: undefined, targetOrgName: '工学院' })],
          ['未知部门'],
          makeContext()
        )
        expect(result.size).toBe(0)
      })
    })

    // ============ 2026-11-13（用户拍板「只能显示一个状态」）：下发 + 上报双 tag 合并为单一徽标 ============
    // 用户原话：「完成下发之后显示『已下发』；下发审批中是『审批中』；完成下发之后只能上报，
    // 上报的时候以上报那时候的审批态为主——上报完了叫『已上报』，上报过程中叫『审批中』。」
    // 判定链：计划侧（无计划→未下发 / DRAFT→草稿 / PENDING→审批中 / DISTRIBUTED→进入上报侧）
    // → 上报侧（在审→审批中 / 退回→已回退 / 归档→已上报 / 无上报·草稿→已下发）。
    describe('resolveCollegeDeptPhaseBadge（单一状态徽标合并语义矩阵，2026-11-13）', () => {
      const badge = (planStatus?: string | null, reportStatus?: string | null) =>
        resolveCollegeDeptPhaseBadge({ planStatus, reportStatus })

      it('无 FUNC_TO_COLLEGE 计划 → null（模板回退「未下发」既有 tag）', () => {
        expect(badge(undefined)).toBeNull()
        expect(badge(null)).toBeNull()
        expect(badge('')).toBeNull()
        expect(badge(' totally-unknown ')).toBeNull()
      })

      it('无计划兜底常量 = 「未下发」warning（模型 ?? 兜底后徽标恒非空，单 el-tag 契约）', () => {
        // 徽标恒非空是双 tag 缺陷修复的一半：单一 el-tag 无分支卸载（见 lib 常量注释）
        expect(COLLEGE_DEPT_NOT_DISPATCHED_BADGE).toEqual({ label: '未下发', tagType: 'warning' })
        expect(
          resolveCollegeDeptPhaseBadge({ planStatus: undefined }) ??
            COLLEGE_DEPT_NOT_DISPATCHED_BADGE
        ).toEqual({ label: '未下发', tagType: 'warning' })
      })

      it('计划 DRAFT / WITHDRAWN（含回退态按归一表落 DRAFT）→ 「草稿」(info)，不看上报侧', () => {
        expect(badge('DRAFT')).toEqual({ label: '草稿', tagType: 'info' })
        expect(badge(' WITHDRAWN ')).toEqual({ label: '草稿', tagType: 'info' })
        // 即使有已归档上报（理论上不可能：未下发不能上报），计划侧语义优先
        expect(badge('DRAFT', 'APPROVED')).toEqual({ label: '草稿', tagType: 'info' })
      })

      it('计划下发审批中（PENDING / IN_REVIEW / SUBMITTED）→ 「审批中」(warning)，不看上报侧', () => {
        expect(badge('PENDING')).toEqual({ label: '审批中', tagType: 'warning' })
        expect(badge('IN_REVIEW')).toEqual({ label: '审批中', tagType: 'warning' })
        expect(badge('SUBMITTED')).toEqual({ label: '审批中', tagType: 'warning' })
      })

      it('计划已下发 + 尚无上报（null / undefined / 空串）→ 「已下发」(success)', () => {
        expect(badge('DISTRIBUTED')).toEqual({ label: '已下发', tagType: 'success' })
        expect(badge('DISTRIBUTED', null)).toEqual({ label: '已下发', tagType: 'success' })
        expect(badge('DISTRIBUTED', '')).toEqual({ label: '已下发', tagType: 'success' })
      })

      it('计划已下发 + 上报草稿（DRAFT）→ 停留「已下发」（上报未开始）', () => {
        expect(badge('DISTRIBUTED', 'DRAFT')).toEqual({ label: '已下发', tagType: 'success' })
      })

      it('计划已下发 + 上报在审（PENDING / IN_REVIEW / SUBMITTED）→ 「审批中」(warning，与下发在审同词)', () => {
        expect(badge('DISTRIBUTED', 'PENDING')).toEqual({ label: '审批中', tagType: 'warning' })
        expect(badge('DISTRIBUTED', 'IN_REVIEW')).toEqual({ label: '审批中', tagType: 'warning' })
        expect(badge('DISTRIBUTED', ' SUBMITTED ')).toEqual({ label: '审批中', tagType: 'warning' })
      })

      it('计划已下发 + 上报归档（APPROVED）→ 「已上报」(success)', () => {
        expect(badge('DISTRIBUTED', 'APPROVED')).toEqual({ label: '已上报', tagType: 'success' })
      })

      it('计划已下发 + 上报回退（REJECTED / RETURNED / CANCELLED / WITHDRAWN）→ 「已回退」(danger)', () => {
        // 已回退/已上报均为代码库既有文案（approvalFlowStatusMeta / resolveCollegeReportApprovalStatusMeta）；
        // WITHDRAWN 专属文案「上报已撤回（待重新上报）」对本下拉属新增词，按同族
        // 「退回待重报」语义保守并入「已回退」（词表零新增约束，见 lib 注释）。
        expect(badge('DISTRIBUTED', 'REJECTED')).toEqual({ label: '已回退', tagType: 'danger' })
        expect(badge('DISTRIBUTED', 'RETURNED')).toEqual({ label: '已回退', tagType: 'danger' })
        expect(badge('DISTRIBUTED', 'CANCELLED')).toEqual({ label: '已回退', tagType: 'danger' })
        expect(badge('DISTRIBUTED', 'WITHDRAWN')).toEqual({ label: '已回退', tagType: 'danger' })
      })

      it('raw APPROVED 计划与 DISTRIBUTED 同为已下发基准（归一表 APPROVED→DISTRIBUTED）', () => {
        expect(badge('APPROVED', 'APPROVED')).toEqual({ label: '已上报', tagType: 'success' })
        expect(badge('APPROVED')).toEqual({ label: '已下发', tagType: 'success' })
      })

      it('2026-11-13 验收场景端到端：winner + 上报状态 → 纪委办=已上报、教务处=已下发、宣传部=未下发', () => {
        const context = {
          collegeOrgId: 58,
          collegeName: '计算机学院',
          currentYear: 2026,
          resolvePlanYear: (p: { year?: unknown }) => Number(p.year ?? 2026) || 2026,
          resolveDeptOrgId: (deptName: string) =>
            (({ 纪委办: 37, 教务处: 44, 宣传部: 45 }) as Record<string, number>)[deptName] ?? null,
          normalize: (value?: string | null) => String(value ?? '').trim()
        }
        const winnerByDept = buildCollegeDeptPlanWinnerByDept(
          [
            {
              id: 705489,
              status: 'DISTRIBUTED',
              planLevel: 'FUNC_TO_COLLEGE',
              targetOrgId: 58,
              targetOrgName: '计算机学院',
              createdByOrgId: 35,
              functionalOrgId: 37,
              totalIndicators: 2,
              year: 2026
            },
            {
              id: 705488,
              status: 'DISTRIBUTED',
              planLevel: 'FUNC_TO_COLLEGE',
              targetOrgId: 56,
              targetOrgName: '工学院',
              createdByOrgId: 35,
              functionalOrgId: 44,
              totalIndicators: 1,
              year: 2026
            }
          ],
          ['纪委办', '宣传部'],
          context
        )
        const reportsByPlanId = new Map<number, CollegeDeptPlanReportLike[]>([
          [705489, [{ id: 1, functionalOrgId: 37, status: 'APPROVED' }]]
        ])
        const reportStatusByDept = buildCollegeDeptReportStatusByDept({
          winnerByDept,
          reportsByPlanId,
          resolveDeptOrgId: context.resolveDeptOrgId
        })
        // 纪委办：已下发 + 上报归档 → 只显示「已上报」
        expect(
          resolveCollegeDeptPhaseBadge({
            planStatus: winnerByDept.get('纪委办')?.status,
            reportStatus: reportStatusByDept.get('纪委办')
          })
        ).toEqual({ label: '已上报', tagType: 'success' })
        // 宣传部：无计划 → 未下发（模板回退）
        expect(
          resolveCollegeDeptPhaseBadge({
            planStatus: winnerByDept.get('宣传部')?.status,
            reportStatus: reportStatusByDept.get('宣传部')
          })
        ).toBeNull()
        // 教务处（工学院语境）：已下发 + 无上报 → 「已下发」
        const gongWinner = buildCollegeDeptPlanWinnerByDept(
          [
            {
              id: 705488,
              status: 'DISTRIBUTED',
              planLevel: 'FUNC_TO_COLLEGE',
              targetOrgId: 56,
              targetOrgName: '工学院',
              createdByOrgId: 35,
              functionalOrgId: 44,
              totalIndicators: 1,
              year: 2026
            }
          ],
          ['教务处'],
          { ...context, collegeOrgId: 56, collegeName: '工学院' }
        )
        expect(
          resolveCollegeDeptPhaseBadge({
            planStatus: gongWinner.get('教务处')?.status,
            reportStatus: undefined
          })
        ).toEqual({ label: '已下发', tagType: 'success' })
      })
    })

    describe('buildCollegeDeptPlanWinnerByDept（获胜计划带 planId，上报状态按 plan 拉取分组）', () => {
      const makeContext = () => ({
        collegeOrgId: 56,
        collegeName: '工学院',
        currentYear: 2026,
        resolvePlanYear: (p: { year?: unknown }) => Number(p.year ?? 2026) || 2026,
        resolveDeptOrgId: (deptName: string) =>
          (({ 教务处: 44 }) as Record<string, number>)[deptName] ?? null,
        normalize: (value?: string | null) => String(value ?? '').trim()
      })
      const plan = (overrides: Record<string, unknown> = {}) => ({
        id: 705488,
        status: 'DISTRIBUTED',
        planLevel: 'FUNC_TO_COLLEGE',
        targetOrgId: 56,
        targetOrgName: '工学院',
        createdByOrgId: 35,
        functionalOrgId: 44,
        totalIndicators: 1,
        year: 2026,
        ...overrides
      })

      it('获胜计划暴露 planId + 原始状态（与 buildCollegeDeptPlanStatusByDept 同一 winner）', () => {
        const winners = buildCollegeDeptPlanWinnerByDept([plan()], ['教务处'], makeContext())
        expect(winners.get('教务处')).toEqual({ planId: 705488, status: 'DISTRIBUTED' })
        expect(winners.has('宣传部')).toBe(false)
      })

      it('状态视图包装（buildCollegeDeptPlanStatusByDept）与 winner.status 逐条一致', () => {
        const plans = [plan(), plan({ id: 705500, status: 'PENDING', functionalOrgId: 45 })]
        const context = makeContext()
        const winners = buildCollegeDeptPlanWinnerByDept(plans, ['教务处'], context)
        const statuses = buildCollegeDeptPlanStatusByDept(plans, ['教务处'], context)
        expect(statuses.get('教务处')).toBe(winners.get('教务处')?.status)
      })
    })

    describe('buildCollegeDeptReportStatusByDept（上报侧 per-dept 状态聚合，2026-11-13）', () => {
      const winnerByDept = new Map([
        ['纪委办', { planId: 705489, status: 'DISTRIBUTED' }],
        ['教务处', { planId: 705488, status: 'DISTRIBUTED' }],
        ['无计划部门', { planId: null as number | null, status: '' }]
      ])
      const resolveDeptOrgId = (deptName: string) =>
        (({ 纪委办: 37, 教务处: 44, 无计划部门: 45 }) as Record<string, number>)[deptName] ?? null

      it('按 report.functionalOrgId 分组归属：同计划多部门报告互不串（旧共享计划口径）', () => {
        const reports = [
          { id: 1, functionalOrgId: 37, status: 'APPROVED' },
          { id: 2, functionalOrgId: 44, status: 'SUBMITTED' }
        ]
        const result = buildCollegeDeptReportStatusByDept({
          winnerByDept,
          reportsByPlanId: new Map([[705489, [reports[0]]]]),
          resolveDeptOrgId
        })
        expect(result.get('纪委办')).toBe('APPROVED')
        // 教务处的报告挂在另一份获胜计划（705488）下，此处未拉 → 不入表
        expect(result.has('教务处')).toBe(false)
      })

      it('同部门多轮报告取最新一轮（submittedAt 降序；workflowStatus 优先于 status）', () => {
        const reports = [
          { id: 1, functionalOrgId: 37, status: 'REJECTED', submittedAt: '2026-10-01T10:00:00Z' },
          {
            id: 2,
            functionalOrgId: 37,
            status: 'DRAFT',
            workflowStatus: 'APPROVED',
            submittedAt: '2026-11-01T10:00:00Z'
          }
        ]
        const result = buildCollegeDeptReportStatusByDept({
          winnerByDept,
          reportsByPlanId: new Map([[705489, reports]]),
          resolveDeptOrgId
        })
        // id=2 更新（submittedAt 较新），workflowStatus 优先 → APPROVED → 已上报基准
        expect(result.get('纪委办')).toBe('APPROVED')
      })

      it('isDeleted 报告不参与；legacy null functionalOrgId 归属获胜计划所在部门', () => {
        const reports = [
          { id: 1, functionalOrgId: null, status: 'APPROVED', isDeleted: true },
          { id: 2, functionalOrgId: null, status: 'APPROVED' }
        ]
        const result = buildCollegeDeptReportStatusByDept({
          winnerByDept,
          reportsByPlanId: new Map([[705489, reports]]),
          resolveDeptOrgId
        })
        expect(result.get('纪委办')).toBe('APPROVED')
      })

      it('计划无报告 / planId 为 null 的部门 → 不入表（徽标按「无上报」=已下发/未下发处理）', () => {
        const result = buildCollegeDeptReportStatusByDept({
          winnerByDept,
          reportsByPlanId: new Map([
            [705488, [{ id: 9, functionalOrgId: 44, status: 'APPROVED' }]]
          ]),
          resolveDeptOrgId
        })
        expect(result.get('教务处')).toBe('APPROVED')
        expect(result.has('无计划部门')).toBe(false)
        expect(result.has('纪委办')).toBe(false)
      })
    })
  })
})
