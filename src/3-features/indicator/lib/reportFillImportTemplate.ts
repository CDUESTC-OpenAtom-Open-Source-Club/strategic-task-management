import { exportSheetsToExcel, type ExcelExportSheet } from '@/shared/lib/export/excel'

/**
 * 2026-11-25（二级学院填报导入）：模板生成。
 *
 * <p>模板 7 列固定：序号 / 学院（须与登录学院一致）/ 归口职能部门 / 子指标名称 /
 * 权重（系统只读）/ 自评等级（点选填写）/ 进度说明（请填写）。
 * 只有「自评等级」「进度说明」两列允许填写，导入时其余列仅做校验。
 *
 * <p>学院取自登录身份，因此模板里的「学院」列由页面按当前登录学院预填；
 * 单归口模板预填当前选中归口线的指标，批量模板预填该学院全部已下发线的指标。
 */

export type ReportFillTemplateMode = 'single' | 'batch'

export interface ReportFillTemplateRow {
  collegeName: string
  functionalDeptName: string
  indicatorName: string
  weight: string | number
}

interface GuideRow {
  item: string
  detail: string
}

export const REPORT_FILL_TEMPLATE_HEADERS = [
  '序号',
  '学院\n（须与登录学院一致）',
  '归口职能部门',
  '子指标名称',
  '权重\n（系统只读）',
  '自评等级\n（点选填写）',
  '进度说明\n（请填写）'
] as const

function buildDataSheet(rows: ReportFillTemplateRow[]): ExcelExportSheet<ReportFillTemplateRow> {
  return {
    sheetName: '填报导入',
    rows,
    emptyMessage: '暂无已下发指标：请先等待职能部门下发后再下载模板',
    columns: [
      {
        header: REPORT_FILL_TEMPLATE_HEADERS[0],
        width: 8,
        align: 'center',
        getValue: (_row, index) => index + 1
      },
      {
        header: REPORT_FILL_TEMPLATE_HEADERS[1],
        width: 22,
        getValue: row => row.collegeName
      },
      {
        header: REPORT_FILL_TEMPLATE_HEADERS[2],
        width: 22,
        getValue: row => row.functionalDeptName
      },
      {
        header: REPORT_FILL_TEMPLATE_HEADERS[3],
        width: 40,
        getValue: row => row.indicatorName
      },
      {
        header: REPORT_FILL_TEMPLATE_HEADERS[4],
        width: 12,
        align: 'center',
        getValue: row => row.weight
      },
      {
        header: REPORT_FILL_TEMPLATE_HEADERS[5],
        width: 18,
        align: 'center',
        getValue: () => ''
      },
      {
        header: REPORT_FILL_TEMPLATE_HEADERS[6],
        width: 46,
        getValue: () => ''
      }
    ]
  }
}

function buildGuideSheet(mode: ReportFillTemplateMode): ExcelExportSheet<GuideRow> {
  const rows: GuideRow[] = [
    {
      item: '能填什么',
      detail:
        '只填「自评等级」和「进度说明」两列；序号、学院、归口职能部门、子指标名称、权重由系统给出，请勿修改。'
    },
    {
      item: '自评等级',
      detail: '三选一：超前 / 正常 / 滞后（与页面下拉一致，不要写「超前完成」之类的长文案）。'
    },
    {
      item: '进度说明',
      detail: '必填，500 字以内；写清本月做到哪一步、结果与遗留问题。'
    },
    {
      item: '学院',
      detail: '必须与登录账号所属学院完全一致，否则整行会被判错、无法导入。'
    },
    {
      item: '归口职能部门',
      detail:
        mode === 'batch'
          ? '批量导入支持一份表里出现多个归口职能部门：系统会按归口自动拆分，逐条线分别写入草稿。'
          : '单归口导入只处理当前选中的归口职能部门，换部门请重新下载模板。'
    },
    {
      item: '导入结果',
      detail: '导入只写「草稿」，不会自动提交审批；核对无误后请在页面点「一键提交」上报。'
    }
  ]

  return {
    sheetName: '填写说明',
    rows,
    columns: [
      { header: '项目', width: 16, getValue: row => row.item },
      { header: '说明', width: 90, getValue: row => row.detail }
    ]
  }
}

export function buildReportFillTemplateFileName(
  mode: ReportFillTemplateMode,
  collegeName: string,
  dateTag: string
): string {
  const scope = mode === 'batch' ? '多归口·批量' : '单归口'
  return `指标填报导入模板（${scope}）_${collegeName}_${dateTag}.xlsx`
}

export async function downloadReportFillTemplate(
  mode: ReportFillTemplateMode,
  rows: ReportFillTemplateRow[],
  collegeName: string,
  dateTag: string
): Promise<void> {
  const sheets: ExcelExportSheet<unknown>[] = [
    buildDataSheet(rows) as unknown as ExcelExportSheet<unknown>,
    buildGuideSheet(mode) as unknown as ExcelExportSheet<unknown>
  ]
  await exportSheetsToExcel(sheets, buildReportFillTemplateFileName(mode, collegeName, dateTag))
}
