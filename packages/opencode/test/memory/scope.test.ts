import { describe, expect, test } from "bun:test"
import { classifyMemoryScope, resolveMemoryScope, scopeLabel } from "../../src/memory/scope"

describe("memory scope classification", () => {
  test("preferences default to global", () => {
    expect(classifyMemoryScope("I prefer concise Chinese answers", true)).toBe("global")
    expect(classifyMemoryScope("I prefer concise answers", true)).toBe("global")
  })

  test("project conventions default to project", () => {
    expect(classifyMemoryScope("this project uses Bun monorepo", true)).toBe("project")
    expect(classifyMemoryScope("repo directory convention is packages/*", true)).toBe("project")
  })

  test("explicit global/project/session keywords win", () => {
    expect(classifyMemoryScope("remember globally across projects: dark theme", true)).toBe("global")
    expect(classifyMemoryScope("only this project uses pnpm", true)).toBe("project")
    expect(classifyMemoryScope("only this session use mock data", true)).toBe("session")
  })

  test("general facts default to global for all-purpose agent", () => {
    expect(classifyMemoryScope("next meeting notes should start with conclusion", true)).toBe("global")
    expect(classifyMemoryScope("my name is Alex", true)).toBe("global")
  })

  test("explicit scope override wins", () => {
    expect(resolveMemoryScope({ projectID: "p1", content: "prefer Chinese", scope: "project" })).toBe("project")
    expect(resolveMemoryScope({ projectID: "p1", content: "use monorepo", scope: "global" })).toBe("global")
  })

  test("scopeLabel", () => {
    expect(scopeLabel("global")).toBe("\u5168\u5c40")
    expect(scopeLabel("project")).toBe("\u672c\u9879\u76ee")
  })
})
