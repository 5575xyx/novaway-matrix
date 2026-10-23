import { describe, expect, test } from "bun:test"
import { samePackage, specifierOf, validSpec } from "@/tool/plugin-install"

describe("plugin_install spec handling", () => {
  test("reads the specifier from plain and tuple specs", () => {
    expect(specifierOf("my-plugin")).toBe("my-plugin")
    expect(specifierOf(["my-plugin@1.0.0", { a: 1 }] as never)).toBe("my-plugin@1.0.0")
  })

  test("matches packages while ignoring versions", () => {
    expect(samePackage("foo@1.0.0", "foo@2.0.0")).toBe(true)
    expect(samePackage(["foo", {}] as never, "foo@2")).toBe(true)
    expect(samePackage("foo", "bar")).toBe(false)
  })

  test("keeps scoped package names intact when comparing", () => {
    expect(samePackage("@scope/plugin@1.0.0", "@scope/plugin@2.0.0")).toBe(true)
    expect(samePackage("@scope/plugin", "@scope/other")).toBe(false)
    expect(samePackage("@scope/plugin", "plugin")).toBe(false)
  })

  test("accepts npm names, paths and git urls", () => {
    expect(validSpec("my-plugin")).toBeUndefined()
    expect(validSpec("@scope/plugin@1.2.3")).toBeUndefined()
    expect(validSpec("./local/plugin.ts")).toBeUndefined()
    expect(validSpec("C:\\plugins\\mine.ts")).toBeUndefined()
    expect(validSpec("https://github.com/x/y.git")).toBeUndefined()
    expect(validSpec("git@github.com:x/y.git")).toBeUndefined()
  })

  test("rejects empty or malformed specs", () => {
    expect(validSpec("   ")).toBe("spec 不能为空")
    expect(validSpec("my plugin")).toBe("spec 里不能有空格")
    expect(validSpec("bad!name")).toContain("不是合法")
  })
})
