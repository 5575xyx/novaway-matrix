import { describe, expect, it } from "bun:test"
import { applyPatch, reversePatch } from "diff"
import { parsePatchPreservingCarriageReturns } from "./patch-utils"

describe("parsePatchPreservingCarriageReturns", () => {
  it("parses and reverses patches with carriage returns embedded in hunk lines", () => {
    const before = "keep\nsame\rdiff --git inside\ndelete\n"
    const after = "keep\nadd\nsame\rdiff --git inside\n"
    const patch = [
      "diff --git a/file.txt b/file.txt",
      "index 0000000..1111111 100644",
      "--- a/file.txt",
      "+++ b/file.txt",
      "@@ -1,3 +1,3 @@",
      " keep",
      "-same\rdiff --git inside",
      "+add",
      "+same\rdiff --git inside",
      "-delete",
      "",
    ].join("\n")

    const parsed = parsePatchPreservingCarriageReturns(patch)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.hunks[0]?.lines).toContain("-same\rdiff --git inside")
    expect(applyPatch(after, reversePatch(parsed[0]!))).toBe(before)
  })
})
