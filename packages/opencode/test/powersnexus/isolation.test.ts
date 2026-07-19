import { expect, test } from "bun:test"
import path from "node:path"
import os from "node:os"
import {
  assertAutoLocalApprove,
  assertInsideWorktree,
  assertNetworkTargetAllowed,
  assertWritablePath,
  canAutoLocalApprove,
  classifyAction,
  isolationStatus,
} from "../../src/powersnexus/isolation"

test("隔离状态默认为逻辑权限模式", () => {
  const status = isolationStatus()
  expect(status.mode).toBe("logical")
  expect(status.worktreeOnlyWrite).toBe(true)
  expect(status.autoLocalDeliveryScope).toBe("worktree_only")
  expect(status.networkDefault).toBe("ask")
  expect(status.note).toContain("逻辑权限模式")
})

test("拒绝 Worktree 外路径", () => {
  const worktree = path.resolve("E:/tmp/worktree-isolation")
  expect(assertInsideWorktree(worktree, path.join(worktree, "src", "a.ts"))).toContain("src")
  expect(() => assertInsideWorktree(worktree, path.join(worktree, "..", "escape.txt"))).toThrow("Worktree")
})

test("动作分类符合 15.1 自动本地交付边界", () => {
  expect(classifyAction("verify")).toBe("local_delivery")
  expect(classifyAction("configure_delivery")).toBe("local_delivery")
  expect(classifyAction("archive")).toBe("local_delivery")
  expect(classifyAction("push")).toBe("external")
  expect(classifyAction("create_pr")).toBe("external")
  expect(classifyAction("deploy")).toBe("external")
  expect(classifyAction("delete_data")).toBe("destructive")
  expect(classifyAction("manage_secrets")).toBe("privileged")
  expect(classifyAction("unknown_thing")).toBe("external")
})

test("逻辑隔离仅允许自动批准本地交付动作", () => {
  expect(canAutoLocalApprove("verify")).toBe(true)
  expect(canAutoLocalApprove("build")).toBe(true)
  expect(canAutoLocalApprove("push")).toBe(false)
  expect(canAutoLocalApprove("deploy")).toBe(false)
  expect(canAutoLocalApprove("delete_data")).toBe(false)
  expect(canAutoLocalApprove("manage_secrets")).toBe(false)
  expect(() => assertAutoLocalApprove("push")).toThrow("禁止自动批准")
  expect(() => assertAutoLocalApprove("verify")).not.toThrow()
})

test("可写路径仅允许 Worktree 与临时目录", () => {
  const worktree = path.resolve("E:/tmp/worktree-isolation")
  const tempRoot = path.resolve(os.tmpdir())
  expect(assertWritablePath(worktree, path.join(worktree, "out", "a.js"))).toContain("out")
  expect(assertWritablePath(worktree, path.join(tempRoot, "powersnexus-smoke", "x.txt"))).toContain("powersnexus-smoke")
  expect(() => assertWritablePath(worktree, path.resolve("E:/outside/escape.txt"))).toThrow("禁止写入")
})

test("自动网络访问仅允许本机回环", () => {
  expect(assertNetworkTargetAllowed("http://127.0.0.1:4173/health").hostname).toBe("127.0.0.1")
  expect(assertNetworkTargetAllowed("http://localhost:3000").hostname).toBe("localhost")
  expect(() => assertNetworkTargetAllowed("https://evil.example.com/api")).toThrow("禁止自动访问外网")
  // 非自动路径可放行形态校验，但仍要求 http/https
  expect(() => assertNetworkTargetAllowed("ftp://127.0.0.1/x")).toThrow("http/https")
})
