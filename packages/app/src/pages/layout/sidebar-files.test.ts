import { describe, expect, test } from "bun:test"
import { isVisibleEntry } from "./sidebar-files"

// 「仅变更」必须对每一层都成立：只看根层的话，展开子目录后未变更的文件会整片露出来，
// 过滤开关看起来就像没生效（旧实现只过滤 rootEntries，子目录走的是未过滤的 openDirs）。
describe("sidebar files 仅变更过滤", () => {
  const changed = new Set(["src/pages/layout/sidebar-files.tsx", "README.md"])

  test("未变更的条目在任意深度都不可见", () => {
    expect(isVisibleEntry("src/pages/session.tsx", changed)).toBe(false)
    expect(isVisibleEntry("src/pages/layout/sidebar-items.tsx", changed)).toBe(false)
    expect(isVisibleEntry("packages/app/index.html", changed)).toBe(false)
  })

  test("变更文件及其每一层祖先目录都可见", () => {
    expect(isVisibleEntry("src/pages/layout/sidebar-files.tsx", changed)).toBe(true)
    expect(isVisibleEntry("src/pages/layout", changed)).toBe(true)
    expect(isVisibleEntry("src/pages", changed)).toBe(true)
    expect(isVisibleEntry("src", changed)).toBe(true)
    expect(isVisibleEntry("README.md", changed)).toBe(true)
  })

  test("同名前缀不算命中，只比目录层级", () => {
    expect(isVisibleEntry("src/pages/layout/sidebar-files", changed)).toBe(false)
    expect(isVisibleEntry("src/pages/layout/sidebar-files.ts", changed)).toBe(false)
  })

  test("Windows 反斜杠路径归一后再比对", () => {
    expect(isVisibleEntry("src\\pages\\layout\\sidebar-files.tsx", changed)).toBe(true)
    expect(isVisibleEntry("src\\pages\\layout", changed)).toBe(true)
  })

  test("空变更清单下什么都不显示", () => {
    expect(isVisibleEntry("src", new Set())).toBe(false)
  })
})
