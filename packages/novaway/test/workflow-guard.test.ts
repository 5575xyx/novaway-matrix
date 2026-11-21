import { describe, expect, test } from "bun:test"
import { checkTool } from "../src/workflow/guard"

describe("workflow phase tool guard", () => {
  test("blocks writes outside implementation", () => {
    expect(checkTool("grill-me", { id: "edit", workspace: true }).allowed).toBe(false)
    expect(checkTool("implementation", { id: "edit", workspace: true }).allowed).toBe(true)
    expect(checkTool("verification", { id: "task", workspace: true }, true).allowed).toBe(true)
    expect(checkTool("verification", { id: "edit", workspace: true }).allowed).toBe(false)
  })
})
