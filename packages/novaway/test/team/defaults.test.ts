import { describe, expect, test } from "bun:test"
import { resolve } from "@/team/defaults"

describe("default team mode", () => {
  test("auto is written into a new session only", () => {
    expect(resolve({ enabled: true, fallback: { mode: "auto" } })).toEqual({ teamMode: "auto" })
  })

  test("an explicit choice always wins, including off", () => {
    // 用户点了「不选」就是不要团队：默认值不能事后把它改回来。
    expect(resolve({ enabled: true, requested: { teamMode: "off" }, fallback: { mode: "auto" } })).toBeUndefined()
    expect(resolve({ enabled: true, requested: { teamMode: "selected" }, fallback: { mode: "auto" } })).toBeUndefined()
  })

  test("sub-sessions never inherit the project default", () => {
    // 团队成员、子代理都是子会话：能不能派发由父会话的编排决定。
    expect(resolve({ enabled: true, parentID: "ses_parent", fallback: { mode: "auto" } })).toBeUndefined()
  })

  test("nothing happens while the master switch is off", () => {
    expect(resolve({ enabled: false, fallback: { mode: "auto" } })).toBeUndefined()
    expect(resolve({ enabled: false, fallback: { mode: "selected", ids: ["t1"] } })).toBeUndefined()
  })

  test("selected without a roster is the same as off", () => {
    // 写一个空的 selected 进库，界面会显示「指定团队」却什么也不注入 —— 不如不写。
    expect(resolve({ enabled: true, fallback: { mode: "selected", ids: [] } })).toBeUndefined()
    expect(resolve({ enabled: true, fallback: { mode: "selected" } })).toBeUndefined()
  })

  test("selected keeps the configured ids, deduplicated and trimmed of blanks", () => {
    expect(resolve({ enabled: true, fallback: { mode: "selected", ids: ["a", "b", "a", ""] } })).toEqual({
      teamMode: "selected",
      teamIDs: ["a", "b"],
    })
  })

  test("off or no configuration means no write at all", () => {
    expect(resolve({ enabled: true, fallback: { mode: "off" } })).toBeUndefined()
    expect(resolve({ enabled: true })).toBeUndefined()
  })
})
