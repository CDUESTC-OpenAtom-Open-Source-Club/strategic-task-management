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
 * 3. 职能页签表单里的 collegeAddMode 死代码（条件标题 + 永不渲染的父级选择器）清理；
 * 4. 2026-11-13（对齐 main 原版）：「关联指标」下拉改为按任务分组——结构、
 *    placeholder、双 tag、popper 分组样式全部照抄「指标下发与审批」页新增行
 *    （main 版 IndicatorDistributeView + useIndicatorDistributeView 的
 *    plansWithIndicators / getIndicatorTypeLabel / _getTaskTypeColor 同款），
 *    逻辑绑定（v-model/@change/必填校验/payload）保持学院侧原口径不变。
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
    // 2026-11-13：分组下拉（el-option-group + 双 tag）比旧单层选项长约 50 行，
    // 截窗 4500 → 6500 保证覆盖到表单尾部的空选项提示与「指标类型」选择器
    return viewSource.slice(start, start + 6500)
  }

  it('学院页签表单渲染必填「关联指标」下拉：绑定 newRow.parentIndicatorId + 锚点选项 + 带出类型', () => {
    const collegeForm = findCollegeForm()

    expect(collegeForm).toContain('关联指标')
    expect(collegeForm).toContain('v-model="newRow.parentIndicatorId"')
    // 2026-11-13（对齐 main 原版）：下拉改为按任务分组——与「指标下发与审批」页
    // 新增行完全同款结构：el-option-group 组头 = 任务完整长文案（label），
    // popper-class 挂分组样式（组头右侧灰色「任务」标记），选项行 = 核心指标名
    // + 定量/定性、基础性/发展性双 tag；placeholder 同步对齐 main 原版文案。
    expect(collegeForm).toContain('v-for="task in collegeParentIndicatorGroups"')
    expect(collegeForm).toContain(':label="task.taskContent"')
    expect(collegeForm).toContain('popper-class="parent-indicator-select-popper"')
    expect(collegeForm).toContain('parent-indicator-option__name')
    expect(collegeForm).toContain('parent-indicator-option__tags')
    expect(collegeForm).toContain('getIndicatorTypeLabel(indicator)')
    expect(collegeForm).toContain('_getTaskTypeColor(task.type2)')
    expect(collegeForm).toContain('placeholder="选择关联的核心指标"')
    expect(collegeForm).not.toContain('选择要挂靠的核心指标')
    // 空选项引导沿用 collegeParentIndicatorOptions 判空（右侧下拉所选职能部门无已下发核心指标时）
    expect(collegeForm).toContain('collegeParentIndicatorOptions.length === 0')
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
    // 2026-11-13（对齐 main 原版）：指标类型回到可编辑——父级带出的类型仅作默认值，
    // 用户可改（main 原版即如此，锁定是方案甲实现时的过度约束）。类型一致性仍由提交侧
    // `const childIndicatorType` 兜底（见下方用例）。
    expect(findCollegeForm()).toMatch(/v-model="newRow\.type1"[\s\S]{0,120}<el-option label="定性"/)
    expect(findCollegeForm()).not.toMatch(/v-model="newRow\.type1"[\s\S]{0,200}disabled/)
  })

  it('提交必带父级：未选拦「请选择关联的核心指标」，草稿行整行携带父级锚点（2026-11-14 新增行不落库）', () => {
    const saveStart = modelSource.indexOf('const saveCollegeChildIndicator')
    expect(saveStart).toBeGreaterThan(0)
    const saveBody = modelSource.slice(
      saveStart,
      modelSource.indexOf('const showAssignmentDialog', saveStart)
    )

    // 未选父级 → 保存被拦（前端必填校验）
    expect(saveBody).toContain("ElMessage.warning('请选择关联的核心指标')")
    // 2026-11-14（新增行不落库）：保存不再调 createIndicator 落库——纯内存 push
    expect(saveBody).not.toContain('indicatorApi.createIndicator')
    expect(saveBody).toContain(
      'pendingCreateDrafts.value = [...pendingCreateDrafts.value, draftRow]'
    )
    // 草稿行整行携带父级锚点与父级继承字段（发起异动时随 create 条目提交后端）
    expect(saveBody).toContain('parentIndicatorId,')
    expect(saveBody).toContain('const childIndicatorType')
    expect(saveBody).toContain(
      "parentRow && (parentRow.type1 === '定性' || parentRow.type1 === '定量')"
    )
    // 草稿行没有后端 id：id = 前端临时 id（draft- 前缀，仅前端识别用）
    expect(saveBody).toContain('draft-${Date.now()}-${++pendingCreateDraftSeq}')
    // 保存成功提示带「尚未落库」语义（用户可感知刷新即丢）
    expect(saveBody).toContain('尚未落库')
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
    // 学院表单标题（2026-11-13 对齐 main 原版：简化为「新增子指标」，与 main 一致）
    expect(viewSource).toContain('<h3 class="form-title">新增子指标</h3>')
  })

  it('model 锚点基座接线：collegeParentIndicatorOptions 消费 lib 纯函数并按右侧下拉部门过滤', () => {
    // 消费共享纯函数（不内联复制口径）
    expect(modelSource).toMatch(/buildCollegeParentAnchorIndicators\(normalizedIndicators\.value/)
    // 键 = 学院页签右侧下拉所选部门（与新增行/导入两步选择同源），不再读左侧 selectedDepartment
    expect(modelSource).toMatch(/ownerDept: collegeDispatchDeptEffective\.value/)
    // 选项带出父级自身类型（选中后锁定子指标指标类型）
    expect(modelSource).toMatch(/type1: String\(typed\.type1 \|\| ''\)/)
  })

  // 2026-11-13（对齐 main 原版）：分组数据源与「指标下发与审批」页
  // plansWithIndicators 同构——taskContent 相同归一组，组 type2 = 组内首个锚点的
  // 任务类型标签（getIndicatorCategoryLabel，与导入 seeds 同款取法），兜底「发展性」
  it('model 分组数据源：collegeParentIndicatorGroups 按 taskContent 分组 + 组 type2 任务类型标签', () => {
    expect(modelSource).toMatch(/const collegeParentIndicatorGroups = computed\(\(\) =>/)
    // 从 collegeParentIndicatorOptions（锚点 id 升序）派生，组间顺序 = 插入序
    expect(modelSource).toMatch(
      /const collegeParentIndicatorGroups = computed\(\(\) => \{[\s\S]*?collegeParentIndicatorOptions\.value\.forEach/
    )
    // 选项行带任务类型标签（基础性/发展性），取法与导入 seeds 同款
    expect(modelSource).toMatch(/type2: getIndicatorCategoryLabel\(item\)/)
    // 组 type2 兜底「发展性」（main `indicators[0]?.type2 || '发展性'` 同款）
    expect(modelSource).toMatch(/type2: option\.type2 \|\| '发展性'/)
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

/**
 * 2026-11-14（用户定案：新增行不落库）学院页签「新增行」内存草稿契约：
 *
 * <p>没点「发起异动」之前，新增行只是本地内存草稿——保存 = 写入内存（表格立即显示、
 * 权重合计实时计入、无后端请求）；刷新页面 = 草稿丢失、界面还原（无 sessionStorage）；
 * 点「发起异动」= 才把草稿按完整创建字段提交后端落库 + 进审批链；行内删除 =
 * 直接从内存移除（不调后端）。</p>
 *
 * <p>职能页签 DISTRIBUTED 分支（saveNewRow）**保持既有落库 + 旧格式 {id, create:true}**
 * ——后端 create 条目新分支硬性要求 parentIndicatorId（IndicatorMutationService
 * :402-405），核心指标行没有父级，内存化会导致发起异动整批 400；后端注释
 * 「旧格式继续兼容（别的地方还在用）」即指该分支。</p>
 */
describe('学院新增行内存草稿（2026-11-14 不落库改造 源码契约）', () => {
  const sliceFrom = (source: string, startMarker: string, endMarker: string): string => {
    const start = source.indexOf(startMarker)
    expect(start).toBeGreaterThan(0)
    const end = source.indexOf(endMarker, start)
    expect(end).toBeGreaterThan(start)
    return source.slice(start, end)
  }

  it('草稿行并入学院表格行集：collegeTableIndicators 合并 collegeCreateDraftRows 并整表重排', () => {
    const computedBody = sliceFrom(
      modelSource,
      'const collegeTableIndicators = computed',
      'const isIndicatorInCollegePlanScope'
    )
    // 库存行 + 内存草稿行合并后统一排序（草稿行与真实兄弟行同组参与 sortOrder 排序）
    expect(computedBody).toContain('[...storeRows, ...collegeCreateDraftRows.value]')
    expect(computedBody).toContain('.sort(compareCollegeTableRows)')
    // 排序比较器对 draft-* 临时 id NaN 安全（草稿行排在同序位真实行之后）
    expect(modelSource).toContain('Number.isFinite(idA) ? idA : Number.MAX_SAFE_INTEGER')
    // 草稿行按同一过滤口径收口：归属部门 + 学院名
    const draftRowsBody = sliceFrom(
      modelSource,
      'const collegeCreateDraftRows = computed',
      'const collegeTableIndicators = computed'
    )
    expect(draftRowsBody).toContain('resolveRowOwnerDept')
    expect(draftRowsBody).toContain('deptName === target || deptName.includes(target)')
  })

  it('权重合计实时计入内存行：collegeBasicWeightTotal 读 collegeTableIndicators（草稿行已并入行集）', () => {
    const weightTotalBody = sliceFrom(
      modelSource,
      'const collegeBasicWeightTotal = computed',
      '// PR#83 头部'
    )
    expect(weightTotalBody).toContain('collegeTableIndicators.value')
    expect(weightTotalBody).toContain('isBasicIndicatorForCurrentRules')
    // 草稿行自带父级 taskId / 任务类型标签，能过基础性判定（与真实子指标同构）
    expect(modelSource).toContain(
      'type2: getIndicatorCategoryLabel(parentRow as StrategicIndicator)'
    )
    expect(modelSource).toMatch(/const draftRow: PendingCreateDraft = \{/)
  })

  it('「发起异动」按钮与横幅计数覆盖内存行：hasMutationDraft / mutationDraftCount 计入 pendingCreateDrafts', () => {
    expect(modelSource).toMatch(
      /hasRealMutationDraft \|\|\s*\n\s*taskNameDrafts\.value\.length > 0 \|\|\s*\n\s*pendingCreatedIndicatorIds\.value\.length > 0 \|\|\s*\n\s*\/\/ 2026-11-14（新增行不落库）：学院页签内存草稿行同样点亮「发起异动」\s*\n\s*pendingCreateDrafts\.value\.length > 0/
    )
    expect(modelSource).toMatch(
      /taskNameDrafts\.value\.length \+\s*\n\s*pendingCreatedIndicatorIds\.value\.length \+\s*\n\s*pendingCreateDrafts\.value\.length/
    )
  })

  it('发起异动载荷按后端新契约整行提交：create 条目带完整创建字段、不带 id，成功后清内存集合', () => {
    const submitBody = sliceFrom(
      modelSource,
      'const submitMutationDraft = async',
      '// 指标双击编辑'
    )
    // 键名与后端 IndicatorMutationService.createAndMarkNewIndicatorInMutation 严格一致
    expect(submitBody).toContain('create: true,')
    expect(submitBody).toContain('indicatorDesc: draft.name,')
    expect(submitBody).toContain('weightPercent: draft.weight,')
    expect(submitBody).toContain('indicatorType: draft.type1,')
    expect(submitBody).toContain('parentIndicatorId: draft.parentIndicatorId,')
    expect(submitBody).toContain('taskId: draft.taskId,')
    expect(submitBody).toContain('remark: draft.remark')
    // 旧格式（职能页签落库行）继续兼容
    expect(submitBody).toContain('pendingCreates.map(id => ({ id, create: true as const }))')
    // 提交成功 = 草稿行已在后端落库，内存集合清空
    expect(submitBody).toMatch(/pendingCreateDrafts\.value = \[\]/)
  })

  it('撤销新增不调后端：内存行删除 = 直接从集合移除（无 store.deleteIndicator / 无刷新链）', () => {
    const draftRemoveBody = sliceFrom(
      modelSource,
      'const removePendingCreateDraftRow',
      'const MUTATION_FIELD_MAP'
    )
    expect(draftRemoveBody).toContain('pendingCreateDrafts.value.filter')
    expect(draftRemoveBody).not.toContain('deleteIndicator')
    // 异动草稿删除分支：内存行先于一切后端路径拦截
    const applyDeleteBody = sliceFrom(
      modelSource,
      'const applyDeleteMutationDraft',
      'const resolveAuthoritativeIndicatorValue'
    )
    expect(applyDeleteBody).toMatch(
      /if \(isPendingCreateDraftRow\(row\)\) \{[\s\S]*?removePendingCreateDraftRow\(row\)[\s\S]*?return\s*\n\s*\}/
    )
    // 草稿分支提示文案与职能页签落库行撤销文案区分开（后者仍走后端删除）
    expect(applyDeleteBody).toContain('已撤销本次新增的草稿行')
    // 直删路径守卫：handleDeleteIndicator 最早分支拦内存行（防走 ElMessageBox + store 直删）
    const handleDeleteBody = sliceFrom(
      modelSource,
      'const handleDeleteIndicator',
      '// ================== 审批流程相关'
    )
    expect(handleDeleteBody.indexOf('isPendingCreateDraftRow(row)')).toBeGreaterThan(-1)
    expect(handleDeleteBody.indexOf('isPendingCreateDraftRow(row)')).toBeLessThan(
      handleDeleteBody.indexOf('canDeleteIndicator(row)')
    )
  })

  it('刷新语义：内存草稿无任何持久化——保存路径不写 sessionStorage，集合声明块无存储键', () => {
    const saveBody = sliceFrom(
      modelSource,
      'const saveCollegeChildIndicator',
      'const showAssignmentDialog'
    )
    expect(saveBody).not.toContain('sessionStorage')
    expect(saveBody).not.toContain('refreshTaskPageAfterIndicatorMutation')
    // pendingCreateDrafts 是纯内存 ref：声明点到职能页签落库行集合声明之间无存储键/持久化函数
    // （类型 JSDoc 里「无 sessionStorage」的语义描述本身不参与切片）
    const draftDeclBody = sliceFrom(
      modelSource,
      'const pendingCreateDrafts = ref<PendingCreateDraft[]>',
      'const pendingCreatedIndicatorIds = ref'
    )
    expect(draftDeclBody).not.toContain('sessionStorage')
    expect(draftDeclBody).not.toContain('PENDING_CREATE_STORAGE_KEY')
    // 存储键仍存在但只服务职能页签落库行（pendingCreatedIndicatorIds），与草稿无关
    expect(modelSource).toMatch(/只剩\*\*职能页签\*\* DISTRIBUTED\s*\n\s*\* 分支在用/)
  })

  it('双击编辑内存行 = 原地更新草稿（不进 mutationDrafts，临时 id 不会炸提交载荷）', () => {
    const editSaveBody = sliceFrom(
      modelSource,
      'const saveIndicatorEdit = async',
      'const cancelIndicatorEdit'
    )
    expect(editSaveBody).toMatch(
      /if \(isPendingCreateDraftRow\(row\) && MUTATION_FIELD_MAP\[field\]\) \{[\s\S]*?pendingCreateDrafts\.value\.map/
    )
    expect(editSaveBody).toContain('weight: Number(value)')
    // 草稿行分支先于 effectiveHasDistributedIndicators 攒改分支
    expect(editSaveBody.indexOf('isPendingCreateDraftRow(row)')).toBeLessThan(
      editSaveBody.indexOf('effectiveHasDistributedIndicators.value && MUTATION_FIELD_MAP[field]')
    )
  })

  it('草稿行不产生网络噪音：上报/异动历史按临时 id 短路，视图徽章不渲染', () => {
    // 上报历史缓存：非正数 id（draft-*）直接按「无上报」处理
    const fillsSource = readSource('src/3-features/indicator/model/useIndicatorFills.ts')
    expect(fillsSource).toMatch(/!Number\.isFinite\(numericId\) \|\| numericId <= 0/)
    // 异动历史缓存：同样短路
    const historySource = readSource('src/3-features/indicator/model/mutationHistory.ts')
    expect(historySource).toMatch(/!Number\.isFinite\(numericId\) \|\| numericId <= 0/)
    // 学院表格两处异动徽章按草稿行守卫（渲染层不再对临时 id 发请求）
    expect(viewSource).toMatch(/v-if="row\.id && !isPendingCreateDraftRow\(row\)"/)
    // 上报完成度聚合剔除内存行（草稿行不该进「有未填报」口径）
    expect(modelSource).toMatch(
      /collegeTableIndicators\.value\.filter\(row => !isPendingCreateDraftRow\(row\)\)/
    )
  })

  it('职能页签 DISTRIBUTED 分支保持落库 + 旧格式（后端 create 条目要求 parentIndicatorId，内存化不可行）', () => {
    const saveNewRowBody = sliceFrom(modelSource, 'const saveNewRow = async', '// 删除指标')
    // 职能页签新增行仍经 store 落库（addIndicator），落库后进 pendingCreatedIndicatorIds
    expect(saveNewRowBody).toContain('strategicStore.addIndicator')
    expect(saveNewRowBody).toContain(
      'pendingCreatedIndicatorIds.value = [...pendingCreatedIndicatorIds.value, createdIndicatorId]'
    )
    // 职能页签 DRAFT 计划新增行保持落库（编制计划语义，红线）：saveNewRow 未改直写主链
    expect(saveNewRowBody).toContain('await saveCollegeChildIndicator(collegeWeight)')
    expect(saveNewRowBody).toContain('collegeAddMode.value')
  })
})
