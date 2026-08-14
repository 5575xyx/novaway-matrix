import { describe, expect, test } from "bun:test"
import JSZip from "jszip"
import {
  derivePptxAnimationConfig,
  fillPptxTemplate,
  hydrateOfficeSlideAssets,
  officePptTemplateSlideShapes,
  xlsxSheetNamesFromBase64,
} from "./office-ppt-template-fill"
import type { OfficeArtifact } from "./office-artifact"
import { createOfficeExportFile } from "./office-export"

const wavBase64 = "UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQgAAACAgICAgICAgA=="

function artifact(input?: Partial<OfficeArtifact>): OfficeArtifact {
  return {
    body: "# 办公产物\n\n## 项目汇报\n\n- 完成本周交付",
    filename: "项目汇报.md",
    memory: "",
    slides: [
      { index: 1, title: "项目目标", content: "- 背景\n- 目标" },
      { index: 2, title: "推进计划", content: "- 节奏\n- 风险" },
      { index: 3, title: "下步动作", content: "- 确认资源\n- 启动试点" },
    ],
    title: "项目汇报",
    ...input,
  }
}

describe("fillPptxTemplate", () => {
  test("reads bound CSV assets into chart data before export", async () => {
    const hydrated = await hydrateOfficeSlideAssets(
      artifact({
        slides: [
          {
            index: 1,
            title: "数据",
            content: "从素材生成图表",
            chartType: "bar",
            assets: ["data/sales.csv"],
          },
        ],
      }),
      async () => "指标,Q1\n华东,20\n华南,30",
    )
    expect(hydrated.slides[0]?.content).toContain("| 指标 | Q1 |")
    expect(hydrated.slides[0]?.content).toContain("| 华东 | 20 |")
  })

  test("reads JSON assets with categories and series into chart data", async () => {
    const hydrated = await hydrateOfficeSlideAssets(
      artifact({
        slides: [
          {
            index: 1,
            title: "趋势",
            content: "从 JSON 生成图表",
            chartType: "line",
            assets: ["data/trend.json"],
          },
        ],
      }),
      async () =>
        JSON.stringify({
          categories: ["Q1", "Q2"],
          series: [
            { name: "收入", data: [10, 20] },
            { name: "成本", data: [5, 8] },
          ],
        }),
    )
    expect(hydrated.slides[0]?.content).toContain("| 分类 | 收入 | 成本 |")
    expect(hydrated.slides[0]?.content).toContain("| Q1 | 10 | 5 |")
  })

  test("reads bound CSV assets into table pages", async () => {
    const hydrated = await hydrateOfficeSlideAssets(
      artifact({
        slides: [
          {
            index: 1,
            title: "排期表",
            content: "从素材生成排期表",
            layout: "table",
            assets: ["data/plan.csv"],
          },
        ],
      }),
      async () => "任务,负责人,时间\n需求澄清,张三,周一\n方案设计,李四,周二",
    )
    expect(hydrated.slides[0]?.content).toContain("| 任务 | 负责人 | 时间 |")
    expect(hydrated.slides[0]?.content).toContain("| 需求澄清 | 张三 | 周一 |")
  })

  test("reads XLSX assets as base64 into table data", async () => {
    const zip = new JSZip()
    zip.file(
      "xl/sharedStrings.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4"><si><t>任务</t></si><si><t>Q1</t></si><si><t>华东</t></si><si><t>20</t></si></sst>`,
    )
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData/></worksheet>`,
    )
    zip.file(
      "xl/worksheets/sheet2.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>20</v></c></row></sheetData></worksheet>`,
    )
    zip.file(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="说明" sheetId="1" r:id="rId1"/><sheet name="销售明细" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    )
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    )
    const base64 = await zip.generateAsync({ type: "base64" })
    const hydrated = await hydrateOfficeSlideAssets(
      artifact({
        slides: [
          {
            index: 1,
            title: "数据",
            content: "从 XLSX 生成图表",
            chartType: "bar",
            assets: ["data/sales.xlsx"],
          },
        ],
      }),
      async () => ({ content: base64, encoding: "base64" as const }),
    )
    expect(hydrated.slides[0]?.content).toContain("| 任务 | Q1 |")
    expect(hydrated.slides[0]?.content).toContain("| 华东 | 20 |")
  })

  test("lists worksheet names from an XLSX asset", async () => {
    const zip = new JSZip()
    zip.file(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="说明" sheetId="1" r:id="rId1"/><sheet name="销售明细" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    )
    const base64 = await zip.generateAsync({ type: "base64" })
    expect(await xlsxSheetNamesFromBase64(base64)).toEqual(["说明", "销售明细"])
  })

  test("reads a selected XLSX worksheet by name", async () => {
    const zip = new JSZip()
    zip.file(
      "xl/sharedStrings.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="8" uniqueCount="8"><si><t>区域</t></si><si><t>收入</t></si><si><t>华东</t></si><si><t>10</t></si><si><t>华南</t></si><si><t>30</t></si><si><t>备用</t></si><si><t>数量</t></si></sst>`,
    )
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row><row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>5</v></c></row></sheetData></worksheet>`,
    )
    zip.file(
      "xl/worksheets/sheet2.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>6</v></c><c r="B1" t="s"><v>7</v></c></row><row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2"><v>5</v></c></row></sheetData></worksheet>`,
    )
    zip.file(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="说明" sheetId="1" r:id="rId1"/><sheet name="备选" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    )
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`,
    )
    const base64 = await zip.generateAsync({ type: "base64" })
    const hydrated = await hydrateOfficeSlideAssets(
      artifact({
        slides: [
          {
            index: 1,
            title: "数据",
            content: "从指定工作表生成图表",
            chartType: "bar",
            chartOptions: { xlsxSheet: "说明" },
            assets: ["data/sales.xlsx"],
          },
        ],
      }),
      async () => ({ content: base64, encoding: "base64" as const }),
    )
    expect(hydrated.slides[0]?.content).toContain("| 区域 | 收入 |")
    expect(hydrated.slides[0]?.content).toContain("| 华东 | 10 |")
    expect(hydrated.slides[0]?.content).not.toContain("备用")
  })

  test("does not hydrate a missing XLSX worksheet", async () => {
    const zip = new JSZip()
    zip.file(
      "xl/sharedStrings.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2"><si><t>任务</t></si><si><t>Q1</t></si></sst>`,
    )
    zip.file(
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row></sheetData></worksheet>`,
    )
    zip.file(
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="数据" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    )
    zip.file(
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    )
    const base64 = await zip.generateAsync({ type: "base64" })
    const hydrated = await hydrateOfficeSlideAssets(
      artifact({
        slides: [
          {
            index: 1,
            title: "数据",
            content: "保持原内容",
            chartType: "bar",
            chartOptions: { xlsxSheet: "不存在" },
            assets: ["data/sales.xlsx"],
          },
        ],
      }),
      async () => ({ content: base64, encoding: "base64" as const }),
    )
    expect(hydrated.slides[0]?.content).toBe("保持原内容")
  })

  test("reads image assets as base64 into visual data urls", async () => {
    const hydrated = await hydrateOfficeSlideAssets(
      artifact({
        slides: [
          {
            index: 1,
            title: "封面",
            content: "- 项目汇报",
            assets: ["assets/cover.png"],
          },
        ],
      }),
      async () => ({ content: "aGVsbG8=", encoding: "base64" as const }),
    )
    expect(hydrated.slides[0]?.visual).toContain("data:image/png;base64,aGVsbG8=")
  })

  test("reads audio assets as base64 into slide audio", async () => {
    const hydrated = await hydrateOfficeSlideAssets(
      artifact({
        slides: [
          {
            index: 1,
            title: "封面",
            content: "- 项目汇报",
            assets: ["audio/narration.mp3"],
          },
        ],
      }),
      async () => ({ content: "QUJD", encoding: "base64" as const }),
    )
    expect(hydrated.slides[0]?.audio).toMatchObject({
      mime: "audio/mpeg",
      dataBase64: "QUJD",
    })
  })

  test("reads bound markdown assets into empty slide content", async () => {
    const hydrated = await hydrateOfficeSlideAssets(
      artifact({
        slides: [
          {
            index: 1,
            title: "项目背景",
            content: "",
            assets: ["docs/background.md"],
          },
        ],
      }),
      async () => "# 项目背景\n- 明确目标\n- 对齐资源",
    )
    expect(hydrated.slides[0]?.content).toContain("项目背景")
    expect(hydrated.slides[0]?.content).toContain("明确目标")
  })

  test("clones real template slides and replaces user text", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/swiss-grid/template.pptx").arrayBuffer(),
    )
    const output = await fillPptxTemplate(templateBytes, artifact())
    const zip = await JSZip.loadAsync(output)

    expect(zip.file("ppt/slideMasters/slideMaster1.xml")).toBeTruthy()
    expect(zip.file("ppt/theme/theme1.xml")).toBeTruthy()

    const presentation = await zip.file("ppt/presentation.xml")?.async("string")
    expect(presentation).toContain('<p:sldId id="256" r:id="rId1000"/>')
    expect(presentation).toContain('<p:sldId id="258" r:id="rId1002"/>')

    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string")
    expect(slide1).toContain("项目目标")
    const slide3 = await zip.file("ppt/slides/slide3.xml")?.async("string")
    expect(slide3).toContain("下步动作")
  })

  test("auto scales long slide text to avoid export overflow", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/swiss-grid/template.pptx").arrayBuffer(),
    )
    const output = await fillPptxTemplate(
      templateBytes,
      artifact({
        slides: [
          {
            index: 1,
            title: "项目目标",
            content: Array.from({ length: 10 }, (_, index) => `第 ${index + 1} 个关键结论需要完整展开说明`).join("\n"),
          },
        ],
      }),
    )
    const zip = await JSZip.loadAsync(output)
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string")
    expect(slide1).toMatch(/<a:normAutofit fontScale="\d+"\/>/)
    expect(slide1).toContain("第 10 个关键结论需要完整展开说明")
  })

  test("fills real template slides with editable native formulas", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/swiss-grid/template.pptx").arrayBuffer(),
    )
    const output = await fillPptxTemplate(
      templateBytes,
      artifact({
        slides: [
          {
            index: 1,
            title: "项目目标",
            content: "- 能量公式：$E=mc^2$\n- 平方根：$\\sqrt{x}$\n- 分数：$$\\frac{a}{b}$$",
          },
        ],
      }),
    )
    const zip = await JSZip.loadAsync(output)
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string")
    expect(slide1).toContain("<a14:m")
    expect(slide1).toContain("<m:oMath>")
    expect(slide1).toContain("<m:sSup>")
    expect(slide1).toContain("<m:rad>")
    expect(slide1).toContain("<m:f>")
  })

  test("fills restored Presenton PPTX templates as real template files", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/presenton-pptx/swift/template.pptx").arrayBuffer(),
    )
    const output = await fillPptxTemplate(templateBytes, artifact())
    const zip = await JSZip.loadAsync(output)

    expect(zip.file("ppt/slideMasters/slideMaster1.xml")).toBeTruthy()
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string")
    expect(slide1).toContain("项目目标")
  })

  test("replaces template tables with user markdown tables", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/swiss-grid/template.pptx").arrayBuffer(),
    )
    const output = await fillPptxTemplate(
      templateBytes,
      artifact({
        slides: [
          { index: 1, title: "封面", content: "- 项目汇报" },
          { index: 2, title: "目录", content: "- 背景\n- 目标" },
          { index: 3, title: "内容", content: "- 关键观点" },
          { index: 4, title: "卡片", content: "- 现状\n- 路径\n- 结果" },
          {
            index: 5,
            title: "数据表",
            content:
              "| 指标 | 基线 | 目标 | 变化 |\n| --- | --- | --- | --- |\n| 营收 | 1.28 亿 | 1.64 亿 | +28% |\n| 用户 | 82 万 | 106 万 | +29% |",
          },
          { index: 6, title: "收尾", content: "- 下一步" },
        ],
      }),
    )
    const zip = await JSZip.loadAsync(output)
    const slide5 = await zip.file("ppt/slides/slide5.xml")?.async("string")
    expect(slide5).toContain("1.64 亿")
    expect(slide5).toContain("106 万")
  })

  test("replaces template image slots with user data url images", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/presenton-pptx/swift/template.pptx").arrayBuffer(),
    )
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    const output = await fillPptxTemplate(
      templateBytes,
      artifact({
        slides: [
          {
            index: 1,
            title: "封面",
            content: "- 项目汇报",
            visual: `![配图](data:image/png;base64,${pngBase64})`,
          },
        ],
      }),
    )
    const zip = await JSZip.loadAsync(output)
    const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")?.async("string")
    const target = rels?.match(/<Relationship[^>]*Type="[^"]*\/image"[^>]*Target="([^"]+)"/)?.[1]
    expect(target).toBeTruthy()
    const mediaPath = target?.replace(/^\.\.\//, "ppt/") ?? ""
    const media = await zip.file(mediaPath)?.async("uint8array")
    expect(media).toBeTruthy()
    expect(media?.length).toBeGreaterThan(0)
  })

  test("adds editable speaker notes slides", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/swiss-grid/template.pptx").arrayBuffer(),
    )
    const output = await fillPptxTemplate(
      templateBytes,
      artifact({
        slides: [
          { index: 1, title: "封面", content: "- 项目汇报", notes: "开场先讲背景和核心结论。" },
          { index: 2, title: "推进计划", content: "- 节奏\n- 风险", notes: "这里展开风险与依赖。" },
        ],
      }),
    )
    const zip = await JSZip.loadAsync(output)
    const notes1 = await zip.file("ppt/notesSlides/notesSlide1.xml")?.async("string")
    const notes2 = await zip.file("ppt/notesSlides/notesSlide2.xml")?.async("string")
    expect(notes1).toContain("开场先讲背景和核心结论。")
    expect(notes2).toContain("这里展开风险与依赖。")
    const rels1 = await zip.file("ppt/slides/_rels/slide1.xml.rels")?.async("string")
    expect(rels1).toContain("notesSlide1.xml")
    expect(rels1).toContain("</Relationships>")
  })

  test("writes selected page assets into speaker notes", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/swiss-grid/template.pptx").arrayBuffer(),
    )
    const output = await fillPptxTemplate(
      templateBytes,
      artifact({
        slides: [
          {
            index: 1,
            title: "封面",
            content: "- 项目汇报",
            assets: ["docs/plan.md", "data/sales.xlsx"],
          },
        ],
      }),
    )
    const zip = await JSZip.loadAsync(output)
    const notes1 = await zip.file("ppt/notesSlides/notesSlide1.xml")?.async("string")
    expect(notes1).toContain("素材来源：docs/plan.md、data/sales.xlsx")
  })

  test("replaces native template charts with user chart data", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/editorial-magazine/template.pptx").arrayBuffer(),
    )
    const output = await fillPptxTemplate(
      templateBytes,
      artifact({
        slides: [
          { index: 1, title: "封面", content: "- 项目汇报" },
          { index: 2, title: "目录", content: "- 背景\n- 目标" },
          { index: 3, title: "内容", content: "- 关键观点" },
          { index: 4, title: "卡片", content: "- 现状\n- 路径\n- 结果" },
          {
            index: 5,
            title: "图表",
            content: "| 指标 | Q1 | Q2 |\n| --- | --- | --- |\n| 华东 | 10 | 20 |\n| 华南 | 30 | 40 |",
          },
          { index: 6, title: "收尾", content: "- 下一步" },
        ],
      }),
    )
    const zip = await JSZip.loadAsync(output)
    const chartPath = Object.keys(zip.files).find((name) => name.startsWith("ppt/charts/") && name.endsWith(".xml"))
    expect(chartPath).toBeTruthy()
    const chart = await zip.file(chartPath ?? "")?.async("string")
    expect(chart).toContain("华东")
    expect(chart).toContain("40")
  })

  test("creates a native table when the selected template page has no table slot", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/retro-terminal/template.pptx").arrayBuffer(),
    )
    const output = await fillPptxTemplate(
      templateBytes,
      artifact({
        slides: [
          { index: 1, title: "封面", content: "- 项目汇报" },
          { index: 2, title: "目录", content: "- 背景\n- 目标" },
          { index: 3, title: "内容", content: "- 关键观点" },
          { index: 4, title: "卡片", content: "- 现状\n- 路径\n- 结果" },
          {
            index: 5,
            title: "数据表",
            content: "| 指标 | 基线 | 目标 |\n| --- | --- | --- |\n| 营收 | 1.28 亿 | 1.64 亿 |",
          },
          { index: 6, title: "收尾", content: "- 下一步" },
        ],
      }),
    )
    const zip = await JSZip.loadAsync(output)
    const slide5 = await zip.file("ppt/slides/slide5.xml")?.async("string")
    expect(slide5).toContain("<a:tbl")
    expect(slide5).toContain("1.64 亿")
  })

  test("auto sizes inserted tables to avoid long-cell overflow", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/retro-terminal/template.pptx").arrayBuffer(),
    )
    const output = await fillPptxTemplate(
      templateBytes,
      artifact({
        slides: [
          { index: 1, title: "封面", content: "- 项目汇报" },
          { index: 2, title: "目录", content: "- 背景\n- 目标" },
          { index: 3, title: "内容", content: "- 关键观点" },
          { index: 4, title: "卡片", content: "- 现状\n- 路径\n- 结果" },
          {
            index: 5,
            title: "数据表",
            content: "| 指标 | 说明 |\n| --- | --- |\n| 核心指标 | 这个指标说明需要更多空间避免导出时溢出 |",
          },
          { index: 6, title: "收尾", content: "- 下一步" },
        ],
      }),
    )
    const zip = await JSZip.loadAsync(output)
    const slide5 = await zip.file("ppt/slides/slide5.xml")?.async("string")
    expect(slide5).toContain('<a:gridCol w="3886200"/>')
    expect(slide5).toContain('<a:normAutofit fontScale="90000"/>')
    expect(slide5).toContain("这个指标说明需要更多空间避免导出时溢出")
  })

  test("creates a native chart when the selected template page has no chart slot", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/retro-terminal/template.pptx").arrayBuffer(),
    )
    const chartTemplateXml = await Bun.file("public/assets/office-ppt-templates/chart-template.xml").text()
    const output = await fillPptxTemplate(
      templateBytes,
      artifact({
        slides: [
          { index: 1, title: "封面", content: "- 项目汇报" },
          { index: 2, title: "目录", content: "- 背景\n- 目标" },
          { index: 3, title: "内容", content: "- 关键观点" },
          { index: 4, title: "卡片", content: "- 现状\n- 路径\n- 结果" },
          {
            index: 5,
            title: "图表",
            content: "| 指标 | Q1 | Q2 |\n| --- | --- | --- |\n| 华东 | 10 | 20 |\n| 华南 | 30 | 40 |",
            shapeOverrides: [{ id: 200, x: 700000, y: 1600000, cx: 5000000, cy: 2000000 }],
          },
          { index: 6, title: "收尾", content: "- 下一步" },
        ],
      }),
      { chartTemplateXml },
    )
    const zip = await JSZip.loadAsync(output)
    const chartPath = "ppt/charts/chart-auto-5.xml"
    const chart = await zip.file(chartPath)?.async("string")
    expect(chart).toContain("华东")
    expect(chart).toContain("40")
    const slide5 = await zip.file("ppt/slides/slide5.xml")?.async("string")
    expect(slide5).toContain("<c:chart")
    expect(slide5).toContain('<a:off x="700000" y="1600000"/>')
    expect(slide5).toContain('<a:ext cx="5000000" cy="2000000"/>')
    const rels5 = await zip.file("ppt/slides/_rels/slide5.xml.rels")?.async("string")
    expect(rels5).toContain("chart-auto-5.xml")
  })

  test("shows a virtual chart object for data pages without a native chart slot", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/retro-terminal/template.pptx").arrayBuffer(),
    )
    const shapes = await officePptTemplateSlideShapes("presenton-swift", "data", templateBytes)
    expect(shapes.some((shape) => shape.id === 200 && shape.kind === "chart")).toBe(true)
  })

  test("exports selected line and donut native chart types", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/retro-terminal/template.pptx").arrayBuffer(),
    )
    const chartTemplateXml = await Bun.file("public/assets/office-ppt-templates/chart-template.xml").text()
    const output = await fillPptxTemplate(
      templateBytes,
      artifact({
        slides: [
          {
            index: 1,
            title: "趋势",
            content: "| 指标 | Q1 | Q2 |\n| --- | --- | --- |\n| 华东 | 20 | 24 |\n| 华南 | 30 | 36 |",
            chartType: "line",
            chartOptions: {
              title: "季度趋势",
              xAxisTitle: "季度",
              yAxisTitle: "金额",
              showDataLabels: true,
              showLegend: true,
              legendPosition: "right",
              showGridlines: false,
              colors: ["E63312", "1954A6"],
            },
          },
          {
            index: 2,
            title: "占比",
            content: "| 分类 | 占比 |\n| --- | --- |\n| A | 60 |",
            chartType: "donut",
            chartOptions: { showPercent: true },
          },
          {
            index: 3,
            title: "面积",
            content: "| 指标 | Q1 |\n| --- | --- |\n| 华东 | 20 |",
            chartType: "area",
          },
          {
            index: 4,
            title: "雷达",
            content: "| 指标 | 评分 |\n| --- | --- |\n| 产品力 | 82 |",
            chartType: "radar",
          },
          {
            index: 5,
            title: "散点",
            content: "| 维度 | 指标 |\n| --- | --- |\n| 成本 | 30 |",
            chartType: "scatter",
          },
          {
            index: 6,
            title: "气泡",
            content: "| 维度 | 指标 |\n| --- | --- |\n| 增长 | 45 |",
            chartType: "bubble",
          },
        ],
      }),
      { chartTemplateXml },
    )
    const zip = await JSZip.loadAsync(output)
    const lineChart = await zip.file("ppt/charts/chart-auto-1.xml")?.async("string")
    const donutChart = await zip.file("ppt/charts/chart-auto-2.xml")?.async("string")
    const areaChart = await zip.file("ppt/charts/chart-auto-3.xml")?.async("string")
    const radarChart = await zip.file("ppt/charts/chart-auto-4.xml")?.async("string")
    const scatterChart = await zip.file("ppt/charts/chart-auto-5.xml")?.async("string")
    const bubbleChart = await zip.file("ppt/charts/chart-auto-6.xml")?.async("string")
    expect(lineChart).toContain("<c:lineChart>")
    expect(lineChart).toContain("<c:title>")
    expect(lineChart).toContain("季度趋势")
    expect(lineChart).toContain("季度")
    expect(lineChart).toContain("金额")
    expect(lineChart).toContain("20")
    expect(lineChart).toContain('<c:showVal val="1"/>')
    expect(lineChart).toContain('<c:showLegendKey val="1"/>')
    expect(lineChart).toContain("<c:legend>")
    expect(lineChart).toContain('<c:legendPos val="r"/>')
    expect(lineChart).toContain('<a:srgbClr val="E63312"/>')
    expect(lineChart).toContain('<a:srgbClr val="1954A6"/>')
    expect(lineChart).not.toContain("<c:majorGridlines>")
    expect(donutChart).toContain("<c:doughnutChart>")
    expect(donutChart).toContain("60")
    expect(donutChart).toContain('<c:showPercent val="1"/>')
    expect(donutChart).not.toContain("<c:catAx>")
    expect(areaChart).toContain("<c:areaChart>")
    expect(areaChart).toContain("20")
    expect(radarChart).toContain("<c:radarChart>")
    expect(radarChart).toContain('<c:radarStyle val="marker"/>')
    expect(radarChart).toContain("82")
    expect(scatterChart).toContain("<c:scatterChart>")
    expect(scatterChart).toContain("<c:xVal>")
    expect(scatterChart).toContain("<c:yVal>")
    expect(scatterChart).toContain("30")
    expect(bubbleChart).toContain("<c:bubbleChart>")
    expect(bubbleChart).toContain("<c:bubbleSize>")
    expect(bubbleChart).toContain("45")
  })

  test("exports native waterfall and combo chart types", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/retro-terminal/template.pptx").arrayBuffer(),
    )
    const chartTemplateXml = await Bun.file("public/assets/office-ppt-templates/chart-template.xml").text()
    const output = await fillPptxTemplate(
      templateBytes,
      artifact({
        slides: [
          {
            index: 1,
            title: "瀑布",
            content: "| 指标 | 金额 |\n| --- | --- |\n| 收入 | 120 |\n| 成本 | -30 |\n| 利润 | 90 |",
            chartType: "waterfall",
          },
          {
            index: 2,
            title: "组合",
            content: "| 月份 | 收入 | 成本 |\n| --- | --- | --- |\n| Q1 | 120 | 80 |\n| Q2 | 160 | 90 |",
            chartType: "combo",
          },
        ],
      }),
      { chartTemplateXml },
    )
    const zip = await JSZip.loadAsync(output)
    const waterfallChart = await zip.file("ppt/charts/chart-auto-1.xml")?.async("string")
    const comboChart = await zip.file("ppt/charts/chart-auto-2.xml")?.async("string")
    expect(waterfallChart).toContain("<c:waterfallChart>")
    expect(waterfallChart).toContain("<c:serLines>")
    expect(waterfallChart).toContain("利润")
    expect(waterfallChart).toContain("90")
    expect(comboChart).toContain("<c:barChart>")
    expect(comboChart).toContain("<c:lineChart>")
    expect(comboChart).toContain("收入")
    expect(comboChart).toContain("成本")
    expect(comboChart).toContain("160")
  })

  test("adds native object animations before the slide transition", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/swiss-grid/template.pptx").arrayBuffer(),
    )
    const output = await fillPptxTemplate(templateBytes, artifact())
    const zip = await JSZip.loadAsync(output)
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string")
    expect(slide1).toContain("<p:timing>")
    expect(slide1).toContain('<p:seq concurrent="1" nextAc="seek">')
    expect(slide1).toContain('<p:animEffect transition="in" filter="fade">')
    expect(slide1).toContain('nodeType="afterEffect"')
    expect(slide1?.indexOf("<p:transition")).toBeLessThan(slide1?.indexOf("<p:timing") ?? 0)
  })

  test("applies per-slide motion overrides to transitions and animations", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/swiss-grid/template.pptx").arrayBuffer(),
    )
    const output = await fillPptxTemplate(
      templateBytes,
      artifact({
        slides: [
          {
            index: 1,
            title: "项目目标",
            content: "- 背景\n- 目标",
            motion: {
              transition: { effect: "wipe", duration: 0.4 },
              animation: { effect: "wipe", duration: 0.8, stagger: 0.1 },
            },
          },
        ],
      }),
    )
    const zip = await JSZip.loadAsync(output)
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string")
    expect(slide1).toContain('<p:wipe dir="l"/>')
    expect(slide1).toContain('spd="fast"')
    expect(slide1).toContain('filter="wipe(down)"')
    expect(slide1).toContain('dur="800"')
  })

  test("extracts template object layout and applies object overrides on export", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/swiss-grid/template.pptx").arrayBuffer(),
    )
    const shapes = await officePptTemplateSlideShapes("presenton-swift", "cover", templateBytes)
    expect(shapes.length).toBeGreaterThan(0)
    const shape = shapes.find((item) => item.kind === "text") ?? shapes[0]
    const output = await fillPptxTemplate(
      templateBytes,
      artifact({
        slides: [
          {
            index: 1,
            title: "项目目标",
            content: "- 背景\n- 目标",
            shapeOverrides: [
              {
                id: shape.id,
                x: shape.x + 100000,
                y: shape.y + 50000,
                cx: shape.cx + 100000,
                cy: shape.cy,
              },
            ],
          },
        ],
      }),
    )
    const zip = await JSZip.loadAsync(output)
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string")
    expect(slide1).toContain(`x="${shape.x + 100000}"`)
    expect(slide1).toContain(`y="${shape.y + 50000}"`)
    expect(slide1).toContain(`cx="${shape.cx + 100000}"`)
  })

  test("maps object overrides to the same template source page as export", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/swiss-grid/template.pptx").arrayBuffer(),
    )
    const shapes = await officePptTemplateSlideShapes("presenton-swift", "overview", templateBytes, {
      pageIndex: 1,
      totalPages: 3,
    })
    expect(shapes.length).toBeGreaterThan(0)
    const shape = shapes[0]
    const output = await fillPptxTemplate(
      templateBytes,
      artifact({
        slides: [
          { index: 1, title: "封面", content: "- 项目汇报" },
          {
            index: 2,
            title: "推进计划",
            content: "- 节奏\n- 风险",
            shapeOverrides: [
              {
                id: shape.id,
                x: shape.x + 120000,
                y: shape.y + 60000,
                cx: shape.cx,
                cy: shape.cy,
              },
            ],
          },
          { index: 3, title: "下步动作", content: "- 确认资源" },
        ],
      }),
    )
    const zip = await JSZip.loadAsync(output)
    const slide2 = await zip.file("ppt/slides/slide2.xml")?.async("string")
    expect(slide2).toContain(`x="${shape.x + 120000}"`)
    expect(slide2).toContain(`y="${shape.y + 60000}"`)
  })

  test("applies object overrides to native template connectors", async () => {
    const templateBytes = createOfficeExportFile(
      artifact({
        slides: [
          { index: 1, title: "封面", content: "- 项目汇报", layout: "highlight" },
          { index: 2, title: "处理闭环", content: "- 提交\n- 审核\n- 生成\n- 发布", layout: "process" },
        ],
      }),
    ).bytes
    const output = await fillPptxTemplate(
      templateBytes,
      artifact({
        slides: [
          { index: 1, title: "封面", content: "- 项目汇报", layout: "highlight" },
          {
            index: 2,
            title: "处理闭环",
            content: "- 提交\n- 审核\n- 生成\n- 发布",
            layout: "process",
            shapeOverrides: [{ id: 34, x: 2000000 }],
          },
        ],
      }),
    )
    const zip = await JSZip.loadAsync(output)
    const slide2 = await zip.file("ppt/slides/slide2.xml")?.async("string")
    expect(slide2).toContain("<p:cxnSp>")
    expect(slide2).toContain('x="2000000"')
  })

  test("embeds per-slide narration audio as a hidden native media shape", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/swiss-grid/template.pptx").arrayBuffer(),
    )
    const output = await fillPptxTemplate(
      templateBytes,
      artifact({
        slides: [
          {
            index: 1,
            title: "封面",
            content: "- 项目汇报",
            audio: { mime: "audio/wav", dataBase64: wavBase64 },
          },
        ],
      }),
    )
    const zip = await JSZip.loadAsync(output)
    const media = await zip.file("ppt/media/narration-1.wav")?.async("uint8array")
    expect(media).toBeTruthy()
    expect(media?.length).toBeGreaterThan(0)
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string")
    expect(slide1).toContain("<a:audioFile")
    expect(slide1).toContain('presetClass="mediacall"')
    expect(slide1).toContain("<p:audio>")
    const rels1 = await zip.file("ppt/slides/_rels/slide1.xml.rels")?.async("string")
    expect(rels1).toContain("relationships/audio")
    const contentTypes = await zip.file("[Content_Types].xml")?.async("string")
    expect(contentTypes).toContain('Extension="wav"')
  })

  test("syncs object animations to narration cues and writes slide advance time", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/swiss-grid/template.pptx").arrayBuffer(),
    )
    const output = await fillPptxTemplate(
      templateBytes,
      artifact({
        slides: [
          {
            index: 1,
            title: "封面",
            content: "- 项目汇报",
            audio: {
              mime: "audio/wav",
              dataBase64: wavBase64,
              startFloor: 0.8,
              padding: 0.5,
              subtitles: [
                { startMs: 500, endMs: 1200, text: "开场先讲背景。" },
                { startMs: 1300, endMs: 2200, text: "再讲目标。" },
              ],
            },
          },
        ],
      }),
    )
    const zip = await JSZip.loadAsync(output)
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string")
    expect(slide1).toContain('delay="500"')
    expect(slide1).toContain("<p:advTm")
  })

  test("derives animation sidecar config from an uploaded real template", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/swiss-grid/template.pptx").arrayBuffer(),
    )
    const config = await derivePptxAnimationConfig(templateBytes)
    expect(config.version).toBe(1)
    expect(config.slides.cover?.groups.length).toBeGreaterThan(0)
    expect(config.slides.data?.groups.some((group) => group.selector === "chart")).toBe(true)
  })

  test("can disable object animations when exporting", async () => {
    const templateBytes = new Uint8Array(
      await Bun.file("public/assets/office-ppt-templates/pptx/swiss-grid/template.pptx").arrayBuffer(),
    )
    const output = await fillPptxTemplate(templateBytes, artifact(), { disableAnimations: true })
    const zip = await JSZip.loadAsync(output)
    const slide1 = await zip.file("ppt/slides/slide1.xml")?.async("string")
    expect(slide1).not.toContain("<p:timing>")
  })
})
