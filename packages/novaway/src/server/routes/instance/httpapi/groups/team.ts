import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/session/:sessionID/team"

export const TeamView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  rootSessionID: Schema.String,
}).annotate({ identifier: "TeamView" })

export const TeamUsageView = Schema.Struct({
  cost: Schema.Number,
  input: Schema.Number,
  output: Schema.Number,
  reasoning: Schema.Number,
  cacheRead: Schema.Number,
  cacheWrite: Schema.Number,
  total: Schema.Number,
}).annotate({ identifier: "TeamUsageView" })

export const TeamMemberView = Schema.Struct({
  sessionID: Schema.String,
  name: Schema.String,
  agent: Schema.String,
  role: Schema.Literals(["lead", "worker"]),
  status: Schema.Literals(["idle", "active", "archived"]),
  currentTaskID: Schema.optional(Schema.String),
  worktreePath: Schema.optional(Schema.String),
  usage: Schema.optional(TeamUsageView),
}).annotate({ identifier: "TeamMemberView" })

export const TeamTaskView = Schema.Struct({
  id: Schema.String,
  subject: Schema.String,
  status: Schema.Literals(["pending", "in_progress", "completed", "failed", "cancelled"]),
  ownerSessionID: Schema.optional(Schema.String),
  blockedBy: Schema.Array(Schema.String),
  activeForm: Schema.optional(Schema.String),
  usage: Schema.optional(TeamUsageView),
}).annotate({ identifier: "TeamTaskView" })

export const TeamOverview = Schema.Struct({
  team: Schema.optional(TeamView),
  members: Schema.Array(TeamMemberView),
  tasks: Schema.Array(TeamTaskView),
  usage: Schema.optional(TeamUsageView),
}).annotate({ identifier: "TeamOverview" })

export const TeamMessagePayload = Schema.Struct({
  to: Schema.String,
  message: Schema.String,
  summary: Schema.optional(Schema.String),
  mode: Schema.optional(Schema.Literals(["queue", "interrupt"])),
})

export const TeamApi = HttpApi.make("team")
  .add(
    HttpApiGroup.make("team")
      .add(
        HttpApiEndpoint.get("overview", root, {
          params: { sessionID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(TeamOverview, "Team overview"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "team.overview",
            summary: "Get team overview",
            description: "Return the team, its members and the shared task list for a session.",
          }),
        ),
        HttpApiEndpoint.post("message", `${root}/message`, {
          params: { sessionID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: TeamMessagePayload,
          success: described(Schema.Boolean, "Message queued"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "team.message",
            summary: "Send a message to a teammate",
            description: "Queue or deliver a message to another agent in the session team.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "team",
          description: "Multi-agent team routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "NovaWay team HttpApi",
      version: "0.0.1",
      description: "Team and shared task board surface.",
    }),
  )
