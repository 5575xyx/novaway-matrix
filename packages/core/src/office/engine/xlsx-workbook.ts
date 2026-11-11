/**
 * 工作簿级操作：新增 / 重命名 / 删除工作表。
 *
 * 和其它 XLSX 写入一样，只动最小的几处：
 *   - 新增：`xl/workbook.xml` 里加一个 `<sheet>`、`workbook.xml.rels` 里加一条关系、
 *     包里新增一张空工作表、`[Content_Types].xml` 里加一条 Override；
 *   - 重命名：只改 `<sheet name>`；
 *   - 删除：摘掉 `<sheet>` 和对应的关系条目；工作表部件留在包里（Excel 与
 *     LibreOffice 都容忍未被引用的部件，而删条目会牵动整个 zip 的重排）。
 *
 * 单元格、样式、共享字符串、图表锚点等其它字节一律不动。
 */

import type { OfficeResult } from "./contract"
import { fail, ok } from "./contract"
import { attribute, decodeXmlText, encodeXmlText, findAll, setAttribute } from "./xml"

/** Excel 对工作表名的限制：1..31 字符，不能含 []:*?/\ ，且不能重名。 */
export function validateSheetName(name: string): OfficeResult<string> {
  const trimmed = name.trim()
  if (trimmed.length === 0) return fail("invalid_params", "工作表名不能为空")
  if (trimmed.length > 31) return fail("invalid_params", "工作表名最多 31 个字符：" + trimmed)
  if (/[[\]:*?/\\]/.test(trimmed)) {
    return fail("invalid_params", "工作表名不能包含 [ ] : * ? / \ 这些字符：" + trimmed)
  }
  return ok(trimmed)
}

/**
 * 找到一个容器元素「插入内容」的位置。
 *
 * 真实文件里容器经常写成自闭合（`<Types/>`、`<sheets/>`、`<Relationships/>`），
 * 这时先把开标签展开成 `<x></x>` 再往回算位置 —— 否则插入点找错就会写出坏 XML。
 */
function container(xml: string, tag: string): { xml: string; closeIndex: number } | undefined {
  const close = xml.indexOf("</" + tag + ">")
  if (close !== -1) return { xml, closeIndex: close }

  const match = new RegExp("<" + tag + "\\b[^>]*/>").exec(xml)
  if (!match) return undefined
  const openTag = match[0].slice(0, -2).trimEnd() + ">"
  const expanded = xml.slice(0, match.index) + openTag + "</" + tag + ">" + xml.slice(match.index + match[0].length)
  return { xml: expanded, closeIndex: match.index + openTag.length }
}

type SheetTag = { start: number; end: number; name: string; sheetId?: string; rId?: string }

function sheetTags(workbookXml: string): SheetTag[] {
  const holder = workbookXml.indexOf("<sheets")
  if (holder === -1) return []
  const close = workbookXml.indexOf("</sheets>", holder)
  const to = close === -1 ? workbookXml.length : close
  return findAll(workbookXml, "sheet", holder, to).map((span) => {
    const tag = workbookXml.slice(span.start, span.end)
    return {
      start: span.start,
      end: span.end,
      name: decodeXmlText(attribute(tag, "name") ?? ""),
      sheetId: attribute(tag, "sheetId"),
      rId: /(?:^|\s)r:id="([^"]*)"/.exec(tag)?.[1],
    }
  })
}

function findSheet(workbookXml: string, name: string): SheetTag | undefined {
  return sheetTags(workbookXml).find((sheet) => sheet.name === name)
}

export function sheetNames(workbookXml: string): string[] {
  return sheetTags(workbookXml).map((sheet) => sheet.name)
}

/** 重命名：只改目标 `<sheet>` 的 name 属性，位置与 r:id 都不动。 */
export function renameSheet(workbookXml: string, from: string, to: string): OfficeResult<string> {
  const valid = validateSheetName(to)
  if (!valid.ok) return valid
  const name = valid.data
  const target = findSheet(workbookXml, from)
  if (!target) return fail("not_found", "找不到工作表 " + from, "先读一次工作簿确认表名")

  const others = sheetNames(workbookXml).filter((item) => item !== from)
  if (others.some((item) => item.toLowerCase() === name.toLowerCase())) {
    return fail("exists", "已存在同名工作表：" + name)
  }
  if (name === from) return ok(workbookXml)

  const tag = workbookXml.slice(target.start, target.end)
  const next = setAttribute(tag, "name", encodeXmlText(name))
  return ok(workbookXml.slice(0, target.start) + next + workbookXml.slice(target.end))
}

/** 表格 XML 里没别的东西时它算「空表」：面板按空表提示，不渲染一堆空格子。 */
const EMPTY_SHEET =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  "<sheetData/></worksheet>"

export const WORKSHEET_RELATION_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
export const WORKSHEET_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"

type AddedSheet = { workbook: string; rels: string; types: string; path: string; content: string }

/**
 * 新增一张空工作表，插在当前最后一张之后。
 *
 * 新部件名取 `sheet{max+1}.xml`：不按「已有序号」推，避免删过表之后撞名。
 */
export function addSheet(
  workbookXml: string,
  relsXml: string,
  contentTypesXml: string,
  name: string,
  existingPaths: readonly string[],
): OfficeResult<AddedSheet> {
  const valid = validateSheetName(name)
  if (!valid.ok) return valid
  const sheetName = valid.data
  const sheets = sheetTags(workbookXml)
  if (sheets.some((sheet) => sheet.name.toLowerCase() === sheetName.toLowerCase())) {
    return fail("exists", "已存在同名工作表：" + sheetName)
  }
  // 只有占位内容的 workbook.xml（可能连 <sheets> 都没有）：直接拒绝，别猜结构。
  const sheetsHolder = container(workbookXml, "sheets")
  if (!sheetsHolder) return fail("engine", "这个工作簿的 workbook.xml 里没有 <sheets>，无法新增工作表")

  const maxSheetId = sheets.reduce((max, sheet) => Math.max(max, Number(sheet.sheetId ?? "0")), 0)
  const sheetId = String(maxSheetId + 1)
  const ridNumbers = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1]))
  const rId = "rId" + String((ridNumbers.length > 0 ? Math.max(...ridNumbers) : 0) + 1)

  const usedNumbers = existingPaths
    .map((path) => /worksheets\/sheet(\d+)\.xml$/.exec(path)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
  const fileNumber = (usedNumbers.length > 0 ? Math.max(...usedNumbers) : sheets.length) + 1
  const path = "xl/worksheets/sheet" + fileNumber + ".xml"

  const sheetTag = '<sheet name="' + encodeXmlText(sheetName) + '" sheetId="' + sheetId + '" r:id="' + rId + '"/>'
  const workbook =
    sheetsHolder.xml.slice(0, sheetsHolder.closeIndex) + sheetTag + sheetsHolder.xml.slice(sheetsHolder.closeIndex)

  const relation =
    '<Relationship Id="' +
    rId +
    '" Type="' +
    WORKSHEET_RELATION_TYPE +
    '" Target="worksheets/sheet' +
    fileNumber +
    '.xml"/>'
  const relsHolder = container(relsXml, "Relationships")
  if (!relsHolder) return fail("engine", "workbook.xml.rels 结构不认识，无法新增工作表")
  const rels = relsHolder.xml.slice(0, relsHolder.closeIndex) + relation + relsHolder.xml.slice(relsHolder.closeIndex)

  // Content_Types 里补 Override：漏了它 Excel 会说文件损坏。
  const override = '<Override PartName="/' + path + '" ContentType="' + WORKSHEET_CONTENT_TYPE + '"/>'
  const typesHolder = container(contentTypesXml, "Types")
  if (!typesHolder) return fail("engine", "[Content_Types].xml 结构不认识，无法新增工作表")
  const types =
    typesHolder.xml.slice(0, typesHolder.closeIndex) + override + typesHolder.xml.slice(typesHolder.closeIndex)

  return ok({ workbook, rels, types, path, content: EMPTY_SHEET })
}

/**
 * 删除一张工作表：摘掉 `<sheet>` 与它的关系条目。
 *
 * 至少保留一张表：Excel 打开「零张可见工作表」的工作簿会直接报错。
 */
export function deleteSheet(
  workbookXml: string,
  relsXml: string,
  name: string,
): OfficeResult<{ workbook: string; rels: string; removedPathHint?: string }> {
  const sheets = sheetTags(workbookXml)
  const target = sheets.find((sheet) => sheet.name === name)
  if (!target) return fail("not_found", "找不到工作表 " + name, "先读一次工作簿确认表名")
  if (sheets.length <= 1) {
    return fail("invalid_params", "工作簿至少要保留一张工作表", "可以先把表清空，或新增一张再删")
  }

  let workbook = workbookXml.slice(0, target.start) + workbookXml.slice(target.end)
  // 连带把因换行留下的空白收一下，避免连续两个空行。
  workbook = workbook.replace(/\n\s*\n\s*(<\/sheets>)/, "\n$1")

  let rels = relsXml
  if (target.rId) {
    const pattern = new RegExp('<Relationship\b[^>]*\bId="' + target.rId + '"[^>]*/>')
    rels = rels.replace(pattern, "")
  }
  return ok({ workbook, rels })
}
