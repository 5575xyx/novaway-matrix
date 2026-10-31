import { describe, expect, it } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, execute, interpret, normalize } from "@/team/command-verifier"

/** 用当前的 bun 可执行文件构造一条跨平台命令，避免依赖 shell 里的 `true` / `exit`。 */
const bun = (script: string) => '"' + process.execPath + '" -e "' + script + '"'

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "novaway-command-"))

describe("command verifier: config", () => {
  it("accepts only a command verifier with a non-empty run line", () => {
    expect(normalize({ kind: "command", run: "bun test" })).toEqual({
      kind: "command",
      run: "bun test",
      timeoutMs: DEFAULT_TIMEOUT_MS,
    })
    // 认不出来就当没有：调用方退回模型验证，而不是拿半份配置去执行。
    expect(normalize(undefined)).toBeUndefined()
    expect(normalize("bun test")).toBeUndefined()
    expect(normalize({ kind: "rubric", run: "bun test" })).toBeUndefined()
    expect(normalize({ kind: "command", run: "   " })).toBeUndefined()
    expect(normalize({ kind: "command" })).toBeUndefined()
  })

  it("defaults the timeout and clamps it instead of accepting an endless one", () => {
    expect(normalize({ kind: "command", run: "x", timeoutMs: 5_000 })?.timeoutMs).toBe(5_000)
    expect(normalize({ kind: "command", run: "x", timeoutMs: -1 })?.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
    expect(normalize({ kind: "command", run: "x", timeoutMs: Number.NaN })?.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
    // 再长就不是验收而是挂死：上限写死，不让配置把看板拖住。
    expect(normalize({ kind: "command", run: "x", timeoutMs: MAX_TIMEOUT_MS * 10 })?.timeoutMs).toBe(MAX_TIMEOUT_MS)
  })
})

describe("command verifier: interpretation", () => {
  it("reads the exit code as the verdict", () => {
    expect(interpret({ code: 0, timedOut: false, durationMs: 1_200, lines: 18 })).toEqual({
      outcome: "pass",
      measured: "exit 0 · 1.2s · 输出 18 行",
      verifierVersion: "command:v1",
    })
    expect(interpret({ code: 1, timedOut: false, durationMs: 900, lines: 3 }).outcome).toBe("fail")
  })

  it("refuses to call a timeout or a failed spawn a pass", () => {
    // 超时不知道它跑完会不会过：按「没验过」算，不按失败算，更不按通过算。
    const timeout = interpret({ timedOut: true, durationMs: 120_000, lines: 0 })
    expect(timeout.outcome).toBe("unverified")
    expect(timeout.measured).toContain("超时")
    // 命令根本没起来：环境问题不是被测代码的问题。
    expect(interpret({ timedOut: false, durationMs: 5, lines: 0 }).outcome).toBe("unverified")
  })

  it("never puts output text into the measured value", () => {
    // 命令输出是最容易夹带凭据的东西：这里只允许退出码、耗时与行数。
    const result = interpret({ code: 0, timedOut: false, durationMs: 10, lines: 4 })
    expect(result.measured).toBe("exit 0 · 0.0s · 输出 4 行")
    expect(result.measured).not.toContain("\n")
  })
})

describe("command verifier: execution", () => {
  it("passes on exit 0 and fails on a non-zero exit", async () => {
    const dir = await tmp()
    const pass = await execute({ directory: dir, spec: { kind: "command", run: bun("process.exit(0)"), timeoutMs: 10_000 } })
    expect(pass.code).toBe(0)
    expect(interpret(pass).outcome).toBe("pass")

    const fail = await execute({ directory: dir, spec: { kind: "command", run: bun("process.exit(3)"), timeoutMs: 10_000 } })
    expect(fail.code).toBe(3)
    expect(interpret(fail).outcome).toBe("fail")
  })

  it("counts lines without keeping the text", async () => {
    const dir = await tmp()
    const result = await execute({
      directory: dir,
      spec: { kind: "command", run: bun("console.log('a'); console.log('b')"), timeoutMs: 10_000 },
    })
    expect(interpret(result).measured).toContain("输出 2 行")
  })

  it("stops a command that outlives its timeout and reports unverified", async () => {
    const dir = await tmp()
    const result = await execute({
      directory: dir,
      spec: { kind: "command", run: bun("setTimeout(() => {}, 30_000)"), timeoutMs: 300 },
    })
    expect(result.timedOut).toBe(true)
    expect(interpret(result).outcome).toBe("unverified")
  })
})
