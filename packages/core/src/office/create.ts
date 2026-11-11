/**
 * 新建 Office 文档（CLI 的 `create`）。
 *
 * 生成的是**最小但合法**的 OOXML 包：PowerPoint / Word / Excel 能直接打开，
 * 我们的引擎也能立刻编辑，而且所有必填部件（主题、版式、样式表）都在 ——
 * 不能只生成一份「自己认识、Office 打不开」的包。
 *
 * 文本类（md / txt / html / csv）不经过 zip，直接给一份能写字的空文档。
 */
import { kindOfPath, officeFormatOf, type DocumentKind } from "./engine/registry"
import { buildZip } from "./pptx-edit"
import { createPdf } from "./pdf/engine"

export type CreateOptions = {
  /** 文件类型；不传就按扩展名推断。 */
  kind?: DocumentKind
  /** 标题：写进正文 / core properties / 第一张幻灯片。 */
  title?: string
  /** 正文内容（Markdown / txt / html 直接作为内容）。 */
  body?: string
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}

function coreProps(title: string): string {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
  return (
    XML_HEAD +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"' +
    ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"' +
    ' xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${escapeXml(title)}</dc:title>` +
    `<dc:creator>NovaWay</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>` +
    "</cp:coreProperties>"
  )
}

function rootRels(main: string): string {
  return (
    XML_HEAD +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/>` +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    "</Relationships>"
  )
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

const DOCX_STYLES =
  `${XML_HEAD}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体"/>' +
  '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>' +
  '<w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr>' +
  '<w:rPr><w:b/><w:sz w:val="56"/><w:szCs w:val="56"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/>' +
  '<w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="595959"/><w:sz w:val="28"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>' +
  '<w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>' +
  '<w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>' +
  '<w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr>' +
  '<w:rPr><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/>' +
  '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr>' +
  '<w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/>' +
  '<w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="NoSpacing"><w:name w:val="No Spacing"/><w:basedOn w:val="Normal"/>' +
  '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>' +
  "</w:styles>"

function docxParagraph(text: string, style?: string): string {
  const props = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""
  return `<w:p>${props}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

export type DocxBlock = { text: string; heading?: number }

/** 用一组段落（可带标题级别）生成 docx；旧格式转换也走这里。 */
export function docxFromBlocks(title: string, blocks: readonly DocxBlock[]): Uint8Array {
  const paragraphs = [docxParagraph(title, "Title")]
  for (const block of blocks) {
    if (block.text.trim() === "" && block.heading === undefined) continue
    paragraphs.push(docxParagraph(block.text, block.heading ? "Heading" + block.heading : undefined))
  }
  const document =
    `${XML_HEAD}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<w:body>${paragraphs.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/>' +
    "</w:sectPr></w:body></w:document>"
  const contentTypes =
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    "</Types>"
  const documentRels =
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    "</Relationships>"
  return buildZip([
    { name: "[Content_Types].xml", data: utf8(contentTypes) },
    { name: "_rels/.rels", data: utf8(rootRels("word/document.xml")) },
    { name: "docProps/core.xml", data: utf8(coreProps(title)) },
    { name: "word/document.xml", data: utf8(document) },
    { name: "word/styles.xml", data: utf8(DOCX_STYLES) },
    { name: "word/_rels/document.xml.rels", data: utf8(documentRels) },
  ])
}

function docxBytes(title: string, body?: string): Uint8Array {
  const blocks: DocxBlock[] = []
  for (const line of (body ?? "").split("\n")) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) blocks.push({ text: heading[2]!, heading: heading[1]!.length })
    else if (line.trim() !== "") blocks.push({ text: line })
  }
  return docxFromBlocks(title, blocks)
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

const XLSX_STYLES =
  `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>"

function sheetCell(ref: string, value: string): string {
  if (value === "") return ""
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`
}

export type XlsxSheetInput = { name: string; rows: readonly (readonly string[])[] }

/** 用多张工作表生成 xlsx；旧格式（ods/xls）转换和新建共用。 */
export function xlsxFromSheets(title: string, sheets: readonly XlsxSheetInput[]): Uint8Array {
  const list = sheets.length > 0 ? sheets : [{ name: "Sheet1", rows: [] }]
  const sheetXml = (rows: readonly (readonly string[])[]) =>
    `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    rows
      .map((row, rowIndex) => {
        const cells = row
          .map((value, colIndex) => sheetCell(columnName(colIndex) + String(rowIndex + 1), String(value ?? "")))
          .join("")
        return `<row r="${rowIndex + 1}">${cells}</row>`
      })
      .join("") +
    "</sheetData></worksheet>"

  const entries = list.map((sheet, index) => ({
    name: sheetName(sheet.name, index),
    part: `xl/worksheets/sheet${index + 1}.xml`,
    index,
  }))
  const workbook =
    `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    "<sheets>" +
    entries
      .map(
        (entry) => `<sheet name="${escapeXml(entry.name)}" sheetId="${entry.index + 1}" r:id="rId${entry.index + 1}"/>`,
      )
      .join("") +
    "</sheets></workbook>"
  const contentTypes =
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    entries
      .map(
        (entry) =>
          `<Override PartName="/${entry.part}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("") +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    "</Types>"
  const workbookRels =
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    entries
      .map(
        (entry) =>
          `<Relationship Id="rId${entry.index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${entry.part.slice("xl/".length)}"/>`,
      )
      .join("") +
    `<Relationship Id="rId${entries.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    "</Relationships>"
  return buildZip([
    { name: "[Content_Types].xml", data: utf8(contentTypes) },
    { name: "_rels/.rels", data: utf8(rootRels("xl/workbook.xml")) },
    { name: "docProps/core.xml", data: utf8(coreProps(title)) },
    { name: "xl/workbook.xml", data: utf8(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: utf8(workbookRels) },
    ...entries.map((entry) => ({ name: entry.part, data: utf8(sheetXml(list[entry.index]!.rows)) })),
    { name: "xl/styles.xml", data: utf8(XLSX_STYLES) },
  ])
}

/** 工作表名：去掉 Excel 不接受的字符，空名和重名自动补编号。 */
function sheetName(input: string, index: number): string {
  const clean = input
    .replace(/[\/?*\[\]:]/g, " ")
    .trim()
    .slice(0, 31)
  return clean.length > 0 ? clean : "Sheet" + (index + 1)
}

function xlsxBytes(title: string, body?: string): Uint8Array {
  // 第一行放标题，后面是制表符 / 逗号分隔的行 —— 新建表格时最常见的起点。
  const rows: string[][] = [[title]]
  for (const line of (body ?? "").split(String.fromCharCode(10))) {
    if (line.trim() === "") continue
    rows.push(line.split(/\t|,/).map((cell) => cell.trim()))
  }
  return xlsxFromSheets(title, [{ name: "Sheet1", rows }])
}

/** 0 → A，25 → Z，26 → AA。 */
function columnName(index: number): string {
  let value = index
  let name = ""
  while (value >= 0) {
    name = String.fromCharCode(65 + (value % 26)) + name
    value = Math.floor(value / 26) - 1
  }
  return name
}

// ---------------------------------------------------------------------------
// PPTX
// ---------------------------------------------------------------------------

const NS_P =
  ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
  ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'

const EMPTY_TREE =
  "<p:cSld><p:spTree>" +
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
  "</p:spTree></p:cSld>"

const PPTX_THEME =
  `${XML_HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="NovaWay">` +
  "<a:themeElements>" +
  '<a:clrScheme name="NovaWay">' +
  '<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2>' +
  '<a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="16A34A"/></a:accent2>' +
  '<a:accent3><a:srgbClr val="EA580C"/></a:accent3><a:accent4><a:srgbClr val="7C3AED"/></a:accent4>' +
  '<a:accent5><a:srgbClr val="0891B2"/></a:accent5><a:accent6><a:srgbClr val="DB2777"/></a:accent6>' +
  '<a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink>' +
  "</a:clrScheme>" +
  '<a:fontScheme name="NovaWay">' +
  '<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface="微软雅黑"/><a:cs typeface=""/></a:majorFont>' +
  '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="微软雅黑"/><a:cs typeface=""/></a:minorFont>' +
  "</a:fontScheme>" +
  '<a:fmtScheme name="NovaWay">' +
  "<a:fillStyleLst>" +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  "</a:fillStyleLst>" +
  "<a:lnStyleLst>" +
  '<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
  '<a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
  '<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>' +
  "</a:lnStyleLst>" +
  "<a:effectStyleLst>" +
  "<a:effectStyle><a:effectLst/></a:effectStyle>" +
  "<a:effectStyle><a:effectLst/></a:effectStyle>" +
  "<a:effectStyle><a:effectLst/></a:effectStyle>" +
  "</a:effectStyleLst>" +
  "<a:bgFillStyleLst>" +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  "</a:bgFillStyleLst>" +
  "</a:fmtScheme>" +
  "</a:themeElements>" +
  "</a:theme>"

const PPTX_MASTER =
  `${XML_HEAD}<p:sldMaster${NS_P}>` +
  '<p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>' +
  EMPTY_TREE +
  "</p:cSld>" +
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"' +
  ' accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
  "<p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>" +
  "</p:sldMaster>"

const PPTX_LAYOUT =
  `${XML_HEAD}<p:sldLayout${NS_P} type="blank" preserve="1">` +
  `<p:cSld name="Blank">${EMPTY_TREE}</p:cSld>` +
  "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>" +
  "</p:sldLayout>"

function pptxSlideXml(title: string, lines: string[]): string {
  const paragraphs = [title, ...lines]
    .map((text) => '<a:p><a:r><a:rPr lang="zh-CN" dirty="0"/><a:t>' + escapeXml(text) + "</a:t></a:r></a:p>")
    .join("")
  return (
    `${XML_HEAD}<p:sld${NS_P}>` +
    "<p:cSld><p:spTree>" +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>' +
    '<p:spPr><a:xfrm><a:off x="838200" y="838200"/><a:ext cx="10515600" cy="1825625"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
    '<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>' +
    paragraphs +
    "</p:txBody></p:sp>" +
    "</p:spTree></p:cSld>" +
    "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>" +
    "</p:sld>"
  )
}

export type PptxSlideInput = { title: string; lines: readonly string[] }

/** 用多张幻灯片生成 pptx；旧格式（odp）转换和新建共用。 */
export function pptxFromSlides(title: string, slides: readonly PptxSlideInput[]): Uint8Array {
  const list = slides.length > 0 ? slides : [{ title, lines: [] }]
  const slideIds: string[] = []
  const slideRels: string[] = []
  const slideParts: Array<{ name: string; data: Uint8Array }> = []
  const slideContentTypes: string[] = []
  const slideFiles: Array<{ name: string; data: Uint8Array }> = []

  for (const [index, slide] of list.entries()) {
    const part = "ppt/slides/slide" + (index + 1) + ".xml"
    const id = 256 + index
    slideIds.push('<p:sldId id="' + id + '" r:id="rId' + (index + 2) + '"/>')
    slideRels.push(
      '<Relationship Id="rId' +
        (index + 2) +
        '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' +
        (index + 1) +
        '.xml"/>',
    )
    slideContentTypes.push(
      '<Override PartName="/' +
        part +
        '" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>',
    )
    slideFiles.push({ name: part, data: utf8(pptxSlideXml(slide.title, [...slide.lines])) })
  }
  void slideParts

  const presentation =
    `${XML_HEAD}<p:presentation${NS_P}>` +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    "<p:sldIdLst>" +
    slideIds.join("") +
    "</p:sldIdLst>" +
    '<p:sldSz cx="12192000" cy="6858000"/>' +
    '<p:notesSz cx="6858000" cy="9144000"/>' +
    "</p:presentation>"
  const presentationRels =
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>' +
    slideRels.join("") +
    "</Relationships>"
  const masterRels =
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>' +
    "</Relationships>"
  const layoutRels =
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>' +
    "</Relationships>"
  const slideRelsXml =
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>' +
    "</Relationships>"
  const contentTypes =
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
    slideContentTypes.join("") +
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>' +
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>' +
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    "</Types>"

  const entries: Array<{ name: string; data: Uint8Array }> = [
    { name: "[Content_Types].xml", data: utf8(contentTypes) },
    { name: "_rels/.rels", data: utf8(rootRels("ppt/presentation.xml")) },
    { name: "docProps/core.xml", data: utf8(coreProps(title)) },
    { name: "ppt/presentation.xml", data: utf8(presentation) },
    { name: "ppt/_rels/presentation.xml.rels", data: utf8(presentationRels) },
    { name: "ppt/slideMasters/slideMaster1.xml", data: utf8(PPTX_MASTER) },
    { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: utf8(masterRels) },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: utf8(PPTX_LAYOUT) },
    { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: utf8(layoutRels) },
    { name: "ppt/theme/theme1.xml", data: utf8(PPTX_THEME) },
  ]
  for (const [index] of list.entries()) {
    entries.push({ name: "ppt/slides/slide" + (index + 1) + ".xml", data: slideFiles[index]!.data })
    entries.push({ name: "ppt/slides/_rels/slide" + (index + 1) + ".xml.rels", data: utf8(slideRelsXml) })
  }
  return buildZip(entries)
}

function pptxBytes(title: string, body?: string): Uint8Array {
  const lines = (body ?? "")
    .split(String.fromCharCode(10))
    .map((line) => line.replace(/^[-*#]+\s*/, "").trim())
    .filter((line) => line !== "")
  return pptxFromSlides(title, [{ title, lines }])
}

// ---------------------------------------------------------------------------
// 文本类
// ---------------------------------------------------------------------------

/**
 * 代码 / 数据类文件的「空文件」：必须是该格式合法的内容。
 *
 * New 面板的约定：新建 .json/.yaml/.toml/.py… 得到的是能直接打开、
 * 不会一保存就报语法错的骨架。纯文本（.txt / 日志 / 未知扩展名）才用标题占位。
 */
const SKELETONS: Record<string, string> = {
  json: "{}\n",
  jsonc: "{}\n",
  json5: "{}\n",
  yaml: "",
  yml: "",
  toml: "",
  ini: "",
  conf: "",
  env: "",
  xml: '<?xml version="1.0" encoding="UTF-8"?>\n',
  html: "",
  css: "",
  scss: "",
  less: "",
  sql: "",
  sh: "#!/usr/bin/env bash\n\n",
  bash: "#!/usr/bin/env bash\n\n",
  zsh: "#!/usr/bin/env zsh\n\n",
  ps1: "",
  py: "",
  js: "",
  mjs: "",
  cjs: "",
  ts: "",
  tsx: "",
  jsx: "",
  go: "",
  rs: "",
  c: "",
  h: "",
  cc: "",
  cpp: "",
  hpp: "",
  cs: "",
  java: "",
  kt: "",
  swift: "",
  php: "",
  rb: "",
  lua: "",
  vue: "",
  svelte: "",
  dockerfile: "",
  makefile: "",
}

/** 纯代码 / 数据类扩展名（新建时不写标题占位，避免文件一打开就是语法错）。 */
export function isCodeOrDataExtension(extension: string): boolean {
  return Object.prototype.hasOwnProperty.call(SKELETONS, extension.toLowerCase())
}

function textBytes(kind: DocumentKind, title: string, body: string | undefined, extension: string): Uint8Array {
  if (kind === "markdown") {
    const head = `---\ntitle: ${title}\n---\n\n# ${title}\n\n`
    return utf8(head + (body ?? ""))
  }
  if (kind === "richtext") {
    return utf8(
      `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8"/>\n<title>${escapeXml(title)}</title>\n</head>\n<body>\n<h1>${escapeXml(title)}</h1>\n` +
        (body ? `<p>${escapeXml(body)}</p>\n` : "") +
        "</body>\n</html>\n",
    )
  }
  if (kind === "spreadsheet") {
    // 没有扩展名能表达「csv」以外的表格新建时，退回制表符分隔的纯文本。
    return utf8(title + "\n" + (body ?? ""))
  }
  const skeleton = SKELETONS[extension]
  if (skeleton !== undefined) return utf8(skeleton + (body ?? ""))
  return utf8(body ? title + "\n\n" + body : title + "\n")
}

export type CreatedDocument = {
  kind: DocumentKind
  bytes: Uint8Array
}

/**
 * 新建一份文档。
 *
 * `kind` 不传时按扩展名推断；无法推断按纯文本处理（和 registry 的口径一致）。
 */
export function createDocument(path: string, options: CreateOptions = {}): CreatedDocument {
  const kind = options.kind ?? kindOfPath(path)
  const title = options.title ?? baseName(path)
  if (kind === "document" && officeFormatOf(path) === "docx") {
    return { kind, bytes: docxBytes(title, options.body) }
  }
  if (kind === "presentation" && officeFormatOf(path) === "pptx") {
    return { kind, bytes: pptxBytes(title, options.body) }
  }
  if (kind === "spreadsheet" && officeFormatOf(path) === "xlsx") {
    return { kind, bytes: xlsxBytes(title, options.body) }
  }
  if (kind === "presentation" || kind === "document" || kind === "spreadsheet") {
    // odt / ods / odp / doc / rtf 还没有写入引擎：明确拒绝，而不是造一个打不开的文件。
    throw new Error("暂时不能新建 ." + extensionOfPath(path) + " 文件")
  }
  return { kind, bytes: textBytes(kind, title, options.body, extensionOfPath(path)) }
}

/**
 * 异步版新建：PDF 要走 pdf-lib 生成（`save()` 是异步的），其余格式同步。
 * Office 面板 / CLI / AI 都用这一个入口，免得两处各写一份分支。
 */
export async function createDocumentAsync(path: string, options: CreateOptions = {}): Promise<CreatedDocument> {
  if (officeFormatOf(path) === "pdf") {
    const title = options.title ?? baseName(path)
    return { kind: "pdf", bytes: await createPdf({ title, body: options.body }) }
  }
  return createDocument(path, options)
}

function baseName(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(0, dot) : name
}

function extensionOfPath(path: string): string {
  const name = path.split(/[\/]/).pop() ?? path
  const dot = name.lastIndexOf(".")
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase()
}
