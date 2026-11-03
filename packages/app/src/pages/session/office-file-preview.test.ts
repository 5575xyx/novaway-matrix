import { describe, expect, test } from "bun:test"
import { isImagePreviewPath, isOfficePreviewPath, isRichTextPath, OFFICE_EXTENSIONS } from "./office-preview-utils"

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

  test("html uses the rich-text editor, not the base64 preview channel", () => {
    expect(isRichTextPath("notes/page.html")).toBe(true)
    expect(isRichTextPath("notes/page.HTM")).toBe(true)
    expect(isRichTextPath("notes/page.md")).toBe(false)
    expect(isOfficePreviewPath("notes/page.html")).toBe(false)
    expect(isImagePreviewPath("notes/page.html")).toBe(false)
  })
})
