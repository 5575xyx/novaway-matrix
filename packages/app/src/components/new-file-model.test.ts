import { describe, expect, test } from "bun:test"
import { NEW_FILE_FORMATS, formatGroups, withExtension } from "./new-file-model"

describe("新建文件", () => {
  test("没写扩展名时补上所选格式的后缀", () => {
    expect(withExtension("notes/today", "md")).toBe("notes/today.md")
    expect(withExtension("today", "html")).toBe("today.html")
  })

  test("用户写了扩展名就照用，不再叠加", () => {
    expect(withExtension("notes/today.txt", "md")).toBe("notes/today.txt")
    expect(withExtension("a/b.c/d", "md")).toBe("a/b.c/d.md")
  })

  test("Office 二进制单独分组，并且明确标成 binary", () => {
    const office = formatGroups().find((group) => group.id === "office")!
    expect(office.items.map((item) => item.extension)).toEqual(["docx", "xlsx", "pptx", "pdf"])
    for (const item of office.items) expect(item.binary).toBe(true)
    // 文本类不能走二进制写入器，否则会写出打不开的文件。
    for (const item of NEW_FILE_FORMATS.filter((entry) => entry.group !== "office")) {
      expect(item.binary).toBeUndefined()
    }
    // 每种扩展名唯一，格式化补后缀时才不会歧义。
    const extensions = NEW_FILE_FORMATS.map((item) => item.extension)
    expect(new Set(extensions).size).toBe(extensions.length)
  })

  test("分组覆盖全部格式", () => {
    const grouped = formatGroups().flatMap((group) => group.items)
    expect(grouped.length).toBe(NEW_FILE_FORMATS.length)
  })

  test("代码与数据覆盖新建面板列出的格式", () => {
    const code = formatGroups().find((group) => group.id === "code")!
    const extensions = code.items.map((item) => item.extension)
    for (const ext of ["json", "yaml", "toml", "xml", "sql", "sh", "py", "js", "ts", "css", "go", "rs"]) {
      expect(extensions).toContain(ext)
    }
  })
})
