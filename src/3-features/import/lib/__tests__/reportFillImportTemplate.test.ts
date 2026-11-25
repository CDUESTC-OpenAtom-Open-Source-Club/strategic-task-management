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
    it('单归口版 9 条，逐字与需求方文件一致', () => {
      expect(buildReportFillTemplateRules('single')).toEqual([
        '1. 使用者：学院填报人登录自己账号使用。导入的填报数据归属 = 登录人所在学院（不可代其他学院填报）。',
        '2. 用途：一次导入一条归口线的月度填报数据（本学院从某一个归口职能部门收到的指标）。',
        '3. 🔴 学院校验（安全规则）：「学院」列必须填写登录人所在学院，解析时与登录账号比对——不一致将整单拒绝导入，防止误报其他学院。',
        '4. 归属月份：本表不设月份列——归属月份在导入界面上选择。',
        '5. 定位规则：按「学院 + 归口职能部门 + 子指标名称」匹配本学院已下发的子指标行；名称完全一致 = 更新该行填报；无匹配 = 该行失败点名。',
        '6. 填报字段（黄色两列，与填报页可编辑字段一致）：① 自评等级——点击单元格下拉选择「超前完成 / 正常 / 滞后」（三选一，手输其他内容会被拒绝）；② 进度说明——当月推进情况文字说明。',
        '7. 权重列：系统只读参考，请勿修改（该列已锁定）。',
        '8. 导入流程：选择文件 → 解析预览（学院校验 + 定位 + 数值校验）→ 确认导入 → 进入该归口线的正常上报审批流程（审批通过后数据看板生效）。',
        '9. 黄色底纹行为示例数据，正式导入前请删除。'
      ])
    })

    it('多归口版 10 条，逐字与需求方文件一致（含拆线规则，其后编号顺延）', () => {
      expect(buildReportFillTemplateRules('all')).toEqual([
        '1. 使用者：学院填报人登录自己账号使用。导入的填报数据归属 = 登录人所在学院（不可代其他学院填报）。',
        '2. 用途：一次导入本学院全部归口线的月度填报数据（示例：计算机学院同时收到「预算部」与「什邡管委会」两条线的指标，一张表一次报完）。',
        '3. 🔴 学院校验（安全规则）：「学院」列必须填写登录人所在学院，解析时与登录账号比对——不一致将整单拒绝导入，防止误报其他学院。',
        '4. 拆线规则：按「归口职能部门」列自动拆分——每个归口线的行独立校验、独立提交、独立进入该线的上报审批流程（一条线失败不影响其他线）。',
        '5. 归属月份：本表不设月份列——归属月份在导入界面上选择。',
        '6. 定位规则：按「学院 + 归口职能部门 + 子指标名称」匹配本学院已下发的子指标行；名称完全一致 = 更新该行填报；无匹配 = 该行失败点名。',
        '7. 填报字段（黄色两列，与填报页可编辑字段一致）：① 自评等级——点击单元格下拉选择「超前完成 / 正常 / 滞后」（三选一，手输其他内容会被拒绝）；② 进度说明——当月推进情况文字说明。',
        '8. 权重列：系统只读参考，请勿修改（该列已锁定）。',
        '9. 导入流程：选择文件 → 解析预览（学院校验 + 按归口线分组展示将提交 / 将跳过 / 错误组）→ 确认批量导入 → 逐线自动提交并进入审批（通过后数据看板生效）。',
        '10. 彩色底纹行为示例数据（黄=预算部线 / 绿=什邡管委会线），正式导入前请删除。'
      ])
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

  describe('样例数据逐字对齐需求方文件', () => {
    it('单归口版 2 行全字段一致', () => {
      const sheet = buildReportFillTemplateSheet('single', '计算机学院')
      expect(sheet.rows).toEqual([
        {
          serial: '1',
          college: '计算机学院',
          functionalDept: '什邡管委会',
          indicatorName: '计算机学院-园区智慧化服务技术支撑',
          weight: '40',
          selfRating: '滞后',
          remark: '受资源到位滞后影响，部分节点未按期完成'
        },
        {
          serial: '2',
          college: '计算机学院',
          functionalDept: '什邡管委会',
          indicatorName: '计算机学院-信息化运维绩效管理',
          weight: '60',
          selfRating: '正常',
          remark: '运维工单响应时效达标率 96%'
        }
      ])
    })

    it('多归口版 4 行全字段一致，且第 2 行等级已同步为「超前完成」', () => {
      const sheet = buildReportFillTemplateSheet('all', '计算机学院')
      expect(sheet.rows).toEqual([
        {
          serial: '1',
          college: '计算机学院',
          functionalDept: '预算部',
          indicatorName: '计算机学院-产业学院订单式人才培养项目',
          weight: '30',
          selfRating: '正常',
          remark: '订单班已开班，课程体系按企业需求调整完毕'
        },
        {
          serial: '2',
          college: '计算机学院',
          functionalDept: '预算部',
          indicatorName: '计算机学院-园区数字孪生联合实验室共建',
          weight: '70',
          // 需求方样例写「超前」，按裁定强制同步为「超前完成」
          selfRating: '超前完成',
          remark: '联合实验室设备安装调试完成，进入试运行'
        },
        {
          serial: '3',
          college: '计算机学院',
          functionalDept: '什邡管委会',
          indicatorName: '计算机学院-信息化运维绩效管理',
          weight: '60',
          selfRating: '正常',
          remark: '运维工单响应时效达标率 96%'
        },
        {
          serial: '4',
          college: '计算机学院',
          functionalDept: '什邡管委会',
          indicatorName: '计算机学院-园区智慧化服务技术支撑',
          weight: '40',
          selfRating: '滞后',
          remark: '受资源到位滞后影响，部分节点未按期完成'
        }
      ])
    })
  })
})
