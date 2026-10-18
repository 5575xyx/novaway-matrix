import { describe, expect, test } from "bun:test"
import { isOfficePreviewPath, OFFICE_EXTENSIONS } from "./office-file-preview"

describe("office preview detection", () => {
  test("recognises the office formats the right panel can render", () => {
    expect(isOfficePreviewPath("docs/report.docx")).toBe(true)
    expect(isOfficePreviewPath("slides/deck.PPTX")).toBe(true)
    expect(isOfficePreviewPath("sheets/data.xlsx")).toBe(true)
    expect(isOfficePreviewPath("manual.pdf")).toBe(true)
  })

  test("leaves source files on the normal text path", () => {
    expect(isOfficePreviewPath("src/index.ts")).toBe(false)
    expect(isOfficePreviewPath("README.md")).toBe(false)
    expect(isOfficePreviewPath(undefined)).toBe(false)
  })

  test("pdf is part of the supported extension list", () => {
    expect(OFFICE_EXTENSIONS as readonly string[]).toContain(".pdf")
  })
})
