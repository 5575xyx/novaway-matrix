import { Effect, Exit, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Identifier } from "@/id/id"
import type { Interface as BackgroundJobInterface, Info } from "./job"
import type { Interface as MailboxInterface } from "@/team/mailbox"
import type { Interface as StatusInterface } from "@/session/status"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import type { SessionID } from "@/session/schema"

/**
 * Long-lived background watchers.
 *
 * `monitor` and `subscribe` are ordinary background jobs, but they share three
 * behaviours that must survive a process restart:
 *
 * - they record enough metadata to be restarted (`resumable: true`)
 * - they deliver a notification to the agent mailbox on completion
 * - they resume an idle session so the agent actually reads that notification
 *
 * The implementations live here (not in the tools) so `background/resume.ts`
 * can rebuild exactly the same job without duplicating the loop.
 */

export type PromptOps = {
  loop: (input: { sessionID: SessionID }) => Effect.Effect<unknown>
}

export type Deps = {
  background: BackgroundJobInterface
  mailbox?: MailboxInterface
  status?: StatusInterface
  spawner?: ChildProcessSpawner["Service"]
  http?: HttpClient.HttpClient
  ops?: PromptOps
}

export type MonitorInput = {
  /** 复用已有 job id。重启恢复时保持同一个 id，面板和模型看到的还是同一个任务。 */
  id?: string
  command: string
  pattern?: string
  timeout: number
  label: string
  sessionID: SessionID
  cwd?: string
  /** True when this run was rebuilt from a previous process. */
  resumed?: boolean
}

export type SubscribeInput = {
  /** 复用已有 job id。重启恢复时保持同一个 id，面板和模型看到的还是同一个任务。 */
  id?: string
  url: string
  match?: string
  every: number
  timeout: number
  label: string
  sessionID: SessionID
  headers?: Record<string, string>
  /** Headers were used; values are never persisted, so a resume needs them again. */
  auth?: boolean
  resumed?: boolean
}

const TAIL_LIMIT = 4_000
const BODY_LIMIT = 200_000
const EXCERPT = 1_500
/** 进度回写间隔。 */
const LIVE_INTERVAL = "2 seconds"

/** 最后一行非空输出。状态卡的进度槽和失败原因都靠它说话。 */
const lastOutputLine = (tail: string) => {
  const lines = tail
    .trimEnd()
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
  return lines[lines.length - 1]?.trim() ?? ""
}

/**
 * 一次监控的结局。
 *
 * `failed` 非空时 job 以 error 态结束而不是 completed——超时、被监控命令非 0
 * 退出以前一律被标成"已完成"，右侧状态卡就显示一个绿色的谎话。
 */
type WatchOutcome = {
  report: string
  failed?: string
}

/** Wakes an idle session so it reads the queued notification. */
const wake = (sessionID: SessionID, deps: Deps) =>
  Effect.gen(function* () {
    if (!deps.status) return
    if ((yield* deps.status.get(sessionID)).type !== "idle") return
    if (!deps.ops) return
    yield* deps.ops.loop({ sessionID }).pipe(Effect.ignore, Effect.forkDetach)
  })

const notify = (input: { sessionID: SessionID; deps: Deps; from: string; summary: string; content: string }) =>
  Effect.gen(function* () {
    if (!input.deps.mailbox) return
    yield* input.deps.mailbox.send({
      teamID: "default",
      fromSessionID: input.from as never,
      toSessionID: input.sessionID,
      summary: input.summary,
      content: input.content,
    })
    yield* wake(input.sessionID, input.deps)
  })

const monitorEffect = (
  input: MonitorInput,
  deps: Deps,
  regex: RegExp | undefined,
  jobID: string,
): Effect.Effect<WatchOutcome, unknown> =>
  Effect.gen(function* () {
    if (!deps.spawner) {
      return { report: "(monitor unavailable: no process spawner)", failed: "no process spawner available" } as const
    }
    const spawner = deps.spawner
    const state: { tail: string; matched?: string } = { tail: "" }

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(
          ChildProcess.make(input.command, [], {
            shell: true,
            cwd: input.cwd,
            stdin: "ignore",
            detached: process.platform !== "win32",
          }),
        )

        yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) => {
          state.tail = (state.tail + chunk).slice(-TAIL_LIMIT)
          if (!regex || state.matched) return Effect.void
          const line = state.tail.split(/\r?\n/).find((candidate) => regex.test(candidate))
          if (!line) return Effect.void
          state.matched = line
          return handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.ignore)
        }).pipe(Effect.forkScoped)

        // 面板轮询 job.output 才能看到进度。monitor 是长任务，没有这条线的话卡片上
        // 只有"运行中"，用户分不清它是在跑、卡住了还是早就死了。
        yield* Effect.forkScoped(
          Effect.forever(
            Effect.gen(function* () {
              yield* Effect.sleep(LIVE_INTERVAL)
              const line = lastOutputLine(state.tail)
              if (line) yield* deps.background.update(jobID, { output: line }).pipe(Effect.ignore)
            }),
          ),
        )

        const exit = yield* Effect.race(
          handle.exitCode.pipe(Effect.map((code) => ({ kind: "exit" as const, code }))),
          Effect.sleep(`${input.timeout} seconds`).pipe(Effect.map(() => ({ kind: "timeout" as const, code: null }))),
        )
        if (exit.kind === "timeout") yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.ignore)

        const matched = state.matched
        const tail = state.tail.trimEnd() || "(no output)"
        const report = [
          `<monitor-notification job="${input.label}">`,
          `command: ${input.command}`,
          `state: ${matched ? "matched" : exit.kind === "timeout" ? "timeout" : "exit"}${
            exit.kind === "exit" ? ` (code ${exit.code})` : ""
          }`,
          ...(matched ? [`matched: ${matched}`] : []),
          "output tail:",
          tail,
          "</monitor-notification>",
        ].join("\n")

        // 超时说明一直没等到想要的那一行；命令自己非 0 退出说明它跑挂了。
        // 两种都不是"监控成功"，不能记成 completed。
        if (exit.kind === "timeout") return { report, failed: `timed out after ${input.timeout}s without a match` }
        if (exit.kind === "exit" && !matched && exit.code !== 0) {
          // 带上最后一行输出：用户想知道的是"到底报了什么"，不只是退出码。
          const hint = lastOutputLine(tail)
          const reason = `command exited with code ${exit.code}`
          return { report, failed: hint ? `${reason}: ${hint.slice(0, 200)}` : reason }
        }
        return { report }
      }),
    )
  })

export const startMonitor = (input: MonitorInput, deps: Deps): Effect.Effect<Info> =>
  Effect.gen(function* () {
    const regex = input.pattern ? new RegExp(input.pattern) : undefined
    const id = input.id ?? Identifier.ascending("job")
    return yield* deps.background.start({
      id,
      type: "monitor",
      title: input.label,
      metadata: {
        command: input.command,
        pattern: input.pattern,
        timeout: input.timeout,
        sessionID: input.sessionID,
        // 会话归属键：卡片可见性（ownsBackgroundJob）、事件归属与取消清扫都认这两个键。
        // 驼峰 sessionID 是 resume 的读取键，保留不动。
        sessionId: input.sessionID,
        parentSessionId: input.sessionID,
        resumable: true,
        ...(input.resumed ? { resumed: true } : {}),
      },
      run: monitorEffect(input, deps, regex, id).pipe(
        Effect.tap((outcome) =>
          notify({
            sessionID: input.sessionID,
            deps,
            from: "monitor",
            summary: `monitor ${input.label}`,
            content: outcome.report,
          }).pipe(Effect.ignore),
        ),
        Effect.map((outcome) => ({
          output: outcome.report,
          ...(outcome.failed ? { failed: outcome.failed } : {}),
        })),
      ),
    })
  })

const subscribeEffect = (
  input: SubscribeInput,
  deps: Deps,
  regex: RegExp | undefined,
  jobID: string,
): Effect.Effect<WatchOutcome, unknown> =>
  Effect.gen(function* () {
    if (!deps.http) {
      return { report: "(subscribe unavailable: no http client)", failed: "no http client available" } as const
    }
    const http = deps.http
    let previous: string | undefined
    let matched: string | undefined
    let state: "matched" | "changed" | "timeout" = "timeout"
    let body = ""
    let polls = 0
    const budget = Math.max(1, Math.ceil(input.timeout / input.every))
    const deadline = Date.now() + input.timeout * 1000

    while (Date.now() < deadline) {
      polls++
      const request = HttpClientRequest.get(input.url).pipe(
        HttpClientRequest.setHeaders(input.headers ?? {}),
        HttpClientRequest.accept("application/json, text/plain, */*"),
      )
      // A failed poll (network blip, 5xx) must not end the subscription.
      const exit = yield* http.execute(request).pipe(Effect.timeout("30 seconds"), Effect.exit)
      if (Exit.isSuccess(exit)) {
        const text = yield* exit.value.text.pipe(
          Effect.map((value: string) => value.slice(0, BODY_LIMIT)),
          Effect.catch(() => Effect.succeed("")),
        )
        body = text
        if (regex) {
          const line = text.split(/\r?\n/).find((candidate: string) => regex.test(candidate)) ?? text.match(regex)?.[0]
          if (line) {
            matched = line
            state = "matched"
            break
          }
        } else if (previous !== undefined && text !== previous) {
          state = "changed"
          break
        }
        // 面板读 job.output 显示进度；订阅是长任务，没有这条线卡片上只有"运行中"。
        yield* deps.background
          .update(jobID, {
            output: `poll ${polls}/${budget}: ${previous === undefined ? "first response" : text === previous ? "unchanged" : "changed"}`,
          })
          .pipe(Effect.ignore)
        previous = text
      }
      yield* Effect.sleep(`${input.every} seconds`)
    }

    const report = [
      `<subscription-notification url="${input.url}">`,
      `label: ${input.label}`,
      `state: ${state}`,
      ...(matched ? [`matched: ${matched}`] : []),
      "body excerpt:",
      (body || "(empty response)").slice(0, EXCERPT),
      "</subscription-notification>",
    ].join("\n")

    // 轮询窗口走完仍然没有变化：订阅什么都没等到，不能记成 completed。
    if (state === "timeout") return { report, failed: `no response change after ${polls} polls (${input.timeout}s)` }
    return { report }
  })

export const startSubscribe = (input: SubscribeInput, deps: Deps): Effect.Effect<Info> =>
  Effect.gen(function* () {
    const regex = input.match ? new RegExp(input.match) : undefined
    const id = input.id ?? Identifier.ascending("job")
    return yield* deps.background.start({
      id,
      type: "subscribe",
      title: input.label,
      metadata: {
        command: input.url,
        url: input.url,
        pattern: input.match,
        every: input.every,
        timeout: input.timeout,
        // Header values are never written: a resume without them is refused
        // rather than silently polling unauthenticated.
        ...(input.auth ? { auth: true } : {}),
        sessionID: input.sessionID,
        sessionId: input.sessionID,
        parentSessionId: input.sessionID,
        resumable: true,
        ...(input.resumed ? { resumed: true } : {}),
      },
      run: subscribeEffect(input, deps, regex, id).pipe(
        Effect.tap((outcome) =>
          notify({
            sessionID: input.sessionID,
            deps,
            from: "subscribe",
            summary: `subscription ${input.label}`,
            content: outcome.report,
          }).pipe(Effect.ignore),
        ),
        Effect.map((outcome) => ({
          output: outcome.report,
          ...(outcome.failed ? { failed: outcome.failed } : {}),
        })),
      ),
    })
  })

export * as Watchers from "./watchers"
