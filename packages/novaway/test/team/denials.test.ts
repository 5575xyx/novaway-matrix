import { describe, expect, it } from "bun:test"
import { actionKey, clear, list, lookup, remember } from "@/team/denials"

const runID = () => "run_" + Math.random().toString(36).slice(2, 9)

describe("permission denials", () => {
  it("keys an action by tool + sorted patterns, so order does not matter", () => {
    expect(actionKey("bash", ["a", "b"])).toBe(actionKey("bash", ["b", "a"]))
    expect(actionKey("bash", ["a"])).not.toBe(actionKey("edit", ["a"]))
    // 键里没有原文：原文（往往带 token）不能落库，判断相同动作只需要相等性。
    expect(actionKey("bash", ["curl -H 'Authorization: Bearer x'"])).not.toContain("Bearer")
  })

  it("keeps a denial for the run and reports it without the original action", () => {
    const id = runID()
    expect(lookup({ runID: id, tool: "bash", patterns: ["bun test"] })).toBeUndefined()

    remember({ runID: id, tool: "bash", patterns: ["bun test"], reason: "跑测试会起服务" })
    const found = lookup({ runID: id, tool: "bash", patterns: ["bun test"] })
    expect(found?.tool).toBe("bash")
    expect(found?.reason).toBe("跑测试会起服务")

    // 同一个动作换个顺序仍然是同一个动作；不同的动作不受影响。
    expect(lookup({ runID: id, tool: "bash", patterns: ["bun test"] })).toBeDefined()
    expect(lookup({ runID: id, tool: "bash", patterns: ["bun run build"] })).toBeUndefined()
    // 拒绝属于「这次运行」，不跨运行生效。
    expect(lookup({ runID: runID(), tool: "bash", patterns: ["bun test"] })).toBeUndefined()
  })

  it("remembers the moment of the first denial instead of moving it", () => {
    const id = runID()
    remember({ runID: id, tool: "edit", patterns: ["src/a.ts"] })
    const first = lookup({ runID: id, tool: "edit", patterns: ["src/a.ts"] })
    // 补充说明可以更新，但「什么时候被判死的」不变：那是看板上的事实。
    remember({ runID: id, tool: "edit", patterns: ["src/a.ts"], reason: "不要改这个文件" })
    const second = lookup({ runID: id, tool: "edit", patterns: ["src/a.ts"] })
    expect(second?.at).toBe(first?.at)
    expect(second?.reason).toBe("不要改这个文件")
    expect(list(id).length).toBe(1)
  })

  it("clears every denial for a run and says how many were cleared", () => {
    const id = runID()
    remember({ runID: id, tool: "bash", patterns: ["a"] })
    remember({ runID: id, tool: "bash", patterns: ["b"] })
    expect(list(id).length).toBe(2)
    expect(clear(id)).toBe(2)
    expect(list(id)).toEqual([])
    // 清空之后同一个动作会重新询问 —— 这是用户显式放行的效果。
    expect(lookup({ runID: id, tool: "bash", patterns: ["a"] })).toBeUndefined()
    expect(clear(id)).toBe(0)
  })
})

