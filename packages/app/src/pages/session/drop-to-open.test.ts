import { describe, expect, test } from "bun:test"
import { droppedPathsFromDataTransfer } from "./drop-to-open"

/** 最小 DataTransfer 替身：只实现 drop 解析用到的两个读方法 + files。 */
function fakeDataTransfer(input: {
  files?: Array<{ name: string; path?: string }>
  text?: Record<string, string>
}): DataTransfer {
  const data: Record<string, string> = {}
  const files = (input.files ?? []) as unknown as FileList
  return {
    files,
    getData: (format: string) => input.text?.[format] ?? "",
    setData: () => {},
    clearData: () => {},
    types: Object.keys(input.text ?? {}),
  } as unknown as DataTransfer
}

describe("droppedPathsFromDataTransfer", () => {
  test("系统拖入：File.path 绝对路径优先", () => {
    const dt = fakeDataTransfer({ files: [{ name: "a.txt", path: "C:\\repo\\a.txt" }] })
    expect(droppedPathsFromDataTransfer(dt)).toEqual(["C:\\repo\\a.txt"])
  })

  test("系统拖入：没有 .path 时回落到 name", () => {
    const dt = fakeDataTransfer({ files: [{ name: "b.txt" }] })
    expect(droppedPathsFromDataTransfer(dt)).toEqual(["b.txt"])
  })

  test("文件树拖入：text/plain 的 file: 前缀被去掉", () => {
    const dt = fakeDataTransfer({ text: { "text/plain": "file:src/a.ts" } })
    expect(droppedPathsFromDataTransfer(dt)).toEqual(["src/a.ts"])
  })

  test("文件树同时写 text/plain 与 uri-list：只取 text/plain，不重复", () => {
    const dt = fakeDataTransfer({
      text: {
        "text/plain": "file:src/a.ts",
        "text/uri-list": "file://src/a.ts",
      },
    })
    expect(droppedPathsFromDataTransfer(dt)).toEqual(["src/a.ts"])
  })

  test("只有 uri-list：解析相对路径 URL（含多行与注释行）", () => {
    const dt = fakeDataTransfer({
      text: {
        "text/uri-list": "# comment\r\nfile://docs/report.md\r\nfile://docs/plan.md",
      },
    })
    expect(droppedPathsFromDataTransfer(dt)).toEqual(["//docs/report.md", "//docs/plan.md"])
  })

  test("uri-list preserves encoded absolute POSIX and Windows file URLs", () => {
    const dt = fakeDataTransfer({
      text: {
        "text/uri-list": "file:///home/user/My%20Docs/report.md\r\nfile:///C:/Users/user/My%20Docs/report.md",
      },
    })
    expect(droppedPathsFromDataTransfer(dt)).toEqual([
      "/home/user/My%20Docs/report.md",
      "/C:/Users/user/My%20Docs/report.md",
    ])
  })

  test("uri-list preserves absolute Windows UNC file URLs", () => {
    const dt = fakeDataTransfer({
      text: { "text/uri-list": "file://server/share/My%20Docs/report.md" },
    })
    expect(droppedPathsFromDataTransfer(dt)).toEqual(["//server/share/My%20Docs/report.md"])
  })

  test("空/无数据：返回空数组", () => {
    expect(droppedPathsFromDataTransfer(null)).toEqual([])
    expect(droppedPathsFromDataTransfer(fakeDataTransfer({}))).toEqual([])
  })

  test("非 file:// 的 uri 被忽略", () => {
    const dt = fakeDataTransfer({ text: { "text/uri-list": "https://example.com/x" } })
    expect(droppedPathsFromDataTransfer(dt)).toEqual([])
  })
})
