/**
 * SISM 前端 Excel 写库「基础能力层」的官方 features 扩展点。
 *
 * 背景
 * ----
 * `write-excel-file` 的 `options.features` 是官方一等公民（见
 * `node_modules/write-excel-file/types/Feature.d.ts`），可以介入
 * `xl/worksheets/sheet{id}.xml` 的生成过程。本模块用它在 XML 层面补齐
 * write-excel-file 本身不支持、但 SISM 导入模板需要的四项能力：
 *
 * 1. **隐藏列**（`<col ... hidden="1"/>`）
 * 2. **裸值列**（把该列单元格的 `s="N"` 样式索引剥掉，走 Excel 主题默认样式）
 * 3. **数据有效性下拉**（`<dataValidations>`）
 * 4. **工作表保护**（`<sheetProtection>`）
 *
 * 为什么不直接改 write-excel-file
 * ------------------------------
 * 该库是三方依赖，升级即丢改动；且 `SheetOptions` 类型是它的公开契约，
 * 直接往里塞自定义字段会造成类型污染。本模块用「模块级注册表 + feature 回调」
 * 的方式，把自定义语义与三方类型彻底隔离。
 *
 * 已知限制
 * --------
 * **逐格 locked/unlocked（只让 F/G 两列可编辑）做不了**：
 * `locked` 是 `styles.xml` 里 `<cellXfs><xf><protection locked="0"/></xf></cellXfs>`
 * 的样式级属性，而 write-excel-file 的 `Cell` 对象没有暴露 `locked` / `hidden`
 * 这类 protection 属性，无法逐格生成 style。本模块只实现**整表保护**
 * （`<sheetProtection sheet="1" .../>`）。若后续需要「只放开某几列可编辑」，
 * 必须改 `xl/styles.xml` 的 `cellXfs`，属于本基础层之外的扩展点。
 *
 * 用法
 * ----
 * ```ts
 * registerSheetExtras('Sheet1', { hiddenColumns: [8], plainColumns: [7] })
 * try {
 *   const blob = await writeXlsxFile(sheets, { features: [xlsxExtrasFeature] }).toBlob()
 * } finally {
 *   clearSheetExtras()
 * }
 * ```
 */

import type { Feature, SheetOptions } from 'write-excel-file/browser'
import {
  findElement,
  getChildElements,
  getOrderOfSiblings,
  insertElementMarkupAccordingToOrderOfSiblings
} from 'write-excel-file/utility'

/**
 * 与 write-excel-file 内部 `FileContent` 完全等价的类型别名。
 * （库没有从 `write-excel-file/browser` 入口 re-export 该类型，只能本地等价声明。）
 */
export type XlsxFileContent = File | Blob | ArrayBuffer

/** 单条数据有效性规则（`<dataValidation>`） */
export interface SheetDataValidation {
  /** 作用区域，例：`F2:F1000` */
  sqref: string
  /** 校验公式，例：`=$H$2:$H$4`（引用同表隐藏列做下拉源） */
  formula1: string
  /** 出错时的标题，例：`自评等级填写错误` */
  errorTitle?: string
  /** 出错时的提示正文 */
  error?: string
  /** 输入提示标题 */
  promptTitle?: string
  /** 输入提示正文 */
  prompt?: string
  /** 是否允许留空（`allowBlank="1"`；不传则不写该属性，走 Excel 默认） */
  allowBlank?: boolean
}

/** 单个工作表的附加能力集合 */
export interface SheetExtras {
  /** 需要隐藏的列号（1-based，例 `[8]` 表示第 8 列） */
  hiddenColumns?: number[]
  /** 需要输出裸值的列号（1-based，剥离单元格 `s` 样式索引） */
  plainColumns?: number[]
  /** 数据有效性（下拉）规则 */
  dataValidations?: SheetDataValidation[]
  /** 工作表保护 */
  sheetProtection?: {
    /** 保护密码（明文写入 `password` 属性） */
    password?: string
  }
}

/** 模块级注册表：sheet 名 → 附加能力 */
const sheetExtrasRegistry = new Map<string, SheetExtras>()

/**
 * 注册某个工作表的附加能力。
 *
 * @param sheetName 工作表名（须与传给 write-excel-file 的 `sheet` 完全一致）
 * @param extras 附加能力集合
 */
export function registerSheetExtras(sheetName: string, extras: SheetExtras): void {
  sheetExtrasRegistry.set(sheetName, extras)
}

/** 清空注册表（避免跨次生成泄漏）。一般在一次 buildExcelBlob 结束后调用。 */
export function clearSheetExtras(): void {
  sheetExtrasRegistry.clear()
}

/** 读取注册表内容（测试用；正常业务不需要直接调用） */
export function getSheetExtras(sheetName: string): SheetExtras | undefined {
  return sheetExtrasRegistry.get(sheetName)
}

/** 判断附加能力集合是否为空（空集合不必注册，保证未注册时零副作用） */
export function isEmptySheetExtras(extras: SheetExtras | undefined): boolean {
  if (!extras) {
    return true
  }
  return (
    !extras.hiddenColumns?.length &&
    !extras.plainColumns?.length &&
    !extras.dataValidations?.length &&
    !extras.sheetProtection
  )
}

/** 列号 → Excel 列字母（1 → A，2 → B，27 → AA） */
export function getColumnLetter(columnNumber: number): string {
  let letter = ''
  let remaining = columnNumber
  while (remaining > 0) {
    const index = (remaining - 1) % 26
    letter = String.fromCharCode(65 + index) + letter
    remaining = Math.floor((remaining - 1) / 26)
  }
  return letter
}

/** XML 文本转义（用于 `<formula1>` 等文本节点） */
function escapeXmlText(value: string): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** XML 属性值转义 */
function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/**
 * XML 属性扫描（与 write-excel-file 内部 `findElementsNonRecursive_` 用的
 * 属性正则保持一致，但能定位属性在原串中的精确位置）。
 * 每次使用时用 `new RegExp(ATTRIBUTE_PATTERN.source, 'g')` 派生独立实例，
 * 避免共享 `lastIndex` 带来的跨调用串扰。
 */
const ATTRIBUTE_PATTERN = /\s+([^\s=>]+)(?:="([^\s=>]+)")?/g

/**
 * 给 `<col>` 元素加 `hidden="1"` 属性。
 *
 * 不新增元素，只在已存在的 `<col>` 上补属性（write-excel-file 总会为有宽度的列
 * 生成 `<col min max width customWidth/>`）。用结构化的 `findElement` /
 * `getChildElements` 定位，绝不用裸正则改整份 XML。
 */
function applyHiddenColumns(xml: string, hiddenColumns: number[]): string {
  const colsElement = findElement(xml, 'cols')
  if (!colsElement) {
    return xml
  }

  const colElements = getChildElements(xml, colsElement).filter(
    element => element.tagName === 'col'
  )
  if (colElements.length === 0) {
    return xml
  }

  // 先在原串快照上算出全部插入点，再按位置倒序插入，避免索引漂移。
  const insertPoints: number[] = []
  for (const columnNumber of hiddenColumns) {
    const target = colElements.find(element => {
      const min = Number(element.openingTagAttributes.min)
      const max = Number(element.openingTagAttributes.max)
      return (
        Number.isFinite(min) && Number.isFinite(max) && columnNumber >= min && columnNumber <= max
      )
    })
    if (!target) {
      // 该列没有 `<col>` 描述（无宽度等），无处挂 hidden 属性——跳过。
      continue
    }
    if (target.openingTagAttributes.hidden === '1') {
      continue
    }
    // `openingTagEndIndex` 指向开始标签的 `>`。
    // 自闭合标签（`<col .../>`）必须插在 `/` **之前**，否则会产出
    // `<col .../ hidden="1">` 这种非法 XML（属性写在自闭合斜杠后面）。
    insertPoints.push(
      target.selfClosingTag ? target.openingTagEndIndex - 1 : target.openingTagEndIndex
    )
  }

  let result = xml
  insertPoints
    .sort((a, b) => b - a)
    .forEach(index => {
      result = `${result.slice(0, index)} hidden="1"${result.slice(index)}`
    })
  return result
}

/**
 * 剥离指定列单元格的 `s="N"` 样式索引。
 *
 * 因全局 `fontFamily/fontSize` 的存在，write-excel-file 给每个格子都挂了
 * `s="0"`（默认字体样式）。裸值列需要回到 Excel 主题默认样式，
 * 所以要把这些格子的 `s` 属性去掉。
 */
function stripStyleFromPlainColumns(xml: string, plainColumns: number[]): string {
  if (plainColumns.length === 0) {
    return xml
  }

  const sheetDataElement = findElement(xml, 'sheetData')
  if (!sheetDataElement) {
    return xml
  }

  const plainColumnLetters = new Set(plainColumns.map(getColumnLetter))

  // 结构化定位：`<sheetData>` → `<row>` → `<c>`。
  const rowElements = getChildElements(xml, sheetDataElement).filter(
    element => element.tagName === 'row'
  )

  // 先算出所有要删除的 ` s="N"` 片段区间（基于同一份快照），再倒序删除。
  const removals: Array<{ start: number; end: number }> = []
  for (const rowElement of rowElements) {
    const cellElements = getChildElements(xml, rowElement).filter(
      element => element.tagName === 'c'
    )
    for (const cellElement of cellElements) {
      const reference = cellElement.openingTagAttributes.r
      if (reference === undefined) {
        continue
      }
      const columnLetter = String(reference).replace(/\d+$/, '')
      if (!plainColumnLetters.has(columnLetter)) {
        continue
      }
      const tagMarkup = xml.slice(
        cellElement.openingTagStartIndex,
        cellElement.openingTagEndIndex + 1
      )
      const attributePattern = new RegExp(ATTRIBUTE_PATTERN.source, 'g')
      let match: RegExpExecArray | null
      while ((match = attributePattern.exec(tagMarkup)) !== null) {
        if (match[1] === 's') {
          removals.push({
            start: cellElement.openingTagStartIndex + match.index,
            end: cellElement.openingTagStartIndex + match.index + match[0].length
          })
          break
        }
      }
    }
  }

  let result = xml
  removals
    .sort((a, b) => b.start - a.start)
    .forEach(({ start, end }) => {
      result = result.slice(0, start) + result.slice(end)
    })
  return result
}

/** 生成 `<dataValidations>` 元素 markup */
function buildDataValidationsXml(dataValidations: SheetDataValidation[]): string {
  const items = dataValidations
    .map(validation => {
      const attributes: string[] = [`sqref="${escapeXmlAttribute(validation.sqref)}"`]
      attributes.push('type="list"')
      attributes.push('showErrorMessage="1"')
      if (validation.prompt || validation.promptTitle) {
        attributes.push('showInputMessage="1"')
      }
      if (validation.allowBlank !== undefined) {
        attributes.push(`allowBlank="${validation.allowBlank ? '1' : '0'}"`)
      }
      if (validation.errorTitle) {
        attributes.push(`errorTitle="${escapeXmlAttribute(validation.errorTitle)}"`)
      }
      if (validation.error) {
        attributes.push(`error="${escapeXmlAttribute(validation.error)}"`)
      }
      if (validation.promptTitle) {
        attributes.push(`promptTitle="${escapeXmlAttribute(validation.promptTitle)}"`)
      }
      if (validation.prompt) {
        attributes.push(`prompt="${escapeXmlAttribute(validation.prompt)}"`)
      }
      const formula = `<formula1>${escapeXmlText(validation.formula1)}</formula1>`
      return `<dataValidation ${attributes.join(' ')}>${formula}</dataValidation>`
    })
    .join('')

  return `<dataValidations count="${dataValidations.length}">${items}</dataValidations>`
}

/** 生成 `<sheetProtection>` 元素 markup */
function buildSheetProtectionXml(protection: { password?: string }): string {
  const attributes = ['sheet="1"', 'objects="1"', 'scenarios="1"']
  if (protection.password) {
    attributes.push(`password="${escapeXmlAttribute(protection.password)}"`)
  }
  return `<sheetProtection ${attributes.join(' ')}/>`
}

/**
 * 保序插入元素：按 write-excel-file 官方 `getOrderOfSiblings` 顺序表，
 * 把 markup 插到 `<worksheet>` 下的正确位置（不手写位置）。
 */
function insertElementInOrder(xml: string, markup: string): string {
  const orderOfSiblings = getOrderOfSiblings('xl/worksheets/sheet{id}.xml', 'worksheet')
  if (!orderOfSiblings) {
    return xml
  }
  return insertElementMarkupAccordingToOrderOfSiblings(xml, markup, orderOfSiblings, 'worksheet')
}

/**
 * write-excel-file 的官方 feature：补齐隐藏列 / 裸值列 / 数据有效性 / 工作表保护。
 *
 * 未在注册表里登记的 sheet：**原样返回 xml**（零副作用）。
 */
export const xlsxExtrasFeature: Feature<XlsxFileContent> = {
  files: {
    transform: {
      'xl/worksheets/sheet{id}.xml': {
        transform: (content: string, sheetOptions: SheetOptions<XlsxFileContent>): string => {
          const sheetName = sheetOptions.sheet
          if (!sheetName) {
            return content
          }
          const extras = sheetExtrasRegistry.get(sheetName)
          if (!extras) {
            // 未注册 → 原样返回，零副作用。
            return content
          }

          let xml = content

          if (extras.hiddenColumns?.length) {
            xml = applyHiddenColumns(xml, extras.hiddenColumns)
          }

          if (extras.plainColumns?.length) {
            xml = stripStyleFromPlainColumns(xml, extras.plainColumns)
          }

          // 顺序很重要：`<sheetProtection>` 在 schema 里排在 `<dataValidations>` 之前，
          // 先插 protection，后插 dataValidations 时
          // `insertElementMarkupAccordingToOrderOfSiblings` 会自动找到 sheetProtection
          // 并把 dataValidations 放到它后面。
          if (extras.sheetProtection) {
            xml = insertElementInOrder(xml, buildSheetProtectionXml(extras.sheetProtection))
          }

          if (extras.dataValidations?.length) {
            xml = insertElementInOrder(xml, buildDataValidationsXml(extras.dataValidations))
          }

          return xml
        }
      }
    }
  }
}
