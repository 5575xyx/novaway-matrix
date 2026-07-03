import { describe, expect, test } from "bun:test"
import {
  fillOfficePptxTemplate,
  officePptxFillPlanFromArtifact,
  officePptxFillPlanSummary,
  officePptxTemplateFillFilename,
  type OfficePptxTemplateFillClient,
} from "./office-template-fill"

describe("fillOfficePptxTemplate", () => {
  test("sends pptx template fill payload through the office sdk", async () => {
    let payload: Parameters<OfficePptxTemplateFillClient["office"]["pptxTemplate"]["fill"]>[0] | undefined
    const client: OfficePptxTemplateFillClient = {
      office: {
        pptxTemplate: {
          fill: async (parameters) => {
            payload = parameters
            return { data: { path: ".novaway/office/ppt/filled.pptx", bytes: 12 } }
          },
        },
      },
    }

    const result = await fillOfficePptxTemplate({
      client,
      directory: "E:/workspace",
      filename: "filled.pptx",
      templateBytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      slides: [{ slide: 1, texts: ["标题", "副标题"] }],
    })

    expect(result.data?.path).toBe(".novaway/office/ppt/filled.pptx")
    expect(payload).toEqual({
      directory: "E:/workspace",
      filename: "filled.pptx",
      templateBase64: "UEsDBA==",
      slides: [{ slide: 1, texts: ["标题", "副标题"] }],
    })
  })

  test("builds text fill plan from slide artifact", () => {
    expect(
      officePptxFillPlanFromArtifact({
        title: "Sales Plan",
        filename: "sales.md",
        body: "",
        memory: "",
        slides: [
          {
            index: 1,
            title: "Cover",
            content: "- Q1 growth\n- Key accounts",
          },
          {
            index: 2,
            title: "Next Steps",
            content: "Owner: PM\nTimeline: 30 days",
          },
        ],
      }),
    ).toEqual([
      { slide: 1, texts: ["Cover", "Q1 growth", "Key accounts"], images: [], tables: [], charts: [] },
      { slide: 2, texts: ["Next Steps", "Owner: PM", "Timeline: 30 days"], images: [], tables: [], charts: [] },
    ])
  })

  test("includes slide data url images in pptx fill plan", () => {
    expect(
      officePptxFillPlanFromArtifact({
        title: "Image Plan",
        filename: "image.md",
        body: "",
        memory: "",
        slides: [
          {
            index: 1,
            title: "Visual",
            content: "![chart](data:image/png;base64,QUJD)",
            visual: '<img src="data:image/jpeg;base64,REVG" />',
          },
        ],
      })[0]?.images,
    ).toEqual([
      { mime: "image/jpeg", dataBase64: "REVG" },
      { mime: "image/png", dataBase64: "QUJD" },
    ])
  })

  test("includes markdown tables in pptx fill plan", () => {
    expect(
      officePptxFillPlanFromArtifact({
        title: "Table Plan",
        filename: "table.md",
        body: "",
        memory: "",
        slides: [
          {
            index: 1,
            title: "Metrics",
            content: "| Metric | Value |\n| --- | --- |\n| Revenue | 120 |\n| Growth | 30% |",
          },
        ],
      })[0]?.tables,
    ).toEqual([[["Metric", "Value"], ["Revenue", "120"], ["Growth", "30%"]]])
  })

  test("derives chart data from numeric markdown tables", () => {
    expect(
      officePptxFillPlanFromArtifact({
        title: "Chart Plan",
        filename: "chart.md",
        body: "",
        memory: "",
        slides: [
          {
            index: 1,
            title: "Metrics",
            content: "| Month | Revenue | Cost |\n| --- | --- | --- |\n| Jan | 120 | 80 |\n| Feb | 160 | 90 |",
          },
        ],
      })[0]?.charts,
    ).toEqual([
      {
        categories: ["Jan", "Feb"],
        series: [
          { name: "Revenue", values: [120, 160] },
          { name: "Cost", values: [80, 90] },
        ],
      },
    ])
  })

  test("creates safe pptx template fill filename", () => {
    expect(
      officePptxTemplateFillFilename({
        title: "A/B: Plan*2026",
        filename: "plan.md",
        body: "",
        memory: "",
        slides: [],
      }),
    ).toBe("A-B- Plan-2026-套版.pptx")
  })

  test("summarizes pptx fill plan content", () => {
    expect(
      officePptxFillPlanSummary([
        {
          slide: 1,
          texts: ["Title", "Body"],
          images: [{ mime: "image/png", dataBase64: "AAA" }],
          tables: [[["A", "B"]]],
          charts: [{ categories: ["Jan"], series: [{ name: "Revenue", values: [1] }] }],
        },
      ]),
    ).toBe("已带入 2 段文本、1 张图片、1 个表格、1 个图表")
  })
})
