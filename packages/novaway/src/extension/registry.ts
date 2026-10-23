import fs from "node:fs/promises"
import path from "node:path"
import { Context, Effect, Layer } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { Global } from "@novaway/core/global"
import * as Log from "@novaway/core/util/log"
import * as Loader from "./loader"
import * as Schema from "./schema"
import * as Validate from "./validate"
import * as Lock from "./lock"
import * as Package from "./package"
import { InstallationVersion } from "@novaway/core/installation/version"
import type { Contribution, Loaded } from "./schema"

const log = Log.create({ service: "extension" })

type State = {
  loaded: Loaded[]
  disabled: string[]
  changes: Record<string, Lock.Change>
  at: number
}

export interface Interface {
  readonly list: () => Effect.Effect<Loaded[]>
  readonly reload: () => Effect.Effect<Loaded[]>
  readonly contributions: () => Effect.Effect<Array<Contribution & { extension: string; root: string }>>
  readonly setEnabled: (name: string, enabled: boolean) => Effect.Effect<void>
  /** Validation issues keyed by extension name. */
  readonly issues: () => Effect.Effect<Record<string, Validate.Issue[]>>
  /** Change status versus the last recorded load (added/upgraded/...). */
  readonly changes: () => Effect.Effect<Record<string, Lock.Change>>
  /** On-demand content fingerprint for one extension (files/bytes/hash). */
  readonly integrity: (name: string) => Effect.Effect<Package.Fingerprint | undefined>
  /** Directories that should be scanned for commands/agents/skills. */
  readonly directories: () => Effect.Effect<string[]>
  /** Hook configurations contributed by extensions. */
  readonly hooks: () => Effect.Effect<Array<{ name: string; root: string; config: unknown }>>
  /** Tool module paths contributed by extensions. */
  readonly tools: () => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@NovaWay/Extension") {}

const stateFile = () => path.join(Global.Path.config, "extensions.json")

async function readDisabled() {
  try {
    const text = await fs.readFile(stateFile(), "utf8")
    const json = JSON.parse(text) as { disabled?: string[] }
    return Array.isArray(json.disabled) ? json.disabled.filter((item) => typeof item === "string") : []
  } catch {
    return []
  }
}

async function writeDisabled(disabled: string[]) {
  await fs.mkdir(Global.Path.config, { recursive: true })
  await fs.writeFile(stateFile(), JSON.stringify({ disabled }, null, 2))
}

async function walkFiles(dir: string, extension: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const result: string[] = []
    for (const entry of entries) {
      const target = path.join(dir, entry.name)
      if (["node_modules", ".git", "dist", "build", ".cache"].includes(entry.name)) continue
      if (entry.isDirectory()) {
        result.push(...(await walkFiles(target, extension)))
        continue
      }
      if (entry.name.endsWith(extension)) result.push(target)
    }
    return result
  } catch {
    return []
  }
}

function expand(loaded: Loaded): Array<Contribution & { extension: string; root: string }> {
  const result: Array<Contribution & { extension: string; root: string }> = []
  for (const item of Schema.contributions(loaded)) {
    result.push({ ...item, extension: loaded.name, root: loaded.root })
  }
  return result
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<State>(
      Effect.fn("Extension.state")(function* () {
        return { loaded: [], disabled: [], changes: {}, at: 0 }
      }),
    )

    const load = Effect.fn("Extension.load")(function* () {
      const ctx = yield* InstanceState.context
      const disabled = yield* Effect.promise(readDisabled)
      yield* Effect.sync(() => Loader.invalidateCache())
      const loaded = yield* Effect.promise(() =>
        Loader.scan({
          config: Global.Path.config,
          home: Global.Path.home,
          directory: ctx.directory,
          worktree: ctx.worktree,
          disabled,
        }),
      )
      const s = yield* InstanceState.get(state)
      s.loaded = loaded
      s.disabled = disabled
      s.at = Date.now()

      // Record what we loaded so the next boot can report upgrades/edits.
      const previous = yield* Effect.promise(() => Lock.read(Global.Path.config))
      const next = Lock.build(loaded, previous)
      const changes = Lock.diff(previous, next)
      s.changes = Object.fromEntries(
        changes.filter((item) => item.change !== "unchanged").map((item) => [item.name, item.change]),
      )
      if (changes.length > 0) {
        log.info("extension changes", {
          changes: changes.filter((item) => item.change !== "unchanged").map((item) => `${item.name}:${item.change}`),
        })
      }
      const changed = JSON.stringify(previous.entries) !== JSON.stringify(next.entries) || previous.updatedAt === 0
      if (changed) yield* Effect.promise(() => Lock.write(Global.Path.config, next))

      for (const item of loaded) {
        if (item.error) log.warn("failed to read extension manifest", { root: item.root, error: item.error })
      }
      return loaded
    })

    const ensure = Effect.fn("Extension.ensure")(function* () {
      const s = yield* InstanceState.get(state)
      if (s.at > 0) return s
      yield* load()
      return yield* InstanceState.get(state)
    })

    const list: Interface["list"] = Effect.fn("Extension.list")(function* () {
      const s = yield* ensure()
      return s.loaded
    })

    const reload: Interface["reload"] = Effect.fn("Extension.reload")(function* () {
      return yield* load()
    })

    const contributions: Interface["contributions"] = Effect.fn("Extension.contributions")(function* () {
      const s = yield* ensure()
      const all = s.loaded.filter((item) => item.enabled).flatMap(expand)
      // Conventional paths are inferred, not declared: drop the ones that do
      // not exist so the UI does not advertise empty contribution points.
      const optional = new Set<string>([
        ...Schema.CONVENTIONAL.commands,
        ...Schema.CONVENTIONAL.agents,
        ...Schema.CONVENTIONAL.skills,
        ...Schema.CONVENTIONAL.tools,
      ])
      return yield* Effect.forEach(all, (item) =>
        Effect.gen(function* () {
          if (item.kind === "mcp" || !("path" in item) || !optional.has(item.path)) return item
          const exists = yield* Effect.promise(() =>
            fs
              .access(path.resolve(item.root, item.path))
              .then(() => true)
              .catch(() => false),
          )
          return exists ? item : undefined
        }),
      ).pipe(Effect.map((items) => items.filter((item) => item !== undefined)))
    })

    const directories: Interface["directories"] = Effect.fn("Extension.directories")(function* () {
      const s = yield* ensure()
      return s.loaded.filter((item) => item.enabled).map((item) => item.root)
    })

    const hooks: Interface["hooks"] = Effect.fn("Extension.hooks")(function* () {
      const list = yield* contributions()
      return yield* Effect.forEach(list, (item) =>
        Effect.gen(function* () {
          if (item.kind !== "hook") return undefined
          const file = path.resolve(item.root, item.path)
          const text = yield* Effect.promise(() => fs.readFile(file, "utf8")).pipe(
            Effect.catch(() => Effect.succeed(undefined)),
          )
          if (!text) return undefined
          try {
            const json = JSON.parse(text)
            const config = typeof json === "object" && json && "hooks" in json ? json.hooks : json
            return { name: item.extension, root: item.root, config }
          } catch {
            return undefined
          }
        }),
      ).pipe(Effect.map((items) => items.filter((item) => item !== undefined)))
    })

    const tools: Interface["tools"] = Effect.fn("Extension.tools")(function* () {
      const list = yield* contributions()
      const result: string[] = []
      for (const item of list) {
        if (item.kind !== "tool") continue
        const target = path.resolve(item.root, item.path)
        const stat = yield* Effect.promise(() => fs.stat(target)).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (!stat) continue
        if (stat.isDirectory()) {
          result.push(...(yield* Effect.promise(() => walkFiles(target, ".ts"))))
          result.push(...(yield* Effect.promise(() => walkFiles(target, ".js"))))
        } else {
          result.push(target)
        }
      }
      return result
    })

    const issues: Interface["issues"] = Effect.fn("Extension.issues")(function* () {
      const s = yield* ensure()
      const result: Record<string, Validate.Issue[]> = {}
      for (const item of s.loaded) {
        const found = yield* Effect.promise(() => Validate.validate(item, s.loaded, InstallationVersion))
        if (found.length > 0) result[item.name] = found
      }
      return result
    })

    const changes: Interface["changes"] = Effect.fn("Extension.changes")(function* () {
      const s = yield* ensure()
      return { ...s.changes }
    })

    const integrity: Interface["integrity"] = Effect.fn("Extension.integrity")(function* (name) {
      const s = yield* ensure()
      const match = s.loaded.find((item) => item.name === name)
      if (!match) return undefined
      return yield* Effect.promise(() => Package.fingerprint(match.root))
    })

    const setEnabled: Interface["setEnabled"] = Effect.fn("Extension.setEnabled")(function* (name, enabled) {
      const s = yield* ensure()
      const next = new Set(s.disabled)
      if (enabled) next.delete(name)
      else next.add(name)
      yield* Effect.promise(() => writeDisabled([...next]))
      yield* load()
    })

    return Service.of({
      list,
      reload,
      contributions,
      setEnabled,
      directories,
      hooks,
      tools,
      issues,
      changes,
      integrity,
    })
  }),
)

export const defaultLayer = layer

export * as ExtensionRegistry from "./registry"
