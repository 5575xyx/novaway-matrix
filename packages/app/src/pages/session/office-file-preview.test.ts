import { describe, expect, test } from "bun:test"
import {
  isImagePreviewPath,
  isOfficeBinaryPreviewPath,
  isOfficePreviewPath,
  isRichTextPath,
  OFFICE_DOCUMENT_EXTENSIONS,
  OFFICE_EXTENSIONS,
  officeDocumentCapability,
  isPluginOfficePath,
  pluginOfficeExtensions,
  pluginFilePreviewer,
} from "./office-preview-utils"

describe("office preview detection", () => {
  test("recognises the office formats the right panel can render", () => {
    expect(isOfficePreviewPath("docs/report.docx")).toBe(true)
    expect(isOfficePreviewPath("slides/deck.PPTX")).toBe(true)
    expect(isOfficePreviewPath("sheets/data.xlsx")).toBe(true)
    expect(isOfficePreviewPath("manual.pdf")).toBe(true)
  })

  test("recognises active Runtime Host Office extensions without changing binary Office routing", () => {
    const contributions = [{ kind: "office-engine", name: "foo", extensions: ["foo"] }]
    expect(pluginOfficeExtensions(contributions)).toEqual(["foo"])
    expect(isPluginOfficePath("notes/readme.foo", contributions)).toBe(true)
    expect(isOfficePreviewPath("notes/readme.foo")).toBe(false)
    expect(isPluginOfficePath("notes/readme.txt", contributions)).toBe(false)
  })

  test("selects active plugin previewers by file extension and priority", () => {
    const previewers = [
      {
        kind: "previewer",
        status: "active",
        pluginID: "novaway-ui",
        localName: "foo-preview",
        match: { extension: [".foo"] },
        viewId: "novaway.office.file",
        priority: 100,
        readOnly: false,
      },
      {
        kind: "previewer",
        status: "active",
        pluginID: "fallback",
        localName: "foo-preview-low",
        match: { extension: ["foo"] },
        viewId: "novaway.office.file",
        priority: 1,
      },
      {
        kind: "previewer",
        status: "disabled",
        pluginID: "disabled",
        localName: "foo-disabled",
        match: { extension: [".foo"] },
        viewId: "novaway.office.file",
        priority: 1000,
      },
    ]
    expect(pluginFilePreviewer("notes/readme.FOO", previewers)).toMatchObject({
      pluginID: "novaway-ui",
      localName: "foo-preview",
      viewId: "novaway.office.file",
      priority: 100,
      readOnly: false,
    })
    expect(pluginFilePreviewer("notes/readme.txt", previewers)).toBeUndefined()
    expect(
      pluginFilePreviewer("notes/readme.foo", [{ ...previewers[0]!, match: { extension: ".foo" } }]),
    ).toMatchObject({
      localName: "foo-preview",
    })
    expect(
      pluginFilePreviewer("notes/readme.foo", [{ ...previewers[0]!, match: { extension: [".txt"] } }]),
    ).toBeUndefined()
  })

  test("leaves source files on the normal text path", () => {
    expect(isOfficePreviewPath("src/index.ts")).toBe(false)
    expect(isOfficePreviewPath("README.md")).toBe(false)
    expect(isOfficePreviewPath(undefined)).toBe(false)
  })

  test("classifies every supported document extension", () => {
    expect(OFFICE_DOCUMENT_EXTENSIONS).toHaveLength(23)
    for (const extension of OFFICE_DOCUMENT_EXTENSIONS) {
      expect(officeDocumentCapability(`docs/example${extension}`)).toBeDefined()
      expect(isOfficePreviewPath(`docs/example${extension}`)).toBe(true)
      expect(isOfficeBinaryPreviewPath(`docs/example${extension}`)).toBe(extension !== ".csv")
    }
    expect(OFFICE_EXTENSIONS as readonly string[]).toContain(".pdf")
  })

  test("distinguishes editing support across document families", () => {
    expect(officeDocumentCapability("docs/report.DOCX")).toBe("native-edit")
    expect(officeDocumentCapability("docs/scan.pdf")).toBe("pdf-edit")
    expect(officeDocumentCapability("docs/report.odt")).toBe("converted-edit")
    expect(officeDocumentCapability("docs/report.rtf")).toBe("converted-edit")
    expect(officeDocumentCapability("docs/report.doc")).toBe("converted-edit")
    expect(officeDocumentCapability("data.csv")).toBe("native-edit")
    expect(officeDocumentCapability("src/main.ts")).toBeUndefined()
  })

  test("html uses the rich-text editor, not the base64 preview channel", () => {
    expect(isRichTextPath("notes/page.html")).toBe(true)
    expect(isRichTextPath("notes/page.HTM")).toBe(true)
    expect(isRichTextPath("notes/page.md")).toBe(false)
    expect(isOfficePreviewPath("notes/page.html")).toBe(false)
    expect(isImagePreviewPath("notes/page.html")).toBe(false)
  })
})
