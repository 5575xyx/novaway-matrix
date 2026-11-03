import { describe, expect, test } from "bun:test"
import { isGitPluginSpec, parsePluginSpecifier } from "../../src/plugin/shared"

describe("parsePluginSpecifier", () => {
  test("parses standard npm package without version", () => {
    expect(parsePluginSpecifier("acme")).toEqual({
      pkg: "acme",
      version: "latest",
    })
  })

  test("parses standard npm package with version", () => {
    expect(parsePluginSpecifier("acme@1.0.0")).toEqual({
      pkg: "acme",
      version: "1.0.0",
    })
  })

  test("parses scoped npm package without version", () => {
    expect(parsePluginSpecifier("@novaway/acme")).toEqual({
      pkg: "@novaway/acme",
      version: "latest",
    })
  })

  test("parses scoped npm package with version", () => {
    expect(parsePluginSpecifier("@novaway/acme@1.0.0")).toEqual({
      pkg: "@novaway/acme",
      version: "1.0.0",
    })
  })

  test("parses package with git+https url", () => {
    expect(parsePluginSpecifier("acme@git+https://github.com/novaway/acme.git")).toEqual({
      pkg: "acme",
      version: "git+https://github.com/novaway/acme.git",
    })
  })

  test("parses scoped package with git+https url", () => {
    expect(parsePluginSpecifier("@novaway/acme@git+https://github.com/novaway/acme.git")).toEqual({
      pkg: "@novaway/acme",
      version: "git+https://github.com/novaway/acme.git",
    })
  })

  test("parses package with git+ssh url containing another @", () => {
    expect(parsePluginSpecifier("acme@git+ssh://git@github.com/novaway/acme.git")).toEqual({
      pkg: "acme",
      version: "git+ssh://git@github.com/novaway/acme.git",
    })
  })

  test("parses scoped package with git+ssh url containing another @", () => {
    expect(parsePluginSpecifier("@novaway/acme@git+ssh://git@github.com/novaway/acme.git")).toEqual({
      pkg: "@novaway/acme",
      version: "git+ssh://git@github.com/novaway/acme.git",
    })
  })

  test("parses unaliased git+ssh url", () => {
    expect(parsePluginSpecifier("git+ssh://git@github.com/novaway/acme.git")).toEqual({
      pkg: "git+ssh://git@github.com/novaway/acme.git",
      version: "",
    })
  })

  test("parses npm alias using the alias name", () => {
    expect(parsePluginSpecifier("acme@npm:@novaway/acme@1.0.0")).toEqual({
      pkg: "acme",
      version: "npm:@novaway/acme@1.0.0",
    })
  })

  test("parses bare npm protocol specifier using the target package", () => {
    expect(parsePluginSpecifier("npm:@novaway/acme@1.0.0")).toEqual({
      pkg: "@novaway/acme",
      version: "1.0.0",
    })
  })

  test("parses unversioned npm protocol specifier", () => {
    expect(parsePluginSpecifier("npm:@novaway/acme")).toEqual({
      pkg: "@novaway/acme",
      version: "latest",
    })
  })
})

describe("isGitPluginSpec", () => {
  test("recognizes remote Git specs", () => {
    expect(isGitPluginSpec("acme@git+https://github.com/novaway/acme.git#main")).toBe(true)
    expect(isGitPluginSpec("acme@git+ssh://git@github.com/novaway/acme.git#v1")).toBe(true)
  })

  test("excludes local and non-Git specs", () => {
    expect(isGitPluginSpec("acme@git+file:../acme")).toBe(false)
    expect(isGitPluginSpec("file:../acme")).toBe(false)
    expect(isGitPluginSpec("acme@1.0.0")).toBe(false)
  })
})
