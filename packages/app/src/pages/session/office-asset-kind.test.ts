import { describe, expect, test } from "bun:test"
import { officeAssetKind, officeAssetKindLabel, officeAssetTarget } from "./office-asset-kind"

describe("office asset kind", () => {
  test("classifies common office assets", () => {
    expect(officeAssetKind("assets/cover.png")).toBe("image")
    expect(officeAssetKind("data/sales.csv")).toBe("data")
    expect(officeAssetKind("data/series.json")).toBe("data")
    expect(officeAssetKind("audio/narration.mp3")).toBe("audio")
    expect(officeAssetKind("docs/report.pptx")).toBe("document")
  })

  test("labels asset kinds in Chinese", () => {
    expect(officeAssetKindLabel("image")).toBe("图片")
    expect(officeAssetKindLabel("data")).toBe("数据")
    expect(officeAssetKindLabel("audio")).toBe("音频")
    expect(officeAssetKindLabel("document")).toBe("文档")
    expect(officeAssetKindLabel("other")).toBe("文件")
  })

  test("maps asset kinds to slide slots", () => {
    expect(officeAssetTarget("cover.png")).toBe("图片槽位")
    expect(officeAssetTarget("sales.csv")).toBe("图表/表格")
    expect(officeAssetTarget("narration.mp3")).toBe("旁白")
    expect(officeAssetTarget("background.md")).toBe("正文/表格")
  })
})
