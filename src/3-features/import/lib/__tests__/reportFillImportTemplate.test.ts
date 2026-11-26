import { describe, expect, it } from 'vitest'
import {
  REPORT_FILL_LEVEL_BY_LABEL,
  REPORT_FILL_LEVEL_LABELS,
  buildReportFillGuideSheet,
  buildReportFillGuideTitle,
  buildReportFillSheetName,
  buildReportFillTemplateRules,
  buildReportFillTemplateSheet,
  resolveReportFillLevel,
  type ReportFillTemplateVariant
} from '../reportFillImportTemplate'

/**
 * 2026-11-25（指标填报导入式上报）：模板生成单测。
 *
 * <p>标准模板以需求方「SISM-导入模板-04/05/06」为准：8 列结构、三套说明页逐字照抄、
 * 样例数据使用系统真实下发全名（2026-11-26 修正：截断名/虚构名 0 命中会点名；
 * 06 第 2 行「超前」按既定裁定同步为「超前完成」）。
 */
const VARIANTS: ReportFillTemplateVariant[] = ['func', 'college-single', 'college-all']

describe('reportFillImportTemplate', () => {
  describe('自评等级白名单', () => {
    it('三个合法中文值映射到后端等级码', () => {
      expect(resolveReportFillLevel('超前完成')).toBe('AHEAD')
      expect(resolveReportFillLevel('正常')).toBe('NORMAL')
      expect(resolveReportFillLevel('滞后')).toBe('DELAYED')
    })

    it('全角空格包裹的合法值也能识别', () => {
      expect(resolveReportFillLevel('正常\u3000')).toBe('NORMAL')
    })

    it('「超前」与未知值 → null（不静默放过）', () => {
      expect(resolveReportFillLevel('超前')).toBeNull()
      expect(resolveReportFillLevel('')).toBeNull()
      expect(resolveReportFillLevel(null)).toBeNull()
      expect(resolveReportFillLevel('AHEAD')).toBeNull()
    })

    it('合法值清单文案为「超前完成 / 正常 / 滞后」', () => {
      expect(REPORT_FILL_LEVEL_LABELS).toBe('超前完成 / 正常 / 滞后')
      expect(Object.keys(REPORT_FILL_LEVEL_BY_LABEL)).toEqual(['超前完成', '正常', '滞后'])
    })
  })

  describe('数据页 7 列表头（以需求方 04/05/06 为准，2026-11-26 去掉枚举辅助列）', () => {
    it('04 职能部门：第 2 列「责任部门（登录部门）」、第 3 列「上报目标（战略发展部）」', () => {
      const sheet = buildReportFillTemplateSheet('func', '教务处')
      expect(sheet.columns.map(column => column.header)).toEqual([
        '序号',
        '责任部门\n（来源·须与登录部门一致）',
        '上报目标\n（战略发展部）',
        '子指标名称',
        '权重\n（系统只读）',
        '自评等级\n（点选填写）',
        '进度说明\n（请填写）'
      ])
    })

    it('05/06 学院：第 2 列「责任部门（登录学院）」、第 3 列「目标部门（归口职能部门）」', () => {
      const single = buildReportFillTemplateSheet('college-single', '计算机学院')
      const all = buildReportFillTemplateSheet('college-all', '计算机学院')
      expect(single.columns[1].header).toBe('责任部门\n（来源·须与登录学院一致）')
      expect(single.columns[2].header).toBe('目标部门\n（归口职能部门）')
      expect(all.columns[1].header).toBe(single.columns[1].header)
      expect(all.columns[2].header).toBe(single.columns[2].header)
      expect(single.columns).toHaveLength(7)
    })

    it('三份 sheet 名与需求方一致', () => {
      expect(buildReportFillSheetName('func')).toBe('月报填报导入模板')
      expect(buildReportFillSheetName('college-single')).toBe('月报填报导入模板')
      expect(buildReportFillSheetName('college-all')).toBe('月报填报批量导入模板')
    })
  })

  describe('说明页逐字对齐需求方文件', () => {
    it('04 职能部门版 10 条', () => {
      expect(buildReportFillTemplateRules('func')).toEqual([
        '1. 使用者：职能部门填报人登录自己账号，在「指标填报」页用「导入填报」按钮上传（需求第二步新功能）。',
        '2. 流转方向：责任部门（当前职能部门，如教务处）→ 上报目标（战略发展部）——两列都会解析校验，方向不符整单拒绝。',
        '🔴 责任部门（来源）：即「当前填报人所在部门/学院」——必须填写登录账号对应的部门，解析时与登录身份比对，不一致整单拒绝导入（防止代他部门/学院填报）。',
        '🔴 目标部门（上报到哪）：本模板已显式标出上报目标——解析时校验责任部门与目标部门的流转方向是否正确（如学院→归口部门、职能部门→战略发展部）。',
        '填报字段（黄色两列，与填报页可编辑字段一致）：① 自评等级——点击单元格下拉选择「超前完成 / 正常 / 滞后」（三选一，手输其他内容会被拒绝）；② 进度说明——当月推进情况文字说明。',
        '权重列：系统只读参考，请勿修改（该列已锁定）。',
        '3. 归属月份：本表不设月份列——归属月份在导入界面上选择。',
        '4. 定位规则：按「责任部门 + 子指标名称」匹配该部门已下发的子指标行；无匹配 = 该行失败点名。',
        '5. 导入流程：选择文件 → 解析预览（责任部门/目标校验 + 定位 + 数值校验）→ 确认导入 → 自动进入上报审批（审批通过后数据看板生效）。',
        '6. 黄色底纹两列（自评等级、进度说明）是本次要填写的内容；其余列已按系统已下发数据预填，请勿修改。'
      ])
    })

    it('05 学院单归口版 10 条', () => {
      const rules = buildReportFillTemplateRules('college-single')
      expect(rules).toHaveLength(10)
      expect(rules[0]).toBe(
        '1. 使用者：二级学院填报人登录自己账号，在「指标填报」页用「导入填报」按钮上传。'
      )
      expect(rules[1]).toContain(
        '责任部门（当前学院，如计算机学院）→ 目标部门（归口职能部门，如什邡管委会）'
      )
      expect(rules[7]).toBe(
        '4. 定位规则：按「责任部门 + 目标部门 + 子指标名称」匹配该学院该归口线已下发的子指标行；无匹配 = 该行失败点名。'
      )
    })

    it('06 学院多归口版 11 条（含第 3 条拆线规则，其后编号顺延）', () => {
      const rules = buildReportFillTemplateRules('college-all')
      expect(rules).toHaveLength(11)
      expect(rules[2]).toBe(
        '3. 拆线规则：按「目标部门」列自动拆分——每条归口线独立校验、独立提交、独立进入该线的上报审批流程（一条线失败不影响其他线）。'
      )
      expect(rules[7]).toBe('4. 归属月份：本表不设月份列——归属月份在导入界面上选择。')
      expect(rules[8]).toBe(
        '5. 定位规则：按「责任部门 + 目标部门 + 子指标名称」匹配已下发子指标行；无匹配 = 该行失败点名。'
      )
      expect(rules[10]).toBe(
        '7. 黄色底纹两列（自评等级、进度说明）是本次要填写的内容；其余列已按本学院各归口线已下发数据预填，请勿修改。'
      )
    })

    it('说明页标题三份各异', () => {
      expect(buildReportFillGuideTitle('func')).toBe(
        '填写说明（04 · 职能部门上报战略发展部 · 单点导入）'
      )
      expect(buildReportFillGuideTitle('college-single')).toBe(
        '填写说明（05 · 二级学院上报归口部门 · 单点导入）'
      )
      expect(buildReportFillGuideTitle('college-all')).toBe(
        '填写说明（06 · 二级学院上报多归口部门 · 批量导入）'
      )
    })

    it('说明页首行是标题、sheet 名为「填写说明」', () => {
      for (const variant of VARIANTS) {
        const guide = buildReportFillGuideSheet(variant)
        expect(guide.sheetName).toBe('填写说明')
        expect(guide.rows[0].text).toBe(buildReportFillGuideTitle(variant))
      }
    })
  })

  describe('数据行：只预填系统真实下发数据，自评等级/进度说明留空（2026-11-26 口径）', () => {
    it('未传预填行时回退示例：行数与部门/子指标/权重取自示例，三列填写区为空', () => {
      const func = buildReportFillTemplateSheet('func', '教务处')
      expect(func.rows).toHaveLength(2)
      expect(func.rows[0]).toMatchObject({
        serial: '1',
        responsibleDept: '教务处',
        targetDept: '战略发展部',
        weight: '40',
        selfRating: '',
        remark: ''
      })
      expect(func.rows[0].indicatorName).toBe(
        '推进教务处教学质量提升专项工作落地见效，围绕课堂教学改革、课程思政建设、' +
          '实践教学体系优化三大主线，建立教学质量监测数据平台，形成月度调度、学期评估、年度考核的持续改进闭环'
      )

      const single = buildReportFillTemplateSheet('college-single', '计算机学院')
      expect(single.rows).toHaveLength(2)
      expect(single.rows[0]).toMatchObject({
        targetDept: '数字校园建设办公室',
        indicatorName: '数字校园协同验证-统一认证与上云子项',
        weight: '55',
        selfRating: '',
        remark: ''
      })

      const all = buildReportFillTemplateSheet('college-all', '计算机学院')
      expect(all.rows).toHaveLength(4)
      expect(all.rows.filter(row => row.targetDept === '教务处')).toHaveLength(2)
      expect(all.rows.filter(row => row.targetDept === '数字校园建设办公室')).toHaveLength(2)
      expect(all.rows.every(row => row.selfRating === '' && row.remark === '')).toBe(true)
    })

    it('传入预填行时逐行映射（部门与子指标对得上），序号重排、填报区留空', () => {
      const prefill = [
        { targetDept: '人力资源部', indicatorName: 'ffff', weight: '40' },
        { targetDept: '人力资源部', indicatorName: 'www', weight: '60' },
        { targetDept: '保卫处', indicatorName: 'ggg', weight: '30' }
      ]
      const sheet = buildReportFillTemplateSheet('college-all', '文理学院', prefill)
      expect(sheet.rows).toHaveLength(3)
      expect(sheet.rows.map(row => row.serial)).toEqual(['1', '2', '3'])
      expect(sheet.rows.map(row => row.targetDept)).toEqual(['人力资源部', '人力资源部', '保卫处'])
      expect(sheet.rows.map(row => row.indicatorName)).toEqual(['ffff', 'www', 'ggg'])
      expect(sheet.rows.map(row => row.weight)).toEqual(['40', '60', '30'])
      expect(sheet.rows.every(row => row.responsibleDept === '文理学院')).toBe(true)
      expect(sheet.rows.every(row => row.selfRating === '' && row.remark === '')).toBe(true)
    })

    it('空预填行数组视同未传，仍走示例兜底', () => {
      const sheet = buildReportFillTemplateSheet('college-single', '计算机学院', [])
      expect(sheet.rows).toHaveLength(2)
    })

    it('列底色：只读列灰底/灰头，自评等级与进度说明黄底/橙头', () => {
      const sheet = buildReportFillTemplateSheet('college-all', '计算机学院')
      expect(sheet.columns.map(column => column.backgroundColor)).toEqual([
        '#EDEDED',
        '#EDEDED',
        '#EDEDED',
        '#EDEDED',
        '#EDEDED',
        '#FFE699',
        '#FFE699'
      ])
      expect(sheet.columns.map(column => column.headerBackgroundColor)).toEqual([
        '#595959',
        '#595959',
        '#595959',
        '#595959',
        '#595959',
        '#BF8F00',
        '#BF8F00'
      ])
    })

    it('「责任部门」列写当前登录组织名（不照抄他院名字）', () => {
      const other = buildReportFillTemplateSheet('college-all', '马克思主义学院')
      expect(other.rows.every(row => row.responsibleDept === '马克思主义学院')).toBe(true)
    })
  })
})
