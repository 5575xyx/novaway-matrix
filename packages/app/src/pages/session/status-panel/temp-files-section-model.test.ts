import { describe, expect, test } from "bun:test"
import { buildTempFilesModel, cleanSummary, formatBytes } from "./temp-files-section-model"
import type { SessionTempFile } from "@novaway/sdk/v2"

const file = (over: Partial<SessionTempFile> = {}): SessionTempFile => ({
  path: "/repo/tmp-a.mjs",
  relative: "tmp-a.mjs",
  tool: "write",
  createdAt: 1,
  size: 2048,
  ...over,
})

describe("temp files section model", () => {
  test("null when there are no files", () => {
    expect(buildTempFilesModel(undefined)).toBeNull()
    expect(buildTempFilesModel([])).toBeNull()
  })

  test("counts files and total size, newest first", () => {
    const model = buildTempFilesModel([
      file({ relative: "a", createdAt: 1 }),
      file({ relative: "b", createdAt: 5, size: 1024 }),
    ])
    expect(model?.count).toBe(2)
    expect(model?.size).toBe(3072)
    expect(model?.files[0].relative).toBe("b")
  })

  test("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(2048)).toBe("2.0 KB")
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB")
  })

  test("groups skip reasons", () => {
    expect(
      cleanSummary({
        removed: ["a", "b"],
        skipped: [{ reason: "modified" }, { reason: "modified" }, { reason: "not-temporary" }],
      }),
    ).toEqual({
      removed: 2,
      skipped: 3,
      reasons: [
        ["modified", 2],
        ["not-temporary", 1],
      ],
    })
  })
})
