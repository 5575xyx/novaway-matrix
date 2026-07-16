import path from "path"
import matter from "gray-matter"
import { Effect, Layer, Context } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Flag } from "@opencode-ai/core/flag/flag"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { Global } from "@opencode-ai/core/global"
import type { MessageV2 } from "./message-v2"
import type { MessageID } from "./schema"
import BUILTIN_DATABASE_RULE from "./prompt/database-rule.txt"

const files = (disableClaudeCodePrompt: boolean) => [
  "AGENTS.md",
  ...(disableClaudeCodePrompt ? [] : ["CLAUDE.md"]),
  "CONTEXT.md", // deprecated
]

function extract(messages: MessageV2.WithParts[]) {
  const paths = new Set<string>()
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "tool" && part.tool === "read" && part.state.status === "completed") {
        if (part.state.time.compacted) continue
        const loaded = part.state.metadata?.loaded
        if (!loaded || !Array.isArray(loaded)) continue
        for (const p of loaded) {
          if (typeof p === "string") paths.add(p)
        }
      }
    }
  }
  return paths
}

export interface Interface {
  readonly clear: (messageID: MessageID) => Effect.Effect<void>
  readonly systemPaths: () => Effect.Effect<Set<string>, AppFileSystem.Error>
  readonly system: (input?: { prompt?: string }) => Effect.Effect<string[], AppFileSystem.Error>
  readonly find: (dir: string) => Effect.Effect<string | undefined, AppFileSystem.Error>
  readonly resolve: (
    messages: MessageV2.WithParts[],
    filepath: string,
    messageID: MessageID,
  ) => Effect.Effect<{ filepath: string; content: string }[], AppFileSystem.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Instruction") {}

type RuleTrigger = "always" | "mention" | "auto"

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalizeText(value: string) {
  return value.toLocaleLowerCase()
}

function isRulePath(filepath: string) {
  const segments = path.normalize(filepath).split(path.sep)
  return path.extname(filepath) === ".md" && segments.at(-2) === "rules"
}

function ruleTrigger(value: unknown): RuleTrigger {
  if (value === "mention" || value === "auto") return value
  return "always"
}

function isMentioned(prompt: string, name: string) {
  return new RegExp(`(^|\\s)@${escapeRegExp(name)}(?=$|\\s|[,.，。:：;；!?！？])`, "i").test(prompt)
}

function autoTerms(input: { name: string; description?: string; content: string }) {
  const source = [
    input.name.replace(/[_.-]+/g, " "),
    input.description ?? "",
    input.content.match(/^#\s+(.+)$/m)?.[1] ?? "",
  ].join(" ")
  return Array.from(
    new Set(source.match(/[\p{Script=Han}]{2,}|[\p{Letter}\p{Number}][\p{Letter}\p{Number}_.-]{2,}/gu) ?? []),
  )
    .map((item) => normalizeText(item))
    .filter((item) => item.length >= 2)
}

function parseRule(content: string): { data: Record<string, unknown>; content: string } {
  try {
    const parsed = matter(content)
    return { data: parsed.data as Record<string, unknown>, content: parsed.content }
  } catch {
    return { data: {}, content }
  }
}

export const layer: Layer.Layer<
  Service,
  never,
  AppFileSystem.Service | Config.Service | Global.Service | HttpClient.HttpClient | RuntimeFlags.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const fs = yield* AppFileSystem.Service
    const global = yield* Global.Service
    const flags = yield* RuntimeFlags.Service
    const http = HttpClient.filterStatusOk(withTransientReadRetry(yield* HttpClient.HttpClient))
    const globalFiles = [
      path.join(global.config, "AGENTS.md"),
      ...(!flags.disableClaudeCodePrompt ? [path.join(global.home, ".claude", "CLAUDE.md")] : []),
    ]
    const instructionFiles = files(flags.disableClaudeCodePrompt)

    const state = yield* InstanceState.make(
      Effect.fn("Instruction.state")(() =>
        Effect.succeed({
          // Track which instruction files have already been attached for a given assistant message.
          claims: new Map<MessageID, Set<string>>(),
        }),
      ),
    )

    const relative = Effect.fnUntraced(function* (instruction: string) {
      const ctx = yield* InstanceState.context
      if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
        return yield* fs
          .globUp(instruction, ctx.directory, ctx.worktree)
          .pipe(Effect.catch(() => Effect.succeed([] as string[])))
      }
      return yield* fs
        .globUp(instruction, global.config, global.config)
        .pipe(Effect.catch(() => Effect.succeed([] as string[])))
    })

    const read = Effect.fnUntraced(function* (filepath: string) {
      return yield* fs.readFileString(filepath).pipe(Effect.catch(() => Effect.succeed("")))
    })

    const fetch = Effect.fnUntraced(function* (url: string) {
      const res = yield* http.execute(HttpClientRequest.get(url)).pipe(
        Effect.timeout(5000),
        Effect.catch(() => Effect.succeed(null)),
      )
      if (!res) return ""
      const body = yield* res.arrayBuffer.pipe(Effect.catch(() => Effect.succeed(new ArrayBuffer(0))))
      return new TextDecoder().decode(body)
    })

    const clear = Effect.fn("Instruction.clear")(function* (messageID: MessageID) {
      const s = yield* InstanceState.get(state)
      s.claims.delete(messageID)
    })

    const systemPaths = Effect.fn("Instruction.systemPaths")(function* () {
      const config = yield* cfg.get()
      const ctx = yield* InstanceState.context
      const paths = new Set<string>()

      for (const file of globalFiles) {
        if (yield* fs.existsSafe(file)) {
          paths.add(path.resolve(file))
          break
        }
      }

      // The first project-level match wins so we don't stack AGENTS.md/CLAUDE.md from every ancestor.
      if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
        for (const file of instructionFiles) {
          const matches = yield* fs
            .findUp(file, ctx.directory, ctx.worktree)
            .pipe(Effect.catch(() => Effect.succeed([])))
          if (matches.length > 0) {
            matches.forEach((item) => paths.add(path.resolve(item)))
            break
          }
        }
      }

      if (config.instructions) {
        for (const raw of config.instructions) {
          if (raw.startsWith("https://") || raw.startsWith("http://")) continue
          const instruction = raw.startsWith("~/") ? path.join(global.home, raw.slice(2)) : raw
          const matches = yield* (
            path.isAbsolute(instruction)
              ? fs.glob(path.basename(instruction), {
                  cwd: path.dirname(instruction),
                  absolute: true,
                  include: "file",
                })
              : relative(instruction)
          ).pipe(Effect.catch(() => Effect.succeed([] as string[])))
          matches.forEach((item) => paths.add(path.resolve(item)))
        }
      }

      const globalRules = yield* fs
        .glob("rules/*.md", {
          cwd: global.config,
          absolute: true,
          include: "file",
          dot: true,
          symlink: true,
        })
        .pipe(Effect.catch(() => Effect.succeed([] as string[])))
      globalRules.forEach((item) => paths.add(path.resolve(item)))

      if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
        const root = ctx.worktree === "/" ? ctx.directory : ctx.worktree
        const projectRules = yield* fs
          .glob("rules/*.md", {
            cwd: path.join(root, ".novaway"),
            absolute: true,
            include: "file",
            dot: true,
            symlink: true,
          })
          .pipe(Effect.catch(() => Effect.succeed([] as string[])))
        projectRules.forEach((item) => paths.add(path.resolve(item)))
      }

      for (const dir of yield* cfg.directories()) {
        const matches = yield* fs
          .glob("rules/*.md", {
            cwd: dir,
            absolute: true,
            include: "file",
            dot: true,
            symlink: true,
          })
          .pipe(Effect.catch(() => Effect.succeed([] as string[])))
        matches.forEach((item) => paths.add(path.resolve(item)))
      }

      return paths
    })

    const system = Effect.fn("Instruction.system")(function* (input?: { prompt?: string }) {
      const config = yield* cfg.get()
      const paths = yield* systemPaths()
      const urls = (config.instructions ?? []).filter(
        (item) => item.startsWith("https://") || item.startsWith("http://"),
      )

      const files = yield* Effect.forEach(Array.from(paths), read, { concurrency: 8 })
      const remote = yield* Effect.forEach(urls, fetch, { concurrency: 4 })
      const prompt = input?.prompt?.trim()

      return [
        // Built-in global rules ship with the binary
        ...(BUILTIN_DATABASE_RULE
          ? [`Instructions from: <built-in>/database.md\n${BUILTIN_DATABASE_RULE.trimEnd()}`]
          : []),
        ...Array.from(paths).flatMap((item, i) => {
          const content = files[i]
          if (!content) return []
          if (!prompt || !isRulePath(item)) return [`Instructions from: ${item}\n${content}`]

          const parsed = parseRule(content)
          const name = path.basename(item, ".md")
          const trigger = ruleTrigger(parsed.data.trigger)
          if (trigger === "mention" && !isMentioned(prompt, name)) return []
          if (trigger === "auto") {
            const normalized = normalizeText(prompt)
            const terms = autoTerms({
              name,
              description: typeof parsed.data.description === "string" ? parsed.data.description : undefined,
              content: parsed.content,
            })
            if (!isMentioned(prompt, name) && !terms.some((term) => normalized.includes(term))) return []
          }
          return [`Instructions from: ${item}\n${parsed.content.trimEnd()}`]
        }),
        ...urls.flatMap((item, i) => (remote[i] ? [`Instructions from: ${item}\n${remote[i]}`] : [])),
      ]
    })

    const find = Effect.fn("Instruction.find")(function* (dir: string) {
      for (const file of instructionFiles) {
        const filepath = path.resolve(path.join(dir, file))
        if (yield* fs.existsSafe(filepath)) return filepath
      }
      return undefined
    })

    const resolve = Effect.fn("Instruction.resolve")(function* (
      messages: MessageV2.WithParts[],
      filepath: string,
      messageID: MessageID,
    ) {
      const sys = yield* systemPaths()
      const already = extract(messages)
      const results: { filepath: string; content: string }[] = []
      const s = yield* InstanceState.get(state)
      const root = path.resolve(yield* InstanceState.directory)

      const target = path.resolve(filepath)
      let current = path.dirname(target)

      // Walk upward from the file being read and attach nearby instruction files once per message.
      while (current.startsWith(root) && current !== root) {
        const found = yield* find(current)
        if (!found || found === target || sys.has(found) || already.has(found)) {
          current = path.dirname(current)
          continue
        }

        let set = s.claims.get(messageID)
        if (!set) {
          set = new Set()
          s.claims.set(messageID, set)
        }
        if (set.has(found)) {
          current = path.dirname(current)
          continue
        }

        set.add(found)
        const content = yield* read(found)
        if (content) {
          results.push({ filepath: found, content: `Instructions from: ${found}\n${content}` })
        }

        current = path.dirname(current)
      }

      return results
    })

    return Service.of({ clear, systemPaths, system, find, resolve })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(Global.layer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(RuntimeFlags.defaultLayer),
)

export function loaded(messages: MessageV2.WithParts[]) {
  return extract(messages)
}

export * as Instruction from "./instruction"
