import { describe, expect, test } from "bun:test"
import { checkTool } from "../src/workflow/guard"

describe("workflow phase tool guard", () => {
  test("blocks writes outside implementation", () => {
    expect(checkTool("grill-me", { id: "edit", workspace: true }).allowed).toBe(false)
    expect(checkTool("implementation", { id: "edit", workspace: true }).allowed).toBe(true)
    expect(checkTool("verification", { id: "task", workspace: true }, true).allowed).toBe(true)
    expect(checkTool("verification", { id: "edit", workspace: true }).allowed).toBe(false)
  })

  // 计划模式有自己的写入白名单（permission 层：只有计划目录下的 markdown 与只读
  // shell）。phase 再拦一次就是两个门互相否决 —— 计划文件一个字节也落不了盘。
  test("plan permission mode owns the write decision, phases step aside", () => {
    expect(checkTool("grill-me", { id: "edit", workspace: true }, false, { permissionMode: "plan" }).allowed).toBe(true)
    expect(checkTool("design", { id: "write", workspace: true }, false, { permissionMode: "plan" }).allowed).toBe(true)
    expect(checkTool("verification", { id: "edit", workspace: true }, false, { permissionMode: "plan" }).allowed).toBe(
      true,
    )
    // 其它档位行为完全不变。
    for (const mode of ["default", "acceptEdits", "auto"] as const) {
      expect(checkTool("grill-me", { id: "edit", workspace: true }, false, { permissionMode: mode }).allowed).toBe(
        false,
      )
    }
  })

  test("todo bookkeeping remains available during read-only workflow gates", () => {
    for (const phase of ["intake", "grill-me", "design", "plan", "review", "delivery"] as const) {
      expect(checkTool(phase, { id: "todowrite" }).allowed).toBe(true)
    }
  })

  test("mode switching tools are never gated", () => {
    for (const phase of ["intake", "grill-me", "plan", "verification", "review"] as const) {
      expect(checkTool(phase, { id: "plan_exit", workspace: false }).allowed).toBe(true)
      expect(checkTool(phase, { id: "plan_enter", workspace: false }).allowed).toBe(true)
    }
  })
})
