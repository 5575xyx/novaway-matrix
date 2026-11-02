import { describe, expect, test } from "bun:test"
import { buildCaptureScript } from "./profile-capture"

describe("buildCaptureScript", () => {
  // 脚本是字符串，tsc 管不到里面的语法；这里至少保证它能被解析成合法表达式，
  // 免得改选择器时多一个引号，线上表现为「永远抓不到资料」。
  test("生成可解析的表达式", () => {
    const code = buildCaptureScript({ nicknameSelectors: [".nick"], avatarSelectors: ["img.avatar"] })
    expect(() => new Function(`return ${code}`)).not.toThrow()
  })

  test("不带 hints 也能用", () => {
    const code = buildCaptureScript({})
    expect(() => new Function(`return ${code}`)).not.toThrow()
    expect(code).toContain("document.querySelector")
  })

  test("选择器原样内联", () => {
    const code = buildCaptureScript({ nicknameSelectors: [".user-name"], avatarSelectors: [".avatar img"] })
    expect(code).toContain('".user-name"')
    expect(code).toContain('".avatar img"')
  })
})
