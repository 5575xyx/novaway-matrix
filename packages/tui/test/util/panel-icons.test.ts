import { describe, expect, test } from "bun:test"
import { fileIcon, treeArrow, setIconStyle, currentIconStyle, ICON_STYLES } from "../../src/util/panel-icons"

describe("util.panel-icons", () => {
  test("nerdfont file tree covers folders, extensions and special filenames", () => {
    setIconStyle("nerdfont")
    // 目录:展开/折叠用两个不同字形
    expect(fileIcon("src", true, false)).toBe("")
    expect(fileIcon("src", true, true)).toBe("")
    // 扩展名归并:tsx 走 ts,scss 走 css,jpeg 走 image 组
    expect(fileIcon("app.tsx", false)).toBe(fileIcon("app.ts", false))
    expect(fileIcon("theme.scss", false)).toBe(fileIcon("theme.css", false))
    expect(fileIcon("logo.jpeg", false)).toBe(fileIcon("logo.png", false))
    // 整个文件名优先于扩展名:package.json 是 npm,不是普通 json
    expect(fileIcon("package.json", false)).toBe("")
    expect(fileIcon("package.json", false)).not.toBe(fileIcon("data.json", false))
    // 无扩展名也能认出来
    expect(fileIcon("Makefile", false)).toBe("")
    expect(fileIcon("Dockerfile", false)).toBe("")
    // 认不出的回落 default
    expect(fileIcon("mystery.qqq", false)).toBe("")
  })

  test("every style resolves to a non-empty glyph for any file", () => {
    for (const style of ICON_STYLES) {
      setIconStyle(style)
      expect(currentIconStyle()).toBe(style)
      for (const name of ["a.ts", "b.unknown", "Makefile", "dir"]) {
        expect(fileIcon(name, false).length).toBeGreaterThan(0)
      }
      expect(fileIcon("dir", true, true).length).toBeGreaterThan(0)
      expect(treeArrow(true)).not.toBe(treeArrow(false))
    }
    setIconStyle("nerdfont")
  })
})
