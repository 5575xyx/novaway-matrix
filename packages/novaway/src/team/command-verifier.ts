import { spawn } from "node:child_process"

/**
 * 命令类验收（§6.2 / §19.1）。
 *
 * 「跑一下测试」这件事不该交给模型去评：退出码就是答案。让模型读测试输出再
 * 回答 pass/fail，既慢又贵，而且它「觉得过了」和「真的过了」是两回事。
 *
 * 三条边界：
 *
 * 1. **命令只能来自受控配置。** 它存在验收项自己的 `verifier` 里（人通过
 *    `POST /run/:runID/acceptance` 写进去），**不从成员报告里读**。顺手读报告里的
 *    命令，等于让被验证的人决定怎么验自己。
 * 2. **执行目录是团队 worktree，不是用户的仓库。** 验收可以有副作用，但副作用
 *    必须落在可以整体丢弃的副本里。
 * 3. **只记结构，不记输出。** 命令输出是最容易夹带凭据的东西（curl 的响应头、
 *    带签名的 URL、调试日志）。这里只数行数，原文既不返回也不落库。
 */

export type CommandSpec = { kind: "command"; run: string; timeoutMs: number }

/** 缺省超时：够跑一次常规测试，又不至于让看板长时间没有结论。 */
export const DEFAULT_TIMEOUT_MS = 120_000
/** 上限：再长就不是「验收」，而是挂死；超时后按 `unverified` 处理。 */
export const MAX_TIMEOUT_MS = 600_000
export const VERSION = "command:v1"

/**
 * 读回受控配置里的命令。
 *
 * 认不出来就当没有 —— 调用方会退回模型验证，而不是拿半份配置去执行。
 * `run` 是空串、`kind` 不是 `command`、超时不是正数，都算认不出来。
 */
export function normalize(value: unknown): CommandSpec | undefined {
  if (!value || typeof value !== "object") return undefined
  const kind: unknown = Reflect.get(value, "kind")
  if (kind !== "command") return undefined
  const run: unknown = Reflect.get(value, "run")
  if (typeof run !== "string" || !run.trim()) return undefined
  const raw: unknown = Reflect.get(value, "timeoutMs")
  const timeoutMs =
    typeof raw === "number" && Number.isFinite(raw) && raw > 0
      ? Math.min(Math.floor(raw), MAX_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS
  return { kind: "command", run: run.trim(), timeoutMs }
}

export type Result = {
  /** 退出码；进程根本没起来时为 `undefined`。 */
  code?: number
  timedOut: boolean
  durationMs: number
  /** 输出行数（只数行，不存原文）。 */
  lines: number
}

export type Interpretation = {
  outcome: "pass" | "fail" | "unverified"
  measured: string
  verifierVersion: string
}

const seconds = (ms: number) => (ms / 1000).toFixed(1) + "s"

/**
 * 退出码 → 结论。
 *
 * - `0` = 通过；非零 = 失败（命令自己就是判定标准）；
 * - 超时 = `unverified`：不知道它跑完会不会过，按「没验过」算，不按失败算；
 * - 起不来（退出码缺失）= `unverified`：环境问题不是被测代码的问题，
 *   更不是通过。
 */
export function interpret(result: Result): Interpretation {
  if (result.timedOut)
    return {
      outcome: "unverified",
      measured: "超时（>" + seconds(result.durationMs) + "），未能得出结论",
      verifierVersion: VERSION,
    }
  if (result.code === undefined)
    return { outcome: "unverified", measured: "命令未能执行", verifierVersion: VERSION }
  const outcome = result.code === 0 ? "pass" : "fail"
  return {
    outcome,
    measured: "exit " + result.code + " · " + seconds(result.durationMs) + " · 输出 " + result.lines + " 行",
    verifierVersion: VERSION,
  }
}

/** 结束整个进程树：`shell: true` 下只杀 shell 会留下孤儿子进程。 */
function killTree(pid: number | undefined) {
  if (pid === undefined) return
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => {})
    return
  }
  try {
    process.kill(pid, "SIGKILL")
  } catch {
    // 进程已经退出：超时与退出竞争，谁先到都一样。
  }
}

/**
 * 执行验收命令。
 *
 * 继承进程环境（测试要 `PATH`，也要它自己的凭据配置）；输出只用来数行数，
 * 不返回、不落库。超时后连子进程一起结束，不留半成品在后台跑。
 */
export function execute(input: { directory: string; spec: CommandSpec }): Promise<Result> {
  return new Promise((resolve) => {
    const started = Date.now()
    let lines = 0
    let pending = ""
    let settled = false
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (code: number | undefined) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      const tail = pending.length > 0 ? 1 : 0
      resolve({ code, timedOut, durationMs: Date.now() - started, lines: lines + tail })
    }
    const child = spawn(input.spec.run, {
      cwd: input.directory,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      windowsHide: true,
    })
    const count = (chunk: Buffer) => {
      const text = chunk.toString()
      for (const char of text) {
        if (char === "\n") lines += 1
      }
      // 只记最后一段没换行的尾巴：分块到达时，判断「最后一行有没有结束」只看它。
      pending = text.slice(text.lastIndexOf("\n") + 1)
    }
    child.stdout?.on("data", count)
    child.stderr?.on("data", count)
    child.on("error", () => finish(undefined))
    child.on("close", (code) => finish(code ?? undefined))
    timer = setTimeout(() => {
      timedOut = true
      killTree(child.pid)
      // 子进程可能不响应：到点先给结论，别让看板一直转。
      finish(undefined)
    }, input.spec.timeoutMs)
  })
}
