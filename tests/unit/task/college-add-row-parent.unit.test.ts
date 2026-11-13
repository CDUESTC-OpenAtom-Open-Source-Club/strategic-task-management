import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildCollegeParentAnchorIndicators,
  type DispatchEligibilityIndicatorLike
} from '@/features/task/lib/collegeDispatchEligibility'

const readSource = (relative: string): string =>
  readFileSync(resolve(process.cwd(), relative), 'utf8')

const viewSource = readSource('src/3-features/task/ui/StrategicTaskView.vue')
const modelSource = readSource('src/3-features/task/model/useStrategicTaskView.ts')

/**
 * 2026-11-13（方案甲恢复，用户拍板）学院「新增行」父级锚点用例口径：
 *
 * 1. 父级「关联指标」恢复**必填**——新增行与导入模板同一锚点口径
 *    （挂到右侧下拉所选职能部门已接收的、战略部已下发的核心指标下），
 *    不再产生 parent=null 的单层孤儿数据；
 * 2. 选中父级后自动带出父级的「指标类型 / 任务类型」（与导入锚点一致：
 *    父级名与类型须完全一致），提交请求体必带 parentIndicatorId 且
 *    indicatorType 与父级一致；
 * 3. 职能页签表单里的 collegeAddMode 死代码（条件标题 + 永不渲染的父级选择器）清理。
 *
 * 纯逻辑锚点过滤用 task/lib/collegeDispatchEligibility 的
 * buildCollegeParentAnchorIndicators 锁（实现与测试共用同一份函数）；
 * 组件/模型接线用源码契约锁（8k 行 composable 不宜整体实例化，
 * college-two-step-selection 同款模式）。
 */

const normalizeIdentity = (value?: string | null): string => String(value ?? '').trim()

const makeIndicator = (overrides: Partial<DispatchEligibilityIndicatorLike> = {}) => ({
  id: 1,
  name: '核心指标甲',
  status: 'DISTRIBUTED',
  ownerDept: '战略发展部',
  targetDepartment: '教务处',
  ...overrides
})

describe('task/lib/collegeDispatchEligibility · buildCollegeParentAnchorIndicators（学院锚点基座）', () => {
  it('只保留「已下发根指标 + owner=战略部 + 目标部门=所选职能部门」的锚点，并按 id 升序', () => {
    const anchors = buildCollegeParentAnchorIndicators(
      [
        makeIndicator({ id: 3, name: '锚点丙' }),
        makeIndicator({ id: 1, name: '锚点甲' }),
        // 子指标：不能做父级
        makeIndicator({ id: 4, parentIndicatorId: 1, name: '子指标' }),
        // 草稿核心指标：不能做父级（与后端 findCoreDispatchAnchors status=DISTRIBUTED 同口径）
        makeIndicator({ id: 5, status: 'DRAFT', name: '草稿核心' }),
        // 目标部门不是所选部门
        makeIndicator({ id: 6, targetDepartment: '财务部', name: '别部门核心' }),
        // owner 不是战略部（存量职能部门 owner）
        makeIndicator({ id: 7, ownerDept: '教务处', name: '存量核心' })
      ],
      { ownerDept: '教务处', strategicDeptName: '战略发展部', normalize: normalizeIdentity }
    )

    expect(anchors.map(item => item.id)).toEqual([1, 3])
  })

  it('未选职能部门（ownerDept 为空）→ 无锚点（两步选择未齐不得出现父级选项）', () => {
    expect(
      buildCollegeParentAnchorIndicators([makeIndicator()], {
        ownerDept: '',
        strategicDeptName: '战略发展部',
        normalize: normalizeIdentity
      })
    ).toEqual([])
  })

  it('目标部门名走注入的 normalize（别名/ID 归一后匹配；含子串的合并部门名放行）', () => {
    const anchors = buildCollegeParentAnchorIndicators(
      [
        makeIndicator({ id: 11, targetDepartment: '38' }),
        makeIndicator({ id: 12, targetDepartment: '纪委办公室 | 监察处' })
      ],
      {
        ownerDept: '纪委办公室 | 监察处',
        strategicDeptName: '战略发展部',
        // 模拟 departmentAliasNameMap：ID → 标准名
        normalize: value =>
          String(value) === '38' ? '纪委办公室 | 监察处' : String(value ?? '').trim()
      }
    )

    expect(anchors.map(item => item.id)).toEqual([11, 12])
  })

  it('ACTIVE 为旧数据「已下发」等价状态，同样可做父级锚点', () => {
    const anchors = buildCollegeParentAnchorIndicators(
      [makeIndicator({ id: 21, status: 'ACTIVE' })],
      { ownerDept: '教务处', strategicDeptName: '战略发展部', normalize: normalizeIdentity }
    )
    expect(anchors.map(item => item.id)).toEqual([21])
  })

  it('strategicDeptName 取不到时跳过 owner 校验（fail-open，不因组织名缺失滤空）', () => {
    const anchors = buildCollegeParentAnchorIndicators(
      [makeIndicator({ id: 31, ownerDept: '教务处' })],
      { ownerDept: '教务处', strategicDeptName: '', normalize: normalizeIdentity }
    )
    expect(anchors.map(item => item.id)).toEqual([31])
  })
})

describe('学院「新增行」父级锚点接线（方案甲 2026-11-13 源码契约）', () => {
  const findCollegeForm = (): string => {
    const start = viewSource.search(/isAddingOrEditing && activeTaskTabName === 'college'/)
    expect(start).toBeGreaterThan(0)
    return viewSource.slice(start, start + 4500)
  }

  it('学院页签表单渲染必填「关联指标」下拉：绑定 newRow.parentIndicatorId + 锚点选项 + 带出类型', () => {
    const collegeForm = findCollegeForm()

    expect(collegeForm).toContain('关联指标')
    expect(collegeForm).toContain('v-model="newRow.parentIndicatorId"')
    expect(collegeForm).toContain('collegeParentIndicatorOptions')
    expect(collegeForm).toContain('@change="handleCollegeParentIndicatorChange"')
    // 空选项引导（右侧下拉所选职能部门无已下发核心指标时）
    expect(collegeForm).toContain('暂无已下发的核心指标')
  })

  it('选中父级带出锚点字段：类型随父级锁定、任务类型/战略任务内部同步（不采纳手填冲突值）', () => {
    const handlerStart = viewSource.indexOf('const handleCollegeParentIndicatorChange')
    expect(handlerStart).toBeGreaterThan(0)
    const handler = viewSource.slice(handlerStart, handlerStart + 1200)

    expect(handler).toContain('indicatorByIdMap.value.get(String(value))')
    expect(handler).toContain("newRow.value.type1 = parent.type1 === '定性' ? '定性' : '定量'")
    expect(handler).toContain('newRow.value.type2 = getIndicatorCategoryLabel(parent)')
    expect(handler).toContain("newRow.value.taskContent = String(parent.taskContent || '')")
    // 学院表单的指标类型选择器锁定为父级带出值（锚点只读，同导入「核心指标类型」列）
    expect(findCollegeForm()).toMatch(/v-model="newRow\.type1"[\s\S]{0,200}disabled/)
  })

  it('提交必带父级：未选拦「请选择关联的核心指标」，payload 直传 parentIndicatorId 不再可选', () => {
    const saveStart = modelSource.indexOf('const saveCollegeChildIndicator')
    expect(saveStart).toBeGreaterThan(0)
    const saveBody = modelSource.slice(
      saveStart,
      modelSource.indexOf('await refreshTaskPageAfterIndicatorMutation', saveStart)
    )

    // 未选父级 → 保存被拦（前端必填校验）
    expect(saveBody).toContain("ElMessage.warning('请选择关联的核心指标')")
    // payload 必传父级（2026-11-08 的 `parentIndicatorId: parentIndicatorId ?? undefined` 可选语义移除）
    expect(saveBody).toMatch(/parentIndicatorId,\n\s+type: childIndicatorType/)
    expect(saveBody).not.toContain('parentIndicatorId ?? undefined')
    // 提交类型以父级核心指标类型为准（锚点一致性兜底）
    expect(saveBody).toContain('const childIndicatorType')
    expect(saveBody).toContain(
      "parentRow && (parentRow.type1 === '定性' || parentRow.type1 === '定量')"
    )
  })

  it('职能页签死代码清理：collegeAddMode 条件标题与永不渲染的父级选择器移除', () => {
    // 职能页签表单（activeTaskTabName === 'functional'）不再包含 collegeAddMode 分支
    const functionalFormStart = viewSource.search(
      /isAddingOrEditing && activeTaskTabName === 'functional'/
    )
    expect(functionalFormStart).toBeGreaterThan(0)
    const paneEnd = viewSource.indexOf('</el-tab-pane>', functionalFormStart)
    expect(paneEnd).toBeGreaterThan(functionalFormStart)
    const functionalForm = viewSource.slice(functionalFormStart, paneEnd)
    // 标题不再条件化（原 `{{ collegeAddMode ? ... : ... }}`），父级选择器死块（v-if="collegeAddMode"）
    // 与任务行上的 v-if="!collegeAddMode" 一并移除——只允许说明性注释里出现这些历史名词
    expect(functionalForm).toContain('新增任务指标')
    expect(functionalForm).not.toMatch(/\{\{\s*collegeAddMode/)
    expect(functionalForm).not.toMatch(/v-if="!?collegeAddMode"/)
    expect(functionalForm).not.toMatch(
      /<template #label><span class="required-asterisk">\*<\/span>关联指标/
    )
    expect(functionalForm).not.toContain('v-model="newRow.parentIndicatorId"')
    // 学院表单标题保留（方案甲下语义恢复正确）
    expect(viewSource).toContain('新增子指标（挂到核心指标下）')
  })

  it('model 锚点基座接线：collegeParentIndicatorOptions 消费 lib 纯函数并按右侧下拉部门过滤', () => {
    // 消费共享纯函数（不内联复制口径）
    expect(modelSource).toMatch(/buildCollegeParentAnchorIndicators\(normalizedIndicators\.value/)
    // 键 = 学院页签右侧下拉所选部门（与新增行/导入两步选择同源），不再读左侧 selectedDepartment
    expect(modelSource).toMatch(/ownerDept: collegeDispatchDeptEffective\.value/)
    // 选项带出父级自身类型（选中后锁定子指标指标类型）
    expect(modelSource).toMatch(/type1: String\(typed\.type1 \|\| ''\)/)
  })
})

describe('学院导入模板父级预填 seeds（方案甲 2026-11-13 接线契约）', () => {
  it('视图不再传空数组常量：导入弹窗 parent-indicators 直连 collegeImportParentIndicators', () => {
    expect(viewSource).not.toContain('COLLEGE_IMPORT_PARENT_INDICATORS')
    expect(viewSource).toMatch(
      /activeTaskTabName === 'college' \? collegeImportParentIndicators : undefined/
    )
  })

  it('model seeds 与新增行父级同源：同一锚点基座 + 任务类型标签映射，旧 computed 移除', () => {
    // 同一基座（右侧下拉所选部门 + DISTRIBUTED 根指标 + id 升序，过滤逻辑在 lib 纯函数）
    expect(modelSource).toMatch(
      /const collegeImportParentIndicators = computed\(\(\) =>\s*\n\s*collegeDispatchAnchorIndicators\.value\.map/
    )
    // 「任务类型」列预填 = 父级所属任务类型标签（基础性/发展性）
    expect(modelSource).toMatch(/type2: getIndicatorCategoryLabel\(item\)/)
    // 视图侧无人消费的 selectedCollegeDispatchParentIndicators 声明一并移除
    expect(modelSource).not.toMatch(/const selectedCollegeDispatchParentIndicators/)
  })
})
