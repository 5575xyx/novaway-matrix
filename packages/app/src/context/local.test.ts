import { describe, expect, test } from "bun:test"
import { forgeAgentForPrompt, hasForgeBuildIntent, shouldAutoBuildAfterForgePlan, visibleAgentList } from "./local-agent"

const agents = [
  { name: "build", mode: "primary", options: {} },
  { name: "plan", mode: "primary", options: {} },
  { name: "office-ppt", mode: "primary", options: { modeGroup: "office" } },
  { name: "office-document", mode: "primary", options: { modeGroup: "office" } },
  { name: "explore", mode: "subagent", options: {} },
  { name: "hidden", mode: "primary", hidden: true, options: {} },
] as const

describe("visibleAgentList", () => {
  test("锻造模式只显示锻造工程和规划蓝图", () => {
    expect(visibleAgentList(agents, "forge").map((agent) => agent.name)).toEqual(["build", "plan"])
  })

  test("办公模式只显示办公场景", () => {
    expect(visibleAgentList(agents, "zen").map((agent) => agent.name)).toEqual(["office-ppt", "office-document"])
  })

  test("未选择模式时保留原有主智能体列表", () => {
    expect(visibleAgentList(agents, undefined).map((agent) => agent.name)).toEqual([
      "build",
      "plan",
      "office-ppt",
      "office-document",
    ])
  })

  test("锻造模式默认进入锻造工程", () => {
    expect(forgeAgentForPrompt({ mode: "forge", current: "plan", text: "帮我看看这个需求怎么做" })).toBe("build")
  })

  test("锻造模式自然语言直接进入锻造工程", () => {
    expect(forgeAgentForPrompt({ mode: "forge", current: "plan", text: "继续，按方案开始实现" })).toBe("build")
    expect(hasForgeBuildIntent("切换到执行，开始修改文件")).toBe(true)
  })

  test("锻造模式命令输入直接进入锻造工程", () => {
    expect(forgeAgentForPrompt({ mode: "forge", current: "plan", text: "/commit 生成提交说明" })).toBe("build")
    expect(shouldAutoBuildAfterForgePlan({ mode: "forge", text: "/commit 生成提交说明", promptMode: "normal" })).toBe(false)
  })

  test("锻造模式始终进入锻造工程", () => {
    expect(forgeAgentForPrompt({ mode: "forge", current: "plan", text: "先不要执行，只给我方案" })).toBe("build")
    expect(hasForgeBuildIntent("先不要执行，只给我方案")).toBe(false)
  })
})
