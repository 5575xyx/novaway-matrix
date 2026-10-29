import { describe, expect, test } from "bun:test"
import { shouldMountStatusPanel, visibleStatusSections } from "./status-panel"

describe("shouldMountStatusPanel", () => {
  test("never mounts without content", () => {
    expect(shouldMountStatusPanel([])).toBe(false)
  })

  test("mounts once at least one section survives filtering", () => {
    expect(shouldMountStatusPanel([{ id: "git" }])).toBe(true)
  })
})

// 任务停下来了就不该继续挂 todo / agents 区块（上一轮的残留会一直盖住消息区），
// git 跟着内容走：有行级变更时空闲期也留着（提交入口在卡 body 里），clean 仓库
// 连卡带提交入口一起消失（对齐 ZCode 的 buildGitModel）。
// context 已退出面板 —— 占用显示在输入框工具条上（对齐 ZCode 的 ChatContextUsage）。
describe("visibleStatusSections", () => {
  const sections = [{ id: "git" }, { id: "todo" }, { id: "background" }]

  test("任务运行中全部区块都在", () => {
    expect(visibleStatusSections(sections, true).map((section) => section.id)).toEqual(["git", "todo", "background"])
  })

  test("任务停下后保留 git 与 background，todo 消失", () => {
    expect(visibleStatusSections(sections, false).map((section) => section.id)).toEqual(["git", "background"])
  })

  test("没有 git 区块时停下只剩 background", () => {
    expect(visibleStatusSections([{ id: "todo" }, { id: "background" }], false).map((section) => section.id)).toEqual([
      "background",
    ])
  })
})

// 本仓库的 bun 测试把 TSX 编译成 React classic JSX（tsconfig 是 jsx:preserve），
// solid-js 也解析到 SSR 构建，因此组件既没法挂到 happy-dom 上，也没法跑响应式重算，
// 仓库里不存在组件渲染夹具。能稳定执行、且真正锁住这次回归的，是「源码契约」测试：
// 挂载判定必须活在响应式 <Show> 的 when 上，不能再是组件体内的一次性早退 null。
// 旧实现（if (!shouldMountStatusPanel(props.sections)) return null）会同时挂掉两条断言。
describe("SessionStatusPanel mount wiring", () => {
  test("gates the view through a reactive Show instead of an untracked early return", async () => {
    const source = await Bun.file(new URL("./status-panel.tsx", import.meta.url)).text()

    expect(source).toMatch(/<Show\s+when=\{shouldMountStatusPanel\(props\.sections\)\}/)
    expect(source).not.toMatch(/if\s*\(\s*!shouldMountStatusPanel\(props\.sections\)\s*\)\s*return null/)
  })

  // 胶囊按需出现（对齐 ZCode 的 !summaryMetric → return null）：收起态与窄容器 mini
  // 都必须挂 summaries 闸门，没有可显示的摘要时不渲染壳。
  test("collapses the capsule away entirely when no section has a summary", async () => {
    const source = await Bun.file(new URL("./status-panel.tsx", import.meta.url)).text()

    const gated = source.match(/<Show when=\{summaries\(\)\.length > 0\}>/g) ?? []
    expect(gated.length).toBe(2)
    expect(source).toContain('data-component="status-panel-mini"')
    expect(source).toContain('data-component="status-panel-expand"')
  })
})
