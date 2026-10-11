import { describe, expect, test } from "bun:test"
import { isDefaultSessionTitle } from "./session-title"

describe("isDefaultSessionTitle", () => {
  test("matches the generated default titles", () => {
    expect(isDefaultSessionTitle("New session - 2026-09-16T06:15:21.718Z")).toBe(true)
    expect(isDefaultSessionTitle("Child session - 2026-09-16T06:15:21.718Z")).toBe(true)
  })

  test("rejects user-authored titles and missing input", () => {
    expect(isDefaultSessionTitle("重构支付回调逻辑")).toBe(false)
    expect(isDefaultSessionTitle(undefined)).toBe(false)
  })
})
