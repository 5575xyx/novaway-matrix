import { describe, expect, test } from "bun:test"
import { hasSyntaxLanguage, syntaxLanguageOf } from "../../src/office/text/language"

describe("语法语言识别", () => {
  test("按扩展名认语言，大小写不敏感", () => {
    expect(syntaxLanguageOf("src/a.ts")).toBe("typescript")
    expect(syntaxLanguageOf("src/a.TSX")).toBe("tsx")
    expect(syntaxLanguageOf("C:\work\README.MD")).toBe("markdown")
    expect(syntaxLanguageOf("data.jsonc")).toBe("jsonc")
    expect(syntaxLanguageOf("page.html")).toBe("html")
  })

  test("无扩展名的固定文件名也能认出来", () => {
    expect(syntaxLanguageOf("/repo/Dockerfile")).toBe("dockerfile")
    expect(syntaxLanguageOf("/repo/Makefile")).toBe("makefile")
    // Windows 路径的分隔符也要认。
    expect(syntaxLanguageOf("C:\\repo\\Dockerfile")).toBe("dockerfile")
  })

  test("认不出来就当纯文本，不瞎猜", () => {
    expect(syntaxLanguageOf("notes.txt")).toBeUndefined()
    expect(syntaxLanguageOf("LICENSE")).toBeUndefined()
    expect(syntaxLanguageOf(".env")).toBeUndefined()
    expect(syntaxLanguageOf("weird.unknownlang")).toBeUndefined()
    expect(syntaxLanguageOf(undefined)).toBeUndefined()
    expect(hasSyntaxLanguage("main.go")).toBe(true)
    expect(hasSyntaxLanguage("main.txt")).toBe(false)
  })
})
