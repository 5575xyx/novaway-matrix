/**
 * 沙箱 harness：父进程这一侧。
 *
 * 职责只有一个——**把子进程的 NDJSON 接到引擎上，把引擎的结算带回调用方**。它不做决策：
 * 谁先跑、跑几次、成不成功，全归引擎；怎么调模型、怎么读文件，全归驱动。
 *
 * 它管三件只有它能管的事：
 *   1. 子进程的生命周期（写入口文件、spawn、超时、abort、kill、清理）；
 *   2. 协议（逐行解析、应答、把畸形行当成协议损坏）；
 *   3. 失败兜底（子进程崩了就是 `stopped(interrupted)`，可恢复，而不是「结果未知」）。
 *
 * 为什么要有子进程：`while (true) {}` 这种脚本不可能靠超时或 Promise.race 拦住——它占住
 * 事件循环，父进程与用户界面一起僵死。独立进程配 `kill()` 是唯一可靠的解法。
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"
import type { PreparedWorkflow } from "../index"
import { fnv1a } from "../engine/hash"
import { WorkflowEngine } from "../engine/engine"
import { MemoryJournal } from "../engine/memory-journal"
import type { JournalPort, RunEvent, Settlement, WorkflowDriver } from "../engine/types"
import type { ReplayPlan } from "../engine/replay"
import { renderChildEntry } from "./entry"
import type { ChildMessage, ResponseMessage, WireError } from "./protocol"

/** 默认并发：给宿主自己留出余量，同时不至于把 provider 打爆。 */
export function defaultMaxConcurrency(): number {
  const detected = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length
  // Some runtimes/test shims expose availableParallelism but return an invalid
  // value. Keep that from leaking NaN into AskScheduler's required limit.
  const fallback = os.cpus().length
  const cores = Number.isFinite(detected) && detected > 0 ? detected : fallback
  return Math.max(4, Math.min(16, (Number.isFinite(cores) && cores > 0 ? cores : 4) - 2))
}

/** 一次 run 的输入。 */
export interface RunWorkflowInput {
  /** 已经过 compile + analyze + lower 的脚本。 */
  readonly prepared: PreparedWorkflow
  readonly driver: WorkflowDriver
  /** 实参，注入脚本成为只读的 args。 */
  readonly args?: Record<string, unknown>
  readonly maxConcurrency?: number
  /** 缺省用内存 journal（测试与 M2；M3 换成 SQLite）。 */
  readonly journal?: JournalPort
  readonly onEvent?: (event: RunEvent) => void
  /** 恢复时给引擎的计划（见 engine/replay.ts）。缺席即第一次生命。 */
  readonly replay?: ReplayPlan
  /** 恢复时继承的已花用量。 */
  readonly spentTokens?: number
  readonly signal?: AbortSignal
  /** 墙钟上限。超时按 `stopped(interrupted)` 结算。 */
  readonly timeoutMs?: number
  /** 入口文件写到哪；缺省是系统临时目录下的 novaway-workflow-runs。 */
  readonly runtimeDir?: string
  /** 覆盖 run id。测试用。 */
  readonly runId?: string
  /**
   * 引擎建好后立刻回调一次。调用方用它拿停止 / 观察的把手——run 一旦开始，外部就只剩
   * 「停下来」和「看进度」两件事可做，而这两件都需要引擎本身。
   */
  readonly onEngine?: (engine: WorkflowEngine) => void
}

/** 一次 run 的结果。 */
export interface RunWorkflowResult {
  readonly runId: string
  readonly settlement: Settlement
  readonly journal: JournalPort
}

/** 编译没通过时抛出。调用方应当把 diagnostics 交给模型，而不是当作崩溃。 */
export class WorkflowCompileError extends Error {
  constructor(readonly diagnostics: PreparedWorkflow["diagnostics"]) {
    super(diagnostics.map((item) => `L${item.line}:C${item.column} ${item.message}`).join("\n"))
    this.name = "WorkflowCompileError"
  }
}

function runtimeDirectory(override?: string): string {
  return override ?? path.join(os.tmpdir(), "novaway-workflow-runs")
}

/** 把任意抛出物规整成线形态。 */
function wireError(error: unknown): WireError {
  if (error && typeof error === "object") {
    const item = error as { name?: unknown; message?: unknown; code?: unknown; stack?: unknown }
    return {
      name: typeof item.name === "string" ? item.name : "Error",
      message: typeof item.message === "string" ? item.message : String(error),
      ...(typeof item.code === "string" ? { code: item.code } : {}),
      ...(typeof item.stack === "string" ? { stack: item.stack } : {}),
    }
  }
  return { name: "Error", message: String(error) }
}

/**
 * 跑一次工作流。
 *
 * 调用方拿到的是结算，不是 promise 的拒绝：脚本自己的错误是 `errored`，宿主打断是
 * `stopped`，两者都是**结果**。只有「脚本根本编译不过」会抛（WorkflowCompileError），
 * 因为那不是一次 run，而是一次没通过检查的提交。
 */
export async function runWorkflow(input: RunWorkflowInput): Promise<RunWorkflowResult> {
  if (!input.prepared.ok || !input.prepared.lowered) throw new WorkflowCompileError(input.prepared.diagnostics)
  const lowered = input.prepared.lowered

  const runId = input.runId ?? `dwfrun-${randomUUID()}`
  const journal = input.journal ?? new MemoryJournal()
  const maxConcurrency = input.maxConcurrency ?? defaultMaxConcurrency()

  const sitePhases = new Map<string, string>()
  for (const site of input.prepared.sites) if (site.phase !== undefined) sitePhases.set(site.id, site.phase)

  const engine = new WorkflowEngine({
    runId,
    // 恢复时要逐字节比对脚本。用站点表当指纹是不够的：改一句指令文本不影响站点表，
    // 但会让缓存答案张冠李戴。
    scriptHash: fnv1a(input.prepared.scriptText),
    maxConcurrency,
    driver: input.driver,
    journal,
    knownSiteIds: new Set(input.prepared.siteIds),
    sitePhases,
    ...(input.onEvent ? { onEvent: input.onEvent } : {}),
    ...(input.replay ? { replay: input.replay } : {}),
    ...(input.spentTokens !== undefined ? { spentTokens: input.spentTokens } : {}),
  })

  input.onEngine?.(engine)

  const entryPath = await writeEntry(runId, input)
  const child = spawnChild(entryPath)

  // 子进程的 stderr 平时没人看，但它正是「为什么这次没跑完」的唯一线索：入口文件语法错、
  // vm 初始化失败、堆上限被拒，都只会出现在这里。留最后 4 KiB，拼进 interrupted 的原因里。
  let stderrTail = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-4096)
  })

  // 子进程的输出按行切。缓冲区里保留最后一段没有换行的残片，等到下一次 data 再拼。
  let buffered = ""
  let protocolBroken = false

  const respond = (message: ResponseMessage) => {
    if (child.stdin.destroyed) return
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  const kill = () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill("SIGKILL")
  }

  const handle = (message: ChildMessage) => {
    switch (message.kind) {
      case "create-actor":
        // 同步：后续 ask 引用 localId 时，映射必须已经在。
        engine.createActor(message.siteId, message.name, message.persona)
        return
      case "request": {
        const { id } = message
        if (message.type === "ask") {
          void engine.ask(message.siteId, message.actor ?? "", message.instructions ?? "").then(
            (value) => respond({ kind: "response", id, ok: true, value }),
            (error) => respond({ kind: "response", id, ok: false, error: wireError(error) }),
          )
          return
        }
        void engine.worldRead(message.siteId, message.op!, message.args ?? []).then(
          (value) => respond({ kind: "response", id, ok: true, value }),
          (error) => respond({ kind: "response", id, ok: false, error: wireError(error) }),
        )
        return
      }
      case "event":
        if (message.type === "log") engine.log(message.message)
        else if (message.type === "report") engine.report(message.siteId, message.item)
        else engine.enterPhase(message.name)
        return
      case "complete":
        if (message.ok) engine.complete(message.value)
        else engine.fail(message.error ?? { name: "Error", message: "脚本以失败结束，但没有给出原因。" })
        return
    }
  }

  const onLine = (line: string) => {
    if (!line.trim()) return
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      protocolBroken = true
      engine.stop("interrupted", new Error(`子进程发出了一行无法解析的内容：${line.slice(0, 200)}`))
      kill()
      return
    }
    if (!parsed || typeof parsed !== "object" || typeof (parsed as { kind?: unknown }).kind !== "string") {
      protocolBroken = true
      engine.stop("interrupted", new Error(`子进程发出了一条不符合协议的消息：${line.slice(0, 200)}`))
      kill()
      return
    }
    handle(parsed as ChildMessage)
  }

  child.stdout.setEncoding("utf8")
  child.stdout.on("data", (chunk: string) => {
    buffered += chunk
    let at = buffered.indexOf("\n")
    while (at !== -1) {
      const line = buffered.slice(0, at)
      buffered = buffered.slice(at + 1)
      onLine(line)
      at = buffered.indexOf("\n")
    }
  })

  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined
  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    // 必须用 `close` 而不是 `exit`：`exit` 只说明进程没了，管道里可能还有没送到父进程的
    // 字节。收到 `exit` 就判「没发 complete」，会让一次正常结束的 run 间歇性地变成
    // stopped(interrupted)——子进程明明写了结果，父进程却说没看见。
    child.on("close", (code, signal) => {
      exited = { code, signal }
      resolve(exited)
    })
  })

  // 子进程没发 complete 就退了：这不是脚本失败，是宿主丢了它。按可恢复的 interrupted 记。
  child.on("error", (error) => {
    engine.stop("interrupted", error)
    kill()
  })
  void exitPromise.then(({ code, signal }) => {
    if (engine.done) return
    const detail = stderrTail.trim()
    const reason = protocolBroken
      ? "子进程的协议损坏"
      : `子进程在没有发出 complete 的情况下退出（code=${code ?? "null"}, signal=${signal ?? "null"}）`
    engine.stop("interrupted", new Error(detail ? `${reason}${String.fromCharCode(10)}${detail}` : reason))
  })

  const onAbort = () => {
    engine.stop("user")
    kill()
  }
  const onTimeout = () => {
    engine.stop("interrupted", new Error(`run 超过 ${input.timeoutMs} 毫秒仍未结束，已中止。`))
    kill()
  }
  const timer = input.timeoutMs && input.timeoutMs > 0 ? setTimeout(onTimeout, input.timeoutMs) : undefined
  if (input.signal) {
    if (input.signal.aborted) onAbort()
    else input.signal.addEventListener("abort", onAbort, { once: true })
  }

  const settlement = await engine.settled

  // 收尾：摘监听、关管道、杀进程、删入口文件。顺序无所谓，但一件都不能漏——
  // 漏掉 kill 会留下一个还在跑的子进程，漏掉删文件会在临时目录里堆脚本。
  clearTimeout(timer)
  input.signal?.removeEventListener("abort", onAbort)
  child.stdout.removeAllListeners("data")
  child.stderr.removeAllListeners("data")
  if (!child.stdin.destroyed) child.stdin.end()
  kill()
  await Promise.race([exitPromise, new Promise((resolve) => setTimeout(resolve, 2000))])
  try {
    rmSync(entryPath, { force: true })
  } catch {
    // 删不掉不影响结算；临时目录迟早会被系统清掉。
  }

  return { runId, settlement, journal }
}

/** 写入口文件。文件名用 run id，便于在临时目录里认出它属于哪次 run。 */
async function writeEntry(runId: string, input: RunWorkflowInput): Promise<string> {
  const dir = runtimeDirectory(input.runtimeDir)
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${runId.replace(/[^A-Za-z0-9._-]/g, "_")}.mjs`)
  writeFileSync(
    file,
    renderChildEntry({ lowered: input.prepared.lowered!.code, ...(input.args ? { args: input.args } : {}) }, { runId }),
    "utf8",
  )
  return file
}

/**
 * spawn 子进程。
 *
 * 用 `process.execPath`：Node 下是 node，Bun 下是 bun。两边都只依赖 node 内建（vm / readline），
 * 所以同一份入口文件不需要分支。
 *
 * 环境变量原样传下去：沙箱里的脚本碰不到 `process`（vm context 里没有这个全局），所以谈不上
 * 泄漏；而剥掉环境会让某些平台的启动器（例如 Windows 上的 bun）在自己初始化时出错。
 */
function spawnChild(entryPath: string): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, [entryPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
    windowsHide: true,
  })
}
