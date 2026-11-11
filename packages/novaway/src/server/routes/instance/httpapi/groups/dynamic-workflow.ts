import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import {
  WorkspaceRoutingMiddleware,
  WorkspaceRoutingQuery,
  WorkspaceRoutingQueryFields,
} from "../middleware/workspace-routing"
import { ApiNotFoundError } from "../errors"
import { described } from "./metadata"
import { QueryBoolean } from "./query"

const root = "/dynamic-workflow"

/**
 * 动态工作流的**只读**接口。
 *
 * 为什么是只读：一次 run 的起点永远是工具调用（`create_workflow` / `resume_workflow_run`）——
 * 那里有脚本、有用户确认、有驱动。HTTP 这一层只回答「跑过什么、跑到哪、留下了什么」，
 * 让界面能把库里已有的东西画出来。唯一的例外是 stop：用户点停止时不该再绕回模型。
 *
 * 查询按 instance 目录收窄（`all=true` 才跨目录），与 `workflow_run` 工具的 list 口径一致。
 */
export const DynamicWorkflowPaths = {
  runs: `${root}/runs`,
  run: `${root}/runs/:runId`,
  nodes: `${root}/runs/:runId/nodes`,
  actors: `${root}/runs/:runId/actors`,
  events: `${root}/runs/:runId/events`,
  stop: `${root}/runs/:runId/stop`,
} as const

const RunStatus = Schema.Literals(["running", "completed", "errored", "stopped"])
const NodeStatus = Schema.Literals(["running", "completed", "failed"])
const StopReason = Schema.Literals(["user", "model", "provider", "interrupted"])

const summaryFields = {
  runId: Schema.String,
  name: Schema.optional(Schema.String),
  cwd: Schema.String,
  status: RunStatus,
  stopReason: Schema.optional(StopReason),
  spentTokens: Schema.Number,
  maxConcurrency: Schema.Number,
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
} as const

export const DynamicWorkflowRunSummary = Schema.Struct(summaryFields).annotate({
  identifier: "DynamicWorkflowRunSummary",
})

export const DynamicWorkflowProgress = Schema.Struct({
  nodes: Schema.Struct({
    total: Schema.Number,
    completed: Schema.Number,
    failed: Schema.Number,
    running: Schema.Number,
    reports: Schema.Number,
  }),
  actors: Schema.Number,
  events: Schema.Number,
}).annotate({ identifier: "DynamicWorkflowProgress" })

export const DynamicWorkflowRunDetail = Schema.Struct({
  ...summaryFields,
  /** 脚本原文。恢复与「作者到底写了什么」都靠它——界面要看原文时直接把这份给出去。 */
  scriptText: Schema.String,
  scriptHash: Schema.String,
  parentSessionID: Schema.optional(Schema.String),
  resumedFrom: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  result: Schema.optional(Schema.Unknown),
  failure: Schema.optional(Schema.Unknown),
  /** `stopped` 才能恢复。界面据此决定要不要显示「接着跑」。 */
  resumable: Schema.Boolean,
  /** 进程内还持有它 —— 此刻能停；重启之后读到的历史是 false。 */
  live: Schema.Boolean,
  progress: DynamicWorkflowProgress,
}).annotate({ identifier: "DynamicWorkflowRunDetail" })

export const DynamicWorkflowNode = Schema.Struct({
  siteId: Schema.String,
  ordinal: Schema.Number,
  kind: Schema.String,
  status: NodeStatus,
  inputHash: Schema.String,
  phase: Schema.optional(Schema.String),
  actor: Schema.optional(Schema.Struct({ siteId: Schema.String, ordinal: Schema.Number })),
  actorSeq: Schema.optional(Schema.Number),
  result: Schema.optional(Schema.Unknown),
  failure: Schema.optional(Schema.Unknown),
  timeCreated: Schema.Number,
  timeUpdated: Schema.Number,
}).annotate({ identifier: "DynamicWorkflowNode" })

export const DynamicWorkflowActor = Schema.Struct({
  siteId: Schema.String,
  ordinal: Schema.Number,
  name: Schema.optional(Schema.String),
  sessionID: Schema.optional(Schema.String),
}).annotate({ identifier: "DynamicWorkflowActor" })

export const DynamicWorkflowEvent = Schema.Struct({
  sequence: Schema.Number,
  type: Schema.String,
  payload: Schema.Unknown,
  timeCreated: Schema.Number,
}).annotate({ identifier: "DynamicWorkflowEvent" })

export const ListRunsQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  /** 缺省只列当前目录。跨目录要在界面上明确说「全部」，所以默认关。 */
  all: Schema.optional(QueryBoolean),
  limit: Schema.optional(Schema.NumberFromString),
})

export const ListNodesQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  /** 逗号分隔的 kind：`ask,world-read,report`。缺省是全部。 */
  kinds: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
  /** 结果可能很大，只有展开某一步时才要。 */
  withResult: Schema.optional(QueryBoolean),
})

export const ListEventsQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  /** 只取序号大于它的：时间线向上翻页用。 */
  after: Schema.optional(Schema.NumberFromString),
  limit: Schema.optional(Schema.NumberFromString),
})

export const DynamicWorkflowApi = HttpApi.make("dynamic-workflow")
  .add(
    HttpApiGroup.make("dynamic-workflow")
      .add(
        HttpApiEndpoint.get("listRuns", DynamicWorkflowPaths.runs, {
          query: ListRunsQuery,
          success: described(Schema.Array(DynamicWorkflowRunSummary), "Recent dynamic workflow runs"),
        }),
        HttpApiEndpoint.get("getRun", DynamicWorkflowPaths.run, {
          params: { runId: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(DynamicWorkflowRunDetail, "Run header with progress"),
          error: [ApiNotFoundError],
        }),
        HttpApiEndpoint.get("listNodes", DynamicWorkflowPaths.nodes, {
          params: { runId: Schema.String },
          query: ListNodesQuery,
          success: described(Schema.Array(DynamicWorkflowNode), "Nodes of a run, in arrival order"),
          error: [ApiNotFoundError],
        }),
        HttpApiEndpoint.get("listActors", DynamicWorkflowPaths.actors, {
          params: { runId: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(DynamicWorkflowActor), "Subagents of a run"),
          error: [ApiNotFoundError],
        }),
        HttpApiEndpoint.get("listEvents", DynamicWorkflowPaths.events, {
          params: { runId: Schema.String },
          query: ListEventsQuery,
          success: described(Schema.Array(DynamicWorkflowEvent), "Journal events, by sequence"),
          error: [ApiNotFoundError],
        }),
        HttpApiEndpoint.post("stopRun", DynamicWorkflowPaths.stop, {
          params: { runId: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(
            Schema.Struct({ requested: Schema.Boolean }),
            "Whether a live run was asked to stop; false means it had already settled",
          ),
          error: [ApiNotFoundError],
        }),
      )
      .annotateMerge(
        OpenApi.annotations({ title: "dynamic-workflow", description: "Read-only access to workflow runs." }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(OpenApi.annotations({ title: "Dynamic workflow", version: "0.0.1" }))

export * as DynamicWorkflowGroup from "./dynamic-workflow"
