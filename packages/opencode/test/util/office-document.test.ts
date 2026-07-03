import { describe, expect, test } from "bun:test"
import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from "@zip.js/zip.js"
import { extractOfficeDocumentText, fillPptxTemplateText, isOfficeDocument } from "../../src/util/office-document"

describe("office document extraction", () => {
  test("detects common Office document types", () => {
    expect(isOfficeDocument("proposal.docx", undefined)).toBe(true)
    expect(isOfficeDocument("deck.pptx", undefined)).toBe(true)
    expect(isOfficeDocument("sheet.xlsx", undefined)).toBe(true)
    expect(isOfficeDocument("notes.txt", "text/plain")).toBe(false)
  })

  test("extracts text from docx document xml", async () => {
    const bytes = await zip({
      "word/document.xml": [
        "<w:document>",
        "<w:body>",
        "<w:p><w:r><w:t>项目方案</w:t></w:r></w:p>",
        "<w:p><w:r><w:t>先结论后细节</w:t></w:r></w:p>",
        "</w:body>",
        "</w:document>",
      ].join(""),
    })

    const result = await extractOfficeDocumentText({ filename: "proposal.docx", bytes })

    expect(result?.kind).toBe("docx")
    expect(result?.text).toContain("项目方案")
    expect(result?.text).toContain("先结论后细节")
  })

  test("preserves spaces across docx text runs", async () => {
    const bytes = await zip({
      "word/document.xml": [
        "<w:document>",
        "<w:body>",
        '<w:p><w:r><w:t xml:space="preserve">客户 </w:t></w:r><w:r><w:t>提案</w:t></w:r></w:p>',
        "</w:body>",
        "</w:document>",
      ].join(""),
    })

    const result = await extractOfficeDocumentText({ filename: "proposal.docx", bytes })

    expect(result?.text).toContain("客户 提案")
  })

  test("extracts slide text from pptx slides", async () => {
    const bytes = await zip({
      "ppt/slides/slide2.xml": "<p:sld><a:t>第二页结论</a:t></p:sld>",
      "ppt/slides/slide1.xml": "<p:sld><a:t>封面标题</a:t></p:sld>",
    })

    const result = await extractOfficeDocumentText({ filename: "deck.pptx", bytes })

    expect(result?.kind).toBe("pptx")
    expect(result?.text).toContain("第 1 页")
    expect(result?.text).toContain("封面标题")
    expect(result?.text).toContain("第二页结论")
  })

  test("extracts speaker notes from pptx notes slides", async () => {
    const bytes = await zip({
      "ppt/slides/slide1.xml": "<p:sld><a:t>汇报标题</a:t></p:sld>",
      "ppt/notesSlides/notesSlide1.xml": "<p:notes><a:t>强调下季度资源诉求</a:t></p:notes>",
    })

    const result = await extractOfficeDocumentText({ filename: "deck.pptx", bytes })

    expect(result?.kind).toBe("pptx")
    expect(result?.text).toContain("汇报标题")
    expect(result?.text).toContain("演讲备注")
    expect(result?.text).toContain("强调下季度资源诉求")
  })

  test("extracts pptx template design signals", async () => {
    const bytes = await zip({
      "ppt/slides/slide1.xml":
        '<p:sld><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="600000" y="500000"/><a:ext cx="6000000" cy="600000"/></a:xfrm></p:spPr><a:t>Template Cover</a:t></p:sp></p:sld>',
      "ppt/slides/slide2.xml":
        '<p:sld><p:sp><p:nvSpPr><p:cNvPr id="2" name="Content Placeholder 2"/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="600000" y="1400000"/><a:ext cx="6200000" cy="1800000"/></a:xfrm></p:spPr><a:t>Revenue 42%</a:t></p:sp><p:pic/></p:sld>',
      "ppt/theme/theme1.xml": '<a:theme><a:srgbClr val="1F4E79"/><a:srgbClr val="F2C94C"/><a:latin typeface="Aptos"/></a:theme>',
    })

    const result = await extractOfficeDocumentText({ filename: "template.pptx", bytes })

    expect(result?.kind).toBe("pptx")
    expect(result?.text).toContain("PPTX模板设计信号")
    expect(result?.text).toContain("#1F4E79")
    expect(result?.text).toContain("Aptos")
    expect(result?.text).toContain("封面候选")
    expect(result?.text).toContain("数据页候选")
    expect(result?.text).toContain("标题槽 1")
    expect(result?.text).toContain("正文槽 1")
    expect(result?.text).toContain("1 个图片位")
  })

  test("fills pptx template text while preserving package design", async () => {
    const bytes = await zip({
      "ppt/slides/slide1.xml":
        '<p:sld><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><a:t>Old Cover</a:t><a:t>Old Subtitle</a:t></p:sp></p:sld>',
      "ppt/slides/slide2.xml":
        '<p:sld><p:sp><p:nvSpPr><p:cNvPr id="2" name="Content Placeholder 2"/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><a:t>Old Point</a:t></p:sp></p:sld>',
      "ppt/theme/theme1.xml": '<a:theme><a:srgbClr val="1F4E79"/><a:latin typeface="Aptos"/></a:theme>',
    })

    const filled = await fillPptxTemplateText({
      bytes,
      plan: {
        slides: [
          { slide: 1, texts: ["New Cover", "New Subtitle & Value"] },
          { slide: 2, texts: ["New Point <Checked>"] },
        ],
      },
    })
    const result = await extractOfficeDocumentText({ filename: "filled.pptx", bytes: filled })

    expect(result?.text).toContain("New Cover")
    expect(result?.text).toContain("New Subtitle & Value")
    expect(result?.text).toContain("New Point <Checked>")
    expect(result?.text).toContain("#1F4E79")
    expect(result?.text).not.toContain("Old Cover")
  })

  test("fills pptx template text by placeholder role instead of shape order", async () => {
    const bytes = await zip({
      "ppt/slides/slide1.xml": [
        "<p:sld>",
        '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content Placeholder 2"/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="600000" y="1500000"/><a:ext cx="6200000" cy="1800000"/></a:xfrm></p:spPr><a:t>Old Body</a:t></p:sp>',
        '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="600000" y="400000"/><a:ext cx="6000000" cy="600000"/></a:xfrm></p:spPr><a:t>Old Title</a:t></p:sp>',
        "</p:sld>",
      ].join(""),
    })

    const filled = await fillPptxTemplateText({
      bytes,
      plan: { slides: [{ slide: 1, texts: ["Deck Title", "First body line", "Second body line"] }] },
    })
    const slideXml = await zipEntryText(filled, "ppt/slides/slide1.xml")

    expect(slideXml.match(/name="Content Placeholder 2"[\s\S]*?<a:t>([\s\S]*?)<\/a:t>/)?.[1]).toContain("First body line")
    expect(slideXml.match(/name="Title 1"[\s\S]*?<a:t>([\s\S]*?)<\/a:t>/)?.[1]).toBe("Deck Title")
    expect(slideXml).not.toContain("Old Body")
    expect(slideXml).not.toContain("Old Title")
  })

  test("fills pptx subtitle placeholder separately from title and body", async () => {
    const bytes = await zip({
      "ppt/slides/slide1.xml": [
        "<p:sld>",
        '<p:sp><p:nvSpPr><p:cNvPr id="4" name="Content Placeholder 3"/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="600000" y="1800000"/><a:ext cx="6200000" cy="1800000"/></a:xfrm></p:spPr><a:t>Old Body</a:t></p:sp>',
        '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="600000" y="400000"/><a:ext cx="6000000" cy="600000"/></a:xfrm></p:spPr><a:t>Old Title</a:t></p:sp>',
        '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Subtitle 2"/><p:nvPr><p:ph type="subtitle"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="600000" y="1100000"/><a:ext cx="6000000" cy="500000"/></a:xfrm></p:spPr><a:t>Old Subtitle</a:t></p:sp>',
        "</p:sld>",
      ].join(""),
    })

    const filled = await fillPptxTemplateText({
      bytes,
      plan: { slides: [{ slide: 1, texts: ["Deck Title", "Deck Subtitle", "Body Line"] }] },
    })
    const slideXml = await zipEntryText(filled, "ppt/slides/slide1.xml")

    expect(slideXml.match(/name="Title 1"[\s\S]*?<a:t>([\s\S]*?)<\/a:t>/)?.[1]).toBe("Deck Title")
    expect(slideXml.match(/name="Subtitle 2"[\s\S]*?<a:t>([\s\S]*?)<\/a:t>/)?.[1]).toBe("Deck Subtitle")
    expect(slideXml.match(/name="Content Placeholder 3"[\s\S]*?<a:t>([\s\S]*?)<\/a:t>/)?.[1]).toBe("Body Line")
  })

  test("fills pptx template image placeholders by slide relationship", async () => {
    const bytes = await zip({
      "ppt/slides/slide1.xml": [
        "<p:sld>",
        '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><a:t>Old Title</a:t></p:sp>',
        '<p:pic><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic>',
        "</p:sld>",
      ].join(""),
      "ppt/slides/_rels/slide1.xml.rels":
        '<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>',
      "ppt/media/image1.png": "OLD_IMAGE",
    })

    const filled = await fillPptxTemplateText({
      bytes,
      plan: {
        slides: [
          {
            slide: 1,
            texts: ["New Title"],
            images: [{ mime: "image/png", dataBase64: Buffer.from("NEW_IMAGE").toString("base64") }],
          },
        ],
      },
    })

    expect(Buffer.from(await zipEntryBytes(filled, "ppt/media/image1.png")).toString()).toBe("NEW_IMAGE")
    expect(await zipEntryText(filled, "ppt/slides/_rels/slide1.xml.rels")).toContain("../media/image1.png")
  })

  test("fills pptx template table cells", async () => {
    const bytes = await zip({
      "ppt/slides/slide1.xml": [
        "<p:sld><a:tbl>",
        "<a:tr><a:tc><a:p><a:r><a:t>H1</a:t></a:r></a:p></a:tc><a:tc><a:p><a:r><a:t>H2</a:t></a:r></a:p></a:tc></a:tr>",
        "<a:tr><a:tc><a:p><a:r><a:t>A1</a:t></a:r></a:p></a:tc><a:tc><a:p><a:r><a:t>A2</a:t></a:r></a:p></a:tc></a:tr>",
        "</a:tbl></p:sld>",
      ].join(""),
    })

    const filled = await fillPptxTemplateText({
      bytes,
      plan: { slides: [{ slide: 1, texts: [], tables: [[["Metric", "Value"], ["Revenue", "120"]]] }] },
    })
    const slideXml = await zipEntryText(filled, "ppt/slides/slide1.xml")

    expect(slideXml).toContain("<a:t>Metric</a:t>")
    expect(slideXml).toContain("<a:t>Value</a:t>")
    expect(slideXml).toContain("<a:t>Revenue</a:t>")
    expect(slideXml).toContain("<a:t>120</a:t>")
    expect(slideXml).not.toContain("<a:t>H1</a:t>")
  })

  test("expands pptx template table rows and columns", async () => {
    const bytes = await zip({
      "ppt/slides/slide1.xml": [
        "<p:sld><a:tbl>",
        "<a:tr><a:tc><a:p><a:r><a:t>H1</a:t></a:r></a:p></a:tc><a:tc><a:p><a:r><a:t>H2</a:t></a:r></a:p></a:tc></a:tr>",
        "<a:tr><a:tc><a:p><a:r><a:t>A1</a:t></a:r></a:p></a:tc><a:tc><a:p><a:r><a:t>A2</a:t></a:r></a:p></a:tc></a:tr>",
        "</a:tbl></p:sld>",
      ].join(""),
    })

    const filled = await fillPptxTemplateText({
      bytes,
      plan: {
        slides: [
          {
            slide: 1,
            texts: [],
            tables: [[["Metric", "Value", "Owner"], ["Revenue", "120", "Sales"], ["Growth", "30%", "Ops"]]],
          },
        ],
      },
    })
    const slideXml = await zipEntryText(filled, "ppt/slides/slide1.xml")

    expect([...slideXml.matchAll(/<a:tr/g)]).toHaveLength(3)
    expect([...slideXml.matchAll(/<a:tc/g)]).toHaveLength(9)
    expect(slideXml).toContain("<a:t>Owner</a:t>")
    expect(slideXml).toContain("<a:t>Ops</a:t>")
  })

  test("fills pptx template chart caches by slide relationship", async () => {
    const bytes = await zip({
      "ppt/slides/slide1.xml": '<p:sld><p:graphicFrame><a:graphic><a:graphicData><c:chart r:id="rId3"/></a:graphicData></a:graphic></p:graphicFrame></p:sld>',
      "ppt/slides/_rels/slide1.xml.rels":
        '<Relationships><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>',
      "ppt/charts/chart1.xml":
        '<c:chartSpace><c:chart><c:plotArea><c:barChart><c:ser><c:tx><c:v>Old</c:v></c:tx><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>Old Cat</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>',
    })

    const filled = await fillPptxTemplateText({
      bytes,
      plan: {
        slides: [
          {
            slide: 1,
            texts: [],
            charts: [{ categories: ["Jan", "Feb"], series: [{ name: "Revenue", values: [120, 160] }] }],
          },
        ],
      },
    })
    const chartXml = await zipEntryText(filled, "ppt/charts/chart1.xml")

    expect(chartXml).toContain("<c:v>Revenue</c:v>")
    expect(chartXml).toContain("<c:v>Jan</c:v>")
    expect(chartXml).toContain("<c:v>Feb</c:v>")
    expect(chartXml).toContain("<c:v>120</c:v>")
    expect(chartXml).toContain("<c:v>160</c:v>")
    expect(chartXml).not.toContain("Old Cat")
  })

  test("expands pptx template chart series from tabular data", async () => {
    const bytes = await zip({
      "ppt/slides/slide1.xml": '<p:sld><p:graphicFrame><a:graphic><a:graphicData><c:chart r:id="rId3"/></a:graphicData></a:graphic></p:graphicFrame></p:sld>',
      "ppt/slides/_rels/slide1.xml.rels":
        '<Relationships><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>',
      "ppt/charts/chart1.xml":
        '<c:chartSpace><c:chart><c:plotArea><c:barChart><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Old</c:v></c:tx><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>Old Cat</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>1</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>',
    })

    const filled = await fillPptxTemplateText({
      bytes,
      plan: {
        slides: [
          {
            slide: 1,
            texts: [],
            charts: [
              {
                categories: ["Jan", "Feb"],
                series: [
                  { name: "Revenue", values: [120, 160] },
                  { name: "Cost", values: [80, 90] },
                ],
              },
            ],
          },
        ],
      },
    })
    const chartXml = await zipEntryText(filled, "ppt/charts/chart1.xml")

    expect([...chartXml.matchAll(/<c:ser/g)]).toHaveLength(2)
    expect(chartXml).toContain('<c:idx val="1"/>')
    expect(chartXml).toContain("<c:v>Revenue</c:v>")
    expect(chartXml).toContain("<c:v>Cost</c:v>")
    expect(chartXml).toContain("<c:v>90</c:v>")
  })

  test("extracts rows from xlsx shared and inline strings", async () => {
    const bytes = await zip({
      "xl/sharedStrings.xml": [
        "<sst>",
        "<si><t>部门</t></si>",
        "<si><t>目标</t></si>",
        "<si><r><t>增长 </t></r><r><t>20%</t></r></si>",
        "</sst>",
      ].join(""),
      "xl/worksheets/sheet1.xml": [
        "<worksheet><sheetData>",
        '<row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row>',
        '<row><c t="inlineStr"><is><t>销售</t></is></c><c t="s"><v>2</v></c></row>',
        "</sheetData></worksheet>",
      ].join(""),
    })

    const result = await extractOfficeDocumentText({ filename: "plan.xlsx", bytes })

    expect(result?.kind).toBe("xlsx")
    expect(result?.text).toContain("部门 | 目标")
    expect(result?.text).toContain("销售 | 增长 20%")
  })
})

async function zip(files: Record<string, string>) {
  const writer = new ZipWriter(new BlobWriter("application/zip"))
  for (const [name, content] of Object.entries(files)) {
    await writer.add(name, new TextReader(content))
  }
  return new Uint8Array(await (await writer.close()).arrayBuffer())
}

async function zipEntryText(bytes: Uint8Array, filename: string) {
  const reader = new ZipReader(new BlobReader(new Blob([Buffer.from(bytes)])))
  try {
    const entry = (await reader.getEntries()).find((item) => item.filename === filename)
    return (await entry?.getData?.(new TextWriter())) ?? ""
  } finally {
    await reader.close()
  }
}

async function zipEntryBytes(bytes: Uint8Array, filename: string) {
  const reader = new ZipReader(new BlobReader(new Blob([Buffer.from(bytes)])))
  try {
    const entry = (await reader.getEntries()).find((item) => item.filename === filename)
    const blob = await entry?.getData?.(new BlobWriter())
    return blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array()
  } finally {
    await reader.close()
  }
}
