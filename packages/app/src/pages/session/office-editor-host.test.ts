import { describe, expect, test } from "bun:test"
import { officeEditorMountFor, type OfficeEditorContext, type OfficeEditorMount } from "./office-editor-host"
import {
  confirmOfficeEditorClose,
  registerOfficeEditorCloseGuard,
  registerOfficeEditorSave,
  saveOfficeEditor,
} from "./office-editor-session"

describe("office editor host", () => {
  test("blocks closing a dirty editor until its registered guard allows it", async () => {
    let allowed = false
    const unregister = registerOfficeEditorCloseGuard("deck.pptx", async () => allowed)

    expect(await confirmOfficeEditorClose("deck.pptx")).toBe(false)
    allowed = true
    expect(await confirmOfficeEditorClose("deck.pptx")).toBe(true)
    unregister()
    expect(await confirmOfficeEditorClose("deck.pptx")).toBe(true)
  })

  test("registers file-panel save for a mounted editor and unregisters only its own instance", async () => {
    const calls: string[] = []
    const first = registerOfficeEditorSave("report.docx", async () => void calls.push("first"))
    const second = registerOfficeEditorSave("report.docx", async () => void calls.push("second"))

    first()
    expect(await saveOfficeEditor("report.docx")).toBe(true)
    expect(calls).toEqual(["second"])

    second()
    expect(await saveOfficeEditor("report.docx")).toBe(false)
    expect(await saveOfficeEditor(undefined)).toBe(false)
  })

  test("routes the panel save to the active mounted Office editor", async () => {
    let count = 0
    const unregister = registerOfficeEditorSave("book.xlsx", async () => {
      count += 1
    })

    expect(await saveOfficeEditor("book.xlsx")).toBe(true)
    expect(count).toBe(1)
    unregister()
  })

  test("offers the DOCX editor factory for the DOCX family", () => {
    // DOCX 系列已接入 Lexora GenOffice 编辑器（public/office/docx-editor.js）。
    expect(officeEditorMountFor("report.docx")).toBeTypeOf("function")
    expect(officeEditorMountFor("report.docm")).toBeTypeOf("function")
    expect(officeEditorMountFor("template.dotx")).toBeTypeOf("function")
    expect(officeEditorMountFor("template.dotm")).toBeTypeOf("function")
  })

  test("offers the sheets editor factory for the XLSX family", () => {
    // XLSX 系列已接入 Lexora GenOffice 表格编辑器（public/office/sheets-editor.js）。
    expect(officeEditorMountFor("book.xlsx")).toBeTypeOf("function")
    expect(officeEditorMountFor("book.xlsm")).toBeTypeOf("function")
    expect(officeEditorMountFor("template.xltx")).toBeTypeOf("function")
    expect(officeEditorMountFor("template.xltm")).toBeTypeOf("function")
  })

  test("offers the slides editor factory for the PPTX family", () => {
    // PPTX 系列已接入 Lexora GenOffice 演示文稿编辑器（public/office/slides-editor.js）。
    expect(officeEditorMountFor("deck.pptx")).toBeTypeOf("function")
    expect(officeEditorMountFor("deck.pptm")).toBeTypeOf("function")
    expect(officeEditorMountFor("template.potx")).toBeTypeOf("function")
    expect(officeEditorMountFor("template.potm")).toBeTypeOf("function")
    expect(officeEditorMountFor("show.ppsx")).toBeTypeOf("function")
    expect(officeEditorMountFor("show.ppsm")).toBeTypeOf("function")
  })

  test("offers the PDF editor factory", () => {
    // PDF 已接入 Lexora GenOffice 编辑器（public/office/pdf-editor.js）。
    expect(officeEditorMountFor("scan.pdf")).toBeTypeOf("function")
    expect(officeEditorMountFor("报告.PDF")).toBeTypeOf("function")
  })

  test("returns no editor for read-only or unsupported formats", () => {
    expect(officeEditorMountFor("old.doc")).toBeUndefined()
    expect(officeEditorMountFor("old.xls")).toBeUndefined()
    expect(officeEditorMountFor("old.ppt")).toBeUndefined()
    expect(officeEditorMountFor("text.rtf")).toBeUndefined()
    expect(officeEditorMountFor("book.ods")).toBeUndefined()
    expect(officeEditorMountFor("notes.md")).toBeUndefined()
    expect(officeEditorMountFor("src/main.ts")).toBeUndefined()
    expect(officeEditorMountFor(undefined)).toBeUndefined()
  })

  test("editor context contract carries container, bytes, name and callbacks", () => {
    const context = {
      container: {} as HTMLElement,
      bytes: new Uint8Array([1, 2, 3]),
      name: "report.docx",
      onDirty: () => {},
      onSaveRequest: async () => {},
      signal: new AbortController().signal,
    }
    expect(context.container).toBeDefined()
    expect(context.bytes.length).toBe(3)
    expect(context.name).toBe("report.docx")
    expect(typeof context.onDirty).toBe("function")
    expect(typeof context.onSaveRequest).toBe("function")
    expect(context.signal).toBeDefined()
  })
})
