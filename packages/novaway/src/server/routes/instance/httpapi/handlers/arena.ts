import { Effect, Schema } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { Arena, type ContenderSpec } from "@/arena/arena"
import { ArenaStore, type ArenaContenderRow, type ArenaRunRow, type ArenaRunSummary } from "@/arena/store"
import { Config } from "@/config/config"
import { ConfigArena } from "@/config/arena"
import { makeRunAgent } from "@/session/agent-step"
import { Agent } from "@/agent/agent"
import { Session } from "@/session/session"
import { SessionPrompt } from "@/session/prompt"
import { InstanceRef } from "@/effect/instance-ref"
import { commit, create, cumulativeDiff, remove } from "@/team/worktree"
import { execute } from "@/team/command-verifier"
import { InstanceHttpApi } from "../api"
import { ArenaContenderView, ArenaDiffView, ArenaRunView } from "../groups/arena"

type ContenderView = Schema.Schema.Type<typeof ArenaContenderView>
type DiffView = Schema.Schema.Type<typeof ArenaDiffView>
type RunView = Schema.Schema.Type<typeof ArenaRunView>

const number = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback

/**
 * 落库的 diff 是运行期写进去的 JSON;老版本或缺字段的记录按不可信输入处理:
 * 结构不对就当没有,不补默认值编一份假 diff。
 */
const toDiff = (value: unknown): DiffView | undefined => {
  if (!value || typeof value !== "object") return undefined
  const files: unknown = Reflect.get(value, "files")
  const untracked: unknown = Reflect.get(value, "untracked")
  const baseSHA: unknown = Reflect.get(value, "baseSHA")
  const head: unknown = Reflect.get(value, "head")
  if (typeof baseSHA !== "string" || typeof head !== "string" || !Array.isArray(files)) return undefined
  return {
    baseSHA,
    head,
    files: files.flatMap((item: unknown) => {
      if (!item || typeof item !== "object") return []
      const path: unknown = Reflect.get(item, "path")
      if (typeof path !== "string") return []
      return [
        {
          path,
          added: number(Reflect.get(item, "added")),
          removed: number(Reflect.get(item, "removed")),
          binary: Reflect.get(item, "binary") === true,
        },
      ]
    }),
    untracked: Array.isArray(untracked)
      ? untracked.filter((item: unknown): item is string => typeof item === "string")
      : [],
    truncated: Reflect.get(value, "truncated") === true,
  }
}

const toUsage = (value: unknown) => {
  if (!value || typeof value !== "object") return undefined
  const cost: unknown = Reflect.get(value, "cost")
  const tokens: unknown = Reflect.get(value, "tokens")
  if (typeof cost !== "number" || typeof tokens !== "number") return undefined
  return { cost, tokens }
}

const toRun = (run: ArenaRunRow, contenders: number): RunView => ({
  id: run.id,
  task: run.task,
  status: run.status,
  ...(run.winner ? { winner: run.winner } : {}),
  verified: run.verified,
  ...(run.note ? { note: run.note } : {}),
  createdAt: run.created_at.toISOString(),
  contenders,
})

const toContender = (row: ArenaContenderRow): ContenderView => {
  const diff = toDiff(row.diff)
  const usage = toUsage(row.usage)
  return {
    id: row.contender_id,
    status: row.status,
    ...(row.session_id ? { sessionID: row.session_id } : {}),
    ...(row.directory ? { directory: row.directory } : {}),
    ...(row.text ? { text: row.text } : {}),
    ...(diff ? { diff } : {}),
    ...(usage ? { usage } : {}),
    ...(row.error ? { error: row.error } : {}),
    ...(row.duration_ms !== null ? { durationMs: row.duration_ms } : {}),
    ...(row.verdict === "pass" || row.verdict === "fail" ? { verdict: row.verdict } : {}),
    ...(row.score !== null ? { score: row.score } : {}),
  }
}

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "contender"
  )
}

function parseModel(value: string): ContenderSpec["model"] | undefined {
  const index = value.indexOf("/")
  if (index <= 0 || index === value.length - 1) return undefined
  return { providerID: value.slice(0, index), modelID: value.slice(index + 1) }
}

export const arenaHandlers = HttpApiBuilder.group(InstanceHttpApi, "arena", (handlers) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const prompt = yield* SessionPrompt.Service
    const instance = yield* InstanceRef

    return handlers
      .handle("runArena", (ctx) =>
        Effect.gen(function* () {
          const cfg = yield* config.get()
          const arena = ConfigArena.resolve(cfg.arena)
          if (!arena.enabled) return yield* new HttpApiError.BadRequest({})
          const task = ctx.payload.task.trim()
          if (!task) return yield* new HttpApiError.BadRequest({})
          if (!instance) return yield* new HttpApiError.BadRequest({})
          const models = arena.models.map(parseModel)
          if (models.some((item) => !item)) return yield* new HttpApiError.BadRequest({})
          const contenders = models.flatMap((model, index) => (model ? [{ id: slug(arena.models[index]), model }] : []))
          if (contenders.length === 0 || contenders.length > arena.max_contenders)
            return yield* new HttpApiError.BadRequest({})
          const fallback = contenders[0]?.model
          if (!fallback) return yield* new HttpApiError.BadRequest({})
          const root = yield* sessions.create({
            title: `Arena: ${task.slice(0, 40)}`,
            ...(cfg.default_agent ? { agent: cfg.default_agent } : {}),
          })
          const runID = `arena-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
          const runAgent = makeRunAgent({
            ops: {
              resolvePromptParts: (template) => prompt.resolvePromptParts(template),
              prompt: (input) => prompt.prompt(input).pipe(Effect.orDie),
            },
            sessions,
            agents,
            parentSessionID: root.id,
            defaultModel: fallback,
            defaultAgent: root.agent ?? cfg.default_agent ?? "build",
          })
          const result = yield* Arena.run(
            {
              runID,
              task,
              contenders,
              concurrency: Math.min(ctx.payload.concurrency ?? arena.concurrency, arena.max_contenders),
              keepWorktrees: ctx.payload.keepWorktrees ?? arena.keep_worktrees,
            },
            {
              createWorktree: ({ name }) => Effect.promise(() => create({ base: instance.directory, runID, name })),
              runAgent,
              commit: ({ directory }) =>
                Effect.promise(() => commit({ directory, message: `arena ${runID}: ${task.slice(0, 60)}` })),
              diff: ({ directory, baseSHA }) => Effect.promise(() => cumulativeDiff({ directory, baseSHA })),
              removeWorktree: ({ base: repository, directory, branch }) =>
                Effect.promise(() => remove({ base: repository, directory, branch })),
            },
          ).pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
          yield* Effect.sync(() => ArenaStore.record(result)).pipe(Effect.ignore)
          const detail = yield* Effect.sync(() => ArenaStore.get(result.runID))
          if (!detail) return yield* new HttpApiError.BadRequest({})
          return { run: toRun(detail.run, detail.contenders.length), results: detail.contenders.map(toContender) }
        }),
      )
      .handle("listArenaRuns", () =>
        Effect.sync(() => ArenaStore.list().map((item: ArenaRunSummary) => toRun(item.run, item.contenders))),
      )
      .handle("getArenaRun", (ctx) =>
        Effect.gen(function* () {
          const detail = yield* Effect.sync(() => ArenaStore.get(ctx.params.runID))
          if (!detail) return yield* Effect.fail(new HttpApiError.NotFound({}))
          return { run: toRun(detail.run, detail.contenders.length), results: detail.contenders.map(toContender) }
        }),
      )
  }),
)
