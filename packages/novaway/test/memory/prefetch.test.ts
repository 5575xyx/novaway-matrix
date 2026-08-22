import { describe, expect, test } from "bun:test"
import { buildPrefetchText, shouldPrefetch } from "../../src/memory/prefetch"

describe("shouldPrefetch export smoke", () => {
  test("gates short talk", () => {
    expect(shouldPrefetch("ok")).toBe(false)
    expect(shouldPrefetch("帮我看看登录模块怎么拆")).toBe(true)
    expect(buildPrefetchText("hi", [])).toBe("")
  })
})
