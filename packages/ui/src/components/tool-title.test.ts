import { describe, expect, test } from "bun:test"
import { toolAction, toolActionKey } from "./tool-title"

describe("toolAction", () => {
  test("maps known tools to action categories", () => {
    expect(toolAction("read")).toBe("read")
    expect(toolAction("glob")).toBe("search")
    expect(toolAction("grep")).toBe("search")
    expect(toolAction("write")).toBe("write")
    expect(toolAction("edit")).toBe("edit")
    expect(toolAction("apply_patch")).toBe("patch")
    expect(toolAction("bash")).toBe("run")
    expect(toolAction("task")).toBe("delegate")
  })

  test("leaves unknown tools unmapped instead of guessing", () => {
    // 把 MCP 工具说成"搜索"比不换时态更糟：用户会以为真的搜了什么。
    expect(toolAction("mcp__foo__bar")).toBeUndefined()
    expect(toolAction("describe_table")).toBeUndefined()
  })
})

describe("toolActionKey", () => {
  test("switches tense with the running flag", () => {
    expect(toolActionKey("edit", true)).toBe("ui.tool.action.edit.running")
    expect(toolActionKey("edit", false)).toBe("ui.tool.action.edit.done")
    expect(toolActionKey("bash", true)).toBe("ui.tool.action.run.running")
    expect(toolActionKey("bash", false)).toBe("ui.tool.action.run.done")
  })

  test("returns undefined for unknown tools", () => {
    expect(toolActionKey("mcp__foo__bar", true)).toBeUndefined()
  })
})
