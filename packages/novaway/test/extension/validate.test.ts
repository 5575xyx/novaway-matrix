import { describe, expect, test } from "bun:test"
import { checkDependencies, checkEngine, parseVersion, satisfies } from "../../src/extension/validate"
import type { Loaded } from "../../src/extension/schema"

describe("extension validate", () => {
  test("parses versions", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 })
    expect(parseVersion("v0.10.2-beta.1")).toEqual({ major: 0, minor: 10, patch: 2 })
    expect(parseVersion("abc")).toBeUndefined()
  })

  test("satisfies common ranges", () => {
    expect(satisfies("1.5.0", ">=1.2.0")).toBe(true)
    expect(satisfies("1.1.0", ">=1.2.0")).toBe(false)
    expect(satisfies("1.9.9", "^1.2.0")).toBe(true)
    expect(satisfies("2.0.0", "^1.2.0")).toBe(false)
    expect(satisfies("0.2.9", "^0.2.3")).toBe(true)
    expect(satisfies("0.3.0", "^0.2.3")).toBe(false)
    expect(satisfies("1.2.9", "~1.2.3")).toBe(true)
    expect(satisfies("1.3.0", "~1.2.3")).toBe(false)
    expect(satisfies("1.2.3", "*")).toBe(true)
    expect(satisfies("1.2.3", "banana")).toBeUndefined()
  })

  test("reports engine mismatches", () => {
    expect(checkEngine(undefined, "1.0.0")).toBeUndefined()
    expect(checkEngine(">=1.0.0", "1.15.4")).toBeUndefined()
    expect(checkEngine(">=2.0.0", "1.15.4")?.severity).toBe("error")
    expect(checkEngine("nonsense", "1.15.4")?.severity).toBe("warning")
  })

  test("flags missing and disabled dependencies", () => {
    const manifest = { name: "app", dependencies: { base: "^1.0.0", missing: "*" } }
    const all = [
      { name: "base", manifest: { name: "base", version: "0.9.0" }, enabled: true },
      { name: "other", manifest: { name: "other" }, enabled: false },
    ] as unknown as Loaded[]
    const issues = checkDependencies(manifest as any, all)
    expect(issues.some((issue) => issue.code === "dependency-missing")).toBe(true)
    expect(issues.some((issue) => issue.code === "dependency-version")).toBe(true)
  })

  test("warns when a dependency is disabled", () => {
    const manifest = { name: "app", dependencies: { base: "*" } }
    const all = [{ name: "base", manifest: { name: "base", version: "1.0.0" }, enabled: false }] as unknown as Loaded[]
    const issues = checkDependencies(manifest as any, all)
    expect(issues.map((issue) => issue.code)).toContain("dependency-disabled")
  })
})
