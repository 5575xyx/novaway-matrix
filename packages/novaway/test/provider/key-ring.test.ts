import { describe, expect, test } from "bun:test"
import { nextKey, rotateAuthHeader } from "../../src/provider/provider"

describe("provider key ring", () => {
  test("cycles through keys in order and wraps around", () => {
    const ring = ["a", "b", "c"]
    const picked = Array.from({ length: 7 }, () => nextKey("ring-test-provider", ring))
    expect(picked).toEqual(["a", "b", "c", "a", "b", "c", "a"])
  })

  test("keeps its own cursor per provider", () => {
    nextKey("ring-test-a", ["a1", "a2"])
    expect(nextKey("ring-test-a", ["a1", "a2"])).toBe("a2")
    expect(nextKey("ring-test-b", ["b1", "b2"])).toBe("b1")
  })

  test("replaces bearer token while preserving other headers", () => {
    const headers = rotateAuthHeader({ authorization: "Bearer first", "x-custom": "1" }, "second")!
    expect(headers.get("authorization")).toBe("Bearer second")
    expect(headers.get("x-custom")).toBe("1")
  })

  test("replaces x-api-key style headers", () => {
    const headers = rotateAuthHeader({ "x-api-key": "first" }, "second")!
    expect(headers.get("x-api-key")).toBe("second")
    expect(headers.get("authorization")).toBeNull()
  })

  test("leaves requests without a known auth header alone", () => {
    expect(rotateAuthHeader(undefined, "only")).toBeUndefined()
    expect(rotateAuthHeader({ "content-type": "application/json" }, "only")).toBeUndefined()
  })
})
