import { describe, expect, test } from "bun:test"
import { detectSaveConflict } from "./save-conflict"

describe("detectSaveConflict 保存冲突检测", () => {
  test("磁盘未变：不冲突", () => {
    expect(detectSaveConflict("a\nb", "a\nb", "a\nb\nc")).toBe(false)
  })

  test("磁盘被外部改过且与草稿不同：冲突", () => {
    expect(detectSaveConflict("a\nb", "a\nb\n外部", "a\nb\nc")).toBe(true)
  })

  test("磁盘被改但草稿恰好等于磁盘新内容：不冲突（写盘幂等）", () => {
    expect(detectSaveConflict("a\nb", "a\nb\n外部", "a\nb\n外部")).toBe(false)
  })

  test("基线为空（磁盘还没读进来）：不冲突", () => {
    expect(detectSaveConflict("", "有内容", "草稿")).toBe(false)
  })

  test("读磁盘失败（null）：不冲突，保守放行", () => {
    expect(detectSaveConflict("a\nb", null, "a\nb\nc")).toBe(false)
  })
})
