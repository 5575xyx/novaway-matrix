import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/arena"

export const ArenaFileView = Schema.Struct({
  path: Schema.String,
  added: Schema.Number,
  removed: Schema.Number,
  binary: Schema.Boolean,
}).annotate({ identifier: "ArenaFileView" })

export const ArenaDiffView = Schema.Struct({
  baseSHA: Schema.String,
  head: Schema.String,
  files: Schema.Array(ArenaFileView),
  untracked: Schema.Array(Schema.String),
  truncated: Schema.Boolean,
}).annotate({ identifier: "ArenaDiffView" })

export const ArenaContenderView = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["completed", "failed", "skipped"]),
  sessionID: Schema.optional(Schema.String),
  /** 保留的 worktree;删除过的运行没有这一项。 */
  directory: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  diff: Schema.optional(ArenaDiffView),
  usage: Schema.optional(Schema.Struct({ cost: Schema.Number, tokens: Schema.Number })),
  error: Schema.optional(Schema.String),
  durationMs: Schema.optional(Schema.Number),
  verdict: Schema.optional(Schema.Literals(["pass", "fail"])),
  score: Schema.optional(Schema.Number),
}).annotate({ identifier: "ArenaContenderView" })

export const ArenaRunView = Schema.Struct({
  id: Schema.String,
  task: Schema.String,
  status: Schema.String,
  winner: Schema.optional(Schema.String),
  verified: Schema.Boolean,
  note: Schema.optional(Schema.String),
  createdAt: Schema.String,
  contenders: Schema.Number,
}).annotate({ identifier: "ArenaRunView" })

export const ArenaRunDetailView = Schema.Struct({
  run: ArenaRunView,
  results: Schema.Array(ArenaContenderView),
}).annotate({ identifier: "ArenaRunDetailView" })

export const ArenaRunInput = Schema.Struct({
  task: Schema.String,
  concurrency: Schema.optional(Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(16))),
  keepWorktrees: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "ArenaRunInput" })

export const ArenaApi = HttpApiGroup.make("arena")
  .add(
    HttpApiEndpoint.post("runArena", `${root}/runs`, {
      query: WorkspaceRoutingQuery,
      payload: ArenaRunInput,
      success: described(ArenaRunDetailView, "Arena run result"),
      error: [HttpApiError.BadRequest, HttpApiError.InternalServerError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "arena.run",
        summary: "Run arena task",
        description: "Run the configured arena models in isolated worktrees and return the completed comparison.",
      }),
    ),
    HttpApiEndpoint.get("listArenaRuns", `${root}/runs`, {
      query: WorkspaceRoutingQuery,
      success: described(Schema.Array(ArenaRunView), "Arena runs"),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "arena.list",
        summary: "List arena runs",
        description:
          "Recent arena runs in this workspace, newest first. Runs are recorded by `arena_run` and `novaway arena`.",
      }),
    ),
    HttpApiEndpoint.get("getArenaRun", `${root}/runs/:runID`, {
      params: { runID: Schema.String },
      query: WorkspaceRoutingQuery,
      success: described(ArenaRunDetailView, "Arena run detail"),
      error: [HttpApiError.NotFound],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "arena.detail",
        summary: "Arena run detail",
        description: "One arena run with every contender's diff, verdict and usage.",
      }),
    ),
  )
  // 与其它 instance group 一致：路由需要实例上下文与工作区路由，并受认证保护。
  .middleware(InstanceContextMiddleware)
  .middleware(WorkspaceRoutingMiddleware)
  .middleware(Authorization)
