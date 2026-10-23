import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { parse as parseJsonc } from "jsonc-parser"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { InstanceRef } from "@/effect/instance-ref"
import { EffectBridge } from "@/effect/bridge"
import { Global } from "@novaway/core/global"
import * as Log from "@novaway/core/util/log"
import * as Hook from "./schema"
import * as ExtensionLoader from "@/extension/loader"
import { Plugin } from "@/plugin"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { FileWatcher } from "@/file/watcher"
import { Event as PlanApprovalEvent } from "@/session/plan-approval"
import { matches, run } from "./exec"

const log = Log.create({ service: "hook" })

type State = {
  registrations: Hook.Registered[]
  loaded: boolean
}

/**
 * A hook that opted into progress reporting via `statusMessage`.
 *
 * Only hooks with a message are tracked: the status line exists to answer
 * "why is this turn slow?", and a hook that never declared a message has
 * nothing to say. Tracking the others would also cost bookkeeping on every
 * tool call for no visible benefit.
 */
export const Active = Schema.Struct({
  id: Schema.String,
  event: Schema.String,
  source: Schema.String,
  message: Schema.String,
  sessionID: Schema.optional(Schema.String),
  startedAt: Schema.Number,
}).annotate({ identifier: "HookActive" })
export type Active = Schema.Schema.Type<typeof Active>

export const Event = {
  /** Emitted when a hook with `statusMessage` starts or finishes. */
  ActiveChanged: BusEvent.define("hook.active", Schema.Array(Active)),
}

export interface Interface {
  readonly trigger: (input: Hook.TriggerInput) => Effect.Effect<Hook.Result>
  readonly register: (input: { config: Hook.Config; source: string; sessionID?: string }) => Effect.Effect<void>
  readonly list: () => Effect.Effect<Hook.Registered[]>
  /** Hooks currently running and reporting progress. */
  readonly active: () => Effect.Effect<Active[]>
  readonly reload: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/Hook") {}

const EMPTY: Hook.Result = { blocked: false, ran: false }

function merge(target: Hook.Result, next: Hook.Result): Hook.Result {
  const merged: Hook.Result = {
    ...target,
    blocked: target.blocked || next.blocked,
    ran: target.ran || next.ran,
    ...(next.decision ? { decision: next.decision } : {}),
    ...(next.reason ? { reason: next.reason } : {}),
    ...(next.updatedInput !== undefined ? { updatedInput: next.updatedInput } : {}),
    ...(next.additionalContext
      ? { additionalContext: [target.additionalContext, next.additionalContext].filter(Boolean).join("\n\n") }
      : {}),
  }
  if (next.decision === "deny") return { ...merged, blocked: true }
  return merged
}

function readJson(file: string) {
  return Effect.tryPromise({
    try: async () => {
      const text = await fs.readFile(file, "utf8")
      return parseJsonc(text) as Record<string, unknown>
    },
    catch: (error) => error,
  }).pipe(Effect.catch(() => Effect.succeed(undefined)))
}

function decodeConfig(value: unknown) {
  try {
    return Effect.succeed(Schema.decodeUnknownSync(Hook.Config)(value) as Hook.Config)
  } catch {
    return Effect.succeed({} as Hook.Config)
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<State>(
      Effect.fn("Hook.state")(function* () {
        return { registrations: [], loaded: false }
      }),
    )

    const collect = Effect.fn("Hook.collect")(function* () {
      const ctx = yield* InstanceState.context
      const dirs = [Global.Path.config, path.join(Global.Path.home, ".claude"), ctx.directory, ctx.worktree].filter(
        (item, index, all) => item && all.indexOf(item) === index,
      )

      const files = [
        ...dirs.flatMap((dir) => [path.join(dir, "hooks.json")]),
        ...dirs.flatMap((dir) => [path.join(dir, "settings.json"), path.join(dir, "novaway.json")]),
      ]

      const extensions = yield* Effect.promise(() =>
        ExtensionLoader.scanCached({
          config: Global.Path.config,
          home: Global.Path.home,
          directory: ctx.directory,
          worktree: ctx.worktree,
        }),
      ).pipe(Effect.catch(() => Effect.succeed([] as Awaited<ReturnType<typeof ExtensionLoader.scan>>)))
      for (const extension of extensions) {
        if (!extension.enabled) continue
        for (const relative of [extension.manifest.hooks, (extension.manifest.contributes ?? {}).hooks]) {
          if (typeof relative !== "string") continue
          files.push(path.resolve(extension.root, relative))
        }
        files.push(path.join(extension.root, "hooks", "hooks.json"))
      }

      const registrations: Hook.Registered[] = []
      for (const file of files) {
        const json = yield* readJson(file)
        if (!json) continue
        const raw = file.endsWith("hooks.json")
          ? json
          : typeof json.hooks === "object" && json.hooks
            ? (json.hooks as Record<string, unknown>)
            : undefined
        if (!raw) continue
        const config = yield* decodeConfig(raw)
        for (const [event, matchers] of Object.entries(config)) {
          for (const matcher of matchers) {
            registrations.push({
              event,
              matcher: matcher.matcher,
              source: file,
              hooks: matcher.hooks as Hook.Command[],
            })
          }
        }
      }
      return registrations
    })

    /**
     * Set once `attach` exists (trigger is defined below it, so a direct
     * reference would create a circular type). `ensure` only needs to kick the
     * subscription off; the work itself is idempotent.
     */
    let startWatching: (() => Effect.Effect<void>) | undefined

    const ensure = Effect.fn("Hook.ensure")(function* () {
      const s = yield* InstanceState.get(state)
      if (s.loaded) return s
      s.registrations = yield* collect()
      s.loaded = true
      // Subscribing is cheap and idempotent; do it once the first time hooks
      // are touched, so processes with no hooks pay nothing.
      if (s.registrations.length > 0 && startWatching) yield* startWatching().pipe(Effect.ignore)
      return s
    })

    // JS plugins are optional: minimal layer stacks run without them.
    const plugins = Option.getOrUndefined(yield* Effect.serviceOption(Plugin.Service))
    const bus = Option.getOrUndefined(yield* Effect.serviceOption(Bus.Service))
    // Layer construction always runs with an instance context, so this is the
    // working directory hooks should be resolved against.
    /**
     * Working directory for bridge-triggered hooks. Captured when `attach` runs
     * (inside an instance context) rather than at layer construction, because
     * layers are also built in contexts without an instance (tests, tooling).
     */
    let bridgeCwd: string | undefined

    /**
     * Bridge to legacy JS plugins.
     *
     * JSON hooks and JS plugins now share one pipeline: every event goes through
     * here, so a plugin can observe events that have no dedicated legacy hook
     * (SessionStart, Stop, SubagentStart/Stop, TaskCreated/Completed, ...) and
     * can still block by mutating `result.decision`.
     */
    const bridged = Effect.fn("Hook.bridged")(function* (input: Hook.TriggerInput) {
      if (!plugins) return EMPTY
      const output = {
        result: {} as {
          decision?: "allow" | "deny" | "ask"
          reason?: string
          updatedInput?: unknown
          additionalContext?: string
        },
      }
      const run = plugins
        .trigger("hook", { event: input.event, payload: { ...input } as Record<string, unknown> }, output)
        .pipe(Effect.catchCause(() => Effect.succeed(output)))
      yield* run
      const r = output.result
      if (!r || Object.keys(r).length === 0) return EMPTY
      return {
        blocked: r.decision === "deny",
        ran: true,
        ...(r.decision ? { decision: r.decision } : {}),
        ...(r.reason ? { reason: r.reason } : {}),
        ...(r.updatedInput !== undefined ? { updatedInput: r.updatedInput } : {}),
        ...(r.additionalContext ? { additionalContext: r.additionalContext } : {}),
      } satisfies Hook.Result
    })

    /**
     * Bus → hook bridge.
     *
     * `FileChanged` and `ConfigChange` have no natural code path inside the
     * hook layer, so we listen to kernel bus events instead. File events are
     * debounced and coalesced: a build touching 500 files must not spawn 500
     * hook processes.
     */
    const FileDebounceMs = 500
    const FileBatchMax = 50
    let attached = false
    const pendingFiles = new Set<string>()

    /** Assigned right after `trigger` is defined (circular reference). */
    let fireHooks: ((input: Hook.TriggerInput) => Effect.Effect<Hook.Result>) | undefined

    const flushFiles = Effect.fnUntraced(function* () {
      if (pendingFiles.size === 0) return
      const files = [...pendingFiles].slice(0, FileBatchMax)
      pendingFiles.clear()
      if (!fireHooks) return
      const s = yield* ensure()
      if (!s.registrations.some((item) => item.event === "FileChanged")) return
      yield* fireHooks({
        event: "FileChanged",
        cwd: bridgeCwd,
        metadata: { files, count: files.length },
      })
    })

    const attach = Effect.fnUntraced(function* () {
      if (attached || !bus) return
      attached = true
      bridgeCwd = (yield* InstanceState.context).directory
      // The bus callback is a plain JS function with no fiber context, so we
      // need a bridge to re-enter Effect with InstanceRef intact.
      const bridge = yield* EffectBridge.make()
      yield* bus.subscribeAllCallback((payload: { type: string; properties: unknown }) => {
        if (payload.type === FileWatcher.Event.Updated.type) {
          const file = (payload.properties as { file?: string } | undefined)?.file
          if (file) pendingFiles.add(file)
          return
        }
        if (payload.type === Config.Event.Updated.type) {
          if (!fireHooks) return
          const props = (payload.properties ?? {}) as Record<string, unknown>
          bridge.fork(fireHooks({ event: "ConfigChange", cwd: bridgeCwd, metadata: props }).pipe(Effect.ignore))
          return
        }
        if (payload.type === PlanApprovalEvent.Requested.type) {
          if (!fireHooks) return
          const props = (payload.properties ?? {}) as Record<string, unknown>
          bridge.fork(
            fireHooks({
              event: "Notification",
              sessionID: typeof props.sessionID === "string" ? props.sessionID : undefined,
              cwd: bridgeCwd,
              metadata: { kind: "plan_approval", ...props },
            }).pipe(Effect.ignore),
          )
        }
      })
      // Detached fiber: the hook service has no Scope of its own, and the
      // poller should live as long as the process.
      yield* Effect.forkDetach(
        Effect.forever(Effect.sleep(`${FileDebounceMs} millis`).pipe(Effect.andThen(flushFiles().pipe(Effect.ignore)))),
      )
    })
    startWatching = attach

    // Live progress for hooks that declared a `statusMessage`. Keyed by a
    // per-run counter so two registrations of the same hook do not collide.
    const running = new Map<string, Active>()
    let runCounter = 0
    const publishActive = Effect.suspend(() =>
      bus ? bus.publish(Event.ActiveChanged, [...running.values()]).pipe(Effect.ignore) : Effect.void,
    )

    const active: Interface["active"] = Effect.fn("Hook.active")(function* () {
      return [...running.values()]
    })

    const trigger = Effect.fn("Hook.trigger")(function* (input: Hook.TriggerInput) {
      // Fast path: most sessions have no hook files at all. Checking with
      // existsSync avoids directory walks and JSON parsing on every trigger.
      //
      // The project root counts even when the session itself moved: a
      // `hooks.json` next to the project must keep applying after `cwd` changes,
      // matching how `collect()` gathers files.
      const instance = Option.getOrUndefined(yield* Effect.serviceOption(InstanceRef))
      const dirs = [Global.Path.config, path.join(Global.Path.home, ".claude"), input.cwd ?? process.cwd()]
      if (instance) dirs.push(instance.directory, instance.worktree)
      const candidates = dirs
        .filter((dir): dir is string => !!dir)
        .flatMap((dir) => [
          path.join(dir, "hooks.json"),
          path.join(dir, "settings.json"),
          path.join(dir, "novaway.json"),
        ])
      if (!candidates.some((file) => existsSync(file))) return yield* bridged(input)

      const s = yield* ensure()
      // Plugins run first so a JSON hook can see (and override) their decision.
      let result: Hook.Result = yield* bridged(input)
      if (result.decision === "deny") return result
      for (const registration of s.registrations) {
        if (registration.event !== input.event) continue
        if (!matches(registration.matcher, input.tool)) continue
        for (const hook of registration.hooks) {
          const id = `hook_${++runCounter}`
          const message = hook.statusMessage
          if (message) {
            running.set(id, {
              id,
              event: registration.event,
              source: registration.source,
              message,
              ...(input.sessionID ? { sessionID: input.sessionID } : {}),
              startedAt: Date.now(),
            })
            yield* publishActive
          }
          const output = yield* run(hook, { ...input, args: result.updatedInput ?? input.args }).pipe(
            // `ensuring` keeps the status line accurate on failure too: a hook
            // that throws must not leave a spinner running forever.
            Effect.ensuring(
              message
                ? Effect.suspend(() => {
                    running.delete(id)
                    return publishActive
                  })
                : Effect.void,
            ),
          )
          result = merge(result, output)
          if (result.decision === "deny") return result
          if (hook.once && registration.hooks.length === 1) {
            s.registrations = s.registrations.filter((item) => item !== registration)
          }
        }
      }
      return result
    })

    fireHooks = (input: Hook.TriggerInput) => trigger(input)

    const register: Interface["register"] = Effect.fn("Hook.register")(function* (input) {
      const s = yield* ensure()
      for (const [event, matchers] of Object.entries(input.config)) {
        for (const matcher of matchers) {
          s.registrations.push({
            event,
            matcher: matcher.matcher,
            source: input.source,
            hooks: matcher.hooks as Hook.Command[],
          })
        }
      }
    })

    const list: Interface["list"] = Effect.fn("Hook.list")(function* () {
      const s = yield* ensure()
      return s.registrations.map((item) => ({ ...item }))
    })

    const reload: Interface["reload"] = Effect.fn("Hook.reload")(function* () {
      const s = yield* InstanceState.get(state)
      s.loaded = false
      s.registrations = []
      yield* ensure()
    })

    return Service.of({ trigger, register, list, active, reload })
  }),
)

export const defaultLayer = layer

export * as HookService from "./service"
