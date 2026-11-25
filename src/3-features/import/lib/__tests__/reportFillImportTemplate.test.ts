import { describe, expect, it } from 'vitest'
import {
  REPORT_FILL_LEVEL_BY_LABEL,
  REPORT_FILL_LEVEL_LABELS,
  REPORT_FILL_TEMPLATE_COLUMNS,
  buildReportFillGuideSheet,
  buildReportFillSheetName,
  buildReportFillTemplateRules,
  buildReportFillTemplateSheet,
  resolveReportFillLevel
} from '../reportFillImportTemplate'

/**
 * 2026-11-25（指标填报导入式上报 · 学院侧）：模板生成单测。
 *
 * <p>锁两条口径：① 标准模板以需求方给的样例为准（表头含括号说明 + 逐条说明文案）；
 * ② 自评等级强制统一为「超前完成 / 正常 / 滞后」。
 */
describe('reportFillImportTemplate', () => {
  describe('自评等级白名单', () => {
    it('三个合法中文值映射到后端等级码', () => {
      expect(resolveReportFillLevel('超前完成')).toBe('AHEAD')
      expect(resolveReportFillLevel('正常')).toBe('NORMAL')
      expect(resolveReportFillLevel('滞后')).toBe('DELAYED')
    })

    it('「超前」（需求方样例旧写法）不在白名单内 → 返回 null', () => {
      expect(resolveReportFillLevel('超前')).toBeNull()
    })

    it('空值 / 空白 / 未知值 → null（不静默放过）', () => {
      expect(resolveReportFillLevel('')).toBeNull()
      expect(resolveReportFillLevel('   ')).toBeNull()
      expect(resolveReportFillLevel(null)).toBeNull()
      expect(resolveReportFillLevel('超前完成 ')).toBe('AHEAD')
      expect(resolveReportFillLevel('DELAYED')).toBeNull()
    })

    it('合法值清单文案为「超前完成 / 正常 / 滞后」', () => {
      expect(REPORT_FILL_LEVEL_LABELS).toBe('超前完成 / 正常 / 滞后')
      expect(Object.keys(REPORT_FILL_LEVEL_BY_LABEL)).toEqual(['超前完成', '正常', '滞后'])
    })
  })

  describe('数据页表头（以需求方样例为准）', () => {
    it('7 列且文案与样例一致（含括号说明）', () => {
      expect(REPORT_FILL_TEMPLATE_COLUMNS.map(column => column.label)).toEqual([
        '序号',
        '学院\n（须与登录学院一致）',
        '归口职能部门',
        '子指标名称',
        '权重\n（系统只读）',
        '自评等级\n（点选填写）',
        '进度说明\n（请填写）'
      ])
    })

    it('单归口 / 多归口的 sheet 名与样例一致', () => {
      expect(buildReportFillSheetName('single')).toBe('月报填报导入模板')
      expect(buildReportFillSheetName('all')).toBe('月报填报批量导入模板')
    })
  })

  describe('数据页样例行', () => {
    const single = buildReportFillTemplateSheet('single', '计算机学院')
    const all = buildReportFillTemplateSheet('all', '计算机学院')

    it('单归口版 2 行、同一归口部门（什邡管委会）', () => {
      expect(single.rows).toHaveLength(2)
      expect(single.rows.every(row => row.functionalDept === '什邡管委会')).toBe(true)
      expect(single.rows.map(row => row.serial)).toEqual(['1', '2'])
    })

    it('多归口版 4 行、跨两个归口部门（预算部 2 行 + 什邡管委会 2 行）', () => {
      expect(all.rows).toHaveLength(4)
      expect(all.rows.filter(row => row.functionalDept === '预算部')).toHaveLength(2)
      expect(all.rows.filter(row => row.functionalDept === '什邡管委会')).toHaveLength(2)
    })

    it('样例里的「超前」强制同步为「超前完成」', () => {
      const ahead = all.rows.find(row => row.indicatorName.includes('数字孪生'))
      expect(ahead?.selfRating).toBe('超前完成')
      expect(all.rows.every(row => row.selfRating !== '超前')).toBe(true)
    })

    it('样例行的等级全部落在白名单内（可被解析器接受）', () => {
      for (const row of [...single.rows, ...all.rows]) {
        expect(resolveReportFillLevel(row.selfRating)).not.toBeNull()
      }
    })

    it('「学院」列填当前登录学院（不照抄他院名字，否则会被整单拒绝）', () => {
      const other = buildReportFillTemplateSheet('all', '马克思主义学院')
      expect(other.rows.every(row => row.college === '马克思主义学院')).toBe(true)
    })

    it('权重列带出样例值（只读参考）', () => {
      expect(single.rows.map(row => row.weight)).toEqual(['40', '60'])
    })
  })

  describe('填写说明页', () => {
    it('单归口版含 9 条说明且含关键口径', () => {
      const rules = buildReportFillTemplateRules('single')
      expect(rules).toHaveLength(9)
      expect(rules.join('\n')).toContain('整单拒绝导入')
      expect(rules.join('\n')).toContain('超前完成 / 正常 / 滞后')
      expect(rules.join('\n')).toContain('归属月份在导入界面上选择')
    })

    it('多归口版含 10 条说明且含拆线规则', () => {
      const rules = buildReportFillTemplateRules('all')
      expect(rules).toHaveLength(10)
      expect(rules.join('\n')).toContain('拆线规则：按「归口职能部门」列自动拆分')
      expect(rules.join('\n')).toContain('一条线失败不影响其他线')
    })

    it('说明页首行是标题', () => {
      const guide = buildReportFillGuideSheet('single')
      expect(guide.sheetName).toBe('填写说明')
      expect(guide.rows[0].text).toBe('填写说明（指标填报导入 · 导入式上报 · 单归口版）')
      expect(buildReportFillGuideSheet('all').rows[0].text).toBe(
        '填写说明（指标填报批量导入 · 导入式上报 · 多归口版）'
      )
    })
  })
})
