import { describe, expect, test } from "bun:test"
import { sessionAutoSubmitKey } from "./auto-submit"

describe("session auto submit", () => {
  test("creates a stable key when navigation requests immediate submission", () => {
    expect(sessionAutoSubmitKey("生成产品发布会演示", "1", 100)).toBe(
      sessionAutoSubmitKey("生成产品发布会演示", "1", 100),
    )
  })

  test("does not require a non-office mode to enable submission", () => {
    expect(sessionAutoSubmitKey("生成产品发布会演示", "1", 100)).toEndWith("-100")
    expect(sessionAutoSubmitKey("生成产品发布会演示", undefined, 100)).toBeUndefined()
  })
})
