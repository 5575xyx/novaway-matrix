import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/session/:sessionID/team"
/** Workspace-level routes used by the standalone team page. */
const workspaceRoot = "/team"

export const TeamView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  rootSessionID: Schema.String,
  /** Auto 模式是否可以把这一队纳入候选（团队页可切换）。 */
  autoEligible: Schema.Boolean,
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

export const TeamMessageView = Schema.Struct({
  id: Schema.String,
  from: Schema.String,
  fromName: Schema.optional(Schema.String),
  to: Schema.optional(Schema.String),
  toName: Schema.optional(Schema.String),
  broadcast: Schema.Boolean,
  summary: Schema.optional(Schema.String),
  content: Schema.String,
  createdAt: Schema.Number,
  readAt: Schema.optional(Schema.Number),
}).annotate({ identifier: "TeamMessageView" })

export const TeamSummaryView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
  rootSessionID: Schema.String,
  memberCount: Schema.Number,
  autoEligible: Schema.Boolean,
  updatedAt: Schema.Number,
}).annotate({ identifier: "TeamSummaryView" })

export const TeamDetail = Schema.Struct({
  team: TeamView,
  members: Schema.Array(TeamMemberView),
  tasks: Schema.Array(TeamTaskView),
  usage: Schema.optional(TeamUsageView),
  messages: Schema.Array(TeamMessageView),
}).annotate({ identifier: "TeamDetail" })

export const TeamMemberInput = Schema.Struct({
  agent: Schema.String,
  name: Schema.optional(Schema.String),
})

export const TeamCreatePayload = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  /** Agent used for the lead session; defaults to the default agent. */
  lead: Schema.optional(Schema.String),
  members: Schema.Array(TeamMemberInput),
})

export const TeamUpdatePayload = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  /** 只有打开后，Auto 模式才会把这一队当作候选。 */
  autoEligible: Schema.optional(Schema.Boolean),
})

export const TeamMessageSendPayload = Schema.Struct({
  content: Schema.String,
  /** Member name or session id. Omit to broadcast to every worker. */
  to: Schema.optional(Schema.String),
  /** Also run the member's agent and post its reply into the chat. */
  dispatch: Schema.optional(Schema.Boolean),
})

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
        HttpApiEndpoint.get("listTeams", workspaceRoot, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(TeamSummaryView), "Teams"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "team.list",
            summary: "List teams",
            description: "List every multi-agent team in this workspace with its member count.",
          }),
        ),
        HttpApiEndpoint.post("createTeam", workspaceRoot, {
          query: WorkspaceRoutingQuery,
          payload: TeamCreatePayload,
          success: described(TeamDetail, "Created team"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "team.create",
            summary: "Create a team",
            description: "Create a lead session plus one session per member agent, and register them as a team.",
          }),
        ),
        HttpApiEndpoint.get("teamDetail", `${workspaceRoot}/:teamID`, {
          params: { teamID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(TeamDetail, "Team detail"),
          error: [HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "team.detail",
            summary: "Team detail",
            description: "Team, members, shared tasks, usage and chat transcript.",
          }),
        ),
        HttpApiEndpoint.patch("updateTeam", `${workspaceRoot}/:teamID`, {
          params: { teamID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: TeamUpdatePayload,
          success: described(TeamDetail, "Updated team"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "team.update",
            summary: "Update a team",
            description: "Rename a team, change its description, or opt it into Auto mode.",
          }),
        ),
        HttpApiEndpoint.delete("removeTeam", `${workspaceRoot}/:teamID`, {
          params: { teamID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Team removed"),
          error: [HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "team.remove",
            summary: "Delete a team",
            description: "Remove the team and its member list. Sessions are kept.",
          }),
        ),
        HttpApiEndpoint.post("addTeamMember", `${workspaceRoot}/:teamID/member`, {
          params: { teamID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: TeamMemberInput,
          success: described(TeamDetail, "Updated team"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "team.member.add",
            summary: "Add a team member",
            description: "Create a session for an agent and add it to the team.",
          }),
        ),
        HttpApiEndpoint.delete("removeTeamMember", `${workspaceRoot}/:teamID/member/:sessionID`, {
          params: { teamID: Schema.String, sessionID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Member removed"),
          error: [HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "team.member.remove",
            summary: "Remove a team member",
            description: "Detach a session from the team; the session itself is kept.",
          }),
        ),
        HttpApiEndpoint.get("teamMessages", `${workspaceRoot}/:teamID/message`, {
          params: { teamID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(TeamMessageView), "Messages"),
          error: [HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "team.message.list",
            summary: "Team chat transcript",
            description: "Messages exchanged inside a team, oldest first.",
          }),
        ),
        HttpApiEndpoint.post("sendTeamMessage", `${workspaceRoot}/:teamID/message`, {
          params: { teamID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: TeamMessageSendPayload,
          success: described(Schema.Boolean, "Message queued"),
          error: [HttpApiError.BadRequest, HttpApiError.NotFound],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "team.message.send",
            summary: "Send a team message",
            description:
              "Post a message into the team chat and (by default) run the targeted members so they can reply.",
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
