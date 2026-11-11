import { describe, expect, test } from "bun:test"
import { dirPath, filePath } from "./markdown-file-path"

describe("filePath - 可点链接的判定", () => {
  test("带扩展名的路径才算文件", () => {
    expect(filePath("product_promo_20261101_134706.pptx")).toBe("product_promo_20261101_134706.pptx")
    expect(filePath("design_spec.md")).toBe("design_spec.md")
    expect(filePath("workflow.log")).toBe("workflow.log")
    expect(filePath("packages/ui/src/components/markdown.tsx")).toBe("packages/ui/src/components/markdown.tsx")
    expect(filePath("./notes/a.txt")).toBe("./notes/a.txt")
  })

  test("目录与分支名不当成文件", () => {
    expect(filePath("notes/")).toBeUndefined()
    expect(filePath("/e/AImoney/PowersNexus")).toBeUndefined()
    expect(filePath("gitee/main")).toBeUndefined()
  })

  test("网址、data: 和带行号的不是文件链接", () => {
    expect(filePath("https://example.com/a.md")).toBeUndefined()
    expect(filePath("data:text/plain,x")).toBeUndefined()
    expect(filePath("src/markdown.tsx:2604")).toBeUndefined()
  })

  test("空值与超长串直接拒", () => {
    expect(filePath("")).toBeUndefined()
    expect(filePath("   ")).toBeUndefined()
    expect(filePath("a/".repeat(200) + "x.md")).toBeUndefined()
  })
})

describe("dirPath - 只挂图标的目录判定", () => {
  test("以分隔符结尾的路径算目录", () => {
    expect(dirPath("notes/")).toBe("notes/")
    expect(dirPath("svg_output/")).toBe("svg_output/")
    expect(dirPath("backup/20261101_134706/")).toBe("backup/20261101_134706/")
    expect(dirPath(".novaway/office/")).toBe(".novaway/office/")
    expect(dirPath("E:\\AImoney\\PowersNexus\\")).toBe("E:\\AImoney\\PowersNexus\\")
    expect(dirPath("~/work/")).toBe("~/work/")
  })

  test("尾随标点不算进路径", () => {
    expect(dirPath("notes/,")).toBe("notes/")
    expect(dirPath("docs/;")).toBe("docs/")
  })

  test("文件、网址和裸词不当成目录", () => {
    expect(dirPath("README.md")).toBeUndefined()
    expect(dirPath("https://example.com/")).toBeUndefined()
    expect(dirPath("gitee/main")).toBeUndefined()
    expect(dirPath("and/or")).toBeUndefined()
    expect(dirPath("//")).toBeUndefined()
    expect(dirPath("")).toBeUndefined()
  })

  test("文件与目录两条判定互斥", () => {
    const samples = ["notes/", "a.md", "src/", "x/y.ts", "b/", "https://e.com/x/"]
    for (const sample of samples) {
      const asFile = filePath(sample) !== undefined
      const asDir = dirPath(sample) !== undefined
      expect(asFile && asDir, sample).toBe(false)
    }
  })
})
