import { spawn } from "node:child_process"
import { Effect } from "effect"
import * as Log from "@novaway/core/util/log"
import { Provider } from "@/provider/provider"
import { Glob } from "@novaway/core/util/glob"
import type * as Hook from "./schema"

const log = Log.create({ service: "hook.exec" })

const DEFAULT_TIMEOUT_MS = 60_000

function payload(input: Hook.TriggerInput) {
  return {
    hook_event_name: input.event,
    session_id: input.sessionID,
    cwd: input.cwd ?? process.cwd(),
    tool_name: input.tool,
    tool_input: input.args,
    tool_result: input.result,
    error: input.error,
    prompt: input.prompt,
    ...(input.metadata ?? {}),
  }
}

function parseOutput(text: string): Partial<Hook.Result> {
  const trimmed = text.trim()
  if (!trimmed) return {}
  try {
    const json = JSON.parse(trimmed) as any
    const specific = json.hookSpecificOutput
    const decision = json.decision ?? specific?.permissionDecision
    return {
      ...(decision ? { decision } : {}),
      ...(json.reason || specific?.permissionDecisionReason
        ? { reason: json.reason ?? specific?.permissionDecisionReason }
        : {}),
      ...(specific?.updatedInput !== undefined ? { updatedInput: specific.updatedInput } : {}),
      ...(specific?.additionalContext ? { additionalContext: specific.additionalContext } : {}),
      ...(json.block === true ? { decision: "deny" as const, blocked: true } : {}),
      blocked: json.block === true || decision === "deny",
    }
  } catch {
    return {}
  }
}

function runCommand(command: string, input: Hook.TriggerInput, timeout: number): Effect.Effect<Hook.Result> {
  return Effect.tryPromise({
    try: () =>
      new Promise<Hook.Result>((resolve) => {
        const child = spawn(command, {
          shell: true,
          cwd: input.cwd ?? process.cwd(),
          env: {
            ...process.env,
            NOVAWAY_HOOK_EVENT: input.event,
            NOVAWAY_HOOK_SESSION_ID: input.sessionID ?? "",
            NOVAWAY_HOOK_TOOL: input.tool ?? "",
            CLAUDE_PROJECT_DIR: input.cwd ?? process.cwd(),
          },
          stdio: ["pipe", "pipe", "pipe"],
        })
        let stdout = ""
        let stderr = ""
        let done = false
        const finish = (result: Hook.Result) => {
          if (done) return
          done = true
          clearTimeout(timer)
          resolve(result)
        }
        const timer = setTimeout(() => {
          child.kill("SIGKILL")
          finish({ blocked: false, ran: true, reason: `hook timed out after ${timeout}ms` })
        }, timeout)

        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString()
        })
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString()
        })
        child.on("error", (error) => finish({ blocked: false, ran: true, reason: error.message }))
        child.on("close", (code) => {
          if (code === 2) {
            finish({ blocked: true, decision: "deny", ran: true, reason: stderr.trim() || "hook blocked the action" })
            return
          }
          if (code !== 0) {
            log.warn("hook command failed", { command, code, stderr: stderr.slice(0, 500) })
            finish({ blocked: false, ran: true, reason: stderr.trim() || undefined })
            return
          }
          const parsed = parseOutput(stdout)
          finish({ blocked: parsed.decision === "deny", ran: true, ...parsed })
        })

        child.stdin.end(JSON.stringify(payload(input)))
      }),
    catch: (error) => error,
  }).pipe(Effect.catch((error) => Effect.succeed({ blocked: false, ran: true, reason: String(error) })))
}

function interpolateHeaders(headers: Record<string, string> | undefined, allowed: readonly string[] | undefined) {
  if (!headers) return {}
  const pattern = new RegExp("\$(?:\{([A-Z0-9_]+)\}|([A-Z0-9_]+))", "g")
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      if (!allowed?.length) return [key, value]
      return [
        key,
        value.replace(pattern, (_match, a, b) => {
          const name: string = a ?? b
          return allowed.includes(name) ? (process.env[name] ?? "") : ""
        }),
      ]
    }),
  )
}

function runHttp(
  hook: Extract<Hook.Command, { type: "http" }>,
  input: Hook.TriggerInput,
  timeout: number,
): Effect.Effect<Hook.Result> {
  return Effect.tryPromise({
    try: async () => {
      const res = await fetch(hook.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...interpolateHeaders(hook.headers, hook.allowedEnvVars) },
        body: JSON.stringify(payload(input)),
        signal: AbortSignal.timeout(timeout),
      })
      const text = await res.text()
      if (!res.ok) {
        log.warn("hook http failed", { url: hook.url, status: res.status, body: text.slice(0, 500) })
        return { blocked: false, ran: true } satisfies Hook.Result
      }
      const parsed = parseOutput(text)
      return { blocked: parsed.decision === "deny", ran: true, ...parsed } satisfies Hook.Result
    },
    catch: (error) => error,
  }).pipe(Effect.catch((error) => Effect.succeed({ blocked: false, ran: true, reason: String(error) })))
}

function parsePromptDecision(text: string): Hook.Result {
  const raw = text.trim()
  let json: Record<string, unknown> | undefined
  const match = /\{[\s\S]*\}/.exec(raw)
  if (match) {
    try {
      json = JSON.parse(match[0]) as Record<string, unknown>
    } catch {
      json = undefined
    }
  }
  const decision = (json?.decision ?? json?.permissionDecision) as Hook.Result["decision"] | undefined
  const reason = typeof json?.reason === "string" ? json.reason : undefined
  if (decision) return { blocked: decision === "deny", decision, reason, ran: true }
  if (/\bdeny\b|\bblock\b|不允许|阻止/i.test(raw)) return { blocked: true, decision: "deny", reason: raw, ran: true }
  return { blocked: false, ran: true, ...(raw ? { reason: raw } : {}) }
}

function runPrompt(
  hook: Extract<Hook.Command, { type: "prompt" | "agent" }>,
  input: Hook.TriggerInput,
  timeout: number,
): Effect.Effect<Hook.Result> {
  return Effect.gen(function* () {
    const provider = yield* Effect.serviceOption(Provider.Service)
    if (provider._tag === "None") return { blocked: false, ran: false } as Hook.Result
    const model = yield* provider.value.defaultModel().pipe(Effect.catch(() => Effect.succeed(undefined)))
    if (!model) return { blocked: false, ran: false } as Hook.Result
    const resolved = hook.model
      ? yield* provider.value
          .getModel(model.providerID, hook.model as never)
          .pipe(Effect.catch(() => provider.value.getModel(model.providerID, model.modelID)))
      : yield* provider.value.getModel(model.providerID, model.modelID)
    const language = yield* provider.value.getLanguage(resolved)
    const prompt = hook.prompt.replace("$ARGUMENTS", JSON.stringify(payload(input)))
    const { generateText } = yield* Effect.promise(() => import("ai"))
    const result = yield* Effect.tryPromise({
      try: () =>
        generateText({
          model: language,
          prompt,
          maxOutputTokens: 500,
          abortSignal: AbortSignal.timeout(timeout),
        }),
      catch: (error) => error,
    })
    return parsePromptDecision(result.text)
  }).pipe(
    Effect.catch((error) => Effect.succeed({ blocked: false, ran: true, reason: String(error) } satisfies Hook.Result)),
  )
}

/** Wildcard match for `if` conditions, same syntax as permission patterns. */
function conditionMatches(condition: string, input: Hook.TriggerInput): boolean {
  const trimmed = condition.trim()
  if (!trimmed) return true
  // `Tool(args)` form: match the tool name, then the serialized arguments.
  const call = trimmed.match(/^([\w-]+)\((.*)\)$/)
  if (call) {
    const [, tool, argsPattern] = call
    if (input.tool !== tool) return false
    if (!argsPattern || argsPattern === "*") return true
    const args = JSON.stringify(input.args ?? {})
    return Glob.match(argsPattern, args) || args.includes(argsPattern)
  }
  // Bare form: match the tool name, or fall back to the serialized input so a
  // hook can key off a command/URL without inventing a new field.
  if (input.tool && (input.tool === trimmed || Glob.match(trimmed, input.tool))) return true
  const serialized = JSON.stringify(input)
  return Glob.match(trimmed, serialized) || serialized.includes(trimmed)
}

/**
 * Run one hook.
 *
 * `if` gates the hook before any work happens; `async` returns immediately and
 * discards the result, so a slow audit/log hook can never block the turn. Async
 * hooks cannot deny: there is no result to inspect by the time they finish.
 */
export function run(hook: Hook.Command, input: Hook.TriggerInput): Effect.Effect<Hook.Result> {
  const timeout = hook.timeout && hook.timeout > 0 ? hook.timeout * 1000 : DEFAULT_TIMEOUT_MS
  if (!conditionMatches(hook.if ?? "", input)) return Effect.succeed({ blocked: false, ran: false })
  const execute = (): Effect.Effect<Hook.Result> => {
    switch (hook.type) {
      case "command":
        return runCommand(hook.command, input, timeout)
      case "http":
        return runHttp(hook, input, timeout)
      case "prompt":
      case "agent":
        return runPrompt(hook, input, timeout)
    }
  }
  if (!("async" in hook && hook.async === true)) return execute()
  return execute().pipe(
    Effect.tapError((error) => Effect.logWarning("async hook failed", { error: String(error) })),
    Effect.ignore,
    Effect.forkDetach,
    Effect.as({ blocked: false, ran: true } satisfies Hook.Result),
  )
}

export function matches(matcher: string | undefined, value: string | undefined) {
  if (!matcher) return true
  if (!value) return false
  if (matcher === "*") return true
  try {
    return new RegExp("^(?:" + matcher + ")$").test(value)
  } catch {
    return matcher === value
  }
}
