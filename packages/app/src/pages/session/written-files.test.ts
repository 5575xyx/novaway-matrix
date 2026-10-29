import { describe, expect, test } from "bun:test"
import type { Part } from "@novaway/sdk/v2"
import { collectTurnWrittenPaths } from "./written-files"

const WS = "E:/proj"
const tool = (name: string, state: unknown) => ({ type: "tool", tool: name, state }) as unknown as Part
const text = (value: string) => ({ type: "text", text: value }) as unknown as Part
const WIN_HTML = String.raw`E:\proj\a.html`
const WIN_MD = String.raw`E:\proj\a.md`

describe("collectTurnWrittenPaths", () => {
  test("write 工具的 filePath 原样保留绝对路径", () => {
    const parts = [tool("write", { status: "completed", input: { filePath: WIN_HTML } })]
    expect(collectTurnWrittenPaths(parts, WS)).toEqual([WIN_HTML])
  })

  test("相对路径按工作区解析", () => {
    const parts = [tool("write", { status: "completed", input: { filePath: ".claude/b.html" } })]
    expect(collectTurnWrittenPaths(parts, WS)).toEqual(["E:/proj/.claude/b.html"])
  })

  test("edit 结果里的 metadata.filediff.file 也算", () => {
    const parts = [
      tool("edit", {
        status: "completed",
        input: { filePath: WIN_MD },
        metadata: { filediff: { file: WIN_MD } },
      }),
    ]
    expect(collectTurnWrittenPaths(parts, WS)).toEqual([WIN_MD])
  })

  test("apply_patch 补丁头里的每个目标文件都算", () => {
    const parts = [
      tool("apply_patch", {
        status: "completed",
        input: {
          patchText: "*** Begin Patch\n*** Add File: x.html\n+1\n*** Update File: sub/y.md\n+2\n*** End Patch",
        },
      }),
    ]
    expect(collectTurnWrittenPaths(parts, WS)).toEqual(["E:/proj/x.html", "E:/proj/sub/y.md"])
  })

  test("notebook_edit 的 notebook_path 也算写过", () => {
    const parts = [tool("notebook_edit", { status: "completed", input: { notebook_path: "E:/proj/a.ipynb" } })]
    expect(collectTurnWrittenPaths(parts, WS)).toEqual(["E:/proj/a.ipynb"])
  })

  test("读取类工具与普通文本不产生写入证据", () => {
    const parts = [
      tool("read", { status: "completed", input: { filePath: WIN_HTML } }),
      tool("bash", { status: "completed", input: { command: "ls" }, output: "a.html" }),
      text("产物是 a.html"),
    ]
    expect(collectTurnWrittenPaths(parts, WS)).toEqual([])
  })

  test("重复路径去重", () => {
    const parts = [
      tool("write", { status: "completed", input: { filePath: WIN_HTML } }),
      tool("edit", { status: "completed", input: { filePath: WIN_HTML } }),
    ]
    expect(collectTurnWrittenPaths(parts, WS)).toHaveLength(1)
  })
})
