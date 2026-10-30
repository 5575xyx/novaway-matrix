import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { SessionPortability } from "@/session/portability"
import { Todo } from "@/session/todo"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Snapshot } from "@/snapshot"
import { BackgroundJob } from "@/background/job"
import { Schema, Struct } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
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

const root = "/session"
export const ListQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  scope: Schema.optional(Schema.Literals(["project"])),
  path: Schema.optional(Schema.String),
  roots: Schema.optional(QueryBoolean),
  start: Schema.optional(Schema.NumberFromString),
  search: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
})
export const ExportQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  redact: Schema.optional(QueryBoolean),
}).annotate({ identifier: "SessionExportQuery" })
export const ImportPayload = Schema.Struct({
  data: SessionPortability.Bundle,
}).annotate({ identifier: "SessionImportPayload" })

export const DiffQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  ...Struct.omit(SessionSummary.DiffInput.fields, ["sessionID"]),
})
export const MessagesQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  limit: Schema.optional(Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  before: Schema.optional(Schema.String),
})
export const StatusMap = Schema.Record(Schema.String, SessionStatus.Info)
export const TempFileInfo = Schema.Struct({
  path: Schema.String,
  relative: Schema.String,
  tool: Schema.String,
  createdAt: Schema.Number,
  size: Schema.Number,
}).annotate({ identifier: "SessionTempFile" })

export const TempFileCleanPayload = Schema.Struct({
  /** 只清理这些路径；省略表示清理全部可安全删除的。 */
  paths: Schema.optional(Schema.Array(Schema.String)),
})

export const TempFileCleanResult = Schema.Struct({
  removed: Schema.Array(Schema.String),
  skipped: Schema.Array(Schema.Struct({ path: Schema.String, reason: Schema.String })),
}).annotate({ identifier: "SessionTempFileCleanResult" })

export const BackgroundJobInfo = BackgroundJob.InfoSchema
export const UpdatePayload = Schema.Struct({
  title: Schema.optional(Schema.String),
  permission: Schema.optional(Permission.Ruleset),
  /** Session-scoped permission mode; omit to keep, pass nothing to reset is not possible via PATCH. */
  permissionMode: Schema.optional(Permission.Mode),
  /**
   * 团队目录注入模式；`selected` 必须同时给出 `teamIDs`。
   * 切到 `off` / `auto` 时内核会清空 `teamIDs`，避免切回来时带回已删团队。
   */
  teamMode: Schema.optional(Schema.Literals(["off", "auto", "selected"])),
  teamIDs: Schema.optional(Schema.Array(Schema.String)),
  /**
   * Move the session's working directory (fires the CwdChanged hook).
   * Named `cwd`, not `directory`: the query parameter already owns that name,
   * and the generated SDK would collide into `body_directory`.
   */
  cwd: Schema.optional(Schema.String),
  time: Schema.optional(
    Schema.Struct({
      archived: Schema.optional(Session.ArchivedTimestamp),
    }),
  ),
})
export const PlanApprovalPending = Schema.Struct({
  id: Schema.String,
  sessionID: Schema.String,
  parentID: Schema.optional(Schema.NullOr(Schema.String)),
  messageID: Schema.optional(Schema.String),
  plan: Schema.String,
  title: Schema.optional(Schema.String),
  createdAt: Schema.Number,
}).annotate({ identifier: "PlanApprovalPending" })

export const PlanApprovalReplyPayload = Schema.Struct({
  approved: Schema.Boolean,
  feedback: Schema.optional(Schema.String),
})

export const ForkPayload = Schema.Struct(Struct.omit(Session.ForkInput.fields, ["sessionID"]))
export const InitPayload = Schema.Struct({
  modelID: ModelID,
  providerID: ProviderID,
  messageID: MessageID,
})
export const SummarizePayload = Schema.Struct({
  providerID: ProviderID,
  modelID: ModelID,
  auto: Schema.optional(Schema.Boolean),
  /** `/compact <instructions>`: extra guidance for what the summary should keep. */
  instructions: Schema.optional(Schema.String),
})
export const PromptPayload = Schema.Struct(Struct.omit(SessionPrompt.PromptInput.fields, ["sessionID"]))
export const CommandPayload = Schema.Struct(Struct.omit(SessionPrompt.CommandInput.fields, ["sessionID"]))
export const ShellPayload = Schema.Struct(Struct.omit(SessionPrompt.ShellInput.fields, ["sessionID"]))
export const RevertPayload = Schema.Struct(Struct.omit(SessionRevert.RevertInput.fields, ["sessionID"]))
export const RevertPreviewPayload = Schema.Struct({
  messageID: MessageID,
})
export const PermissionResponsePayload = Schema.Struct({
  response: Permission.Reply,
})

export const SessionPaths = {
  list: root,
  status: `${root}/status`,
  get: `${root}/:sessionID`,
  children: `${root}/:sessionID/children`,
  todo: `${root}/:sessionID/todo`,
  diff: `${root}/:sessionID/diff`,
  messages: `${root}/:sessionID/message`,
  message: `${root}/:sessionID/message/:messageID`,
  create: root,
  remove: `${root}/:sessionID`,
  update: `${root}/:sessionID`,
  fork: `${root}/:sessionID/fork`,
  abort: `${root}/:sessionID/abort`,
  background: `${root}/:sessionID/background`,
  backgroundCancel: `${root}/:sessionID/background/:jobID`,
  tempFiles: `${root}/:sessionID/temp-files`,
  tempFilesClean: `${root}/:sessionID/temp-files/clean`,
  planApproval: `${root}/:sessionID/plan-approval`,
  planApprovalReply: `${root}/:sessionID/plan-approval/:requestID`,
  share: `${root}/:sessionID/share`,
  export: `${root}/:sessionID/export`,
  import: `${root}/import`,
  init: `${root}/:sessionID/init`,
  summarize: `${root}/:sessionID/summarize`,
  prompt: `${root}/:sessionID/message`,
  promptAsync: `${root}/:sessionID/prompt_async`,
  resume: `${root}/:sessionID/resume`,
  command: `${root}/:sessionID/command`,
  shell: `${root}/:sessionID/shell`,
  revert: `${root}/:sessionID/revert`,
  revertPreview: `${root}/:sessionID/revert/preview`,
  unrevert: `${root}/:sessionID/unrevert`,
  permissions: `${root}/:sessionID/permissions/:permissionID`,
  deleteMessage: `${root}/:sessionID/message/:messageID`,
  deletePart: `${root}/:sessionID/message/:messageID/part/:partID`,
  updatePart: `${root}/:sessionID/message/:messageID/part/:partID`,
} as const

export const SessionApi = HttpApi.make("session")
  .add(
    HttpApiGroup.make("session")
      .add(
        HttpApiEndpoint.get("list", SessionPaths.list, {
          query: ListQuery,
          success: described(Schema.Array(Session.Info), "List of sessions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.list",
            summary: "List sessions",
            description: "Get a list of all NovaWay sessions, sorted by most recently updated.",
          }),
        ),
        HttpApiEndpoint.get("status", SessionPaths.status, {
          query: WorkspaceRoutingQuery,
          success: described(StatusMap, "Get session status"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.status",
            summary: "Get session status",
            description: "Retrieve the current status of all sessions, including active, idle, and completed states.",
          }),
        ),
        HttpApiEndpoint.get("get", SessionPaths.get, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Session.Info, "Get session"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.get",
            summary: "Get session",
            description: "Retrieve detailed information about a specific NovaWay session.",
          }),
        ),
        HttpApiEndpoint.get("children", SessionPaths.children, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Session.Info), "List of children"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.children",
            summary: "Get session children",
            description: "Retrieve all child sessions that were forked from the specified parent session.",
          }),
        ),
        HttpApiEndpoint.get("todo", SessionPaths.todo, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(Todo.Info), "Todo list"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.todo",
            summary: "Get session todos",
            description: "Retrieve the todo list associated with a specific session, showing tasks and action items.",
          }),
        ),
        HttpApiEndpoint.get("diff", SessionPaths.diff, {
          params: { sessionID: SessionID },
          query: DiffQuery,
          success: described(Schema.Array(Snapshot.FileDiff), "Successfully retrieved diff"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.diff",
            summary: "Get message diff",
            description: "Get the file changes (diff) that resulted from a specific user message in the session.",
          }),
        ),
        HttpApiEndpoint.get("messages", SessionPaths.messages, {
          params: { sessionID: SessionID },
          query: MessagesQuery,
          success: described(Schema.Array(MessageV2.WithParts), "List of messages"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.messages",
            summary: "Get session messages",
            description: "Retrieve all messages in a session, including user prompts and AI responses.",
          }),
        ),
        HttpApiEndpoint.get("message", SessionPaths.message, {
          params: { sessionID: SessionID, messageID: MessageID },
          query: WorkspaceRoutingQuery,
          success: described(MessageV2.WithParts, "Message"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.message",
            summary: "Get message",
            description: "Retrieve a specific message from a session by its message ID.",
          }),
        ),
        HttpApiEndpoint.post("create", SessionPaths.create, {
          query: WorkspaceRoutingQuery,
          payload: [HttpApiSchema.NoContent, Session.CreateInput],
          success: described(Session.Info, "Successfully created session"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.create",
            summary: "Create session",
            description: "Create a new NovaWay session for interacting with AI assistants and managing conversations.",
          }),
        ),
        HttpApiEndpoint.delete("remove", SessionPaths.remove, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Successfully deleted session"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.delete",
            summary: "Delete session",
            description: "Delete a session and permanently remove all associated data, including messages and history.",
          }),
        ),
        HttpApiEndpoint.patch("update", SessionPaths.update, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: UpdatePayload,
          success: described(Session.Info, "Successfully updated session"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.update",
            summary: "Update session",
            description: "Update properties of an existing session, such as title or other metadata.",
          }),
        ),
        HttpApiEndpoint.post("fork", SessionPaths.fork, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: Schema.optional(ForkPayload),
          success: described(Session.Info, "200"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.fork",
            summary: "Fork session",
            description: "Create a new session by forking an existing session at a specific message point.",
          }),
        ),
        HttpApiEndpoint.post("abort", SessionPaths.abort, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Aborted session"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.abort",
            summary: "Abort session",
            description: "Abort an active session and stop any ongoing AI processing or command execution.",
          }),
        ),
        // 后台任务（子代理 / 后台命令）属于某个会话，但没有消息事件可推；
        // 右侧状态卡按需轮询这两个端点拿实时状态并支持停止。
        HttpApiEndpoint.get("background", SessionPaths.background, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(BackgroundJobInfo), "Background jobs"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.background",
            summary: "List background jobs",
            description: "List background subagents and commands spawned by a session.",
          }),
        ),
        HttpApiEndpoint.get("tempFiles", SessionPaths.tempFiles, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(TempFileInfo), "Temporary files created by tools"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.tempFiles.list",
            summary: "List temporary files",
            description: "Temporary files created by tools in this session (tmp-*, scratch/, *.tmp ...).",
          }),
        ),
        HttpApiEndpoint.get("planApproval", SessionPaths.planApproval, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(PlanApprovalPending), "Pending plan approvals"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.planApproval.list",
            summary: "List pending plan approvals",
            description: "Subagent plans waiting for the lead to approve or reject them.",
          }),
        ),
        HttpApiEndpoint.post("planApprovalReply", SessionPaths.planApprovalReply, {
          params: { sessionID: SessionID, requestID: Schema.String },
          query: WorkspaceRoutingQuery,
          payload: PlanApprovalReplyPayload,
          success: described(Schema.Boolean, "Reply accepted"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.planApproval.reply",
            summary: "Approve or reject a plan",
            description: "Resolve a pending plan approval request from the lead session.",
          }),
        ),
        HttpApiEndpoint.post("tempFilesClean", SessionPaths.tempFilesClean, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: TempFileCleanPayload,
          success: described(TempFileCleanResult, "Cleanup result"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.tempFiles.clean",
            summary: "Clean temporary files",
            description:
              "Delete tracked temporary files. Files modified after creation are skipped unless force is used.",
          }),
        ),
        HttpApiEndpoint.delete("backgroundCancel", SessionPaths.backgroundCancel, {
          params: { sessionID: SessionID, jobID: Schema.String },
          query: WorkspaceRoutingQuery,
          success: described(Schema.NullOr(BackgroundJobInfo), "Cancelled background job"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.background.cancel",
            summary: "Cancel background job",
            description: "Stop a running background subagent or command that belongs to the session.",
          }),
        ),
        HttpApiEndpoint.post("init", SessionPaths.init, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: InitPayload,
          success: described(Schema.Boolean, "200"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.init",
            summary: "Initialize session",
            description:
              "Analyze the current application and create an AGENTS.md file with project-specific agent configurations.",
          }),
        ),
        HttpApiEndpoint.get("exportSession", SessionPaths.export, {
          params: { sessionID: SessionID },
          query: ExportQuery,
          success: described(SessionPortability.Bundle, "Session export"),
          error: [ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.export",
            summary: "Export session",
            description:
              "Return one session with every message and part as a single JSON document. " +
              "`redact=true` replaces user-authored text and paths so the bundle can be attached to a report.",
          }),
        ),
        HttpApiEndpoint.post("importSession", SessionPaths.import, {
          query: WorkspaceRoutingQuery,
          payload: ImportPayload,
          success: described(Session.Info, "Imported session"),
          error: [HttpApiError.BadRequest],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.import",
            summary: "Import session",
            description:
              "Write a previously exported bundle into this project. Existing sessions are re-pointed at this " +
              "project; messages and parts that already exist are left untouched.",
          }),
        ),
        HttpApiEndpoint.post("share", SessionPaths.share, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Session.Info, "Successfully shared session"),
          error: [HttpApiError.InternalServerError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.share",
            summary: "Share session",
            description: "Create a shareable link for a session, allowing others to view the conversation.",
          }),
        ),
        HttpApiEndpoint.delete("unshare", SessionPaths.share, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Session.Info, "Successfully unshared session"),
          error: [HttpApiError.InternalServerError, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.unshare",
            summary: "Unshare session",
            description: "Remove the shareable link for a session, making it private again.",
          }),
        ),
        HttpApiEndpoint.post("summarize", SessionPaths.summarize, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: SummarizePayload,
          success: described(Schema.Boolean, "Summarized session"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.summarize",
            summary: "Summarize session",
            description: "Generate a concise summary of the session using AI compaction to preserve key information.",
          }),
        ),
        HttpApiEndpoint.post("prompt", SessionPaths.prompt, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: PromptPayload,
          success: described(MessageV2.WithParts, "Created message"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.prompt",
            summary: "Send message",
            description: "Create and send a new message to a session, streaming the AI response.",
          }),
        ),
        HttpApiEndpoint.post("promptAsync", SessionPaths.promptAsync, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: PromptPayload,
          success: described(HttpApiSchema.NoContent, "Prompt accepted"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.prompt_async",
            summary: "Send async message",
            description:
              "Create and send a new message to a session asynchronously, starting the session if needed and returning immediately.",
          }),
        ),
        HttpApiEndpoint.post("resume", SessionPaths.resume, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(HttpApiSchema.NoContent, "Continuation accepted"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.resume",
            summary: "Continue an interrupted turn",
            description:
              "Resume the last assistant turn after an unexpected interruption. No new user message is created: the model continues the same turn with the existing context.",
          }),
        ),
        HttpApiEndpoint.post("command", SessionPaths.command, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: CommandPayload,
          success: described(MessageV2.WithParts, "Created message"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.command",
            summary: "Send command",
            description: "Send a new command to a session for execution by the AI assistant.",
          }),
        ),
        HttpApiEndpoint.post("shell", SessionPaths.shell, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: ShellPayload,
          success: described(MessageV2.WithParts, "Created message"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.shell",
            summary: "Run shell command",
            description: "Execute a shell command within the session context and return the AI's response.",
          }),
        ),
        HttpApiEndpoint.post("revert", SessionPaths.revert, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: RevertPayload,
          success: described(Session.Info, "Updated session"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.revert",
            summary: "Revert message",
            description:
              "Revert a specific message in a session, undoing its effects and restoring the previous state.",
          }),
        ),
        HttpApiEndpoint.post("revertPreview", SessionPaths.revertPreview, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          payload: RevertPreviewPayload,
          success: described(Schema.Array(Snapshot.FileDiff), "Preview of file changes"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.revertPreview",
            summary: "Preview revert",
            description: "Preview the file changes that would result from reverting to a specific message.",
          }),
        ),
        HttpApiEndpoint.post("unrevert", SessionPaths.unrevert, {
          params: { sessionID: SessionID },
          query: WorkspaceRoutingQuery,
          success: described(Session.Info, "Updated session"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.unrevert",
            summary: "Restore reverted messages",
            description: "Restore all previously reverted messages in a session.",
          }),
        ),
        HttpApiEndpoint.post("permissionRespond", SessionPaths.permissions, {
          params: { sessionID: SessionID, permissionID: PermissionID },
          query: WorkspaceRoutingQuery,
          payload: PermissionResponsePayload,
          success: described(Schema.Boolean, "Permission processed successfully"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "permission.respond",
            summary: "Respond to permission",
            description: "Approve or deny a permission request from the AI assistant.",
            deprecated: true,
          }),
        ),
        HttpApiEndpoint.delete("deleteMessage", SessionPaths.deleteMessage, {
          params: { sessionID: SessionID, messageID: MessageID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Successfully deleted message"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "session.deleteMessage",
            summary: "Delete message",
            description:
              "Permanently delete a specific message and all of its parts from a session without reverting file changes.",
          }),
        ),
        HttpApiEndpoint.delete("deletePart", SessionPaths.deletePart, {
          params: { sessionID: SessionID, messageID: MessageID, partID: PartID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Successfully deleted part"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "part.delete",
            description: "Delete a part from a message.",
          }),
        ),
        HttpApiEndpoint.patch("updatePart", SessionPaths.updatePart, {
          params: { sessionID: SessionID, messageID: MessageID, partID: PartID },
          query: WorkspaceRoutingQuery,
          payload: MessageV2.Part,
          success: described(MessageV2.Part, "Successfully updated part"),
          error: [HttpApiError.BadRequest, ApiNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "part.update",
            description: "Update a part in a message.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "session",
          description: "Experimental HttpApi session routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "NovaWay experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
