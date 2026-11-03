import { describe, expect, test } from "bun:test"
import { IDLE, beginFollow, endFollow, followChipState, followTab, hijackFollow, takeSidebar } from "./live-follow"

describe("live follow", () => {
  test("面板关着时开始跟随，结束会连面板一起收起", () => {
    let s = beginFollow(IDLE, false)
    const step = followTab(s, "file://a.md")
    s = step.state
    expect(step.close).toEqual([])
    expect(s.tabs).toEqual(["file://a.md"])

    const end = endFollow(s)
    expect(end.close).toEqual(["file://a.md"])
    expect(end.closePane).toBe(true)
  })

  test("面板原本开着就不替用户关", () => {
    let s = beginFollow(IDLE, true)
    s = followTab(s, "file://a.md").state
    expect(endFollow(s).closePane).toBe(false)
  })

  test("每次只留一个自动标签，旧的在切换时关掉", () => {
    let s = beginFollow(IDLE, false)
    s = followTab(s, "file://a.md").state
    const step = followTab(s, "file://b.md")
    expect(step.close).toEqual(["file://a.md"])
    expect(step.state.tabs).toEqual(["file://b.md"])
  })

  test("重复跟随同一个文件不产生关标签动作", () => {
    let s = beginFollow(IDLE, false)
    s = followTab(s, "file://a.md").state
    const step = followTab(s, "file://a.md")
    expect(step.close).toEqual([])
    expect(step.state).toBe(s)
  })

  test("用户接管后不再切换文件，结束时也不动面板", () => {
    let s = beginFollow(IDLE, false)
    s = followTab(s, "file://a.md").state
    s = hijackFollow(s)
    const step = followTab(s, "file://b.md")
    expect(step.state.hijacked).toBe(true)
    expect(step.close).toEqual([])

    const end = endFollow(s)
    expect(end.close).toEqual([])
    expect(end.closePane).toBe(false)
  })

  test("未激活时结束是空操作", () => {
    expect(endFollow(IDLE)).toEqual({ state: IDLE, close: [], closePane: false, restoreSidebar: false })
  })

  test("重复开始不重置接管标记与已开标签", () => {
    let s = beginFollow(IDLE, false)
    s = followTab(s, "file://a.md").state
    s = hijackFollow(s)
    expect(beginFollow(s, false)).toBe(s)
  })
})

describe("跟随期间收起左侧栏", () => {
  test("左栏开着就收起来，结束时还回去", () => {
    let s = beginFollow(IDLE, false)
    const side = takeSidebar(s, true)
    expect(side.collapse).toBe(true)
    expect(side.state.sidebarCollapsed).toBe(true)
    s = followTab(side.state, "file://a.md").state

    const end = endFollow(s)
    expect(end.restoreSidebar).toBe(true)
  })

  test("左栏本来就关着：什么都不做，结束时也不替用户打开", () => {
    let s = beginFollow(IDLE, false)
    const side = takeSidebar(s, false)
    expect(side.collapse).toBe(false)
    expect(side.state).toBe(s)
    expect(endFollow(s).restoreSidebar).toBe(false)
  })

  test("一个窗口里只收一次（用户自己拉回来就不再动）", () => {
    let s = beginFollow(IDLE, false)
    s = takeSidebar(s, true).state
    // 用户中途把左栏拉回来了：下一次写盘不再收。
    expect(takeSidebar(s, true)).toEqual({ state: s, collapse: false })
  })

  test("用户接管后不再收左栏，但收过的仍然还回去", () => {
    let s = beginFollow(IDLE, false)
    s = takeSidebar(s, true).state
    s = hijackFollow(s)
    expect(takeSidebar(s, true).collapse).toBe(false)
    // 接管只影响右栏（不再切文件、不收面板）；左栏是我们收的，得还。
    const end = endFollow(s)
    expect(end.restoreSidebar).toBe(true)
    expect(end.closePane).toBe(false)
  })

  test("重复开始跟随会清掉上一窗口的左栏标记", () => {
    let s = beginFollow(IDLE, false)
    s = takeSidebar(s, true).state
    const next = beginFollow(endFollow(s).state, false)
    expect(next.sidebarCollapsed).toBe(false)
  })
})

describe("跟随开关的视觉状态", () => {
  const base = { enabled: true, active: true, hijacked: false, writing: false }

  test("关掉设置就是灰色，哪怕本轮还在跟", () => {
    expect(followChipState({ ...base, enabled: false, writing: true })).toBe("off")
  })

  test("接管优先于正在跟随：用户碰过面板就先显示已接管", () => {
    expect(followChipState({ ...base, hijacked: true, writing: true })).toBe("taken")
  })

  test("开着且正在写盘 = live，其余开着的情况 = armed", () => {
    expect(followChipState({ ...base, writing: true })).toBe("live")
    expect(followChipState(base)).toBe("armed")
    expect(followChipState({ ...base, active: false })).toBe("armed")
  })
})
