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
  assertArgvWithinWriteRoots,
  buildIsolatedProcessEnv,
  sandboxTempRoot,
} from "../../src/powersnexus/isolation"
import {
  createRunJob,
  createRestrictedTokenHandle,
  disposeRunJob,
  isOsIsolationAvailable,
  isRestrictedTokenAvailable,
  processIsolationStatus,
  sandboxCapabilities,
} from "../../src/powersnexus/os-isolation"

test("隔离状态在 Windows 可用时报告 OS Job Object，否则为逻辑模式", () => {
  const status = isolationStatus()
  expect(status.worktreeOnlyWrite).toBe(true)
  expect(status.autoLocalDeliveryScope).toBe("worktree_only")
  expect(status.networkDefault).toBe("ask")
  if (process.platform === "win32" && isOsIsolationAvailable()) {
    expect(status.mode).toBe("os")
    expect(status.note).toContain("Job Object")
  } else {
    expect(status.mode).toBe("logical")
    expect(status.note).toContain("逻辑权限模式")
  }
  expect(processIsolationStatus().mode).toBe(status.mode)
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

test("逻辑/OS 隔离均仅允许自动批准本地交付动作", () => {
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
  expect(() => assertNetworkTargetAllowed("ftp://127.0.0.1/x")).toThrow("http/https")
})

test("OS 隔离 Job 可启动命令并在 terminate 后结束", async () => {
  if (process.platform !== "win32") return
  const job = createRunJob(`test-job-${Date.now()}`)
  try {
    expect(["os", "logical"]).toContain(job.mode)
    const { Effect } = await import("effect")
  const result = await Effect.runPromise(
      job.run([process.execPath, "-e", "console.log('iso-ok')"], {
        cwd: process.cwd(),
        timeoutMs: 10_000,
      }),
    )
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString("utf8")).toContain("iso-ok")
  } finally {
    disposeRunJob(job.id)
  }
})


test("argv 绝对路径越界被拒绝，Worktree 内路径允许", () => {
  const worktree = path.resolve("E:/tmp/worktree-isolation")
  expect(() => assertArgvWithinWriteRoots(worktree, ["node", "E:/outside/secret.txt"])).toThrow("禁止写入")
  expect(() =>
    assertArgvWithinWriteRoots(worktree, ["tool", `--out=${path.join(worktree, "dist", "a.js")}`]),
  ).not.toThrow()
  expect(() => assertArgvWithinWriteRoots(worktree, ["node", "-e", "console.log(1)"])).not.toThrow()
})

test("隔离子进程环境强制 TEMP 进入 Worktree 沙箱", () => {
  const worktree = path.resolve("E:/tmp/worktree-isolation")
  const { env, tempRoot } = buildIsolatedProcessEnv({
    worktree,
    runID: "run-abc",
    base: { TEMP: "C:\\Windows\\Temp", PATH: process.env.PATH },
  })
  expect(tempRoot).toBe(sandboxTempRoot(worktree, "run-abc"))
  expect(env.TEMP).toBe(tempRoot)
  expect(env.TMP).toBe(tempRoot)
  expect(env.TMPDIR).toBe(tempRoot)
  expect(env.POWERSNEXUS_WORKTREE).toBe(worktree)
  expect(env.TEMP?.includes("Windows")).toBe(false)
})


test("沙箱能力面：Job Object / 写守卫 / TEMP 沙箱可用；受限 Token 在支持时可用", () => {
  const caps = sandboxCapabilities()
  expect(caps.worktreeTempSandbox).toBe(true)
  expect(caps.argvWriteGuard).toBe(true)
  expect(caps.activeProcessLimit).toBeGreaterThan(0)
  if (process.platform === "win32") {
    expect(caps.jobObject).toBe(isOsIsolationAvailable())
    if (isRestrictedTokenAvailable()) {
      expect(caps.restrictedToken).toBe(true)
      const handle = createRestrictedTokenHandle()
      expect(handle).toBeGreaterThan(0)
    }
  }
})

test("隔离子进程环境在受限 Token 可用时标记 restricted", () => {
  const worktree = path.resolve("E:/tmp/worktree-isolation")
  const { env } = buildIsolatedProcessEnv({ worktree, runID: "tok-1" })
  if (process.platform === "win32" && isRestrictedTokenAvailable()) {
    expect(env.POWERSNEXUS_TOKEN_LEVEL).toBe("restricted")
  } else {
    expect(["restricted", "standard"]).toContain(env.POWERSNEXUS_TOKEN_LEVEL ?? "standard")
  }
})


test("CreateProcessAsUser 受限路径可启动命令且 restricted=true", async () => {
  if (process.platform !== "win32" || !isRestrictedTokenAvailable()) return
  const previous = process.env.POWERSNEXUS_RESTRICTED_SPAWN
  process.env.POWERSNEXUS_RESTRICTED_SPAWN = "1"
  const { Effect } = await import("effect")
  const job = createRunJob(`asuser-${Date.now()}`)
  try {
    const comspec = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe"
    const tempRoot = path.join(os.tmpdir(), `pn-asuser-${Date.now()}`)
    const result = await Effect.runPromise(
      job.run([comspec, "/c", "echo asuser-ok"], {
        cwd: process.cwd(),
        timeoutMs: 15_000,
        env: { ...process.env, TEMP: tempRoot, TMP: tempRoot, TMPDIR: tempRoot },
      }),
    )
    expect(result.exitCode).toBe(0)
    expect(result.restricted).toBe(true)
    expect(result.stdout.toString("utf8")).toContain("asuser-ok")
  } finally {
    disposeRunJob(job.id)
    if (previous === undefined) delete process.env.POWERSNEXUS_RESTRICTED_SPAWN
    else process.env.POWERSNEXUS_RESTRICTED_SPAWN = previous
  }
})
