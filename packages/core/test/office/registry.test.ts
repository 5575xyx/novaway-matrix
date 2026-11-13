import { describe, expect, test } from "bun:test"
import {
  defaultExtension,
  engineFor,
  kindOfPath,
  officeFormatOf,
  registerOfficeEngine,
} from "../../src/office/engine/registry"

describe("格式识别", () => {
  test("带宏 / 模板的 OOXML 变体映射到同一个引擎", () => {
    expect(officeFormatOf("report.docm")).toBe("docx")
    expect(officeFormatOf("report.dotx")).toBe("docx")
    expect(officeFormatOf("budget.xlsm")).toBe("xlsx")
    expect(officeFormatOf("deck.pptm")).toBe("pptx")
    expect(officeFormatOf("deck.ppsx")).toBe("pptx")
    // 大小写不敏感（Windows 上文件名的常见形态）。
    expect(officeFormatOf("DECK.PPTM")).toBe("pptx")
  })

  test("同一个格式拿到的是同一个引擎", () => {
    expect(engineFor(officeFormatOf("a.docm")!)).toBe(engineFor("docx"))
    expect(engineFor(officeFormatOf("a.xlsm")!)).toBe(engineFor("xlsx"))
    expect(engineFor(officeFormatOf("a.pptm")!)).toBe(engineFor("pptx"))
  })

  test("插件注册的新格式参与识别、引擎选择并可释放", () => {
    const engine = {} as never
    const registration = registerOfficeEngine({ format: "foo", kind: "document", extensions: [".foo"], engine })
    expect(officeFormatOf("note.foo")).toBe("foo")
    expect(kindOfPath("note.foo")).toBe("document")
    expect(engineFor("foo")).toBe(engine)
    registration.dispose()
    expect(officeFormatOf("note.foo")).toBe("text")
    expect(engineFor("foo")).toBeUndefined()
  })

  test("pdf 走页面级编辑引擎", () => {
    expect(officeFormatOf("paper.pdf")).toBe("pdf")
    expect(engineFor("pdf")).toBeDefined()
  })

  test("旧格式先按种类归类（还没有引擎，但不能被当成纯文本）", () => {
    expect(kindOfPath("old.doc")).toBe("document")
    expect(kindOfPath("old.rtf")).toBe("document")
    expect(kindOfPath("old.ods")).toBe("spreadsheet")
    expect(kindOfPath("old.ppt")).toBe("presentation")
    expect(defaultExtension("document")).toBe("docx")
  })
})
