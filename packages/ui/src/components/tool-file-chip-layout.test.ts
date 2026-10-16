import { describe, expect, test } from "bun:test"
import { fileChipLabel, layoutToolFileChips, TOOL_FILE_CHIP_LIMIT } from "./tool-file-chip-layout"

describe("layoutToolFileChips", () => {
  test("lists everything when it fits", () => {
    const files = [{ path: "a.ts" }, { path: "b.ts" }]
    expect(layoutToolFileChips(files)).toEqual({ visible: files, overflow: 0 })
  })

  test("exactly at the limit still lists everything", () => {
    const files = Array.from({ length: TOOL_FILE_CHIP_LIMIT }, (_, i) => ({ path: `f${i}.ts` }))
    expect(layoutToolFileChips(files).overflow).toBe(0)
  })

  test("reserves a slot for the +N when overflowing", () => {
    const files = Array.from({ length: 6 }, (_, i) => ({ path: `f${i}.ts` }))
    const layout = layoutToolFileChips(files)
    expect(layout.visible).toHaveLength(TOOL_FILE_CHIP_LIMIT - 1)
    expect(layout.overflow).toBe(files.length - layout.visible.length)
  })

  test("never returns an empty list", () => {
    // limit 被调到 1 时也要显示一枚，否则整行只剩 "+N"，看不到任何文件名。
    const files = [{ path: "a.ts" }, { path: "b.ts" }]
    expect(layoutToolFileChips(files, 1).visible).toHaveLength(1)
  })
})

describe("fileChipLabel", () => {
  test("takes the last segment for both separators", () => {
    expect(fileChipLabel("src/components/a.tsx")).toBe("a.tsx")
    expect(fileChipLabel(["src", "components", "a.tsx"].join(String.fromCharCode(92)))).toBe("a.tsx")
    expect(fileChipLabel("a.tsx")).toBe("a.tsx")
  })

  test("falls back to the raw path when it is only separators", () => {
    expect(fileChipLabel("/")).toBe("/")
  })
})
