import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
  REPORT_FILL_LEVEL_BY_LABEL,
  REPORT_FILL_LEVEL_LABELS,
  TEMPLATE_STYLE,
  buildReportFillGuideSheet,
  buildReportFillGuideTitle,
  buildReportFillSheetName,
  buildReportFillTemplateRules,
  buildReportFillTemplateSheet,
  resolveReportFillLevel,
  type ReportFillTemplateVariant
} from '../reportFillImportTemplate'
import { buildExcelBlob } from '@/shared/lib/export/excel'

/**
 * 2026-11-25（指标填报导入式上报）：模板生成单测。
 *
 * <p>标准模板以需求方「SISM-导入模板-04/05/06」为准：8 列结构、三套说明页逐字照抄、
 * 样例数据使用系统真实下发全名（2026-11-26 修正：截断名/虚构名 0 命中会点名；
 * 06 第 2 行「超前」按既定裁定同步为「超前完成」）。
 *
 * <p>2026-11-26（样式逐格对齐）：新增 xlsx 级断言——隐藏列、裸值列、F 列下拉、
 * 整表保护、冻结 C2、列宽/行高、微软雅黑字体，全部在生成的 xlsx XML 上核对。
 */
const VARIANTS: ReportFillTemplateVariant[] = ['func', 'college-single', 'college-all']

/** 读取 xlsx 内某个文件的 xml 文本 */
const readPart = async (blob: Blob, path: string): Promise<string> => {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const file = zip.file(path)
  if (!file) {
    throw new Error(`xlsx 内缺少文件：${path}`)
  }
  return file.async('string')
}

/** 取出某个 `<c r="XX" ...>` 开始标签 */
const getCellTag = (sheetXml: string, reference: string): string => {
  const match = sheetXml.match(new RegExp(`<c r="${reference}"[^>]*>`))
  return match?.[0] ?? ''
}

/** 生成 04/05/06 三份上报模板的 xlsx（数据页 + 说明页） */
const buildTemplateBlob = async (variant: ReportFillTemplateVariant): Promise<Blob> =>
  buildExcelBlob([
    buildReportFillTemplateSheet(variant, '教务处') as never,
    buildReportFillGuideSheet(variant) as never
  ])

describe('reportFillImportTemplate', () => {
  describe('自评等级白名单', () => {
    it('三个合法中文值映射到后端等级码', () => {
      expect(resolveReportFillLevel('超前完成')).toBe('AHEAD')
      expect(resolveReportFillLevel('正常')).toBe('NORMAL')
      expect(resolveReportFillLevel('滞后')).toBe('DELAYED')
    })

    it('全角空格包裹的合法值也能识别', () => {
      expect(resolveReportFillLevel('正常　')).toBe('NORMAL')
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

  describe('数据页 8 列表头（以需求方 04/05/06 为准）', () => {
    it('04 职能部门：第 2 列「责任部门（登录部门）」、第 3 列「上报目标（战略发展部）」', () => {
      const sheet = buildReportFillTemplateSheet('func', '教务处')
      expect(sheet.columns.map(column => column.header)).toEqual([
        '序号',
        '责任部门\n（来源·须与登录部门一致）',
        '上报目标\n（战略发展部）',
        '子指标名称',
        '权重\n（系统只读）',
        '自评等级\n（点选填写）',
        '进度说明\n（请填写）',
        '（枚举来源，勿动）'
      ])
    })

    it('05/06 学院：第 2 列「责任部门（登录学院）」、第 3 列「目标部门（归口职能部门）」', () => {
      const single = buildReportFillTemplateSheet('college-single', '计算机学院')
      const all = buildReportFillTemplateSheet('college-all', '计算机学院')
      expect(single.columns[1].header).toBe('责任部门\n（来源·须与登录学院一致）')
      expect(single.columns[2].header).toBe('目标部门\n（归口职能部门）')
      expect(all.columns[1].header).toBe(single.columns[1].header)
      expect(all.columns[2].header).toBe(single.columns[2].header)
      expect(single.columns).toHaveLength(8)
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
        '6. 黄色底纹行为示例数据，正式导入前请删除。'
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
        '7. 彩色底纹行为示例数据（绿=教务处线 / 黄=数字校园建设办公室线），正式导入前请删除。'
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

  describe('样例数据使用系统真实下发全名（2026-11-26 口径修正）', () => {
    it('04 样例：教务处 / 战略发展部 / 2 条数据行 + 1 行枚举，首行用核心指标 2005 全名', () => {
      const sheet = buildReportFillTemplateSheet('func', '教务处')
      expect(sheet.rows).toHaveLength(3)
      expect(sheet.rows[0]).toMatchObject({
        serial: '1',
        responsibleDept: '教务处',
        targetDept: '战略发展部',
        weight: '40',
        selfRating: '正常',
        enumSource: '超前完成'
      })
      // 2026-11-26 修复：原名是截断的「推进教务处教学质量提升专项工作落地见效」→
      // 换成系统下发全名（截断名在后端按名称精确定位 0 命中会点名）
      expect(sheet.rows[0].indicatorName).toBe(
        '推进教务处教学质量提升专项工作落地见效，围绕课堂教学改革、课程思政建设、'
          + '实践教学体系优化三大主线，建立教学质量监测数据平台，形成月度调度、学期评估、年度考核的持续改进闭环'
      )
      expect(sheet.rows[0].indicatorName).toHaveLength(85)
      expect(sheet.rows[0].indicatorName?.endsWith('持续改进闭环')).toBe(true)
      expect(sheet.rows[1].indicatorName).toBe('完善课程建设与专业评估机制')
      expect(sheet.rows[2].enumSource).toBe('滞后')
    })

    it('05 样例：计算机学院 / 数字校园建设办公室线真实子指标 / 2 条数据行', () => {
      const sheet = buildReportFillTemplateSheet('college-single', '计算机学院')
      expect(sheet.rows).toHaveLength(3)
      expect(sheet.rows[0]).toMatchObject({
        responsibleDept: '计算机学院',
        targetDept: '数字校园建设办公室',
        indicatorName: '数字校园协同验证-统一认证与上云子项',
        weight: '55',
        selfRating: '滞后'
      })
      expect(sheet.rows[1].indicatorName).toBe('数字校园协同验证-数据治理子项')
    })

    it('06 样例：4 行、跨教务处/数字校园建设办公室两条真实线，第 2 行等级已同步为「超前完成」', () => {
      const sheet = buildReportFillTemplateSheet('college-all', '计算机学院')
      expect(sheet.rows).toHaveLength(4)
      expect(sheet.rows.filter(row => row.targetDept === '教务处')).toHaveLength(2)
      expect(sheet.rows.filter(row => row.targetDept === '数字校园建设办公室')).toHaveLength(2)
      expect(sheet.rows[0].indicatorName).toBe('导入下发验证-基础A')
      const second = sheet.rows[1]
      expect(second.indicatorName).toBe('导入下发验证-基础B')
      // 需求方样例写「超前」→ 按 2026-11-25 裁定强制同步
      expect(second.selfRating).toBe('超前完成')
      expect(sheet.rows.every(row => row.selfRating !== '超前')).toBe(true)
      expect(sheet.rows[2].indicatorName).toBe('数字校园协同验证-统一认证与上云子项')
      expect(sheet.rows[3].indicatorName).toBe('数字校园协同验证-数据治理子项')
    })

    it('示例行子指标名不得是截断名/虚构名：名称非空时必须以系统真实下发全名出现', () => {
      // 本地库锚点（2026-11-26 核对）：计算机学院两条真实线 + 教务处 2005/2006 全名
      const realNames = new Set([
        '推进教务处教学质量提升专项工作落地见效，围绕课堂教学改革、课程思政建设、实践教学体系优化三大主线，'
          + '建立教学质量监测数据平台，形成月度调度、学期评估、年度考核的持续改进闭环',
        '完善课程建设与专业评估机制',
        '导入下发验证-基础A',
        '导入下发验证-基础B',
        '数字校园协同验证-统一认证与上云子项',
        '数字校园协同验证-数据治理子项'
      ])
      for (const variant of VARIANTS) {
        for (const row of buildReportFillTemplateSheet(variant, 'X').rows) {
          if (row.indicatorName) {
            expect(realNames.has(row.indicatorName)).toBe(true)
          }
        }
      }
    })

    it('样例行的等级全部落在白名单内（非空时）', () => {
      for (const variant of VARIANTS) {
        for (const row of buildReportFillTemplateSheet(variant, 'X').rows) {
          if (row.selfRating) {
            expect(resolveReportFillLevel(row.selfRating)).not.toBeNull()
          }
        }
      }
    })

    it('「责任部门」列写当前登录组织名（不照抄他院名字）', () => {
      const other = buildReportFillTemplateSheet('college-all', '马克思主义学院')
      expect(other.rows.filter(row => row.responsibleDept !== null).every(
        row => row.responsibleDept === '马克思主义学院'
      )).toBe(true)
    })
  })

  describe('仅枚举行（04/05 末行）：整行只有第 8 列有值', () => {
    it('04 末行：责任部门为空、其余列为空，只保留枚举第三档', () => {
      const sheet = buildReportFillTemplateSheet('func', '教务处')
      const last = sheet.rows[sheet.rows.length - 1]
      expect(last.enumSource).toBe('滞后')
      expect(last.responsibleDept).toBeNull()
      expect(last.serial).toBeNull()
      expect(last.targetDept).toBeNull()
      expect(last.indicatorName).toBeNull()
      expect(last.weight).toBeNull()
      expect(last.selfRating).toBeNull()
      expect(last.remark).toBeNull()
    })

    it('05 末行同样是仅枚举行', () => {
      const sheet = buildReportFillTemplateSheet('college-single', '计算机学院')
      const last = sheet.rows[sheet.rows.length - 1]
      expect(last.enumSource).toBe('滞后')
      expect(last.responsibleDept).toBeNull()
      expect(last.selfRating).toBeNull()
    })

    it('06 末行是正常数据行（第 4 行数据行，无枚举值）', () => {
      const sheet = buildReportFillTemplateSheet('college-all', '计算机学院')
      const last = sheet.rows[sheet.rows.length - 1]
      expect(last.serial).toBe('4')
      expect(last.enumSource).toBeNull()
      expect(last.responsibleDept).toBe('计算机学院')
    })
  })

  describe('模板动态行（2026-11-26：真实已下发子指标替换静态示例行）', () => {
    /** 计算机学院×教务处线（700067）的 4 条真实子指标（名称/权重以本地库为准） */
    const dynamicRows = [
      { targetDept: '教务处', name: '导入下发验证-基础A', weight: 40 },
      { targetDept: '教务处', name: '导入下发验证-基础B', weight: 30 },
      { targetDept: '教务处', name: '导入下发验证-基础C', weight: 30 },
      { targetDept: '教务处', name: '导入下发验证-发展D', weight: 100 }
    ]

    it('05 单归口：数据行 = 传入的真实子指标逐行——名称/权重预填、等级/说明留空、序号逐行递增', () => {
      const sheet = buildReportFillTemplateSheet('college-single', '计算机学院', dynamicRows)
      expect(sheet.rows).toHaveLength(4)
      expect(sheet.rows[0]).toMatchObject({
        serial: '1',
        responsibleDept: '计算机学院',
        targetDept: '教务处',
        indicatorName: '导入下发验证-基础A',
        weight: '40',
        selfRating: null,
        remark: null
      })
      expect(sheet.rows[3]).toMatchObject({
        serial: '4',
        indicatorName: '导入下发验证-发展D',
        weight: '100'
      })
      expect(sheet.rows.map(row => row.serial)).toEqual(['1', '2', '3', '4'])
    })

    it('动态行 H2:H4 补齐三档枚举（F 列下拉源），第 4 行起不落格；责任部门逐行写登录组织', () => {
      const sheet = buildReportFillTemplateSheet('college-single', '计算机学院', dynamicRows)
      expect(sheet.rows.map(row => row.enumSource)).toEqual(['超前完成', '正常', '滞后', null])
      expect(sheet.rows.every(row => row.responsibleDept === '计算机学院')).toBe(true)
      expect(sheet.dataValidations?.[0]?.formula1).toBe('=$H$2:$H$4')
    })

    it('真实行不足 3 行：补「仅枚举行」凑齐 H2:H4（不落责任部门/序号）', () => {
      const sheet = buildReportFillTemplateSheet('college-single', '计算机学院', [dynamicRows[0]])
      expect(sheet.rows).toHaveLength(3)
      expect(sheet.rows[0]).toMatchObject({ serial: '1', indicatorName: '导入下发验证-基础A' })
      expect(sheet.rows[1]).toMatchObject({
        serial: null,
        responsibleDept: null,
        indicatorName: null,
        enumSource: '正常'
      })
      expect(sheet.rows[2]).toMatchObject({ serial: null, responsibleDept: null, enumSource: '滞后' })
    })

    it('04 职能：目标部门未传时补「战略发展部」', () => {
      const sheet = buildReportFillTemplateSheet('func', '教务处', [
        { targetDept: null, name: '完善课程建设与专业评估机制', weight: 60 }
      ])
      expect(sheet.rows[0].targetDept).toBe('战略发展部')
      expect(sheet.rows[0].responsibleDept).toBe('教务处')
    })

    it('06 批量：多归口行逐行落格（归口分组排布由调用方定序），等级/说明全部留空', () => {
      const sheet = buildReportFillTemplateSheet('college-all', '计算机学院', [
        { targetDept: '教务处', name: '导入下发验证-基础A', weight: 40 },
        { targetDept: '教务处', name: '导入下发验证-基础B', weight: 30 },
        { targetDept: '党委办公室', name: '党委办协同验证-A', weight: 50 },
        { targetDept: '党委办公室', name: '党委办协同验证-B', weight: 50 }
      ])
      expect(sheet.rows.map(row => row.targetDept)).toEqual([
        '教务处',
        '教务处',
        '党委办公室',
        '党委办公室'
      ])
      expect(sheet.rows.every(row => row.selfRating === null && row.remark === null)).toBe(true)
    })

    it('空数组/缺参回退静态示例行（兜底口径不变；静态样例既有断言即回归）', () => {
      const fallback = buildReportFillTemplateSheet('college-single', '计算机学院')
      const empty = buildReportFillTemplateSheet('college-single', '计算机学院', [])
      expect(empty.rows).toEqual(fallback.rows)
      expect(empty.rows[0].indicatorName).toBe('数字校园协同验证-统一认证与上云子项')
    })

    it('生成的 xlsx：数据页落真实行（静态示例名不再出现），样式/保护/下拉口径不变', async () => {
      const blob = await buildExcelBlob([
        buildReportFillTemplateSheet('college-single', '计算机学院', dynamicRows) as never,
        buildReportFillGuideSheet('college-single') as never
      ])
      const sheetXml = await readPart(blob, 'xl/worksheets/sheet1.xml')
      const sharedStrings = await readPart(blob, 'xl/sharedStrings.xml')
      // 数据行是真实子指标，静态示例名不再出现
      expect(sharedStrings).toContain('导入下发验证-基础A')
      expect(sharedStrings).not.toContain('数字校园协同验证')
      // 冻结 C2、下拉、保护、列宽与静态路径同一套口径
      expect(sheetXml).toContain('topLeftCell="C2"')
      expect(sheetXml).toContain('<formula1>=$H$2:$H$4</formula1>')
      expect(sheetXml).toMatch(/<sheetProtection[^>]*sheet="1"/)
      expect(sheetXml).toContain('<row r="2" ht="36" customHeight="1">')
    })
  })

  describe('样式参数（与需求方样例逐格对齐）', () => {
    it('列宽为 A6 B16 C16 D44 E13 F14 G36 H13', () => {
      const sheet = buildReportFillTemplateSheet('func', '教务处')
      expect(sheet.columns.map(column => column.width)).toEqual([6, 16, 16, 44, 13, 14, 36, 13])
    })

    it('行高：表头 34、数据行 36', () => {
      const sheet = buildReportFillTemplateSheet('func', '教务处')
      expect(sheet.headerHeight).toBe(34)
      expect(sheet.bodyRowHeight).toBe(36)
    })

    it('冻结 C2 + 网格线可见 + 第 8 列隐藏/裸值 + 整表保护', () => {
      const sheet = buildReportFillTemplateSheet('func', '教务处')
      expect(sheet.stickyRowsCount).toBe(1)
      expect(sheet.stickyColumnsCount).toBe(2)
      expect(sheet.showGridLines).toBe(true)
      expect(sheet.hiddenColumns).toEqual([8])
      expect(sheet.plainColumns).toEqual([8])
      expect(sheet.sheetProtection).toEqual({})
    })

    it('第 8 列列级 plain + hidden', () => {
      const sheet = buildReportFillTemplateSheet('func', '教务处')
      expect(sheet.columns[7].plain).toBe(true)
      expect(sheet.columns[7].hidden).toBe(true)
      // 其余 7 列不隐藏、不裸值
      for (let i = 0; i < 7; i += 1) {
        expect(sheet.columns[i].plain).toBeUndefined()
        expect(sheet.columns[i].hidden).toBeUndefined()
      }
    })

    it('A-E 列灰底、F-G 列金底，且都带 #BBBBBB 边框与微软雅黑', () => {
      const sheet = buildReportFillTemplateSheet('func', '教务处')
      for (let i = 0; i < 5; i += 1) {
        expect(sheet.columns[i].headerBackgroundColor).toBe('#595959')
        expect(sheet.columns[i].bodyBackgroundColor).toBe('#EDEDED')
      }
      expect(sheet.columns[5].headerBackgroundColor).toBe('#BF8F00')
      expect(sheet.columns[5].bodyBackgroundColor).toBe('#FFE699')
      expect(sheet.columns[6].headerBackgroundColor).toBe('#BF8F00')
      expect(sheet.columns[6].bodyBackgroundColor).toBe('#FFE699')
      for (let i = 0; i < 7; i += 1) {
        expect(sheet.columns[i].headerBorderColor).toBe('#BBBBBB')
        expect(sheet.columns[i].bodyBorderColor).toBe('#BBBBBB')
        expect(sheet.columns[i].fontFamily).toBe('微软雅黑')
        expect(sheet.columns[i].headerFontSize).toBe(11)
        expect(sheet.columns[i].bodyFontSize).toBe(10)
        expect(sheet.columns[i].bodyAlign).toBe('center')
        expect(sheet.columns[i].bodyAlignVertical).toBe('center')
      }
    })

    it('F 列下拉规则参数与需求方一致', () => {
      const sheet = buildReportFillTemplateSheet('func', '教务处')
      expect(sheet.dataValidations).toEqual([
        {
          sqref: 'F2:F1000',
          formula1: '=$H$2:$H$4',
          errorTitle: '自评等级填写错误',
          error: '自评等级只能从下拉中选择：超前完成 / 正常 / 滞后（三选一）',
          promptTitle: '自评等级',
          prompt: '点击单元格右侧箭头，从下拉中选择：超前完成 / 正常 / 滞后',
          allowBlank: false
        }
      ])
    })

    it('说明页：无表头行、列宽 114、行高 26、不冻结、白底无边框', () => {
      const guide = buildReportFillGuideSheet('func')
      expect(guide.skipHeaderRow).toBe(true)
      expect(guide.columns[0].width).toBe(114)
      expect(guide.bodyRowHeight).toBe(26)
      expect(guide.stickyRowsCount).toBe(0)
      expect(guide.showGridLines).toBe(true)
      // 第 1 行是标题、第 2 行空行
      expect(guide.rows[0].text).toBe(buildReportFillGuideTitle('func'))
      expect(guide.rows[1].text).toBe('')
      expect(guide.rows).toHaveLength(buildReportFillTemplateRules('func').length + 2)
    })
  })

  describe('生成的 xlsx（XML 级核对）', () => {
    it('数据页：隐藏第 8 列、H 列无 s 样式索引、冻结 C2、下拉与保护齐备', async () => {
      const blob = await buildTemplateBlob('func')
      const sheetXml = await readPart(blob, 'xl/worksheets/sheet1.xml')

      // 第 8 列隐藏
      expect(sheetXml).toMatch(/<col[^>]*min="8"[^>]*hidden="1"/)
      // H 列单元格不带 s 属性（裸值）
      expect(getCellTag(sheetXml, 'H1')).not.toMatch(/\ss="/)
      expect(getCellTag(sheetXml, 'H2')).not.toMatch(/\ss="/)
      expect(getCellTag(sheetXml, 'H4')).not.toMatch(/\ss="/)
      // A 列仍带 s 属性
      expect(getCellTag(sheetXml, 'A1')).toMatch(/\ss="/)
      // 冻结 C2
      expect(sheetXml).toContain('topLeftCell="C2"')
      expect(sheetXml).toContain('xSplit="2"')
      expect(sheetXml).toContain('ySplit="1"')
      // 网格线可见
      expect(sheetXml).not.toContain('showGridLines="false"')
      // 下拉 + 保护
      expect(sheetXml).toContain('sqref="F2:F1000"')
      expect(sheetXml).toContain('<formula1>=$H$2:$H$4</formula1>')
      expect(sheetXml).toContain('allowBlank="0"')
      expect(sheetXml).toMatch(/<sheetProtection[^>]*sheet="1"/)
      // 表头行高 34、数据行高 36
      expect(sheetXml).toContain('<row r="1" ht="34" customHeight="1">')
      expect(sheetXml).toContain('<row r="2" ht="36" customHeight="1">')
      // 仅枚举行（04 第 4 行）不设行高
      expect(sheetXml).toContain('<row r="4">')
    })

    it('数据页：列宽与样例一致（6/16/16/44/13/14/36/13）', async () => {
      const blob = await buildTemplateBlob('func')
      const sheetXml = await readPart(blob, 'xl/worksheets/sheet1.xml')
      const widths = [...sheetXml.matchAll(/<col[^>]*min="(\d+)"[^>]*width="([\d.]+)"/g)].map(m => ({
        col: Number(m[1]),
        width: Number(m[2])
      }))
      expect(widths).toEqual([
        { col: 1, width: 6 },
        { col: 2, width: 16 },
        { col: 3, width: 16 },
        { col: 4, width: 44 },
        { col: 5, width: 13 },
        { col: 6, width: 14 },
        { col: 7, width: 36 },
        { col: 8, width: 13 }
      ])
    })

    it('说明页：无表头行、A1 是标题、行高 26、列宽 114、不冻结', async () => {
      const blob = await buildTemplateBlob('func')
      const sheetXml = await readPart(blob, 'xl/worksheets/sheet2.xml')
      const sharedStrings = await readPart(blob, 'xl/sharedStrings.xml')

      // A1 是标题行（没有独立表头行）
      expect(sheetXml).toContain('<row r="1"')
      expect(sharedStrings).toContain('填写说明（04 · 职能部门上报战略发展部 · 单点导入）')
      // 行高 26
      expect(sheetXml).toContain('<row r="1" ht="26" customHeight="1">')
      expect(sheetXml).toContain('<row r="2" ht="26" customHeight="1">')
      // 列宽 114
      expect(sheetXml).toContain('<col min="1" max="1" width="114" customWidth="1"/>')
      // 不冻结
      expect(sheetXml).not.toContain('state="frozen"')
      // 网格线可见
      expect(sheetXml).not.toContain('showGridLines="false"')
    })

    it('样式表：字体为微软雅黑、边框 #BBBBBB、底色齐全', async () => {
      const blob = await buildTemplateBlob('func')
      const stylesXml = await readPart(blob, 'xl/styles.xml')

      expect(stylesXml).toContain('<name val="微软雅黑"/>')
      expect(stylesXml).toContain('rgb="FF595959"')
      expect(stylesXml).toContain('rgb="FFBF8F00"')
      expect(stylesXml).toContain('rgb="FFEDEDED"')
      expect(stylesXml).toContain('rgb="FFFFE699"')
      expect(stylesXml).toContain('rgb="FFBBBBBB"')
    })

    it('三份变体都生成成功且 sheet 名正确', async () => {
      for (const variant of VARIANTS) {
        const blob = await buildTemplateBlob(variant)
        const workbookXml = await readPart(blob, 'xl/workbook.xml')
        expect(workbookXml).toContain(buildReportFillSheetName(variant))
        expect(workbookXml).toContain('填写说明')
      }
    })
  })

  describe('TEMPLATE_STYLE 常量与样例口径一致', () => {
    it('关键样式常量', () => {
      expect(TEMPLATE_STYLE.fontFamily).toBe('微软雅黑')
      expect(TEMPLATE_STYLE.headerBackground).toBe('#595959')
      expect(TEMPLATE_STYLE.headerBackgroundFillable).toBe('#BF8F00')
      expect(TEMPLATE_STYLE.bodyBackground).toBe('#EDEDED')
      expect(TEMPLATE_STYLE.bodyBackgroundFillable).toBe('#FFE699')
      expect(TEMPLATE_STYLE.borderColor).toBe('#BBBBBB')
      expect(TEMPLATE_STYLE.headerHeight).toBe(34)
      expect(TEMPLATE_STYLE.bodyRowHeight).toBe(36)
      expect(TEMPLATE_STYLE.guideColumnWidth).toBe(114)
      expect(TEMPLATE_STYLE.guideRowHeight).toBe(26)
    })
  })
})
