import { expect, test } from "bun:test"
import {
  isExcludedPath,
  isHtmlPath,
  relativeToWorkspace,
  resolveWorkspacePath,
  shouldAutoOpenHtml,
} from "./preview-sources"

test("识别 HTML 扩展名，大小写不敏感", () => {
  expect(isHtmlPath("index.html")).toBe(true)
  expect(isHtmlPath("Index.HTML")).toBe(true)
  expect(isHtmlPath("C:/work/demo.htm")).toBe(true)
  expect(isHtmlPath("page.xhtml")).toBe(true)
  expect(isHtmlPath("page.html/")).toBe(true)
  expect(isHtmlPath("app.js")).toBe(false)
  expect(isHtmlPath("html")).toBe(false)
  expect(isHtmlPath(".html")).toBe(false)
  expect(isHtmlPath("")).toBe(false)
})

test("构建产物与依赖目录被排除", () => {
  expect(isExcludedPath("node_modules/lib/index.html")).toBe(true)
  expect(isExcludedPath("src/pages/node_modules/index.html")).toBe(true)
  expect(isExcludedPath(".git/hooks/index.html")).toBe(true)
  expect(isExcludedPath(".\\git\\hooks\\index.html")).toBe(true)
  expect(isExcludedPath("src/.git/index.html")).toBe(true)
  expect(isExcludedPath("src/./git/index.html")).toBe(true)
  expect(isExcludedPath("dist/index.html")).toBe(true)
  expect(isExcludedPath(".next/static/index.html")).toBe(true)
  expect(isExcludedPath("src/index.html")).toBe(false)
  expect(isExcludedPath("distribution/index.html")).toBe(false)
})

test("相对路径按工作区拼接，绝对路径原样保留", () => {
  expect(resolveWorkspacePath("src/index.html", "E:/work/demo")).toBe("E:/work/demo/src/index.html")
  expect(resolveWorkspacePath("src/index.html", "E:/work/demo/")).toBe("E:/work/demo/src/index.html")
  expect(resolveWorkspacePath("index.html", "E:\\work\\demo")).toBe("E:\\work\\demo/index.html")
  expect(resolveWorkspacePath("C:/abs/index.html", "E:/work/demo")).toBe("C:/abs/index.html")
  expect(resolveWorkspacePath("/Users/foo/index.html", "E:/work/demo")).toBe("/Users/foo/index.html")
  expect(resolveWorkspacePath("\\\\server\\share\\index.html", "E:/work/demo")).toBe("\\\\server\\share\\index.html")
  expect(resolveWorkspacePath("   src/a.html  ", "E:/work/demo")).toBe("E:/work/demo/src/a.html")
  expect(resolveWorkspacePath("  ", "E:/work/demo")).toBe("")
})

test("绝对路径转工作区相对路径", () => {
  expect(relativeToWorkspace("E:/work/demo/src/index.html", "E:/work/demo")).toBe("src/index.html")
  expect(relativeToWorkspace("E:\\work\\demo\\src\\index.html", "E:/work/demo")).toBe("src/index.html")
  expect(relativeToWorkspace("E:/work/demo/src/index.html", "E:\\work\\demo\\")).toBe("src/index.html")
  // 不在工作区内：原样返回，交给上层展示
  expect(relativeToWorkspace("C:/other/index.html", "E:/work/demo")).toBe("C:/other/index.html")
  expect(relativeToWorkspace("/Users/foo/x.html", "E:/work/demo")).toBe("/Users/foo/x.html")
})

test("综合判定：新增 HTML 自动打开，被排除的不动", () => {
  expect(shouldAutoOpenHtml("src/pages/index.html")).toBe(true)
  expect(shouldAutoOpenHtml("dist/index.html")).toBe(false)
  expect(shouldAutoOpenHtml("src/app.js")).toBe(false)
  expect(shouldAutoOpenHtml("node_modules/vue/dist/index.html")).toBe(false)
})
