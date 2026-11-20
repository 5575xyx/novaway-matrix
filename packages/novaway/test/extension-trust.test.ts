import { describe, expect, test } from "bun:test"
import { assess } from "../src/extension/trust"

describe("extension trust policy", () => {
  test("allows hashed official artifacts and flags high-risk confirmation", () => {
    const result = assess({ url: "https://gitee.com/NovaWay-AI/a.zip", sourceId: "com.novaway.powersnexus", sha256: "a".repeat(64), permissions: ["workspace"] })
    expect(result.level).toBe("official")
    expect(result.allowed).toBe(true)
    expect(result.requiresConfirmation).toBe(true)
  })
  test("blocks unverifiable third-party artifacts", () => {
    const result = assess({ url: "https://example.com/a.zip" })
    expect(result.level).toBe("untrusted")
    expect(result.allowed).toBe(false)
  })
})
