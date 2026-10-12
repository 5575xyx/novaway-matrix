import { describe, expect, test } from "bun:test"
import { shouldMountStatusPanel } from "./status-panel"

describe("shouldMountStatusPanel", () => {
  test("never mounts without content", () => {
    expect(shouldMountStatusPanel([])).toBe(false)
  })

  test("mounts once at least one section survives filtering", () => {
    expect(shouldMountStatusPanel([{ id: "git" }])).toBe(true)
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
})
