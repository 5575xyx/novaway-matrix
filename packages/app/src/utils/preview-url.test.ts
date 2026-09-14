import { expect, test } from "bun:test"
import { normalizePreviewUrl } from "./preview-url"

test("完整 http 地址被规范化", () => {
  expect(normalizePreviewUrl("localhost:3000")).toBe("http://localhost:3000/")
  expect(normalizePreviewUrl("http://127.0.0.1:5173")).toBe("http://127.0.0.1:5173/")
  expect(normalizePreviewUrl("https://example.com")).toBe("https://example.com/")
  expect(normalizePreviewUrl("http://localhost:3000/app")).toBe("http://localhost:3000/app")
})

test("裸路径被当作本地文件", () => {
  expect(normalizePreviewUrl("/C:/work/index.html")).toBe("file:///C:/work/index.html")
  expect(normalizePreviewUrl("C:/work/index.html")).toBe("file:///C:/work/index.html")
  expect(normalizePreviewUrl("/Users/foo/demo.html")).toBe("file:///Users/foo/demo.html")
})

test("本地路径统一按 Windows 风格重写", () => {
  // 预览只服务本机页面，因此不按平台分支
  expect(normalizePreviewUrl("C:\\work\\index.html")).toBe("file:///C:/work/index.html")
  expect(normalizePreviewUrl("/mnt/data/demo.html")).toBe("file:///mnt/data/demo.html")
})

test("空白与非法协议被拒绝", () => {
  expect(normalizePreviewUrl("")).toBeUndefined()
  expect(normalizePreviewUrl("   ")).toBeUndefined()
  expect(normalizePreviewUrl("   localhost:3000  ")).toBe("http://localhost:3000/")
  expect(normalizePreviewUrl("javascript:alert(1)")).toBeUndefined()
  expect(normalizePreviewUrl("ftp://example.com/file")).toBeUndefined()
})

test("畸形地址被拒绝", () => {
  expect(normalizePreviewUrl("://")).toBeUndefined()
  expect(normalizePreviewUrl("http://")).toBeUndefined()
  expect(normalizePreviewUrl("file:")).toBeUndefined()
  expect(normalizePreviewUrl("file:///")).toBeUndefined()
})
