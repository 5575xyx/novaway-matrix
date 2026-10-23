import { Effect, Exit, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
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

const monitorEffect = (input: MonitorInput, deps: Deps, regex: RegExp | undefined) =>
  Effect.gen(function* () {
    if (!deps.spawner) return "(monitor unavailable: no process spawner)"
    const spawner = deps.spawner
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
        let tail = ""
        let matched: string | undefined

        yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) => {
          tail = (tail + chunk).slice(-TAIL_LIMIT)
          if (!regex || matched) return Effect.void
          const line = tail.split(/\r?\n/).find((candidate) => regex.test(candidate))
          if (!line) return Effect.void
          matched = line
          return handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.ignore)
        }).pipe(Effect.forkScoped)

        const exit = yield* Effect.race(
          handle.exitCode.pipe(Effect.map((code) => ({ kind: "exit" as const, code }))),
          Effect.sleep(`${input.timeout} seconds`).pipe(Effect.map(() => ({ kind: "timeout" as const, code: null }))),
        )
        if (exit.kind === "timeout") yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.ignore)

        const state = matched ? "matched" : exit.kind === "timeout" ? "timeout" : "exit"
        return [
          `<monitor-notification job="${input.label}">`,
          `command: ${input.command}`,
          `state: ${state}${exit.kind === "exit" ? ` (code ${exit.code})` : ""}`,
          ...(matched ? [`matched: ${matched}`] : []),
          "output tail:",
          tail.trimEnd() || "(no output)",
          "</monitor-notification>",
        ].join("\n")
      }),
    )
  })

export const startMonitor = (input: MonitorInput, deps: Deps): Effect.Effect<Info> =>
  Effect.gen(function* () {
    const regex = input.pattern ? new RegExp(input.pattern) : undefined
    return yield* deps.background.start({
      type: "monitor",
      title: input.label,
      metadata: {
        command: input.command,
        pattern: input.pattern,
        timeout: input.timeout,
        sessionID: input.sessionID,
        resumable: true,
        ...(input.resumed ? { resumed: true } : {}),
      },
      run: monitorEffect(input, deps, regex).pipe(
        Effect.tap((report) =>
          notify({
            sessionID: input.sessionID,
            deps,
            from: "monitor",
            summary: `monitor ${input.label}`,
            content: report,
          }).pipe(Effect.ignore),
        ),
      ),
    })
  })

const subscribeEffect = (input: SubscribeInput, deps: Deps, regex: RegExp | undefined) =>
  Effect.gen(function* () {
    if (!deps.http) return "(subscribe unavailable: no http client)"
    const http = deps.http
    let previous: string | undefined
    let matched: string | undefined
    let state: "matched" | "changed" | "timeout" = "timeout"
    let body = ""
    const deadline = Date.now() + input.timeout * 1000

    while (Date.now() < deadline) {
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
        previous = text
      }
      yield* Effect.sleep(`${input.every} seconds`)
    }

    return [
      `<subscription-notification url="${input.url}">`,
      `label: ${input.label}`,
      `state: ${state}`,
      ...(matched ? [`matched: ${matched}`] : []),
      "body excerpt:",
      (body || "(empty response)").slice(0, EXCERPT),
      "</subscription-notification>",
    ].join("\n")
  })

export const startSubscribe = (input: SubscribeInput, deps: Deps): Effect.Effect<Info> =>
  Effect.gen(function* () {
    const regex = input.match ? new RegExp(input.match) : undefined
    return yield* deps.background.start({
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
        resumable: true,
        ...(input.resumed ? { resumed: true } : {}),
      },
      run: subscribeEffect(input, deps, regex).pipe(
        Effect.tap((report) =>
          notify({
            sessionID: input.sessionID,
            deps,
            from: "subscribe",
            summary: `subscription ${input.label}`,
            content: report,
          }).pipe(Effect.ignore),
        ),
      ),
    })
  })

export * as Watchers from "./watchers"
