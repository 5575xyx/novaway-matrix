/**
 * 执行验证命令。
 *
 * 走用户的默认 shell（与 shell 工具同一口径），带超时与输出上限。
 * 不做交互式处理：验证命令必须是能自己结束的。
 */
import { spawn } from "node:child_process"
import { Shell } from "@/shell/shell"
import { summarize, tail, type VerifyOutcome } from "./summary"

export type RunResult = VerifyOutcome & {
  command: string
  output: string
  durationMs: number
}

const MAX_OUTPUT = 2 * 1024 * 1024

export async function run(input: {
  command: string
  cwd: string
  timeoutMs?: number
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
}): Promise<RunResult> {
  const started = Date.now()
  const shell = Shell.acceptable(undefined)
  const timeoutMs = input.timeoutMs ?? 10 * 60 * 1000

  return new Promise<RunResult>((resolve) => {
    const child = spawn(input.command, {
      cwd: input.cwd,
      shell,
      env: input.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    })

    let output = ""
    let timedOut = false
    const append = (chunk: Buffer) => {
      if (output.length >= MAX_OUTPUT) return
      output += chunk.toString("utf8")
      if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT)
    }
    child.stdout?.on("data", append)
    child.stderr?.on("data", append)

    const timer = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, timeoutMs)

    const abort = () => child.kill("SIGKILL")
    input.signal?.addEventListener("abort", abort, { once: true })

    const finish = (code: number | null, extra = "") => {
      clearTimeout(timer)
      input.signal?.removeEventListener("abort", abort)
      const outcome = summarize({ output: output + extra, exitCode: code, timedOut })
      resolve({ ...outcome, command: input.command, output: tail(output), durationMs: Date.now() - started })
    }

    child.on("error", (error) => finish(null, "\n" + error.message))
    child.on("close", (code) => finish(code))
  })
}
