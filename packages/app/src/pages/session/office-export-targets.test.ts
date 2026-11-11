import { describe, expect, test } from "bun:test"
import { officeExportTargets } from "./office-export-targets"

describe("office export targets", () => {
  test("offers the corresponding editable OOXML format for legacy office files", () => {
    expect(officeExportTargets("report.doc")).toContain("docx")
    expect(officeExportTargets("sheet.xls")).toContain("xlsx")
    expect(officeExportTargets("deck.ppt")).toContain("pptx")
    expect(officeExportTargets("text.rtf")).toContain("docx")
    expect(officeExportTargets("book.ods")).toContain("xlsx")
    expect(officeExportTargets("slides.odp")).toContain("pptx")
    expect(officeExportTargets("document.odt")).toContain("docx")
  })

  test("offers JSON from CSV and page export for PDFs", () => {
    expect(officeExportTargets("table.csv")).toContain("json")
    expect(officeExportTargets("scan.pdf")).toEqual(["png"])
  })

  test("returns no document export targets for unsupported paths", () => {
    expect(officeExportTargets(undefined)).toEqual([])
    expect(officeExportTargets("src/main.ts")).toEqual(["txt", "png"])
  })
})
