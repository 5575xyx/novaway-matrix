import { expect, test } from "bun:test"
import path from "node:path"
import { assertInsideWorktree, isolationStatus } from "../../src/powersnexus/isolation"

test("隔离状态默认为逻辑权限模式", () => {
  const status = isolationStatus()
  expect(status.mode).toBe("logical")
  expect(status.worktreeOnlyWrite).toBe(true)
  expect(status.note).toContain("逻辑权限模式")
})

test("拒绝 Worktree 外路径", () => {
  const worktree = path.resolve("E:/tmp/worktree-isolation")
  expect(assertInsideWorktree(worktree, path.join(worktree, "src", "a.ts"))).toContain("src")
  expect(() => assertInsideWorktree(worktree, path.join(worktree, "..", "escape.txt"))).toThrow("Worktree")
})
